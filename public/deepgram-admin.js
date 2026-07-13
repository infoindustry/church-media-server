(() => {
  const SOURCE_LANGUAGE_KEY = 'church.translation.deepgram.sourceLang';
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init?.method || 'GET').toUpperCase();
    if (url.includes('/api/translation/live/start') && method === 'POST' && init?.body) {
      try {
        const body = JSON.parse(init.body);
        if (body.engine === 'deepgram') {
          body.sourceLang = localStorage.getItem(SOURCE_LANGUAGE_KEY) || 'ru';
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {}
    }
    return originalFetch(input, init);
  };

  let state = null;
  let pollTimer = null;

  function findCard() {
    return [...document.querySelectorAll('.live-translation-card, .card')]
      .find(card => card.querySelector('h2')?.textContent?.includes('Своё решение')) || null;
  }

  function ensureEngineOption(card) {
    const select = card.querySelector('label select');
    if (!select || select.querySelector('option[value="deepgram"]')) return select;
    const option = document.createElement('option');
    option.value = 'deepgram';
    option.textContent = 'Deepgram STT + OpenAI Text';
    select.appendChild(option);
    return select;
  }

  function ensureSourceLanguage(card, engineSelect) {
    let wrapper = card.querySelector('[data-deepgram-source-language]');
    if (!wrapper) {
      wrapper = document.createElement('label');
      wrapper.dataset.deepgramSourceLanguage = '1';
      wrapper.innerHTML = `Язык исходной речи
        <select>
          <option value="ru">Русский</option>
          <option value="en">English</option>
          <option value="nl">Nederlands</option>
          <option value="sr">Srpski</option>
          <option value="uk">Українська</option>
          <option value="de">Deutsch</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
        </select>`;
      const select = wrapper.querySelector('select');
      select.value = localStorage.getItem(SOURCE_LANGUAGE_KEY) || 'ru';
      select.addEventListener('change', () => localStorage.setItem(SOURCE_LANGUAGE_KEY, select.value));
      card.querySelector('.form-row')?.appendChild(wrapper);
    }
    wrapper.style.display = engineSelect?.value === 'deepgram' ? '' : 'none';
  }

  function ensureInlineStatus(card) {
    let panel = card.querySelector('[data-deepgram-inline-status]');
    if (!panel) {
      panel = document.createElement('div');
      panel.dataset.deepgramInlineStatus = '1';
      panel.style.marginTop = '12px';
      panel.style.padding = '12px';
      panel.style.border = '1px solid rgba(127,127,127,.25)';
      panel.style.borderRadius = '12px';
      card.querySelector('.live-tr-status')?.after(panel);
    }
    return panel;
  }

  function render(card, engineSelect) {
    const isDeepgramSelected = engineSelect?.value === 'deepgram';
    const isDeepgramRunning = state?.running && state?.engine === 'deepgram';
    ensureSourceLanguage(card, engineSelect);

    const heading = card.querySelector('h2');
    if (heading) heading.textContent = 'Своё решение · OpenAI / Gemini / Deepgram';

    const keyBox = card.querySelector('.live-tr-key');
    if (keyBox && isDeepgramSelected) {
      const status = state?.pipeline?.sttStatus;
      keyBox.innerHTML = `<span class="badge ${status === 'open' ? 'ok' : 'warn'}">${status === 'open' ? 'Deepgram подключён' : 'нужны DEEPGRAM_API_KEY + OPENAI_API_KEY'}</span>`;
    }

    const panel = ensureInlineStatus(card);
    panel.style.display = isDeepgramSelected || isDeepgramRunning ? '' : 'none';
    if (!(isDeepgramSelected || isDeepgramRunning)) return;

    const pipeline = state?.pipeline || {};
    const sourceAge = pipeline.lastSourceTranscriptAt
      ? Math.max(0, Math.round((Date.now() - pipeline.lastSourceTranscriptAt) / 1000))
      : null;
    const sourceText = pipeline.lastSourceText || 'Распознанная речь появится здесь после запуска.';
    panel.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span class="badge ${pipeline.sttStatus === 'open' ? 'ok' : 'warn'}">Deepgram STT: ${pipeline.sttStatus || 'не запущен'}</span>
        <span class="badge">Модель: ${pipeline.sttModel || 'nova-3'}</span>
        <span class="badge">Перевод: ${pipeline.translationModel || 'OpenAI text'}</span>
        <span class="badge ${Number(pipeline.pendingTranslations || 0) ? 'warn' : 'ok'}">Очередь: ${pipeline.pendingTranslations || 0}</span>
        ${sourceAge !== null ? `<span class="badge">Исходный текст: ${sourceAge} с назад</span>` : ''}
      </div>
      <div style="font-size:13px;opacity:.75;margin-bottom:5px">Последняя распознанная фраза</div>
      <div style="font-size:16px;line-height:1.45">${escapeHtml(sourceText)}</div>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function enhance() {
    const card = findCard();
    if (!card) return;
    const engineSelect = ensureEngineOption(card);
    if (!engineSelect) return;
    if (!engineSelect.dataset.deepgramBound) {
      engineSelect.dataset.deepgramBound = '1';
      engineSelect.addEventListener('change', () => render(card, engineSelect));
    }
    render(card, engineSelect);
  }

  async function refreshState() {
    try {
      const response = await originalFetch('/api/translation/live/state', { cache: 'no-store' });
      if (response.ok) state = await response.json();
    } catch {}
    enhance();
  }

  new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
  refreshState();
  pollTimer = setInterval(refreshState, 2000);
  window.addEventListener('beforeunload', () => clearInterval(pollTimer));
})();

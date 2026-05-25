import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Monitor, Music, BookOpen, QrCode, Megaphone, Moon, Play, Pause,
  Square, RotateCcw, Search, Upload, Wifi, AlertTriangle, CheckCircle2,
  Video, Radio, Home, Trash2, ClipboardList, SkipForward, SkipBack,
  ListPlus, ArrowUp, ArrowDown, Plus, ExternalLink, Image, Images, Headphones, Volume2
} from 'lucide-react';
import './styles.css';

const API = '';

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

function postJson(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/screen')) return <ScreenApp />;
  return <AdminApp />;
}

function AdminApp() {
  const [tab, setTab] = useState('live');
  const [state, setState] = useState(null);
  const [settings, setSettings] = useState(null);
  const [plan, setPlan] = useState({ servicePlan: [], activePlanIndex: -1 });
  const [notice, setNotice] = useState('');

  async function refreshState() {
    setState(await api('/api/screen/state'));
  }

  async function refreshPlan() {
    setPlan(await api('/api/service-plan'));
  }

  async function refreshSettings() {
    const nextSettings = await api('/api/settings');
    setSettings(nextSettings);
    if (nextSettings?.churchName) document.title = nextSettings.churchName;
  }

  async function action(label, fn) {
    try {
      await fn();
      setNotice(label);
      setTimeout(() => setNotice(''), 1800);
      await refreshState();
      await refreshPlan();
    } catch (error) {
      alert(error.message);
    }
  }

  useEffect(() => {
    refreshState();
    refreshPlan();
    refreshSettings();
    const es = new EventSource('/api/screen/stream');
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'state') setState(data.state);
      } catch {}
    };
    return () => es.close();
  }, []);

  const tabs = [
    ['live', Monitor, 'Экран'],
    ['welcome', Home, 'Приветствие'],
    ['plan', ClipboardList, 'План'],
    ['songs', Music, 'Песни'],
    ['audio', Headphones, 'Фонограммы'],
    ['bible', BookOpen, 'Писание'],
    ['translation', QrCode, 'Перевод'],
    ['announcement', Megaphone, 'Объявления'],
    ['media', Images, 'Картинки'],
    ['checkup', Wifi, 'Проверка']
  ];

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <div className="eyebrow">Local-first church media</div>
          <h1>{settings?.churchName || 'Church Screen Control'}</h1>
        </div>
        <div className="header-actions">
          {notice && <div className="notice">{notice}</div>}
          <div className="status-pill"><Radio size={16} /> {state?.mode || 'loading'}</div>
        </div>
      </header>

      <main className="admin-main">
        <section className="card live-card">
          <div className="card-title-row">
            <div>
              <h2>Сейчас на ТВ</h2>
              <p>{describeState(state)}</p>
            </div>
            <button className="icon-btn" onClick={refreshState}><RotateCcw size={18} /></button>
          </div>
          <div className="quick-actions">
            <button onClick={() => action('Медиа: play', () => api('/api/screen/command', postJson({ command: 'play' })))}><Play size={18} /> Play</button>
            <button onClick={() => action('Медиа: pause', () => api('/api/screen/command', postJson({ command: 'pause' })))}><Pause size={18} /> Pause</button>
            <button onClick={() => action('Медиа: stop', () => api('/api/screen/command', postJson({ command: 'stop' })))}><Square size={18} /> Stop</button>
            <button onClick={() => action('Назад по плану', () => api('/api/service-plan/previous', { method: 'POST' }))}><SkipBack size={18} /> Назад</button>
            <button className="primary" onClick={() => action('Следующий пункт', () => api('/api/service-plan/next', { method: 'POST' }))}><SkipForward size={18} /> Следующий</button>
            <button className="danger" onClick={() => action('Blank', () => api('/api/blank', postJson({ payload: { title: '', subtitle: '' } })))}><Moon size={18} /> Blank</button>
          </div>
        </section>

        <nav className="tabbar">
          {tabs.map(([id, Icon, label]) => (
            <button key={id} className={cx(tab === id && 'active')} onClick={() => setTab(id)}>
              <Icon size={19} /> <span>{label}</span>
            </button>
          ))}
        </nav>

        {tab === 'live' && <LivePanel state={state} plan={plan} action={action} />}
        {tab === 'welcome' && <WelcomePanel action={action} refreshSettings={refreshSettings} />}
        {tab === 'plan' && <ServicePlanPanel plan={plan} refreshPlan={refreshPlan} action={action} />}
        {tab === 'songs' && <SongsPanel action={action} refreshPlan={refreshPlan} />}
        {tab === 'audio' && <AudioPanel action={action} refreshPlan={refreshPlan} />}
        {tab === 'bible' && <BiblePanel action={action} />}
        {tab === 'translation' && <TranslationPanel action={action} />}
        {tab === 'announcement' && <AnnouncementPanel action={action} />}
        {tab === 'media' && <MediaPanel action={action} />}
        {tab === 'checkup' && <CheckupPanel />}
      </main>
    </div>
  );
}

function describeState(state) {
  if (!state) return 'Подключение...';
  const p = state.payload || {};
  if (state.mode === 'welcome') return `Приветствие: ${p.title || p.subtitle || 'экран приветствия'}`;
  if (state.mode === 'song_video') return `Песня: ${p.title || 'без названия'}`;
  if (state.mode === 'audio_track') return `Фонограмма: ${p.title || 'без названия'}`;
  if (state.mode === 'youtube_audio') return `YouTube audio: ${p.title || 'без названия'}`;
  if (state.mode === 'bible') return `Писание: ${p.reference || ''}`;
  if (state.mode === 'translation_qr') return `QR перевода: ${p.title || p.url}`;
  if (state.mode === 'announcement') return `Объявление: ${p.title || ''}`;
  if (state.mode === 'image') return `Картинка: ${p.title || ''}`;
  if (state.mode === 'slideshow') return `Слайдшоу: ${p.title || ''} (${p.images?.length || 0})`;
  if (state.mode === 'blank') return p.title || p.subtitle ? `Заставка: ${p.title || p.subtitle}` : 'Черный экран';
  return state.mode;
}

function typeLabel(type) {
  return {
    welcome: 'Приветствие', song: 'Песня', song_video: 'Песня', audio: 'Фонограмма', audio_track: 'Фонограмма', youtube_audio: 'YouTube audio', youtube: 'YouTube', bible: 'Писание', translation_qr: 'Перевод', announcement: 'Объявление', image: 'Картинка', slideshow: 'Слайдшоу', blank: 'Blank', loading: 'Загрузка'
  }[type] || type;
}


function WelcomePanel({ action, refreshSettings }) {
  const [images, setImages] = useState([]);
  const [form, setForm] = useState({
    churchName: 'Word of God Crossroads Budva',
    title: 'Добро пожаловать',
    subtitle: 'Word of God Crossroads Budva',
    serviceText: 'Служение скоро начнется',
    language: 'ru',
    imageUrl: '',
    imageFit: 'cover',
    overlay: true,
    textAlign: 'center',
    showChurchName: true
  });

  async function load() {
    const settings = await api('/api/settings');
    const imgs = await api('/api/images');
    setImages(imgs || []);
    setForm({ ...form, ...(settings || {}), ...(settings?.welcome || {}) });
  }

  useEffect(() => { load(); }, []);

  async function save() {
    const saved = await api('/api/settings/welcome', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    await refreshSettings?.();
    return saved;
  }

  async function saveAndShow() {
    await save();
    return api('/api/welcome/show', postJson({}));
  }

  async function saveAndAddToPlan() {
    await save();
    return api('/api/welcome/add-to-plan', postJson({}));
  }

  const selectedImage = images.find(img => img.mediaUrl === form.imageUrl);

  return (
    <section className="grid two">
      <div className="card">
        <h2>Приветственный экран</h2>
        <p>Здесь настраивается нормальная заставка вместо пустого экрана: название церкви, приветствие, язык, фоновая картинка.</p>
        <div className="form">
          <label>Название церкви<input value={form.churchName || ''} onChange={e => setForm({ ...form, churchName: e.target.value, subtitle: e.target.value })} /></label>
          <label>Главная надпись<input value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Подзаголовок<input value={form.subtitle || ''} onChange={e => setForm({ ...form, subtitle: e.target.value })} /></label>
          <label>Дополнительная строка<input value={form.serviceText || ''} onChange={e => setForm({ ...form, serviceText: e.target.value })} /></label>
          <div className="form-row">
            <label>Язык/локаль
              <select value={form.language || 'ru'} onChange={e => setForm({ ...form, language: e.target.value })}>
                <option value="ru">Русский</option>
                <option value="en">English</option>
                <option value="me">Crnogorski</option>
                <option value="ua">Українська</option>
                <option value="sr">Srpski</option>
              </select>
            </label>
            <label>Режим картинки
              <select value={form.imageFit || 'cover'} onChange={e => setForm({ ...form, imageFit: e.target.value })}>
                <option value="cover">Заполнить экран</option>
                <option value="contain">Вместить целиком</option>
              </select>
            </label>
          </div>
          <label>Фоновая картинка из медиатеки
            <select value={form.imageUrl || ''} onChange={e => setForm({ ...form, imageUrl: e.target.value })}>
              <option value="">Без картинки / градиент</option>
              {images.map(img => <option key={img.id} value={img.mediaUrl}>{img.title}</option>)}
            </select>
          </label>
          <label className="checkline"><input type="checkbox" checked={Boolean(form.overlay)} onChange={e => setForm({ ...form, overlay: e.target.checked })} /> Затемнять фон под текстом</label>
          <label className="checkline"><input type="checkbox" checked={Boolean(form.showChurchName)} onChange={e => setForm({ ...form, showChurchName: e.target.checked })} /> Показывать название церкви</label>
          <div className="button-row">
            <button onClick={() => action('Приветствие сохранено', save)}><CheckCircle2 size={17} /> Сохранить</button>
            <button className="primary" onClick={() => action('Приветствие показано', saveAndShow)}><Monitor size={17} /> Показать на ТВ</button>
            <button onClick={() => action('Приветствие добавлено в план', saveAndAddToPlan)}><ListPlus size={17} /> В план</button>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>Превью</h2>
        <div className="welcome-preview">
          {selectedImage && <img src={selectedImage.mediaUrl} alt="background" />}
          <div className="welcome-preview-overlay">
            <div className="welcome-mini-mark">✦</div>
            <h3>{form.title}</h3>
            {form.showChurchName && <strong>{form.subtitle || form.churchName}</strong>}
            <p>{form.serviceText}</p>
          </div>
        </div>
        <p className="hint">Картинки загружаются в разделе “Картинки”, после этого их можно выбрать здесь как фон приветствия.</p>
      </div>
    </section>
  );
}

function LivePanel({ state, plan, action }) {
  const current = plan.servicePlan?.[plan.activePlanIndex];
  const next = plan.servicePlan?.[plan.activePlanIndex + 1];
  const p = state?.payload || {};
  const biblePageInfo = state?.mode === 'bible' && Array.isArray(p.pages)
    ? `страница ${(p.currentPage || 0) + 1} из ${p.pages.length}`
    : '';

  return (
    <section className="grid two">
      <div className="card">
        <h2>Быстрые действия</h2>
        <div className="stack">
          <button className="big-action" onClick={() => window.location.href = '/screen/main'}><Monitor /> Открыть TV Screen <ExternalLink size={17} /></button>
          <button className="big-action" onClick={() => action('Приветствие показано', () => api('/api/welcome/show', postJson({})))}><Home /> Приветствие</button>
          <button className="big-action" onClick={() => action('Медиа перезапущено', () => api('/api/screen/command', postJson({ command: 'restart' })))}><RotateCcw /> Restart media</button>
          <button className="big-action danger" onClick={() => action('Черный экран', () => api('/api/blank', postJson({ payload: { title: '', subtitle: '' } })))}><Moon /> Черный экран</button>
        </div>
      </div>

      <div className="card">
        <h2>План служения</h2>
        <div className="plan-summary">
          <div><strong>Сейчас:</strong> <span>{current ? `${plan.activePlanIndex + 1}. ${current.title}` : 'не выбран'}</span></div>
          <div><strong>Следующий:</strong> <span>{next ? `${plan.activePlanIndex + 2}. ${next.title}` : 'нет'}</span></div>
          <div><strong>Всего пунктов:</strong> <span>{plan.servicePlan?.length || 0}</span></div>
        </div>

        <div className="tv-summary-card">
          <div className="tv-summary-top">
            <span className="badge ok">{typeLabel(state?.mode || 'loading')}</span>
            {biblePageInfo && <span className="badge warn">{biblePageInfo}</span>}
          </div>
          <h3>{describeState(state)}</h3>
          {p.reference && <p><strong>Ссылка:</strong> {p.reference}</p>}
          {p.title && <p><strong>Заголовок:</strong> {p.title}</p>}
          {p.subtitle && <p><strong>Подзаголовок:</strong> {p.subtitle}</p>}
          {state?.mode === 'bible' && <p className="hint">Для длинной главы используй кнопки “Стихи вперед/назад” или “Следующий/Назад”. JSON больше не выводится на главной.</p>}
        </div>
      </div>
    </section>
  );
}

function ServicePlanPanel({ plan, refreshPlan, action }) {
  async function remove(id) {
    await api(`/api/service-plan/items/${id}`, { method: 'DELETE' });
    await refreshPlan();
  }
  async function move(id, direction) {
    await api(`/api/service-plan/items/${id}/move`, postJson({ direction }));
    await refreshPlan();
  }
  async function clear() {
    if (!confirm('Очистить план служения?')) return;
    await api('/api/service-plan/clear', { method: 'POST' });
    await refreshPlan();
  }
  async function addBlank() {
    await api('/api/service-plan/items', postJson({ type: 'blank', title: 'Черный экран', payload: { title: '', subtitle: '' } }));
    await refreshPlan();
  }
  return (
    <section className="grid two">
      <div className="card">
        <div className="card-title-row">
          <div><h2>План служения</h2><p>Заранее собери порядок: песни, Писание, QR, объявления.</p></div>
          <button className="danger" onClick={clear}><Trash2 size={17} /> Очистить</button>
        </div>
        <div className="stack">
          <button className="big-action" onClick={() => action('Следующий пункт', () => api('/api/service-plan/next', { method: 'POST' }))}><SkipForward /> Показать следующий пункт</button>
          <button className="big-action" onClick={() => action('Предыдущий пункт', () => api('/api/service-plan/previous', { method: 'POST' }))}><SkipBack /> Показать предыдущий пункт</button>
          <button className="big-action" onClick={addBlank}><Moon /> Добавить blank в план</button>
        </div>
      </div>
      <div className="card">
        <h2>Пункты</h2>
        <div className="song-list">
          {plan.servicePlan?.length === 0 && <p>План пустой. Добавляй песни из каталога или Писание/QR из соответствующих разделов.</p>}
          {plan.servicePlan?.map((item, index) => (
            <article className={cx('song-item', index === plan.activePlanIndex && 'active-plan-item')} key={item.id}>
              <div>
                <h3>{index + 1}. {item.title}</h3>
                <p>{typeLabel(item.type)} {index === plan.activePlanIndex ? '· сейчас на плане' : ''}</p>
                <span className="badge ok">{typeLabel(item.type)}</span>
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Пункт показан', () => api(`/api/service-plan/items/${item.id}/show`, { method: 'POST' }))}><Monitor size={17} /> На ТВ</button>
                <button className="icon-btn" onClick={() => move(item.id, 'up')}><ArrowUp size={17} /></button>
                <button className="icon-btn" onClick={() => move(item.id, 'down')}><ArrowDown size={17} /></button>
                <button className="icon-btn danger" onClick={() => remove(item.id)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SongsPanel({ action, refreshPlan }) {
  const [songs, setSongs] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [form, setForm] = useState({ title: '', language: 'ru', category: 'Поклонение', tags: '', youtubeUrl: '' });
  const [guest, setGuest] = useState({ title: '', youtubeUrl: '', language: 'guest', category: 'Гости / YouTube', audioOnly: true });
  const [file, setFile] = useState(null);

  async function load() {
    setLoading(true);
    try { setSongs(await api(`/api/songs?q=${encodeURIComponent(q)}`)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function toggleSong(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function submit(e) {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (file) fd.append('video', file);
    await api('/api/songs', { method: 'POST', body: fd });
    setForm({ title: '', language: 'ru', category: 'Поклонение', tags: '', youtubeUrl: '' });
    setFile(null);
    await load();
  }

  async function quickGuestYoutube(mode) {
    if (!guest.youtubeUrl.trim()) return alert('Вставь YouTube-ссылку гостя');
    await api('/api/songs/quick-youtube', postJson({
      ...guest,
      title: guest.title || 'Гостевая YouTube-песня',
      addToPlan: mode === 'plan' || mode === 'both',
      showNow: mode === 'show' || mode === 'both'
    }));
    setGuest({ title: '', youtubeUrl: '', language: 'guest', category: 'Гости / YouTube', audioOnly: true });
    await load();
    await refreshPlan();
  }

  async function addSelectedToPlan(clearBefore = false) {
    if (!selected.length) return alert('Выбери песни галочками');
    await api('/api/service-plan/add-songs-bulk', postJson({ songIds: selected, clearBefore }));
    setSelected([]);
    await refreshPlan();
  }

  async function remove(id) {
    if (!confirm('Удалить песню из каталога? Файл на диске не удаляется.')) return;
    await api(`/api/songs/${id}`, { method: 'DELETE' });
    await load();
    await refreshPlan();
  }

  return (
    <section className="grid two">
      <div className="stack">
        <div className="card">
          <h2>Быстрый план песен на день</h2>
          <p>Найди песни, отметь галочками и одной кнопкой добавь их в план служения.</p>
          <div className="search-row">
            <Search size={18} />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder="Поиск по названию, тегу, языку" />
            <button onClick={load}>Найти</button>
          </div>
          <div className="selected-bar">
            <strong>Выбрано: {selected.length}</strong>
            <button onClick={() => addSelectedToPlan(false)}><ListPlus size={17} /> Добавить выбранные в план</button>
            <button className="danger" onClick={() => addSelectedToPlan(true)}><ClipboardList size={17} /> Новый план из выбранных</button>
          </div>
        </div>

        <div className="card guest-card">
          <h2>Гость принес YouTube-ссылку</h2>
          <p>Быстро добавить ссылку гостя. По умолчанию включаем режим “только звук”: на ТВ будет темная заставка, а YouTube iframe попытается стартовать автоматически.</p>
          <div className="form">
            <label>Название<input value={guest.title} onChange={e => setGuest({ ...guest, title: e.target.value })} placeholder="Песня гостя" /></label>
            <label>YouTube ссылка<input value={guest.youtubeUrl} onChange={e => setGuest({ ...guest, youtubeUrl: e.target.value })} placeholder="https://youtube.com/watch?v=..." /></label>
            <label className="checkline"><input type="checkbox" checked={guest.audioOnly} onChange={e => setGuest({ ...guest, audioOnly: e.target.checked })} /> Только звук / без видео на экране</label>
            <div className="button-row">
              <button onClick={() => quickGuestYoutube('plan')}><ListPlus size={18} /> Добавить в план</button>
              <button className="primary" onClick={() => quickGuestYoutube('show')}><ExternalLink size={18} /> Сразу на ТВ</button>
              <button onClick={() => quickGuestYoutube('both')}><Play size={18} /> В план и на ТВ</button>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Добавить локальную песню / видео</h2>
          <form className="form" onSubmit={submit}>
            <label>Название<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Дух Святой приди" /></label>
            <div className="form-row">
              <label>Язык<input value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} placeholder="ru" /></label>
              <label>Категория<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
            </div>
            <label>Теги<input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="молитва, поклонение" /></label>
            <label>YouTube как источник, не для служения<input value={form.youtubeUrl} onChange={e => setForm({ ...form, youtubeUrl: e.target.value })} placeholder="https://youtube.com/..." /></label>
            <label className="file-input"><Upload size={18} /> <span>{file ? file.name : 'Выбрать локальный MP4/WebM/MOV'}</span><input type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
            <button className="primary" type="submit"><Upload size={18} /> Добавить</button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Каталог песен</h2>
          <span>{loading ? '...' : songs.length}</span>
        </div>
        <div className="song-list">
          {songs.map(song => (
            <article className={cx('song-item', selected.includes(song.id) && 'selected-item')} key={song.id}>
              <div className="song-select-line">
                <input type="checkbox" checked={selected.includes(song.id)} onChange={() => toggleSong(song.id)} />
                <div>
                  <h3>{song.title}</h3>
                  <p>{song.language} · {song.category} · {(song.tags || []).join(', ')}</p>
                  <span className={cx('badge', song.isOfflineReady ? 'ok' : 'warn')}>{song.isOfflineReady ? 'Готово офлайн' : (song.youtubeUrl ? (song.youtubeAudioOnly ? 'YouTube audio / онлайн' : 'YouTube / онлайн') : 'Без файла')}</span>
                </div>
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Песня показана', () => api(`/api/songs/${song.id}/show`, { method: 'POST' }))}><Video size={17} /> На ТВ</button>
                <button onClick={() => action('Песня добавлена в план', () => api(`/api/songs/${song.id}/add-to-plan`, { method: 'POST' }))}><ListPlus size={17} /> В план</button>
                <button className="icon-btn danger" onClick={() => remove(song.id)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}


function AudioPanel({ action, refreshPlan }) {
  const [tracks, setTracks] = useState([]);
  const [q, setQ] = useState('');
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: '', language: 'ru', category: 'Фонограммы', tags: '' });
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setTracks(await api(`/api/audio-tracks?q=${encodeURIComponent(q)}`)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (!file) return alert('Выбери MP3/WAV/OGG/M4A файл');
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    fd.append('audio', file);
    await api('/api/audio-tracks', { method: 'POST', body: fd });
    setForm({ title: '', language: 'ru', category: 'Фонограммы', tags: '' });
    setFile(null);
    await load();
  }

  async function remove(id) {
    if (!confirm('Удалить фонограмму из каталога? Файл на диске не удаляется.')) return;
    await api(`/api/audio-tracks/${id}`, { method: 'DELETE' });
    await load();
    await refreshPlan();
  }

  return (
    <section className="grid two">
      <div className="stack">
        <div className="card">
          <h2>Каталог фонограмм / минусовок</h2>
          <p>Загружай MP3, WAV, OGG, M4A и включай их на ТВ как отдельный аудио-режим. Удобно, когда видео не нужно.</p>
          <div className="search-row">
            <Search size={18} />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder="Поиск по названию, языку, тегам" />
            <button onClick={load}>Найти</button>
          </div>
        </div>

        <div className="card">
          <h2>Добавить фонограмму</h2>
          <form className="form" onSubmit={submit}>
            <label>Название<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Название песни / минусовки" /></label>
            <div className="form-row">
              <label>Язык<input value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} placeholder="ru" /></label>
              <label>Категория<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
            </div>
            <label>Теги<input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="гость, минус, поклонение" /></label>
            <label className="file-input"><Upload size={18} /> <span>{file ? file.name : 'Выбрать MP3/WAV/OGG/M4A'}</span><input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
            <button className="primary" type="submit"><Upload size={18} /> Добавить фонограмму</button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Фонограммы</h2>
          <span>{loading ? '...' : tracks.length}</span>
        </div>
        <div className="song-list">
          {tracks.map(track => (
            <article className="song-item" key={track.id}>
              <div className="song-select-line">
                <Volume2 size={22} />
                <div>
                  <h3>{track.title}</h3>
                  <p>{track.language} · {track.category} · {(track.tags || []).join(', ')}</p>
                  <span className="badge ok">Готово офлайн · audio</span>
                </div>
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Фонограмма включена', () => api(`/api/audio-tracks/${track.id}/show`, { method: 'POST' }))}><Volume2 size={17} /> На ТВ</button>
                <button onClick={() => action('Фонограмма добавлена в план', () => api(`/api/audio-tracks/${track.id}/add-to-plan`, { method: 'POST' }))}><ListPlus size={17} /> В план</button>
                <button className="icon-btn danger" onClick={() => remove(track.id)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
          {tracks.length === 0 && <p>Пока нет фонограмм. Загрузи первый MP3 или WAV.</p>}
        </div>
      </div>
    </section>
  );
}

function BiblePanel({ action }) {
  const [reference, setReference] = useState('Иоанна 7:37-38');
  const [translations, setTranslations] = useState([]);
  const [books, setBooks] = useState([]);
  const [selected, setSelected] = useState(['ru_synodal']);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [bookSlug, setBookSlug] = useState('john');
  const [chapter, setChapter] = useState(7);
  const [verseStart, setVerseStart] = useState(37);
  const [verseEnd, setVerseEnd] = useState(38);
  const [manualForm, setManualForm] = useState({
    reference: 'Иоанна 7:37-38',
    language: 'ru',
    translation: 'Синодальный',
    text: 'Если кто жаждет, иди ко Мне и пей. Кто верует в Меня, у того, как сказано в Писании, из чрева потекут реки воды живой.',
    secondaryLanguage: '',
    secondaryText: ''
  });

  async function loadBibleMeta() {
    const [list, bookList] = await Promise.all([
      api('/api/bible/translations'),
      api('/api/bible/books')
    ]);
    setTranslations(list || []);
    setBooks(bookList || []);
    if (list?.some(t => t.id === 'ru_synodal')) setSelected(prev => prev.length ? prev : ['ru_synodal']);
  }

  async function lookup(nextSelected = selected, nextReference = reference) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ reference: nextReference, translations: nextSelected.join(',') });
      const result = await api(`/api/bible/lookup?${qs.toString()}`);
      setPreview(result);
      return result;
    } finally {
      setLoading(false);
    }
  }

  function toggleTranslation(id) {
    setSelected(prev => {
      const next = prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id];
      return next.length ? next : ['ru_synodal'];
    });
  }

  function getCurrentBook(slug = bookSlug) {
    return books.find(b => b.slug === slug) || books[0];
  }

  function getCurrentChapterInfo(nextBookSlug = bookSlug, nextChapter = chapter) {
    const book = getCurrentBook(nextBookSlug);
    return book?.chapters?.find(c => Number(c.chapter) === Number(nextChapter)) || book?.chapters?.[0];
  }

  function buildReference(next = {}) {
    const nextBookSlug = next.bookSlug ?? bookSlug;
    const nextChapter = Number(next.chapter ?? chapter);
    const nextVerseStart = Number(next.verseStart ?? verseStart);
    const nextVerseEnd = Number(next.verseEnd ?? verseEnd);
    const book = getCurrentBook(nextBookSlug);
    if (!book) return reference;
    const safeEnd = nextVerseEnd && nextVerseEnd >= nextVerseStart ? nextVerseEnd : nextVerseStart;
    return `${book.ru || book.en} ${nextChapter}:${nextVerseStart}${safeEnd !== nextVerseStart ? '-' + safeEnd : ''}`;
  }

  function applyBuilder(next = {}) {
    const nextBookSlug = next.bookSlug ?? bookSlug;
    const book = getCurrentBook(nextBookSlug);
    const nextChapter = Number(next.chapter ?? chapter);
    const chapterInfo = book?.chapters?.find(c => Number(c.chapter) === nextChapter) || book?.chapters?.[0];
    const maxVerse = Number(chapterInfo?.versesCount || 1);
    const nextVerseStart = Math.min(Math.max(1, Number(next.verseStart ?? verseStart)), maxVerse);
    const nextVerseEndRaw = Number(next.verseEnd ?? verseEnd);
    const nextVerseEnd = Math.min(Math.max(nextVerseStart, nextVerseEndRaw || nextVerseStart), maxVerse);

    setBookSlug(nextBookSlug);
    setChapter(Number(chapterInfo?.chapter || nextChapter || 1));
    setVerseStart(nextVerseStart);
    setVerseEnd(nextVerseEnd);
    const ref = buildReference({ bookSlug: nextBookSlug, chapter: Number(chapterInfo?.chapter || nextChapter || 1), verseStart: nextVerseStart, verseEnd: nextVerseEnd });
    setReference(ref);
    return ref;
  }

  useEffect(() => { loadBibleMeta(); }, []);
  useEffect(() => {
    if (translations.length && books.length) lookup(selected).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translations.length, books.length]);

  const preparedPayload = { reference, translations: selected };
  const availableIds = new Set(translations.map(t => t.id));
  const quickOptions = [
    { id: 'ru_synodal', label: 'Русский · Синодальный' },
    { id: 'en_kjv', label: 'English · KJV' },
    { id: 'sr_latn', label: 'Srpski · latinica' },
    { id: 'sr_cyrl', label: 'Српски · ћирилица' }
  ];
  const currentBook = getCurrentBook();
  const currentChapter = getCurrentChapterInfo();
  const maxVerse = Number(currentChapter?.versesCount || 1);

  if (manualMode) {
    return (
      <section className="card">
        <div className="card-title-row">
          <div>
            <h2>Писание — ручной режим</h2>
            <p>Если нужного перевода пока нет в базе, можно вставить текст вручную.</p>
          </div>
          <button onClick={() => setManualMode(false)}>Вернуться к выбору</button>
        </div>
        <form className="form" onSubmit={e => e.preventDefault()}>
          <div className="form-row">
            <label>Ссылка<input value={manualForm.reference} onChange={e => setManualForm({ ...manualForm, reference: e.target.value })} /></label>
            <label>Перевод<input value={manualForm.translation} onChange={e => setManualForm({ ...manualForm, translation: e.target.value })} /></label>
          </div>
          <label>Основной текст<textarea rows="7" value={manualForm.text} onChange={e => setManualForm({ ...manualForm, text: e.target.value })} /></label>
          <div className="form-row">
            <label>Второй язык<input value={manualForm.secondaryLanguage} onChange={e => setManualForm({ ...manualForm, secondaryLanguage: e.target.value })} placeholder="en / sr / me / ua" /></label>
            <label>Основной язык<input value={manualForm.language} onChange={e => setManualForm({ ...manualForm, language: e.target.value })} /></label>
          </div>
          <label>Второй текст<textarea rows="5" value={manualForm.secondaryText} onChange={e => setManualForm({ ...manualForm, secondaryText: e.target.value })} placeholder="Можно оставить пустым" /></label>
          <div className="button-row">
            <button className="primary" onClick={() => action('Писание показано', () => api('/api/bible/show', postJson(manualForm)))}><BookOpen size={18} /> Показать на ТВ</button>
            <button onClick={() => action('Писание добавлено в план', () => api('/api/bible/add-to-plan', postJson(manualForm)))}><ListPlus size={18} /> Добавить в план</button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="card bible-builder">
      <div className="card-title-row">
        <div>
          <h2>Быстрый выбор Писания</h2>
          <p>Можно выбрать книгу, главу и стихи или ввести ссылку вручную. Галочками выбираются языки показа.</p>
        </div>
        <button onClick={() => setManualMode(true)}>Ручной ввод</button>
      </div>

      <div className="bible-selector-panel">
        <div className="form-row three-cols">
          <label>Книга
            <select value={bookSlug} onChange={e => {
              const nextBook = books.find(b => b.slug === e.target.value);
              const nextChapter = nextBook?.chapters?.[0]?.chapter || 1;
              setVerseStart(1);
              setVerseEnd(1);
              applyBuilder({ bookSlug: e.target.value, chapter: nextChapter, verseStart: 1, verseEnd: 1 });
            }}>
              {books.map(book => <option key={book.slug} value={book.slug}>{book.ru || book.en}</option>)}
            </select>
          </label>
          <label>Глава
            <select value={chapter} onChange={e => applyBuilder({ chapter: Number(e.target.value), verseStart: 1, verseEnd: 1 })}>
              {(currentBook?.chapters || []).map(ch => <option key={ch.chapter} value={ch.chapter}>{ch.chapter}</option>)}
            </select>
          </label>
          <label>Стихи
            <div className="verse-range-row">
              <select value={verseStart} onChange={e => applyBuilder({ verseStart: Number(e.target.value), verseEnd: Math.max(Number(e.target.value), verseEnd) })}>
                {Array.from({ length: maxVerse }, (_, i) => i + 1).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <span>—</span>
              <select value={verseEnd} onChange={e => applyBuilder({ verseEnd: Number(e.target.value) })}>
                {Array.from({ length: maxVerse }, (_, i) => i + 1).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </label>
        </div>
      </div>

      <form className="form" onSubmit={e => { e.preventDefault(); lookup().catch(err => alert(err.message)); }}>
        <label>Ссылка на место Писания
          <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Например: Ин 3:16 или Иоанна 7:37-38" />
        </label>

        <div className="translation-checkboxes">
          {quickOptions.map(option => {
            const isAvailable = availableIds.has(option.id);
            return (
              <label key={option.id} className={cx('check-card', !isAvailable && 'disabled')}>
                <input
                  type="checkbox"
                  disabled={!isAvailable}
                  checked={selected.includes(option.id)}
                  onChange={() => toggleTranslation(option.id)}
                />
                <span>{option.label}</span>
                {!isAvailable && <small>нет файла</small>}
              </label>
            );
          })}
        </div>

        <div className="button-row">
          <button type="submit"><Search size={18} /> Найти и обновить предпросмотр</button>
          <button className="primary" type="button" onClick={() => action('Писание показано', () => api('/api/bible/show-reference', postJson(preparedPayload)))}><BookOpen size={18} /> Показать на ТВ</button>
          <button type="button" onClick={() => action('Писание добавлено в план', () => api('/api/bible/add-reference-to-plan', postJson(preparedPayload)))}><ListPlus size={18} /> Добавить в план</button>
        </div>
      </form>

      <div className="bible-preview">
        <div className="card-title-row compact">
          <h3>{preview?.reference || reference}</h3>
          <span>{loading ? 'ищу...' : `${preview?.blocks?.filter(b => b.text).length || 0} перевод(а)`}</span>
        </div>
        {preview?.blocks?.map(block => (
          <article key={block.translationId} className={cx('bible-preview-block', block.missing && 'missing')}>
            <div className="scripture-translation-title">{block.shortName || block.name || block.translationId}</div>
            {block.text ? <p>{block.text}</p> : <p>Текст не найден для этого перевода.</p>}
          </article>
        ))}
        {!preview && <p>Нажми “Найти”, чтобы увидеть текст из подключенных Bible JSON.</p>}
      </div>
    </section>
  );
}

function TranslationPanel({ action }) {
  const [form, setForm] = useState({
    title: 'Live translation',
    url: 'https://example.com/join/service',
    languages: 'English, Русский, Crnogorski',
    instructions: 'Scan the QR code, choose your language and keep the screen open for audio.'
  });
  return (
    <section className="card">
      <h2>QR для live-перевода</h2>
      <form className="form" onSubmit={e => e.preventDefault()}>
        <label>Заголовок<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label>Ссылка<input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></label>
        <label>Языки<input value={form.languages} onChange={e => setForm({ ...form, languages: e.target.value })} /></label>
        <label>Инструкция<textarea rows="4" value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} /></label>
        <div className="button-row">
          <button className="primary" onClick={() => action('QR показан', () => api('/api/translation/show', postJson(form)))}><QrCode size={18} /> Показать QR на ТВ</button>
          <button onClick={() => action('QR добавлен в план', () => api('/api/translation/add-to-plan', postJson(form)))}><ListPlus size={18} /> Добавить в план</button>
        </div>
      </form>
    </section>
  );
}

function AnnouncementPanel({ action }) {
  const donationPreset = {
    title: 'Пожертвование',
    body: 'Спасибо за вашу поддержку служения.\nВы можете сделать пожертвование, отсканировав QR-код.',
    qrUrl: ''
  };
  const welcomePreset = { title: 'Добро пожаловать!', body: 'Мы рады видеть вас на служении. После служения будем рады познакомиться с вами.', qrUrl: '' };
  const translationPreset = { title: 'Live translation', body: 'Для перевода проповеди отсканируйте QR-код и выберите язык.', qrUrl: '' };
  const [form, setForm] = useState(welcomePreset);
  const [items, setItems] = useState([]);

  async function load() {
    setItems(await api('/api/announcements'));
  }
  useEffect(() => { load(); }, []);

  async function saveAndShow() {
    await action('Объявление показано', () => api('/api/announcement/show', postJson(form)));
    await load();
  }
  async function saveToPlan() {
    await action('Объявление добавлено в план', () => api('/api/announcement/add-to-plan', postJson(form)));
    await load();
  }

  return (
    <section className="grid two">
      <div className="card">
        <h2>Объявления / пожертвования / заставки</h2>
        <p>Да, раздел реализован: можно показать объявление сразу или добавить его в конец плана служения.</p>
        <div className="preset-grid">
          <button onClick={() => setForm(welcomePreset)}>Приветствие</button>
          <button onClick={() => setForm(donationPreset)}>Пожертвование</button>
          <button onClick={() => setForm(translationPreset)}>Перевод</button>
          <button onClick={() => setForm({ title: 'После служения', body: 'Оставайтесь на общение и чай после служения.', qrUrl: '' })}>Общение</button>
        </div>
        <form className="form" onSubmit={e => e.preventDefault()}>
          <label>Заголовок<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Текст<textarea rows="7" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
          <label>QR-ссылка, если нужна<input value={form.qrUrl} onChange={e => setForm({ ...form, qrUrl: e.target.value })} placeholder="https://... ссылка для пожертвования / Telegram / формы" /></label>
          <div className="button-row">
            <button className="primary" onClick={saveAndShow}><Megaphone size={18} /> Показать на ТВ</button>
            <button onClick={saveToPlan}><ListPlus size={18} /> Добавить в план</button>
          </div>
        </form>
      </div>
      <div className="card">
        <div className="card-title-row">
          <h2>Последние объявления</h2>
          <button onClick={load}><RotateCcw size={17} /> Обновить</button>
        </div>
        <div className="song-list">
          {!items.length && <p>Пока нет сохраненных объявлений. Покажи или добавь первое — оно сохранится здесь.</p>}
          {items.map(item => (
            <article className="song-item" key={item.id}>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                {item.qrUrl && <span className="badge ok">QR</span>}
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Объявление показано', () => api(`/api/announcements/${item.id}/show`, { method: 'POST' }))}><Monitor size={17} /> На ТВ</button>
                <button onClick={() => action('Объявление добавлено в план', () => api(`/api/announcements/${item.id}/add-to-plan`, { method: 'POST' }))}><ListPlus size={17} /> В план</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}


function MediaPanel({ action }) {
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState([]);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: '', category: 'Заставки', tags: '' });
  const [slide, setSlide] = useState({ title: 'Слайдшоу перед служением', intervalSeconds: 6, fit: 'cover' });

  async function load() {
    setImages(await api('/api/images'));
  }
  useEffect(() => { load(); }, []);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function uploadImage(e) {
    e.preventDefault();
    if (!file) return alert('Выбери картинку');
    const fd = new FormData();
    fd.append('image', file);
    fd.append('title', form.title || file.name);
    fd.append('category', form.category);
    fd.append('tags', form.tags);
    await api('/api/images', { method: 'POST', body: fd });
    setFile(null);
    setForm({ title: '', category: 'Заставки', tags: '' });
    await load();
  }

  async function deleteImage(id) {
    if (!confirm('Удалить картинку из медиатеки?')) return;
    await api(`/api/images/${id}`, { method: 'DELETE' });
    setSelected(prev => prev.filter(x => x !== id));
    await load();
  }

  async function showSlideshow() {
    await api('/api/slideshow/show', postJson({ ...slide, imageIds: selected }));
  }

  async function addSlideshowToPlan() {
    await api('/api/slideshow/add-to-plan', postJson({ ...slide, imageIds: selected }));
  }

  return (
    <section className="grid two">
      <div className="card">
        <h2>Картинки, заставки, фото и слайдшоу</h2>
        <p>Загружай JPG/PNG/WebP/GIF, показывай одну картинку на ТВ или собирай слайдшоу перед/после служения.</p>

        <form className="form" onSubmit={uploadImage}>
          <label>Название<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Например: Добро пожаловать" /></label>
          <div className="form-row">
            <label>Категория<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Заставки / Фото / Пожертвование" /></label>
            <label>Теги<input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="welcome, offering, youth" /></label>
          </div>
          <label>Файл картинки<input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
          <button className="primary" type="submit"><Upload size={18} /> Загрузить картинку</button>
        </form>

        <div className="divider" />
        <h3>Слайдшоу из выбранных</h3>
        <div className="form">
          <label>Название слайдшоу<input value={slide.title} onChange={e => setSlide({ ...slide, title: e.target.value })} /></label>
          <div className="form-row">
            <label>Секунд на слайд<input type="number" min="2" max="60" value={slide.intervalSeconds} onChange={e => setSlide({ ...slide, intervalSeconds: e.target.value })} /></label>
            <label>Отображение<select value={slide.fit} onChange={e => setSlide({ ...slide, fit: e.target.value })}><option value="cover">Заполнить экран</option><option value="contain">Вместить целиком</option></select></label>
          </div>
          <p className="hint">Выбрано картинок: {selected.length}</p>
          <div className="button-row">
            <button className="primary" onClick={() => action('Слайдшоу показано', showSlideshow)}><Images size={18} /> Показать слайдшоу</button>
            <button onClick={() => action('Слайдшоу добавлено в план', addSlideshowToPlan)}><ListPlus size={18} /> Добавить в план</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <div><h2>Медиатека</h2><p>Одна картинка может быть заставкой, объявлением или пунктом плана.</p></div>
          <button onClick={load}><RotateCcw size={17} /> Обновить</button>
        </div>
        <div className="media-grid">
          {!images.length && <p>Пока нет картинок. Загрузи заставку или фото.</p>}
          {images.map(img => (
            <article className={cx('media-card', selected.includes(img.id) && 'selected')} key={img.id}>
              <button className="media-thumb" onClick={() => toggle(img.id)} title="Выбрать для слайдшоу">
                <img src={img.mediaUrl} alt={img.title} />
                <span>{selected.includes(img.id) ? '✓ выбрано' : 'выбрать'}</span>
              </button>
              <div className="media-body">
                <h3>{img.title}</h3>
                <p>{img.category}</p>
                <div className="song-actions wrap-actions">
                  <button className="primary" onClick={() => action('Картинка показана', () => api(`/api/images/${img.id}/show`, postJson({ fit: 'cover' })))}><Monitor size={17} /> На ТВ</button>
                  <button onClick={() => action('Картинка добавлена в план', () => api(`/api/images/${img.id}/add-to-plan`, postJson({ fit: 'cover' })))}><ListPlus size={17} /> В план</button>
                  <button className="danger" onClick={() => deleteImage(img.id)}><Trash2 size={17} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CheckupPanel() {
  const [data, setData] = useState(null);
  async function run() { setData(await api('/api/checkup')); }
  useEffect(() => { run(); }, []);
  return (
    <section className="card">
      <div className="card-title-row">
        <h2>Проверка перед служением</h2>
        <button onClick={run}><RotateCcw size={17} /> Проверить</button>
      </div>
      {data && (
        <div className="checkup">
          <div className={cx('check-row', data.ok ? 'ok' : 'warn')}>
            {data.ok ? <CheckCircle2 /> : <AlertTriangle />}
            <div><strong>{data.ok ? 'Можно начинать' : 'Есть проблемы'}</strong><p>Песен: {data.songsCount}, офлайн готово: {data.offlineReadySongs}, пунктов плана: {data.servicePlanItems}</p></div>
          </div>
          {data.missing?.map(item => <p key={item.id}>⚠️ {item.title}: {item.reason}</p>)}
          {data.planWarnings?.map((item, i) => <p key={i}>⚠️ План #{item.index}: {item.title}: {item.reason}</p>)}
          <pre className="state-box">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}

function ScreenApp() {
  const [state, setState] = useState({ mode: 'welcome', payload: { title: 'Добро пожаловать', subtitle: 'Word of God Crossroads Budva' } });
  const mediaRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    api('/api/screen/state').then(setState).catch(() => {});
    const es = new EventSource('/api/screen/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'state') setState(data.state);
        if (data.type === 'command') handleCommand(data.command, mediaRef.current);
      } catch {}
    };
    return () => es.close();
  }, []);

  const payload = state?.payload || {};

  return (
    <div className="screen-shell">
      <div className="screen-status">{connected ? '● online' : '● offline'} · {state?.mode}</div>
      {state.mode === 'welcome' && <WelcomeScreen payload={payload} />}
      {state.mode === 'blank' && <BlankScreen payload={payload} />}
      {state.mode === 'song_video' && <SongVideo payload={payload} mediaRef={mediaRef} />}
      {state.mode === 'bible' && <BibleScreen payload={payload} />}
      {state.mode === 'translation_qr' && <TranslationScreen payload={payload} />}
      {state.mode === 'announcement' && <AnnouncementScreen payload={payload} />}
      {state.mode === 'image' && <ImageScreen payload={payload} />}
      {state.mode === 'slideshow' && <SlideshowScreen payload={payload} />}
      {state.mode === 'youtube' && <YouTubeScreen payload={payload} />}
      {state.mode === 'youtube_audio' && <YouTubeAudioScreen payload={payload} />}
      {state.mode === 'audio_track' && <AudioTrackScreen payload={payload} mediaRef={mediaRef} />}
      {state.mode === 'message' && <MessageScreen payload={payload} />}
    </div>
  );
}

function handleCommand(command, media) {
  if (!media) return;
  if (command === 'play') media.play().catch(() => {});
  if (command === 'pause') media.pause();
  if (command === 'stop') { media.pause(); media.currentTime = 0; }
  if (command === 'restart') { media.currentTime = 0; media.play().catch(() => {}); }
}


function WelcomeScreen({ payload }) {
  const style = payload.imageUrl ? { backgroundImage: `linear-gradient(${payload.overlay === false ? 'rgba(0,0,0,.12), rgba(0,0,0,.12)' : 'rgba(0,0,0,.48), rgba(0,0,0,.62)'}), url(${payload.imageUrl})` } : undefined;
  return (
    <section className={cx('welcome-screen-tv', payload.imageFit === 'contain' && 'contain-bg')} style={style}>
      <div className="welcome-content-tv">
        <div className="cross-mark">✦</div>
        <h1>{payload.title || 'Добро пожаловать'}</h1>
        {payload.showChurchName !== false && <h2>{payload.subtitle || payload.churchName || 'Church'}</h2>}
        {payload.serviceText && <p>{payload.serviceText}</p>}
        {payload.language && <div className="welcome-lang">{payload.language}</div>}
      </div>
    </section>
  );
}

function BlankScreen({ payload }) {
  return (
    <section className="screen-center blank-screen">
      {(payload.title || payload.subtitle) && <div className="cross-mark">✦</div>}
      {payload.title && <h1>{payload.title}</h1>}
      {payload.subtitle && <p>{payload.subtitle}</p>}
    </section>
  );
}

function SongVideo({ payload, mediaRef }) {
  return (
    <section className="video-screen">
      <video key={payload.mediaUrl} ref={mediaRef} src={payload.mediaUrl} controls={false} autoPlay playsInline className="main-video" />
      <div className="video-title"><Music size={24} /> {payload.title}</div>
    </section>
  );
}

function BibleScreen({ payload }) {
  const blocks = Array.isArray(payload.blocks) && payload.blocks.length
    ? payload.blocks.filter(block => block && (block.text || block.missing))
    : [
        payload.text ? { translationId: payload.language || 'ru', shortName: payload.translation || payload.language || '', text: payload.text } : null,
        payload.secondaryText ? { translationId: payload.secondaryLanguage || 'secondary', shortName: payload.secondaryLanguage || '', text: payload.secondaryText } : null
      ].filter(Boolean);

  return (
    <section className={cx('screen-center bible-screen', blocks.length > 1 && 'multi-bible')}>
      <div className="reference">{payload.reference || 'Место Писания'}</div>
      {blocks.length > 0 ? (
        <div className="scripture-grid" data-count={blocks.length}>
          {blocks.map((block, index) => (
            <article className="scripture-block" key={block.translationId || block.shortName || index}>
              <div className="scripture-translation-label">{block.shortName || block.name || block.language || block.translationId}</div>
              <div className="scripture-text">
                {String(block.text || 'Текст не найден для этого перевода.').split('\n').map((line, lineIndex) => (
                  <p key={lineIndex}>{line}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="scripture-empty">
          Текст не передан на экран. Нажми в админке “Найти и обновить предпросмотр”, потом “Показать на ТВ”.
        </div>
      )}
    </section>
  );
}

function TranslationScreen({ payload }) {
  return (
    <section className="screen-center qr-screen">
      <h1>{payload.title || 'Live translation'}</h1>
      {payload.qrDataUrl && <img src={payload.qrDataUrl} alt="QR" />}
      <p>{payload.instructions || 'Scan the QR code and choose your language.'}</p>
      <div className="url-line">{payload.url}</div>
      {payload.languages && <div className="langs">{payload.languages}</div>}
    </section>
  );
}

function AnnouncementScreen({ payload }) {
  return (
    <section className="screen-center announcement-screen">
      <h1>{payload.title}</h1>
      <p>{payload.body}</p>
      {payload.qrDataUrl && <img src={payload.qrDataUrl} alt="QR" />}
    </section>
  );
}


function ImageScreen({ payload }) {
  return (
    <section className="image-screen">
      <img src={payload.mediaUrl} alt={payload.title || 'Image'} className={cx('screen-image', payload.fit === 'contain' && 'contain')} />
      {payload.title && <div className="image-caption"><Image size={24} /> {payload.title}</div>}
    </section>
  );
}

function SlideshowScreen({ payload }) {
  const images = payload.images || [];
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [payload.fromPlanItemId, payload.title, images.length]);
  useEffect(() => {
    if (images.length <= 1) return;
    const ms = Math.max(2, Number(payload.intervalSeconds || 6)) * 1000;
    const timer = setInterval(() => setIndex(i => (i + 1) % images.length), ms);
    return () => clearInterval(timer);
  }, [images.length, payload.intervalSeconds]);
  const current = images[index] || images[0];
  if (!current) return <MessageScreen payload={{ title: 'Слайдшоу', body: 'Нет картинок для показа.' }} />;
  return (
    <section className="image-screen slideshow-screen">
      <img key={current.mediaUrl} src={current.mediaUrl} alt={current.title || 'Slide'} className={cx('screen-image', payload.fit === 'contain' && 'contain')} />
      <div className="slideshow-caption">
        <span>{payload.title || 'Слайдшоу'}</span>
        <span>{index + 1} / {images.length}</span>
      </div>
    </section>
  );
}


function AudioTrackScreen({ payload, mediaRef }) {
  return (
    <section className="screen-center audio-screen">
      <div className="audio-orb"><Volume2 size={64} /></div>
      <h1>{payload.title || 'Фонограмма'}</h1>
      <p>{payload.category || 'Audio'} {payload.language ? `· ${payload.language}` : ''}</p>
      <audio key={payload.mediaUrl} ref={mediaRef} src={payload.mediaUrl} autoPlay playsInline />
      <div className="audio-hint">Локальный аудиофайл · офлайн-режим</div>
    </section>
  );
}

function YouTubeAudioScreen({ payload }) {
  return (
    <section className="screen-center audio-screen youtube-audio-screen">
      <div className="audio-orb"><Headphones size={64} /></div>
      <h1>{payload.title || 'YouTube audio'}</h1>
      <p>Режим “только звук” для гостевой YouTube-ссылки</p>
      <iframe
        className="youtube-audio-frame"
        title={payload.title || 'YouTube audio'}
        src={payload.embedUrl || payload.youtubeUrl}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
      <div className="youtube-warning"><AlertTriangle size={20} /> YouTube online mode · возможна реклама · автозапуск зависит от браузера</div>
    </section>
  );
}

function YouTubeScreen({ payload }) {
  return (
    <section className="youtube-screen">
      <iframe
        title={payload.title || 'YouTube'}
        src={payload.embedUrl || payload.youtubeUrl}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
      <div className="youtube-warning"><AlertTriangle size={20} /> YouTube online mode · возможна реклама · нужен интернет</div>
    </section>
  );
}

function MessageScreen({ payload, warning }) {
  return (
    <section className={cx('screen-center', warning && 'warning-screen')}>
      <h1>{payload.title || 'Сообщение'}</h1>
      <p>{payload.body || payload.message}</p>
      {payload.youtubeUrl && <div className="url-line">{payload.youtubeUrl}</div>}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);

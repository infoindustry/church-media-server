import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Monitor, Music, BookOpen, QrCode, Megaphone, Moon, Play, Pause,
  Square, RotateCcw, Search, Upload, Wifi, AlertTriangle, CheckCircle2,
  Video, Radio, Home, Trash2, ClipboardList, SkipForward, SkipBack,
  ListPlus, ArrowUp, ArrowDown, Plus, ExternalLink, Image, Images, Headphones, Volume2,
  GraduationCap, Clapperboard, Globe2, UsersRound, Star, Lock, Unlock
} from 'lucide-react';
import './styles.css';
import { supportedLanguages, getLanguageLabel } from './translationLanguages';

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

const LEARNING_SECTIONS = [
  { id: 'bibleka', label: 'Библейка', icon: GraduationCap, prefixes: ['Библейка'], description: 'Семинары, богословские уроки и обучающие материалы.' },
  { id: 'superbook', label: 'Суперкнига', icon: Clapperboard, prefixes: ['Superkniga', 'Суперкнига'], description: 'Видеоуроки, модули и материалы по Суперкниге.' }
];

const MISSION_BOARD_LINKS = [
  {
    id: 'missionaries',
    title: 'Миссионеры',
    subtitle: 'Борд миссионеров',
    url: 'https://missionreport.top/church/board/church-board-2026-03-15-do4g?lang=en',
    icon: UsersRound
  },
  {
    id: 'prayer',
    title: 'Молитвенный ТВ',
    subtitle: 'Prayer mode',
    url: 'https://missionreport.top/church/board/church-board-2026-03-15-do4g?tv=1&mode=prayer&lang=en',
    icon: QrCode
  },
  {
    id: 'globe',
    title: 'Глобус',
    subtitle: 'Globe mode',
    url: 'https://missionreport.top/church/board/church-board-2026-03-15-do4g?tv=1&mode=globe&lang=en',
    icon: Globe2
  }
];

const BIBLE_WEIGHT_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Middle' },
  { id: 'high', label: 'Big' }
];

function matchesMediaSection(item, prefixes) {
  const category = String(item.category || '');
  const original = String(item.originalFileName || '');
  return prefixes.some(prefix => category === prefix || category.startsWith(`${prefix} /`) || original === prefix || original.startsWith(`${prefix}\\`) || original.startsWith(`${prefix}/`));
}

function isLearningMedia(item) {
  return LEARNING_SECTIONS.some(section => matchesMediaSection(item, section.prefixes));
}

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/screen')) return <ScreenApp />;
  if (path.startsWith('/translate/source')) return <TranslationSourceApp />;
  if (path.startsWith('/translate')) return <TranslationGuestApp />;
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
    ['bibleka', GraduationCap, 'Библейка'],
    ['superbook', Clapperboard, 'Суперкнига'],
    ['bible', BookOpen, 'Писание'],
    ['translation', QrCode, 'Перевод'],
    ['announcement', Megaphone, 'Объявления'],
    ['prayer-requests', BookOpen, 'Молитва'],
    ['external-links', ExternalLink, 'Ссылки'],
    ['missions', Globe2, 'Миссии'],
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
        {tab === 'bibleka' && <LearningVideosPanel section={LEARNING_SECTIONS[0]} action={action} refreshPlan={refreshPlan} />}
        {tab === 'superbook' && <LearningVideosPanel section={LEARNING_SECTIONS[1]} action={action} refreshPlan={refreshPlan} />}
        {tab === 'bible' && <BiblePanel action={action} state={state} />}
        {tab === 'translation' && <TranslationPanel action={action} />}
        {tab === 'announcement' && <AnnouncementPanel action={action} />}
        {tab === 'prayer-requests' && <PrayerRequestsPanel action={action} />}
        {tab === 'external-links' && <ExternalLinksPanel action={action} refreshPlan={refreshPlan} />}
        {tab === 'missions' && <MissionBoardPanel action={action} />}
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
  if (state.mode === 'translation_caption') return `Субтитры перевода: ${p.title || p.url}`;
  if (state.mode === 'translation_live') return `Live субтитры: ${p.lang || ''}`;
  if (state.mode === 'announcement') return `Объявление: ${p.title || ''}`;
  if (state.mode === 'external_board') return `Внешняя ссылка: ${p.title || p.url || ''}`;
  if (state.mode === 'image') return `Картинка: ${p.title || ''}`;
  if (state.mode === 'slideshow') return `Слайдшоу: ${p.title || ''} (${p.images?.length || 0})`;
  if (state.mode === 'blank') return p.title || p.subtitle ? `Заставка: ${p.title || p.subtitle}` : 'Черный экран';
  return state.mode;
}

function typeLabel(type) {
  return {
    welcome: 'Приветствие', song: 'Песня', song_video: 'Песня', audio: 'Фонограмма', audio_track: 'Фонограмма', youtube_audio: 'YouTube audio', youtube: 'YouTube', bible: 'Писание', translation_qr: 'QR перевода', translation_caption: 'Субтитры', translation_live: 'Live субтитры', announcement: 'Объявление', external_board: 'Ссылка', image: 'Картинка', slideshow: 'Слайдшоу', blank: 'Blank', loading: 'Загрузка'
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
  const [editMode, setEditMode] = useState(false);
  const planTemplates = [
    {
      id: 'sunday',
      label: 'Воскресенье',
      items: [
        welcomePlanItem('Приветствие'),
        announcementPlanItem('Прославление', 'Worship', 'Приготовим сердца к прославлению Господа.\n«Войду в дом Твой по множеству милости Твоей». — Псалом 5:8', 'Let us prepare our hearts to worship the Lord.\n“I will come into thy house in the multitude of thy mercy.” — Psalm 5:7'),
        announcementPlanItem('Пожертвование', 'Offering', 'Спасибо за вашу поддержку служения.\nПожертвование можно положить в бокс.', 'Thank you for supporting the ministry.\nYou can place your offering in the box.'),
        announcementPlanItem('Писание и проповедь', 'Scripture and Sermon', 'Приготовим сердца к слышанию Слова Божьего.\n«Слово Твое — светильник ноге моей и свет стезе моей». — Псалом 118:105', 'Let us prepare our hearts to hear the Word of God.\n“Thy word is a lamp unto my feet, and a light unto my path.” — Psalm 119:105'),
        announcementPlanItem('Время молитвы', 'Time of Prayer', 'Будем вместе искать лица Божьего в молитве.\n«Ищите лица Моего». И буду искать лица Твоего, Господи. — Псалом 26:8', 'Let us seek the face of God together in prayer.\n“Seek my face.” Your face, Lord, I will seek. — Psalm 27:8'),
        announcementPlanItem('Приглашаем к столу', 'You Are Invited to the Table', 'После служения приглашаем всех к совместному чаепитию и общению.\n«Преломляя по домам хлеб, принимали пищу в веселии и простоте сердца». — Деяния 2:46', 'After the service, everyone is invited for tea and fellowship.\n“They broke bread from house to house, and did eat their meat with gladness and singleness of heart.” — Acts 2:46'),
        blankPlanItem()
      ]
    },
    {
      id: 'communion',
      label: 'Причастие',
      items: [
        welcomePlanItem('Приветствие'),
        announcementPlanItem('Причастие', 'Communion', 'Будем вспоминать смерть и воскресение Господа Иисуса Христа.\n«Сие творите в Мое воспоминание». — 1 Коринфянам 11:24', 'We remember the death and resurrection of the Lord Jesus Christ.\n“Do this in remembrance of me.” — 1 Corinthians 11:24'),
        blankPlanItem()
      ]
    },
    {
      id: 'prayer',
      label: 'Молитвенное',
      items: [
        welcomePlanItem('Приветствие'),
        announcementPlanItem('Время молитвы', 'Time of Prayer', 'Будем вместе искать лица Божьего в молитве.\n«Ищите лица Моего». И буду искать лица Твоего, Господи. — Псалом 26:8', 'Let us seek the face of God together in prayer.\n“Seek my face.” Your face, Lord, I will seek. — Psalm 27:8'),
        announcementPlanItem('Молитва за исцеление', 'Prayer for Healing', 'Если вы нуждаетесь в исцелении, служители готовы помолиться с вами.\n«Молитва веры исцелит болящего, и восставит его Господь». — Иакова 5:15', 'If you need healing, our ministry team is ready to pray with you.\n“The prayer of faith shall save the sick, and the Lord shall raise him up.” — James 5:15'),
        announcementPlanItem('Молитва за нужды', 'Prayer for Needs', 'Если у вас есть нужда, мы готовы помолиться вместе с вами.\n«Открывайте свои желания пред Богом в молитве и прошении с благодарением». — Филиппийцам 4:6', 'If you have a need, we are ready to pray with you.\n“In every thing by prayer and supplication with thanksgiving let your requests be made known unto God.” — Philippians 4:6'),
        blankPlanItem()
      ]
    },
    {
      id: 'baptism',
      label: 'Крещение',
      items: [
        welcomePlanItem('Приветствие'),
        announcementPlanItem('Водное крещение', 'Water Baptism', 'Сегодня мы радуемся вместе с теми, кто свидетельствует о своей вере через водное крещение.\n«Покайтесь, и да крестится каждый из вас во имя Иисуса Христа». — Деяния 2:38', 'Today we rejoice with those who are declaring their faith through water baptism.\n“Repent, and be baptized every one of you in the name of Jesus Christ.” — Acts 2:38'),
        announcementPlanItem('Приветствуем крещаемого', 'Welcoming the Baptism Candidate', 'Сегодня мы радуемся вместе с тем, кто свидетельствует о своей вере через водное крещение.\n«Итак, кто во Христе, тот новая тварь; древнее прошло, теперь всё новое». — 2 Коринфянам 5:17', 'Today we rejoice with the one who is declaring their faith through water baptism.\n“If any man be in Christ, he is a new creature.” — 2 Corinthians 5:17'),
        announcementPlanItem('Приглашаем к столу', 'You Are Invited to the Table', 'После служения приглашаем всех к совместному чаепитию и общению.', 'After the service, everyone is invited for tea and fellowship.'),
        blankPlanItem()
      ]
    }
  ];

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
  async function addTemplate(template, clearBefore = false) {
    if (clearBefore) {
      if (!confirm(`Очистить текущий план и создать шаблон "${template.label}"?`)) return;
      await api('/api/service-plan/clear', { method: 'POST' });
    }
    await action(`Шаблон "${template.label}" добавлен`, async () => {
      for (const item of template.items) {
        await api('/api/service-plan/items', postJson(item));
      }
    });
    await refreshPlan();
  }
  return (
    <section className="grid two">
      <div className="card">
        <div className="card-title-row">
          <div><h2>План служения</h2><p>Заранее собери порядок: песни, Писание, QR, объявления.</p></div>
          <div className="plan-head-actions">
            <button className={cx('icon-btn', editMode && 'primary')} onClick={() => setEditMode(v => !v)} title={editMode ? 'Заблокировать план (скрыть удаление)' : 'Редактировать план (показать удаление)'}>
              {editMode ? <Unlock size={17} /> : <Lock size={17} />} {editMode ? 'Редактирование' : 'Редактировать план'}
            </button>
            {editMode && <button className="danger" onClick={clear}><Trash2 size={17} /> Очистить</button>}
          </div>
        </div>
        <div className="stack">
          <button className="big-action" onClick={() => action('Следующий пункт', () => api('/api/service-plan/next', { method: 'POST' }))}><SkipForward /> Показать следующий пункт</button>
          <button className="big-action" onClick={() => action('Предыдущий пункт', () => api('/api/service-plan/previous', { method: 'POST' }))}><SkipBack /> Показать предыдущий пункт</button>
          <button className="big-action" onClick={addBlank}><Moon /> Добавить blank в план</button>
        </div>
        <div className="template-actions">
          <h3>Шаблоны плана</h3>
          <div className="template-grid">
            {planTemplates.map(template => (
              <div className="template-item" key={template.id}>
                <strong>{template.label}</strong>
                <div>
                  <button onClick={() => addTemplate(template, false)}><ListPlus size={16} /> Добавить</button>
                  <button className="danger" onClick={() => addTemplate(template, true)}><ClipboardList size={16} /> Новый</button>
                </div>
              </div>
            ))}
          </div>
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
                {editMode && <button className="icon-btn danger" onClick={() => remove(item.id)}><Trash2 size={17} /></button>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function welcomePlanItem(title) {
  return { type: 'welcome', title, payload: {} };
}

function blankPlanItem() {
  return { type: 'blank', title: 'Черный экран', payload: { title: '', subtitle: '' } };
}

function announcementPlanItem(title, titleEn, body, bodyEn) {
  return {
    type: 'announcement',
    title,
    payload: { title, titleEn, body, bodyEn, lang: 'both', qrUrl: '', qrDataUrl: '' }
  };
}

function youtubeThumb(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : '';
}

function SongThumb({ song }) {
  const [failed, setFailed] = useState(false);
  const src = song.fileName ? `/api/songs/${song.id}/thumbnail` : youtubeThumb(song.youtubeUrl);
  if (!src || failed) {
    return <div className="song-thumb song-thumb-empty"><Music size={20} /></div>;
  }
  return <img className="song-thumb" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function SongsPanel({ action, refreshPlan }) {
  const [songs, setSongs] = useState([]);
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [sortMode, setSortMode] = useState('title');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [form, setForm] = useState({ title: '', language: 'ru', category: 'Поклонение', tags: '', youtubeUrl: '' });
  const [guest, setGuest] = useState({ title: '', youtubeUrl: '', language: 'guest', category: 'Гости / YouTube', audioOnly: true });
  const [file, setFile] = useState(null);

  async function load() {
    setLoading(true);
    try { setSongs(await api('/api/songs')); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const songCatalog = useMemo(() => songs.filter(song => !isLearningMedia(song)), [songs]);

  const languages = useMemo(() => {
    const counts = new Map();
    songCatalog.forEach(song => {
      const value = song.language || 'ru';
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [songCatalog]);

  const categories = useMemo(() => {
    const counts = new Map();
    songCatalog.forEach(song => {
      const value = song.category || 'Без категории';
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [songCatalog]);

  const filteredSongs = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const filtered = songCatalog.filter(song => {
      if (language && String(song.language || '').toLowerCase() !== language.toLowerCase()) return false;
      if (category && String(song.category || '') !== category) return false;
      if (quickFilter === 'recent' && new Date(song.createdAt || 0).getTime() < recentCutoff) return false;
      if (quickFilter === 'cloud' && !song.cloudItemId && song.sourceType !== 'cloud_upload') return false;
      if (quickFilter === 'youtube' && !song.youtubeUrl) return false;
      if (quickFilter === 'offline' && !song.isOfflineReady) return false;
      if (quickFilter === 'favorite' && !song.favorite) return false;
      if (!words.length) return true;
      const text = [song.title, song.language, song.category, song.originalFileName, ...(song.tags || [])].join(' ').toLowerCase();
      return words.every(word => text.includes(word));
    });
    return filtered.sort((a, b) => {
      if (sortMode === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      if (sortMode === 'recently-updated') return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      if (sortMode === 'category') return String(a.category || '').localeCompare(String(b.category || ''), 'ru') || String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    });
  }, [songCatalog, q, language, category, quickFilter, sortMode]);

  function resetFilters() {
    setQ('');
    setLanguage('');
    setCategory('');
    setQuickFilter('all');
    setSortMode('title');
  }

  function toggleSong(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleVisibleSongs() {
    const visibleIds = filteredSongs.map(song => song.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));
    setSelected(prev => allVisibleSelected
      ? prev.filter(id => !visibleIds.includes(id))
      : [...new Set([...prev, ...visibleIds])]);
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

  async function toggleFavorite(song) {
    await api(`/api/songs/${song.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !song.favorite })
    });
    await load();
  }

  return (
    <section className="grid two">
      <div className="stack">
        <div className="card">
          <div className="card-title-row compact">
            <div>
              <h2>Быстрый поиск песен</h2>
              <p>Название, язык и тема фильтруются сразу. Можно быстро собрать план или вывести песню на ТВ.</p>
            </div>
            <span className="result-count">{loading ? '...' : `${filteredSongs.length} / ${songCatalog.length}`}</span>
          </div>
          <div className="song-search-grid">
            <label className="song-search-main">
              <Search size={22} />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Пишите: благословение, свят, рождество..."
              />
            </label>
            <label>Язык
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="">Все языки</option>
                {languages.map(([value, count]) => <option value={value} key={value}>{value} ({count})</option>)}
              </select>
            </label>
            <label>Тема
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">Все темы</option>
                {categories.map(([value, count]) => <option value={value} key={value}>{value} ({count})</option>)}
              </select>
            </label>
            <label>Сортировка
              <select value={sortMode} onChange={e => setSortMode(e.target.value)}>
                <option value="title">По названию</option>
                <option value="newest">Сначала новые</option>
                <option value="recently-updated">Недавно измененные</option>
                <option value="category">По теме</option>
              </select>
            </label>
          </div>
          <div className="filter-chips">
            {[
              ['all', 'Все'],
              ['recent', 'Недавние'],
              ['cloud', 'Из облака'],
              ['offline', 'Офлайн'],
              ['youtube', 'YouTube'],
              ['favorite', 'Избранное']
            ].map(([value, label]) => (
              <button className={cx(quickFilter === value && 'active')} onClick={() => setQuickFilter(value)} key={value}>
                {label}
              </button>
            ))}
          </div>
          <div className="filter-chips">
            {languages.slice(0, 8).map(([value, count]) => (
              <button className={cx(language === value && 'active')} onClick={() => setLanguage(language === value ? '' : value)} key={value}>
                {value} <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="filter-chips category-chips">
            {categories.slice(0, 8).map(([value, count]) => (
              <button className={cx(category === value && 'active')} onClick={() => setCategory(category === value ? '' : value)} key={value}>
                {value} <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="selected-bar">
            <strong>Выбрано: {selected.length}</strong>
            <button onClick={toggleVisibleSongs}><CheckCircle2 size={17} /> {filteredSongs.length && filteredSongs.every(song => selected.includes(song.id)) ? 'Снять видимые' : 'Выбрать видимые'}</button>
            <button onClick={() => addSelectedToPlan(false)}><ListPlus size={17} /> В план</button>
            <button className="danger" onClick={() => addSelectedToPlan(true)}><ClipboardList size={17} /> Новый план</button>
            <button onClick={resetFilters}><RotateCcw size={17} /> Сбросить</button>
          </div>
        </div>

        <details className="card guest-card collapsible-tool">
          <summary>
            <span>Гость принес YouTube-ссылку</span>
            <small>Открыть</small>
          </summary>
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
        </details>

        <details className="card collapsible-tool">
          <summary>
            <span>Добавить локальную песню / видео</span>
            <small>Открыть</small>
          </summary>
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
        </details>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Каталог песен</h2>
          <span>{loading ? '...' : filteredSongs.length}</span>
        </div>
        <div className="song-list">
          {filteredSongs.map(song => (
            <article className={cx('song-item', selected.includes(song.id) && 'selected-item')} key={song.id}>
              <div className="song-select-line">
                <input type="checkbox" checked={selected.includes(song.id)} onChange={() => toggleSong(song.id)} />
                <SongThumb song={song} />
                <div>
                  <h3>{song.title}</h3>
                  <p>{song.language} · {song.category} · {(song.tags || []).join(', ')}</p>
                  <span className={cx('badge', song.isOfflineReady ? 'ok' : 'warn')}>{song.isOfflineReady ? 'Готово офлайн' : (song.youtubeUrl ? (song.youtubeAudioOnly ? 'YouTube audio / онлайн' : 'YouTube / онлайн') : 'Без файла')}</span>
                </div>
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Песня показана', () => api(`/api/songs/${song.id}/show`, { method: 'POST' }))}><Video size={17} /> На ТВ</button>
                <button onClick={() => action('Песня добавлена в план', () => api(`/api/songs/${song.id}/add-to-plan`, { method: 'POST' }))}><ListPlus size={17} /> В план</button>
                <button className={cx('icon-btn', song.favorite && 'favorite-on')} onClick={() => action(song.favorite ? 'Убрано из избранного' : 'Добавлено в избранное', () => toggleFavorite(song))}><Star size={17} /></button>
                <button className="icon-btn danger" onClick={() => remove(song.id)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
          {!loading && filteredSongs.length === 0 && (
            <div className="empty-search">
              <Search size={26} />
              <strong>Ничего не найдено</strong>
              <p>Попробуйте убрать тему, язык или сократить текст поиска.</p>
              <button onClick={resetFilters}>Сбросить фильтры</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}


function LearningVideosPanel({ section, action, refreshPlan }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const allSongs = await api('/api/songs');
      setItems(allSongs.filter(item => matchesMediaSection(item, section.prefixes)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [section.id]);

  const categories = useMemo(() => {
    const counts = new Map();
    items.forEach(item => {
      const value = item.category || section.label;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, section.label]);

  const filteredItems = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(item => {
      if (category && String(item.category || '') !== category) return false;
      if (!words.length) return true;
      const text = [item.title, item.category, item.originalFileName, ...(item.tags || [])].join(' ').toLowerCase();
      return words.every(word => text.includes(word));
    });
  }, [items, q, category]);

  function resetFilters() {
    setQ('');
    setCategory('');
  }

  function toggleItem(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleVisibleItems() {
    const visibleIds = filteredItems.map(item => item.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id));
    setSelected(prev => allVisibleSelected
      ? prev.filter(id => !visibleIds.includes(id))
      : [...new Set([...prev, ...visibleIds])]);
  }

  async function addSelectedToPlan(clearBefore = false) {
    if (!selected.length) return alert('Выбери видео галочками');
    await api('/api/service-plan/add-songs-bulk', postJson({ songIds: selected, clearBefore }));
    setSelected([]);
    await refreshPlan();
  }

  async function remove(id) {
    if (!confirm('Удалить материал из каталога? Файл на диске не удаляется.')) return;
    await api(`/api/songs/${id}`, { method: 'DELETE' });
    await load();
    await refreshPlan();
  }

  return (
    <section className="grid two">
      <div className="stack">
        <div className="card">
          <div className="card-title-row compact">
            <div>
              <h2>{section.label}</h2>
              <p>{section.description}</p>
            </div>
            <span className="result-count">{loading ? '...' : `${filteredItems.length} / ${items.length}`}</span>
          </div>
          <div className="song-search-grid learning-search-grid">
            <label className="song-search-main">
              <Search size={22} />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Поиск по названию, уроку, модулю..."
              />
            </label>
            <label>Тема / папка
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">Все темы</option>
                {categories.map(([value, count]) => <option value={value} key={value}>{value} ({count})</option>)}
              </select>
            </label>
          </div>
          <div className="filter-chips category-chips">
            {categories.slice(0, 10).map(([value, count]) => (
              <button className={cx(category === value && 'active')} onClick={() => setCategory(category === value ? '' : value)} key={value}>
                {value} <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="selected-bar">
            <strong>Выбрано: {selected.length}</strong>
            <button onClick={toggleVisibleItems}><CheckCircle2 size={17} /> {filteredItems.length && filteredItems.every(item => selected.includes(item.id)) ? 'Снять видимые' : 'Выбрать видимые'}</button>
            <button onClick={() => addSelectedToPlan(false)}><ListPlus size={17} /> В план</button>
            <button className="danger" onClick={() => addSelectedToPlan(true)}><ClipboardList size={17} /> Новый план</button>
            <button onClick={resetFilters}><RotateCcw size={17} /> Сбросить</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Материалы</h2>
          <span>{loading ? '...' : filteredItems.length}</span>
        </div>
        <div className="song-list">
          {filteredItems.map(item => (
            <article className={cx('song-item', selected.includes(item.id) && 'selected-item')} key={item.id}>
              <div className="song-select-line">
                <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleItem(item.id)} />
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.category}</p>
                  <span className={cx('badge', item.isOfflineReady ? 'ok' : 'warn')}>{item.isOfflineReady ? 'Готово офлайн' : 'Без файла'}</span>
                </div>
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Материал показан', () => api(`/api/songs/${item.id}/show`, { method: 'POST' }))}><Video size={17} /> На ТВ</button>
                <button onClick={() => action('Материал добавлен в план', () => api(`/api/songs/${item.id}/add-to-plan`, { method: 'POST' }))}><ListPlus size={17} /> В план</button>
                <button className="icon-btn danger" onClick={() => remove(item.id)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
          {!loading && filteredItems.length === 0 && (
            <div className="empty-search">
              <Search size={26} />
              <strong>Материалы не найдены</strong>
              <p>Запустите импорт после добавления файлов или сбросьте фильтры.</p>
              <button onClick={resetFilters}>Сбросить фильтры</button>
            </div>
          )}
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

function clampFontScale(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(2.5, Math.max(0.5, Math.round(num * 100) / 100));
}

function BiblePanel({ action, state }) {
  const [reference, setReference] = useState('Иоанна 7:37-38');
  const [translations, setTranslations] = useState([]);
  const [books, setBooks] = useState([]);
  const [selected, setSelected] = useState(['ru_synodal']);
  const [scriptureWeight, setScriptureWeight] = useState('medium');
  const [fontScale, setFontScale] = useState(1);
  const fontScaleTimer = useRef(null);
  const bibleLive = state?.mode === 'bible';
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
    const [list, bookList, settings] = await Promise.all([
      api('/api/bible/translations'),
      api('/api/bible/books'),
      api('/api/settings')
    ]);
    setTranslations(list || []);
    setBooks(bookList || []);
    setScriptureWeight(settings?.bible?.scriptureWeight || 'medium');
    setFontScale(clampFontScale(settings?.bible?.fontScale ?? 1));
    if (list?.some(t => t.id === 'ru_synodal')) setSelected(prev => prev.length ? prev : ['ru_synodal']);
  }

  function changeFontScale(nextValue) {
    const value = clampFontScale(nextValue);
    setFontScale(value);
    // Debounced: persists as default and live-patches the TV if Scripture is on screen.
    if (fontScaleTimer.current) clearTimeout(fontScaleTimer.current);
    fontScaleTimer.current = setTimeout(() => {
      api('/api/bible/font-scale', postJson({ fontScale: value })).catch(() => {});
    }, 120);
  }

  async function saveScriptureWeight(nextWeight) {
    setScriptureWeight(nextWeight);
    try {
      await api('/api/settings/bible', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptureWeight: nextWeight })
      });
    } catch (error) {
      alert(error.message);
    }
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

  const preparedPayload = { reference, translations: selected, scriptureWeight, fontScale };
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

        <BibleWeightSettings value={scriptureWeight} onChange={saveScriptureWeight} />

        <FontScaleSlider value={fontScale} onChange={changeFontScale} live={bibleLive} />

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

function BibleWeightSettings({ value, onChange }) {
  return (
    <div className="bible-weight-settings">
      <div>
        <strong>Scripture boldness</strong>
        <p>Middle is the current TV value.</p>
      </div>
      <div className="font-weight-options">
        {BIBLE_WEIGHT_OPTIONS.map(option => (
          <button
            key={option.id}
            type="button"
            className={cx(value === option.id && 'active')}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FontScaleSlider({ value, onChange, live }) {
  const percent = Math.round(value * 100);
  return (
    <div className="font-scale-settings">
      <div className="font-scale-head">
        <div>
          <strong>Размер шрифта на ТВ</strong>
          <p>{live ? 'Стих уже на экране — размер меняется вживую.' : 'Применится при показе на ТВ.'}</p>
        </div>
        <span className="font-scale-value">{percent}%</span>
      </div>
      <div className="font-scale-row">
        <button type="button" className="icon-btn" onClick={() => onChange(value - 0.1)} aria-label="Меньше">A−</button>
        <input
          type="range"
          min="0.5"
          max="2.5"
          step="0.05"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <button type="button" className="icon-btn" onClick={() => onChange(value + 0.1)} aria-label="Больше">A+</button>
        <button type="button" className="font-scale-reset" onClick={() => onChange(1)}>100%</button>
      </div>
    </div>
  );
}

function LiveTranslationPanel({ action }) {
  const [state, setState] = useState(null);
  const [engine, setEngine] = useState('stub');
  const [displayLang, setDisplayLang] = useState('en');

  async function refresh() { try { setState(await api('/api/translation/live/state')); } catch {} }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  const running = state?.running;
  return (
    <div className="card live-translation-card">
      <div className="card-title-row">
        <div>
          <h2>Своё решение · OpenAI (субтитры)</h2>
          <p>Перевод проповеди в реальном времени через OpenAI. Звук берётся на мини-ПК, субтитры идут на ТВ и на телефоны по локальной сети. Прихожанин сам выбирает язык на телефоне.</p>
        </div>
        <span className={cx('badge', running ? 'ok' : 'warn')}>{running ? `идёт · ${state.engine}` : 'остановлен'}</span>
      </div>
      <div className="form-row three-cols">
        <label>Движок
          <select value={engine} onChange={e => setEngine(e.target.value)} disabled={running}>
            <option value="stub">Заглушка (тест без интернета)</option>
            <option value="openai">OpenAI Realtime</option>
          </select>
        </label>
        <label>Язык субтитров на ТВ
          <select value={displayLang} onChange={e => setDisplayLang(e.target.value)}>
            {supportedLanguages.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
          </select>
        </label>
        <div className="live-tr-key">
          {state && (state.hasApiKey ? <span className="badge ok">ключ OpenAI есть</span> : <span className="badge warn">нет OPENAI_API_KEY</span>)}
        </div>
      </div>
      <div className="button-row">
        {!running
          ? <button className="primary" onClick={() => action('Перевод запущен', () => api('/api/translation/live/start', postJson({ engine, displayLang })).then(refresh))}><Play size={18} /> Запустить</button>
          : <button className="danger" onClick={() => action('Перевод остановлен', () => api('/api/translation/live/stop', { method: 'POST' }).then(refresh))}><Square size={18} /> Остановить</button>}
        <button onClick={() => window.open('/translate/source', '_blank')}><Radio size={18} /> Источник звука</button>
        <button className="primary" onClick={() => action('Субтитры на ТВ', () => api('/api/translation/live/show-on-tv', postJson({ lang: displayLang })))}><Megaphone size={18} /> Субтитры на ТВ</button>
        <button onClick={() => action('QR на телефоны', () => api('/api/translation/live/show-qr', { method: 'POST' }))}><QrCode size={18} /> QR на телефоны</button>
      </div>
      <div className="live-tr-status">
        {(state?.languages || []).map(l => <span className="badge" key={l.lang}>{getLanguageLabel(l.lang)}: {l.status}</span>)}
        {state?.lanUrls?.length > 0 && <p className="hint">Телефоны в LAN открывают: {state.lanUrls.map(u => `${u}/translate`).join('   ·   ')}</p>}
      </div>
    </div>
  );
}

const EMPTY_TRANSLATION_DRAFT = {
  name: '',
  audienceUrl: '',
  screenEmbedUrl: '',
  languages: 'English, Srpski',
  audienceInstructions: 'Scan the QR code to read or listen to the live translation in your language.\nFor audio, please use headphones.',
  rtmpUrl: '',
  rtmpKey: ''
};

const CAPTION_LANGUAGE_OPTIONS = [
  { code: 'en-US', label: 'English' },
  { code: 'sr', label: 'Srpski' },
  { code: 'bs', label: 'Bosanski' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'pl', label: 'Polski' },
  { code: 'nl', label: 'Dutch' }
];

function TranslationPanel({ action }) {
  const [providers, setProviders] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api('/api/translation/providers');
      setProviders(data.providers || []);
      setActiveId(data.activeId || '');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function activate(id) {
    await api(`/api/translation/providers/${id}/activate`, { method: 'POST' });
    await load();
  }

  async function saveDraft() {
    if (!draft) return;
    const body = postJson(draft);
    if (draft.id) await api(`/api/translation/providers/${draft.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    else await api('/api/translation/providers', body);
    setDraft(null);
    await load();
  }

  async function removeProvider(id) {
    if (!confirm('Удалить сервис перевода из списка?')) return;
    await api(`/api/translation/providers/${id}`, { method: 'DELETE' });
    if (draft?.id === id) setDraft(null);
    await load();
  }

  function getCaptionFontSize(url) {
    try {
      const parsed = new URL(url);
      const raw = parsed.searchParams.get('fontSize') || parsed.searchParams.get('font-size') || '10';
      const match = String(raw).match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : 10;
    } catch {
      return 10;
    }
  }

  function getCaptionLanguage(url) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const index = parts.indexOf('l');
      return index !== -1 && parts[index + 1] ? parts[index + 1] : 'en-US';
    } catch {
      return 'en-US';
    }
  }

  async function changeCaptionFont(provider, fontSize) {
    const safeSize = Math.min(120, Math.max(6, Math.round(Number(fontSize) || 10)));
    await api(`/api/translation/providers/${provider.id}/caption-font-size`, postJson({ fontSize: safeSize }));
    await load();
  }

  async function changeCaptionLanguage(provider, language) {
    await api(`/api/translation/providers/${provider.id}/caption-language`, postJson({ language }));
    await load();
  }

  return (
    <div className="stack">
      <LiveTranslationPanel action={action} />
    <section className="grid two">
      <div className="stack">
        <div className="card">
          <div className="card-title-row compact">
            <div>
              <h2>Сервисы перевода</h2>
              <p>Сначала покажи <strong>QR на телефоны</strong> (люди сканируют и открывают у себя), потом переключи на <strong>Субтитры на ТВ</strong> — слова проповедника на экране.</p>
            </div>
            <span className="result-count">{loading ? '...' : providers.length}</span>
          </div>
          <div className="song-list">
            {providers.map(p => {
              const isActive = p.id === activeId;
              const captionFontSize = getCaptionFontSize(p.screenEmbedUrl);
              const captionLanguage = getCaptionLanguage(p.screenEmbedUrl);
              return (
                <article className={cx('song-item', 'provider-item', isActive && 'active-plan-item')} key={p.id}>
                  <div>
                    <h3>{p.name} {isActive && <span className="badge ok">активный</span>}</h3>
                    <p>{p.languages || 'языки не указаны'}</p>
                    <div className="provider-badges">
                      <span className={cx('badge', p.audienceUrl ? 'ok' : 'warn')}>{p.audienceUrl ? 'телефоны ✓' : 'нет ссылки телефонов'}</span>
                      <span className={cx('badge', p.screenEmbedUrl ? 'ok' : 'warn')}>{p.screenEmbedUrl ? 'субтитры ✓' : 'нет субтитров'}</span>
                      {p.rtmpUrl && <span className="badge">RTMP</span>}
                    </div>
                    {p.screenEmbedUrl && (
                      <div className="caption-control-stack">
                        <div className="caption-language-controls">
                          <label>Язык субтитров
                            <select
                              value={captionLanguage}
                              onChange={e => action('Язык субтитров изменен', () => changeCaptionLanguage(p, e.target.value))}
                            >
                              {CAPTION_LANGUAGE_OPTIONS.map(option => (
                                <option key={option.code} value={option.code}>{option.label} · {option.code}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="caption-font-controls">
                          <div>
                            <strong>Шрифт субтитров</strong>
                            <span>{captionFontSize}px</span>
                          </div>
                          <div className="caption-font-buttons">
                            <button type="button" className="icon-btn" onClick={() => action('Шрифт субтитров уменьшен', () => changeCaptionFont(p, captionFontSize - 2))}>A−</button>
                            <button type="button" className="icon-btn" onClick={() => action('Шрифт субтитров увеличен', () => changeCaptionFont(p, captionFontSize + 2))}>A+</button>
                            <button type="button" onClick={() => action('Шрифт субтитров сброшен', () => changeCaptionFont(p, p.id === 'glossa' ? 64 : 10))}>Сброс</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="song-actions wrap-actions">
                    <button className="primary" disabled={!p.audienceUrl} onClick={() => action('QR на телефоны показан', () => api(`/api/translation/providers/${p.id}/show-qr`, { method: 'POST' }))}><QrCode size={17} /> QR на телефоны</button>
                    <button className="primary" disabled={!p.screenEmbedUrl} onClick={() => action('Субтитры на ТВ', () => api(`/api/translation/providers/${p.id}/show-caption`, { method: 'POST' }))}><Megaphone size={17} /> Субтитры на ТВ</button>
                    <button disabled={!p.audienceUrl} onClick={() => action('QR добавлен в план', () => api(`/api/translation/providers/${p.id}/add-qr-to-plan`, { method: 'POST' }))}><ListPlus size={17} /> QR в план</button>
                    <button disabled={!p.screenEmbedUrl} onClick={() => action('Субтитры добавлены в план', () => api(`/api/translation/providers/${p.id}/add-caption-to-plan`, { method: 'POST' }))}><ListPlus size={17} /> Субтитры в план</button>
                    {!isActive && <button onClick={() => activate(p.id)}><CheckCircle2 size={17} /> Активный</button>}
                    <button className="icon-btn" onClick={() => setDraft({ ...p })}><RotateCcw size={17} /></button>
                    <button className="icon-btn danger" onClick={() => removeProvider(p.id)}><Trash2 size={17} /></button>
                  </div>
                </article>
              );
            })}
            {!loading && !providers.length && <p>Список пуст. Добавь первый сервис перевода справа.</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>{draft?.id ? 'Изменить сервис' : 'Добавить сервис'}</h2>
          {draft && <button onClick={() => setDraft(null)}>Отмена</button>}
        </div>
        {!draft && <button className="big-action" onClick={() => setDraft({ ...EMPTY_TRANSLATION_DRAFT })}><Plus size={18} /> Новый сервис перевода</button>}
        {draft && (
          <form className="form" onSubmit={e => { e.preventDefault(); saveDraft().catch(err => alert(err.message)); }}>
            <label>Название<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="CaptionKit / Glossa / ..." /></label>
            <label>Ссылка для телефонов прихожан (→ QR)
              <input value={draft.audienceUrl} onChange={e => setDraft({ ...draft, audienceUrl: e.target.value })} placeholder="https://captionkit.io/c/word-of-god" />
            </label>
            <label>Ссылка субтитров для экрана (iframe)
              <input value={draft.screenEmbedUrl} onChange={e => setDraft({ ...draft, screenEmbedUrl: e.target.value })} placeholder="https://captionkit.io/f/word-of-god/l/en-US?fontSize=10" />
            </label>
            <label>Языки<input value={draft.languages} onChange={e => setDraft({ ...draft, languages: e.target.value })} placeholder="English, Srpski" /></label>
            <label>Английское объявление на QR-экране<textarea rows="3" value={draft.audienceInstructions} onChange={e => setDraft({ ...draft, audienceInstructions: e.target.value })} /></label>
            <details className="collapsible-tool">
              <summary><span>RTMP-вход (для микшера, опционально)</span><small>Открыть</small></summary>
              <p className="hint">Понадобится, когда подключишь микшер и будешь подавать чистый звук с пульта. Ключ хранится локально на мини-ПК.</p>
              <label>RTMP URL<input value={draft.rtmpUrl} onChange={e => setDraft({ ...draft, rtmpUrl: e.target.value })} placeholder="rtmp://stream.glossa.live:1935/live" /></label>
              <label>RTMP ключ<input value={draft.rtmpKey} onChange={e => setDraft({ ...draft, rtmpKey: e.target.value })} placeholder="секретный ключ потока" /></label>
            </details>
            <button className="primary" type="submit"><CheckCircle2 size={18} /> Сохранить сервис</button>
          </form>
        )}
        <p className="hint">QR-экран и экран-субтитры — это два отдельных пункта. Покажи QR, дай людям просканировать, затем включи субтитры — на экране пойдут слова проповедника.</p>
      </div>
    </section>
    </div>
  );
}

function AnnouncementPanel({ action }) {
  const donationPreset = {
    title: 'Поддержите наше служение',
    titleEn: 'Support Our Ministry',
    body: 'Спасибо за вашу поддержку служения.\nВаше участие помогает нам служить людям и распространять Евангелие.',
    bodyEn: 'Thank you for supporting our ministry.\nYour generosity helps us serve people and share the Gospel.',
    qrUrl: '',
    qrImageUrl: '/buymecoffee.png'
  };
  const welcomePreset = {
    title: 'Добро пожаловать!',
    titleEn: 'Welcome!',
    body: 'Мы рады видеть вас на служении. После служения будем рады познакомиться с вами.',
    bodyEn: 'We are glad to see you at the service. After the service, we would love to meet you.',
    qrUrl: ''
  };
  const translationPreset = {
    title: 'Live-перевод',
    titleEn: 'Live translation',
    body: 'Для перевода проповеди отсканируйте QR-код и выберите язык.',
    bodyEn: 'To listen to the sermon translation, scan the QR code and choose your language.',
    qrUrl: ''
  };
  const fellowshipPreset = {
    title: 'После служения',
    titleEn: 'After the service',
    body: 'Оставайтесь на общение и чай после служения.',
    bodyEn: 'Please stay for fellowship and tea after the service.',
    qrUrl: ''
  };
  const photoPreset = {
    title: 'Общая фотография',
    titleEn: 'Group photo',
    body: 'Приглашаем всех сделать общую фотографию на память.',
    bodyEn: 'We invite everyone to take a group photo as a memory.',
    qrUrl: ''
  };
  function makeTestimonyPreset(name) {
    const person = String(name || '').trim();
    return {
      title: person ? `Свидетельство · ${person}` : 'Время свидетельств',
      titleEn: person ? `Testimony · ${person}` : 'Time of Testimonies',
      body: `${person ? `${person} делится свидетельством.\n` : 'Поделитесь кратко тем, что совершил Господь в вашей жизни.\n'}«Придите, послушайте, все боящиеся Бога, и я возвещу вам, что сотворил Он для души моей». — Псалом 65:16`,
      bodyEn: `${person ? `${person} is sharing a testimony.\n` : 'Share briefly what God has done in your life.\n'}“Come and hear, all you who fear God; let me tell you what he has done for me.” — Psalm 66:16`,
      qrUrl: ''
    };
  }
  const prayerPreset = {
    title: 'Время молитвы',
    titleEn: 'Time of Prayer',
    body: 'Будем вместе искать лица Божьего в молитве.\n«Ищите лица Моего». И буду искать лица Твоего, Господи. — Псалом 26:8',
    bodyEn: 'Let us seek the face of God together in prayer.\n“Seek my face.” Your face, Lord, I will seek. — Psalm 27:8',
    qrUrl: ''
  };
  function makeSoloPraisePreset(name, songTitle) {
    const person = String(name || '').trim();
    const song = String(songTitle || '').trim();
    const detailRu = [person, song && `«${song}»`].filter(Boolean).join(' · ');
    const detailEn = [person, song && `“${song}”`].filter(Boolean).join(' · ');
    return {
      title: detailRu ? `Прославление · ${detailRu}` : 'Прославим Господа пением',
      titleEn: detailEn ? `Worship Song · ${detailEn}` : 'Let Us Praise the Lord in Song',
      body: `${detailRu ? 'Сольное прославление.\n' : 'Сольное прославление.\n'}«Воспойте Господу новую песнь; воспойте Господу, вся земля». — Псалом 95:1`,
      bodyEn: `${detailEn ? 'A song of worship.\n' : 'A song of worship.\n'}“Sing to the Lord a new song; sing to the Lord, all the earth.” — Psalm 96:1`,
      qrUrl: ''
    };
  }
  function makeBirthdayPreset(name) {
    const ruName = String(name || '').trim() || '[имя]';
    const enName = ruName === '[имя]' ? '[name]' : ruName;
    return {
      title: 'С Днём рождения!',
      titleEn: 'Happy Birthday!',
      body: `Поздравляем, ${ruName}! Пусть Господь обильно благословит новый год твоей жизни.\n«Да благословит тебя Господь и сохранит тебя!» — Числа 6:24`,
      bodyEn: `Happy Birthday, ${enName}! May the Lord richly bless this new year of your life.\n“The Lord bless you and keep you.” — Numbers 6:24`,
      qrUrl: ''
    };
  }
  const childrenPraisePreset = {
    title: 'Пустите детей приходить ко Мне',
    titleEn: 'Let the Little Children Come to Me',
    body: 'Дети славят Господа песней и стихами.\n«Пустите детей и не препятствуйте им приходить ко Мне, ибо таковых есть Царство Небесное». — Матфея 19:14',
    bodyEn: 'The children praise the Lord with song and verse.\n“Let the little children come to me, and do not hinder them, for the kingdom of heaven belongs to such as these.” — Matthew 19:14',
    qrUrl: ''
  };
  const healingPrayerPreset = {
    title: 'Молитва за исцеление',
    titleEn: 'Prayer for Healing',
    body: 'Если вы нуждаетесь в исцелении, служители готовы помолиться с вами.\n«Молитва веры исцелит болящего, и восставит его Господь». — Иакова 5:15',
    bodyEn: 'If you need healing, our ministry team is ready to pray with you.\n“The prayer of faith shall save the sick, and the Lord shall raise him up.” — James 5:15',
    qrUrl: ''
  };
  const communionPreset = {
    title: 'Причастие',
    titleEn: 'Communion',
    body: 'Будем вспоминать смерть и воскресение Господа Иисуса Христа.\n«Сие творите в Мое воспоминание». — 1 Коринфянам 11:24',
    bodyEn: 'We remember the death and resurrection of the Lord Jesus Christ.\n“Do this in remembrance of me.” — 1 Corinthians 11:24',
    qrUrl: ''
  };
  const holySpiritBaptismPreset = {
    title: 'Молитва за крещение Духом Святым',
    titleEn: 'Prayer for the Baptism in the Holy Spirit',
    body: 'Приглашаем всех, кто желает исполниться Духом Святым, выйти для молитвы.\n«Вы примете силу, когда сойдет на вас Дух Святой». — Деяния 1:8',
    bodyEn: 'Everyone who desires to be filled with the Holy Spirit is invited to come forward for prayer.\n“You shall receive power, after that the Holy Ghost is come upon you.” — Acts 1:8',
    qrUrl: ''
  };
  const teaTablePreset = {
    title: 'Приглашаем к столу',
    titleEn: 'You Are Invited to the Table',
    body: 'После служения приглашаем всех к совместному чаепитию и общению.\n«Преломляя по домам хлеб, принимали пищу в веселии и простоте сердца». — Деяния 2:46',
    bodyEn: 'After the service, everyone is invited for tea and fellowship.\n“They broke bread from house to house, and did eat their meat with gladness and singleness of heart.” — Acts 2:46',
    qrUrl: ''
  };
  const salvationCallPreset = {
    title: 'Призыв к покаянию',
    titleEn: 'Invitation to Repentance',
    body: 'Если вы хотите примириться с Богом, мы приглашаем вас выйти для молитвы.\n«Покайтесь и обратитесь, чтобы загладились грехи ваши». — Деяния 3:19',
    bodyEn: 'If you want to be reconciled with God, we invite you to come forward for prayer.\n“Repent ye therefore, and be converted, that your sins may be blotted out.” — Acts 3:19',
    qrUrl: ''
  };
  const waterBaptismPreset = {
    title: 'Водное крещение',
    titleEn: 'Water Baptism',
    body: 'Если вы хотите принять водное крещение, подойдите к служителям после служения.\n«Покайтесь, и да крестится каждый из вас во имя Иисуса Христа». — Деяния 2:38',
    bodyEn: 'If you want to be baptized in water, please speak with the ministry team after the service.\n“Repent, and be baptized every one of you in the name of Jesus Christ.” — Acts 2:38',
    qrUrl: ''
  };
  const needsPrayerPreset = {
    title: 'Молитва за нужды',
    titleEn: 'Prayer for Needs',
    body: 'Если у вас есть нужда, мы готовы помолиться вместе с вами.\n«Открывайте свои желания пред Богом в молитве и прошении с благодарением». — Филиппийцам 4:6',
    bodyEn: 'If you have a need, we are ready to pray with you.\n“In every thing by prayer and supplication with thanksgiving let your requests be made known unto God.” — Philippians 4:6',
    qrUrl: ''
  };
  function makeChildrenBlessingPreset(name) {
    const child = String(name || '').trim();
    return {
      title: child ? `Благословение · ${child}` : 'Благословение детей',
      titleEn: child ? `Blessing · ${child}` : 'Blessing the Children',
      body: `${child ? `Приглашаем ${child} и семью для молитвы благословения.\n` : 'Приглашаем родителей с детьми для молитвы благословения.\n'}«И, обняв их, возложил руки на них и благословил их». — Марка 10:16`,
      bodyEn: `${child ? `${child} and family are invited forward for a prayer of blessing.\n` : 'Parents and children are invited forward for a prayer of blessing.\n'}“He took them up in his arms, put his hands upon them, and blessed them.” — Mark 10:16`,
      qrUrl: ''
    };
  }
  function makeBaptismWelcomePreset(name) {
    const person = String(name || '').trim();
    return {
      title: person ? `Приветствуем крещаемого · ${person}` : 'Приветствуем крещаемого',
      titleEn: person ? `Welcoming the Baptism Candidate · ${person}` : 'Welcoming the Baptism Candidate',
      body: `Сегодня мы радуемся вместе с ${person || 'тем, кто свидетельствует о своей вере'} через водное крещение.\n«Итак, кто во Христе, тот новая тварь; древнее прошло, теперь всё новое». — 2 Коринфянам 5:17`,
      bodyEn: `Today we rejoice with ${person || 'the one who is declaring their faith'} through water baptism.\n“If any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new.” — 2 Corinthians 5:17`,
      qrUrl: ''
    };
  }
  const missionsPrayerPreset = {
    title: 'Молитва за народы',
    titleEn: 'Prayer for the Nations',
    body: 'Будем молиться за народы, миссионеров и распространение Евангелия.\n«Идите, научите все народы». — Матфея 28:19',
    bodyEn: 'Let us pray for the nations, missionaries, and the spread of the Gospel.\n“Go ye therefore, and teach all nations.” — Matthew 28:19',
    qrUrl: ''
  };
  const [form, setForm] = useState(welcomePreset);
  const [items, setItems] = useState([]);
  const [lang, setLang] = useState('both');
  const [birthdayName, setBirthdayName] = useState('');
  const [baptismName, setBaptismName] = useState('');
  const [childName, setChildName] = useState('');
  const [testimonyName, setTestimonyName] = useState('');
  const [soloName, setSoloName] = useState('');
  const [soloSongTitle, setSoloSongTitle] = useState('');

  async function load() {
    setItems(await api('/api/announcements'));
  }
  useEffect(() => { load(); }, []);

  async function saveAndShow() {
    await action('Объявление показано', () => api('/api/announcement/show', postJson({ ...form, lang })));
    await load();
  }
  async function saveToPlan() {
    await action('Объявление добавлено в план', () => api('/api/announcement/add-to-plan', postJson({ ...form, lang })));
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
          <button onClick={() => setForm(fellowshipPreset)}>Общение</button>
          <button onClick={() => setForm(photoPreset)}>Фото</button>
          <button onClick={() => setForm(makeTestimonyPreset(testimonyName))}>Свидетельства</button>
          <button onClick={() => setForm(prayerPreset)}>Молитва</button>
          <button onClick={() => setForm(makeSoloPraisePreset(soloName, soloSongTitle))}>Сольное пение</button>
          <button onClick={() => setForm(makeBirthdayPreset(birthdayName))}>День рождения</button>
          <button onClick={() => setForm(childrenPraisePreset)}>Дети славят</button>
          <button onClick={() => setForm(healingPrayerPreset)}>Исцеление</button>
          <button onClick={() => setForm(communionPreset)}>Причастие</button>
          <button onClick={() => setForm(holySpiritBaptismPreset)}>Крещение Духом</button>
          <button onClick={() => setForm(teaTablePreset)}>Чаепитие</button>
          <button onClick={() => setForm(salvationCallPreset)}>Покаяние</button>
          <button onClick={() => setForm(waterBaptismPreset)}>Водное крещение</button>
          <button onClick={() => setForm(makeBaptismWelcomePreset(baptismName))}>Крещаемый</button>
          <button onClick={() => setForm(needsPrayerPreset)}>Нужды</button>
          <button onClick={() => setForm(makeChildrenBlessingPreset(childName))}>Благословение детей</button>
          <button onClick={() => setForm(missionsPrayerPreset)}>Миссии</button>
        </div>
        <div className="quick-name-grid">
          <label>Имя для поздравления
            <input value={birthdayName} onChange={e => setBirthdayName(e.target.value)} placeholder="Например: Мария" />
            <button type="button" onClick={() => setForm(makeBirthdayPreset(birthdayName))}>День рождения</button>
          </label>
          <label>Крещаемый
            <input value={baptismName} onChange={e => setBaptismName(e.target.value)} placeholder="Например: Давид" />
            <button type="button" onClick={() => setForm(makeBaptismWelcomePreset(baptismName))}>Крещаемый</button>
          </label>
          <label>Ребенок / семья
            <input value={childName} onChange={e => setChildName(e.target.value)} placeholder="Например: семья Ивановых" />
            <button type="button" onClick={() => setForm(makeChildrenBlessingPreset(childName))}>Благословение</button>
          </label>
          <label>Свидетельство
            <input value={testimonyName} onChange={e => setTestimonyName(e.target.value)} placeholder="Имя человека" />
            <button type="button" onClick={() => setForm(makeTestimonyPreset(testimonyName))}>Свидетельство</button>
          </label>
          <label>Сольное пение
            <input value={soloName} onChange={e => setSoloName(e.target.value)} placeholder="Имя" />
            <input value={soloSongTitle} onChange={e => setSoloSongTitle(e.target.value)} placeholder="Название песни" />
            <button type="button" onClick={() => setForm(makeSoloPraisePreset(soloName, soloSongTitle))}>Сольное пение</button>
          </label>
        </div>
        <div className="lang-toggle">
          <span>Язык на экране:</span>
          {[['both', 'Оба'], ['ru', 'Русский'], ['en', 'English']].map(([value, label]) => (
            <button key={value} type="button" className={cx(lang === value && 'active')} onClick={() => setLang(value)}>{label}</button>
          ))}
        </div>
        <form className="form" onSubmit={e => e.preventDefault()}>
          <div className="form-row">
            <label>Заголовок RU<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>Заголовок EN<input value={form.titleEn || ''} onChange={e => setForm({ ...form, titleEn: e.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>Текст RU<textarea rows="6" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
            <label>Текст EN<textarea rows="6" value={form.bodyEn || ''} onChange={e => setForm({ ...form, bodyEn: e.target.value })} /></label>
          </div>
          <label>QR-ссылка (необязательно)<input value={form.qrUrl} onChange={e => setForm({ ...form, qrUrl: e.target.value })} placeholder="Оставьте пустым, если QR нет" /></label>
          <p className="hint">Если QR-ссылки нет, экран просто покажет текст. Для пожертвований уже готов текст про бокс.</p>
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
                <h3>{item.title}{item.titleEn ? ` / ${item.titleEn}` : ''}</h3>
                <p>{item.body}</p>
                {item.bodyEn && <p className="muted-text">{item.bodyEn}</p>}
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


function ExternalLinksPanel({ action, refreshPlan }) {
  const [links, setLinks] = useState([]);
  const [form, setForm] = useState({ title: '', url: '', category: 'Ссылка', notes: '' });
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setLinks(await api('/api/external-links')); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    await api('/api/external-links', postJson(form));
    setForm({ title: '', url: '', category: 'Ссылка', notes: '' });
    await load();
  }

  async function remove(id) {
    if (!confirm('Удалить внешнюю ссылку?')) return;
    await api(`/api/external-links/${id}`, { method: 'DELETE' });
    await load();
    await refreshPlan();
  }

  return (
    <section className="grid two">
      <div className="card">
        <h2>Внешние ссылки</h2>
        <p>Храни сайты, которые иногда нужно показать на ТВ: магазин, языковую программу, формы, страницы служения.</p>
        <div className="preset-grid">
          <button onClick={() => setForm({ title: 'FaithCuts · Etsy', url: 'https://www.etsy.com/shop/FaithCuts', category: 'Магазин', notes: 'Демонстрация магазина' })}>FaithCuts</button>
          <button onClick={() => setForm({ title: 'Kotmilo', url: 'https://kotmilo.top', category: 'Изучение языка', notes: 'Программа изучения языка' })}>Kotmilo</button>
        </div>
        <form className="form" onSubmit={submit}>
          <label>Название<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Название для экрана" /></label>
          <label>URL<input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://..." /></label>
          <div className="form-row">
            <label>Категория<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
            <label>Заметка<input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <button className="primary" type="submit"><Plus size={18} /> Сохранить ссылку</button>
        </form>
        <p className="hint">Некоторые сайты запрещают открытие внутри iframe. Если на ТВ пусто, открой ссылку напрямую на mini PC или используй другой режим показа.</p>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Сохраненные ссылки</h2>
          <button onClick={load}><RotateCcw size={17} /> Обновить</button>
        </div>
        <div className="song-list">
          {loading && <p>Загрузка...</p>}
          {!loading && !links.length && <p>Пока нет ссылок.</p>}
          {links.map(link => (
            <article className="song-item" key={link.id}>
              <div>
                <h3>{link.title}</h3>
                <p>{link.category} · {link.url}</p>
                {link.notes && <p className="muted-text">{link.notes}</p>}
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Ссылка показана', () => api(`/api/external-links/${link.id}/show`, { method: 'POST' }))}><Monitor size={17} /> На ТВ</button>
                <button onClick={() => action('Ссылка добавлена в план', () => api(`/api/external-links/${link.id}/add-to-plan`, { method: 'POST' }).then(refreshPlan))}><ListPlus size={17} /> В план</button>
                <button className="icon-btn danger" onClick={() => remove(link.id)}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PrayerRequestsPanel({ action }) {
  const [items, setItems] = useState([]);
  const [lang, setLang] = useState('both');
  const [form, setForm] = useState({
    title: 'Молитвенные нужды',
    titleEn: 'Prayer Requests',
    body: 'Будем молиться вместе:\n• \n• \n• ',
    bodyEn: 'Let us pray together:\n• \n• \n• '
  });

  async function load() {
    setItems(await api('/api/prayer-requests'));
  }

  useEffect(() => { load(); }, []);

  async function show() {
    await action('Молитвенные нужды показаны', () => api('/api/prayer-requests/show', postJson({ ...form, lang })));
    await load();
  }

  async function addToPlan() {
    await action('Молитвенные нужды добавлены в план', () => api('/api/prayer-requests/add-to-plan', postJson({ ...form, lang })));
    await load();
  }

  return (
    <section className="grid two">
      <div className="card">
        <h2>Молитвенные нужды</h2>
        <p>Выводи на экран нужды на русском, английском или сразу на двух языках.</p>
        <div className="lang-toggle">
          <span>Язык на экране:</span>
          {[['both', 'Оба'], ['ru', 'Русский'], ['en', 'English']].map(([value, label]) => (
            <button key={value} type="button" className={cx(lang === value && 'active')} onClick={() => setLang(value)}>{label}</button>
          ))}
        </div>
        <form className="form" onSubmit={e => e.preventDefault()}>
          <div className="form-row">
            <label>Заголовок RU<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>Заголовок EN<input value={form.titleEn} onChange={e => setForm({ ...form, titleEn: e.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>Нужды RU<textarea rows="9" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
            <label>Needs EN<textarea rows="9" value={form.bodyEn} onChange={e => setForm({ ...form, bodyEn: e.target.value })} /></label>
          </div>
          <div className="button-row">
            <button className="primary" onClick={show}><Megaphone size={18} /> Показать на ТВ</button>
            <button onClick={addToPlan}><ListPlus size={18} /> Добавить в план</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h2>Последние нужды</h2>
          <button onClick={load}><RotateCcw size={17} /> Обновить</button>
        </div>
        <div className="song-list">
          {!items.length && <p>Пока нет сохраненных молитвенных нужд.</p>}
          {items.map(item => (
            <article className="song-item" key={item.id}>
              <div>
                <h3>{item.title}{item.titleEn ? ` / ${item.titleEn}` : ''}</h3>
                <p>{item.body}</p>
                {item.bodyEn && <p className="muted-text">{item.bodyEn}</p>}
              </div>
              <div className="song-actions wrap-actions">
                <button className="primary" onClick={() => action('Молитвенные нужды показаны', () => api('/api/screen/state', postJson({ mode: 'announcement', payload: item })))}><Monitor size={17} /> На ТВ</button>
                <button onClick={() => action('Молитвенные нужды добавлены в план', () => api('/api/service-plan/items', postJson({ type: 'announcement', title: item.title, payload: item })))}><ListPlus size={17} /> В план</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function MissionBoardPanel({ action }) {
  async function showLink(link) {
    return api('/api/screen/state', postJson({ mode: 'external_board', payload: link }));
  }

  async function addLinkToPlan(link) {
    return api('/api/service-plan/items', postJson({ type: 'external_board', title: link.title, payload: link }));
  }

  return (
    <section className="card">
      <div className="card-title-row compact">
        <div>
          <h2>Миссионерский борд</h2>
          <p>Эти экраны открываются с сайта missionreport.top. Для показа на ТВ нужен интернет.</p>
        </div>
        <span className="badge warn">online</span>
      </div>
      <div className="mission-grid">
        {MISSION_BOARD_LINKS.map(link => {
          const Icon = link.icon;
          return (
            <article className="mission-card" key={link.id}>
              <div className="mission-card-head">
                <Icon size={28} />
                <div>
                  <h3>{link.title}</h3>
                  <p>{link.subtitle}</p>
                </div>
              </div>
              <div className="mission-url">{link.url}</div>
              <div className="button-row">
                <button className="primary" onClick={() => action(`${link.title} показан`, () => showLink(link))}><Monitor size={18} /> На ТВ</button>
                <button onClick={() => action(`${link.title} добавлен в план`, () => addLinkToPlan(link))}><ListPlus size={18} /> В план</button>
                <button onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}><ExternalLink size={18} /> Открыть</button>
              </div>
            </article>
          );
        })}
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
      {state.mode === 'translation_caption' && <TranslationCaptionScreen payload={payload} />}
      {state.mode === 'translation_live' && <TranslationLiveScreen payload={payload} />}
      {state.mode === 'announcement' && <AnnouncementScreen payload={payload} />}
      {state.mode === 'external_board' && <ExternalBoardScreen payload={payload} />}
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
  const scriptureWeight = ['low', 'medium', 'high'].includes(payload.scriptureWeight) ? payload.scriptureWeight : 'medium';
  const fontScale = Number.isFinite(Number(payload.fontScale))
    ? Math.min(2.5, Math.max(0.5, Number(payload.fontScale)))
    : 1;

  return (
    <section
      className={cx('screen-center bible-screen', `scripture-weight-${scriptureWeight}`, blocks.length > 1 && 'multi-bible')}
    >
      <div className="reference">{payload.reference || 'Место Писания'}</div>
      {blocks.length > 0 ? (
        <div className="scripture-grid" data-count={blocks.length} style={{ zoom: fontScale }}>
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

const DEFAULT_TRANSLATION_INSTRUCTIONS = 'Scan the QR code to read or listen to the live translation in your language.\nFor audio, please use headphones.';

function TranslationScreen({ payload }) {
  const instructions = payload.instructions || DEFAULT_TRANSLATION_INSTRUCTIONS;
  return (
    <section className="screen-center qr-screen">
      <h1>Live Translation</h1>
      {payload.qrDataUrl && <img src={payload.qrDataUrl} alt="QR" />}
      <div className="qr-instructions">
        {String(instructions).split('\n').map((line, i) => <p key={i}>{line}</p>)}
      </div>
    </section>
  );
}

function TranslationCaptionScreen({ payload }) {
  if (!payload.url) {
    return <MessageScreen payload={{ title: payload.title || 'Перевод', body: 'У сервиса не задана ссылка субтитров для экрана.' }} />;
  }
  return (
    <section className="translation-caption-screen">
      <iframe
        title={payload.title || 'Live translation'}
        src={payload.url}
        allow="autoplay; encrypted-media; clipboard-read; clipboard-write"
        allowFullScreen
      />
      <div className="translation-caption-badge">
        <QrCode size={20} />
        <span>Live Translation</span>
      </div>
    </section>
  );
}

function floatToBase64Pcm16(f32) {
  const int16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function useLiveSubtitles(lang) {
  const [textByLang, setTextByLang] = useState({});
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const es = new EventSource('/api/translation/live/stream');
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcript') setTextByLang(prev => ({ ...prev, [data.lang]: data.text }));
        if (data.type === 'status') setStatus(data);
      } catch {}
    };
    return () => es.close();
  }, []);
  return { text: lang ? (textByLang[lang] || '') : '', textByLang, status };
}

function TranslationLiveScreen({ payload }) {
  const lang = payload.lang || 'en';
  const { text, status } = useLiveSubtitles(lang);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  const placeholder = status?.running ? 'Ожидание речи…' : 'Перевод ещё не запущен';
  return (
    <section className="translation-live-screen">
      <div className="translation-live-lang">{getLanguageLabel(lang)}</div>
      <div className="translation-live-text" ref={ref}>{text || placeholder}</div>
    </section>
  );
}

function TranslationSourceApp() {
  const [state, setState] = useState(null);
  const [engine, setEngine] = useState('stub');
  const [displayLang, setDisplayLang] = useState('en');
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const captureRef = useRef(null);
  const { text } = useLiveSubtitles(displayLang);

  async function refresh() {
    try { setState(await api('/api/translation/live/state')); } catch {}
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);

  async function startRun() {
    await api('/api/translation/live/start', postJson({ engine, displayLang }));
    await refresh();
  }
  async function stopRun() {
    await stopCapture();
    await api('/api/translation/live/stop', { method: 'POST' });
    await refresh();
  }

  async function startCapture() {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
      const ctx = new AudioContext({ sampleRate: 24000 });
      await ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm-capture');
      const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/translate/ingest';
      const ws = new WebSocket(wsUrl);
      node.port.onmessage = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(floatToBase64Pcm16(e.data)); };
      source.connect(node);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      captureRef.current = { stream, ctx, ws, node };
      setCapturing(true);
    } catch (e) { setError(e.message || String(e)); }
  }
  async function stopCapture() {
    const c = captureRef.current;
    if (c) {
      try { c.ws.close(); } catch {}
      try { c.node.disconnect(); } catch {}
      try { c.ctx.close(); } catch {}
      try { c.stream.getTracks().forEach(t => t.stop()); } catch {}
    }
    captureRef.current = null;
    setCapturing(false);
  }
  useEffect(() => () => { stopCapture(); }, []);

  const running = state?.running;
  return (
    <div className="source-shell">
      <h1>Источник перевода</h1>
      <p className="hint">Открой эту страницу на мини-ПК. Микрофон/линия отправляется в OpenAI, перевод идёт на ТВ и телефоны по локальной сети.</p>
      <div className="source-card">
        <div className="form-row">
          <label>Движок
            <select value={engine} onChange={e => setEngine(e.target.value)} disabled={running}>
              <option value="stub">Заглушка (тест без интернета)</option>
              <option value="openai">OpenAI Realtime</option>
            </select>
          </label>
          <label>Язык для ТВ
            <select value={displayLang} onChange={e => setDisplayLang(e.target.value)}>
              {supportedLanguages.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
            </select>
          </label>
        </div>
        {engine === 'openai' && state && !state.hasApiKey && <p className="source-error">OPENAI_API_KEY не задан в .env на сервере — OpenAI-движок не запустится.</p>}
        <div className="button-row">
          {!running
            ? <button className="primary" onClick={() => startRun().catch(e => setError(e.message))}><Play size={18} /> Запустить перевод</button>
            : <button className="danger" onClick={() => stopRun().catch(e => setError(e.message))}><Square size={18} /> Остановить</button>}
          {running && !capturing && <button className="primary" onClick={startCapture}><Radio size={18} /> Включить микрофон</button>}
          {running && capturing && <button onClick={stopCapture}><Pause size={18} /> Выключить микрофон</button>}
        </div>
        {error && <p className="source-error">{error}</p>}
        <div className="source-status">
          <span className={cx('badge', running ? 'ok' : 'warn')}>{running ? `идёт · ${state.engine}` : 'остановлен'}</span>
          <span className={cx('badge', capturing ? 'ok' : 'warn')}>{capturing ? 'микрофон активен' : 'микрофон выкл'}</span>
          {(state?.languages || []).map(l => <span className="badge" key={l.lang}>{l.lang}: {l.status}</span>)}
        </div>
      </div>
      <div className="source-preview">
        <div className="source-preview-label">Предпросмотр ({getLanguageLabel(displayLang)})</div>
        <div className="source-preview-text">{text || '—'}</div>
      </div>
    </div>
  );
}

function TranslationGuestApp() {
  const [lang, setLang] = useState('');
  const [q, setQ] = useState('');
  const { text, status } = useLiveSubtitles(lang);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  useEffect(() => {
    if (!lang) return;
    api('/api/translation/live/ensure', postJson({ lang })).catch(() => {});
  }, [lang]);

  if (!lang) {
    const list = supportedLanguages.filter(l => {
      const w = q.trim().toLowerCase();
      return !w || l.name.toLowerCase().includes(w) || l.nativeName.toLowerCase().includes(w) || l.code === w;
    });
    return (
      <div className="guest-shell">
        <h1>Live Translation</h1>
        <p>Choose your language / Выберите язык</p>
        <input className="guest-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search language…" />
        <div className="guest-lang-grid">
          {list.map(l => (
            <button key={l.code} onClick={() => setLang(l.code)}>
              <span className="guest-flag">{l.flag}</span>
              <span>{l.nativeName}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="guest-shell guest-reading">
      <div className="guest-topbar">
        <span>{getLanguageLabel(lang)}</span>
        <button onClick={() => setLang('')}>Сменить язык</button>
      </div>
      <div className="guest-subtitles" ref={ref}>
        {text || (status?.running ? 'Waiting for speech…' : 'Translation is not running yet.')}
      </div>
    </div>
  );
}

function AnnouncementScreen({ payload }) {
  const hasEnglish = Boolean(payload.titleEn || payload.bodyEn);
  const lang = ['ru', 'en', 'both'].includes(payload.lang) ? payload.lang : (hasEnglish ? 'both' : 'ru');
  const showRu = lang === 'ru' || lang === 'both';
  const showEn = (lang === 'en' || lang === 'both') && hasEnglish;
  const bilingual = showRu && showEn;
  const qrSrc = payload.qrImageUrl || payload.qrDataUrl;
  const hasQr = Boolean(qrSrc);
  return (
    <section className={cx('screen-center announcement-screen', bilingual ? 'bilingual-announcement' : 'single-announcement', !hasQr && 'no-qr')}>
      <div className="announcement-copy">
        {showRu && (
          <div className="announcement-lang-block">
            <h1>{payload.title}</h1>
            <p>{payload.body}</p>
          </div>
        )}
        {showEn && (
          <div className="announcement-lang-block announcement-english">
            {bilingual ? <h2>{payload.titleEn}</h2> : <h1>{payload.titleEn}</h1>}
            <p>{payload.bodyEn}</p>
          </div>
        )}
      </div>
      {hasQr && <img src={qrSrc} alt="QR" />}
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

function ExternalBoardScreen({ payload }) {
  return (
    <section className="external-board-screen">
      <iframe
        title={payload.title || 'Mission board'}
        src={payload.url}
        allow="fullscreen; autoplay; clipboard-read; clipboard-write"
        allowFullScreen
      />
      <div className="external-board-badge">
        <Globe2 size={20} />
        <span>{payload.title || 'Mission board'}</span>
      </div>
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

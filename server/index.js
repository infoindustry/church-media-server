import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import http from 'http';
import { TranslationHub, attachTranslation, sanitizeLang, getLanUrls } from './translation.js';
import { startCloudSync } from './cloud-sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Load .env (KEY=VALUE per line) without a dependency, so OPENAI_API_KEY and
// friends are available. Existing process env always wins.
(function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    console.error('Cannot read .env:', error.message);
  }
})();
const DATA_DIR = path.join(__dirname, 'data');
const MEDIA_DIR = path.join(__dirname, 'media');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const PORT = process.env.PORT || 4000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'videos'), { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'audio'), { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'thumbs'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'vendor', 'bibles'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'vendor', 'bibles', 'raw'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'vendor', 'bibles', 'normalized'), { recursive: true });

const defaultStore = {
  settings: {
    churchName: 'Word of God Crossroads Budva',
    screenSlug: 'main',
    welcome: {
      title: 'Добро пожаловать',
      subtitle: 'Word of God Crossroads Budva',
      language: 'ru',
      serviceText: 'Служение скоро начнется',
      imageUrl: '',
      imageFit: 'cover',
      overlay: true,
      textAlign: 'center',
      showChurchName: true
    },
    bible: {
      scriptureWeight: 'medium',
      fontScale: 1
    }
  },
  songs: [],
  announcements: [],
  externalLinks: [
    {
      id: 'etsy-faithcuts',
      title: 'FaithCuts · Etsy',
      url: 'https://www.etsy.com/shop/FaithCuts',
      category: 'Магазин',
      notes: 'Демонстрация магазина',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'kotmilo-language',
      title: 'Kotmilo',
      url: 'https://kotmilo.top',
      category: 'Изучение языка',
      notes: 'Программа изучения языка',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  prayerRequests: [],
  translationLinks: [],
  translationProviders: [
    {
      id: 'captionkit',
      name: 'CaptionKit',
      audienceUrl: 'https://captionkit.io/c/word-of-god',
      screenEmbedUrl: 'https://captionkit.io/f/word-of-god/l/en-US?fontSize=10',
      languages: 'English, Srpski',
      audienceInstructions: 'Scan the QR code to read or listen to the live translation in your language.\nFor audio, please use headphones.',
      rtmpUrl: '',
      rtmpKey: ''
    },
    {
      id: 'glossa',
      name: 'Glossa',
      audienceUrl: 'https://glossa.live/services/934aae72-9b38-45f0-a85f-233d4b1af7f2',
      screenEmbedUrl: 'https://glossa.live/embed/934aae72-9b38-45f0-a85f-233d4b1af7f2?bg=000000&color=ffffff&font-size=64px&align=center',
      languages: 'English, Srpski',
      audienceInstructions: 'Scan the QR code to read or listen to the live translation in your language.\nFor audio, please use headphones.',
      rtmpUrl: 'rtmp://stream.glossa.live:1935/live',
      rtmpKey: ''
    }
  ],
  activeTranslationProviderId: 'captionkit',
  mediaImages: [],
  audioTracks: [],
  servicePlan: [],
  activePlanIndex: -1,
  screenState: {
    mode: 'welcome',
    payload: { title: 'Добро пожаловать', subtitle: 'Word of God Crossroads Budva', serviceText: 'Служение скоро начнется', language: 'ru', showChurchName: true },
    updatedAt: new Date().toISOString()
  }
};

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(defaultStore, null, 2), 'utf8');
  }
}

function normalizeStore(store) {
  const settings = store?.settings || {};
  return {
    ...defaultStore,
    ...store,
    settings: {
      ...defaultStore.settings,
      ...settings,
      welcome: { ...defaultStore.settings.welcome, ...(settings.welcome || {}) },
      bible: { ...defaultStore.settings.bible, ...(settings.bible || {}) }
    },
    songs: Array.isArray(store?.songs) ? store.songs : [],
    announcements: Array.isArray(store?.announcements) ? store.announcements : [],
    externalLinks: Array.isArray(store?.externalLinks) ? store.externalLinks : defaultStore.externalLinks,
    prayerRequests: Array.isArray(store?.prayerRequests) ? store.prayerRequests : [],
    translationLinks: Array.isArray(store?.translationLinks) ? store.translationLinks : [],
    translationProviders: Array.isArray(store?.translationProviders) ? store.translationProviders : defaultStore.translationProviders,
    activeTranslationProviderId: store?.activeTranslationProviderId ?? defaultStore.activeTranslationProviderId,
    mediaImages: Array.isArray(store?.mediaImages) ? store.mediaImages : [],
    audioTracks: Array.isArray(store?.audioTracks) ? store.audioTracks : [],
    servicePlan: Array.isArray(store?.servicePlan) ? store.servicePlan : [],
    activePlanIndex: Number.isInteger(store?.activePlanIndex) ? store.activePlanIndex : -1,
    screenState: store?.screenState || defaultStore.screenState
  };
}

function readStore() {
  ensureStore();
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
  } catch (error) {
    console.error('Cannot read store.json:', error);
    return structuredClone(defaultStore);
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeStore(store), null, 2), 'utf8');
}

function now() {
  return new Date().toISOString();
}

function normalizeScriptureWeight(value) {
  return ['low', 'medium', 'high'].includes(value) ? value : 'medium';
}

const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.5;

function normalizeFontScale(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(num * 100) / 100));
}

function getBibleSettings(store) {
  return {
    ...defaultStore.settings.bible,
    ...(store.settings?.bible || {}),
    scriptureWeight: normalizeScriptureWeight(store.settings?.bible?.scriptureWeight),
    fontScale: normalizeFontScale(store.settings?.bible?.fontScale)
  };
}

function safeFileName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const base = path.basename(originalName || 'file', ext)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return `${Date.now()}-${base || 'media'}${ext}`;
}

function localMediaExists(mediaUrl) {
  if (!mediaUrl) return false;
  const relative = mediaUrl.replace('/media/', '');
  return fs.existsSync(path.join(MEDIA_DIR, relative));
}

const THUMBS_DIR = path.join(MEDIA_DIR, 'thumbs');
const thumbInFlight = new Map();

// Extract a single representative frame from a local video into a cached JPG.
// Resolves to the thumb path, or null if there is no source file / ffmpeg fails.
function ensureVideoThumb(song) {
  const fileName = song?.fileName;
  if (!fileName) return Promise.resolve(null);
  const videoPath = path.join(MEDIA_DIR, 'videos', fileName);
  if (!fs.existsSync(videoPath)) return Promise.resolve(null);
  const thumbPath = path.join(THUMBS_DIR, `${song.id}.jpg`);
  if (fs.existsSync(thumbPath)) return Promise.resolve(thumbPath);
  if (thumbInFlight.has(song.id)) return thumbInFlight.get(song.id);

  const job = new Promise((resolve) => {
    // -ss before -i = fast input seek; grab ~1s in to skip black fade-in.
    execFile('ffmpeg', [
      '-ss', '1', '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5',
      '-y', thumbPath
    ], { timeout: 20000 }, (err) => {
      if (err && !fs.existsSync(thumbPath)) {
        // Retry from the very first frame for videos shorter than 1s.
        execFile('ffmpeg', [
          '-i', videoPath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5',
          '-y', thumbPath
        ], { timeout: 20000 }, (err2) => {
          resolve(err2 && !fs.existsSync(thumbPath) ? null : thumbPath);
        });
        return;
      }
      resolve(thumbPath);
    });
  }).finally(() => thumbInFlight.delete(song.id));

  thumbInFlight.set(song.id, job);
  return job;
}


const BIBLE_DATA_PATH = path.join(ROOT, 'vendor', 'bibles', 'normalized', 'bibles.json');
let bibleCache = null;

function loadBibleData() {
  if (bibleCache) return bibleCache;
  if (!fs.existsSync(BIBLE_DATA_PATH)) {
    bibleCache = { books: [], translations: [], verses: {} };
    return bibleCache;
  }
  try {
    bibleCache = JSON.parse(fs.readFileSync(BIBLE_DATA_PATH, 'utf8'));
    return bibleCache;
  } catch (error) {
    console.error('Cannot load normalized Bible data:', error);
    bibleCache = { books: [], translations: [], verses: {} };
    return bibleCache;
  }
}

function normalizeBibleText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,”“"'`«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBibleBook(input) {
  const data = loadBibleData();
  const raw = normalizeBibleText(input);
  if (!raw) return null;
  const books = data.books || [];
  const candidates = [];
  for (const book of books) {
    for (const alias of [book.ru, book.en, book.slug, ...(book.aliases || [])]) {
      if (!alias) continue;
      candidates.push({ alias, normalized: normalizeBibleText(alias), book });
    }
  }
  candidates.sort((a, b) => b.normalized.length - a.normalized.length);
  return candidates.find(c => raw === c.normalized || raw.startsWith(c.normalized + ' ')) || null;
}


function getBibleBookStats() {
  const data = loadBibleData();
  const firstTranslation = (data.translations || [])[0]?.id || 'ru_synodal';
  const verses = data.verses?.[firstTranslation] || {};
  return (data.books || []).map((book, index) => {
    const chapterMap = new Map();
    for (const key of Object.keys(verses)) {
      const [slug, chapterRaw, verseRaw] = key.split('.');
      if (slug !== book.slug) continue;
      const chapter = Number(chapterRaw);
      const verse = Number(verseRaw);
      if (!chapterMap.has(chapter)) chapterMap.set(chapter, 0);
      chapterMap.set(chapter, Math.max(chapterMap.get(chapter), verse));
    }
    const chapters = [...chapterMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([chapter, versesCount]) => ({ chapter, versesCount }));
    return { ...book, order: index + 1, chapters, chaptersCount: chapters.length };
  });
}

function parseBibleReference(reference) {
  const cleaned = String(reference || '')
    .replace(/[–—]/g, '-')
    .replace(/,/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(/^(.+?)\s+(\d+)\s*[:.]\s*(\d+)(?:\s*-\s*(\d+))?$/i);
  if (!match) return null;
  const [, bookPart, chapterRaw, verseStartRaw, verseEndRaw] = match;
  const found = findBibleBook(bookPart);
  if (!found) return null;
  const chapter = Number(chapterRaw);
  const verseStart = Number(verseStartRaw);
  const verseEnd = Number(verseEndRaw || verseStartRaw);
  if (!chapter || !verseStart || !verseEnd || verseEnd < verseStart) return null;
  return {
    book: found.book,
    chapter,
    verseStart,
    verseEnd,
    normalizedReference: `${found.book.ru} ${chapter}:${verseStart}${verseEnd !== verseStart ? '-' + verseEnd : ''}`
  };
}

function lookupBible(reference, translationIds) {
  const data = loadBibleData();
  const parsed = parseBibleReference(reference);
  if (!parsed) {
    return { ok: false, error: 'Не удалось распознать ссылку. Пример: Ин 3:16, Иоанна 7:37-38, John 3:16.' };
  }
  const available = data.translations || [];
  const selectedIds = Array.isArray(translationIds) && translationIds.length
    ? translationIds
    : ['ru_synodal'];
  const blocks = selectedIds.map(id => {
    const translation = available.find(t => t.id === id);
    if (!translation) {
      return { translationId: id, missing: true, text: '', reference: parsed.normalizedReference };
    }
    const lines = [];
    for (let verse = parsed.verseStart; verse <= parsed.verseEnd; verse += 1) {
      const key = `${parsed.book.slug}.${parsed.chapter}.${verse}`;
      const text = data.verses?.[id]?.[key];
      if (text) lines.push(`${verse}. ${text}`);
    }
    return {
      translationId: id,
      language: translation.language,
      name: translation.name,
      shortName: translation.shortName || translation.name,
      reference: parsed.normalizedReference,
      text: lines.join('\n'),
      missing: lines.length === 0
    };
  });
  return { ok: true, reference: parsed.normalizedReference, parsed, translations: available, blocks };
}

function getYouTubeEmbedUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    let id = '';
    if (parsed.hostname.includes('youtu.be')) id = parsed.pathname.replace('/', '');
    else if (parsed.searchParams.get('v')) id = parsed.searchParams.get('v');
    else if (parsed.pathname.includes('/embed/')) id = parsed.pathname.split('/embed/')[1]?.split('/')[0] || '';
    else if (parsed.pathname.includes('/shorts/')) id = parsed.pathname.split('/shorts/')[1]?.split('/')[0] || '';
    if (!id) return url;
    return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&autoplay=1&playsinline=1&enablejsapi=1`;
  } catch {
    return url;
  }
}

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(MEDIA_DIR, 'videos')),
  filename: (req, file, cb) => cb(null, safeFileName(file.originalname))
});

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(MEDIA_DIR, 'images')),
  filename: (req, file, cb) => cb(null, safeFileName(file.originalname))
});

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(MEDIA_DIR, 'audio')),
  filename: (req, file, cb) => cb(null, safeFileName(file.originalname))
});

function audioFileFilter(req, file, cb) {
  const ok = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg',
    'audio/webm', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/flac'
  ].includes(file.mimetype) || /\.(mp3|wav|ogg|webm|m4a|aac|flac)$/i.test(file.originalname || '');
  cb(ok ? null : new Error('Only audio files are allowed'), ok);
}

function imageFileFilter(req, file, cb) {
  const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.mimetype);
  cb(ok ? null : new Error('Only image files are allowed'), ok);
}

const upload = multer({ storage: videoStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
const uploadImage = multer({ storage: imageStorage, fileFilter: imageFileFilter, limits: { fileSize: 50 * 1024 * 1024 } });
const uploadAudio = multer({ storage: audioStorage, fileFilter: audioFileFilter, limits: { fileSize: 1024 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/media', express.static(MEDIA_DIR));

const clients = new Set();

function sendSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(data) {
  for (const res of clients) {
    try { sendSse(res, data); } catch {}
  }
}

function updateScreenState(mode, payload, updatedBy = 'admin') {
  const store = readStore();
  store.screenState = { mode, payload, updatedBy, updatedAt: now() };
  writeStore(store);
  broadcast({ type: 'state', state: store.screenState });
  return store.screenState;
}

function makePlanItem(input) {
  return {
    id: nanoid(10),
    type: input.type || 'message',
    title: input.title || 'Без названия',
    payload: input.payload || {},
    createdAt: now()
  };
}

function stateFromPlanItem(item, store) {
  if (!item) return null;
  const payload = item.payload || {};

  if (item.type === 'song') {
    const song = store.songs.find(s => s.id === payload.songId) || payload.song;
    if (!song) return { mode: 'message', payload: { title: item.title, body: 'Песня не найдена в каталоге.' } };
    if (song.mediaUrl) {
      return {
        mode: 'song_video',
        payload: {
          songId: song.id,
          title: song.title,
          language: song.language,
          category: song.category,
          mediaUrl: song.mediaUrl,
          isOfflineReady: Boolean(song.isOfflineReady),
          fromPlanItemId: item.id
        }
      };
    }
    if (song.youtubeUrl) {
      return {
        mode: song.youtubeAudioOnly ? 'youtube_audio' : 'youtube',
        payload: { title: song.title, youtubeUrl: song.youtubeUrl, embedUrl: getYouTubeEmbedUrl(song.youtubeUrl), audioOnly: Boolean(song.youtubeAudioOnly), message: 'Онлайн YouTube-режим: возможна реклама, нужен интернет, автозапуск зависит от настроек браузера.' }
      };
    }
    return { mode: 'message', payload: { title: song.title, body: 'У этой песни пока нет локального видеофайла.' } };
  }

  if (item.type === 'audio') {
    const track = store.audioTracks.find(a => a.id === payload.audioId) || payload.track;
    if (!track) return { mode: 'message', payload: { title: item.title, body: 'Фонограмма не найдена в каталоге.' } };
    return {
      mode: 'audio_track',
      payload: { audioId: track.id, title: track.title, language: track.language, category: track.category, mediaUrl: track.mediaUrl, isOfflineReady: Boolean(track.isOfflineReady), fromPlanItemId: item.id }
    };
  }

  if (item.type === 'bible') return { mode: 'bible', payload: { ...payload, fromPlanItemId: item.id } };
  if (item.type === 'translation_qr') return { mode: 'translation_qr', payload: { ...payload, fromPlanItemId: item.id } };
  if (item.type === 'translation_caption') return { mode: 'translation_caption', payload: { ...payload, fromPlanItemId: item.id } };
  if (item.type === 'announcement') return { mode: 'announcement', payload: { ...payload, fromPlanItemId: item.id } };
  if (item.type === 'external_board') return { mode: 'external_board', payload: { ...payload, fromPlanItemId: item.id } };
  if (item.type === 'image') return { mode: 'image', payload: { ...payload, fromPlanItemId: item.id } };
  if (item.type === 'slideshow') return { mode: 'slideshow', payload: { ...payload, fromPlanItemId: item.id } };
  if (item.type === 'welcome') return { mode: 'welcome', payload: { ...(store.settings?.welcome || {}), ...payload, fromPlanItemId: item.id } };
  if (item.type === 'blank') return { mode: 'blank', payload: payload || { title: '', subtitle: '' } };
  return { mode: 'message', payload: { title: item.title, body: payload.body || '' } };
}

function showPlanIndex(index) {
  const store = readStore();
  if (!store.servicePlan.length) return { error: 'Service plan is empty', status: 400 };
  const safeIndex = Math.max(0, Math.min(index, store.servicePlan.length - 1));
  const item = store.servicePlan[safeIndex];
  const nextState = stateFromPlanItem(item, store);
  if (!nextState) return { error: 'Cannot resolve service plan item', status: 400 };
  store.activePlanIndex = safeIndex;
  store.screenState = { ...nextState, updatedBy: 'service-plan', updatedAt: now() };
  writeStore(store);
  broadcast({ type: 'state', state: store.screenState });
  return { item, index: safeIndex, state: store.screenState, servicePlan: store.servicePlan };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: now(), port: PORT });
});

app.get('/api/store', (req, res) => {
  res.json(readStore());
});

app.get('/api/screen/state', (req, res) => {
  res.json(readStore().screenState);
});

app.post('/api/screen/state', (req, res) => {
  const { mode, payload } = req.body;
  if (!mode) return res.status(400).json({ error: 'mode is required' });
  res.json(updateScreenState(mode, payload || {}));
});

app.get('/api/screen/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  clients.add(res);
  sendSse(res, { type: 'state', state: readStore().screenState });
  const ping = setInterval(() => sendSse(res, { type: 'ping', time: now() }), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.post('/api/screen/command', (req, res) => {
  const { command, payload } = req.body;
  if (!command) return res.status(400).json({ error: 'command is required' });
  const event = { type: 'command', command, payload: payload || {}, at: now() };
  broadcast(event);
  res.json({ ok: true, event });
});

app.post('/api/blank', (req, res) => {
  const state = updateScreenState('blank', req.body?.payload || { title: 'Добро пожаловать', subtitle: '' });
  res.json(state);
});


app.get('/api/settings', (req, res) => {
  res.json(readStore().settings || {});
});

app.put('/api/settings/welcome', (req, res) => {
  const store = readStore();
  const current = store.settings?.welcome || defaultStore.settings.welcome;
  store.settings = {
    ...(store.settings || {}),
    churchName: req.body?.churchName ?? store.settings?.churchName ?? defaultStore.settings.churchName,
    welcome: {
      ...current,
      title: req.body?.title ?? current.title,
      subtitle: req.body?.subtitle ?? current.subtitle,
      language: req.body?.language ?? current.language,
      serviceText: req.body?.serviceText ?? current.serviceText,
      imageUrl: req.body?.imageUrl ?? current.imageUrl,
      imageFit: req.body?.imageFit ?? current.imageFit,
      overlay: typeof req.body?.overlay === 'boolean' ? req.body.overlay : current.overlay,
      textAlign: req.body?.textAlign ?? current.textAlign,
      showChurchName: typeof req.body?.showChurchName === 'boolean' ? req.body.showChurchName : current.showChurchName
    }
  };
  writeStore(store);
  res.json(store.settings);
});

app.put('/api/settings/bible', (req, res) => {
  const store = readStore();
  const current = getBibleSettings(store);
  store.settings = {
    ...(store.settings || {}),
    bible: {
      ...current,
      scriptureWeight: normalizeScriptureWeight(req.body?.scriptureWeight ?? current.scriptureWeight),
      fontScale: normalizeFontScale(req.body?.fontScale ?? current.fontScale)
    }
  };
  writeStore(store);
  res.json(store.settings.bible);
});

app.post('/api/welcome/show', (req, res) => {
  const store = readStore();
  const payload = { ...(store.settings?.welcome || defaultStore.settings.welcome), ...(req.body?.payload || {}) };
  res.json(updateScreenState('welcome', payload));
});

app.post('/api/welcome/add-to-plan', (req, res) => {
  const store = readStore();
  const payload = { ...(store.settings?.welcome || defaultStore.settings.welcome), ...(req.body?.payload || {}) };
  const item = makePlanItem({ type: 'welcome', title: payload.title || 'Приветственный экран', payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.get('/api/bibles/sources', (req, res) => {
  const data = loadBibleData();
  res.json({
    status: data.translations?.length ? 'ready' : 'sources-prepared',
    translations: data.translations || [],
    booksCount: data.books?.length || 0,
    sources: [
      { id: 'ru_synodal', language: 'ru', name: 'Russian Synodal Translation / Синодальный перевод', repository: 'https://github.com/bibleonline/rst', recommendedPath: 'parsed66', licenseNote: 'Public Domain по README репозитория' },
      { id: 'en_kjv', language: 'en', name: 'King James Version', repository: 'https://github.com/farskipper/kjv', recommendedPath: 'json/verses-1769.json', licenseNote: 'Public Domain / Unlicense по README репозитория' },
      { id: 'sr_latn', language: 'sr', name: 'Serbian / Srpski / Crnogorski', repository: 'https://bible.helloao.org/', recommendedPath: 'node scripts/import-serbian-helloao.mjs', licenseNote: 'Free Use Bible API: JSON API, no API key, no usage limits; site states no copyright restrictions. Script imports and normalizes Serbian into sr_latn.' },
      { id: 'sr_biblica_step', language: 'sr', name: 'Biblica Open New Serbian Translation Latin', repository: 'https://www.stepbible.org/version.jsp?version=SrpNSPl', recommendedPath: 'SWORD module / STEP Bible', licenseNote: 'CC BY-SA/Biblica notice required; do not bundle without preserving copyright notice.' },
      { id: 'sr_wordproject', language: 'sr', name: 'WordProject Serbian Holy Bible', repository: 'https://www.wordproject.org/download/bibles/', recommendedPath: 'Serbian Holy Bible download', licenseNote: 'Offline ZIP source; check copyright/distribution terms before bundling publicly.' }
    ]
  });
});

app.get('/api/bible/translations', (req, res) => {
  const data = loadBibleData();
  res.json(data.translations || []);
});

app.get('/api/bible/books', (req, res) => {
  res.json(getBibleBookStats());
});

app.get('/api/bible/lookup', (req, res) => {
  const reference = String(req.query.reference || '');
  const translations = String(req.query.translations || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const result = lookupBible(reference, translations);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/bible/show-reference', (req, res) => {
  const store = readStore();
  const result = lookupBible(req.body?.reference, req.body?.translations);
  if (!result.ok) return res.status(400).json(result);
  const blocks = result.blocks.filter(block => block.text);
  if (!blocks.length) return res.status(404).json({ error: 'Текст для выбранных переводов не найден.', result });
  const bibleSettings = getBibleSettings(store);
  const state = updateScreenState('bible', {
    reference: result.reference,
    blocks,
    text: blocks.map(block => `${block.shortName || block.name}:\n${block.text}`).join('\n\n'),
    language: blocks[0]?.language || '',
    translation: blocks[0]?.shortName || blocks[0]?.name || '',
    primaryTranslation: blocks[0]?.translationId || '',
    selectedTranslations: blocks.map(b => b.translationId),
    scriptureWeight: normalizeScriptureWeight(req.body?.scriptureWeight ?? bibleSettings.scriptureWeight),
    fontScale: normalizeFontScale(req.body?.fontScale ?? bibleSettings.fontScale)
  });
  res.json(state);
});

app.post('/api/bible/add-reference-to-plan', (req, res) => {
  const result = lookupBible(req.body?.reference, req.body?.translations);
  if (!result.ok) return res.status(400).json(result);
  const blocks = result.blocks.filter(block => block.text);
  if (!blocks.length) return res.status(404).json({ error: 'Текст для выбранных переводов не найден.', result });
  const store = readStore();
  const bibleSettings = getBibleSettings(store);
  const payload = {
    reference: result.reference,
    blocks,
    text: blocks.map(block => `${block.shortName || block.name}:\n${block.text}`).join('\n\n'),
    language: blocks[0]?.language || '',
    translation: blocks[0]?.shortName || blocks[0]?.name || '',
    primaryTranslation: blocks[0]?.translationId || '',
    selectedTranslations: blocks.map(b => b.translationId),
    scriptureWeight: normalizeScriptureWeight(req.body?.scriptureWeight ?? bibleSettings.scriptureWeight),
    fontScale: normalizeFontScale(req.body?.fontScale ?? bibleSettings.fontScale)
  };
  const item = makePlanItem({ type: 'bible', title: result.reference, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.get('/api/songs', (req, res) => {
  const store = readStore();
  const q = String(req.query.q || '').trim().toLowerCase();
  const language = String(req.query.language || '').trim().toLowerCase();
  let songs = store.songs || [];
  if (q) {
    songs = songs.filter(song => [song.title, song.category, song.language, ...(song.tags || [])].join(' ').toLowerCase().includes(q));
  }
  if (language) songs = songs.filter(song => String(song.language || '').toLowerCase() === language);
  res.json(songs.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru')));
});

// Lazy thumbnail for a local-video song: a cached first frame of the file.
app.get('/api/songs/:id/thumbnail', async (req, res) => {
  const store = readStore();
  const song = (store.songs || []).find(s => s.id === req.params.id);
  if (!song) return res.status(404).end();
  try {
    const thumbPath = await ensureVideoThumb(song);
    if (!thumbPath) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbPath);
  } catch {
    res.status(500).end();
  }
});

app.post('/api/songs', upload.single('video'), (req, res) => {
  const store = readStore();
  const file = req.file;
  const tags = String(req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const createdAt = now();
  const song = {
    id: nanoid(10),
    title: req.body.title || file?.originalname || 'Без названия',
    language: req.body.language || 'ru',
    category: req.body.category || 'Без категории',
    tags,
    sourceType: file ? 'local_video' : (req.body.youtubeUrl ? 'youtube' : 'slides'),
    mediaUrl: file ? `/media/videos/${file.filename}` : '',
    fileName: file?.filename || '',
    originalFileName: file?.originalname || '',
    youtubeUrl: req.body.youtubeUrl || '',
    isOfflineReady: Boolean(file),
    createdAt,
    updatedAt: createdAt
  };
  store.songs = [song, ...(store.songs || [])];
  writeStore(store);
  res.status(201).json(song);
});

app.put('/api/songs/:id', (req, res) => {
  const store = readStore();
  const index = store.songs.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Song not found' });
  store.songs[index] = { ...store.songs[index], ...req.body, updatedAt: now() };
  writeStore(store);
  res.json(store.songs[index]);
});

app.delete('/api/songs/:id', (req, res) => {
  const store = readStore();
  const song = store.songs.find(s => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  store.songs = store.songs.filter(s => s.id !== req.params.id);
  store.servicePlan = store.servicePlan.filter(item => !(item.type === 'song' && item.payload?.songId === song.id));
  writeStore(store);
  fs.promises.rm(path.join(THUMBS_DIR, `${song.id}.jpg`), { force: true }).catch(() => {});
  res.json({ ok: true });
});

app.post('/api/songs/:id/show', (req, res) => {
  const store = readStore();
  const song = store.songs.find(s => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  if (song.mediaUrl) {
    return res.json(updateScreenState('song_video', {
      songId: song.id,
      title: song.title,
      language: song.language,
      category: song.category,
      mediaUrl: song.mediaUrl,
      isOfflineReady: song.isOfflineReady
    }));
  }
  if (song.youtubeUrl) {
    return res.json(updateScreenState(song.youtubeAudioOnly ? 'youtube_audio' : 'youtube', {
      title: song.title,
      youtubeUrl: song.youtubeUrl,
      embedUrl: getYouTubeEmbedUrl(song.youtubeUrl),
      audioOnly: Boolean(song.youtubeAudioOnly),
      message: 'Онлайн YouTube-режим: возможна реклама, нужен интернет, автозапуск зависит от настроек браузера.'
    }));
  }
  res.json(updateScreenState('message', { title: song.title, body: 'У этой песни пока нет локального видеофайла.' }));
});

app.post('/api/songs/:id/add-to-plan', (req, res) => {
  const store = readStore();
  const song = store.songs.find(s => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  const item = makePlanItem({ type: 'song', title: song.title, payload: { songId: song.id } });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.post('/api/songs/quick-youtube', (req, res) => {
  const store = readStore();
  const { title, youtubeUrl, language, category, tags, addToPlan, showNow, audioOnly } = req.body || {};
  if (!youtubeUrl) return res.status(400).json({ error: 'youtubeUrl is required' });
  const createdAt = now();
  const song = {
    id: nanoid(10),
    title: title || 'Гостевая YouTube-песня',
    language: language || 'guest',
    category: category || 'Гости / YouTube',
    tags: Array.isArray(tags) ? tags : String(tags || 'guest,youtube').split(',').map(t => t.trim()).filter(Boolean),
    sourceType: audioOnly ? 'youtube_audio' : 'youtube',
    youtubeAudioOnly: Boolean(audioOnly),
    mediaUrl: '',
    fileName: '',
    originalFileName: '',
    youtubeUrl,
    isOfflineReady: false,
    createdAt,
    updatedAt: createdAt
  };
  store.songs = [song, ...(store.songs || [])];
  let item = null;
  if (addToPlan) {
    item = makePlanItem({ type: 'song', title: song.title, payload: { songId: song.id } });
    store.servicePlan.push(item);
  }
  writeStore(store);
  if (showNow) {
    updateScreenState(song.youtubeAudioOnly ? 'youtube_audio' : 'youtube', {
      title: song.title,
      youtubeUrl: song.youtubeUrl,
      embedUrl: getYouTubeEmbedUrl(song.youtubeUrl),
      audioOnly: Boolean(song.youtubeAudioOnly),
      message: 'Онлайн YouTube-режим: возможна реклама, нужен интернет, автозапуск зависит от настроек браузера.'
    });
  }
  res.status(201).json({ song, item, servicePlan: readStore().servicePlan });
});

app.post('/api/service-plan/add-songs-bulk', (req, res) => {
  const store = readStore();
  const songIds = Array.isArray(req.body?.songIds) ? req.body.songIds : [];
  if (req.body?.clearBefore) {
    store.servicePlan = [];
    store.activePlanIndex = -1;
  }
  const added = [];
  for (const songId of songIds) {
    const song = store.songs.find(s => s.id === songId);
    if (!song) continue;
    const item = makePlanItem({ type: 'song', title: song.title, payload: { songId: song.id } });
    store.servicePlan.push(item);
    added.push(item);
  }
  writeStore(store);
  res.status(201).json({ added, servicePlan: store.servicePlan, activePlanIndex: store.activePlanIndex });
});


app.get('/api/audio-tracks', (req, res) => {
  const store = readStore();
  const q = String(req.query.q || '').trim().toLowerCase();
  let tracks = store.audioTracks || [];
  if (q) tracks = tracks.filter(track => [track.title, track.category, track.language, ...(track.tags || [])].join(' ').toLowerCase().includes(q));
  res.json(tracks.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru')));
});

app.post('/api/audio-tracks', uploadAudio.single('audio'), (req, res) => {
  const store = readStore();
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'audio file is required' });
  const tags = String(req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const createdAt = now();
  const track = {
    id: nanoid(10),
    title: req.body.title || file.originalname || 'Фонограмма',
    language: req.body.language || 'ru',
    category: req.body.category || 'Фонограммы',
    tags,
    mediaUrl: `/media/audio/${file.filename}`,
    fileName: file.filename,
    originalFileName: file.originalname,
    mimeType: file.mimetype,
    isOfflineReady: true,
    createdAt,
    updatedAt: createdAt
  };
  store.audioTracks = [track, ...(store.audioTracks || [])];
  writeStore(store);
  res.status(201).json(track);
});

app.delete('/api/audio-tracks/:id', (req, res) => {
  const store = readStore();
  const track = store.audioTracks.find(a => a.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Audio track not found' });
  store.audioTracks = store.audioTracks.filter(a => a.id !== track.id);
  store.servicePlan = store.servicePlan.filter(item => !(item.type === 'audio' && item.payload?.audioId === track.id));
  writeStore(store);
  res.json({ ok: true });
});

app.post('/api/audio-tracks/:id/show', (req, res) => {
  const store = readStore();
  const track = store.audioTracks.find(a => a.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Audio track not found' });
  res.json(updateScreenState('audio_track', {
    audioId: track.id,
    title: track.title,
    language: track.language,
    category: track.category,
    mediaUrl: track.mediaUrl,
    isOfflineReady: true
  }));
});

app.post('/api/audio-tracks/:id/add-to-plan', (req, res) => {
  const store = readStore();
  const track = store.audioTracks.find(a => a.id === req.params.id);
  if (!track) return res.status(404).json({ error: 'Audio track not found' });
  const item = makePlanItem({ type: 'audio', title: track.title, payload: { audioId: track.id } });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.post('/api/bible/show', (req, res) => {
  const store = readStore();
  const bibleSettings = getBibleSettings(store);
  const { reference, text, language, translation, secondaryText, secondaryLanguage } = req.body;
  if (!reference && !text) return res.status(400).json({ error: 'reference or text is required' });
  const state = updateScreenState('bible', {
    reference: reference || 'Место Писания',
    text: text || '',
    language: language || 'ru',
    translation: translation || '',
    secondaryText: secondaryText || '',
    secondaryLanguage: secondaryLanguage || '',
    blocks: Array.isArray(req.body?.blocks) ? req.body.blocks : undefined,
    scriptureWeight: normalizeScriptureWeight(req.body?.scriptureWeight ?? bibleSettings.scriptureWeight),
    fontScale: normalizeFontScale(req.body?.fontScale ?? bibleSettings.fontScale)
  });
  res.json(state);
});

app.post('/api/bible/font-scale', (req, res) => {
  const store = readStore();
  const fontScale = normalizeFontScale(req.body?.fontScale);
  // Persist as the new default so future shows reuse it.
  store.settings = {
    ...(store.settings || {}),
    bible: { ...getBibleSettings(store), fontScale }
  };
  // If Scripture is on screen right now, patch it live without re-sending the text.
  const state = store.screenState;
  const isLive = state && state.mode === 'bible';
  if (isLive) {
    store.screenState = {
      ...state,
      payload: { ...(state.payload || {}), fontScale },
      updatedAt: now()
    };
  }
  writeStore(store);
  if (isLive) broadcast({ type: 'state', state: store.screenState });
  res.json({ fontScale, live: isLive });
});

app.post('/api/bible/add-to-plan', (req, res) => {
  const store = readStore();
  const bibleSettings = getBibleSettings(store);
  const payload = {
    reference: req.body.reference || 'Место Писания',
    text: req.body.text || '',
    language: req.body.language || 'ru',
    translation: req.body.translation || '',
    secondaryText: req.body.secondaryText || '',
    secondaryLanguage: req.body.secondaryLanguage || '',
    blocks: Array.isArray(req.body?.blocks) ? req.body.blocks : undefined,
    scriptureWeight: normalizeScriptureWeight(req.body?.scriptureWeight ?? bibleSettings.scriptureWeight),
    fontScale: normalizeFontScale(req.body?.fontScale ?? bibleSettings.fontScale)
  };
  const item = makePlanItem({ type: 'bible', title: payload.reference, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.post('/api/translation/show', async (req, res) => {
  const { title, url, languages, instructions } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 720 });
  const store = readStore();
  const link = { id: nanoid(10), title: title || 'Live translation', url, languages: languages || '', instructions: instructions || '', qrDataUrl, createdAt: now() };
  store.translationLinks = [link, ...(store.translationLinks || []).slice(0, 19)];
  writeStore(store);
  const state = updateScreenState('translation_qr', link);
  res.json(state);
});

app.post('/api/translation/add-to-plan', async (req, res) => {
  const { title, url, languages, instructions } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 720 });
  const store = readStore();
  const payload = { title: title || 'Live translation', url, languages: languages || '', instructions: instructions || '', qrDataUrl };
  const item = makePlanItem({ type: 'translation_qr', title: payload.title, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

function findTranslationProvider(store, id) {
  return (store.translationProviders || []).find(p => p.id === id);
}

async function buildTranslationQrPayload(provider) {
  const url = provider.audienceUrl || '';
  const qrDataUrl = url ? await QRCode.toDataURL(url, { margin: 1, width: 720 }) : '';
  return {
    providerId: provider.id,
    title: provider.name || 'Live translation',
    url,
    languages: provider.languages || '',
    instructions: provider.audienceInstructions || 'Scan the QR code and choose your language.',
    qrDataUrl
  };
}

function buildTranslationCaptionPayload(provider) {
  return {
    providerId: provider.id,
    title: provider.name || 'Live translation',
    url: provider.screenEmbedUrl || '',
    languages: provider.languages || '',
    captionFontSize: getCaptionFontSize(provider.screenEmbedUrl),
    captionLanguage: getCaptionLanguage(provider.screenEmbedUrl)
  };
}

function getCaptionFontSize(url) {
  if (!url) return 10;
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get('fontSize') || parsed.searchParams.get('font-size') || '';
    const match = String(raw).match(/\d+(?:\.\d+)?/);
    const value = match ? Number(match[0]) : 10;
    return normalizeCaptionFontSize(value);
  } catch {
    return 10;
  }
}

function normalizeCaptionFontSize(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 10;
  return Math.min(120, Math.max(6, Math.round(num)));
}

function setCaptionFontSize(url, value) {
  const size = normalizeCaptionFontSize(value);
  if (!url) return { url, size };
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('font-size')) {
      parsed.searchParams.set('font-size', `${size}px`);
    } else {
      parsed.searchParams.set('fontSize', String(size));
    }
    return { url: parsed.toString(), size };
  } catch {
    return { url, size };
  }
}

function normalizeCaptionLanguage(value) {
  const lang = String(value || '').trim();
  return /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(lang) ? lang : 'en-US';
}

function getCaptionLanguage(url) {
  if (!url) return 'en-US';
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const index = parts.indexOf('l');
    return normalizeCaptionLanguage(index !== -1 ? parts[index + 1] : 'en-US');
  } catch {
    return 'en-US';
  }
}

function setCaptionLanguage(url, value) {
  const language = normalizeCaptionLanguage(value);
  if (!url) return { url, language };
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const index = parts.indexOf('l');
    if (index === -1) {
      parts.push('l', language);
    } else {
      parts[index + 1] = language;
    }
    parsed.pathname = `/${parts.map(encodeURIComponent).join('/')}`;
    return { url: parsed.toString(), language };
  } catch {
    return { url, language };
  }
}

app.get('/api/translation/providers', (req, res) => {
  const store = readStore();
  res.json({ providers: store.translationProviders || [], activeId: store.activeTranslationProviderId || '' });
});

app.post('/api/translation/providers', (req, res) => {
  const store = readStore();
  const provider = {
    id: nanoid(8),
    name: req.body?.name || 'Сервис перевода',
    audienceUrl: req.body?.audienceUrl || '',
    screenEmbedUrl: req.body?.screenEmbedUrl || '',
    languages: req.body?.languages || '',
    audienceInstructions: req.body?.audienceInstructions || 'Scan the QR code to read or listen to the live translation in your language.\nFor audio, please use headphones.',
    rtmpUrl: req.body?.rtmpUrl || '',
    rtmpKey: req.body?.rtmpKey || ''
  };
  store.translationProviders = [...(store.translationProviders || []), provider];
  if (!store.activeTranslationProviderId) store.activeTranslationProviderId = provider.id;
  writeStore(store);
  res.status(201).json(provider);
});

app.put('/api/translation/providers/:id', (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  for (const field of ['name', 'audienceUrl', 'screenEmbedUrl', 'languages', 'audienceInstructions', 'rtmpUrl', 'rtmpKey']) {
    if (req.body?.[field] !== undefined) provider[field] = req.body[field];
  }
  writeStore(store);
  res.json(provider);
});

app.post('/api/translation/providers/:id/caption-font-size', (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  if (!provider.screenEmbedUrl) return res.status(400).json({ error: 'У сервиса не задана ссылка субтитров для экрана' });
  const { url, size } = setCaptionFontSize(provider.screenEmbedUrl, req.body?.fontSize);
  provider.screenEmbedUrl = url;
  provider.updatedAt = now();

  const isLiveCaption = store.screenState?.mode === 'translation_caption'
    && store.screenState?.payload?.providerId === provider.id;
  if (isLiveCaption) {
    store.screenState = {
      mode: 'translation_caption',
      payload: buildTranslationCaptionPayload(provider),
      updatedBy: 'admin',
      updatedAt: now()
    };
  }

  writeStore(store);
  if (isLiveCaption) broadcast({ type: 'state', state: store.screenState });
  res.json({ provider, fontSize: size, screenState: isLiveCaption ? store.screenState : null });
});

app.post('/api/translation/providers/:id/caption-language', (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  if (!provider.screenEmbedUrl) return res.status(400).json({ error: 'У сервиса не задана ссылка субтитров для экрана' });
  const { url, language } = setCaptionLanguage(provider.screenEmbedUrl, req.body?.language);
  provider.screenEmbedUrl = url;
  provider.updatedAt = now();

  const isLiveCaption = store.screenState?.mode === 'translation_caption'
    && store.screenState?.payload?.providerId === provider.id;
  if (isLiveCaption) {
    store.screenState = {
      mode: 'translation_caption',
      payload: buildTranslationCaptionPayload(provider),
      updatedBy: 'admin',
      updatedAt: now()
    };
  }

  writeStore(store);
  if (isLiveCaption) broadcast({ type: 'state', state: store.screenState });
  res.json({ provider, language, screenState: isLiveCaption ? store.screenState : null });
});

app.delete('/api/translation/providers/:id', (req, res) => {
  const store = readStore();
  store.translationProviders = (store.translationProviders || []).filter(p => p.id !== req.params.id);
  if (store.activeTranslationProviderId === req.params.id) {
    store.activeTranslationProviderId = store.translationProviders[0]?.id || '';
  }
  writeStore(store);
  res.json({ ok: true, providers: store.translationProviders, activeId: store.activeTranslationProviderId });
});

app.post('/api/translation/providers/:id/activate', (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  store.activeTranslationProviderId = provider.id;
  writeStore(store);
  res.json({ activeId: provider.id });
});

app.post('/api/translation/providers/:id/show-qr', async (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  if (!provider.audienceUrl) return res.status(400).json({ error: 'У сервиса не задана ссылка для телефонов' });
  res.json(updateScreenState('translation_qr', await buildTranslationQrPayload(provider)));
});

app.post('/api/translation/providers/:id/show-caption', (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  if (!provider.screenEmbedUrl) return res.status(400).json({ error: 'У сервиса не задана ссылка субтитров для экрана' });
  res.json(updateScreenState('translation_caption', buildTranslationCaptionPayload(provider)));
});

app.post('/api/translation/providers/:id/add-qr-to-plan', async (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  const payload = await buildTranslationQrPayload(provider);
  const item = makePlanItem({ type: 'translation_qr', title: `QR перевода · ${provider.name}`, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.post('/api/translation/providers/:id/add-caption-to-plan', (req, res) => {
  const store = readStore();
  const provider = findTranslationProvider(store, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Сервис не найден' });
  const payload = buildTranslationCaptionPayload(provider);
  const item = makePlanItem({ type: 'translation_caption', title: `Субтитры · ${provider.name}`, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.post('/api/announcement/show', async (req, res) => {
  const { title, titleEn, body, bodyEn, qrUrl, qrImageUrl } = req.body;
  let qrDataUrl = '';
  if (qrUrl) qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 640 });
  const payload = {
    title: title || 'Объявление',
    titleEn: titleEn || '',
    body: body || '',
    bodyEn: bodyEn || '',
    lang: ['ru', 'en', 'both'].includes(req.body?.lang) ? req.body.lang : 'both',
    qrUrl: qrUrl || '',
    qrImageUrl: qrImageUrl || '',
    qrDataUrl
  };
  const store = readStore();
  store.announcements = [{ id: nanoid(10), ...payload, createdAt: now() }, ...(store.announcements || []).slice(0, 49)];
  writeStore(store);
  res.json(updateScreenState('announcement', payload));
});

app.post('/api/announcement/add-to-plan', async (req, res) => {
  const { title, titleEn, body, bodyEn, qrUrl, qrImageUrl } = req.body;
  let qrDataUrl = '';
  if (qrUrl) qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 640 });
  const payload = {
    title: title || 'Объявление',
    titleEn: titleEn || '',
    body: body || '',
    bodyEn: bodyEn || '',
    lang: ['ru', 'en', 'both'].includes(req.body?.lang) ? req.body.lang : 'both',
    qrUrl: qrUrl || '',
    qrImageUrl: qrImageUrl || '',
    qrDataUrl
  };
  const store = readStore();
  const item = makePlanItem({ type: 'announcement', title: payload.title, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.get('/api/announcements', (req, res) => {
  res.json(readStore().announcements || []);
});

app.get('/api/external-links', (req, res) => {
  const store = readStore();
  res.json((store.externalLinks || []).sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru')));
});

app.post('/api/external-links', (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL должен начинаться с http:// или https://' });
  const store = readStore();
  const createdAt = now();
  const link = {
    id: nanoid(10),
    title: req.body?.title || url,
    url,
    category: req.body?.category || 'Ссылка',
    notes: req.body?.notes || '',
    createdAt,
    updatedAt: createdAt
  };
  store.externalLinks = [link, ...(store.externalLinks || [])];
  writeStore(store);
  res.status(201).json(link);
});

app.put('/api/external-links/:id', (req, res) => {
  const store = readStore();
  const index = (store.externalLinks || []).findIndex(link => link.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'External link not found' });
  const next = { ...store.externalLinks[index] };
  for (const field of ['title', 'category', 'notes']) {
    if (req.body?.[field] !== undefined) next[field] = req.body[field];
  }
  if (req.body?.url !== undefined) {
    const url = String(req.body.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL должен начинаться с http:// или https://' });
    next.url = url;
  }
  next.updatedAt = now();
  store.externalLinks[index] = next;
  writeStore(store);
  res.json(next);
});

app.delete('/api/external-links/:id', (req, res) => {
  const store = readStore();
  const before = (store.externalLinks || []).length;
  store.externalLinks = (store.externalLinks || []).filter(link => link.id !== req.params.id);
  store.servicePlan = (store.servicePlan || []).filter(item => !(item.type === 'external_board' && item.payload?.externalLinkId === req.params.id));
  writeStore(store);
  res.json({ ok: before !== store.externalLinks.length });
});

app.post('/api/external-links/:id/show', (req, res) => {
  const store = readStore();
  const link = (store.externalLinks || []).find(item => item.id === req.params.id);
  if (!link) return res.status(404).json({ error: 'External link not found' });
  res.json(updateScreenState('external_board', { externalLinkId: link.id, title: link.title, url: link.url, category: link.category }));
});

app.post('/api/external-links/:id/add-to-plan', (req, res) => {
  const store = readStore();
  const link = (store.externalLinks || []).find(item => item.id === req.params.id);
  if (!link) return res.status(404).json({ error: 'External link not found' });
  const payload = { externalLinkId: link.id, title: link.title, url: link.url, category: link.category };
  const item = makePlanItem({ type: 'external_board', title: link.title, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.get('/api/prayer-requests', (req, res) => {
  res.json(readStore().prayerRequests || []);
});

app.post('/api/prayer-requests/show', (req, res) => {
  const payload = {
    title: req.body?.title || 'Молитвенные нужды',
    titleEn: req.body?.titleEn || 'Prayer Requests',
    body: req.body?.body || '',
    bodyEn: req.body?.bodyEn || '',
    lang: ['ru', 'en', 'both'].includes(req.body?.lang) ? req.body.lang : 'both',
    kind: 'prayer_request'
  };
  const store = readStore();
  const request = { id: nanoid(10), ...payload, createdAt: now() };
  store.prayerRequests = [request, ...(store.prayerRequests || []).slice(0, 49)];
  writeStore(store);
  res.json(updateScreenState('announcement', payload));
});

app.post('/api/prayer-requests/add-to-plan', (req, res) => {
  const payload = {
    title: req.body?.title || 'Молитвенные нужды',
    titleEn: req.body?.titleEn || 'Prayer Requests',
    body: req.body?.body || '',
    bodyEn: req.body?.bodyEn || '',
    lang: ['ru', 'en', 'both'].includes(req.body?.lang) ? req.body.lang : 'both',
    kind: 'prayer_request'
  };
  const store = readStore();
  const request = { id: nanoid(10), ...payload, createdAt: now() };
  store.prayerRequests = [request, ...(store.prayerRequests || []).slice(0, 49)];
  const item = makePlanItem({ type: 'announcement', title: payload.title, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});


app.get('/api/images', (req, res) => {
  const store = readStore();
  res.json((store.mediaImages || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

app.post('/api/images', uploadImage.single('image'), (req, res) => {
  const store = readStore();
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'image file is required' });
  const createdAt = now();
  const image = {
    id: nanoid(10),
    title: req.body.title || file.originalname || 'Картинка',
    category: req.body.category || 'Заставки',
    tags: String(req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    mediaUrl: `/media/images/${file.filename}`,
    fileName: file.filename,
    originalFileName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    createdAt,
    updatedAt: createdAt
  };
  store.mediaImages = [image, ...(store.mediaImages || [])];
  writeStore(store);
  res.status(201).json(image);
});

app.delete('/api/images/:id', (req, res) => {
  const store = readStore();
  const image = (store.mediaImages || []).find(i => i.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  store.mediaImages = store.mediaImages.filter(i => i.id !== req.params.id);
  store.servicePlan = store.servicePlan.filter(item => !(item.type === 'image' && item.payload?.imageId === image.id));
  writeStore(store);
  res.json({ ok: true });
});

app.post('/api/images/:id/show', (req, res) => {
  const store = readStore();
  const image = (store.mediaImages || []).find(i => i.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  res.json(updateScreenState('image', {
    imageId: image.id,
    title: image.title,
    category: image.category,
    mediaUrl: image.mediaUrl,
    fit: req.body?.fit || 'cover'
  }));
});

app.post('/api/images/:id/add-to-plan', (req, res) => {
  const store = readStore();
  const image = (store.mediaImages || []).find(i => i.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  const payload = { imageId: image.id, title: image.title, category: image.category, mediaUrl: image.mediaUrl, fit: req.body?.fit || 'cover' };
  const item = makePlanItem({ type: 'image', title: image.title, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

function resolveImagesByIds(store, imageIds) {
  const ids = Array.isArray(imageIds) ? imageIds : [];
  return ids.map(id => (store.mediaImages || []).find(i => i.id === id)).filter(Boolean);
}

app.post('/api/slideshow/show', (req, res) => {
  const store = readStore();
  const images = resolveImagesByIds(store, req.body?.imageIds);
  if (!images.length) return res.status(400).json({ error: 'Choose at least one image' });
  const payload = {
    title: req.body?.title || 'Слайдшоу',
    intervalSeconds: Number(req.body?.intervalSeconds || 6),
    fit: req.body?.fit || 'cover',
    images: images.map(i => ({ id: i.id, title: i.title, mediaUrl: i.mediaUrl }))
  };
  res.json(updateScreenState('slideshow', payload));
});

app.post('/api/slideshow/add-to-plan', (req, res) => {
  const store = readStore();
  const images = resolveImagesByIds(store, req.body?.imageIds);
  if (!images.length) return res.status(400).json({ error: 'Choose at least one image' });
  const payload = {
    title: req.body?.title || 'Слайдшоу',
    intervalSeconds: Number(req.body?.intervalSeconds || 6),
    fit: req.body?.fit || 'cover',
    images: images.map(i => ({ id: i.id, title: i.title, mediaUrl: i.mediaUrl }))
  };
  const item = makePlanItem({ type: 'slideshow', title: payload.title, payload });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.post('/api/announcements/:id/show', (req, res) => {
  const item = readStore().announcements.find(a => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Announcement not found' });
  res.json(updateScreenState('announcement', item));
});

app.post('/api/announcements/:id/add-to-plan', (req, res) => {
  const store = readStore();
  const announcement = store.announcements.find(a => a.id === req.params.id);
  if (!announcement) return res.status(404).json({ error: 'Announcement not found' });
  const item = makePlanItem({ type: 'announcement', title: announcement.title, payload: announcement });
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.get('/api/service-plan', (req, res) => {
  const store = readStore();
  res.json({ servicePlan: store.servicePlan, activePlanIndex: store.activePlanIndex });
});

app.post('/api/service-plan/items', (req, res) => {
  const store = readStore();
  const item = makePlanItem(req.body || {});
  store.servicePlan.push(item);
  writeStore(store);
  res.status(201).json({ item, servicePlan: store.servicePlan });
});

app.post('/api/service-plan/items/:id/show', (req, res) => {
  const store = readStore();
  const index = store.servicePlan.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Plan item not found' });
  const result = showPlanIndex(index);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

app.delete('/api/service-plan/items/:id', (req, res) => {
  const store = readStore();
  const before = store.servicePlan.length;
  const removedIndex = store.servicePlan.findIndex(item => item.id === req.params.id);
  store.servicePlan = store.servicePlan.filter(item => item.id !== req.params.id);
  if (removedIndex !== -1 && store.activePlanIndex >= removedIndex) store.activePlanIndex = Math.max(-1, store.activePlanIndex - 1);
  writeStore(store);
  res.json({ ok: before !== store.servicePlan.length, servicePlan: store.servicePlan, activePlanIndex: store.activePlanIndex });
});

app.post('/api/service-plan/items/:id/move', (req, res) => {
  const { direction } = req.body;
  const store = readStore();
  const index = store.servicePlan.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Plan item not found' });
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= store.servicePlan.length) return res.json({ servicePlan: store.servicePlan, activePlanIndex: store.activePlanIndex });
  const copy = [...store.servicePlan];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  store.servicePlan = copy;
  if (store.activePlanIndex === index) store.activePlanIndex = target;
  else if (store.activePlanIndex === target) store.activePlanIndex = index;
  writeStore(store);
  res.json({ servicePlan: store.servicePlan, activePlanIndex: store.activePlanIndex });
});

app.post('/api/service-plan/next', (req, res) => {
  const store = readStore();
  const result = showPlanIndex(store.activePlanIndex + 1);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

app.post('/api/service-plan/previous', (req, res) => {
  const store = readStore();
  const result = showPlanIndex(store.activePlanIndex <= 0 ? 0 : store.activePlanIndex - 1);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

app.post('/api/service-plan/clear', (req, res) => {
  const store = readStore();
  store.servicePlan = [];
  store.activePlanIndex = -1;
  writeStore(store);
  res.json({ ok: true, servicePlan: [] });
});

app.get('/api/checkup', (req, res) => {
  const store = readStore();
  const missing = [];
  for (const song of store.songs || []) {
    if (song.mediaUrl && !localMediaExists(song.mediaUrl)) missing.push({ id: song.id, title: song.title, reason: 'Видео-файл не найден' });
  }
  for (const track of store.audioTracks || []) {
    if (track.mediaUrl && !localMediaExists(track.mediaUrl)) missing.push({ id: track.id, title: track.title, reason: 'Аудиофайл не найден' });
  }
  const planWarnings = [];
  for (const [index, item] of (store.servicePlan || []).entries()) {
    if (item.type === 'song') {
      const song = store.songs.find(s => s.id === item.payload?.songId);
      if (!song) planWarnings.push({ index: index + 1, title: item.title, reason: 'Песня удалена из каталога' });
      else if (!song.mediaUrl) planWarnings.push({ index: index + 1, title: song.title, reason: 'Нет локального видео' });
      else if (!localMediaExists(song.mediaUrl)) planWarnings.push({ index: index + 1, title: song.title, reason: 'Локальный файл не найден' });
      if (song.youtubeUrl && !song.mediaUrl) planWarnings.push({ index: index + 1, title: song.title, reason: 'Только YouTube: требуется интернет и возможна реклама' });
    }
    if (item.type === 'audio') {
      const track = store.audioTracks.find(a => a.id === item.payload?.audioId);
      if (!track) planWarnings.push({ index: index + 1, title: item.title, reason: 'Фонограмма удалена из каталога' });
      else if (!localMediaExists(track.mediaUrl)) planWarnings.push({ index: index + 1, title: track.title, reason: 'Аудиофайл не найден' });
    }
    if (item.type === 'translation_qr' && item.payload?.url?.startsWith('http')) {
      planWarnings.push({ index: index + 1, title: item.title, reason: 'Ссылка перевода может требовать интернет' });
    }
    if (item.type === 'translation_caption' && item.payload?.url?.startsWith('http')) {
      planWarnings.push({ index: index + 1, title: item.title, reason: 'Субтитры перевода требуют интернет' });
    }
    if (item.type === 'external_board' && item.payload?.url?.startsWith('http')) {
      planWarnings.push({ index: index + 1, title: item.title, reason: 'Миссионерский борд требует интернет' });
    }
    if (item.type === 'image' && item.payload?.mediaUrl && !localMediaExists(item.payload.mediaUrl)) {
      planWarnings.push({ index: index + 1, title: item.title, reason: 'Картинка не найдена' });
    }
    if (item.type === 'slideshow') {
      for (const img of item.payload?.images || []) {
        if (img.mediaUrl && !localMediaExists(img.mediaUrl)) planWarnings.push({ index: index + 1, title: img.title || item.title, reason: 'Картинка слайдшоу не найдена' });
      }
    }
  }
  res.json({
    ok: missing.length === 0 && planWarnings.filter(w => !w.reason.includes('интернет')).length === 0,
    songsCount: (store.songs || []).length,
    offlineReadySongs: (store.songs || []).filter(s => s.isOfflineReady).length,
    servicePlanItems: (store.servicePlan || []).length,
    imagesCount: (store.mediaImages || []).length,
    audioTracksCount: (store.audioTracks || []).length,
    activePlanIndex: store.activePlanIndex,
    missing,
    planWarnings,
    screenState: store.screenState,
    mediaDir: MEDIA_DIR,
    time: now()
  });
});

// ---- Live translation (our own OpenAI engine) ----
const translationHub = new TranslationHub();

app.get('/api/translation/live/state', (req, res) => {
  res.json({ ...translationHub.status(), hasApiKey: Boolean(process.env.OPENAI_API_KEY), lanUrls: getLanUrls(PORT) });
});

app.post('/api/translation/live/start', (req, res) => {
  const state = translationHub.start({ engine: req.body?.engine, displayLang: req.body?.displayLang });
  res.json(state);
});

app.post('/api/translation/live/stop', (req, res) => {
  res.json(translationHub.stop());
});

app.post('/api/translation/live/ensure', (req, res) => {
  if (!translationHub.running) return res.status(409).json({ error: 'Перевод не запущен' });
  translationHub.ensureLanguage(req.body?.lang);
  res.json(translationHub.status());
});

app.get('/api/translation/live/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  translationHub.addSubscriber(res);
  const ping = setInterval(() => { try { res.write(`event: ping\ndata: {}\n\n`); } catch {} }, 25000);
  req.on('close', () => clearInterval(ping));
});

app.post('/api/translation/live/show-on-tv', (req, res) => {
  const lang = sanitizeLang(req.body?.lang) || translationHub.displayLang;
  if (translationHub.running) translationHub.ensureLanguage(lang);
  res.json(updateScreenState('translation_live', { lang, title: 'Live Translation' }));
});

app.post('/api/translation/live/show-qr', async (req, res) => {
  const lanUrls = getLanUrls(PORT);
  const base = lanUrls[0] || `http://localhost:${PORT}`;
  const url = `${base}/translate`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 720 });
  res.json(updateScreenState('translation_qr', {
    title: 'Live Translation',
    url,
    languages: '',
    instructions: 'Scan the QR code to read or listen to the live translation in your language.\nFor audio, please use headphones.',
    qrDataUrl
  }));
});

const distPath = path.join(ROOT, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
  app.get('/', (req, res) => {
    res.send(`
      <h1>Church Local Media Server</h1>
      <p>Server is running on port ${PORT}.</p>
      <p>For development run <code>npm run dev</code> and open Vite on port 5173.</p>
    `);
  });
}

const server = http.createServer(app);
attachTranslation(server, translationHub);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Church Local Media Server running on http://localhost:${PORT}`);
  console.log(`Admin:  http://localhost:${PORT}/admin`);
  console.log(`Screen: http://localhost:${PORT}/screen/main`);
  console.log(`Translate source: http://localhost:${PORT}/translate/source`);
  startCloudSync({ readStore, writeStore, mediaDir: MEDIA_DIR, now, safeFileName });
});

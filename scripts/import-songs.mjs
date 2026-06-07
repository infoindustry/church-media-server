import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { TextDecoder } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT, 'server', 'data', 'store.json');
const VIDEOS_DIR = path.join(ROOT, 'server', 'media', 'videos');
const AUDIO_DIR = path.join(ROOT, 'server', 'media', 'audio');
const SONGS_DIR = process.env.SONGS_DIR || path.join(ROOT, 'import-songs');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm']);

const LANGUAGE_FOLDERS = new Map([
  ['dutch', 'nl'],
  ['en', 'en'],
  ['english', 'en'],
  ['fr', 'fr'],
  ['french', 'fr'],
  ['german', 'de'],
  ['de', 'de'],
  ['polish', 'pl'],
  ['pl', 'pl'],
  ['portugal', 'pt'],
  ['portuguese', 'pt'],
  ['pt', 'pt'],
  ['ruen', 'ru/en'],
  ['spanish', 'es'],
  ['es', 'es'],
  ['sr', 'sr'],
  ['serbian', 'sr'],
  ['ua', 'ua'],
  ['ukrainian', 'ua'],
  ['на украинском', 'ua']
]);

const AUDIO_CATEGORY_FOLDERS = new Set([
  'фоновые песни',
  'фонограммы',
  'минусовки',
  'audio',
  'background'
]);

const cp1251 = new TextDecoder('windows-1251');

function now() {
  return new Date().toISOString();
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function safeFileName(originalName, index) {
  const ext = path.extname(originalName || '').toLowerCase();
  const base = path.basename(originalName || 'file', ext)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${Date.now()}-${index}-${base || 'media'}${ext}`;
}

function decodeUtf16BE(buffer) {
  let text = '';
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    text += String.fromCharCode((buffer[i] << 8) | buffer[i + 1]);
  }
  return text;
}

function decodeTextFrame(data) {
  if (!data?.length) return '';
  const encoding = data[0];
  const payload = data.slice(1);
  if (encoding === 0) return payload.toString('latin1');
  if (encoding === 1) return payload.toString('utf16le');
  if (encoding === 2) return decodeUtf16BE(payload);
  return payload.toString('utf8');
}

function syncSafeToInt(buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21)
    | ((buffer[offset + 1] & 0x7f) << 14)
    | ((buffer[offset + 2] & 0x7f) << 7)
    | (buffer[offset + 3] & 0x7f);
}

function readMp3Title(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.slice(0, 3).toString('latin1') !== 'ID3') return '';

  const major = buffer[3];
  const tagSize = syncSafeToInt(buffer, 6);
  let offset = 10;
  const end = Math.min(10 + tagSize, buffer.length);

  while (offset + 10 <= end) {
    const frameId = buffer.slice(offset, offset + 4).toString('latin1');
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize = major === 4 ? syncSafeToInt(buffer, offset + 4) : buffer.readUInt32BE(offset + 4);
    if (frameSize <= 0 || offset + 10 + frameSize > buffer.length) break;

    if (frameId === 'TIT2') {
      return cleanTitle(decodeTextFrame(buffer.slice(offset + 10, offset + 10 + frameSize)));
    }
    offset += 10 + frameSize;
  }

  return '';
}

function looksLikeMojibake(text) {
  return /[À-ÿ]{2,}/.test(text) && /[ÐÑÃÂÊËÌÍÎÏÒÓÔÕØÙÚÛÝÞßà-ÿ]/.test(text);
}

function repairMojibake(text) {
  if (!looksLikeMojibake(text)) return text;
  return cp1251.decode(Buffer.from(text, 'latin1'));
}

function cleanTitle(value) {
  return repairMojibake(String(value || ''))
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\s*\(video-converter\.com\)\s*/gi, ' ')
    .replace(/\s*video-converter\.com\s*/gi, ' ')
    .replace(/\s*https?:\/\/\S+/gi, ' ')
    .replace(/\s*mp4\s*$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\d{1,3}[\s.-]+(?=\p{L})/u, '')
    .trim();
}

function isWeakTitle(title) {
  return !title
    || /^\d+$/.test(title)
    || /^(track|audiotrack|дорожка|трек)[\s_-]*\d*$/i.test(title)
    || /^music-[a-z0-9]+(?: \(\d+\))?$/i.test(title);
}

function titleFromFile(originalName, fullPath = '') {
  const tagTitle = fullPath && AUDIO_EXT.has(path.extname(fullPath).toLowerCase()) ? readMp3Title(fullPath) : '';
  const ext = path.extname(originalName);
  const folders = originalName.split(path.sep).slice(0, -1);
  const fileTitle = cleanTitle(path.basename(originalName, ext)
    .replace(/\s*\(video-converter\.com\)\s*/gi, ' ')
    .replace(/\s*video-converter\.com\s*/gi, ' ')
    .replace(/\s*mp4\s*$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' '));

  if (tagTitle && !isWeakTitle(tagTitle)) return tagTitle;
  if (!isWeakTitle(fileTitle)) return fileTitle;
  const fallbackTitle = tagTitle || fileTitle || 'Без названия';
  if (folders.length) return `${folders[folders.length - 1]} / ${fallbackTitle}`;
  return fallbackTitle;
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'Thumbs.db') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function metadataFor(relativePath, isAudio) {
  const parts = relativePath.split(path.sep);
  const folders = parts.slice(0, -1);
  let language = 'ru';
  let categoryParts = [];
  const tags = [];

  for (const folder of folders) {
    const key = normalizeKey(folder);
    const mappedLanguage = LANGUAGE_FOLDERS.get(key);
    if (mappedLanguage) {
      language = mappedLanguage;
      tags.push(folder);
      continue;
    }
    categoryParts.push(folder);
  }

  if (isAudio && categoryParts.length === 0) categoryParts = ['Фонограммы'];
  if (isAudio && folders.some(folder => AUDIO_CATEGORY_FOLDERS.has(normalizeKey(folder)))) {
    categoryParts = ['Фоновые песни'];
  }

  return {
    language,
    category: categoryParts.length ? categoryParts.join(' / ') : 'Поклонение',
    tags
  };
}

function main() {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(SONGS_DIR, { recursive: true });

  if (!fs.existsSync(STORE_PATH)) {
    throw new Error(`Не найден ${STORE_PATH}. Запустите сервер хотя бы один раз.`);
  }

  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  store.songs = store.songs || [];
  store.audioTracks = store.audioTracks || [];

  const alreadySongs = new Set(store.songs.map(s => s.originalFileName).filter(Boolean));
  const alreadyAudio = new Set(store.audioTracks.map(a => a.originalFileName).filter(Boolean));

  const files = walkFiles(SONGS_DIR)
    .map(fullPath => ({
      fullPath,
      relativePath: path.relative(SONGS_DIR, fullPath),
      ext: path.extname(fullPath).toLowerCase()
    }))
    .filter(file => VIDEO_EXT.has(file.ext) || AUDIO_EXT.has(file.ext))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ru'));

  if (!files.length) {
    console.log(`Нет видео или аудио в папке: ${SONGS_DIR}`);
    console.log('Положите туда mp4/mp3-файлы и запустите снова.');
    return;
  }

  let importedSongs = 0;
  let importedAudio = 0;
  let skipped = 0;
  let renamedAudio = 0;
  const createdSongs = [];
  const createdAudio = [];
  const sourceByRelativePath = new Map(files.map(file => [file.relativePath, file]));

  for (const track of store.audioTracks) {
    if (!track.originalFileName) continue;
    const source = sourceByRelativePath.get(track.originalFileName);
    if (!source || !AUDIO_EXT.has(source.ext)) continue;
    const betterTitle = titleFromFile(source.relativePath, source.fullPath);
    if (betterTitle && betterTitle !== track.title && (isWeakTitle(track.title) || !isWeakTitle(betterTitle))) {
      track.title = betterTitle;
      track.updatedAt = now();
      renamedAudio += 1;
    }
  }

  files.forEach((file, index) => {
    const isAudio = AUDIO_EXT.has(file.ext) && !VIDEO_EXT.has(file.ext);
    const originalKey = file.relativePath;
    const already = isAudio ? alreadyAudio : alreadySongs;

    if (already.has(originalKey)) {
      console.log(`Пропуск, уже импортировано: ${originalKey}`);
      skipped += 1;
      return;
    }

    const targetDir = isAudio ? AUDIO_DIR : VIDEOS_DIR;
    const fileName = safeFileName(path.basename(file.relativePath), index);
    fs.copyFileSync(file.fullPath, path.join(targetDir, fileName));

    const createdAt = now();
    const meta = metadataFor(file.relativePath, isAudio);

    if (isAudio) {
      createdAudio.push({
        id: nanoid(10),
        title: titleFromFile(file.relativePath, file.fullPath),
        language: meta.language,
        category: meta.category,
        tags: meta.tags,
        mediaUrl: `/media/audio/${fileName}`,
        fileName,
        originalFileName: originalKey,
        mimeType: 'audio/mpeg',
        isOfflineReady: true,
        createdAt,
        updatedAt: createdAt
      });
      console.log(`Аудио: ${originalKey}`);
      importedAudio += 1;
      return;
    }

    createdSongs.push({
      id: nanoid(10),
      title: titleFromFile(file.relativePath, file.fullPath),
      language: meta.language,
      category: meta.category,
      tags: meta.tags,
      sourceType: 'local_video',
      mediaUrl: `/media/videos/${fileName}`,
      fileName,
      originalFileName: originalKey,
      youtubeUrl: '',
      isOfflineReady: true,
      createdAt,
      updatedAt: createdAt
    });
    console.log(`Песня: ${originalKey}`);
    importedSongs += 1;
  });

  store.songs = [...createdSongs, ...store.songs];
  store.audioTracks = [...createdAudio, ...store.audioTracks];
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');

  console.log(`\nГотово. Песен добавлено: ${importedSongs}, фонограмм добавлено: ${importedAudio}, названий фонограмм обновлено: ${renamedAudio}, пропущено: ${skipped}.`);
  console.log('Перезапустите сервер и проверьте разделы “Песни” и “Фонограммы”.');
}

main();

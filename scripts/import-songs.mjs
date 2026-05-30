import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT, 'server', 'data', 'store.json');
const VIDEOS_DIR = path.join(ROOT, 'server', 'media', 'videos');
const SONGS_DIR = process.env.SONGS_DIR || path.join(ROOT, 'import-songs');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']);

function now() {
  return new Date().toISOString();
}

function safeFileName(originalName, index) {
  const ext = path.extname(originalName || '').toLowerCase();
  const base = path.basename(originalName || 'file', ext)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return `${Date.now()}-${index}-${base || 'media'}${ext}`;
}

function titleFromFile(originalName) {
  const ext = path.extname(originalName);
  return path.basename(originalName, ext)
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Без названия';
}

function main() {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  fs.mkdirSync(SONGS_DIR, { recursive: true });

  if (!fs.existsSync(STORE_PATH)) {
    throw new Error(`Не найден ${STORE_PATH}. Запустите сервер хотя бы раз.`);
  }

  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  store.songs = store.songs || [];
  const already = new Set(store.songs.map(s => s.originalFileName).filter(Boolean));

  const files = fs.readdirSync(SONGS_DIR)
    .filter(f => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ru'));

  if (!files.length) {
    console.log(`Нет видео в папке: ${SONGS_DIR}`);
    console.log('Положите туда mp4-файлы и запустите снова.');
    return;
  }

  let imported = 0;
  let skipped = 0;
  const created = [];

  files.forEach((original, index) => {
    if (already.has(original)) {
      console.log(`Пропуск (уже импортирован): ${original}`);
      skipped += 1;
      return;
    }
    const fileName = safeFileName(original, index);
    fs.copyFileSync(path.join(SONGS_DIR, original), path.join(VIDEOS_DIR, fileName));

    const createdAt = now();
    created.push({
      id: nanoid(10),
      title: titleFromFile(original),
      language: 'ru',
      category: 'Без категории',
      tags: [],
      sourceType: 'local_video',
      mediaUrl: `/media/videos/${fileName}`,
      fileName,
      originalFileName: original,
      youtubeUrl: '',
      isOfflineReady: true,
      createdAt,
      updatedAt: createdAt
    });
    console.log(`Импортировано: ${original}`);
    imported += 1;
  });

  store.songs = [...created, ...store.songs];
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');

  console.log(`\nГотово. Добавлено: ${imported}, пропущено: ${skipped}.`);
  console.log('Перезапустите сервер и проверьте раздел Песни.');
}

main();

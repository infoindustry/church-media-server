import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const NORMALIZED_PATH = path.join(ROOT, 'vendor', 'bibles', 'normalized', 'bibles.json');
const SOURCE_PATH = process.env.SRPONSTL_SOURCE
  || path.join(ROOT, 'vendor', 'bibles', 'raw', 'srponstl', 'srponstl_bible.json');

const TRANSLATION_ID = 'sr_srponstl';

function loadNormalized() {
  if (!fs.existsSync(NORMALIZED_PATH)) {
    throw new Error(`Не найден ${NORMALIZED_PATH}. Сначала нужен bibles.json со списком книг.`);
  }
  return JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
}

function saveNormalized(data) {
  data.generatedAt = new Date().toISOString();
  fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(data, null, 2));
}

function main() {
  const normalized = loadNormalized();
  if (!normalized.books?.length) {
    throw new Error('В bibles.json нет списка книг.');
  }
  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(`Не найден исходник: ${SOURCE_PATH}`);
  }

  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
  const meta = source.translation || {};
  const verses = {};
  let count = 0;

  for (const book of source.books || []) {
    const appBook = normalized.books[(book.number || 0) - 1];
    if (!appBook) {
      console.warn(`Пропускаю книгу без сопоставления: ${book.code} number=${book.number}`);
      continue;
    }
    for (const chapter of book.chapters || []) {
      for (const verse of chapter.verses || []) {
        const text = String(verse.text || '').replace(/\s+/g, ' ').trim();
        if (!verse.number || !text) continue;
        verses[`${appBook.slug}.${chapter.number}.${verse.number}`] = text;
        count += 1;
      }
    }
  }

  normalized.verses = normalized.verses || {};
  normalized.verses[TRANSLATION_ID] = verses;

  normalized.translations = (normalized.translations || []).filter(t => t.id !== TRANSLATION_ID);
  normalized.translations.push({
    id: TRANSLATION_ID,
    language: 'sr',
    name: meta.name || 'Novi srpski prevod',
    shortName: meta.short_name || 'NSP',
    source: meta.source || 'srponstl',
    license: meta.license || '',
    licenseUrl: meta.license_url || '',
    copyright: meta.copyright || '',
    primary: false
  });

  saveNormalized(normalized);
  console.log(`Импортировано стихов: ${count}`);
  console.log(`Перевод: ${TRANSLATION_ID} — ${meta.name || ''}`);
  console.log('Готово. Перезапустите сервер и проверьте Писание →', meta.short_name || TRANSLATION_ID);
}

main();

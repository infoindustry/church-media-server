import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const NORMALIZED_PATH = path.join(ROOT, 'vendor', 'bibles', 'normalized', 'bibles.json');
const RAW_DIR = path.join(ROOT, 'vendor', 'bibles', 'raw', 'helloao-serbian');
const API_BASE = 'https://bible.helloao.org';

fs.mkdirSync(RAW_DIR, { recursive: true });
fs.mkdirSync(path.dirname(NORMALIZED_PATH), { recursive: true });

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'church-local-media-server/0.8' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(getJson(new URL(res.headers.location, url).toString()));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} ${url}\n${data.slice(0, 500)}`));
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function loadNormalized() {
  if (!fs.existsSync(NORMALIZED_PATH)) {
    return { version: 1, generatedAt: new Date().toISOString(), books: [], translations: [], verses: {} };
  }
  return JSON.parse(fs.readFileSync(NORMALIZED_PATH, 'utf8'));
}

function saveNormalized(data) {
  data.generatedAt = new Date().toISOString();
  fs.writeFileSync(NORMALIZED_PATH, JSON.stringify(data, null, 2));
}

function isSerbianCandidate(t) {
  const haystack = [t.id, t.name, t.englishName, t.shortName, t.language, t.languageName, t.languageEnglishName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return t.language === 'srp' || haystack.includes('serbian') || haystack.includes('srpski') || haystack.includes('срп');
}

function hasCyrillic(text) {
  return /[А-Яа-яЂђЈјЉљЊњЋћЏџ]/.test(text || '');
}

const CYR_TO_LAT = {
  'А':'A','а':'a','Б':'B','б':'b','В':'V','в':'v','Г':'G','г':'g','Д':'D','д':'d','Ђ':'Đ','ђ':'đ',
  'Е':'E','е':'e','Ж':'Ž','ж':'ž','З':'Z','з':'z','И':'I','и':'i','Ј':'J','ј':'j','К':'K','к':'k',
  'Л':'L','л':'l','Љ':'Lj','љ':'lj','М':'M','м':'m','Н':'N','н':'n','Њ':'Nj','њ':'nj','О':'O','о':'o',
  'П':'P','п':'p','Р':'R','р':'r','С':'S','с':'s','Т':'T','т':'t','Ћ':'Ć','ћ':'ć','У':'U','у':'u',
  'Ф':'F','ф':'f','Х':'H','х':'h','Ц':'C','ц':'c','Ч':'Č','ч':'č','Џ':'Dž','џ':'dž','Ш':'Š','ш':'š'
};

function cyrillicToLatin(text) {
  return String(text || '').split('').map(ch => CYR_TO_LAT[ch] || ch).join('');
}

function flattenContent(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenContent).join('');
  if (typeof value === 'object') {
    if (value.type === 'footnote' || value.type === 'verse_footnote_reference') return '';
    if (typeof value.text === 'string') return value.text;
    if (value.content) return flattenContent(value.content);
  }
  return '';
}

function extractVerses(chapterJson) {
  const verses = [];
  const content = chapterJson?.chapter?.content || [];
  for (const item of content) {
    if (item?.type === 'verse') {
      const number = Number(item.number);
      const text = flattenContent(item.content).replace(/\s+/g, ' ').trim();
      if (number && text) verses.push({ number, text });
    }
  }
  return verses;
}

function apiUrl(linkOrPath) {
  if (!linkOrPath) return '';
  if (/^https?:\/\//i.test(linkOrPath)) return linkOrPath;
  return `${API_BASE}${linkOrPath.startsWith('/') ? '' : '/'}${linkOrPath}`;
}

async function main() {
  const normalized = loadNormalized();
  if (!normalized.books?.length) {
    throw new Error('В bibles.json нет списка книг. Сначала используй архив v0.7+ с русской/английской Библией.');
  }

  console.log('Loading available translations from Free Use Bible API...');
  const available = await getJson(`${API_BASE}/api/available_translations.json`);
  fs.writeFileSync(path.join(RAW_DIR, 'available_translations.json'), JSON.stringify(available, null, 2));

  const candidates = (available.translations || [])
    .filter(t => isSerbianCandidate(t) && (t.availableFormats || []).includes('json'))
    .sort((a, b) => (b.numberOfBooks || 0) - (a.numberOfBooks || 0));

  if (!candidates.length) {
    throw new Error('Не нашёл сербский JSON-перевод в Free Use Bible API. Можно проверить vendor/bibles/raw/helloao-serbian/available_translations.json вручную.');
  }

  console.log('Serbian candidates:');
  for (const t of candidates) {
    console.log(`- ${t.id}: ${t.name} / ${t.englishName || ''} (${t.numberOfBooks || '?'} books, ${t.totalNumberOfVerses || '?'} verses)`);
  }

  const requestedId = process.env.SERBIAN_TRANSLATION_ID;
  const selected = requestedId
    ? candidates.find(t => t.id === requestedId) || (available.translations || []).find(t => t.id === requestedId)
    : candidates.find(t => (t.numberOfBooks || 0) >= 66) || candidates[0];

  if (!selected) throw new Error(`Перевод ${requestedId} не найден.`);
  console.log(`Selected Serbian source: ${selected.id} — ${selected.name}`);

  const booksJson = await getJson(apiUrl(selected.listOfBooksApiLink || `/api/${selected.id}/books.json`));
  fs.writeFileSync(path.join(RAW_DIR, `${selected.id}-books.json`), JSON.stringify(booksJson, null, 2));

  const verses = {};
  const originalCyrillicVerses = {};
  const books = (booksJson.books || []).filter(book => !book.isApocryphal);

  for (const book of books) {
    const appBook = normalized.books[(book.order || 1) - 1];
    if (!appBook) {
      console.warn(`Skipping book without app mapping: ${book.id} order=${book.order}`);
      continue;
    }
    for (let chapter = book.firstChapterNumber || 1; chapter <= (book.lastChapterNumber || book.numberOfChapters || 1); chapter += 1) {
      const url = apiUrl(`/api/${selected.id}/${book.id}/${chapter}.json`);
      process.stdout.write(`Downloading ${selected.id} ${book.id} ${chapter}...\r`);
      const chapterJson = await getJson(url);
      const outPath = path.join(RAW_DIR, selected.id, `${book.id}-${chapter}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(chapterJson, null, 2));
      for (const verse of extractVerses(chapterJson)) {
        const key = `${appBook.slug}.${chapter}.${verse.number}`;
        originalCyrillicVerses[key] = verse.text;
        verses[key] = hasCyrillic(verse.text) ? cyrillicToLatin(verse.text) : verse.text;
      }
    }
  }
  console.log('\nDownloaded verses:', Object.keys(verses).length);

  normalized.verses = normalized.verses || {};
  normalized.verses.sr_latn = verses;

  normalized.translations = (normalized.translations || []).filter(t => t.id !== 'sr_latn');
  normalized.translations.push({
    id: 'sr_latn',
    language: 'sr',
    name: 'Srpski / Crnogorski — latinica',
    shortName: 'Srpski',
    source: `Free Use Bible API: ${selected.id} — ${selected.name}`,
    licenseUrl: selected.licenseUrl || 'https://bible.helloao.org/',
    primary: false
  });

  if (Object.values(originalCyrillicVerses).some(hasCyrillic)) {
    normalized.verses.sr_cyrl = originalCyrillicVerses;
    normalized.translations = normalized.translations.filter(t => t.id !== 'sr_cyrl');
    normalized.translations.push({
      id: 'sr_cyrl',
      language: 'sr',
      name: 'Српски — ћирилица',
      shortName: 'Српски',
      source: `Free Use Bible API: ${selected.id} — ${selected.name}`,
      licenseUrl: selected.licenseUrl || 'https://bible.helloao.org/',
      primary: false
    });
  }

  saveNormalized(normalized);
  console.log('Saved:', path.relative(ROOT, NORMALIZED_PATH));
  console.log('Done. Restart the server, then check Писание → Srpski/Crnogorski.');
}

main().catch(error => {
  console.error('\nImport failed:', error.message);
  process.exit(1);
});

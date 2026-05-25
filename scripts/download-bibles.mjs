import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'vendor', 'bibles', 'raw');
fs.mkdirSync(RAW_DIR, { recursive: true });

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'church-local-media-server' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(requestJson(res.headers.location));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} ${url}\n${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'church-local-media-server' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.rmSync(dest, { force: true });
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.rmSync(dest, { force: true });
        return reject(new Error(`${res.statusCode} ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { file.close(); reject(err); });
  });
}

async function downloadKjv() {
  const url = 'https://raw.githubusercontent.com/farskipper/kjv/master/json/verses-1769.json';
  const dest = path.join(RAW_DIR, 'en-kjv-verses-1769.json');
  console.log('Downloading KJV:', url);
  await download(url, dest);
  console.log('Saved:', path.relative(ROOT, dest));
}

async function downloadRstParsed66() {
  const apiUrl = 'https://api.github.com/repos/bibleonline/rst/contents/parsed66?ref=master';
  const dir = path.join(RAW_DIR, 'ru-rst-parsed66');
  fs.mkdirSync(dir, { recursive: true });
  console.log('Listing RST parsed66:', apiUrl);
  const files = await requestJson(apiUrl);
  const dataFiles = files.filter(f => f.type === 'file' && /\.dat$/i.test(f.name));
  console.log(`Found ${dataFiles.length} RST files`);
  for (const file of dataFiles) {
    const dest = path.join(dir, file.name);
    console.log('Downloading:', file.name);
    await download(file.download_url, dest);
  }
  console.log('Saved RST files into:', path.relative(ROOT, dir));
}

await downloadKjv();
await downloadRstParsed66();
console.log('Done. Next step: convert/import these files into app Bible search format.');

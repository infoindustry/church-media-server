import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
console.log('Serbian SWORD import is already integrated in v1.3.');
console.log('Raw module location: vendor/bibles/raw/SrKDEkavski.zip');
console.log('Normalized translations: sr_latn and sr_cyrl in vendor/bibles/normalized/bibles.json');

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { nanoid } from 'nanoid';

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);

export function startCloudSync({ readStore, writeStore, mediaDir, now, safeFileName }) {
  const baseUrl = String(process.env.CLOUD_SYNC_URL || '').replace(/\/+$/, '');
  const token = process.env.CLOUD_SYNC_DEVICE_TOKEN || '';
  if (!baseUrl || !token) {
    console.log('Cloud media sync disabled. Set CLOUD_SYNC_URL and CLOUD_SYNC_DEVICE_TOKEN to enable it.');
    return;
  }

  const deviceId = process.env.CLOUD_SYNC_DEVICE_ID || 'mini-pc-main';
  const deviceName = process.env.CLOUD_SYNC_DEVICE_NAME || 'Church Mini PC';
  const intervalMs = Math.max(5000, Number(process.env.CLOUD_SYNC_INTERVAL_MS || 10000));
  const maxItems = Math.max(1, Math.min(10, Number(process.env.CLOUD_SYNC_MAX_ITEMS || 3)));
  let stopped = false;

  async function loop() {
    if (stopped) return;
    try {
      await heartbeat({ baseUrl, token, deviceId, deviceName });
      const pending = await apiJson(`${baseUrl}/api/device/pending?limit=${maxItems}`, { token });
      for (const item of pending.items || []) {
        await syncItem({ baseUrl, token, deviceId, item, readStore, writeStore, mediaDir, now, safeFileName });
      }
    } catch (error) {
      console.error('Cloud media sync error:', error.message);
    } finally {
      setTimeout(loop, intervalMs);
    }
  }

  console.log(`Cloud media sync enabled: ${baseUrl}`);
  refreshDeviceConfig({ baseUrl, token }).catch(error => {
    console.error('Cloud device config error:', error.message);
  });
  setTimeout(loop, 1500);

  return () => {
    stopped = true;
  };
}

async function heartbeat({ baseUrl, token, deviceId, deviceName }) {
  return apiJson(`${baseUrl}/api/device/heartbeat`, {
    token,
    method: 'POST',
    body: {
      deviceId,
      name: deviceName,
      version: process.env.npm_package_version || ''
    }
  });
}

async function refreshDeviceConfig({ baseUrl, token }) {
  const config = await apiJson(`${baseUrl}/api/device/config`, { token });
  if (!process.env.OPENAI_API_KEY && config.openaiApiKey) {
    process.env.OPENAI_API_KEY = config.openaiApiKey;
    console.log('OpenAI translation key loaded from Cloudflare.');
  }
  if (!process.env.GEMINI_API_KEY && config.geminiApiKey) {
    process.env.GEMINI_API_KEY = config.geminiApiKey;
    console.log('Gemini translation key loaded from Cloudflare.');
  }
  if (!process.env.CAPTIONKIT_API_KEY && config.captionKitApiKey) {
    process.env.CAPTIONKIT_API_KEY = config.captionKitApiKey;
    console.log('CaptionKit key loaded from Cloudflare.');
  }
}

async function syncItem({ baseUrl, token, deviceId, item, readStore, writeStore, mediaDir, now, safeFileName }) {
  if (!item?.id) return;

  await apiJson(`${baseUrl}/api/device/items/${item.id}/started`, {
    token,
    method: 'POST',
    body: { deviceId }
  });

  let targetPath = '';
  try {
    if (item.kind === 'sermon') {
      const existingStore = readStore();
      const existing = (existingStore.sermons || []).find(sermon => sermon.cloudItemId === item.id);
      if (existing) {
        maybeAddSermonToPlan(existingStore, item, existing, now);
        writeStore(existingStore);
        await apiJson(`${baseUrl}/api/device/items/${item.id}/synced`, {
          token,
          method: 'POST',
          body: { deviceId, localId: existing.id }
        });
        return;
      }
      const result = await downloadAndRegisterSermon({ item, mediaDir, now, safeFileName, readStore, writeStore });
      await apiJson(`${baseUrl}/api/device/items/${item.id}/synced`, {
        token,
        method: 'POST',
        body: { deviceId, localId: result.id }
      });
      console.log(`Cloud sermon synced: ${result.title} (${result.images.length} slides)`);
      return;
    }

    if (item.kind === 'youtube') {
      const record = registerLocalMedia({
        item,
        kind: 'youtube',
        fileName: '',
        now,
        readStore,
        writeStore
      });
      await apiJson(`${baseUrl}/api/device/items/${item.id}/synced`, {
        token,
        method: 'POST',
        body: { deviceId, localId: record.id, mediaUrl: record.youtubeUrl }
      });
      console.log(`Cloud YouTube link registered: ${record.title}`);
      return;
    }

    if (!item.downloadUrl) throw new Error('Cloud item has no download URL');
    const kind = item.kind === 'audio' ? 'audio' : 'video';
    const folder = kind === 'audio' ? 'audio' : 'videos';
    fs.mkdirSync(path.join(mediaDir, folder), { recursive: true });

    const originalName = item.originalFileName || `${item.title || 'media'}${fallbackExtension(item)}`;
    const { fileName, targetPath: uniquePath } = uniqueTargetPath(path.join(mediaDir, folder), safeFileName(originalName));
    targetPath = uniquePath;
    await downloadToFile(item.downloadUrl, targetPath);
    const record = registerLocalMedia({
      item,
      kind,
      fileName,
      now,
      readStore,
      writeStore
    });

    await apiJson(`${baseUrl}/api/device/items/${item.id}/synced`, {
      token,
      method: 'POST',
      body: { deviceId, localId: record.id, mediaUrl: record.mediaUrl }
    });
    console.log(`Cloud media synced: ${record.title}`);
  } catch (error) {
    if (targetPath && fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch {}
    }
    await apiJson(`${baseUrl}/api/device/items/${item.id}/failed`, {
      token,
      method: 'POST',
      body: { deviceId, error: error.message }
    }).catch(() => {});
    throw error;
  }
}

async function downloadAndRegisterSermon({ item, mediaDir, now, safeFileName, readStore, writeStore }) {
  const slides = Array.isArray(item.slides) ? item.slides : [];
  if (!slides.length) throw new Error('Cloud sermon has no slides');
  const imageDir = path.join(mediaDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  const downloaded = [];

  try {
    for (const [index, slide] of slides.entries()) {
      if (!slide.downloadUrl) throw new Error(`Sermon slide ${index + 1} has no download URL`);
      const originalName = slide.originalFileName || slide.fileName || `slide-${index + 1}${imageExtension(slide)}`;
      const preferredName = safeFileName(`${String(index + 1).padStart(3, '0')}-${originalName}`);
      const target = uniqueTargetPath(imageDir, preferredName);
      await downloadToFile(slide.downloadUrl, target.targetPath);
      downloaded.push({
        id: nanoid(10),
        title: slide.title || originalName.replace(/\.[^.]+$/, ''),
        mediaUrl: `/media/images/${target.fileName}`,
        fileName: target.fileName,
        originalFileName: originalName,
        mimeType: slide.mimeType || '',
        sizeBytes: Number(slide.sizeBytes || 0),
        targetPath: target.targetPath
      });
    }

    const store = readStore();
    const createdAt = now();
    const mediaImages = downloaded.map(image => ({
      ...image,
      targetPath: undefined,
      category: 'Проповеди',
      tags: ['sermon'],
      sourceType: 'cloud_sermon',
      cloudItemId: item.id,
      createdAt,
      updatedAt: createdAt
    }));
    const sermon = {
      id: nanoid(10),
      title: item.title || 'Проповедь',
      fit: item.fit === 'cover' ? 'cover' : 'contain',
      cloudItemId: item.id,
      images: mediaImages.map(image => ({ id: image.id, title: image.title, mediaUrl: image.mediaUrl })),
      createdAt,
      updatedAt: createdAt
    };
    store.mediaImages = [...mediaImages, ...(store.mediaImages || [])];
    store.sermons = [sermon, ...(store.sermons || [])];
    maybeAddSermonToPlan(store, item, sermon, now);
    writeStore(store);
    return sermon;
  } catch (error) {
    for (const image of downloaded) {
      try { if (fs.existsSync(image.targetPath)) fs.unlinkSync(image.targetPath); } catch {}
    }
    throw error;
  }
}

function registerLocalMedia({ item, kind, fileName, now, readStore, writeStore }) {
  const store = readStore();
  const createdAt = now();
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const base = {
    id: nanoid(10),
    title: item.title || item.originalFileName || 'Cloud media',
    language: item.language || 'ru',
    category: item.category || (kind === 'audio' ? 'Фонограммы' : 'Поклонение'),
    tags,
    fileName,
    originalFileName: item.originalFileName || '',
    mimeType: item.mimeType || '',
    cloudItemId: item.id,
    isOfflineReady: true,
    createdAt,
    updatedAt: createdAt
  };

  if (kind === 'youtube') {
    store.songs = store.songs || [];
    const existing = store.songs.find(song => song.cloudItemId === item.id);
    if (existing) {
      maybeAddToPlan(store, item, existing, 'song', now);
      writeStore(store);
      return existing;
    }
    const song = {
      ...base,
      sourceType: 'youtube',
      mediaUrl: '',
      fileName: '',
      youtubeUrl: item.sourceUrl || '',
      youtubeAudioOnly: true,
      isOfflineReady: false
    };
    store.songs = [song, ...store.songs];
    maybeAddToPlan(store, item, song, 'song', now);
    writeStore(store);
    return song;
  }

  if (kind === 'audio') {
    store.audioTracks = store.audioTracks || [];
    const existing = store.audioTracks.find(track => track.cloudItemId === item.id);
    if (existing) {
      maybeAddToPlan(store, item, existing, 'audio', now);
      writeStore(store);
      return existing;
    }
    const track = {
      ...base,
      mediaUrl: `/media/audio/${fileName}`
    };
    store.audioTracks = [track, ...store.audioTracks];
    maybeAddToPlan(store, item, track, 'audio', now);
    writeStore(store);
    return track;
  }

  store.songs = store.songs || [];
  const existing = store.songs.find(song => song.cloudItemId === item.id);
  if (existing) {
    maybeAddToPlan(store, item, existing, 'song', now);
    writeStore(store);
    return existing;
  }
  const song = {
    ...base,
    sourceType: 'cloud_upload',
    mediaUrl: `/media/videos/${fileName}`,
    youtubeUrl: ''
  };
  store.songs = [song, ...store.songs];
  maybeAddToPlan(store, item, song, 'song', now);
  writeStore(store);
  return song;
}

function maybeAddToPlan(store, item, record, type, now) {
  if (!item.addToPlan || !record?.id) return;
  store.servicePlan = Array.isArray(store.servicePlan) ? store.servicePlan : [];
  const exists = store.servicePlan.some(planItem => planItem.payload?.cloudItemId === item.id);
  if (exists) return;

  const payload = type === 'audio'
    ? { audioId: record.id, cloudItemId: item.id }
    : { songId: record.id, cloudItemId: item.id };
  const planItem = {
    id: nanoid(10),
    type,
    title: record.title || item.title || 'Cloud media',
    payload,
    createdAt: now()
  };

  if (item.planPosition === 'start') {
    store.servicePlan.unshift(planItem);
    if (Number.isInteger(store.activePlanIndex) && store.activePlanIndex >= 0) store.activePlanIndex += 1;
  } else {
    store.servicePlan.push(planItem);
  }
}

function maybeAddSermonToPlan(store, item, sermon, now) {
  if (!item.addToPlan || !sermon?.id) return;
  store.servicePlan = Array.isArray(store.servicePlan) ? store.servicePlan : [];
  if (store.servicePlan.some(planItem => planItem.payload?.cloudItemId === item.id)) return;
  const planItem = {
    id: nanoid(10),
    type: 'sermon',
    title: sermon.title || item.title || 'Проповедь',
    payload: { sermonId: sermon.id, sermon, cloudItemId: item.id },
    createdAt: now()
  };
  if (item.planPosition === 'start') {
    store.servicePlan.unshift(planItem);
    if (Number.isInteger(store.activePlanIndex) && store.activePlanIndex >= 0) store.activePlanIndex += 1;
  } else {
    store.servicePlan.push(planItem);
  }
}

async function downloadToFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath, { flags: 'wx' }));
}

function uniqueTargetPath(folderPath, preferredName) {
  const ext = path.extname(preferredName);
  const base = path.basename(preferredName, ext);
  let fileName = preferredName;
  let targetPath = path.join(folderPath, fileName);
  let counter = 1;

  while (fs.existsSync(targetPath)) {
    fileName = `${base}-${counter}${ext}`;
    targetPath = path.join(folderPath, fileName);
    counter += 1;
  }

  return { fileName, targetPath };
}

async function apiJson(url, { token, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Cloud API failed: ${response.status}`);
  return data;
}

function fallbackExtension(item) {
  const mime = String(item.mimeType || '').toLowerCase();
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('wav')) return '.wav';
  const ext = path.extname(item.originalFileName || '').toLowerCase();
  if (VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext)) return ext;
  return item.kind === 'audio' ? '.mp3' : '.mp4';
}

function imageExtension(slide) {
  const ext = path.extname(slide.originalFileName || slide.fileName || '').toLowerCase();
  if (IMAGE_EXT.has(ext)) return ext;
  const mime = String(slide.mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('svg')) return '.svg';
  return '.jpg';
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const COOKIE_NAME = 'cms_portal_session';
const LANGUAGE_OPTIONS = [
  ['ru', 'Русский'],
  ['en', 'English'],
  ['sr', 'Srpski / Crnogorski'],
  ['ua', 'Українська'],
  ['ru/en', 'Русский + English'],
  ['guest', 'Гость / неизвестно'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['pl', 'Polski'],
  ['pt', 'Português'],
  ['nl', 'Dutch']
];
const CATEGORY_OPTIONS = [
  'Поклонение',
  'Фонограммы',
  'Фоновые песни',
  'Минусовки',
  'Гости / YouTube',
  'Обучение / Богослужение',
  'Обучение / Музыка',
  'Детское',
  'Праздники',
  'Разное'
];

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: error?.message, stack: error?.stack }));
      return json({ error: 'Internal server error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupStaleObjects(env));
  }
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (path === '/' && request.method === 'GET') return html(portalHtml());
  if (path === '/api/session' && request.method === 'POST') return createSession(request, env);
  if (path === '/api/session' && request.method === 'DELETE') return clearSession();
  if (path === '/api/me' && request.method === 'GET') return requirePortal(request, env, async () => json({ ok: true }));
  if (path === '/api/items' && request.method === 'GET') return requirePortal(request, env, () => listItems(env));
  if (path === '/api/uploads/create' && request.method === 'POST') return requirePortal(request, env, () => createUpload(request, env));
  if (path === '/api/sermons/create' && request.method === 'POST') return requirePortal(request, env, () => createSermonPackage(request, env));
  if (path === '/api/youtube' && request.method === 'POST') return requirePortal(request, env, () => createYouTubeItem(request, env));
  if (path.match(/^\/api\/uploads\/[^/]+\/complete$/) && request.method === 'POST') {
    const id = path.split('/')[3];
    return requirePortal(request, env, () => completeUpload(env, id));
  }
  if (path.match(/^\/api\/sermons\/[^/]+\/complete$/) && request.method === 'POST') {
    const id = path.split('/')[3];
    return requirePortal(request, env, () => completeSermonPackage(env, id));
  }
  if (path.match(/^\/api\/items\/[^/]+$/) && request.method === 'DELETE') {
    const id = path.split('/')[3];
    return requirePortal(request, env, () => deleteItem(env, id));
  }

  if (path === '/api/device/config' && request.method === 'GET') return requireDevice(request, env, () => deviceConfig(env));
  if (path === '/api/device/heartbeat' && request.method === 'POST') return requireDevice(request, env, () => heartbeat(request, env));
  if (path === '/api/device/pending' && request.method === 'GET') return requireDevice(request, env, () => devicePending(request, env));
  if (path.match(/^\/api\/device\/items\/[^/]+\/started$/) && request.method === 'POST') {
    const id = path.split('/')[4];
    return requireDevice(request, env, () => markDownloadStarted(request, env, id));
  }
  if (path.match(/^\/api\/device\/items\/[^/]+\/synced$/) && request.method === 'POST') {
    const id = path.split('/')[4];
    return requireDevice(request, env, () => markSynced(request, env, ctx, id));
  }
  if (path.match(/^\/api\/device\/items\/[^/]+\/failed$/) && request.method === 'POST') {
    const id = path.split('/')[4];
    return requireDevice(request, env, () => markFailed(request, env, id));
  }

  return json({ error: 'Not found' }, 404);
}

async function createSession(request, env) {
  if (!env.PORTAL_PASSWORD || !env.SESSION_SECRET) return json({ error: 'Portal secrets are not configured' }, 500);
  const body = await readJson(request);
  const ok = await timingSafeTextEqual(body.password || '', env.PORTAL_PASSWORD || '');
  if (!ok) return json({ error: 'Wrong password' }, 401);
  const token = await signSession(env, {
    sub: 'portal',
    exp: epochSeconds() + numberEnv(env.SESSION_TTL_SECONDS, 604800)
  });
  const headers = new Headers(JSON_HEADERS);
  headers.append('set-cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${numberEnv(env.SESSION_TTL_SECONDS, 604800)}`);
  return new Response(JSON.stringify({ ok: true }), { headers });
}

function clearSession() {
  const headers = new Headers(JSON_HEADERS);
  headers.append('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(JSON.stringify({ ok: true }), { headers });
}

async function requirePortal(request, env, handler) {
  if (!env.SESSION_SECRET) return json({ error: 'Portal session secret is not configured' }, 500);
  const token = parseCookies(request.headers.get('cookie') || '')[COOKIE_NAME];
  if (!token || !(await verifySession(env, token))) return json({ error: 'Unauthorized' }, 401);
  return handler();
}

async function requireDevice(request, env, handler) {
  if (!env.DEVICE_TOKEN) return json({ error: 'Device token is not configured' }, 500);
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ok = await timingSafeTextEqual(token, env.DEVICE_TOKEN || '');
  if (!ok) return json({ error: 'Unauthorized device' }, 401);
  return handler();
}

async function listItems(env) {
  const rows = await env.DB.prepare(
    `SELECT id, kind, title, language, category, tags_json, original_file_name, mime_type, size_bytes,
            source_url, add_to_plan, plan_position, status, error, created_at, uploaded_at, download_started_at, synced_at, synced_by, deleted_at
       FROM media_items
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 200`
  ).all();
  const sermonRows = await env.DB.prepare(
    `SELECT id, title, fit, slides_json, size_bytes, add_to_plan, plan_position, status, error,
            created_at, uploaded_at, download_started_at, synced_at, synced_by, deleted_at
       FROM sermon_packages
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100`
  ).all();
  const devices = await env.DB.prepare(
    `SELECT id, name, last_seen_at, current_version, updated_at
       FROM devices
      ORDER BY last_seen_at DESC
      LIMIT 20`
  ).all();
  const nowMs = Date.now();
  return json({
    items: [
      ...(rows.results || []).map(normalizeItem),
      ...(sermonRows.results || []).map(normalizeSermonItem)
    ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 200),
    devices: (devices.results || []).map(device => ({
      ...device,
      online: nowMs - new Date(device.last_seen_at).getTime() < 45000
    })),
    time: nowIso()
  });
}

async function createSermonPackage(request, env) {
  const body = await readJson(request);
  const inputSlides = Array.isArray(body.slides) ? body.slides.slice(0, 100) : [];
  if (!inputSlides.length) return json({ error: 'Добавьте хотя бы один слайд' }, 400);
  const invalidSlideIndex = inputSlides.findIndex(input => !isImageFile(input.mimeType, input.fileName));
  if (invalidSlideIndex !== -1) return json({ error: `Слайд ${invalidSlideIndex + 1}: поддерживаются только изображения` }, 400);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const slides = inputSlides.map((input, index) => {
    const fileName = cleanFileName(input.fileName || `slide-${index + 1}.jpg`);
    return {
      id: crypto.randomUUID(),
      order: index,
      title: cleanText(input.title) || fileName.replace(/\.[^.]+$/, ''),
      originalFileName: fileName,
      mimeType: cleanText(input.mimeType),
      sizeBytes: Math.max(0, Number(input.sizeBytes || 0)),
      r2Key: `incoming/sermons/${createdAt.slice(0, 10)}/${id}/${String(index + 1).padStart(3, '0')}-${fileName}`
    };
  });
  const totalSize = slides.reduce((sum, slide) => sum + slide.sizeBytes, 0);
  await env.DB.prepare(
    `INSERT INTO sermon_packages
      (id, title, fit, slides_json, size_bytes, add_to_plan, plan_position, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`
  ).bind(
    id,
    cleanText(body.title) || 'Новая проповедь',
    body.fit === 'cover' ? 'cover' : 'contain',
    JSON.stringify(slides),
    totalSize,
    body.addToPlan ? 1 : 0,
    normalizePlanPosition(body.planPosition),
    createdAt,
    createdAt
  ).run();
  const uploadSlides = [];
  for (const slide of slides) {
    uploadSlides.push({
      id: slide.id,
      order: slide.order,
      uploadUrl: await presignR2(env, 'PUT', slide.r2Key, numberEnv(env.UPLOAD_URL_TTL_SECONDS, 900))
    });
  }
  return json({ id, slides: uploadSlides, expiresIn: numberEnv(env.UPLOAD_URL_TTL_SECONDS, 900) }, 201);
}

async function completeSermonPackage(env, id) {
  const row = await env.DB.prepare(`SELECT * FROM sermon_packages WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
  if (!row) return json({ error: 'Проповедь не найдена' }, 404);
  const slides = safeJsonArray(row.slides_json);
  if (!slides.length) return json({ error: 'В проповеди нет слайдов' }, 400);
  let totalSize = 0;
  for (const [index, slide] of slides.entries()) {
    const object = await env.MEDIA_BUCKET.head(slide.r2Key);
    if (!object) return json({ error: `Слайд ${index + 1} не найден в R2` }, 409);
    slide.sizeBytes = object.size || slide.sizeBytes || 0;
    totalSize += slide.sizeBytes;
  }
  const updatedAt = nowIso();
  await env.DB.prepare(
    `UPDATE sermon_packages
        SET status = 'pending', slides_json = ?, size_bytes = ?, uploaded_at = ?, updated_at = ?, error = ''
      WHERE id = ?`
  ).bind(JSON.stringify(slides), totalSize, updatedAt, updatedAt, id).run();
  return json({ ok: true });
}

async function createUpload(request, env) {
  const body = await readJson(request);
  const kind = inferKind(body.kind, body.mimeType, body.fileName);
  if (!['video', 'audio'].includes(kind)) return json({ error: 'Only video/audio uploads are supported in this endpoint' }, 400);

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const fileName = cleanFileName(body.fileName || `${id}.${kind === 'audio' ? 'mp3' : 'mp4'}`);
  const ext = fileExtension(fileName);
  const r2Key = `incoming/${createdAt.slice(0, 10)}/${id}${ext}`;
  const tags = normalizeTags(body.tags);

  await env.DB.prepare(
    `INSERT INTO media_items
      (id, kind, title, language, category, tags_json, original_file_name, mime_type, size_bytes, r2_key, add_to_plan, plan_position, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`
  ).bind(
    id,
    kind,
    cleanText(body.title) || fileName,
    normalizeLanguage(body.language, 'ru'),
    normalizeCategory(body.category, kind === 'audio' ? 'Фонограммы' : 'Поклонение'),
    JSON.stringify(tags),
    fileName,
    cleanText(body.mimeType),
    Math.max(0, Number(body.sizeBytes || 0)),
    r2Key,
    body.addToPlan ? 1 : 0,
    normalizePlanPosition(body.planPosition),
    createdAt,
    createdAt
  ).run();

  const uploadUrl = await presignR2(env, 'PUT', r2Key, numberEnv(env.UPLOAD_URL_TTL_SECONDS, 900));
  return json({ id, kind, r2Key, uploadUrl, expiresIn: numberEnv(env.UPLOAD_URL_TTL_SECONDS, 900) }, 201);
}

async function createYouTubeItem(request, env) {
  const body = await readJson(request);
  const youtubeUrl = cleanText(body.youtubeUrl || body.sourceUrl);
  if (!isHttpUrl(youtubeUrl)) return json({ error: 'Valid YouTube URL is required' }, 400);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const tags = normalizeTags(body.tags || 'youtube');
  await env.DB.prepare(
    `INSERT INTO media_items
      (id, kind, title, language, category, tags_json, source_url, add_to_plan, plan_position, status, created_at, updated_at)
     VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    id,
    cleanText(body.title) || 'YouTube-песня',
    normalizeLanguage(body.language, 'guest'),
    normalizeCategory(body.category, 'Гости / YouTube'),
    JSON.stringify(tags),
    youtubeUrl,
    body.addToPlan ? 1 : 0,
    normalizePlanPosition(body.planPosition),
    createdAt,
    createdAt
  ).run();
  return json({ ok: true, id }, 201);
}

async function completeUpload(env, id) {
  const item = await findItem(env, id);
  if (!item) return json({ error: 'Item not found' }, 404);
  if (!item.r2_key) return json({ error: 'Item has no R2 object' }, 400);
  const object = await env.MEDIA_BUCKET.head(item.r2_key);
  if (!object) return json({ error: 'Uploaded object was not found in R2' }, 409);
  const updatedAt = nowIso();
  await env.DB.prepare(
    `UPDATE media_items
        SET status = 'pending',
            size_bytes = CASE WHEN size_bytes > 0 THEN size_bytes ELSE ? END,
            uploaded_at = ?,
            updated_at = ?,
            error = ''
      WHERE id = ?`
  ).bind(object.size || 0, updatedAt, updatedAt, id).run();
  return json({ ok: true, item: normalizeItem({ ...item, status: 'pending', uploaded_at: updatedAt, updated_at: updatedAt }) });
}

async function deleteItem(env, id) {
  const item = await findItem(env, id);
  if (!item) {
    const sermon = await env.DB.prepare(`SELECT * FROM sermon_packages WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
    if (!sermon) return json({ error: 'Item not found' }, 404);
    const updatedAt = nowIso();
    const slides = safeJsonArray(sermon.slides_json);
    if (sermon.status !== 'synced') await deleteSermonObjects(env, slides);
    await env.DB.prepare(
      `UPDATE sermon_packages
          SET deleted_at = ?, updated_at = ?, status = CASE WHEN status = 'synced' THEN status ELSE 'deleted' END
        WHERE id = ?`
    ).bind(updatedAt, updatedAt, id).run();
    return json({ ok: true });
  }
  const updatedAt = nowIso();
  if (item.r2_key && item.status !== 'synced') await env.MEDIA_BUCKET.delete(item.r2_key);
  await env.DB.prepare(
    `UPDATE media_items
        SET deleted_at = ?, updated_at = ?, status = CASE WHEN status = 'synced' THEN status ELSE 'deleted' END
      WHERE id = ?`
  ).bind(updatedAt, updatedAt, id).run();
  return json({ ok: true });
}

// Hand the authenticated mini PC its API keys so they never live in git.
// Keys are stored as Worker secrets (wrangler secret put OPENAI_API_KEY / GEMINI_API_KEY / CAPTIONKIT_API_KEY).
function deviceConfig(env) {
  return json({
    openaiApiKey: env.OPENAI_API_KEY || '',
    geminiApiKey: env.GEMINI_API_KEY || '',
    captionKitApiKey: env.CAPTIONKIT_API_KEY || ''
  });
}

async function heartbeat(request, env) {
  const body = await readJson(request);
  const deviceId = cleanText(body.deviceId) || 'mini-pc';
  const name = cleanText(body.name) || 'Church mini PC';
  const version = cleanText(body.version);
  const now = nowIso();
  const ip = request.headers.get('cf-connecting-ip') || '';
  await env.DB.prepare(
    `INSERT INTO devices (id, name, last_seen_at, current_version, last_ip, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       last_seen_at = excluded.last_seen_at,
       current_version = excluded.current_version,
       last_ip = excluded.last_ip,
       updated_at = excluded.updated_at`
  ).bind(deviceId, name, now, version, ip, now, now).run();
  const pending = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM media_items
        WHERE deleted_at IS NULL
          AND (status = 'pending' OR (status = 'downloading' AND julianday(download_started_at) < julianday('now', '-15 minutes'))))
      +
      (SELECT COUNT(*) FROM sermon_packages
        WHERE deleted_at IS NULL
          AND (status = 'pending' OR (status = 'downloading' AND julianday(download_started_at) < julianday('now', '-15 minutes')))) AS count`
  ).first();
  return json({ ok: true, deviceId, time: now, pendingCount: pending?.count || 0 });
}

async function devicePending(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(10, Math.max(1, Number(url.searchParams.get('limit') || 3)));
  const rows = await env.DB.prepare(
    `SELECT id, kind, title, language, category, tags_json, original_file_name, mime_type, size_bytes, r2_key, source_url, add_to_plan, plan_position, status, created_at
       FROM media_items
      WHERE deleted_at IS NULL
        AND (status = 'pending' OR (status = 'downloading' AND julianday(download_started_at) < julianday('now', '-15 minutes')))
      ORDER BY created_at ASC
      LIMIT ?`
  ).bind(limit).all();
  const sermonRows = await env.DB.prepare(
    `SELECT id, title, fit, slides_json, size_bytes, add_to_plan, plan_position, status, created_at
       FROM sermon_packages
      WHERE deleted_at IS NULL
        AND (status = 'pending' OR (status = 'downloading' AND julianday(download_started_at) < julianday('now', '-15 minutes')))
      ORDER BY created_at ASC
      LIMIT ?`
  ).bind(limit).all();
  const items = [];
  for (const row of rows.results || []) {
    items.push({
      ...normalizeItem(row),
      downloadUrl: row.r2_key ? await presignR2(env, 'GET', row.r2_key, numberEnv(env.DOWNLOAD_URL_TTL_SECONDS, 900)) : ''
    });
  }
  for (const row of sermonRows.results || []) {
    const sermon = normalizeSermonItem(row);
    const slides = [];
    for (const slide of sermon.slides) {
      slides.push({
        ...slide,
        downloadUrl: slide.r2Key ? await presignR2(env, 'GET', slide.r2Key, numberEnv(env.DOWNLOAD_URL_TTL_SECONDS, 900)) : ''
      });
    }
    items.push({ ...sermon, slides });
  }
  items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return json({ items: items.slice(0, limit), time: nowIso() });
}

async function markDownloadStarted(request, env, id) {
  const body = await readJson(request);
  const now = nowIso();
  const mediaResult = await env.DB.prepare(
    `UPDATE media_items
        SET status = 'downloading',
            download_started_at = ?,
            synced_by = ?,
            updated_at = ?,
            error = ''
      WHERE id = ? AND status IN ('pending', 'failed', 'downloading')`
  ).bind(now, cleanText(body.deviceId) || 'mini-pc', now, id).run();
  if (!mediaResult.meta?.changes) {
    await env.DB.prepare(
      `UPDATE sermon_packages
          SET status = 'downloading', download_started_at = ?, synced_by = ?, updated_at = ?, error = ''
        WHERE id = ? AND status IN ('pending', 'failed', 'downloading')`
    ).bind(now, cleanText(body.deviceId) || 'mini-pc', now, id).run();
  }
  return json({ ok: true });
}

async function markSynced(request, env, ctx, id) {
  const body = await readJson(request);
  const item = await findItem(env, id);
  const now = nowIso();
  if (item) {
    await env.DB.prepare(
      `UPDATE media_items
          SET status = 'synced', synced_at = ?, synced_by = ?, updated_at = ?, error = ''
        WHERE id = ?`
    ).bind(now, cleanText(body.deviceId) || 'mini-pc', now, id).run();
    if (item.r2_key) ctx.waitUntil(env.MEDIA_BUCKET.delete(item.r2_key));
    return json({ ok: true, deletedFromR2: Boolean(item.r2_key) });
  }
  const sermon = await env.DB.prepare(`SELECT * FROM sermon_packages WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
  if (!sermon) return json({ error: 'Item not found' }, 404);
  await env.DB.prepare(
    `UPDATE sermon_packages
        SET status = 'synced', synced_at = ?, synced_by = ?, updated_at = ?, error = ''
      WHERE id = ?`
  ).bind(now, cleanText(body.deviceId) || 'mini-pc', now, id).run();
  const slides = safeJsonArray(sermon.slides_json);
  ctx.waitUntil(deleteSermonObjects(env, slides));
  return json({ ok: true, deletedFromR2: slides.length > 0 });
}

async function markFailed(request, env, id) {
  const body = await readJson(request);
  const now = nowIso();
  const mediaResult = await env.DB.prepare(
    `UPDATE media_items
        SET status = 'failed',
            error = ?,
            updated_at = ?
      WHERE id = ?`
  ).bind(cleanText(body.error).slice(0, 1000), now, id).run();
  if (!mediaResult.meta?.changes) {
    await env.DB.prepare(
      `UPDATE sermon_packages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
    ).bind(cleanText(body.error).slice(0, 1000), now, id).run();
  }
  return json({ ok: true });
}

async function findItem(env, id) {
  return env.DB.prepare(`SELECT * FROM media_items WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
}

function normalizeItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    language: row.language,
    category: row.category,
    tags: safeJsonArray(row.tags_json),
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sourceUrl: row.source_url,
    addToPlan: Boolean(row.add_to_plan),
    planPosition: row.plan_position || 'end',
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    downloadStartedAt: row.download_started_at,
    syncedAt: row.synced_at,
    syncedBy: row.synced_by
  };
}

function normalizeSermonItem(row) {
  const slides = safeJsonArray(row.slides_json).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  return {
    id: row.id,
    kind: 'sermon',
    title: row.title,
    fit: row.fit === 'cover' ? 'cover' : 'contain',
    slides,
    slideCount: slides.length,
    sizeBytes: row.size_bytes,
    addToPlan: Boolean(row.add_to_plan),
    planPosition: row.plan_position || 'end',
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    downloadStartedAt: row.download_started_at,
    syncedAt: row.synced_at,
    syncedBy: row.synced_by
  };
}

function inferKind(kind, mimeType, fileName) {
  const requested = cleanText(kind).toLowerCase();
  if (['video', 'audio', 'youtube'].includes(requested)) return requested;
  const mime = cleanText(mimeType).toLowerCase();
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  const ext = fileExtension(fileName).toLowerCase();
  if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'].includes(ext)) return 'audio';
  return 'video';
}

function isImageFile(mimeType, fileName) {
  if (cleanText(mimeType).toLowerCase().startsWith('image/')) return true;
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(fileExtension(fileName));
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).slice(0, 20);
  return String(value || '').split(',').map(cleanText).filter(Boolean).slice(0, 20);
}

function normalizeLanguage(value, fallback) {
  const cleaned = cleanText(value);
  return LANGUAGE_OPTIONS.some(([code]) => code === cleaned) ? cleaned : fallback;
}

function normalizeCategory(value, fallback) {
  const cleaned = cleanText(value);
  return CATEGORY_OPTIONS.includes(cleaned) ? cleaned : fallback;
}

function normalizePlanPosition(value) {
  return value === 'start' ? 'start' : 'end';
}

async function cleanupStaleObjects(env) {
  const rows = await env.DB.prepare(
    `SELECT id, r2_key, status
       FROM media_items
      WHERE r2_key IS NOT NULL
        AND deleted_at IS NULL
        AND (
          status IN ('uploading', 'failed', 'deleted', 'synced')
          OR (status IN ('pending', 'downloading') AND julianday(created_at) < julianday('now', '-30 days'))
        )
        AND julianday(updated_at) < julianday('now', '-7 days')
      LIMIT 100`
  ).all();
  const now = nowIso();
  for (const row of rows.results || []) {
    try {
      await env.MEDIA_BUCKET.delete(row.r2_key);
      await env.DB.prepare(
        `UPDATE media_items
            SET deleted_at = COALESCE(deleted_at, ?),
                updated_at = ?,
                status = CASE WHEN status = 'synced' THEN status ELSE 'expired' END
          WHERE id = ?`
      ).bind(now, now, row.id).run();
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', message: 'cleanup_failed', id: row.id, error: error.message }));
    }
  }
  const sermonRows = await env.DB.prepare(
    `SELECT id, slides_json, status
       FROM sermon_packages
      WHERE deleted_at IS NULL
        AND (
          status IN ('uploading', 'failed', 'deleted', 'synced')
          OR (status IN ('pending', 'downloading') AND julianday(created_at) < julianday('now', '-30 days'))
        )
        AND julianday(updated_at) < julianday('now', '-7 days')
      LIMIT 50`
  ).all();
  for (const row of sermonRows.results || []) {
    try {
      const slides = safeJsonArray(row.slides_json);
      await deleteSermonObjects(env, slides);
      await env.DB.prepare(
        `UPDATE sermon_packages
            SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?,
                status = CASE WHEN status = 'synced' THEN status ELSE 'expired' END
          WHERE id = ?`
      ).bind(now, now, row.id).run();
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', message: 'sermon_cleanup_failed', id: row.id, error: error.message }));
    }
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function deleteSermonObjects(env, slides) {
  const keys = (slides || []).map(slide => slide.r2Key).filter(Boolean);
  if (keys.length) await env.MEDIA_BUCKET.delete(keys);
}

function cleanFileName(value) {
  const cleaned = cleanText(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 120);
  return cleaned || 'media-file';
}

function fileExtension(value) {
  const match = cleanText(value).match(/\.[a-z0-9]{1,8}$/i);
  return match ? match[0].toLowerCase() : '';
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function readJson(request) {
  if (!request.body) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function html(markup) {
  return new Response(markup, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function nowIso() {
  return new Date().toISOString();
}

function epochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) result[key] = rest.join('=');
  }
  return result;
}

async function signSession(env, payload) {
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacHex(env.SESSION_SECRET || '', encoded);
  return `${encoded}.${signature}`;
}

async function verifySession(env, token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return false;
  const expected = await hmacHex(env.SESSION_SECRET || '', encoded);
  if (!(await timingSafeTextEqual(signature, expected))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
    return payload.sub === 'portal' && Number(payload.exp || 0) > epochSeconds();
  } catch {
    return false;
  }
}

async function timingSafeTextEqual(left, right) {
  if (!right) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  const length = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

async function hmacBytes(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, typeof message === 'string' ? new TextEncoder().encode(message) : message);
  return new Uint8Array(sig);
}

async function presignR2(env, method, key, expiresSeconds) {
  const accountId = requiredEnv(env.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID');
  const bucket = requiredEnv(env.R2_BUCKET_NAME, 'R2_BUCKET_NAME');
  const accessKeyId = requiredEnv(env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv(env.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY');
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalUri = `/${encodePath(bucket)}/${encodePath(key)}`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host'
  };
  const canonicalQuery = canonicalQueryString(query);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, 'auto', 's3');
  const signature = bytesToHex(await hmacBytes(signingKey, stringToSign));
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function requiredEnv(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function sha256Hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(digest));
}

async function getSignatureKey(secret, dateStamp, region, service) {
  const kDate = await hmacBytes(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, service);
  return hmacBytes(kService, 'aws4_request');
}

function canonicalQueryString(params) {
  return Object.keys(params)
    .sort()
    .map(key => `${encodeRfc3986(key)}=${encodeRfc3986(params[key])}`)
    .join('&');
}

function encodePath(value) {
  return String(value).split('/').map(encodeRfc3986).join('/');
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function portalHtml() {
  const languageOptions = LANGUAGE_OPTIONS.map(([value, label]) => `<option value="${value}">${label} (${value})</option>`).join('');
  const categoryOptions = CATEGORY_OPTIONS.map(value => `<option value="${value}">${value}</option>`).join('');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Church Media Portal</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8f7;
      --panel: #ffffff;
      --text: #17201d;
      --muted: #62706b;
      --border: #dfe5e2;
      --accent: #0f766e;
      --accent-strong: #0b5d56;
      --danger: #a43d33;
      --pending: #9a6a10;
      --ok: #136f45;
      --shadow: 0 14px 40px rgba(23, 32, 29, 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    button, input, select { font: inherit; }
    .shell { min-height: 100vh; padding: 28px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
    h1 { font-size: 28px; line-height: 1.1; margin: 0; letter-spacing: 0; }
    h2 { font-size: 17px; margin: 0 0 14px; letter-spacing: 0; }
    p { color: var(--muted); margin: 6px 0 0; line-height: 1.5; }
    .layout { display: grid; grid-template-columns: minmax(320px, 430px) 1fr; gap: 18px; align-items: start; }
    .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); padding: 18px; }
    .sermon-workspace { margin-bottom: 18px; padding: 24px; }
    .sermon-workspace-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
    .sermon-workspace-head h2 { font-size: 24px; margin-bottom: 5px; }
    .sermon-builder { display: grid; grid-template-columns: minmax(260px, 330px) minmax(0, 1fr); gap: 24px; align-items: start; }
    .sermon-controls { display: grid; gap: 12px; position: sticky; top: 18px; }
    .sermon-canvas { min-width: 0; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: #f4f7f5; }
    .sermon-canvas-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
    .sermon-canvas-head strong { font-size: 15px; }
    .stack { display: grid; gap: 18px; }
    .form { display: grid; gap: 12px; }
    label { display: grid; gap: 6px; color: #3d4a45; font-size: 13px; font-weight: 650; }
    label.checkline { display: flex; align-items: center; gap: 10px; font-weight: 750; }
    label.checkline input { width: 18px; height: 18px; }
    input, select {
      width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 11px 12px;
      background: #fbfcfb; color: var(--text); outline: none;
    }
    input:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.13); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .button-row { display: flex; gap: 10px; flex-wrap: wrap; }
    button {
      border: 1px solid var(--border); background: #fff; color: var(--text); border-radius: 8px; padding: 10px 13px;
      font-size: 14px; font-weight: 700; cursor: pointer; min-height: 40px;
    }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.primary:hover { background: var(--accent-strong); }
    button.danger { color: var(--danger); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .login { max-width: 420px; margin: 12vh auto; }
    .status-strip { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 999px; font-size: 12px; font-weight: 750; background: #eef3f1; color: #41504b; }
    .badge.ok { background: #e8f5ee; color: var(--ok); }
    .badge.warn { background: #fff3d8; color: var(--pending); }
    .badge.danger { background: #fbe9e7; color: var(--danger); }
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
    .queue-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; }
    th { background: #f5f7f6; color: #46534f; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    tr:last-child td { border-bottom: 0; }
    .item-title { font-weight: 800; margin-bottom: 4px; }
    .muted { color: var(--muted); font-size: 12px; }
    .progress { height: 8px; background: #e8eeeb; border-radius: 999px; overflow: hidden; }
    .progress > span { display: block; height: 100%; background: var(--accent); width: 0%; transition: width 160ms ease; }
    .slide-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .slide-row { position: relative; display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 11px; border: 1px solid var(--border); border-radius: 12px; background: #fff; cursor: grab; transition: opacity .15s ease, transform .15s ease, border-color .15s ease, box-shadow .15s ease; }
    .slide-row:active { cursor: grabbing; }
    .slide-row.dragging { opacity: .42; transform: scale(.98); }
    .slide-row.drag-target { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(15, 118, 110, .16); }
    .slide-number { position: absolute; z-index: 3; top: 18px; left: 18px; display: grid; place-items: center; min-width: 34px; height: 34px; padding: 0 7px; border-radius: 999px; background: #dcefeb; color: var(--accent-strong); font-weight: 850; box-shadow: 0 3px 12px rgba(0,0,0,.16); }
    .slide-drag-handle { position: absolute; z-index: 3; top: 18px; right: 18px; padding: 7px 10px; border-radius: 999px; background: rgba(0,0,0,.72); color: #fff; font-size: 11px; font-weight: 800; pointer-events: none; }
    .slide-thumb-button { display: block; width: 100%; min-height: 0; padding: 0; overflow: hidden; border-radius: 9px; border: 1px solid #cfd8d4; background: #101715; }
    .slide-thumb { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #101715; }
    .slide-copy { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-width: 0; padding: 1px 2px; }
    .slide-copy .item-title { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
    .slide-copy .muted { flex: 0 0 auto; white-space: nowrap; }
    .slide-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
    .slide-actions button { min-height: 34px; padding: 6px 9px; }
    .preview-modal { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(5, 12, 10, .88); }
    .preview-modal-card { position: relative; width: min(1100px, 100%); display: grid; gap: 10px; }
    .preview-modal img { display: block; width: 100%; max-height: 82vh; object-fit: contain; border-radius: 10px; background: #000; }
    .preview-modal strong { color: #fff; text-align: center; overflow-wrap: anywhere; }
    .preview-close { position: absolute; z-index: 2; top: 12px; right: 12px; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 999px; background: rgba(0,0,0,.72); color: #fff; font-size: 25px; }
    .hidden { display: none !important; }
    .empty { padding: 28px; text-align: center; color: var(--muted); }
    @media (min-width: 1450px) {
      .slide-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 900px) {
      .shell { padding: 18px; }
      header { align-items: flex-start; flex-direction: column; }
      .layout { grid-template-columns: 1fr; }
      .row { grid-template-columns: 1fr; }
      .sermon-builder { grid-template-columns: 1fr; }
      .sermon-controls { position: static; }
    }
    @media (max-width: 720px) {
      body { background: #fff; }
      .shell { padding: 12px; }
      .login { margin: 10vh auto; }
      header { gap: 12px; margin-bottom: 14px; }
      h1 { font-size: 24px; }
      h2 { font-size: 16px; }
      p { font-size: 14px; }
      .panel { border-radius: 8px; padding: 14px; box-shadow: none; }
      .layout, .stack { gap: 12px; }
      .button-row { display: grid; grid-template-columns: 1fr 1fr; width: 100%; }
      .button-row button, .form button { width: 100%; min-height: 46px; }
      label { font-size: 12px; }
      input, select { min-height: 46px; font-size: 16px; padding: 10px 11px; }
      label.checkline { align-items: flex-start; line-height: 1.35; }
      label.checkline input { flex: 0 0 20px; width: 20px; height: 20px; margin-top: 1px; }
      .status-strip { display: grid; grid-template-columns: 1fr; align-items: stretch; }
      .badge { width: max-content; max-width: 100%; white-space: normal; }
      .queue-head { align-items: flex-start; flex-direction: column; }
      .table-wrap { overflow: visible; border: 0; border-radius: 0; }
      table { min-width: 0; display: block; }
      thead { display: none; }
      tbody { display: grid; gap: 10px; }
      tr {
        display: block;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #fff;
        padding: 10px;
      }
      td {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        border-bottom: 0;
        padding: 7px 0;
        font-size: 13px;
      }
      td::before {
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      td:nth-child(1)::before { content: "Материал"; }
      td:nth-child(2)::before { content: "Тип"; }
      td:nth-child(3)::before { content: "Размер"; }
      td:nth-child(4)::before { content: "Статус"; }
      td:nth-child(5)::before { content: "Время"; }
      td:nth-child(6)::before { content: ""; }
      td:nth-child(6) { grid-template-columns: 1fr; padding-top: 10px; }
      td:nth-child(6) button { width: 100%; min-height: 42px; }
      .item-title { overflow-wrap: anywhere; }
      .muted { overflow-wrap: anywhere; }
      .sermon-workspace { padding: 14px; }
      .sermon-workspace-head { align-items: flex-start; flex-direction: column; }
      .sermon-workspace-head h2 { font-size: 20px; }
      .sermon-canvas { padding: 10px; }
      .slide-list { grid-template-columns: 1fr; }
      .slide-row { gap: 8px; }
      .slide-thumb-button { width: 100%; }
      .slide-copy { align-items: flex-start; flex-direction: column; gap: 3px; }
      .slide-copy .item-title { width: 100%; }
      .slide-actions button { min-width: 48px; }
      .preview-modal { padding: 10px; }
    }
    @media (max-width: 420px) {
      .shell { padding: 8px; }
      .panel { padding: 12px; }
      .button-row { grid-template-columns: 1fr; }
      td { grid-template-columns: 78px minmax(0, 1fr); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section id="login" class="panel login hidden">
      <h1>Church Media Portal</h1>
      <p>Введите пароль, чтобы отправить песни или готовую проповедь на mini PC.</p>
      <form id="loginForm" class="form" style="margin-top: 18px">
        <label>Пароль портала<input id="password" type="password" autocomplete="current-password" required /></label>
        <button class="primary" type="submit">Войти</button>
        <p id="loginError" class="muted"></p>
      </form>
    </section>

    <section id="app" class="hidden">
      <header>
        <div>
          <h1>Church Media Portal</h1>
          <p>Песни, фонограммы и готовые проповеди для церковного mini PC.</p>
        </div>
        <div class="button-row">
          <button id="refreshBtn">Обновить</button>
          <button id="logoutBtn">Выйти</button>
        </div>
      </header>

      <section class="panel sermon-workspace">
        <div class="sermon-workspace-head">
          <div>
            <h2>Подготовить проповедь</h2>
            <p>Выберите готовые слайды, визуально расставьте их по порядку и отправьте одним пакетом.</p>
          </div>
          <span class="badge">Полноширинный редактор</span>
        </div>
        <form id="sermonForm" class="sermon-builder">
          <div class="sermon-controls">
            <label>Слайды<input id="sermonFiles" type="file" accept="image/*,.jpg,.jpeg,.png,.webp" multiple /></label>
            <label>Название<input id="sermonTitle" placeholder="Например: Живая надежда" required /></label>
            <label>Отображение
              <select id="sermonFit"><option value="contain">Вместить целиком</option><option value="cover">Заполнить экран</option></select>
            </label>
            <label class="checkline"><input id="sermonAddToPlan" type="checkbox" /> Сразу добавить проповедь в план mini PC</label>
            <label>Позиция в плане
              <select id="sermonPlanPosition"><option value="end">В конец плана</option><option value="start">В начало плана</option></select>
            </label>
            <button id="sermonUploadBtn" class="primary" type="submit" disabled>Отправить проповедь</button>
            <div class="progress hidden" id="sermonProgress"><span></span></div>
            <p id="sermonStatus" class="muted">Добавьте слайды в нужной последовательности.</p>
          </div>
          <div class="sermon-canvas">
            <div class="sermon-canvas-head"><strong>Последовательность слайдов · перетащите карточку мышкой</strong><span id="sermonSlideCount" class="badge">0 слайдов</span></div>
            <div id="sermonSlideList" class="slide-list"></div>
            <div id="sermonSlideEmpty" class="empty">Выберите изображения — здесь появится большая визуальная раскладка проповеди.</div>
          </div>
        </form>
      </section>

      <div class="layout">
        <div class="stack">
          <section class="panel">
            <h2>Загрузить материал</h2>
            <form id="uploadForm" class="form">
              <label>Файл<input id="file" type="file" accept="video/*,audio/*,.mp4,.mp3,.wav,.m4a,.aac,.flac,.webm" required /></label>
              <label>Название<input id="title" placeholder="Название песни" /></label>
              <div class="row">
                <label>Язык<select id="language">${languageOptions}</select></label>
                <label>Категория<select id="category">${categoryOptions}</select></label>
              </div>
              <label>Теги<input id="tags" placeholder="гость, воскресенье" /></label>
              <label class="checkline"><input id="addToPlan" type="checkbox" /> Добавить в план на mini PC после скачивания</label>
              <label>Позиция в плане
                <select id="planPosition">
                  <option value="end">В конец плана</option>
                  <option value="start">В начало плана</option>
                </select>
              </label>
              <button id="uploadBtn" class="primary" type="submit">Загрузить в очередь</button>
              <div class="progress hidden" id="progress"><span></span></div>
              <p id="uploadStatus" class="muted"></p>
            </form>
          </section>

          <section class="panel">
            <h2>Mini PC</h2>
            <div id="devices" class="status-strip"></div>
          </section>

          <section class="panel">
            <h2>YouTube-ссылка</h2>
            <form id="youtubeForm" class="form">
              <label>Ссылка<input id="youtubeUrl" placeholder="https://youtube.com/watch?v=..." /></label>
              <label>Название<input id="youtubeTitle" placeholder="Гостевая песня" /></label>
              <div class="row">
                <label>Язык<select id="youtubeLanguage">${languageOptions}</select></label>
                <label>Категория<select id="youtubeCategory">${categoryOptions}</select></label>
              </div>
              <label class="checkline"><input id="youtubeAddToPlan" type="checkbox" /> Добавить в план на mini PC</label>
              <label>Позиция в плане
                <select id="youtubePlanPosition">
                  <option value="end">В конец плана</option>
                  <option value="start">В начало плана</option>
                </select>
              </label>
              <button type="submit">Добавить ссылку в очередь</button>
              <p id="youtubeStatus" class="muted"></p>
            </form>
          </section>
        </div>

        <section class="panel">
          <div class="queue-head">
            <h2 style="margin:0">Очередь</h2>
            <span id="count" class="badge">0 файлов</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Материал</th><th>Тип</th><th>Размер</th><th>Статус</th><th>Время</th><th></th></tr></thead>
              <tbody id="items"></tbody>
            </table>
          </div>
          <div id="empty" class="empty hidden">Очередь пустая. Загруженные файлы появятся здесь.</div>
        </section>
      </div>
    </section>
  </main>
  <div id="slidePreviewModal" class="preview-modal hidden" role="dialog" aria-modal="true" aria-label="Предпросмотр слайда">
    <div class="preview-modal-card">
      <button id="slidePreviewClose" class="preview-close" type="button" aria-label="Закрыть">×</button>
      <img id="slidePreviewImage" alt="Предпросмотр слайда" />
      <strong id="slidePreviewTitle"></strong>
    </div>
  </div>

  <script>
    const login = document.getElementById('login');
    const app = document.getElementById('app');
    const itemsBody = document.getElementById('items');
    const empty = document.getElementById('empty');
    const count = document.getElementById('count');
    const uploadForm = document.getElementById('uploadForm');
    const progress = document.getElementById('progress');
    const progressBar = progress.querySelector('span');
    const sermonForm = document.getElementById('sermonForm');
    const sermonSlideList = document.getElementById('sermonSlideList');
    const sermonProgress = document.getElementById('sermonProgress');
    const sermonProgressBar = sermonProgress.querySelector('span');
    let sermonFiles = [];
    let draggedSermonIndex = -1;
    const sermonPreviewUrls = new Map();

    async function api(path, options = {}) {
      const response = await fetch(path, options);
      if (response.status === 401) throw new Error('unauthorized');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    async function boot() {
      try {
        await api('/api/me');
        login.classList.add('hidden');
        app.classList.remove('hidden');
        await load();
      } catch {
        app.classList.add('hidden');
        login.classList.remove('hidden');
      }
    }

    async function load() {
      const data = await api('/api/items');
      renderDevices(data.devices || []);
      renderItems(data.items || []);
    }

    function renderDevices(devices) {
      const root = document.getElementById('devices');
      if (!devices.length) {
        root.innerHTML = '<span class="badge danger">mini PC еще не подключался</span>';
        return;
      }
      root.innerHTML = devices.map(device => {
        const cls = device.online ? 'ok' : 'danger';
        const text = device.online ? 'online' : 'offline';
        return '<span class="badge ' + cls + '">' + escapeHtml(device.name) + ': ' + text + '</span><span class="muted">last seen ' + formatDate(device.last_seen_at) + '</span>';
      }).join('');
    }

    function renderItems(items) {
      count.textContent = items.length + ' материалов';
      empty.classList.toggle('hidden', items.length !== 0);
      itemsBody.innerHTML = items.map(item => {
        const status = statusBadge(item.status, item.error);
        return '<tr>' +
          '<td><div class="item-title">' + escapeHtml(item.title) + '</div><div class="muted">' + escapeHtml(item.kind === 'sermon' ? ((item.slideCount || 0) + ' слайдов') : (item.originalFileName || '')) + '</div><div class="muted">' + escapeHtml([item.language, item.category, (item.tags || []).join(', ')].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td>' + escapeHtml(item.kind === 'sermon' ? 'проповедь' : item.kind) + '</td>' +
          '<td>' + formatSize(item.sizeBytes || 0) + '</td>' +
          '<td>' + status + (item.addToPlan ? '<div class="muted">+ в план · ' + escapeHtml(item.planPosition === 'start' ? 'начало' : 'конец') + '</div>' : '') + '</td>' +
          '<td><div class="muted">создан ' + formatDate(item.createdAt) + '</div>' + (item.syncedAt ? '<div class="muted">скачан ' + formatDate(item.syncedAt) + '</div>' : '') + '</td>' +
          '<td><button class="danger" data-delete="' + item.id + '">Удалить</button></td>' +
        '</tr>';
      }).join('');
    }

    function statusBadge(status, error) {
      if (status === 'synced') return '<span class="badge ok">скачано</span>';
      if (status === 'pending') return '<span class="badge warn">ждет mini PC</span>';
      if (status === 'downloading') return '<span class="badge warn">скачивается</span>';
      if (status === 'uploading') return '<span class="badge warn">загрузка</span>';
      if (status === 'failed') return '<span class="badge danger" title="' + escapeHtml(error || '') + '">ошибка</span>';
      return '<span class="badge">' + escapeHtml(status) + '</span>';
    }

    uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = document.getElementById('file').files[0];
      if (!file) return;
      const uploadBtn = document.getElementById('uploadBtn');
      uploadBtn.disabled = true;
      progress.classList.remove('hidden');
      progressBar.style.width = '0%';
      document.getElementById('uploadStatus').textContent = 'Готовлю временную ссылку...';
      try {
        const created = await api('/api/uploads/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            title: document.getElementById('title').value || file.name.replace(/\\.[^.]+$/, ''),
            language: document.getElementById('language').value,
            category: document.getElementById('category').value,
            tags: document.getElementById('tags').value,
            addToPlan: document.getElementById('addToPlan').checked,
            planPosition: document.getElementById('planPosition').value
          })
        });
        await putFile(created.uploadUrl, file);
        await api('/api/uploads/' + created.id + '/complete', { method: 'POST' });
        uploadForm.reset();
        document.getElementById('language').value = 'ru';
        document.getElementById('category').value = 'Поклонение';
        document.getElementById('uploadStatus').textContent = 'Файл в очереди. Mini PC скачает его при включении.';
        await load();
      } catch (error) {
        if (error.message === 'unauthorized') return boot();
        document.getElementById('uploadStatus').textContent = error.message;
      } finally {
        uploadBtn.disabled = false;
      }
    });

    function putFile(url, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        if (file.type) xhr.setRequestHeader('content-type', file.type);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            if (onProgress) onProgress(percent);
            else progressBar.style.width = percent + '%';
          }
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('R2 upload failed: ' + xhr.status));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
      });
    }

    document.getElementById('sermonFiles').addEventListener('change', (event) => {
      sermonFiles = [...sermonFiles, ...Array.from(event.target.files || []).filter(file => file.type.startsWith('image/'))];
      event.target.value = '';
      renderSermonFiles();
    });

    sermonSlideList.addEventListener('click', (event) => {
      const previewIndex = Number(event.target?.dataset?.slidePreview);
      if (Number.isInteger(previewIndex) && sermonFiles[previewIndex]) {
        openSermonPreview(previewIndex);
        return;
      }
      const index = Number(event.target?.dataset?.slideIndex);
      const action = event.target?.dataset?.slideAction;
      if (!Number.isInteger(index) || !action) return;
      if (action === 'remove') {
        revokeSermonPreview(sermonFiles[index]);
        sermonFiles.splice(index, 1);
      }
      if (action === 'up' && index > 0) [sermonFiles[index - 1], sermonFiles[index]] = [sermonFiles[index], sermonFiles[index - 1]];
      if (action === 'down' && index < sermonFiles.length - 1) [sermonFiles[index + 1], sermonFiles[index]] = [sermonFiles[index], sermonFiles[index + 1]];
      renderSermonFiles();
    });

    sermonSlideList.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-slide-card]');
      if (!card) return;
      draggedSermonIndex = Number(card.dataset.slideCard);
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(draggedSermonIndex));
    });

    sermonSlideList.addEventListener('dragover', (event) => {
      if (draggedSermonIndex < 0) return;
      const card = event.target.closest('[data-slide-card]');
      if (!card || Number(card.dataset.slideCard) === draggedSermonIndex) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      sermonSlideList.querySelectorAll('.drag-target').forEach(item => item.classList.remove('drag-target'));
      card.classList.add('drag-target');
    });

    sermonSlideList.addEventListener('drop', (event) => {
      const card = event.target.closest('[data-slide-card]');
      const targetIndex = card ? Number(card.dataset.slideCard) : -1;
      event.preventDefault();
      if (draggedSermonIndex < 0 || targetIndex < 0 || targetIndex === draggedSermonIndex) return clearSermonDragState();
      const [movedFile] = sermonFiles.splice(draggedSermonIndex, 1);
      sermonFiles.splice(targetIndex, 0, movedFile);
      clearSermonDragState();
      renderSermonFiles();
    });

    sermonSlideList.addEventListener('dragend', clearSermonDragState);

    function clearSermonDragState() {
      draggedSermonIndex = -1;
      sermonSlideList.querySelectorAll('.dragging, .drag-target').forEach(item => item.classList.remove('dragging', 'drag-target'));
    }

    function renderSermonFiles() {
      document.getElementById('sermonUploadBtn').disabled = sermonFiles.length === 0;
      document.getElementById('sermonSlideCount').textContent = sermonFiles.length + (sermonFiles.length === 1 ? ' слайд' : ' слайдов');
      document.getElementById('sermonSlideEmpty').classList.toggle('hidden', sermonFiles.length !== 0);
      sermonSlideList.innerHTML = sermonFiles.map((file, index) =>
        '<div class="slide-row" draggable="true" data-slide-card="' + index + '"><span class="slide-number">' + (index + 1) + '</span><span class="slide-drag-handle">⋮⋮ Перетащить</span>' +
        '<button class="slide-thumb-button" type="button" data-slide-preview="' + index + '" title="Открыть крупный предпросмотр"><img class="slide-thumb" src="' + escapeHtml(sermonPreviewUrl(file)) + '" alt="Слайд ' + (index + 1) + '" data-slide-preview="' + index + '" /></button>' +
        '<div class="slide-copy"><div class="item-title">' + escapeHtml(file.name) + '</div><div class="muted">Слайд ' + (index + 1) + ' · ' + formatSize(file.size) + '</div></div>' +
        '<div class="slide-actions">' +
        '<button type="button" data-slide-action="up" data-slide-index="' + index + '"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" data-slide-action="down" data-slide-index="' + index + '"' + (index === sermonFiles.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="danger" data-slide-action="remove" data-slide-index="' + index + '">×</button>' +
        '</div></div>'
      ).join('');
    }

    function sermonPreviewUrl(file) {
      if (!sermonPreviewUrls.has(file)) sermonPreviewUrls.set(file, URL.createObjectURL(file));
      return sermonPreviewUrls.get(file);
    }

    function revokeSermonPreview(file) {
      const url = sermonPreviewUrls.get(file);
      if (url) URL.revokeObjectURL(url);
      sermonPreviewUrls.delete(file);
    }

    function openSermonPreview(index) {
      const file = sermonFiles[index];
      if (!file) return;
      document.getElementById('slidePreviewImage').src = sermonPreviewUrl(file);
      document.getElementById('slidePreviewTitle').textContent = (index + 1) + '. ' + file.name;
      document.getElementById('slidePreviewModal').classList.remove('hidden');
    }

    function closeSermonPreview() {
      document.getElementById('slidePreviewModal').classList.add('hidden');
      document.getElementById('slidePreviewImage').removeAttribute('src');
    }

    document.getElementById('slidePreviewClose').addEventListener('click', closeSermonPreview);
    document.getElementById('slidePreviewModal').addEventListener('click', event => {
      if (event.target.id === 'slidePreviewModal') closeSermonPreview();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSermonPreview();
    });
    window.addEventListener('beforeunload', () => {
      for (const url of sermonPreviewUrls.values()) URL.revokeObjectURL(url);
    });

    sermonForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!sermonFiles.length) return;
      const uploadButton = document.getElementById('sermonUploadBtn');
      const status = document.getElementById('sermonStatus');
      uploadButton.disabled = true;
      sermonProgress.classList.remove('hidden');
      sermonProgressBar.style.width = '0%';
      status.textContent = 'Готовлю пакет проповеди...';
      try {
        const created = await api('/api/sermons/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('sermonTitle').value,
            fit: document.getElementById('sermonFit').value,
            addToPlan: document.getElementById('sermonAddToPlan').checked,
            planPosition: document.getElementById('sermonPlanPosition').value,
            slides: sermonFiles.map(file => ({ fileName: file.name, title: file.name.replace(/\.[^.]+$/, ''), mimeType: file.type, sizeBytes: file.size }))
          })
        });
        for (const [index, upload] of created.slides.entries()) {
          const file = sermonFiles[index];
          status.textContent = 'Загружаю слайд ' + (index + 1) + ' из ' + sermonFiles.length + '...';
          await putFile(upload.uploadUrl, file, percent => {
            const overall = Math.round(((index + percent / 100) / sermonFiles.length) * 100);
            sermonProgressBar.style.width = overall + '%';
          });
        }
        await api('/api/sermons/' + created.id + '/complete', { method: 'POST' });
        for (const file of sermonFiles) revokeSermonPreview(file);
        sermonFiles = [];
        sermonForm.reset();
        renderSermonFiles();
        sermonProgressBar.style.width = '100%';
        status.textContent = 'Проповедь в очереди. Mini PC скачает все слайды при включении.';
        await load();
      } catch (error) {
        if (error.message === 'unauthorized') return boot();
        status.textContent = error.message;
      } finally {
        uploadButton.disabled = sermonFiles.length === 0;
      }
    });

    document.getElementById('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: document.getElementById('password').value })
        });
        document.getElementById('loginError').textContent = '';
        await boot();
      } catch (error) {
        document.getElementById('loginError').textContent = error.message === 'unauthorized' ? 'Неверный пароль' : error.message;
      }
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/session', { method: 'DELETE' });
      await boot();
    });
    document.getElementById('youtubeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/youtube', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl: document.getElementById('youtubeUrl').value,
            title: document.getElementById('youtubeTitle').value,
            language: document.getElementById('youtubeLanguage').value,
            category: document.getElementById('youtubeCategory').value,
            addToPlan: document.getElementById('youtubeAddToPlan').checked,
            planPosition: document.getElementById('youtubePlanPosition').value
          })
        });
        document.getElementById('youtubeForm').reset();
        document.getElementById('youtubeLanguage').value = 'guest';
        document.getElementById('youtubeCategory').value = 'Гости / YouTube';
        document.getElementById('youtubeStatus').textContent = 'Ссылка добавлена. Mini PC зарегистрирует ее при включении.';
        await load();
      } catch (error) {
        document.getElementById('youtubeStatus').textContent = error.message;
      }
    });
    document.getElementById('refreshBtn').addEventListener('click', load);
    itemsBody.addEventListener('click', async (event) => {
      const id = event.target?.dataset?.delete;
      if (!id || !confirm('Удалить этот материал из очереди?')) return;
      await api('/api/items/' + id, { method: 'DELETE' });
      await load();
    });
    setInterval(() => app.classList.contains('hidden') ? undefined : load().catch(() => {}), 10000);
    boot();

    function formatSize(bytes) {
      if (!bytes) return '-';
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = bytes;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
      return value.toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
    }

    function formatDate(value) {
      if (!value) return '-';
      return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
    }
  </script>
</body>
</html>`;
}

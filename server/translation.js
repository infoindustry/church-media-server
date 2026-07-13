// Live translation hub: captures source audio (PCM16 24kHz) over WebSocket,
// feeds one realtime session per target language, and fans translated
// subtitles out to the TV and audience phones over SSE.

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import os from 'os';

const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-translate';
const GEMINI_MODEL = process.env.GEMINI_REALTIME_MODEL || 'gemini-3.5-live-translate-preview';
const MAX_BUFFER_CHARS = 1600;
const AUDIO_CHUNK_MS = 100;
const MAX_QUEUED_AUDIO_MS = Number(process.env.TRANSLATION_MAX_QUEUE_MS || 5000);
const MAX_QUEUED_CHUNKS = Math.max(1, Math.ceil(MAX_QUEUED_AUDIO_MS / AUDIO_CHUNK_MS));
const RECONNECT_BASE_MS = Number(process.env.TRANSLATION_RECONNECT_BASE_MS || 1000);
const RECONNECT_MAX_MS = Number(process.env.TRANSLATION_RECONNECT_MAX_MS || 15000);
const FAILOVER_AFTER_ATTEMPTS = Number(process.env.TRANSLATION_FAILOVER_ATTEMPTS || 3);
const AUDIO_STALE_MS = Number(process.env.TRANSLATION_AUDIO_STALE_MS || 3000);
const TRANSCRIPT_STALE_MS = Number(process.env.TRANSLATION_TRANSCRIPT_STALE_MS || 20000);

function toBcp47(lang) {
  const map = { zh: 'zh-Hans', pt: 'pt-BR' };
  return map[lang] || lang;
}

function downsamplePcm16Base64(base64, inRate = 24000, outRate = 16000) {
  if (inRate === outRate) return base64;
  const inBuf = Buffer.from(base64, 'base64');
  const inLen = inBuf.length >> 1;
  const outLen = Math.floor(inLen * outRate / inRate);
  const out = Buffer.allocUnsafe(outLen * 2);
  const ratio = inRate / outRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = inBuf.readInt16LE(idx * 2);
    const b = (idx + 1) < inLen ? inBuf.readInt16LE((idx + 1) * 2) : a;
    out.writeInt16LE((a + (b - a) * frac) | 0, i * 2);
  }
  return out.toString('base64');
}

export function sanitizeLang(code) {
  return String(code || '').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 8);
}

export function getLanUrls(port) {
  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}

class QueuedSession extends EventEmitter {
  constructor(lang) {
    super();
    this.lang = lang;
    this.ready = false;
    this.closedByUser = false;
    this.queue = [];
    this.ws = null;
  }
  enqueue(base64) {
    this.queue.push(base64);
    if (this.queue.length > MAX_QUEUED_CHUNKS) this.queue.splice(0, this.queue.length - MAX_QUEUED_CHUNKS);
  }
  flush() {
    const chunks = this.queue;
    this.queue = [];
    for (const chunk of chunks) this._send(chunk);
  }
  appendAudio(base64) {
    if (this.ready) this._send(base64);
    else this.enqueue(base64);
  }
  close() {
    this.closedByUser = true;
    this.ready = false;
    this.queue = [];
    try { if (this.ws) this.ws.close(); } catch {}
  }
}

class StubSession extends EventEmitter {
  constructor(lang) {
    super();
    this.lang = lang;
    this.open = true;
    const words = ['[stub]', lang.toUpperCase(), 'live', 'subtitle', 'pipeline', 'works', '·'];
    let i = 0;
    queueMicrotask(() => this.emit('status', 'open'));
    this.timer = setInterval(() => {
      if (this.open) this.emit('transcript', { delta: words[i++ % words.length] + ' ' });
    }, 1000);
  }
  appendAudio() {}
  close() {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.timer);
    this.emit('closed', { intentional: true });
  }
}

class OpenAISession extends QueuedSession {
  constructor(lang, apiKey) {
    super(lang);
    if (!apiKey) {
      queueMicrotask(() => {
        this.emit('status', 'error: OPENAI_API_KEY is not set');
        this.emit('closed', { intentional: false, reason: 'missing_api_key' });
      });
      return;
    }
    this.ws = new WebSocket(`wss://api.openai.com/v1/realtime/translations?model=${OPENAI_MODEL}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    this.ws.on('open', () => {
      this.ws.send(JSON.stringify({ type: 'session.update', session: { audio: { output: { language: lang } } } }));
      this.ready = true;
      this.flush();
      this.emit('status', 'open');
    });
    this.ws.on('message', (data) => {
      let ev;
      try { ev = JSON.parse(data.toString()); } catch { return; }
      if (ev.type === 'session.output_transcript.delta' && ev.delta) this.emit('transcript', { delta: ev.delta });
      else if (ev.type === 'error' || ev.error) this.emit('status', 'error: ' + (ev.error?.message || 'unknown'));
    });
    this.ws.on('error', (err) => this.emit('status', 'error: ' + err.message));
    this.ws.on('close', () => {
      this.ready = false;
      this.emit('closed', { intentional: this.closedByUser, reason: 'socket_closed' });
    });
  }
  _send(base64) {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: base64 }));
    } catch {}
  }
}

class GeminiSession extends QueuedSession {
  constructor(lang, apiKey) {
    super(lang);
    if (!apiKey) {
      queueMicrotask(() => {
        this.emit('status', 'error: GEMINI_API_KEY is not set');
        this.emit('closed', { intentional: false, reason: 'missing_api_key' });
      });
      return;
    }
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    this.ws = new WebSocket(url);
    this.ws.on('open', () => {
      this.ws.send(JSON.stringify({
        setup: {
          model: `models/${GEMINI_MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            translationConfig: { targetLanguageCode: toBcp47(lang), echoTargetLanguage: true }
          }
        }
      }));
    });
    this.ws.on('message', (data) => {
      let ev;
      try { ev = JSON.parse(data.toString()); } catch { return; }
      if (ev.setupComplete) {
        this.ready = true;
        this.flush();
        this.emit('status', 'open');
        return;
      }
      const text = ev.serverContent?.outputTranscription?.text;
      if (text) this.emit('transcript', { delta: text });
      if (ev.error) this.emit('status', 'error: ' + (ev.error.message || 'unknown'));
    });
    this.ws.on('error', (err) => this.emit('status', 'error: ' + err.message));
    this.ws.on('close', () => {
      this.ready = false;
      this.emit('closed', { intentional: this.closedByUser, reason: 'socket_closed' });
    });
  }
  _send(base64) {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          realtimeInput: { audio: { data: downsamplePcm16Base64(base64), mimeType: 'audio/pcm;rate=16000' } }
        }));
      }
    } catch {}
  }
}

function hasEngineKey(engine) {
  if (engine === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  if (engine === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
  return true;
}

function alternateEngine(engine) {
  if (engine === 'openai' && hasEngineKey('gemini')) return 'gemini';
  if (engine === 'gemini' && hasEngineKey('openai')) return 'openai';
  return engine;
}

function createSession(engine, lang) {
  if (engine === 'openai') return new OpenAISession(lang, process.env.OPENAI_API_KEY);
  if (engine === 'gemini') return new GeminiSession(lang, process.env.GEMINI_API_KEY);
  return new StubSession(lang);
}

export class TranslationHub {
  constructor() {
    this.running = false;
    this.engineKind = 'stub';
    this.displayLang = 'en';
    this.sessions = new Map();
    this.sessionMeta = new Map();
    this.buffers = new Map();
    this.langStatus = new Map();
    this.subscribers = new Set();
    this.captureClients = new Set();
    this.lastAudioAt = 0;
    this.audioLevel = 0;
    this.audioPeak = 0;
    this.audioChunks = 0;
    this.lastTranscriptAt = 0;
    this.captureError = '';
    this.healthTimer = setInterval(() => this.broadcastStatus(), 2000);
    this.healthTimer.unref?.();
  }

  status() {
    const now = Date.now();
    const audioFresh = this.running && this.captureClients.size > 0 && this.lastAudioAt > 0 && now - this.lastAudioAt <= AUDIO_STALE_MS;
    const transcriptFresh = this.running && this.lastTranscriptAt > 0 && now - this.lastTranscriptAt <= TRANSCRIPT_STALE_MS;
    const languages = [...this.sessionMeta.entries()].map(([lang, meta]) => ({
      lang,
      status: this.langStatus.get(lang) || 'connecting',
      engine: meta.engine,
      preferredEngine: meta.preferredEngine,
      reconnectAttempts: meta.attempts,
      nextRetryAt: meta.nextRetryAt || null
    }));
    const languageError = languages.some(item => String(item.status).startsWith('error') || item.status === 'reconnecting');
    let severity = 'ok';
    let alert = '';
    if (this.running && !this.captureClients.size) {
      severity = 'error';
      alert = 'Источник звука не подключён.';
    } else if (this.running && this.lastAudioAt && !audioFresh) {
      severity = 'error';
      alert = 'Звук перестал поступать в перевод.';
    } else if (this.running && languageError) {
      severity = 'error';
      alert = 'Облачный перевод потерял соединение и переподключается.';
    } else if (this.running && this.lastAudioAt && !transcriptFresh) {
      severity = 'warning';
      alert = 'Звук поступает, но перевод давно не обновлялся.';
    }
    return {
      running: this.running,
      engine: this.engineKind,
      displayLang: this.displayLang,
      severity,
      alert,
      health: { audioFresh, transcriptFresh, checkedAt: now },
      capture: {
        connected: this.captureClients.size > 0,
        clients: this.captureClients.size,
        lastAudioAt: this.lastAudioAt || null,
        audioLevel: this.audioLevel,
        audioPeak: this.audioPeak,
        audioChunks: this.audioChunks,
        lastTranscriptAt: this.lastTranscriptAt || null,
        error: this.captureError || null
      },
      languages
    };
  }

  start({ engine, displayLang } = {}) {
    if (this.running) this.stop();
    this.engineKind = ['openai', 'gemini'].includes(engine) ? engine : 'stub';
    this.displayLang = sanitizeLang(displayLang) || 'en';
    this.running = true;
    this.lastTranscriptAt = 0;
    this.ensureLanguage(this.displayLang);
    this.broadcastStatus();
    return this.status();
  }

  stop() {
    this.running = false;
    for (const meta of this.sessionMeta.values()) clearTimeout(meta.retryTimer);
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.sessionMeta.clear();
    this.buffers.clear();
    this.langStatus.clear();
    this.broadcastStatus();
    return this.status();
  }

  ensureLanguage(langRaw) {
    const lang = sanitizeLang(langRaw);
    if (!lang || !this.running || this.sessionMeta.has(lang)) return;
    this.buffers.set(lang, '');
    this.sessionMeta.set(lang, { preferredEngine: this.engineKind, engine: this.engineKind, attempts: 0, generation: 0, retryTimer: null, nextRetryAt: 0 });
    this.openLanguageSession(lang);
  }

  openLanguageSession(lang) {
    const meta = this.sessionMeta.get(lang);
    if (!meta || !this.running) return;
    clearTimeout(meta.retryTimer);
    meta.retryTimer = null;
    meta.nextRetryAt = 0;
    meta.generation += 1;
    const generation = meta.generation;
    const session = createSession(meta.engine, lang);
    const previous = this.sessions.get(lang);
    if (previous && previous !== session) previous.close();
    this.sessions.set(lang, session);
    this.langStatus.set(lang, meta.engine === 'stub' ? 'open' : 'connecting');
    session.on('transcript', ({ delta }) => {
      if (this.sessionMeta.get(lang)?.generation !== generation) return;
      meta.attempts = 0;
      this.onTranscript(lang, delta);
    });
    session.on('status', (st) => {
      if (this.sessionMeta.get(lang)?.generation !== generation) return;
      this.langStatus.set(lang, st);
      if (st === 'open') meta.attempts = 0;
      this.broadcastStatus();
    });
    session.on('closed', ({ intentional } = {}) => {
      if (this.sessionMeta.get(lang)?.generation !== generation || intentional || !this.running) return;
      this.scheduleReconnect(lang);
    });
    this.broadcastStatus();
  }

  scheduleReconnect(lang) {
    const meta = this.sessionMeta.get(lang);
    if (!meta || !this.running || meta.retryTimer) return;
    meta.attempts += 1;
    if (meta.attempts >= FAILOVER_AFTER_ATTEMPTS) {
      const fallback = alternateEngine(meta.engine);
      if (fallback !== meta.engine) {
        meta.engine = fallback;
        meta.attempts = 0;
        this.langStatus.set(lang, `failover: ${fallback}`);
      }
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, meta.attempts - 1)));
    meta.nextRetryAt = Date.now() + delay;
    this.langStatus.set(lang, 'reconnecting');
    meta.retryTimer = setTimeout(() => {
      meta.retryTimer = null;
      meta.nextRetryAt = 0;
      this.openLanguageSession(lang);
    }, delay);
    this.broadcastStatus();
  }

  onTranscript(lang, delta) {
    this.lastTranscriptAt = Date.now();
    let text = (this.buffers.get(lang) || '') + delta;
    if (text.length > MAX_BUFFER_CHARS) text = text.slice(-MAX_BUFFER_CHARS);
    this.buffers.set(lang, text);
    this.broadcast({ type: 'transcript', lang, delta, text });
    this.broadcastStatus();
  }

  appendAudio(base64) {
    if (!this.running) return;
    const pcm = Buffer.from(base64, 'base64');
    let sum = 0;
    let peak = 0;
    const samples = pcm.length >> 1;
    for (let i = 0; i < samples; i++) {
      const value = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
      sum += value * value;
      if (value > peak) peak = value;
    }
    this.audioLevel = samples ? Math.sqrt(sum / samples) : 0;
    this.audioPeak = peak;
    this.lastAudioAt = Date.now();
    this.audioChunks++;
    for (const session of this.sessions.values()) session.appendAudio(base64);
  }

  captureConnected(ws) {
    this.captureClients.add(ws);
    this.captureError = '';
    this.broadcastStatus();
  }

  captureDisconnected(ws) {
    this.captureClients.delete(ws);
    this.audioLevel = 0;
    this.audioPeak = 0;
    this.broadcastStatus();
  }

  setCaptureError(message) {
    this.captureError = String(message || 'Ошибка источника звука');
    this.broadcastStatus();
  }

  addSubscriber(res) {
    this.subscribers.add(res);
    this.sendTo(res, { type: 'status', ...this.status() });
    for (const [lang, text] of this.buffers) this.sendTo(res, { type: 'transcript', lang, delta: '', text });
    res.on('close', () => this.subscribers.delete(res));
  }

  sendTo(res, data) {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  }

  broadcast(data) {
    for (const res of this.subscribers) this.sendTo(res, data);
  }

  broadcastStatus() {
    this.broadcast({ type: 'status', ...this.status() });
  }
}

export function attachTranslation(server, hub) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch {}
    if (pathname === '/translate/ingest') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        hub.captureConnected(ws);
        ws.on('message', (msg) => {
          const text = msg.toString();
          if (text.charCodeAt(0) === 123) {
            try { const json = JSON.parse(text); if (json.audio) hub.appendAudio(json.audio); } catch {}
          } else {
            hub.appendAudio(text);
          }
        });
        ws.on('close', () => hub.captureDisconnected(ws));
        ws.on('error', () => hub.captureDisconnected(ws));
      });
    } else {
      socket.destroy();
    }
  });
}

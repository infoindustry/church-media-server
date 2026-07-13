// Live translation hub: captures source audio (PCM16 24kHz) over WebSocket,
// feeds realtime translation engines, and fans translated subtitles out to
// the TV and audience phones over SSE.

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import os from 'os';

const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-translate';
const GEMINI_MODEL = process.env.GEMINI_REALTIME_MODEL || 'gemini-3.5-live-translate-preview';
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_TRANSLATION_MODEL || 'gpt-4.1-mini';
const DEEPGRAM_MODEL = process.env.DEEPGRAM_STT_MODEL || 'nova-3';
const DEEPGRAM_SOURCE_LANGUAGE = process.env.DEEPGRAM_SOURCE_LANGUAGE || 'ru';
const MAX_BUFFER_CHARS = 1600;
const AUDIO_CHUNK_MS = 100;
const MAX_QUEUED_AUDIO_MS = Number(process.env.TRANSLATION_MAX_QUEUE_MS || 5000);
const MAX_QUEUED_CHUNKS = Math.max(1, Math.ceil(MAX_QUEUED_AUDIO_MS / AUDIO_CHUNK_MS));
const RECONNECT_BASE_MS = Number(process.env.TRANSLATION_RECONNECT_BASE_MS || 1000);
const RECONNECT_MAX_MS = Number(process.env.TRANSLATION_RECONNECT_MAX_MS || 15000);
const FAILOVER_AFTER_ATTEMPTS = Number(process.env.TRANSLATION_FAILOVER_ATTEMPTS || 3);
const AUDIO_STALE_MS = Number(process.env.TRANSLATION_AUDIO_STALE_MS || 3000);
const TRANSCRIPT_STALE_MS = Number(process.env.TRANSLATION_TRANSCRIPT_STALE_MS || 20000);
const DEEPGRAM_ENDPOINTING_MS = Number(process.env.DEEPGRAM_ENDPOINTING_MS || 600);
const DEEPGRAM_UTTERANCE_END_MS = Number(process.env.DEEPGRAM_UTTERANCE_END_MS || 1200);
const DEEPGRAM_FLUSH_MS = Number(process.env.DEEPGRAM_FLUSH_MS || 900);

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
  return String(code || '').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 12);
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

class DeepgramSession extends QueuedSession {
  constructor(sourceLang, apiKey) {
    super(sourceLang);
    this.pendingFinal = [];
    this.flushTimer = null;
    this.keepAliveTimer = null;
    if (!apiKey) {
      queueMicrotask(() => {
        this.emit('status', 'error: DEEPGRAM_API_KEY is not set');
        this.emit('closed', { intentional: false, reason: 'missing_api_key' });
      });
      return;
    }

    const query = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      language: sourceLang,
      encoding: 'linear16',
      sample_rate: '24000',
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: String(DEEPGRAM_ENDPOINTING_MS),
      utterance_end_ms: String(DEEPGRAM_UTTERANCE_END_MS)
    });
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${query}`, {
      headers: { Authorization: `Token ${apiKey}` }
    });
    this.ws.on('open', () => {
      this.ready = true;
      this.flush();
      this.emit('status', 'open');
      this.keepAliveTimer = setInterval(() => {
        try {
          if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        } catch {}
      }, 8000);
      this.keepAliveTimer.unref?.();
    });
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('error', (err) => this.emit('status', 'error: ' + err.message));
    this.ws.on('close', () => {
      this.ready = false;
      clearInterval(this.keepAliveTimer);
      clearTimeout(this.flushTimer);
      this.emit('closed', { intentional: this.closedByUser, reason: 'socket_closed' });
    });
  }

  handleMessage(data) {
    let ev;
    try { ev = JSON.parse(data.toString()); } catch { return; }
    if (ev.type === 'Metadata') return;
    if (ev.type === 'UtteranceEnd') {
      this.flushUtterance();
      return;
    }
    if (ev.type !== 'Results') return;
    const transcript = String(ev.channel?.alternatives?.[0]?.transcript || '').trim();
    if (!transcript) return;
    this.emit('interim', { text: transcript, isFinal: Boolean(ev.is_final), speechFinal: Boolean(ev.speech_final) });
    if (!ev.is_final) return;
    this.pendingFinal.push(transcript);
    clearTimeout(this.flushTimer);
    if (ev.speech_final) this.flushUtterance();
    else this.flushTimer = setTimeout(() => this.flushUtterance(), DEEPGRAM_FLUSH_MS);
  }

  flushUtterance() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const text = this.pendingFinal.join(' ').replace(/\s+/g, ' ').trim();
    this.pendingFinal = [];
    if (text) this.emit('utterance', { text });
  }

  _send(base64) {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(Buffer.from(base64, 'base64'));
    } catch {}
  }

  close() {
    this.flushUtterance();
    clearInterval(this.keepAliveTimer);
    clearTimeout(this.flushTimer);
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'CloseStream' }));
    } catch {}
    super.close();
  }
}

function hasEngineKey(engine) {
  if (engine === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  if (engine === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
  if (engine === 'deepgram') return Boolean(process.env.DEEPGRAM_API_KEY && process.env.OPENAI_API_KEY);
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

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n');
}

function parseJsonObject(text) {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Translator returned invalid JSON');
  return JSON.parse(clean.slice(start, end + 1));
}

async function translateTextWithOpenAI({ sourceText, sourceLang, targetLangs }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const targets = targetLangs.filter(lang => lang !== sourceLang);
  const result = {};
  if (targetLangs.includes(sourceLang)) result[sourceLang] = sourceText;
  if (!targets.length) return result;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      instructions: 'You are a live church interpreter. Translate faithfully and naturally. Preserve Bible names and meaning. Do not add explanations. Return only one valid JSON object whose keys are exactly the requested target language codes.',
      input: `Source language: ${sourceLang}\nTarget language codes: ${targets.join(', ')}\nText:\n${sourceText}`,
      max_output_tokens: 1200
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI text translation failed: ${response.status}`);
  const translated = parseJsonObject(extractResponseText(payload));
  for (const lang of targets) {
    const value = String(translated?.[lang] || '').trim();
    if (!value) throw new Error(`Translator omitted language ${lang}`);
    result[lang] = value;
  }
  return result;
}

export class TranslationHub {
  constructor() {
    this.running = false;
    this.engineKind = 'stub';
    this.displayLang = 'en';
    this.sourceLang = sanitizeLang(DEEPGRAM_SOURCE_LANGUAGE) || 'ru';
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
    this.lastSourceTranscriptAt = 0;
    this.lastSourceText = '';
    this.captureError = '';
    this.deepgramSession = null;
    this.deepgramAttempts = 0;
    this.deepgramRetryTimer = null;
    this.deepgramNextRetryAt = 0;
    this.deepgramGeneration = 0;
    this.deepgramStatus = 'closed';
    this.pendingTranslations = 0;
    this.translationChain = Promise.resolve();
    this.healthTimer = setInterval(() => this.broadcastStatus(), 2000);
    this.healthTimer.unref?.();
  }

  status() {
    const now = Date.now();
    const audioFresh = this.running && this.captureClients.size > 0 && this.lastAudioAt > 0 && now - this.lastAudioAt <= AUDIO_STALE_MS;
    const transcriptFresh = this.running && this.lastTranscriptAt > 0 && now - this.lastTranscriptAt <= TRANSCRIPT_STALE_MS;
    const languages = this.engineKind === 'deepgram'
      ? [...this.buffers.keys()].map(lang => ({ lang, status: this.langStatus.get(lang) || 'waiting', engine: 'deepgram+openai-text', preferredEngine: 'deepgram', reconnectAttempts: this.deepgramAttempts, nextRetryAt: this.deepgramNextRetryAt || null }))
      : [...this.sessionMeta.entries()].map(([lang, meta]) => ({
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
    } else if (this.running && (languageError || (this.engineKind === 'deepgram' && this.deepgramStatus !== 'open'))) {
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
      sourceLang: this.sourceLang,
      severity,
      alert,
      health: { audioFresh, transcriptFresh, checkedAt: now },
      pipeline: this.engineKind === 'deepgram' ? {
        stt: 'deepgram',
        sttModel: DEEPGRAM_MODEL,
        sttStatus: this.deepgramStatus,
        translator: 'openai',
        translationModel: OPENAI_TEXT_MODEL,
        pendingTranslations: this.pendingTranslations,
        lastSourceTranscriptAt: this.lastSourceTranscriptAt || null,
        lastSourceText: this.lastSourceText || ''
      } : null,
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

  start({ engine, displayLang, sourceLang } = {}) {
    if (this.running) this.stop();
    this.engineKind = ['openai', 'gemini', 'deepgram'].includes(engine) ? engine : 'stub';
    this.displayLang = sanitizeLang(displayLang) || 'en';
    this.sourceLang = sanitizeLang(sourceLang) || sanitizeLang(DEEPGRAM_SOURCE_LANGUAGE) || 'ru';
    this.running = true;
    this.lastTranscriptAt = 0;
    this.lastSourceTranscriptAt = 0;
    this.lastSourceText = '';
    this.ensureLanguage(this.displayLang);
    if (this.engineKind === 'deepgram') this.openDeepgramSession();
    this.broadcastStatus();
    return this.status();
  }

  stop() {
    this.running = false;
    clearTimeout(this.deepgramRetryTimer);
    this.deepgramRetryTimer = null;
    this.deepgramNextRetryAt = 0;
    this.deepgramGeneration += 1;
    if (this.deepgramSession) this.deepgramSession.close();
    this.deepgramSession = null;
    this.deepgramStatus = 'closed';
    for (const meta of this.sessionMeta.values()) clearTimeout(meta.retryTimer);
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.sessionMeta.clear();
    this.buffers.clear();
    this.langStatus.clear();
    this.pendingTranslations = 0;
    this.broadcastStatus();
    return this.status();
  }

  ensureLanguage(langRaw) {
    const lang = sanitizeLang(langRaw);
    if (!lang || !this.running || this.buffers.has(lang)) return;
    this.buffers.set(lang, '');
    if (this.engineKind === 'deepgram') {
      this.langStatus.set(lang, this.deepgramStatus === 'open' ? 'open' : 'waiting');
      this.broadcastStatus();
      return;
    }
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

  openDeepgramSession() {
    if (!this.running || this.engineKind !== 'deepgram') return;
    clearTimeout(this.deepgramRetryTimer);
    this.deepgramRetryTimer = null;
    this.deepgramNextRetryAt = 0;
    this.deepgramGeneration += 1;
    const generation = this.deepgramGeneration;
    const session = new DeepgramSession(this.sourceLang, process.env.DEEPGRAM_API_KEY);
    const previous = this.deepgramSession;
    if (previous && previous !== session) previous.close();
    this.deepgramSession = session;
    this.deepgramStatus = 'connecting';
    for (const lang of this.buffers.keys()) this.langStatus.set(lang, 'waiting');

    session.on('status', (status) => {
      if (this.deepgramGeneration !== generation) return;
      this.deepgramStatus = status;
      if (status === 'open') {
        this.deepgramAttempts = 0;
        for (const lang of this.buffers.keys()) this.langStatus.set(lang, 'open');
      }
      this.broadcastStatus();
    });
    session.on('interim', ({ text, isFinal }) => {
      if (this.deepgramGeneration !== generation) return;
      this.broadcast({ type: 'source-transcript', text, final: isFinal, lang: this.sourceLang });
    });
    session.on('utterance', ({ text }) => {
      if (this.deepgramGeneration !== generation || !text) return;
      this.lastSourceTranscriptAt = Date.now();
      this.lastSourceText = text;
      this.broadcast({ type: 'source-transcript', text, final: true, lang: this.sourceLang });
      this.queueTextTranslation(text);
    });
    session.on('closed', ({ intentional } = {}) => {
      if (this.deepgramGeneration !== generation || intentional || !this.running) return;
      this.scheduleDeepgramReconnect();
    });
    this.broadcastStatus();
  }

  scheduleDeepgramReconnect() {
    if (!this.running || this.engineKind !== 'deepgram' || this.deepgramRetryTimer) return;
    this.deepgramAttempts += 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, this.deepgramAttempts - 1)));
    this.deepgramNextRetryAt = Date.now() + delay;
    this.deepgramStatus = 'reconnecting';
    for (const lang of this.buffers.keys()) this.langStatus.set(lang, 'reconnecting');
    this.deepgramRetryTimer = setTimeout(() => {
      this.deepgramRetryTimer = null;
      this.deepgramNextRetryAt = 0;
      this.openDeepgramSession();
    }, delay);
    this.broadcastStatus();
  }

  queueTextTranslation(sourceText) {
    const targetLangs = [...this.buffers.keys()];
    if (!targetLangs.length) return;
    this.pendingTranslations += 1;
    for (const lang of targetLangs) this.langStatus.set(lang, 'translating');
    this.broadcastStatus();
    this.translationChain = this.translationChain
      .then(async () => {
        const translated = await translateTextWithOpenAI({ sourceText, sourceLang: this.sourceLang, targetLangs });
        if (!this.running || this.engineKind !== 'deepgram') return;
        for (const lang of targetLangs) {
          const text = String(translated[lang] || '').trim();
          if (text) this.onTranscript(lang, text + ' ');
          this.langStatus.set(lang, 'open');
        }
      })
      .catch((error) => {
        if (!this.running || this.engineKind !== 'deepgram') return;
        for (const lang of targetLangs) this.langStatus.set(lang, `error: ${error.message}`);
      })
      .finally(() => {
        this.pendingTranslations = Math.max(0, this.pendingTranslations - 1);
        this.broadcastStatus();
      });
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
    if (this.engineKind === 'deepgram') this.deepgramSession?.appendAudio(base64);
    else for (const session of this.sessions.values()) session.appendAudio(base64);
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

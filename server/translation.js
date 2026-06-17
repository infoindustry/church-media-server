// Live translation hub: captures source audio (PCM16 24kHz) over WebSocket,
// feeds one realtime session per target language, and fans translated
// subtitles out to the TV and audience phones over SSE.
//
// Engines behind one interface:
//   - 'stub'   : no network; emits placeholder words so the whole pipeline
//                (capture -> hub -> SSE -> screens) can be verified offline.
//   - 'openai' : OpenAI Realtime Translate (gpt-realtime-translate), one
//                WebSocket session per language. Needs OPENAI_API_KEY + internet.
//   - 'gemini' : Gemini Live Translate (gemini-3.5-live-translate-preview), one
//                WebSocket session per language. Needs GEMINI_API_KEY + internet.
//
// All sessions speak the same EventEmitter contract: 'transcript' ({ delta }),
// 'status' (string), 'closed'. Capture feeds PCM16 mono 24kHz base64 chunks;
// the Gemini session resamples to the 16kHz it requires.

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import os from 'os';

const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-translate';
const GEMINI_MODEL = process.env.GEMINI_REALTIME_MODEL || 'gemini-3.5-live-translate-preview';
const MAX_BUFFER_CHARS = 1600; // how much rolling subtitle text we keep per language

// App language codes are mostly BCP-47 already; only a few need a region/script.
function toBcp47(lang) {
  const map = { zh: 'zh-Hans', pt: 'pt-BR' };
  return map[lang] || lang;
}

// Capture sends PCM16 mono @24kHz; Gemini Live Translate requires 16kHz.
// Linear-interpolate down (ratio 3:2) and re-encode to base64.
function downsamplePcm16Base64(base64, inRate = 24000, outRate = 16000) {
  if (inRate === outRate) return base64;
  const inBuf = Buffer.from(base64, 'base64');
  const inLen = inBuf.length >> 1; // 16-bit samples
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

// ---- per-language sessions ----

class StubSession extends EventEmitter {
  constructor(lang) {
    super();
    this.lang = lang;
    this.open = true;
    const words = ['[stub]', lang.toUpperCase(), 'live', 'subtitle', 'pipeline', 'works', '·'];
    let i = 0;
    this.timer = setInterval(() => {
      if (!this.open) return;
      this.emit('transcript', { delta: words[i++ % words.length] + ' ' });
    }, 1000);
  }
  appendAudio() {}
  close() {
    this.open = false;
    clearInterval(this.timer);
    this.emit('closed');
  }
}

class OpenAISession extends EventEmitter {
  constructor(lang, apiKey) {
    super();
    this.lang = lang;
    this.ready = false;
    this.queue = [];
    if (!apiKey) {
      // Surface the misconfiguration on the next tick so callers can listen.
      setTimeout(() => this.emit('status', 'error: OPENAI_API_KEY is not set'), 0);
      return;
    }
    this.ws = new WebSocket(`wss://api.openai.com/v1/realtime/translations?model=${OPENAI_MODEL}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    this.ws.on('open', () => {
      this.ws.send(JSON.stringify({ type: 'session.update', session: { audio: { output: { language: lang } } } }));
      this.ready = true;
      for (const chunk of this.queue) this._send(chunk);
      this.queue = [];
      this.emit('status', 'open');
    });
    this.ws.on('message', (data) => {
      let ev;
      try { ev = JSON.parse(data.toString()); } catch { return; }
      if (ev.type === 'session.output_transcript.delta' && ev.delta) this.emit('transcript', { delta: ev.delta });
      else if (ev.type === 'error' || ev.error) this.emit('status', 'error: ' + (ev.error?.message || 'unknown'));
      else if (ev.type === 'session.closed') this.close();
    });
    this.ws.on('error', (err) => this.emit('status', 'error: ' + err.message));
    this.ws.on('close', () => { this.ready = false; this.emit('closed'); });
  }
  _send(base64) {
    try { this.ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: base64 })); } catch {}
  }
  appendAudio(base64) {
    if (this.ready) this._send(base64);
    else if (this.queue.length < 400) this.queue.push(base64);
  }
  close() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'session.close' }));
      if (this.ws) this.ws.close();
    } catch {}
    this.emit('closed');
  }
}

class GeminiSession extends EventEmitter {
  constructor(lang, apiKey) {
    super();
    this.lang = lang;
    this.ready = false;
    this.queue = [];
    if (!apiKey) {
      setTimeout(() => this.emit('status', 'error: GEMINI_API_KEY is not set'), 0);
      return;
    }
    // v1alpha endpoint: the live-translate model is a preview feature.
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
        for (const chunk of this.queue) this._send(chunk);
        this.queue = [];
        this.emit('status', 'open');
        return;
      }
      const content = ev.serverContent;
      // We only surface translated text as subtitles; the audio parts (modelTurn)
      // are required by the model but intentionally dropped here.
      const text = content?.outputTranscription?.text;
      if (text) this.emit('transcript', { delta: text });
      if (ev.error) this.emit('status', 'error: ' + (ev.error.message || 'unknown'));
    });
    this.ws.on('error', (err) => this.emit('status', 'error: ' + err.message));
    this.ws.on('close', () => { this.ready = false; this.emit('closed'); });
  }
  _send(base64) {
    try {
      this.ws.send(JSON.stringify({
        realtimeInput: { audio: { data: downsamplePcm16Base64(base64), mimeType: 'audio/pcm;rate=16000' } }
      }));
    } catch {}
  }
  appendAudio(base64) {
    if (this.ready) this._send(base64);
    else if (this.queue.length < 400) this.queue.push(base64);
  }
  close() {
    try { if (this.ws) this.ws.close(); } catch {}
    this.emit('closed');
  }
}

// ---- hub ----

export class TranslationHub {
  constructor() {
    this.running = false;
    this.engineKind = 'stub';
    this.displayLang = 'en';
    this.sessions = new Map();   // lang -> session
    this.buffers = new Map();    // lang -> rolling subtitle text
    this.langStatus = new Map(); // lang -> last status string
    this.subscribers = new Set();
  }

  status() {
    return {
      running: this.running,
      engine: this.engineKind,
      displayLang: this.displayLang,
      languages: [...this.sessions.keys()].map(lang => ({ lang, status: this.langStatus.get(lang) || 'connecting' }))
    };
  }

  start({ engine, displayLang } = {}) {
    if (this.running) this.stop();
    this.engineKind = ['openai', 'gemini'].includes(engine) ? engine : 'stub';
    this.displayLang = sanitizeLang(displayLang) || 'en';
    this.running = true;
    this.ensureLanguage(this.displayLang);
    this.broadcastStatus();
    return this.status();
  }

  stop() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.buffers.clear();
    this.langStatus.clear();
    this.running = false;
    this.broadcastStatus();
    return this.status();
  }

  ensureLanguage(langRaw) {
    const lang = sanitizeLang(langRaw);
    if (!lang || !this.running || this.sessions.has(lang)) return;
    let session;
    if (this.engineKind === 'openai') session = new OpenAISession(lang, process.env.OPENAI_API_KEY);
    else if (this.engineKind === 'gemini') session = new GeminiSession(lang, process.env.GEMINI_API_KEY);
    else session = new StubSession(lang);
    this.buffers.set(lang, '');
    this.langStatus.set(lang, this.engineKind === 'stub' ? 'open' : 'connecting');
    session.on('transcript', ({ delta }) => this.onTranscript(lang, delta));
    session.on('status', (st) => { this.langStatus.set(lang, st); this.broadcastStatus(); });
    session.on('closed', () => {});
    this.sessions.set(lang, session);
    this.broadcastStatus();
  }

  onTranscript(lang, delta) {
    let text = (this.buffers.get(lang) || '') + delta;
    if (text.length > MAX_BUFFER_CHARS) text = text.slice(-MAX_BUFFER_CHARS);
    this.buffers.set(lang, text);
    this.broadcast({ type: 'transcript', lang, delta, text });
  }

  appendAudio(base64) {
    if (!this.running) return;
    for (const session of this.sessions.values()) session.appendAudio(base64);
  }

  addSubscriber(res) {
    this.subscribers.add(res);
    // Replay current state so a late joiner sees existing subtitles immediately.
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

// Attach the audio-ingest WebSocket endpoint to the HTTP server.
export function attachTranslation(server, hub) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch {}
    if (pathname === '/translate/ingest') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (msg) => {
          const text = msg.toString();
          if (text.charCodeAt(0) === 123) { // '{'
            try { const json = JSON.parse(text); if (json.audio) hub.appendAudio(json.audio); } catch {}
          } else {
            hub.appendAudio(text);
          }
        });
      });
    } else {
      socket.destroy();
    }
  });
}

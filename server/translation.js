// Live translation hub: captures source audio (PCM16 24kHz) over WebSocket,
// feeds one realtime session per target language, and fans translated
// subtitles out to the TV and audience phones over SSE.
//
// Two engines behind one interface:
//   - 'stub'   : no network; emits placeholder words so the whole pipeline
//                (capture -> hub -> SSE -> screens) can be verified offline.
//   - 'openai' : OpenAI Realtime Translate (gpt-realtime-translate), one
//                WebSocket session per language. Needs OPENAI_API_KEY + internet.

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import os from 'os';

const OPENAI_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-translate';
const MAX_BUFFER_CHARS = 1600; // how much rolling subtitle text we keep per language

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
    this.engineKind = engine === 'openai' ? 'openai' : 'stub';
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
    const session = this.engineKind === 'openai'
      ? new OpenAISession(lang, process.env.OPENAI_API_KEY)
      : new StubSession(lang);
    this.buffers.set(lang, '');
    this.langStatus.set(lang, this.engineKind === 'openai' ? 'connecting' : 'open');
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

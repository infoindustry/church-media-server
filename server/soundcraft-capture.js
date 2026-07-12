import { spawn } from 'child_process';

const DEFAULT_DEVICE = 'Mic/Line In 01/02 (2- Soundcraft Notepad 12FX)';
const CHUNK_BYTES = 4800; // 100 ms of mono PCM16 at 24 kHz

export class SoundcraftCapture {
  constructor(hub) {
    this.hub = hub;
    this.process = null;
    this.buffer = Buffer.alloc(0);
    this.wanted = false;
    this.restartTimer = null;
    this.device = process.env.TRANSLATION_AUDIO_DEVICE || DEFAULT_DEVICE;
  }

  start() {
    this.wanted = true;
    if (this.process) return;
    this._spawn();
  }

  _spawn() {
    if (!this.wanted || this.process) return;
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-f', 'dshow', '-i', `audio=${this.device}`,
      '-af', 'pan=mono|c0=c0',
      '-ar', '24000', '-ac', '1', '-f', 's16le', 'pipe:1'
    ];
    const child = spawn('ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;
    this.buffer = Buffer.alloc(0);
    let connected = false;

    child.stdout.on('data', (data) => {
      if (!connected) {
        connected = true;
        this.hub.captureConnected(this);
      }
      this.buffer = Buffer.concat([this.buffer, data]);
      while (this.buffer.length >= CHUNK_BYTES) {
        const chunk = this.buffer.subarray(0, CHUNK_BYTES);
        this.buffer = this.buffer.subarray(CHUNK_BYTES);
        this.hub.appendAudio(chunk.toString('base64'));
      }
    });
    child.stderr.on('data', (data) => {
      const message = data.toString().trim();
      if (message) this.hub.setCaptureError(message.slice(-300));
    });
    child.on('error', (error) => this.hub.setCaptureError(error.message));
    child.on('close', () => {
      this.process = null;
      if (connected) this.hub.captureDisconnected(this);
      if (this.wanted) this.restartTimer = setTimeout(() => this._spawn(), 2000);
    });
  }

  stop() {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.process;
    this.process = null;
    if (child) child.kill();
    this.hub.captureDisconnected(this);
  }
}

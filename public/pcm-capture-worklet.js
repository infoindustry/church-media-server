// Captures mono audio frames from the mic and posts ~100ms Float32 chunks to
// the main thread. The AudioContext runs at 24kHz, so no resampling is needed
// before encoding to PCM16 for OpenAI Realtime.
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._target = 2400; // ~100ms at 24kHz
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) this._buf.push(channel[i]);
      if (this._buf.length >= this._target) {
        this.port.postMessage(Float32Array.from(this._buf));
        this._buf.length = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor);


export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

// Function to add a WAV header to raw PCM data so it can be played in <audio> elements
export function createWavUrl(samples: Uint8Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, 1, true); // Mono
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length, true);

  // Write the PCM samples
  const dataView = new Uint8Array(buffer, 44);
  dataView.set(samples);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// --- LIVE API AUDIO WORKLETS ---

export const MIC_WORKLET_CODE = `
class MicPCM16Processor extends AudioWorkletProcessor {
  constructor(){
    super();
    // Standard mic is often 44.1 or 48k. We want 16k for the model.
    this._resampleRatio = sampleRate / 16000;
    this._acc = [];
    this._accLen = 0;
  }
  process(inputs){
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    // basic RMS for VAD (Voice Activity Detection)
    let sum = 0;
    for (let i=0;i<ch.length;i++) sum += ch[i]*ch[i];
    const rms = Math.sqrt(sum / ch.length);
    this.port.postMessage({ type: "rms", rms });

    // resample to 16kHz via simple decimation / nearest (prototype-grade)
    const outLen = Math.floor(ch.length / this._resampleRatio);
    const out = new Int16Array(outLen);
    for (let i=0;i<outLen;i++){
      const srcIndex = Math.floor(i * this._resampleRatio);
      const v = Math.max(-1, Math.min(1, ch[srcIndex] || 0));
      // Convert Float32 (-1.0 to 1.0) to Int16
      out[i] = (v * 32767) | 0;
    }
    this.port.postMessage({ type: "pcm16", pcm16: out }, [out.buffer]);
    return true;
  }
}
registerProcessor("mic-pcm16", MicPCM16Processor);
`;

export const OUT_WORKLET_CODE = `
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this._queue = [];
    this._queuedSamples = 0;
    this._gain = 1.0;
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === "push"){
        // Receive Float32 chunks (already converted from Int16 in main thread)
        const f32 = new Float32Array(msg.f32);
        this._queue.push(f32);
        this._queuedSamples += f32.length;
      } else if (msg.type === "clear"){
        this._queue = [];
        this._queuedSamples = 0;
      } else if (msg.type === "gain"){
        this._gain = msg.gain;
      } else if (msg.type === "stats"){
        this.port.postMessage({ type:"stats", queued: this._queuedSamples });
      }
    };
  }
  process(inputs, outputs){
    const out = outputs[0][0];
    out.fill(0);
    let offset = 0;
    
    // Process queue
    while (offset < out.length && this._queue.length){
      const head = this._queue[0];
      const take = Math.min(head.length, out.length - offset);
      for (let i=0;i<take;i++){
        out[offset+i] = head[i] * this._gain;
      }
      if (take === head.length){
        this._queue.shift();
      } else {
        this._queue[0] = head.subarray(take);
      }
      this._queuedSamples -= take;
      offset += take;
    }
    return true;
  }
}
registerProcessor("pcm-player", PCMPlayerProcessor);
`;

export function b64FromInt16(int16: Int16Array): string {
  const u8 = new Uint8Array(int16.buffer);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

export function int16FromB64(b64: string): Int16Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer);
}

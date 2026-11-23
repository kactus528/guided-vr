/**
 * On-headset speech-to-text with Whisper via Transformers.js, running in a
 * Web Worker so transcription never blocks rendering. The library loads from
 * a CDN and the model downloads once from Hugging Face, then is cached by the
 * browser. Audio never leaves the device.
 */

/** Self-contained CDN build (the package's "jsdelivr" entry), then jsDelivr's ESM-rewritten build as a fallback. */
export const TRANSFORMERS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm',
];

export const LOCAL_MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Tiny (≈40 MB, fastest)' },
  { id: 'Xenova/whisper-base.en', label: 'Base (≈80 MB, more accurate, slower)' },
];

const WORKER_SRC = `
let pipe = null, loading = null, loadedModel = null;
async function importLib(libs) {
  const errors = [];
  for (const url of libs) {
    try {
      const mod = await import(url);
      if (mod && mod.pipeline) return mod;
      errors.push(url + ': no pipeline export');
    } catch (e) {
      errors.push(url.split('/').slice(-2).join('/') + ': ' + ((e && e.message) || e));
    }
  }
  throw new Error('Could not load the speech library. ' + errors.join(' | '));
}
async function load(model, libs) {
  const { pipeline, env } = await importLib(libs);
  env.allowLocalModels = false;
  const files = {};
  pipe = await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p && p.file && typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0) {
        files[p.file] = [p.loaded, p.total];
        let l = 0, t = 0;
        for (const k in files) { l += files[k][0]; t += files[k][1]; }
        postMessage({ type: 'progress', loaded: l, total: t });
      }
    },
  });
  loadedModel = model;
}
function ensure(model, lib) {
  if (!loading || loadedModel && loadedModel !== model) loading = load(model, lib);
  return loading;
}
onmessage = async (e) => {
  const m = e.data;
  try {
    await ensure(m.model, m.lib);
    if (m.type === 'load') postMessage({ type: 'ready', id: m.id });
    if (m.type === 'transcribe') {
      const out = await pipe(m.audio, { chunk_length_s: 30 });
      postMessage({ type: 'result', id: m.id, text: Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text });
    }
  } catch (err) {
    loading = null;
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};`;

export type LocalStatus = 'idle' | 'downloading' | 'ready' | 'error';

export class LocalWhisper {
  status: LocalStatus = 'idle';
  progress = 0; // 0..1
  error: string | null = null;
  onStatus: () => void = () => {};
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();

  constructor(private getModel: () => string, private libs: string[] = TRANSFORMERS_URLS) {}

  static supported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url, { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id?: number; text?: string; message?: string; loaded?: number; total?: number };
      if (m.type === 'progress' && m.total) {
        if (this.status !== 'ready') this.status = 'downloading';
        this.progress = (m.loaded ?? 0) / m.total;
        this.onStatus();
        return;
      }
      if (m.type === 'ready' || m.type === 'result') {
        this.status = 'ready';
        this.progress = 1;
        this.error = null;
        this.onStatus();
      }
      if (m.type === 'error') {
        this.status = 'error';
        this.error = m.message ?? 'Speech model failed to load';
        this.onStatus();
      }
      const p = m.id !== undefined ? this.pending.get(m.id) : undefined;
      if (!p) return;
      this.pending.delete(m.id!);
      if (m.type === 'error') p.reject(new Error(m.message ?? 'Speech model error'));
      else p.resolve(m.text ?? '');
    };
    w.onerror = (e) => {
      this.status = 'error';
      this.error = e.message || 'Speech worker failed to start';
      this.onStatus();
      for (const p of this.pending.values()) p.reject(new Error(this.error));
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  private send(type: 'load' | 'transcribe', audio?: Float32Array): Promise<string> {
    const id = ++this.seq;
    const w = this.ensureWorker();
    if (this.status !== 'ready') {
      this.status = 'downloading';
      this.onStatus();
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = { type, id, model: this.getModel(), lib: this.libs, audio };
      if (audio) w.postMessage(msg, [audio.buffer]);
      else w.postMessage(msg);
    });
  }

  /** Download / warm the model ahead of time. */
  preload(): Promise<string> {
    return this.send('load');
  }

  async transcribe(blob: Blob): Promise<string> {
    const audio = await toMono16k(blob);
    if (audio.length < 1600) return ''; // under 0.1 s
    return (await this.send('transcribe', audio)).trim();
  }
}

/** Decode any recorded clip and resample to 16 kHz mono (decodeAudioData resamples to the context rate). */
export async function toMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(buf);
  return mixdown(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)));
}

export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return new Float32Array(channels[0]);
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

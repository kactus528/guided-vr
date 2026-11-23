/**
 * On-headset neural voice (Kokoro-82M via kokoro-js) running in a Web Worker.
 * kokoro.web.js is the package's self-contained browser build (bundles
 * Transformers.js 3.x and the phonemizer). The model downloads once from
 * Hugging Face and is then cached by the browser.
 */
const LIBS = [
  'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js',
  'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm',
];
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPES = ['q8', 'q4'];

const WORKER_SRC = `
let tts = null, loading = null, usedDtype = null;
async function importLib(libs) {
  const errs = [];
  for (const u of libs) {
    try { const m = await import(u); if (m && m.KokoroTTS) return m; errs.push(u + ': no KokoroTTS'); }
    catch (e) { errs.push(u.split('/').slice(-2).join('/') + ': ' + ((e && e.message) || e)); }
  }
  throw new Error('Could not load the voice library. ' + errs.join(' | '));
}
async function load(libs, model, dtypes) {
  const { KokoroTTS } = await importLib(libs);
  const fails = [];
  for (const dtype of dtypes) {
    try {
      const files = {};
      tts = await KokoroTTS.from_pretrained(model, {
        dtype, device: 'wasm',
        progress_callback: (p) => {
          if (p && p.file && typeof p.loaded === 'number' && p.total > 0) {
            files[p.file] = [p.loaded, p.total];
            let l = 0, t = 0; for (const k in files) { l += files[k][0]; t += files[k][1]; }
            postMessage({ type: 'progress', loaded: l, total: t });
          }
        },
      });
      usedDtype = dtype;
      return;
    } catch (e) { fails.push(dtype + ': ' + String((e && e.message) || e).slice(0, 160)); postMessage({ type: 'retry' }); }
  }
  throw new Error('Voice model failed to start. ' + fails.join(' || '));
}
onmessage = async (e) => {
  const m = e.data;
  try {
    if (!loading) loading = load(m.libs, m.model, m.dtypes);
    await loading;
    if (m.type === 'load') { postMessage({ type: 'ready', id: m.id, dtype: usedDtype }); return; }
    const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed });
    const pcm = out.audio;
    postMessage({ type: 'audio', id: m.id, pcm, rate: out.sampling_rate, dtype: usedDtype }, [pcm.buffer]);
  } catch (err) {
    loading = null;
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};`;

export type KokoroStatus = 'idle' | 'downloading' | 'ready' | 'error';

export class KokoroVoice {
  status: KokoroStatus = 'idle';
  progress = 0;
  error: string | null = null;
  dtype: string | null = null;
  onStatus: () => void = () => {};
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: { pcm: Float32Array; rate: number } | null) => void; reject: (e: Error) => void }>();

  static supported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })), { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id?: number; pcm?: Float32Array; rate?: number; message?: string; loaded?: number; total?: number; dtype?: string };
      if (m.type === 'progress' && m.total) {
        if (this.status !== 'ready') this.status = 'downloading';
        this.progress = (m.loaded ?? 0) / m.total;
        this.onStatus();
        return;
      }
      if (m.type === 'retry') return;
      if (m.dtype) this.dtype = m.dtype;
      if (m.type === 'ready' || m.type === 'audio') {
        if (this.status !== 'ready') {
          this.status = 'ready';
          this.progress = 1;
          this.error = null;
          this.onStatus();
        }
      }
      if (m.type === 'error') {
        this.status = 'error';
        this.error = m.message ?? 'Voice model error';
        this.onStatus();
      }
      const p = m.id !== undefined ? this.pending.get(m.id) : undefined;
      if (!p) return;
      this.pending.delete(m.id!);
      if (m.type === 'error') p.reject(new Error(m.message));
      else p.resolve(m.pcm ? { pcm: m.pcm, rate: m.rate ?? 24000 } : null);
    };
    w.onerror = (e) => {
      this.status = 'error';
      this.error = e.message || 'Voice worker failed to start';
      this.onStatus();
      for (const p of this.pending.values()) p.reject(new Error(this.error));
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  private send(type: 'load' | 'speak', text?: string, voice?: string, speed?: number): Promise<{ pcm: Float32Array; rate: number } | null> {
    const id = ++this.seq;
    const w = this.ensure();
    if (this.status !== 'ready') {
      this.status = 'downloading';
      this.onStatus();
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type, id, text, voice, speed, libs: LIBS, model: MODEL, dtypes: DTYPES });
    });
  }

  preload(): Promise<unknown> {
    return this.send('load');
  }

  async synth(text: string, voice: string, speed: number): Promise<{ pcm: Float32Array; rate: number }> {
    const r = await this.send('speak', text, voice, speed);
    if (!r) throw new Error('No audio generated');
    return r;
  }
}

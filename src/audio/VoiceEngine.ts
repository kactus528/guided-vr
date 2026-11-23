import { del, get, getAll, put } from '../data/db.js';
import { KokoroVoice } from './KokoroVoice.js';
import { engineOrder, type VoiceConfigStore } from './VoiceConfigStore.js';
import { encodeWav, hashText, splitSentences } from './wav.js';

export type EngineUsed = 'elevenlabs' | 'kokoro' | 'browser' | null;

/**
 * Turns text into audio clips: ElevenLabs (cloud) → Kokoro (on headset) →
 * none (caller falls back to browser speech / subtitles). Clips for fixed
 * narration are cached in IndexedDB so they play instantly next time.
 */
export class VoiceEngine {
  readonly kokoro = new KokoroVoice();
  lastEngine: EngineUsed = null;
  lastError: string | null = null;

  constructor(private cfg: VoiceConfigStore) {}

  order(): ('elevenlabs' | 'kokoro' | 'browser')[] {
    return engineOrder(this.cfg.get(), KokoroVoice.supported());
  }

  private cacheKey(engine: string, text: string): string {
    const c = this.cfg.get();
    const voice = engine === 'elevenlabs' ? c.elevenVoiceId : `${c.kokoroVoice}@${c.kokoroSpeed}`;
    return `gen:${engine}:${voice}:${hashText(text)}`;
  }

  /**
   * Yields audio clips for the text, sentence by sentence (Kokoro) or whole (ElevenLabs).
   * Returns false if no neural engine could speak it (caller should use browser speech).
   */
  async *clips(text: string, cache: boolean, cancelled: () => boolean): AsyncGenerator<Blob, boolean> {
    this.lastError = null;
    for (const engine of this.order()) {
      if (engine === 'browser') return false;
      try {
        if (cache) {
          const hit = await get<{ key: string; blob: Blob }>('narration', this.cacheKey(engine, text)).catch(() => undefined);
          if (hit?.blob) {
            this.lastEngine = engine;
            yield hit.blob;
            return true;
          }
        }
        const made: Blob[] = [];
        if (engine === 'elevenlabs') {
          const b = await this.eleven(text);
          made.push(b);
          this.lastEngine = engine;
          yield b;
        } else {
          const c = this.cfg.get();
          const parts = splitSentences(text);
          // Generate one sentence ahead of playback.
          let next = parts.length ? this.kokoro.synth(parts[0], c.kokoroVoice, c.kokoroSpeed) : null;
          for (let i = 0; i < parts.length && next; i++) {
            const r = await next;
            next = i + 1 < parts.length ? this.kokoro.synth(parts[i + 1], c.kokoroVoice, c.kokoroSpeed) : null;
            const b = encodeWav(r.pcm, r.rate);
            made.push(b);
            this.lastEngine = engine;
            if (cancelled()) return true;
            yield b;
          }
        }
        if (cache && made.length && !cancelled()) {
          const blob = made.length === 1 ? made[0] : await joinWavs(made);
          if (blob) await put('narration', { key: this.cacheKey(engine, text), blob }).catch(() => undefined);
        }
        return true;
      } catch (e) {
        this.lastError = `${engine === 'elevenlabs' ? 'ElevenLabs' : 'On-headset voice'}: ${(e as Error).message}`;
        // fall through to the next engine
      }
    }
    return false;
  }

  private async eleven(text: string): Promise<Blob> {
    const c = this.cfg.get();
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(c.elevenVoiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': c.elevenKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.6, similarity_boost: 0.75 } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }

  /** Deletes generated (not user-recorded) narration audio. */
  async clearGenerated(): Promise<number> {
    const all = await getAll<{ key: string }>('narration').catch(() => []);
    const gen = all.filter((r) => r.key.startsWith('gen:'));
    for (const r of gen) await del('narration', r.key).catch(() => undefined);
    return gen.length;
  }
}

/** Concatenate WAV clips that share a format (used to cache multi-sentence narration as one file). */
async function joinWavs(clips: Blob[]): Promise<Blob | null> {
  const bufs = await Promise.all(clips.map((b) => b.arrayBuffer()));
  if (bufs.some((b) => b.byteLength < 44)) return null;
  const rate = new DataView(bufs[0]).getUint32(24, true);
  const datas = bufs.map((b) => new Int16Array(b.slice(44)));
  const total = datas.reduce((n, d) => n + d.length, 0);
  const pcm = new Float32Array(total);
  let o = 0;
  for (const d of datas) for (let i = 0; i < d.length; i++) pcm[o++] = d[i] / 0x8000;
  return encodeWav(pcm, rate);
}

import { MicrophoneRecorder } from '../audio/MicrophoneRecorder.js';
import type { AIConfig } from './types.js';

type SR = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

function srCtor(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Push-to-talk speech-to-text.
 *  - browser: the Web Speech API (may send audio to the browser maker's servers)
 *  - whisper: records locally, then sends the clip to an OpenAI-compatible /audio/transcriptions endpoint
 *  - typing: no speech; the user types (browser view)
 */
export class SpeechRecognitionAdapter {
  private sr: SR | null = null;
  private rec = new MicrophoneRecorder();
  private finalText = '';
  private interim = '';
  onInterim: (text: string) => void = () => {};
  listening = false;

  constructor(private getCfg: () => AIConfig) {}

  static browserAvailable(): boolean {
    return srCtor() !== null;
  }

  available(): boolean {
    const m = this.getCfg().stt;
    if (m === 'browser') return SpeechRecognitionAdapter.browserAvailable();
    if (m === 'whisper') return MicrophoneRecorder.supported() && !!this.getCfg().sttKey;
    return false;
  }

  async start(): Promise<void> {
    this.finalText = '';
    this.interim = '';
    const cfg = this.getCfg();
    if (cfg.stt === 'browser') {
      const C = srCtor();
      if (!C) throw new Error('Speech recognition is not available in this browser.');
      const sr = new C();
      sr.lang = navigator.language || 'en-US';
      sr.interimResults = true;
      sr.continuous = true;
      sr.onresult = (e) => {
        let fin = '';
        let int = '';
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) fin += r[0].transcript;
          else int += r[0].transcript;
        }
        this.finalText = fin;
        this.interim = int;
        this.onInterim(`${fin} ${int}`.trim());
      };
      sr.onerror = () => undefined;
      this.sr = sr;
      sr.start();
    } else if (cfg.stt === 'whisper') {
      await this.rec.start();
    } else {
      throw new Error('Voice input is off — type instead.');
    }
    this.listening = true;
  }

  /** Stop listening and return the transcript. */
  async stop(): Promise<string> {
    this.listening = false;
    const cfg = this.getCfg();
    if (cfg.stt === 'browser' && this.sr) {
      const sr = this.sr;
      this.sr = null;
      await new Promise<void>((res) => {
        sr.onend = () => res();
        sr.stop();
        setTimeout(res, 1500);
      });
      return `${this.finalText} ${this.interim}`.trim();
    }
    if (cfg.stt === 'whisper') {
      const clip = await this.rec.stop();
      if (!clip) return '';
      const form = new FormData();
      const ext = clip.mime.includes('mp4') ? 'm4a' : clip.mime.includes('ogg') ? 'ogg' : 'webm';
      form.append('file', clip.blob, `speech.${ext}`);
      form.append('model', cfg.sttModel || 'whisper-1');
      const res = await fetch(`${cfg.sttBaseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.sttKey}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Transcription failed (HTTP ${res.status})`);
      const data = (await res.json()) as { text?: string };
      return (data.text ?? '').trim();
    }
    return '';
  }

  cancel(): void {
    this.listening = false;
    this.sr?.abort();
    this.sr = null;
    void this.rec.stop();
  }
}

export type VoiceEngineId = 'auto' | 'elevenlabs' | 'kokoro' | 'browser' | 'off';

export interface VoiceConfig {
  engine: VoiceEngineId;
  kokoroVoice: string;
  kokoroSpeed: number;
  /** User allowed downloading the on-headset voice model. */
  kokoroEnabled: boolean;
  elevenKey: string;
  elevenVoiceId: string;
  /** Consent to send text-to-be-spoken to ElevenLabs. */
  elevenConsent: boolean;
}

export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart — warm, US' },
  { id: 'af_bella', label: 'Bella — soft, US' },
  { id: 'am_michael', label: 'Michael — calm, US' },
  { id: 'bf_emma', label: 'Emma — gentle, UK' },
  { id: 'bm_george', label: 'George — steady, UK' },
];

export const ELEVEN_VOICES = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
];

const DEFAULTS: VoiceConfig = {
  engine: 'auto',
  kokoroVoice: 'af_heart',
  kokoroSpeed: 0.9,
  kokoroEnabled: false,
  elevenKey: '',
  elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
  elevenConsent: false,
};

const KEY = 'gvr.voice.v1';

export class VoiceConfigStore {
  private c: VoiceConfig;
  private listeners = new Set<() => void>();
  constructor() {
    let s: Partial<VoiceConfig> = {};
    try {
      s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VoiceConfig>;
    } catch {
      s = {};
    }
    this.c = { ...DEFAULTS, ...s };
  }
  get(): VoiceConfig {
    return this.c;
  }
  set<K extends keyof VoiceConfig>(k: K, v: VoiceConfig[K]): void {
    this.c = { ...this.c, [k]: v };
    if (k === 'elevenKey') this.c.elevenConsent = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.c));
    } catch {
      /* ignore */
    }
    this.listeners.forEach((l) => l());
  }
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }
}

/** Which engines to try, in order, for the current settings. */
export function engineOrder(c: VoiceConfig, kokoroSupported: boolean): ('elevenlabs' | 'kokoro' | 'browser')[] {
  const eleven = !!c.elevenKey && c.elevenConsent;
  const kokoro = kokoroSupported && c.kokoroEnabled;
  switch (c.engine) {
    case 'off': return [];
    case 'browser': return ['browser'];
    case 'elevenlabs': return [...(eleven ? ['elevenlabs' as const] : []), ...(kokoro ? ['kokoro' as const] : []), 'browser'];
    case 'kokoro': return [...(kokoro ? ['kokoro' as const] : []), 'browser'];
    default: return [...(eleven ? ['elevenlabs' as const] : []), ...(kokoro ? ['kokoro' as const] : []), 'browser'];
  }
}

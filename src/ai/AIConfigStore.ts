import { DEFAULT_AI_CONFIG, DEFAULT_MODELS, type AIConfig, type ProviderId } from './types.js';

const KEY = 'gvr.ai.v1';

/** Stored only in this browser (localStorage). Keys never leave the device except in calls to the provider you chose. */
export class AIConfigStore {
  private c: AIConfig;

  constructor() {
    let s: Partial<AIConfig> = {};
    try {
      s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AIConfig>;
    } catch {
      s = {};
    }
    this.c = { ...DEFAULT_AI_CONFIG, ...s };
  }

  get(): AIConfig {
    return this.c;
  }

  set<K extends keyof AIConfig>(k: K, v: AIConfig[K]): void {
    const next = { ...this.c, [k]: v };
    if (k === 'provider') {
      next.model = DEFAULT_MODELS[v as ProviderId] || next.model;
      if (v === 'openai' && !next.baseUrl) next.baseUrl = 'https://api.openai.com/v1';
      next.consent = null; // new destination → ask again
    }
    if (k === 'includeHistory' || k === 'stt') next.consent = null;
    this.c = next;
    this.save();
  }

  consent(): void {
    this.c = {
      ...this.c,
      consent: { provider: this.c.provider, at: new Date().toISOString(), history: this.c.includeHistory, audio: this.c.stt !== 'typing' },
    };
    this.save();
  }

  /** True when AI is on, configured, and the user consented to the current destination. */
  ready(): boolean {
    const c = this.c;
    if (c.provider === 'off') return false;
    if (c.provider === 'scripted') return true;
    return !!c.consent && c.consent.provider === c.provider;
  }

  disable(): void {
    this.c = { ...this.c, provider: 'off', consent: null };
    this.save();
  }

  forgetKeys(): void {
    this.c = { ...this.c, apiKey: '', sttKey: '' };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.c));
    } catch {
      /* ignore */
    }
  }
}

import type { SettingsManager } from '../settings/SettingsManager.js';
import type { VoiceEngine } from './VoiceEngine.js';

export type NarratorProfile = 'default' | 'my-voice' | 'imported';

/**
 * Plays narration for a segment. Order of preference:
 *   1. a recorded clip for the active profile (Voice Studio, Milestone 2),
 *   2. the voice engine: ElevenLabs or the on-headset Kokoro voice,
 *   3. browser text-to-speech if available,
 *   4. subtitles only.
 * Subtitles are always reported through onSubtitle so they can be shown even
 * when audio is off.
 */
export class NarrationManager {
  profile: NarratorProfile = 'default';
  private audioEl: HTMLAudioElement | null = null;
  private last: { segment: string; text: string } | null = null;
  private token = 0;
  private hasTTS = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  constructor(
    private settings: SettingsManager,
    private lookupClip: (profile: NarratorProfile, segment: string) => Promise<Blob | undefined>,
    private onSubtitle: (text: string | null) => void,
    private voice?: VoiceEngine,
  ) {}

  private play(blob: Blob, volume: number): Promise<void> {
    const el = new Audio(URL.createObjectURL(blob));
    el.volume = volume;
    this.audioEl = el;
    return new Promise<void>((res) => {
      const done = () => {
        URL.revokeObjectURL(el.src);
        res();
      };
      el.onended = done;
      el.onerror = done;
      el.onpause = () => {
        if (this.audioEl !== el) done();
      };
      el.play().catch(done);
    });
  }

  async say(segment: string, text: string): Promise<void> {
    this.stop();
    const my = ++this.token;
    this.last = { segment, text };
    const s = this.settings.get();
    if (s.subtitles) this.onSubtitle(text);
    if (!s.narrationOn) return;

    let clip: Blob | undefined;
    if (this.profile !== 'default') {
      try {
        clip = await this.lookupClip(this.profile, segment);
      } catch {
        clip = undefined; // missing-segment fallback
      }
    }
    if (my !== this.token) return;

    let spoke = false;
    if (clip) {
      await this.play(clip, s.narrationVolume);
      spoke = true;
    } else if (this.voice) {
      const cache = segment !== 'ai' && segment !== 'test';
      const gen = this.voice.clips(text, cache, () => my !== this.token);
      for (;;) {
        const r = await gen.next();
        if (my !== this.token) return;
        if (r.done) {
          spoke = spoke || r.value;
          break;
        }
        spoke = true;
        await this.play(r.value, s.narrationVolume);
        if (my !== this.token) return;
      }
    }
    if (my !== this.token) return;
    if (!spoke && this.hasTTS) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      u.pitch = 1;
      u.volume = s.narrationVolume;
      const voices = speechSynthesis.getVoices();
      const en = voices.find((v) => /en[-_]/i.test(v.lang) && /female|samantha|serena|google uk/i.test(v.name)) ??
        voices.find((v) => /^en/i.test(v.lang));
      if (en) u.voice = en;
      await new Promise<void>((res) => {
        u.onend = () => res();
        u.onerror = () => res();
        speechSynthesis.speak(u);
      });
    }
    if (my === this.token && s.subtitles) {
      // Keep the subtitle visible a moment after speech ends.
      setTimeout(() => my === this.token && this.onSubtitle(null), 2500);
    }
  }

  repeat(): void {
    if (this.last) void this.say(this.last.segment, this.last.text);
  }

  pause(): void {
    this.audioEl?.pause();
    if (this.hasTTS) speechSynthesis.pause();
  }

  resume(): void {
    void this.audioEl?.play().catch(() => undefined);
    if (this.hasTTS) speechSynthesis.resume();
  }

  stop(): void {
    this.token++;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    if (this.hasTTS) speechSynthesis.cancel();
    this.onSubtitle(null);
  }

  get hasLast(): boolean {
    return this.last !== null;
  }

  clearLast(): void {
    this.last = null;
  }
}

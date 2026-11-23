import type { SettingsManager } from '../settings/SettingsManager.js';

export type NarratorProfile = 'default' | 'my-voice' | 'imported';

/**
 * Plays narration for a segment. Order of preference:
 *   1. a recorded clip for the active profile (Voice Studio, Milestone 2),
 *   2. browser text-to-speech if available,
 *   3. subtitles only.
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
  ) {}

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

    if (clip) {
      const el = new Audio(URL.createObjectURL(clip));
      el.volume = s.narrationVolume;
      this.audioEl = el;
      await new Promise<void>((res) => {
        el.onended = () => res();
        el.onerror = () => res();
        el.play().catch(() => res());
      });
      URL.revokeObjectURL(el.src);
    } else if (this.hasTTS) {
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

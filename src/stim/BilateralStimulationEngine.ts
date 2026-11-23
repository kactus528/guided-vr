import type { Settings } from '../settings/SettingsManager.js';
import type { AudioStimulusController } from './AudioStimulusController.js';
import type { HapticStimulusController } from './HapticStimulusController.js';
import type { VisualStimulusController } from './VisualStimulusController.js';
import { alignedDuration, beatSide, beatTime, patternPosition } from './patterns.js';

export interface StimLog {
  mode: string;
  startedAt: string;
  plannedDuration: number;
  alignedDuration: number;
  actualDuration: number;
  completed: boolean;
  stopReason?: string;
  beats: number;
  audioBeats: number;
  hapticBeats: number;
  frames: number;
  avgFrameMs: number;
  maxFrameMs: number;
  audioAvailable: boolean;
  hapticsAvailable: boolean;
  settings: Settings;
}

const LEAD_IN = 1.2; // s: target fades in at centre before moving
const FADE_OUT = 0.5;
const LOOKAHEAD = 0.15; // s of audio scheduled ahead

interface RunState {
  s: Settings;
  t0: number;
  pausedTotal: number;
  pausedAt: number | null;
  end: number;
  nextAudio: number;
  nextHaptic: number;
  nextBeat: number;
  log: StimLog;
  lastFrame: number;
  frameSum: number;
  onEnd: (log: StimLog) => void;
}

/**
 * Central timing controller. One clock (performance.now) drives visuals; audio
 * is scheduled ahead on the AudioContext clock from the same beat times, so
 * modalities stay aligned and animation is frame-rate independent.
 */
export class BilateralStimulationEngine {
  private r: RunState | null = null;

  constructor(
    private visual: VisualStimulusController,
    private getAudio: () => AudioStimulusController | null,
    private haptics: HapticStimulusController,
  ) {}

  get running(): boolean {
    return this.r !== null;
  }

  get paused(): boolean {
    return this.r?.pausedAt != null;
  }

  private now(): number {
    return performance.now() / 1000;
  }

  start(settings: Settings, duration: number, mode: string, onEnd: (log: StimLog) => void): void {
    this.stop('restarted');
    const s = { ...settings };
    const audio = this.getAudio();
    const now = this.now();
    const end = alignedDuration(duration, s.speed);
    this.r = {
      s,
      t0: now,
      pausedTotal: 0,
      pausedAt: null,
      end,
      nextAudio: 0,
      nextHaptic: 0,
      nextBeat: 0,
      lastFrame: now,
      frameSum: 0,
      onEnd,
      log: {
        mode,
        startedAt: new Date().toISOString(),
        plannedDuration: duration,
        alignedDuration: end,
        actualDuration: 0,
        completed: false,
        beats: 0,
        audioBeats: 0,
        hapticBeats: 0,
        frames: 0,
        avgFrameMs: 0,
        maxFrameMs: 0,
        audioAvailable: !!audio && audio.running,
        hapticsAvailable: this.haptics.available(),
        settings: s,
      },
    };
    this.visual.apply(s);
    this.visual.place(0, 0, s, 0);
    this.visual.show(true);
  }

  /** Seconds of active movement time (negative during lead-in). */
  private activeTime(now: number): number {
    const r = this.r!;
    const ref = r.pausedAt ?? now;
    return ref - r.t0 - r.pausedTotal - LEAD_IN;
  }

  update(): void {
    const r = this.r;
    if (!r) return;
    const now = this.now();
    const dtMs = (now - r.lastFrame) * 1000;
    r.lastFrame = now;
    if (r.pausedAt != null) return;
    r.log.frames++;
    r.frameSum += dtMs;
    if (r.log.frames > 2) r.log.maxFrameMs = Math.max(r.log.maxFrameMs, dtMs);

    const t = this.activeTime(now);
    const s = r.s;
    const f = s.speed;

    if (t < 0) {
      // Lead-in: fade in at centre.
      const a = Math.min(1, (t + LEAD_IN) / LEAD_IN);
      this.visual.place(0, 0, s, a);
    } else if (t < r.end) {
      const pos = patternPosition(s.pattern, t * f);
      this.visual.place(pos.x, pos.y, s, 1);
    } else {
      const a = Math.max(0, 1 - (t - r.end) / FADE_OUT);
      this.visual.place(0, 0, s, a);
      if (t >= r.end + FADE_OUT) {
        this.finish(true);
        return;
      }
    }

    // Beat bookkeeping (used for logging and haptics).
    while (beatTime(r.nextBeat, f) <= t && beatTime(r.nextBeat, f) < r.end) {
      r.log.beats++;
      r.nextBeat++;
    }

    // Audio: schedule slightly ahead on the audio clock.
    const audio = s.audioOn ? this.getAudio() : null;
    if (audio && audio.running) {
      while (beatTime(r.nextAudio, f) < r.end && beatTime(r.nextAudio, f) < t + LOOKAHEAD) {
        const bt = beatTime(r.nextAudio, f);
        if (bt >= t - 0.02) {
          audio.beat(beatSide(r.nextAudio), audio.currentTime + (bt - t), s.tone, s.volume);
          r.log.audioBeats++;
        }
        r.nextAudio++;
      }
    }

    // Haptics: fire on the frame the beat is reached.
    if (s.hapticsOn) {
      while (beatTime(r.nextHaptic, f) <= t && beatTime(r.nextHaptic, f) < r.end) {
        if (this.haptics.pulse(beatSide(r.nextHaptic), s.hapticIntensity, s.hapticMs)) r.log.hapticBeats++;
        r.nextHaptic++;
      }
    }
  }

  pause(): void {
    const r = this.r;
    if (!r || r.pausedAt != null) return;
    r.pausedAt = this.now();
    this.getAudio()?.stopAll();
  }

  resume(): void {
    const r = this.r;
    if (!r || r.pausedAt == null) return;
    const now = this.now();
    r.pausedTotal += now - r.pausedAt;
    r.pausedAt = null;
    r.lastFrame = now;
    // Re-sync audio scheduling to the first beat not yet heard.
    const t = this.activeTime(now);
    let k = 0;
    while (beatTime(k, r.s.speed) < t) k++;
    r.nextAudio = Math.max(r.nextAudio, k);
  }

  /** Immediate stop. Reports the partial set to the caller. */
  stop(reason: string): void {
    if (!this.r) return;
    this.r.log.stopReason = reason;
    this.finish(false);
  }

  private finish(completed: boolean): void {
    const r = this.r;
    if (!r) return;
    this.r = null;
    this.getAudio()?.stopAll();
    this.visual.show(false);
    const now = this.now();
    const ref = r.pausedAt ?? now;
    r.log.completed = completed;
    r.log.actualDuration = Math.max(0, Math.min(r.end, ref - r.t0 - r.pausedTotal - LEAD_IN));
    r.log.avgFrameMs = r.log.frames ? r.frameSum / r.log.frames : 0;
    r.onEnd(r.log);
  }
}

import type { ToneType } from '../settings/SettingsManager.js';

/**
 * Alternating left/right sounds with explicit stereo routing: each beat is
 * wired into input 0 (left) or input 1 (right) of a ChannelMergerNode, so the
 * sound is genuinely in one ear only. These are alternating bilateral sounds,
 * not binaural beats — both ears never receive simultaneous offset tones.
 */
export class AudioStimulusController {
  private merger: ChannelMergerNode;
  private master: GainNode;
  private live = new Set<AudioScheduledSourceNode>();
  private noise: AudioBuffer;

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.channelCount = 2;
    this.master.channelCountMode = 'explicit';
    this.master.channelInterpretation = 'discrete';
    this.merger = ctx.createChannelMerger(2);
    this.merger.connect(this.master);
    this.master.connect(ctx.destination);
    // 20 ms of noise for the click sound.
    const len = Math.floor(ctx.sampleRate * 0.02);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }

  get currentTime(): number {
    return this.ctx.currentTime;
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /** Schedule one beat on one side at AudioContext time `when`. */
  beat(side: 'L' | 'R', when: number, type: ToneType, volume: number): void {
    const t = Math.max(when, this.ctx.currentTime + 0.005);
    const env = this.ctx.createGain();
    env.gain.value = 0;
    env.connect(this.merger, 0, side === 'L' ? 0 : 1);
    let src: AudioScheduledSourceNode;
    let end: number;
    const peak = volume * 0.6;
    if (type === 'click') {
      const b = this.ctx.createBufferSource();
      b.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2200;
      bp.Q.value = 1.2;
      b.connect(bp).connect(env);
      env.gain.setValueAtTime(peak, t);
      end = t + 0.03;
      src = b;
    } else {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const isPulse = type === 'pulse';
      o.frequency.value = isPulse ? 196 : 523.25;
      o.connect(env);
      const attack = isPulse ? 0.04 : 0.008;
      const release = isPulse ? 0.26 : 0.14;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(isPulse ? peak * 0.9 : peak * 0.55, t + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
      end = t + attack + release + 0.02;
      src = o;
    }
    src.start(t);
    src.stop(end);
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      env.disconnect();
    };
  }

  /** Immediately silence and cancel everything scheduled. */
  stopAll(): void {
    for (const s of this.live) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live.clear();
  }
}

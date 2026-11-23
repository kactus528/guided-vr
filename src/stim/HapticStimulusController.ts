interface HapticActuatorLike {
  pulse?: (value: number, duration: number) => Promise<boolean>;
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
}

/** Alternating controller vibration with runtime feature detection; silently no-ops when unavailable. */
export class HapticStimulusController {
  constructor(private getSources: () => readonly XRInputSource[]) {}

  private actuator(side: 'L' | 'R'): HapticActuatorLike | null {
    const hand = side === 'L' ? 'left' : 'right';
    const src = this.getSources().find((s) => s.handedness === hand);
    const gp = src?.gamepad as (Gamepad & { hapticActuators?: HapticActuatorLike[]; vibrationActuator?: HapticActuatorLike }) | undefined;
    if (!gp) return null;
    return gp.hapticActuators?.[0] ?? gp.vibrationActuator ?? null;
  }

  available(): boolean {
    return this.actuator('L') !== null || this.actuator('R') !== null;
  }

  pulse(side: 'L' | 'R', intensity: number, ms: number): boolean {
    const a = this.actuator(side);
    if (!a) return false;
    try {
      if (a.pulse) {
        void a.pulse(intensity, ms);
        return true;
      }
      if (a.playEffect) {
        void a.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}

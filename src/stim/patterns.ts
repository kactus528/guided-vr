import type { Pattern } from '../settings/SettingsManager.js';

/**
 * Normalised target position for a phase (cycles elapsed). x in [-1, 1]
 * (−1 = far left), y in units of the half-width (positive = up).
 * All patterns start centred and moving right, reach the right extreme at
 * phase .25 and the left extreme at .75, so beats line up across patterns.
 */
export function patternPosition(pattern: Pattern, phase: number): { x: number; y: number } {
  const p = phase - Math.floor(phase);
  const sine = Math.sin(2 * Math.PI * p);
  switch (pattern) {
    case 'horizontal': {
      // Linear sweep with softened reversals (70% triangle, 30% sine).
      const tri = p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
      return { x: 0.7 * tri + 0.3 * sine, y: 0 };
    }
    case 'arc':
      // Experimental: shallow downward arc through the centre.
      return { x: sine, y: -0.22 * (1 - sine * sine) };
    case 'sinusoidal':
    default:
      return { x: sine, y: 0 };
  }
}

/** Time (s from set start) of beat k at f cycles/s. Even k = right extreme, odd = left. */
export function beatTime(k: number, f: number): number {
  return (0.25 + 0.5 * k) / f;
}

export function beatSide(k: number): 'L' | 'R' {
  return k % 2 === 0 ? 'R' : 'L';
}

/** Round a requested duration up so the target finishes back at centre (half-cycle boundary). */
export function alignedDuration(requested: number, f: number): number {
  return Math.ceil(requested * 2 * f - 1e-9) / (2 * f);
}

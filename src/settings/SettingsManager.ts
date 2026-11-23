export type Pattern = 'horizontal' | 'sinusoidal' | 'arc';
export type ToneType = 'tone' | 'click' | 'pulse';
export type ViewMode = 'seated' | 'reclining';

export interface Settings {
  // Visual bilateral stimulation
  speed: number; // full left-right-left cycles per second
  width: number; // total horizontal visual angle, degrees
  distance: number; // virtual target distance, metres
  size: number; // target angular diameter, degrees
  brightness: number; // 0..1
  color: string;
  pattern: Pattern;
  setDuration: number; // seconds
  // Auditory
  audioOn: boolean;
  tone: ToneType;
  volume: number;
  // Haptics
  hapticsOn: boolean;
  hapticIntensity: number;
  hapticMs: number;
  // Narration
  narrationOn: boolean;
  narrationVolume: number;
  subtitles: boolean;
  // View
  viewMode: ViewMode;
  // Processing
  processingStyle: 'restricted' | 'open' | 'standard';
  sessionMinutes: number;
}

/**
 * Defaults include an illustrative research-reference setting of roughly one
 * full horizontal cycle per second with short sets. This is a starting point,
 * not a prescription.
 */
export const DEFAULT_SETTINGS: Settings = {
  speed: 1.0,
  width: 40,
  distance: 2,
  size: 1.5,
  brightness: 0.8,
  color: '#7fe8ff',
  pattern: 'sinusoidal',
  setDuration: 25,
  audioOn: true,
  tone: 'tone',
  volume: 0.4,
  hapticsOn: false,
  hapticIntensity: 0.4,
  hapticMs: 60,
  narrationOn: true,
  narrationVolume: 0.9,
  subtitles: true,
  viewMode: 'seated',
  processingStyle: 'restricted',
  sessionMinutes: 60,
};

export const COLORS: { value: string; label: string }[] = [
  { value: '#7fe8ff', label: 'Soft cyan' },
  { value: '#ffffff', label: 'White' },
  { value: '#ffc27a', label: 'Warm amber' },
  { value: '#8dffb0', label: 'Green' },
  { value: '#c7a2ff', label: 'Violet' },
];

export type SettingRow =
  | { key: keyof Settings; label: string; kind: 'number'; min: number; max: number; step: number; fmt: (v: number) => string }
  | { key: keyof Settings; label: string; kind: 'enum'; options: { value: string; label: string }[] }
  | { key: keyof Settings; label: string; kind: 'bool' };

export const SETTING_ROWS: SettingRow[] = [
  { key: 'speed', label: 'Speed', kind: 'number', min: 0.3, max: 2, step: 0.1, fmt: (v) => `${v.toFixed(1)} cycles/s` },
  { key: 'width', label: 'Width', kind: 'number', min: 10, max: 70, step: 5, fmt: (v) => `${v}°` },
  { key: 'distance', label: 'Distance', kind: 'number', min: 1, max: 4, step: 0.25, fmt: (v) => `${v.toFixed(2)} m` },
  { key: 'size', label: 'Target size', kind: 'number', min: 0.5, max: 4, step: 0.25, fmt: (v) => `${v.toFixed(2)}°` },
  { key: 'brightness', label: 'Brightness', kind: 'number', min: 0.2, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'color', label: 'Colour', kind: 'enum', options: COLORS },
  {
    key: 'pattern', label: 'Movement', kind: 'enum', options: [
      { value: 'sinusoidal', label: 'Sinusoidal' },
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'arc', label: 'Arc (experimental)' },
    ],
  },
  { key: 'setDuration', label: 'Set length', kind: 'number', min: 10, max: 60, step: 5, fmt: (v) => `${v} s` },
  { key: 'audioOn', label: 'Bilateral sound', kind: 'bool' },
  {
    key: 'tone', label: 'Sound type', kind: 'enum', options: [
      { value: 'tone', label: 'Soft tone' },
      { value: 'click', label: 'Gentle click' },
      { value: 'pulse', label: 'Ambient pulse' },
    ],
  },
  { key: 'volume', label: 'Sound volume', kind: 'number', min: 0, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'hapticsOn', label: 'Controller haptics', kind: 'bool' },
  { key: 'hapticIntensity', label: 'Haptic strength', kind: 'number', min: 0.1, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'narrationOn', label: 'Spoken narration', kind: 'bool' },
  { key: 'subtitles', label: 'Subtitles', kind: 'bool' },
  {
    key: 'viewMode', label: 'Position', kind: 'enum', options: [
      { value: 'seated', label: 'Seated' },
      { value: 'reclining', label: 'Reclining' },
    ],
  },
  {
    key: 'processingStyle', label: 'Processing style', kind: 'enum', options: [
      { value: 'restricted', label: 'Focused' },
      { value: 'open', label: 'Open' },
      { value: 'standard', label: 'Standard protocol' },
    ],
  },
  { key: 'sessionMinutes', label: 'Session time', kind: 'number', min: 30, max: 120, step: 15, fmt: (v) => `${v} min` },
];

const KEY = 'gvr.settings.v1';

export class SettingsManager {
  private s: Settings;
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    let stored: Partial<Settings> = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    } catch {
      stored = {};
    }
    this.s = { ...DEFAULT_SETTINGS, ...stored };
  }

  get(): Readonly<Settings> {
    return this.s;
  }

  snapshot(): Settings {
    return { ...this.s };
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.s = { ...this.s, [key]: value };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* storage unavailable: keep in memory */
    }
    this.listeners.forEach((l) => l(this.s));
  }

  onChange(fn: (s: Settings) => void): void {
    this.listeners.add(fn);
  }

  /** Step a row up or down (numbers), cycle (enums) or toggle (bools). */
  adjust(key: keyof Settings, dir: 1 | -1): void {
    const row = SETTING_ROWS.find((r) => r.key === key);
    if (!row) return;
    const cur = this.s[key];
    if (row.kind === 'number') {
      const v = Math.min(row.max, Math.max(row.min, (cur as number) + dir * row.step));
      this.set(key, Math.round(v * 100) / 100 as never);
    } else if (row.kind === 'enum') {
      const i = row.options.findIndex((o) => o.value === cur);
      const n = row.options.length;
      this.set(key, row.options[((i < 0 ? 0 : i) + dir + n) % n].value as never);
    } else {
      this.set(key, !cur as never);
    }
  }

  display(row: SettingRow): string {
    const v = this.s[row.key];
    if (row.kind === 'number') return row.fmt(v as number);
    if (row.kind === 'enum') return row.options.find((o) => o.value === v)?.label ?? String(v);
    return v ? 'On' : 'Off';
  }
}

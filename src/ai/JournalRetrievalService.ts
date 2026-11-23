import type { SessionRecord } from '../session/types.js';

const FIELDS: [string, string][] = [
  ['emotions', 'feelings'], ['emotions_text', 'feelings'], ['negBelief', 'belief'], ['negBelief_text', 'belief'],
  ['posBelief', 'preferred belief'], ['situation_text', 'situation'], ['sensations', 'body'], ['sensations_end', 'body after'],
];

function words(v: unknown): string[] {
  const s = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
  return s.toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 3);
}

/** One short line per past session, built only from what the user entered as text (no audio, no AI turns). */
export function summarise(r: SessionRecord): string {
  const a = r.answers;
  const parts: string[] = [];
  for (const [k, label] of FIELDS) {
    const v = a[k];
    if (v === undefined || (typeof v === 'string' && v.startsWith('rec_'))) continue;
    parts.push(`${label}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  }
  const refl = Object.keys(a).filter((k) => /^reflect_\d+_text$/.test(k)).map((k) => String(a[k]));
  if (refl.length) parts.push(`noticed: ${refl.slice(-2).join(' / ')}`);
  if (typeof a.sud_0 === 'number' || typeof a.sud_end === 'number') parts.push(`distress ${a.sud_0 ?? '?'}→${a.sud_end ?? '?'}`);
  return `${r.startedAt.slice(0, 10)} — ${parts.join('; ')}`.slice(0, 400);
}

/** Selects a few past sessions most related to the current one by simple word overlap. */
export function selectRelevant(current: Record<string, unknown>, past: SessionRecord[], max = 4): string[] {
  const q = new Set(FIELDS.flatMap(([k]) => words(current[k])));
  const scored = past
    .filter((r) => r.definitionId === 'guided-v1')
    .map((r) => {
      const w = FIELDS.flatMap(([k]) => words(r.answers[k]));
      return { r, score: w.filter((x) => q.has(x)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.startedAt.localeCompare(a.r.startedAt))
    .slice(0, max);
  return scored.map((x) => summarise(x.r));
}

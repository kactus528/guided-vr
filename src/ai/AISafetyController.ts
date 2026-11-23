/**
 * Deterministic checks that run before and after every AI turn. These are
 * keyword safeguards, not a detector: they can miss things and can misfire,
 * and they never replace the Ground button or the check-ins.
 */

const CRISIS = new RegExp(
  [
    'kill(ing)? myself', 'suicid\\w*', 'end(ing)? (it all|my life|things)', '(want|wants|wanted|wanting) to die',
    "(don'?t|do not) want to (be alive|live|be here)", 'hurt(ing)? myself', 'self[- ]?harm', 'cut(ting)? myself(?!\\s+off)',
    'overdos\\w*', 'wish (i was|i were|i\'d be) dead', 'better off dead', 'no (reason|point) (to|in) (live|living|going on)',
    "can'?t go on",
  ].map((x) => `\\b${x}\\b`).join('|'),
  'i',
);

const DISORIENTED = new RegExp(
  [
    "(don'?t|do not) feel real", "nothing (feels|seems|is) real", "not real anymore", 'unreal',
    'where am i', "can'?t feel my body", 'out of my body', 'outside (of )?my body', 'floating away',
    'everything (is|feels) far away', "can'?t breathe", 'panic attack', 'losing (it|my mind|control)',
    "don'?t know where i am", 'spacing out', 'blanking out', 'numb all over',
  ].join('|'),
  'i',
);

export type SafetyVerdict = { level: 'ok' } | { level: 'disoriented' } | { level: 'crisis' };

export function checkUserText(text: string): SafetyVerdict {
  if (CRISIS.test(text)) return { level: 'crisis' };
  if (DISORIENTED.test(text)) return { level: 'disoriented' };
  return { level: 'ok' };
}

const FORBIDDEN_OUTPUT = [
  /\b(repressed|hidden|buried|recovered) memor/i,
  /\byou (probably |may |might |likely )?(have|suffer from) (ptsd|c-?ptsd|complex ptsd|bpd|a (disorder|condition))/i,
  /\bdiagnos(e|is|ed)\b/i,
  /\b(i am|i'm) (a|your) (therapist|psychologist|counsel+or|doctor)\b/i,
  /\b(push|keep) (through|going) (even|no matter)/i,
  /\byou (must|need to|have to) (continue|keep going|do another set)/i,
];

export const SAFE_FALLBACK = 'Thank you for sharing that. What are you noticing now?';

/** Replaces replies that break the guide's rules with a neutral prompt. */
export function filterReply(say: string): { say: string; replaced: boolean } {
  if (FORBIDDEN_OUTPUT.some((r) => r.test(say))) return { say: SAFE_FALLBACK, replaced: true };
  return { say, replaced: false };
}

export const CRISIS_MESSAGE =
  "It sounds like you might be thinking about hurting yourself or not wanting to be alive. I've stopped the session. " +
  "You don't have to go through this alone: in the US you can call or text 988 (Suicide & Crisis Lifeline) any time, " +
  'or call 911 or your local emergency number if you are in immediate danger. Please take the headset off and reach out to someone now.';

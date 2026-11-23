import { permittedActions } from './AIActionValidator.js';
import type { AIReply, ChatTurn, ConfirmedPattern } from './types.js';
import { AI_ACTIONS } from './types.js';

export interface SessionSnapshot {
  stage: string;
  stepId: string;
  stepTitle: string;
  sessionType: string;
  processingStyle?: string;
  setCount: number;
  answers: Record<string, unknown>;
}

const SYSTEM = `You are a calm, brief voice guide inside a private, experimental VR app for emotional processing with bilateral stimulation (EMDR-inspired, self-guided).

You are NOT a therapist and must never claim to be one. Strict rules:
- Never diagnose or name conditions. Never interpret what the user's experience "means" or where it "comes from".
- Never suggest hidden, repressed, or recovered memories, and never invent or add details to anything the user describes.
- Never pressure the user to continue, go deeper, intensify, or do another set. Stopping, grounding, or closing is always fine.
- You cannot start stimulation, change its speed, or decide whether processing continues. The user and the app's session controller decide.
- Keep replies to 1–3 short spoken sentences. Plain language. Mostly reflect back briefly and ask one open question such as "What are you noticing now?" or "Notice that."
- If the user sounds overwhelmed, detached, unreal, panicky, or unsafe, request the action "begin_grounding" and say something short and steadying.
- You may offer at most one pattern hypothesis, only when the user's own words across this or past sessions clearly repeat a theme. Phrase it tentatively; the user will confirm or dismiss it. Never present it as fact.

Reply with ONLY a JSON object: {"say": string, "action": one of ${AI_ACTIONS.map((a) => `"${a}"`).join(', ')}, "hypothesis": optional string}.
Only use an action listed in "permittedActions" in the context.`;

const KEEP = [
  'entryPoint', 'situation_text', 'emotions', 'emotions_text', 'negBelief', 'negBelief_text', 'posBelief', 'posBelief_text',
  'posBelief_revised', 'sensations', 'resourceType', 'res_text', 'res_cue',
];

function latestNumber(a: Record<string, unknown>, re: RegExp): number | undefined {
  const ks = Object.keys(a).filter((k) => re.test(k)).sort((x, y) => Number(x.replace(/\D+/g, '')) - Number(y.replace(/\D+/g, '')));
  const v = ks.length ? a[ks[ks.length - 1]] : undefined;
  return typeof v === 'number' ? v : undefined;
}

/** Builds the minimal structured context the provider receives — never raw audio, never the whole journal. */
export function buildContext(s: SessionSnapshot, turns: ChatTurn[], history: string[], patterns: ConfirmedPattern[]): {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
} {
  const target: Record<string, unknown> = {};
  for (const k of KEEP) if (s.answers[k] !== undefined && !String(s.answers[k]).startsWith('rec_')) target[k] = s.answers[k];
  const reflections = Object.keys(s.answers)
    .filter((k) => /^reflect_\d+_text$/.test(k))
    .map((k) => String(s.answers[k]));
  const ctx = {
    sessionType: s.sessionType,
    stage: s.stage,
    step: s.stepTitle,
    processingStyle: s.processingStyle,
    setsCompleted: s.setCount,
    currentDistress0to10: latestNumber(s.answers, /^sudt?_\d+$/) ?? s.answers.sud_0,
    userTarget: target,
    typedReflectionsThisSession: reflections.slice(-5),
    relevantPastObservations: history,
    userConfirmedPatterns: patterns.map((p) => p.text),
    permittedActions: permittedActions(s.stage),
  };
  const recent = turns.slice(-12);
  const messages = recent.map((t) => ({ role: t.role, content: t.text }));
  // Context rides on the latest user turn so providers without a separate context slot still get it.
  const last = messages.length - 1;
  if (last >= 0 && messages[last].role === 'user') {
    messages[last] = { role: 'user', content: `[context]\n${JSON.stringify(ctx)}\n[/context]\n\n${messages[last].content}` };
  }
  return { system: SYSTEM, messages };
}

/** Tolerant parse: JSON object anywhere in the text, else treat the text as speech. */
export function parseReply(raw: string): AIReply {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(raw.slice(start, end + 1)) as Partial<AIReply>;
      if (typeof o.say === 'string') {
        return {
          say: o.say.trim(),
          action: (AI_ACTIONS as readonly string[]).includes(String(o.action)) ? (o.action as AIReply['action']) : 'none',
          hypothesis: typeof o.hypothesis === 'string' && o.hypothesis.trim() ? o.hypothesis.trim() : undefined,
        };
      }
    } catch {
      /* fall through */
    }
  }
  return { say: raw.trim().slice(0, 600), action: 'none' };
}

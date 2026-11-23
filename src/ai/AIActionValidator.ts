import type { AIAction } from './types.js';

/**
 * Deterministic gate between the AI and the session. The AI can only
 * *request*; nothing here can start stimulation, change its parameters,
 * trigger activation, or continue a session.
 */
const ALWAYS: AIAction[] = ['none', 'begin_grounding', 'pause_session', 'repeat_instruction'];

const BY_STAGE: Record<string, AIAction[]> = {
  reflection: ['record_reflection', 'show_emotional_rating', 'finish_session'],
  checkin: ['finish_session'],
  integration: ['show_emotional_rating'],
  body: ['record_reflection'],
  grounding: [],
  closure: ['record_reflection'],
};

export function permittedActions(stage: string): AIAction[] {
  return [...ALWAYS, ...(BY_STAGE[stage] ?? [])];
}

export function validateAction(requested: string | undefined, stage: string): AIAction {
  const a = (requested ?? 'none') as AIAction;
  return permittedActions(stage).includes(a) ? a : 'none';
}

/**
 * Session definitions are plain data (JSON-compatible) so new flows can be
 * written without touching UI code. `{set}` in a field name is replaced with
 * the number of completed stimulation sets (e.g. `reflect_{set}_voice`).
 * `{{field}}` in text is replaced with an answer; `{{a|b}}` uses the first
 * non-empty answer; `{{date}}` is today's date.
 */

export type StageId =
  | 'welcome'
  | 'preparation'
  | 'target'
  | 'baseline'
  | 'activation'
  | 'stimulation'
  | 'checkin'
  | 'reflection'
  | 'integration'
  | 'body'
  | 'closure'
  | 'summary'
  | 'followup'
  | 'measure'
  | 'grounding';

export type EnvironmentId = 'void' | 'grounding';

export type Effect =
  | 'recenter'
  | 'settings'
  | 'menu'
  | 'lockStim'
  | 'exitXR'
  | 'endNow'
  | 'complete';

export interface Condition {
  /** Answer must be present (non-empty). */
  present?: string;
  /** Any of these answers present. */
  anyPresent?: string[];
  /** Answer `field` is one of `in`. */
  field?: string;
  in?: string[];
  /** Numeric answer `field` >= gte. */
  gte?: number;
  /** Numeric answer `field` <= lte. */
  lte?: number;
  /** Completed set count >= n. */
  setCountGte?: number;
}

export interface Option {
  value: string;
  label: string;
}

export type InputDef =
  | { kind: 'choice'; field: string; label?: string; options: Option[]; autoAdvance?: boolean; numeric?: boolean; when?: Condition }
  | { kind: 'chips'; field: string; label?: string; items: string[]; multi: boolean; when?: Condition }
  | { kind: 'rating'; field: string; label: string; min: number; max: number; minLabel?: string; maxLabel?: string; when?: Condition }
  | { kind: 'text'; field: string; label?: string; placeholder?: string; when?: Condition }
  | { kind: 'voice'; field: string; label?: string; when?: Condition };

export interface RouteRule {
  when: Condition;
  goto: string;
  effects?: Effect[];
}

export interface ActionDef {
  id: string;
  label: string;
  goto?: string;
  route?: RouteRule[];
  effects?: Effect[];
  style?: 'primary' | 'normal' | 'danger';
}

export interface NoteRule {
  when: Condition;
  text: string;
  tone?: 'info' | 'warn';
}

export interface StepDef {
  id: string;
  stage: StageId;
  type: 'form' | 'stimulation' | 'summary';
  title: string;
  body?: string;
  /** Body chosen by the value of an earlier answer. */
  bodyByAnswer?: { field: string; map: Record<string, string> };
  notes?: NoteRule[];
  narration?: { segment: string; text: string };
  inputs?: InputDef[];
  actions?: ActionDef[];
  /** Default next step (used by stimulation end, auto-advance and skipped steps). */
  next?: string;
  /** Step is skipped (to `next`) unless this holds. */
  when?: Condition;
  environment?: EnvironmentId;
  onEnter?: Effect[];
  /** Optional per-step overrides (e.g. slow, short resource sets). */
  stim?: { countsAsSet: boolean; duration?: number; speed?: number };
}

export interface SessionDefinition {
  id: string;
  version: number;
  title: string;
  start: string;
  /** Where a stimulation step goes once stimulation is locked for the session. */
  stimLockedFallback: string;
  /** Step that grounding / End offer as a gentle way to finish. */
  closingStep?: string;
  steps: StepDef[];
}

export interface RatingEntry {
  field: string;
  value: number;
  stepId: string;
  at: string;
}

export interface SessionEvent {
  type: 'grounding' | 'pause' | 'disorientation-reported' | 'stim-locked' | 'ended-early' | 'orientation';
  stepId?: string;
  at: string;
}

export interface FollowUpDue {
  kind: '24h' | '7d';
  due: number; // epoch ms
  done: boolean;
  followUpSessionId?: string;
}

export interface SessionRecord {
  id: string;
  definitionId: string;
  definitionVersion: number;
  parentId?: string;
  startedAt: string;
  endedAt?: string;
  status: 'in-progress' | 'completed' | 'ended-early';
  answers: Record<string, unknown>;
  ratings: RatingEntry[];
  sets: unknown[];
  events: SessionEvent[];
  stepTrail: { stepId: string; at: string }[];
  followUps?: FollowUpDue[];
  stimLocked: boolean;
}

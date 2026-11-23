import type { ActionDef, Condition, Effect, InputDef, SessionDefinition, StepDef } from './types.js';

/**
 * Data-driven state machine. Pure logic: no DOM, no Three.js, so it can be
 * unit-tested in Node. It never advances into stimulation on its own — every
 * set starts from a user action.
 */
export class SessionEngine {
  answers: Record<string, unknown> = {};
  setCount = 0;
  stimLocked = false;
  current!: StepDef;
  private history: string[] = [];
  private stepMap = new Map<string, StepDef>();
  private listeners = new Set<(step: StepDef, effects: Effect[]) => void>();

  constructor(readonly def: SessionDefinition) {
    for (const s of def.steps) {
      if (this.stepMap.has(s.id)) throw new Error(`Duplicate step id ${s.id}`);
      this.stepMap.set(s.id, s);
    }
  }

  onStep(fn: (step: StepDef, effects: Effect[]) => void): void {
    this.listeners.add(fn);
  }

  start(): void {
    this.enter(this.def.start);
  }

  step(id: string): StepDef {
    const s = this.stepMap.get(id);
    if (!s) throw new Error(`Unknown step ${id}`);
    return s;
  }

  resolveField(f: string): string {
    return f.replace(/\{set\}/g, String(this.setCount));
  }

  setAnswer(field: string, value: unknown): void {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete this.answers[field];
    } else {
      this.answers[field] = value;
    }
  }

  getAnswer(field: string): unknown {
    return this.answers[field];
  }

  isPresent(field: string): boolean {
    const v = this.answers[field];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }

  evaluate(c: Condition | undefined): boolean {
    if (!c) return true;
    if (c.present !== undefined && !this.isPresent(this.resolveField(c.present))) return false;
    if (c.anyPresent && !c.anyPresent.some((f) => this.isPresent(this.resolveField(f)))) return false;
    if (c.field !== undefined) {
      const v = this.answers[this.resolveField(c.field)];
      if (c.in && !c.in.includes(String(v))) return false;
      if (c.notIn && c.notIn.includes(String(v))) return false;
      if (c.gte !== undefined && !(typeof v === 'number' && v >= c.gte)) return false;
      if (c.lte !== undefined && !(typeof v === 'number' && v <= c.lte)) return false;
    }
    if (c.setCountGte !== undefined && this.setCount < c.setCountGte) return false;
    if (c.all && !c.all.every((x) => this.evaluate(x))) return false;
    return true;
  }

  visibleActions(step: StepDef = this.current): ActionDef[] {
    return (step.actions ?? []).filter((a) => this.evaluate(a.when));
  }

  visibleInputs(step: StepDef = this.current): InputDef[] {
    return (step.inputs ?? []).filter((i) => this.evaluate(i.when));
  }

  /** Move to a step, honouring `when` skips and the stimulation lock. */
  enter(id: string, effects: Effect[] = [], record = true): void {
    let target = this.step(id);
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(target.id)) throw new Error(`Skip loop at ${target.id}`);
      seen.add(target.id);
      if (target.type === 'stimulation' && this.stimLocked) {
        target = this.step(this.def.stimLockedFallback);
        continue;
      }
      if (!this.evaluate(target.when)) {
        if (!target.next) throw new Error(`Step ${target.id} skipped but has no next`);
        target = this.step(target.next);
        continue;
      }
      break;
    }
    if (record && this.current) this.history.push(this.current.id);
    this.current = target;
    const all = [...effects, ...(target.onEnter ?? [])];
    if (all.includes('lockStim')) this.stimLocked = true;
    this.listeners.forEach((l) => l(target, all));
  }

  /** Perform an action on the current step. Returns its effects (already applied to engine state). */
  act(actionId: string): Effect[] {
    const a: ActionDef | undefined = this.visibleActions().find((x) => x.id === actionId);
    if (!a) throw new Error(`No action ${actionId} on ${this.current.id}`);
    let effects = [...(a.effects ?? [])];
    let goto = a.goto;
    for (const r of a.route ?? []) {
      if (this.evaluate(r.when)) {
        goto = r.goto;
        effects = [...effects, ...(r.effects ?? [])];
        break;
      }
    }
    if (effects.includes('lockStim')) this.stimLocked = true;
    if (goto) this.enter(goto, effects);
    return effects;
  }

  /** Default advance (auto-advancing choices, stimulation end). */
  advance(): void {
    if (this.current.next) this.enter(this.current.next);
  }

  /** Called when a set finishes or is stopped early. Partial sets still count. */
  stimulationEnded(): void {
    if (this.current.type !== 'stimulation') return;
    if (this.current.stim?.countsAsSet !== false) this.setCount++;
    this.advance();
  }

  back(): void {
    const prev = this.history.pop();
    if (prev) this.enter(prev, [], false);
  }

  lockStimulation(): void {
    this.stimLocked = true;
  }

  /** Fill `{{field}}`, `{{a|b}}` and `{{date}}` tokens. */
  template(text: string): string {
    return text.replace(/\{\{([^}]+)\}\}/g, (_m, expr: string) => {
      if (expr === 'date') {
        return new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      }
      for (const f of expr.split('|')) {
        const v = this.answers[this.resolveField(f.trim())];
        if (Array.isArray(v) && v.length) return v.join(', ');
        if (typeof v === 'string' && v) return v;
        if (typeof v === 'number') return String(v);
      }
      return '…';
    });
  }

  bodyFor(step: StepDef = this.current): string {
    let body = step.body ?? '';
    if (step.bodyByAnswer) {
      const v = String(this.answers[step.bodyByAnswer.field] ?? '');
      body = step.bodyByAnswer.map[v] ?? step.bodyByAnswer.map['*'] ?? body;
    }
    return this.template(body);
  }
}

/** Static checks used by tests: every reference resolves. */
export function validateDefinition(def: SessionDefinition): string[] {
  const ids = new Set(def.steps.map((s) => s.id));
  const errs: string[] = [];
  const ref = (from: string, to: string | undefined) => {
    if (to && !ids.has(to)) errs.push(`${from} -> missing ${to}`);
  };
  ref('start', def.start);
  ref('stimLockedFallback', def.stimLockedFallback);
  ref('closingStep', def.closingStep);
  for (const s of def.steps) {
    ref(`${s.id}.next`, s.next);
    if (s.when && !s.next) errs.push(`${s.id} has when but no next`);
    if (s.type === 'stimulation' && !s.next) errs.push(`${s.id} stimulation without next`);
    for (const a of s.actions ?? []) {
      ref(`${s.id}.${a.id}`, a.goto);
      for (const r of a.route ?? []) ref(`${s.id}.${a.id}.route`, r.goto);
    }
    if (s.inputs?.some((i) => i.kind === 'choice' && i.autoAdvance) && !s.next) {
      errs.push(`${s.id} auto-advance without next`);
    }
  }
  return errs;
}

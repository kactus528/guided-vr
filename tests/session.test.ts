import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine, validateDefinition } from '../src/session/SessionEngine.js';
import { DEFINITIONS, GUIDED_SESSION } from '../src/session/definitions.js';
import { alignedDuration, beatSide, beatTime, patternPosition } from '../src/stim/patterns.js';

test('all definitions are internally consistent', () => {
  for (const def of Object.values(DEFINITIONS)) assert.deepEqual(validateDefinition(def), [], def.id);
});

function walk() {
  const e = new SessionEngine(GUIDED_SESSION);
  const trail: string[] = [];
  e.onStep((s) => trail.push(s.id));
  e.start();
  return { e, trail };
}

test('full happy path with two sets reaches summary', () => {
  const { e, trail } = walk();
  e.act('continue'); e.act('ok'); e.act('continue');
  assert.equal(e.current.id, 'entry');
  e.setAnswer('entryPoint', 'reaction'); e.advance();
  assert.match(e.bodyFor(), /not to know why/);
  e.act('continue'); e.act('skip'); e.act('skip');
  e.setAnswer('posBelief', 'I matter');
  e.act('continue'); e.act('continue');
  assert.equal(e.current.id, 'baseline');
  assert.equal(e.visibleInputs().length, 2, 'VoC shown when a positive belief exists');
  e.setAnswer('sud_0', 9);
  e.act('continue');
  assert.ok(e.current.notes!.some((n) => e.evaluate(n.when)), 'high-distress note shown');
  e.act('skip'); e.act('begin');
  assert.equal(e.current.type, 'stimulation');
  e.stimulationEnded();
  assert.equal(e.setCount, 1);
  assert.equal(e.current.id, 'checkin');
  e.setAnswer(e.resolveField('present_{set}'), 'yes');
  e.act('continue');
  assert.equal(e.current.id, 'reflection');
  assert.equal(e.resolveField('reflect_{set}_voice'), 'reflect_1_voice');
  e.act('again'); e.act('begin'); e.stimulationEnded();
  assert.equal(e.setCount, 2);
  e.act('continue'); e.act('close');
  assert.equal(e.current.id, 'positive_end');
  assert.match(e.bodyFor(), /I matter/);
  e.act('continue'); e.act('continue'); e.act('continue');
  assert.equal(e.current.id, 'summary');
  assert.ok(!trail.includes('orientation'));
});

test('reported detachment routes to orientation and locks stimulation', () => {
  const { e } = walk();
  e.enter('stim'); e.stimulationEnded();
  e.setAnswer(e.resolveField('unreal_{set}'), 'yes');
  e.act('continue');
  assert.equal(e.current.id, 'orientation');
  assert.equal(e.stimLocked, true);
  e.enter('stim');
  assert.equal(e.current.id, 'closure', 'stimulation never restarts once locked');
});

test('positive-belief step is skipped when none was named', () => {
  const { e } = walk();
  e.enter('positive_end');
  assert.equal(e.current.id, 'body_end');
});

test('practice set does not count as a processing set', () => {
  const { e } = walk();
  e.enter('practice'); e.stimulationEnded();
  assert.equal(e.setCount, 0);
  assert.equal(e.current.id, 'arriving');
});

test('stimulation is only ever entered from a user action', () => {
  for (const s of GUIDED_SESSION.steps) {
    if (s.type === 'stimulation') continue;
    const n = s.next && GUIDED_SESSION.steps.find((x) => x.id === s.next);
    assert.ok(!n || n.type !== 'stimulation', `${s.id} auto-advances into stimulation`);
  }
});

test('patterns: extremes at beat times, centred at half cycles', () => {
  for (const p of ['sinusoidal', 'horizontal', 'arc'] as const) {
    assert.ok(Math.abs(patternPosition(p, 0.25).x - 1) < 1e-9);
    assert.ok(Math.abs(patternPosition(p, 0.75).x + 1) < 1e-9);
    assert.ok(Math.abs(patternPosition(p, 0.5).x) < 1e-9);
  }
  assert.equal(beatTime(0, 1), 0.25);
  assert.equal(beatTime(1, 1), 0.75);
  assert.equal(beatSide(0), 'R');
  assert.equal(beatSide(1), 'L');
  assert.equal(alignedDuration(25, 1), 25);
  assert.equal(alignedDuration(25.2, 1), 25.5);
  assert.ok(Math.abs(alignedDuration(10, 0.7) * 0.7 * 2 - Math.round(alignedDuration(10, 0.7) * 1.4)) < 1e-9);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreItq, ITQ_PTSD_ITEMS, ITQ_DSO_ITEMS, ITQ_PTSD_FI, ITQ_DSO_FI } from '../src/measures/itq.js';
import { SessionEngine } from '../src/session/SessionEngine.js';
import { GUIDED_SESSION, ITQ_SESSION, RESOURCE_SESSION } from '../src/session/definitions.js';

const fill = (v: number) => Object.fromEntries([...ITQ_PTSD_ITEMS, ...ITQ_DSO_ITEMS, ...ITQ_PTSD_FI, ...ITQ_DSO_FI].map((i) => [i.field, v]));

test('ITQ: all zeros → none, all 4s → CPTSD with max totals', () => {
  assert.equal(scoreItq(fill(0)).screen, 'none');
  const r = scoreItq(fill(4));
  assert.equal(r.screen, 'CPTSD');
  assert.equal(r.ptsdTotal, 24);
  assert.equal(r.dsoTotal, 24);
});

test('ITQ: PTSD only when DSO clusters are not all endorsed', () => {
  const a = fill(0);
  a.itq_p1 = 2; a.itq_p3 = 2; a.itq_p6 = 3; a.itq_pfi2 = 2; // one per PTSD cluster + impairment
  a.itq_c1 = 4; a.itq_c3 = 4; a.itq_cfi1 = 4;              // DR cluster missing
  assert.equal(scoreItq(a).screen, 'PTSD');
  a.itq_c6 = 2;
  assert.equal(scoreItq(a).screen, 'CPTSD');
});

test('ITQ: symptoms without functional impairment do not meet threshold', () => {
  const a = fill(3);
  for (const i of ITQ_PTSD_FI) a[i.field] = 1;
  assert.equal(scoreItq(a).screen, 'none');
});

test('ITQ: a skipped item gives an incomplete screen', () => {
  const a = fill(4);
  delete a.itq_c4;
  assert.equal(scoreItq(a).screen, 'incomplete');
});

test('ITQ flow visits all 18 questions then results', () => {
  const e = new SessionEngine(ITQ_SESSION);
  e.start();
  let asked = 0;
  e.act('continue');
  while (e.current.id !== 'itq_result') {
    asked += e.visibleInputs().length;
    e.act('continue');
  }
  assert.equal(asked, 18);
});

test('Resource: sets are slow and short; an upsetting resource is set aside without more stimulation', () => {
  const e = new SessionEngine(RESOURCE_SESSION);
  e.start();
  e.act('continue');
  e.setAnswer('resourceType', 'place'); e.advance();
  e.act('continue');
  e.act('begin');
  assert.equal(e.current.stim?.speed, 0.6);
  assert.equal(e.current.stim?.duration, 8);
  e.stimulationEnded();
  e.setAnswer(e.resolveField('res_check_{set}'), 'negative');
  e.act('continue');
  assert.equal(e.current.id, 'res_redirect');
  assert.ok(!(e.current.actions ?? []).some((a) => a.goto === 'res_stim'), 'no direct route back into stimulation');
});

test('Focused (restricted) processing changes the wording and adds stopping cues', () => {
  const e = new SessionEngine(GUIDED_SESSION);
  e.answers.processingStyle = 'restricted';
  e.start();
  e.enter('set_again');
  assert.match(e.bodyFor(), /same starting point/);
  e.enter('stim'); e.stimulationEnded(); e.setAnswer('present_1', 'yes'); e.act('continue');
  e.setAnswer('sud_1', 1);
  assert.ok(e.current.notes!.some((n) => e.evaluate(n.when) && /natural point/.test(n.text)));
  e.answers.processingStyle = 'open';
  e.enter('set_again');
  assert.match(e.bodyFor(), /whatever is here now/);
});

test('New check-in questions route detachment to orientation', () => {
  const e = new SessionEngine(GUIDED_SESSION);
  e.start(); e.enter('stim'); e.stimulationEnded();
  e.setAnswer('far_1', 'yes');
  e.act('continue');
  assert.equal(e.current.id, 'orientation');
  assert.equal(e.stimLocked, true);
});

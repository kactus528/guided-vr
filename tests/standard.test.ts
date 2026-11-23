import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine, validateDefinition } from '../src/session/SessionEngine.js';
import { GUIDED_SESSION } from '../src/session/definitions.js';

function std(withPositive = true) {
  const e = new SessionEngine(GUIDED_SESSION);
  e.answers.processingStyle = 'standard';
  if (withPositive) e.answers.posBelief = 'I am enough';
  e.start();
  return e;
}
const set = (e: SessionEngine) => { assert.equal(e.current.type, 'stimulation'); e.stimulationEnded(); e.setAnswer(e.resolveField('present_{set}'), 'yes'); e.act('continue'); };

test('definition still valid', () => assert.deepEqual(validateDefinition(GUIDED_SESSION), []));

test('standard protocol: desensitize → install → body scan → closure', () => {
  const e = std();
  e.enter('stim'); set(e);
  assert.equal(e.current.id, 'reflection');
  const ids = e.visibleActions().map((a) => a.id);
  assert.deepEqual(ids, ['go', 'target', 'stuck', 'closeStd']);
  e.act('go'); set(e);
  e.act('stuck'); assert.equal(e.current.id, 'interweave');
  e.setAnswer(e.resolveField('interweave_{set}'), 'Are you safe now?');
  e.act('go'); set(e);
  e.act('target'); e.setAnswer(e.resolveField('sudt_{set}'), 4); e.act('continue');
  assert.equal(e.current.type, 'stimulation', 'target still charged → keep desensitizing');
  set(e); e.act('target'); e.setAnswer(e.resolveField('sudt_{set}'), 1); e.act('continue');
  assert.equal(e.current.id, 'install_intro');
  e.act('begin'); e.stimulationEnded();
  assert.equal(e.current.id, 'install_check');
  e.setAnswer(e.resolveField('voci_{set}'), 4); e.act('continue');
  assert.equal(e.current.id, 'install_stim', 'VoC below 6 → another installation set');
  e.stimulationEnded(); e.setAnswer(e.resolveField('voci_{set}'), 7); e.act('continue');
  assert.equal(e.current.id, 'bodyscan');
  e.setAnswer(e.resolveField('scan_{set}'), 'tension'); e.act('continue');
  assert.equal(e.current.id, 'bodyscan_stim');
  e.stimulationEnded(); e.setAnswer(e.resolveField('scan_{set}'), 'clear'); e.act('continue');
  assert.equal(e.current.id, 'closure');
});

test('standard: no positive belief skips installation; closing early goes straight to closure', () => {
  const e = std(false);
  e.enter('stim'); set(e); e.act('target'); e.setAnswer(e.resolveField('sudt_{set}'), 0); e.act('continue');
  assert.equal(e.current.id, 'bodyscan');
  const f = std();
  f.enter('stim'); set(f); f.act('closeStd');
  assert.equal(f.current.id, 'closure');
});

test('standard: high distress is informational only — no forced stop, no push', () => {
  const e = std();
  e.enter('stim'); set(e); e.setAnswer('sud_1', 9);
  const notes = e.current.notes!.filter((n) => e.evaluate(n.when)).map((n) => n.text);
  assert.ok(notes.some((t) => /your call/.test(t)));
  assert.ok(!notes.some((t) => /usually a better next step/.test(t)));
});

test('standard: dissociation still locks stimulation for the session', () => {
  const e = std();
  e.enter('stim'); e.stimulationEnded(); e.setAnswer('unreal_1', 'yes'); e.act('continue');
  assert.equal(e.current.id, 'orientation');
  e.enter('install_stim');
  assert.equal(e.current.id, 'closure');
});

test('other styles keep their original reflection actions', () => {
  const e = new SessionEngine(GUIDED_SESSION);
  e.answers.processingStyle = 'restricted';
  e.start(); e.enter('stim'); set(e);
  assert.deepEqual(e.visibleActions().map((a) => a.id), ['again', 'close']);
  e.act('close');
  assert.equal(e.current.id, 'body_end', 'no positive belief → positive_end skipped');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, splitSentences, hashText } from '../src/audio/wav.js';
import { engineOrder } from '../src/audio/VoiceConfigStore.js';

test('wav: header and length', async () => {
  const b = encodeWav(new Float32Array([0, 1, -1, 0.5]), 24000);
  const buf = new DataView(await b.arrayBuffer());
  assert.equal(buf.byteLength, 44 + 8);
  assert.equal(buf.getUint32(24, true), 24000);
  assert.equal(buf.getInt16(46, true), 32767);
  assert.equal(buf.getInt16(48, true), -32768);
});

test('splitSentences keeps punctuation and splits long text', () => {
  assert.deepEqual(splitSentences('Take a breath. Notice the room! Where are you?'), ['Take a breath.', 'Notice the room!', 'Where are you?']);
  assert.deepEqual(splitSentences('No full stop here'), ['No full stop here']);
  const long = splitSentences(`${'word, '.repeat(80)}end.`);
  assert.ok(long.length > 1 && long.every((x) => x.length <= 220));
  assert.notEqual(hashText('a'), hashText('b'));
});

test('engine order: ElevenLabs only with key + consent; Kokoro only when enabled', () => {
  const base = { engine: 'auto' as const, kokoroVoice: 'af_heart', kokoroSpeed: 0.9, kokoroEnabled: false, elevenKey: '', elevenVoiceId: 'x', elevenConsent: false };
  assert.deepEqual(engineOrder(base, true), ['browser']);
  assert.deepEqual(engineOrder({ ...base, kokoroEnabled: true }, true), ['kokoro', 'browser']);
  assert.deepEqual(engineOrder({ ...base, kokoroEnabled: true, elevenKey: 'k' }, true), ['kokoro', 'browser'], 'no consent → not used');
  assert.deepEqual(engineOrder({ ...base, kokoroEnabled: true, elevenKey: 'k', elevenConsent: true }, true), ['elevenlabs', 'kokoro', 'browser']);
  assert.deepEqual(engineOrder({ ...base, engine: 'kokoro', kokoroEnabled: true, elevenKey: 'k', elevenConsent: true }, true), ['kokoro', 'browser']);
  assert.deepEqual(engineOrder({ ...base, engine: 'off' }, true), []);
  assert.deepEqual(engineOrder({ ...base, kokoroEnabled: true }, false), ['browser'], 'unsupported device');
});

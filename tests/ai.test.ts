import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permittedActions, validateAction } from '../src/ai/AIActionValidator.js';
import { checkUserText, filterReply, SAFE_FALLBACK } from '../src/ai/AISafetyController.js';
import { buildContext, parseReply } from '../src/ai/ConversationContextBuilder.js';
import { selectRelevant } from '../src/ai/JournalRetrievalService.js';
import { AnthropicProvider, OpenAICompatibleProvider } from '../src/ai/AIProviderInterface.js';
import { DEFAULT_AI_CONFIG } from '../src/ai/types.js';
import type { SessionRecord } from '../src/session/types.js';

test('validator: AI can never request stimulation; unknown or stage-inappropriate actions become none', () => {
  for (const stage of ['reflection', 'checkin', 'integration', 'stimulation', 'activation']) {
    const p = permittedActions(stage) as string[];
    assert.ok(!p.some((a) => /stim|set|activat|speed|continue/.test(a)), stage);
    assert.ok(p.includes('begin_grounding'));
  }
  assert.equal(validateAction('start_set', 'reflection'), 'none');
  assert.equal(validateAction('record_reflection', 'activation'), 'none');
  assert.equal(validateAction('record_reflection', 'reflection'), 'record_reflection');
  assert.equal(validateAction(undefined, 'reflection'), 'none');
});

test('safety: crisis and disorientation phrases are caught deterministically', () => {
  assert.equal(checkUserText('honestly I want to die').level, 'crisis');
  assert.equal(checkUserText("I keep thinking about hurting myself").level, 'crisis');
  for (const t of ['part of me wants to die', 'I wish I was dead', "everyone's better off dead without me", "I can't go on", 'thinking about suicide', 'I took an overdose'])
    assert.equal(checkUserText(t).level, 'crisis', t);
  for (const t of ['the dog died last year', 'I want to live differently', 'I cut myself off from friends', 'it was killing my mood'])
    assert.notEqual(checkUserText(t).level, 'crisis', t);
  assert.equal(checkUserText("I don't feel real right now").level, 'disoriented');
  assert.equal(checkUserText('where am I').level, 'disoriented');
  assert.equal(checkUserText('my chest feels tight and I feel sad about my dad').level, 'ok');
});

test('safety: replies that diagnose, claim therapist status, or suggest hidden memories are replaced', () => {
  assert.equal(filterReply('This might be a repressed memory surfacing.').say, SAFE_FALLBACK);
  assert.equal(filterReply('You probably have complex PTSD.').say, SAFE_FALLBACK);
  assert.equal(filterReply("As your therapist, I'm a therapist who…").say, SAFE_FALLBACK);
  assert.equal(filterReply('You need to keep going with another set.').say, SAFE_FALLBACK);
  assert.equal(filterReply('Notice that. What comes up now?').replaced, false);
});

test('parseReply: JSON with fences, plain text, and bad actions', () => {
  const a = parseReply('```json\n{"say":"Notice that.","action":"pause_session","hypothesis":"Shame shows up around criticism"}\n```');
  assert.deepEqual(a, { say: 'Notice that.', action: 'pause_session', hypothesis: 'Shame shows up around criticism' });
  assert.equal(parseReply('Just notice that.').action, 'none');
  assert.equal(parseReply('{"say":"Ok","action":"start_stimulation"}').action, 'none');
});

test('context: minimal, no recordings ids, permitted actions included, history only when given', () => {
  const ctx = buildContext(
    { stage: 'reflection', stepId: 'reflection', stepTitle: 'What are you noticing now?', sessionType: 'Guided', setCount: 2,
      answers: { emotions: ['Shame'], negBelief: "I'm not good enough", situation_voice: 'rec_abc', sud_0: 7, sud_2: 5, reflect_1_text: 'tight chest' } },
    [{ role: 'user', text: 'I feel small', at: '' }], [], [],
  );
  const last = ctx.messages[ctx.messages.length - 1].content;
  assert.match(last, /\[context\]/);
  assert.doesNotMatch(last, /rec_abc/);
  assert.match(last, /"currentDistress0to10":5/);
  assert.match(last, /begin_grounding/);
  assert.match(last, /"relevantPastObservations":\[\]/);
  assert.match(ctx.system, /NOT a therapist/);
});

test('retrieval: picks related past sessions by overlap, text only', () => {
  const mk = (id: string, answers: Record<string, unknown>, d: string): SessionRecord => ({
    id, definitionId: 'guided-v1', definitionVersion: 1, startedAt: d, status: 'completed', answers, ratings: [], sets: [], events: [], stepTrail: [], stimLocked: false,
  });
  const past = [
    mk('a', { emotions: ['Shame'], situation_text: 'criticised at work meeting', situation_voice: 'rec_x' }, '2026-11-01T00:00:00Z'),
    mk('b', { emotions: ['Fear'], situation_text: 'driving on highway' }, '2026-11-02T00:00:00Z'),
  ];
  const r = selectRelevant({ emotions: ['Shame'], situation_text: 'my boss criticised me' }, past);
  assert.equal(r.length, 1);
  assert.match(r[0], /criticised/);
  assert.doesNotMatch(r[0], /rec_x/);
});

test('providers send the right requests (mocked fetch)', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = url.includes('anthropic')
      ? { content: [{ type: 'text', text: '{"say":"Hi","action":"none"}' }] }
      : { choices: [{ message: { content: '{"say":"Hi","action":"none"}' } }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const a = await new AnthropicProvider({ ...DEFAULT_AI_CONFIG, provider: 'anthropic', apiKey: 'k', model: 'm' }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }] });
    assert.match(a, /Hi/);
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(h['x-api-key'], 'k');
    const o = await new OpenAICompatibleProvider({ ...DEFAULT_AI_CONFIG, provider: 'openai', apiKey: 'k2', model: 'm', baseUrl: 'https://example.com/v1/' }, 'openai').complete({ system: 's', messages: [] });
    assert.match(o, /Hi/);
    assert.equal(calls[1].url, 'https://example.com/v1/chat/completions');
    assert.equal(JSON.parse(String(calls[1].init.body)).messages[0].role, 'system');
  } finally {
    globalThis.fetch = realFetch;
  }
});

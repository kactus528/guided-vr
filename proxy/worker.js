// Optional Cloudflare Worker proxy for the Guided VR AI guide.
// Keeps your provider API key on the server instead of the headset.
//
// The app talks to it as an OpenAI-compatible endpoint:
//   POST {WORKER_URL}/chat/completions
//   POST {WORKER_URL}/audio/transcriptions   (only if OPENAI_API_KEY is set)
//
// Environment (set as Worker secrets / variables):
//   ACCESS_TOKEN      required — paste the same value into the app's "Proxy access token"
//   ALLOWED_ORIGIN    e.g. https://kactus528.github.io
//   UPSTREAM          "anthropic" (default) or "openai"
//   ANTHROPIC_API_KEY when UPSTREAM=anthropic
//   OPENAI_API_KEY    when UPSTREAM=openai, or to enable transcription
//   MODEL             default model if the app sends none
//
// It stores nothing and logs nothing.

const cors = (env) => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
});

const json = (env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(env) } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (req.method !== 'POST') return json(env, { error: 'POST only' }, 405);
    const origin = req.headers.get('origin');
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json(env, { error: 'origin not allowed' }, 403);
    if (!env.ACCESS_TOKEN || req.headers.get('authorization') !== `Bearer ${env.ACCESS_TOKEN}`) {
      return json(env, { error: 'unauthorized' }, 401);
    }
    const path = new URL(req.url).pathname.replace(/\/+$/, '');

    if (path.endsWith('/audio/transcriptions')) {
      if (!env.OPENAI_API_KEY) return json(env, { error: 'transcription not configured' }, 501);
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: await req.formData(),
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', ...cors(env) } });
    }

    if (!path.endsWith('/chat/completions')) return json(env, { error: 'not found' }, 404);
    const body = await req.json();
    const model = body.model || env.MODEL;

    if ((env.UPSTREAM || 'anthropic') === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({ ...body, model }),
      });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', ...cors(env) } });
    }

    // Anthropic: translate OpenAI-style chat into the Messages API and back.
    const system = (body.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages = (body.messages || []).filter((m) => m.role !== 'system');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: Math.min(body.max_tokens || 400, 1000), system, messages }),
    });
    const data = await r.json();
    if (!r.ok) return json(env, data, r.status);
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return json(env, { choices: [{ message: { role: 'assistant', content: text } }] });
  },
};

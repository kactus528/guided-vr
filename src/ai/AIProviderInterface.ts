import type { AIConfig } from './types.js';

export interface ProviderRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
}

/** Replaceable provider: anything that turns a system prompt + turns into text. */
export interface AIProviderInterface {
  readonly id: string;
  readonly cloud: boolean;
  complete(req: ProviderRequest): Promise<string>;
}

async function check(res: Response): Promise<unknown> {
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
  return res.json();
}

/** Anthropic Messages API, called directly from the browser (bring-your-own-key). */
export class AnthropicProvider implements AIProviderInterface {
  readonly id = 'anthropic';
  readonly cloud = true;
  constructor(private cfg: AIConfig) {}
  async complete(req: ProviderRequest): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: this.cfg.model, max_tokens: 400, system: req.system, messages: req.messages }),
    });
    const data = (await check(res)) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  }
}

/** Any OpenAI-compatible chat endpoint: OpenAI, OpenRouter, a local server (Ollama / LM Studio), or your own proxy. */
export class OpenAICompatibleProvider implements AIProviderInterface {
  readonly cloud: boolean;
  constructor(private cfg: AIConfig, readonly id: string) {
    this.cloud = !/^https?:\/\/(localhost|127\.|192\.168\.|10\.)/.test(cfg.baseUrl);
  }
  async complete(req: ProviderRequest): Promise<string> {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: req.signal,
      headers,
      body: JSON.stringify({
        model: this.cfg.model || undefined,
        max_tokens: 400,
        temperature: 0.6,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      }),
    });
    const data = (await check(res)) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

/**
 * Offline fallback "guide": short, non-directive EMDR-style prompts with no
 * model at all. Used when AI is off-line, misconfigured, or fails.
 */
export class ScriptedProvider implements AIProviderInterface {
  readonly id = 'scripted';
  readonly cloud = false;
  private i = 0;
  private lines = [
    'Notice that.',
    'Just notice that, and let it be however it is.',
    'Thank you. What are you noticing now?',
    "That's fine. Notice whatever is there.",
    'Okay. Take a breath. What do you notice in your body?',
  ];
  async complete(): Promise<string> {
    const say = this.lines[this.i++ % this.lines.length];
    return JSON.stringify({ say, action: 'none' });
  }
}

export function makeProvider(cfg: AIConfig): AIProviderInterface | null {
  switch (cfg.provider) {
    case 'anthropic':
      return cfg.apiKey ? new AnthropicProvider(cfg) : null;
    case 'openai':
      return cfg.baseUrl ? new OpenAICompatibleProvider(cfg, 'openai') : null;
    case 'proxy':
      return cfg.baseUrl ? new OpenAICompatibleProvider({ ...cfg, apiKey: cfg.apiKey }, 'proxy') : null;
    case 'scripted':
      return new ScriptedProvider();
    default:
      return null;
  }
}

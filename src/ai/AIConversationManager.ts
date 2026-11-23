import { validateAction } from './AIActionValidator.js';
import { makeProvider, ScriptedProvider } from './AIProviderInterface.js';
import type { AIConfigStore } from './AIConfigStore.js';
import { checkUserText, filterReply, type SafetyVerdict } from './AISafetyController.js';
import { buildContext, parseReply, type SessionSnapshot } from './ConversationContextBuilder.js';
import type { SpeechRecognitionAdapter } from './SpeechRecognitionAdapter.js';
import type { AIReply, ChatTurn, ConfirmedPattern } from './types.js';

export type GuideState = 'idle' | 'listening' | 'thinking';

/**
 * Runs one conversational turn at a time inside the session state machine.
 * It never touches stimulation: it returns a validated reply and the session
 * controller (App) decides what to do with any requested action.
 */
export class AIConversationManager {
  state: GuideState = 'idle';
  turns: ChatTurn[] = [];
  interim = '';
  lastReply: AIReply | null = null;
  pendingHypothesis: string | null = null;
  notice: string | null = null;
  draft = '';
  private fallback = new ScriptedProvider();

  constructor(
    private cfg: AIConfigStore,
    private stt: SpeechRecognitionAdapter,
    private loadHistory: (answers: Record<string, unknown>) => Promise<string[]>,
    private loadPatterns: () => Promise<ConfirmedPattern[]>,
    private onChange: () => void,
  ) {
    stt.onInterim = (t) => {
      this.interim = t;
      this.onChange();
    };
  }

  reset(turns: ChatTurn[] = []): void {
    this.stt.cancel();
    this.state = 'idle';
    this.turns = turns;
    this.interim = '';
    this.lastReply = null;
    this.pendingHypothesis = null;
    this.notice = null;
    this.draft = '';
  }

  /** Called when a new step starts: clears the per-step display, keeps the conversation history. */
  newStep(): void {
    if (this.state === 'listening') this.stt.cancel();
    this.state = 'idle';
    this.interim = '';
    this.lastReply = null;
    this.notice = null;
    this.draft = '';
  }

  canListen(): boolean {
    return this.stt.available();
  }

  async startListening(): Promise<void> {
    this.notice = null;
    this.interim = '';
    try {
      await this.stt.start();
      this.state = 'listening';
    } catch (e) {
      this.notice = (e as Error).message;
    }
    this.onChange();
  }

  async stopListening(snap: SessionSnapshot): Promise<{ reply: AIReply | null; safety: SafetyVerdict; text: string }> {
    this.state = 'thinking';
    this.onChange();
    let text = '';
    try {
      text = await this.stt.stop();
    } catch (e) {
      this.notice = (e as Error).message;
    }
    this.interim = '';
    if (!text) {
      this.state = 'idle';
      this.notice = this.notice ?? "I didn't catch anything. Try again, or type instead.";
      this.onChange();
      return { reply: null, safety: { level: 'ok' }, text };
    }
    return this.ask(text, snap);
  }

  async ask(text: string, snap: SessionSnapshot): Promise<{ reply: AIReply | null; safety: SafetyVerdict; text: string }> {
    this.notice = null;
    this.turns.push({ role: 'user', text, at: new Date().toISOString(), stepId: snap.stepId });
    const safety = checkUserText(text);
    if (safety.level !== 'ok') {
      // Deterministic response — the AI is not consulted.
      this.state = 'idle';
      this.onChange();
      return { reply: null, safety, text };
    }
    this.state = 'thinking';
    this.onChange();

    const c = this.cfg.get();
    const useHistory = c.includeHistory && !!c.consent?.history;
    let history: string[] = [];
    let patterns: ConfirmedPattern[] = [];
    if (useHistory) {
      [history, patterns] = await Promise.all([
        this.loadHistory(snap.answers).catch(() => []),
        this.loadPatterns().catch(() => []),
      ]);
    }
    const ctx = buildContext(snap, this.turns, history, patterns);

    let raw: string;
    const provider = this.cfg.ready() ? makeProvider(c) : null;
    if (!provider) {
      raw = await this.fallback.complete();
      if (c.provider !== 'scripted') this.notice = 'AI guide not set up — using built-in prompts.';
    } else {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      try {
        raw = await provider.complete({ ...ctx, signal: ctl.signal });
      } catch (e) {
        raw = await this.fallback.complete();
        this.notice = `AI unavailable (${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}) — using built-in prompts.`;
      } finally {
        clearTimeout(timer);
      }
    }

    const parsed = parseReply(raw);
    const filtered = filterReply(parsed.say || 'What are you noticing now?');
    const reply: AIReply = {
      say: filtered.say,
      action: validateAction(parsed.action, snap.stage),
      hypothesis: filtered.replaced ? undefined : parsed.hypothesis,
    };
    this.turns.push({ role: 'assistant', text: reply.say, at: new Date().toISOString(), stepId: snap.stepId });
    this.lastReply = reply;
    if (reply.hypothesis) this.pendingHypothesis = reply.hypothesis;
    this.state = 'idle';
    this.onChange();
    return { reply, safety, text };
  }
}

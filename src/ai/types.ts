export type ProviderId = 'off' | 'anthropic' | 'openai' | 'proxy' | 'scripted';
export type SttMode = 'local' | 'browser' | 'whisper' | 'typing';

export interface AIConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string; // OpenAI-compatible base (OpenAI, OpenRouter, local server) or proxy URL
  stt: SttMode;
  sttBaseUrl: string;
  sttKey: string;
  sttModel: string;
  localModel: string;
  includeHistory: boolean;
  speakReplies: boolean;
  /** Consent is recorded per provider; changing provider requires consenting again. */
  consent: { provider: ProviderId; at: string; history: boolean; audio: boolean } | null;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'off',
  apiKey: '',
  model: '',
  baseUrl: '',
  stt: 'local',
  sttBaseUrl: 'https://api.openai.com/v1',
  sttKey: '',
  sttModel: 'whisper-1',
  localModel: 'Xenova/whisper-tiny.en',
  includeHistory: false,
  speakReplies: true,
  consent: null,
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  off: '',
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o-mini',
  proxy: '',
  scripted: '',
};

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  stepId?: string;
}

/** Actions the AI may *request*. The session controller decides whether they run. */
export const AI_ACTIONS = [
  'none',
  'repeat_instruction',
  'record_reflection',
  'show_emotional_rating',
  'pause_session',
  'begin_grounding',
  'finish_session',
] as const;
export type AIAction = (typeof AI_ACTIONS)[number];

export interface AIReply {
  say: string;
  action: AIAction;
  /** Optional pattern hypothesis — shown to the user, saved only if they confirm. */
  hypothesis?: string;
}

export interface ConfirmedPattern {
  id: string;
  text: string;
  source: 'ai-hypothesis' | 'user';
  sessionId?: string;
  createdAt: string;
}

let ctx: AudioContext | null = null;

/** Shared AudioContext, created lazily. Returns null when Web Audio is unavailable. */
export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor({ latencyHint: 'interactive' });
  return ctx;
}

/** Call from a user gesture so audio is allowed to start. */
export function unlockAudio(): void {
  const c = getAudioContext();
  if (c && c.state === 'suspended') void c.resume();
}

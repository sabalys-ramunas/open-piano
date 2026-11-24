let shared: AudioContext | null = null;

/**
 * The app's single AudioContext, created on first use. Instruments and the
 * metronome share it so they stay in time with each other. Create it from a
 * click or key press handler, or it starts suspended.
 */
export function audioContext(): AudioContext {
  // 'interactive' asks the browser for its smallest safe output buffer.
  if (!shared) shared = new AudioContext({ latencyHint: 'interactive' });
  // Safari can leave the context 'interrupted' after a phone call or a tab switch.
  if (shared.state !== 'running' && shared.state !== 'closed') void shared.resume().catch(() => {});
  return shared;
}

/** The context if it exists already, without creating one. */
export function existingAudioContext(): AudioContext | null {
  return shared;
}

/**
 * How long, in seconds, between asking for a sound and hearing it, as far as
 * the browser knows (often an underestimate for Bluetooth headphones; the
 * timing check in settings measures the rest).
 */
export function audioOutputDelay(ctx: AudioContext | null = shared): number {
  if (!ctx) return 0;
  const base = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0;
  const out = 'outputLatency' in ctx && Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0;
  return base + out;
}

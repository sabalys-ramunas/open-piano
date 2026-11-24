/**
 * Timing check maths. The player taps along with clicks they hear (and a
 * flash they see); the typical gap between each click and the tap is their
 * personal delay: sound output (Bluetooth headphones add a lot), the piano's
 * cable, and their own habit of playing a little early or late.
 *
 * The result is stored in settings.latencyMs. Positive means key presses
 * reach the app that many milliseconds AFTER the moment the player meant, so
 * a judge should compare (pressTime - latencyMs / 1000) with the note time.
 */

export interface TimingResult {
  /** Typical delay in ms (median). Positive = presses arrive late. */
  offsetMs: number;
  /** How steady the taps were: median distance from the typical delay, in ms. */
  spreadMs: number;
  /** Taps that matched a click. */
  used: number;
}

/**
 * Pairs each tap with the nearest click (within half a beat), drops the first
 * `warmup` clicks while the player finds the beat, and returns a robust
 * average. Null when there were too few usable taps.
 */
export function measureOffset(
  clicks: readonly number[],
  taps: readonly number[],
  options: { warmup?: number; minTaps?: number } = {},
): TimingResult | null {
  const warmup = options.warmup ?? 2;
  const minTaps = options.minTaps ?? 4;
  if (clicks.length < 2) return null;
  const sorted = [...clicks].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]);
  const beat = median(gaps);
  const counted = sorted.slice(warmup);
  const usedClicks = new Set<number>();
  const offsets: number[] = [];
  for (const tap of taps) {
    let best = -1;
    let bestDist = Infinity;
    counted.forEach((c, i) => {
      const d = Math.abs(tap - c);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best < 0 || bestDist > beat / 2 || usedClicks.has(best)) continue;
    usedClicks.add(best);
    offsets.push(tap - counted[best]);
  }
  if (offsets.length < minTaps) return null;
  const mid = median(offsets);
  // Throw away taps far from the rest (a missed beat, a double tap) and average again.
  const spread = median(offsets.map((o) => Math.abs(o - mid)));
  const keep = offsets.filter((o) => Math.abs(o - mid) <= Math.max(3 * spread, beat * 0.08));
  const offset = median(keep.length >= minTaps ? keep : offsets);
  return { offsetMs: Math.round(offset), spreadMs: Math.round(spread), used: offsets.length };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A plain-words verdict for the result. */
export function describeOffset(result: TimingResult): string {
  const ms = Math.abs(result.offsetMs);
  const steady = result.spreadMs <= 40;
  const how =
    ms < 15
      ? 'Your timing and the app line up well.'
      : result.offsetMs > 0
        ? `Your presses reach the app about ${ms} ms after the beat. The app will allow for that.`
        : `You play about ${ms} ms ahead of the beat. The app will allow for that.`;
  return steady ? how : `${how} Your taps were a bit uneven, so you may want to try again.`;
}

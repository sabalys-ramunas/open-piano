/**
 * "Set the tempo by tapping": tap along with the music and get beats per
 * minute. Uses the middle value of the recent gaps, so one late tap does not
 * spoil the result.
 */

/** Tempo from tap times in milliseconds, or null with fewer than 4 taps. */
export function bpmFromTaps(times: readonly number[]): number | null {
  if (times.length < 4) return null;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  if (!(median > 0)) return null;
  const bpm = 60000 / median;
  if (bpm < 20 || bpm > 400) return null;
  return Math.round(bpm * 10) / 10;
}

export class TapTempo {
  private times: number[] = [];

  constructor(
    private keep = 12,
    private resetAfterMs = 2500,
  ) {}

  /** Records a tap. Returns the tempo so far, or null until there are enough taps. */
  tap(now: number): number | null {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && (now - last > this.resetAfterMs || now <= last)) this.times = [];
    this.times.push(now);
    if (this.times.length > this.keep) this.times.shift();
    return bpmFromTaps(this.times);
  }

  get count(): number {
    return this.times.length;
  }

  reset(): void {
    this.times = [];
  }
}

/**
 * The recording's loudness over time, drawn behind the notes so they can be
 * lined up with what you hear. Stored as the lowest and highest sample in
 * each small slice of time.
 */
export interface Peaks {
  /** Slices per second. */
  rate: number;
  min: Float32Array;
  max: Float32Array;
  /** Length of the recording in seconds. */
  duration: number;
}

/** Mixes the channels and keeps the extremes of each slice. */
export function computePeaks(channels: readonly Float32Array[], sampleRate: number, rate = 200): Peaks {
  const length = channels.length ? channels[0].length : 0;
  const per = Math.max(1, Math.round(sampleRate / rate));
  const count = Math.ceil(length / per);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  const scale = 1 / Math.max(1, channels.length);
  for (let b = 0; b < count; b++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(length, (b + 1) * per);
    for (let i = b * per; i < end; i++) {
      let s = 0;
      for (const ch of channels) s += ch[i];
      s *= scale;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    min[b] = lo;
    max[b] = hi;
  }
  // Quiet recordings are scaled up so the shape is still easy to see.
  let top = 0;
  for (let b = 0; b < count; b++) top = Math.max(top, -min[b], max[b]);
  if (top > 0 && top < 0.9) {
    const k = 0.9 / top;
    for (let b = 0; b < count; b++) {
      min[b] *= k;
      max[b] *= k;
    }
  }
  return { rate: sampleRate / per, min, max, duration: length / sampleRate };
}

/** Lowest and highest value between two times. */
export function peakRange(p: Peaks, t0: number, t1: number): [number, number] {
  const a = Math.max(0, Math.floor(t0 * p.rate));
  const b = Math.min(p.min.length, Math.max(a + 1, Math.ceil(t1 * p.rate)));
  let lo = 0;
  let hi = 0;
  for (let i = a; i < b; i++) {
    if (p.min[i] < lo) lo = p.min[i];
    if (p.max[i] > hi) hi = p.max[i];
  }
  return [lo, hi];
}

/** Decodes a recording (a blob: URL) into peaks. Resolves null when it cannot be read. */
export async function loadPeaks(url: string): Promise<Peaks | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    // A tiny offline context only decodes; it never plays or asks for the speakers.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
    return computePeaks(channels, buffer.sampleRate);
  } catch (error) {
    console.warn('The recording could not be drawn.', error);
    return null;
  }
}

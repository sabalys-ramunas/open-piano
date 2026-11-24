// A fast in-place complex FFT for the song splitter. Sizes are powers of two
// (4096 and 2048 here). Tables are made once per size; the transform itself
// allocates nothing. The first two stages need no twiddle multiplies and are
// done together as one radix-4 pass, which is where a plain radix-2 FFT spends
// a good share of its time.

export interface FftPlan {
  readonly n: number;
  /** Bit-reversal pairs (i, j) with i < j, flattened. */
  readonly swaps: Uint32Array;
  /** cos and -sin of 2*pi*k/n for k < n/2. */
  readonly cos: Float64Array;
  readonly sin: Float64Array;
}

const plans = new Map<number, FftPlan>();

export function fftPlan(n: number): FftPlan {
  let plan = plans.get(n);
  if (plan) return plan;
  const bits = Math.log2(n);
  if (!Number.isInteger(bits) || n < 4) throw new Error('FFT size must be a power of two, at least 4');
  const pairs: number[] = [];
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    if (r > i) pairs.push(i, r);
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = -Math.sin((2 * Math.PI * k) / n);
  }
  plan = { n, swaps: Uint32Array.from(pairs), cos, sin };
  plans.set(n, plan);
  return plan;
}

/**
 * In-place complex FFT of `re` + i `im` (length n). `inverse` conjugates the
 * twiddles and does not scale: divide by n yourself.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { swaps, cos, sin } = fftPlan(n);
  for (let p = 0; p < swaps.length; p += 2) {
    const i = swaps[p];
    const j = swaps[p + 1];
    let t = re[i];
    re[i] = re[j];
    re[j] = t;
    t = im[i];
    im[i] = im[j];
    im[j] = t;
  }
  // Stages of size 2 and 4 together: twiddles are 1 and -i (or +i inverse).
  const s = inverse ? -1 : 1;
  for (let a = 0; a < n; a += 4) {
    const r0 = re[a], i0 = im[a];
    const r1 = re[a + 1], i1 = im[a + 1];
    const r2 = re[a + 2], i2 = im[a + 2];
    const r3 = re[a + 3], i3 = im[a + 3];
    const ar = r0 + r1, ai = i0 + i1; // size-2 butterflies
    const br = r0 - r1, bi = i0 - i1;
    const cr = r2 + r3, ci = i2 + i3;
    const dr = r2 - r3, di = i2 - i3;
    // d times -i (forward) or +i (inverse)
    const er = s * di, ei = -s * dr;
    re[a] = ar + cr;
    im[a] = ai + ci;
    re[a + 2] = ar - cr;
    im[a + 2] = ai - ci;
    re[a + 1] = br + er;
    im[a + 1] = bi + ei;
    re[a + 3] = br - er;
    im[a + 3] = bi - ei;
  }
  for (let size = 8; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t];
        const wi = s * sin[t];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Periodic Hann window (what Spleeter and torch.hann_window use). */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// Small signal helpers used before and after the network: an FFT, centre
// extraction for stereo recordings, and resampling. Plain TypeScript so they
// run in a worker and in tests.

/** In-place radix-2 complex FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * How alike the two channels are, from 0 (unrelated) to 1 (the same signal).
 * Mono files played as stereo give 1, and so does a song with everything in the middle.
 */
export function channelSimilarity(left: Float32Array, right: Float32Array): number {
  let lr = 0;
  let ll = 0;
  let rr = 0;
  const step = Math.max(1, Math.floor(left.length / 2_000_000));
  for (let i = 0; i < left.length; i += step) {
    lr += left[i] * right[i];
    ll += left[i] * left[i];
    rr += right[i] * right[i];
  }
  return ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
}

/**
 * Keeps what sits in the middle of a stereo recording, where singers are
 * almost always mixed, and fades out what is panned to the sides. Works per
 * frequency: a sound counts as "middle" when both channels carry it with the
 * same strength and phase.
 */
export function centre(
  left: Float32Array,
  right: Float32Array,
  options: { size?: number; sharpness?: number } = {},
): Float32Array {
  const size = options.size ?? 2048;
  const hop = size / 4;
  const sharp = options.sharpness ?? 4;
  const n = left.length;
  const out = new Float32Array(n);
  const w = hann(size);
  const lr = new Float64Array(size);
  const li = new Float64Array(size);
  const rr = new Float64Array(size);
  const ri = new Float64Array(size);
  // Hann analysis and synthesis at a quarter-window hop sums to 1.5.
  const norm = 1 / 1.5;
  for (let at = -size + hop; at < n; at += hop) {
    for (let i = 0; i < size; i++) {
      const k = at + i;
      const inside = k >= 0 && k < n;
      lr[i] = inside ? left[k] * w[i] : 0;
      rr[i] = inside ? right[k] * w[i] : 0;
      li[i] = 0;
      ri[i] = 0;
    }
    fft(lr, li);
    fft(rr, ri);
    for (let b = 0; b < size; b++) {
      const cross = lr[b] * rr[b] + li[b] * ri[b]; // real part of L * conj(R)
      const power = lr[b] * lr[b] + li[b] * li[b] + rr[b] * rr[b] + ri[b] * ri[b];
      const same = power > 1e-12 ? Math.max(0, (2 * cross) / power) : 0;
      const g = same ** sharp * 0.5;
      // Inverse FFT through the forward one: conjugate in, conjugate out.
      lr[b] = (lr[b] + rr[b]) * g;
      li[b] = -(li[b] + ri[b]) * g;
    }
    fft(lr, li);
    for (let i = 0; i < size; i++) {
      const k = at + i;
      if (k >= 0 && k < n) out[k] += (lr[i] / size) * w[i] * norm;
    }
  }
  return out;
}

/** Linear-interpolation resampler, good enough to feed the network from any rate. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  // A simple moving average first when shrinking, against aliasing.
  const src = ratio > 1.01 ? smooth(input, Math.round(ratio)) : input;
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (src[j] ?? 0) * (1 - f) + (src[j + 1] ?? 0) * f;
  }
  return out;
}

function smooth(input: Float32Array, width: number): Float32Array {
  if (width <= 1) return input;
  const out = new Float32Array(input.length);
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += input[i];
    if (i >= width) sum -= input[i - width];
    out[i] = sum / Math.min(i + 1, width);
  }
  return out;
}

/** Root-mean-square level of consecutive blocks. */
export function blockLevels(audio: Float32Array, block: number): Float32Array {
  const out = new Float32Array(Math.ceil(audio.length / block));
  for (let b = 0; b < out.length; b++) {
    let s = 0;
    const end = Math.min(audio.length, (b + 1) * block);
    for (let i = b * block; i < end; i++) s += audio[i] * audio[i];
    out[b] = Math.sqrt(s / Math.max(1, end - b * block));
  }
  return out;
}

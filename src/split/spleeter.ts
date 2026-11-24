// Splits a stereo 44.1 kHz recording with Deezer's Spleeter 4stems networks
// (vocals, drums, bass, other), block by block, and streams out only what the
// app keeps:
// - the backing: the recording without the "other" layer (guitars, keys),
//   stereo, at 44.1 kHz or (for the WAV fallback) 22.05 kHz;
// - mono vocals, other and bass at 22.05 kHz for the note model.
//
// The maths is the prototype's (experiments/separation/src/separate.js), which
// was checked against Spleeter itself: a 4096-point STFT with a 1024 hop and
// periodic Hann windows, the networks see the magnitudes of the lowest 1024
// bins of 512 frames at a time, ratio masks (each stem's estimate squared over
// their sum), masks above 11 kHz extended with each frame's mean, and the
// inverse with overlap-add. What changed is how much is kept and computed:
// - nothing full-length is held except the input; the overlap-add tail is
//   carried from block to block and finished samples go straight to the sinks;
// - the masks sum to one, so the backing is the recording times (1 - other's
//   mask): one inverse transform per frame instead of one per stem;
// - the 22.05 kHz outputs come from a 2048-point inverse of the lowest 1024
//   bins (band-limited and decimated in one step), two outputs packed into one
//   complex transform;
// - every buffer is allocated once, the FFT is faster, no Math.hypot.

import { fft, hann } from './fft';

export const SPLIT_RATE = 44100;
export const LOW_RATE = 22050;
export const STEMS = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = (typeof STEMS)[number];

export const N_FFT = 4096;
export const HOP = 1024;
/** Frames per network call (about 11.9 seconds). */
export const T = 512;
/** Bins the networks see (up to 11 kHz). */
export const F = 1024;
export const BINS = N_FFT / 2 + 1;
const PAD = N_FFT - HOP;
const N2 = N_FFT / 2;
const HOP2 = HOP / 2;
/** Sum of the squared window over overlapping frames (periodic Hann, hop N/4). */
const WSUM = 1.5;

/** Runs the four networks on one block of magnitudes [2, 1, T, F]; returns one estimate per stem in STEMS order. */
export type StemModel = (magnitudes: Float32Array) => Promise<readonly Float32Array[]>;

export interface SplitSinks {
  /** Finished backing samples, in order. The arrays are reused: copy what you keep. */
  backing?(left: Float32Array, right: Float32Array): void | Promise<void>;
  /** Finished 22.05 kHz mono stems, in order. Reused arrays too. */
  stems?(vocals: Float32Array, other: Float32Array, bass: Float32Array): void | Promise<void>;
}

export interface SplitOptions {
  /** 44100 (default) or 22050 for the backing. */
  backingRate?: 44100 | 22050;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Filled with the time spent in the networks and in this file's maths, in ms. */
  stats?: { modelMs: number; dspMs: number; blocks: number };
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

/** Number of 512-frame blocks for a recording of `n` samples (each costs one network call per stem). */
export function blockCount(n: number): number {
  return Math.ceil(Math.ceil((PAD + n) / HOP) / T);
}

/** Length of a 22.05 kHz output for `n` input samples. */
export const lowLength = (n: number) => Math.ceil(n / 2);

export async function splitStereo(left: Float32Array, right: Float32Array, model: StemModel, sinks: SplitSinks, options: SplitOptions = {}): Promise<void> {
  const n = Math.min(left.length, right.length);
  const lowBacking = options.backingRate === 22050;
  const wantBacking = Boolean(sinks.backing);
  const wantStems = Boolean(sinks.stems);
  const stats = options.stats;
  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

  const frames = Math.ceil((PAD + n) / HOP);
  const blocks = Math.ceil(frames / T);
  const win = hann(N_FFT);
  const win2 = hann(N2);

  // Work buffers, made once.
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const re2 = new Float64Array(N2);
  const im2 = new Float64Array(N2);
  const xlr = new Float32Array(T * BINS);
  const xli = new Float32Array(T * BINS);
  const xrr = new Float32Array(T * BINS);
  const xri = new Float32Array(T * BINS);
  const mag = new Float32Array(2 * T * F);
  // Masks of one frame, per channel: vocals, bass, other (drums only counts in the total).
  const mv = new Float32Array(2 * BINS);
  const mb = new Float32Array(2 * BINS);
  const mo = new Float32Array(2 * BINS);
  const keep = new Float32Array(2 * BINS);
  const spectra: Spectra = { lr: xlr, li: xli, rr: xrr, ri: xri };

  // Overlap-add accumulators: one block of hops plus one frame.
  const accLen = T * HOP + N_FFT;
  const accLen2 = T * HOP2 + N2;
  const backL = wantBacking ? new Float32Array(lowBacking ? accLen2 : accLen) : null;
  const backR = wantBacking ? new Float32Array(lowBacking ? accLen2 : accLen) : null;
  const accV = wantStems ? new Float32Array(accLen2) : null;
  const accO = wantStems ? new Float32Array(accLen2) : null;
  const accB = wantStems ? new Float32Array(accLen2) : null;
  const outA = new Float32Array(T * HOP);
  const outB = new Float32Array(T * HOP);
  const outC = new Float32Array(T * HOP2);

  options.onProgress?.(0);
  for (let b = 0; b < blocks; b++) {
    if (options.signal?.aborted) throw new Cancelled();
    let t0 = now();
    const f0 = b * T;
    const count = Math.min(T, frames - f0);
    if (count < T) mag.fill(0);

    // ---- Forward: both channels in one complex transform.
    for (let f = 0; f < count; f++) {
      const start = (f0 + f) * HOP - PAD;
      if (start >= 0 && start + N_FFT <= n) {
        for (let i = 0; i < N_FFT; i++) {
          const w = win[i];
          re[i] = left[start + i] * w;
          im[i] = right[start + i] * w;
        }
      } else {
        for (let i = 0; i < N_FFT; i++) {
          const x = start + i;
          const inside = x >= 0 && x < n;
          re[i] = inside ? left[x] * win[i] : 0;
          im[i] = inside ? right[x] * win[i] : 0;
        }
      }
      fft(re, im);
      const row = f * BINS;
      const ml = f * F;
      const mr = T * F + f * F;
      for (let k = 0; k < BINS; k++) {
        const j = (N_FFT - k) & (N_FFT - 1);
        const lr = 0.5 * (re[k] + re[j]);
        const li = 0.5 * (im[k] - im[j]);
        const rr = 0.5 * (im[k] + im[j]);
        const ri = -0.5 * (re[k] - re[j]);
        xlr[row + k] = lr;
        xli[row + k] = li;
        xrr[row + k] = rr;
        xri[row + k] = ri;
        if (k < F) {
          mag[ml + k] = Math.sqrt(lr * lr + li * li);
          mag[mr + k] = Math.sqrt(rr * rr + ri * ri);
        }
      }
    }
    let t1 = now();
    if (stats) stats.dspMs += t1 - t0;

    const est = await model(mag);
    t0 = now();
    if (stats) stats.modelMs += t0 - t1;
    if (options.signal?.aborted) throw new Cancelled();
    const [ev, ed, eb, eo] = est;

    // ---- Masks and inverse, frame by frame.
    for (let f = 0; f < count; f++) {
      for (let c = 0; c < 2; c++) {
        const at = c * T * F + f * F;
        const mAt = c * BINS;
        let sv = 0;
        let sb = 0;
        let so = 0;
        for (let k = 0; k < F; k++) {
          const v = ev[at + k];
          const d = ed[at + k];
          const bb = eb[at + k];
          const o = eo[at + k];
          const v2 = v * v;
          const b2 = bb * bb;
          const o2 = o * o;
          const inv = 1 / (1e-10 + v2 + d * d + b2 + o2);
          const qv = (v2 + 2.5e-11) * inv;
          const qb = (b2 + 2.5e-11) * inv;
          const qo = (o2 + 2.5e-11) * inv;
          mv[mAt + k] = qv;
          mb[mAt + k] = qb;
          mo[mAt + k] = qo;
          sv += qv;
          sb += qb;
          so += qo;
        }
        mv.fill(sv / F, mAt + F, mAt + BINS);
        mb.fill(sb / F, mAt + F, mAt + BINS);
        mo.fill(so / F, mAt + F, mAt + BINS);
      }
      const row = f * BINS;

      if (backL && backR) {
        if (!lowBacking) {
          // Stereo backing at 44.1 kHz: A = left (1 - other), B = right (1 - other); Z = A + iB.
          for (let k = 0; k <= N2; k++) {
            const gl = 1 - mo[k];
            const gr = 1 - mo[BINS + k];
            const ar = xlr[row + k] * gl;
            const ai = xli[row + k] * gl;
            const br = xrr[row + k] * gr;
            const bi = xri[row + k] * gr;
            re[k] = ar - bi;
            im[k] = ai + br;
            if (k > 0 && k < N2) {
              re[N_FFT - k] = ar + bi;
              im[N_FFT - k] = -ai + br;
            }
          }
          fft(re, im, true);
          const o = f * HOP;
          for (let i = 0; i < N_FFT; i++) {
            const w = win[i] / N_FFT;
            backL[o + i] += re[i] * w;
            backR[o + i] += im[i] * w;
          }
        } else {
          for (let k = 0; k < 2 * BINS; k++) keep[k] = 1 - mo[k];
          lowInverse(re2, im2, spectra, row, 'stereo', keep);
          addFrame(backL, backR, re2, im2, f * HOP2, win2);
        }
      }

      if (accV && accO && accB) {
        // Mono stems: P = (left mask_l + right mask_r) / 2 for vocals and other in one transform, bass in another.
        lowInverse(re2, im2, spectra, row, 'mono', mv, mo);
        addFrame(accV, accO, re2, im2, f * HOP2, win2);
        lowInverse(re2, im2, spectra, row, 'mono', mb);
        addFrame(accB, null, re2, im2, f * HOP2, win2);
      }
    }

    // ---- Hand over finished samples, carry the overlap into the next block.
    const last = b === blocks - 1;
    const base = f0 * HOP - PAD;
    if (backL && backR) {
      const rate = lowBacking ? 2 : 1;
      const hop = HOP / rate;
      const b0 = base / rate;
      const end = last ? Math.ceil(n / rate) : b0 + count * hop;
      const from = Math.max(0, b0);
      const len = Math.max(0, end - from);
      for (let i = 0; i < len; i++) {
        outA[i] = backL[from - b0 + i] / WSUM;
        outB[i] = backR[from - b0 + i] / WSUM;
      }
      t1 = now();
      if (stats) stats.dspMs += t1 - t0;
      if (len > 0) await sinks.backing!(outA.subarray(0, len), outB.subarray(0, len));
      t0 = now();
      carry(backL, count * hop, (lowBacking ? N2 : N_FFT) - hop);
      carry(backR, count * hop, (lowBacking ? N2 : N_FFT) - hop);
    }
    if (accV && accO && accB) {
      const b0 = base / 2;
      const end = last ? lowLength(n) : b0 + count * HOP2;
      const from = Math.max(0, b0);
      const len = Math.max(0, end - from);
      // outA/outB are free again once the backing sink returned.
      for (let i = 0; i < len; i++) {
        outA[i] = accV[from - b0 + i] / WSUM;
        outB[i] = accO[from - b0 + i] / WSUM;
        outC[i] = accB[from - b0 + i] / WSUM;
      }
      t1 = now();
      if (stats) stats.dspMs += t1 - t0;
      if (len > 0) await sinks.stems!(outA.subarray(0, len), outB.subarray(0, len), outC.subarray(0, len));
      t0 = now();
      for (const acc of [accV, accO, accB]) carry(acc, count * HOP2, N2 - HOP2);
    }
    if (stats) {
      stats.dspMs += now() - t0;
      stats.blocks++;
    }
    options.onProgress?.((b + 1) / blocks);
  }
}

/**
 * One 2048-point inverse of the lowest bins of frame `row`: two real outputs,
 * P into `re` and Q into `im`. Masks hold the left channel's gains in
 * [0, BINS) and the right's in [BINS, 2 BINS).
 * 'stereo': P = left * p, Q = right * p. 'mono': P = (left * p_l + right * p_r) / 2,
 * Q the same with `q` (or silence without it).
 * The result is the 44.1 kHz signal at every other sample, band-limited to 11 kHz.
 */
function lowInverse(
  re: Float64Array,
  im: Float64Array,
  x: Spectra,
  row: number,
  kind: 'stereo' | 'mono',
  p: Float32Array,
  q?: Float32Array,
): void {
  const { lr, li, rr, ri } = x;
  for (let k = 0; k < N2 / 2; k++) {
    const pl = p[k];
    const pr = p[BINS + k];
    const xlr = lr[row + k];
    const xli = li[row + k];
    const xrr = rr[row + k];
    const xri = ri[row + k];
    let ar: number, ai: number, br: number, bi: number;
    if (kind === 'stereo') {
      ar = xlr * pl;
      ai = xli * pl;
      br = xrr * pr;
      bi = xri * pr;
    } else {
      ar = 0.5 * (xlr * pl + xrr * pr);
      ai = 0.5 * (xli * pl + xri * pr);
      if (q) {
        const ql = q[k];
        const qr = q[BINS + k];
        br = 0.5 * (xlr * ql + xrr * qr);
        bi = 0.5 * (xli * ql + xri * qr);
      } else {
        br = 0;
        bi = 0;
      }
    }
    re[k] = ar - bi;
    im[k] = ai + br;
    if (k > 0) {
      re[N2 - k] = ar + bi;
      im[N2 - k] = -ai + br;
    }
  }
  // The new Nyquist bin (11025 Hz) is left out.
  re[N2 / 2] = 0;
  im[N2 / 2] = 0;
  fft(re, im, true);
}

interface Spectra {
  lr: Float32Array;
  li: Float32Array;
  rr: Float32Array;
  ri: Float32Array;
}

/** Overlap-adds one 2048-sample frame (re into a, im into b) at `offset`. */
function addFrame(a: Float32Array, b: Float32Array | null, re: Float64Array, im: Float64Array, offset: number, win: Float64Array): void {
  for (let i = 0; i < N2; i++) {
    const w = win[i] / N_FFT;
    a[offset + i] += re[i] * w;
    if (b) b[offset + i] += im[i] * w;
  }
}

/** Moves the `keep` samples starting at `from` to the front and clears the rest. */
function carry(acc: Float32Array, from: number, keep: number): void {
  acc.copyWithin(0, from, from + keep);
  acc.fill(0, keep);
}

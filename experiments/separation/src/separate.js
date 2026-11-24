// Model registry and the separation loops. Runtime-agnostic: the caller passes
// an onnxruntime module (`onnxruntime-web` in the browser worker,
// `onnxruntime-node` in node-check.mjs) and the sessions it created, so the
// exact same chunking / STFT code is measured everywhere.
import { prepareModelInput, standaloneIspec, standaloneMask } from '../node_modules/demucs-web/src/processor.js';
import { fft, hann } from './fft.js';

export const SAMPLE_RATE = 44100;

export const MODELS = {
  // Demucs v4 (htdemucs), 4 stems. Export by timcsy/demucs-web: the STFT and
  // the frequency-branch iSTFT happen in JS, the network takes [wave, spec].
  htdemucs: {
    label: 'HT-Demucs v4 (4 stems)',
    files: ['htdemucs_embedded.onnx'],
    stems: ['drums', 'bass', 'other', 'vocals'],
    kind: 'demucs-split',
  },
  // Demucs v4 6-source (htdemucs_6s). Export by StemSplitio, WebGPU fix by
  // kramp: STFT/iSTFT inside the graph, mix [1,2,343980] -> stems [1,6,2,343980].
  htdemucs_6s: {
    label: 'HT-Demucs v4 6-stem (guitar, piano)',
    files: ['htdemucs_6s_kramp.onnx'],
    stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    kind: 'demucs-graph',
  },
  // Deezer Spleeter 4stems (fp16 weights, fp32 I/O), one U-Net per stem.
  // Magnitudes in, magnitudes out; STFT, ratio mask and iSTFT here.
  spleeter4: {
    label: 'Spleeter 4 stems (small, fast)',
    files: ['spleeter4_vocals.fp16.onnx', 'spleeter4_drums.fp16.onnx', 'spleeter4_bass.fp16.onnx', 'spleeter4_other.fp16.onnx'],
    stems: ['vocals', 'drums', 'bass', 'other'],
    kind: 'spleeter',
  },
  // Deezer Spleeter 5stems (has a piano stem), converted by
  // convert/spleeter_export.py from the v1.4.0 checkpoint: one file, five
  // U-Nets soft-maxed across stems, fp16-stored weights, fp32 compute.
  spleeter5: {
    label: 'Spleeter 5 stems with piano (small, fast)',
    files: ['spleeter5.fp16w.onnx'],
    stems: ['vocals', 'piano', 'drums', 'bass', 'other'],
    kind: 'spleeter',
  },
};

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

/**
 * Separates a stereo 44.1 kHz recording.
 * @param {object} ort onnxruntime module (for Tensor)
 * @param {object[]} sessions one InferenceSession per entry in MODELS[model].files
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {{ model: string, onProgress?: (f: number) => void, signal?: AbortSignal, overlap?: number, stats?: { runMs?: number } }} options
 *   stats.runMs is filled with the time spent inside session.run (the rest is JS STFT, masks, overlap-add)
 * @returns {Promise<Record<string, { left: Float32Array, right: Float32Array }>>}
 */
export async function separate(ort, sessions, left, right, options) {
  const spec = MODELS[options.model];
  options.stats ??= {};
  options.stats.runMs = 0;
  if (!spec) throw new Error(`Unknown model ${options.model}`);
  if (spec.kind === 'spleeter') return separateSpleeter(ort, sessions, left, right, spec, options);
  return separateDemucs(ort, sessions[0], left, right, spec, options);
}

// ---- Demucs ----------------------------------------------------------------
const SEGMENT = 343980; // 7.8 s, fixed in both exports

async function separateDemucs(ort, session, left, right, spec, options) {
  const stats = options.stats;
  const n = left.length;
  const overlap = options.overlap ?? 0.25;
  const stride = Math.round(SEGMENT * (1 - overlap));
  const progress = options.onProgress ?? (() => {});
  const S = spec.stems.length;

  // Track-level normalisation, as demucs.separate does (mean/std of the mono mix).
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) { const m = (left[i] + right[i]) / 2; sum += m; sum2 += m * m; }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(1e-12, sum2 / n - mean * mean));

  // Triangular overlap-add weight (demucs apply_model, transition_power = 1).
  const weight = new Float32Array(SEGMENT);
  for (let i = 0; i < SEGMENT; i++) weight[i] = Math.min(i + 1, SEGMENT - i) / (SEGMENT / 2);

  const out = spec.stems.map(() => ({ left: new Float32Array(n), right: new Float32Array(n) }));
  const wsum = new Float32Array(n);
  const segments = Math.max(1, Math.ceil(Math.max(0, n - SEGMENT) / stride) + 1);
  let done = 0;
  progress(0);

  for (let offset = 0; offset < n; offset += stride) {
    if (options.signal?.aborted) throw new Cancelled();
    const len = Math.min(SEGMENT, n - offset);
    const segL = new Float32Array(SEGMENT), segR = new Float32Array(SEGMENT);
    for (let i = 0; i < len; i++) {
      segL[i] = (left[offset + i] - mean) / std;
      segR[i] = (right[offset + i] - mean) / std;
    }

    let stems; // (stem, channel, i) -> value
    if (spec.kind === 'demucs-graph') {
      const wave = new Float32Array(2 * SEGMENT);
      wave.set(segL, 0); wave.set(segR, SEGMENT);
      const tr = performance.now();
      const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', wave, [1, 2, SEGMENT]) });
      stats.runMs += performance.now() - tr;
      const data = res[session.outputNames[0]].data;
      stems = (s, c, i) => data[(s * 2 + c) * SEGMENT + i];
      for (const k of Object.keys(res)) res[k].dispose?.();
    } else {
      const input = prepareModelInput(segL, segR);
      const tr = performance.now();
      const res = await session.run({
        [session.inputNames[0]]: new ort.Tensor('float32', input.waveform, [1, 2, SEGMENT]),
        [session.inputNames[1]]: new ort.Tensor('float32', input.magSpec, [1, 4, 2048, 336]),
      });
      stats.runMs += performance.now() - tr;
      let timeData, freqData;
      for (const name of session.outputNames) {
        const t = res[name];
        if (t.dims.length === 4) timeData = t.data; else freqData = t.data;
      }
      const specs = standaloneMask(freqData);
      const freqWave = specs.map((ts) => standaloneIspec(ts, SEGMENT));
      for (const k of Object.keys(res)) res[k].dispose?.();
      stems = (s, c, i) => timeData[(s * 2 + c) * SEGMENT + i] + (c === 0 ? freqWave[s].left[i] : freqWave[s].right[i]);
    }

    for (let s = 0; s < S; s++) {
      const oL = out[s].left, oR = out[s].right;
      for (let i = 0; i < len; i++) {
        const w = weight[i];
        oL[offset + i] += w * stems(s, 0, i);
        oR[offset + i] += w * stems(s, 1, i);
      }
    }
    for (let i = 0; i < len; i++) wsum[offset + i] += weight[i];
    done++;
    progress(Math.min(1, done / segments));
    // Yield so a cancel message can be handled between segments.
    await new Promise((r) => setTimeout(r, 0));
    if (offset + SEGMENT >= n) break;
  }

  for (let s = 0; s < S; s++) {
    const oL = out[s].left, oR = out[s].right;
    for (let i = 0; i < n; i++) {
      const w = wsum[i] > 0 ? std / wsum[i] : 0;
      oL[i] = oL[i] * w + mean;
      oR[i] = oR[i] * w + mean;
    }
  }
  return Object.fromEntries(spec.stems.map((name, s) => [name, out[s]]));
}

// ---- Spleeter ----------------------------------------------------------------
const N_FFT = 4096, HOP = 1024, T = 512, F = 1024, BINS = N_FFT / 2 + 1, PAD = N_FFT - HOP;

async function separateSpleeter(ort, sessions, left, right, spec, options) {
  const stats = options.stats;
  const n = left.length;
  const progress = options.onProgress ?? (() => {});
  const S = spec.stems.length;
  const win = hann(N_FFT);
  const frames = Math.ceil((PAD + n) / HOP);
  const blocks = Math.ceil(frames / T);

  const out = spec.stems.map(() => ({ left: new Float32Array(n), right: new Float32Array(n) }));
  const wsum = new Float32Array(n);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  // Per-block complex spectra (channel, frame, bin) and the net input.
  const XL = { re: new Float32Array(T * BINS), im: new Float32Array(T * BINS) };
  const XR = { re: new Float32Array(T * BINS), im: new Float32Array(T * BINS) };
  const mag = new Float32Array(2 * T * F);
  progress(0);

  for (let b = 0; b < blocks; b++) {
    if (options.signal?.aborted) throw new Cancelled();
    const f0 = b * T;
    const count = Math.min(T, frames - f0);
    mag.fill(0);
    for (let f = 0; f < count; f++) {
      const start = (f0 + f) * HOP - PAD;
      for (let i = 0; i < N_FFT; i++) {
        const x = start + i;
        const inside = x >= 0 && x < n;
        re[i] = inside ? left[x] * win[i] : 0;
        im[i] = inside ? right[x] * win[i] : 0;
      }
      fft(re, im);
      const row = f * BINS;
      for (let k = 0; k < BINS; k++) {
        const j = (N_FFT - k) & (N_FFT - 1);
        // unpack two real spectra from one complex transform
        const lr = 0.5 * (re[k] + re[j]), li = 0.5 * (im[k] - im[j]);
        const rr = 0.5 * (im[k] + im[j]), ri = -0.5 * (re[k] - re[j]);
        XL.re[row + k] = lr; XL.im[row + k] = li;
        XR.re[row + k] = rr; XR.im[row + k] = ri;
        if (k < F) {
          mag[f * F + k] = Math.hypot(lr, li);
          mag[T * F + f * F + k] = Math.hypot(rr, ri);
        }
      }
    }

    const est = [];
    if (sessions.length === 1) {
      // one graph for all stems: y [S, 2, 1, T, F]
      const sess = sessions[0];
      const tr = performance.now();
      const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', mag.slice(), [2, 1, T, F]) });
      stats.runMs += performance.now() - tr;
      const y = res[sess.outputNames[0]].data;
      for (let s = 0; s < S; s++) est.push(y.subarray(s * 2 * T * F, (s + 1) * 2 * T * F));
    } else {
      for (let s = 0; s < S; s++) {
        const sess = sessions[s];
        const tr = performance.now();
        const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', mag.slice(), [2, 1, T, F]) });
        stats.runMs += performance.now() - tr;
        est.push(res[sess.outputNames[0]].data);
        if (options.signal?.aborted) throw new Cancelled();
      }
    }

    // Ratio masks, extended above 11 kHz with each frame's mean ("average").
    const masks = est.map(() => new Float32Array(2 * T * BINS));
    for (let c = 0; c < 2; c++) {
      for (let f = 0; f < count; f++) {
        const means = new Float64Array(S);
        for (let k = 0; k < F; k++) {
          const idx = c * T * F + f * F + k;
          let tot = 1e-10;
          for (let s = 0; s < S; s++) tot += est[s][idx] * est[s][idx];
          for (let s = 0; s < S; s++) {
            const m = (est[s][idx] * est[s][idx] + 1e-10 / S) / tot;
            masks[s][c * T * BINS + f * BINS + k] = m;
            means[s] += m;
          }
        }
        for (let s = 0; s < S; s++) {
          const m = means[s] / F;
          masks[s].fill(m, c * T * BINS + f * BINS + F, c * T * BINS + f * BINS + BINS);
        }
      }
    }

    // Inverse: pack masked left + i*masked right into one transform.
    for (let s = 0; s < S; s++) {
      const mk = masks[s];
      const oL = out[s].left, oR = out[s].right;
      for (let f = 0; f < count; f++) {
        const row = f * BINS;
        for (let k = 0; k < BINS; k++) {
          const ml = mk[row + k], mr = mk[T * BINS + row + k];
          const ar = XL.re[row + k] * ml, ai = XL.im[row + k] * ml; // A = left spectrum
          const br = XR.re[row + k] * mr, bi = XR.im[row + k] * mr; // B = right spectrum
          // Z[k] = A[k] + i B[k];  Z[N-k] = conj(A[k]) + i conj(B[k])
          re[k] = ar - bi; im[k] = ai + br;
          if (k > 0 && k < N_FFT / 2) {
            re[N_FFT - k] = ar + bi; im[N_FFT - k] = -ai + br;
          }
        }
        fft(re, im, true);
        const start = (f0 + f) * HOP - PAD;
        for (let i = 0; i < N_FFT; i++) {
          const x = start + i;
          if (x < 0 || x >= n) continue;
          oL[x] += (re[i] / N_FFT) * win[i];
          oR[x] += (im[i] / N_FFT) * win[i];
          if (s === 0) wsum[x] += win[i] * win[i];
        }
      }
    }
    progress((b + 1) / blocks);
    await new Promise((r) => setTimeout(r, 0));
  }

  for (let s = 0; s < S; s++) {
    const oL = out[s].left, oR = out[s].right;
    for (let i = 0; i < n; i++) {
      const w = wsum[i] > 1e-8 ? 1 / wsum[i] : 0;
      oL[i] *= w; oR[i] *= w;
    }
  }
  return Object.fromEntries(spec.stems.map((name, s) => [name, out[s]]));
}

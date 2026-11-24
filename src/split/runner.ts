// Runs the four Spleeter networks with onnxruntime-web (in the split worker,
// and under Node in tests and benchmarks). The caller passes the onnxruntime
// module, so this file never pulls it into a bundle by itself.
import type * as Ort from 'onnxruntime-web';
import { F, STEMS, T, type StemModel } from './spleeter';

type OrtModule = typeof Ort;
export type ExecutionProvider = 'webgpu' | 'wasm';

export interface Runner {
  model: StemModel;
  ep: ExecutionProvider;
  release(): Promise<void>;
}

const SESSION_OPTIONS = {
  graphOptimizationLevel: 'all',
  // No memory-pattern planning and no arena: measured in the prototype, a few hundred MB
  // less at the peak for the same speed.
  enableMemPattern: false,
  enableCpuMemArena: false,
} as const;

/** Creates one session per stem (files in STEMS order: vocals, drums, bass, other). */
export async function createRunner(ort: OrtModule, files: readonly Uint8Array[], ep: ExecutionProvider): Promise<Runner> {
  if (files.length !== STEMS.length) throw new Error('The splitter needs four network files.');
  const sessions: Ort.InferenceSession[] = [];
  try {
    for (const bytes of files) sessions.push(await ort.InferenceSession.create(bytes, { ...SESSION_OPTIONS, executionProviders: [ep] }));
  } catch (error) {
    for (const s of sessions) await s.release().catch(() => {});
    throw error;
  }
  const model: StemModel = async (mag) => {
    const input = new ort.Tensor('float32', mag, [2, 1, T, F]);
    const out: Float32Array[] = [];
    for (const session of sessions) {
      const result = await session.run({ [session.inputNames[0]]: input });
      const tensor = result[session.outputNames[0]];
      const data = tensor.data;
      if (!(data instanceof Float32Array) || data.length !== mag.length) throw new Error('The splitter network gave an unexpected answer.');
      out.push(data);
      for (const name of Object.keys(result)) if (result[name] !== tensor) result[name].dispose();
    }
    return out;
  };
  return {
    model,
    ep,
    async release() {
      for (const s of sessions) await s.release().catch(() => {});
      sessions.length = 0;
    },
  };
}

/** A fixed, music-like block of magnitudes for comparing two ways of running a network. */
export function probeMagnitudes(): Float32Array {
  const mag = new Float32Array(2 * T * F);
  for (let c = 0; c < 2; c++) {
    for (let f = 0; f < T; f++) {
      for (let k = 0; k < F; k++) {
        // A few harmonic series that come and go, over a quiet floor.
        let v = 0.002;
        for (const base of [12, 19, 28]) {
          if (k % base === 0 && ((f >> 5) + base) % 3 !== 0) v += 2 / (1 + k / base);
        }
        mag[c * T * F + f * F + k] = v * (1 + 0.2 * Math.sin(f * 0.1 + c));
      }
    }
  }
  return mag;
}

/**
 * How differently two sets of the four networks' answers would split the
 * music: the ratio masks (each stem's share of every bin) from both, compared
 * bin by bin and weighted by how loud the bin is in `mag` (a near-silent bin
 * can flip between stems on any rounding, and nobody hears it). On the 0..1
 * scale of a mask; Infinity when an answer has a NaN or the sizes differ.
 */
export function maskDifference(a: readonly Float32Array[], b: readonly Float32Array[], mag: Float32Array): number {
  if (a.length !== b.length || a.some((x, s) => x.length !== b[s].length || x.length !== mag.length)) return Infinity;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < mag.length; i++) {
    let ta = 1e-10;
    let tb = 1e-10;
    for (let s = 0; s < a.length; s++) {
      ta += a[s][i] * a[s][i];
      tb += b[s][i] * b[s][i];
    }
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
    const w = mag[i] * mag[i];
    let d = 0;
    for (let s = 0; s < a.length; s++) d += Math.abs((a[s][i] * a[s][i]) / ta - (b[s][i] * b[s][i]) / tb);
    sum += (d / a.length) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * WebGPU is trusted when its masks are this close to WebAssembly's (energy-
 * weighted mean difference). Half-precision maths on a graphics card is a
 * little off everywhere; the failures the prototype found were wholesale
 * (NaNs, or silence where the music is).
 */
export const AGREEMENT = 0.01;

/**
 * Picks how to run the networks when the browser has WebGPU: makes both, runs
 * the same test block through each and keeps WebGPU only if its masks agree
 * with WebAssembly's (the prototype found WebGPU giving wrong numbers for some
 * networks in some browsers). The other set is released.
 */
export async function pickRunner(ort: OrtModule, files: readonly Uint8Array[]): Promise<{ runner: Runner; difference?: number }> {
  const cpu = await createRunner(ort, files, 'wasm');
  let gpu: Runner | null = null;
  try {
    gpu = await createRunner(ort, files, 'webgpu');
    const mag = probeMagnitudes();
    const fromGpu = (await gpu.model(mag)).map((x) => Float32Array.from(x));
    const fromCpu = await cpu.model(mag);
    const difference = maskDifference(fromGpu, fromCpu, mag);
    if (difference < AGREEMENT) {
      await cpu.release();
      return { runner: gpu, difference };
    }
    console.warn(`The graphics card split differently (${difference.toExponential(1)}); splitting on the processor instead.`);
    await gpu.release();
    return { runner: cpu, difference };
  } catch (error) {
    console.warn('WebGPU did not work here; splitting on the processor.', error);
    await gpu?.release();
    return { runner: cpu };
  }
}

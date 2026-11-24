// The split worker: one per song, ended by the page as soon as it answers, so
// all its memory (the networks, onnxruntime's heap, the spectra) goes back
// before the note model starts. onnxruntime-web is loaded here on demand and
// never by the page.
//
// Execution: WebGPU when the browser has a graphics adapter and a test block
// gives the same numbers as WebAssembly; otherwise WebAssembly on one thread
// (see loadOrt for why not more).
import wasmPlainUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import wasmGpuUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import { type BackingEncoder, type EncodedAudio, canEncodeOpus, opusEncoder, wavEncoder } from './encode';
import { loadSplitter } from './model-store';
import { type ExecutionProvider, type Runner, createRunner, pickRunner } from './runner';
import { lowLength, splitStereo } from './spleeter';

export interface SplitRequest {
  type: 'split';
  /** Stereo at 44.1 kHz. */
  left: Float32Array;
  right: Float32Array;
  /** Also make the 22.05 kHz mono harmony stem (other + bass) for the note model. */
  stems: boolean;
  /** How to keep the backing: Opus when the page can play it, else WAV. */
  format: 'opus' | 'wav';
  /** Skip the WebGPU test and use this. */
  prefer?: ExecutionProvider;
}

export interface SplitInfo {
  ep: ExecutionProvider;
  threads: number;
  /** How differently WebGPU split the test block than WebAssembly (masks, 0..1), when tried. */
  webgpuDifference?: number;
  seconds: number;
  modelSeconds: number;
  mathSeconds: number;
  type: string;
}

export type SplitReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; backing: EncodedAudio; harmony?: Float32Array; info: SplitInfo }
  | { type: 'error'; message: string; name: string };

const post = (reply: SplitReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(reply, transfer);
const controller = new AbortController();

type OrtModule = typeof import('onnxruntime-web');

async function loadOrt(gpu: boolean): Promise<OrtModule> {
  const ort = (gpu ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm')) as OrtModule;
  // One thread. Threads need cross-origin isolation, which the app does not have (and the iPad shell
  // cannot have); measured with COOP/COEP on a production build, onnxruntime's thread workers start
  // from this bundled worker and never get going, and the note model's threaded backend fails too.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: new URL(gpu ? wasmGpuUrl : wasmPlainUrl, self.location.href).href };
  ort.env.logLevel = 'error';
  return ort;
}

async function hasAdapter(): Promise<boolean> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function run(request: SplitRequest): Promise<void> {
  const started = performance.now();
  const files = await loadSplitter();
  const gpu = request.prefer !== 'wasm' && (request.prefer === 'webgpu' || (await hasAdapter()));
  const ort = await loadOrt(gpu);
  const n = Math.min(request.left.length, request.right.length);
  let webgpuDifference: number | undefined;

  const attempt = async (provider: ExecutionProvider | 'pick') => {
    let runner: Runner | null = null;
    let encoder: BackingEncoder | null = null;
    try {
      if (provider === 'pick') {
        const picked = await pickRunner(ort, files);
        runner = picked.runner;
        webgpuDifference = picked.difference;
      } else {
        runner = await createRunner(ort, files, provider);
      }
      const ep = runner.ep;
      encoder = request.format === 'opus' && (await canEncodeOpus()) ? opusEncoder() : wavEncoder();
      const enc = encoder;
      // Only the harmony is kept for the note model: the vocal stem did not help (docs/architecture.md).
      const harmony = request.stems ? new Float32Array(lowLength(n)) : null;
      let at = 0;
      const stats = { modelMs: 0, dspMs: 0, blocks: 0 };
      await splitStereo(
        request.left,
        request.right,
        runner.model,
        {
          backing: (l, r) => enc.push(l, r),
          ...(harmony
            ? {
                stems(_v: Float32Array, o: Float32Array, b: Float32Array) {
                  for (let i = 0; i < o.length; i++) harmony[at + i] = o[i] + b[i];
                  at += o.length;
                },
              }
            : {}),
        },
        { backingRate: enc.rate, signal: controller.signal, stats, onProgress: (fraction) => post({ type: 'progress', fraction: 0.02 + 0.96 * fraction }) },
      );
      await runner.release();
      runner = null;
      const backing = await enc.finish();
      return { backing, harmony, stats, ep };
    } finally {
      encoder?.close();
      await runner?.release();
    }
  };

  let result: Awaited<ReturnType<typeof attempt>>;
  try {
    result = await attempt(gpu ? (request.prefer ?? 'pick') : 'wasm');
  } catch (error) {
    if (!gpu || (error instanceof Error && error.name === 'Cancelled')) throw error;
    console.warn('Splitting on the graphics card failed; trying the processor.', error);
    result = await attempt('wasm');
  }
  files.length = 0;
  const { backing, harmony, stats, ep } = result;
  const info: SplitInfo = {
    ep,
    threads: ort.env.wasm.numThreads ?? 1,
    webgpuDifference,
    seconds: (performance.now() - started) / 1000,
    modelSeconds: stats.modelMs / 1000,
    mathSeconds: stats.dspMs / 1000,
    type: backing.type,
  };
  const transfer: Transferable[] = [backing.bytes];
  if (harmony) transfer.push(harmony.buffer);
  post({ type: 'done', backing, ...(harmony ? { harmony } : {}), info }, transfer);
}

self.onmessage = (event: MessageEvent<SplitRequest | { type: 'cancel' }>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    controller.abort();
    return;
  }
  if (request.type !== 'split') return;
  post({ type: 'progress', fraction: 0 });
  run(request).catch((error: unknown) => {
    const e = error instanceof Error ? error : new Error(String(error));
    post({ type: 'error', message: e.message, name: e.name });
  });
};

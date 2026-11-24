// Picks the fastest way this browser can run the network: the graphics card
// (WebGL), WebAssembly, or plain JavaScript. Each candidate runs one batch;
// the fastest one whose answers agree with the others wins.
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { type GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import wasmPlain from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimd from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreads from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import { runModel } from './model';

setWasmPaths({
  'tfjs-backend-wasm.wasm': wasmPlain,
  'tfjs-backend-wasm-simd.wasm': wasmSimd,
  'tfjs-backend-wasm-threaded-simd.wasm': wasmThreads,
});

export type BackendName = 'webgl' | 'wasm' | 'cpu';

export interface Loaded {
  model: GraphModel;
  backend: BackendName;
  /** Measured speed of each backend tried, in seconds of audio per second. */
  speeds: Partial<Record<BackendName, number>>;
}

const TEST_SECONDS = 4;
/** A warm-up slower than this rules a backend out once another one already works. */
const SLOW_WARM_UP_MS = 8000;

/**
 * The backends to race, in order. WebAssembly runs first when the graphics
 * card is unlikely to win, so a slow card never holds up the import:
 * - a software graphics driver (SwiftShader, llvmpipe) is many times slower
 *   than WebAssembly, and just finding that out took about 20 seconds;
 * - Safari's engine (Safari, every iPhone and iPad browser, the app's own
 *   iPad shell) runs this network on WebGL about 70 times slower than on
 *   WebAssembly, after a warm-up of more than half a minute.
 */
export function backendCandidates(options: { prefer?: BackendName; softwareGraphics: boolean; webkit: boolean }): BackendName[] {
  if (options.prefer) return [options.prefer];
  return options.softwareGraphics || options.webkit ? ['wasm', 'cpu'] : ['webgl', 'wasm', 'cpu'];
}

/** True for Safari's engine (WebKit) but not for Chrome, Edge or Firefox on a desktop or Android. */
export function isWebKitEngine(userAgent: string): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true; // every iOS browser is WebKit
  return /AppleWebKit\//.test(userAgent) && !/(Chrome|Chromium|CriOS|Edg|OPR|Android|Firefox)\//.test(userAgent);
}

/** Loads the network on the fastest working backend. `prefer` skips the race. */
export async function loadFastest(modelUrl: string, prefer?: BackendName): Promise<Loaded> {
  const handler = tf.io.browserHTTPRequest(modelUrl);
  if (!handler.load) throw new Error('Cannot load the note model.');
  const artifacts = await handler.load();
  const probe = new Float32Array(22050 * TEST_SECONDS);
  for (let i = 0; i < probe.length; i++) probe[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / 22050) * (1 + Math.sin(i / 3000));

  const candidates = backendCandidates({
    prefer,
    softwareGraphics: !prefer && softwareGraphics(),
    webkit: isWebKitEngine(typeof navigator === 'undefined' ? '' : navigator.userAgent),
  });
  const speeds: Partial<Record<BackendName, number>> = {};
  let best: { name: BackendName; model: GraphModel; speed: number; frames: Float32Array } | undefined;
  for (const name of candidates) {
    try {
      if (!(await tf.setBackend(name))) continue;
      await tf.ready();
      const model = await loadGraphModel(tf.io.fromMemory(artifacts));
      const warming = performance.now();
      await runModel(model, probe.subarray(0, 22050), { batch: 1 }); // warm up (shader compiling and the like)
      // A graphics card that needs this long for one second of audio will not
      // win, and the speed test would only cost as much again.
      if (best && performance.now() - warming > SLOW_WARM_UP_MS) {
        console.warn(`The ${name} backend was too slow to warm up here.`);
        model.dispose();
        continue;
      }
      const started = performance.now();
      const out = await runModel(model, probe, { batch: 2 });
      const speed = TEST_SECONDS / ((performance.now() - started) / 1000);
      speeds[name] = speed;
      const sane = out.frames.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
      // A graphics card with low precision can give noticeably different answers; trust it only if it agrees.
      const agrees = !best || maxDiff(best.frames, out.frames) < 0.1;
      if (sane && agrees && (!best || speed > best.speed)) {
        best?.model.dispose();
        best = { name, model, speed, frames: out.frames };
      } else {
        model.dispose();
      }
      // Plain JavaScript is only a last resort; no need to race it.
      if (best && name === 'wasm') break;
    } catch (error) {
      console.warn(`The ${name} backend did not work here.`, error);
    }
  }
  if (!best) throw new Error('No way to run the note model in this browser.');
  await tf.setBackend(best.name);
  return { model: best.model, backend: best.name, speeds };
}

/**
 * True when WebGL is missing or drawn by the processor instead of a graphics
 * card (SwiftShader, llvmpipe and the like). Works in a worker too.
 */
export function softwareGraphics(): boolean {
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement | null =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!canvas) return false;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null;
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

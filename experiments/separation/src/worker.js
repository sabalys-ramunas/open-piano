// Separation worker (module worker). One worker per run: onnxruntime-web
// fixes its thread count when the first session is created, and terminating
// the worker is the only reliable way to free the WASM heap afterwards.
//
// in:  { type: 'run', model, ep: 'wasm' | 'webgpu', threads, left, right, modelBase }
//      { type: 'cancel' }
// out: { type: 'stage', stage, detail } | { type: 'progress', fraction }
//      { type: 'done', stems: { name: [left, right] }, timings, info } | { type: 'error', message }
import * as ort from '../node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs';
import { MODELS, separate } from './separate.js';

ort.env.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
const controller = new AbortController();
const post = (m, transfer) => self.postMessage(m, transfer ?? []);

async function download(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed: ${res.status} ${url}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const buf = total ? new Uint8Array(total) : null;
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (buf) buf.set(value, got); else parts.push(value);
    got += value.length;
    onBytes(got, total);
  }
  if (buf) return buf;
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'cancel') { controller.abort(); return; }
  if (msg.type !== 'run') return;
  const spec = MODELS[msg.model];
  const timings = {};
  const info = {
    crossOriginIsolated: self.crossOriginIsolated === true,
    hardwareConcurrency: navigator.hardwareConcurrency,
    webgpuAvailable: 'gpu' in navigator,
  };
  try {
    let t = performance.now();
    const files = [];
    let bytes = 0;
    for (const f of spec.files) {
      post({ type: 'stage', stage: 'download', detail: f });
      const data = await download(`${msg.modelBase}${f}`, (got, total) => post({ type: 'download', file: f, got, total }));
      bytes += data.length;
      files.push(data);
    }
    timings.downloadMs = performance.now() - t;
    info.modelBytes = bytes;

    t = performance.now();
    post({ type: 'stage', stage: 'load' });
    ort.env.wasm.numThreads = msg.threads ?? 0; // 0 = let ORT pick (needs crossOriginIsolated for > 1)
    if (msg.ep === 'webgpu') {
      if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser.');
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('WebGPU: no adapter.');
      info.gpuAdapter = adapter.info ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim() : 'unknown';
    }
    const sessions = [];
    for (const data of files) {
      sessions.push(await ort.InferenceSession.create(data, {
        executionProviders: [msg.ep],
        graphOptimizationLevel: 'all',
        // lowMem: no memory-pattern planning and no CPU arena (about 1 GB less peak for HT-Demucs in Node)
        ...(msg.lowMem ? { enableMemPattern: false, enableCpuMemArena: false } : {}),
      }));
    }
    files.length = 0;
    timings.sessionMs = performance.now() - t;
    info.numThreads = ort.env.wasm.numThreads;

    t = performance.now();
    post({ type: 'stage', stage: 'separate' });
    const stats = {};
    const stems = await separate(ort, sessions, msg.left, msg.right, {
      model: msg.model,
      stats,
      signal: controller.signal,
      onProgress: (fraction) => post({ type: 'progress', fraction }),
    });
    timings.separateMs = performance.now() - t;
    timings.inferenceMs = stats.runMs;
    for (const s of sessions) await s.release?.();

    const out = {};
    const transfer = [];
    for (const [name, { left, right }] of Object.entries(stems)) {
      out[name] = [left, right];
      transfer.push(left.buffer, right.buffer);
    }
    post({ type: 'done', stems: out, timings, info }, transfer);
  } catch (error) {
    post({ type: 'error', message: error?.name === 'Cancelled' ? 'Cancelled' : String(error?.message ?? error), timings, info });
  }
};

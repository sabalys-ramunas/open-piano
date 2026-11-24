// Runs the same separation code under onnxruntime-node (CPU), as a correctness
// check of the JS pre/post-processing and a native-speed reference point.
//   node node-check.mjs <model> <seconds> [threads]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ort from 'onnxruntime-node';
import { MODELS, separate } from './src/separate.js';
import { interleave } from './src/metrics.js';

const [model, seconds, threads = '4'] = process.argv.slice(2);
const wav = readFileSync(`testdata/mix_${seconds}.wav`);
const n = (wav.length - 44) / 4;
const left = new Float32Array(n), right = new Float32Array(n);
for (let i = 0; i < n; i++) { left[i] = wav.readInt16LE(44 + 4 * i) / 32768; right[i] = wav.readInt16LE(46 + 4 * i) / 32768; }
const t0 = performance.now();
const sessions = [];
for (const f of MODELS[model].files) sessions.push(await ort.InferenceSession.create(`models/${f}`, { intraOpNumThreads: +threads }));
const t1 = performance.now();
const stems = await separate(ort, sessions, left, right, { model, onProgress: (f) => process.stdout.write(`\r${(100 * f).toFixed(0)}%  `) });
const t2 = performance.now();
console.log(`\n${model} ${seconds}s: load ${((t1 - t0) / 1000).toFixed(1)} s, separate ${((t2 - t1) / 1000).toFixed(1)} s, peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
const dir = `results/audio/node_${model}_${seconds}`;
mkdirSync(dir, { recursive: true });
for (const [s, { left: l, right: r }] of Object.entries(stems)) writeFileSync(`${dir}/${s}.f32`, Buffer.from(interleave(l, r).buffer));
console.log('wrote', dir);

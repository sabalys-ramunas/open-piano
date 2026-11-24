// Scores separated stems against the synthetic ground truth.
//   node evaluate.mjs <estimatesDir> <seconds> [--json out.json]
// <estimatesDir> holds <stem>.f32 files (interleaved stereo float32).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { energy, leakage, sdrGlobal, sdrMedian } from './src/metrics.js';

const [dir, seconds] = process.argv.slice(2);
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const f32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const truth = Object.fromEntries(['vocals', 'drums', 'bass', 'guitar', 'keys', 'other', 'mix'].map((s) => [s, f32(`testdata/${s}_${seconds}.f32`)]));
const basis = { vocals: truth.vocals, drums: truth.drums, bass: truth.bass, guitar: truth.guitar, keys: truth.keys };
const TARGET = { vocals: 'vocals', drums: 'drums', bass: 'bass', other: 'other', guitar: 'guitar', piano: 'keys' };

const est = {};
for (const s of ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']) if (existsSync(join(dir, `${s}.f32`))) est[s] = f32(join(dir, `${s}.f32`));
const rows = [];
for (const [s, e] of Object.entries(est)) {
  let ref = truth[TARGET[s]];
  // In the 6-stem model "other" should be what is left after guitar and piano: here nothing.
  if (s === 'other' && est.guitar) ref = new Float32Array(ref.length);
  const lk = leakage(e, basis);
  rows.push({ stem: s, target: s === 'other' && est.guitar ? '(silence)' : TARGET[s], sdr: +sdrGlobal(ref, e).toFixed(2), sdrMedian: +sdrMedian(ref, e).toFixed(2),
    shareOfEnergy: Object.fromEntries(Object.entries(lk).map(([k, v]) => [k, +(100 * v).toFixed(1)])), energyDbVsTruth: +(10 * Math.log10((energy(e) + 1e-12) / (energy(ref) + 1e-12))).toFixed(1) });
}
// Harmonic layer as one stem (what the app would turn down): other (+ guitar + piano)
if (est.other) {
  const h = Float32Array.from(est.other);
  for (const s of ['guitar', 'piano']) if (est[s]) for (let i = 0; i < h.length; i++) h[i] += est[s][i];
  rows.push({ stem: 'harmonic (other+guitar+piano)', target: 'guitar+keys', sdr: +sdrGlobal(truth.other, h).toFixed(2), sdrMedian: +sdrMedian(truth.other, h).toFixed(2), shareOfEnergy: Object.fromEntries(Object.entries(leakage(h, basis)).map(([k, v]) => [k, +(100 * v).toFixed(1)])) });
  // Backing = mix - harmonic estimate, versus the true backing (vocals+drums+bass)
  const trueBacking = new Float32Array(h.length), estBacking = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) { trueBacking[i] = truth.vocals[i] + truth.drums[i] + truth.bass[i]; estBacking[i] = truth.mix[i] - h[i]; }
  rows.push({ stem: 'backing = mix - harmonic', target: 'vocals+drums+bass', sdr: +sdrGlobal(trueBacking, estBacking).toFixed(2), sdrMedian: +sdrMedian(trueBacking, estBacking).toFixed(2), shareOfEnergy: Object.fromEntries(Object.entries(leakage(estBacking, basis)).map(([k, v]) => [k, +(100 * v).toFixed(1)])) });
}
// Sum check
const sum = new Float32Array(truth.mix.length);
for (const e of Object.values(est)) for (let i = 0; i < sum.length; i++) sum[i] += e[i];
const recon = sdrGlobal(truth.mix, sum);
for (const r of rows) console.log(r.stem.padEnd(30), 'SDR', String(r.sdr).padStart(6), 'dB  median', String(r.sdrMedian).padStart(6), ' energy share %', JSON.stringify(r.shareOfEnergy));
console.log('sum of stems vs mix: SDR', recon.toFixed(1), 'dB');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ dir, seconds, rows, reconstructionSdr: +recon.toFixed(2) }, null, 2));

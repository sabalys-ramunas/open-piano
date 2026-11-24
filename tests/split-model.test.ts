// The real splitter networks under Node. Skipped when the model files are not
// in public/models/spleeter-4stems/ (they are not in git: see docs/architecture.md).
// With the prototype's test song (experiments/separation/testdata, made by its
// synth-testmix.mjs) the backing is scored against the true stems and must
// match what the prototype measured (14.35 dB).
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SPLITTER_FILES } from '../src/split/model-files';
import { createRunner } from '../src/split/runner';
import { STEMS, lowLength, splitStereo } from '../src/split/spleeter';

const dir = 'public/models/spleeter-4stems/';
const haveModel = SPLITTER_FILES.every((f) => existsSync(dir + f.file));
const testdata = 'experiments/separation/testdata/';
const haveSong = ['mix', 'vocals', 'drums', 'bass'].every((s) => existsSync(`${testdata}${s}_30.f32`));

const f32 = (path: string) => {
  const b = readFileSync(path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const planar = (interleaved: Float32Array) => {
  const n = interleaved.length / 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = interleaved[2 * i];
    right[i] = interleaved[2 * i + 1];
  }
  return { left, right };
};
const sdr = (ref: ArrayLike<number>, est: ArrayLike<number>) => {
  let num = 0;
  let den = 0;
  for (let i = 0; i < ref.length; i++) {
    const d = ref[i] - est[i];
    num += ref[i] * ref[i];
    den += d * d;
  }
  return 10 * Math.log10((num + 1e-12) / (den + 1e-12));
};

it.skipIf(!haveModel || !haveSong)('splits the prototype test song as well as the prototype did', { timeout: 300_000 }, async () => {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const files = STEMS.map((stem) => new Uint8Array(readFileSync(dir + SPLITTER_FILES.find((f) => f.stem === stem)!.file)));
  const runner = await createRunner(ort, files, 'wasm');
  const mix = planar(f32(`${testdata}mix_30.f32`));
  const n = mix.left.length;
  const back = { left: new Float32Array(n), right: new Float32Array(n), at: 0 };
  const low = { vocals: new Float32Array(lowLength(n)), other: new Float32Array(lowLength(n)), bass: new Float32Array(lowLength(n)), at: 0 };
  const stats = { modelMs: 0, dspMs: 0, blocks: 0 };
  const started = performance.now();
  await splitStereo(
    mix.left,
    mix.right,
    runner.model,
    {
      backing(l, r) {
        back.left.set(l, back.at);
        back.right.set(r, back.at);
        back.at += l.length;
      },
      stems(v, o, b) {
        low.vocals.set(v, low.at);
        low.other.set(o, low.at);
        low.bass.set(b, low.at);
        low.at += v.length;
      },
    },
    { stats },
  );
  const ms = performance.now() - started;
  await runner.release();

  const truth = Object.fromEntries(['vocals', 'drums', 'bass'].map((s) => [s, planar(f32(`${testdata}${s}_30.f32`))]));
  const trueBacking = new Float32Array(2 * n);
  const estBacking = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    trueBacking[2 * i] = truth.vocals.left[i] + truth.drums.left[i] + truth.bass.left[i];
    trueBacking[2 * i + 1] = truth.vocals.right[i] + truth.drums.right[i] + truth.bass.right[i];
    estBacking[2 * i] = back.left[i];
    estBacking[2 * i + 1] = back.right[i];
  }
  const backingSdr = sdr(trueBacking, estBacking);
  // Vocals at 22 kHz against the true vocals, mono and decimated.
  const trueVocals = Float32Array.from({ length: lowLength(n) }, (_, m) => (truth.vocals.left[2 * m] + truth.vocals.right[2 * m]) / 2);
  const vocalsSdr = sdr(trueVocals, low.vocals);
  console.log(
    `split 30 s in ${(ms / 1000).toFixed(1)} s (networks ${(stats.modelMs / 1000).toFixed(1)} s, our maths ${(stats.dspMs / 1000).toFixed(1)} s = ` +
      `${Math.round((100 * stats.dspMs) / (stats.modelMs + stats.dspMs))}%); backing SDR ${backingSdr.toFixed(2)} dB, vocals (22 kHz mono) ${vocalsSdr.toFixed(2)} dB`,
  );
  // The prototype measured 14.35 dB for the backing and 10.02 dB for the (stereo, full-rate) vocals.
  expect(backingSdr).toBeGreaterThan(14.2);
  expect(backingSdr).toBeLessThan(14.5);
  expect(vocalsSdr).toBeGreaterThan(9.5);
});

// Does listening to split stems give better lessons than listening to the whole
// recording? Measured on the synthetic band songs with a known score
// (tests/band.ts) and, when present, the separation prototype's test song with
// its true stems (experiments/separation/testdata). Skipped unless BENCH is set.
//
//   BENCH=1 npx vitest run --dir scripts stems-bench
//
// Needs the splitter networks in public/models/spleeter-4stems/. What the note
// model heard is cached in BENCH_CACHE (default: the system temp folder).
// BENCH_JSON=file writes every number as JSON; BENCH_LOG=file the printed table.
//
// Variants (chords from / melody from / accompaniment notes from):
//   mix        today: whole recording / its centre (stereo) / whole recording
//   voc        whole recording / vocal stem / whole recording
//   stems      harmony stem (other + bass) / vocal stem / harmony stem
//   harm       harmony stem / centre of the recording / harmony stem
//   oracle     the true stems instead of the split ones (prototype song only)
//
// Nothing is played; synthetic material is not a real band recording.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import type { Analysis } from '../src/analysis';
import { arrange } from '../src/import/arrange';
import { extractMelody } from '../src/import/melody';
import { type Activations, KEYS, runModel } from '../src/import/model';
import { decodeNotes } from '../src/import/notes';
import { analyseHeard, listenToSong } from '../src/import/pipeline';
import type { Level, RawNote } from '../src/song';
import { SPLITTER_FILES } from '../src/split/model-files';
import { createRunner } from '../src/split/runner';
import { STEMS, lowLength, splitStereo } from '../src/split/spleeter';
import { BAND_RATE, BAND_SONGS, renderBand } from '../tests/band';
import { chordAccuracy, measure, melodyOf, melodyScore, type ChordTruth } from '../tests/arrange-metrics';
import { loadModel } from '../tests/helpers';

const MODEL_DIR = 'public/models/spleeter-4stems/';
const haveSplitter = SPLITTER_FILES.every((f) => existsSync(MODEL_DIR + f.file));
const cacheDir = process.env.BENCH_CACHE ?? join(tmpdir(), 'piano-stems-bench');

const lines: string[] = [];
const log = (line: string) => {
  lines.push(line);
  console.log(line);
};
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** 2x upsampling with a windowed-sinc half-band filter (the band songs are made at 22.05 kHz). */
function upsample2(x: Float32Array): Float32Array {
  const taps = 32;
  const kernel = new Float64Array(2 * taps);
  for (let j = -taps; j < taps; j++) {
    const t = j + 0.5;
    const w = 0.42 + 0.5 * Math.cos((Math.PI * t) / taps) + 0.08 * Math.cos((2 * Math.PI * t) / taps);
    kernel[j + taps] = (Math.sin(Math.PI * t) / (Math.PI * t)) * w;
  }
  const out = new Float32Array(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    out[2 * i] = x[i];
    let s = 0;
    for (let j = -taps; j < taps; j++) {
      const k = i + j + 1;
      if (k >= 0 && k < x.length) s += x[k] * kernel[taps - 1 - j];
    }
    out[2 * i + 1] = s;
  }
  return out;
}

let splitter: Awaited<ReturnType<typeof createRunner>> | undefined;
async function split(left: Float32Array, right: Float32Array) {
  if (!splitter) {
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    splitter = await createRunner(ort, STEMS.map((s) => new Uint8Array(readFileSync(MODEL_DIR + SPLITTER_FILES.find((f) => f.stem === s)!.file))), 'wasm');
  }
  const n = left.length;
  const out = { vocals: new Float32Array(lowLength(n)), other: new Float32Array(lowLength(n)), bass: new Float32Array(lowLength(n)) };
  let at = 0;
  await splitStereo(left, right, splitter.model, {
    stems(v, o, b) {
      out.vocals.set(v, at);
      out.other.set(o, at);
      out.bass.set(b, at);
      at += v.length;
    },
  });
  return out;
}

const add = (a: Float32Array, b: Float32Array) => Float32Array.from(a, (x, i) => x + b[i]);

/** Model activations, cached on disk by name. */
async function activations(name: string, audio: () => Promise<Float32Array> | Float32Array): Promise<Activations> {
  mkdirSync(cacheDir, { recursive: true });
  const base = join(cacheDir, name);
  if (existsSync(`${base}.frames`) && existsSync(`${base}.onsets`) && existsSync(`${base}.pitch`)) {
    const read = (p: string) => {
      const b = readFileSync(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    const frames = new Float32Array(read(`${base}.frames`));
    return { frameCount: frames.length / KEYS, frames, onsets: new Float32Array(read(`${base}.onsets`)), pitch: new Uint8Array(read(`${base}.pitch`)) };
  }
  const act = await runModel(await loadModel(), await audio(), { batch: 2 });
  saveActivations(base, act);
  return act;
}

const bytesOf = (a: Float32Array | Uint8Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
function saveActivations(base: string, act: Activations): void {
  writeFileSync(`${base}.frames`, bytesOf(act.frames));
  writeFileSync(`${base}.onsets`, bytesOf(act.onsets));
  writeFileSync(`${base}.pitch`, bytesOf(act.pitch));
}

/** What today's pipeline hears (cached: raw notes with the tune, and the whole-recording activations). */
async function heardToday(name: string, left: Float32Array, right: Float32Array): Promise<{ raw: RawNote[]; act: Activations }> {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${name}.today.json`);
  if (existsSync(file)) {
    const act = await activations(`${name}.mix`, () => Float32Array.from(left, (x, i) => (x + right[i]) / 2));
    return { raw: JSON.parse(readFileSync(file, 'utf8')) as RawNote[], act };
  }
  const heard = await listenToSong(await loadModel(), { left, right }, { keepActivations: true });
  writeFileSync(file, JSON.stringify(heard.raw));
  const act = heard.activations!;
  saveActivations(join(cacheDir, `${name}.mix`), act);
  return { raw: heard.raw, act };
}

interface Inputs {
  today: { raw: RawNote[]; act: Activations };
  vocals: Activations;
  harmony: Activations;
}

interface Variant {
  name: string;
  build(i: Inputs): { raw: RawNote[]; act: Activations };
}

const tuneOf = (act: Activations) => extractMelody(act).map((n): RawNote => ({ ...n, part: 'melody' }));
const byStart = (a: RawNote[]) => a.sort((x, y) => x.start - y.start);

const VARIANTS: Variant[] = [
  { name: 'mix', build: (i) => i.today },
  { name: 'voc', build: (i) => ({ raw: byStart([...i.today.raw.filter((n) => n.part !== 'melody'), ...tuneOf(i.vocals)]), act: i.today.act }) },
  { name: 'stems', build: (i) => ({ raw: byStart([...decodeNotes(i.harmony), ...tuneOf(i.vocals)]), act: i.harmony }) },
  { name: 'harm', build: (i) => ({ raw: byStart([...decodeNotes(i.harmony), ...i.today.raw.filter((n) => n.part === 'melody')]), act: i.harmony }) },
];

const LEVELS: Level[] = ['melody', 'melody-bass', 'melody-chords', 'full'];
const totals = new Map<string, Record<string, number[]>>();
const addTotal = (key: string, metric: string, value: number) => {
  const t = totals.get(key) ?? {};
  (t[metric] ??= []).push(value);
  totals.set(key, t);
};

function score(
  song: string,
  variant: string,
  built: { raw: RawNote[]; act: Activations },
  mono: Float32Array,
  rate: number,
  truth: { chords: ChordTruth[]; beats: number[]; beatSeconds: number; melody?: { midi: number; start: number }[] },
) {
  const a: Analysis = analyseHeard(built.raw, { sampleRate: rate, length: mono.length, numberOfChannels: 1, getChannelData: () => mono }, built.act);
  const acc = chordAccuracy(truth.chords, a.chords ?? [], truth.beats);
  const ctx = { beats: a.beats, chords: a.chords, beatsPerBar: a.timeSignature?.beats };
  const parts: string[] = [];
  const row: Record<string, unknown> = { song, variant, chords: acc };
  addTotal(variant, 'root', acc.root);
  addTotal(variant, 'majmin', acc.majmin);
  addTotal(variant, 'wrong', acc.wrong);
  addTotal(variant, 'bass', acc.bass);
  for (const level of LEVELS) {
    const notes = arrange(built.raw, level, ctx);
    const m = measure(notes, truth.chords, truth.beatSeconds);
    const entry: Record<string, number> = { notes: notes.length, nonChord: m.nonChordTone };
    if (truth.melody) {
      const ms = melodyScore(truth.melody, melodyOf(notes));
      entry.recall = ms.recall;
      entry.precision = ms.precision;
      if (level === 'melody') {
        addTotal(variant, 'tuneRecall', ms.recall);
        addTotal(variant, 'tunePrecision', ms.precision);
      }
    }
    if (level !== 'melody') addTotal(variant, `nonChord:${level}`, m.nonChordTone);
    row[level] = entry;
    parts.push(`${level} non-chord ${pct(m.nonChordTone)}${entry.recall !== undefined ? ` tune R ${pct(entry.recall)} P ${pct(entry.precision)}` : ''}`);
  }
  log(`[${variant.padEnd(6)}] ${song}: chords root ${pct(acc.root)} maj/min ${pct(acc.majmin)} wrong ${pct(acc.wrong)} bass ${pct(acc.bass)} | ${parts.join(' | ')}`);
  return row;
}

it.skipIf(!process.env.BENCH || !haveSplitter)('compares lessons made with and without split stems', { timeout: 3_600_000 }, async () => {
  const rows: Record<string, unknown>[] = [];
  const only = process.env.BENCH_SONGS?.split(',');
  for (const song of BAND_SONGS.filter((s) => !only || only.includes(s.name))) {
    const mix = renderBand(song);
    let stems: Awaited<ReturnType<typeof split>> | undefined;
    const getStems = async () => (stems ??= await split(upsample2(mix.left), upsample2(mix.right)));
    const inputs: Inputs = {
      today: await heardToday(song.name, mix.left, mix.right),
      vocals: await activations(`${song.name}.vocals`, async () => (await getStems()).vocals),
      harmony: await activations(`${song.name}.harmony`, async () => {
        const s = await getStems();
        return add(s.other, s.bass);
      }),
    };
    const truth = { chords: mix.chords, beats: mix.beats, beatSeconds: 60 / song.bpm, melody: mix.melody };
    for (const v of VARIANTS) rows.push(score(song.name, v.name, v.build(inputs), mix.mono, BAND_RATE, truth));
  }

  // The prototype's test song: real piano samples, a plucked guitar, speech for vocals (no tune to score).
  const td = 'experiments/separation/testdata/';
  if (!only && ['mix', 'vocals', 'bass', 'guitar', 'keys'].every((s) => existsSync(`${td}${s}_30.f32`))) {
    const f32 = (s: string) => {
      const b = readFileSync(`${td}${s}_30.f32`);
      const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      const left = new Float32Array(x.length / 2);
      const right = new Float32Array(x.length / 2);
      for (let i = 0; i < left.length; i++) {
        left[i] = x[2 * i];
        right[i] = x[2 * i + 1];
      }
      return { left, right };
    };
    const down = (s: { left: Float32Array; right: Float32Array }) => Float32Array.from({ length: lowLength(s.left.length) }, (_, m) => (s.left[2 * m] + s.right[2 * m]) / 2);
    const mix = f32('mix');
    // Score at 22.05 kHz like the app: simple 2:1 with a short low-pass (content is mostly below 8 kHz).
    const lp = (x: Float32Array) => Float32Array.from(x, (v, i) => 0.25 * (x[i - 1] ?? v) + 0.5 * v + 0.25 * (x[i + 1] ?? v));
    const lpLeft = lp(mix.left);
    const lpRight = lp(mix.right);
    const mixLow = { left: Float32Array.from({ length: lowLength(mix.left.length) }, (_, m) => lpLeft[2 * m]), right: Float32Array.from({ length: lowLength(mix.left.length) }, (_, m) => lpRight[2 * m]) };
    const bpm = 100;
    const spb = 60 / bpm;
    const names = [
      ['C', 0, [0, 4, 7]],
      ['G', 7, [7, 11, 2]],
      ['Am', 9, [9, 0, 4]],
      ['F', 5, [5, 9, 0]],
    ] as const;
    const chords: ChordTruth[] = [];
    for (let b = 0; b * 4 * spb < 30; b++) {
      const [label, root, tones] = names[b % 4];
      chords.push({ start: b * 4 * spb, dur: 4 * spb, label, root, bass: root, third: label === 'Am' ? 'min' : 'maj', tones: [...tones] });
    }
    const beats = Array.from({ length: Math.floor(30 / spb) }, (_, i) => i * spb);
    const truth = { chords, beats, beatSeconds: spb };
    let stems: Awaited<ReturnType<typeof split>> | undefined;
    const getStems = async () => (stems ??= await split(mix.left, mix.right));
    const inputs: Inputs = {
      today: await heardToday('proto30', mixLow.left, mixLow.right),
      vocals: await activations('proto30.vocals', async () => (await getStems()).vocals),
      harmony: await activations('proto30.harmony', async () => {
        const s = await getStems();
        return add(s.other, s.bass);
      }),
    };
    const monoLow = Float32Array.from(mixLow.left, (x, i) => (x + mixLow.right[i]) / 2);
    for (const v of VARIANTS) rows.push(score('proto30', v.name, v.build(inputs), monoLow, 22050, truth));
    // The true stems: how good it could get with a perfect splitter.
    const trueHarmony = add(add(down(f32('guitar')), down(f32('keys'))), down(f32('bass')));
    const oracle: Inputs = { ...inputs, vocals: await activations('proto30.true-vocals', () => down(f32('vocals'))), harmony: await activations('proto30.true-harmony', () => trueHarmony) };
    rows.push(score('proto30', 'oracle', VARIANTS[2].build(oracle), monoLow, 22050, truth));
  }

  log('\nAverages over the band songs and the prototype song (where measured):');
  for (const [k, t] of totals) {
    log(`${k.padEnd(7)} ${Object.entries(t).map(([m, xs]) => `${m} ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)}`).join(', ')}`);
  }
  if (process.env.BENCH_LOG) writeFileSync(process.env.BENCH_LOG, lines.join('\n') + '\n');
  if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify({ rows, totals: Object.fromEntries(totals) }, null, 1));
  await splitter?.release();
});

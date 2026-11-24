// Measures chord detection and the piano arrangements on synthetic band
// recordings with a known score (tests/band.ts). Skipped unless BENCH is set.
//
//   BENCH=1 npx vitest run --dir scripts arrange-bench
//
// Optional:
//   BENCH_CACHE=dir   where to keep what the note model heard (default: the system temp folder);
//                     the model is the slow part, so later runs reuse it
//   LEGACY=dir        a folder with an older arrange.ts and analysis.ts to compare against
//   WAV_OUT=dir       also render every level of the first song (and the legacy version) to WAV files
//   BENCH_SONGS=a,b   only these songs
//   NOTES_ONLY=1      find chords from the notes alone (as when an older song is re-arranged)
//   BENCH_JSON=file   write all numbers as JSON
//   BENCH_LOG=file    write the printed table to a file too
//
// Nothing is played out loud; WAV files are only written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import type { Analysis } from '../src/analysis';
import { analyseHeard, listenToSong } from '../src/import/pipeline';
import { arrange as arrangeNow } from '../src/import/arrange';
import { type Activations, KEYS } from '../src/import/model';
import type { Level, Note, RawNote, TimedChord } from '../src/song';
import { BAND_RATE, BAND_SONGS, renderBand, type BandMix } from '../tests/band';
import { chordAccuracy, flicker, measure, melodyClashes, melodyOf, melodyScore } from '../tests/arrange-metrics';
import { loadModel } from '../tests/helpers';
import { wavBytes, writePianoWav } from './piano-wav';

const LEVELS: Level[] = ['melody', 'melody-bass', 'melody-chords', 'full'];

interface Variant {
  name: string;
  analyse(heard: Heard, mix: BandMix): Analysis;
  arrange(raw: RawNote[], level: Level, a: Analysis): Note[];
}

const audioOf = (mono: Float32Array) => ({ sampleRate: BAND_RATE, length: mono.length, numberOfChannels: 1, getChannelData: () => mono });
const ctxOf = (a: Analysis) => ({ beats: a.beats, chords: a.chords, beatsPerBar: a.timeSignature?.beats, key: a.key });

async function variants(): Promise<Variant[]> {
  const out: Variant[] = [];
  if (process.env.LEGACY) {
    const la = (await import(/* @vite-ignore */ join(process.env.LEGACY, 'analysis.ts'))) as typeof import('../src/analysis');
    const lr = (await import(/* @vite-ignore */ join(process.env.LEGACY, 'arrange.ts'))) as typeof import('../src/import/arrange');
    out.push({
      name: 'before',
      analyse: (heard, mix) => la.analyseSync(heard.raw.filter((n) => n.part !== 'melody'), audioOf(mix.mono)),
      arrange: (raw, level, a) => lr.arrange(raw, level, ctxOf(a)),
    });
  }
  out.push({
    name: 'after',
    analyse: (heard, mix) => analyseHeard(heard.raw, audioOf(mix.mono), process.env.NOTES_ONLY ? undefined : heard.activations),
    arrange: (raw, level, a) => arrangeNow(raw, level, ctxOf(a)),
  });
  return out;
}

interface Heard {
  raw: RawNote[];
  activations: Activations;
}

async function heardFor(name: string, mix: BandMix): Promise<Heard> {
  const dir = process.env.BENCH_CACHE ?? join(tmpdir(), 'piano-arrange-bench');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  const frames = join(dir, `${name}.frames.f32`);
  if (existsSync(file) && existsSync(frames)) {
    const bytes = readFileSync(frames);
    const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const activations: Activations = { frameCount: f.length / KEYS, frames: f, onsets: new Float32Array(0), pitch: new Uint8Array(0) };
    return { raw: JSON.parse(readFileSync(file, 'utf8')) as RawNote[], activations };
  }
  const heard = await listenToSong(await loadModel(), { left: mix.left, right: mix.right }, { keepActivations: true });
  writeFileSync(file, JSON.stringify(heard.raw));
  writeFileSync(frames, new Uint8Array(heard.activations!.frames.buffer.slice(0)));
  return { raw: heard.raw, activations: heard.activations! };
}

const lines: string[] = [];
function log(line: string) {
  lines.push(line);
  console.log(line);
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const f1 = (x: number) => x.toFixed(1);

it.skipIf(!process.env.BENCH)('measures chords and arrangements on synthetic band songs', { timeout: 3_600_000 }, async () => {
  const only = process.env.BENCH_SONGS?.split(',');
  const songs = BAND_SONGS.filter((s) => !only || only.includes(s.name));
  const vs = await variants();
  const results: Record<string, unknown>[] = [];
  const totals = new Map<string, Record<string, number[]>>();
  const add = (key: string, metric: string, value: number) => {
    const t = totals.get(key) ?? {};
    (t[metric] ??= []).push(value);
    totals.set(key, t);
  };
  for (const song of songs) {
    const mix = renderBand(song);
    const heard = await heardFor(song.name, mix);
    if (process.env.WAV_OUT && song === songs[0]) {
      mkdirSync(process.env.WAV_OUT, { recursive: true });
      writeFileSync(join(process.env.WAV_OUT, `${song.name}-recording.wav`), wavBytes(mix.mono, BAND_RATE));
    }
    const raw = heard.raw;
    const beatSeconds = 60 / song.bpm;
    const bar = beatSeconds * song.beatsPerBar;
    const from = mix.chords[0].start;
    const to = mix.chords[mix.chords.length - 1].start + mix.chords[mix.chords.length - 1].dur;
    const trueFlicker = flicker(mix.chords, from, to, bar);
    const scaleAt = (t: number) => {
      const k = [...mix.keys].reverse().find((x) => x.start <= t + 1e-6) ?? mix.keys[0];
      return (k.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((x) => (x + k.tonic) % 12);
    };
    for (const v of vs) {
      const started = performance.now();
      const a = v.analyse(heard, mix);
      const analyseMs = performance.now() - started;
      const chords: TimedChord[] = a.chords ?? [];
      const acc = chordAccuracy(mix.chords, chords, mix.beats);
      const fl = flicker(chords, from, to, bar);
      log(
        `[${v.name}] ${song.name}: key ${a.key} bpm ${a.bpm}/${song.bpm} meter ${a.timeSignature?.beats}/${song.beatsPerBar}; chords root ${pct(acc.root)} ` +
          `maj/min ${pct(acc.majmin)} bass ${pct(acc.bass)} exact ${pct(acc.full)} wrong ${pct(acc.wrong)} power ${pct(acc.power)}; flicker ${fl.toFixed(2)}/bar (true ${trueFlicker.toFixed(2)}); ` +
          `analysis ${analyseMs.toFixed(0)} ms`,
      );
      if (process.env.BENCH_VERBOSE) {
        log('  truth ' + mix.chords.map((c) => `${c.label}@${c.start.toFixed(1)}`).join(' '));
        log('  found ' + chords.map((c) => `${c.label}@${c.start.toFixed(1)}${'confidence' in c ? `(${(c as { confidence: number }).confidence})` : ''}`).join(' '));
      }
      add(v.name, 'root', acc.root);
      add(v.name, 'majmin', acc.majmin);
      add(v.name, 'bass', acc.bass);
      add(v.name, 'exact', acc.full);
      add(v.name, 'wrong', acc.wrong);
      add(v.name, 'power', acc.power);
      add(v.name, 'flicker', fl);
      add(v.name, 'analyseMs', analyseMs);
      const row: Record<string, unknown> = { song: song.name, variant: v.name, chords: acc, flicker: fl, trueFlicker, key: a.key };
      for (const level of LEVELS) {
        const t0 = performance.now();
        const notes = v.arrange(raw, level, a);
        const arrangeMs = performance.now() - t0;
        const m = measure(notes, mix.chords, beatSeconds);
        const tune = melodyOf(notes);
        const ms = melodyScore(mix.melody, tune);
        const clashes = melodyClashes(tune, mix.chords, beatSeconds, scaleAt);
        row[level] = { ...m, melody: ms, clashes, arrangeMs };
        const k = `${v.name}:${level}`;
        add(k, 'rateR', m.rate.right);
        add(k, 'peakR', m.peak.right);
        add(k, 'rateL', m.rate.left);
        add(k, 'peakL', m.peak.left);
        add(k, 'spanL', m.span.left);
        add(k, 'reachL', m.reach.left);
        add(k, 'spanR', m.span.right);
        add(k, 'nct', m.nonChordTone);
        add(k, 'lil', m.lowIntervalViolations / (m.seconds / 60));
        add(k, 'lowClusters', m.lowClusters);
        add(k, 'vl', m.voiceLeading);
        add(k, 'jumps', m.bigJumps);
        add(k, 'cross', m.crossings);
        add(k, 'masked', m.masked);
        add(k, 'recall', ms.recall);
        add(k, 'precision', ms.precision);
        add(k, 'clashes', clashes);
        add(k, 'arrangeMs', arrangeMs);
        log(
          `  ${level.padEnd(13)} notes ${String(m.notes).padStart(4)}  notes/s R ${f1(m.rate.right)} L ${f1(m.rate.left)} (peak L ${m.peak.left})  ` +
            `span R ${m.span.right} L ${m.span.left} reach L ${m.reach.left}  non-chord ${pct(m.nonChordTone)}  LIL ${m.lowIntervalViolations} low-clusters ${m.lowClusters}  ` +
            `VL ${f1(m.voiceLeading)}  jumps ${m.bigJumps}  cross ${m.crossings}  masked ${m.masked}  tune R ${pct(ms.recall)} P ${pct(ms.precision)} clashes ${clashes}`,
        );
        if (process.env.WAV_OUT && song === songs[0]) {
          mkdirSync(process.env.WAV_OUT, { recursive: true });
          writePianoWav(join(process.env.WAV_OUT, `${song.name}-${level}-${v.name}.wav`), notes);
        }
      }
      results.push(row);
    }
  }
  log('\nAverages over songs:');
  for (const [k, t] of totals) {
    log(`${k}: ${Object.entries(t).map(([m, xs]) => `${m} ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}`).join(', ')}`);
  }
  if (process.env.BENCH_LOG) writeFileSync(process.env.BENCH_LOG, lines.join('\n') + '\n');
  if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify({ results, totals: Object.fromEntries(totals) }, null, 1));
});

// How much time analysis and arranging take on a three-minute song (a band song repeated).
it.skipIf(!process.env.BENCH)('times analysis and arranging on a three-minute song', { timeout: 600_000 }, async () => {
  const song = BAND_SONGS.find((s) => s.name === 'dense-pop-a')!;
  const mix = renderBand(song);
  const heard = await heardFor(song.name, mix);
  const copies = Math.ceil(180 / mix.length);
  const seconds = mix.length * copies;
  const mono = new Float32Array(Math.round(seconds * BAND_RATE));
  for (let k = 0; k < copies; k++) mono.set(mix.mono.subarray(0, Math.min(mix.mono.length, mono.length - k * mix.mono.length)), k * mix.mono.length);
  const raw: RawNote[] = [];
  for (let k = 0; k < copies; k++) for (const n of heard.raw) raw.push({ ...n, start: n.start + k * (mix.mono.length / BAND_RATE) });
  // Frames repeat at the model's frame rate; close enough for timing.
  const frames = new Float32Array(heard.activations.frames.length * copies);
  for (let k = 0; k < copies; k++) frames.set(heard.activations.frames, k * heard.activations.frames.length);
  const activations: Activations = { frameCount: heard.activations.frameCount * copies, frames, onsets: new Float32Array(0), pitch: new Uint8Array(0) };
  const time = (f: () => unknown) => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  };
  const vs = await variants();
  for (const v of vs) {
    let a: Analysis = {};
    const analyseMs = time(() => (a = v.name === 'after' ? analyseHeard(raw, audioOf(mono), activations) : v.analyse({ raw, activations }, { ...mix, mono })));
    const arrangeMs = LEVELS.map((level) => time(() => v.arrange(raw, level, a)));
    log(`[${v.name}] ${seconds.toFixed(0)} s song: analysis ${analyseMs.toFixed(0)} ms, arranging ${arrangeMs.map((ms, i) => `${LEVELS[i]} ${ms.toFixed(0)} ms`).join(', ')}`);
  }
  if (process.env.BENCH_LOG) writeFileSync(process.env.BENCH_LOG.replace(/(\.\w+)?$/, '-timing$1'), lines.join('\n') + '\n');
});

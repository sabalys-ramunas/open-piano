import { readFileSync } from 'node:fs';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-wasm';
import { type GraphModel, loadGraphModel } from '@tensorflow/tfjs-converter';
import { type Activations, runModel } from '../src/import/model';
import { decodeNotes } from '../src/import/notes';
import type { RawNote } from '../src/song';

let loaded: Promise<GraphModel> | undefined;

/** Loads the app's network from disk, on the WASM backend unless TF_BACKEND says otherwise (cpu). */
export function loadModel(): Promise<GraphModel> {
  loaded ??= (async () => {
    await tf.setBackend(process.env.TF_BACKEND ?? 'wasm');
    await tf.ready();
    const dir = 'public/model/';
    const json = JSON.parse(readFileSync(`${dir}model.json`, 'utf8'));
    const weights = readFileSync(`${dir}group1-shard1of1.bin`);
    return loadGraphModel(
      tf.io.fromMemory({
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest[0].weights,
        weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
      }),
    );
  })();
  return loaded;
}

/** Runs the network the app uses over mono 22050 Hz audio. */
export async function listen(audio: Float32Array): Promise<Activations> {
  return runModel(await loadModel(), audio, { batch: 2 });
}

/** Runs the same note model the app uses, loading it from disk instead of over the network. */
export async function hear(audio: Float32Array): Promise<RawNote[]> {
  return decodeNotes(await listen(audio));
}

/** Length of the longest run of notes two melodies share, in order. */
export function shared(a: readonly number[], b: readonly number[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = x === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = keep;
    }
  }
  return row[b.length];
}

/** Reads raw little-endian float32 samples, as written by `ffmpeg -f f32le`. */
export function readF32(path: string): Float32Array {
  const bytes = readFileSync(path);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

// ---------------------------------------------------------------------------
// Synthetic band mixes: a known tune sung by a voice-like tone over chords,
// bass and drums, so the vocal pipeline can be scored exactly.

export const RATE = 22050;

/** One note of a test tune, in beats. */
export interface TuneNote {
  midi: number;
  beat: number;
  beats: number;
}

export interface TuneChord {
  /** Chord root as a pitch class, 0 = C. */
  root: number;
  minor: boolean;
  beat: number;
  beats: number;
}

export interface Tune {
  name: string;
  bpm: number;
  beatsPerBar: number;
  /** Tonic pitch class and mode, for the key test. */
  key: { tonic: number; minor: boolean };
  melody: TuneNote[];
  chords: TuneChord[];
}

/** Parses "E4/1 D4/0.5 _/1" into notes, counting beats from `start`. */
export function tuneLine(line: string, start = 0): TuneNote[] {
  const out: TuneNote[] = [];
  let beat = start;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (const token of line.trim().split(/\s+/)) {
    const [pitch, len] = token.split('/');
    const beats = Number(len);
    if (pitch !== '_') {
      const m = /^([A-G]#?)(\d)$/.exec(pitch)!;
      out.push({ midi: names.indexOf(m[1]) + 12 * (Number(m[2]) + 1), beat, beats });
    }
    beat += beats;
  }
  return out;
}

/** Parses "C/4 Am/4 F/2 G/2" into chords. */
export function chordLine(line: string, start = 0): TuneChord[] {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const out: TuneChord[] = [];
  let beat = start;
  for (const token of line.trim().split(/\s+/)) {
    const [label, len] = token.split('/');
    const m = /^([A-G]#?)(m?)$/.exec(label)!;
    out.push({ root: names.indexOf(m[1]), minor: m[2] === 'm', beat, beats: Number(len) });
    beat += Number(len);
  }
  return out;
}

export const TUNES: Tune[] = [
  {
    name: 'ode-g',
    bpm: 110,
    beatsPerBar: 4,
    key: { tonic: 7, minor: false },
    melody: tuneLine(
      `B4/1 B4/1 C5/1 D5/1 D5/1 C5/1 B4/1 A4/1 G4/1 G4/1 A4/1 B4/1 B4/1.5 A4/0.5 A4/2
       B4/1 B4/1 C5/1 D5/1 D5/1 C5/1 B4/1 A4/1 G4/1 G4/1 A4/1 B4/1 A4/1.5 G4/0.5 G4/2`,
      4,
    ),
    chords: chordLine('G/4 G/4 D/4 G/4 D/4 G/4 D/4 G/4 D/2 G/2 G/4', 0),
  },
  {
    // An original minor-key pop line with repeated notes and leaps.
    name: 'pop-am',
    bpm: 96,
    beatsPerBar: 4,
    key: { tonic: 9, minor: true },
    melody: tuneLine(
      `A4/0.5 A4/0.5 A4/0.5 C5/0.5 E5/1 D5/1 C5/1 C5/0.5 B4/0.5 A4/1 _/1
       F4/0.5 A4/0.5 C5/0.5 D5/0.5 C5/1 A4/1 G4/1.5 E4/0.5 G4/1 _/1
       A4/0.5 A4/0.5 A4/0.5 C5/0.5 E5/1 G5/1 E5/1 D5/0.5 C5/0.5 D5/2
       F5/1 E5/1 D5/1 C5/1 B4/1 G4/1 A4/2`,
      4,
    ),
    chords: chordLine('Am/4 Am/4 F/4 G/4 Am/4 C/4 F/4 G/2 E/2 Am/4', 0),
  },
  {
    name: 'twinkle-d',
    bpm: 100,
    beatsPerBar: 4,
    key: { tonic: 2, minor: false },
    melody: tuneLine(
      `D4/1 D4/1 A4/1 A4/1 B4/1 B4/1 A4/2 G4/1 G4/1 F#4/1 F#4/1 E4/1 E4/1 D4/2
       A4/1 A4/1 G4/1 G4/1 F#4/1 F#4/1 E4/2 A4/1 A4/1 G4/1 G4/1 F#4/1 F#4/1 E4/2`,
      4,
    ),
    chords: chordLine('D/4 D/2 G/2 D/2 A/2 D/2 A/2 D/2 G/2 D/2 A/2 D/2 G/2 D/2 A/2 D/4', 0),
  },
  {
    // 3/4 waltz with a low male-range tune.
    name: 'waltz-f',
    bpm: 120,
    beatsPerBar: 3,
    key: { tonic: 5, minor: false },
    melody: tuneLine(
      `C4/1 F4/2 A3/1 C4/2 F4/1 G4/1 A4/1 G4/2 _/1
       E4/1 G4/2 C4/1 E4/2 G4/1 A4/1 A#4/1 A4/2 _/1
       A4/1 C5/2 A4/1 F4/2 D4/1 E4/1 F4/1 G4/2 E4/1 F4/3`,
      3,
    ),
    chords: chordLine('F/3 F/3 F/3 F/3 C/3 C/3 C/3 F/3 F/3 Dm/3 C/3 C/3 F/3', 0),
  },
];

function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Formant envelope of an "ah"-like vowel, gain for a harmonic at `f` Hz. */
function vowel(f: number, shift: number): number {
  const formants = [
    [730 * shift, 90, 1],
    [1090 * shift, 110, 0.5],
    [2440 * shift, 160, 0.25],
  ];
  let g = 0.02;
  for (const [c, bw, a] of formants) g += a / (1 + ((f - c) / bw) ** 2);
  return g;
}

export interface MixOptions {
  /** Voice level against the band, in dB. 0 means equally loud. */
  voiceDb?: number;
  /** Adds a sustained string pad, which competes with the voice. */
  pad?: boolean;
  drums?: boolean;
  seed?: number;
}

export interface Mix {
  left: Float32Array;
  right: Float32Array;
  mono: Float32Array;
  /** The sung notes in seconds. */
  melody: { midi: number; start: number; dur: number }[];
  /** True chord labels in seconds. */
  chords: { start: number; dur: number; label: string }[];
  beats: number[];
  length: number;
}

/** Renders a tune as a small band recording with a singer. */
export function renderMix(tune: Tune, options: MixOptions = {}): Mix {
  const spb = 60 / tune.bpm;
  const lastBeat = Math.max(
    ...tune.melody.map((n) => n.beat + n.beats),
    ...tune.chords.map((c) => c.beat + c.beats),
  );
  const length = lastBeat * spb + 1.5;
  const total = Math.ceil(length * RATE);
  const voice = new Float32Array(total);
  const bandL = new Float32Array(total);
  const bandR = new Float32Array(total);
  const rnd = noise(options.seed ?? 7);

  // --- Voice: harmonics through vowel formants, with scoops, glides and vibrato.
  const shift = 1 + 0.08 * rnd();
  let prevMidi: number | null = null;
  let prevEnd = -1;
  let phase = 0;
  const melody = tune.melody.map((n) => ({ midi: n.midi, start: n.beat * spb, dur: n.beats * spb * 0.95 }));
  for (const n of melody) {
    const from = Math.floor(n.start * RATE);
    const count = Math.floor(n.dur * RATE);
    const legato = prevMidi !== null && n.start - prevEnd < 0.08;
    const startMidi = legato ? prevMidi! : n.midi - 0.4; // glide from the last note, or scoop up
    const glide = legato ? 0.05 : 0.07;
    const vibRate = 5 + rnd() * 1.2;
    const vibDepth = 0.2 + 0.1 * rnd();
    const loud = 0.85 + 0.15 * rnd();
    for (let i = 0; i < count && from + i < total; i++) {
      const t = i / RATE;
      let m = t < glide ? startMidi + (n.midi - startMidi) * (t / glide) : n.midi;
      if (t > 0.18) m += vibDepth * Math.min(1, (t - 0.18) / 0.2) * Math.sin(2 * Math.PI * vibRate * t);
      const f = hz(m);
      phase += (2 * Math.PI * f) / RATE;
      const env = Math.min(1, t / 0.03) * Math.min(1, (n.dur - t) / 0.05) * loud;
      let s = 0;
      for (let h = 1; h * f < 5000; h++) s += (Math.sin(h * phase) / h) * vowel(h * f, shift);
      voice[from + i] += s * env;
      // A breathy consonant at each syllable.
      if (t < 0.025) voice[from + i] += rnd() * 0.08 * (1 - t / 0.025);
    }
    prevMidi = n.midi;
    prevEnd = n.start + n.dur;
  }

  // --- Band.
  const pluck = (out: Float32Array, midi: number, start: number, dur: number, gain: number, bright: number) => {
    const f = hz(midi);
    const from = Math.floor(start * RATE);
    const count = Math.floor((dur + 0.3) * RATE);
    for (let i = 0; i < count && from + i < total; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.004) * Math.exp(-t * 3.5) * (t > dur ? Math.exp(-(t - dur) * 15) : 1);
      let s = 0;
      for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * t) / h ** bright;
      out[from + i] += s * env * gain;
    }
  };
  const chords: Mix['chords'] = [];
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (const c of tune.chords) {
    const start = c.beat * spb;
    chords.push({ start, dur: c.beats * spb, label: names[c.root] + (c.minor ? 'm' : '') });
    const third = c.minor ? 3 : 4;
    // Close voicing around middle C.
    const tones = [0, third, 7].map((iv) => 48 + ((c.root + iv) % 12) + (((c.root + iv) % 12) < 5 ? 12 : 0));
    for (let b = 0; b < c.beats; b++) {
      const at = start + b * spb;
      tones.forEach((m, k) => pluck(k % 2 ? bandL : bandR, m, at + k * 0.012, spb * 0.9, 0.09, 1.4));
      const bass = 36 + c.root - (c.root > 7 ? 12 : 0);
      if (b % 2 === 0) {
        pluck(bandL, bass, at, spb * 1.8, 0.22, 2.5);
        pluck(bandR, bass, at, spb * 1.8, 0.22, 2.5);
      }
    }
    if (options.pad) {
      for (const m of tones.map((x) => x + 12)) {
        const f = hz(m);
        const from = Math.floor(start * RATE);
        const count = Math.floor(c.beats * spb * RATE);
        for (let i = 0; i < count && from + i < total; i++) {
          const t = i / RATE;
          const env = Math.min(1, t / 0.2) * Math.min(1, (c.beats * spb - t) / 0.1);
          let s = 0;
          for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * f * h * t * (1 + 0.002 * (h % 2))) / (h * 1.5);
          bandL[from + i] += s * env * 0.03;
          bandR[from + i] += s * env * 0.03;
        }
      }
    }
  }
  const beats: number[] = [];
  for (let b = 0; b < lastBeat; b++) beats.push(b * spb);
  if (options.drums !== false) {
    for (let b = 0; b < lastBeat; b++) {
      const at = Math.floor(b * spb * RATE);
      const inBar = b % tune.beatsPerBar;
      if (inBar === 0 || (tune.beatsPerBar === 4 && inBar === 2)) {
        let ph = 0;
        for (let i = 0; i < 0.25 * RATE && at + i < total; i++) {
          const t = i / RATE;
          ph += (2 * Math.PI * (45 + 80 * Math.exp(-t * 30))) / RATE;
          const s = Math.sin(ph) * Math.exp(-t * 14) * 0.5;
          bandL[at + i] += s;
          bandR[at + i] += s;
        }
      } else {
        let lp = 0;
        for (let i = 0; i < 0.18 * RATE && at + i < total; i++) {
          const t = i / RATE;
          lp += 0.5 * (rnd() - lp);
          const s = lp * Math.exp(-t * 22) * 0.35;
          bandL[at + i] += s;
          bandR[at + i] += s * 0.9;
        }
      }
      for (const half of [0, 0.5]) {
        const h0 = Math.floor((b + half) * spb * RATE);
        let prev = 0;
        for (let i = 0; i < 0.04 * RATE && h0 + i < total; i++) {
          const x = rnd();
          const s = (x - prev) * Math.exp(-(i / RATE) * 90) * 0.12;
          prev = x;
          bandL[h0 + i] += s * 0.6;
          bandR[h0 + i] += s;
        }
      }
    }
  }

  // Set the voice level against the band.
  const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  const bandRms = (rms(bandL) + rms(bandR)) / 2;
  const gain = (bandRms / Math.max(1e-9, rms(voice))) * 10 ** ((options.voiceDb ?? 0) / 20);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const mono = new Float32Array(total);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    left[i] = bandL[i] + voice[i] * gain;
    right[i] = bandR[i] + voice[i] * gain;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  for (let i = 0; i < total; i++) {
    left[i] *= 0.8 / peak;
    right[i] *= 0.8 / peak;
    mono[i] = (left[i] + right[i]) / 2;
  }
  return { left, right, mono, melody, chords, beats, length };
}

/** Note-level scores: a note counts when its pitch is right and it starts within `tolerance` seconds. */
export function scoreNotes(
  truth: readonly { midi: number; start: number }[],
  found: readonly { midi: number; start: number }[],
  tolerance = 0.15,
): { recall: number; precision: number; matched: number } {
  const used = new Set<number>();
  let matched = 0;
  for (const t of truth) {
    let best = -1;
    let bestGap = tolerance;
    found.forEach((f, i) => {
      const gap = Math.abs(f.start - t.start);
      if (!used.has(i) && f.midi === t.midi && gap <= bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return {
    matched,
    recall: truth.length ? matched / truth.length : 0,
    precision: found.length ? matched / found.length : 0,
  };
}

/** Parses note names such as "E4 E4 G4 C4" (or MIDI numbers) into MIDI numbers. */
export function parseNotes(text: string): number[] {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flats: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  return text
    .trim()
    .split(/[\s,|]+/)
    .filter(Boolean)
    .map((token) => {
      if (/^\d+$/.test(token)) return Number(token);
      const m = /^([A-G][#b]?)(-?\d)$/.exec(token);
      if (!m) throw new Error(`Not a note: ${token}`);
      const name = flats[m[1]] ?? m[1];
      return names.indexOf(name) + 12 * (Number(m[2]) + 1);
    });
}

/**
 * How much of an expected phrase appears, in order, somewhere in a found note
 * sequence, in any key. Local alignment (Smith-Waterman): a matching note scores
 * +1, a wrong or extra note costs 0.6. Returns the matched fraction of the phrase,
 * the transposition used, and where in `found` the phrase was found.
 * With `octaves`, notes match when they share a pitch class.
 */
export function findPhrase(
  phrase: readonly number[],
  found: readonly number[],
  octaves = false,
  shifts: readonly number[] = Array.from({ length: 49 }, (_, i) => i - 24),
  penalty = 0.6,
): { fraction: number; shift: number; at: number } {
  let best = { fraction: 0, shift: 0, at: -1 };
  for (const shift of shifts) {
    const m = phrase.length;
    let prev = new Float64Array(m + 1);
    let prevCount = new Int32Array(m + 1);
    let cur = new Float64Array(m + 1);
    let curCount = new Int32Array(m + 1);
    for (let j = 0; j < found.length; j++) {
      cur[0] = 0;
      curCount[0] = 0;
      for (let i = 1; i <= m; i++) {
        const a = phrase[i - 1] + shift;
        const b = found[j];
        const hit = octaves ? (((a - b) % 12) + 12) % 12 === 0 : a === b;
        let s = prev[i - 1] + (hit ? 1 : -penalty);
        let c = prevCount[i - 1] + (hit ? 1 : 0);
        if (prev[i] - penalty > s) {
          s = prev[i] - penalty; // extra found note
          c = prevCount[i];
        }
        if (cur[i - 1] - penalty > s) {
          s = cur[i - 1] - penalty; // phrase note missing
          c = curCount[i - 1];
        }
        if (s <= 0) {
          s = 0;
          c = 0;
        }
        cur[i] = s;
        curCount[i] = c;
        if (c / m > best.fraction) best = { fraction: c / m, shift, at: j };
      }
      [prev, cur] = [cur, prev];
      [prevCount, curCount] = [curCount, prevCount];
    }
  }
  return best;
}

/**
 * Scores a found melody against the known phrases of a tune, all in one key
 * (any key, and the tune may sit an octave higher or lower). Returns the
 * matched fraction of each phrase at its best place, and the same measure on
 * the found notes shuffled, which is what chance alone scores.
 */
export function scoreTune(
  phrases: readonly (readonly number[])[],
  found: readonly number[],
): { fraction: number; phrases: number[]; chance: number; key: number } {
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const at = (key: number, notes: readonly number[]) =>
    phrases.map((p) => findPhrase(p, notes, false, [key - 12, key, key + 12], 1).fraction);
  let bestKey = 0;
  let best: number[] = [];
  for (let key = -6; key < 6; key++) {
    const r = at(key, found);
    if (avg(r) > avg(best)) {
      best = r;
      bestKey = key;
    }
  }
  // Chance: the same notes in a random order, scored the same way.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const chances: number[] = [];
  for (let k = 0; k < 4; k++) {
    const shuffled = [...found];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let top = 0;
    for (let key = -6; key < 6; key++) top = Math.max(top, avg(at(key, shuffled)));
    chances.push(top);
  }
  return { fraction: avg(best), phrases: best, chance: avg(chances), key: bestKey };
}

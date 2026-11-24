import { fft as fftInPlace } from '../import/dsp';
import type { RawNote, TimeSignature, TimedChord } from '../song';
import { type Key, chordLabel, noteLetter } from './chords';
import { type Salience, correlate, findHarmony } from './harmony';

export { type ChordInfo, type Key, type Quality, chordLabel, chordNotes, scaleOf } from './chords';
export { type DetectedChord, type Harmony, type HarmonyOptions, type Salience, beatChroma, chordFamily, cleanHeard, findHarmony } from './harmony';

/** What analysis can work out about a song. Every field is optional: leave out what you are unsure of. */
export interface Analysis {
  bpm?: number;
  /** Beat times in seconds, ascending. */
  beats?: number[];
  timeSignature?: TimeSignature;
  chords?: TimedChord[];
  /** Key name such as "G" or "Am". */
  key?: string;
}

/** Anything shaped like a Web Audio AudioBuffer (an AudioBuffer itself works). */
export interface AudioInput {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Works out tempo, beats, time signature, key and chords from the notes heard
 * in a recording and, when there is one, the decoded audio. Called once by the
 * add-song flow in src/import; the result is copied onto the song and stored.
 * Never throws for odd input; returns {} instead.
 */
export async function analyse(raw: readonly RawNote[], audio?: AudioInput, options: AnalyseOptions = {}): Promise<Analysis> {
  try {
    return analyseSync(raw, audio, options);
  } catch (error) {
    console.warn('Song analysis failed.', error);
    return {};
  }
}

export interface AnalyseOptions {
  /** The sung tune, when it was traced separately: its notes are not counted as harmony. */
  melody?: readonly RawNote[];
  /** Frame-by-frame note activations of the recording, for steadier chords. */
  salience?: Salience;
}

/** The same as `analyse`, without the promise. Safe to call in a worker. */
export function analyseSync(raw: readonly RawNote[], audio?: AudioInput, options: AnalyseOptions = {}): Analysis {
  const notes = raw.filter((n) => Number.isFinite(n.start) && Number.isFinite(n.dur) && n.dur > 0 && n.midi > 0);
  const end = Math.max(0, ...notes.map((n) => n.start + n.dur), audio ? audio.length / audio.sampleRate : 0);
  if (end < 2 || (notes.length < 4 && !audio)) return {};

  const env = audio ? onsetEnvelope(mixDown(audio), audio.sampleRate) : noteEnvelope(notes, end);
  const out: Analysis = {};
  const beats = trackBeats(env.values, env.fps);
  if (beats.length >= 4) {
    out.beats = beats.map((b) => round3(b));
    out.bpm = Math.round(60 / median(diffs(beats)));
  }
  const grid = beats.length >= 4 ? beats : evenGrid(end, 0.5);
  // Chords first in 4/4, then the metre (chord changes mark bar lines), then chords again if it is 3/4.
  let harmony = findHarmony(notes, grid, { beatsPerBar: 4, melody: options.melody, salience: options.salience });
  if (beats.length >= 8) {
    const meter = guessMeter(env, beats, harmony.chords);
    out.timeSignature = { beats: meter, unit: 4 };
    if (meter !== 4) harmony = findHarmony(notes, grid, { beatsPerBar: meter, melody: options.melody, salience: options.salience });
  }
  const key = harmony.key ?? findKey(harmony.total);
  if (key) out.key = keyName(key);
  if (harmony.chords.length > 0) out.chords = harmony.chords;
  return out;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};
const diffs = (a: readonly number[]) => a.slice(1).map((x, i) => x - a[i]);
const evenGrid = (end: number, step: number) => Array.from({ length: Math.ceil(end / step) }, (_, i) => i * step);

function mixDown(audio: AudioInput): Float32Array {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / audio.numberOfChannels;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Onsets

export interface Envelope {
  values: Float32Array;
  fps: number;
}

/**
 * How much new sound starts in each short frame: the rise in loudness summed
 * over frequency bands (spectral flux on a log scale), about 86 frames a second.
 */
export function onsetEnvelope(audio: Float32Array, rate: number): Envelope {
  // Work at about 11 kHz: beats live well below that.
  const step = Math.max(1, Math.round(rate / 11025));
  const sr = rate / step;
  const size = 512;
  const hop = 128;
  const frames = Math.max(0, Math.floor((audio.length / step - size) / hop) + 1);
  const values = new Float32Array(frames);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  // 24 roughly logarithmic bands between 60 Hz and 5 kHz.
  const edges = Array.from({ length: 25 }, (_, i) => Math.round((60 * (5000 / 60) ** (i / 24) * size) / sr));
  const prev = new Float64Array(24);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) {
      re[i] = (audio[(f * hop + i) * step] ?? 0) * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    let flux = 0;
    for (let b = 0; b < 24; b++) {
      let e = 0;
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) e += re[k] * re[k] + im[k] * im[k];
      const v = Math.log(1 + 1000 * e);
      if (f > 0) flux += Math.max(0, v - prev[b]);
      prev[b] = v;
    }
    values[f] = flux;
  }
  return { values: normalise(values), fps: sr / hop };
}

/** An onset envelope built from note starts, for when there is no audio. */
export function noteEnvelope(notes: readonly RawNote[], end: number, fps = 100): Envelope {
  const values = new Float32Array(Math.ceil(end * fps) + 1);
  for (const n of notes) {
    const i = Math.round(n.start * fps);
    if (i >= 0 && i < values.length) values[i] += n.amp > 0 ? n.amp : 0.5;
  }
  // Smear a little so nearby starts reinforce each other.
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    for (let k = -2; k <= 2; k++) out[i] += (values[i + k] ?? 0) * (1 - Math.abs(k) / 3);
  }
  return { values: normalise(out), fps };
}

function normalise(v: Float32Array): Float32Array {
  // Remove a slow-moving local mean, then scale by the spread.
  const n = v.length;
  const out = new Float32Array(n);
  const radius = 16;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < Math.min(n, radius); i++) {
    sum += v[i];
    count++;
  }
  for (let i = 0; i < n; i++) {
    if (i + radius < n) {
      sum += v[i + radius];
      count++;
    }
    if (i - radius - 1 >= 0) {
      sum -= v[i - radius - 1];
      count--;
    }
    out[i] = Math.max(0, v[i] - sum / count);
  }
  let sq = 0;
  for (const x of out) sq += x * x;
  const sd = Math.sqrt(sq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

// ---------------------------------------------------------------------------
// Tempo and beats

/** Beat period in frames from the envelope's autocorrelation, leaning towards 70-160 bpm. */
export function findPeriod(env: Float32Array, fps: number): number {
  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 50) * fps);
  const n = env.length;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / Math.max(1, n - lag);
  }
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Strength at the beat, plus at half and double the beat, which a real pulse also shows.
    const harm = ac[lag] + 0.5 * (ac[Math.round(lag * 2)] ?? 0) + 0.25 * (ac[Math.round(lag / 2)] ?? 0);
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.6) ** 2);
    const score = harm * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement for a period between whole frames.
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const den = a - 2 * b + c;
  return den < 0 ? best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : best;
}

/**
 * Beat times in seconds. Dynamic programming (after Ellis, 2007): each beat
 * sits on strong onsets and about one period after the last, so the tempo
 * may drift through the song while the beats stay on the music.
 */
export function trackBeats(env: Float32Array, fps: number): number[] {
  const n = env.length;
  if (n < fps * 2) return [];
  const period = findPeriod(env, fps);
  const tightness = 300;
  const score = new Float64Array(n);
  const from = new Int32Array(n).fill(-1);
  const lo = Math.round(period * 0.5);
  const hi = Math.round(period * 2);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let arg = -1;
    for (let p = i - hi; p <= i - lo; p++) {
      if (p < 0) continue;
      const dev = Math.log((i - p) / period);
      const s = score[p] - tightness * dev * dev;
      if (arg < 0 || s > best) {
        best = s;
        arg = p;
      }
    }
    score[i] = env[i] + (arg >= 0 ? Math.max(0, best) : 0);
    from[i] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Start from the best-scoring frame within the last period.
  let i = n - 1;
  for (let k = Math.max(0, n - Math.round(period)); k < n; k++) if (score[k] > score[i]) i = k;
  const beats: number[] = [];
  while (i >= 0) {
    beats.push(i / fps);
    i = from[i];
  }
  beats.reverse();
  // Trim beats in silence at the very start and end.
  const strong = (t: number) => {
    const f = Math.round(t * fps);
    let m = 0;
    for (let k = Math.max(0, f - 3); k <= Math.min(n - 1, f + 3); k++) m = Math.max(m, env[k]);
    return m;
  };
  let a = 0;
  let b = beats.length;
  const loud = (x: number) => strong(x) > 0.25;
  while (a < b && !loud(beats[a]) && !loud(beats[a + 1] ?? -1)) a++;
  while (b > a && !loud(beats[b - 1]) && !loud(beats[b - 2] ?? -1)) b--;
  return beats.slice(a, b);
}

// ---------------------------------------------------------------------------
// Harmony (see harmony.ts)

/** The most likely key from overall pitch weights. */
export function findKey(total: ArrayLike<number>): Key | undefined {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += total[i];
  if (!(sum > 0)) return undefined;
  let best: Key | undefined;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const s = correlate(total, minor ? MINOR : MAJOR, tonic);
      if (s > bestScore) {
        bestScore = s;
        best = { tonic, minor };
      }
    }
  }
  return best;
}

// Krumhansl-Kessler key profiles, for a key from pitch weights alone.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function keyName(key: Key): string {
  return noteLetter(key.tonic, key) + (key.minor ? 'm' : '');
}

/** Chord name for a root and quality, spelled to suit the key. */
export function chordName(root: number, minor: boolean, key?: Key): string {
  return chordLabel(root, minor ? 'm' : '', undefined, key);
}

/**
 * 3/4 or 4/4: which bar length makes the strongest accents (and chord changes)
 * land on the first beat of a bar most consistently.
 */
export function guessMeter(env: Envelope, beats: readonly number[], chords: readonly TimedChord[]): number {
  const strength = beats.map((b) => {
    const f = Math.round(b * env.fps);
    let m = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(env.values.length - 1, f + 2); k++) m = Math.max(m, env.values[k]);
    return m;
  });
  const changes = new Set(
    chords.map((c) => {
      let best = 0;
      beats.forEach((b, i) => {
        if (Math.abs(b - c.start) < Math.abs(beats[best] - c.start)) best = i;
      });
      return best;
    }),
  );
  const fit = (bar: number) => {
    let best = -Infinity;
    for (let phase = 0; phase < bar; phase++) {
      let on = 0;
      let off = 0;
      let onN = 0;
      let offN = 0;
      let changeOn = 0;
      let changeAll = 0;
      for (let i = 0; i < beats.length; i++) {
        const down = (i - phase) % bar === 0;
        if (down) {
          on += strength[i];
          onN++;
        } else {
          off += strength[i];
          offN++;
        }
        if (changes.has(i)) {
          changeAll++;
          if (down) changeOn++;
        }
      }
      const accent = onN && offN ? on / onN - off / offN : 0;
      const harmonic = changeAll ? changeOn / changeAll - 1 / bar : 0;
      best = Math.max(best, Math.abs(accent) * 0.2 + harmonic);
    }
    return best;
  };
  // How much the pattern of accents repeats every 3 or every 4 beats.
  const mean = strength.reduce((a, b) => a + b, 0) / Math.max(1, strength.length);
  const centred = strength.map((x) => x - mean);
  const energy = centred.reduce((a, x) => a + x * x, 0) || 1;
  const repeat = (lag: number) => {
    let r = 0;
    for (let i = 0; i + lag < centred.length; i++) r += centred[i] * centred[i + lag];
    return r / energy;
  };
  const three = repeat(3) + repeat(6) + 0.5 * fit(3);
  const four = repeat(4) + repeat(8) + 0.5 * fit(4);
  return three > four + 0.05 ? 3 : 4;
}

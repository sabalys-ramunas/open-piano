// Chords and key from the notes heard in a recording, one decision per beat.
//
// How it works (after Mauch and Dixon's beat-synchronous chord HMMs and the
// MIREX chord systems built on them):
// 1. Each beat gets two pitch-class profiles (chroma): one for the harmony
//    (every note, the sung tune turned down) and one for the bass (low notes).
// 2. A first Viterbi pass over major and minor triads finds rough chords; their
//    agreement with each key, plus the overall pitch profile, gives the key of
//    every stretch of the song (a key change costs a lot, so only a real
//    modulation shows).
// 3. A second pass decides the chords with what is known: chords of the local
//    key get a head start, borrowed chords need more evidence, a chord lasts at
//    least half a bar, and chords change more easily on a downbeat.
// 4. Each chord then gets its details only where the notes clearly show them:
//    a seventh, a sus4, a bass note other than the root (slash chord), and a
//    confidence. Where the third is unclear the chord becomes a power chord
//    ("C5": root and fifth), and a very unsure short chord just continues the
//    one before, so the piano never plays a wrong third.
//
// Inputs are plain notes so this also works on separate stems later: harmony
// notes from the accompaniment, `melody` from the vocals, bass from the bass.
import type { RawNote, TimedChord } from '../song';
import { type Key, type Quality, chordLabel } from './chords';

export interface DetectedChord extends TimedChord {
  /** 0..1: how clearly the notes showed this chord. */
  confidence: number;
}

/**
 * What the note model heard frame by frame, before it was cut into notes: much
 * richer than the notes for chords, because quiet chord tones under a loud
 * singer or a distorted guitar rarely pass the note threshold.
 */
export interface Salience {
  /** frameCount x keys values 0..1. */
  frames: Float32Array;
  frameCount: number;
  /** Keys per frame (88) and the MIDI number of the first (21). */
  keys: number;
  lowest: number;
  /** Time of a frame in seconds. */
  time(frame: number): number;
}

export interface HarmonyOptions {
  /** Frame-by-frame note activations, when the recording itself was listened to. */
  salience?: Salience;
  /** Beats in a bar, when known. Chords last at least half a bar. */
  beatsPerBar?: number;
  /** The sung tune: its notes are not harmony, so they count for little. */
  melody?: readonly RawNote[];
  /** Index of a beat that starts a bar, when known. Found from the chord changes otherwise. */
  downbeat?: number;
}

export interface Harmony {
  chords: DetectedChord[];
  /** The key most of the song is in. */
  key?: Key;
  /** Key of each stretch, when the song changes key. */
  keys: { start: number; key: Key }[];
  /** Index of the first beat that starts a bar. */
  downbeat: number;
  /** Pitch weights over the whole song. */
  total: Float64Array;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------
// Cleaning what the note model heard

// A struck string also rings at whole multiples of its pitch, and the model
// sometimes writes those overtones down as quiet extra notes. Each entry is
// how far above the real note an overtone sits, and how much quieter a note
// there must be before we call it an echo. The 5th harmonic (+28, a major
// third two octaves up) matters most for chords: it turns minor into major.
const OVERTONES: [semitones: number, quieterThan: number][] = [
  [12, 0.5],
  [19, 0.65],
  [24, 0.65],
  [28, 0.75],
  [31, 0.7],
  [34, 0.75],
];

/** Drops the faint, very short notes and (unless told not to) overtone echoes the note model tends to invent. */
export function cleanHeard(raw: readonly RawNote[], options: { overtones?: boolean } = {}): RawNote[] {
  const valid = raw.filter((n) => Number.isFinite(n.start) && Number.isFinite(n.dur) && Number.isFinite(n.amp) && n.start >= 0 && n.dur > 0);
  if (valid.length === 0) return [];
  const loudest = valid.reduce((m, n) => Math.max(m, n.amp), 0);
  const solid = valid
    .filter((n) => n.dur >= 0.09 && n.amp >= loudest * 0.18 && n.midi >= 21 && n.midi <= 108)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  if (options.overtones === false) return solid;
  // Notes sorted by start: only look back over notes that can still be sounding.
  const out: RawNote[] = [];
  let from = 0;
  for (let i = 0; i < solid.length; i++) {
    const n = solid[i];
    while (from < i && solid[from].start < n.start - 8) from++;
    let echo = false;
    for (let j = from; j < solid.length && solid[j].start <= n.start + 0.05 && !echo; j++) {
      const f = solid[j];
      if (f === n || f.start + f.dur <= n.start) continue;
      const limit = OVERTONES.find(([gap]) => gap === n.midi - f.midi);
      if (limit && n.amp < f.amp * limit[1]) echo = true;
    }
    if (!echo) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Beat chroma

export interface BeatChroma {
  /** Harmony weight per pitch class, one row per beat. */
  treble: Float64Array[];
  /** Bass weight per pitch class (notes below G3, the lowest counting most). */
  bass: Float64Array[];
  /** Segment edges: beat i runs from bounds[i] to bounds[i + 1]. */
  bounds: number[];
  total: Float64Array;
}

function median(a: readonly number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
}

/** Same pitch (or an octave off) and sounding at the same time as a sung note: the singer, heard in the mix. */
function sungWith(melody: readonly RawNote[]): (n: RawNote) => boolean {
  const sorted = [...melody].sort((a, b) => a.start - b.start);
  return (n) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].start < n.start - 4) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < sorted.length && sorted[i].start < n.start + n.dur; i++) {
      const m = sorted[i];
      const d = Math.abs(m.midi - n.midi);
      if (d !== 0 && d !== 12) continue;
      const overlap = Math.min(m.start + m.dur, n.start + n.dur) - Math.max(m.start, n.start);
      if (overlap >= 0.5 * Math.min(n.dur, m.dur)) return true;
    }
    return false;
  };
}

export function beatChroma(
  notes: readonly RawNote[],
  beats: readonly number[],
  melody: readonly RawNote[] = [],
  salience?: Salience,
): BeatChroma {
  const step = beats.length > 1 ? median(beats.slice(1).map((b, i) => b - beats[i])) : 0.5;
  const bounds = [...beats, beats[beats.length - 1] + step];
  const T = bounds.length - 1;
  const treble = Array.from({ length: T }, () => new Float64Array(12));
  const bass = Array.from({ length: T }, () => new Float64Array(12));
  const lowest = new Float64Array(T).fill(Infinity);
  const total = new Float64Array(12);
  const sung = sungWith(melody);
  const first = (t: number) => {
    let lo = 0;
    let hi = T - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bounds[mid + 1] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const n of notes) {
    const pc = ((n.midi % 12) + 12) % 12;
    const amp = n.amp > 0 ? n.amp : 0.5;
    const register = n.midi < 40 ? 0.5 : n.midi < 72 ? 1 : n.midi < 84 ? 0.7 : 0.3;
    const weight = amp * register * (melody.length && sung(n) ? 0.3 : 1);
    const end = n.start + n.dur;
    total[pc] += weight * n.dur;
    for (let k = first(n.start); k < T && bounds[k] < end; k++) {
      const len = bounds[k + 1] - bounds[k];
      const overlap = Math.min(end, bounds[k + 1]) - Math.max(n.start, bounds[k]);
      if (overlap <= 0) continue;
      // Sounding through the beat, plus a little extra for being struck in it.
      const struck = n.start >= bounds[k] - 0.03 && n.start < bounds[k + 1] - 0.03 ? 0.4 : 0;
      const share = overlap / len + struck;
      treble[k][pc] += weight * share;
      if (n.midi < 55) {
        const low = 1 + (55 - n.midi) / 12;
        bass[k][pc] += amp * low * share;
        if (overlap > len * 0.3) lowest[k] = Math.min(lowest[k], n.midi);
      }
    }
  }
  // The lowest note held through a beat is the bass note more often than not.
  for (let k = 0; k < T; k++) if (Number.isFinite(lowest[k])) bass[k][lowest[k] % 12] *= 1.5;
  // Soften loud notes so one strong note cannot outvote a whole chord.
  for (const rows of [treble, bass]) for (const row of rows) for (let i = 0; i < 12; i++) row[i] = Math.sqrt(row[i]);
  if (salience) addSalience(treble, bass, bounds, salience, melody);
  return { treble, bass, bounds, total };
}

/**
 * Adds the frame activations to the note chroma, scaled to the same size, with
 * the sung line taken out (the singer's own pitch, and its octave, while singing).
 */
function addSalience(treble: Float64Array[], bass: Float64Array[], bounds: readonly number[], s: Salience, melody: readonly RawNote[]): void {
  const T = treble.length;
  const actT = Array.from({ length: T }, () => new Float64Array(12));
  const actB = Array.from({ length: T }, () => new Float64Array(12));
  const count = new Float64Array(T);
  const sung = [...melody].sort((a, b) => a.start - b.start);
  let m = 0;
  let k = 0;
  for (let f = 0; f < s.frameCount; f++) {
    const t = s.time(f);
    while (k < T && bounds[k + 1] <= t) k++;
    if (k >= T) break;
    if (t < bounds[0]) continue;
    while (m < sung.length && sung[m].start + sung[m].dur < t) m++;
    let voice = -1;
    for (let j = m; j < sung.length && sung[j].start <= t; j++) if (sung[j].start + sung[j].dur >= t) voice = sung[j].midi;
    count[k]++;
    const row = f * s.keys;
    for (let i = 0; i < s.keys; i++) {
      const v = s.frames[row + i] - 0.12;
      if (v <= 0) continue;
      const midi = s.lowest + i;
      const pc = midi % 12;
      const register = midi < 40 ? 0.5 : midi < 72 ? 1 : midi < 84 ? 0.7 : 0.3;
      const d = voice < 0 ? 99 : Math.abs(midi - voice);
      const w = v * register * (d === 0 || d === 12 ? 0.2 : 1);
      actT[k][pc] += w;
      if (midi < 55) actB[k][pc] += v * (1 + (55 - midi) / 12);
    }
  }
  for (let i = 0; i < T; i++) {
    if (count[i] === 0) continue;
    for (let pc = 0; pc < 12; pc++) {
      actT[i][pc] = Math.sqrt(actT[i][pc] / count[i]);
      actB[i][pc] = Math.sqrt(actB[i][pc] / count[i]);
    }
  }
  // Same overall size as the note chroma, then weighted a little more: it hears more.
  const size = (rows: Float64Array[]) => median(rows.map((r) => r.reduce((a, x) => a + x, 0)).filter((x) => x > 0)) || 1;
  const kt = (size(treble) / size(actT)) * 1.5;
  const kb = (size(bass) / size(actB)) * 1.0;
  for (let i = 0; i < T; i++) {
    for (let pc = 0; pc < 12; pc++) {
      treble[i][pc] += actT[i][pc] * kt;
      bass[i][pc] += actB[i][pc] * kb;
    }
  }
}

// ---------------------------------------------------------------------------
// Keys

// Temperley's key profiles (Kostka-Payne corpus), which suit popular music better than the classical ones.
const MAJOR_PROFILE = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const MINOR_PROFILE = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

export function correlate(a: ArrayLike<number>, profile: readonly number[], shift: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i] / 12;
    mb += profile[i] / 12;
  }
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[(i + shift) % 12] - ma;
    const y = profile[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

// Krumhansl-Kessler profiles: together with Temperley's they settle relative major and minor better than either alone.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Key index 0..23: tonic + 12 for minor. */
const keyOf = (k: number): Key => ({ tonic: k % 12, minor: k >= 12 });

/**
 * How at home a chord is in a key: 2 for the key's own chords, 1 for the usual
 * borrowed and secondary chords of pop music, 0 for anything else.
 */
export function chordFamily(root: number, minor: boolean, key: Key): 0 | 1 | 2 {
  const d = (root - key.tonic + 12) % 12;
  if (!key.minor) {
    if (minor ? [2, 4, 9].includes(d) : [0, 5, 7].includes(d)) return 2;
    // iv, bVII, bVI, bIII, V/V, V/vi, V/ii
    if (minor ? d === 5 : [10, 8, 3, 2, 4, 9].includes(d)) return 1;
    return 0;
  }
  // Natural minor plus the major V (harmonic minor).
  if (minor ? [0, 5, 7].includes(d) : [3, 8, 10, 7].includes(d)) return 2;
  // Dorian IV, minor ii, the Picardy I, bII.
  if (minor ? d === 2 : [5, 0, 1].includes(d)) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Chords

const N = 24; // states 0..11 major, 12..23 minor, 24 = no chord

interface Emissions {
  /** T x 25 scores. */
  score: Float64Array[];
  /** How much is sounding in each beat, relative to a typical beat. */
  energy: Float64Array;
}

function emissions(ch: BeatChroma): Emissions {
  const T = ch.treble.length;
  const sums = ch.treble.map((row) => row.reduce((a, x) => a + x, 0));
  const typical = median(sums.filter((s) => s > 0)) || 1;
  const energy = new Float64Array(T);
  const score: Float64Array[] = [];
  for (let t = 0; t < T; t++) {
    const tre = ch.treble[t];
    const bas = ch.bass[t];
    energy[t] = sums[t] / typical;
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += tre[i] * tre[i];
    norm = Math.sqrt(norm);
    let bsum = 0;
    for (let i = 0; i < 12; i++) bsum += bas[i];
    const row = new Float64Array(N + 1);
    for (let c = 0; c < N; c++) {
      if (norm < 1e-9) {
        row[c] = 0;
        continue;
      }
      const r = c % 12;
      const minor = c >= 12;
      const third = (r + (minor ? 3 : 4)) % 12;
      const other = (r + (minor ? 4 : 3)) % 12;
      const fifth = (r + 7) % 12;
      const fit = (tre[r] + tre[third] + 0.8 * tre[fifth]) / (norm * Math.sqrt(2.64));
      const clash = (0.35 * tre[other]) / norm;
      let low = 0;
      if (bsum > 1e-9) {
        const b = (pc: number) => bas[pc] / bsum;
        low = 0.5 * b(r) + 0.25 * b(third) + 0.25 * b(fifth) - 0.25 * (1 - b(r) - b(third) - b(fifth));
      }
      row[c] = fit - clash + 0.6 * low;
    }
    row[N] = energy[t] < 0.08 ? 1.2 : -1;
    score.push(row);
  }
  return { score, energy };
}

interface DecodeOptions {
  minBeats: number;
  /** Cost of changing chord at beat t. */
  changeCost: (t: number) => number;
  /** Extra score for chord c at beat t. */
  prior?: (t: number, c: number) => number;
}

/** Viterbi over chords where a chord, once started, must last `minBeats` beats. */
function decode(e: Emissions, o: DecodeOptions): Int16Array {
  const T = e.score.length;
  const C = N + 1;
  const m = Math.max(1, o.minBeats);
  const S = C * m;
  let score = new Float64Array(S).fill(-Infinity);
  let next = new Float64Array(S);
  const back = new Int32Array(T * S).fill(-1);
  const emit = (t: number, c: number) => e.score[t][c] + (o.prior && c < N ? o.prior(t, c) : 0);
  for (let c = 0; c < C; c++) score[c * m + (m - 1)] = emit(0, c);
  for (let t = 1; t < T; t++) {
    next.fill(-Infinity);
    // Best and second best finished chords to change from.
    let b1 = -1;
    let b2 = -1;
    for (let c = 0; c < C; c++) {
      const s = score[c * m + m - 1];
      if (b1 < 0 || s > score[b1 * m + m - 1]) {
        b2 = b1;
        b1 = c;
      } else if (b2 < 0 || s > score[b2 * m + m - 1]) b2 = c;
    }
    const cost = o.changeCost(t);
    for (let c = 0; c < C; c++) {
      const e0 = emit(t, c);
      // Start chord c here.
      const from = b1 !== c ? b1 : b2;
      if (from >= 0) {
        const v = score[from * m + m - 1] - cost + (c === N || from === N ? cost * 0.5 : 0);
        next[c * m] = v + e0;
        back[t * S + c * m] = from * m + m - 1;
      }
      // Carry on with chord c.
      for (let k = 1; k < m; k++) {
        let best = score[c * m + k - 1];
        let arg = c * m + k - 1;
        if (k === m - 1 && score[c * m + k] > best) {
          best = score[c * m + k];
          arg = c * m + k;
        }
        if (best === -Infinity) continue;
        next[c * m + k] = best + e0;
        back[t * S + c * m + k] = arg;
      }
      if (m === 1) {
        const stay = score[c] + e0;
        if (stay > next[c]) {
          next[c] = stay;
          back[t * S + c] = c;
        }
      }
    }
    [score, next] = [next, score];
    let top = -Infinity;
    for (let s = 0; s < S; s++) top = Math.max(top, score[s]);
    if (Number.isFinite(top)) for (let s = 0; s < S; s++) score[s] -= top;
  }
  let state = 0;
  for (let s = 1; s < S; s++) if (score[s] > score[state]) state = s;
  const path = new Int16Array(T);
  for (let t = T - 1; t >= 0; t--) {
    path[t] = Math.floor(state / m);
    if (t > 0) state = back[t * S + state];
    if (state < 0) state = 0;
  }
  return path;
}

/** Index of the beat (mod bar) where chord changes and low notes land most. */
function findDownbeat(path: Int16Array, ch: BeatChroma, bar: number): number {
  const votes = new Float64Array(bar);
  for (let t = 1; t < path.length; t++) if (path[t] !== path[t - 1]) votes[t % bar] += 1;
  for (let t = 0; t < ch.bass.length; t++) votes[t % bar] += 0.05 * ch.bass[t].reduce((a, x) => a + x, 0);
  let best = 0;
  for (let p = 1; p < bar; p++) if (votes[p] > votes[best]) best = p;
  return best;
}

/** Key per beat: Viterbi over 24 keys, scored by the rough chords and the pitch profile around each beat. */
function trackKeys(path: Int16Array, ch: BeatChroma, bar: number): Int16Array {
  const T = path.length;
  const K = 24;
  const fit: Float64Array[] = [];
  // Pitch profile over about eight bars around each beat.
  const radius = bar * 4;
  const cumulative = [new Float64Array(12)];
  for (let t = 0; t < T; t++) {
    const row = new Float64Array(cumulative[t]);
    for (let i = 0; i < 12; i++) row[i] += ch.treble[t][i] + ch.bass[t][i];
    cumulative.push(row);
  }
  for (let t = 0; t < T; t++) {
    const lo = Math.max(0, t - radius);
    const hi = Math.min(T, t + radius);
    const local = new Float64Array(12);
    for (let i = 0; i < 12; i++) local[i] = cumulative[hi][i] - cumulative[lo][i];
    const row = new Float64Array(K);
    const c = path[t];
    for (let k = 0; k < K; k++) {
      const key = keyOf(k);
      let s =
        0.3 * correlate(local, key.minor ? MINOR_PROFILE : MAJOR_PROFILE, key.tonic) +
        0.3 * correlate(local, key.minor ? KK_MINOR : KK_MAJOR, key.tonic);
      if (c < N) {
        const root = c % 12;
        const minor = c >= 12;
        s += [-0.5, 0.2, 0.6][chordFamily(root, minor, key)];
        // Songs and sections tend to start and end on the home chord.
        const edge = t < bar * 2 || t >= T - bar * 2 ? 3 : 1;
        if (root === key.tonic && minor === key.minor) s += 0.35 * edge;
      }
      row[k] = s;
    }
    fit.push(row);
  }
  const switchCost = 8;
  let score = Float64Array.from(fit[0]);
  const back = new Int8Array(T * K);
  for (let t = 1; t < T; t++) {
    let best = 0;
    for (let k = 1; k < K; k++) if (score[k] > score[best]) best = k;
    const next = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const stay = score[k];
      const move = score[best] - switchCost;
      next[k] = Math.max(stay, move) + fit[t][k];
      back[t * K + k] = stay >= move ? k : best;
    }
    score = next;
  }
  let k = 0;
  for (let j = 1; j < K; j++) if (score[j] > score[k]) k = j;
  const keys = new Int16Array(T);
  for (let t = T - 1; t >= 0; t--) {
    keys[t] = k;
    k = back[t * K + k];
  }
  return keys;
}

/**
 * Chords and key from notes and beat times. `notes` should be the harmony
 * (everything heard, or an accompaniment stem); pass the sung tune as
 * `options.melody` so it is not mistaken for harmony.
 */
export function findHarmony(notes: readonly RawNote[], beats: readonly number[], options: HarmonyOptions = {}): Harmony {
  const empty: Harmony = { chords: [], keys: [], downbeat: 0, total: new Float64Array(12) };
  if (beats.length < 2) return empty;
  // Overtone-looking notes stay: measured on band recordings, dropping them
  // removed real chord tones an octave or a twelfth above the bass more often
  // than it removed echoes, and the chords came out worse.
  const clean = cleanHeard(notes, { overtones: false });
  if (clean.length === 0) return empty;
  const ch = beatChroma(clean, beats, options.melody ?? [], options.salience);
  const T = ch.treble.length;
  const beatLen = median(beats.slice(1).map((b, i) => b - beats[i]));
  const bar = options.beatsPerBar && options.beatsPerBar > 1 ? options.beatsPerBar : 4;
  const e = emissions(ch);

  // Pass 1: rough chords, half a bar at least.
  const half = Math.max(2, Math.ceil(bar / 2), Math.ceil(0.9 / beatLen));
  const rough = decode(e, { minBeats: half, changeCost: () => 0.5 });
  const downbeat = options.downbeat !== undefined ? ((options.downbeat % bar) + bar) % bar : findDownbeat(rough, ch, bar);
  const keyPath = trackKeys(rough, ch, bar);

  // Pass 2: with keys and bar lines.
  const position = (t: number) => (((t - downbeat) % bar) + bar) % bar;
  const changeCost = (t: number) => {
    const p = position(t);
    if (p === 0) return 0.25;
    if (bar === 4 && p === 2) return 0.5;
    return 1.1;
  };
  const prior = (t: number, c: number) => {
    const fam = chordFamily(c % 12, c >= 12, keyOf(keyPath[t]));
    return [-0.12, 0.0, 0.08][fam];
  };
  const path = decode(e, { minBeats: half, changeCost, prior });

  // Segments.
  const segments: { from: number; to: number; c: number }[] = [];
  for (let t = 0; t < T; t++) {
    const last = segments[segments.length - 1];
    if (last && last.c === path[t]) last.to = t + 1;
    else segments.push({ from: t, to: t + 1, c: path[t] });
  }

  const chords: DetectedChord[] = [];
  for (const seg of segments) {
    if (seg.c === N) continue;
    const key = keyOf(keyPath[seg.from]);
    const d = describe(seg, ch, e, key);
    const prev = chords[chords.length - 1];
    const start = ch.bounds[seg.from];
    const end = ch.bounds[seg.to];
    let energy = 0;
    for (let t = seg.from; t < seg.to; t++) energy += e.energy[t] / (seg.to - seg.from);
    // Nothing clear and nothing before it (an intro of drums, say): no chord yet.
    if (!prev && (d.confidence < 0.15 || energy < 0.35)) continue;
    // Too unsure and short: keep playing what was there before.
    if (prev && d.confidence < 0.12 && seg.to - seg.from <= bar && Math.abs(prev.start + prev.dur - start) < 0.05) {
      prev.dur = round3(end - prev.start);
      continue;
    }
    const label = chordLabel(seg.c % 12, d.quality, d.bass, key);
    if (prev && prev.label === label && Math.abs(prev.start + prev.dur - start) < 0.05) {
      prev.dur = round3(end - prev.start);
      prev.confidence = Math.min(prev.confidence, d.confidence);
      continue;
    }
    chords.push({ start: round3(start), dur: round3(end - start), label, confidence: Math.round(d.confidence * 100) / 100 });
  }

  // Keys: where they change, and the one covering most of the song.
  const keys: Harmony['keys'] = [];
  const time = new Float64Array(24);
  for (let t = 0; t < T; t++) {
    time[keyPath[t]] += ch.bounds[t + 1] - ch.bounds[t];
    if (t === 0 || keyPath[t] !== keyPath[t - 1]) keys.push({ start: round3(ch.bounds[t]), key: keyOf(keyPath[t]) });
  }
  let main = 0;
  for (let k = 1; k < 24; k++) if (time[k] > time[main]) main = k;
  return { chords, key: keyOf(main), keys, downbeat, total: ch.total };
}

/** Quality, bass note and confidence of one decoded chord. */
function describe(seg: { from: number; to: number; c: number }, ch: BeatChroma, e: Emissions, key: Key) {
  const root = seg.c % 12;
  const minor = seg.c >= 12;
  const len = seg.to - seg.from;
  const tre = new Float64Array(12);
  const bas = new Float64Array(12);
  let margin = 0;
  let thirdMargin = 0;
  for (let t = seg.from; t < seg.to; t++) {
    for (let i = 0; i < 12; i++) {
      tre[i] += ch.treble[t][i] / len;
      bas[i] += ch.bass[t][i] / len;
    }
    const row = e.score[t];
    let other = -Infinity;
    for (let c = 0; c < N; c++) if (c !== seg.c && c % 12 !== root) other = Math.max(other, row[c]);
    margin += (row[seg.c] - other) / len;
    thirdMargin += (row[seg.c] - row[minor ? root : root + 12]) / len;
  }
  const third = (root + (minor ? 3 : 4)) % 12;
  const fifth = (root + 7) % 12;
  const core = (tre[root] + tre[third] + tre[fifth]) / 3;
  let quality: Quality = minor ? 'm' : '';

  // A seventh only when it sounds through most of the chord, as loud as a chord tone.
  const flat7 = (root + 10) % 12;
  const maj7 = (root + 11) % 12;
  const beatsWith = (pc: number, level: number) => {
    let n = 0;
    for (let t = seg.from; t < seg.to; t++) {
      const row = ch.treble[t];
      const c = (row[root] + row[third] + row[fifth]) / 3;
      if (row[pc] >= c * level) n++;
    }
    return n / len;
  };
  if (len >= 2 && core > 0) {
    if (tre[flat7] >= core * 0.55 && tre[flat7] > tre[maj7] && beatsWith(flat7, 0.4) >= 0.6) quality = minor ? 'm7' : '7';
    else if (!minor && tre[maj7] >= core * 0.6 && beatsWith(maj7, 0.45) >= 0.6 && tre[maj7] > tre[(root + 9) % 12]) quality = 'maj7';
  }
  // sus4: the fourth clearly there and the third clearly missing.
  const fourth = (root + 5) % 12;
  if (quality === '' && tre[fourth] > tre[third] * 1.8 && tre[third] < tre[root] * 0.35 && tre[fourth] > tre[root] * 0.5) quality = 'sus4';

  // Confidence: the lead over the best chord with another root, and over the same root with the other third.
  const confidence = Math.max(0, Math.min(1, margin / 0.35)) * Math.min(1, len / 2);
  // The third unclear (both thirds weak or both present): root and fifth only.
  const thirdShown = tre[third] > tre[root] * 0.3 && thirdMargin > 0.04;
  if (!thirdShown && (quality === '' || quality === 'm') && tre[fifth] > tre[root] * 0.3) quality = '5';

  // Bass note: a chord tone other than the root, clearly the lowest through the chord.
  let bsum = 0;
  for (let i = 0; i < 12; i++) bsum += bas[i];
  let bass: number | undefined;
  if (bsum > 0) {
    let top = 0;
    for (let i = 1; i < 12; i++) if (bas[i] > bas[top]) top = i;
    const tones = [third, fifth, ...(quality.includes('7') ? [quality === 'maj7' ? maj7 : flat7] : [])];
    if (top !== root && tones.includes(top) && bas[top] / bsum >= 0.35 && bas[root] < bas[top] * 0.5) bass = top;
  }
  void key;
  return { quality, bass, confidence };
}

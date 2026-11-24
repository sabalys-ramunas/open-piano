// Finds the tune a singer (or lead instrument) carries through a full band
// recording. The network's fine pitch output shows every instrument at once;
// the tune is the strongest line that moves smoothly over time. A Viterbi
// search picks one pitch per frame (or "nobody sings") that balances how
// strongly each pitch is heard against how far the line jumps, then the line is
// cut into notes where the pitch settles on a new key, at gaps, and where the
// network hears a fresh start on the same key (repeated syllables).
import type { RawNote } from '../song';
import { type Activations, BINS_PER_SEMITONE, KEYS, MIDI_OFFSET, PITCH_BINS, frameTime } from './model';

export interface MelodyOptions {
  /** Lowest and highest MIDI note the tune may use. */
  low?: number;
  high?: number;
  /** Extra weight for each pitch bin, e.g. from how loud the centre of the stereo image is there. */
  weight?: (frame: number, bin: number) => number;
}

/** A tracked pitch line: fractional MIDI per frame, NaN where nobody sings. */
export interface PitchLine {
  pitch: Float32Array;
  strength: Float32Array;
}

const LOG_FLOOR = Math.log(0.02);

/** Picks the most likely sung line, frame by frame. */
export function trackLine(act: Activations, options: MelodyOptions = {}): PitchLine {
  const low = options.low ?? 48;
  const high = options.high ?? 88;
  const b0 = (low - MIDI_OFFSET) * BINS_PER_SEMITONE;
  const b1 = Math.min(PITCH_BINS - 1, (high - MIDI_OFFSET) * BINS_PER_SEMITONE);
  const S = b1 - b0 + 1; // voiced states; state S is "silent"
  const n = act.frameCount;
  const pitch = new Float32Array(n).fill(NaN);
  const strength = new Float32Array(n);
  if (n === 0) return { pitch, strength };

  const maxJump = 13 * BINS_PER_SEMITONE;
  const jumpCost = 0.11; // per bin moved, in log units
  const leapCost = 1.0; // extra once the line leaves its key, so it prefers clean note changes
  const voicingCost = 2.5; // to start or stop singing
  const silentScore = Math.log(0.18);

  const emit = new Float32Array(S);
  let score = new Float32Array(S + 1);
  let next = new Float32Array(S + 1);
  const back = new Int16Array(n * (S + 1));

  const emission = (t: number) => {
    const row = t * PITCH_BINS;
    for (let s = 0; s < S; s++) {
      const b = b0 + s;
      // Smooth across neighbouring bins so vibrato does not split the line.
      const v =
        (act.pitch[row + b] * 0.5 + (act.pitch[row + b - 1] ?? 0) * 0.25 + (act.pitch[row + b + 1] ?? 0) * 0.25) / 255;
      // Notes the network is sure of (frame output) back the fine pitch up.
      const key = Math.round(b / BINS_PER_SEMITONE);
      const sure = key < KEYS ? act.frames[t * KEYS + key] : 0;
      let x = 0.6 * v + 0.4 * sure;
      if (options.weight) x *= options.weight(t, b);
      // A gentle lean towards higher lines: tunes usually sit above the accompaniment.
      x *= 1 + (s / S) * 0.35;
      emit[s] = Math.max(LOG_FLOOR, Math.log(Math.max(1e-6, x)));
    }
  };

  emission(0);
  for (let s = 0; s < S; s++) score[s] = emit[s] - voicingCost;
  score[S] = silentScore;

  for (let t = 1; t < n; t++) {
    emission(t);
    const bt = t * (S + 1);
    for (let s = 0; s < S; s++) {
      let best = score[S] - voicingCost;
      let arg = S;
      const lo = Math.max(0, s - maxJump);
      const hi = Math.min(S - 1, s + maxJump);
      for (let p = lo; p <= hi; p++) {
        const d = Math.abs(p - s);
        const c = score[p] - d * jumpCost - (d > 1 ? leapCost : 0);
        if (c > best) {
          best = c;
          arg = p;
        }
      }
      next[s] = best + emit[s];
      back[bt + s] = arg;
    }
    let best = score[S];
    let arg = S;
    for (let p = 0; p < S; p++) {
      const c = score[p] - voicingCost;
      if (c > best) {
        best = c;
        arg = p;
      }
    }
    next[S] = best + silentScore;
    back[bt + S] = arg;
    [score, next] = [next, score];
    // Keep numbers small.
    let top = -Infinity;
    for (let s = 0; s <= S; s++) top = Math.max(top, score[s]);
    for (let s = 0; s <= S; s++) score[s] -= top;
  }

  let state = 0;
  for (let s = 1; s <= S; s++) if (score[s] > score[state]) state = s;
  for (let t = n - 1; t >= 0; t--) {
    if (state < S) {
      const b = b0 + state;
      // Refine between bins with a parabola through the neighbours.
      const row = t * PITCH_BINS;
      const l = act.pitch[row + b - 1] ?? 0;
      const c = act.pitch[row + b];
      const r = act.pitch[row + b + 1] ?? 0;
      const den = l - 2 * c + r;
      const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
      pitch[t] = MIDI_OFFSET + (b + off) / BINS_PER_SEMITONE;
      strength[t] = act.pitch[t * PITCH_BINS + b] / 255;
    }
    if (t > 0) state = back[t * (S + 1) + state];
  }
  return { pitch, strength };
}

/**
 * How far off concert pitch the line sits, around each frame, in semitones.
 * Untrained singers drift, and some recordings are tuned a little sharp or flat;
 * without this, a line sung a quarter tone off flips between two keys.
 */
export function tuning(line: PitchLine, radius = 350): Float32Array {
  const n = line.pitch.length;
  // Circular mean of the distance to the nearest key, over a sliding window.
  const cos = new Float64Array(n + 1);
  const sin = new Float64Array(n + 1);
  for (let t = 0; t < n; t++) {
    const p = line.pitch[t];
    const w = Number.isNaN(p) ? 0 : 0.2 + line.strength[t];
    const a = Number.isNaN(p) ? 0 : 2 * Math.PI * (p - Math.round(p));
    cos[t + 1] = cos[t] + w * Math.cos(a);
    sin[t + 1] = sin[t] + w * Math.sin(a);
  }
  const out = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, t - radius);
    const hi = Math.min(n, t + radius);
    const c = cos[hi] - cos[lo];
    const s = sin[hi] - sin[lo];
    out[t] = c === 0 && s === 0 ? 0 : Math.atan2(s, c) / (2 * Math.PI);
  }
  return out;
}

/** Cuts a pitch line into notes. */
export function lineToNotes(act: Activations, line: PitchLine): RawNote[] {
  const n = line.pitch.length;
  const offset = tuning(line);
  // Median over about 70 ms steadies vibrato and scoops.
  const half = 3;
  const smooth = new Float32Array(n).fill(NaN);
  const win: number[] = [];
  for (let t = 0; t < n; t++) {
    if (Number.isNaN(line.pitch[t])) continue;
    win.length = 0;
    for (let k = Math.max(0, t - half); k <= Math.min(n - 1, t + half); k++) {
      if (!Number.isNaN(line.pitch[k])) win.push(line.pitch[k] - offset[k]);
    }
    win.sort((a, b) => a - b);
    smooth[t] = win[win.length >> 1];
  }
  // A key must hold for a few frames before it counts as a new note, and the
  // line must move clearly away from the current key (not just past halfway).
  const minHold = 5;
  const away = 0.7;
  const notes: RawNote[] = [];
  let start = -1;
  let key = -1;
  let sum = 0;
  const finish = (end: number) => {
    if (start >= 0 && end - start >= minHold) {
      const s = frameTime(start);
      notes.push({ midi: key, start: s, dur: frameTime(end) - s, amp: Math.min(1, sum / (end - start)) });
    }
    start = -1;
  };
  for (let t = 0; t < n; t++) {
    const p = smooth[t];
    if (Number.isNaN(p)) {
      finish(t);
      continue;
    }
    if (start >= 0 && Math.abs(p - key) >= away) {
      const k = Math.round(p);
      let holds = 0;
      while (t + holds < n && Math.abs(smooth[t + holds] - k) < away && holds < minHold) holds++;
      if (holds >= minHold || (holds > 0 && t + holds >= n)) {
        finish(t);
      } else {
        sum += line.strength[t];
        continue;
      }
    }
    if (start >= 0 && t - start >= minHold && restruck(act, t, key)) finish(t);
    if (start < 0) {
      start = t;
      key = Math.round(p);
      sum = 0;
    }
    sum += line.strength[t];
  }
  finish(n);
  return mergeBlips(notes);
}

/** Folds very short notes that touch a neighbour a step or two away into it: they are slides, not notes. */
function mergeBlips(notes: RawNote[]): RawNote[] {
  const out: RawNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = { ...notes[i] };
    const prev = out[out.length - 1];
    const next = notes[i + 1];
    if (n.dur < 0.1) {
      const touchesPrev = prev && n.start - (prev.start + prev.dur) < 0.03 && Math.abs(prev.midi - n.midi) <= 2;
      const touchesNext = next && next.start - (n.start + n.dur) < 0.03 && Math.abs(next.midi - n.midi) <= 2;
      if (touchesPrev) {
        prev.dur = n.start + n.dur - prev.start;
        continue;
      }
      if (touchesNext) {
        notes[i + 1] = { ...next, start: n.start, dur: next.start + next.dur - n.start };
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

/** True when the network hears a fresh start of `key` at frame t (a repeated note). */
function restruck(act: Activations, t: number, key: number): boolean {
  const k = key - MIDI_OFFSET;
  if (k < 0 || k >= KEYS || t < 8 || t >= act.frameCount - 2) return false;
  const o = (f: number) => act.onsets[f * KEYS + k];
  const peak = o(t);
  if (peak < 0.55) return false;
  for (let x = t - 2; x <= t + 2; x++) if (x !== t && o(x) > peak) return false;
  // Rising out of quiet: vibrato wobbles the onset output too, but never from near zero.
  let quiet = 1;
  for (let x = t - 6; x <= t - 3; x++) quiet = Math.min(quiet, o(x));
  if (quiet >= 0.25) return false;
  if (peak > 0.85) return true;
  // Otherwise a real new syllable shows as a dip in loudness just before it.
  const f = (x: number) => act.frames[x * KEYS + k];
  let dip = 1;
  let before = 0;
  for (let x = t - 3; x <= t; x++) dip = Math.min(dip, f(x));
  for (let x = t - 10; x < t - 4; x++) before = Math.max(before, f(x));
  return dip < before * 0.8;
}

/** The sung tune of a band recording, as notes. */
export function extractMelody(act: Activations, options: MelodyOptions = {}): RawNote[] {
  return lineToNotes(act, trackLine(act, options));
}

/**
 * How much the line wobbles in pitch while it holds a note, in semitones.
 * Voices (vibrato, slides) wobble; pianos and most keyboards do not.
 */
export function wobble(line: PitchLine): number {
  const n = line.pitch.length;
  const devs: number[] = [];
  for (let t = 4; t < n - 4; t += 2) {
    const p = line.pitch[t];
    if (Number.isNaN(p) || line.strength[t] < 0.3) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let ok = true;
    for (let k = t - 4; k <= t + 4; k++) {
      const q = line.pitch[k];
      if (Number.isNaN(q) || Math.abs(q - p) > 0.8) {
        ok = false;
        break;
      }
      lo = Math.min(lo, q);
      hi = Math.max(hi, q);
    }
    if (ok) devs.push(hi - lo);
  }
  if (devs.length < 20) return 0;
  devs.sort((a, b) => a - b);
  return devs[devs.length >> 1];
}

import type { Note, Song } from '../song';
import { beatLength } from './practice';

/**
 * Pure maths for the falling-notes stage: which notes are on screen, where
 * the beat lines go, how far ahead we look. Kept free of DOM so it can be
 * tested and so the draw loop can call it every frame without allocating.
 */

/** Sorted start times and the longest note, built once per song for fast culling. */
export interface NoteIndex {
  notes: readonly Note[];
  starts: Float64Array;
  maxDur: number;
  sorted: boolean;
}

export function indexNotes(notes: readonly Note[]): NoteIndex {
  const starts = new Float64Array(notes.length);
  let maxDur = 0;
  let sorted = true;
  for (let i = 0; i < notes.length; i++) {
    starts[i] = notes[i].start;
    if (notes[i].dur > maxDur) maxDur = notes[i].dur;
    if (i > 0 && starts[i] < starts[i - 1]) sorted = false;
  }
  return { notes, starts, maxDur, sorted };
}

/** First index whose value is >= x (values ascending). */
export function lowerBound(values: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose value is > x (values ascending). */
export function upperBound(values: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A reusable [from, to) pair so the draw loop does not allocate. */
export interface Span {
  from: number;
  to: number;
}

/**
 * The index range of notes that may overlap song time [t0, t1]. Every note
 * outside it is certainly off screen; a few inside may still end before t0
 * (check `start + dur >= t0` when drawing). O(log n).
 */
export function visibleSpan(index: NoteIndex, t0: number, t1: number, out: Span = { from: 0, to: 0 }): Span {
  if (!index.sorted) {
    out.from = 0;
    out.to = index.starts.length;
    return out;
  }
  out.from = lowerBound(index.starts, t0 - index.maxDur);
  out.to = upperBound(index.starts, t1);
  return out;
}

/** Real seconds a note takes to fall from the top of the stage to the keys at normal speed. */
export const FALL_SECONDS = 2.6;

/**
 * Song seconds shown above the keys. Slower speeds show less song, which
 * spreads the notes out: a note always takes the same real time to fall.
 * `zoom` above 1 shows more.
 */
export function visibleSeconds(speed: number, zoom = 1): number {
  const s = Math.max(0.1, speed);
  return FALL_SECONDS * s * Math.max(0.25, zoom);
}

/** Moves `current` toward `target` smoothly; `rate` per second. Frame-rate independent. */
export function approach(current: number, target: number, dt: number, rate = 8): number {
  if (!Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return current + (target - current) * k;
}

/** Where beat lines go: explicit beat times, or an even grid from the tempo. */
export interface BeatGrid {
  beats: readonly number[] | null;
  period: number;
  offset: number;
  perBar: number;
}

export function beatGrid(song: Pick<Song, 'bpm' | 'beats' | 'timeSignature'>): BeatGrid | null {
  const perBar = song.timeSignature?.beats && song.timeSignature.beats > 0 ? Math.round(song.timeSignature.beats) : 4;
  if (song.beats && song.beats.length >= 2) {
    let ascending = true;
    for (let i = 1; i < song.beats.length; i++) if (!(song.beats[i] > song.beats[i - 1])) ascending = false;
    if (ascending) return { beats: song.beats, period: beatLength(song) ?? 0.5, offset: song.beats[0], perBar };
  }
  const period = beatLength(song);
  if (!period) return null;
  return { beats: null, period, offset: 0, perBar };
}

/** Index of the first beat at or after `t`. Beat k is at grid.beats[k] or offset + k * period. */
export function firstBeat(grid: BeatGrid, t: number): number {
  if (grid.beats) return lowerBound(grid.beats, t);
  return Math.max(0, Math.ceil((t - grid.offset) / grid.period - 1e-9));
}

/** Time of beat k, or NaN when the song has no such beat. */
export function beatTime(grid: BeatGrid, k: number): number {
  if (grid.beats) return k < grid.beats.length ? grid.beats[k] : Number.NaN;
  return grid.offset + k * grid.period;
}

/** How far into the current beat we are, 0..1, for pulsing things on the beat. 0 when unknown. */
export function beatPhase(grid: BeatGrid | null, t: number): number {
  if (!grid || t < 0) return 0;
  const k = firstBeat(grid, t + 1e-9) - 1;
  if (k < 0) return 0;
  const a = beatTime(grid, k);
  const b = beatTime(grid, k + 1);
  const len = Number.isFinite(b) ? b - a : grid.period;
  return len > 0 ? Math.min(1, Math.max(0, (t - a) / len)) : 0;
}

/** Horizontal scroll that centres `centre` in a view of `view` px over content `full` px wide. */
export function panFor(centre: number, full: number, view: number): number {
  if (full <= view) return 0;
  return Math.max(0, Math.min(full - view, centre - view / 2));
}

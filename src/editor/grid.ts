import type { Meta } from './model';

/**
 * The beat grid notes snap to. It follows the song's beat times when there are
 * any (from the recording), otherwise a steady tempo. Positions are measured
 * in beats: position 0 is the first beat, 1.5 is halfway between the second
 * and third beat. Before the first and after the last known beat the grid
 * carries on at the nearest beat's spacing.
 */
export interface Grid {
  /** Beat times in seconds, ascending, at least two. Null for a steady tempo. */
  beats: readonly number[] | null;
  bpm: number;
  /** Time of beat 0 for a steady tempo. */
  offset: number;
  beatsPerBar: number;
}

export const DEFAULT_BPM = 100;

/** Grid sizes offered in the editor, in beats. 0 turns snapping off. */
export const SNAP_OPTIONS: readonly { step: number; label: string }[] = [
  { step: 0, label: 'Off' },
  { step: -1, label: 'Bar' },
  { step: 1, label: '1 beat' },
  { step: 1 / 2, label: '1/2 beat' },
  { step: 1 / 3, label: '1/3 beat' },
  { step: 1 / 4, label: '1/4 beat' },
  { step: 1 / 6, label: '1/6 beat' },
  { step: 1 / 8, label: '1/8 beat' },
];

/** Turns a snap option into beats: -1 means a whole bar. */
export function stepBeats(grid: Grid, step: number): number {
  return step < 0 ? grid.beatsPerBar : step;
}

/** Spacing of a list of beats when it is steady enough to call a tempo, or null. */
export function steadyTempo(beats: readonly number[]): { bpm: number; offset: number } | null {
  if (beats.length < 2) return null;
  const span = beats[beats.length - 1] - beats[0];
  const period = span / (beats.length - 1);
  if (!(period > 0)) return null;
  for (let i = 1; i < beats.length; i++) {
    if (Math.abs(beats[i] - beats[i - 1] - period) > period * 0.02) return null;
  }
  const offset = beats[0] - Math.floor(beats[0] / period + 1e-9) * period;
  return { bpm: 60 / period, offset };
}

export function makeGrid(meta: Pick<Meta, 'bpm' | 'beats' | 'timeSignature'>): Grid {
  const beatsPerBar = meta.timeSignature?.beats ?? 4;
  const usable = meta.beats && meta.beats.length >= 2 && meta.beats.every((b, i, a) => i === 0 || b > a[i - 1]);
  if (usable && meta.beats) {
    const steady = steadyTempo(meta.beats);
    return {
      beats: meta.beats,
      bpm: meta.bpm ?? steady?.bpm ?? 60 / ((meta.beats[meta.beats.length - 1] - meta.beats[0]) / (meta.beats.length - 1)),
      offset: meta.beats[0],
      beatsPerBar,
    };
  }
  const bpm = meta.bpm && meta.bpm >= 20 && meta.bpm <= 400 ? meta.bpm : DEFAULT_BPM;
  return { beats: null, bpm, offset: 0, beatsPerBar };
}

/** Even beats from `offset` until `until` seconds, for saving a steady tempo that does not start at 0. */
export function evenBeats(bpm: number, offset: number, until: number): number[] {
  const period = 60 / bpm;
  const out: number[] = [];
  for (let t = offset; t <= until + period && out.length < 50_000; t += period) out.push(Math.round(t * 1000) / 1000);
  if (out.length < 2) out.push(Math.round((offset + period) * 1000) / 1000);
  return out;
}

/** Index of the last beat at or before t (clamped to the list). */
function beatIndex(beats: readonly number[], t: number): number {
  let lo = 0;
  let hi = beats.length - 2;
  if (t <= beats[0]) return 0;
  if (t >= beats[beats.length - 1]) return beats.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The grid position (in beats) of a time in seconds. */
export function beatPos(grid: Grid, t: number): number {
  const b = grid.beats;
  if (!b) return ((t - grid.offset) * grid.bpm) / 60;
  const i = beatIndex(b, t);
  return i + (t - b[i]) / (b[i + 1] - b[i]);
}

/** The time in seconds of a grid position. */
export function beatTime(grid: Grid, pos: number): number {
  const b = grid.beats;
  if (!b) return grid.offset + (pos * 60) / grid.bpm;
  const i = Math.max(0, Math.min(b.length - 2, Math.floor(pos)));
  return b[i] + (pos - i) * (b[i + 1] - b[i]);
}

const EPS = 1e-6;

/** Rounds a time to the nearest grid line. A step of 0 leaves it alone. */
export function snapTime(grid: Grid, t: number, step: number): number {
  if (step === 0) return t;
  const s = stepBeats(grid, step);
  return beatTime(grid, Math.round(beatPos(grid, t) / s) * s);
}

/** The grid line at or before a time (the cell a click landed in). */
export function snapFloor(grid: Grid, t: number, step: number): number {
  if (step === 0) return t;
  const s = stepBeats(grid, step);
  return beatTime(grid, Math.floor(beatPos(grid, t) / s + EPS) * s);
}

/** The length in seconds of one grid step starting near `t`. */
export function stepSeconds(grid: Grid, t: number, step: number): number {
  const s = stepBeats(grid, step === 0 ? 1 / 4 : step);
  const p = beatPos(grid, t);
  return Math.max(1e-3, beatTime(grid, p + s) - beatTime(grid, p));
}

export type LineKind = 'bar' | 'beat' | 'sub';
export interface GridLine {
  time: number;
  kind: LineKind;
  /** Bar number counting from 1, for bar lines. */
  bar?: number;
}

/**
 * Grid lines between two times. Subdivisions are left out when they would be
 * closer than `minPx`, and beats too when even those would be crowded.
 */
export function gridLines(grid: Grid, t0: number, t1: number, step: number, pxPerSec: number, minPx = 7): GridLine[] {
  const beatPx = (60 / grid.bpm) * pxPerSec;
  const sub = step > 0 && step < 1 && beatPx * step >= minPx ? step : 1;
  let unit = sub;
  if (beatPx < minPx) unit = grid.beatsPerBar;
  while (beatPx * unit < minPx && unit < 1e6) unit *= 2;
  const p0 = Math.floor(beatPos(grid, t0) / unit) * unit;
  const p1 = beatPos(grid, t1);
  const out: GridLine[] = [];
  for (let k = 0; ; k++) {
    const p = p0 + k * unit;
    if (p > p1 + EPS || out.length > 5000) break;
    const near = Math.round(p);
    const whole = Math.abs(p - near) < EPS;
    const isBar = whole && ((near % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
    const time = beatTime(grid, p);
    if (isBar) out.push({ time, kind: 'bar', bar: Math.floor(near / grid.beatsPerBar) + 1 });
    else out.push({ time, kind: whole ? 'beat' : 'sub' });
  }
  return out;
}

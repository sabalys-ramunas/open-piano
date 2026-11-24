import type { EdNote } from './model';

/**
 * What part of the piano roll is on screen. Time runs left to right, pitch
 * bottom to top. Coordinates are CSS pixels inside the note area (the ruler
 * and the key strip are outside it).
 */
export interface Viewport {
  /** Time at the left edge, seconds. */
  t0: number;
  pxPerSec: number;
  /** Pitch at the top edge: the top of the row of key `top - 1`. Fractional while scrolling. */
  top: number;
  /** Height of one key row in pixels. */
  rowH: number;
  width: number;
  height: number;
}

/** Lowest and highest keys the roll can show (a little past the piano, so stray notes are visible). */
export const VIEW_LO = 12;
export const VIEW_HI = 119;
export const ZOOM_X = { min: 6, max: 2400 };
export const ZOOM_Y = { min: 6, max: 44 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const xOf = (v: Viewport, t: number): number => (t - v.t0) * v.pxPerSec;
export const timeAt = (v: Viewport, x: number): number => v.t0 + x / v.pxPerSec;
/** Top edge of the row for `midi`. */
export const yOf = (v: Viewport, midi: number): number => (v.top - midi - 1) * v.rowH;
/** The key whose row contains y. */
export const midiAt = (v: Viewport, y: number): number => Math.floor(v.top - y / v.rowH);

/** Keeps the view inside the song and the keyboard. */
export function clampView(v: Viewport, length: number): Viewport {
  const rows = v.height / v.rowH;
  const pxPerSec = clamp(v.pxPerSec, ZOOM_X.min, ZOOM_X.max);
  const visible = v.width / pxPerSec;
  const maxT0 = Math.max(0, length + 2 - visible * 0.5);
  const rowH = clamp(v.rowH, ZOOM_Y.min, ZOOM_Y.max);
  const r = v.height / rowH;
  const lowTop = Math.min(VIEW_HI + 1, VIEW_LO + r);
  return {
    ...v,
    pxPerSec,
    rowH,
    t0: clamp(v.t0, -0.5, maxT0),
    top: rows >= VIEW_HI + 1 - VIEW_LO ? VIEW_HI + 1 : clamp(v.top, lowTop, VIEW_HI + 1),
  };
}

/** Zooms time around the point x (which stays under the pointer). */
export function zoomTime(v: Viewport, factor: number, x: number): Viewport {
  const t = timeAt(v, x);
  const pxPerSec = clamp(v.pxPerSec * factor, ZOOM_X.min, ZOOM_X.max);
  return { ...v, pxPerSec, t0: t - x / pxPerSec };
}

/** Zooms pitch around the point y. */
export function zoomPitch(v: Viewport, factor: number, y: number): Viewport {
  const p = v.top - y / v.rowH;
  const rowH = clamp(v.rowH * factor, ZOOM_Y.min, ZOOM_Y.max);
  return { ...v, rowH, top: p + y / rowH };
}

/** Scrolls by pixels: positive dx moves later in time, positive dy moves down in pitch. */
export function scrollBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, t0: v.t0 + dx / v.pxPerSec, top: v.top - dy / v.rowH };
}

/** Shows all of `t0..t1` and the keys `lo..hi`, as far as zoom limits allow. */
export function fitView(v: Viewport, t0: number, t1: number, lo: number, hi: number): Viewport {
  const span = Math.max(2, t1 - t0);
  const pxPerSec = clamp((v.width * 0.94) / span, ZOOM_X.min, ZOOM_X.max);
  const keys = Math.max(14, hi - lo + 5);
  const rowH = clamp(v.height / keys, ZOOM_Y.min, ZOOM_Y.max);
  const mid = (lo + hi + 1) / 2;
  return { ...v, pxPerSec, rowH, t0: t0 - (v.width * 0.03) / pxPerSec, top: mid + v.height / rowH / 2 };
}

/** Scrolls just enough to bring `t` into view, keeping a margin. */
export function revealTime(v: Viewport, t: number, margin = 0.1): Viewport {
  const visible = v.width / v.pxPerSec;
  if (t < v.t0 + visible * margin * 0.5) return { ...v, t0: t - visible * margin };
  if (t > v.t0 + visible * (1 - margin * 0.5)) return { ...v, t0: t - visible * (1 - margin) };
  return v;
}

/** Scrolls just enough to bring the row of `midi` into view. */
export function revealPitch(v: Viewport, midi: number): Viewport {
  const rows = v.height / v.rowH;
  if (midi + 1 > v.top - 0.5) return { ...v, top: midi + 2 };
  if (midi < v.top - rows + 0.5) return { ...v, top: midi - 1 + rows };
  return v;
}

export type HitPart = 'body' | 'start' | 'end';

/**
 * The note under a point and which part of it: an edge (to resize) or the
 * body (to move). Later notes win, matching the drawing order. Very short
 * notes keep a grab area in the middle so they can still be moved.
 */
export function hitTest(notes: readonly EdNote[], v: Viewport, x: number, y: number, edgePx = 7): { note: EdNote; part: HitPart } | null {
  const midi = midiAt(v, y);
  const t = timeAt(v, x);
  const slack = edgePx / v.pxPerSec;
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.midi !== midi) continue;
    if (t < n.start - slack * 0.5 || t > n.start + n.dur + slack * 0.5) continue;
    const w = n.dur * v.pxPerSec;
    const px = (t - n.start) * v.pxPerSec;
    const edge = Math.min(edgePx, w / 3);
    if (px >= w - edge) return { note: n, part: 'end' };
    if (px <= edge && w > 18) return { note: n, part: 'start' };
    return { note: n, part: 'body' };
  }
  return null;
}

/** The index of the first note that could be visible at time t0, given the longest note. */
export function firstVisible(notes: readonly EdNote[], t0: number, longest: number): number {
  let lo = 0;
  let hi = notes.length;
  const from = t0 - longest;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

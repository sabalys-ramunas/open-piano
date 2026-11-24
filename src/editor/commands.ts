import type { Hand } from '../song';
import { snapTime, stepBeats, beatPos, beatTime, type Grid } from './grid';
import { MAX_TIME, MIN_DUR, MAX_DUR, PIANO_HI, PIANO_LO, makeNote, sortEd, type Doc, type EdNote, type Meta } from './model';

/**
 * Pure editing operations. Each takes a Doc and returns a new one (or the same
 * Doc when nothing changed, so no empty undo steps are made).
 */

export type Ids = ReadonlySet<number>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function withNotes(doc: Doc, notes: readonly EdNote[]): Doc {
  return { ...doc, notes: sortEd(notes) };
}

/** Changes the notes in `ids` with `fn`. Returns the same Doc if nothing changed. */
function mapSelected(doc: Doc, ids: Ids, fn: (n: EdNote) => EdNote): Doc {
  let changed = false;
  const notes = doc.notes.map((n) => {
    if (!ids.has(n.id)) return n;
    const next = fn(n);
    if (next.midi !== n.midi || next.start !== n.start || next.dur !== n.dur || next.hand !== n.hand) {
      changed = true;
      return next;
    }
    return n;
  });
  return changed ? withNotes(doc, notes) : doc;
}

export function selected(doc: Doc, ids: Ids): EdNote[] {
  return doc.notes.filter((n) => ids.has(n.id));
}

export function addNotes(doc: Doc, notes: readonly EdNote[]): Doc {
  if (notes.length === 0) return doc;
  return withNotes(doc, [...doc.notes, ...notes]);
}

export function deleteNotes(doc: Doc, ids: Ids): Doc {
  if (!doc.notes.some((n) => ids.has(n.id))) return doc;
  return { ...doc, notes: doc.notes.filter((n) => !ids.has(n.id)) };
}

/**
 * Limits a move so the whole group stays on the piano and after time 0. Notes
 * already off the piano may still move back towards it.
 */
export function limitMove(notes: readonly EdNote[], dt: number, dmidi: number): { dt: number; dmidi: number } {
  if (notes.length === 0) return { dt: 0, dmidi: 0 };
  let minStart = Infinity;
  let maxStart = -Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    minStart = Math.min(minStart, n.start);
    maxStart = Math.max(maxStart, n.start);
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  return {
    dt: clamp(dt, -minStart, MAX_TIME - maxStart),
    dmidi: clamp(Math.round(dmidi), Math.min(0, PIANO_LO - lo), Math.max(0, PIANO_HI - hi)),
  };
}

/** Moves notes in time and/or pitch, as a group. */
export function moveNotes(doc: Doc, ids: Ids, dt: number, dmidi: number): Doc {
  const lim = limitMove(selected(doc, ids), dt, dmidi);
  if (lim.dt === 0 && lim.dmidi === 0) return doc;
  return mapSelected(doc, ids, (n) => ({ ...n, start: n.start + lim.dt, midi: n.midi + lim.dmidi }));
}

/** Makes notes longer or shorter by moving their end (`edge` end) or start (`edge` start). */
export function resizeNotes(doc: Doc, ids: Ids, delta: number, edge: 'start' | 'end'): Doc {
  if (delta === 0) return doc;
  return mapSelected(doc, ids, (n) => {
    if (edge === 'end') return { ...n, dur: clamp(n.dur + delta, MIN_DUR, MAX_DUR) };
    const end = n.start + n.dur;
    const start = clamp(n.start + delta, Math.max(0, end - MAX_DUR), end - MIN_DUR);
    return { ...n, start, dur: end - start };
  });
}

/** Puts notes in one hand, or swaps each note's hand with 'swap'. */
export function setHand(doc: Doc, ids: Ids, hand: Hand | 'swap'): Doc {
  return mapSelected(doc, ids, (n) => ({ ...n, hand: hand === 'swap' ? (n.hand === 'right' ? 'left' : 'right') : hand }));
}

/**
 * Snaps note starts to the grid and, with `ends`, note ends too. A note never
 * shrinks to nothing: it keeps at least one grid step.
 */
export function quantise(doc: Doc, ids: Ids, grid: Grid, step: number, ends = true): Doc {
  if (step === 0) return doc;
  const s = stepBeats(grid, step);
  return mapSelected(doc, ids, (n) => {
    const start = Math.max(0, snapTime(grid, n.start, step));
    if (!ends) return { ...n, start };
    let end = snapTime(grid, n.start + n.dur, step);
    if (end <= start + 1e-6) end = beatTime(grid, beatPos(grid, start) + s);
    return { ...n, start, dur: clamp(end - start, MIN_DUR, MAX_DUR) };
  });
}

/** Notes copied for pasting: times are relative to the earliest copied note. */
export interface Clip {
  notes: { midi: number; start: number; dur: number; hand: Hand }[];
  /** From the first start to the last end, in seconds. */
  span: number;
}

export function copyClip(doc: Doc, ids: Ids): Clip | null {
  const notes = selected(doc, ids);
  if (notes.length === 0) return null;
  const t0 = Math.min(...notes.map((n) => n.start));
  const end = Math.max(...notes.map((n) => n.start + n.dur));
  return { notes: notes.map((n) => ({ midi: n.midi, start: n.start - t0, dur: n.dur, hand: n.hand })), span: end - t0 };
}

/** Pastes a clip so its first note starts at `at`. Returns the new note ids too. */
export function pasteClip(doc: Doc, clip: Clip, at: number): { doc: Doc; ids: Set<number> } {
  const added = clip.notes.map((n) => makeNote(n.midi, at + n.start, n.dur, n.hand));
  return { doc: addNotes(doc, added), ids: new Set(added.map((n) => n.id)) };
}

/**
 * Copies the selection to just after itself. With a grid step the copy lands
 * on the next grid line at or after the selection's end.
 */
export function duplicate(doc: Doc, ids: Ids, grid: Grid | null, step: number): { doc: Doc; ids: Set<number> } {
  const clip = copyClip(doc, ids);
  if (!clip) return { doc, ids: new Set(ids) };
  const notes = selected(doc, ids);
  const t0 = Math.min(...notes.map((n) => n.start));
  let at = t0 + clip.span;
  if (grid && step !== 0) {
    // Keep the copy in the same place in the beat as the original.
    const s = stepBeats(grid, step);
    const p0 = beatPos(grid, t0);
    const pend = beatPos(grid, t0 + clip.span);
    const steps = Math.max(1, Math.ceil((pend - p0) / s - 1e-6));
    at = beatTime(grid, p0 + steps * s);
  }
  return pasteClip(doc, clip, at);
}

/** Ids of notes that touch a box in time (seconds) and pitch (inclusive). */
export function idsInBox(notes: readonly EdNote[], t0: number, t1: number, m0: number, m1: number): number[] {
  const [ta, tb] = t0 <= t1 ? [t0, t1] : [t1, t0];
  const [ma, mb] = m0 <= m1 ? [m0, m1] : [m1, m0];
  return notes.filter((n) => n.midi >= ma && n.midi <= mb && n.start < tb && n.start + n.dur > ta).map((n) => n.id);
}

export function updateMeta(doc: Doc, patch: Partial<Meta>): Doc {
  let changed = false;
  const meta: Meta = { ...doc.meta };
  for (const [key, value] of Object.entries(patch) as [keyof Meta, Meta[keyof Meta]][]) {
    if (JSON.stringify(meta[key]) === JSON.stringify(value)) continue;
    changed = true;
    if (value === undefined) delete meta[key];
    else Object.assign(meta, { [key]: value });
  }
  return changed ? { ...doc, meta } : doc;
}

/** The note just after (dir 1) or before (dir -1) the given one in time order, or the first/last note. */
export function neighbour(doc: Doc, id: number | null, dir: 1 | -1): EdNote | null {
  const notes = doc.notes;
  if (notes.length === 0) return null;
  const i = id === null ? -1 : notes.findIndex((n) => n.id === id);
  if (i < 0) return dir === 1 ? notes[0] : notes[notes.length - 1];
  return notes[clamp(i + dir, 0, notes.length - 1)];
}

import type { Hand } from '../song';
import { noteName } from '../song';
import { withNotes, type Ids } from './commands';
import { MAX_TIME, inPiano, type Doc, type EdNote } from './model';

/**
 * Tools for cleaning up a first draft. Each works on the notes in `scope`, or
 * on every note when `scope` is null or empty, and reports how much it changed.
 */

const inScope = (scope: Ids | null) => (n: EdNote) => !scope || scope.size === 0 || scope.has(n.id);

/** Removes notes shorter than `minDur` seconds. */
export function removeShort(doc: Doc, minDur: number, scope: Ids | null = null): { doc: Doc; count: number } {
  const pick = inScope(scope);
  const keep = doc.notes.filter((n) => !(pick(n) && n.dur < minDur));
  const count = doc.notes.length - keep.length;
  return { doc: count ? { ...doc, notes: keep } : doc, count };
}

/**
 * Joins notes that were broken into pieces: the same key in the same hand,
 * where the next piece starts less than `maxGap` seconds after the last one
 * ends (or overlaps it). Returns how many pieces were joined away.
 */
export function joinBroken(doc: Doc, maxGap: number, scope: Ids | null = null): { doc: Doc; count: number } {
  const pick = inScope(scope);
  const groups = new Map<string, EdNote[]>();
  const rest: EdNote[] = [];
  for (const n of doc.notes) {
    if (!pick(n)) {
      rest.push(n);
      continue;
    }
    const key = `${n.midi}:${n.hand}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(n);
  }
  let count = 0;
  const out = [...rest];
  for (const list of groups.values()) {
    let cur: EdNote = list[0];
    for (let i = 1; i < list.length; i++) {
      const n = list[i];
      if (n.start <= cur.start + cur.dur + maxGap) {
        const end = Math.max(cur.start + cur.dur, n.start + n.dur);
        cur = { ...cur, dur: end - cur.start };
        count++;
      } else {
        out.push(cur);
        cur = n;
      }
    }
    out.push(cur);
  }
  return { doc: count ? withNotes(doc, out) : doc, count };
}

/** Notes below `split` go to the left hand, the rest to the right. */
export function splitHands(doc: Doc, split: number, scope: Ids | null = null): { doc: Doc; count: number } {
  const pick = inScope(scope);
  let count = 0;
  const notes = doc.notes.map((n) => {
    if (!pick(n)) return n;
    const hand: Hand = n.midi < split ? 'left' : 'right';
    if (hand === n.hand) return n;
    count++;
    return { ...n, hand };
  });
  return { doc: count ? { ...doc, notes } : doc, count };
}

/**
 * Moves notes earlier (negative) or later in time, e.g. to line them up with
 * the recording. The move is limited so no note starts before 0. Returns the
 * move that was actually made.
 */
export function shiftTime(doc: Doc, dt: number, scope: Ids | null = null): { doc: Doc; dt: number } {
  const pick = inScope(scope);
  const moving = doc.notes.filter(pick);
  if (moving.length === 0 || dt === 0) return { doc, dt: 0 };
  const minStart = Math.min(...moving.map((n) => n.start));
  const maxStart = Math.max(...moving.map((n) => n.start));
  const real = Math.min(MAX_TIME - maxStart, Math.max(-minStart, dt));
  if (real === 0) return { doc, dt: 0 };
  const notes = doc.notes.map((n) => (pick(n) ? { ...n, start: n.start + real } : n));
  return { doc: withNotes(doc, notes), dt: real };
}

/** Shortens notes that run into the next note on the same key. Returns how many were shortened. */
export function fixOverlaps(doc: Doc, scope: Ids | null = null): { doc: Doc; count: number } {
  const pick = inScope(scope);
  const byKey = new Map<number, EdNote[]>();
  for (const n of doc.notes) {
    let list = byKey.get(n.midi);
    if (!list) byKey.set(n.midi, (list = []));
    list.push(n);
  }
  const changed = new Map<number, EdNote>();
  const dropped = new Set<number>();
  for (const list of byKey.values()) {
    for (let i = 0; i + 1 < list.length; i++) {
      const a = changed.get(list[i].id) ?? list[i];
      const b = list[i + 1];
      if (!pick(a) && !pick(b)) continue;
      if (a.start + a.dur <= b.start + 1e-4) continue;
      const dur = b.start - a.start - 0.01;
      if (dur < 0.02) {
        // Two notes on the same key at the same moment: keep the longer one.
        const [lose, win] = a.dur >= b.dur ? [b, a] : [a, b];
        dropped.add(lose.id);
        if (win === a) list[i + 1] = a;
      } else {
        changed.set(a.id, { ...a, dur });
      }
    }
  }
  const count = changed.size + dropped.size;
  if (!count) return { doc, count };
  const notes = doc.notes.filter((n) => !dropped.has(n.id)).map((n) => changed.get(n.id) ?? n);
  return { doc: { ...doc, notes }, count };
}

/** Moves notes that are off the piano by whole octaves until they fit. */
export function foldIntoPiano(doc: Doc): { doc: Doc; count: number } {
  let count = 0;
  const notes = doc.notes.map((n) => {
    if (inPiano(n.midi)) return n;
    let midi = n.midi;
    while (midi < 21) midi += 12;
    while (midi > 108) midi -= 12;
    count++;
    return { ...n, midi };
  });
  return { doc: count ? withNotes(doc, notes) : doc, count };
}

export type ProblemKind = 'overlap' | 'range' | 'stretch' | 'crowded' | 'tiny';

export interface Problem {
  kind: ProblemKind;
  ids: number[];
  /** Where it happens, in seconds. */
  time: number;
  message: string;
}

export interface ProblemOptions {
  /** Widest comfortable reach for one hand, in keys (semitones). 12 is an octave. */
  maxStretch: number;
  /** Most notes one hand can hold at once. */
  maxNotes: number;
  /** Notes shorter than this (seconds) are reported as very short. */
  tiny: number;
}

const DEFAULTS: ProblemOptions = { maxStretch: 12, maxNotes: 5, tiny: 0.05 };
const TOGETHER = 0.03;

/**
 * Finds things that make a lesson wrong or unplayable: notes on the same key
 * that overlap, notes off the piano, chords too wide or too full for one hand,
 * and very short notes (usually left over from a draft).
 */
export function findProblems(notes: readonly EdNote[], options: Partial<ProblemOptions> = {}): Problem[] {
  const opt = { ...DEFAULTS, ...options };
  const out: Problem[] = [];

  const byKey = new Map<number, EdNote[]>();
  for (const n of notes) {
    if (!inPiano(n.midi)) {
      out.push({ kind: 'range', ids: [n.id], time: n.start, message: 'This note is outside the piano' });
    }
    if (n.dur < opt.tiny) out.push({ kind: 'tiny', ids: [n.id], time: n.start, message: 'Very short note' });
    let list = byKey.get(n.midi);
    if (!list) byKey.set(n.midi, (list = []));
    list.push(n);
  }
  for (const list of byKey.values()) {
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (b.start < a.start + a.dur - 0.005) {
        out.push({ kind: 'overlap', ids: [a.id, b.id], time: b.start, message: `Two ${noteName(a.midi)} notes overlap` });
      }
    }
  }

  for (const hand of ['right', 'left'] as const) {
    const mine = notes.filter((n) => n.hand === hand);
    let lastKey = '';
    let active: EdNote[] = [];
    for (let i = 0; i < mine.length; i++) {
      const t = mine[i].start;
      // Every note that starts together with this one.
      let j = i;
      while (j + 1 < mine.length && mine[j + 1].start - t <= TOGETHER) j++;
      active = active.filter((n) => n.start + n.dur > t + TOGETHER);
      for (let k = i; k <= j; k++) active.push(mine[k]);
      i = j;
      if (active.length < 2) continue;
      const key = active.map((n) => n.id).sort((a, b) => a - b).join(',');
      if (key === lastKey) continue;
      lastKey = key;
      const lo = Math.min(...active.map((n) => n.midi));
      const hi = Math.max(...active.map((n) => n.midi));
      const ids = active.map((n) => n.id);
      const who = hand === 'right' ? 'right hand' : 'left hand';
      if (hi - lo > opt.maxStretch) {
        out.push({ kind: 'stretch', ids, time: t, message: `Too wide for the ${who} (${hi - lo} keys apart)` });
      }
      if (active.length > opt.maxNotes) {
        out.push({ kind: 'crowded', ids, time: t, message: `${active.length} notes at once in the ${who}` });
      }
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Every note id that has a problem. */
export function problemIds(problems: readonly Problem[]): Set<number> {
  const ids = new Set<number>();
  for (const p of problems) for (const id of p.ids) ids.add(id);
  return ids;
}

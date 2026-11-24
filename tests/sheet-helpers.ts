import type { Event, Measure, MetricScore, Score } from '../src/sheet/score';
import { LETTERS } from '../src/sheet/theory';
import { seq, sortNotes, type Note } from '../src/song';

const ALTER = (a: number) => (a === 1 ? '#' : a === -1 ? 'b' : a === 2 ? '##' : a === -2 ? 'bb' : '');
const SIGN = (a: number) => (a === 1 ? '#' : a === -1 ? 'b' : a === 0 ? 'n' : '?');

/**
 * Writes an event compactly: `C4/4`, `E4/4.`, `D#5/16` (spelled pitch), a
 * printed accidental in brackets `(#)D#5/16`, `~` when tied onwards, `r8` a
 * rest, `R` a whole-bar rest. Chords join with `+`.
 */
export function tok(e: Event, accidentals = false): string {
  const v = `${e.base}${'.'.repeat(e.dots)}`;
  if (e.kind === 'rest') return e.full ? 'R' : `r${v}`;
  const heads = e.heads
    .map((h) => `${accidentals && h.accidental !== null ? `(${SIGN(h.accidental)})` : ''}${LETTERS[h.spelled.letter]}${ALTER(h.spelled.alter)}${h.spelled.octave}`)
    .join('+');
  return `${heads}/${v}${e.heads.some((h) => h.tieStart) ? '~' : ''}`;
}

export function bar(m: Measure, staff: 0 | 1, accidentals = false): string {
  return m.staves[staff].map((e) => tok(e, accidentals)).join(' ');
}

export function metric(score: Score): MetricScore {
  if (score.kind !== 'metric') throw new Error('expected a metric score');
  return score;
}

/** Deterministic pseudo random numbers. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Roughly normal noise with the given spread. */
export function noise(rand: () => number, spread: number): number {
  return (rand() + rand() + rand() - 1.5) * spread * 1.4;
}

/**
 * Plays notes like a person: onsets jitter, the tempo drifts, and fingers lift
 * a bit early.
 */
export function humanise(notes: readonly Note[], seed: number, opts: { jitter?: number; drift?: number; legato?: number } = {}): Note[] {
  const rand = rng(seed);
  const jitter = opts.jitter ?? 0.02;
  const drift = opts.drift ?? 0.06;
  const legato = opts.legato ?? 0.85;
  const end = Math.max(...notes.map((n) => n.start + n.dur));
  // Time warp: slowly speeds up by `drift` over the piece.
  const warp = (t: number) => t * (1 - (drift * t) / (2 * end));
  const chordOffsets = new Map<number, number>();
  return sortNotes(
    notes.map((n) => {
      const key = Math.round(n.start * 1000);
      if (!chordOffsets.has(key)) chordOffsets.set(key, noise(rand, jitter));
      const start = Math.max(0, warp(n.start) + chordOffsets.get(key)! + noise(rand, jitter * 0.25));
      const dur = Math.max(0.05, (warp(n.start + n.dur / 0.92) - warp(n.start)) * (legato + noise(rand, 0.06)));
      return { ...n, start, dur };
    }),
  );
}

export const TWINKLE = sortNotes([
  ...seq(
    'right',
    0.5,
    `C4/1 C4/1 G4/1 G4/1 A4/1 A4/1 G4/2 F4/1 F4/1 E4/1 E4/1 D4/1 D4/1 C4/2
     G4/1 G4/1 F4/1 F4/1 E4/1 E4/1 D4/2 G4/1 G4/1 F4/1 F4/1 E4/1 E4/1 D4/2
     C4/1 C4/1 G4/1 G4/1 A4/1 A4/1 G4/2 F4/1 F4/1 E4/1 E4/1 D4/1 D4/1 C4/2`,
  ),
  ...seq(
    'left',
    0.5,
    `C3/4 F3/2 C3/2 F3/2 C3/2 G2/2 C3/2
     C3/2 F3/2 C3/2 G2/2 C3/2 F3/2 C3/2 G2/2
     C3/4 F3/2 C3/2 F3/2 C3/2 G2/2 C3/2`,
  ),
]);

export const ODE = sortNotes([
  ...seq(
    'right',
    0.25,
    `E4/2 E4/2 F4/2 G4/2 G4/2 F4/2 E4/2 D4/2 C4/2 C4/2 D4/2 E4/2 E4/3 D4/1 D4/4
     E4/2 E4/2 F4/2 G4/2 G4/2 F4/2 E4/2 D4/2 C4/2 C4/2 D4/2 E4/2 D4/3 C4/1 C4/4`,
  ),
  ...seq('left', 0.25, 'C3/8 G2/8 C3/8 G2/8 C3/8 G2/8 C3/8 G2/4 C3/4'),
]);

export const ELISE = sortNotes([
  ...seq(
    'right',
    0.2,
    `E5/1 D#5/1
     E5/1 D#5/1 E5/1 B4/1 D5/1 C5/1
     A4/2 _/1 C4/1 E4/1 A4/1
     B4/2 _/1 E4/1 G#4/1 B4/1
     C5/2 _/1 E4/1 E5/1 D#5/1
     E5/1 D#5/1 E5/1 B4/1 D5/1 C5/1
     A4/2 _/1 C4/1 E4/1 A4/1
     B4/2 _/1 E4/1 C5/1 B4/1
     A4/4`,
  ),
  ...seq(
    'left',
    0.2,
    `_/8
     A2/1 E3/1 A3/1 _/3
     E2/1 E3/1 G#3/1 _/3
     A2/1 E3/1 A3/1 _/3
     _/6
     A2/1 E3/1 A3/1 _/3
     E2/1 E3/1 G#3/1 _/3
     A2/1 E3/1 A3/2`,
  ),
]);

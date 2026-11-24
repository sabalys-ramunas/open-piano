// Measures for chord detection and piano arrangements, shared by the unit tests
// and scripts/arrange-bench.test.ts. Everything a listener would notice and a
// teacher would mark: wrong chords, flicker, notes outside the chord, muddy low
// intervals, jumpy voicings, too many notes, stretches, crossed hands and a
// covered tune.
import type { Note, TimedChord } from '../src/song';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

export interface ChordTruth {
  start: number;
  dur: number;
  label: string;
  root: number;
  bass: number;
  third: 'maj' | 'min';
  tones: number[];
}

/** Root, third class and bass of a label like "Am7", "G/B", "Csus4"; undefined for anything else. */
export function readLabel(label: string): { root: number; third: 'maj' | 'min'; bass: number; seventh: boolean } | undefined {
  const m = /^([A-G][#b]?)(maj7|m7|m6|m|7|sus4|sus2|dim|aug|6|5)?(?:\/([A-G][#b]?))?$/.exec(label);
  if (!m) return undefined;
  const pc = (s: string) => NAMES.indexOf(FLAT[s] ?? s);
  const root = pc(m[1]);
  const q = m[2] ?? '';
  return { root, third: q === 'm' || q === 'm7' || q === 'dim' ? 'min' : 'maj', bass: m[3] ? pc(m[3]) : root, seventh: q.includes('7') };
}

const at = <T extends { start: number; dur: number }>(list: readonly T[], t: number) =>
  list.find((c) => t >= c.start && t < c.start + c.dur);

/** Per-beat chord scores, sampled at the middle of each true beat. */
export function chordAccuracy(truth: readonly ChordTruth[], found: readonly TimedChord[], beats: readonly number[]) {
  let n = 0;
  let root = 0;
  let majmin = 0;
  let bass = 0;
  let full = 0;
  let wrongThird = 0;
  let wrongRoot = 0;
  let power = 0;
  for (let i = 0; i + 1 < beats.length; i++) {
    const t = (beats[i] + beats[i + 1]) / 2;
    const want = at(truth, t);
    if (!want) continue;
    n++;
    const got = at(found, t);
    const g = got && readLabel(got.label);
    if (!g) continue;
    const w = readLabel(want.label)!;
    const isPower = /^[A-G][#b]?5(\/|$)/.test(got!.label);
    if (isPower) power++;
    if (g.root !== want.root) wrongRoot++;
    else if (!isPower && g.third !== want.third) wrongThird++;
    if (g.root === want.root) root++;
    if (g.root === want.root && g.third === want.third) majmin++;
    if (g.bass === want.bass) bass++;
    if (g.root === want.root && g.third === want.third && g.bass === want.bass && g.seventh === w.seventh) full++;
  }
  const pct = (x: number) => (n ? x / n : 0);
  return {
    beats: n,
    root: pct(root),
    majmin: pct(majmin),
    bass: pct(bass),
    full: pct(full),
    /** Beats with a wrong root, or the right root with the wrong third: what the ear hears as a wrong chord. */
    wrong: pct(wrongRoot + wrongThird),
    /** Beats played as root and fifth only (the safe fallback). */
    power: pct(power),
  };
}

/** Chord changes per bar inside the span of the truth. */
export function flicker(chords: readonly { start: number; dur: number; label: string }[], from: number, to: number, barSeconds: number): number {
  const inside = chords.filter((c) => c.start + c.dur > from + 0.05 && c.start < to - 0.05);
  let changes = 0;
  for (let i = 1; i < inside.length; i++) if (inside[i].label !== inside[i - 1].label) changes++;
  return changes / Math.max(1, (to - from) / barSeconds);
}

/**
 * Lowest pitch at which each interval (in semitones) still sounds clear, after
 * the usual low interval limits chart: minor 2nd E3, major 2nd Eb3, minor 3rd C3,
 * major 3rd Bb2, 4th A2, tritone Bb2, 5th Bb1, minor 6th G2, major 6th F2,
 * sevenths F2. Octaves are clear anywhere.
 */
export const LOW_LIMIT: Record<number, number> = { 1: 52, 2: 51, 3: 48, 4: 46, 5: 45, 6: 46, 7: 34, 8: 43, 9: 41, 10: 41, 11: 41 };

const sounding = (notes: readonly Note[], t: number) => notes.filter((n) => n.start <= t + 1e-6 && t < n.start + n.dur - 1e-6);

/** The tune: the top right-hand note of each right-hand strike. */
export function melodyOf(notes: readonly Note[]): Note[] {
  const right = notes.filter((n) => n.hand === 'right');
  const byStart = new Map<number, Note>();
  for (const n of right) {
    const k = Math.round(n.start * 1000);
    const cur = byStart.get(k);
    if (!cur || n.midi > cur.midi) byStart.set(k, n);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

export interface ArrangementReport {
  notes: number;
  seconds: number;
  /** Onsets per second while the hand is playing, per hand. */
  rate: { right: number; left: number };
  /** Most onsets in any one second, per hand. */
  peak: { right: number; left: number };
  /** Widest stretch of notes sounding together, per hand. */
  span: { right: number; left: number };
  /** Widest stretch of a hand's notes struck within one beat (broken patterns), per hand. */
  reach: { right: number; left: number };
  /** Accompaniment notes whose pitch class is not in the true chord (or its bass). */
  nonChordTone: number;
  /** Onsets where two adjacent sounding notes break the low interval limits. */
  lowIntervalViolations: number;
  /** Simultaneous left-hand notes below C3 that are not an octave or a fifth apart. */
  lowClusters: number;
  /** Mean semitones each upper left-hand voice moves at a chord change. */
  voiceLeading: number;
  /** Left-hand jumps over an octave within 0.4 s. */
  bigJumps: number;
  /** Moments where the left hand reaches the right. */
  crossings: number;
  /** Accompaniment notes sounding at or above the tune (or a step under it, struck together). */
  masked: number;
  /** Most notes one hand holds at once. */
  maxChord: { right: number; left: number };
}

export function measure(notes: readonly Note[], truth: readonly ChordTruth[], beatSeconds: number): ArrangementReport {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const tune = new Set(melodyOf(sorted));
  const accompaniment = sorted.filter((n) => !tune.has(n));
  const end = Math.max(0, ...sorted.map((n) => n.start + n.dur));
  const first = sorted.length ? sorted[0].start : 0;
  const seconds = Math.max(1e-9, end - first);
  const hands = { right: sorted.filter((n) => n.hand === 'right'), left: sorted.filter((n) => n.hand === 'left') };
  const onsets = (list: Note[]) => [...new Set(list.map((n) => Math.round(n.start * 1000) / 1000))].sort((a, b) => a - b);
  const rate = { right: 0, left: 0 };
  const peak = { right: 0, left: 0 };
  const span = { right: 0, left: 0 };
  const reach = { right: 0, left: 0 };
  const maxChord = { right: 0, left: 0 };
  for (const hand of ['right', 'left'] as const) {
    const list = hands[hand];
    const on = onsets(list);
    if (on.length === 0) continue;
    const active = Math.max(1, Math.max(...list.map((n) => n.start + n.dur)) - on[0]);
    rate[hand] = on.length / active;
    for (let i = 0, j = 0; i < on.length; i++) {
      while (j < on.length && on[j] < on[i] + 1 - 1e-9) j++;
      peak[hand] = Math.max(peak[hand], j - i);
    }
    for (const t of on) {
      const now = sounding(list, t);
      maxChord[hand] = Math.max(maxChord[hand], now.length);
      if (now.length > 1) span[hand] = Math.max(span[hand], Math.max(...now.map((n) => n.midi)) - Math.min(...now.map((n) => n.midi)));
      const near = list.filter((n) => n.start >= t - 1e-6 && n.start < t + beatSeconds * 0.99);
      const all = [...near, ...now];
      reach[hand] = Math.max(reach[hand], Math.max(...all.map((n) => n.midi)) - Math.min(...all.map((n) => n.midi)));
    }
  }

  let nonChord = 0;
  for (const n of accompaniment) {
    // Heard a moment after it starts: a chord struck a few milliseconds early is still that chord.
    const c = at(truth, n.start + Math.min(0.12, n.dur / 2));
    if (!c) continue;
    const pc = n.midi % 12;
    if (!c.tones.includes(pc) && pc !== c.bass) nonChord++;
  }

  let lil = 0;
  let lowClusters = 0;
  for (const t of onsets(sorted)) {
    const now = sounding(sorted, t)
      .map((n) => n.midi)
      .sort((a, b) => a - b);
    let bad = false;
    for (let i = 0; i + 1 < now.length; i++) {
      const iv = now[i + 1] - now[i];
      if (iv >= 1 && iv <= 11 && now[i] < LOW_LIMIT[iv]) bad = true;
    }
    if (bad) lil++;
    const lows = sounding(hands.left, t)
      .map((n) => n.midi)
      .filter((m) => m < 48)
      .sort((a, b) => a - b);
    for (let i = 0; i + 1 < lows.length; i++) {
      const iv = lows[i + 1] - lows[i];
      if (iv !== 0 && iv !== 7 && iv % 12 !== 0) {
        lowClusters++;
        break;
      }
    }
  }

  // Voice leading: upper left-hand notes (above the lowest) per true chord span.
  const spans = truth.map((c) => {
    const inside = hands.left.filter((n) => n.start >= c.start - 0.05 && n.start < c.start + c.dur - 0.05);
    if (inside.length === 0) return [] as number[];
    const lowest = Math.min(...inside.map((n) => n.midi));
    return [...new Set(inside.map((n) => n.midi).filter((m) => m > lowest + 4))].sort((a, b) => a - b);
  });
  let moved = 0;
  let moves = 0;
  for (let i = 1; i < spans.length; i++) {
    const a = spans[i - 1];
    const b = spans[i];
    if (a.length === 0 || b.length === 0) continue;
    for (const m of b) {
      moved += Math.min(...a.map((x) => Math.abs(x - m)));
      moves++;
    }
  }

  let bigJumps = 0;
  const leftOn = onsets(hands.left);
  for (let i = 1; i < leftOn.length; i++) {
    if (leftOn[i] - leftOn[i - 1] > 0.4) continue;
    const lo = (t: number) => Math.min(...hands.left.filter((n) => Math.abs(n.start - t) < 1e-3).map((n) => n.midi));
    const hi = (t: number) => Math.max(...hands.left.filter((n) => Math.abs(n.start - t) < 1e-3).map((n) => n.midi));
    if (Math.abs(lo(leftOn[i]) - lo(leftOn[i - 1])) > 12 || Math.abs(hi(leftOn[i]) - hi(leftOn[i - 1])) > 12) bigJumps++;
  }

  let crossings = 0;
  for (const t of onsets(sorted)) {
    const l = sounding(hands.left, t).map((n) => n.midi);
    const r = sounding(hands.right, t).map((n) => n.midi);
    if (l.length && r.length && Math.max(...l) >= Math.min(...r)) crossings++;
  }

  let masked = 0;
  for (const n of accompaniment) {
    const top = [...tune].find((m) => m.start <= n.start + 1e-6 && n.start < m.start + m.dur - 1e-6);
    if (!top) continue;
    if (n.midi >= top.midi) masked++;
    else if (Math.abs(n.start - top.start) < 0.03 && top.midi - n.midi <= 2) masked++;
  }

  return {
    notes: sorted.length,
    seconds,
    rate,
    peak,
    span,
    reach,
    nonChordTone: accompaniment.length ? nonChord / accompaniment.length : 0,
    lowIntervalViolations: lil,
    lowClusters,
    voiceLeading: moves ? moved / moves : 0,
    bigJumps,
    crossings,
    masked,
    maxChord,
  };
}

/** Share of sung notes found (right key within 150 ms), after moving the found tune by whole octaves to match. */
export function melodyScore(truth: readonly { midi: number; start: number }[], found: readonly { midi: number; start: number }[]) {
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
  const shift = 12 * Math.round((med(found.map((n) => n.midi)) - med(truth.map((n) => n.midi))) / 12);
  const used = new Set<number>();
  let matched = 0;
  for (const t of truth) {
    let best = -1;
    let gap = 0.15;
    found.forEach((f, i) => {
      const g = Math.abs(f.start - t.start);
      if (!used.has(i) && f.midi - shift === t.midi && g <= gap) {
        best = i;
        gap = g;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return { recall: truth.length ? matched / truth.length : 0, precision: found.length ? matched / found.length : 0 };
}

/** Tune notes of a beat or longer whose pitch class is outside the true chord. */
export function melodyClashes(tune: readonly Note[], truth: readonly ChordTruth[], beatSeconds: number, scale: (t: number) => number[]): number {
  let n = 0;
  for (const m of tune) {
    if (m.dur < beatSeconds * 0.95) continue;
    const c = at(truth, m.start + Math.min(0.12, m.dur / 2));
    if (!c) continue;
    const pc = m.midi % 12;
    if (!c.tones.includes(pc) && !scale(m.start).includes(pc)) n++;
  }
  return n;
}

// Turns what was heard in a recording into a piano part a learner can play.
//
// This arranges rather than transcribes. The tune comes from what was sung (or
// the top line); everything under it is written fresh from the chords, the way
// a pianist plays from a lead sheet:
// - Register: the bass note sits low in the left hand; chord tones sit in the
//   middle (around C3 to E4), always under the tune; nothing closer than the
//   low interval limits allow (no thirds or triads low in the bass).
// - Voice leading: each chord is voiced as close as possible to the one before
//   (common tones kept, the rest moving by step), with the third (and the
//   seventh of a seventh chord) kept and the fifth left out first. The tune's
//   own note is not doubled right under it.
// - Rhythm: the left hand follows the song's chord changes and bars with one
//   pattern for the whole song, picked from the tempo and metre.
// - Levels build on each other: the tune; the tune and a bass note per bar;
//   the tune with bass and a two-note chord ("root then chord", or
//   bass-chord-chord in 3/4); and the fullest, with a broken root-fifth-octave
//   left hand and a chord tone under the tune on strong beats.
// - Playability: one octave at most in a hand, few notes at once, a limit on
//   notes per second, notes on a grid from the song's beats, no crossed hands.
import { type ChordInfo, type Key, chordFamily, chordNotes, cleanHeard, findHarmony, scaleOf } from '../analysis';
import type { Hand, Level, Note, RawNote, TimedChord } from '../song';
import { sortNotes } from '../song';

export type { Level } from '../song';

/** Song facts the arrangement can lean on. All optional. */
export interface ArrangeContext {
  beats?: readonly number[];
  chords?: readonly TimedChord[];
  /** Beats in a bar, for how often the left hand plays. */
  beatsPerBar?: number;
  /** Key name such as "G" or "Am", when known. */
  key?: string;
}

/** The playing rules each level keeps. Exported so tests check the same numbers. */
export const RULES = {
  /** Widest stretch of one hand, in semitones: what it holds at once, and what it reaches within one beat. */
  span: 12,
  /** Most notes one hand plays at once, per level. */
  maxChord: {
    melody: { right: 1, left: 0 },
    'melody-bass': { right: 1, left: 1 },
    'melody-chords': { right: 1, left: 2 },
    full: { right: 2, left: 2 },
  },
  /** Shortest time before the same key is played again, per level, in seconds. */
  repeatGap: { melody: 0.18, 'melody-bass': 0.18, 'melody-chords': 0.18, full: 0.12 },
  /** Most new notes (or chords) per second in any one-second stretch, per hand. */
  rate: {
    melody: { right: 6, left: 0 },
    'melody-bass': { right: 6, left: 2 },
    'melody-chords': { right: 6, left: 3 },
    full: { right: 8, left: 5 },
  },
  /** Where the tune is moved to (by whole octaves) and kept. */
  melodyRange: { low: 57, high: 86, centre: 69 },
  /** Lowest note of a two-note chord in the left hand (C3): below it only single notes, octaves and fifths. */
  chordFloor: 48,
  /** Shortest note, in seconds. */
  shortest: 0.1,
} as const;

/**
 * Low interval limits: the lowest pitch at which each interval (in semitones)
 * still sounds clear (minor 2nd E3, major 2nd Eb3, minor 3rd C3, major 3rd Bb2,
 * 4th A2, tritone Bb2, 5th Bb1, minor 6th G2, major 6th and sevenths F2).
 */
export const LOW_LIMIT: Readonly<Record<number, number>> = { 1: 52, 2: 51, 3: 48, 4: 46, 5: 45, 6: 46, 7: 34, 8: 43, 9: 41, 10: 41, 11: 41 };

const CHORD_WINDOW = 0.06; // notes this close together count as struck at once
const MIDDLE_C = 60;

/** Drops the faint, very short notes and overtone echoes the note model tends to invent. */
export const clean = cleanHeard;

function clusters<T extends { start: number }>(notes: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && n.start - last[0].start <= CHORD_WINDOW) last.push(n);
    else out.push([n]);
  }
  return out;
}

/** The tune as the old way found it: the top note of each moment, above the song's middle. */
function topVoice(notes: RawNote[]): RawNote[] {
  const sorted = notes.map((n) => n.midi).sort((a, b) => a - b);
  const floor = Math.min(MIDDLE_C, sorted[Math.floor(sorted.length / 2)] ?? MIDDLE_C);
  return clusters(notes)
    .map((g) => g.reduce((a, n) => (n.midi > a.midi ? n : a)))
    .filter((n) => n.midi >= floor);
}

/**
 * Moves a line by whole octaves so it sits in a comfortable place: the shift
 * that leaves the fewest notes outside the range, nearest the centre on a tie.
 * Only notes still outside are folded back in, so the tune keeps its shape.
 */
export function fitRange(line: Note[], low: number, high: number, centre: number): Note[] {
  if (line.length === 0) return line;
  const mids = line.map((n) => n.midi).sort((a, b) => a - b);
  const med = mids[mids.length >> 1];
  // Stray notes at the edges (a slide, a wrong guess) should not move the whole tune.
  const core = mids.slice(Math.floor(mids.length * 0.1), Math.ceil(mids.length * 0.9));
  let best = 0;
  let bestCost = Infinity;
  for (let shift = -48; shift <= 48; shift += 12) {
    const outside = core.filter((m) => m + shift < low || m + shift > high).length;
    // Any middle within a comfortable band will do; past that, nearer the centre is better.
    const away = Math.max(0, Math.abs(med + shift - centre) - 11);
    const cost = outside * 100 + away + Math.abs(shift) / 24;
    if (cost < bestCost) {
      bestCost = cost;
      best = shift;
    }
  }
  // A phrase that does not fit at that shift (an instrument playing the tune an
  // octave above the singer, say) gets its own octave instead of broken intervals.
  const out: Note[] = [];
  let from = 0;
  for (let i = 1; i <= line.length; i++) {
    const gap = i < line.length ? line[i].start - (line[i - 1].start + line[i - 1].dur) : Infinity;
    if (gap < 0.8) continue;
    const phrase = line.slice(from, i);
    const misses = (shift: number) => phrase.filter((n) => n.midi + shift < low || n.midi + shift > high).length;
    let shift = best;
    if (misses(best) > phrase.length * 0.25) {
      for (let k = -48; k <= 48; k += 12) {
        if (misses(k) < misses(shift) || (misses(k) === misses(shift) && Math.abs(k - best) < Math.abs(shift - best))) shift = k;
      }
    }
    for (const n of phrase) {
      let m = n.midi + shift;
      while (m < low) m += 12;
      while (m > high) m -= 12;
      out.push({ ...n, midi: m });
    }
    from = i;
  }
  return out;
}

/**
 * Nudges starts towards the nearest grid point, never by more than `limit`
 * seconds and never by more than a quarter of the way to a neighbouring
 * strike, so fast passages keep their shape and stay with the recording.
 */
export function snap(notes: Note[], points: readonly number[], limit: number): Note[] {
  if (points.length === 0) return notes;
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  const moved = new Map<number, number>();
  starts.forEach((t, i) => {
    const target = nearest(points, t);
    const room = Math.min(i > 0 ? t - starts[i - 1] : Infinity, i < starts.length - 1 ? starts[i + 1] - t : Infinity) / 4;
    const cap = Math.min(limit, room);
    moved.set(t, Math.max(0, t + Math.max(-cap, Math.min(cap, target - t))));
  });
  return notes.map((n) => {
    const start = moved.get(n.start) ?? n.start;
    return { ...n, start, dur: Math.max(RULES.shortest, n.dur - (start - n.start)) };
  });
}

/** The grid point nearest to t (points sorted). */
function nearest(points: readonly number[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo - 1];
  const b = points[lo];
  if (a === undefined) return b;
  return Math.abs(a - t) <= Math.abs(b - t) ? a : b;
}

/** Drops the least important onsets wherever a hand would play more than `perSecond` in one second. */
export function limitRate(notes: Note[], perSecond: number, onBeat: (t: number) => boolean): Note[] {
  if (perSecond <= 0) return [];
  const groups = clusters(sortNotes([...notes]));
  const keep = groups.map(() => true);
  const weight = (g: Note[]) => g.reduce((s, n) => s + n.dur, 0) + (onBeat(g[0].start) ? 1 : 0);
  let changed = true;
  while (changed) {
    changed = false;
    const live = groups.map((_, i) => i).filter((i) => keep[i]);
    for (let a = 0, b = 0; a < live.length; a++) {
      while (b < live.length && groups[live[b]][0].start < groups[live[a]][0].start + 1 - 1e-9) b++;
      if (b - a > Math.floor(perSecond)) {
        let worst = live[a];
        for (let k = a; k < b; k++) if (weight(groups[live[k]]) < weight(groups[worst])) worst = live[k];
        keep[worst] = false;
        changed = true;
        break;
      }
    }
  }
  return groups.filter((_, i) => keep[i]).flat();
}

// ---------------------------------------------------------------------------
// Time: beats, bars and the grid

interface Timeline {
  beats: number[];
  /** Whether the beats came from the song (not a made-up pulse). */
  known: boolean;
  /** Beats in a bar. */
  bar: number;
  /** Index of a beat that starts a bar. */
  phase: number;
  /** Median seconds per beat. */
  beat: number;
}

function timeline(context: ArrangeContext, notes: readonly { start: number; dur: number }[], chords: readonly TimedChord[]): Timeline {
  const given = (context.beats ?? []).filter((b) => Number.isFinite(b));
  let beats = given.length >= 4 ? [...given].sort((a, b) => a - b) : [];
  const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  if (beats.length < 4) {
    // No beats known: a steady half-second pulse.
    beats = [];
    for (let t = 0; t <= end + 0.5; t += 0.5) beats.push(t);
  } else {
    // Carry the pulse on past the last known beat (and before the first) so every note has a grid.
    const step = Math.max(0.2, beats[beats.length - 1] - beats[beats.length - 2]);
    while (beats[beats.length - 1] < end + step) beats.push(beats[beats.length - 1] + step);
    const first = Math.max(0.2, beats[1] - beats[0]);
    const lead: number[] = [];
    for (let t = beats[0] - first; t > -first / 2; t -= first) lead.unshift(Math.max(0, t));
    beats = [...lead.filter((t, i, a) => i === 0 || t > a[i - 1]), ...beats].filter((t, i, a) => i === 0 || t > a[i - 1]);
  }
  const bar = context.beatsPerBar && context.beatsPerBar >= 2 && context.beatsPerBar <= 7 ? Math.round(context.beatsPerBar) : 4;
  const gaps = beats
    .slice(1)
    .map((b, i) => b - beats[i])
    .sort((a, b) => a - b);
  const beat = gaps[gaps.length >> 1] ?? 0.5;
  // Bars start where most chords start.
  const votes = new Array<number>(bar).fill(0);
  for (const c of chords) {
    const i = beatIndex(beats, c.start);
    if (Math.abs(beats[i] - c.start) < beat * 0.3) votes[i % bar] += 1;
  }
  let phase = 0;
  for (let p = 1; p < bar; p++) if (votes[p] > votes[phase]) phase = p;
  return { beats, known: given.length >= 4, bar, phase, beat };
}

/** Index of the beat nearest to t. */
function beatIndex(beats: readonly number[], t: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(beats[lo - 1] - t) <= Math.abs(beats[lo] - t)) return lo - 1;
  return lo;
}

/** Grid points: each beat cut into `sub` equal steps. */
function gridOf(beats: readonly number[], sub: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    for (let k = 0; k < sub; k++) out.push(beats[i] + ((beats[i + 1] - beats[i]) * k) / sub);
  }
  out.push(beats[beats.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Chords for the piano

interface Span {
  start: number;
  end: number;
  /** First and last-plus-one beat index. */
  from: number;
  to: number;
  chord: ChordInfo;
  confidence: number;
}

/** Parses "G", "Am", "F#m": the key a song was found in. */
function parseKey(name: string | undefined): Key | undefined {
  if (!name) return undefined;
  const c = chordNotes(name);
  return c && (c.quality === '' || c.quality === 'm') ? { tonic: c.root, minor: c.minor } : undefined;
}

const sameChord = (a: ChordInfo, b: ChordInfo) =>
  a.root === b.root && a.bass === b.bass && a.tones.length === b.tones.length && a.tones.every((t, i) => t === b.tones[i]);

/**
 * The chords the left hand follows: snapped to beats, and never shorter than
 * half a bar (a shorter one is folded into its neighbour), so the hand is not
 * chasing every passing chord.
 */
function chordSpans(chords: readonly TimedChord[], time: Timeline): Span[] {
  const half = Math.max(1, Math.round(time.bar / 2));
  const raw: Span[] = [];
  for (const c of chords) {
    const info = chordNotes(c.label);
    if (!info || !(c.dur > 0) || !Number.isFinite(c.start)) continue;
    const from = beatIndex(time.beats, c.start);
    const to = Math.max(from + 1, beatIndex(time.beats, c.start + c.dur));
    const conf = (c as { confidence?: unknown }).confidence;
    raw.push({ start: 0, end: 0, from, to, chord: info, confidence: typeof conf === 'number' ? conf : 1 });
  }
  raw.sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (prev && s.from < prev.to) s.from = prev.to; // overlapping input
    if (s.to <= s.from) continue;
    const short = s.to - s.from < half;
    if (prev && prev.to === s.from && (short || sameChord(prev.chord, s.chord))) {
      prev.to = s.to;
      continue;
    }
    out.push(s);
  }
  // A short chord at the very start joins the next one.
  if (out.length > 1 && out[0].to - out[0].from < half && out[1].from === out[0].to) {
    out[1].from = out[0].from;
    out.shift();
  }
  const last = time.beats.length - 1;
  for (const s of out) {
    s.start = time.beats[Math.min(s.from, last)];
    s.end = s.to <= last ? time.beats[s.to] : time.beats[last] + (s.to - last) * time.beat;
  }
  return out;
}

/** The key the chords sit in best, by time: the song's own chords count most, the home chord a little more. */
function keyFromChords(spans: readonly Span[]): Key | undefined {
  if (spans.length === 0) return undefined;
  let best: Key | undefined;
  let bestScore = -Infinity;
  for (let k = 0; k < 24; k++) {
    const key = { tonic: k % 12, minor: k >= 12 };
    let score = 0;
    for (const s of spans) {
      if (s.chord.quality === '5') continue;
      const len = s.to - s.from;
      score += len * [-0.5, 0.2, 1][chordFamily(s.chord.root, s.chord.minor, key)];
      if (s.chord.root === key.tonic && s.chord.minor === key.minor) score += len * 0.3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

function spanAt(spans: readonly Span[], t: number): Span | undefined {
  return spans.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6);
}

// ---------------------------------------------------------------------------
// The tune

/**
 * Grid subdivision for the tune: eighths at the easy levels and sixteenths in
 * full, but sixteenths at every level when the tune really moves that fast (so
 * a quick run is kept, not rounded away), and never a step under a limit.
 */
function tuneGrid(level: Level, beat: number, line: readonly { start: number }[]): number {
  const gaps = line.slice(1).map((n, i) => n.start - line[i].start).filter((g) => g > 0.03);
  const quick = gaps.filter((g) => g < beat * 0.35).length;
  let sub = level === 'full' || (gaps.length > 0 && quick / gaps.length >= 0.2) ? 4 : 2;
  const shortest = level === 'full' ? 0.1 : 0.12;
  while (sub > 1 && beat / sub < shortest) sub = sub / 2;
  return sub;
}

/** The tune: cleaned, in a comfortable octave, on the grid, thinned to the level. */
function tuneLine(raw: readonly RawNote[], level: Level, time: Timeline, spans: readonly Span[], key: Key | undefined): Note[] {
  const tracked = raw.filter((n) => n.part === 'melody');
  const source = tracked.length > 0 ? [...tracked].sort((a, b) => a.start - b.start) : topVoice(clean(raw.filter((n) => n.part !== 'melody')));
  // Vibrato and breaths can chip a sliver off a sung note: join a tiny same-key
  // piece to the note it touches. (Two real notes on one key, sung legato, stay two.)
  const joined: { midi: number; start: number; dur: number; amp: number }[] = [];
  for (const n of source) {
    if (n.midi < 21 || n.midi > 108) continue;
    const prev = joined[joined.length - 1];
    if (prev && prev.midi === n.midi && n.start - (prev.start + prev.dur) < 0.04 && Math.min(n.dur, prev.dur) < 0.12) {
      prev.dur = Math.max(prev.dur, n.start + n.dur - prev.start);
      continue;
    }
    joined.push({ midi: n.midi, start: n.start, dur: n.dur, amp: Number.isFinite(n.amp) ? n.amp : 1 });
  }
  // Ghost notes: too short to be sung on purpose. And quiet notes far under the
  // tune around them: the tracker following a guitar or bass while the singer rests.
  const solid = joined.filter((n, i) => {
    if (n.dur < 0.08) return false;
    if (n.amp >= 0.5) return true;
    const near = joined.filter((m, j) => j !== i && Math.abs(m.start - n.start) < 3).map((m) => m.midi).sort((a, b) => a - b);
    return near.length < 4 || n.midi >= near[near.length >> 1] - 7;
  });
  const line = fitRange(
    solid.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur, hand: 'right' as Hand })),
    RULES.melodyRange.low,
    RULES.melodyRange.high,
    RULES.melodyRange.centre,
  );

  // Onto the grid: every start to its nearest step, every end too (at least one
  // step long). Without known beats there is no grid to trust: times stay as heard.
  const sub = tuneGrid(level, time.beat, line);
  const points = gridOf(time.beats, sub);
  const placed: (Note & { held: number })[] = [];
  for (const n of line) {
    const start = time.known ? nearest(points, n.start) : n.start;
    const i = beatIndex(time.beats, n.start);
    const step = (time.beats[Math.min(i + 1, time.beats.length - 1)] - time.beats[i] || time.beat) / sub;
    const end = time.known ? Math.max(start + step, nearest(points, n.start + n.dur)) : Math.max(start + RULES.shortest, n.start + n.dur);
    const prev = placed[placed.length - 1];
    if (prev && Math.abs(prev.start - start) < 1e-6) {
      // Two notes on one step: keep the one that was held longer.
      if (n.dur > prev.held) placed[placed.length - 1] = { midi: n.midi, start, dur: end - start, hand: 'right', held: n.dur };
      continue;
    }
    placed.push({ midi: n.midi, start, dur: end - start, hand: 'right', held: n.dur });
  }
  for (let i = 0; i + 1 < placed.length; i++) {
    const next = placed[i + 1].start;
    if (placed[i].start + placed[i].dur > next) placed[i].dur = next - placed[i].start;
  }

  // A long note outside both the chord and the key is more likely a pitch the
  // model got a semitone wrong than a real clash: move it onto the chord tone next to it.
  const scale = key ? scaleOf(key) : undefined;
  if (scale) {
    for (const n of placed) {
      if (n.dur < time.beat * 0.9) continue;
      const span = spanAt(spans, n.start + Math.min(n.dur / 2, 0.2));
      if (!span || span.confidence < 0.3) continue;
      const pc = n.midi % 12;
      if (span.chord.tones.includes(pc) || scale.includes(pc)) continue;
      if (span.chord.tones.includes((pc + 11) % 12)) n.midi -= 1;
      else if (span.chord.tones.includes((pc + 1) % 12)) n.midi += 1;
    }
  }

  // The same key struck again too soon is one held note at this level.
  const merged: Note[] = [];
  for (const n of placed) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.start - prev.start < RULES.repeatGap[level] - 1e-9) {
      prev.dur = n.start + n.dur - prev.start;
      continue;
    }
    merged.push({ midi: n.midi, start: n.start, dur: n.dur, hand: 'right' });
  }
  const onBeat = (t: number) => Math.abs(time.beats[beatIndex(time.beats, t)] - t) < 0.03;
  return limitRate(merged, RULES.rate[level].right, onBeat);
}

// ---------------------------------------------------------------------------
// The left hand

/** One way to play a chord with the left hand: a bass note and the notes above it. */
interface Shape {
  bass: number;
  upper: number[];
  cost: number;
}

/** Whether a set of notes sounding together respects the low interval limits. */
export function clearLow(notes: readonly number[]): boolean {
  const s = [...notes].sort((a, b) => a - b);
  for (let i = 0; i + 1 < s.length; i++) {
    const iv = s[i + 1] - s[i];
    if (iv === 0) return false;
    if (iv < 12 && s[i] < (LOW_LIMIT[iv] ?? 0)) return false;
  }
  return true;
}

/** Pitches of pitch class pc from lo to hi. */
function placesOf(pc: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo + ((((pc - lo) % 12) + 12) % 12); m <= hi; m += 12) out.push(m);
  return out;
}

/** Pitch-class pairs worth playing above the bass, best first: third (or sus note) with seventh, fifth or root. */
function upperChoices(c: ChordInfo): number[][] {
  const colour = c.third ?? c.extra;
  if (c.quality === '5' || colour === undefined) return [[c.root, c.fifth ?? c.root]];
  const sets: number[][] = [];
  if (c.seventh !== undefined) sets.push([colour, c.seventh]);
  if (c.fifth !== undefined) sets.push([colour, c.fifth]);
  sets.push([c.root, colour]);
  return sets;
}

/** Every left-hand shape for a chord at the 'melody-chords' level: a bass note, then two notes within the octave above. */
function chordShapes(c: ChordInfo, ceiling: number, melodyPc: number | undefined): Shape[] {
  const shapes: Shape[] = [];
  for (const bass of placesOf(c.bass, 40, 55)) {
    for (const [a, b] of upperChoices(c)) {
      for (const x of placesOf(a, RULES.chordFloor, 67)) {
        for (const y of placesOf(b, RULES.chordFloor, 67)) {
          const lo = Math.min(x, y);
          const hi = Math.max(x, y);
          if (hi - lo > 9 || hi - lo < 3) continue; // a third to a sixth
          // Above the bass, and close enough to reach from it between beats (a tenth at most).
          if (lo <= bass || hi - bass > 16) continue;
          if (hi > ceiling || !clearLow([lo, hi])) continue;
          let cost = hi - bass > RULES.span ? (hi - bass - RULES.span) * 0.3 : 0;
          if ((a === c.root || b === c.root) && c.quality !== '5') cost += 0.4; // the bass already has the root
          if (c.seventh !== undefined && a !== c.seventh && b !== c.seventh) cost += 3; // a seventh chord wants its seventh
          if (melodyPc !== undefined && hi % 12 === melodyPc) cost += 0.8; // the tune's note right under it
          shapes.push({ bass, upper: [lo, hi], cost });
        }
      }
    }
    // Always possible: the bass note alone.
    shapes.push({ bass, upper: [], cost: 4 });
  }
  return shapes;
}

/** Every left-hand shape for a chord at the 'full' level: a low bass and the notes of a broken pattern within an octave of it. */
function brokenShapes(c: ChordInfo, ceiling: number): Shape[] {
  const shapes: Shape[] = [];
  for (const bass of placesOf(c.bass, 36, 50)) {
    const above: number[] = [];
    // Fifth above the bass when the bass is the root, else the root above it; then the octave.
    const second = c.bass === c.root ? (c.fifth ?? c.root) : c.root;
    const p = placesOf(second, bass + 1, bass + 11)[0];
    if (p !== undefined && p <= ceiling) above.push(p);
    if (bass + 12 <= ceiling) above.push(bass + 12);
    // The third (or seventh) on top, when it fits in the octave above the low register.
    const colour = c.quality === '5' ? undefined : (c.seventh ?? c.third ?? c.extra);
    const q = colour === undefined ? undefined : placesOf(colour, Math.max(bass + 1, RULES.chordFloor), bass + 12)[0];
    if (q !== undefined && q <= ceiling && !above.includes(q)) above.push(q);
    above.sort((x, y) => x - y);
    shapes.push({ bass, upper: above, cost: above.length < 2 ? 2 : 0 });
  }
  return shapes;
}

/** Semitones the upper voices move from one shape to the next (each to its nearest). */
function motion(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 6;
  let sum = 0;
  for (const m of b) sum += Math.min(...a.map((x) => Math.abs(x - m)));
  return sum;
}

/** Picks one shape per chord with the smoothest movement overall (dynamic programming over the song). */
function leadVoices(options: Shape[][], centre: { bass: number; upper: number }): Shape[] {
  const n = options.length;
  if (n === 0) return [];
  const own = (s: Shape) =>
    s.cost +
    0.08 * Math.abs(s.bass - centre.bass) +
    (s.upper.length ? 0.1 * Math.abs(s.upper.reduce((a, x) => a + x, 0) / s.upper.length - centre.upper) : 0);
  let cost = options[0].map(own);
  const back: number[][] = [options[0].map(() => -1)];
  for (let i = 1; i < n; i++) {
    const next: number[] = [];
    const from: number[] = [];
    for (const s of options[i]) {
      let best = Infinity;
      let arg = 0;
      options[i - 1].forEach((p, j) => {
        const leap = Math.abs(s.bass - p.bass);
        const c = cost[j] + motion(p.upper, s.upper) * 0.8 + (leap > 7 ? (leap - 7) * 0.4 : 0) + leap * 0.05;
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      next.push(best + own(s));
      from.push(arg);
    }
    cost = next;
    back.push(from);
  }
  let k = 0;
  for (let j = 1; j < cost.length; j++) if (cost[j] < cost[k]) k = j;
  const out = new Array<Shape>(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = options[i][k];
    k = back[i][k];
  }
  return out;
}

/**
 * Lowest tune note that sounds for a real part of a span (a fifth of it). A
 * quick low passing note does not push the whole chord down: where it meets
 * the left hand, the left hand gives way (see separateHands).
 */
function tuneFloor(tune: readonly Note[], from: number, to: number): number {
  const time = new Map<number, number>();
  for (const n of tune) {
    const overlap = Math.min(to, n.start + n.dur) - Math.max(from, n.start);
    if (overlap > 0.02) time.set(n.midi, (time.get(n.midi) ?? 0) + overlap);
  }
  const pitches = [...time.keys()].sort((a, b) => a - b);
  return pitches.find((m) => (time.get(m) ?? 0) >= (to - from) * 0.2) ?? pitches[0] ?? Infinity;
}

interface Event {
  start: number;
  notes: number[];
  /** Latest end; the notes stop sooner when the hand plays again. */
  end: number;
  /** A bass note held under what follows (like a pianist's held finger), until the next held note. */
  hold?: boolean;
}

/** An unsure chord is played as root and fifth: an open sound that cannot clash, where a guessed third could. */
function safeChord(s: Span): ChordInfo {
  const c = s.chord;
  if (s.confidence >= 0.25 || c.third === undefined || c.fifth === undefined) return c;
  return { ...c, quality: '5', minor: false, third: undefined, seventh: undefined, extra: undefined, tones: [c.root, c.fifth] };
}

function leftHand(level: Level, spans: readonly Span[], tune: readonly Note[], time: Timeline): Note[] {
  if (spans.length === 0) return [];
  // With a quick beat the pattern moves every other beat (half time).
  const stride = time.beat < 0.42 ? 2 : 1;
  const pos = (i: number) => (((i - time.phase) % time.bar) + time.bar) % time.bar;
  const beatAt = (i: number) => (i < time.beats.length ? time.beats[i] : time.beats[time.beats.length - 1] + (i - time.beats.length + 1) * time.beat);
  const events: Event[] = [];
  /** Pattern beats of a span: its first beat, every `stride` beats after, and every bar line. */
  const patternBeats = (s: Span) => {
    const out: number[] = [];
    for (let i = s.from; i < s.to; i++) if ((i - s.from) % stride === 0 || pos(i) === 0) out.push(i);
    return out;
  };

  if (level === 'melody-bass') {
    // One low note per chord and bar, held: the plainest support for the tune.
    const shapes = leadVoices(
      spans.map((s) => placesOf(s.chord.bass, 40, 52).map((bass): Shape => ({ bass, upper: [], cost: 0 }))),
      { bass: 45, upper: 0 },
    );
    spans.forEach((s, k) => {
      for (let i = s.from; i < s.to; i++) {
        if (i === s.from || pos(i) === 0) events.push({ start: beatAt(i), notes: [shapes[k].bass], end: s.end });
      }
    });
  } else if (level === 'melody-chords') {
    const shapes = leadVoices(
      spans.map((s) => {
        const ceiling = Math.min(67, tuneFloor(tune, s.start, s.end) - 3);
        const first = tune.find((n) => n.start <= s.start + 0.05 && s.start < n.start + n.dur);
        return chordShapes(safeChord(s), ceiling, first ? first.midi % 12 : undefined);
      }),
      { bass: 47, upper: 55 },
    );
    spans.forEach((s, k) => {
      const shape = shapes[k];
      // "Root then chord": the bass on the chord's first beat and on each bar
      // line, the two-note chord on the middle of the bar (beats 2 and 3 in 3/4),
      // or straight after the bass when the chord is short.
      const list = patternBeats(s);
      let chordDone = false;
      list.forEach((i, j) => {
        const p = pos(i);
        if (j === 0 || p === 0) {
          events.push({ start: beatAt(i), notes: [shape.bass], end: s.end });
          chordDone = false;
          return;
        }
        if (shape.upper.length === 0) return;
        const middle = time.bar === 3 ? true : p === Math.floor(time.bar / 2);
        const lateFirst = !chordDone && (list[j + 1] === undefined || pos(list[j + 1]) === 0);
        if (middle || lateFirst) {
          events.push({ start: beatAt(i), notes: shape.upper, end: s.end });
          chordDone = true;
        }
      });
    });
  } else {
    const shapes = leadVoices(
      spans.map((s) => brokenShapes(safeChord(s), Math.min(64, tuneFloor(tune, s.start, s.end) - 3))),
      { bass: 43, upper: 52 },
    );
    // Broken chords, root-fifth-octave and back: eighths when the tempo allows,
    // quarters otherwise, starting again on each chord and bar line.
    const eighths = time.beat * stride >= 0.57;
    // Up and back down within each bar (1-5-8-5), so the hand ends near the next bass note instead of leaping to it.
    const perBar = Math.round((time.bar / stride) * (eighths ? 2 : 1));
    const cycle = perBar >= 8 ? [0, 1, 2, 3, 2, 1, 2, 1] : perBar >= 6 ? [0, 1, 2, 3, 2, 1] : perBar >= 4 ? [0, 1, 2, 1] : [0, 1, 2];
    spans.forEach((s, k) => {
      const notes = [shapes[k].bass, ...shapes[k].upper];
      let step = 0;
      for (const i of patternBeats(s)) {
        if (pos(i) === 0) step = 0;
        const t0 = beatAt(i);
        const len = beatAt(i + stride) - t0;
        const parts = eighths ? 2 : 1;
        for (let h = 0; h < parts; h++) {
          const at = t0 + (len * h) / parts;
          if (at >= s.end - 0.05) break;
          const idx = Math.min(cycle[step % cycle.length], notes.length - 1);
          // The bass rings on under the broken chord when every note above it sounds clear with it.
          const hold = idx === 0 && notes.slice(1).every((m) => clearLow([notes[0], m]));
          events.push({ start: at, notes: [notes[idx]], end: s.end, hold });
          step++;
        }
      }
    });
  }

  // Each event rings until the hand plays again (or the chord ends).
  events.sort((a, b) => a.start - b.start);
  const out: Note[] = [];
  events.forEach((e, i) => {
    const next = (e.hold ? events.slice(i + 1).find((x) => x.hold || x.notes.includes(e.notes[0]))?.start : events[i + 1]?.start) ?? Infinity;
    const end = Math.min(e.end, next);
    const dur = Math.max(RULES.shortest, end - e.start - 0.02);
    for (const midi of e.notes) out.push({ midi, start: e.start, dur, hand: 'left' });
  });
  return out;
}

/** In the fullest level, a chord tone under the tune on strong beats: a third or sixth below, clear of the left hand. */
function rightHarmony(tune: readonly Note[], left: readonly Note[], spans: readonly Span[], time: Timeline): Note[] {
  const out: Note[] = [];
  const pos = (i: number) => (((i - time.phase) % time.bar) + time.bar) % time.bar;
  for (const n of tune) {
    if (n.dur < time.beat * 0.9) continue;
    const i = beatIndex(time.beats, n.start);
    if (Math.abs(time.beats[i] - n.start) > 0.03) continue;
    const p = pos(i);
    if (!(p === 0 || (time.bar === 4 && p === 2))) continue;
    const span = spanAt(spans, n.start + 0.02);
    if (!span || span.chord.quality === '5' || span.confidence < 0.3) continue;
    const leftTop = left.filter((l) => l.start < n.start + n.dur && n.start < l.start + l.dur).reduce((m, l) => Math.max(m, l.midi), 0);
    let pick: number | undefined;
    for (const gap of [3, 4, 8, 9, 5]) {
      const m = n.midi - gap;
      if (!span.chord.tones.includes(m % 12) || m % 12 === n.midi % 12) continue;
      if (m <= leftTop + 2 || m < 55) continue;
      pick = m;
      break;
    }
    if (pick !== undefined) out.push({ midi: pick, start: n.start, dur: n.dur, hand: 'right' });
  }
  return out;
}

/**
 * Turns the notes heard in a recording into something a learner can play.
 * - melody: the tune only, right hand.
 * - melody-bass: the tune plus one low bass note per chord and bar.
 * - melody-chords: the tune plus "root then chord" in the left hand.
 * - full: the tune with a chord tone under it on strong beats, and a broken
 *   root-fifth-octave left hand.
 */
export function arrange(raw: readonly RawNote[], level: Level, context: ArrangeContext = {}): Note[] {
  const valid = raw.filter(
    (n) => Number.isFinite(n.start) && Number.isFinite(n.dur) && Number.isFinite(n.midi) && Number.isFinite(n.amp) && n.dur > 0 && n.start >= 0,
  );
  if (valid.length === 0) return [];
  let chords: readonly TimedChord[] = (context.chords ?? []).filter((c) => chordNotes(c.label));
  let key = parseKey(context.key);
  if (chords.length === 0 && level !== 'melody') {
    // No chords known (an older song, or analysis failed): work them out from the notes.
    const time = timeline(context, valid, []);
    const found = findHarmony(
      valid.filter((n) => n.part !== 'melody'),
      time.beats,
      { beatsPerBar: time.bar, melody: valid.filter((n) => n.part === 'melody') },
    );
    chords = found.chords;
    key ??= found.key;
  }
  const time = timeline(context, valid, chords);
  const spans = chordSpans(chords, time);
  key ??= keyFromChords(spans);
  const tune = tuneLine(valid, level, time, spans, key);
  if (level === 'melody') return sortNotes(tune);

  let left = leftHand(level, spans, tune, time);
  let right: Note[] = tune;
  if (level === 'full') right = [...tune, ...rightHarmony(tune, left, spans, time)];
  const onBeat = (t: number) => Math.abs(time.beats[beatIndex(time.beats, t)] - t) < 0.03;
  left = playableHand(left, 'left', level, onBeat);
  right = playableHand(right, 'right', level, onBeat);
  return sortNotes(separateHands(right, left));
}

/** Applies the per-hand rules: stretch, notes at once, repeats and notes per second. */
function playableHand(notes: Note[], hand: Hand, level: Level, onBeat: (t: number) => boolean): Note[] {
  const max = RULES.maxChord[level][hand];
  if (max === 0) return [];
  const groups = clusters(sortNotes([...notes])).map((g) => {
    const start = g[0].start;
    const unique = new Map<number, Note>();
    for (const n of g) if (!unique.has(n.midi)) unique.set(n.midi, { ...n, start, hand });
    const sorted = [...unique.values()].sort((a, b) => a.midi - b.midi);
    // The right hand keeps its top (the tune); the left keeps its bass.
    return hand === 'right'
      ? sorted.filter((n) => sorted[sorted.length - 1].midi - n.midi <= RULES.span).slice(-max)
      : sorted.filter((n) => n.midi - sorted[0].midi <= RULES.span).slice(0, max);
  });
  const out: Note[] = [];
  const lastStart = new Map<number, number>();
  for (const group of groups) {
    const g = group.filter((n) => n.start - (lastStart.get(n.midi) ?? -Infinity) >= RULES.repeatGap[level] - 1e-9);
    for (const n of g) {
      lastStart.set(n.midi, n.start);
      out.push({ ...n, dur: Math.min(Math.max(n.dur, RULES.shortest), 4) });
    }
  }
  const limited = sortNotes(limitRate(out, RULES.rate[level][hand], onBeat));
  // A held note must not widen the stretch, overfill the hand or sound under its own repeat: it is let go sooner.
  for (const n of limited) {
    for (const m of limited) {
      if (m === n || m.start <= n.start + 1e-9 || m.start >= n.start + n.dur) continue;
      const together = limited.filter((x) => x !== n && x.start <= m.start + 1e-9 && m.start < x.start + x.dur).length + 1;
      if (Math.abs(m.midi - n.midi) > RULES.span || together > max || m.midi === n.midi) n.dur = Math.max(0.05, m.start - n.start - 0.01);
    }
  }
  return limited;
}

/** The left hand always stays clearly below the right: a left-hand note that would come near the tune is cut short or left out. */
function separateHands(right: Note[], left: Note[]): Note[] {
  const out: Note[] = [...right];
  for (const n of left) {
    const lowestRight = right.filter((r) => r.start < n.start + n.dur && n.start < r.start + r.dur).reduce((m, r) => Math.min(m, r.midi), Infinity);
    // A whole tone of room at least, so the tune is never blurred from below.
    if (n.midi < lowestRight - 2) {
      out.push(n);
      continue;
    }
    const clash = right
      .filter((r) => r.midi <= n.midi + 2 && r.start < n.start + n.dur && n.start < r.start + r.dur)
      .reduce((m, r) => Math.min(m, r.start), Infinity);
    if (clash - n.start >= RULES.shortest) out.push({ ...n, dur: clash - n.start - 0.01 });
  }
  return out;
}

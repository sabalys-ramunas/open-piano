/**
 * Builds a score from a song: bars, note values, ties, rests, accidentals,
 * stems and beams for a grand staff. Pure functions, no DOM.
 */
import type { Hand, Note, Song, TimeSignature } from '../song';
import {
  detectKey,
  diatonic,
  keyAlters,
  spell,
  staffStep,
  type Clef,
  type Key,
  type Spelled,
} from './theory';
import { analyseTiming, meterTicks, type QNote, type TimeMap } from './timing';

/** 0 is the top staff (right hand), 1 the bottom staff (left hand). */
export type Staff = 0 | 1;

/** Note value: 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth. */
export type Base = 1 | 2 | 4 | 8 | 16;

export interface Head {
  midi: number;
  spelled: Spelled;
  /** Staff step: 0 middle line, positive up, lines on even steps. */
  step: number;
  /** Alteration to print in front of the head (0 = natural sign), or null for none. */
  accidental: number | null;
  /** Index of the song note this head belongs to. */
  src: number;
  /** Tied to the same pitch in the following chord. */
  tieStart: boolean;
  /** Continues a tie: not a new key press. */
  tieEnd: boolean;
}

export interface Chord {
  kind: 'chord';
  staff: Staff;
  tick: number;
  len: number;
  base: Base;
  dots: number;
  /** Lowest first. */
  heads: Head[];
  stem: 'up' | 'down';
  /** Beam group id, unique in the score, or -1. */
  beam: number;
}

export interface Rest {
  kind: 'rest';
  staff: Staff;
  tick: number;
  len: number;
  base: Base;
  dots: number;
  /** A whole bar of rest, drawn as a centred whole rest. */
  full: boolean;
}

export type Event = Chord | Rest;

export interface Measure {
  number: number;
  start: number;
  len: number;
  /** A short first bar (upbeat). */
  pickup: boolean;
  staves: [Event[], Event[]];
}

export interface Beam {
  id: number;
  staff: Staff;
  chords: Chord[];
}

export interface MetricScore {
  kind: 'metric';
  /** 2 for a grand staff, 1 when only the top staff is shown. */
  staves: 1 | 2;
  /** Draw bar lines and the time signature. */
  bars: boolean;
  key: Key;
  meter: TimeSignature;
  clefs: [Clef, Clef];
  measures: Measure[];
  beams: Map<number, Beam>;
  map: TimeMap;
  bpm: number;
}

export interface FreeChord {
  time: number;
  dur: number;
  staff: Staff;
  heads: Head[];
}

/** For playing too free to write as rhythm: note heads placed by time. */
export interface FreeScore {
  kind: 'free';
  staves: 1 | 2;
  key: Key;
  clefs: [Clef, Clef];
  chords: FreeChord[];
}

export type Score = MetricScore | FreeScore;

const staffOf = (hand: Hand): Staff => (hand === 'right' ? 0 : 1);

// ---------------------------------------------------------------- note values

const VALUES: { len: number; base: Base; dots: number }[] = [
  { len: 16, base: 1, dots: 0 },
  { len: 12, base: 2, dots: 1 },
  { len: 8, base: 2, dots: 0 },
  { len: 6, base: 4, dots: 1 },
  { len: 4, base: 4, dots: 0 },
  { len: 3, base: 8, dots: 1 },
  { len: 2, base: 8, dots: 0 },
  { len: 1, base: 16, dots: 0 },
];

export interface Piece {
  pos: number;
  len: number;
  base: Base;
  dots: number;
}

/**
 * Splits a length starting at `pos` (ticks from the start of a full bar) into
 * written values so the beats stay visible: values shorter than a beat stay
 * inside it, longer ones start on a beat. Rests are stricter (no dotted rests
 * in simple time).
 */
export function splitValue(pos: number, len: number, meter: TimeSignature, rest = false): Piece[] {
  const { bar, beat } = meterTicks(meter);
  const compound = beat % 3 === 0 && beat > 2;
  const out: Piece[] = [];
  let p = pos;
  let left = len;
  while (left > 0) {
    let chosen = VALUES[VALUES.length - 1];
    for (const v of VALUES) {
      if (v.len > left) continue;
      if (allowed(p, v, bar, beat, compound, rest)) {
        chosen = v;
        break;
      }
    }
    out.push({ pos: p, len: chosen.len, base: chosen.base, dots: chosen.dots });
    p += chosen.len;
    left -= chosen.len;
  }
  return out;
}

function allowed(
  pos: number,
  v: { len: number; dots: number },
  bar: number,
  beat: number,
  compound: boolean,
  rest: boolean,
): boolean {
  const end = pos + v.len;
  if (end > bar) return false;
  if (v.len < beat) {
    // Stays inside one beat.
    if (Math.floor(pos / beat) !== Math.floor((end - 1) / beat)) return false;
    if (rest && v.dots && !compound) return false;
    // In compound time a quarter-length value must start on the beat or end on it.
    return true;
  }
  if (pos % beat !== 0) return false;
  if (end % beat === 0) {
    if (rest && v.dots && !compound && v.len !== bar) return false;
    // In 4/4 a half rest only sits on beat one or three.
    if (rest && bar === 16 && v.len === 8 && pos % 8 !== 0) return false;
    return true;
  }
  // Dotted value starting on a beat and ending half way through one (dotted quarter + eighth).
  if (rest || !v.dots || beat % 2 !== 0) return false;
  return end % (beat / 2) === 0;
}

// ---------------------------------------------------------------- building

export interface ScoreOptions {
  /** Treat timing as free, for testing or by choice. */
  free?: boolean;
}

function chooseClefs(notes: readonly Note[]): [Clef, Clef] {
  const top = notes.filter((n) => n.hand === 'right');
  const bottom = notes.filter((n) => n.hand === 'left');
  const topClef: Clef = top.length && top.every((n) => n.midi < 55) ? 'bass' : 'treble';
  const bottomClef: Clef = bottom.length && bottom.every((n) => n.midi >= 60) ? 'treble' : 'bass';
  return [topClef, bottomClef];
}

function spellAll(notes: readonly Note[], key: Key): Spelled[] {
  const out = new Array<Spelled>(notes.length);
  const nextInHand = new Map<Hand, number>();
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    out[i] = spell(n.midi, key, nextInHand.get(n.hand));
    nextInHand.set(n.hand, n.midi);
  }
  return out;
}

export function stemFor(steps: readonly number[]): 'up' | 'down' {
  const lo = Math.min(...steps);
  const hi = Math.max(...steps);
  return lo + hi >= 0 ? 'down' : 'up';
}

interface Block {
  staff: Staff;
  tick: number;
  len: number;
  rawLen: number;
  notes: QNote[];
}

/** Groups quantised notes into chords per staff and settles their lengths. */
function blocksFor(qnotes: readonly QNote[], recorded: boolean, bar: number, origin: number): Block[][] {
  const staves: Block[][] = [[], []];
  for (const q of qnotes) {
    const list = staves[staffOf(q.hand)];
    const last = list[list.length - 1];
    if (last && last.tick === q.tick) {
      if (!last.notes.some((n) => n.midi === q.midi)) last.notes.push(q);
      last.len = Math.max(last.len, q.len);
      last.rawLen = Math.max(last.rawLen, q.rawLen);
    } else list.push({ staff: staffOf(q.hand), tick: q.tick, len: q.len, rawLen: q.rawLen, notes: [q] });
  }
  // A short silence after a note is usually a lifted finger, not a written
  // rest: held for most of the gap (or a lone sixteenth after a longer note)
  // means the note lasts until the next one.
  const legato = recorded ? 0.5 : 0.7;
  const fills = (b: Block, until: number) => {
    const gap = until - (b.tick + b.len);
    if (gap <= 0) return false;
    const span = until - b.tick;
    return b.rawLen / span >= legato || gap * 4 <= b.len || (gap === 1 && b.len >= 3);
  };
  for (const list of staves) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const next = list[i + 1];
      if (next) {
        b.len = Math.min(b.len, next.tick - b.tick);
        if (fills(b, next.tick)) b.len = next.tick - b.tick;
      } else {
        const barEnd = origin + Math.ceil((b.tick + b.len - origin) / bar) * bar;
        if (fills(b, barEnd) && barEnd - (b.tick + b.len) <= b.len) b.len = barEnd - b.tick;
      }
      b.len = Math.max(1, b.len);
    }
  }
  return staves;
}

export function buildScore(song: Pick<Song, 'notes' | 'bpm' | 'beats' | 'timeSignature' | 'raw'>, options: ScoreOptions = {}): Score {
  const notes = song.notes;
  const key = detectKey(notes);
  const clefs = chooseClefs(notes);
  const spelled = spellAll(notes, key);
  const recorded = !!song.raw;
  const timing = options.free
    ? ({ kind: 'free', error: 1 } as const)
    : analyseTiming({ notes, bpm: song.bpm, beats: song.beats, timeSignature: song.timeSignature, recorded });

  const headFor = (index: number, staff: Staff): Head => ({
    midi: notes[index].midi,
    spelled: spelled[index],
    step: staffStep(spelled[index], clefs[staff]),
    accidental: null,
    src: index,
    tieStart: false,
    tieEnd: false,
  });

  if (timing.kind === 'free') return buildFree(notes, key, clefs, headFor);

  const meter = timing.meter;
  const { bar } = meterTicks(meter);
  const blocks = blocksFor(timing.notes, recorded, bar, timing.origin);
  const all = [...blocks[0], ...blocks[1]];
  const measures: Measure[] = [];
  if (all.length) {
    const first = all.reduce((m, b) => Math.min(m, b.tick), Infinity);
    const end = all.reduce((m, b) => Math.max(m, b.tick + b.len), -Infinity);
    const b0 = Math.floor((first - timing.origin) / bar);
    const barStart = timing.origin + b0 * bar;
    let start = barStart;
    let pickupLen = 0;
    if (first > barStart && barStart + bar - first <= bar / 2) {
      pickupLen = barStart + bar - first;
      start = first;
    }
    let number = 1;
    let cursor = start;
    if (pickupLen) {
      measures.push({ number: 0, start, len: pickupLen, pickup: true, staves: [[], []] });
      cursor += pickupLen;
    }
    while (cursor < end || measures.length === 0) {
      measures.push({ number: number++, start: cursor, len: bar, pickup: false, staves: [[], []] });
      cursor += bar;
    }
  }

  for (const staff of [0, 1] as const) {
    fillStaff(measures, blocks[staff], staff, meter, bar, headFor);
  }
  return finishScore({ measures, key, meter, clefs, map: timing.map, bpm: timing.bpm, staves: 2, bars: true });
}

/** Adds accidentals, beams and stem directions to measures filled with events. */
export function finishScore(parts: Omit<MetricScore, 'kind' | 'beams'>): MetricScore {
  const { measures, key, meter } = parts;
  const { bar } = meterTicks(meter);
  for (const m of measures) {
    for (const staff of [0, 1] as const) markAccidentals(m.staves[staff], key);
  }
  const beams = new Map<number, Beam>();
  let beamId = 0;
  for (const m of measures) {
    for (const staff of [0, 1] as const) {
      for (const group of beamGroups(m, staff, meter, bar)) {
        const id = beamId++;
        const steps = group.flatMap((c) => c.heads.map((h) => h.step));
        const dir = stemFor([Math.min(...steps), Math.max(...steps)]);
        for (const c of group) {
          c.beam = id;
          c.stem = dir;
        }
        beams.set(id, { id, staff, chords: group });
      }
    }
  }
  return { kind: 'metric', ...parts, beams };
}

function fillStaff(
  measures: Measure[],
  blocks: readonly Block[],
  staff: Staff,
  meter: TimeSignature,
  bar: number,
  headFor: (index: number, staff: Staff) => Head,
): void {
  let bi = 0;
  // A chord still sounding from the previous bar.
  let carry: { notes: QNote[]; until: number } | null = null;
  for (const m of measures) {
    const events = m.staves[staff];
    const mEnd = m.start + m.len;
    const barBase = mEnd - bar; // where a full bar would start, for upbeats
    let cursor = m.start;
    const emitChord = (tick: number, len: number, notes: QNote[], tieEnd: boolean, tieOut: boolean) => {
      const pieces = splitValue(tick - barBase, len, meter);
      pieces.forEach((p, k) => {
        const heads = notes.map((q) => {
          const h = headFor(q.index, staff);
          h.tieEnd = tieEnd || k > 0;
          h.tieStart = tieOut || k < pieces.length - 1;
          return h;
        });
        heads.sort((a, b) => a.step - b.step || a.midi - b.midi);
        events.push({
          kind: 'chord',
          staff,
          tick: barBase + p.pos,
          len: p.len,
          base: p.base,
          dots: p.dots,
          heads,
          stem: stemFor(heads.map((h) => h.step)),
          beam: -1,
        });
      });
    };
    const emitRest = (tick: number, len: number) => {
      for (const p of splitValue(tick - barBase, len, meter, true)) {
        events.push({ kind: 'rest', staff, tick: barBase + p.pos, len: p.len, base: p.base, dots: p.dots, full: false });
      }
    };

    if (carry) {
      const until = Math.min(carry.until, mEnd);
      emitChord(cursor, until - cursor, carry.notes, true, carry.until > mEnd);
      cursor = until;
      carry = carry.until > mEnd ? carry : null;
    }
    while (bi < blocks.length && blocks[bi].tick < mEnd) {
      const b = blocks[bi++];
      const tick = Math.max(b.tick, cursor);
      if (tick > cursor) emitRest(cursor, tick - cursor);
      const until = b.tick + b.len;
      if (until <= tick) continue;
      const stop = Math.min(until, mEnd);
      emitChord(tick, stop - tick, b.notes, false, until > mEnd);
      cursor = stop;
      if (until > mEnd) carry = { notes: b.notes, until };
    }
    if (!events.length && !m.pickup) {
      events.push({ kind: 'rest', staff, tick: m.start, len: m.len, base: 1, dots: 0, full: true });
    } else if (cursor < mEnd) emitRest(cursor, mEnd - cursor);
  }
}

/** Accidentals follow the key signature and last until the bar line. */
function markAccidentals(events: readonly Event[], key: Key): void {
  const sig = keyAlters(key.fifths);
  const memory = new Map<number, number>();
  for (const e of events) {
    if (e.kind !== 'chord') continue;
    for (const h of e.heads) {
      const d = diatonic(h.spelled);
      const current = memory.get(d) ?? sig[h.spelled.letter];
      if (h.tieEnd) continue;
      if (current !== h.spelled.alter) {
        h.accidental = h.spelled.alter;
        memory.set(d, h.spelled.alter);
      }
    }
  }
}

function beamGroups(m: Measure, staff: Staff, meter: TimeSignature, bar: number): Chord[][] {
  const { beat } = meterTicks(meter);
  const events = m.staves[staff];
  const barBase = m.start + m.len - bar;
  // 3/8 beams the whole bar; other meters beam by beat.
  const span = meter.unit === 8 && meter.beats === 3 ? bar : beat;
  const groups: Chord[][] = [];
  let current: Chord[] = [];
  let currentSpan = -1;
  const flush = () => {
    if (current.length >= 2) groups.push(current);
    current = [];
  };
  for (const e of events) {
    const beamable = e.kind === 'chord' && e.base >= 8;
    if (!beamable) {
      flush();
      currentSpan = -1;
      continue;
    }
    const s = Math.floor((e.tick - barBase) / span);
    if (s !== currentSpan) flush();
    currentSpan = s;
    current.push(e);
  }
  flush();

  // In 4/4, four plain eighths in a half bar share one beam.
  if (bar === 16 && beat === 4 && meter.unit === 4) {
    const merged: Chord[][] = [];
    for (let i = 0; i < groups.length; i++) {
      const a = groups[i];
      const b = groups[i + 1];
      const plain = (g: Chord[]) => g.length === 2 && g.every((c) => c.len === 2);
      if (
        b &&
        plain(a) &&
        plain(b) &&
        (a[0].tick - barBase) % 8 === 0 &&
        b[0].tick === a[0].tick + 4
      ) {
        merged.push([...a, ...b]);
        i++;
      } else merged.push(a);
    }
    return merged;
  }
  return groups;
}

function buildFree(
  notes: readonly Note[],
  key: Key,
  clefs: [Clef, Clef],
  headFor: (index: number, staff: Staff) => Head,
): FreeScore {
  const sig = keyAlters(key.fifths);
  const chords: FreeChord[] = [];
  const lastOf: (FreeChord | undefined)[] = [undefined, undefined];
  notes.forEach((n, i) => {
    const staff = staffOf(n.hand);
    const h = headFor(i, staff);
    if (h.spelled.alter !== sig[h.spelled.letter]) h.accidental = h.spelled.alter;
    const last = lastOf[staff];
    if (last && n.start - last.time < 0.045) {
      if (!last.heads.some((x) => x.midi === h.midi)) last.heads.push(h);
      last.dur = Math.max(last.dur, n.dur);
    } else {
      const c: FreeChord = { time: n.start, dur: n.dur, staff, heads: [h] };
      chords.push(c);
      lastOf[staff] = c;
    }
  });
  for (const c of chords) c.heads.sort((a, b) => a.step - b.step);
  chords.sort((a, b) => a.time - b.time || a.staff - b.staff);
  return { kind: 'free', staves: 2, key, clefs, chords };
}

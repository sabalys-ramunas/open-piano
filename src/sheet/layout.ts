/**
 * Places a score on a long horizontal grand staff. All lengths are in staff
 * spaces (the distance between two staff lines); y grows downwards with the
 * top staff's middle line at 0. Pure functions, no DOM.
 */
import type { TimeSignature } from '../song';
import type { Chord, FreeScore, Head, MetricScore, Rest, Score, Staff } from './score';
import { keySignatureSteps, type Clef, type Key } from './theory';
import { timeAt } from './timing';

export const HEAD_W = 1.18;
const STEM = 3.5;
const ACC_W = 1.1;

export interface LHead {
  head: Head;
  x: number;
  y: number;
  /** Accidental centre x, when one is printed. */
  accX: number;
}

export interface LChord {
  staff: Staff;
  x: number;
  time: number;
  heads: LHead[];
  /** 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth; 0 for a plain head with no rhythm. */
  base: number;
  dots: number;
  dotX: number;
  up: boolean;
  stem: { x: number; y1: number; y2: number } | null;
  flags: number;
  ledgers: { x1: number; x2: number; y: number }[];
}

export interface LRest {
  staff: Staff;
  x: number;
  y: number;
  base: number;
  dots: number;
  full: boolean;
  time: number;
}

export interface LBeam {
  staff: Staff;
  up: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Second (sixteenth) beam segments, as x ranges on the same slope. */
  subs: { x1: number; x2: number }[];
}

export interface LTie {
  staff: Staff;
  x1: number;
  x2: number;
  y: number;
  /** Curves upwards (above the heads). */
  over: boolean;
  src: number;
}

export interface LMeasure {
  number: number;
  /** Left edge (just after the previous bar line). */
  x: number;
  w: number;
  start: number;
  end: number;
  chords: LChord[];
  rests: LRest[];
  beams: LBeam[];
  ties: LTie[];
  final: boolean;
}

export interface Layout {
  kind: 'metric' | 'free';
  /** 2 for a grand staff, 1 for the top staff alone. */
  staves: 1 | 2;
  /** Bar lines and time signature are drawn. */
  bars: boolean;
  key: Key;
  meter: TimeSignature | null;
  clefs: [Clef, Clef];
  /** Distance between the two staves' middle lines. */
  dist: number;
  /** Width of clefs, key and time signature at the start. */
  header: number;
  measures: LMeasure[];
  /** Positions in time order, for placing the playhead. */
  columns: { x: number; time: number }[];
  width: number;
  /** Highest and lowest y used, including ledger notes and stems. */
  top: number;
  bottom: number;
  /** Seconds where the music starts and ends. */
  startTime: number;
  endTime: number;
}

export const stepY = (step: number, staff: Staff, dist: number) => (staff === 1 ? dist : 0) - step / 2;

/** Width of the start-of-line signs: clef, key signature and (optionally) time signature. */
export function headerWidth(key: Key, meter: TimeSignature | null): number {
  const n = Math.min(7, Math.abs(key.fifths));
  return 4.2 + n * 1.0 + (n ? 0.6 : 0) + (meter ? 2.6 : 0) + 0.6;
}

function spacing(ticks: number): number {
  return 2.1 + 1.35 * Math.log2(Math.max(1, ticks));
}

/** Places heads (seconds side by side), accidentals and ledger lines for a chord at x. */
function placeHeads(
  heads: readonly Head[],
  staff: Staff,
  x: number,
  up: boolean,
  dist: number,
): { heads: LHead[]; right: number; left: number } {
  const out: LHead[] = heads.map((head) => ({ head, x, y: stepY(head.step, staff, dist), accX: 0 }));
  // Seconds: put every other head of a cluster on the far side of the stem.
  const order = up ? out.map((_, i) => i) : out.map((_, i) => out.length - 1 - i);
  let prevStep = Infinity;
  let prevMoved = false;
  for (const i of order) {
    const s = out[i].head.step;
    const moved: boolean = Math.abs(s - prevStep) === 1 && !prevMoved;
    if (moved) out[i].x = up ? x + HEAD_W - 0.08 : x - HEAD_W + 0.08;
    prevMoved = moved;
    prevStep = s;
  }
  const left = Math.min(...out.map((h) => h.x));
  const right = Math.max(...out.map((h) => h.x)) + HEAD_W;
  // Accidentals: top to bottom, each in the first column that does not clash.
  const columns: number[][] = [];
  for (let i = out.length - 1; i >= 0; i--) {
    const h = out[i];
    if (h.head.accidental === null) continue;
    let col = 0;
    while (columns[col]?.some((s) => Math.abs(s - h.head.step) < 6)) col++;
    (columns[col] ??= []).push(h.head.step);
    h.accX = left - 0.7 - col * ACC_W;
  }
  return { heads: out, right, left };
}

function ledgersFor(heads: readonly LHead[], staff: Staff, dist: number) {
  const out: { x1: number; x2: number; y: number }[] = [];
  const steps = heads.map((h) => h.head.step);
  const hi = Math.max(...steps);
  const lo = Math.min(...steps);
  const span = (pred: (s: number) => boolean) => {
    const hs = heads.filter((h) => pred(h.head.step));
    return { x1: Math.min(...hs.map((h) => h.x)) - 0.4, x2: Math.max(...hs.map((h) => h.x)) + HEAD_W + 0.4 };
  };
  for (let s = 6; s <= hi; s += 2) out.push({ ...span((t) => t >= s - 1), y: stepY(s, staff, dist) });
  for (let s = -6; s >= lo; s -= 2) out.push({ ...span((t) => t <= s + 1), y: stepY(s, staff, dist) });
  return out;
}

function stemFor(heads: readonly LHead[], up: boolean, base: number, x: number, staff: Staff, dist: number) {
  if (base <= 1) return null;
  const ys = heads.map((h) => h.y);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const mid = staff === 1 ? dist : 0;
  const extra = base >= 16 ? 0.5 : 0;
  if (up) {
    const sx = x + HEAD_W - 0.06;
    // Stems reach at least the middle line.
    const y2 = Math.min(top - STEM - extra, mid);
    return { x: sx, y1: bottom - 0.2, y2 };
  }
  const sx = x + 0.06;
  const y2 = Math.max(bottom + STEM + extra, mid);
  return { x: sx, y1: top + 0.2, y2 };
}

function layChord(c: Chord, x: number, time: number, dist: number): { chord: LChord; right: number; left: number } {
  const up = c.stem === 'up';
  const placed = placeHeads(c.heads, c.staff, x, up, dist);
  const stem = stemFor(placed.heads, up, c.base, x, c.staff, dist);
  const dotX = placed.right + 0.45;
  const accLeft = Math.min(placed.left, ...placed.heads.filter((h) => h.head.accidental !== null).map((h) => h.accX - 0.55));
  return {
    chord: {
      staff: c.staff,
      x,
      time,
      heads: placed.heads,
      base: c.base,
      dots: c.dots,
      dotX,
      up,
      stem,
      flags: c.beam < 0 && c.base >= 8 ? (c.base >= 16 ? 2 : 1) : 0,
      ledgers: ledgersFor(placed.heads, c.staff, dist),
    },
    right: c.dots ? dotX + 0.6 * c.dots : placed.right,
    left: accLeft,
  };
}

function restY(base: number, full: boolean, staff: Staff, dist: number): number {
  const mid = staff === 1 ? dist : 0;
  if (full || base === 1) return mid - 1; // hangs from the fourth line
  if (base === 2) return mid; // sits on the middle line
  return mid;
}

function staffDistance(score: Score): number {
  let lowTop = 0;
  let highBottom = 0;
  const visit = (staff: Staff, heads: readonly Head[]) => {
    for (const h of heads) {
      if (staff === 0) lowTop = Math.min(lowTop, h.step);
      else highBottom = Math.max(highBottom, h.step);
    }
  };
  if (score.kind === 'metric') {
    for (const m of score.measures) for (const s of [0, 1] as const) for (const e of m.staves[s]) if (e.kind === 'chord') visit(s, e.heads);
  } else for (const c of score.chords) visit(c.staff, c.heads);
  // Room for notes below the top staff and above the bottom one.
  const need = (Math.max(0, -lowTop - 4) + Math.max(0, highBottom - 4)) / 2 + 4 + 3;
  return Math.min(17, Math.max(10, need));
}

export function layoutScore(score: Score): Layout {
  return score.kind === 'metric' ? layoutMetric(score) : layoutFree(score);
}

function layoutMetric(score: MetricScore): Layout {
  const dist = staffDistance(score);
  const header = headerWidth(score.key, score.bars ? score.meter : null);
  const measures: LMeasure[] = [];
  const columns: { x: number; time: number }[] = [];
  const chordAt = new Map<Chord, LChord>();
  let x = header;
  score.measures.forEach((m, mi) => {
    const lm: LMeasure = {
      number: m.number,
      x,
      w: 0,
      start: timeAt(score.map, m.start),
      end: timeAt(score.map, m.start + m.len),
      chords: [],
      rests: [],
      beams: [],
      ties: [],
      final: mi === score.measures.length - 1,
    };
    const events = [...m.staves[0], ...m.staves[1]];
    const ticks = [...new Set(events.filter((e) => !(e.kind === 'rest' && e.full)).map((e) => e.tick))].sort((a, b) => a - b);
    let cx = x + (mi === 0 ? 1.0 : 1.4);
    if (!ticks.length) {
      // Rest in both hands.
      for (const e of events) {
        lm.rests.push({ staff: e.staff, x: x + 2.4, y: restY(1, true, e.staff, dist), base: 1, dots: 0, full: true, time: lm.start });
      }
      columns.push({ x: x + 1.4, time: lm.start });
      cx = x + 6;
    }
    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i];
      const next = i + 1 < ticks.length ? ticks[i + 1] : m.start + m.len;
      const time = timeAt(score.map, tick);
      const here = events.filter((e) => e.tick === tick && !(e.kind === 'rest' && e.full));
      // Make room on the left for accidentals and moved heads.
      let left = 0;
      let right = HEAD_W;
      const laid: LChord[] = [];
      for (const e of here) {
        if (e.kind === 'chord') {
          const r = layChord(e, 0, time, dist);
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          laid.push(r.chord);
        } else right = Math.max(right, 1.4 + (e.dots ? 0.8 : 0));
      }
      cx += -left;
      columns.push({ x: cx, time });
      for (const e of here) {
        if (e.kind === 'chord') {
          const r = layChord(e, cx, time, dist);
          lm.chords.push(r.chord);
          chordAt.set(e, r.chord);
        } else {
          lm.rests.push(restFor(e, cx, time, dist));
        }
      }
      cx += Math.max(right + 0.6, spacing(next - tick));
    }
    for (const e of events) {
      if (e.kind === 'rest' && e.full && ticks.length) {
        lm.rests.push({ staff: e.staff, x: (x + cx) / 2 - 0.6, y: restY(1, true, e.staff, dist), base: 1, dots: 0, full: true, time: lm.start });
      }
    }
    lm.w = cx + 0.4 - x;
    x += lm.w;
    measures.push(lm);
  });
  if (measures.length) columns.push({ x: x - 0.4, time: measures[measures.length - 1].end });

  // Beams.
  score.measures.forEach((m, mi) => {
    for (const s of [0, 1] as const) {
      const ids = new Set<number>();
      for (const e of m.staves[s]) if (e.kind === 'chord' && e.beam >= 0) ids.add(e.beam);
      for (const id of ids) {
        const beam = score.beams.get(id);
        if (!beam) continue;
        const laid = beam.chords.map((c) => chordAt.get(c)).filter((c): c is LChord => !!c);
        if (laid.length >= 2) measures[mi].beams.push(layBeam(laid, beam.chords));
      }
    }
  });

  // Ties: each tied head joins the same pitch in the next chord on its staff.
  for (const s of [0, 1] as const) {
    const list: { chord: LChord; measure: number }[] = [];
    score.measures.forEach((m, mi) => {
      for (const e of m.staves[s]) {
        const l = e.kind === 'chord' ? chordAt.get(e) : undefined;
        if (l) list.push({ chord: l, measure: mi });
      }
    });
    list.forEach(({ chord: lc, measure }, i) => {
      const next = list[i + 1]?.chord;
      lc.heads.forEach((h, k) => {
        if (!h.head.tieStart) return;
        const target = next?.heads.find((n) => n.head.midi === h.head.midi);
        const over = lc.heads.length > 1 ? k >= lc.heads.length / 2 : !lc.up;
        measures[measure].ties.push({
          staff: s,
          x1: h.x + HEAD_W + 0.1,
          x2: target ? target.x - 0.15 : h.x + HEAD_W + 2,
          y: h.y + (over ? -0.55 : 0.55),
          over,
          src: h.head.src,
        });
      });
    });
  }

  const { top, bottom } = extents(measures, dist, score.staves);
  return {
    kind: 'metric',
    staves: score.staves,
    bars: score.bars,
    key: score.key,
    meter: score.bars ? score.meter : null,
    clefs: score.clefs,
    dist,
    header,
    measures,
    columns,
    width: x,
    top,
    bottom,
    startTime: measures.length ? measures[0].start : 0,
    endTime: measures.length ? measures[measures.length - 1].end : 0,
  };
}

function restFor(e: Rest, x: number, time: number, dist: number): LRest {
  return { staff: e.staff, x, y: restY(e.base, false, e.staff, dist), base: e.base, dots: e.dots, full: false, time };
}

function layBeam(laid: LChord[], chords: Chord[]): LBeam {
  const up = laid[0].up;
  const first = laid[0];
  const last = laid[laid.length - 1];
  const ideal = (c: LChord) => (c.stem ? c.stem.y2 : 0);
  const x1 = first.stem?.x ?? first.x;
  const x2 = last.stem?.x ?? last.x;
  let slope = x2 > x1 ? (ideal(last) - ideal(first)) / (x2 - x1) : 0;
  slope = Math.max(-0.18, Math.min(0.18, slope));
  // Every stem at least 3 spaces (3.4 with a second beam) long.
  let y1 = ideal(first);
  const hasSubs = chords.some((c) => c.base >= 16);
  const minStem = hasSubs ? 3.3 : 3.0;
  for (const c of laid) {
    const sx = c.stem?.x ?? c.x;
    const ys = c.heads.map((h) => h.y);
    const beamY = y1 + slope * (sx - x1);
    if (up) {
      const limit = Math.min(...ys) - minStem;
      if (beamY > limit) y1 -= beamY - limit;
    } else {
      const limit = Math.max(...ys) + minStem;
      if (beamY < limit) y1 += limit - beamY;
    }
  }
  const y2 = y1 + slope * (x2 - x1);
  for (const c of laid) {
    if (!c.stem) continue;
    c.stem.y2 = y1 + slope * (c.stem.x - x1);
    c.flags = 0;
  }
  // Sixteenth beams: between neighbours that are both sixteenths, stubs for lone ones.
  const subs: { x1: number; x2: number }[] = [];
  const sx = laid.map((c) => c.stem?.x ?? c.x);
  for (let i = 0; i < chords.length; i++) {
    if (chords[i].base < 16) continue;
    const prev = i > 0 && chords[i - 1].base >= 16;
    const next = i + 1 < chords.length && chords[i + 1].base >= 16;
    if (next) subs.push({ x1: sx[i], x2: sx[i + 1] });
    else if (!prev) {
      const towardsLeft = i === chords.length - 1 || (i > 0 && chords[i - 1].dots > 0);
      subs.push(towardsLeft ? { x1: sx[i] - 1.1, x2: sx[i] } : { x1: sx[i], x2: sx[i] + 1.1 });
    }
  }
  return { staff: first.staff, up, x1, y1, x2, y2, subs };
}

function extents(measures: readonly LMeasure[], dist: number, staves: 1 | 2): { top: number; bottom: number } {
  let top = -2;
  let bottom = staves === 2 ? dist + 2 : 2;
  for (const m of measures) {
    for (const c of m.chords) {
      for (const h of c.heads) {
        top = Math.min(top, h.y - 0.6);
        bottom = Math.max(bottom, h.y + 0.6);
      }
      if (c.stem) {
        top = Math.min(top, c.stem.y2, c.stem.y1);
        bottom = Math.max(bottom, c.stem.y2, c.stem.y1);
      }
    }
  }
  return { top: top - 0.5, bottom: bottom + 0.5 };
}

function layoutFree(score: FreeScore): Layout {
  const dist = staffDistance(score);
  const header = headerWidth(score.key, null);
  const chords = score.chords;
  const iois: number[] = [];
  for (let i = 1; i < chords.length; i++) {
    const d = chords[i].time - chords[i - 1].time;
    if (d > 0.04) iois.push(d);
  }
  iois.sort((a, b) => a - b);
  const median = iois.length ? iois[iois.length >> 1] : 0.5;
  const perSecond = Math.min(16, Math.max(3, 2.8 / median));
  const t0 = chords.length ? chords[0].time : 0;
  const tEnd = chords.reduce((m, c) => Math.max(m, c.time + c.dur), t0);
  const start = header + 1.5;
  const xOf = (t: number) => start + (t - t0) * perSecond;
  const laid: LChord[] = chords.map((c) => {
    const x = xOf(c.time);
    const placed = placeHeads(c.heads, c.staff, x, true, dist);
    return {
      staff: c.staff,
      x,
      time: c.time,
      heads: placed.heads,
      base: 0,
      dots: 0,
      dotX: 0,
      up: true,
      stem: null,
      flags: 0,
      ledgers: ledgersFor(placed.heads, c.staff, dist),
    };
  });
  const width = xOf(tEnd) + 3;
  // Split into chunks of about four seconds, so drawing only visits what is on screen.
  const measures: LMeasure[] = [];
  const chunk = 4;
  for (let t = t0, n = 1; t < tEnd || measures.length === 0; t += chunk, n++) {
    const end = Math.min(tEnd, t + chunk);
    const x = measures.length ? xOf(t) : 0;
    const w = (measures.length === 0 ? xOf(end) : xOf(end) - x) + (end >= tEnd ? 3 : 0);
    measures.push({
      number: n,
      x,
      w: Math.max(w, 1),
      start: t,
      end,
      chords: laid.filter((c) => c.time >= t && (c.time < end || end >= tEnd)),
      rests: [],
      beams: [],
      ties: [],
      final: end >= tEnd,
    });
    if (end >= tEnd) break;
  }
  const columns = [
    { x: start, time: t0 },
    { x: xOf(tEnd), time: tEnd },
  ];
  const { top, bottom } = extents(measures, dist, score.staves);
  return {
    kind: 'free',
    staves: score.staves,
    bars: false,
    key: score.key,
    meter: null,
    clefs: score.clefs,
    dist,
    header,
    measures,
    columns,
    width,
    top,
    bottom,
    startTime: t0,
    endTime: tEnd,
  };
}

/** x of the playhead at a time: between the columns around it. */
export function xAtTime(layout: Layout, time: number): number {
  const cols = layout.columns;
  if (!cols.length) return layout.header;
  if (time <= cols[0].time) {
    // Before the first note: come in from the left edge of the music.
    const lead = cols[0].time - time;
    return cols[0].x - Math.min(cols[0].x - layout.header, lead * 4);
  }
  let lo = 0;
  let hi = cols.length - 1;
  if (time >= cols[hi].time) return cols[hi].x;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cols[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = cols[lo];
  const b = cols[hi];
  const f = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
  return a.x + f * (b.x - a.x);
}

/** Index of the first measure whose right edge is past x. */
export function measureAt(layout: Layout, x: number): number {
  const ms = layout.measures;
  let lo = 0;
  let hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ms[mid].x + ms[mid].w < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Key signature accidentals laid out after the clef, relative to the header start. */
export function keySignatureLayout(key: Key, clef: Clef): { x: number; step: number; alter: number }[] {
  return keySignatureSteps(key.fifths, clef).map((k, i) => ({ x: 4.0 + i * 1.0, ...k }));
}

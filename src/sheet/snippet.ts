/**
 * Small static pieces of notation for lessons, e.g. "C4/q D4/q E4/h" on a
 * treble staff. Draws into a canvas you pass in and sizes it to fit.
 *
 * Token format, separated by spaces:
 *   C4/q        a quarter note (values: w h q 8 16, or 1 2 4 8 16; default q)
 *   F#4/8 Bb3/h sharps and flats are spelled as written (# or b)
 *   E4/q.       a dotted value
 *   C4+E4+G4/h  a chord
 *   _/q         a rest
 *   |           a bar line (only drawn when `time` is set or bars are given)
 */
import type { TimeSignature } from '../song';
import { finishScore, stemFor, type Base, type Chord, type Event, type Head, type Measure, type MetricScore, type Staff } from './score';
import { layoutScore } from './layout';
import { enter, paintHeader, paintMeasures, paintStaffLines, PAPER, type Palette } from './render';
import { midiOf, staffStep, type Clef, type Letter, type Spelled } from './theory';
import { linearMap, TPQ } from './timing';

export interface SnippetSpec {
  /** Notes for the top staff (or the only staff), in the token format above. */
  notes: string;
  /** Notes for the bottom staff of a grand staff. */
  lower?: string;
  /** 'treble', 'bass' or 'grand'. Default: picked from the notes. */
  clef?: Clef | 'grand';
  /** Key signature: sharps (positive) or flats (negative). Default 0. */
  key?: number;
  /** Show a time signature and bar lines. */
  time?: TimeSignature;
  /** Show each note's letter name in its head. */
  names?: boolean;
  /** Token indices (top staff, counting notes and rests, not bar lines) to draw in the highlight colour. */
  highlight?: readonly number[];
  /** Per-token colours, by the same index. */
  colors?: Readonly<Record<number, string>>;
}

export interface SnippetOptions {
  /** Pixels per staff space (line gap). Default 10. */
  size?: number;
  /** Default window.devicePixelRatio. */
  pixelRatio?: number;
  /** Shrinks the notation to fit this many CSS pixels wide. */
  maxWidth?: number;
  /** Fill the background; transparent when omitted. */
  background?: string;
  palette?: Partial<Palette>;
}

interface Token {
  rest: boolean;
  pitches: Spelled[];
  len: number;
  base: Base;
  dots: number;
  bar: boolean;
}

const VALUE: Record<string, Base> = { w: 1, '1': 1, h: 2, '2': 2, q: 4, '4': 4, '8': 8, '16': 16 };
const LETTER_INDEX: Record<string, Letter> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** Parses the token format. Unknown tokens throw an Error naming them. */
export function parseSnippet(line: string): Token[] {
  const out: Token[] = [];
  for (const raw of line.trim().split(/\s+/)) {
    if (!raw) continue;
    if (raw === '|') {
      out.push({ rest: true, pitches: [], len: 0, base: 4, dots: 0, bar: true });
      continue;
    }
    const m = /^([^/]+)(?:\/(w|h|q|1|2|4|8|16)(\.?))?$/.exec(raw);
    if (!m) throw new Error(`Unknown note "${raw}"`);
    const base = VALUE[m[2] ?? 'q'];
    const dots = m[3] ? 1 : 0;
    const len = ((TPQ * 4) / base) * (dots ? 1.5 : 1);
    if (m[1] === '_') {
      out.push({ rest: true, pitches: [], len, base, dots, bar: false });
      continue;
    }
    const pitches = m[1].split('+').map((p) => {
      const pm = /^([A-G])(#|b|♯|♭)?(-?\d)$/.exec(p);
      if (!pm) throw new Error(`Unknown note "${p}"`);
      const alter = pm[2] === '#' || pm[2] === '♯' ? 1 : pm[2] ? -1 : 0;
      return { letter: LETTER_INDEX[pm[1]], alter, octave: Number(pm[3]) };
    });
    out.push({ rest: false, pitches, len, base, dots, bar: false });
  }
  return out;
}

function autoClef(tokens: readonly Token[]): Clef | 'grand' {
  const midis = tokens.flatMap((t) => t.pitches.map(midiOf));
  if (!midis.length) return 'treble';
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  if (lo >= 55) return 'treble';
  if (hi <= 64) return 'bass';
  return 'grand';
}

/** Builds the score for a snippet (exported for tests). */
export function snippetScore(spec: SnippetSpec): MetricScore {
  const top = parseSnippet(spec.notes);
  const lowerTokens = spec.lower !== undefined ? parseSnippet(spec.lower) : null;
  const clef = spec.clef ?? (lowerTokens ? 'grand' : autoClef(top));
  const grand = clef === 'grand';
  const clefs: [Clef, Clef] = grand ? ['treble', 'bass'] : [clef, 'bass'];
  const key = { fifths: Math.max(-7, Math.min(7, Math.round(spec.key ?? 0))), mode: 'major' as const };
  const meter = spec.time ?? { beats: 4, unit: 4 };
  const bars = !!spec.time || top.some((t) => t.bar);

  // Split a single line over both staves when a grand staff has no lower line.
  let staves: [Token[], Token[]] = [top, lowerTokens ?? []];
  if (grand && !lowerTokens) {
    const up: Token[] = [];
    const down: Token[] = [];
    for (const t of top) {
      const hi = t.pitches.filter((p) => midiOf(p) >= 60);
      const lo = t.pitches.filter((p) => midiOf(p) < 60);
      up.push({ ...t, pitches: hi, rest: t.rest || !hi.length });
      down.push({ ...t, pitches: lo, rest: t.rest || !lo.length });
    }
    staves = [up, down];
  }

  const barLen = (TPQ * 4 * meter.beats) / meter.unit;
  const measures: Measure[] = [];
  const measureAt = (tick: number) => {
    let m = measures.find((x) => tick >= x.start && tick < x.start + x.len);
    if (!m) {
      const start = measures.length ? measures[measures.length - 1].start + measures[measures.length - 1].len : 0;
      m = { number: measures.length + 1, start, len: barLen, pickup: false, staves: [[], []] };
      measures.push(m);
    }
    return m;
  };
  staves.forEach((tokens, s) => {
    const staff = s as Staff;
    let tick = 0;
    let index = 0;
    for (const t of tokens) {
      if (t.bar) {
        // Explicit bar line: the bar ends here.
        const m = measures.find((x) => tick > x.start && tick <= x.start + x.len);
        if (m && !spec.time) m.len = tick - m.start;
        continue;
      }
      const m = measureAt(tick);
      const src = staff === 0 ? index : 1000 + index;
      index++;
      let e: Event;
      if (t.rest) e = { kind: 'rest', staff, tick, len: t.len, base: t.base, dots: t.dots, full: false };
      else {
        const heads: Head[] = t.pitches
          .map((p) => ({
            midi: midiOf(p),
            spelled: p,
            step: staffStep(p, clefs[staff]),
            accidental: null,
            src,
            tieStart: false,
            tieEnd: false,
          }))
          .sort((a, b) => a.step - b.step);
        const c: Chord = {
          kind: 'chord',
          staff,
          tick,
          len: t.len,
          base: t.base,
          dots: t.dots,
          heads,
          stem: stemFor(heads.map((h) => h.step)),
          beam: -1,
        };
        e = c;
      }
      m.staves[staff].push(e);
      tick += t.len;
      if (tick > m.start + m.len && !spec.time) m.len = tick - m.start;
    }
  });
  if (!measures.length) measures.push({ number: 1, start: 0, len: barLen, pickup: false, staves: [[], []] });
  // Without a time signature the single bar is as long as its notes.
  if (!bars) {
    const end = Math.max(...measures.flatMap((m) => [...m.staves[0], ...m.staves[1]].map((e) => e.tick + e.len)), 1);
    measures.splice(1);
    measures[0].len = end;
  }
  return finishScore({ measures, key, meter, clefs, map: linearMap(0, 0.5), bpm: 120, staves: grand ? 2 : 1, bars });
}

/**
 * Draws a snippet into the canvas and sets its size (CSS and backing pixels).
 * Returns the CSS size. Throws an Error for tokens it cannot read.
 */
export function renderSnippet(
  canvas: HTMLCanvasElement,
  spec: SnippetSpec,
  options: SnippetOptions = {},
): { width: number; height: number } {
  const score = snippetScore(spec);
  const layout = layoutScore(score);
  const palette: Palette = { ...PAPER, ...options.palette };
  let sp = options.size ?? 10;
  const margin = 1;
  const contentW = layout.width + 0.6 + margin;
  if (options.maxWidth && (contentW + margin) * sp > options.maxWidth) sp = Math.max(4, Math.floor((options.maxWidth / (contentW + margin)) * 100) / 100);
  const top = Math.min(layout.top, -4.6);
  const bottom = layout.bottom;
  const width = Math.ceil((contentW + margin) * sp);
  const height = Math.ceil((bottom - top + margin) * sp);
  const ratio = options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { width, height };
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  const highlight = new Set(spec.highlight ?? []);
  const o = {
    sp,
    ox: (margin + 0.4) * sp,
    oy: (-top + margin / 2) * sp,
    from: 0,
    to: layout.width,
    palette,
    names: !!spec.names,
    style: (src: number) => {
      const color = spec.colors?.[src];
      if (color) return { color };
      if (highlight.has(src)) return { color: palette.next };
      return undefined;
    },
  };
  enter(ctx, o);
  paintStaffLines(ctx, layout, 0, layout.width, palette, sp);
  paintHeader(ctx, layout, 0, o, !!spec.time);
  paintMeasures(ctx, layout, o);
  ctx.restore();
  return { width, height };
}

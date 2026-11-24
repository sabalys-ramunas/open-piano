/**
 * Draws a laid-out score on a 2D canvas. Shared by the live sheet view and
 * the static snippets. All drawing happens in staff-space units under a
 * scale transform, so it stays sharp at any size and pixel density.
 */
import {
  accidentalShape,
  BASS,
  brace,
  FLAG,
  restShape,
  SIXTEENTH_FLAG,
  TREBLE,
  type Shape,
} from './glyphs';
import { HEAD_W, keySignatureLayout, measureAt, stepY, type LChord, type Layout, type LMeasure, type LRest } from './layout';
import { spelledName, type Clef } from './theory';

export interface Palette {
  paper: string;
  ink: string;
  staff: string;
  faint: string;
  hit: string;
  miss: string;
  next: string;
  nextGlow: string;
  playhead: string;
  dim: string;
  headText: string;
}

export const PAPER: Palette = {
  paper: '#fbf8f1',
  ink: '#1c1e25',
  staff: '#6b6f7a',
  faint: '#a3a7b1',
  hit: '#15803d',
  miss: '#dc2626',
  next: '#2563eb',
  nextGlow: 'rgba(37, 99, 235, 0.2)',
  playhead: 'rgba(37, 99, 235, 0.55)',
  dim: '#9aa0ab',
  headText: '#ffffff',
};

/** How one note head should look. */
export interface HeadStyle {
  color?: string;
  glow?: string;
}

export interface PaintOptions {
  /** Pixels per staff space. */
  sp: number;
  /** Pixel position of layout x = 0 and of the top staff's middle line. */
  ox: number;
  oy: number;
  /** Visible range in layout units; only measures touching it are drawn. */
  from: number;
  to: number;
  palette: Palette;
  /** Show the note's name inside its head. */
  names: boolean;
  /** Per-note style by song note index. */
  style?: (src: number) => HeadStyle | undefined;
  /** Small bar numbers above the top staff. */
  numbers?: boolean;
}

const paths = new WeakMap<Shape, Path2D>();

function pathOf(shape: Shape): Path2D {
  let p = paths.get(shape);
  if (!p) {
    p = new Path2D();
    for (const poly of shape.polys) {
      p.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) p.lineTo(poly[i], poly[i + 1]);
      p.closePath();
    }
    for (const [cx, cy, r] of shape.dots) {
      p.moveTo(cx + r, cy);
      p.arc(cx, cy, r, 0, Math.PI * 2);
      p.closePath();
    }
    paths.set(shape, p);
  }
  return p;
}

export function glyph(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, sx = 1, sy = 1): void {
  ctx.save();
  ctx.translate(x, y);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.fill(pathOf(shape));
  ctx.restore();
}

/** Text at a point in staff units, rendered at its real pixel size. */
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  sp: number,
  font: string,
  align: CanvasTextAlign = 'center',
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / sp, 1 / sp);
  ctx.font = font.replace('{size}', `${Math.max(1, size * sp).toFixed(1)}px`);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

const SANS = '700 {size} system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SERIF = '700 {size} Georgia, "Times New Roman", serif';

function hline(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, w: number): void {
  ctx.fillRect(x1, y - w / 2, x2 - x1, w);
}

function vline(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, w: number): void {
  ctx.fillRect(x - w / 2, Math.min(y1, y2), w, Math.abs(y2 - y1));
}

/** Enters staff-space coordinates. Pair with ctx.restore(). */
export function enter(ctx: CanvasRenderingContext2D, o: Pick<PaintOptions, 'sp' | 'ox' | 'oy'>): void {
  ctx.save();
  ctx.translate(o.ox, o.oy);
  ctx.scale(o.sp, o.sp);
}

/** Five lines for each staff, from x1 to x2 (layout units). Call inside enter(). */
export function paintStaffLines(ctx: CanvasRenderingContext2D, layout: Layout, x1: number, x2: number, palette: Palette, sp: number): void {
  ctx.fillStyle = palette.staff;
  const w = Math.max(0.085, 1 / sp);
  for (const center of layout.staves === 2 ? [0, layout.dist] : [0]) {
    for (let l = -2; l <= 2; l++) hline(ctx, x1, x2, center + l, w);
  }
}

function clefGlyph(ctx: CanvasRenderingContext2D, clef: Clef, x: number, center: number): void {
  if (clef === 'treble') glyph(ctx, TREBLE, x, center + 1);
  else glyph(ctx, BASS, x, center - 1);
}

/**
 * Brace, clefs, key signature and time signature, starting at layout x.
 * Call inside enter(). Leaves the background alone.
 */
export function paintHeader(ctx: CanvasRenderingContext2D, layout: Layout, x: number, o: PaintOptions, withTime = true): void {
  const p = o.palette;
  ctx.fillStyle = p.ink;
  const top = -2;
  const bottom = layout.staves === 2 ? layout.dist + 2 : 2;
  vline(ctx, x, top, bottom, 0.16);
  if (layout.staves === 2) glyph(ctx, brace(bottom - top), x - 0.35, top);
  layout.clefs.slice(0, layout.staves).forEach((clef, staff) => {
    const center = staff === 0 ? 0 : layout.dist;
    clefGlyph(ctx, clef, x + 0.7, center);
    for (const k of keySignatureLayout(layout.key, clef)) {
      glyph(ctx, accidentalShape(k.alter), x + k.x + 0.4, center - k.step / 2);
    }
    if (withTime && layout.meter) {
      const n = Math.min(7, Math.abs(layout.key.fifths));
      const tx = x + 4.2 + n * 1.0 + (n ? 0.6 : 0) + 1.1;
      text(ctx, String(layout.meter.beats), tx, center - 1, 2.35, o.sp, SERIF);
      text(ctx, String(layout.meter.unit), tx, center + 1, 2.35, o.sp, SERIF);
    }
  });
}

function headPath(ctx: CanvasRenderingContext2D, x: number, y: number, base: number): void {
  ctx.beginPath();
  if (base === 1) {
    ctx.ellipse(x + 0.72, y, 0.72, 0.46, 0, 0, Math.PI * 2);
    ctx.moveTo(x + 0.72 + 0.34, y);
    ctx.ellipse(x + 0.72, y, 0.34, 0.24, Math.PI / 3, 0, Math.PI * 2, true);
    return;
  }
  const cx = x + HEAD_W / 2;
  ctx.ellipse(cx, y, HEAD_W / 2, 0.42, -0.35, 0, Math.PI * 2);
  if (base === 2) {
    ctx.moveTo(cx + 0.48, y);
    ctx.ellipse(cx, y, 0.48, 0.2, -0.6, 0, Math.PI * 2, true);
  }
}

function paintChord(ctx: CanvasRenderingContext2D, c: LChord, layout: Layout, o: PaintOptions): void {
  const p = o.palette;
  const styles = c.heads.map((h) => o.style?.(h.head.src));
  const colors = styles.map((s) => s?.color ?? p.ink);
  const same = colors.every((col) => col === colors[0]) ? colors[0] : p.ink;

  // Glow behind notes to play next.
  c.heads.forEach((h, i) => {
    const glow = styles[i]?.glow;
    if (!glow) return;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(h.x + HEAD_W / 2, h.y, 1.25, 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = same;
  for (const l of c.ledgers) hline(ctx, l.x1, l.x2, l.y, 0.16);

  if (c.stem) {
    ctx.fillStyle = same;
    vline(ctx, c.stem.x, c.stem.y1, c.stem.y2, 0.12);
    if (c.flags) {
      const shape = c.flags >= 2 ? SIXTEENTH_FLAG : FLAG;
      glyph(ctx, shape, c.stem.x - 0.06, c.stem.y2, 1, c.up ? 1 : -1);
    }
  }

  c.heads.forEach((h, i) => {
    ctx.fillStyle = colors[i];
    if (h.head.accidental !== null) glyph(ctx, accidentalShape(h.head.accidental), h.accX, h.y);
    const base = c.base === 0 ? 4 : c.base;
    headPath(ctx, h.x, h.y, base);
    ctx.fill('evenodd');
    if (o.names && base <= 2) {
      // Open the hollow head up a little so the letter inside can be read.
      ctx.fillStyle = p.paper;
      ctx.beginPath();
      if (base === 1) ctx.ellipse(h.x + 0.72, h.y, 0.5, 0.3, 0, 0, Math.PI * 2);
      else ctx.ellipse(h.x + HEAD_W / 2, h.y, 0.42, 0.26, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors[i];
    }
    for (let d = 0; d < c.dots; d++) {
      const dy = h.head.step % 2 === 0 ? -0.5 : 0;
      ctx.beginPath();
      ctx.arc(c.dotX + d * 0.5, h.y + dy, 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
    if (o.names) {
      const name = spelledName(h.head.spelled);
      const filled = c.base >= 4 || c.base === 0;
      ctx.fillStyle = filled ? p.headText : colors[i];
      const cx = h.x + (c.base === 1 ? 0.72 : HEAD_W / 2);
      text(ctx, name, cx, h.y + 0.03, (name.length > 1 ? 0.62 : 0.78) * (filled ? 1 : 0.85), o.sp, SANS);
    }
  });
  void layout;
}

function paintRest(ctx: CanvasRenderingContext2D, r: LRest, o: PaintOptions): void {
  ctx.fillStyle = o.palette.ink;
  if (r.full || r.base === 1) {
    ctx.fillRect(r.x, r.y, 1.25, 0.52);
  } else if (r.base === 2) {
    ctx.fillRect(r.x, r.y - 0.52, 1.25, 0.52);
  } else {
    const shape = restShape(r.base);
    if (shape) glyph(ctx, shape, r.x + 0.5, r.y);
  }
  for (let d = 0; d < r.dots; d++) {
    ctx.beginPath();
    ctx.arc(r.x + 1.5 + d * 0.5, r.y - 0.5, 0.17, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintMeasure(ctx: CanvasRenderingContext2D, m: LMeasure, layout: Layout, o: PaintOptions): void {
  const p = o.palette;
  for (const r of m.rests) paintRest(ctx, r, o);

  for (const b of m.beams) {
    const up = b.up;
    const thick = 0.48;
    const dir = up ? 1 : -1;
    ctx.fillStyle = p.ink;
    const slope = b.x2 > b.x1 ? (b.y2 - b.y1) / (b.x2 - b.x1) : 0;
    const bar = (x1: number, x2: number, off: number) => {
      const ya = b.y1 + slope * (x1 - b.x1) + off;
      const yb = b.y1 + slope * (x2 - b.x1) + off;
      ctx.beginPath();
      ctx.moveTo(x1 - 0.06, ya);
      ctx.lineTo(x2 + 0.06, yb);
      ctx.lineTo(x2 + 0.06, yb + thick * dir);
      ctx.lineTo(x1 - 0.06, ya + thick * dir);
      ctx.closePath();
      ctx.fill();
    };
    bar(b.x1, b.x2, 0);
    for (const s of b.subs) bar(s.x1, s.x2, 0.78 * dir);
  }

  for (const c of m.chords) paintChord(ctx, c, layout, o);

  ctx.fillStyle = p.ink;
  for (const t of m.ties) {
    const style = o.style?.(t.src);
    ctx.fillStyle = style?.color ?? p.ink;
    const len = t.x2 - t.x1;
    const h = Math.min(1.0, 0.3 + len * 0.07) * (t.over ? -1 : 1);
    const mx = (t.x1 + t.x2) / 2;
    ctx.beginPath();
    ctx.moveTo(t.x1, t.y);
    ctx.quadraticCurveTo(mx, t.y + h * 1.6, t.x2, t.y);
    ctx.quadraticCurveTo(mx, t.y + h * 1.25, t.x1, t.y);
    ctx.fill();
  }

  // Bar line at the right edge.
  if (layout.bars) {
    ctx.fillStyle = p.ink;
    const x = m.x + m.w;
    const top = -2;
    const bottom = layout.staves === 2 ? layout.dist + 2 : 2;
    if (m.final) {
      vline(ctx, x - 0.75, top, bottom, 0.13);
      vline(ctx, x - 0.2, top, bottom, 0.45);
    } else vline(ctx, x, top, bottom, 0.13);
    if (o.numbers && m.number > 0 && m.number % 1 === 0) {
      ctx.fillStyle = p.faint;
      text(ctx, String(m.number), m.x + 0.3, -3.6, 1.1, o.sp, SANS, 'left');
    }
  }
}

/** Draws every measure that touches [o.from, o.to]. Call inside enter(). */
export function paintMeasures(ctx: CanvasRenderingContext2D, layout: Layout, o: PaintOptions): void {
  if (!layout.measures.length) return;
  // Accidentals and ties reach a little outside their measure.
  const first = measureAt(layout, o.from - 3);
  for (let i = first; i < layout.measures.length; i++) {
    const m = layout.measures[i];
    if (m.x > o.to + 3) break;
    paintMeasure(ctx, m, layout, o);
  }
}

/** A note head drawn at a free position, for keys being pressed. */
export function paintGhost(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  x: number,
  staff: 0 | 1,
  step: number,
  accidental: number | null,
  color: string,
): void {
  const y = stepY(step, staff, layout.dist);
  ctx.fillStyle = color;
  for (let s = 6; s <= step; s += 2) hline(ctx, x - 0.4, x + HEAD_W + 0.4, stepY(s, staff, layout.dist), 0.16);
  for (let s = -6; s >= step; s -= 2) hline(ctx, x - 0.4, x + HEAD_W + 0.4, stepY(s, staff, layout.dist), 0.16);
  if (accidental !== null) glyph(ctx, accidentalShape(accidental), x - 0.75, y);
  headPath(ctx, x, y, 4);
  ctx.fill();
}

/**
 * Music symbols drawn as filled outlines, in staff spaces (y down). Curved
 * symbols are made from brush strokes: a centre line of cubic curves with a
 * width that changes along it, turned into an outline polygon. Original
 * drawings, no font needed. Pure geometry, no DOM.
 */

export interface Shape {
  /** Closed polygons as flat [x0, y0, x1, y1, ...] lists, filled with the non-zero rule. */
  polys: number[][];
  /** Filled circles [cx, cy, r]. */
  dots: [number, number, number][];
}

type Pt = [number, number];

/** One brush segment: a cubic curve from p0 to p3, width w0 at the start and w1 at the end. */
interface Seg {
  p: [Pt, Pt, Pt, Pt];
  w: [number, number];
}

const seg = (p0: Pt, c1: Pt, c2: Pt, p3: Pt, w0: number, w1: number): Seg => ({ p: [p0, c1, c2, p3], w: [w0, w1] });
const line = (a: Pt, b: Pt, w0: number, w1 = w0): Seg =>
  seg(a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], b, w0, w1);

function bez(p: Seg['p'], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

/** Turns a chain of brush segments into one outline polygon with round-ish ends. */
export function brush(segs: readonly Seg[], steps = 20): number[] {
  const pts: Pt[] = [];
  const widths: number[] = [];
  segs.forEach((s, i) => {
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      // Ease the width so thick parts swell smoothly.
      const e = t * t * (3 - 2 * t);
      pts.push(bez(s.p, t));
      widths.push(s.w[0] + (s.w[1] - s.w[0]) * e);
    }
  });
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const h = widths[i] / 2;
    left.push([pts[i][0] - dy * h, pts[i][1] + dx * h]);
    right.push([pts[i][0] + dy * h, pts[i][1] - dx * h]);
  }
  const out: number[] = [];
  for (const p of left) out.push(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) out.push(right[i][0], right[i][1]);
  return out;
}

const poly = (...pts: number[]) => pts;

/** Treble (G) clef. Origin: left edge, on the G line. */
export const TREBLE: Shape = {
  polys: [
    brush([
      seg([1.62, -0.12], [1.55, -0.78], [0.42, -0.72], [0.36, 0.2], 0.1, 0.34),
      seg([0.36, 0.2], [0.3, 0.86], [0.85, 1.12], [1.38, 1.08], 0.34, 0.13),
      seg([1.38, 1.08], [1.98, 1.04], [2.36, 0.6], [2.3, 0.08], 0.13, 0.3),
      seg([2.3, 0.08], [2.24, -0.55], [1.5, -0.98], [1.08, -1.5], 0.3, 0.3),
      seg([1.08, -1.5], [0.62, -2.05], [0.5, -2.62], [0.86, -3.2], 0.3, 0.2),
      seg([0.86, -3.2], [1.08, -3.6], [1.4, -3.95], [1.62, -4.38], 0.2, 0.08),
      seg([1.62, -4.38], [1.86, -3.75], [1.55, -3.1], [1.33, -2.45], 0.08, 0.15),
      seg([1.33, -2.45], [1.25, -1.0], [1.55, 0.6], [1.66, 1.9], 0.15, 0.15),
      seg([1.66, 1.9], [1.72, 2.5], [1.22, 2.68], [0.82, 2.4], 0.15, 0.17),
    ]),
  ],
  dots: [[0.98, 2.2, 0.36]],
};

/** Bass (F) clef. Origin: left edge, on the F line. */
export const BASS: Shape = {
  polys: [
    brush([
      seg([0.22, -0.1], [0.28, -0.8], [0.72, -1.02], [1.18, -1.0], 0.2, 0.18),
      seg([1.18, -1.0], [1.78, -0.98], [2.12, -0.55], [2.1, 0.0], 0.18, 0.4),
      seg([2.1, 0.0], [2.08, 1.05], [1.2, 1.95], [0.15, 2.5], 0.4, 0.07),
    ]),
  ],
  dots: [
    [0.46, 0.0, 0.34],
    [2.62, -0.5, 0.15],
    [2.62, 0.5, 0.15],
  ],
};

/** Sharp, centred on its note. */
export const SHARP: Shape = {
  polys: [
    poly(-0.28, -1.25, -0.17, -1.25, -0.17, 1.45, -0.28, 1.45),
    poly(0.17, -1.45, 0.28, -1.45, 0.28, 1.25, 0.17, 1.25),
    poly(-0.52, -0.22, 0.52, -0.58, 0.52, -0.3, -0.52, 0.06),
    poly(-0.52, 0.58, 0.52, 0.22, 0.52, 0.5, -0.52, 0.86),
  ],
  dots: [],
};

/** Flat, centred on its note (the bowl sits on the note). */
export const FLAT: Shape = {
  polys: [
    poly(-0.42, -1.75, -0.3, -1.75, -0.3, 0.55, -0.42, 0.55),
    brush([
      seg([-0.36, -0.08], [-0.05, -0.52], [0.55, -0.55], [0.46, -0.12], 0.08, 0.2),
      seg([0.46, -0.12], [0.4, 0.15], [0.0, 0.38], [-0.36, 0.55], 0.2, 0.09),
    ]),
  ],
  dots: [],
};

/** Natural, centred on its note. */
export const NATURAL: Shape = {
  polys: [
    poly(-0.36, -1.35, -0.25, -1.35, -0.25, 0.55, -0.36, 0.55),
    poly(0.25, -0.55, 0.36, -0.55, 0.36, 1.35, 0.25, 1.35),
    poly(-0.36, -0.3, 0.36, -0.55, 0.36, -0.3, -0.36, -0.05),
    poly(-0.36, 0.3, 0.36, 0.05, 0.36, 0.3, -0.36, 0.55),
  ],
  dots: [],
};

/** Quarter rest, centred on the middle line. */
export const QUARTER_REST: Shape = {
  polys: [
    brush([
      line([-0.3, -1.55], [0.32, -0.8], 0.12, 0.3),
      seg([0.32, -0.8], [-0.05, -0.45], [-0.12, -0.2], [0.0, -0.02], 0.3, 0.12),
      line([0.0, -0.02], [0.36, 0.48], 0.12, 0.34),
      seg([0.36, 0.48], [-0.12, 0.3], [-0.45, 0.85], [0.08, 1.45], 0.34, 0.1),
    ]),
  ],
  dots: [],
};

function hookRest(levels: number): Shape {
  const polys: number[][] = [];
  const dots: [number, number, number][] = [];
  for (let i = 0; i < levels; i++) {
    const oy = i * 1.0;
    const ox = -i * 0.28;
    dots.push([ox - 0.28, -0.6 + oy, 0.24]);
    polys.push(brush([seg([ox - 0.4, -0.45 + oy], [ox - 0.05, -0.25 + oy], [ox + 0.3, -0.35 + oy], [ox + 0.5, -0.75 + oy], 0.12, 0.12)]));
  }
  const bottom = -0.75 + levels * 1.0 + 0.75;
  polys.push(brush([line([0.5, -0.75], [0.5 - (bottom + 0.75) * 0.28, bottom], 0.13, 0.13)]));
  return { polys, dots };
}

export const EIGHTH_REST = hookRest(1);
export const SIXTEENTH_REST = hookRest(2);

/** Flag for an up stem. Origin: top of the stem; draw mirrored (scale y by -1) for down stems. */
export const FLAG: Shape = {
  polys: [brush([seg([0.03, 0], [0.12, 1.0], [1.35, 1.25], [0.9, 2.9], 0.36, 0.08)])],
  dots: [],
};

export const SIXTEENTH_FLAG: Shape = {
  polys: [
    brush([seg([0.03, 0], [0.12, 0.8], [1.25, 1.0], [0.95, 2.1], 0.34, 0.08)]),
    brush([seg([0.03, 0.85], [0.12, 1.65], [1.3, 1.85], [0.9, 3.2], 0.34, 0.08)]),
  ],
  dots: [],
};

/** Brace joining the two staves. Origin: right edge, top; height in staff spaces. */
export function brace(height: number): Shape {
  const h = height;
  const m = h / 2;
  return {
    polys: [
      brush(
        [
          seg([0, 0], [-0.9, h * 0.08], [-0.05, m * 0.7], [-0.75, m], 0.06, 0.32),
          seg([-0.75, m], [-0.05, m * 1.3], [-0.9, h * 0.92], [0, h], 0.32, 0.06),
        ],
        28,
      ),
    ],
    dots: [],
  };
}

export function accidentalShape(alter: number): Shape {
  return alter > 0 ? SHARP : alter < 0 ? FLAT : NATURAL;
}

export function restShape(base: number): Shape | null {
  if (base === 4) return QUARTER_REST;
  if (base === 8) return EIGHTH_REST;
  if (base >= 16) return SIXTEENTH_REST;
  return null;
}

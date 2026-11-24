/**
 * Generative cover art: every song gets its own illustrated cover, made from
 * its data, with no photos and no downloads. The style (from tags and source)
 * picks the colourway family and a simple original motif; the composer picks
 * the colourway within the family (so one composer's pieces look related); the
 * song id picks the pattern, the layout and the small details. The result is
 * deterministic per song and cheap: one small inline SVG with 10 to 40 shapes.
 *
 * Also: unitArt() for the course units, in the same visual language.
 *
 * All markup here is built from numbers and colours in this file only, never
 * from song text, so it is safe to assign as SVG markup.
 */

export interface CoverInput {
  id: string;
  title?: string;
  by?: string;
  tags?: readonly string[];
  difficulty?: number;
  source?: 'built-in' | 'mine' | 'community';
}

export type CoverStyle =
  | 'lullaby'
  | 'holiday'
  | 'march'
  | 'ragtime'
  | 'dance'
  | 'hymn'
  | 'children'
  | 'folk'
  | 'classical'
  | 'mine'
  | 'shared'
  | 'tune';

export type Pattern = 'waves' | 'keys' | 'arcs' | 'dots' | 'stripes';

type Motif =
  | 'moon'
  | 'star'
  | 'snowflake'
  | 'tree'
  | 'leaf'
  | 'flower'
  | 'column'
  | 'lyre'
  | 'feather'
  | 'metronome'
  | 'hat'
  | 'bell'
  | 'window'
  | 'drum'
  | 'flag'
  | 'swirl'
  | 'fan'
  | 'balloon'
  | 'kite'
  | 'boat'
  | 'wave'
  | 'heart'
  | 'note';

/** [background, blob, motif main colour, motif second colour, pattern colour] */
type Colorway = readonly [string, string, string, string, string];

const CREAM = '#fff7e8';
const INK = '#10304a';
const SUN = '#ffd23f';
const CORAL = '#ff7d6e';

const STYLES: Record<CoverStyle, { colorways: readonly Colorway[]; motifs: readonly Motif[] }> = {
  lullaby: {
    colorways: [
      ['#2b3f8f', '#4061c2', '#ffe9a8', SUN, CREAM],
      ['#1d5a8f', '#3a86c4', '#ffe9a8', CORAL, CREAM],
    ],
    motifs: ['moon'],
  },
  holiday: {
    colorways: [
      ['#d6453a', '#ff7d6e', SUN, CREAM, CREAM],
      ['#137a5c', '#2aa883', SUN, CORAL, CREAM],
      ['#1d3f8f', '#3463c9', CREAM, SUN, CREAM],
    ],
    motifs: ['star', 'snowflake', 'tree'],
  },
  march: {
    colorways: [
      ['#163a7a', '#2c5bb8', CORAL, CREAM, CREAM],
      ['#c9503f', '#ff7d6e', CREAM, SUN, CREAM],
    ],
    motifs: ['drum', 'flag'],
  },
  ragtime: {
    colorways: [
      ['#e2566e', '#ff9aa8', INK, CREAM, CREAM],
      ['#ffc93c', '#ffe27a', INK, CORAL, INK],
    ],
    motifs: ['hat'],
  },
  dance: {
    colorways: [
      ['#ffc93c', '#ffe27a', '#e2566e', INK, INK],
      ['#e2566e', '#ff9aa8', SUN, CREAM, CREAM],
      ['#2aa883', '#5fe3b8', CREAM, CORAL, INK],
    ],
    motifs: ['swirl', 'fan'],
  },
  hymn: {
    colorways: [
      ['#3f6fd0', '#8fd3ff', CREAM, SUN, CREAM],
      ['#0c6f8c', '#2fa3bf', SUN, CREAM, CREAM],
    ],
    motifs: ['bell', 'window'],
  },
  children: {
    colorways: [
      ['#47b6e6', '#8fd3ff', CORAL, SUN, CREAM],
      ['#ffc93c', '#ffe27a', '#e2566e', '#2aa883', INK],
      ['#5fe3b8', '#a8f2d8', CORAL, INK, INK],
      ['#ff7d6e', '#ffb0a5', SUN, CREAM, CREAM],
    ],
    motifs: ['balloon', 'kite', 'boat'],
  },
  folk: {
    colorways: [
      ['#1f9a74', '#5fe3b8', CREAM, INK, CREAM],
      ['#c9503f', '#ff7d6e', SUN, CREAM, CREAM],
      ['#0c6f8c', '#2fa3bf', '#a8f2d8', SUN, CREAM],
    ],
    motifs: ['leaf', 'flower'],
  },
  classical: {
    colorways: [
      ['#0c6f8c', '#2fa3bf', CREAM, SUN, CREAM],
      ['#c9503f', '#ff7d6e', CREAM, SUN, CREAM],
      ['#1d3f8f', '#3463c9', CREAM, CORAL, CREAM],
      ['#137a5c', '#2aa883', CREAM, SUN, CREAM],
      ['#ffc93c', '#ffe27a', INK, CORAL, INK],
      ['#e2566e', '#ff9aa8', CREAM, INK, CREAM],
    ],
    motifs: ['column', 'lyre', 'feather', 'metronome'],
  },
  mine: {
    colorways: [
      ['#ff7d6e', SUN, INK, CREAM, INK],
      [SUN, '#ffe27a', INK, CORAL, INK],
    ],
    motifs: ['wave'],
  },
  shared: {
    colorways: [
      ['#2aa883', '#5fe3b8', CREAM, CORAL, CREAM],
      ['#3f6fd0', '#8fd3ff', CORAL, CREAM, CREAM],
    ],
    motifs: ['heart'],
  },
  tune: {
    colorways: [
      ['#0b5a80', '#1a7fa8', SUN, CREAM, CREAM],
      ['#1d3f8f', '#3463c9', SUN, CORAL, CREAM],
    ],
    motifs: ['note'],
  },
};

const PATTERNS: readonly Pattern[] = ['waves', 'keys', 'arcs', 'dots', 'stripes'];

/** A small, stable string hash (FNV-1a). */
export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A tiny seeded random generator (mulberry32), so every cover is the same each time. */
function random(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which family a song belongs to. The first matching tag wins, in this order. */
export function coverStyle(song: Pick<CoverInput, 'tags' | 'source'>): CoverStyle {
  const tags = new Set((song.tags ?? []).map((t) => t.toLowerCase()));
  for (const style of ['lullaby', 'holiday', 'march', 'ragtime', 'dance', 'hymn', 'children', 'folk', 'classical'] as const) {
    if (tags.has(style)) return style;
  }
  if (tags.has('christmas') || tags.has('carol')) return 'holiday';
  if (tags.has('traditional')) return 'folk';
  if (song.source === 'mine') return 'mine';
  if (song.source === 'community') return 'shared';
  return 'tune';
}

export interface CoverSpec {
  style: CoverStyle;
  colorway: Colorway;
  motif: Motif;
  pattern: Pattern;
  seed: number;
}

/** Everything that decides how a cover looks, as plain data (tested in tests/cover-art.test.ts). */
export function coverSpec(song: CoverInput): CoverSpec {
  const style = coverStyle(song);
  const family = STYLES[style];
  const seed = hashText(song.id);
  // A named composer keeps one look across their pieces; traditional and unknown tunes vary per song.
  const by = (song.by ?? '').trim().toLowerCase();
  const named = by !== '' && !by.startsWith('traditional') && !by.startsWith('anonymous') && !by.startsWith('unknown');
  const who = named ? hashText(`${style}:${by}`) : hashText(`${style}:${song.id}:look`);
  return {
    style,
    colorway: family.colorways[who % family.colorways.length],
    motif: family.motifs[(who >>> 4) % family.motifs.length],
    pattern: PATTERNS[seed % PATTERNS.length],
    seed,
  };
}

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

function patternMarkup(pattern: Pattern, color: string, rnd: () => number): string {
  const o = (0.16 + rnd() * 0.08).toFixed(2);
  switch (pattern) {
    case 'waves': {
      let d = '';
      const amp = 5 + rnd() * 4;
      for (let y = 14 + rnd() * 10; y < 125; y += 20) {
        d += `M-10 ${f(y)}`;
        for (let x = -10; x < 170; x += 30) d += ` q15 ${f(-amp)} 30 0`;
      }
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity="${o}"/>`;
    }
    case 'keys': {
      // A strip of piano keys along the bottom edge.
      const top = 86 + rnd() * 6;
      let s = `<g opacity="${o}"><rect x="0" y="${f(top)}" width="160" height="${f(120 - top)}" fill="${color}"/>`;
      const w = 16;
      for (let i = 0; i <= 10; i++) {
        const x = i * w;
        s += `<rect x="${f(x - 1)}" y="${f(top)}" width="2" height="${f(120 - top)}" fill="#000" opacity="0.5"/>`;
        if ([0, 1, 3, 4, 5, 7, 8].includes(i % 7)) s += `<rect x="${f(x + w - 4.5)}" y="${f(top)}" width="9" height="${f((120 - top) * 0.6)}" rx="2" fill="#000"/>`;
      }
      return `${s}</g>`;
    }
    case 'arcs': {
      const cx = rnd() < 0.5 ? 0 : 160;
      const cy = rnd() < 0.5 ? 0 : 120;
      let s = `<g fill="none" stroke="${color}" stroke-width="7" opacity="${o}">`;
      for (let r = 30; r < 200; r += 22) s += `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
      return `${s}</g>`;
    }
    case 'dots': {
      let s = `<g fill="${color}" opacity="${o}">`;
      const step = 18;
      const off = rnd() * step;
      for (let y = 6; y < 120; y += step) {
        for (let x = 6 + ((y / step) % 2) * (step / 2) - off; x < 165; x += step) s += `<circle cx="${f(x)}" cy="${f(y)}" r="3.2"/>`;
      }
      return `${s}</g>`;
    }
    case 'stripes': {
      let s = `<g stroke="${color}" stroke-width="9" opacity="${o}">`;
      const dir = rnd() < 0.5 ? 1 : -1;
      for (let x = -140; x < 300; x += 26) s += `<path d="M${x} 0 l${dir * 120} 120"/>`;
      return `${s}</g>`;
    }
  }
}

/** Motifs, drawn around (0, 0) in a box from -30 to 30. a = main colour, b = second colour. */
function motifMarkup(motif: Motif, a: string, b: string): string {
  switch (motif) {
    case 'moon':
      return `<path d="M6-27a28 28 0 1 0 22 40A24 24 0 0 1 6-27z" fill="${a}"/><path d="M-22-22l2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1z" fill="${b}"/><circle cx="-6" cy="-30" r="2.5" fill="${b}"/>`;
    case 'star':
      return `<path d="M0-30l8.8 18 19.7 2.9-14.3 13.9 3.4 19.7L0 15.2l-17.6 9.3 3.4-19.7-14.3-13.9 19.7-2.9z" fill="${a}" stroke="${b}" stroke-width="3" stroke-linejoin="round"/><circle cx="0" cy="0" r="4" fill="${b}"/>`;
    case 'snowflake':
      return `<g stroke="${a}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M0-28V28M-24-14L24 14M-24 14L24-14"/><path d="M-7-22L0-15l7-7M-7 22L0 15l7 7M-23-5l9-2-2-9M23 5l-9 2 2 9M-23 5l9 2-2 9M23-5l-9-2 2-9"/></g><circle r="5" fill="${b}"/>`;
    case 'tree':
      return `<path d="M0-30L18-4H9L24 16H-24L-9-4H-18z" fill="${a}" stroke-linejoin="round"/><rect x="-5" y="16" width="10" height="12" rx="2" fill="${b}"/><circle cx="-6" cy="4" r="3" fill="${b}"/><circle cx="8" cy="-8" r="3" fill="${b}"/><circle cx="0" cy="-32" r="5" fill="${b}"/>`;
    case 'leaf':
      return `<path d="M-22 26C-26-6-6-26 26-28c0 32-18 54-48 54z" fill="${a}"/><path d="M-22 26L14-14M-6 8l-2-14M4-2l12 2" stroke="${b}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
    case 'flower':
      return `<g fill="${a}"><circle cy="-15" r="12"/><circle cx="14.3" cy="-4.6" r="12"/><circle cx="8.8" cy="12.1" r="12"/><circle cx="-8.8" cy="12.1" r="12"/><circle cx="-14.3" cy="-4.6" r="12"/></g><circle r="9" fill="${b}"/>`;
    case 'column':
      return `<rect x="-24" y="-28" width="48" height="8" rx="3" fill="${a}"/><path d="M-26-24c-4 0-6 4-4 7M26-24c4 0 6 4 4 7" stroke="${a}" stroke-width="4" fill="none" stroke-linecap="round"/><rect x="-17" y="-20" width="34" height="40" fill="${a}"/><path d="M-9-18v36M0-18v36M9-18v36" stroke="${b}" stroke-width="3" stroke-linecap="round"/><rect x="-24" y="20" width="48" height="9" rx="3" fill="${a}"/>`;
    case 'lyre':
      return `<path d="M-18-26c-12 10-8 34 4 44h28c12-10 16-34 4-44" fill="none" stroke="${a}" stroke-width="6" stroke-linecap="round"/><rect x="-22" y="-30" width="44" height="7" rx="3.5" fill="${a}"/><path d="M-8-23v40M0-23v40M8-23v40" stroke="${b}" stroke-width="2.5"/><rect x="-16" y="16" width="32" height="8" rx="4" fill="${a}"/>`;
    case 'feather':
      return `<path d="M24-30C-6-28-22-4-20 26 6 22 26-2 24-30z" fill="${a}"/><path d="M-24 30L18-22" stroke="${b}" stroke-width="3.5" stroke-linecap="round"/><path d="M-6 8l-10-2M2-2l-8-6M8-10l-4-8" stroke="${b}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'metronome':
      return `<path d="M-10-28h20l14 56h-48z" fill="${a}" stroke-linejoin="round"/><rect x="-16" y="12" width="32" height="7" rx="2" fill="${b}"/><path d="M0 10L14-26" stroke="${b}" stroke-width="4" stroke-linecap="round"/><circle cx="9" cy="-13" r="5" fill="${b}"/>`;
    case 'hat':
      return `<ellipse cx="0" cy="14" rx="32" ry="9" fill="${a}"/><path d="M-18 12v-24c0-8 36-8 36 0v24z" fill="${a}"/><rect x="-18" y="-1" width="36" height="8" fill="${b}"/><path d="M-26 22c-4 4 0 6 6 4" stroke="${b}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'bell':
      return `<path d="M0-28c-12 0-18 10-18 24v10l-7 9h50l-7-9V-4c0-14-6-24-18-24z" fill="${a}" stroke-linejoin="round"/><circle cx="0" cy="22" r="6" fill="${b}"/><path d="M0-28v-5" stroke="${a}" stroke-width="5" stroke-linecap="round"/><path d="M-26-14c-6 4-6 12 0 16M26-14c6 4 6 12 0 16" stroke="${b}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'window':
      return `<path d="M-20 28V-6a20 20 0 0 1 40 0v34z" fill="${a}"/><path d="M-12 22V-4a12 12 0 0 1 24 0v26z" fill="${b}"/><path d="M0-16V22M-12 4h24" stroke="${a}" stroke-width="3"/>`;
    case 'drum':
      return `<ellipse cx="0" cy="-10" rx="26" ry="9" fill="${b}"/><path d="M-26-10v26c0 5 12 9 26 9s26-4 26-9v-26c0 5-12 9-26 9s-26-4-26-9z" fill="${a}"/><path d="M-26-4l13 20 13-20 13 20 13-20" stroke="${b}" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M-20-34l14 20M22-34L8-14" stroke="${b}" stroke-width="4" stroke-linecap="round"/><circle cx="-20" cy="-34" r="4" fill="${a}"/><circle cx="22" cy="-34" r="4" fill="${a}"/>`;
    case 'flag':
      return `<path d="M-20-30v60" stroke="${b}" stroke-width="5" stroke-linecap="round"/><path d="M-18-28c14-6 22 6 38 0v28c-16 6-24-6-38 0z" fill="${a}"/><circle cx="-20" cy="-31" r="4.5" fill="${b}"/>`;
    case 'swirl':
      return `<path d="M2 2a5 5 0 1 0-8-4 10 10 0 1 0 18 6A16 16 0 1 0-18 12" fill="none" stroke="${a}" stroke-width="7" stroke-linecap="round"/><circle cx="24" cy="-22" r="4" fill="${b}"/><circle cx="-26" cy="-20" r="3" fill="${b}"/>`;
    case 'fan':
      return `<path d="M0 22L-28-10a40 40 0 0 1 56 0z" fill="${a}"/><path d="M0 22L-14-22M0 22L0-26M0 22L14-22" stroke="${b}" stroke-width="3"/><circle cx="0" cy="22" r="5" fill="${b}"/>`;
    case 'balloon':
      return `<ellipse cx="0" cy="-8" rx="20" ry="23" fill="${a}"/><path d="M-3 15h6l-3 5z" fill="${a}"/><path d="M0 20c-6 6 6 8 0 16" stroke="${b}" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="-8" cy="-18" rx="4" ry="7" fill="#fff" opacity="0.45"/>`;
    case 'kite':
      return `<path d="M0-30L20-4 0 18-20-4z" fill="${a}"/><path d="M0-30V18M-20-4h40" stroke="${b}" stroke-width="2.5"/><path d="M0 18c4 6-4 8 0 14" stroke="${b}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M-4 24l4 2 4-2M-4 32l4 2 4-2" stroke="${a}" stroke-width="3" fill="none"/>`;
    case 'boat':
      return `<path d="M-28 10h56l-9 14h-38z" fill="${a}"/><path d="M2 8V-30l20 34z" fill="${b}"/><path d="M-2 8V-20l-16 24z" fill="${b}" opacity="0.8"/>`;
    case 'wave':
      return `<g fill="${a}"><rect x="-27" y="-6" width="7" height="12" rx="3.5"/><rect x="-16" y="-18" width="7" height="36" rx="3.5"/><rect x="-5" y="-26" width="7" height="52" rx="3.5"/><rect x="6" y="-14" width="7" height="28" rx="3.5"/><rect x="17" y="-20" width="7" height="40" rx="3.5"/></g><circle cx="28" cy="-24" r="4" fill="${b}"/>`;
    case 'heart':
      return `<path d="M0 26S-28 10-28-8a14 14 0 0 1 28-6 14 14 0 0 1 28 6c0 18-28 34-28 34z" fill="${a}"/><ellipse cx="-14" cy="-10" rx="5" ry="7" fill="${b}" opacity="0.7"/>`;
    case 'note':
      return `<path d="M-6 18V-26l26-6v40" fill="none" stroke="${a}" stroke-width="6" stroke-linejoin="round"/><ellipse cx="-14" cy="18" rx="10" ry="8" fill="${a}" transform="rotate(-20 -14 18)"/><ellipse cx="12" cy="10" rx="10" ry="8" fill="${a}" transform="rotate(-20 12 10)"/><circle cx="-24" cy="-22" r="3" fill="${b}"/>`;
  }
}

const NS = 'http://www.w3.org/2000/svg';

function svgElement(viewBox: string, className: string, markup: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.innerHTML = markup;
  return svg;
}

/** The cover markup for a song (exported for tests and for the style guide). */
export function coverMarkup(song: CoverInput): string {
  const spec = coverSpec(song);
  const [bg, blob, a, b, pat] = spec.colorway;
  const rnd = random(spec.seed);
  const corner = Math.floor(rnd() * 4);
  const bx = corner % 2 === 0 ? 10 + rnd() * 30 : 120 + rnd() * 30;
  const by = corner < 2 ? 10 + rnd() * 20 : 90 + rnd() * 20;
  const br = 52 + rnd() * 22;
  const mx = 80 + (rnd() - 0.5) * 30;
  const my = 58 + (rnd() - 0.5) * 12;
  const rot = (rnd() - 0.5) * 26;
  const scale = 1.05 + rnd() * 0.25;
  let sparkles = '';
  const count = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const x = 12 + rnd() * 136;
    const y = 10 + rnd() * 100;
    if (Math.abs(x - mx) < 40 && Math.abs(y - my) < 40) continue;
    sparkles += i % 2 === 0
      ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(2.5 + rnd() * 2.5)}" fill="${b}"/>`
      : `<path d="M${f(x)} ${f(y - 6)}l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z" fill="${b}"/>`;
  }
  return (
    `<rect width="160" height="120" fill="${bg}"/>` +
    `<circle cx="${f(bx)}" cy="${f(by)}" r="${f(br)}" fill="${blob}"/>` +
    patternMarkup(spec.pattern, pat, rnd) +
    sparkles +
    `<g transform="translate(${f(mx)} ${f(my)}) rotate(${f(rot)}) scale(${f(scale)})">` +
    `<g transform="translate(3 4)" opacity="0.18">${motifMarkup(spec.motif, '#000', '#000')}</g>` +
    motifMarkup(spec.motif, a, b) +
    `</g>`
  );
}

/** A song's cover as an inline SVG (4:3). Decorative: the card next to it carries the words. */
export function songCover(song: CoverInput, className = 'pcard-cover'): SVGSVGElement {
  return svgElement('0 0 160 120', className, coverMarkup(song));
}

/** The background colour of a song's cover, for tinting things around it (a sheet header). */
export function coverColor(song: CoverInput): string {
  return coverSpec(song).colorway[0];
}

// ---------- Course units ----------

const UNIT_COLORS: readonly Colorway[] = [
  ['#8fd3ff', '#c4e9ff', INK, CORAL, INK],
  ['#ff7d6e', '#ffb0a5', CREAM, INK, CREAM],
  ['#5fe3b8', '#a8f2d8', INK, CORAL, INK],
  [SUN, '#ffe27a', INK, CORAL, INK],
  ['#e2566e', '#ff9aa8', CREAM, SUN, CREAM],
  ['#2aa883', '#5fe3b8', CREAM, SUN, CREAM],
  ['#3f6fd0', '#8fd3ff', CREAM, SUN, CREAM],
  ['#ffc93c', '#ffe27a', INK, '#2aa883', INK],
  ['#c9503f', '#ff7d6e', CREAM, SUN, CREAM],
];

function hand(a: string, b: string, mirror = false): string {
  const t = mirror ? ' transform="scale(-1 1)"' : '';
  return `<g${t}><rect x="-14" y="-4" width="30" height="30" rx="11" fill="${a}"/><rect x="-13" y="-24" width="7" height="28" rx="3.5" fill="${a}"/><rect x="-4.5" y="-29" width="7" height="32" rx="3.5" fill="${a}"/><rect x="4" y="-27" width="7" height="30" rx="3.5" fill="${a}"/><rect x="12" y="-20" width="6.5" height="24" rx="3.2" fill="${a}"/><rect x="-28" y="0" width="7" height="20" rx="3.5" fill="${a}" transform="rotate(-38 -24 10)"/><circle cx="1" cy="12" r="3" fill="${b}"/></g>`;
}

/** Motifs for the nine units, in course order. */
function unitMotif(index: number, a: string, b: string): string {
  switch (index % 9) {
    case 0: // meet the keyboard
      return `<rect x="-30" y="-20" width="60" height="40" rx="8" fill="${a}"/><g fill="${b}"><rect x="-26" y="-16" width="11" height="32" rx="3"/><rect x="-13" y="-16" width="11" height="32" rx="3"/><rect x="0" y="-16" width="11" height="32" rx="3"/><rect x="13" y="-16" width="11" height="32" rx="3"/></g><g fill="${a}"><rect x="-18" y="-16" width="7" height="18" rx="2"/><rect x="-5" y="-16" width="7" height="18" rx="2"/><rect x="21" y="-16" width="5" height="18" rx="2"/></g>`;
    case 1: // right hand
      return hand(a, b);
    case 2: // rhythm
      return motifMarkup('drum', a, b);
    case 3: // left hand
      return hand(a, b, true);
    case 4: // hands together
      return `<g transform="translate(-13 4) scale(0.72)">${hand(a, b, true)}</g><g transform="translate(13 4) scale(0.72)">${hand(a, b)}</g>`;
    case 5: // moving around
      return motifMarkup('boat', a, b);
    case 6: // chords
      return `<path d="M-28-14h56M-28-2h56M-28 10h56M-28 22h56" stroke="${a}" stroke-width="2.5" opacity="0.6"/><g fill="${a}"><ellipse cx="0" cy="22" rx="9" ry="6.5"/><ellipse cx="0" cy="10" rx="9" ry="6.5"/><ellipse cx="0" cy="-2" rx="9" ry="6.5"/></g><path d="M8.5 22V-30" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/><circle cx="-20" cy="-24" r="4" fill="${b}"/>`;
    case 7: // reading music
      return `<rect x="-30" y="-24" width="60" height="48" rx="8" fill="${a}"/><path d="M-24-12h48M-24-4h48M-24 4h48M-24 12h48" stroke="${b}" stroke-width="2"/><ellipse cx="-10" cy="8" rx="5.5" ry="4.2" fill="${b}"/><path d="M-5 8v-18" stroke="${b}" stroke-width="2.5"/><ellipse cx="10" cy="0" rx="5.5" ry="4.2" fill="${b}"/><path d="M15 0v-18" stroke="${b}" stroke-width="2.5"/>`;
    default: // expression
      return `${motifMarkup('heart', a, b)}<path d="M-34-6c-4 6-4 12 0 18M34-6c4 6 4 12 0 18" stroke="${a}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  }
}

/** Art for a course unit (0-based index in the course), square, same language as song covers. */
export function unitArtMarkup(index: number): string {
  const [bg, blob, a, b, pat] = UNIT_COLORS[((index % 9) + 9) % 9];
  const rnd = random(hashText(`unit:${index}`));
  return (
    `<rect width="120" height="120" fill="${bg}"/>` +
    `<circle cx="${f(20 + rnd() * 80)}" cy="${f(rnd() < 0.5 ? 6 : 114)}" r="${f(46 + rnd() * 14)}" fill="${blob}"/>` +
    `<g transform="translate(-20 0)">${patternMarkup(PATTERNS[index % PATTERNS.length], pat, rnd)}</g>` +
    `<g transform="translate(60 62) scale(1.15)"><g transform="translate(3 4)" opacity="0.16">${unitMotif(index, '#000', '#000')}</g>${unitMotif(index, a, b)}</g>`
  );
}

export function unitArt(index: number, className = 'unit-art'): SVGSVGElement {
  return svgElement('0 0 120 120', className, unitArtMarkup(index));
}

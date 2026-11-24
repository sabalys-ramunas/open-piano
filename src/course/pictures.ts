import { isBlack, noteName } from '../song';
import type { Finger, HandPicture, KeyMark, RhythmPicture, StaffPicture } from './types';

const NS = 'http://www.w3.org/2000/svg';

type SvgAttrs = Record<string, string | number>;

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

const WHITE_W = 40;
const WHITE_H = 150;
const BLACK_W = 24;
const BLACK_H = 92;

export interface KeyboardOptions {
  lo: number;
  hi: number;
  marks?: KeyMark[];
  names?: boolean;
  groups?: boolean;
  /** Accessible description of the picture. */
  label: string;
}

/** A keyboard drawing. When used for playing, the course screen attaches the pointer to `el`. */
export interface KeyboardPicture {
  el: SVGSVGElement;
  /** Key under a point given in viewport (client) coordinates. */
  keyAtPoint(clientX: number, clientY: number): number | null;
  /** Keys that glow as a hint. */
  setLit(keys: Iterable<number>): void;
  /** Keys held down right now. */
  setHeld(keys: Iterable<number>): void;
  /** A short flash on a key: green for right, red for wrong. */
  flash(midi: number, kind: 'right' | 'wrong'): void;
  /** Computer-key letters to print on keys (empty to hide). */
  setLetters(letters: ReadonlyMap<number, string>): void;
  destroy(): void;
}

/** Black keys in the group of two (C#, D#) or three (F#, G#, A#). */
const groupOf = (midi: number) => ([1, 3].includes(midi % 12) ? 'two' : 'three');

export function keyboardPicture(o: KeyboardOptions): KeyboardPicture {
  const whites: number[] = [];
  for (let m = o.lo; m <= o.hi; m++) if (!isBlack(m)) whites.push(m);
  const width = whites.length * WHITE_W;
  // A rounded case around the keys with a coral felt strip, like a toy piano.
  const root = svg('svg', { viewBox: `-8 -14 ${width + 16} ${WHITE_H + 22}`, class: 'kb', role: 'img', 'aria-label': o.label });
  root.style.setProperty('--whites', String(whites.length));
  root.append(
    svg('rect', { x: -8, y: -14, width: width + 16, height: WHITE_H + 22, rx: 16, class: 'kb-case' }),
    svg('rect', { x: -2, y: -8, width: width + 4, height: 7, rx: 3.5, class: 'kb-felt' }),
  );
  const keyEls = new Map<number, SVGGElement>();
  const letterEls = new Map<number, SVGTextElement>();
  const xOf = new Map<number, number>();
  whites.forEach((m, i) => xOf.set(m, i * WHITE_W));

  const whiteLayer = svg('g');
  const blackLayer = svg('g');
  root.append(whiteLayer, blackLayer);

  for (const m of whites) {
    const x = xOf.get(m)!;
    const g = svg('g', { class: 'kb-key kb-white', 'data-midi': m });
    g.append(svg('rect', { x: x + 1.5, y: 0, width: WHITE_W - 3, height: WHITE_H, rx: 7 }));
    if (o.names) g.append(svg('text', { x: x + WHITE_W / 2, y: WHITE_H - 12, class: 'kb-name' }, noteName(m)));
    // The little C landmark, except under a mark (a quiz's "?" must not give the answer away).
    else if (m % 12 === 0 && !o.marks?.some((k) => k.midi === m)) g.append(svg('text', { x: x + WHITE_W / 2, y: WHITE_H - 12, class: 'kb-c' }, 'C'));
    const letter = svg('text', { x: x + WHITE_W / 2, y: 22, class: 'kb-letter' });
    letterEls.set(m, letter);
    g.append(letter);
    whiteLayer.append(g);
    keyEls.set(m, g);
  }
  for (let m = o.lo; m <= o.hi; m++) {
    if (!isBlack(m) || !xOf.has(m - 1)) continue;
    const x = xOf.get(m - 1)! + WHITE_W - BLACK_W / 2;
    const cls = `kb-key kb-black${o.groups ? ` kb-group-${groupOf(m)}` : ''}`;
    const g = svg('g', { class: cls, 'data-midi': m });
    g.append(svg('rect', { x, y: 0, width: BLACK_W, height: BLACK_H, rx: 5 }), svg('rect', { x: x + 4, y: BLACK_H - 16, width: BLACK_W - 8, height: 10, rx: 3, class: 'kb-shine' }));
    const letter = svg('text', { x: x + BLACK_W / 2, y: 20, class: 'kb-letter kb-letter-black' });
    letterEls.set(m, letter);
    g.append(letter);
    blackLayer.append(g);
    keyEls.set(m, g);
  }

  // Marks: a coloured dot with a finger number or a short label.
  const markLayer = svg('g', { class: 'kb-marks', 'aria-hidden': 'true' });
  for (const mark of o.marks ?? []) {
    const black = isBlack(mark.midi);
    const x = black ? (xOf.get(mark.midi - 1) ?? -100) + WHITE_W : (xOf.get(mark.midi) ?? -100) + WHITE_W / 2;
    const y = black ? BLACK_H - 30 : WHITE_H - 46;
    const text = mark.label ?? (mark.finger ? String(mark.finger) : '');
    const wide = text.length > 2;
    const g = svg('g', { class: `kb-mark kb-mark-${mark.hand ?? 'right'}` });
    if (wide) g.append(svg('rect', { x: x - 19, y: y - 13, width: 38, height: 26, rx: 13 }));
    else g.append(svg('circle', { cx: x, cy: y, r: 14 }));
    g.append(svg('text', { x, y: y + 6 }, text));
    markLayer.append(g);
    keyEls.get(mark.midi)?.classList.add('kb-marked');
  }
  root.append(markLayer);

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const setClass = (cls: string, keys: Iterable<number>) => {
    const want = new Set(keys);
    for (const [m, el] of keyEls) el.classList.toggle(cls, want.has(m));
  };

  return {
    el: root,
    keyAtPoint(clientX, clientY) {
      const hit = document.elementFromPoint(clientX, clientY);
      const key = hit?.closest('[data-midi]');
      if (!key || !root.contains(key)) return null;
      const midi = Number(key.getAttribute('data-midi'));
      return Number.isFinite(midi) ? midi : null;
    },
    setLit: (keys) => setClass('is-lit', keys),
    setHeld: (keys) => setClass('is-down', keys),
    flash(midi, kind) {
      const el = keyEls.get(midi);
      if (!el) return;
      const cls = kind === 'right' ? 'is-right' : 'is-wrong';
      el.classList.remove('is-right', 'is-wrong');
      // Restart the animation even when the same key flashes twice.
      void el.getBoundingClientRect();
      el.classList.add(cls);
      const t = setTimeout(() => {
        el.classList.remove(cls);
        timers.delete(t);
      }, 600);
      timers.add(t);
    },
    setLetters(letters) {
      for (const [m, el] of letterEls) el.textContent = letters.get(m) ?? '';
    },
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      root.remove();
    },
  };
}

const LETTER_INDEX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

/** Position of a white key counted in letter steps: C4 = 28, D4 = 29, ... */
export function diatonic(midi: number): number {
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + (LETTER_INDEX[((midi % 12) + 12) % 12] ?? 0);
}

const STEP = 7; // half the space between two staff lines, in viewBox units

/** A small staff with notes, drawn as SVG. */
export function staffPicture(pic: StaffPicture, label: string): SVGSVGElement {
  const bottom = pic.clef === 'treble' ? diatonic(64) : diatonic(43); // E4 or G2 on the bottom line
  const left = 64;
  const gap = 46;
  const width = left + Math.max(1, pic.notes.length) * gap + 16;
  const top = 40;
  const bottomY = top + 8 * STEP;
  const height = bottomY + 56;
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'staff', role: 'img', 'aria-label': label });
  for (let i = 0; i < 5; i++) root.append(svg('line', { x1: 8, x2: width - 8, y1: bottomY - i * 2 * STEP, y2: bottomY - i * 2 * STEP, class: 'staff-line' }));
  root.append(
    pic.clef === 'treble'
      ? svg('text', { x: 14, y: bottomY + 10, class: 'staff-clef staff-clef-treble', 'aria-hidden': 'true' }, '\u{1D11E}')
      : svg('text', { x: 14, y: bottomY - 2 * STEP + 3, class: 'staff-clef staff-clef-bass', 'aria-hidden': 'true' }, '\u{1D122}'),
  );
  pic.notes.forEach((midi, i) => {
    const d = diatonic(midi) - bottom;
    const x = left + i * gap + gap / 2;
    const y = bottomY - d * STEP;
    // Short ledger lines for notes below or above the staff.
    for (let l = -2; l >= d; l -= 2) root.append(svg('line', { x1: x - 13, x2: x + 13, y1: bottomY - l * STEP, y2: bottomY - l * STEP, class: 'staff-line' }));
    for (let l = 10; l <= d; l += 2) root.append(svg('line', { x1: x - 13, x2: x + 13, y1: bottomY - l * STEP, y2: bottomY - l * STEP, class: 'staff-line' }));
    root.append(svg('ellipse', { cx: x, cy: y, rx: 8.5, ry: 6.2, transform: `rotate(-20 ${x} ${y})`, class: 'staff-note' }));
    // Stem: up for notes below the middle line, down otherwise.
    if (d < 4) root.append(svg('line', { x1: x + 7.5, x2: x + 7.5, y1: y - 1, y2: y - 6 * STEP, class: 'staff-stem' }));
    else root.append(svg('line', { x1: x - 7.5, x2: x - 7.5, y1: y + 1, y2: y + 6 * STEP, class: 'staff-stem' }));
    if (pic.names) root.append(svg('text', { x, y: height - 8, class: 'staff-name' }, noteName(midi)));
  });
  return root;
}

/** Words for a staff picture, for screen readers. */
export function describeStaff(pic: StaffPicture, names: boolean): string {
  const clef = pic.clef === 'treble' ? 'Treble clef staff' : 'Bass clef staff';
  if (!names) return `${clef} with ${pic.notes.length === 1 ? 'one note' : `${pic.notes.length} notes`}`;
  return `${clef} showing ${pic.notes.map(noteName).join(', ')}`;
}

/** Words for a keyboard picture, for screen readers. */
export function describeKeys(marks: readonly KeyMark[]): string {
  if (marks.length === 0) return 'Piano keyboard';
  const parts = marks.map((m) => {
    const name = m.label === '?' ? 'a key marked with a question mark' : m.label && m.label.length > 2 ? `${m.label} ${noteName(m.midi)}` : noteName(m.midi);
    const finger = m.finger ? ` finger ${m.finger}` : '';
    const hand = m.hand === 'left' ? ' left hand' : '';
    return `${name}${finger}${m.finger ? hand : ''}`.trim();
  });
  return `Piano keyboard showing ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Hands: a friendly hand seen from above, as it rests on the keys, with a
// numbered badge on every fingertip (1 is the thumb). The right hand has its
// thumb on the left, like on the piano; the left hand is its mirror image.
// ---------------------------------------------------------------------------

const HAND_W = 224;
const HAND_H = 246;

/** Finger shapes of a right hand (index to little finger), and the thumb. */
const FINGERS: { finger: Finger; x: number; top: number; w: number }[] = [
  { finger: 2, x: 82, top: 30, w: 33 },
  { finger: 3, x: 118, top: 12, w: 33 },
  { finger: 4, x: 154, top: 26, w: 32 },
  { finger: 5, x: 186, top: 60, w: 29 },
];
const THUMB = { x: 74, y: 186, angle: -56, length: 74, w: 34 };

function handShapes(cls: string): SVGGElement {
  const g = svg('g', { class: cls });
  for (const f of FINGERS) g.append(svg('rect', { x: f.x - f.w / 2, y: f.top, width: f.w, height: 160 - f.top, rx: f.w / 2 }));
  g.append(
    svg('rect', { x: -THUMB.w / 2, y: -THUMB.length, width: THUMB.w, height: THUMB.length + 16, rx: THUMB.w / 2, transform: `translate(${THUMB.x} ${THUMB.y}) rotate(${THUMB.angle})` }),
    svg('rect', { x: 62, y: 112, width: 142, height: 110, rx: 48 }),
  );
  return g;
}

/** Where each finger's number badge sits, for a right hand. */
function badgeSpots(): { finger: Finger; x: number; y: number }[] {
  const rad = (THUMB.angle * Math.PI) / 180;
  const along = THUMB.length - 20;
  return [
    // The thumb is rotated: (0, -along) in its own space lands here.
    { finger: 1, x: THUMB.x + along * Math.sin(rad), y: THUMB.y - along * Math.cos(rad) },
    ...FINGERS.map((f) => ({ finger: f.finger, x: f.x, y: f.top + f.w / 2 + 2 })),
  ];
}

export function handPicture(pic: HandPicture, label: string): SVGSVGElement {
  const root = svg('svg', { viewBox: `0 0 ${HAND_W} ${HAND_H}`, class: `hand hand-${pic.side}`, role: 'img', 'aria-label': label });
  const body = svg('g', pic.side === 'left' ? { transform: `translate(${HAND_W} 0) scale(-1 1)` } : {});
  // The outline is the same shapes drawn fatter in ink underneath, so the hand reads as one friendly piece.
  body.append(
    handShapes('hand-edge'),
    handShapes('hand-skin'),
    svg('path', { d: 'M104 168q28 12 58 0', class: 'hand-crease' }),
    svg('rect', { x: 72, y: 206, width: 124, height: 36, rx: 15, class: 'hand-cuff' }),
    svg('path', { d: 'M86 224h96', class: 'hand-cuff-line' }),
  );
  root.append(body);
  const bright = new Set<Finger>(pic.fingers ?? [1, 2, 3, 4, 5]);
  for (const spot of badgeSpots()) {
    const x = pic.side === 'left' ? HAND_W - spot.x : spot.x;
    const g = svg('g', { class: `hand-badge${bright.has(spot.finger) ? '' : ' is-calm'}`, 'aria-hidden': 'true' });
    g.append(svg('circle', { cx: x, cy: spot.y, r: 17 }), svg('text', { x, y: spot.y + 7.5 }, String(spot.finger)));
    root.append(g);
  }
  return root;
}

/** Words for a hand picture, for screen readers. */
export function describeHand(pic: HandPicture): string {
  const side = pic.side === 'left' ? 'Left hand' : 'Right hand';
  const fingers = pic.fingers ?? [1, 2, 3, 4, 5];
  if (fingers.length === 5) return `${side} with finger numbers: thumb 1, pointing finger 2, middle finger 3, ring finger 4, little finger 5`;
  return `${side}, showing finger${fingers.length > 1 ? 's' : ''} ${fingers.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Rhythm: a count across the top, the written notes, and a block for each
// note as long as it lasts. Rests are empty blocks.
// ---------------------------------------------------------------------------

const BEAT_W = 64;

export function rhythmPicture(pic: RhythmPicture, label: string): SVGSVGElement {
  const total = pic.notes.reduce((t, n) => t + n.beats, 0);
  const halves = pic.notes.some((n) => n.beats % 1 !== 0);
  const width = Math.max(1, total) * BEAT_W + 16;
  const root = svg('svg', { viewBox: `0 0 ${width} 156`, class: 'rhythm', role: 'img', 'aria-label': label });
  const left = 8;
  for (let b = 0; b < Math.ceil(total); b++) {
    const x = left + b * BEAT_W;
    root.append(svg('rect', { x: x + 2, y: 108, width: BEAT_W - 4, height: 36, rx: 12, class: 'rh-cell' }));
    root.append(svg('text', { x: x + (halves ? BEAT_W / 4 : BEAT_W / 2), y: 26, class: 'rh-count' }, String(b + 1)));
    if (halves) root.append(svg('text', { x: x + (BEAT_W * 3) / 4, y: 26, class: 'rh-count rh-and' }, 'and'));
  }
  let beat = 0;
  for (const n of pic.notes) {
    const x0 = left + beat * BEAT_W;
    const cx = x0 + (n.beats < 1 ? BEAT_W / 4 : n.beats === 1 ? BEAT_W / 2 : BEAT_W / 2);
    if (n.rest) {
      root.append(svg('rect', { x: x0 + 5, y: 111, width: n.beats * BEAT_W - 10, height: 30, rx: 10, class: 'rh-rest' }));
      root.append(svg('path', { d: `M${cx - 4} 44l9 10-8 9 9 10q-11-4-7 9`, class: 'rh-rest-sign' }));
    } else {
      root.append(svg('rect', { x: x0 + 5, y: 111, width: n.beats * BEAT_W - 10, height: 30, rx: 10, class: 'rh-block' }));
      const hollow = n.beats >= 2;
      root.append(svg('ellipse', { cx, cy: 80, rx: 10, ry: 7.5, transform: `rotate(-20 ${cx} 80)`, class: hollow ? 'rh-head is-hollow' : 'rh-head' }));
      if (n.beats < 4) root.append(svg('path', { d: `M${cx + 9} 78V40`, class: 'rh-stem' }));
      if (n.beats < 1) root.append(svg('path', { d: `M${cx + 9} 40q4 10 14 16`, class: 'rh-stem' }));
    }
    beat += n.beats;
  }
  return root;
}

const LENGTH_WORDS: Record<string, string> = { '0.5': 'eighth note', '1': 'quarter note', '2': 'half note', '4': 'whole note' };

/** Words for a rhythm picture, for screen readers. */
export function describeRhythm(pic: RhythmPicture): string {
  const parts = pic.notes.map((n) => {
    const beats = n.beats === 0.5 ? 'half a beat' : n.beats === 1 ? '1 beat' : `${n.beats} beats`;
    return n.rest ? `rest, ${beats}` : `${LENGTH_WORDS[String(n.beats)] ?? 'note'}, ${beats}`;
  });
  return `Counting beats: ${parts.join('; ')}`;
}

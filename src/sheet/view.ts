import '../styles/sheet.css';
import { layout as keyLayout, type KeyBox } from '../player/keyboard';
import type { FrameState, Rect, StageView } from '../player/view';
import type { Note, Song } from '../song';
import { layoutScore, measureAt, stepY, xAtTime, HEAD_W, type Layout } from './layout';
import { enter, paintGhost, paintHeader, paintMeasures, paintStaffLines, PAPER as ENGRAVING, type HeadStyle, type Palette } from './render';
import { buildScore } from './score';
import { keyAlters, keyName, spell, spelledName, staffStep } from './theory';

const KEYS_PREF = 'sheet:keyboard';
const LEAD = 0.3; // playhead position, as a share of the music area

/**
 * The play screen's paper: the app's cream and ink, the playhead in ocean
 * teal, the notes to play next glowing sun yellow, played notes in mint and
 * coral. (Lesson pictures keep the plain engraving palette from render.ts.)
 */
const PAPER: Palette = {
  ...ENGRAVING,
  paper: '#fff8ec',
  ink: '#10304a',
  staff: '#6f7f8c',
  faint: '#a9b4bc',
  hit: '#137a5c',
  miss: '#b23b30',
  next: '#0b6f93',
  nextGlow: 'rgba(255, 210, 63, 0.4)',
  playhead: 'rgba(11, 111, 147, 0.7)',
  dim: '#98a5ae',
};
const PAPER_CLEAR = 'rgba(255, 248, 236, 0)';
const FONT = "Fredoka, ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif";

const COLOR = {
  white: '#fffaf2',
  whiteEdge: '#dcc8a2',
  black: '#12324c',
  next: '#ffd23f',
  nextBlack: '#c79a0e',
  good: '#5fe3b8',
  goodBlack: '#1f8f6c',
  bad: '#ff7d6e',
  badBlack: '#c9503f',
  letter: '#4d6474',
  shade: 'rgba(143, 211, 255, 0.16)',
  strip: '#ead9b8',
};

function readPref(): boolean {
  try {
    return localStorage.getItem(KEYS_PREF) !== 'off';
  } catch {
    return true;
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(KEYS_PREF, on ? 'on' : 'off');
  } catch {
    // Not saved; fine.
  }
}

interface Geometry {
  sp: number;
  /** y of the top staff's middle line, CSS px. */
  oy: number;
  /** Width of the fixed clef area, CSS px. */
  headerPx: number;
  stripTop: number;
  stripH: number;
}

/**
 * Sheet music: a grand staff that scrolls past a fixed playhead. Notes to
 * play next glow, played notes turn green or red, keys being pressed show as
 * notes at the playhead and on a small keyboard below.
 */
export class SheetView implements StageView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private toggle: HTMLButtonElement;
  private caption: HTMLElement;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private song: Song | null = null;
  private notes: readonly Note[] | null = null;
  private layout: Layout | null = null;
  private scroll = 0;
  private lastNow = 0;
  private lastTime = -Infinity;
  private keysOn = readPref();
  private boxes = new Map<number, KeyBox>();
  private range = { lo: 48, hi: 83 };
  private geo: Geometry = { sp: 10, oy: 0, headerPx: 0, stripTop: 0, stripH: 0 };
  private sounding = new Set<number>();
  private soundingFor: FrameState | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'sheet-view';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sheet-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Sheet music');
    this.ctx = this.canvas.getContext('2d')!;
    this.caption = document.createElement('p');
    this.caption.className = 'sheet-caption';
    this.caption.hidden = true;
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'sheet-toggle';
    this.toggle.addEventListener('click', () => {
      this.keysOn = !this.keysOn;
      writePref(this.keysOn);
      this.updateToggle();
      this.measure();
    });
    this.updateToggle();
    this.root.append(this.canvas, this.caption, this.toggle);
    host.append(this.root);
  }

  private updateToggle(): void {
    this.toggle.textContent = this.keysOn ? 'Hide keyboard' : 'Show keyboard';
    this.toggle.setAttribute('aria-pressed', String(this.keysOn));
  }

  resize(width: number, height: number, ratio: number): void {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.measure();
  }

  /** Works out sizes: staff space, staff position, keyboard strip. */
  private measure(): void {
    const w = this.width;
    const h = this.height;
    const showStrip = this.keysOn && h >= 240;
    const stripH = showStrip ? Math.round(Math.min(96, Math.max(48, h * 0.17))) : 0;
    this.toggle.hidden = h < 240;
    this.root.style.setProperty('--sheet-strip', `${stripH}px`);
    // Room at the top for the slim chrome (pause button, progress, score).
    const top = Math.round(Math.min(110, Math.max(h < 480 ? 56 : 84, h * 0.12)));
    const bottomPad = 34;
    const avail = Math.max(60, h - stripH - top - bottomPad);
    const l = this.layout;
    const dist = l?.dist ?? 10;
    const staves = l?.staves ?? 2;
    // Keep room for a few ledger lines but do not shrink for one far-away note.
    const above = Math.min(6, Math.max(3.5, -(l?.top ?? -5)));
    const below = Math.min(6, Math.max(3.5, (l?.bottom ?? dist + 5) - (staves === 2 ? dist : 0)));
    const span = above + (staves === 2 ? dist : 0) + below;
    let sp = avail / span;
    // Bigger staff on tablets and big screens, where there is room to read it from the piano bench.
    sp = Math.max(6, Math.min(w < 600 ? 15 : w >= 700 && h >= 600 ? 21 : 17, sp));
    // Whole device pixels per space keep staff lines evenly sharp.
    sp = Math.max(1, Math.round(sp * this.ratio)) / this.ratio;
    const used = span * sp;
    const oy = Math.round((top + Math.max(0, (avail - used) / 2) + above * sp) * this.ratio) / this.ratio;
    const headerPx = ((l?.header ?? 8) + 0.9) * sp;
    this.geo = { sp, oy, headerPx, stripTop: h - stripH, stripH };
    this.boxes = keyLayout(this.range.lo, this.range.hi, w);
  }

  private ensureLayout(frame: FrameState): void {
    if (frame.song === this.song && frame.notes === this.notes && this.layout) return;
    this.song = frame.song;
    this.notes = frame.notes;
    const score = buildScore({ ...frame.song, notes: [...frame.notes] });
    this.layout = layoutScore(score);
    this.scroll = this.layout.header - 0.5;
    this.lastTime = -Infinity;
    const meter = this.layout.meter ? `, ${this.layout.meter.beats}/${this.layout.meter.unit} time` : '';
    this.canvas.setAttribute('aria-label', `Sheet music for ${frame.song.title}, in ${keyName(this.layout.key)}${meter}`);
    this.caption.hidden = this.layout.kind !== 'free';
    this.caption.textContent =
      'This song has very free timing, so notes are placed by when they sound, without note lengths.';
    this.measure();
  }

  keyAt(x: number, y: number): number | null {
    const g = this.geo;
    if (!g.stripH || y < g.stripTop) return null;
    const inBlack = y < g.stripTop + g.stripH * 0.6;
    let white: number | null = null;
    for (const [midi, b] of this.boxes) {
      if (x < b.x || x >= b.x + b.w) continue;
      if (b.black && inBlack) return midi;
      if (!b.black) white = midi;
    }
    return white;
  }

  keyRect(midi: number): Rect | null {
    const g = this.geo;
    if (g.stripH) {
      const b = this.boxes.get(midi);
      if (!b) return null;
      return { x: b.x, y: g.stripTop, w: b.w, h: b.black ? g.stripH * 0.6 : g.stripH };
    }
    // No keyboard: point at where the note sits on the staff, at the playhead.
    const l = this.layout;
    if (!l) return null;
    const staff = midi >= 60 || l.staves === 1 ? 0 : 1;
    const s = spell(midi, l.key);
    const y = g.oy + stepY(staffStep(s, l.clefs[staff]), staff, l.dist) * g.sp;
    const x = this.screenX(xAtTime(l, this.lastTime === -Infinity ? 0 : this.lastTime));
    return { x: x - g.sp, y: y - g.sp, w: g.sp * 2, h: g.sp * 2 };
  }

  private screenX(layoutX: number): number {
    return this.geo.headerPx + (layoutX - this.scroll) * this.geo.sp;
  }

  draw(frame: FrameState): void {
    if (!this.width || !this.height) return;
    if (frame.range.lo !== this.range.lo || frame.range.hi !== this.range.hi) {
      this.range = { ...frame.range };
      this.boxes = keyLayout(this.range.lo, this.range.hi, this.width);
    }
    this.ensureLayout(frame);
    const l = this.layout;
    if (!l) return;
    const ctx = this.ctx;
    const g = this.geo;
    const dt = Math.min(0.1, Math.max(0, (frame.now - this.lastNow) / 1000));
    this.lastNow = frame.now;

    // ---- Scrolling ----
    const musicPx = Math.max(50, this.width - g.headerPx);
    const musicW = musicPx / g.sp;
    const playX = xAtTime(l, frame.time);
    const minScroll = l.header - 0.5;
    const jumped = Math.abs(frame.time - this.lastTime) > 2;
    this.lastTime = frame.time;
    if (frame.reduceMotion) {
      // Turn the page instead of sliding.
      if (playX > this.scroll + musicW * 0.88 || playX < this.scroll + 1 || jumped) {
        this.scroll = Math.max(minScroll, playX - musicW * 0.08);
      }
    } else {
      const target = Math.max(minScroll, playX - musicW * LEAD);
      if (jumped || Math.abs(target - this.scroll) > musicW) this.scroll = target;
      else this.scroll += (target - this.scroll) * (1 - Math.exp(-dt * 14));
    }

    // ---- Background ----
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = PAPER.paper;
    ctx.fillRect(0, 0, this.width, this.height);

    const style = this.styler(frame);
    const o = {
      sp: g.sp,
      ox: g.headerPx - this.scroll * g.sp,
      oy: g.oy,
      from: this.scroll,
      to: this.scroll + musicW,
      palette: PAPER,
      names: frame.showNoteNames,
      style,
      numbers: l.kind === 'metric',
    };

    // ---- Music ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.headerPx - 2, 0, this.width - g.headerPx + 2, g.stripTop);
    ctx.clip();
    enter(ctx, o);
    paintStaffLines(ctx, l, this.scroll - 1, this.scroll + musicW + 1, PAPER, g.sp);
    // Shade the bar being played, so the eye finds its place.
    const mi = measureAt(l, playX);
    const m = l.measures[mi];
    if (m && frame.time >= l.startTime) {
      ctx.fillStyle = COLOR.shade;
      const bottom = l.staves === 2 ? l.dist + 2 : 2;
      ctx.fillRect(m.x, -2, m.w, bottom + 2);
    }
    paintMeasures(ctx, l, o);
    this.paintPlayhead(frame, playX);
    ctx.restore(); // enter
    ctx.restore(); // clip

    // ---- Fixed clefs on the left ----
    ctx.fillStyle = PAPER.paper;
    ctx.fillRect(0, 0, g.headerPx, g.stripTop);
    const fade = ctx.createLinearGradient(g.headerPx, 0, g.headerPx + 18, 0);
    fade.addColorStop(0, PAPER.paper);
    fade.addColorStop(1, PAPER_CLEAR);
    ctx.fillStyle = fade;
    ctx.fillRect(g.headerPx - 1, 0, 19, g.stripTop);
    const ho = { ...o, ox: 0.9 * g.sp };
    enter(ctx, ho);
    paintStaffLines(ctx, l, 0, l.header + 0.1, PAPER, g.sp);
    paintHeader(ctx, l, 0, ho, true);
    ctx.restore();

    // ---- Keyboard strip ----
    if (g.stripH) this.paintKeys(frame);
  }

  /** Colour and glow for each note, from the session's state. */
  private styler(frame: FrameState): (src: number) => HeadStyle | undefined {
    const states = frame.states;
    const notes = frame.notes;
    // The group of notes to play next (first pending note and any chord with it).
    const next = new Set<number>();
    const first = states.indexOf('pending');
    if (first >= 0) {
      for (let i = first; i < notes.length && notes[i].start - notes[first].start <= 0.06; i++) {
        if (states[i] === 'pending') next.add(i);
      }
    }
    const pulse = frame.reduceMotion ? 0.22 : 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(frame.now / 260));
    const glow = `rgba(255, 210, 63, ${(pulse * 2.4).toFixed(3)})`;
    const waiting = frame.mode === 'wait';
    return (src: number) => {
      const st = states[src];
      if (st === 'hit') return { color: PAPER.hit };
      if (st === 'miss') return { color: PAPER.miss };
      if (st === 'auto') {
        const n = notes[src];
        const sounding = n && frame.time >= n.start - 0.02 && frame.time < n.start + Math.max(n.dur, 0.15);
        if (frame.mode === 'listen') return sounding ? { color: PAPER.next } : undefined;
        return { color: sounding ? PAPER.ink : PAPER.dim };
      }
      if (st === 'pending') {
        if (next.has(src) && (waiting || notes[src].start - frame.time < 1.2)) return { color: PAPER.next, glow };
        const n = notes[src];
        if (n && n.start - frame.time < 0.5 && n.start >= frame.time - 0.3) return { color: PAPER.next };
      }
      return undefined;
    };
  }

  private paintPlayhead(frame: FrameState, playX: number): void {
    const l = this.layout!;
    const ctx = this.ctx;
    const top = -4.5;
    const bottom = (l.staves === 2 ? l.dist : 0) + 4.5;
    // A soft sun band with a teal line down the middle.
    ctx.fillStyle = 'rgba(255, 210, 63, 0.22)';
    ctx.fillRect(playX - 1, top, 2, bottom - top);
    ctx.fillStyle = PAPER.playhead;
    ctx.fillRect(playX - 0.11, top, 0.22, bottom - top);

    // Keys being pressed, as notes at the playhead.
    for (const midi of frame.held) {
      const staff = midi >= 60 || l.staves === 1 ? 0 : 1;
      const s = spell(midi, l.key);
      const step = staffStep(s, l.clefs[staff]);
      ctx.globalAlpha = 0.7;
      const accidental = s.alter === keyAlters(l.key.fifths)[s.letter] ? null : s.alter;
      paintGhost(ctx, l, playX - HEAD_W / 2, staff, step, accidental, this.heldColor(frame, midi, PAPER.hit, PAPER.miss, PAPER.next));
      ctx.globalAlpha = 1;
    }
  }

  /** Notes that are fine to be holding right now: about to sound, sounding, or asked for. */
  private soundingNow(frame: FrameState): Set<number> {
    if (this.soundingFor === frame) return this.sounding;
    const set = new Set<number>(frame.expected);
    const notes = frame.notes;
    // Notes are sorted by start: find the window by binary search.
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].start < frame.time - 8) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < notes.length; i++) {
      const n = notes[i];
      if (n.start > frame.time + 0.45) break;
      if (n.start + n.dur >= frame.time - 0.35) set.add(n.midi);
    }
    this.sounding = set;
    this.soundingFor = frame;
    return set;
  }

  private heldColor(frame: FrameState, midi: number, good: string, bad: string, neutral: string): string {
    if (frame.wrong && frame.wrong.midi === midi && frame.now - frame.wrong.at < 400) return bad;
    if (!frame.running || frame.mode === 'listen') return neutral;
    return this.soundingNow(frame).has(midi) ? good : bad;
  }

  private paintKeys(frame: FrameState): void {
    const ctx = this.ctx;
    const g = this.geo;
    const top = g.stripTop;
    const h = g.stripH;
    const l = this.layout!;
    ctx.fillStyle = COLOR.strip;
    ctx.fillRect(0, top, this.width, h);
    const colorFor = (midi: number, black: boolean): string | null => {
      if (frame.held.has(midi)) {
        return black
          ? this.heldColor(frame, midi, COLOR.goodBlack, COLOR.badBlack, COLOR.nextBlack)
          : this.heldColor(frame, midi, COLOR.good, COLOR.bad, COLOR.next);
      }
      if (frame.expected.has(midi)) return black ? COLOR.nextBlack : COLOR.next;
      return null;
    };
    for (const pass of [false, true]) {
      for (const [midi, b] of this.boxes) {
        if (b.black !== pass) continue;
        const kh = b.black ? h * 0.6 : h;
        const fill = colorFor(midi, b.black) ?? (b.black ? COLOR.black : COLOR.white);
        ctx.fillStyle = fill;
        if (b.black) {
          ctx.beginPath();
          ctx.roundRect?.(b.x, top, b.w, kh, [0, 0, 3, 3]);
          if (!ctx.roundRect) ctx.rect(b.x, top, b.w, kh);
          ctx.fill();
        } else {
          ctx.fillRect(b.x + 0.5, top + 1, b.w - 1, kh - 2);
          ctx.fillStyle = COLOR.whiteEdge;
          ctx.fillRect(b.x + b.w - 0.5, top, 1, kh);
        }
        const letter = frame.keyLetters.get(midi);
        const fontPx = Math.max(10, Math.min(16, b.w * 0.6));
        if (!b.black) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.font = `600 ${fontPx}px ${FONT}`;
          ctx.fillStyle = COLOR.letter;
          let y = top + h - 6;
          if (frame.showNoteNames && b.w >= 14) {
            ctx.fillText(spelledName(spell(midi, l.key)), b.x + b.w / 2, y);
            y -= fontPx + 2;
          }
          if (letter && b.w >= 12) {
            ctx.font = `600 ${fontPx}px ${FONT}`;
            ctx.fillStyle = '#10304a';
            ctx.fillText(letter.toUpperCase(), b.x + b.w / 2, y);
          }
          if (midi === 60 && b.w >= 10 && !frame.showNoteNames) {
            ctx.fillStyle = COLOR.letter;
            ctx.font = `600 ${Math.max(9, fontPx - 2)}px ${FONT}`;
            ctx.fillText('C', b.x + b.w / 2, top + h - 6);
          }
        } else if (letter && b.w >= 9) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.font = `600 ${Math.max(9, fontPx - 2)}px ${FONT}`;
          ctx.fillStyle = '#fff8ec';
          ctx.fillText(letter.toUpperCase(), b.x + b.w / 2, top + kh - 5);
        }
      }
    }
    ctx.fillStyle = 'rgba(16, 48, 74, 0.18)';
    ctx.fillRect(0, top, this.width, 3);
  }

  destroy(): void {
    this.root.remove();
  }
}

export const createSheetView = (host: HTMLElement): StageView => new SheetView(host);

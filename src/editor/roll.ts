import type { Hand } from '../song';
import { isBlack, noteName } from '../song';
import { addNotes, idsInBox, moveNotes, resizeNotes, limitMove, selected } from './commands';
import { gridLines, snapFloor, snapTime, stepSeconds, type Grid } from './grid';
import { MIN_DUR, inPiano, makeNote, type Doc, type EdNote } from './model';
import {
  clampView,
  firstVisible,
  fitView,
  hitTest,
  midiAt,
  revealPitch,
  revealTime,
  scrollBy,
  timeAt,
  xOf,
  yOf,
  zoomPitch,
  zoomTime,
  type Viewport,
} from './viewport';
import { peakRange, type Peaks } from './waveform';

/**
 * The piano roll: draws the notes on a canvas and turns mouse, pen and touch
 * into edits. All editing goes through the pure functions in commands.ts; this
 * file only works out what the pointer meant.
 */

export type Tool = 'add' | 'select';

/** What the roll shows. Owned by the editor and read on every frame. */
export interface RollState {
  doc: Doc;
  selection: Set<number>;
  tool: Tool;
  /** Snap step in beats (see SNAP_OPTIONS); 0 is off. */
  snap: number;
  grid: Grid;
  playhead: number;
  loop: { start: number; end: number } | null;
  loopOn: boolean;
  peaks: Peaks | null;
  problems: ReadonlySet<number>;
  /** Keys held on the piano right now. */
  held: ReadonlySet<number>;
  /** Notes recorded so far in the current take, not yet in the document. */
  live: readonly EdNote[];
  /** Length of the song or recording, whichever is longer, in seconds. */
  length: number;
  /** Length of the last note drawn or resized, used for the next new note. */
  noteLen: number | null;
}

export interface RollDeps {
  state: RollState;
  /** Makes an undo step. `select` replaces the selection afterwards. */
  commit(doc: Doc, label: string, select?: Iterable<number>): void;
  setSelection(ids: Set<number>): void;
  seek(time: number): void;
  setLoop(loop: { start: number; end: number }): void;
  /** Plays a short preview of a key. */
  sound(midi: number): void;
  /** Hand for a new note on this key. */
  handFor(midi: number): Hand;
  /** Anything about the view changed (for scroll bars, buttons). */
  viewChanged?(): void;
}

type Drag =
  | {
      kind: 'note';
      part: 'body' | 'start' | 'end';
      origin: Doc;
      ids: Set<number>;
      anchor: EdNote;
      x0: number;
      y0: number;
      t0: number;
      m0: number;
      moved: boolean;
      wasSelected: boolean;
      shift: boolean;
      lastMidi: number;
    }
  | { kind: 'draw'; origin: Doc; note: EdNote; x0: number; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; base: Set<number>; moved: boolean; t0: number }
  | { kind: 'ruler'; x0: number; moved: boolean }
  | { kind: 'pan'; x0: number; y0: number; view0: Viewport };

interface Pinch {
  a: number;
  b: number;
  dist0: number;
  cx0: number;
  cy0: number;
  view0: Viewport;
}

export const RULER_H = 30;
const MOVE_PX = 4;

interface Colors {
  bg: string;
  panel: string;
  line: string;
  lineStrong: string;
  sub: string;
  text: string;
  muted: string;
  right: string;
  left: string;
  accent: string;
  bad: string;
  star: string;
  keyWhite: string;
  keyBlack: string;
  keyLabel: string;
}

/** The roll's colours, from CSS custom properties on its host (see .ed-roll in editor.css), with the app's own as fallbacks. */
function readColors(el: HTMLElement): Colors {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--roll-bg', '#073650'),
    panel: v('--roll-panel', '#0a4a6d'),
    line: v('--roll-line', 'rgba(255, 247, 232, 0.16)'),
    lineStrong: v('--roll-bar', 'rgba(255, 247, 232, 0.38)'),
    sub: v('--roll-sub', 'rgba(255, 247, 232, 0.06)'),
    text: v('--text', '#fff7e8'),
    muted: v('--muted', '#d6ecef'),
    right: v('--right', '#5aa9ff'),
    left: v('--left', '#ffa24a'),
    accent: v('--mint', '#5fe3b8'),
    bad: v('--coral', '#ff7d6e'),
    star: v('--sun', '#ffd23f'),
    keyWhite: v('--cream', '#fff7e8'),
    keyBlack: v('--ink', '#10304a'),
    keyLabel: v('--ink', '#10304a'),
  };
}

const FONT = "'Fredoka', ui-rounded, system-ui, sans-serif";

const label = (midi: number) => `${noteName(midi)}${Math.floor(midi / 12) - 1}`;

export class Roll {
  readonly canvas: HTMLCanvasElement;
  view: Viewport = { t0: 0, pxPerSec: 80, top: 85, rowH: 14, width: 300, height: 200 };
  private ctx: CanvasRenderingContext2D;
  private colors: Colors;
  private cssW = 300;
  private cssH = 200;
  private ratio = 1;
  private gutter = 52;
  private dirty = true;
  private sized = false;
  private drag: Drag | null = null;
  private preview: Doc | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: Pinch | null = null;
  private longestFor: readonly EdNote[] | null = null;
  private longest = 0;
  private hoverMidi: number | null = null;
  private offs: (() => void)[] = [];
  private observer: ResizeObserver;

  constructor(
    private host: HTMLElement,
    private deps: RollDeps,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'roll-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-roledescription', 'piano roll');
    this.canvas.setAttribute(
      'aria-label',
      'Notes of the song. Use comma and full stop to pick a note, arrow keys to move it, Enter to add one. Press question mark for all shortcuts.',
    );
    host.append(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    this.ctx = ctx;
    this.colors = readColors(host);

    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      this.canvas.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => this.canvas.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e, false));
    on('pointercancel', (e) => this.onUp(e, true));
    on('pointerleave', () => {
      if (this.hoverMidi !== null) {
        this.hoverMidi = null;
        this.requestDraw();
      }
    });
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('dblclick', (e) => this.onDouble(e));
    on('contextmenu', (e) => this.onContext(e));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  // ---------- geometry ----------

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left - this.gutter, y: e.clientY - r.top - RULER_H };
  }

  /** Where the middle of key `midi` at time `time` is on the page, in client pixels. */
  screenPoint(time: number, midi: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + this.gutter + xOf(this.view, time), y: r.top + RULER_H + yOf(this.view, midi) + this.view.rowH / 2 };
  }

  resize(): void {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(120, Math.floor(r.width));
    const h = Math.max(120, Math.floor(r.height));
    const ratio = window.devicePixelRatio || 1;
    if (w === this.cssW && h === this.cssH && ratio === this.ratio && this.sized) return;
    this.cssW = w;
    this.cssH = h;
    this.ratio = ratio;
    this.gutter = w < 520 ? 44 : 60;
    this.canvas.width = Math.round(w * ratio);
    this.canvas.height = Math.round(h * ratio);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const first = !this.sized;
    this.sized = true;
    this.view = { ...this.view, width: w - this.gutter, height: h - RULER_H };
    if (first) this.fit();
    else this.setView(this.view);
  }

  private setView(v: Viewport): void {
    this.view = clampView(v, this.deps.state.length);
    this.requestDraw();
    this.deps.viewChanged?.();
  }

  /** Shows the whole song (or a comfortable middle of the keyboard when it is empty). */
  fit(): void {
    const notes = this.deps.state.doc.notes;
    if (notes.length === 0) {
      const span = Math.max(8, Math.min(20, this.deps.state.length));
      this.setView(fitView(this.view, 0, span, 48, 72));
      return;
    }
    let lo = 127;
    let hi = 0;
    let end = 0;
    for (const n of notes) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
      end = Math.max(end, n.start + n.dur);
    }
    const start = notes[0].start;
    // Long songs open at a readable zoom instead of squeezing everything in.
    const span = Math.min(end - start, Math.max(8, this.view.width / 40));
    this.setView(fitView(this.view, Math.max(0, start - 0.5), start + span, lo, hi));
  }

  /**
   * After adding a note while zoomed far out (the whole song on screen), zoom
   * in around it so the new note is big enough to grab, move and stretch.
   */
  makeGrabbable(note: Pick<EdNote, 'start' | 'dur' | 'midi'>): void {
    const MIN_W = 28;
    const MIN_ROW = 14;
    let v = this.view;
    const w = note.dur * v.pxPerSec;
    if (w >= MIN_W && v.rowH >= MIN_ROW) return;
    if (w < MIN_W) v = zoomTime(v, MIN_W / Math.max(0.01, w), Math.max(0, Math.min(v.width, xOf(v, note.start))));
    if (v.rowH < MIN_ROW) v = zoomPitch(v, MIN_ROW / v.rowH, Math.max(0, Math.min(v.height, yOf(v, note.midi) + v.rowH / 2)));
    this.setView(v);
    this.reveal(note.start, note.midi);
  }

  zoomBy(factor: number, aroundTime?: number): void {
    const x = aroundTime === undefined ? this.view.width / 2 : Math.max(0, Math.min(this.view.width, xOf(this.view, aroundTime)));
    this.setView(zoomTime(this.view, factor, x));
  }

  zoomKeys(factor: number): void {
    this.setView(zoomPitch(this.view, factor, this.view.height / 2));
  }

  /** Scrolls so a time (and optionally a key) is on screen. */
  reveal(time: number, midi?: number): void {
    let v = revealTime(this.view, time);
    if (midi !== undefined) v = revealPitch(v, midi);
    if (v !== this.view) this.setView(v);
  }

  /** Pages along with the playhead while playing. */
  follow(time: number): void {
    const visible = this.view.width / this.view.pxPerSec;
    if (time > this.view.t0 + visible * 0.92 || time < this.view.t0) {
      this.setView({ ...this.view, t0: time - visible * 0.08 });
    }
  }

  /** The key strip as an on-screen keyboard: the key under a point in canvas pixels, or null. */
  keyAt(x: number, y: number): number | null {
    if (x >= this.gutter || y < RULER_H) return null;
    const midi = midiAt(this.view, y - RULER_H);
    return inPiano(midi) ? midi : null;
  }

  /** Key at the middle of the screen. */
  centreMidi(): number {
    return midiAt(this.view, this.view.height / 2);
  }

  /** Time at the middle of the screen. */
  centreTime(): number {
    return timeAt(this.view, this.view.width / 2);
  }

  requestDraw(): void {
    this.dirty = true;
  }

  /** Draws if anything changed since the last frame. */
  frame(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  /** Drops an unfinished drag (e.g. when the document changes underneath it). */
  cancelDrag(): void {
    if (this.drag?.kind === 'box') this.deps.setSelection(this.drag.base);
    this.drag = null;
    this.preview = null;
    this.requestDraw();
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  private step(e: { altKey: boolean }): number {
    return e.altKey ? 0 : this.deps.state.snap;
  }

  // ---------- pointer ----------

  private onDown(e: PointerEvent): void {
    if (e.button === 2) return; // handled by contextmenu
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.canvas.focus({ preventScroll: true });

    if (this.pointers.size === 2) {
      // Second finger: switch to pinch zoom and two-finger scroll.
      this.cancelDrag();
      const [a, b] = [...this.pointers.entries()];
      this.pinch = {
        a: a[0],
        b: b[0],
        dist0: Math.max(10, Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y)),
        cx0: (a[1].x + b[1].x) / 2,
        cy0: (a[1].y + b[1].y) / 2,
        view0: this.view,
      };
      return;
    }
    if (this.pointers.size > 2) return;
    this.canvas.setPointerCapture?.(e.pointerId);

    if (p.x < 0) return; // The key strip plays through the app's input (see keyAt).

    if (e.button === 1) {
      e.preventDefault();
      this.drag = { kind: 'pan', x0: p.x, y0: p.y, view0: this.view };
      return;
    }
    if (p.y < 0) {
      this.drag = { kind: 'ruler', x0: p.x, moved: false };
      return;
    }

    const s = this.deps.state;
    const hit = hitTest(s.doc.notes, this.view, p.x, p.y);
    if (hit) {
      const wasSelected = s.selection.has(hit.note.id);
      let sel = s.selection;
      if (e.shiftKey) {
        sel = new Set(sel);
        if (wasSelected) sel.delete(hit.note.id);
        else sel.add(hit.note.id);
        this.deps.setSelection(sel);
        if (wasSelected) return;
      } else if (!wasSelected) {
        sel = new Set([hit.note.id]);
        this.deps.setSelection(sel);
      }
      this.deps.sound(hit.note.midi);
      this.drag = {
        kind: 'note',
        part: hit.part,
        origin: s.doc,
        ids: new Set(sel),
        anchor: hit.note,
        x0: p.x,
        y0: p.y,
        t0: timeAt(this.view, p.x),
        m0: midiAt(this.view, p.y),
        moved: false,
        wasSelected,
        shift: e.shiftKey,
        lastMidi: hit.note.midi,
      };
      return;
    }

    if (s.tool === 'add' && !e.shiftKey) {
      const midi = midiAt(this.view, p.y);
      if (!inPiano(midi)) return;
      const t = timeAt(this.view, p.x);
      const step = this.step(e);
      const start = Math.max(0, snapFloor(s.grid, t, step));
      const dur = s.noteLen ?? stepSeconds(s.grid, start, step === 0 || step > 1 || step < 0 ? 1 : step);
      const note = makeNote(midi, start, dur, this.deps.handFor(midi));
      this.drag = { kind: 'draw', origin: s.doc, note, x0: p.x, moved: false };
      this.preview = addNotes(s.doc, [note]);
      this.deps.sound(midi);
      this.requestDraw();
      return;
    }

    const base = e.shiftKey ? new Set(s.selection) : new Set<number>();
    if (!e.shiftKey && s.selection.size) this.deps.setSelection(new Set());
    this.drag = { kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, base, moved: false, t0: timeAt(this.view, p.x) };
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

    if (this.pinch) {
      const a = this.pointers.get(this.pinch.a);
      const b = this.pointers.get(this.pinch.b);
      if (!a || !b) return;
      const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const v = zoomTime(this.pinch.view0, dist / this.pinch.dist0, this.pinch.cx0);
      this.setView(scrollBy(v, -(cx - this.pinch.cx0), -(cy - this.pinch.cy0)));
      return;
    }

    const d = this.drag;
    if (!d) {
      this.hover(p, e);
      return;
    }
    const s = this.deps.state;
    switch (d.kind) {
      case 'pan':
        this.setView(scrollBy(d.view0, -(p.x - d.x0), -(p.y - d.y0)));
        return;
      case 'ruler': {
        if (!d.moved && Math.abs(p.x - d.x0) < MOVE_PX) return;
        d.moved = true;
        const step = this.step(e) || 0;
        const a = Math.max(0, snapTime(s.grid, timeAt(this.view, d.x0), step));
        const b = Math.max(0, snapTime(s.grid, timeAt(this.view, p.x), step));
        this.deps.setLoop({ start: Math.min(a, b), end: Math.max(a, b) });
        this.requestDraw();
        return;
      }
      case 'box': {
        d.x1 = p.x;
        d.y1 = p.y;
        if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) < MOVE_PX) return;
        d.moved = true;
        const ids = idsInBox(s.doc.notes, d.t0, timeAt(this.view, p.x), midiAt(this.view, d.y0), midiAt(this.view, p.y));
        const next = new Set(d.base);
        for (const id of ids) next.add(id);
        this.deps.setSelection(next);
        this.requestDraw();
        return;
      }
      case 'draw': {
        if (!d.moved && Math.abs(p.x - d.x0) < MOVE_PX) return;
        d.moved = true;
        const step = this.step(e);
        const start = d.note.start;
        let end = snapTime(s.grid, timeAt(this.view, p.x), step);
        const min = step === 0 ? MIN_DUR * 2 : stepSeconds(s.grid, start, step);
        if (end < start + min) end = start + min;
        this.preview = addNotes(d.origin, [{ ...d.note, dur: end - start }]);
        this.requestDraw();
        return;
      }
      case 'note': {
        if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) < MOVE_PX) return;
        d.moved = true;
        const step = this.step(e);
        const rawDt = timeAt(this.view, p.x) - d.t0;
        const a = d.anchor;
        if (d.part === 'body') {
          const dt = Math.max(0, snapTime(s.grid, a.start + rawDt, step)) - a.start;
          const lim = limitMove(selected(d.origin, d.ids), dt, midiAt(this.view, p.y) - d.m0);
          this.preview = moveNotes(d.origin, d.ids, lim.dt, lim.dmidi);
          const midi = a.midi + lim.dmidi;
          if (midi !== d.lastMidi) {
            d.lastMidi = midi;
            this.deps.sound(midi);
          }
        } else if (d.part === 'end') {
          const end0 = a.start + a.dur;
          let end = snapTime(s.grid, end0 + rawDt, step);
          if (end <= a.start + MIN_DUR) end = a.start + (step === 0 ? MIN_DUR : stepSeconds(s.grid, a.start, step));
          this.preview = resizeNotes(d.origin, d.ids, end - end0, 'end');
        } else {
          const start = Math.max(0, snapTime(s.grid, a.start + rawDt, step));
          this.preview = resizeNotes(d.origin, d.ids, Math.min(start, a.start + a.dur - MIN_DUR) - a.start, 'start');
        }
        this.requestDraw();
        return;
      }
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const preview = this.preview;
    this.preview = null;
    this.requestDraw();
    if (cancelled) {
      if (d.kind === 'box') this.deps.setSelection(d.base);
      return;
    }
    const s = this.deps.state;
    switch (d.kind) {
      case 'note':
        if (d.moved && preview && preview !== d.origin) {
          const what = d.part === 'body' ? (d.ids.size > 1 ? 'Move notes' : 'Move a note') : 'Change note length';
          if (d.part !== 'body') {
            const changed = preview.notes.find((n) => n.id === d.anchor.id);
            if (changed) s.noteLen = changed.dur;
          }
          this.deps.commit(preview, what);
        } else if (!d.moved && !d.shift && d.wasSelected && s.selection.size > 1) {
          this.deps.setSelection(new Set([d.anchor.id]));
        }
        return;
      case 'draw': {
        if (!preview) return;
        const made = preview.notes.find((n) => n.id === d.note.id);
        if (made && d.moved) s.noteLen = made.dur;
        this.deps.commit(preview, 'Add a note', [d.note.id]);
        if (made) this.makeGrabbable(made);
        return;
      }
      case 'box':
        if (!d.moved) this.deps.seek(Math.max(0, d.t0));
        return;
      case 'ruler':
        if (!d.moved) this.deps.seek(Math.max(0, timeAt(this.view, d.x0)));
        return;
      case 'pan':
        return;
    }
  }

  private hover(p: { x: number; y: number }, e: PointerEvent): void {
    let cursor = 'default';
    let midi: number | null = null;
    if (p.x < 0) cursor = 'pointer';
    else if (p.y < 0) cursor = 'col-resize';
    else {
      midi = midiAt(this.view, p.y);
      const hit = hitTest(this.deps.state.doc.notes, this.view, p.x, p.y);
      if (hit) cursor = hit.part === 'body' ? 'grab' : 'ew-resize';
      else if (this.deps.state.tool === 'add' && !e.shiftKey && inPiano(midi)) cursor = 'copy';
      else cursor = 'crosshair';
    }
    if (p.x < 0 && p.y >= 0) midi = midiAt(this.view, p.y);
    this.canvas.style.cursor = cursor;
    if (midi !== this.hoverMidi) {
      this.hoverMidi = midi;
      this.requestDraw();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.view.height : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const p = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      this.setView(zoomTime(this.view, Math.exp(-dy * 0.01), Math.max(0, p.x)));
    } else if (e.altKey) {
      this.setView(zoomPitch(this.view, Math.exp(-dy * 0.01), Math.max(0, p.y)));
    } else if (e.shiftKey) {
      this.setView(scrollBy(this.view, dy || dx, 0));
    } else {
      this.setView(scrollBy(this.view, dx, dy));
    }
  }

  private noteAt(e: MouseEvent): EdNote | null {
    const p = this.local(e);
    if (p.x < 0 || p.y < 0) return null;
    return hitTest(this.deps.state.doc.notes, this.view, p.x, p.y)?.note ?? null;
  }

  private remove(note: EdNote): void {
    const s = this.deps.state;
    const notes = s.doc.notes.filter((n) => n.id !== note.id);
    const sel = new Set(s.selection);
    sel.delete(note.id);
    this.deps.commit({ ...s.doc, notes }, 'Delete a note', sel);
  }

  private onDouble(e: MouseEvent): void {
    const note = this.noteAt(e);
    if (note) this.remove(note);
  }

  private onContext(e: MouseEvent): void {
    const note = this.noteAt(e);
    if (!note) return;
    e.preventDefault();
    this.cancelDrag();
    this.remove(note);
  }

  // ---------- drawing ----------

  private longestNote(notes: readonly EdNote[]): number {
    if (this.longestFor !== notes) {
      this.longestFor = notes;
      this.longest = notes.reduce((m, n) => Math.max(m, n.dur), 0);
    }
    return this.longest;
  }

  private draw(): void {
    const c = this.ctx;
    const col = this.colors;
    const s = this.deps.state;
    const v = this.view;
    const G = this.gutter;
    const W = this.cssW;
    const H = this.cssH;
    const doc = this.preview ?? s.doc;
    c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = col.bg;
    c.fillRect(0, 0, W, H);

    const mTop = midiAt(v, 0);
    const mBottom = midiAt(v, v.height - 1);
    const tLeft = timeAt(v, 0);
    const tRight = timeAt(v, v.width);

    // ---- note area ----
    c.save();
    c.translate(G, RULER_H);
    c.beginPath();
    c.rect(0, 0, v.width, v.height);
    c.clip();

    for (let m = mTop; m >= mBottom; m--) {
      const y = yOf(v, m);
      if (!inPiano(m)) {
        c.fillStyle = 'rgba(255, 125, 110, 0.10)';
        c.fillRect(0, y, v.width, v.rowH);
      } else if (isBlack(m)) {
        c.fillStyle = 'rgba(2, 24, 40, 0.32)';
        c.fillRect(0, y, v.width, v.rowH);
      }
      if (m === this.hoverMidi) {
        c.fillStyle = 'rgba(255, 247, 232, 0.08)';
        c.fillRect(0, y, v.width, v.rowH);
      }
      if (m % 12 === 0) {
        c.fillStyle = col.line;
        c.fillRect(0, Math.round(y + v.rowH) - 1, v.width, 1);
      }
    }

    if (s.peaks) {
      const mid = v.height / 2;
      const amp = v.height * 0.45;
      c.fillStyle = 'rgba(143, 211, 255, 0.22)';
      const stepPx = 2;
      for (let x = 0; x < v.width; x += stepPx) {
        const t0 = timeAt(v, x);
        if (t0 > s.peaks.duration) break;
        if (t0 + stepPx / v.pxPerSec < 0) continue;
        const [lo, hi] = peakRange(s.peaks, t0, t0 + stepPx / v.pxPerSec);
        const top = mid - hi * amp;
        c.fillRect(x, top, stepPx, Math.max(1, (hi - lo) * amp));
      }
    }

    const lines = gridLines(s.grid, tLeft, tRight, s.snap < 0 ? 1 : s.snap || 1, v.pxPerSec);
    for (const line of lines) {
      const x = Math.round(xOf(v, line.time));
      c.fillStyle = line.kind === 'bar' ? col.lineStrong : line.kind === 'beat' ? col.line : col.sub;
      c.fillRect(x, 0, line.kind === 'bar' ? 2 : 1, v.height);
    }

    if (s.loop) {
      const x0 = xOf(v, s.loop.start);
      const x1 = xOf(v, s.loop.end);
      c.fillStyle = s.loopOn ? 'rgba(95, 227, 184, 0.12)' : 'rgba(255, 247, 232, 0.05)';
      c.fillRect(x0, 0, x1 - x0, v.height);
    }

    const notes = doc.notes;
    const longest = this.longestNote(notes);
    const showLabels = v.rowH >= 11;
    c.font = `600 ${Math.min(14, Math.floor(v.rowH * 0.78))}px ${FONT}`;
    c.textBaseline = 'middle';
    const drawNote = (n: EdNote, alpha: number, live: boolean) => {
      const y = yOf(v, n.midi);
      if (y > v.height || y + v.rowH < 0) return;
      const x = xOf(v, n.start);
      const w = Math.max(8, n.dur * v.pxPerSec);
      const hgt = Math.max(4, v.rowH - 2);
      const sel = s.selection.has(n.id);
      const r = Math.min(9, hgt / 2, w / 2);
      c.globalAlpha = alpha;
      if (sel) {
        // A sun glow around selected notes.
        c.fillStyle = col.star;
        c.beginPath();
        c.roundRect(x - 2.5, y - 1.5, w + 4, hgt + 5, r + 3);
        c.fill();
      }
      c.fillStyle = n.hand === 'right' ? col.right : col.left;
      c.beginPath();
      c.roundRect(x + 0.5, y + 1, w - 1, hgt, r);
      c.fill();
      if (sel) {
        c.fillStyle = 'rgba(255, 255, 255, 0.28)';
        c.fill();
      } else if (s.problems.has(n.id) && !live) {
        c.strokeStyle = col.bad;
        c.lineWidth = 2.5;
        c.setLineDash([5, 3]);
        c.stroke();
        c.setLineDash([]);
      } else {
        // A soft lower lip, like the app's chunky buttons.
        c.fillStyle = 'rgba(2, 24, 40, 0.28)';
        c.fillRect(x + r, y + hgt - 1, Math.max(0, w - 2 * r), 2);
      }
      if (showLabels && w > 30) {
        c.fillStyle = '#10304a';
        c.fillText(label(n.midi), x + 7, y + 1.5 + hgt / 2, w - 10);
      }
      c.globalAlpha = 1;
    };
    for (let i = firstVisible(notes, tLeft, longest); i < notes.length; i++) {
      const n = notes[i];
      if (n.start > tRight) break;
      if (n.start + n.dur < tLeft) continue;
      drawNote(n, 0.95, false);
    }
    for (const n of s.live) drawNote(n, 0.6, true);

    if (notes.length === 0 && s.live.length === 0) {
      c.fillStyle = col.muted;
      c.font = `600 18px ${FONT}`;
      c.textAlign = 'center';
      c.fillText(
        s.tool === 'add' ? 'Tap anywhere to add a note' : 'No notes yet. Pick Add to start',
        v.width / 2,
        v.height / 2,
      );
      c.textAlign = 'start';
    }

    const d = this.drag;
    if (d?.kind === 'box' && d.moved) {
      c.fillStyle = 'rgba(255, 210, 63, 0.12)';
      c.strokeStyle = col.star;
      c.lineWidth = 2;
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      c.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      c.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }

    const px = xOf(v, s.playhead);
    if (px >= -2 && px <= v.width + 2) {
      c.fillStyle = col.star;
      c.fillRect(Math.round(px) - 1.5, 0, 3, v.height);
    }
    c.restore();

    // ---- ruler ----
    c.fillStyle = col.panel;
    c.fillRect(G, 0, W - G, RULER_H);
    c.fillStyle = col.line;
    c.fillRect(G, RULER_H - 1, W - G, 1);
    c.save();
    c.beginPath();
    c.rect(G, 0, W - G, RULER_H);
    c.clip();
    if (s.loop) {
      const x0 = G + xOf(v, s.loop.start);
      const x1 = G + xOf(v, s.loop.end);
      c.fillStyle = s.loopOn ? 'rgba(95, 227, 184, 0.6)' : 'rgba(255, 247, 232, 0.2)';
      c.beginPath();
      c.roundRect(x0, 5, x1 - x0, RULER_H - 10, 8);
      c.fill();
    }
    c.font = `600 13px ${FONT}`;
    c.textBaseline = 'middle';
    let lastLabel = -Infinity;
    for (const line of lines) {
      const x = G + Math.round(xOf(v, line.time));
      if (line.kind === 'bar') {
        c.fillStyle = col.muted;
        c.fillRect(x, RULER_H - 10, 2, 9);
        if (x - lastLabel >= 34 && line.bar !== undefined && line.bar >= 1) {
          c.fillText(String(line.bar), x + 4, RULER_H / 2 - 2);
          lastLabel = x;
        }
      } else if (line.kind === 'beat') {
        c.fillStyle = col.lineStrong;
        c.fillRect(x, RULER_H - 6, 1, 5);
      }
    }
    const hx = G + px;
    c.fillStyle = col.star;
    c.beginPath();
    c.moveTo(hx - 8, 0);
    c.lineTo(hx + 8, 0);
    c.lineTo(hx, 12);
    c.closePath();
    c.fill();
    c.restore();

    // ---- key strip: cream keys, ink black keys, big C labels ----
    c.save();
    c.beginPath();
    c.rect(0, RULER_H, G, H - RULER_H);
    c.clip();
    c.fillStyle = col.keyWhite;
    c.fillRect(0, RULER_H, G, H - RULER_H);
    c.textBaseline = 'middle';
    for (let m = mTop; m >= mBottom; m--) {
      const y = RULER_H + yOf(v, m);
      const held = s.held.has(m);
      if (!inPiano(m)) {
        c.fillStyle = '#8aa1ad';
        c.fillRect(0, y, G, v.rowH);
        continue;
      }
      if (isBlack(m)) {
        c.fillStyle = held ? col.star : m === this.hoverMidi ? '#2b5675' : col.keyBlack;
        c.beginPath();
        c.roundRect(0, y + 0.5, G * 0.6, v.rowH - 1, [0, 4, 4, 0]);
        c.fill();
      } else {
        if (held || m === this.hoverMidi) {
          c.fillStyle = held ? col.star : '#f6e2bd';
          c.fillRect(0, y, G, v.rowH);
        }
        const pc = m % 12;
        if (pc === 0 || pc === 5) {
          c.fillStyle = 'rgba(16, 48, 74, 0.35)';
          c.fillRect(0, Math.round(y + v.rowH) - 1, G, 1);
        }
      }
      if (m % 12 === 0 && v.rowH >= 7) {
        c.font = `600 ${Math.min(14, Math.max(11, Math.floor(v.rowH * 0.9)))}px ${FONT}`;
        c.fillStyle = col.keyLabel;
        c.textAlign = 'right';
        c.fillText(label(m), G - 5, y + v.rowH / 2 + 0.5);
        c.textAlign = 'start';
      }
    }
    c.fillStyle = 'rgba(2, 24, 40, 0.5)';
    c.fillRect(G - 2, RULER_H, 2, H - RULER_H);
    c.restore();

    c.fillStyle = col.panel;
    c.fillRect(0, 0, G, RULER_H);
    c.fillStyle = col.line;
    c.fillRect(0, RULER_H - 1, G, 1);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.observer.disconnect();
    this.canvas.remove();
  }
}

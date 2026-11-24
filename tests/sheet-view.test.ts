import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NoteState } from '../src/player/game';
import type { FrameState } from '../src/player/view';
import { renderSnippet } from '../src/sheet/snippet';
import { SheetView } from '../src/sheet/view';
import { seq, sortNotes, type Song } from '../src/song';
import { MockContext, MockPath2D } from './sheet-mockcanvas';

// A very small stand-in for the DOM: enough for the view to build its elements.
class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attrs = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  style: Record<string, unknown> & { setProperty(k: string, v: string): void } = {
    setProperty: (k: string, v: string) => {
      this.style[k] = v;
    },
  };
  hidden = false;
  textContent = '';
  className = '';
  type = '';
  width = 0;
  height = 0;
  ctx: MockContext | null = null;
  constructor(readonly tag: string) {}
  append(...els: FakeElement[]) {
    for (const el of els) {
      el.parent = this;
      this.children.push(el);
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  click() {
    for (const fn of this.listeners.get('click') ?? []) fn();
  }
  getContext() {
    this.ctx ??= new MockContext(this.width / 2, this.height / 2);
    return this.ctx;
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, Path2D: g.Path2D };

beforeAll(() => {
  g.document = { createElement: (tag: string) => new FakeElement(tag) };
  g.Path2D = MockPath2D;
});

afterAll(() => {
  g.document = saved.document;
  g.Path2D = saved.Path2D;
});

const song: Song = {
  id: 'ode-test',
  title: 'Ode test',
  by: '',
  bpm: 120,
  notes: sortNotes([
    ...seq('right', 0.25, 'E4/2 E4/2 F4/2 G4/2 G4/2 F4/2 E4/2 D4/2 C4/2 C4/2 D4/2 E4/2 E4/3 D4/1 D4/4'),
    ...seq('left', 0.25, 'C3/8 G2/8 C3/8 G2/8'),
  ]),
};

function frame(time: number, states: NoteState[], extra: Partial<FrameState> = {}): FrameState {
  return {
    song,
    notes: song.notes,
    states,
    time,
    length: 8,
    mode: 'wait',
    hands: 'both',
    speed: 1,
    running: true,
    expected: new Set<number>(),
    held: new Set<number>(),
    wrong: null,
    keyLetters: new Map(),
    range: { lo: 36, hi: 83 },
    showNoteNames: false,
    reduceMotion: false,
    now: 1000 + time * 1000,
    ...extra,
  };
}

describe('sheet view', () => {
  it('builds, draws frames, maps keys and cleans up', () => {
    const host = new FakeElement('div');
    const view = new SheetView(host as unknown as HTMLElement);
    view.resize(900, 520, 2);
    const states: NoteState[] = song.notes.map((_, i) => (i < 4 ? 'hit' : i === 4 ? 'miss' : 'pending'));
    for (const t of [-1, 0, 0.5, 1.2, 2.4]) {
      view.draw(frame(t, states, { held: new Set([64, 61]), expected: new Set([67]), showNoteNames: t > 1 }));
    }
    const root = host.children[0];
    expect(root.className).toBe('sheet-view');
    const canvas = root.children.find((c) => c.tag === 'canvas')!;
    expect(canvas.width).toBe(1800);
    const ctx = canvas.ctx!;
    expect(ctx.shapes).toBeGreaterThan(200);
    expect(canvas.getAttribute('aria-label')).toContain('C major');
    expect(canvas.getAttribute('aria-label')).not.toContain('\u2014');

    // The keyboard strip at the bottom can be played.
    const key = view.keyAt(450, 515);
    expect(key).not.toBeNull();
    expect(view.keyAt(450, 100)).toBeNull();
    const rect = view.keyRect(60)!;
    expect(rect.y).toBeGreaterThan(400);

    // Hiding the keyboard frees the space; effects then point at the staff.
    const toggle = root.children.find((c) => c.tag === 'button')!;
    expect(toggle.textContent).toBe('Hide keyboard');
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(view.keyAt(450, 515)).toBeNull();
    expect(view.keyRect(60)).not.toBeNull();
    toggle.click();

    if (process.env.SHEET_SVG_DIR) {
      ctx.out = [];
      ctx.width = 1800;
      ctx.height = 1040;
      view.draw(frame(2.4, states, { held: new Set([64, 61]), showNoteNames: true }));
      writeFileSync(`${process.env.SHEET_SVG_DIR}/view.svg`, ctx.svg());
    }
    view.destroy();
    expect(host.children.length).toBe(0);
  });

  it('copes with a song with no notes', () => {
    const host = new FakeElement('div');
    const view = new SheetView(host as unknown as HTMLElement);
    view.resize(600, 400, 1);
    const empty: Song = { id: 'empty', title: 'Empty', by: '', notes: [] };
    expect(() => view.draw({ ...frame(0, []), song: empty, notes: empty.notes })).not.toThrow();
    view.destroy();
  });

  it('turns pages instead of sliding when motion is reduced', () => {
    const host = new FakeElement('div');
    const view = new SheetView(host as unknown as HTMLElement);
    view.resize(700, 420, 1);
    const states: NoteState[] = song.notes.map(() => 'pending');
    expect(() => {
      for (let t = -1; t < 9; t += 0.05) view.draw(frame(t, states, { reduceMotion: true, mode: 'flow' }));
    }).not.toThrow();
    view.destroy();
  });
});

describe('notation snippets', () => {
  it('sizes the canvas and draws', () => {
    const canvas = new FakeElement('canvas');
    const size = renderSnippet(canvas as unknown as HTMLCanvasElement, { notes: 'C4/q D4/q E4/h | F#4/8 G4/8 A4/q B4/h', time: { beats: 4, unit: 4 }, names: true, highlight: [2] }, { size: 12, pixelRatio: 2 });
    expect(size.width).toBeGreaterThan(100);
    expect(size.height).toBeGreaterThan(60);
    expect(canvas.width).toBe(size.width * 2);
    expect(canvas.ctx!.shapes).toBeGreaterThan(20);
    if (process.env.SHEET_SVG_DIR) {
      canvas.ctx!.width = size.width * 2;
      canvas.ctx!.height = size.height * 2;
      writeFileSync(`${process.env.SHEET_SVG_DIR}/snippet.svg`, canvas.ctx!.svg());
    }
  });

  it('shrinks to a maximum width', () => {
    const canvas = new FakeElement('canvas');
    const size = renderSnippet(canvas as unknown as HTMLCanvasElement, { notes: 'C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5 C6' }, { size: 14, maxWidth: 200, pixelRatio: 1 });
    expect(size.width).toBeLessThanOrEqual(201);
  });

  it('draws bass and grand staff examples', () => {
    for (const spec of [{ notes: 'C3/w', clef: 'bass' as const }, { notes: 'C4+E4+G4/h G4/h', lower: 'C3/w' }, { notes: 'C3 E4 G2 C5', clef: 'grand' as const }]) {
      const canvas = new FakeElement('canvas');
      expect(() => renderSnippet(canvas as unknown as HTMLCanvasElement, spec, { pixelRatio: 1 })).not.toThrow();
    }
  });
});

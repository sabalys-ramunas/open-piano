import { describe, expect, it } from 'vitest';
import { fitKeys, whiteCount } from '../src/player/keyboard';
import { approach, beatGrid, beatPhase, beatTime, firstBeat, indexNotes, panFor, visibleSeconds, visibleSpan } from '../src/player/stage';
import { isBlack, type Note } from '../src/song';

function randomNotes(count: number, seed = 7): Note[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: Note[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    t += rnd() * 0.2;
    out.push({ midi: 40 + Math.floor(rnd() * 40), start: t, dur: 0.05 + rnd() * (i % 50 === 0 ? 4 : 0.8), hand: rnd() > 0.5 ? 'right' : 'left' });
  }
  return out;
}

describe('visible notes', () => {
  it('finds exactly the notes on screen, checked against a full scan', () => {
    const notes = randomNotes(5000);
    const index = indexNotes(notes);
    for (const t0 of [0, 3.3, 100, 250, 499.9, 1e6]) {
      const t1 = t0 + 2.6;
      const span = visibleSpan(index, t0, t1);
      const expected = notes.map((n, i) => (n.start <= t1 && n.start + n.dur >= t0 ? i : -1)).filter((i) => i >= 0);
      const got: number[] = [];
      for (let i = span.from; i < span.to; i++) if (notes[i].start + notes[i].dur >= t0) got.push(i);
      expect(got).toEqual(expected);
      // And it only looks at a small slice of a long song.
      expect(span.to - span.from).toBeLessThan(200);
    }
  });

  it('falls back to every note when they are not sorted', () => {
    const notes: Note[] = [
      { midi: 60, start: 2, dur: 1, hand: 'right' },
      { midi: 62, start: 1, dur: 1, hand: 'right' },
    ];
    const span = visibleSpan(indexNotes(notes), 0, 1.5);
    expect([span.from, span.to]).toEqual([0, 2]);
  });

  it('shows less song at slower speeds so notes spread out', () => {
    expect(visibleSeconds(0.5)).toBeCloseTo(visibleSeconds(1) / 2);
    expect(visibleSeconds(1, 2)).toBeCloseTo(visibleSeconds(1) * 2);
  });

  it('eases toward a target without overshooting', () => {
    let x = 0;
    for (let i = 0; i < 60; i++) x = approach(x, 10, 1 / 60, 8);
    expect(x).toBeGreaterThan(9.9);
    expect(x).toBeLessThanOrEqual(10);
    expect(approach(Number.NaN, 4, 0.016)).toBe(4);
  });
});

describe('beat lines', () => {
  it('uses beat times when the song has them', () => {
    const grid = beatGrid({ beats: [0.5, 1, 1.5, 2, 2.5], timeSignature: { beats: 3, unit: 4 } })!;
    expect(grid.perBar).toBe(3);
    expect(firstBeat(grid, 1.2)).toBe(2);
    expect(beatTime(grid, 2)).toBe(1.5);
    expect(beatTime(grid, 9)).toBeNaN();
    expect(beatPhase(grid, 1.25)).toBeCloseTo(0.5);
  });

  it('makes an even grid from the tempo', () => {
    const grid = beatGrid({ bpm: 120 })!;
    expect(grid.perBar).toBe(4);
    expect(firstBeat(grid, 1.1)).toBe(3);
    expect(beatTime(grid, 3)).toBe(1.5);
    expect(beatPhase(grid, 1.75)).toBeCloseTo(0.5);
  });

  it('draws no beat lines without a beat', () => {
    expect(beatGrid({})).toBeNull();
    expect(beatPhase(null, 3)).toBe(0);
  });
});

describe('key range', () => {
  it('fits snugly around the song from white key to white key', () => {
    const r = fitKeys([60, 67], { minWhites: 8 });
    expect(isBlack(r.lo)).toBe(false);
    expect(isBlack(r.hi)).toBe(false);
    expect(r.lo).toBeLessThanOrEqual(58);
    expect(r.hi).toBeGreaterThanOrEqual(69);
    expect(whiteCount(r.lo, r.hi)).toBeGreaterThanOrEqual(8);
  });

  it('grows to a minimum width', () => {
    const r = fitKeys([60], { minWhites: 15 });
    expect(whiteCount(r.lo, r.hi)).toBeGreaterThanOrEqual(15);
    expect(r.lo).toBeLessThan(60);
    expect(r.hi).toBeGreaterThan(60);
  });

  it('stays inside the piano', () => {
    const r = fitKeys([21, 108], { minWhites: 15 });
    expect(r).toEqual({ lo: 21, hi: 108 });
    const small = fitKeys([50, 70], { minWhites: 52, limit: { lo: 36, hi: 96 } });
    expect(small.lo).toBeGreaterThanOrEqual(36);
    expect(small.hi).toBeLessThanOrEqual(96);
  });

  it('scrolls the keyboard to keep a spot in view on narrow screens', () => {
    expect(panFor(100, 300, 400)).toBe(0);
    expect(panFor(500, 1000, 400)).toBe(300);
    expect(panFor(990, 1000, 400)).toBe(600);
    expect(panFor(10, 1000, 400)).toBe(0);
  });
});

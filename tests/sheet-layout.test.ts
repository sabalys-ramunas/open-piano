import { describe, expect, it } from 'vitest';
import { layoutScore, measureAt, xAtTime, type Layout } from '../src/sheet/layout';
import { buildScore } from '../src/sheet/score';
import { parseSnippet, snippetScore } from '../src/sheet/snippet';
import { sortNotes, type Note } from '../src/song';
import { bar, ELISE, metric, ODE, TWINKLE } from './sheet-helpers';

function checkLayout(l: Layout): void {
  // Bars follow each other without gaps.
  for (let i = 1; i < l.measures.length; i++) {
    expect(l.measures[i].x).toBeCloseTo(l.measures[i - 1].x + l.measures[i - 1].w, 6);
  }
  // Notes on a staff move strictly to the right.
  for (const staff of [0, 1] as const) {
    const xs = l.measures.flatMap((m) => m.chords.filter((c) => c.staff === staff).map((c) => c.x));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  }
  // The playhead only moves forward.
  let last = -Infinity;
  for (let t = l.startTime - 1; t < l.endTime + 1; t += 0.01) {
    const x = xAtTime(l, t);
    expect(x).toBeGreaterThanOrEqual(last - 1e-9);
    last = x;
  }
  for (const c of l.columns) expect(xAtTime(l, c.time)).toBeCloseTo(c.x, 6);
  // Stems end on their beams.
  for (const m of l.measures) {
    for (const b of m.beams) {
      const slope = b.x2 > b.x1 ? (b.y2 - b.y1) / (b.x2 - b.x1) : 0;
      const stems = m.chords.filter((c) => c.stem && c.stem.x >= b.x1 - 1e-6 && c.stem.x <= b.x2 + 1e-6 && c.staff === b.staff);
      expect(stems.length).toBeGreaterThanOrEqual(2);
      for (const c of stems) {
        expect(c.stem!.y2).toBeCloseTo(b.y1 + slope * (c.stem!.x - b.x1), 6);
        // Stems are long enough to read.
        expect(Math.abs(c.stem!.y2 - c.stem!.y1)).toBeGreaterThan(2.4);
      }
    }
    for (const c of m.chords) for (const h of c.heads) if (h.head.accidental !== null) expect(h.accX).toBeLessThan(h.x);
  }
  expect(l.top).toBeLessThan(-2);
  expect(l.bottom).toBeGreaterThan(l.staves === 2 ? l.dist + 2 : 2);
}

describe('layout', () => {
  it('lays out the known tunes cleanly', () => {
    for (const notes of [TWINKLE, ODE, ELISE]) checkLayout(layoutScore(buildScore({ notes })));
  });

  it('finds the bar under a position', () => {
    const l = layoutScore(buildScore({ notes: ODE, bpm: 120 }));
    const m = l.measures[3];
    expect(measureAt(l, m.x + m.w / 2)).toBe(3);
    expect(measureAt(l, -100)).toBe(0);
    expect(measureAt(l, 1e9)).toBe(l.measures.length - 1);
  });

  it('places the playhead on notes at their times', () => {
    const l = layoutScore(buildScore({ notes: ODE, bpm: 120 }));
    const first = l.measures[0].chords.find((c) => c.staff === 0)!;
    expect(xAtTime(l, 0)).toBeCloseTo(first.x, 6);
    // Before the song starts the playhead waits to the left of the first note.
    expect(xAtTime(l, -1)).toBeLessThan(first.x);
    expect(xAtTime(l, -1)).toBeGreaterThanOrEqual(l.header);
  });

  it('lays out free timing by time', () => {
    const notes: Note[] = [];
    let at = 0;
    for (let i = 0; i < 30; i++) {
      notes.push({ midi: 55 + ((i * 5) % 20), start: at, dur: 0.3, hand: i % 2 ? 'right' : 'left' });
      at += 0.13 + ((i * 0.618) % 1) * 0.8;
    }
    const l = layoutScore(buildScore({ notes: sortNotes(notes) }));
    expect(l.kind).toBe('free');
    expect(l.bars).toBe(false);
    const chords = l.measures.flatMap((m) => m.chords);
    expect(chords).toHaveLength(30);
    for (let i = 1; i < chords.length; i++) expect(chords[i].x).toBeGreaterThan(chords[i - 1].x);
    expect(xAtTime(l, notes[10].start)).toBeCloseTo(chords[10].x, 6);
  });
});

describe('snippets', () => {
  it('reads the token format', () => {
    const t = parseSnippet('C4 D#4/8 Eb4/h. C4+E4+G4/w _/q |');
    expect(t.map((x) => [x.rest, x.len, x.base, x.dots, x.pitches.length])).toEqual([
      [false, 4, 4, 0, 1],
      [false, 2, 8, 0, 1],
      [false, 12, 2, 1, 1],
      [false, 16, 1, 0, 3],
      [true, 4, 4, 0, 0],
      [true, 0, 4, 0, 0],
    ]);
    expect(t[1].pitches[0]).toEqual({ letter: 1, alter: 1, octave: 4 });
    expect(t[2].pitches[0]).toEqual({ letter: 2, alter: -1, octave: 4 });
  });

  it('names a token it cannot read', () => {
    expect(() => parseSnippet('C4 H4')).toThrow('H4');
    expect(() => parseSnippet('C4/3')).toThrow('C4/3');
  });

  it('builds bars, accidentals and the key signature', () => {
    const s = snippetScore({ notes: 'F#4/q F#4/q F4/h | F#4/w', time: { beats: 4, unit: 4 } });
    expect(s.measures).toHaveLength(2);
    expect(bar(s.measures[0], 0, true)).toBe('(#)F#4/4 F#4/4 (n)F4/2');
    expect(bar(s.measures[1], 0, true)).toBe('(#)F#4/1');
    const g = snippetScore({ notes: 'G4 F#4 F4 G4', key: 1 });
    expect(bar(g.measures[0], 0, true)).toBe('G4/4 F#4/4 (n)F4/4 G4/4');
    expect(g.bars).toBe(false);
    expect(g.staves).toBe(1);
  });

  it('chooses a clef from the notes', () => {
    expect(snippetScore({ notes: 'C4 E4 G4' }).clefs[0]).toBe('treble');
    expect(snippetScore({ notes: 'C3 E3 G3' }).clefs[0]).toBe('bass');
    const grand = snippetScore({ notes: 'C3 E5' });
    expect(grand.staves).toBe(2);
    expect(bar(grand.measures[0], 0)).toBe('r4 E5/4');
    expect(bar(grand.measures[0], 1)).toBe('C3/4 r4');
  });

  it('beams eighths in snippets too', () => {
    const s = metric(snippetScore({ notes: 'C5/8 D5/8 E5/8 F5/8 G5/h' }));
    const beams = s.measures[0].staves[0].map((e) => (e.kind === 'chord' ? e.beam : -2));
    expect(beams[0]).toBeGreaterThanOrEqual(0);
    expect(new Set(beams.slice(0, 4)).size).toBe(1);
    checkLayout(layoutScore(s));
  });
});

import { describe, expect, it } from 'vitest';
import { analyseTiming, estimateMeter, meterTicks, tickAt, timeAt, type MetricTiming, type Timing } from '../src/sheet/timing';
import { seq, sortNotes, type Note } from '../src/song';
import { ELISE, humanise, ODE, rng, TWINKLE } from './sheet-helpers';

function metricOf(t: Timing): MetricTiming {
  if (t.kind !== 'metric') throw new Error(`expected rhythm, got free timing (error ${t.error.toFixed(2)})`);
  return t;
}

/** Positions of the right hand relative to the first note, in sixteenths. */
const rightTicks = (t: MetricTiming) => {
  const right = t.notes.filter((n) => n.hand === 'right');
  return right.map((n) => n.tick - right[0].tick);
};

const steps = (line: string, unit: number) => {
  const out: number[] = [];
  let at = 0;
  for (const tokn of line.trim().split(/\s+/)) {
    const [p, len] = tokn.split('/');
    if (p !== '_') out.push(at);
    at += Number(len) * unit;
  }
  return out;
};

describe('tempo and meter from clean songs', () => {
  it('reads Twinkle as 4/4 quarter notes at 120', () => {
    for (const bpm of [120, undefined]) {
      const t = metricOf(analyseTiming({ notes: TWINKLE, bpm }));
      expect(t.meter).toEqual({ beats: 4, unit: 4 });
      expect(t.bpm).toBeCloseTo(120, 0);
      expect(t.error).toBeLessThan(0.01);
      // The first note starts a bar.
      expect((t.notes[0].tick - t.origin) % 16).toBe(0);
      // Every note starts on a beat.
      expect(t.notes.every((n) => (n.tick - t.notes[0].tick) % 4 === 0)).toBe(true);
    }
  });

  it('reads Ode to Joy with its dotted rhythm', () => {
    const t = metricOf(analyseTiming({ notes: ODE, bpm: 120 }));
    expect(t.meter).toEqual({ beats: 4, unit: 4 });
    expect(rightTicks(t).slice(0, 15)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 54, 56]);
  });

  it('reads Für Elise as 3/8 with a two-sixteenth upbeat, even though its bpm does not fit', () => {
    for (const bpm of [100, undefined]) {
      const t = metricOf(analyseTiming({ notes: ELISE, bpm }));
      expect(t.meter).toEqual({ beats: 3, unit: 8 });
      const first = t.notes[0].tick;
      expect((((first - t.origin) % 6) + 6) % 6).toBe(4); // two sixteenths before a bar line
      expect(rightTicks(t).slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('keeps a given time signature', () => {
    const t = metricOf(analyseTiming({ notes: TWINKLE, bpm: 120, timeSignature: { beats: 2, unit: 4 } }));
    expect(t.meter).toEqual({ beats: 2, unit: 4 });
  });

  it('finds 3/4 in a waltz', () => {
    const notes = sortNotes([
      ...seq('left', 0.5, 'C3/1 E3+G3/1 E3+G3/1 G2/1 D3+F3/1 D3+F3/1 C3/1 E3+G3/1 E3+G3/1 G2/1 D3+F3/1 D3+F3/1 C3/1 E3+G3/1 E3+G3/1 C3/3'),
      ...seq('right', 0.5, 'E5/2 G5/1 F5/3 E5/2 C5/1 D5/3 G5/2 E5/1 F5/2 D5/1 C5/3'),
    ]);
    const t = metricOf(analyseTiming({ notes }));
    expect(t.meter).toEqual({ beats: 3, unit: 4 });
    expect((t.notes[0].tick - t.origin) % 12).toBe(0);
  });

  it('writes a jig in 6/8 with eighth notes when told its tempo and meter', () => {
    const notes = sortNotes([
      ...seq('right', 0.2, 'G4/2 B4/1 D5/2 B4/1 C5/2 E5/1 D5/2 B4/1 G4/2 B4/1 D5/2 G5/1 F#5/3 D5/3 G4/2 B4/1 D5/2 B4/1 C5/2 A4/1 F#4/2 A4/1 G4/6'),
      ...seq('left', 0.2, 'G2/3 D3/3 C3/3 G2/3 G2/3 B2/3 D3/6 G2/3 D3/3 C3/3 D3/3 G2/6'),
    ]);
    const t = metricOf(analyseTiming({ notes, bpm: 150, timeSignature: { beats: 6, unit: 8 } }));
    expect(t.meter).toEqual({ beats: 6, unit: 8 });
    expect(rightTicks(t).slice(0, 6)).toEqual([0, 4, 6, 10, 12, 16]);
    // Without help it groups the same notes in threes as well (3/8 and 6/8 read the same).
    const free = metricOf(analyseTiming({ notes }));
    expect(free.meter.unit).toBe(8);
  });
});

describe('human timing', () => {
  it('still reads Ode to Joy correctly when played unevenly and speeding up', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const played = humanise(ODE, seed, { jitter: 0.022, drift: 0.08 });
      const t = metricOf(analyseTiming({ notes: played }));
      expect(t.meter).toEqual({ beats: 4, unit: 4 });
      expect(rightTicks(t)).toEqual(steps('E4/2 E4/2 F4/2 G4/2 G4/2 F4/2 E4/2 D4/2 C4/2 C4/2 D4/2 E4/2 E4/3 D4/1 D4/4 E4/2 E4/2 F4/2 G4/2 G4/2 F4/2 E4/2 D4/2 C4/2 C4/2 D4/2 E4/2 D4/3 C4/1 C4/4', 2));
    }
  });

  it('still reads Twinkle when played unevenly', () => {
    for (const seed of [11, 12, 13]) {
      const t = metricOf(analyseTiming({ notes: humanise(TWINKLE, seed, { jitter: 0.025, drift: -0.07 }) }));
      expect(t.meter).toEqual({ beats: 4, unit: 4 });
      expect(rightTicks(t).every((x) => x % 4 === 0)).toBe(true);
      expect(rightTicks(t).length).toBe(42);
    }
  });

  it('follows beat times from a recording, even with rubato', () => {
    // Beats get slower and faster; notes sit on (and between) them.
    const beats: number[] = [];
    let at = 0.7;
    for (let i = 0; i < 40; i++) {
      beats.push(at);
      at += 0.5 + 0.12 * Math.sin(i / 3);
    }
    const onBeat = (b: number) => {
      const i = Math.floor(b);
      return beats[i] + (b - i) * (beats[i + 1] - beats[i]);
    };
    const pattern = [0, 1, 1.5, 2, 3, 4, 4.5, 5, 5.5, 6, 8, 9, 10, 10.5, 11, 12];
    const notes: Note[] = pattern.map((b, i) => ({
      midi: 60 + (i % 5),
      start: onBeat(b),
      dur: onBeat(pattern[i + 1] ?? b + 1) - onBeat(b) - 0.03,
      hand: 'right',
    }));
    const t = metricOf(analyseTiming({ notes, beats, bpm: 120 }));
    expect(rightTicks(t)).toEqual(pattern.map((b) => b * 4));
  });

  it('gives up on rhythm for very free playing', () => {
    const rand = rng(7);
    let at = 0;
    const notes: Note[] = [];
    for (let i = 0; i < 40; i++) {
      notes.push({ midi: 60 + Math.floor(rand() * 12), start: at, dur: 0.2, hand: 'right' });
      at += 0.11 + rand() * 0.9;
    }
    expect(analyseTiming({ notes }).kind).toBe('free');
  });

  it('handles tiny songs', () => {
    expect(analyseTiming({ notes: [] }).kind).toBe('metric');
    const one = metricOf(analyseTiming({ notes: [{ midi: 60, start: 1, dur: 0.5, hand: 'right' }] }));
    expect(one.notes).toHaveLength(1);
    const two = metricOf(analyseTiming({ notes: seq('right', 0.5, 'C4/1 D4/1') }));
    expect(two.notes.map((n) => n.len)).toEqual([4, 4]);
  });
});

describe('time maps and meters', () => {
  it('maps seconds and ticks both ways, past the ends too', () => {
    const map = { times: [1, 2, 4], ticks: [0, 4, 8] };
    expect(tickAt(map, 1.5)).toBe(2);
    expect(tickAt(map, 3)).toBe(6);
    expect(tickAt(map, 6)).toBe(12);
    expect(tickAt(map, 0)).toBe(-4);
    expect(timeAt(map, 6)).toBe(3);
    expect(timeAt(map, -4)).toBe(0);
  });

  it('knows bar and beat sizes', () => {
    expect(meterTicks({ beats: 4, unit: 4 })).toEqual({ bar: 16, beat: 4 });
    expect(meterTicks({ beats: 3, unit: 8 })).toEqual({ bar: 6, beat: 2 });
    expect(meterTicks({ beats: 6, unit: 8 })).toEqual({ bar: 12, beat: 6 });
    expect(meterTicks({ beats: 2, unit: 2 })).toEqual({ bar: 16, beat: 8 });
  });

  it('places bar lines where bass notes fall', () => {
    const notes = [0, 4, 8, 12, 16, 20, 24, 28].map((tick, i) => ({ tick: tick + 2, len: 4, midi: 60, hand: 'right' as const, i }));
    const bass = [2, 14, 26].map((tick) => ({ tick, len: 12, midi: 40, hand: 'left' as const }));
    expect(estimateMeter([...notes, ...bass])).toEqual({ meter: { beats: 3, unit: 4 }, origin: 2 });
  });
});

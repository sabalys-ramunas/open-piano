import { describe, expect, it } from 'vitest';
import { beatLength, clampSpeed, formatTime, loopAround, loopFor, passageLength, passAccuracy, TrickyCoach, trickiest, troublePassages } from '../src/player/practice';
import type { Mistake } from '../src/player/scoring';
import { seq } from '../src/song';

// Sixteen notes, one every half second.
const notes = seq('right', 0.5, 'C4/1 D4/1 E4/1 F4/1 G4/1 A4/1 B4/1 C5/1 C4/1 D4/1 E4/1 F4/1 G4/1 A4/1 B4/1 C5/1');
const m = (time: number, kind: Mistake['kind'] = 'miss'): Mistake => ({ time, kind });

describe('speed', () => {
  it('rounds to 5% steps between 25% and 125%', () => {
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(0.62)).toBe(0.6);
    expect(clampSpeed(0.63)).toBe(0.65);
    expect(clampSpeed(3)).toBe(1.25);
    expect(clampSpeed(Number.NaN)).toBe(1);
  });

  it('formats times', () => {
    expect(formatTime(-1)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
  });
});

describe('beats and passages', () => {
  it('finds the beat from bpm or beat times', () => {
    expect(beatLength({ bpm: 120 })).toBe(0.5);
    expect(beatLength({ beats: [0, 0.6, 1.2, 1.8, 2.4] })).toBeCloseTo(0.6);
    expect(beatLength({})).toBeNull();
  });

  it('uses two bars as a passage when there is a beat', () => {
    expect(passageLength({ bpm: 120, timeSignature: { beats: 3, unit: 4 } })).toBe(3);
    expect(passageLength({})).toBe(4);
  });
});

describe('trouble passages', () => {
  it('finds the passage with the most mistakes, worst first, without overlaps', () => {
    const mistakes = [m(1), m(5), m(5.5), m(6, 'wrong'), m(6.2), m(1.2, 'timing')];
    const found = troublePassages(mistakes, 2, 3);
    expect(found[0]).toMatchObject({ start: 5, end: 6.2, count: 4 });
    expect(found[1]).toMatchObject({ start: 1, end: 1.2, count: 2 });
    expect(found.length).toBe(2);
  });

  it('weighs a timing slip less than a missed note', () => {
    const found = troublePassages([m(1, 'timing'), m(1.1, 'timing'), m(5)], 1, 1);
    expect(found[0].start).toBe(5);
  });

  it('returns nothing without mistakes', () => {
    expect(troublePassages([], 4)).toEqual([]);
    expect(trickiest([], notes, 4)).toBeNull();
  });
});

describe('practice loops', () => {
  it('starts the loop on the note before the first mistake and ends after the last', () => {
    const loop = loopFor({ start: 3, end: 4 }, notes)!;
    expect(loop.start).toBe(2.5);
    expect(loop.end).toBeCloseTo(4.6);
  });

  it('is at least the minimum length and stays inside the song', () => {
    const loop = loopFor({ start: 0, end: 0 }, notes, 2)!;
    expect(loop.start).toBe(0);
    expect(loop.end - loop.start).toBeGreaterThanOrEqual(2);
    const late = loopFor({ start: 7.5, end: 7.5 }, notes, 2)!;
    expect(late.end).toBeLessThanOrEqual(7.5 + 0.46 + 0.5);
  });

  it('picks the tricky part as a loop', () => {
    const loop = trickiest([m(1), m(5), m(5.5), m(6)], notes, 2)!;
    expect(loop.start).toBeLessThanOrEqual(5);
    expect(loop.end).toBeGreaterThan(6);
  });

  it('loops around the last mistake', () => {
    const loop = loopAround(4, notes)!;
    expect(loop.start).toBeLessThan(4);
    expect(loop.end).toBeGreaterThan(4);
  });

  it('returns null when there is nothing to play in the loop', () => {
    expect(loopFor({ start: 20, end: 21 }, notes)).toBeNull();
    expect(loopFor({ start: 0, end: 1 }, [])).toBeNull();
  });
});

describe('tricky part coach', () => {
  it('starts slow, speeds up on clean passes and finishes after two clean passes at full speed', () => {
    const coach = new TrickyCoach(1);
    expect(coach.ladder).toEqual([0.6, 0.7, 0.8, 0.9, 1]);
    expect(coach.speed).toBe(0.6);
    const clean = { hit: 10, missed: 0, wrong: 0 };
    for (const expected of [0.7, 0.8, 0.9, 1]) {
      const step = coach.pass(clean);
      expect(step.changed).toBe(true);
      expect(step.speed).toBe(expected);
    }
    expect(coach.pass(clean).done).toBe(false);
    expect(coach.pass(clean).done).toBe(true);
  });

  it('slows down when a pass goes badly and stays put when it is close', () => {
    const coach = new TrickyCoach(1);
    coach.pass({ hit: 10, missed: 0, wrong: 0 });
    expect(coach.speed).toBe(0.7);
    expect(coach.pass({ hit: 7, missed: 3, wrong: 0 }).changed).toBe(false);
    const down = coach.pass({ hit: 2, missed: 8, wrong: 0 });
    expect(down.changed).toBe(true);
    expect(coach.speed).toBe(0.6);
    // Never below the bottom step.
    coach.pass({ hit: 0, missed: 10, wrong: 0 });
    expect(coach.speed).toBe(0.6);
  });

  it('works up to a slower target speed', () => {
    const coach = new TrickyCoach(0.5);
    expect(coach.ladder[coach.ladder.length - 1]).toBe(0.5);
    expect(coach.ladder[0]).toBe(0.3);
  });

  it('counts wrong keys against a pass', () => {
    expect(passAccuracy({ hit: 10, missed: 0, wrong: 4 })).toBeCloseTo(0.9);
    expect(passAccuracy({ hit: 0, missed: 0, wrong: 0 })).toBe(0);
  });
});

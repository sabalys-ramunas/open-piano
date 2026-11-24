import { describe, expect, it } from 'vitest';
import type { Instrument } from '../src/audio/instrument';
import { calloutFor, gradeFor, histogramBin, multiplierFor, ScoreKeeper, Scorer } from '../src/player/scoring';
import { Session, type Backing } from '../src/player/session';
import { seq, toMidi, type Song } from '../src/song';

describe('timing grades', () => {
  it('grades Play along hits by how far off they were', () => {
    expect(gradeFor(0, 'flow')).toBe('perfect');
    expect(gradeFor(0.06, 'flow')).toBe('perfect');
    expect(gradeFor(-0.1, 'flow')).toBe('good');
    expect(gradeFor(-0.2, 'flow')).toBe('early');
    expect(gradeFor(0.2, 'flow')).toBe('late');
  });

  it('judges in real time, so slowing down does not make timing stricter', () => {
    // 0.05 song seconds at half speed is 0.1 real seconds.
    expect(gradeFor(0.05, 'flow', 0.5)).toBe('good');
    expect(gradeFor(0.1, 'flow', 2)).toBe('perfect');
  });

  it('never calls a Learn mode hit late or early: waiting is not penalised', () => {
    expect(gradeFor(0, 'wait')).toBe('perfect');
    expect(gradeFor(-0.1, 'wait')).toBe('perfect');
    expect(gradeFor(-0.3, 'wait')).toBe('good');
  });

  it('bins timing errors for the chart', () => {
    expect(histogramBin(-1000)).toBe(0);
    expect(histogramBin(-1)).toBe(4);
    expect(histogramBin(0)).toBe(5);
    expect(histogramBin(1000)).toBe(9);
  });
});

describe('scorer', () => {
  it('builds a multiplier from the combo, up to x4', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(9)).toBe(1);
    expect(multiplierFor(10)).toBe(2);
    expect(multiplierFor(35)).toBe(4);
    expect(multiplierFor(500)).toBe(4);
  });

  it('adds points with the multiplier and resets the combo on a miss', () => {
    const s = new Scorer('flow');
    for (let i = 0; i < 10; i++) s.hit(0);
    expect(s.score).toBe(9 * 100 + 200); // the 10th hit is already at x2
    expect(s.combo).toBe(10);
    s.miss();
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(10);
    expect(s.accuracy).toBeCloseTo(10 / 11);
  });

  it('breaks the combo on a wrong key in Play along but not in Learn mode', () => {
    const flow = new Scorer('flow');
    flow.hit(0);
    flow.wrongKey();
    expect(flow.combo).toBe(0);
    const learn = new Scorer('wait');
    learn.hit(0);
    learn.wrongKey();
    expect(learn.combo).toBe(1);
    // Wrong keys cost less accuracy in Learn mode.
    expect(learn.accuracy).toBeGreaterThan(flow.accuracy);
  });

  it('gives the same score for a slow Learn mode run as for a quick one', () => {
    const slow = new Scorer('wait');
    const quick = new Scorer('wait');
    for (let i = 0; i < 20; i++) {
      slow.hit(0); // the song waited for every note
      quick.hit(-0.05);
    }
    expect(slow.score).toBe(quick.score);
    expect(slow.accuracy).toBe(1);
  });

  it('keeps a timing histogram in Play along only', () => {
    const s = new Scorer('flow');
    s.hit(0.2);
    s.hit(-0.3);
    s.hit(0);
    expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.histogram[9]).toBe(1);
    expect(s.histogram[0]).toBe(1);
    const l = new Scorer('wait');
    l.hit(0);
    expect(l.histogram.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('cheers at milestones and helps after a run of misses', () => {
    expect(calloutFor(10, 0, 0, 'flow')).toContain('10');
    expect(calloutFor(11, 0, 0, 'flow')).toBeNull();
    expect(calloutFor(3, 8, 0, 'flow')).toBe('Right on the beat!');
    expect(calloutFor(0, 0, 3, 'flow')).toMatch(/slower/);
  });

  it('resets everything', () => {
    const s = new Scorer('flow');
    s.hit(0);
    s.miss();
    s.reset('wait');
    expect([s.score, s.combo, s.hits, s.misses, s.mode]).toEqual([0, 0, 0, 0, 'wait']);
    expect(s.accuracy).toBe(1);
  });
});

describe('score keeper', () => {
  const song: Song = { id: 's', title: 's', by: '', notes: seq('right', 1, 'C4/1 D4/1 E4/1') };
  const instrument: Instrument = { wake() {}, noteOn() {}, noteOff() {}, play() {}, setVolume() {} };
  const backing = (): Backing => ({ src: '', currentTime: 0, playbackRate: 1, paused: true, ended: false, async play() {}, pause() {} });

  it('scores session events and logs mistakes for practice', () => {
    const session = new Session({ audio: { instrument }, backing: backing() }, song, { mode: 'flow', hands: 'right', speed: 1 });
    const keeper = new ScoreKeeper(session);
    const kinds: string[] = [];
    keeper.onScore((e, cleared) => !cleared && kinds.push(e.kind));
    session.start();
    for (let i = 0; i < 30; i++) session.tick(0.05); // 0.0
    session.press(toMidi('C4'));
    session.press(toMidi('B4'));
    for (let i = 0; i < 100; i++) session.tick(0.05);
    expect(kinds).toEqual(['hit', 'wrong', 'miss', 'miss']);
    expect(keeper.scorer.hits).toBe(1);
    expect(keeper.mistakes.map((m) => m.kind)).toEqual(['wrong', 'miss', 'miss']);
    expect(keeper.lastMistake()).toBe(2);
    expect(keeper.practised).toBe(false);
    session.seek(1);
    expect(keeper.practised).toBe(true);
    session.reset();
    expect(keeper.mistakes).toEqual([]);
    expect(keeper.scorer.score).toBe(0);
    expect(keeper.practised).toBe(false);
    keeper.destroy();
  });
});

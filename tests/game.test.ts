import { describe, expect, it } from 'vitest';
import { arrange } from '../src/import/arrange';
import { keyMap } from '../src/input/keyboard';
import { Game } from '../src/player/game';
import { layout, rangeFor } from '../src/player/keyboard';
import { seq, toMidi, type Song } from '../src/song';
import { BUILT_IN } from '../src/songs';

const tune: Song = {
  id: 't',
  title: 't',
  by: '',
  notes: [...seq('right', 1, 'C4/1 D4/1 E4+G4/1'), ...seq('left', 1, 'C3/3')].sort((a, b) => a.start - b.start),
};

describe('songs', () => {
  it('reads note names', () => {
    expect(toMidi('C4')).toBe(60);
    expect(toMidi('A4')).toBe(69);
    expect(toMidi('D#5')).toBe(75);
  });

  it('ships built-in songs that are in order and playable', () => {
    for (const song of BUILT_IN) {
      expect(song.notes.length).toBeGreaterThan(20);
      song.notes.forEach((n, i) => {
        expect(n.dur).toBeGreaterThan(0);
        if (i > 0) expect(n.start).toBeGreaterThanOrEqual(song.notes[i - 1].start);
      });
      expect(song.notes.some((n) => n.hand === 'left')).toBe(true);
    }
  });

  it('keeps both hands of Für Elise the same length', () => {
    const elise = BUILT_IN.find((s) => s.id === 'elise')!;
    const end = (hand: string) => Math.max(...elise.notes.filter((n) => n.hand === hand).map((n) => n.start));
    expect(Math.abs(end('right') - end('left'))).toBeLessThan(0.7);
  });
});

describe('learn mode', () => {
  it('holds the song until the right key is pressed', () => {
    const game = new Game(tune, { mode: 'wait', hands: 'right', speed: 1 });
    game.advance(10);
    expect(game.time).toBe(0);
    expect(game.waiting).toBe(true);

    expect(game.press(toMidi('D4'))).toBe(false);
    expect(game.wrong).toBe(1);
    expect(game.press(toMidi('C4'))).toBe(true);
    game.advance(10);
    expect(game.time).toBe(1);
  });

  it('needs every note of a chord', () => {
    const game = new Game(tune, { mode: 'wait', hands: 'right', speed: 1 });
    game.advance(10);
    game.press(toMidi('C4'));
    game.advance(10);
    game.press(toMidi('D4'));
    game.advance(10);
    game.press(toMidi('E4'));
    game.advance(10);
    expect(game.time).toBe(2);
    game.press(toMidi('G4'));
    game.advance(10);
    expect(game.finished).toBe(true);
    expect(game.result().accuracy).toBe(1);
  });

  it('plays the other hand for you', () => {
    const game = new Game(tune, { mode: 'wait', hands: 'right', speed: 1 });
    const sounded = game.advance(10);
    expect(sounded.map((n) => n.midi)).toEqual([toMidi('C3')]);
  });
});

describe('play-along mode', () => {
  it('scores hits near the beat and misses the rest', () => {
    const game = new Game(tune, { mode: 'flow', hands: 'right', speed: 1 });
    game.advance(1.4); // lead-in is 1.5s, so this is just before the first note
    expect(game.press(toMidi('C4'))).toBe(true);
    game.advance(5);
    const r = game.result();
    expect(r.hit).toBe(1);
    expect(r.missed).toBe(3);
  });

  it('ignores presses in listen mode', () => {
    const game = new Game(tune, { mode: 'listen', hands: 'both', speed: 1 });
    expect(game.press(60)).toBe(false);
    expect(game.advance(2).length).toBeGreaterThan(0);
  });
});

describe('arranging a transcription', () => {
  const raw = [
    { midi: 48, start: 0, dur: 1, amp: 0.8 },
    { midi: 64, start: 0.01, dur: 0.5, amp: 0.8 },
    { midi: 72, start: 0.02, dur: 0.5, amp: 0.9 },
    { midi: 74, start: 0.5, dur: 0.5, amp: 0.9 },
    { midi: 90, start: 0.7, dur: 0.03, amp: 0.9 }, // too short to be real
    { midi: 76, start: 1, dur: 0.5, amp: 0.05 }, // too quiet to be real
  ];

  it('keeps only the top line for melody', () => {
    expect(arrange(raw, 'melody').map((n) => n.midi)).toEqual([72, 74]);
  });

  it('adds the bass in the left hand', () => {
    const notes = arrange(raw, 'melody-bass');
    expect(notes.filter((n) => n.hand === 'left').map((n) => n.midi)).toEqual([48]);
  });

  it('plays the tune on top of its chord for the full version, and nothing that was not really heard', () => {
    // Arranged, not copied: the tune on top, the C chord under it (bass and chord tones), no stray notes.
    const notes = arrange(raw, 'full');
    const right = notes.filter((n) => n.hand === 'right');
    const left = notes.filter((n) => n.hand === 'left');
    expect(right.filter((n) => n.midi >= 72).map((n) => n.midi)).toEqual([72, 74]);
    expect(left.some((n) => n.midi % 12 === 0)).toBe(true);
    expect(notes.filter((n) => n.midi < 72).every((n) => [0, 4, 7].includes(n.midi % 12))).toBe(true);
    expect(notes.some((n) => n.midi === 90 || n.midi === 76)).toBe(false);
  });
});

describe('keyboard', () => {
  it('fits whole octaves around the notes', () => {
    expect(rangeFor([60, 64])).toEqual({ lo: 60, hi: 83 });
    expect(rangeFor([45, 76])).toEqual({ lo: 36, hi: 83 });
  });

  it('gives every key a place', () => {
    const boxes = layout(60, 83, 1400);
    expect(boxes.size).toBe(24);
    expect(boxes.get(61)!.black).toBe(true);
    expect(boxes.get(60)!.w).toBeCloseTo(100);
  });

  it('maps computer keys from the chosen C', () => {
    const map = keyMap(60);
    expect(map.get('z')).toBe(60);
    expect(map.get('q')).toBe(72);
  });
});

describe('seeking and judging', () => {
  it('skips notes before a seek and restores the ones after', () => {
    const game = new Game(tune, { mode: 'flow', hands: 'right', speed: 1 });
    game.seek(1.5);
    expect(game.state.slice(0, 2)).toEqual(['auto', 'auto']); // C3 is the left hand, C4 skipped
    game.advance(0.6);
    expect(game.takeMisses()).toEqual([]);
    expect(game.result().missed).toBe(2); // C4 and D4 skipped; E4 and G4 still to come
    game.seek(0);
    expect(game.state.filter((s) => s === 'pending').length).toBe(4);
  });

  it('judges only notes inside a loop', () => {
    const game = new Game(tune, { mode: 'wait', hands: 'right', speed: 1 });
    game.seek(0.5, { start: 1, end: 1.5 });
    expect(game.nextGroup().map((i) => game.notes[i].midi)).toEqual([toMidi('D4')]);
    expect(game.state.filter((s) => s === 'pending').length).toBe(1);
  });

  it('allows for a slow audio delay in Play along', () => {
    const game = new Game(tune, { mode: 'flow', hands: 'right', speed: 1 });
    game.advance(1.5 + 0.25); // 0.25 s after C4
    expect(game.strike(toMidi('C4'), 0.2)?.error).toBeCloseTo(0.05);
  });

  it('is gentler with wrong keys in Learn mode', () => {
    const learn = new Game(tune, { mode: 'wait', hands: 'right', speed: 1 });
    const flow = new Game(tune, { mode: 'flow', hands: 'right', speed: 1 });
    learn.advance(10);
    learn.press(toMidi('B4'));
    learn.press(toMidi('C4'));
    flow.advance(1.5);
    flow.press(toMidi('B4'));
    flow.press(toMidi('C4'));
    expect(learn.result().accuracy).toBeGreaterThan(flow.result().accuracy);
  });
});

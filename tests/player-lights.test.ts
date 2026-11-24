import { describe, expect, it } from 'vitest';
import type { NoteState } from '../src/player/game';
import { KeyLights, keysToLight, type LightFrame } from '../src/player/lights';
import { seq } from '../src/song';

const notes = seq('right', 1, 'C4/1 D4/1 E4/1 F4/1');
const pending: NoteState[] = notes.map(() => 'pending');

const frame = (over: Partial<LightFrame>): LightFrame => ({ notes, states: pending, time: 0, mode: 'flow', speed: 1, running: true, next: [], ...over });

describe('keysToLight', () => {
  it('lights nothing while paused or in Listen', () => {
    expect(keysToLight(frame({ running: false })).size).toBe(0);
    expect(keysToLight(frame({ mode: 'listen' })).size).toBe(0);
  });

  it('lights the group Learn mode waits for', () => {
    expect([...keysToLight(frame({ mode: 'wait', next: [1] }))]).toEqual([62]);
  });

  it('lights upcoming pending notes in Play along, not hit or missed ones', () => {
    const states: NoteState[] = ['hit', 'pending', 'pending', 'pending'];
    expect([...keysToLight(frame({ states, time: 0.5 }))]).toEqual([62]);
    expect([...keysToLight(frame({ states: ['miss', 'auto', 'pending', 'pending'], time: 1.5 }))]).toEqual([64]);
  });

  it('looks further ahead at higher speeds', () => {
    expect(keysToLight(frame({ time: 0.5, speed: 1 })).has(62)).toBe(true);
    expect(keysToLight(frame({ time: 0.3, speed: 1 })).has(62)).toBe(false);
    expect(keysToLight(frame({ time: 0.3, speed: 1.25 })).has(62)).toBe(true);
  });
});

describe('KeyLights', () => {
  it('sends only changes and clears everything', () => {
    const sent: [number, boolean][] = [];
    const lights = new KeyLights((m, on) => sent.push([m, on]));
    lights.show(new Set([60, 64]));
    lights.show(new Set([64, 67]));
    lights.clear();
    expect(sent).toEqual([
      [60, true],
      [64, true],
      [60, false],
      [67, true],
      [64, false],
      [67, false],
    ]);
    expect(lights.size).toBe(0);
  });
});

describe('keyLimitFor', () => {
  it('uses the piano size only when connected and narrower than 88 keys', async () => {
    const { keyLimitFor, fitKeys } = await import('../src/player/keyboard');
    expect(keyLimitFor({ keyLow: 36, keyHigh: 96 }, true)).toEqual({ lo: 36, hi: 96 });
    expect(keyLimitFor({ keyLow: 36, keyHigh: 96 }, false)).toBeUndefined();
    expect(keyLimitFor({ keyLow: 21, keyHigh: 108 }, true)).toBeUndefined();
    expect(keyLimitFor({ keyLow: 60, keyHigh: 70 }, true)).toBeUndefined(); // not measured properly yet
    const fit = fitKeys([30, 100], { limit: keyLimitFor({ keyLow: 36, keyHigh: 96 }, true) });
    expect(fit.lo).toBeGreaterThanOrEqual(36);
    expect(fit.hi).toBeLessThanOrEqual(96);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitize } from '../src/app/settings';
import { INSTRUMENT_KINDS, INSTRUMENT_LABELS } from '../src/audio/instrument';

// The settings screen itself needs a browser DOM, which the test setup does not have.
// These tests cover the sound and input settings it reads and writes.

describe('sound and input settings', () => {
  it('defaults to the recorded grand piano, normal touch, MIDI output off and a full keyboard', () => {
    expect(DEFAULT_SETTINGS.instrument).toBe('piano');
    expect(DEFAULT_SETTINGS.velocityCurve).toBe('normal');
    expect(DEFAULT_SETTINGS.fixedVelocity).toBe(false);
    expect(DEFAULT_SETTINGS.midiOutput).toBe('');
    expect(DEFAULT_SETTINGS.midiDisabled).toEqual([]);
    expect([DEFAULT_SETTINGS.keyLow, DEFAULT_SETTINGS.keyHigh]).toEqual([21, 108]);
    expect(DEFAULT_SETTINGS.micEnabled).toBe(false);
  });

  it('keeps valid values and drops broken ones from storage', () => {
    const s = sanitize({
      reverb: 0.5,
      metronomeVolume: 2,
      velocityCurve: 'light',
      fixedVelocity: 'yes',
      midiDisabled: ['Pad', 3],
      midiOutput: 'Light-up keys',
      keyLow: 36,
      keyHigh: 300,
      micSensitivity: 0.8,
      micNoiseFloor: -1,
      instrument: 'synth',
    });
    expect(s.reverb).toBe(0.5);
    expect(s.metronomeVolume).toBe(DEFAULT_SETTINGS.metronomeVolume);
    expect(s.velocityCurve).toBe('light');
    expect(s.fixedVelocity).toBe(false);
    expect(s.midiDisabled).toEqual([]);
    expect(s.midiOutput).toBe('Light-up keys');
    expect(s.keyLow).toBe(36);
    expect(s.keyHigh).toBe(108);
    expect(s.micSensitivity).toBe(0.8);
    expect(s.micNoiseFloor).toBe(0);
    expect(s.instrument).toBe('synth');
    expect(sanitize({ midiDisabled: ['A', 'B'] }).midiDisabled).toEqual(['A', 'B']);
    expect(sanitize({ midiOutput: 'x'.repeat(500) }).midiOutput).toBe('');
  });

  it('has a friendly label for every instrument', () => {
    for (const k of INSTRUMENT_KINDS) expect(INSTRUMENT_LABELS[k].length).toBeGreaterThan(3);
  });
});

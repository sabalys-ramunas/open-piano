import { describe, expect, it } from 'vitest';
import {
  detectKey,
  keyAlters,
  keyName,
  keySignatureSteps,
  midiOf,
  spell,
  spelledName,
  staffStep,
  type Key,
} from '../src/sheet/theory';
import { toMidi } from '../src/song';
import { ELISE, ODE, TWINKLE } from './sheet-helpers';

const notes = (names: string, dur = 0.5) => names.split(' ').map((n) => ({ midi: toMidi(n), dur }));
const C: Key = { fifths: 0, mode: 'major' };
const Am: Key = { fifths: 0, mode: 'minor' };

describe('key detection', () => {
  it('finds C major and A minor for the known tunes', () => {
    expect(detectKey(TWINKLE)).toEqual(C);
    expect(detectKey(ODE)).toEqual(C);
    expect(detectKey(ELISE)).toEqual(Am);
  });

  it('finds sharp and flat keys', () => {
    expect(detectKey(notes('G3 D4 G4 A4 B4 C5 D5 E5 F#5 G5 D4 B3 G3 F#4 G4'))).toMatchObject({ fifths: 1, mode: 'major' });
    expect(detectKey(notes('D3 A3 D4 E4 F#4 G4 A4 B4 C#5 D5 A3 F#3 D3 C#4 D4'))).toMatchObject({ fifths: 2, mode: 'major' });
    expect(detectKey(notes('F3 C4 F4 G4 A4 Bb4 C5 D5 E5 F5 C4 A3 F3 E4 F4'.replace(/Bb/g, 'A#')))).toMatchObject({ fifths: -1, mode: 'major' });
    expect(detectKey(notes('D#3 A#3 D#4 F4 G4 G#4 A#4 C5 D5 D#5 A#3 G3 D#3 D4 D#4'))).toMatchObject({ fifths: -3, mode: 'major' });
  });

  it('uses no sharps or flats when only white keys are played', () => {
    expect(detectKey(notes('G4 A4 B4 D5 G4 D4 G3 B3')).fifths).toBe(0);
  });

  it('copes with no notes', () => {
    expect(detectKey([])).toEqual(C);
  });
});

describe('key signatures', () => {
  it('lists the altered letters', () => {
    // Letters C D E F G A B
    expect(keyAlters(0)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(keyAlters(2)).toEqual([1, 0, 0, 1, 0, 0, 0]);
    expect(keyAlters(-3)).toEqual([0, 0, -1, 0, 0, -1, -1]);
    expect(keyAlters(7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(keyAlters(-7)).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  it('places the signature on the usual lines and spaces', () => {
    // Treble: F#5 on the top line, C#5 in the third space.
    expect(keySignatureSteps(2, 'treble')).toEqual([
      { step: 4, alter: 1 },
      { step: 1, alter: 1 },
    ]);
    // Bass: Bb2 on the second line.
    expect(keySignatureSteps(-1, 'bass')).toEqual([{ step: -2, alter: -1 }]);
  });

  it('names keys', () => {
    expect(keyName(C)).toBe('C major');
    expect(keyName(Am)).toBe('A minor');
    expect(keyName({ fifths: -3, mode: 'major' })).toBe('E♭ major');
    expect(keyName({ fifths: 3, mode: 'minor' })).toBe('F♯ minor');
  });
});

describe('spelling', () => {
  const name = (midi: number, key: Key, next?: number) => {
    const s = spell(midi, key, next);
    return `${spelledName(s)}${s.octave}`;
  };

  it('uses the scale in the key', () => {
    expect(name(66, { fifths: 1, mode: 'major' })).toBe('F♯4');
    expect(name(70, { fifths: -1, mode: 'major' })).toBe('B♭4');
    expect(name(71, { fifths: -6, mode: 'major' })).toBe('C♭5');
    expect(name(65, { fifths: 6, mode: 'major' })).toBe('E♯4');
    expect(name(60, { fifths: 7, mode: 'major' })).toBe('B♯3');
  });

  it('spells notes outside the key sensibly', () => {
    expect(name(66, C)).toBe('F♯4');
    expect(name(70, C)).toBe('B♭4');
    expect(name(63, C)).toBe('E♭4');
    expect(name(61, C)).toBe('C♯4');
    // Raised leading tone and sixth in minor.
    expect(name(68, Am)).toBe('G♯4');
    expect(name(75, Am)).toBe('D♯5');
    // Equal choices follow the melody.
    expect(name(68, C, 69)).toBe('G♯4');
    expect(name(68, C, 67)).toBe('A♭4');
  });

  it('round-trips every pitch in every key', () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (const mode of ['major', 'minor'] as const) {
        for (let midi = 21; midi <= 108; midi++) {
          const s = spell(midi, { fifths, mode });
          expect(midiOf(s)).toBe(midi);
          expect(Math.abs(s.alter)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('staff positions', () => {
  const at = (n: string, clef: 'treble' | 'bass') => staffStep(spell(toMidi(n), C), clef);

  it('puts notes on the right lines', () => {
    expect(at('B4', 'treble')).toBe(0);
    expect(at('G4', 'treble')).toBe(-2);
    expect(at('E4', 'treble')).toBe(-4);
    expect(at('F5', 'treble')).toBe(4);
    expect(at('C4', 'treble')).toBe(-6);
    expect(at('A5', 'treble')).toBe(6);
    expect(at('D3', 'bass')).toBe(0);
    expect(at('F3', 'bass')).toBe(2);
    expect(at('G2', 'bass')).toBe(-4);
    expect(at('C4', 'bass')).toBe(6);
    expect(at('E2', 'bass')).toBe(-6);
  });

  it('uses the letter, not the sound, for sharps and flats', () => {
    expect(staffStep(spell(toMidi('C#4'), C), 'treble')).toBe(-6);
    expect(staffStep(spell(toMidi('C#4'), { fifths: -5, mode: 'major' }), 'treble')).toBe(-5); // D flat
  });
});

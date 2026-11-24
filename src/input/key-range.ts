/** Working out how many keys the player's piano has from the lowest and highest key pressed. */

export interface KeyboardGuess {
  /** Number of keys: 25, 37, 49, 61, 76 or 88 (or the pressed span when nothing standard fits). */
  keys: number;
  /** Lowest and highest MIDI note of that keyboard. */
  low: number;
  high: number;
}

/** Common keyboard sizes and the note each one starts on (as a pitch class: 0 = C, 4 = E, 9 = A). */
const SIZES: readonly { keys: number; startClass: number; usualLow: number }[] = [
  { keys: 25, startClass: 0, usualLow: 48 },
  { keys: 37, startClass: 0, usualLow: 48 },
  { keys: 49, startClass: 0, usualLow: 36 },
  { keys: 61, startClass: 0, usualLow: 36 },
  { keys: 76, startClass: 4, usualLow: 28 },
  { keys: 88, startClass: 9, usualLow: 21 },
];

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * The smallest common keyboard that contains every key pressed, placed the
 * way such keyboards are built (C to C, E to G, A to C). Keyboards with
 * octave buttons are handled because only the pressed notes matter.
 */
export function guessKeyboard(lowest: number, highest: number): KeyboardGuess {
  const lo = Math.max(0, Math.min(127, Math.round(Math.min(lowest, highest))));
  const hi = Math.max(0, Math.min(127, Math.round(Math.max(lowest, highest))));
  for (const size of SIZES) {
    if (hi - lo + 1 > size.keys) continue;
    // Start on the nearest suitable note at or below the lowest key pressed.
    const low = lo - mod(lo - size.startClass, 12);
    const high = low + size.keys - 1;
    if (high >= hi && low >= 0 && high <= 127) {
      // An 88-key piano always spans A0 to C8.
      if (size.keys === 88) return { keys: 88, low: 21, high: 108 };
      return { keys: size.keys, low, high };
    }
  }
  return { keys: hi - lo + 1, low: lo, high: hi };
}

/** Tracks the lowest and highest key seen, for the connection helper. */
export class RangeTracker {
  low = Infinity;
  high = -Infinity;
  count = 0;

  add(midi: number): void {
    if (!Number.isFinite(midi)) return;
    this.low = Math.min(this.low, midi);
    this.high = Math.max(this.high, midi);
    this.count++;
  }

  reset(): void {
    this.low = Infinity;
    this.high = -Infinity;
    this.count = 0;
  }

  /** Null until two different keys have been pressed. */
  guess(): KeyboardGuess | null {
    if (this.count < 2 || this.high <= this.low) return null;
    return guessKeyboard(this.low, this.high);
  }
}

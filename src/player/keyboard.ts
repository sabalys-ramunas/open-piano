import { isBlack } from '../song';

export interface KeyBox {
  x: number;
  w: number;
  black: boolean;
}

/** Lowest and highest key of an 88-key piano. */
export const PIANO_LO = 21;
export const PIANO_HI = 108;

/** Works out where every key sits for a keyboard running from one C up to a B. */
export function layout(lo: number, hi: number, width: number): Map<number, KeyBox> {
  const whites: number[] = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const w = width / whites.length;
  const boxes = new Map<number, KeyBox>();
  whites.forEach((m, i) => boxes.set(m, { x: i * w, w, black: false }));
  for (let m = lo; m <= hi; m++) {
    if (!isBlack(m)) continue;
    const left = boxes.get(m - 1);
    if (left) boxes.set(m, { x: left.x + left.w * 0.68, w: left.w * 0.64, black: true });
  }
  return boxes;
}

/** Picks a keyboard range that fits the notes: whole octaves, at least two of them. */
export function rangeFor(midis: number[]): { lo: number; hi: number } {
  let min = 60;
  let max = 71;
  for (const m of midis) {
    if (m < min) min = m;
    if (m > max) max = m;
  }
  const lo = Math.floor(min / 12) * 12;
  let hi = Math.floor(max / 12) * 12 + 11;
  while (hi - lo < 23) hi += 12;
  return { lo: Math.max(lo, 12), hi: Math.min(hi, 119) };
}

export function whiteCount(lo: number, hi: number): number {
  let n = 0;
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) n++;
  return n;
}

/**
 * A snug keyboard for a song: from a white key a little below the lowest
 * note to a white key a little above the highest, at least `minWhites`
 * white keys wide, never outside `limit` (the connected piano's keys, or 88
 * keys). Unlike rangeFor it does not round to whole octaves, so the keys
 * come out bigger.
 */
export function fitKeys(
  midis: Iterable<number>,
  options: { minWhites?: number; pad?: number; limit?: { lo: number; hi: number } } = {},
): { lo: number; hi: number } {
  const minWhites = options.minWhites ?? 15;
  const pad = options.pad ?? 2;
  const limLo = Math.max(PIANO_LO, Math.min(options.limit?.lo ?? PIANO_LO, PIANO_HI - 12));
  const limHi = Math.min(PIANO_HI, Math.max(options.limit?.hi ?? PIANO_HI, limLo + 12));
  let min = Infinity;
  let max = -Infinity;
  for (const m of midis) {
    if (!Number.isFinite(m)) continue;
    if (m < min) min = m;
    if (m > max) max = m;
  }
  if (min === Infinity) {
    min = 60;
    max = 72;
  }
  let lo = Math.max(limLo, Math.round(min) - pad);
  let hi = Math.min(limHi, Math.round(max) + pad);
  while (isBlack(lo) && lo > limLo) lo--;
  while (isBlack(hi) && hi < limHi) hi++;
  if (isBlack(lo)) lo++;
  if (isBlack(hi)) hi--;
  // Grow evenly on both sides until wide enough.
  let growLow = true;
  while (whiteCount(lo, hi) < minWhites && (lo > limLo || hi < limHi)) {
    if ((growLow && lo > limLo) || hi >= limHi) {
      lo--;
      while (isBlack(lo) && lo > limLo) lo--;
    } else {
      hi++;
      while (isBlack(hi) && hi < limHi) hi++;
    }
    growLow = !growLow;
  }
  return { lo, hi };
}

/**
 * The keys of the player's own piano (settings keyLow/keyHigh), when it is
 * narrower than 88 keys, so the stage never draws keys it does not have.
 * Only while a MIDI piano is connected; undefined means "assume 88 keys".
 */
export function keyLimitFor(s: { keyLow: number; keyHigh: number }, connected: boolean): { lo: number; hi: number } | undefined {
  if (!connected) return undefined;
  const lo = Math.max(PIANO_LO, Math.round(s.keyLow));
  const hi = Math.min(PIANO_HI, Math.round(s.keyHigh));
  if (hi - lo < 24 || (lo <= PIANO_LO && hi >= PIANO_HI)) return undefined;
  return { lo, hi };
}

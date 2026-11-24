/**
 * Music theory for notation: key detection, pitch spelling and staff positions.
 * Pure functions, no DOM.
 */

/** Letter index: 0 = C, 1 = D, ... 6 = B. */
export type Letter = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Spelled {
  letter: Letter;
  /** -2 double flat ... 0 natural ... 2 double sharp. */
  alter: number;
  octave: number;
}

export interface Key {
  /** Sharps (positive) or flats (negative) in the key signature, -7..7. */
  fifths: number;
  mode: 'major' | 'minor';
}

export type Clef = 'treble' | 'bass';

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
/** Pitch class of each natural letter. */
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
/** Position of each natural letter on the line of fifths (C = 0, G = 1, F = -1). */
const LOF = [0, 2, 4, -1, 1, 3, 5];

const mod = (n: number, m: number) => ((n % m) + m) % m;

// Krumhansl-Kessler key profiles, starting at the tonic.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Key signature (fifths) of a major key with this tonic pitch class, preferring fewer accidentals. */
export function majorFifths(tonicPc: number): number {
  const f = mod(tonicPc * 7, 12);
  return f > 6 ? f - 12 : f;
}

/**
 * Guesses the key from the notes, weighting by duration. Songs with no black
 * keys at all get a signature with no sharps or flats.
 */
export function detectKey(notes: readonly { midi: number; dur: number }[]): Key {
  const hist = new Array<number>(12).fill(0);
  let lowest = Infinity;
  for (const n of notes) lowest = Math.min(lowest, n.midi);
  for (const n of notes) {
    const w = Math.max(0.05, Math.min(n.dur, 2));
    // Bass notes say a lot about the key.
    hist[mod(n.midi, 12)] += n.midi < lowest + 12 ? w * 1.3 : w;
  }
  if (!notes.length) return { fifths: 0, mode: 'major' };
  const allWhite = hist.every((w, pc) => w === 0 || NATURAL_PC.includes(pc));

  let best: Key = { fifths: 0, mode: 'major' };
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotated = hist.map((_, i) => hist[mod(i + tonic, 12)]);
      const fifths = majorFifths(mode === 'major' ? tonic : tonic + 3);
      if (allWhite && fifths !== 0) continue;
      // Share of the music that would need accidentals with this signature.
      const alters = keyAlters(fifths);
      const scale = new Set(NATURAL_PC.map((p, l) => mod(p + alters[l], 12)));
      let outside = 0;
      let total = 0;
      hist.forEach((w, p) => {
        total += w;
        if (!scale.has(p)) outside += w;
      });
      // A small nudge towards simpler signatures and towards major.
      const score =
        correlate(rotated, profile) -
        (mode === 'minor' ? 0.25 : 0.4) * (total ? outside / total : 0) -
        0.01 * Math.abs(fifths) -
        (mode === 'minor' ? 0.005 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { fifths, mode };
      }
    }
  }
  return best;
}

/** Alteration the key signature gives each letter (C..B). */
export function keyAlters(fifths: number): number[] {
  const alters = new Array<number>(7).fill(0);
  for (let l = 0; l < 7; l++) {
    const pos = LOF[l];
    // Sharps are added F C G D A E B (positions -1..5), flats B E A D G C F.
    if (fifths > 0 && pos <= fifths - 2) alters[l] = 1;
    if (fifths < 0 && pos >= 6 + fifths) alters[l] = -1;
  }
  return alters;
}

/** Midi number of a spelled pitch. */
export function midiOf(s: Spelled): number {
  return 12 * (s.octave + 1) + NATURAL_PC[s.letter] + s.alter;
}

/** Position on the line of fifths, used to choose between spellings. */
export function lineOfFifths(letter: Letter, alter: number): number {
  return LOF[letter] + 7 * alter;
}

/**
 * Spells a midi note in a key. Notes of the scale use the scale's letters;
 * other notes take the spelling closest to the key on the line of fifths
 * (minor keys lean towards sharps for their raised sixth and seventh). When
 * both are equally close, a note that moves up next is spelled sharp and one
 * that moves down is spelled flat.
 */
export function spell(midi: number, key: Key, next?: number): Spelled {
  const pc = mod(midi, 12);
  const center = key.fifths + 2 + (key.mode === 'minor' ? 1.5 : 0);
  let best: Spelled | null = null;
  let bestScore = Infinity;
  for (let l = 0 as Letter; l < 7; l = (l + 1) as Letter) {
    let alter = pc - NATURAL_PC[l];
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    if (Math.abs(alter) > 1) continue;
    let score = Math.abs(lineOfFifths(l, alter) - center);
    // A white key spelled as Cb, Fb, E# or B# only makes sense in keys with six or more flats or sharps.
    if (alter !== 0 && NATURAL_PC.includes(pc) && Math.abs(key.fifths) < 6) score += 2.5;
    if (next !== undefined && alter !== 0) {
      if (next > midi && alter > 0) score -= 0.25;
      if (next < midi && alter < 0) score -= 0.25;
    }
    if (score < bestScore) {
      bestScore = score;
      const octave = Math.floor((midi - alter - NATURAL_PC[l]) / 12) - 1;
      best = { letter: l, alter, octave };
    }
  }
  return best ?? { letter: 0, alter: 0, octave: 4 };
}

/** Diatonic index: 7 per octave, C0 = 0. */
export function diatonic(s: Pick<Spelled, 'letter' | 'octave'>): number {
  return s.octave * 7 + s.letter;
}

/** Diatonic index of each clef's middle line (B4 for treble, D3 for bass). */
const MIDDLE: Record<Clef, number> = { treble: 4 * 7 + 6, bass: 3 * 7 + 1 };

/**
 * Staff step of a pitch: 0 is the middle line, each step is a line or space,
 * positive goes up. Lines are even steps, -4..4 are inside the staff.
 */
export function staffStep(s: Pick<Spelled, 'letter' | 'octave'>, clef: Clef): number {
  return diatonic(s) - MIDDLE[clef];
}

/** Steps (relative to the middle line) of the key signature accidentals, in drawing order. */
export function keySignatureSteps(fifths: number, clef: Clef): { step: number; alter: number }[] {
  // Treble positions: sharps F5 C5 G5 D5 A4 E5 B4, flats B4 E5 A4 D5 G4 C5 F4.
  const sharps = [4, 1, 5, 2, -1, 3, 0];
  const flats = [0, 3, -1, 2, -2, 1, -3];
  const shift = clef === 'bass' ? -2 : 0;
  const n = Math.min(7, Math.abs(fifths));
  const list = fifths > 0 ? sharps : flats;
  return list.slice(0, n).map((step) => ({ step: step + shift, alter: fifths > 0 ? 1 : -1 }));
}

/** Name of a spelled note for labels, e.g. "C", "F♯", "B♭". */
export function spelledName(s: Pick<Spelled, 'letter' | 'alter'>): string {
  const acc = s.alter === 1 ? '♯' : s.alter === -1 ? '♭' : s.alter === 2 ? '𝄪' : s.alter === -2 ? '𝄫' : '';
  return LETTERS[s.letter] + acc;
}

/** Readable key name, e.g. "G major" or "A minor". */
export function keyName(key: Key): string {
  const tonicMajor = mod(key.fifths * 7, 12);
  const pc = key.mode === 'major' ? tonicMajor : mod(tonicMajor - 3, 12);
  const s = spell(pc + 60, key);
  return `${spelledName(s)} ${key.mode}`;
}

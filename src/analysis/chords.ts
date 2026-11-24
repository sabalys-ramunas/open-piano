// Chord names and the notes in them. Labels are lead-sheet style: "C", "Am",
// "G7", "Cmaj7", "Am7", "Dsus4", "E5" (root and fifth only, used when the third
// was not clear), with an optional bass note after a slash ("G/B").

export interface Key {
  tonic: number;
  minor: boolean;
}

export type Quality = '' | 'm' | '7' | 'maj7' | 'm7' | 'sus4' | 'sus2' | '5' | 'dim' | 'aug' | '6' | 'm6';

/** Intervals above the root, in order of importance for a pianist: root, third, seventh, fifth, the rest. */
const SHAPES: Record<Quality, { third?: number; fifth?: number; seventh?: number; extra?: number }> = {
  '': { third: 4, fifth: 7 },
  m: { third: 3, fifth: 7 },
  '7': { third: 4, fifth: 7, seventh: 10 },
  maj7: { third: 4, fifth: 7, seventh: 11 },
  m7: { third: 3, fifth: 7, seventh: 10 },
  sus4: { fifth: 7, extra: 5 },
  sus2: { fifth: 7, extra: 2 },
  '5': { fifth: 7 },
  dim: { third: 3, fifth: 6 },
  aug: { third: 4, fifth: 8 },
  '6': { third: 4, fifth: 7, extra: 9 },
  m6: { third: 3, fifth: 7, extra: 9 },
};

export interface ChordInfo {
  root: number;
  /** True when the chord has a minor third. */
  minor: boolean;
  quality: Quality;
  /** Pitch classes: root, third, fifth (then seventh or added note). */
  tones: number[];
  /** Pitch class of the lowest note: the root unless written after a slash. */
  bass: number;
  third?: number;
  fifth?: number;
  seventh?: number;
  /** The added note of sus and sixth chords. */
  extra?: number;
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const pcOf = (name: string): number => {
  const base = LETTER[name[0]];
  const acc = name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0;
  return (base + acc + 12) % 12;
};

/** Pitch classes of a chord label such as "Am", "Bb7", "G/B". Undefined for anything else. */
export function chordNotes(label: string): ChordInfo | undefined {
  const m = /^([A-G][#b]?)(maj7|m7|m6|m|7|sus4|sus2|5|dim|aug|6)?(?:\/([A-G][#b]?))?$/.exec(label);
  if (!m) return undefined;
  const root = pcOf(m[1]);
  const quality = (m[2] ?? '') as Quality;
  const s = SHAPES[quality];
  const at = (iv?: number) => (iv === undefined ? undefined : (root + iv) % 12);
  const third = at(s.third);
  const fifth = at(s.fifth);
  const seventh = at(s.seventh);
  const extra = at(s.extra);
  const tones = [root, third, fifth, seventh, extra].filter((x): x is number => x !== undefined);
  return {
    root,
    minor: s.third === 3,
    quality,
    tones,
    bass: m[3] ? pcOf(m[3]) : root,
    third,
    fifth,
    seventh,
    extra,
  };
}

/** Whether a key is written with flats (F, Bb, Eb... and their relative minors). */
export function usesFlats(key: Key | undefined): boolean {
  if (!key) return false;
  const major = key.minor ? (key.tonic + 3) % 12 : key.tonic;
  return [5, 10, 3, 8, 1, 6].includes(major);
}

export function noteLetter(pc: number, key?: Key): string {
  return (usesFlats(key) ? FLATS : SHARPS)[((pc % 12) + 12) % 12];
}

/** A chord label from its parts, spelled to suit the key. */
export function chordLabel(root: number, quality: Quality, bass?: number, key?: Key): string {
  const name = noteLetter(root, key) + quality;
  return bass !== undefined && bass !== root ? `${name}/${noteLetter(bass, key)}` : name;
}

/** Scale pitch classes of a key (natural minor plus the raised seventh for minor keys). */
export function scaleOf(key: Key): number[] {
  const steps = key.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11];
  return steps.map((s) => (key.tonic + s) % 12);
}

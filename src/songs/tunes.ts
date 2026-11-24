import { sortNotes, toMidi, type Difficulty, type Note, type Song, type TimedChord } from '../song';

/**
 * Hand-written arrangements of short traditional tunes. Every tune is written
 * once (melody plus one chord name per bar or half bar) and turned into two
 * lessons: an easy one where the left hand holds one note per chord, and a
 * fuller one where it plays a bass note and the chord.
 *
 * Notation: bars are separated by "|". A note is `pitch/length`, where the
 * length counts beats of the time signature (in 6/8, one eighth note is 1).
 * "_" is a rest and a trailing "~" ties the note to the next one.
 * Chords: one line per bar, separated by "|"; several names in a bar share it
 * equally and "_" means no chord.
 *
 * The melodies are traditional and in the public domain; these arrangements
 * were written for this app and are released under CC0.
 */
export interface Tune {
  /** File name stem: lessons are `tune-<slug>.json` and `tune-<slug>-easy.json`. */
  slug: string;
  title: string;
  by: string;
  tags: string[];
  time: { beats: number; unit: number };
  /** Tempo in beats of the time signature per minute. */
  bpm: number;
  /** Length of the first, incomplete bar, if the tune starts on an upbeat. */
  pickup?: number;
  melody: string;
  chords: string;
  /** Only make the easy lesson (for tunes too short to need two). */
  easyOnly?: boolean;
  /** Difficulty of the easy and the full lesson. Default [1, 2]. */
  levels?: [Difficulty, Difficulty];
}

export const TUNE_LICENCE = 'CC0 1.0 (arrangement); the tune is traditional and in the public domain';
export const TUNE_CREDIT = 'Arranged for this app by the Piano contributors.';

export const TUNES: Tune[] = [
  {
    slug: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    by: 'Traditional',
    tags: ['children'],
    time: { beats: 4, unit: 4 },
    bpm: 96,
    easyOnly: true,
    melody: `E4/1 D4/1 C4/2 | E4/1 D4/1 C4/2 | C4/0.5 C4/0.5 C4/0.5 C4/0.5 D4/0.5 D4/0.5 D4/0.5 D4/0.5 | E4/1 D4/1 C4/2`,
    chords: `C | C | C G | C`,
  },
  {
    slug: 'mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    by: 'Traditional',
    tags: ['children'],
    time: { beats: 4, unit: 4 },
    bpm: 100,
    melody: `E4/1 D4/1 C4/1 D4/1 | E4/1 E4/1 E4/2 | D4/1 D4/1 D4/2 | E4/1 G4/1 G4/2 |
             E4/1 D4/1 C4/1 D4/1 | E4/1 E4/1 E4/1 E4/1 | D4/1 D4/1 E4/1 D4/1 | C4/4`,
    chords: `C | C | G | C | C | C | G | C`,
  },
  {
    slug: 'row-row-row-your-boat',
    title: 'Row, Row, Row Your Boat',
    by: 'Traditional',
    tags: ['children'],
    time: { beats: 6, unit: 8 },
    bpm: 180,
    melody: `C4/3 C4/3 | C4/2 D4/1 E4/3 | E4/2 D4/1 E4/2 F4/1 | G4/6 |
             C5/1 C5/1 C5/1 G4/1 G4/1 G4/1 | E4/1 E4/1 E4/1 C4/1 C4/1 C4/1 | G4/2 F4/1 E4/2 D4/1 | C4/6`,
    chords: `C | C | C | C | C | C | G | C`,
  },
  {
    slug: 'frere-jacques',
    title: 'Frère Jacques',
    by: 'Traditional',
    tags: ['children', 'folk'],
    time: { beats: 4, unit: 4 },
    bpm: 108,
    melody: `G4/1 A4/1 B4/1 G4/1 | G4/1 A4/1 B4/1 G4/1 | B4/1 C5/1 D5/2 | B4/1 C5/1 D5/2 |
             D5/0.5 E5/0.5 D5/0.5 C5/0.5 B4/1 G4/1 | D5/0.5 E5/0.5 D5/0.5 C5/0.5 B4/1 G4/1 | G4/1 D4/1 G4/2 | G4/1 D4/1 G4/2`,
    chords: `G | G | G | G | G | G | G D G | G D G`,
  },
  {
    slug: 'london-bridge',
    title: 'London Bridge Is Falling Down',
    by: 'Traditional',
    tags: ['children'],
    time: { beats: 4, unit: 4 },
    bpm: 108,
    melody: `G4/1.5 A4/0.5 G4/1 F4/1 | E4/1 F4/1 G4/2 | D4/1 E4/1 F4/2 | E4/1 F4/1 G4/2 |
             G4/1.5 A4/0.5 G4/1 F4/1 | E4/1 F4/1 G4/2 | D4/2 G4/2 | E4/1 C4/3`,
    chords: `C | C | G | C | C | C | G | C`,
  },
  {
    slug: 'old-macdonald',
    title: 'Old MacDonald Had a Farm',
    by: 'Traditional',
    tags: ['children'],
    time: { beats: 4, unit: 4 },
    bpm: 112,
    melody: `G4/1 G4/1 G4/1 D4/1 | E4/1 E4/1 D4/2 | B4/1 B4/1 A4/1 A4/1 | G4/3 D4/1 |
             G4/1 G4/1 G4/1 D4/1 | E4/1 E4/1 D4/2 | B4/1 B4/1 A4/1 A4/1 | G4/4`,
    chords: `G | C G | G D | G | G | C G | G D | G`,
  },
  {
    slug: 'yankee-doodle',
    title: 'Yankee Doodle',
    by: 'Traditional',
    tags: ['children', 'folk'],
    time: { beats: 4, unit: 4 },
    bpm: 120,
    melody: `G4/1 G4/1 A4/1 B4/1 | G4/1 B4/1 A4/1 D4/1 | G4/1 G4/1 A4/1 B4/1 | G4/2 F#4/2 |
             G4/1 G4/1 A4/1 B4/1 | C5/1 B4/1 A4/1 G4/1 | F#4/1 D4/1 E4/1 F#4/1 | G4/2 G4/2`,
    chords: `G | G D | G | G D | G | C | D | G`,
  },
  {
    slug: 'au-clair-de-la-lune',
    title: 'Au clair de la lune',
    by: 'Traditional (France)',
    tags: ['children', 'folk'],
    time: { beats: 4, unit: 4 },
    bpm: 96,
    melody: `G4/1 G4/1 G4/1 A4/1 | B4/2 A4/2 | G4/1 B4/1 A4/1 A4/1 | G4/4 |
             G4/1 G4/1 G4/1 A4/1 | B4/2 A4/2 | G4/1 B4/1 A4/1 A4/1 | G4/4 |
             A4/1 A4/1 A4/1 A4/1 | E4/2 E4/2 | A4/1 G4/1 F#4/1 E4/1 | D4/4 |
             G4/1 G4/1 G4/1 A4/1 | B4/2 A4/2 | G4/1 B4/1 A4/1 A4/1 | G4/4`,
    chords: `G | G D | G D | G | G | G D | G D | G | D | Am | D | D | G | G D | G D | G`,
  },
  {
    slug: 'happy-birthday',
    title: 'Happy Birthday to You',
    by: 'Mildred J. Hill and Patty Hill',
    tags: ['children'],
    time: { beats: 3, unit: 4 },
    bpm: 100,
    pickup: 1,
    melody: `G4/0.75 G4/0.25 | A4/1 G4/1 C5/1 | B4/2 G4/0.75 G4/0.25 | A4/1 G4/1 D5/1 | C5/2 G4/0.75 G4/0.25 |
             G5/1 E5/1 C5/1 | B4/1 A4/1 F5/0.75 F5/0.25 | E5/1 C5/1 D5/1 | C5/3`,
    chords: `_ | C | G | G | C | C | F | C G | C`,
  },
  {
    slug: 'jingle-bells',
    title: 'Jingle Bells (chorus)',
    by: 'James Lord Pierpont',
    tags: ['holiday', 'children'],
    time: { beats: 4, unit: 4 },
    bpm: 120,
    melody: `E4/1 E4/1 E4/2 | E4/1 E4/1 E4/2 | E4/1 G4/1 C4/1.5 D4/0.5 | E4/4 |
             F4/1 F4/1 F4/1.5 F4/0.5 | F4/1 E4/1 E4/1 E4/0.5 E4/0.5 | E4/1 D4/1 D4/1 E4/1 | D4/2 G4/2 |
             E4/1 E4/1 E4/2 | E4/1 E4/1 E4/2 | E4/1 G4/1 C4/1.5 D4/0.5 | E4/4 |
             F4/1 F4/1 F4/1 F4/1 | F4/1 E4/1 E4/1 E4/0.5 E4/0.5 | G4/1 G4/1 F4/1 D4/1 | C4/4`,
    chords: `C | C | C | C | F | C | G | G | C | C | C | C | F | C | G | C`,
  },
  {
    slug: 'we-wish-you-a-merry-christmas',
    levels: [2, 2],
    title: 'We Wish You a Merry Christmas',
    by: 'Traditional (England)',
    tags: ['holiday'],
    time: { beats: 3, unit: 4 },
    bpm: 132,
    pickup: 1,
    melody: `D4/1 | G4/1 G4/0.5 A4/0.5 G4/0.5 F#4/0.5 | E4/1 E4/1 E4/1 | A4/1 A4/0.5 B4/0.5 A4/0.5 G4/0.5 | F#4/1 D4/1 D4/1 |
             B4/1 B4/0.5 C5/0.5 B4/0.5 A4/0.5 | G4/1 E4/1 D4/0.5 D4/0.5 | E4/1 A4/1 F#4/1 | G4/2`,
    chords: `_ | G | C | D | D | Em | C | C D | G`,
  },
  {
    slug: 'deck-the-halls',
    levels: [2, 3],
    title: 'Deck the Halls',
    by: 'Traditional (Wales)',
    tags: ['holiday', 'folk'],
    time: { beats: 4, unit: 4 },
    bpm: 112,
    melody: `D5/1.5 C5/0.5 B4/1 A4/1 | G4/1 A4/1 B4/1 G4/1 | A4/0.5 B4/0.5 C5/0.5 A4/0.5 B4/1.5 A4/0.5 | G4/1 F#4/1 G4/2 |
             D5/1.5 C5/0.5 B4/1 A4/1 | G4/1 A4/1 B4/1 G4/1 | A4/0.5 B4/0.5 C5/0.5 A4/0.5 B4/1.5 A4/0.5 | G4/1 F#4/1 G4/2 |
             A4/1.5 B4/0.5 C5/1 A4/1 | B4/1.5 C5/0.5 D5/1 A4/1 | B4/0.5 C#5/0.5 D5/1 E5/0.5 F#5/0.5 G5/1 | F#5/1 E5/1 D5/2 |
             D5/1.5 C5/0.5 B4/1 A4/1 | G4/1 A4/1 B4/1 G4/1 | E5/0.5 E5/0.5 E5/0.5 E5/0.5 D5/1.5 C5/0.5 | B4/1 A4/1 G4/2`,
    chords: `G | G | D G | G D G | G | G | D G | G D G | D | G D | G D | D | G | G | C G | G D G`,
  },
  {
    slug: 'silent-night',
    title: 'Silent Night',
    by: 'Franz Xaver Gruber',
    tags: ['holiday', 'lullaby'],
    time: { beats: 3, unit: 4 },
    bpm: 84,
    melody: `G4/1.5 A4/0.5 G4/1 | E4/3 | G4/1.5 A4/0.5 G4/1 | E4/3 | D5/2 D5/1 | B4/3 | C5/2 C5/1 | G4/3 |
             A4/2 A4/1 | C5/1.5 B4/0.5 A4/1 | G4/1.5 A4/0.5 G4/1 | E4/3 | A4/2 A4/1 | C5/1.5 B4/0.5 A4/1 | G4/1.5 A4/0.5 G4/1 | E4/3 |
             D5/2 D5/1 | F5/1.5 D5/0.5 B4/1 | C5/3 | E5/3 | C5/1.5 G4/0.5 E4/1 | G4/1.5 F4/0.5 D4/1 | C4/3`,
    chords: `C | C | C | C | G | G | C | C | F | F | C | C | F | F | C | C | G | G | C | C | C | G | C`,
  },
  {
    slug: 'amazing-grace',
    levels: [1, 2],
    title: 'Amazing Grace',
    by: 'Traditional (tune "New Britain")',
    tags: ['hymn'],
    time: { beats: 3, unit: 4 },
    bpm: 80,
    pickup: 1,
    melody: `D4/1 | G4/2 B4/0.5 G4/0.5 | B4/2 A4/1 | G4/2 E4/1 | D4/2 D4/1 | G4/2 B4/0.5 G4/0.5 | B4/2 A4/1 | D5/3~ |
             D5/2 B4/1 | D5/2 B4/0.5 G4/0.5 | B4/2 A4/1 | G4/2 E4/1 | D4/2 D4/1 | G4/2 B4/0.5 G4/0.5 | B4/2 A4/1 | G4/3`,
    chords: `_ | G | G | C | G | G | D | D | G | G | G | C | G | G | D | G`,
  },
  {
    slug: 'greensleeves',
    levels: [2, 3],
    title: 'Greensleeves',
    by: 'Traditional (England)',
    tags: ['folk'],
    time: { beats: 3, unit: 4 },
    bpm: 100,
    pickup: 1,
    melody: `A4/1 | C5/2 D5/1 | E5/1.5 F5/0.5 E5/1 | D5/2 B4/1 | G4/1.5 A4/0.5 B4/1 | C5/2 A4/1 | A4/1.5 G#4/0.5 A4/1 | B4/2 G#4/1 | E4/2 A4/1 |
             C5/2 D5/1 | E5/1.5 F5/0.5 E5/1 | D5/2 B4/1 | G4/1.5 A4/0.5 B4/1 | C5/1.5 B4/0.5 A4/1 | G#4/1.5 F#4/0.5 G#4/1 | A4/3 | A4/3 |
             G5/3 | G5/1.5 F#5/0.5 E5/1 | D5/2 B4/1 | G4/1.5 A4/0.5 B4/1 | C5/2 A4/1 | A4/1.5 G#4/0.5 A4/1 | B4/2 G#4/1 | E4/3 |
             G5/3 | G5/1.5 F#5/0.5 E5/1 | D5/2 B4/1 | G4/1.5 A4/0.5 B4/1 | C5/1.5 B4/0.5 A4/1 | G#4/1.5 F#4/0.5 G#4/1 | A4/3 | A4/3`,
    chords: `_ | Am | Am | G | G | Am | E | E | Am |
             Am | Am | G | G | Am | E | Am | Am |
             C | C | G | G | Am | E | E | E |
             C | C | G | G | Am | E | Am | Am`,
  },
];

interface Parsed {
  /** Melody notes with times in beats. */
  notes: { midi: number; start: number; dur: number }[];
  /** Length of every bar in beats. */
  bars: number[];
}

/** Reads a melody line. Throws on anything malformed, so mistakes show up in the tests. */
export function parseMelody(text: string): Parsed {
  const notes: Parsed['notes'] = [];
  const bars: number[] = [];
  let time = 0;
  let tie = false;
  for (const bar of text.split('|')) {
    let length = 0;
    for (const token of bar.trim().split(/\s+/).filter(Boolean)) {
      const m = /^(_|[A-G]#?-?\d)\/(\d+(?:\.\d+)?)(~?)$/.exec(token);
      if (!m) throw new Error(`Bad note "${token}"`);
      const dur = Number(m[2]);
      if (m[1] !== '_') {
        const midi = toMidi(m[1]);
        const last = notes[notes.length - 1];
        if (tie && last && last.midi === midi && Math.abs(last.start + last.dur - time) < 1e-9) last.dur += dur;
        else notes.push({ midi, start: time, dur });
      }
      tie = m[3] === '~';
      time += dur;
      length += dur;
    }
    bars.push(length);
  }
  return { notes, bars };
}

/** Reads the chord line: one entry per bar, each a list of chord names (or null for none). */
export function parseChords(text: string): (string | null)[][] {
  return text.split('|').map((bar) =>
    bar
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => {
        if (c === '_') return null;
        if (!/^[A-G]#?(m|7|m7)?$/.test(c)) throw new Error(`Bad chord "${c}"`);
        return c;
      }),
  );
}

const PC: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

/** Pitch classes of a chord name: root, third, fifth (and seventh). */
export function chordTones(name: string): number[] {
  const m = /^([A-G]#?)(m)?(7)?$/.exec(name);
  if (!m) throw new Error(`Bad chord "${name}"`);
  const root = PC[m[1]];
  const tones = [root, (root + (m[2] ? 3 : 4)) % 12, (root + 7) % 12];
  if (m[3]) tones.push((root + 10) % 12);
  return tones;
}

/** The MIDI note with pitch class `pc` in [lo, lo + 11]. */
const inRange = (pc: number, lo: number) => lo + ((pc - lo) % 12 + 12) % 12;

interface ChordSpan {
  name: string;
  start: number; // beats
  dur: number;
}

function chordSpans(tune: Tune, bars: number[]): ChordSpan[] {
  const chords = parseChords(tune.chords);
  if (chords.length !== bars.length) throw new Error(`${tune.slug}: ${bars.length} bars but ${chords.length} chord bars`);
  const spans: ChordSpan[] = [];
  let time = 0;
  bars.forEach((length, i) => {
    const names = chords[i];
    const each = length / Math.max(1, names.length);
    names.forEach((name, j) => {
      if (name) spans.push({ name, start: time + j * each, dur: each });
    });
    time += length;
  });
  return spans;
}

/** Left-hand notes in beats. Easy: one held note per chord. Full: a low root, then the chord, following the meter. */
function leftHand(tune: Tune, spans: ChordSpan[], easy: boolean): { midi: number; start: number; dur: number }[] {
  const out: { midi: number; start: number; dur: number }[] = [];
  const compound = tune.time.unit === 8 && tune.time.beats % 3 === 0;
  for (const span of spans) {
    const [root, third, fifth] = chordTones(span.name);
    if (easy) {
      out.push({ midi: inRange(root, 48), start: span.start, dur: span.dur });
      continue;
    }
    const low = inRange(root, 36);
    const lowFifth = inRange(fifth, low + 1);
    const block = [root, third, fifth].map((pc) => inRange(pc, 48));
    const pushChord = (start: number, dur: number) => block.forEach((midi) => out.push({ midi, start, dur }));
    if (compound) {
      // 6/8: bass on each dotted beat, chord on the last eighth of each group.
      for (let t = 0; t + 3 <= span.dur + 1e-9; t += 3) {
        out.push({ midi: t === 0 ? low : lowFifth, start: span.start + t, dur: 2 });
        pushChord(span.start + t + 2, 1);
      }
      continue;
    }
    if (span.dur < 2) {
      out.push({ midi: low, start: span.start, dur: span.dur });
      continue;
    }
    // Simple meters: bass on the first beat, chord on the others, the fifth on beat three of four.
    for (let t = 0; t + 1 <= span.dur + 1e-9; t += 1) {
      if (t === 0) out.push({ midi: low, start: span.start, dur: 1 });
      else if (t === 2 && span.dur >= 4) out.push({ midi: lowFifth, start: span.start + t, dur: 1 });
      else pushChord(span.start + t, 1);
    }
  }
  return out;
}

/** Checks a tune's bar lengths: every bar is full except an upbeat at the start and the bar that completes it at the end. */
export function checkBars(tune: Tune, bars: number[]): void {
  const full = tune.time.beats;
  bars.forEach((length, i) => {
    const first = i === 0 && tune.pickup !== undefined;
    const last = i === bars.length - 1;
    if (first && Math.abs(length - tune.pickup!) > 1e-9) throw new Error(`${tune.slug}: upbeat is ${length}, expected ${tune.pickup}`);
    if (!first && !last && Math.abs(length - full) > 1e-9) throw new Error(`${tune.slug}: bar ${i + 1} has ${length} beats, expected ${full}`);
    if (last && (length > full + 1e-9 || length <= 0)) throw new Error(`${tune.slug}: last bar has ${length} beats`);
  });
}

/** Builds the lessons for one tune: the easy one first, then the fuller one (unless `easyOnly`). */
export function arrangeTune(tune: Tune): { file: string; song: Song }[] {
  const { notes, bars } = parseMelody(tune.melody);
  checkBars(tune, bars);
  const spans = chordSpans(tune, bars);
  const sec = 60 / tune.bpm;
  const total = bars.reduce((a, b) => a + b, 0);
  const beats: number[] = [];
  for (let b = 0; b <= total + 1e-9; b++) beats.push(Math.round(b * sec * 1000) / 1000);
  const chords: TimedChord[] = spans.map((s) => ({ start: round(s.start * sec), dur: round(s.dur * sec), label: s.name }));
  const toNotes = (list: { midi: number; start: number; dur: number }[], hand: Note['hand']): Note[] =>
    list.map((n) => ({ midi: n.midi, start: round(n.start * sec), dur: round(n.dur * sec * 0.92), hand }));

  const make = (easy: boolean, difficulty: Difficulty): Song => ({
    id: `pack:tune-${tune.slug}${easy && !tune.easyOnly ? '-easy' : ''}`,
    title: easy && !tune.easyOnly ? `${tune.title} (easy)` : tune.title,
    by: tune.by,
    notes: sortNotes([...toNotes(notes, 'right'), ...toNotes(leftHand(tune, spans, easy), 'left')]),
    source: 'built-in',
    difficulty,
    bpm: tune.bpm,
    beats,
    timeSignature: { ...tune.time },
    chords,
    tags: [...tune.tags, ...(easy && !tune.easyOnly ? ['easy version'] : [])],
    licence: TUNE_LICENCE,
    credit: TUNE_CREDIT,
  });

  const [easyLevel, fullLevel] = tune.levels ?? [1, 2];
  const out = [{ file: `tune-${tune.slug}${tune.easyOnly ? '' : '-easy'}.json`, song: make(true, easyLevel) }];
  if (!tune.easyOnly) out.push({ file: `tune-${tune.slug}.json`, song: make(false, fullLevel) });
  return out;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

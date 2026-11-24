import type { Hands } from '../player/game';
import { toMidi } from '../song';
import { keys, line, phrase } from './music';
import type { Course, Finger, HandPicture, Lesson, LessonStep, Loudness, Phrase, Pictures, RhythmPicture, StaffPicture, Unit } from './types';

export type { Course, CourseNote, Finger, HandPicture, KeyMark, KeyPicture, Lesson, LessonStep, Phrase, RhythmPicture, StaffPicture, StepKind, Unit } from './types';

// ---------------------------------------------------------------------------
// Step builders. They keep the lesson text below easy to read.
// ---------------------------------------------------------------------------

const explain = (title: string, text: string, pics: Pictures = {}): LessonStep => ({ kind: 'explain', title, text, ...pics });

function find(
  title: string,
  text: string,
  targets: string,
  options: { lo?: string; hi?: string; anyOctave?: boolean; distinct?: boolean; hintAfter?: number; finger?: Finger; hand?: 'right' | 'left' } = {},
): LessonStep {
  const step: Extract<LessonStep, { kind: 'find' }> = {
    kind: 'find',
    title,
    text,
    targets: targets.trim().split(/\s+/).map(toMidi),
    lo: toMidi(options.lo ?? 'C3'),
    hi: toMidi(options.hi ?? 'B4'),
  };
  if (options.anyOctave) step.anyOctave = true;
  if (options.distinct) step.distinct = true;
  if (options.hintAfter !== undefined) step.hintAfter = options.hintAfter;
  if (options.finger) step.finger = options.finger;
  if (options.hand) step.hand = options.hand;
  return step;
}

const quiz = (title: string, question: string, choices: string[], answer: number, why: string, pics: Pictures = {}): LessonStep => ({
  kind: 'quiz',
  title,
  question,
  choices,
  answer,
  why,
  ...pics,
});

const staff = (clef: 'treble' | 'bass', notes: string, names = false): StaffPicture => {
  const pic: StaffPicture = { clef, notes: notes.trim().split(/\s+/).map(toMidi) };
  if (names) pic.names = true;
  return pic;
};

/** A hand picture; `fingers` picks the ones drawn brightly. */
const hand = (side: 'right' | 'left', fingers?: Finger[]): HandPicture => (fingers ? { side, fingers } : { side });

/** A rhythm picture: "1 1 r1 1" is two beats, a one-beat rest, one beat. */
const rhythm = (text: string): RhythmPicture => ({
  notes: text
    .trim()
    .split(/\s+/)
    .map((t) => (t.startsWith('r') ? { beats: Number(t.slice(1)), rest: true } : { beats: Number(t) })),
});

type View = { view?: 'falling' | 'sheet' };

const listen = (title: string, text: string, music: Phrase, extra: View = {}): LessonStep => ({ kind: 'listen', title, text, music, hands: 'both', ...extra });

const learn = (title: string, text: string, music: Phrase, hands: Hands = 'right', extra: View & { hintAfter?: number } = {}): LessonStep => ({
  kind: 'phrase',
  title,
  text,
  music,
  hands,
  ...extra,
});

const timed = (title: string, text: string, music: Phrase, hands: Hands = 'right', pass = 0.6, extra: View = {}): LessonStep => ({
  kind: 'timed',
  title,
  text,
  music,
  hands,
  pass,
  ...extra,
});

const perform = (title: string, text: string, music: Phrase, hands: Hands = 'right', pass = 0.6, extra: View = {}): LessonStep => ({
  kind: 'perform',
  title,
  text,
  music,
  hands,
  pass,
  ...extra,
});

const touch = (title: string, text: string, prompts: Loudness[]): LessonStep => ({ kind: 'touch', title, text, prompts });

const R = (text: string, start = 0) => line('right', text, start);
const L = (text: string, start = 0) => line('left', text, start);

// Left-hand chord shapes used in the course, all between C3 and B3 so they fit
// under the right hand and on the computer keyboard.
const CH = {
  C: 'C3+E3+G3',
  F: 'C3+F3+A3',
  G: 'D3+G3+B3',
  Am: 'C3+E3+A3',
} as const;
const CF = { C: '5+3+1', F: '5+2+1', G: '5+2+1', Am: '5+3+1' } as const;
/** A left-hand chord for `beats` beats, with fingers. */
const chord = (name: keyof typeof CH, beats: number) => `${CH[name]}/${beats}@${CF[name]}`;

// ---------------------------------------------------------------------------
// Tunes. Traditional tunes and composers long out of copyright, plus a few
// short pieces written for this course. Fingerings are for the hand shown.
// ---------------------------------------------------------------------------

const HOT_CROSS_BUNS = 'E4/1@3 D4/1@2 C4/2@1 | E4/1@3 D4/1@2 C4/2@1 | C4/0.5@1 C4/0.5@1 C4/0.5@1 C4/0.5@1 D4/0.5@2 D4/0.5@2 D4/0.5@2 D4/0.5@2 | E4/1@3 D4/1@2 C4/2@1';
const HOT_CROSS_BUNS_LH = 'E3/1@3 D3/1@4 C3/2@5 | E3/1@3 D3/1@4 C3/2@5 | C3/0.5@5 C3/0.5@5 C3/0.5@5 C3/0.5@5 D3/0.5@4 D3/0.5@4 D3/0.5@4 D3/0.5@4 | E3/1@3 D3/1@4 C3/2@5';

const MARY_A = 'E4/1@3 D4/1@2 C4/1@1 D4/1@2 | E4/1@3 E4/1@3 E4/2@3 | D4/1@2 D4/1@2 D4/2@2 | E4/1@3 G4/1@5 G4/2@5';
const MARY_B = 'E4/1@3 D4/1@2 C4/1@1 D4/1@2 | E4/1@3 E4/1@3 E4/1@3 E4/1@3 | D4/1@2 D4/1@2 E4/1@3 D4/1@2 | C4/4@1';
const MARY_A_LH = 'E3/1@3 D3/1@4 C3/1@5 D3/1@4 | E3/1@3 E3/1@3 E3/2@3 | D3/1@4 D3/1@4 D3/2@4 | E3/1@3 G3/1@1 G3/2@1';
const MARY_BAND = (() => {
  const c = `${CH.C}/2 ${CH.C}/2`;
  const g = `${CH.G}/2 ${CH.G}/2`;
  return [c, c, g, c, c, c, g, `${CH.C}/4`].join(' | ');
})();

const JINGLE_A = 'E4/1@3 E4/1@3 E4/2@3 | E4/1@3 E4/1@3 E4/2@3 | E4/1@3 G4/1@5 C4/1@1 D4/1@2 | E4/4@3 | F4/1@4 F4/1@4 F4/1@4 F4/1@4 | F4/1@4 E4/1@3 E4/1@3 E4/0.5@3 E4/0.5@3 | E4/1@3 D4/1@2 D4/1@2 E4/1@3 | D4/2@2 G4/2@5';
const JINGLE_B = 'E4/1@3 E4/1@3 E4/2@3 | E4/1@3 E4/1@3 E4/2@3 | E4/1@3 G4/1@5 C4/1@1 D4/1@2 | E4/4@3 | F4/1@4 F4/1@4 F4/1@4 F4/1@4 | F4/1@4 E4/1@3 E4/1@3 E4/0.5@3 E4/0.5@3 | G4/1@5 G4/1@5 F4/1@4 D4/1@2 | C4/4@1';

const LIGHTLY_A = 'G3/1@1 E3/1@3 E3/2@3 | F3/1@2 D3/1@4 D3/2@4 | C3/1@5 D3/1@4 E3/1@3 F3/1@2 | G3/1@1 G3/1@1 G3/2@1';
const LIGHTLY_END = 'G3/1@1 E3/1@3 E3/2@3 | F3/1@2 D3/1@4 D3/2@4 | C3/1@5 E3/1@3 G3/1@1 G3/1@1 | C3/4@5';
const LIGHTLY_MID = 'D3/1@4 D3/1@4 D3/1@4 D3/1@4 | D3/1@4 E3/1@3 F3/2@2 | E3/1@3 E3/1@3 E3/1@3 E3/1@3 | E3/1@3 F3/1@2 G3/2@1';

const ODE_A = 'E4/1@3 E4/1@3 F4/1@4 G4/1@5 | G4/1@5 F4/1@4 E4/1@3 D4/1@2 | C4/1@1 C4/1@1 D4/1@2 E4/1@3 | E4/1.5@3 D4/0.5@2 D4/2@2';
const ODE_B = 'E4/1@3 E4/1@3 F4/1@4 G4/1@5 | G4/1@5 F4/1@4 E4/1@3 D4/1@2 | C4/1@1 C4/1@1 D4/1@2 E4/1@3 | D4/1.5@2 C4/0.5@1 C4/2@1';
const ODE_LH = 'C3/4@5 | G3/4@1 | C3/4@5 | G3/4@1 | C3/4@5 | G3/4@1 | C3/4@5 | G3/2@1 C3/2@5';
const ODE_IN_G = 'B4/1@3 B4/1@3 C5/1@4 D5/1@5 | D5/1@5 C5/1@4 B4/1@3 A4/1@2 | G4/1@1 G4/1@1 A4/1@2 B4/1@3 | B4/1.5@3 A4/0.5@2 A4/2@2';

const TWINKLE_A = 'C4/1@1 C4/1@1 G4/1@5 G4/1@5 | A4/1@5 A4/1@5 G4/2@5 | F4/1@4 F4/1@4 E4/1@3 E4/1@3 | D4/1@2 D4/1@2 C4/2@1';
const TWINKLE_B = 'G4/1@5 G4/1@5 F4/1@4 F4/1@4 | E4/1@3 E4/1@3 D4/2@2 | G4/1@5 G4/1@5 F4/1@4 F4/1@4 | E4/1@3 E4/1@3 D4/2@2';
const TWINKLE_A_LH = 'C3/4@5 | F3/2@2 C3/2@5 | F3/2@2 C3/2@5 | G3/2@1 C3/2@5';
const TWINKLE_B_LH = 'C3/2@5 F3/2@2 | C3/2@5 G3/2@1 | C3/2@5 F3/2@2 | C3/2@5 G3/2@1';

const SAINTS =
  '_/1 C4/1@1 E4/1@3 F4/1@4 | G4/4@5 | _/1 C4/1@1 E4/1@3 F4/1@4 | G4/4@5 | _/1 C4/1@1 E4/1@3 F4/1@4 | G4/2@5 E4/2@3 | C4/2@1 E4/2@3 | D4/4@2 | ' +
  '_/1 E4/1@3 E4/1@3 D4/1@2 | C4/3@1 C4/1@1 | E4/2@3 G4/2@5 | G4/1@5 F4/3@4 | _/2 E4/1@3 F4/1@4 | G4/2@5 E4/2@3 | C4/2@1 D4/2@2 | C4/4@1';
const SAINTS_LH = [
  '_/4',
  chord('C', 4), chord('C', 4), chord('C', 4), chord('C', 4), chord('C', 4), chord('C', 4),
  chord('G', 4),
  chord('C', 4), chord('C', 4), chord('C', 4),
  chord('F', 4),
  chord('C', 4), chord('C', 4),
  `${chord('C', 2)} ${chord('G', 2)}`,
  chord('C', 4),
].join(' | ');
const SAINTS_CHORDS = '_/4 C/4 C/4 C/4 C/4 C/4 C/4 G/4 C/4 C/4 C/4 F/4 C/4 C/4 C/2 G/2 C/4';

/** Written for this course: a gentle tune over C, A minor, F and G. */
const EVENING_RH = 'G4/2@5 E4/2@3 | E4/2@3 C4/2@1 | F4/2@4 A4/2@5 | G4/2@5 D4/2@2 | E4/1@3 F4/1@4 G4/2@5 | E4/1@3 D4/1@2 C4/2@1 | C4/2@1 D4/2@2 | C4/4@1';
const EVENING_LH = [chord('C', 4), chord('Am', 4), chord('F', 4), chord('G', 4), chord('C', 4), chord('Am', 4), `${chord('F', 2)} ${chord('G', 2)}`, chord('C', 4)].join(' | ');
const EVENING_CHORDS = 'C/4 Am/4 F/4 G/4 C/4 Am/4 F/2 G/2 C/4';

const AU_CLAIR_RH = 'C4/1@1 C4/1@1 C4/1@1 D4/1@2 | E4/2@3 D4/2@2 | C4/1@1 E4/1@3 D4/1@2 D4/1@2 | C4/4@1';
const AU_CLAIR_LH = 'C3/4@5 | C3/2@5 G3/2@1 | C3/2@5 G3/2@1 | C3/4@5';

const FRERE =
  'C4/1@1 D4/1@2 E4/1@3 C4/1@1 | C4/1@1 D4/1@2 E4/1@3 C4/1@1 | E4/1@3 F4/1@4 G4/2@5 | E4/1@3 F4/1@4 G4/2@5 | ' +
  'G4/0.5@4 A4/0.5@5 G4/0.5@4 F4/0.5@3 E4/1@2 C4/1@1 | G4/0.5@4 A4/0.5@5 G4/0.5@4 F4/0.5@3 E4/1@2 C4/1@1 | C4/1@4 G3/1@1 C4/2@4 | C4/1@4 G3/1@1 C4/2@4';
/** The band's voice of the round: the same tune an octave lower, two bars later. */
const FRERE_BAND =
  'C3/1 D3/1 E3/1 C3/1 | C3/1 D3/1 E3/1 C3/1 | E3/1 F3/1 G3/2 | E3/1 F3/1 G3/2 | ' +
  'G3/0.5 A3/0.5 G3/0.5 F3/0.5 E3/1 C3/1 | G3/0.5 A3/0.5 G3/0.5 F3/0.5 E3/1 C3/1 | C3/1 G2/1 C3/2 | C3/1 G2/1 C3/2';

const FIVE_UP = 'C4/1@1 D4/1@2 E4/1@3 F4/1@4 G4/2@5';
const FIVE_DOWN = 'G4/1@5 F4/1@4 E4/1@3 D4/1@2 C4/2@1';

// ---------------------------------------------------------------------------
// The course
// ---------------------------------------------------------------------------

const unit1: Unit = {
  id: 'u1-keyboard',
  title: 'Meet the keyboard',
  blurb: 'Find your way around the keys.',
  lessons: [
    {
      id: 'find-c',
      title: 'Find C',
      summary: 'Use the black keys to find C.',
      steps: [
        explain('Black keys in groups', 'The black keys come in twos and threes. They are your map of the piano!', { keys: keys('C4', 'B5', '', { groups: true }) }),
        explain('Meet C', 'C is the white key just left of two black keys. The piano has lots of Cs!', { keys: keys('C3', 'B4', 'C3=C C4=C', { groups: true }) }),
        find('Find middle C', 'It is the C in the middle of the piano.', 'C4'),
        find('Find three Cs', 'Press three different Cs, anywhere.', 'C3 C4 C5', { lo: 'C3', hi: 'B5', anyOctave: true, distinct: true }),
        quiz('Name that key', 'What is this key called?', ['C', 'D', 'F'], 0, 'C always sits just left of two black keys.', {
          keys: keys('C4', 'B4', 'C4=?', { groups: true }),
        }),
        learn('Play C', 'Press middle C for each note. The music waits for you.', phrase({ bpm: 80 }, R('C4/1@1 C4/1@1 C4/1@1 C4/1@1')), 'right', { hintAfter: 0 }),
      ],
    },
    {
      id: 'keys-de',
      title: 'D and E',
      summary: 'Meet the neighbours of C.',
      steps: [
        explain('D in the middle', 'D sits between the two black keys. It is right next to C.', { keys: keys('C4', 'B4', 'C4=C D4=D', { groups: true }) }),
        find('Find D', 'Find the D next to middle C.', 'D4'),
        explain('Then comes E', 'E is just right of the two black keys. C, D, E!', {
          keys: keys('C4', 'B4', 'C4=C D4=D E4=E', { groups: true }),
        }),
        find('Find E', 'Find the E next to middle C.', 'E4'),
        quiz('The middle one', 'Which key is between two black keys?', ['C', 'D', 'E'], 1, 'D is in the middle, like the filling in a sandwich.', {
          keys: keys('C4', 'B4', 'D4=?', { groups: true }),
        }),
        learn('Walk up and back', 'Play C, D, E and back down. Use fingers 1, 2 and 3.', phrase({ bpm: 80 }, R('C4/1@1 D4/1@2 E4/1@3 D4/1@2 C4/2@1')), 'right', { hintAfter: 0 }),
      ],
    },
    {
      id: 'keys-fgab',
      title: 'F, G, A, B',
      summary: 'Learn the rest of the white keys.',
      steps: [
        explain('Just seven letters', 'Keys use seven letters, from A to G. After G, the letters start again at A.', {
          keys: keys('C4', 'B4', '', { names: true }),
        }),
        explain('F starts the three', 'F is just left of the three black keys. Then come G, A and B.', {
          keys: keys('C4', 'B4', 'F4=F G4=G A4=A B4=B', { groups: true }),
        }),
        find('Find F', 'Find the F above middle C.', 'F4'),
        find('Find G', 'G is right next to F.', 'G4'),
        find('Find A, then B', 'Keep going up: A, then B.', 'A4 B4'),
        quiz('After G', 'What comes after G?', ['H', 'A', 'F'], 1, 'There is no H on the piano. After G comes A again.'),
        learn('All the way up', 'Play every white key from C up to C. Any finger is fine.', phrase({ bpm: 90 }, R('C4/1 D4/1 E4/1 F4/1 G4/1 A4/1 B4/1 C5/2')), 'right', { hintAfter: 0 }),
      ],
    },
    {
      id: 'high-low',
      title: 'High and low',
      summary: 'Hear the keys climb from low to high.',
      steps: [
        explain('Low left, high right', 'Keys on the left sound low, like a bear. Keys on the right sound high, like a bird.', {
          keys: keys('C3', 'B5', 'C3=low C4=middle C5=high'),
        }),
        listen('Listen to three Cs', 'Low, middle, then high.', phrase({ bpm: 80 }, R('C3/2 C4/2 C5/2'))),
        find('Find a low C', 'Find the C on the left side.', 'C3', { lo: 'C3', hi: 'B5' }),
        find('Find a high C', 'Now find the C on the right side.', 'C5', { lo: 'C3', hi: 'B5' }),
        quiz('Which is higher?', 'Which way sounds higher?', ['Further left', 'Further right'], 1, 'Going to the right always goes higher.'),
        learn('Low, middle, high', 'Play the three Cs going up, then back down.', phrase({ bpm: 80 }, R('C3/1 C4/1 C5/2 | C4/1 C3/1 _/2')), 'right', { hintAfter: 0 }),
      ],
    },
    {
      id: 'piece-hot-cross-buns',
      title: 'Hot Cross Buns',
      summary: 'Your first real piece, with three keys.',
      piece: { title: 'Hot Cross Buns', by: 'Traditional' },
      steps: [
        explain('Your first piece', 'This song uses just E, D and C. Rest fingers 1, 2 and 3 on C, D and E.', {
          keys: keys('C4', 'B4', 'C4@1 D4@2 E4@3'),
        }),
        listen('Listen first', 'Listen and watch the notes fall.', phrase({ bpm: 84 }, R(HOT_CROSS_BUNS))),
        learn('Learn it', 'The music waits for each key. The quick notes are just faster Cs and Ds.', phrase({ bpm: 84 }, R(HOT_CROSS_BUNS)), 'right', { hintAfter: 0 }),
        perform('Play it in time', 'Now the music keeps going. Wait for the count, then play along!', phrase({ bpm: 76 }, R(HOT_CROSS_BUNS)), 'right', 0.55),
      ],
    },
  ],
};

const unit2: Unit = {
  id: 'u2-right-hand',
  title: 'Your right hand',
  blurb: 'Give each finger a home.',
  lessons: [
    {
      id: 'rh-fingers',
      title: 'Finger numbers',
      summary: 'Every finger gets a number.',
      steps: [
        explain('Fingers have numbers', 'Your thumb is 1 and your little finger is 5. Both hands use the same numbers.', {
          hand: hand('right'),
          keys: keys('C4', 'B4', 'C4@1 D4@2 E4@3 F4@4 G4@5'),
        }),
        quiz('Finger 3', 'Which finger is number 3?', ['Thumb', 'Middle finger', 'Little finger'], 1, 'Count from the thumb: 1, 2, 3. It is the middle one.'),
        quiz('Your thumb', 'What number is your thumb?', ['1', '3', '5'], 0, 'Thumbs are always 1, on both hands.'),
        explain('Round fingers', 'Curve your fingers, like you hold a small ball. Play on your fingertips, with a soft wrist.', { hand: hand('right') }),
        find('Thumb on C', 'Press middle C with your right thumb.', 'C4', { finger: 1, hand: 'right' }),
        find('Little finger on G', 'Keep your thumb near C. Press G with finger 5.', 'G4', { finger: 5, hand: 'right' }),
      ],
    },
    {
      id: 'rh-position',
      title: 'Home position',
      summary: 'Five fingers on five keys.',
      steps: [
        explain('Five fingers, five keys', 'Thumb on C, then one finger on each key up to G. This is C position, your home!', {
          keys: keys('C4', 'B4', 'C4@1 D4@2 E4@3 F4@4 G4@5'),
        }),
        learn('Climb up', 'Play C, D, E, F, G with fingers 1 to 5.', phrase({ bpm: 80 }, R(FIVE_UP)), 'right', { hintAfter: 0 }),
        learn('Climb down', 'Now come back down, from G to C.', phrase({ bpm: 80 }, R(FIVE_DOWN)), 'right', { hintAfter: 0 }),
        quiz('Finger for F', 'Which finger plays F?', ['2', '4', '5'], 1, 'C, D, E, F: count 1, 2, 3, 4. F is finger 4.', { keys: keys('C4', 'B4', 'C4@1 F4=?') }),
        learn('Up and down', 'All the way up and back. Try not to stop!', phrase({ bpm: 84 }, R('C4/1@1 D4/1@2 E4/1@3 F4/1@4 | G4/1@5 F4/1@4 E4/1@3 D4/1@2 | C4/4@1')), 'right', { hintAfter: 2 }),
      ],
    },
    {
      id: 'rh-steps',
      title: 'Little steps',
      summary: 'Move to the very next key.',
      steps: [
        explain('What is a step?', 'Going to the very next white key is a step. In C position, it is just the next finger.', { keys: keys('C4', 'B4', 'C4@1 D4@2') }),
        listen('A stepping tune', 'This tune only uses steps.', phrase({ bpm: 84 }, R('C4/1@1 D4/1@2 E4/1@3 C4/1@1 | E4/1@3 F4/1@4 G4/2@5 | G4/1@5 F4/1@4 E4/1@3 D4/1@2 | C4/4@1'))),
        learn('Learn it', 'Your turn. The music waits for you.', phrase({ bpm: 84 }, R('C4/1@1 D4/1@2 E4/1@3 C4/1@1 | E4/1@3 F4/1@4 G4/2@5 | G4/1@5 F4/1@4 E4/1@3 D4/1@2 | C4/4@1'))),
        timed('Play it in time', 'Now the music keeps moving. Listen for the count.', phrase({ bpm: 72 }, R('C4/1@1 D4/1@2 E4/1@3 C4/1@1 | E4/1@3 F4/1@4 G4/2@5 | G4/1@5 F4/1@4 E4/1@3 D4/1@2 | C4/4@1'))),
      ],
    },
    {
      id: 'rh-skips',
      title: 'Hop and skip',
      summary: 'Hop over a key.',
      steps: [
        explain('Skip a key', 'A skip hops over one white key, like C to E. Fingers 1 and 3 play it without moving.', {
          keys: keys('C4', 'B4', 'C4@1 E4@3 G4@5'),
        }),
        find('Skip, skip', 'Play C, then E, then G.', 'C4 E4 G4', { hintAfter: 1 }),
        learn('Skip and step', 'A tune with skips and steps.', phrase({ bpm: 80 }, R('C4/1@1 E4/1@3 G4/2@5 | G4/1@5 E4/1@3 C4/2@1 | D4/1@2 F4/1@4 E4/1@3 D4/1@2 | C4/4@1'))),
        quiz('Step or skip?', 'D up to F: a step or a skip?', ['A step', 'A skip'], 1, 'D to F hops over E, so it is a skip.', { keys: keys('C4', 'B4', 'D4@2 F4@4') }),
        timed('Play it in time', 'Keep your fingers on their keys.', phrase({ bpm: 72 }, R('C4/1@1 E4/1@3 G4/2@5 | G4/1@5 E4/1@3 C4/2@1 | D4/1@2 F4/1@4 E4/1@3 D4/1@2 | C4/4@1'))),
      ],
    },
    {
      id: 'piece-mary',
      title: 'Mary Had a Little Lamb',
      summary: 'A whole song in C position.',
      piece: { title: 'Mary Had a Little Lamb', by: 'Traditional' },
      steps: [
        explain('Get ready', 'This song stays in C position. Finger 5 has one special job: G.', { keys: keys('C4', 'B4', 'C4@1 D4@2 E4@3 G4@5') }),
        listen('Listen first', 'Here is how it goes.', phrase({ bpm: 92 }, R(MARY_A), R(MARY_B, 16))),
        learn('First half', 'Learn the first four bars.', phrase({ bpm: 92 }, R(MARY_A))),
        learn('Second half', 'It starts the same, then goes home to C.', phrase({ bpm: 92 }, R(MARY_B))),
        perform('The whole song', 'Both halves, in time. Enjoy it!', phrase({ bpm: 84 }, R(MARY_A), R(MARY_B, 16))),
      ],
    },
  ],
};

const unit3: Unit = {
  id: 'u3-rhythm',
  title: 'Rhythm and counting',
  blurb: 'Feel the beat. Long notes, short notes, rests.',
  lessons: [
    {
      id: 'rhythm-beat',
      title: 'The steady beat',
      summary: 'Every song has a heartbeat.',
      steps: [
        explain('Music has a heartbeat', 'Every song has a steady beat, like a clock. We count it 1, 2, 3, 4, and each group is a bar.', { rhythm: rhythm('1 1 1 1') }),
        listen('Hear the beat', 'Count along out loud: 1, 2, 3, 4.', phrase({ bpm: 90 }, R('C4/1 C4/1 C4/1 C4/1 | C4/1 C4/1 C4/1 C4/1'))),
        explain('One beat notes', 'A note that lasts one beat is a quarter note. You have played lots already!', { rhythm: rhythm('1 1 1 1') }),
        timed('On the beat', 'Play on every beat: four Cs, then four Es.', phrase({ bpm: 80 }, R('C4/1@1 C4/1@1 C4/1@1 C4/1@1 | E4/1@3 E4/1@3 E4/1@3 E4/1@3'))),
        timed('Steady steps', 'Keep it steady, like walking.', phrase({ bpm: 80 }, R('C4/1@1 D4/1@2 E4/1@3 F4/1@4 | G4/1@5 F4/1@4 E4/1@3 D4/1@2 | C4/1@1 E4/1@3 D4/1@2 C4/1@1'))),
      ],
    },
    {
      id: 'rhythm-long',
      title: 'Long notes',
      summary: 'Hold notes for two or four beats.',
      steps: [
        explain('Two beat notes', 'A half note lasts two beats. Press it on 1 and hold it through 2.', { rhythm: rhythm('2 2') }),
        explain('Four beat notes', 'A whole note lasts four beats. Hold it down and let it ring.', { rhythm: rhythm('4') }),
        listen('Long and short', 'Listen for the notes that ring longer.', phrase({ bpm: 84 }, R('C4/1@1 D4/1@2 E4/2@3 | F4/2@4 E4/2@3 | D4/1@2 E4/1@3 D4/2@2 | C4/4@1'))),
        timed('Hold them', 'Hold each long note until the next one.', phrase({ bpm: 80 }, R('C4/1@1 D4/1@2 E4/2@3 | F4/2@4 E4/2@3 | D4/1@2 E4/1@3 D4/2@2 | C4/4@1'))),
        quiz('How long?', 'How many beats is a whole note?', ['1', '2', '4'], 2, 'A whole note fills a whole bar of four beats.'),
      ],
    },
    {
      id: 'rhythm-rests',
      title: 'Quiet rests',
      summary: 'Quiet beats are music too.',
      steps: [
        explain('Quiet beats', 'A rest is a beat with no note. Keep counting in your head.', { rhythm: rhythm('1 r1 1 r1') }),
        listen('Hear the gaps', 'Listen for the little silences.', phrase({ bpm: 84 }, R('C4/1@1 _/1 C4/1@1 _/1 | E4/1@3 _/1 E4/1@3 _/1 | G4/1@5 E4/1@3 C4/2@1'))),
        timed('Play and rest', 'Play on the notes. Wait on the rests.', phrase({ bpm: 80 }, R('C4/1@1 _/1 C4/1@1 _/1 | E4/1@3 _/1 E4/1@3 _/1 | G4/1@5 E4/1@3 C4/2@1'))),
        quiz('Rest time', 'What do you do on a rest?', ['Play loudly', 'Stay quiet and keep counting', 'Stop the song'], 1, 'The beat goes on. You just wait for the next note.'),
        timed('Call and echo', 'Three notes, then a rest, like an echo.', phrase({ bpm: 80 }, R('C4/1@1 E4/1@3 G4/1@5 _/1 | G4/1@5 E4/1@3 C4/1@1 _/1 | D4/1@2 F4/1@4 E4/1@3 D4/1@2 | C4/2@1 _/2'))),
      ],
    },
    {
      id: 'rhythm-eighths',
      title: 'Quick notes',
      summary: 'Two notes in one beat.',
      steps: [
        explain('Half a beat each', 'An eighth note lasts half a beat. Count them like this: 1 and 2 and.', { rhythm: rhythm('0.5 0.5 0.5 0.5 1 1') }),
        listen('Hear quick pairs', 'Listen for the quick pairs.', phrase({ bpm: 76 }, R('C4/1@1 C4/1@1 C4/0.5@1 C4/0.5@1 C4/1@1 | D4/1@2 D4/1@2 D4/0.5@2 D4/0.5@2 D4/1@2 | E4/0.5@3 E4/0.5@3 D4/0.5@2 D4/0.5@2 C4/2@1'))),
        learn('Learn it slowly', 'First just the notes. No hurry!', phrase({ bpm: 76 }, R('C4/1@1 C4/1@1 C4/0.5@1 C4/0.5@1 C4/1@1 | D4/1@2 D4/1@2 D4/0.5@2 D4/0.5@2 D4/1@2 | E4/0.5@3 E4/0.5@3 D4/0.5@2 D4/0.5@2 C4/2@1'))),
        timed('Now in time', 'Say "1 and 2 and" in your head.', phrase({ bpm: 72 }, R('C4/1@1 C4/1@1 C4/0.5@1 C4/0.5@1 C4/1@1 | D4/1@2 D4/1@2 D4/0.5@2 D4/0.5@2 D4/1@2 | E4/0.5@3 E4/0.5@3 D4/0.5@2 D4/0.5@2 C4/2@1')), 'right', 0.55),
        quiz('Quick notes quiz', 'How many eighth notes fit in one beat?', ['1', '2', '4'], 1, 'Two eighth notes share one beat: "1 and".'),
      ],
    },
    {
      id: 'piece-jingle-bells',
      title: 'Jingle Bells',
      summary: 'The famous chorus, in C position.',
      piece: { title: 'Jingle Bells', by: 'James Lord Pierpont' },
      steps: [
        explain('Every kind of note', 'This chorus uses every note you know. Watch for the long E in bar 4 and the quick Es in bar 6.', {
          keys: keys('C4', 'B4', 'C4@1 D4@2 E4@3 F4@4 G4@5'),
        }),
        listen('Listen first', 'Count along: 1, 2, 3, 4.', phrase({ bpm: 100 }, R(JINGLE_A), R(JINGLE_B, 32))),
        learn('First half', 'The first eight bars.', phrase({ bpm: 100 }, R(JINGLE_A))),
        learn('Second half', 'Same start, new ending.', phrase({ bpm: 100 }, R(JINGLE_B))),
        perform('The whole chorus', 'All of it, in time. Jingle away!', phrase({ bpm: 92 }, R(JINGLE_A), R(JINGLE_B, 32)), 'right', 0.55),
      ],
    },
  ],
};

const unit4: Unit = {
  id: 'u4-left-hand',
  title: 'Left hand',
  blurb: 'Wake up your left hand.',
  lessons: [
    {
      id: 'lh-position',
      title: 'Left hand home',
      summary: 'Your left hand in C position.',
      steps: [
        explain('Same numbers, other side', 'Your left thumb is 1 too. Put left finger 5 on the C below middle C.', {
          hand: hand('left'),
          keys: keys('C3', 'B4', 'C3@5:L D3@4:L E3@3:L F3@2:L G3@1:L'),
        }),
        find('Little finger on C', 'Press the C below middle C with left finger 5.', 'C3', { finger: 5, hand: 'left' }),
        find('Thumb on G', 'Now press G with your left thumb.', 'G3', { finger: 1, hand: 'left' }),
        learn('Climb up', 'C to G with left fingers 5, 4, 3, 2, 1.', phrase({ bpm: 80 }, L('C3/1@5 D3/1@4 E3/1@3 F3/1@2 G3/2@1')), 'left', { hintAfter: 0 }),
        learn('Climb down', 'G to C with left fingers 1, 2, 3, 4, 5.', phrase({ bpm: 80 }, L('G3/1@1 F3/1@2 E3/1@3 D3/1@4 C3/2@5')), 'left', { hintAfter: 0 }),
        quiz('Count down', 'Thumb on G. Which finger plays C?', ['1', '3', '5'], 2, 'Count down from G: 1, 2, 3, 4, 5. C is finger 5.', { keys: keys('C3', 'B3', 'G3@1:L C3=?:L') }),
      ],
    },
    {
      id: 'lh-steps',
      title: 'Left steps and skips',
      summary: 'Steps and skips, down low.',
      steps: [
        explain('Just like the right', 'Steps and skips work the same way here. The notes just sound lower.', { keys: keys('C3', 'B3', 'C3@5:L E3@3:L G3@1:L') }),
        learn('Learn it', 'Steps and skips with your left hand.', phrase({ bpm: 80 }, L('C3/1@5 D3/1@4 E3/1@3 C3/1@5 | E3/1@3 F3/1@2 G3/2@1 | G3/1@1 E3/1@3 D3/1@4 F3/1@2 | E3/1@3 D3/1@4 C3/2@5')), 'left'),
        quiz('Which fingers?', 'Which left fingers skip from C up to E?', ['5 and 3', '5 and 4', '1 and 2'], 0, 'C is 5, D is 4, E is 3. So it is 5 and 3!'),
        timed('Play it in time', 'Now in time, with your left hand.', phrase({ bpm: 72 }, L('C3/1@5 D3/1@4 E3/1@3 C3/1@5 | E3/1@3 F3/1@2 G3/2@1 | G3/1@1 E3/1@3 D3/1@4 F3/1@2 | E3/1@3 D3/1@4 C3/2@5')), 'left'),
      ],
    },
    {
      id: 'lh-melody',
      title: 'Left hand tunes',
      summary: 'Tunes you know, down low.',
      steps: [
        explain('Tunes down low', 'Your left hand can play tunes too. Here is Hot Cross Buns, with fingers 3, 4 and 5.', { keys: keys('C3', 'B3', 'C3@5:L D3@4:L E3@3:L') }),
        learn('Hot Cross Buns, low', 'E, D, C with fingers 3, 4, 5.', phrase({ bpm: 84 }, L(HOT_CROSS_BUNS_LH)), 'left'),
        timed('Now in time', 'The same tune, in time.', phrase({ bpm: 76 }, L(HOT_CROSS_BUNS_LH)), 'left', 0.55),
        learn('Mary, down low', 'The start of Mary Had a Little Lamb. G is your thumb.', phrase({ bpm: 88 }, L(MARY_A_LH)), 'left'),
      ],
    },
    {
      id: 'piece-lightly-row',
      title: 'Lightly Row',
      summary: 'A whole song for your left hand.',
      piece: { title: 'Lightly Row', by: 'Traditional' },
      steps: [
        explain('A left hand song', 'It starts on G, your thumb, and skips down to E. Rest your hand in C position first.', { keys: keys('C3', 'B3', 'C3@5:L D3@4:L E3@3:L F3@2:L G3@1:L') }),
        listen('Listen first', 'Here is the whole song.', phrase({ bpm: 92 }, L(LIGHTLY_A), L(LIGHTLY_END, 16), L(LIGHTLY_MID, 32), L(LIGHTLY_END, 48))),
        learn('The first part', 'The first eight bars.', phrase({ bpm: 92 }, L(LIGHTLY_A), L(LIGHTLY_END, 16)), 'left'),
        learn('The middle part', 'Lots of repeated notes, then the ending you know.', phrase({ bpm: 92 }, L(LIGHTLY_MID), L(LIGHTLY_END, 16)), 'left'),
        perform('The whole song', 'All of it, in time, with your left hand.', phrase({ bpm: 88 }, L(LIGHTLY_A), L(LIGHTLY_END, 16), L(LIGHTLY_MID, 32), L(LIGHTLY_END, 48)), 'left', 0.55),
      ],
    },
  ],
};

const TURNS = phrase({ bpm: 84 }, R('C4/1@1 D4/1@2 E4/2@3'), L('G3/1@1 F3/1@2 E3/2@3', 4), R('E4/1@3 F4/1@4 G4/2@5', 8), L('E3/1@3 D3/1@4 C3/2@5', 12));
const HOLD = (bpm: number) => phrase({ bpm }, R('C4/1@1 D4/1@2 E4/1@3 F4/1@4 | G4/2@5 E4/2@3 | F4/1@4 E4/1@3 D4/1@2 E4/1@3 | C4/4@1'), L('C3/4@5 | C3/4@5 | G3/4@1 | C3/4@5'));
const MIRROR = (bpm: number) =>
  phrase(
    { bpm },
    R('C4/1@1 D4/1@2 E4/1@3 F4/1@4 | G4/2@5 G4/2@5 | F4/1@4 E4/1@3 D4/1@2 E4/1@3 | C4/4@1'),
    L('C3/1@5 D3/1@4 E3/1@3 F3/1@2 | G3/2@1 G3/2@1 | F3/1@2 E3/1@3 D3/1@4 E3/1@3 | C3/4@5'),
  );
const ODE = (bpm: number) => phrase({ bpm }, R(ODE_A), R(ODE_B, 16), L(ODE_LH));

const unit5: Unit = {
  id: 'u5-together',
  title: 'Hands together',
  blurb: 'Both hands, as a team.',
  lessons: [
    {
      id: 'ht-turns',
      title: 'Taking turns',
      summary: 'Right hand plays, left hand answers.',
      steps: [
        explain('One, then the other', 'Put both hands in C position. The right hand plays, then the left hand answers.', {
          keys: keys('C3', 'B4', 'C3@5:L G3@1:L C4@1 G4@5'),
        }),
        listen('Listen first', 'Blue notes are for the right hand. Orange notes are for the left.', TURNS),
        learn('Your turn', 'Play both parts. The music waits for you.', TURNS, 'both', { hintAfter: 0 }),
        timed('Now in time', 'Get the next hand ready while the other one plays.', phrase({ bpm: 76 }, R('C4/1@1 D4/1@2 E4/2@3'), L('G3/1@1 F3/1@2 E3/2@3', 4), R('E4/1@3 F4/1@4 G4/2@5', 8), L('E3/1@3 D3/1@4 C3/2@5', 12)), 'both'),
      ],
    },
    {
      id: 'ht-hold',
      title: 'Hold and move',
      summary: 'One hand holds, one hand moves.',
      steps: [
        explain('One hand holds', 'Press both hands together on beat 1. Keep the left key down for the whole bar.', { rhythm: rhythm('4') }),
        learn('Learn it', 'Both hands. The music waits for you.', HOLD(80), 'both'),
        quiz('Which hand holds?', 'Which hand plays the long notes?', ['Right hand', 'Left hand'], 1, 'The left hand holds long notes while the right hand plays the tune.'),
        timed('Now in time', 'Both hands, in time.', HOLD(72), 'both', 0.55),
      ],
    },
    {
      id: 'ht-together',
      title: 'Both at once',
      summary: 'Both hands play the same tune.',
      steps: [
        explain('Same notes, two hands', 'Both hands play the same letters at the same time. The keys match, but the fingers are different!', {
          keys: keys('C3', 'B4', 'C3@5:L D3@4:L E3@3:L F3@2:L G3@1:L C4@1 D4@2 E4@3 F4@4 G4@5'),
        }),
        learn('Learn it', 'Press each pair of keys together.', MIRROR(72), 'both'),
        timed('Now in time', 'Both hands together, in time.', MIRROR(66), 'both', 0.55),
      ],
    },
    {
      id: 'piece-ode-to-joy',
      title: 'Ode to Joy',
      summary: 'A famous tune by Beethoven.',
      piece: { title: 'Ode to Joy', by: 'Ludwig van Beethoven' },
      steps: [
        explain('A famous tune', 'Beethoven wrote this about 200 years ago. Your right hand plays the tune, your left hand one long note per bar.', {
          keys: keys('C3', 'B4', 'C3@5:L G3@1:L C4@1 D4@2 E4@3 F4@4 G4@5'),
        }),
        listen('Listen first', 'Hear the long-short rhythm at the end of each line.', ODE(88)),
        learn('Right hand', 'The tune first. The app plays the left hand.', ODE(88), 'right'),
        learn('Left hand', 'Now the long low notes. The app plays the tune.', ODE(88), 'left'),
        learn('Hands together', 'Put them together, slowly. The music waits.', ODE(88), 'both'),
        perform('Play it in time', 'Both hands, in time. You are playing Beethoven!', ODE(80), 'both', 0.55),
      ],
    },
  ],
};

const TWINKLE = (bpm: number) => phrase({ bpm }, R(TWINKLE_A), R(TWINKLE_B, 16), R(TWINKLE_A, 32), L(TWINKLE_A_LH), L(TWINKLE_B_LH, 16), L(TWINKLE_A_LH, 32));
const SHIFT = 'C4/1@1 D4/1@2 E4/1@3 F4/1@4 | G4/2@5 _/2 | G4/1@1 A4/1@2 B4/1@3 C5/1@4 | D5/2@5 _/2 | D5/1@5 C5/1@4 B4/1@3 A4/1@2 | G4/4@1';

const unit6: Unit = {
  id: 'u6-moving',
  title: 'Moving around',
  blurb: 'Stretch and move your hand.',
  lessons: [
    {
      id: 'move-stretch',
      title: 'Stretching to A',
      summary: 'Reach one key further.',
      steps: [
        explain('A little reach', 'Keep your thumb on C. Let finger 5 stretch from G to A, then come back.', { keys: keys('C4', 'B4', 'C4@1 G4@5 A4@5') }),
        find('Reach for A', 'Play G, stretch to A, and come back to G.', 'G4 A4 G4', { finger: 5, hand: 'right', hintAfter: 1 }),
        learn('Stretch in a tune', 'Finger 5 plays both G and A here.', phrase({ bpm: 80 }, R('C4/1@1 E4/1@3 G4/1@5 A4/1@5 | G4/2@5 E4/2@3 | F4/1@4 G4/1@5 A4/1@5 G4/1@5 | C4/4@1'))),
        timed('Now in time', 'Keep your thumb close to C.', phrase({ bpm: 72 }, R('C4/1@1 E4/1@3 G4/1@5 A4/1@5 | G4/2@5 E4/2@3 | F4/1@4 G4/1@5 A4/1@5 G4/1@5 | C4/4@1'))),
      ],
    },
    {
      id: 'move-shift',
      title: 'Moving your hand',
      summary: 'Lift your hand, land somewhere new.',
      steps: [
        explain('Lift and land', 'Lift your hand lightly and land with your fingers ready. Here your thumb jumps from C to G.', { keys: keys('C4', 'B5', 'C4@1 G4@1') }),
        learn('Learn it', 'Climb up from C, then move your thumb to G. The rests give you time.', phrase({ bpm: 80 }, R(SHIFT))),
        quiz('Moving well', 'What helps most when your hand moves?', ['Lift lightly and land ready', 'Slide along the keys', 'Press harder'], 0, 'A light lift lands softly, without bumping other keys.'),
        timed('Now in time', 'Use the rests to move your hand.', phrase({ bpm: 72 }, R(SHIFT)), 'right', 0.55),
      ],
    },
    {
      id: 'move-g-position',
      title: 'G position',
      summary: 'A second home for your right hand.',
      steps: [
        explain('New home: G', 'Thumb on G, then fingers on A, B, C and D. This is G position.', { keys: keys('C4', 'B5', 'G4@1 A4@2 B4@3 C5@4 D5@5') }),
        find('Find your new home', 'Play G with your thumb, then D with finger 5.', 'G4 D5', { lo: 'C4', hi: 'B5' }),
        learn('Ode in G', 'A tune you know, in G position. Same fingers, new keys.', phrase({ bpm: 88 }, R(ODE_IN_G))),
        timed('Now in time', 'The same tune, in time.', phrase({ bpm: 80 }, R(ODE_IN_G))),
      ],
    },
    {
      id: 'piece-twinkle',
      title: 'Twinkle, Twinkle, Little Star',
      summary: 'Stretch to A, with both hands.',
      piece: { title: 'Twinkle, Twinkle, Little Star', by: 'Traditional' },
      steps: [
        explain('Stretch and come back', 'Your right finger 5 stretches up to A. Your left hand plays long low notes: C, F or G.', {
          keys: keys('C3', 'B4', 'C3@5:L F3@2:L G3@1:L C4@1 D4@2 E4@3 F4@4 G4@5 A4@5'),
        }),
        listen('Listen first', 'The whole song, with both hands.', TWINKLE(96)),
        learn('Right hand', 'The tune. The app plays the left hand.', TWINKLE(96), 'right'),
        learn('Left hand', 'The low notes. The app plays the tune.', TWINKLE(96), 'left'),
        perform('Play it in time', 'Both hands together, in time.', TWINKLE(84), 'both', 0.55),
      ],
    },
  ],
};

const CHORDS = (bpm: number, names: (keyof typeof CH)[], beats = 4) => phrase({ bpm, chords: names.map((n) => `${n}/${beats}`).join(' ') }, L(names.map((n) => chord(n, beats)).join(' ')));
const EVENING = (bpm: number) => phrase({ bpm, chords: EVENING_CHORDS }, R(EVENING_RH), L(EVENING_LH));
const SAINTS_SONG = (bpm: number) => phrase({ bpm, chords: SAINTS_CHORDS }, R(SAINTS), L(SAINTS_LH));

const unit7: Unit = {
  id: 'u7-chords',
  title: 'First chords',
  blurb: 'Three notes at once.',
  lessons: [
    {
      id: 'chord-c',
      title: 'The C chord',
      summary: 'Your very first chord.',
      steps: [
        explain('Three notes at once', 'A chord is notes played together. The C chord is C, E and G, with left fingers 5, 3 and 1.', {
          keys: keys('C3', 'B3', 'C3@5:L E3@3:L G3@1:L'),
        }),
        listen('Hear it', 'This is the C chord.', CHORDS(70, ['C', 'C'])),
        learn('Play the C chord', 'Press C, E and G together. The music waits for all three.', CHORDS(70, ['C', 'C']), 'left', { hintAfter: 0 }),
        quiz('Which notes?', 'Which notes make the C chord?', ['C, D, E', 'C, E, G', 'C, F, A'], 1, 'Skip, skip: C, E, G. Every other white key.'),
        timed('Chord on beat 1', 'Play it at the start of each bar. Hold it for four beats.', CHORDS(72, ['C', 'C', 'C', 'C']), 'left'),
      ],
    },
    {
      id: 'chord-g',
      title: 'The G chord',
      summary: 'A new chord, and your first change.',
      steps: [
        explain('A new shape', 'Move your left hand up a little: 5 on D, 2 on G, 1 on B. That is this G chord.', {
          keys: keys('C3', 'B3', 'D3@5:L G3@2:L B3@1:L'),
        }),
        listen('Hear C, then G', 'Hear the music move from C to G and back.', CHORDS(70, ['C', 'G', 'C', 'G'], 2)),
        learn('Switch C and G', 'Change shape between the chords. The music waits.', CHORDS(70, ['C', 'G', 'C', 'G', 'C']), 'left', { hintAfter: 0 }),
        quiz('Which notes?', 'Which notes make this G chord?', ['D, G, B', 'C, E, G', 'C, F, A'], 0, 'This G chord is D, G and B.'),
        timed('Now in time', 'One chord per bar. Move on beat 4 to be ready.', CHORDS(66, ['C', 'G', 'C', 'G', 'C']), 'left'),
      ],
    },
    {
      id: 'chord-f',
      title: 'The F chord',
      summary: 'Three chords for hundreds of songs.',
      steps: [
        explain('F keeps C', 'This F chord is C, F and A. Finger 5 stays on C, finger 2 goes to F and your thumb to A.', { keys: keys('C3', 'B3', 'C3@5:L F3@2:L A3@1:L') }),
        listen('Hear C, F, G', 'Lots of songs use just these three.', CHORDS(70, ['C', 'F', 'C', 'G', 'C'], 2)),
        quiz('Shared note', 'Which note is in both the C and F chords?', ['C', 'E', 'A'], 0, 'Both chords use C, so finger 5 can stay put.'),
        learn('Learn the changes', 'C, F, C, G, C. The music waits.', CHORDS(70, ['C', 'F', 'C', 'G', 'C']), 'left'),
        timed('Now in time', 'One chord per bar.', CHORDS(66, ['C', 'F', 'C', 'G', 'C']), 'left'),
      ],
    },
    {
      id: 'chord-am',
      title: 'A minor',
      summary: 'A softer, thoughtful chord.',
      steps: [
        explain('A softer colour', 'A minor sounds gentle, a little sad. It is the C chord with your thumb moved up to A.', {
          keys: keys('C3', 'B3', 'C3@5:L E3@3:L A3@1:L'),
        }),
        listen('Hear the difference', 'C, then A minor. Hear the mood change.', CHORDS(66, ['C', 'Am', 'C', 'Am'], 2)),
        quiz('How does it sound?', 'How does A minor sound?', ['Brighter', 'Softer, a little sad', 'Exactly the same'], 1, 'Minor chords sound softer and more thoughtful.'),
        learn('Four chords', 'C, A minor, F, G, and home to C.', CHORDS(70, ['C', 'Am', 'F', 'G', 'C']), 'left'),
        timed('Now in time', 'All four chords, in time.', CHORDS(66, ['C', 'Am', 'F', 'G', 'C']), 'left'),
      ],
    },
    {
      id: 'chord-melody',
      title: 'Chords under a tune',
      summary: 'Tune on top, chords below.',
      steps: [
        explain('Tune and chords', 'Your right hand plays the tune, your left hand a chord each bar. Press the chord with the first note.', {
          keys: keys('C3', 'B4', 'C3@5:L E3@3:L G3@1:L C4@1 E4@3 G4@5'),
        }),
        listen('Evening Song', 'A tune made for this course.', EVENING(80)),
        learn('Right hand', 'The tune. The app plays the chords.', EVENING(80), 'right'),
        learn('Hands together', 'Now add the chords. The music waits.', EVENING(80), 'both'),
        timed('Now in time', 'Both hands, in time.', EVENING(66), 'both', 0.55),
      ],
    },
    {
      id: 'piece-saints',
      title: 'When the Saints Go Marching In',
      summary: 'A lively march with chords.',
      piece: { title: 'When the Saints Go Marching In', by: 'Traditional' },
      steps: [
        explain('Start after a rest', 'Each line starts after a quiet beat: count 1, then play C, E, F. Your left hand plays C, F and G chords.', {
          keys: keys('C3', 'B4', 'C3@5:L E3@3:L G3@1:L C4@1 D4@2 E4@3 F4@4 G4@5'),
        }),
        listen('Listen first', 'Count the quiet beat at the start of each line.', SAINTS_SONG(96)),
        learn('Right hand', 'The tune. The app plays the chords.', SAINTS_SONG(96), 'right'),
        learn('Left hand', 'The chords. The app plays the tune.', SAINTS_SONG(96), 'left'),
        learn('Hands together', 'Slowly. The music waits for you.', SAINTS_SONG(96), 'both'),
        perform('Play it in time', 'March on! Both hands, in time.', SAINTS_SONG(84), 'both', 0.5),
      ],
    },
  ],
};

const AU_CLAIR = (bpm: number) => phrase({ bpm }, R(AU_CLAIR_RH), R(AU_CLAIR_RH, 16), L(AU_CLAIR_LH), L(AU_CLAIR_LH, 16));
const SHEET = { view: 'sheet' } as const;

const unit8: Unit = {
  id: 'u8-reading',
  title: 'Reading music',
  blurb: 'Read notes on the staff.',
  lessons: [
    {
      id: 'staff-intro',
      title: 'The staff',
      summary: 'Five lines that show the notes.',
      steps: [
        explain('Five lines', 'Music is written on five lines, called a staff. Higher on the staff means higher on the piano.', {
          staff: staff('treble', 'C4 D4 E4 F4 G4 A4 B4 C5', true),
        }),
        explain('The treble clef', 'This curly sign is for the right hand. It curls around the second line, and that line is G.', {
          staff: staff('treble', 'G4', true),
        }),
        quiz('The bottom line', 'Which note is on the bottom line?', ['C', 'E', 'G'], 1, 'The bottom line of this staff is E.', { staff: staff('treble', 'E4') }),
        explain('Middle C', 'Middle C sits just below the staff, on its own little line.', { staff: staff('treble', 'C4', true) }),
        quiz('Its own line', 'Which note has its own little line?', ['Middle C', 'G', 'A'], 0, 'Middle C always has its own little line.', { staff: staff('treble', 'C4') }),
        quiz('Just under', 'Which note hangs just under the bottom line?', ['C', 'D', 'F'], 1, 'D sits just under the bottom line, between middle C and E.', { staff: staff('treble', 'D4') }),
        learn('Play what you read', 'Read each note, then play it.', phrase({ bpm: 80 }, R('C4/1@1 D4/1@2 E4/2@3 | D4/1@2 C4/1@1 E4/2@3 | C4/4@1')), 'right', SHEET),
      ],
    },
    {
      id: 'staff-treble',
      title: 'Reading C to G',
      summary: 'The C position notes on the staff.',
      steps: [
        explain('One key, one place', 'Each key up moves the note one place up the staff: line, space, line, space.', { staff: staff('treble', 'C4 D4 E4 F4 G4', true) }),
        quiz('Which note?', 'Which note is this?', ['E', 'F', 'G'], 1, 'F is in the first space, just above the bottom line.', { staff: staff('treble', 'F4') }),
        quiz('And this one?', 'Which note is this?', ['D', 'G', 'B'], 1, 'G sits on the second line, where the clef curls.', { staff: staff('treble', 'G4') }),
        quiz('Two notes', 'They skip up from the bottom line. What are they?', ['E and G', 'C and D', 'F and A'], 0, 'The bottom line is E. The next line up is G.', { staff: staff('treble', 'E4 G4') }),
        learn('Read and play', 'Read the notes as they come. If you get stuck, try falling notes under More.', phrase({ bpm: 80 }, R('C4/1@1 E4/1@3 D4/1@2 F4/1@4 | E4/1@3 G4/1@5 F4/2@4 | E4/1@3 D4/1@2 C4/2@1')), 'right', SHEET),
      ],
    },
    {
      id: 'staff-bass',
      title: 'The bass clef',
      summary: 'Notes for your left hand.',
      steps: [
        explain('The bass clef', 'The left hand reads the bass clef. Its two dots hug the second line from the top, and that line is F.', { staff: staff('bass', 'F3', true) }),
        explain('Left hand notes', 'Your left hand notes sit high on this staff. C is in the second space from the bottom.', { staff: staff('bass', 'C3 D3 E3 F3 G3', true) }),
        quiz('Which note?', 'Which note is this?', ['E', 'G', 'B'], 1, 'G is in the top space of this staff.', { staff: staff('bass', 'G3') }),
        quiz('And this one?', 'Which note is this?', ['C', 'A', 'F'], 0, 'C is in the second space from the bottom.', { staff: staff('bass', 'C3') }),
        learn('Read and play', 'Read the notes with your left hand.', phrase({ bpm: 80 }, L('C3/1@5 E3/1@3 G3/2@1 | F3/1@2 D3/1@4 C3/2@5')), 'left', SHEET),
      ],
    },
    {
      id: 'piece-au-clair',
      title: 'Au Clair de la Lune',
      summary: 'A French song to read, with both hands.',
      piece: { title: 'Au Clair de la Lune', by: 'Traditional' },
      steps: [
        explain('Read it first', 'This French song begins like this. Can you name the notes?', { staff: staff('treble', 'C4 C4 C4 D4 E4 D4') }),
        quiz('The first notes', 'What are the first three notes?', ['C, C, C', 'E, E, E', 'G, G, G'], 0, 'All three are middle C, on its own little line.', { staff: staff('treble', 'C4 C4 C4 D4 E4 D4') }),
        listen('Listen first', 'Follow the notes as you listen.', AU_CLAIR(88), SHEET),
        learn('Right hand', 'Read the tune. The app plays the left hand.', AU_CLAIR(88), 'right', SHEET),
        perform('Both hands, in time', 'Read and play with both hands.', AU_CLAIR(80), 'both', 0.55, SHEET),
      ],
    },
  ],
};

const MARY_WITH_BAND = (bpm: number) => phrase({ bpm, chords: 'C/4 C/4 G/4 C/4 C/4 C/4 G/4 C/4' }, R(MARY_A), R(MARY_B, 16), L(MARY_BAND));
const FRERE_ROUND = (bpm: number) => phrase({ bpm }, R(FRERE), L(FRERE_BAND, 8));

const unit9: Unit = {
  id: 'u9-expression',
  title: 'Play with feeling',
  blurb: 'Soft, loud, and playing with others.',
  lessons: [
    {
      id: 'dyn-soft-loud',
      title: 'Soft and loud',
      summary: 'Your touch changes the sound.',
      steps: [
        explain('Gentle or strong', 'A gentle press is soft and a strong press is loud. Musicians say "piano" for soft and "forte" for loud.'),
        explain('Real keys can tell', 'Soft and loud need a piano keyboard plugged in. Computer keys and the screen just count your presses.'),
        touch('Soft, then loud', 'Any key: soft two times, then loud two times.', ['soft', 'soft', 'loud', 'loud']),
        touch('Echo game', 'Play loud, then answer softly, like an echo.', ['loud', 'soft', 'loud', 'soft']),
        quiz('Music words', 'What does "forte" mean?', ['Soft', 'Loud', 'Slow'], 1, 'Forte means loud. Piano means soft.'),
      ],
    },
    {
      id: 'band',
      title: 'Play with a band',
      summary: 'You play the tune, the band keeps going.',
      steps: [
        explain('You lead the band', 'The app plays chords with you, like a band. The band will not wait, so keep going after a slip.'),
        listen('Hear the band', 'Mary Had a Little Lamb, with the band.', MARY_WITH_BAND(96)),
        timed('Play with the band', 'You play the tune with your right hand.', MARY_WITH_BAND(88), 'right', 0.55),
        { kind: 'song', title: 'Play along', text: 'A song from your library. You play the right hand, the app plays the left.', songId: 'ode', hands: 'right', pass: 0.5 },
        explain('Any song works', 'On Songs, choose Add your own song and pick a music file. It all happens on your computer.'),
      ],
    },
    {
      id: 'piece-frere-jacques',
      title: 'Frère Jacques',
      summary: 'A round with the band.',
      piece: { title: 'Frère Jacques', by: 'Traditional' },
      steps: [
        explain('What is a round?', 'Everyone plays the same tune, but starts at different times. You start, and the band joins two bars later.'),
        listen('Listen to the round', 'Listen for the second voice coming in.', FRERE_ROUND(92)),
        learn('Learn the tune', 'Just your part first. The fingers change a little in the quick notes.', phrase({ bpm: 92 }, R(FRERE))),
        explain('Moving down', 'In the last two bars, put your thumb on the G below middle C. Finger 4 plays C.', { keys: keys('C3', 'B4', 'G3@1 C4@4') }),
        perform('Play the round', 'You start. Keep going when the band comes in!', FRERE_ROUND(88), 'right', 0.55),
      ],
    },
  ],
};

/** The course, from never having touched a piano to simple pieces with both hands. */
export const COURSE: Course = {
  id: 'beginner',
  title: 'Learn to play',
  units: [unit1, unit2, unit3, unit4, unit5, unit6, unit7, unit8, unit9],
};

export function allLessons(course: Course = COURSE): Lesson[] {
  return course.units.flatMap((u) => u.lessons);
}

export function findLesson(id: string, course: Course = COURSE): Lesson | undefined {
  return allLessons(course).find((l) => l.id === id);
}

export function unitOf(lessonId: string, course: Course = COURSE): Unit | undefined {
  return course.units.find((u) => u.lessons.some((l) => l.id === lessonId));
}

/** A rough time for a lesson, in whole minutes, for the lesson list. */
export function minutesFor(lesson: Lesson): number {
  let seconds = 0;
  for (const step of lesson.steps) {
    switch (step.kind) {
      case 'explain':
        seconds += 15;
        break;
      case 'find':
        seconds += 10 + 5 * step.targets.length;
        break;
      case 'quiz':
        seconds += 15;
        break;
      case 'touch':
        seconds += 20;
        break;
      case 'song':
        seconds += 90;
        break;
      default: {
        const beats = step.music.notes.reduce((e, n) => Math.max(e, n.beat + n.beats), 0);
        seconds += (beats * 60) / step.music.bpm + (step.kind === 'listen' ? 5 : 25);
      }
    }
  }
  return Math.max(1, Math.round(seconds / 60));
}

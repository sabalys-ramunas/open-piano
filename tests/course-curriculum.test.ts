import { describe, expect, it } from 'vitest';
import { allLessons, COURSE, findLesson, minutesFor } from '../src/course/curriculum';
import { phraseBeats } from '../src/course/music';
import type { CourseNote, Lesson, LessonStep, Phrase } from '../src/course/types';
import { BUILT_IN } from '../src/songs';

// An independent spelling of pitches, so the tests do not trust src/song.ts.
const STEP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function pitch(name: string): number {
  const m = /^([a-g])(#?)(\d)$/.exec(name);
  if (!m) throw new Error(`test spelling ${name}`);
  return 12 * (Number(m[3]) + 1) + STEP[m[1]] + (m[2] ? 1 : 0);
}
const pitches = (text: string) => text.trim().split(/\s+/).map(pitch);
const isWhite = (midi: number) => [0, 2, 4, 5, 7, 9, 11].includes(((midi % 12) + 12) % 12);

type MusicStep = Extract<LessonStep, { music: Phrase }>;
const hasMusic = (s: LessonStep): s is MusicStep => 'music' in s;

const lessons = allLessons();
const steps = lessons.flatMap((l) => l.steps.map((s) => ({ lesson: l, step: s })));
const musicSteps = steps.filter((x): x is { lesson: Lesson; step: MusicStep } => hasMusic(x.step));

/** The notes a learner plays in a step, given its hands setting. */
function mine(step: MusicStep): CourseNote[] {
  if (step.kind === 'listen') return [];
  return step.music.notes.filter((n) => step.hands === 'both' || n.hand === step.hands);
}

describe('course structure', () => {
  it('has a full beginner course of 30 to 40ish lessons in units', () => {
    expect(COURSE.units.length).toBeGreaterThanOrEqual(8);
    expect(lessons.length).toBeGreaterThanOrEqual(30);
    expect(lessons.length).toBeLessThanOrEqual(42);
  });

  it('uses unique, url-safe ids and keeps the original first lesson id', () => {
    const ids = lessons.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const unitIds = COURSE.units.map((u) => u.id);
    expect(new Set(unitIds).size).toBe(unitIds.length);
    for (const id of [...ids, ...unitIds]) expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(ids[0]).toBe('find-c');
    expect(findLesson('find-c')?.title).toBe('Find C');
  });

  it('gives every lesson short, real content', () => {
    for (const l of lessons) {
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.steps.length, l.id).toBeLessThanOrEqual(8);
      expect(l.title.length, l.id).toBeGreaterThan(2);
      expect(l.summary.length, l.id).toBeGreaterThan(10);
      expect(minutesFor(l), l.id).toBeGreaterThanOrEqual(1);
      expect(minutesFor(l), l.id).toBeLessThanOrEqual(6);
      // Plenty of playing: every lesson has the learner touch the keys.
      expect(l.steps.some((s) => s.kind !== 'explain' && s.kind !== 'quiz' && s.kind !== 'listen'), l.id).toBe(true);
    }
  });

  it('ends every unit with a piece to perform', () => {
    for (const unit of COURSE.units) {
      const last = unit.lessons[unit.lessons.length - 1];
      expect(last.piece, unit.id).toBeDefined();
      expect(last.steps.some((s) => s.kind === 'perform'), unit.id).toBe(true);
    }
  });

  it('keeps the words short enough for an eight-year-old', () => {
    const words = (t: string) => t.trim().split(/\s+/).length;
    const sentences = (t: string) => t.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
    for (const unit of COURSE.units) {
      expect(words(unit.title), unit.id).toBeLessThanOrEqual(4);
      expect(sentences(unit.blurb), unit.id).toBeLessThanOrEqual(2);
    }
    for (const l of lessons) {
      // A piece's lesson is named after the song itself.
      if (l.piece) expect(l.title, l.id).toBe(l.piece.title);
      else expect(words(l.title), l.id).toBeGreaterThanOrEqual(2), expect(words(l.title), l.id).toBeLessThanOrEqual(4);
      expect(words(l.summary), `${l.id} summary`).toBeLessThanOrEqual(8);
      for (const step of l.steps) {
        const where = `${l.id}: ${step.title}`;
        expect(words(step.title), where).toBeGreaterThanOrEqual(2);
        expect(words(step.title), where).toBeLessThanOrEqual(4);
        const text = step.kind === 'quiz' ? step.question : step.text;
        expect(sentences(text), where).toBeLessThanOrEqual(2);
        expect(words(text), where).toBeLessThanOrEqual(24);
        if (step.kind === 'quiz') {
          expect(words(step.question), where).toBeLessThanOrEqual(10);
          expect(sentences(step.why), where).toBeLessThanOrEqual(2);
          expect(words(step.why), where).toBeLessThanOrEqual(16);
        }
      }
    }
  });

  it('never uses an em dash in learner-facing text', () => {
    const text = JSON.stringify(COURSE);
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe('step data', () => {
  it('has answerable quizzes', () => {
    for (const { lesson, step } of steps) {
      if (step.kind !== 'quiz') continue;
      expect(step.choices.length, lesson.id).toBeGreaterThanOrEqual(2);
      expect(new Set(step.choices).size, lesson.id).toBe(step.choices.length);
      expect(Number.isInteger(step.answer) && step.answer >= 0 && step.answer < step.choices.length, lesson.id).toBe(true);
      expect(step.why.length).toBeGreaterThan(5);
    }
  });

  it('has find steps whose targets are on the drawn keyboard and the computer keys', () => {
    for (const { lesson, step } of steps) {
      if (step.kind !== 'find') continue;
      expect(isWhite(step.lo) && isWhite(step.hi), lesson.id).toBe(true);
      expect(step.targets.length).toBeGreaterThan(0);
      const baseC = Math.floor(step.lo / 12) * 12;
      const reach = Math.min(step.hi, baseC + 28);
      for (const t of step.targets) {
        expect(t >= step.lo && t <= step.hi, `${lesson.id} ${t}`).toBe(true);
        expect(t - baseC, `${lesson.id} ${t}`).toBeLessThanOrEqual(28);
      }
      if (step.anyOctave && step.distinct) {
        const pc = step.targets[0] % 12;
        let count = 0;
        for (let m = step.lo; m <= reach; m++) if (m % 12 === pc) count++;
        expect(count, lesson.id).toBeGreaterThanOrEqual(step.targets.length);
      }
    }
  });

  it('draws keyboard pictures with marks that fit', () => {
    for (const { lesson, step } of steps) {
      if (!('keys' in step) || !step.keys) continue;
      const k = step.keys;
      expect(isWhite(k.lo) && isWhite(k.hi) && k.lo < k.hi, lesson.id).toBe(true);
      for (const m of k.marks) {
        expect(m.midi >= k.lo && m.midi <= k.hi, `${lesson.id} mark ${m.midi}`).toBe(true);
        if (m.finger !== undefined) expect([1, 2, 3, 4, 5]).toContain(m.finger);
      }
    }
  });

  it('draws staff pictures with notes in a readable range', () => {
    for (const { lesson, step } of steps) {
      if (!('staff' in step) || !step.staff) continue;
      const [lo, hi] = step.staff.clef === 'treble' ? [pitch('a3'), pitch('c6')] : [pitch('c2'), pitch('e4')];
      for (const n of step.staff.notes) {
        expect(isWhite(n), lesson.id).toBe(true);
        expect(n >= lo && n <= hi, `${lesson.id} ${n}`).toBe(true);
      }
    }
  });

  it('only refers to songs that exist', () => {
    const ids = new Set(BUILT_IN.map((s) => s.id));
    for (const { lesson, step } of steps) if (step.kind === 'song') expect(ids.has(step.songId), lesson.id).toBe(true);
  });

  it('has touch steps with prompts', () => {
    for (const { step } of steps) if (step.kind === 'touch') expect(step.prompts.length).toBeGreaterThan(0);
  });
});

describe('written music', () => {
  it('keeps every note in a playable range with sensible lengths', () => {
    for (const { lesson, step } of musicSteps) {
      expect(step.music.notes.length, lesson.id).toBeGreaterThan(0);
      expect(step.music.bpm >= 50 && step.music.bpm <= 120, lesson.id).toBe(true);
      for (const n of step.music.notes) {
        expect(n.midi >= pitch('c2') && n.midi <= pitch('c6'), `${lesson.id} ${n.midi}`).toBe(true);
        expect(n.beats > 0 && n.beats <= 8, lesson.id).toBe(true);
        // Lengths and starts sit on a half-beat grid.
        expect(Number.isInteger(n.beats * 2) && Number.isInteger(n.beat * 2), lesson.id).toBe(true);
      }
    }
  });

  it('uses finger numbers 1 to 5 only', () => {
    for (const { lesson, step } of musicSteps) {
      for (const n of step.music.notes) if (n.finger !== undefined) expect([1, 2, 3, 4, 5], lesson.id).toContain(n.finger);
    }
  });

  it('has fingerings that make physical sense for one hand', () => {
    // Within one hand, a higher finger number on the right hand means a higher key, and the
    // opposite on the left hand, for notes sounding together (chords).
    for (const { lesson, step } of musicSteps) {
      const byStart = new Map<string, CourseNote[]>();
      for (const n of step.music.notes) {
        if (n.finger === undefined) continue;
        const key = `${n.hand}:${n.beat}`;
        byStart.set(key, [...(byStart.get(key) ?? []), n]);
      }
      for (const group of byStart.values()) {
        const sorted = [...group].sort((a, b) => a.midi - b.midi);
        const fingers = sorted.map((n) => n.finger as number);
        const ok = sorted[0].hand === 'right' ? fingers.every((f, i) => i === 0 || f > fingers[i - 1]) : fingers.every((f, i) => i === 0 || f < fingers[i - 1]);
        expect(ok, `${lesson.id} chord fingers ${fingers}`).toBe(true);
      }
    }
  });

  it('only asks for hands the music has, and fits the computer keyboard', () => {
    for (const { lesson, step } of musicSteps) {
      if (step.kind === 'listen') continue;
      const notes = mine(step);
      expect(notes.length, `${lesson.id} ${step.title}`).toBeGreaterThan(0);
      if (step.hands === 'both') {
        expect(step.music.notes.some((n) => n.hand === 'left')).toBe(true);
        expect(step.music.notes.some((n) => n.hand === 'right')).toBe(true);
      }
      // The computer keyboard covers 29 keys from the C at or below the lowest note.
      const lo = Math.min(...notes.map((n) => n.midi));
      const hi = Math.max(...notes.map((n) => n.midi));
      expect(hi - Math.floor(lo / 12) * 12, `${lesson.id} ${step.title}`).toBeLessThanOrEqual(28);
    }
  });

  it('writes pieces in whole bars', () => {
    for (const { lesson, step } of musicSteps) {
      if (step.kind !== 'perform') continue;
      expect(phraseBeats(step.music) % step.music.beatsPerBar, lesson.id).toBe(0);
    }
  });

  it('never has one hand play two notes at once unless it is a chord with fingers for each', () => {
    for (const { lesson, step } of musicSteps) {
      for (const hand of ['right', 'left'] as const) {
        const notes = step.music.notes.filter((n) => n.hand === hand);
        for (let i = 1; i < notes.length; i++) {
          const a = notes[i - 1];
          const b = notes[i];
          if (a.beat === b.beat) continue; // chord
          // A new note starts only when the previous one has ended (melodies are one line).
          const ended = notes.filter((n) => n.beat < b.beat).every((n) => n.beat + n.beats <= b.beat + 1e-9);
          expect(ended, `${lesson.id} ${step.title} ${hand} at beat ${b.beat}`).toBe(true);
        }
      }
    }
  });

  it('plays chords that match the chord names written above them', () => {
    const SHAPES: Record<string, number[]> = { C: [0, 4, 7], F: [5, 9, 0], G: [7, 11, 2], Am: [9, 0, 4] };
    let checked = 0;
    for (const { lesson, step } of musicSteps) {
      for (const c of step.music.chords ?? []) {
        const left = step.music.notes.filter((n) => n.hand === 'left' && n.beat === c.beat);
        if (left.length < 3) continue;
        const pcs = new Set(left.map((n) => n.midi % 12));
        expect([...pcs].sort(), `${lesson.id} ${c.label} at ${c.beat}`).toEqual([...SHAPES[c.label]].sort());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

/**
 * Known tunes, spelled here by hand from memory of the traditional melodies,
 * independently of the course files. Each is compared with the melody of the
 * piece's performance step, pitch by pitch and (where given) beat by beat.
 */
const REFERENCE: { lesson: string; hand: 'right' | 'left'; notes: string; beats?: string }[] = [
  { lesson: 'piece-hot-cross-buns', hand: 'right', notes: 'e4 d4 c4 e4 d4 c4 c4 c4 c4 c4 d4 d4 d4 d4 e4 d4 c4', beats: '1 1 2 1 1 2 .5 .5 .5 .5 .5 .5 .5 .5 1 1 2' },
  {
    lesson: 'piece-mary',
    hand: 'right',
    notes: 'e4 d4 c4 d4 e4 e4 e4 d4 d4 d4 e4 g4 g4 e4 d4 c4 d4 e4 e4 e4 e4 d4 d4 e4 d4 c4',
    beats: '1 1 1 1 1 1 2 1 1 2 1 1 2 1 1 1 1 1 1 1 1 1 1 1 1 4',
  },
  {
    lesson: 'piece-jingle-bells',
    hand: 'right',
    notes:
      'e4 e4 e4 e4 e4 e4 e4 g4 c4 d4 e4 f4 f4 f4 f4 f4 e4 e4 e4 e4 e4 d4 d4 e4 d4 g4 ' +
      'e4 e4 e4 e4 e4 e4 e4 g4 c4 d4 e4 f4 f4 f4 f4 f4 e4 e4 e4 e4 g4 g4 f4 d4 c4',
  },
  {
    lesson: 'piece-lightly-row',
    hand: 'left',
    notes:
      'g3 e3 e3 f3 d3 d3 c3 d3 e3 f3 g3 g3 g3 g3 e3 e3 f3 d3 d3 c3 e3 g3 g3 c3 ' +
      'd3 d3 d3 d3 d3 e3 f3 e3 e3 e3 e3 e3 f3 g3 g3 e3 e3 f3 d3 d3 c3 e3 g3 g3 c3',
  },
  {
    lesson: 'piece-ode-to-joy',
    hand: 'right',
    notes: 'e4 e4 f4 g4 g4 f4 e4 d4 c4 c4 d4 e4 e4 d4 d4 e4 e4 f4 g4 g4 f4 e4 d4 c4 c4 d4 e4 d4 c4 c4',
    beats: '1 1 1 1 1 1 1 1 1 1 1 1 1.5 .5 2 1 1 1 1 1 1 1 1 1 1 1 1 1.5 .5 2',
  },
  {
    lesson: 'piece-twinkle',
    hand: 'right',
    notes:
      'c4 c4 g4 g4 a4 a4 g4 f4 f4 e4 e4 d4 d4 c4 g4 g4 f4 f4 e4 e4 d4 g4 g4 f4 f4 e4 e4 d4 ' +
      'c4 c4 g4 g4 a4 a4 g4 f4 f4 e4 e4 d4 d4 c4',
    beats: '1 1 1 1 1 1 2 1 1 1 1 1 1 2 1 1 1 1 1 1 2 1 1 1 1 1 1 2 1 1 1 1 1 1 2 1 1 1 1 1 1 2',
  },
  { lesson: 'piece-saints', hand: 'right', notes: 'c4 e4 f4 g4 c4 e4 f4 g4 c4 e4 f4 g4 e4 c4 e4 d4 e4 e4 d4 c4 c4 e4 g4 g4 f4 e4 f4 g4 e4 c4 d4 c4' },
  { lesson: 'piece-au-clair', hand: 'right', notes: 'c4 c4 c4 d4 e4 d4 c4 e4 d4 d4 c4 c4 c4 c4 d4 e4 d4 c4 e4 d4 d4 c4', beats: '1 1 1 1 2 2 1 1 1 1 4 1 1 1 1 2 2 1 1 1 1 4' },
  {
    lesson: 'piece-frere-jacques',
    hand: 'right',
    notes: 'c4 d4 e4 c4 c4 d4 e4 c4 e4 f4 g4 e4 f4 g4 g4 a4 g4 f4 e4 c4 g4 a4 g4 f4 e4 c4 c4 g3 c4 c4 g3 c4',
    beats: '1 1 1 1 1 1 1 1 1 1 2 1 1 2 .5 .5 .5 .5 1 1 .5 .5 .5 .5 1 1 1 1 2 1 1 2',
  },
];

describe('known tunes match an independent reference', () => {
  for (const ref of REFERENCE) {
    it(ref.lesson, () => {
      const lesson = findLesson(ref.lesson);
      expect(lesson).toBeDefined();
      const step = lesson!.steps.find((s): s is Extract<LessonStep, { kind: 'perform' }> => s.kind === 'perform');
      expect(step).toBeDefined();
      const melody = step!.music.notes.filter((n) => n.hand === ref.hand);
      expect(melody.map((n) => n.midi)).toEqual(pitches(ref.notes));
      if (ref.beats) expect(melody.map((n) => n.beats)).toEqual(ref.beats.trim().split(/\s+/).map(Number));
    });
  }

  it('teaches the same tune in the practice steps as in the performance', () => {
    for (const ref of REFERENCE) {
      const lesson = findLesson(ref.lesson)!;
      const perform = lesson.steps.find((s): s is MusicStep => s.kind === 'perform')!;
      const whole = perform.music.notes.filter((n) => n.hand === ref.hand).map((n) => n.midi);
      for (const s of lesson.steps) {
        if (!hasMusic(s) || s === perform) continue;
        const part = s.music.notes.filter((n) => n.hand === ref.hand).map((n) => n.midi);
        // Each practice step is the whole tune or a run of it.
        const text = (a: number[]) => `,${a.join(',')},`;
        expect(text(whole).includes(text(part)), `${lesson.id}: ${s.title}`).toBe(true);
      }
    }
  });

  it('matches the Ode to Joy tune in G position, moved up a fifth', () => {
    const step = findLesson('move-g-position')!.steps.find((s): s is MusicStep => s.kind === 'phrase')!;
    const expected = pitches('e4 e4 f4 g4 g4 f4 e4 d4 c4 c4 d4 e4 e4 d4 d4').map((m) => m + 7);
    // In G position, F becomes C, which is a perfect fifth for every note of this tune.
    expect(step.music.notes.map((n) => n.midi)).toEqual(expected);
  });
});

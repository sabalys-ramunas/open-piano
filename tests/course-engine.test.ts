import { describe, expect, it } from 'vitest';
import type { Instrument } from '../src/audio/instrument';
import { allLessons } from '../src/course/curriculum';
import { ExplainStep, FindStep, LessonRunner, PlayStep, QuizStep, TouchStep, type RunnerDeps, type StepController } from '../src/course/engine';
import { line, phrase } from '../src/course/music';
import type { Lesson, LessonStep } from '../src/course/types';
import { BUILT_IN } from '../src/songs';

function deps(): RunnerDeps & { played: number[] } {
  const played: number[] = [];
  const instrument: Instrument = {
    wake() {},
    noteOn() {},
    noteOff() {},
    play: (midi) => void played.push(midi),
    setVolume() {},
  };
  return { audio: { instrument }, songs: (id) => BUILT_IN.find((s) => s.id === id), played };
}

const lesson = (steps: LessonStep[]): Lesson => ({ id: 'test', title: 'Test', summary: 'A test lesson.', steps });

function current<T extends StepController>(runner: LessonRunner, type: new (...args: never[]) => T): T {
  const c = runner.current;
  if (!(c instanceof type)) throw new Error(`expected ${type.name}, got ${c?.constructor.name}`);
  return c;
}

/** Runs the session until Learn mode is holding for the next notes (or it finishes). */
function untilWaiting(p: PlayStep, limit = 2000): void {
  for (let i = 0; i < limit; i++) {
    const s = p.session!;
    if (s.game.waiting || !s.running) return;
    p.tick(0.05);
  }
  throw new Error('never waited');
}

const C = 60;
const D = 62;
const E = 64;

describe('find steps', () => {
  const step: LessonStep = { kind: 'find', title: 'Find', text: '', targets: [C, E], lo: 48, hi: 71 };

  it('says right and wrong, lights the key after two misses, and passes', () => {
    const r = new LessonRunner(lesson([step, { kind: 'explain', title: 'x', text: '' }]), deps());
    const f = current(r, FindStep);
    expect(f.target).toBe(C);

    r.press(D);
    expect(f.feedback?.kind).toBe('wrong');
    expect(f.feedback?.text).toContain('That is D');
    expect(f.feedback?.text).toContain('left');
    expect(f.hint).toBe(false);
    r.press(61); // a black key
    expect(f.feedback?.text).toContain('black key');
    expect(f.hint).toBe(true);
    expect(f.goodKeys()).toEqual([C]);

    r.press(C);
    expect(f.feedback?.kind).toBe('right');
    expect(f.hint).toBe(false);
    expect(f.target).toBe(E);

    // Not passed yet, so next() does nothing.
    r.next();
    expect(r.index).toBe(0);

    r.press(E);
    expect(f.status).toBe('passed');
    expect(f.feedback?.kind).toBe('done');
    expect(f.outcome?.accuracy).toBeCloseTo(0.8);
    r.next();
    expect(r.index).toBe(1);
  });

  it('accepts any octave and wants different keys when asked', () => {
    const r = new LessonRunner(lesson([{ kind: 'find', title: 'Cs', text: '', targets: [48, 60, 72], anyOctave: true, distinct: true, lo: 48, hi: 83 }]), deps());
    const f = current(r, FindStep);
    r.press(72);
    expect(f.found).toEqual([72]);
    r.press(72);
    expect(f.feedback?.text).toContain('already found');
    expect(f.found).toEqual([72]);
    expect(f.goodKeys()).toEqual([48, 60]);
    r.press(48);
    r.press(60);
    expect(f.status).toBe('passed');
  });

  it('can light the key from the start', () => {
    const r = new LessonRunner(lesson([{ ...step, hintAfter: 0 } as LessonStep]), deps());
    expect(current(r, FindStep).hint).toBe(true);
  });
});

describe('quiz steps', () => {
  it('lets the learner try again and scores the first try best', () => {
    const r = new LessonRunner(lesson([{ kind: 'quiz', title: 'Q', question: '?', choices: ['a', 'b', 'c'], answer: 2, why: 'Because.' }]), deps());
    const q = current(r, QuizStep);
    q.choose(0);
    expect(q.feedback?.kind).toBe('wrong');
    expect(q.status).toBe('active');
    q.choose(0); // same wrong answer again is ignored
    expect(q.tried.size).toBe(1);
    q.choose(2);
    expect(q.status).toBe('passed');
    expect(q.outcome?.accuracy).toBe(0.7);
    expect(q.feedback?.text).toContain('Because.');
  });
});

describe('touch steps', () => {
  const step: LessonStep = { kind: 'touch', title: 'T', text: '', prompts: ['soft', 'loud'] };

  it('needs a soft press and then a loud one from a piano that can tell', () => {
    const r = new LessonRunner(lesson([step]), deps());
    const t = current(r, TouchStep);
    r.press(C, 0.9, true);
    expect(t.feedback?.kind).toBe('wrong');
    expect(t.done).toBe(0);
    r.press(C, 0.3, true);
    expect(t.done).toBe(1);
    r.press(C, 0.5, true);
    expect(t.done).toBe(1);
    r.press(C, 0.8, true);
    expect(t.status).toBe('passed');
  });

  it('just counts presses from computer keys', () => {
    const r = new LessonRunner(lesson([step]), deps());
    const t = current(r, TouchStep);
    r.press(C, 0.8, false);
    r.press(C, 0.8, false);
    expect(t.status).toBe('passed');
    expect(t.sensitive).toBe(false);
  });
});

describe('play steps', () => {
  const music = phrase({ bpm: 120 }, line('right', 'C4/1@1 D4/1@2 E4/1@3'));

  it('waits for each right key, gives hints after two wrong keys, and passes', () => {
    const r = new LessonRunner(lesson([{ kind: 'phrase', title: 'P', text: '', music, hands: 'right' }]), deps());
    const p = current(r, PlayStep);
    expect(p.mode).toBe('wait');
    p.start();
    untilWaiting(p);
    expect(p.nextNotes().map((n) => [n.midi, n.finger])).toEqual([[C, 1]]);
    expect(p.expected().size).toBe(0);

    r.press(E);
    expect(p.feedback?.kind).toBe('wrong');
    expect(p.feedback?.text).toContain('Next is C');
    expect(p.hint).toBe(false);
    r.press(E);
    expect(p.hint).toBe(true);
    expect([...p.expected()]).toEqual([C]);

    r.press(C);
    expect(p.hint).toBe(false);
    expect(p.feedback?.kind).toBe('right');
    untilWaiting(p);
    r.press(D);
    untilWaiting(p);
    r.press(E);
    for (let i = 0; i < 200 && p.status === 'active'; i++) p.tick(0.05);
    expect(p.status).toBe('passed');
    // Two wrong keys cost a little (the exact cost belongs to the shared Game).
    expect(p.outcome?.accuracy).toBeGreaterThan(0.5);
    expect(p.outcome?.accuracy).toBeLessThan(1);
    expect(p.last?.wrong).toBe(2);
    r.next();
    expect(r.done).toBe(true);
    expect(r.stars()).toBeGreaterThanOrEqual(2);
  });

  it('asks to try again after a weak try in time, never forces it, and keeps the best', () => {
    const r = new LessonRunner(lesson([{ kind: 'timed', title: 'T', text: '', music, hands: 'right', pass: 0.6 }]), deps());
    const p = current(r, PlayStep);
    expect(p.mode).toBe('flow');
    expect(p.leadBeats).toBe(4);
    p.start();
    for (let i = 0; i < 400 && p.running; i++) p.tick(0.05);
    expect(p.status).toBe('retry');
    expect(p.attempts).toBe(1);
    expect(p.feedback?.kind).toBe('info');

    p.restart(0.75);
    expect(p.status).toBe('active');
    expect(p.speed).toBe(0.75);
    expect(p.session!.options.speed).toBe(0.75);

    p.moveOn();
    expect(p.status).toBe('passed');
    r.next();
    expect(r.done).toBe(true);
    expect(r.state.outcomes[0]).toEqual({ passed: true, accuracy: 0 });
    // Finishing always earns at least one star.
    expect(r.stars()).toBe(1);
  });

  it('plays the other hand for the learner', () => {
    const both = phrase({ bpm: 120 }, line('right', 'C4/1@1 D4/1@2'), line('left', 'C3/2@5'));
    const d = deps();
    const r = new LessonRunner(lesson([{ kind: 'phrase', title: 'P', text: '', music: both, hands: 'right' }]), d);
    const p = current(r, PlayStep);
    p.start();
    untilWaiting(p);
    expect(d.played).toContain(48);
  });

  it('listen steps pass by listening, and can be skipped without losing stars', () => {
    const r = new LessonRunner(lesson([{ kind: 'listen', title: 'L', text: '', music, hands: 'both' }, { kind: 'explain', title: 'x', text: '' }]), deps());
    r.skip();
    expect(r.state.outcomes[0]).toEqual({ passed: false, skipped: true });
    r.back();
    const p = current(r, PlayStep);
    p.start();
    for (let i = 0; i < 400 && p.status === 'active'; i++) p.tick(0.05);
    expect(p.status).toBe('passed');
  });

  it('handles a library song that is missing', () => {
    const r = new LessonRunner(lesson([{ kind: 'song', title: 'S', text: '', songId: 'nope', hands: 'right', pass: 0.5 }]), deps());
    const p = current(r, PlayStep);
    expect(p.missing).toBe(true);
    r.skip();
    expect(r.done).toBe(true);
  });
});

describe('lesson runner', () => {
  it('counts skipped scored steps as zero, and stops sound when moving on', () => {
    const r = new LessonRunner(
      lesson([
        { kind: 'explain', title: 'x', text: '' },
        { kind: 'quiz', title: 'Q', question: '?', choices: ['a', 'b'], answer: 0, why: 'ok' },
      ]),
      deps(),
    );
    expect(current(r, ExplainStep)).toBeInstanceOf(ExplainStep);
    const seen: number[] = [];
    const off = r.subscribe((s) => seen.push(s.index));
    r.next();
    r.skip();
    off();
    expect(seen).toEqual([1, 2]);
    expect(r.done).toBe(true);
    expect(r.current).toBeNull();
    expect(r.state.outcomes[1]).toEqual({ passed: false, skipped: true, accuracy: 0 });
    // Its only practice step was skipped, so the whole lesson counts as skipped: no stars.
    expect(r.result()).toEqual({ completed: false, skipped: true, stars: 0 });
    expect(r.stars()).toBe(0);
  });

  it('marks a lesson skipped when every step was skipped, and never gives it a star', () => {
    for (const l of allLessons()) {
      const r = new LessonRunner(l, deps());
      while (!r.done) {
        if (r.current instanceof ExplainStep) r.next();
        else r.skip();
      }
      expect(r.result(), l.id).toEqual({ completed: false, skipped: true, stars: 0 });
      r.destroy();
    }
  });

  it('completes a lesson when more than half of its practice was done, scoring skipped steps as zero', () => {
    const quiz = (q: string): LessonStep => ({ kind: 'quiz', title: q, question: '?', choices: ['a', 'b'], answer: 0, why: 'ok' });
    const steps = [{ kind: 'explain', title: 'x', text: '' } as LessonStep, quiz('1'), quiz('2'), quiz('3'), quiz('4')];
    const run = (answered: number) => {
      const r = new LessonRunner(lesson(steps), deps());
      r.next();
      for (let i = 0; i < 4; i++) {
        if (i < answered) {
          current(r, QuizStep).choose(0);
          r.next();
        } else r.skip();
      }
      return r.result();
    };
    expect(run(4)).toEqual({ completed: true, skipped: false, stars: 3 });
    // 3 of 4 done: average 0.75 gives two stars.
    expect(run(3)).toEqual({ completed: true, skipped: false, stars: 2 });
    // Half is not enough.
    expect(run(2)).toEqual({ completed: false, skipped: true, stars: 0 });
    expect(run(0)).toEqual({ completed: false, skipped: true, stars: 0 });
  });

  it('counts a lesson with nothing to practise as complete', () => {
    const music = phrase({ bpm: 120 }, line('right', 'C4/1@1'));
    const r = new LessonRunner(lesson([{ kind: 'explain', title: 'x', text: '' }, { kind: 'listen', title: 'L', text: '', music, hands: 'both' }]), deps());
    r.next();
    r.skip();
    // Listening is not scored, so nothing pulls the stars down.
    expect(r.result()).toEqual({ completed: true, skipped: false, stars: 3 });
    // A missing library song is not practice the learner could have done.
    const s = new LessonRunner(lesson([{ kind: 'song', title: 'S', text: '', songId: 'nope', hands: 'right', pass: 0.5 }]), deps());
    expect(s.practiceSteps()).toEqual([]);
    s.skip();
    expect(s.result().completed).toBe(true);
  });

  it('is not done, and has no result, part way through', () => {
    const r = new LessonRunner(allLessons()[0], deps());
    expect(r.result()).toEqual({ completed: false, skipped: false, stars: 0 });
    r.destroy();
  });

  it('can jump to a step to pick up where the learner left off', () => {
    const l = allLessons()[0];
    const r = new LessonRunner(l, deps());
    r.goTo(3);
    expect(r.index).toBe(3);
    expect(r.current?.step).toBe(l.steps[3]);
    r.destroy();
  });
});

/** Plays every step of a lesson perfectly, the way an attentive learner would. */
function playPerfectly(l: Lesson): LessonRunner {
  const r = new LessonRunner(l, deps());
  let guard = 0;
  while (!r.done) {
    if (++guard > 100) throw new Error(`${l.id} did not finish`);
    const c = r.current!;
    if (c instanceof ExplainStep) {
      r.next();
      continue;
    }
    if (c instanceof FindStep) {
      while (c.status === 'active') r.press(c.goodKeys()[0]);
    } else if (c instanceof QuizStep) {
      c.choose(c.step.answer);
    } else if (c instanceof TouchStep) {
      while (c.status === 'active') r.press(60, c.prompt === 'soft' ? 0.3 : 0.9, true);
    } else if (c instanceof PlayStep) {
      expect(c.missing, `${l.id} ${c.step.title}`).toBe(false);
      c.start();
      const s = c.session!;
      for (let i = 0; i < 20000 && c.status === 'active'; i++) {
        c.tick(0.02);
        const g = s.game;
        if (c.mode === 'wait') {
          if (g.waiting) for (const n of c.nextNotes()) r.press(n.midi);
        } else if (c.mode === 'flow') {
          for (let k = 0; k < g.notes.length; k++) if (g.state[k] === 'pending' && g.notes[k].start <= g.time) r.press(g.notes[k].midi);
        }
      }
      expect(c.status, `${l.id} ${c.step.title}`).toBe('passed');
      if (c.mode !== 'listen') expect(c.last?.wrong, `${l.id} ${c.step.title}`).toBe(0);
    }
    expect(c.status, `${l.id} ${c.step.title}`).toBe('passed');
    r.next();
  }
  return r;
}

describe('every lesson can be finished', () => {
  for (const l of allLessons()) {
    it(`${l.id} gives three stars to a perfect player`, () => {
      const r = playPerfectly(l);
      expect(r.stars()).toBe(3);
      r.destroy();
    });
  }
});

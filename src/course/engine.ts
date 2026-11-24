import { starsFor } from '../app/progress';
import type { Stars } from '../app/store';
import type { Instrument } from '../audio/instrument';
import type { Mode } from '../player/game';
import { Session, type Backing } from '../player/session';
import { isBlack, noteName, type Song } from '../song';
import { courseNoteFor, toSong } from './music';
import type { CourseNote, Lesson, LessonStep, Loudness, Phrase } from './types';

/** How a finished run through a lesson went. */
export interface LessonResult {
  completed: boolean;
  /** Most practice was skipped: no stars, not counted as done. */
  skipped: boolean;
  stars: Stars;
}

export interface StepOutcome {
  passed: boolean;
  /** 0..1 for steps that are scored. Unscored steps (explanations, listening) leave it out. */
  accuracy?: number;
  /** Moved past without doing it. */
  skipped?: boolean;
}

export type FeedbackKind = 'right' | 'wrong' | 'done' | 'info';

/** What to tell the learner after something happened. Always kind, never a telling-off. */
export interface Feedback {
  kind: FeedbackKind;
  text: string;
  midi?: number;
}

export interface RunnerDeps {
  audio: { readonly instrument: Instrument };
  /** Looks up library songs for `song` steps. */
  songs?: (id: string) => Song | undefined;
  /** Makes the audio element a Session plays recordings with. Tests leave it out. */
  backing?: () => Backing | undefined;
}

/** Velocity at or below which a press counts as soft, and at or above which it counts as loud. */
export const SOFT_MAX = 0.45;
export const LOUD_MIN = 0.62;

/** How a key's name is said to a learner. */
export function sayKey(midi: number): string {
  return isBlack(midi) ? 'a black key' : noteName(midi);
}

function direction(pressed: number, target: number): string {
  if (pressed === target) return '';
  const far = Math.abs(pressed - target) >= 12;
  if (pressed < target) return far ? 'Go higher, to the right.' : 'Go a little to the right.';
  return far ? 'Go lower, to the left.' : 'Go a little to the left.';
}

type Notify = () => void;

abstract class BaseStep<S extends LessonStep> {
  /** 'retry' only happens on play-in-time steps that missed the target. */
  status: 'active' | 'passed' | 'retry' = 'active';
  outcome: StepOutcome | undefined;
  feedback: Feedback | null = null;

  constructor(
    readonly step: S,
    protected notify: Notify,
  ) {}

  protected pass(outcome: Omit<StepOutcome, 'passed'> = {}): void {
    this.status = 'passed';
    this.outcome = { passed: true, ...outcome };
  }

  /** Notes from any input. Most steps ignore velocity. */
  press(midi: number, velocity: number, sensitive: boolean): void {
    void midi;
    void velocity;
    void sensitive;
  }

  destroy(): void {}
}

export class ExplainStep extends BaseStep<Extract<LessonStep, { kind: 'explain' }>> {
  readonly kind = 'explain';

  /** Read it: done. */
  ok(): void {
    this.markRead();
    this.notify();
  }

  /** Same as ok, without telling listeners (the runner moves on right after). */
  markRead(): void {
    if (this.status !== 'passed') this.pass();
  }
}

export class FindStep extends BaseStep<Extract<LessonStep, { kind: 'find' }>> {
  readonly kind = 'find';
  /** Keys found so far, in order. */
  readonly found: number[] = [];
  /** Wrong presses in the whole step. */
  misses = 0;
  /** Wrong presses since the last right one. */
  wrongStreak = 0;

  get hintAfter(): number {
    return this.step.hintAfter ?? 2;
  }

  /** The target being looked for now, or undefined when all are found. */
  get target(): number | undefined {
    return this.step.targets[this.found.length];
  }

  /** True when the key should light up. */
  get hint(): boolean {
    return this.status === 'active' && this.wrongStreak >= this.hintAfter;
  }

  private matches(midi: number, target: number): boolean {
    if (this.step.anyOctave) {
      if ((midi - target) % 12 !== 0) return false;
      return !(this.step.distinct && this.found.includes(midi));
    }
    return midi === target;
  }

  /** Keys that would count right now, within the drawn keyboard. */
  goodKeys(): number[] {
    const t = this.target;
    if (t === undefined) return [];
    const out: number[] = [];
    for (let m = this.step.lo; m <= this.step.hi; m++) if (this.matches(m, t)) out.push(m);
    return out;
  }

  override press(midi: number): void {
    const t = this.target;
    if (t === undefined || this.status !== 'active') return;
    if (this.matches(midi, t)) {
      this.found.push(midi);
      this.wrongStreak = 0;
      if (this.target === undefined) {
        this.pass({ accuracy: Math.max(0.5, 1 - 0.1 * this.misses) });
        this.feedback = { kind: 'done', midi, text: `Yes, that is ${noteName(midi)}! You found ${this.found.length > 1 ? 'them all' : 'it'}.` };
      } else {
        const next = this.target as number;
        const same = (next - midi) % 12 === 0;
        this.feedback = {
          kind: 'right',
          midi,
          text: same ? `Yes, that is ${noteName(midi)}! Now find another one.` : `Yes, that is ${noteName(midi)}! Now find ${noteName(next)}.`,
        };
      }
    } else {
      this.misses++;
      this.wrongStreak++;
      let text: string;
      if (this.step.anyOctave && this.step.distinct && this.found.includes(midi)) {
        text = `You already found that ${noteName(midi)}. Look for a different one.`;
      } else {
        const where = this.step.anyOctave ? '' : ` ${direction(midi, t)}`;
        text = `That is ${sayKey(midi)}, not ${noteName(t)}.${where}`;
      }
      if (this.hint) text += ' Look for the glowing key.';
      this.feedback = { kind: 'wrong', midi, text };
    }
    this.notify();
  }
}

export class QuizStep extends BaseStep<Extract<LessonStep, { kind: 'quiz' }>> {
  readonly kind = 'quiz';
  /** Choices already tried that were not right. */
  readonly tried = new Set<number>();

  choose(choice: number): void {
    if (this.status !== 'active' || this.tried.has(choice)) return;
    if (choice === this.step.answer) {
      const accuracy = this.tried.size === 0 ? 1 : this.tried.size === 1 ? 0.7 : 0.5;
      this.pass({ accuracy });
      this.feedback = { kind: 'done', text: `${this.tried.size === 0 ? 'Right!' : 'You got it!'} ${this.step.why}` };
    } else {
      this.tried.add(choice);
      this.feedback = { kind: 'wrong', text: this.tried.size === 1 ? 'Not quite. Have another look!' : 'Not that one either. You are close!' };
    }
    this.notify();
  }
}

export class TouchStep extends BaseStep<Extract<LessonStep, { kind: 'touch' }>> {
  readonly kind = 'touch';
  /** Prompts done so far. */
  done = 0;
  /** Velocity of the last press, 0..1, for a loudness meter. */
  lastVelocity: number | null = null;
  /** Whether the last input could tell soft from loud. Computer keys and the screen cannot. */
  sensitive = true;

  get prompt(): Loudness | undefined {
    return this.step.prompts[this.done];
  }

  override press(midi: number, velocity: number, sensitive: boolean): void {
    void midi;
    const want = this.prompt;
    if (want === undefined || this.status !== 'active') return;
    this.lastVelocity = velocity;
    this.sensitive = sensitive;
    const ok = !sensitive || (want === 'soft' ? velocity <= SOFT_MAX : velocity >= LOUD_MIN);
    if (ok) {
      this.done++;
      if (this.prompt === undefined) {
        this.pass();
        this.feedback = { kind: 'done', text: sensitive ? 'Lovely. You can play soft and loud!' : 'Done. On a real piano your touch changes the sound.' };
      } else {
        this.feedback = { kind: 'right', text: want === 'soft' ? 'Nice and gentle!' : 'Big and strong!' };
      }
    } else {
      this.feedback = { kind: 'wrong', text: want === 'soft' ? 'A little gentler. Let the key go down slowly.' : 'A little stronger. Drop your finger into the key.' };
    }
    this.notify();
  }
}

export type PlayKind = 'listen' | 'phrase' | 'timed' | 'perform' | 'song';
type PlayLessonStep = Extract<LessonStep, { kind: PlayKind }>;

const MODE: Record<PlayKind, Mode> = { listen: 'listen', phrase: 'wait', timed: 'flow', perform: 'flow', song: 'flow' };

/** Plays music on the shared Session and judges it. The screen draws `session`. */
export class PlayStep extends BaseStep<PlayLessonStep> {
  readonly kind: PlayKind;
  readonly mode: Mode;
  /** Undefined only for a `song` step whose song is not in the library. */
  readonly song: Song | undefined;
  readonly session: Session | undefined;
  /** Silent beats before the first note (a count-in for steps played in time). */
  readonly leadBeats: number;
  speed = 1;
  attempts = 0;
  best = 0;
  last: { accuracy: number; hit: number; missed: number; wrong: number } | null = null;
  wrongStreak = 0;
  private offs: (() => void)[] = [];

  constructor(step: PlayLessonStep, notify: Notify, deps: RunnerDeps, id: string) {
    super(step, notify);
    this.kind = step.kind;
    this.mode = MODE[step.kind];
    if (step.kind === 'song') {
      this.leadBeats = 0;
      this.song = deps.songs?.(step.songId);
    } else {
      this.leadBeats = this.mode === 'flow' ? step.music.beatsPerBar : 0;
      this.song = toSong(step.music, `course:${id}`, step.title, this.leadBeats);
    }
    if (!this.song) {
      this.session = undefined;
      return;
    }
    const backing = deps.backing?.();
    this.session = new Session(
      backing ? { audio: deps.audio, backing } : { audio: deps.audio },
      this.song,
      { mode: this.mode, hands: step.hands, speed: this.speed },
    );
    const s = this.session;
    this.offs.push(
      s.on('hit', () => {
        this.wrongStreak = 0;
        this.feedback = { kind: 'right', text: 'Yes!' };
        this.notify();
      }),
      s.on('wrong', ({ midi }) => {
        this.wrongStreak++;
        let text = `That was ${sayKey(midi)}.`;
        const next = this.nextNotes()[0];
        if (this.mode === 'wait' && next) text += ` Next is ${noteName(next.midi)}. ${direction(midi, next.midi)}`;
        if (this.hint) text += ' The key to press is lit up.';
        this.feedback = { kind: 'wrong', midi, text: text.trim() };
        this.notify();
      }),
      s.on('finished', ({ result }) => this.finished(result)),
      s.on('running', () => this.notify()),
    );
  }

  /** The written music behind this step, when it has its own. */
  get music(): Phrase | undefined {
    return this.step.kind === 'song' ? undefined : this.step.music;
  }

  get hintAfter(): number {
    return this.step.kind === 'phrase' ? (this.step.hintAfter ?? 2) : 2;
  }

  /** True when the next keys should light up. */
  get hint(): boolean {
    if (this.mode === 'listen') return false;
    return this.hintAfter === 0 || this.wrongStreak >= this.hintAfter;
  }

  get missing(): boolean {
    return !this.session;
  }

  get running(): boolean {
    return this.session?.running ?? false;
  }

  /** The keys the learner should press next (with their written fingers). */
  nextNotes(): CourseNote[] {
    const s = this.session;
    if (!s || this.mode === 'listen') return [];
    const game = s.game;
    const music = this.music;
    return game.nextGroup().map((i) => {
      const n = game.notes[i];
      return (music && courseNoteFor(music, n, this.leadBeats)) ?? { midi: n.midi, beat: 0, beats: 1, hand: n.hand };
    });
  }

  /** Keys to light up on the stage now. */
  expected(): Set<number> {
    if (!this.hint || !this.session) return new Set();
    return new Set(this.nextNotes().map((n) => n.midi));
  }

  /** Start, pause or continue. */
  toggle(): void {
    if (!this.session) return;
    if (this.status === 'retry' || (this.status === 'passed' && this.session.game.finished)) this.restart();
    this.session.toggle();
    this.notify();
  }

  start(): void {
    if (this.session && !this.session.running) this.toggle();
  }

  /** Back to the top, paused, optionally at a new speed (0.5..1). */
  restart(speed = this.speed): void {
    if (!this.session) return;
    this.speed = Math.min(1, Math.max(0.5, speed));
    this.wrongStreak = 0;
    this.feedback = null;
    if (this.status === 'retry') this.status = 'active';
    this.session.load(this.session.song, { speed: this.speed });
    this.notify();
  }

  override press(midi: number): void {
    this.session?.press(midi);
  }

  tick(dt: number): void {
    this.session?.tick(dt);
  }

  /** After a try that missed the mark: carry on anyway, keeping the best score. */
  moveOn(): void {
    if (this.status === 'passed') return;
    this.pass({ accuracy: this.best });
    this.notify();
  }

  private finished(result: { accuracy: number; hit: number; missed: number; wrong: number }): void {
    if (this.mode === 'listen') {
      if (this.status !== 'passed') this.pass();
      this.feedback = { kind: 'done', text: 'Now you know how it goes!' };
      this.notify();
      return;
    }
    this.attempts++;
    this.last = { accuracy: result.accuracy, hit: result.hit, missed: result.missed, wrong: result.wrong };
    // Playing slower still counts, but full speed is what earns full marks.
    const scored = result.accuracy * (this.speed >= 1 ? 1 : 0.85 + 0.15 * this.speed);
    this.best = Math.max(this.best, scored);
    const percent = Math.round(result.accuracy * 100);
    if (this.step.kind === 'phrase') {
      this.pass({ accuracy: this.best });
      this.feedback = { kind: 'done', text: result.wrong === 0 ? 'Perfect, every key right!' : 'You played it all the way through!' };
    } else if (result.accuracy >= ('pass' in this.step ? this.step.pass : 0)) {
      this.pass({ accuracy: this.best });
      this.feedback = { kind: 'done', text: percent >= 90 ? `Wonderful! ${percent}% right.` : `Well played! ${percent}% right.` };
    } else {
      this.status = 'retry';
      this.feedback = {
        kind: 'info',
        text: `${percent}% right. Every try makes it easier!`,
      };
    }
    this.notify();
  }

  override destroy(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.session?.destroy();
  }
}

export type StepController = ExplainStep | FindStep | QuizStep | TouchStep | PlayStep;

export function createController(step: LessonStep, notify: Notify, deps: RunnerDeps, id: string): StepController {
  switch (step.kind) {
    case 'explain':
      return new ExplainStep(step, notify);
    case 'find':
      return new FindStep(step, notify);
    case 'quiz':
      return new QuizStep(step, notify);
    case 'touch':
      return new TouchStep(step, notify);
    default:
      return new PlayStep(step, notify, deps, id);
  }
}

export interface LessonRunnerState {
  lesson: Lesson;
  /** Current step, or steps.length once the lesson is finished. */
  index: number;
  step: LessonStep | undefined;
  /** Outcome of each step so far, by index. */
  outcomes: (StepOutcome | undefined)[];
  /** Every step has been passed or moved past. */
  done: boolean;
}

/**
 * Walks through a lesson's steps. It draws nothing: the course screen renders
 * `current` and passes key presses in with `press`.
 */
export class LessonRunner {
  private outcomes: (StepOutcome | undefined)[] = [];
  private i = 0;
  private ctl: StepController | null;
  private listeners = new Set<(state: LessonRunnerState) => void>();
  private destroyed = false;

  constructor(
    readonly lesson: Lesson,
    private deps: RunnerDeps,
  ) {
    if (lesson.steps.length === 0) throw new Error(`Lesson ${lesson.id} has no steps`);
    this.ctl = this.make(0);
  }

  get index(): number {
    return this.i;
  }

  get done(): boolean {
    return this.i >= this.lesson.steps.length;
  }

  /** The controller of the current step; null once the lesson is done. */
  get current(): StepController | null {
    return this.ctl;
  }

  get state(): LessonRunnerState {
    return {
      lesson: this.lesson,
      index: this.i,
      step: this.lesson.steps[this.i],
      outcomes: [...this.outcomes],
      done: this.done,
    };
  }

  /** A key went down on any input. `sensitive` says whether the input knows how hard it was pressed. */
  press(midi: number, velocity = 0.8, sensitive = false): void {
    this.ctl?.press(midi, velocity, sensitive);
  }

  /** Moves on when the current step is passed. Explanations pass by moving on. */
  next(): void {
    const c = this.ctl;
    if (!c) return;
    if (c instanceof ExplainStep && c.status !== 'passed') c.markRead();
    if (c.status !== 'passed') return;
    this.outcomes[this.i] = c.outcome;
    this.goTo(this.i + 1);
  }

  /** Moves past the current step without doing it. Scored steps then count as 0. */
  skip(): void {
    const c = this.ctl;
    if (!c) return;
    if (c.status === 'passed') return this.next();
    const scored = !(c instanceof ExplainStep) && !(c instanceof TouchStep) && !(c instanceof PlayStep && (c.kind === 'listen' || c.missing));
    this.outcomes[this.i] = scored ? { passed: false, skipped: true, accuracy: 0 } : { passed: false, skipped: true };
    this.goTo(this.i + 1);
  }

  back(): void {
    if (this.i > 0) this.goTo(this.i - 1);
  }

  /** Jumps to a step, e.g. to pick up where the learner left off. */
  goTo(index: number): void {
    if (this.destroyed) return;
    this.ctl?.destroy();
    this.i = Math.max(0, Math.min(index, this.lesson.steps.length));
    this.outcomes.length = Math.min(this.outcomes.length, this.lesson.steps.length);
    this.ctl = this.done ? null : this.make(this.i);
    this.emit();
  }

  /**
   * Steps the learner actually practises: everything but explanations,
   * listening, and a library song that is not there.
   */
  practiceSteps(): number[] {
    const out: number[] = [];
    this.lesson.steps.forEach((s, i) => {
      if (s.kind === 'explain' || s.kind === 'listen') return;
      if (s.kind === 'song' && !this.deps.songs?.(s.songId)) return;
      out.push(i);
    });
    return out;
  }

  /**
   * How the lesson went, once it is done. It counts as completed when the
   * learner did more than half of its practice steps (a step done with "move
   * on" after a try counts); skipped steps then score zero. Otherwise it was
   * skipped: no stars, and the learner may still move ahead.
   */
  result(): LessonResult {
    if (!this.done) return { completed: false, skipped: false, stars: 0 };
    const practice = this.practiceSteps();
    const did = practice.filter((i) => this.outcomes[i]?.passed).length;
    if (practice.length > 0 && did * 2 <= practice.length) return { completed: false, skipped: true, stars: 0 };
    const scored = this.outcomes.filter((o): o is StepOutcome & { accuracy: number } => o?.accuracy !== undefined).map((o) => o.accuracy);
    const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 1;
    return { completed: true, skipped: false, stars: Math.max(1, starsFor(avg)) as Stars };
  }

  /** Stars for the whole lesson: 0 until it is done or when it was skipped, at least 1 for finishing. */
  stars(): Stars {
    return this.result().stars;
  }

  subscribe(listener: (state: LessonRunnerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    this.ctl?.destroy();
    this.ctl = null;
    this.listeners.clear();
  }

  private make(index: number): StepController {
    const step = this.lesson.steps[index];
    return createController(step, () => this.emit(), this.deps, `${this.lesson.id}:${index}`);
  }

  private emit(): void {
    const s = this.state;
    for (const l of [...this.listeners]) l(s);
  }
}

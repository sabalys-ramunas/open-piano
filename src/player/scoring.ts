import type { Hand } from '../song';
import type { Mode } from './game';
import type { Session } from './session';

/** How well a right note was timed. */
export type Grade = 'perfect' | 'good' | 'early' | 'late';
export const GRADES: readonly Grade[] = ['perfect', 'good', 'early', 'late'];
export const GRADE_LABEL: Record<Grade, string> = { perfect: 'Perfect', good: 'Good', early: 'Early', late: 'Late' };

/** Timing windows in real seconds (not song seconds), so slowing the song down does not make timing stricter. */
export const PERFECT_WINDOW = 0.07;
export const GOOD_WINDOW = 0.14;
export const POINTS: Record<Grade, number> = { perfect: 100, good: 70, early: 40, late: 40 };
export const MAX_MULTIPLIER = 4;
/** Right notes in a row needed for each step of the multiplier. */
export const COMBO_STEP = 10;

/**
 * Grades a hit from its timing error (song seconds, negative is early).
 * In Learn mode the song waits for you, so a press is never late, and
 * anything the song accepted is at least "good": waiting is never penalised.
 */
export function gradeFor(error: number, mode: Mode, speed = 1): Grade {
  const real = error / (speed > 0 ? speed : 1);
  const off = Math.abs(real);
  if (mode === 'wait') return off <= GOOD_WINDOW ? 'perfect' : 'good';
  if (off <= PERFECT_WINDOW) return 'perfect';
  if (off <= GOOD_WINDOW) return 'good';
  return real < 0 ? 'early' : 'late';
}

/** Score multiplier for a combo: x1, then one step more every 10 in a row, up to x4. */
export function multiplierFor(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(Math.max(0, combo) / COMBO_STEP));
}

const MILESTONES: [number, string][] = [
  [10, '10 in a row!'],
  [25, 'Making waves! 25 in a row'],
  [50, 'Smooth sailing! 50 in a row'],
  [100, 'Wow! 100 in a row'],
  [200, 'Superstar! 200 in a row'],
];

/** Short encouraging words for a moment worth celebrating, or null. */
export function calloutFor(combo: number, perfectRun: number, missRun: number, mode: Mode): string | null {
  for (const [at, text] of MILESTONES) if (combo === at) return text;
  if (combo > 200 && combo % 100 === 0) return `${combo} in a row!`;
  if (perfectRun > 0 && perfectRun % 8 === 0) return 'Right on the beat!';
  if (missRun === 3) return mode === 'flow' ? 'Tricky bit? Try it slower' : 'No rush. Take your time';
  return null;
}

/** Timing errors (real milliseconds) from -250 to +250 in 50 ms bins, with the ends catching everything beyond. */
export const HISTOGRAM_BINS = 10;
export const HISTOGRAM_SPAN_MS = 250;
export function histogramBin(errorMs: number): number {
  const width = (HISTOGRAM_SPAN_MS * 2) / HISTOGRAM_BINS;
  const i = Math.floor((errorMs + HISTOGRAM_SPAN_MS) / width);
  return Math.max(0, Math.min(HISTOGRAM_BINS - 1, i));
}

export interface Judgement {
  grade: Grade;
  points: number;
  combo: number;
  multiplier: number;
  callout: string | null;
}

/** Pure score keeping: feed it hits, misses and wrong keys. No timers, no DOM. */
export class Scorer {
  score = 0;
  combo = 0;
  bestCombo = 0;
  hits = 0;
  misses = 0;
  wrong = 0;
  grades: Record<Grade, number> = { perfect: 0, good: 0, early: 0, late: 0 };
  histogram: number[] = new Array<number>(HISTOGRAM_BINS).fill(0);
  private perfectRun = 0;
  private missRun = 0;

  constructor(public mode: Mode = 'wait') {}

  reset(mode: Mode = this.mode): void {
    this.mode = mode;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.wrong = 0;
    this.grades = { perfect: 0, good: 0, early: 0, late: 0 };
    this.histogram.fill(0);
    this.perfectRun = 0;
    this.missRun = 0;
  }

  hit(error: number, speed = 1): Judgement {
    const grade = gradeFor(error, this.mode, speed);
    this.hits++;
    this.grades[grade]++;
    this.combo++;
    this.missRun = 0;
    this.perfectRun = grade === 'perfect' ? this.perfectRun + 1 : 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (this.mode !== 'wait') this.histogram[histogramBin((error / (speed > 0 ? speed : 1)) * 1000)]++;
    const multiplier = multiplierFor(this.combo);
    const points = POINTS[grade] * multiplier;
    this.score += points;
    return { grade, points, combo: this.combo, multiplier, callout: calloutFor(this.combo, this.perfectRun, 0, this.mode) };
  }

  /** A note went by unplayed (Play along mode only). */
  miss(): string | null {
    this.misses++;
    this.combo = 0;
    this.perfectRun = 0;
    this.missRun++;
    return calloutFor(0, 0, this.missRun, this.mode);
  }

  /** A key that was not wanted. Breaks the combo in Play along; in Learn mode trying keys is fine. */
  wrongKey(): void {
    this.wrong++;
    if (this.mode === 'flow') {
      this.combo = 0;
      this.perfectRun = 0;
    }
  }

  get multiplier(): number {
    return multiplierFor(this.combo);
  }

  /** Accuracy so far over the notes judged, same rule as Game.result: wrong keys cost a little. */
  get accuracy(): number {
    const total = this.hits + this.misses;
    if (total === 0) return 1;
    const cost = this.mode === 'flow' ? 0.25 : this.mode === 'wait' ? 0.15 : 0;
    return Math.max(0, this.hits - this.wrong * cost) / total;
  }

  /** Notes judged so far: hit or missed. */
  get judged(): number {
    return this.hits + this.misses;
  }
}

/** A mistake and when it happened, in song seconds. */
export interface Mistake {
  time: number;
  kind: 'miss' | 'wrong' | 'timing';
}

export interface ScoreEvent {
  kind: 'hit' | 'miss' | 'wrong';
  judgement: Judgement | null;
  callout: string | null;
  midi: number;
  /** The hand of the note, for colouring. 'right' for wrong keys. */
  hand: Hand;
  time: number;
}

export type ScoreListener = (e: ScoreEvent, cleared: boolean) => void;

/**
 * Wires a Scorer to a session and keeps a log of mistakes for the progress
 * bar, "loop the last mistake" and "practise the tricky part". Everything it
 * learns is passed on to `onScore` listeners (the HUD, the effects).
 */
export class ScoreKeeper {
  readonly scorer: Scorer;
  readonly mistakes: Mistake[] = [];
  /** True once the player has jumped around, looped or previewed: the run is practice, not a full play. */
  practised = false;
  private listeners = new Set<ScoreListener>();
  private offs: (() => void)[];

  constructor(private session: Session) {
    this.scorer = new Scorer(session.options.mode);
    this.offs = [
      session.on('reset', ({ options }) => {
        this.scorer.reset(options.mode);
        this.mistakes.length = 0;
        this.practised = false;
        this.notify({ kind: 'miss', judgement: null, callout: null, midi: -1, hand: 'right', time: 0 }, true);
      }),
      session.on('seek', () => (this.practised = true)),
      session.on('looping', () => (this.practised = true)),
      session.on('preview', () => (this.practised = true)),
      session.on('hit', (e) => {
        const j = this.scorer.hit(e.error, this.session.options.speed);
        if (j.grade === 'early' || j.grade === 'late') this.mistakes.push({ time: e.note.start, kind: 'timing' });
        this.notify({ kind: 'hit', judgement: j, callout: j.callout, midi: e.note.midi, hand: e.note.hand, time: e.time });
      }),
      session.on('miss', (e) => {
        const callout = this.scorer.miss();
        this.mistakes.push({ time: e.note.start, kind: 'miss' });
        this.notify({ kind: 'miss', judgement: null, callout, midi: e.note.midi, hand: e.note.hand, time: e.time });
      }),
      session.on('wrong', (e) => {
        this.scorer.wrongKey();
        this.mistakes.push({ time: Math.max(0, e.time), kind: 'wrong' });
        this.notify({ kind: 'wrong', judgement: null, callout: null, midi: e.midi, hand: 'right', time: e.time });
      }),
    ];
  }

  /** Listens to every judged event. `cleared` is true for the empty event sent after a reset. */
  onScore(listener: ScoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** When the latest mistake happened, or null. */
  lastMistake(): number | null {
    return this.mistakes.length ? this.mistakes[this.mistakes.length - 1].time : null;
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.listeners.clear();
  }

  private notify(e: ScoreEvent, cleared = false): void {
    for (const l of this.listeners) {
      try {
        l(e, cleared);
      } catch (error) {
        console.error('A score listener failed.', error);
      }
    }
  }
}

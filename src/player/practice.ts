import type { Note, Song } from '../song';
import { firstAtOrAfter, type Loop } from './game';
import type { Mistake } from './scoring';

/** Speed choices: 25% to 125% in 5% steps. */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 1.25;
export const SPEED_STEP = 0.05;

/** Rounds a speed to the nearest step and keeps it in range. */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  const stepped = Math.round(speed / SPEED_STEP) * SPEED_STEP;
  return Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, stepped)) * 100) / 100;
}

/** "1:05" for 65 seconds. Negative times (the lead-in) show as 0:00. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Length of one beat in song seconds: from bpm, else the typical gap between beats, else null. */
export function beatLength(song: Pick<Song, 'bpm' | 'beats'>): number | null {
  if (song.bpm && song.bpm > 20 && song.bpm < 400) return 60 / song.bpm;
  const b = song.beats;
  if (b && b.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < b.length; i++) if (b[i] > b[i - 1]) gaps.push(b[i] - b[i - 1]);
    if (gaps.length) {
      gaps.sort((x, y) => x - y);
      const median = gaps[gaps.length >> 1];
      if (median > 0.15 && median < 3) return median;
    }
  }
  return null;
}

/** How long a passage is when looking for tricky parts: two bars when the song has a beat, else four seconds. */
export function passageLength(song: Pick<Song, 'bpm' | 'beats' | 'timeSignature'>): number {
  const beat = beatLength(song);
  if (!beat) return 4;
  const perBar = song.timeSignature?.beats && song.timeSignature.beats > 0 ? song.timeSignature.beats : 4;
  return Math.max(2, Math.min(8, beat * perBar * 2));
}

const WEIGHT: Record<Mistake['kind'], number> = { miss: 1, wrong: 1, timing: 0.4 };

export interface Passage extends Loop {
  /** Weighted number of mistakes inside. */
  score: number;
  count: number;
}

/**
 * Groups mistakes into passages of about `window` seconds, worst first.
 * Passages never overlap. Pure; times are song seconds.
 */
export function troublePassages(mistakes: readonly Mistake[], window: number, limit = 3): Passage[] {
  const sorted = mistakes.filter((m) => Number.isFinite(m.time)).sort((a, b) => a.time - b.time);
  const used: boolean[] = sorted.map(() => false);
  const out: Passage[] = [];
  while (out.length < limit) {
    let best: Passage | null = null;
    let bestFrom = 0;
    let bestTo = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue;
      let weight = 0;
      let j = i;
      // Passages never overlap, so stop at a mistake that already belongs to one.
      while (j < sorted.length && !used[j] && sorted[j].time - sorted[i].time <= window) weight += WEIGHT[sorted[j++].kind];
      if (!best || weight > best.score + 1e-9) {
        best = { start: sorted[i].time, end: sorted[j - 1].time, score: weight, count: j - i };
        bestFrom = i;
        bestTo = j;
      }
    }
    if (!best) break;
    for (let k = bestFrom; k < bestTo; k++) used[k] = true;
    out.push(best);
  }
  return out;
}

/**
 * Turns a stretch of mistakes into a loop that is nice to practise: it starts
 * on the note before the first mistake (so you play into it) and ends just
 * after the last one, at least `minLength` seconds long and inside the song.
 */
export function loopFor(range: Loop, notes: readonly Note[], minLength = 2): Loop | null {
  if (notes.length === 0) return null;
  const last = notes[notes.length - 1];
  const songEnd = last.start + last.dur;
  // The note group just before the first mistake, if it is close.
  let i = firstAtOrAfter(notes, range.start - 1e-6) - 1;
  let start = range.start;
  if (i >= 0 && range.start - notes[i].start <= 2) {
    const groupStart = notes[i].start;
    while (i > 0 && groupStart - notes[i - 1].start < 0.06) i--;
    start = notes[i].start;
  }
  let end = range.end + 0.6;
  if (end - start < minLength) {
    const pad = (minLength - (end - start)) / 2;
    start -= pad;
    end += pad;
  }
  start = Math.max(0, start);
  end = Math.min(songEnd + 0.5, Math.max(end, start + minLength));
  // Make sure there is something to play in it.
  const first = firstAtOrAfter(notes, start - 1e-6);
  if (first >= notes.length || notes[first].start >= end) return null;
  return { start: round(start), end: round(end) };
}

/** The passage with the most mistakes, as a loop, or null when there are none. */
export function trickiest(mistakes: readonly Mistake[], notes: readonly Note[], window: number): Loop | null {
  const [worst] = troublePassages(mistakes, window, 1);
  return worst ? loopFor(worst, notes) : null;
}

/** A short loop around one moment, for "loop the last mistake". */
export function loopAround(time: number, notes: readonly Note[], window = 4): Loop | null {
  return loopFor({ start: time - window * 0.35, end: time + window * 0.25 }, notes, window * 0.6);
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Accuracy of one loop pass, same rule as the game (wrong keys cost a little). */
export function passAccuracy(pass: { hit: number; missed: number; wrong: number }): number {
  const total = pass.hit + pass.missed;
  if (total === 0) return 0;
  return Math.max(0, pass.hit - pass.wrong * 0.25) / total;
}

export interface CoachStep {
  speed: number;
  message: string;
  changed: boolean;
  done: boolean;
}

/**
 * "Practise the tricky part": loops a passage slower, then speeds up as you
 * get it right, until you play it cleanly at your normal speed.
 */
export class TrickyCoach {
  readonly ladder: number[];
  private level = 0;
  private cleanAtTop = 0;
  done = false;

  /** `target` is the speed to work up to, usually the speed you chose. */
  constructor(target = 1, readonly good = 0.9, readonly poor = 0.5) {
    const t = clampSpeed(Math.min(target, 1.25));
    const steps = [0.6, 0.7, 0.8, 0.9, 1].map((f) => clampSpeed(Math.max(SPEED_MIN, t * f)));
    this.ladder = steps.filter((s, i) => i === 0 || s > steps[i - 1]);
  }

  get speed(): number {
    return this.ladder[this.level];
  }

  get atTop(): boolean {
    return this.level === this.ladder.length - 1;
  }

  /** Tells the coach how one pass went. Returns what to do next. */
  pass(stats: { hit: number; missed: number; wrong: number }): CoachStep {
    const acc = passAccuracy(stats);
    const pct = (s: number) => `${Math.round(s * 100)}%`;
    if (this.done) return { speed: this.speed, message: 'You have got it! Keep going or clear the loop.', changed: false, done: true };
    if (acc >= this.good) {
      if (this.atTop) {
        this.cleanAtTop++;
        if (this.cleanAtTop >= 2) {
          this.done = true;
          return { speed: this.speed, message: 'You have got it! That part is yours now.', changed: false, done: true };
        }
        return { speed: this.speed, message: 'Lovely. Once more like that!', changed: false, done: false };
      }
      this.level++;
      return { speed: this.speed, message: `Nice! A little faster now: ${pct(this.speed)}`, changed: true, done: false };
    }
    this.cleanAtTop = 0;
    if (acc < this.poor && this.level > 0) {
      this.level--;
      return { speed: this.speed, message: `Let us slow down a bit: ${pct(this.speed)}`, changed: true, done: false };
    }
    return { speed: this.speed, message: 'Again! You are getting closer.', changed: false, done: false };
  }
}

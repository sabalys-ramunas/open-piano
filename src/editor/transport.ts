import type { Instrument } from '../audio/instrument';
import type { Backing } from '../player/session';

/**
 * Plays the notes being edited from any point, at any speed, with an optional
 * repeated part. When the song has its recording, the recording plays along
 * and is the clock (the same way the play screen does it), so notes can never
 * drift from it. Without one, a steady clock moves time on.
 *
 * Owns no DOM: the editor calls `tick` once per animation frame.
 */

/** The bits of an audio element the editor uses. */
export interface EditorBacking extends Backing {
  volume: number;
  readonly duration: number;
  preservesPitch?: boolean;
  removeAttribute?(name: string): void;
}

/** Notes starting exactly at the playhead still sound when playing starts there. */
const EPS = 1e-6;

export interface PlayNote {
  midi: number;
  start: number;
  dur: number;
}

export interface TransportDeps {
  /** Read at every use: the app swaps the instrument when settings change. */
  instrument: () => Instrument;
  backing?: EditorBacking | null;
  /** Milliseconds, e.g. performance.now. */
  clock?: () => number;
}

function defaultBacking(): EditorBacking | null {
  if (typeof Audio === 'undefined') return null;
  const audio = new Audio();
  audio.preservesPitch = true;
  audio.preload = 'auto';
  return audio;
}

/**
 * Sets the recording's loudness. iPhone and iPad ignore `volume` on media
 * elements, so zero also mutes it there (and anything louder unmutes it).
 */
export function applyVolume(backing: EditorBacking, volume: number): void {
  backing.volume = volume;
  backing.muted = volume === 0;
}

export class Transport {
  /** Song time of the playhead, seconds. */
  time = 0;
  speed = 1;
  loop: { start: number; end: number } | null = null;
  loopOn = false;
  /** Sound the notes. Off lets you hear only the recording. */
  playNotes = true;
  /** Where playing stops on its own when nothing repeats. */
  end = 0;
  /** Called when playing starts or stops. */
  onState: (() => void) | null = null;

  private isPlaying = false;
  private notes: readonly PlayNote[] = [];
  private audioUrl: string | null = null;
  private recordingVolume = 1;
  private backing: EditorBacking | null;
  private clock: () => number;
  private lastWall = 0;
  /** Notes starting before this time have already been sounded on this pass. */
  private soundedTo = 0;

  constructor(private deps: TransportDeps) {
    this.backing = deps.backing === undefined ? defaultBacking() : deps.backing;
    this.clock = deps.clock ?? (() => performance.now());
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get hasRecording(): boolean {
    return Boolean(this.audioUrl && this.backing);
  }

  /** Length of the recording in seconds, or 0 while unknown. */
  get recordingLength(): number {
    const d = this.backing?.duration ?? 0;
    return this.audioUrl && Number.isFinite(d) ? d : 0;
  }

  /** Notes sorted by start. */
  setNotes(notes: readonly PlayNote[]): void {
    this.notes = notes;
  }

  setAudio(url: string | null | undefined): void {
    const next = url ?? null;
    if (next === this.audioUrl) return;
    const was = this.isPlaying;
    if (was) this.pause();
    this.audioUrl = next;
    if (this.backing) {
      if (next) this.backing.src = next;
      else this.backing.pause();
    }
    if (was) this.play();
  }

  setRecordingVolume(volume: number): void {
    this.recordingVolume = volume;
    if (this.backing) applyVolume(this.backing, volume);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    if (this.backing) this.backing.playbackRate = speed;
  }

  /** True while the recording is the clock. */
  private recordingRuns(t: number): boolean {
    if (!this.audioUrl || !this.backing) return false;
    const d = this.backing.duration;
    return !(Number.isFinite(d) && d > 0 && t >= d - 0.01);
  }

  seek(t: number): void {
    this.time = Math.max(0, t);
    this.soundedTo = this.time - EPS;
    if (this.backing && this.audioUrl) {
      if (this.isPlaying && this.recordingRuns(this.time)) {
        this.backing.currentTime = this.time;
        if (this.backing.paused) void this.backing.play().catch(() => {});
      } else if (!this.isPlaying) {
        this.backing.currentTime = this.time;
      }
    }
  }

  play(): void {
    if (this.isPlaying) return;
    this.deps.instrument().wake();
    if (this.loopOn && this.loop && (this.time < this.loop.start || this.time >= this.loop.end)) this.time = this.loop.start;
    if (!this.loopOn && this.end > 0 && this.time >= this.end) this.time = 0;
    this.isPlaying = true;
    this.lastWall = this.clock();
    this.startBacking();
    // Notes right under the playhead sound at once.
    this.sound(this.time - EPS, this.time + EPS);
    this.soundedTo = this.time + EPS;
    this.onState?.();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.backing?.pause();
    this.onState?.();
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  private startBacking(): void {
    const b = this.backing;
    if (!b || !this.audioUrl || !this.recordingRuns(this.time)) return;
    applyVolume(b, this.recordingVolume);
    b.playbackRate = this.speed;
    b.currentTime = this.time;
    void b.play().catch(() => {});
  }

  /** The playhead right now, between frames (used to time recorded key presses). */
  now(): number {
    if (!this.isPlaying) return this.time;
    const b = this.backing;
    if (b && this.audioUrl && !b.paused && this.recordingRuns(this.time)) return b.currentTime;
    return this.time + ((this.clock() - this.lastWall) / 1000) * this.speed;
  }

  /** Moves time on. Returns true if the playhead jumped back to the start of the repeated part. */
  tick(): boolean {
    if (!this.isPlaying) return false;
    const wall = this.clock();
    const dt = Math.min(0.25, Math.max(0, (wall - this.lastWall) / 1000));
    this.lastWall = wall;
    const b = this.backing;
    let next: number;
    if (b && this.audioUrl && this.recordingRuns(this.time)) {
      if (b.paused) {
        // Not started yet (or the browser is still loading it): keep time still until it plays.
        b.currentTime = this.time;
        b.playbackRate = this.speed;
        void b.play().catch(() => {});
        next = this.time;
      } else {
        next = b.currentTime;
      }
    } else {
      next = this.time + dt * this.speed;
    }

    let wrapped = false;
    if (this.loopOn && this.loop && this.loop.end - this.loop.start > 0.05 && next >= this.loop.end) {
      this.sound(this.soundedTo, this.loop.end);
      next = this.loop.start;
      this.soundedTo = next - EPS;
      wrapped = true;
      if (b && this.audioUrl && this.recordingRuns(next)) b.currentTime = next;
    }
    if (next > this.soundedTo) {
      this.sound(this.soundedTo, next);
      this.soundedTo = next;
    }
    this.time = next;
    if (!wrapped && !this.loopOn && this.end > 0 && this.time >= this.end) {
      this.time = this.end;
      this.pause();
    }
    return wrapped;
  }

  private sound(from: number, to: number): void {
    if (!this.playNotes || to <= from) return;
    const notes = this.notes;
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].start < from) lo = mid + 1;
      else hi = mid;
    }
    const instrument = this.deps.instrument();
    for (let i = lo; i < notes.length && notes[i].start < to; i++) {
      instrument.play(notes[i].midi, notes[i].dur / this.speed, 0.8);
    }
  }

  destroy(): void {
    this.isPlaying = false;
    if (this.backing) {
      this.backing.pause();
      if (this.audioUrl) {
        this.backing.removeAttribute?.('src');
      }
    }
    this.onState = null;
  }
}

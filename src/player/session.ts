import type { Instrument } from '../audio/instrument';
import type { Note, Song } from '../song';
import { Game, firstAtOrAfter, type Loop, type Options, type Result } from './game';

export type SessionOptions = Options;
/** The whole recording, or the split backing without guitars and keys. */
export type RecordingSource = 'full' | 'backing';
export type { Loop };

/**
 * How far ahead, in real seconds, the notes the app plays are handed to the
 * audio clock. A frame that comes this much late still leaves them on time.
 */
export const LOOKAHEAD = 0.25;

/** Learn mode: the recording is moved to the song when they are this far apart (song seconds). */
const RESYNC = 0.3;
/** Learn mode: a recording that has not moved for this long (real seconds) no longer holds the song. */
const STALL = 0.5;

/** Slowest and fastest speed the session accepts. */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 2;

/**
 * What a session reports. Times are song seconds. `error` is how far off the
 * beat a hit was in song seconds: negative is early, positive is late. In
 * Learn mode the song waits for the player, so late is always 0 there.
 */
export interface SessionEvents {
  hit: { index: number; note: Note; error: number; time: number };
  miss: { index: number; note: Note; time: number };
  wrong: { midi: number; time: number };
  /** The song reached its end. Listen mode then resets by itself. */
  finished: { result: Result; mode: Options['mode']; song: Song };
  /** Started, paused or continued. */
  running: { running: boolean };
  /** A fresh Game was made: new song, new options or Restart. */
  reset: { song: Song; options: SessionOptions };
  /** The song jumped to `time` (seek, loop start, or the end of a preview). Notes from there on are fresh. */
  seek: { time: number };
  /** One pass of the loop finished and the song went back to its start. Counts are for that pass only. */
  loop: { loop: Loop; pass: number; hit: number; missed: number; wrong: number };
  /** The loop was set or cleared. */
  looping: { loop: Loop | null };
  /** Speed changed without restarting. */
  speed: { speed: number };
  /** A "show me" preview started or ended. */
  preview: { on: boolean };
}

export type SessionEventName = keyof SessionEvents;
type Handler<K extends SessionEventName> = (event: SessionEvents[K]) => void;

/** The bits of an HTMLAudioElement the session uses, so tests can pass a fake. */
export interface Backing {
  src: string;
  currentTime: number;
  playbackRate: number;
  /** Loading a new source resets playbackRate to this. */
  defaultPlaybackRate?: number;
  muted?: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
}

export interface SessionDeps {
  /** Read on every use, so the instrument can be swapped while playing. */
  audio: { readonly instrument: Instrument };
  /** Plays the original recording. Defaults to a new Audio element. */
  backing?: Backing;
}

function defaultBacking(): Backing | undefined {
  if (typeof Audio === 'undefined') return undefined;
  const audio = new Audio();
  audio.preservesPitch = true;
  return audio;
}

/**
 * Runs one song: moves time forward, plays the parts the player is not
 * playing, judges key presses and reports what happened. The player screen
 * drives it by calling `tick` once per animation frame and `press` for every
 * key down. It owns no DOM.
 *
 * When the song has its original recording, Listen and Play along modes play
 * the recording and use it as the clock so the notes never drift from it.
 * Learn mode plays it too, pausing it whenever the song waits for a key.
 */
export class Session {
  song: Song;
  options: SessionOptions;
  game: Game;
  /**
   * How late key presses reach us, in real seconds (for example from slow
   * Bluetooth audio, so the player hears the song late). Taken off before
   * judging in Play along mode. Set it from settings.latencyMs / 1000.
   */
  inputDelay = 0;
  /**
   * When true the app never sounds the learner's own part (their hand or
   * hands), for example while the microphone listens to an acoustic piano:
   * the piano makes that sound, and the microphone would hear the app. The
   * other hand, the recording and "Show me" still play. Listen mode has no
   * own part, so it is unaffected.
   */
  muteOwnPart = false;
  private silentRecording = false;

  /**
   * True when the player switched the original recording off. It still keeps
   * time where it is the clock, but silently: the piano sound plays the notes.
   */
  get recordingMuted(): boolean {
    return this.silentRecording;
  }
  set recordingMuted(on: boolean) {
    this.silentRecording = on;
    if (this.backing) this.backing.muted = on;
  }

  /**
   * Which version of the recording plays: the whole recording, or the backing
   * without guitars and keys (only for songs that have one, `song.backingUrl`;
   * others play the whole recording either way).
   */
  get recordingSource(): RecordingSource {
    return this.source;
  }

  /**
   * Switches between the whole recording and the backing. Mid-song this keeps
   * the position, the speed and whether it is playing: the new recording
   * starts where the old one was, and the song waits the moment it takes to load.
   */
  setRecordingSource(source: RecordingSource): void {
    this.source = source;
    const backing = this.backing;
    const url = this.recordingUrl();
    if (!backing || !url || backing.src === url) return;
    const playing = !backing.paused;
    const at = backing.src ? backing.currentTime : this.game.time;
    backing.src = url;
    if (backing.defaultPlaybackRate !== undefined) backing.defaultPlaybackRate = this.options.speed;
    backing.playbackRate = this.options.speed;
    backing.currentTime = Math.max(0, Number.isFinite(at) ? at : this.game.time);
    if (backing.muted !== undefined) backing.muted = this.silentRecording;
    if (playing) void backing.play().catch(() => {});
  }

  /** The address of the recording that should play now. */
  private recordingUrl(): string | undefined {
    return this.source === 'backing' && this.song.backingUrl ? this.song.backingUrl : this.song.audioUrl;
  }
  private source: RecordingSource = 'full';
  private isRunning = false;
  /** Learn mode: the last recording time read, and how long (real seconds) it has not moved. */
  private learnLast = Number.NaN;
  private learnStall = 0;
  /** Notes were handed to the audio clock ahead of time and may still be waiting to start. */
  private ahead = false;
  private loopRange: Loop | null = null;
  private pass = { count: 0, wrong: 0 };
  private previewState: { from: number; to: number; cursor: number } | null = null;
  private backing: Backing | undefined;
  private handlers = new Map<SessionEventName, Set<Handler<SessionEventName>>>();

  constructor(
    private deps: SessionDeps,
    song: Song,
    options: SessionOptions,
  ) {
    this.backing = deps.backing ?? defaultBacking();
    this.song = song;
    this.options = { ...options };
    this.game = new Game(song, this.options);
    this.reset();
  }

  get running(): boolean {
    return this.isRunning;
  }

  /** The section being looped, or null. */
  get loop(): Loop | null {
    return this.loopRange;
  }

  /** True while "show me" is playing the next few seconds for the player. */
  get previewing(): boolean {
    return this.previewState !== null;
  }

  /** How much song time a loop starts before its first note, so there is a moment to get ready. */
  loopLead(): number {
    return Math.max(0.3, 1.2 * this.options.speed);
  }

  /** Switches song and/or options and starts again from the top. */
  load(song: Song, options: Partial<SessionOptions> = {}): void {
    this.song = song;
    this.options = { ...this.options, ...options };
    this.reset();
  }

  /** Starts the current song again from the top, paused. */
  reset(): void {
    this.dropAhead();
    this.previewState = null;
    this.loopRange = null;
    this.pass = { count: 0, wrong: 0 };
    this.game = new Game(this.song, { ...this.options });
    this.setRunningFlag(false);
    this.backing?.pause();
    const url = this.recordingUrl();
    if (this.backing && url && this.backing.src !== url) {
      this.backing.src = url;
      if (this.backing.defaultPlaybackRate !== undefined) this.backing.defaultPlaybackRate = this.options.speed;
    }
    this.emit('reset', { song: this.song, options: { ...this.options } });
  }

  /** Start, pause or continue: what the main play button does. */
  toggle(): void {
    this.deps.audio.instrument.wake();
    if (this.previewState) this.stopPreview();
    if (this.game.finished) this.reset();
    this.setRunning(!this.isRunning);
  }

  start(): void {
    if (!this.isRunning) this.toggle();
  }

  pause(): void {
    if (this.isRunning) this.setRunning(false);
  }

  /** True when the original recording plays and sets the time. */
  usesRecording(): boolean {
    return Boolean(this.song.audioUrl && this.backing) && this.options.mode !== 'wait';
  }

  /** A key went down. Judged only while running. */
  press(midi: number): void {
    if (!this.isRunning) return;
    const strike = this.game.strike(midi, this.inputDelay * this.options.speed);
    if (strike) {
      this.emit('hit', { index: strike.index, note: this.game.notes[strike.index], error: strike.error, time: this.game.time });
    } else if (this.options.mode !== 'listen') {
      this.pass.wrong++;
      this.emit('wrong', { midi, time: this.game.time });
    }
  }

  /**
   * Jumps to song time `t` without restarting. Keeps running if it was.
   * The recording, when it is the clock, jumps with it.
   */
  seek(t: number): void {
    this.dropAhead();
    if (this.previewState) this.previewState = null;
    const time = Math.max(-1.5, Math.min(t, this.game.length + 0.5));
    this.game.seek(time, this.loopRange);
    this.syncBacking();
    this.emit('seek', { time });
  }

  /**
   * Loops a section: when the song reaches `loop.end` it goes back to a
   * moment before `loop.start`. Only your notes inside the loop are judged;
   * the rest are played for you. Null clears the loop.
   */
  setLoop(loop: Loop | null): void {
    if (loop && !(Number.isFinite(loop.start) && Number.isFinite(loop.end) && loop.end > loop.start)) return;
    this.loopRange = loop ? { start: Math.max(0, loop.start), end: Math.min(loop.end, this.game.length + 0.5) } : null;
    this.pass = { count: 0, wrong: 0 };
    const range = this.loopRange;
    if (range && (this.game.time < range.start - this.loopLead() - 1e-6 || this.game.time >= range.end)) {
      this.seek(range.start - this.loopLead());
    } else {
      this.seek(this.game.time);
    }
    this.emit('looping', { loop: this.loopRange ? { ...this.loopRange } : null });
  }

  /** True when the recording plays in step with a clock that waits for the player (Learn mode). */
  private followsRecording(): boolean {
    return Boolean(this.song.audioUrl && this.backing) && this.options.mode === 'wait';
  }

  /** Changes speed without restarting. The recording follows at the same pitch. */
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    const s = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
    if (s === this.options.speed) return;
    this.dropAhead();
    this.options = { ...this.options, speed: s };
    this.game.opts.speed = s;
    if (this.backing) {
      this.backing.playbackRate = s;
      if (this.backing.defaultPlaybackRate !== undefined) this.backing.defaultPlaybackRate = s;
    }
    this.emit('speed', { speed: s });
  }

  /**
   * "Show me": pauses, plays the next `seconds` of song (all notes, both
   * hands) with the built-in sound, then comes back to where it was, paused.
   * Nothing is judged while it plays.
   */
  preview(seconds = 4): void {
    if (this.previewState) return;
    this.pause();
    this.deps.audio.instrument.wake();
    const from = this.game.time;
    this.previewState = { from, to: Math.max(from, 0) + seconds, cursor: firstAtOrAfter(this.game.notes, from) };
    this.emit('preview', { on: true });
  }

  /** Ends a preview early and goes back to where it started. */
  stopPreview(): void {
    const p = this.previewState;
    if (!p) return;
    this.previewState = null;
    this.game.time = p.from;
    this.emit('preview', { on: false });
  }

  /** Moves the song on by `dt` real seconds. Call once per animation frame. */
  tick(dt: number): void {
    if (this.previewState) {
      this.tickPreview(dt);
      return;
    }
    if (!this.isRunning) return;
    const game = this.game;
    const backing = this.backing;
    let step = dt;
    let recordingPlays = false;
    if (backing && this.usesRecording() && game.time >= 0 && !backing.ended) {
      // The recording is the clock, so the notes can never drift away from it.
      if (backing.paused) {
        backing.currentTime = game.time;
        backing.playbackRate = this.options.speed;
        void backing.play().catch(() => {});
      }
      step = (backing.currentTime - game.time) / this.options.speed;
      recordingPlays = true;
    }
    if (backing && this.followsRecording()) {
      recordingPlays = true;
      step = this.followInLearn(backing, dt);
    }
    const toSound = game.advance(Math.max(0, step));
    if (backing && this.followsRecording()) this.holdInLearn(backing);
    // Listen mode shows what the lesson sounds like, so its notes always sound, over the recording too.
    if (!recordingPlays || this.silentRecording || this.options.mode === 'listen') {
      const instrument = this.deps.audio.instrument;
      const speed = this.options.speed;
      for (const n of toSound) if (!this.isOwn(n)) instrument.play(n.midi, n.dur / speed);
      // Notes due in the next moment go to the audio clock now, with their exact start, so
      // they keep time even when drawing is slow. Learn mode can stop at any note, so it never
      // looks ahead; nor does anything past a loop's end or the song's end.
      if (this.options.mode !== 'wait' && game.time >= 0 && !game.finished) {
        const loop = this.loopRange;
        const until = Math.min(game.time + LOOKAHEAD * speed, loop ? loop.end - 1e-6 : Infinity);
        if (until > game.time) {
          for (const n of game.takeAhead(until)) {
            if (!this.isOwn(n)) instrument.play(n.midi, n.dur / speed, undefined, Math.max(0, (n.start - game.time) / speed));
          }
          this.ahead = true;
        }
      }
    }
    for (const index of game.takeMisses()) this.emit('miss', { index, note: game.notes[index], time: game.time });
    const loop = this.loopRange;
    if (loop && game.time >= loop.end) this.wrapLoop(loop);
    else if (game.finished) this.finish();
  }

  private tickPreview(dt: number): void {
    const p = this.previewState;
    if (!p) return;
    const game = this.game;
    const t = game.time + Math.max(0, dt) * this.options.speed;
    const instrument = this.deps.audio.instrument;
    while (p.cursor < game.notes.length && game.notes[p.cursor].start <= t) {
      const n = game.notes[p.cursor++];
      if (n.start >= p.from) instrument.play(n.midi, n.dur / this.options.speed);
    }
    game.time = t;
    if (t >= p.to || t > game.length + 0.5) this.stopPreview();
  }

  /**
   * Learn mode with a recording: how far the song moves this frame. While the
   * song moves, it follows the recording (so a media element that takes a
   * moment to start never leaves the sound behind the notes); while it waits
   * for a key it does not move. If the recording does not move at all for a
   * while (blocked, still loading), the song goes on by the frame time.
   */
  private followInLearn(backing: Backing, dt: number): number {
    const game = this.game;
    const speed = this.options.speed;
    if (game.time < 0 || game.finished || backing.ended || game.waiting) {
      this.learnStall = 0;
      return dt;
    }
    if (backing.paused) {
      // Continue from where the recording stopped (it ran up to this note); jump only when it is far off.
      if (Math.abs(backing.currentTime - game.time) > RESYNC) backing.currentTime = game.time;
      backing.playbackRate = speed;
      void backing.play().catch(() => {});
      this.learnLast = backing.currentTime;
      this.learnStall = 0;
      return 0;
    }
    const media = backing.currentTime;
    if (media !== this.learnLast) {
      this.learnLast = media;
      this.learnStall = 0;
      if (Math.abs(media - game.time) > RESYNC) {
        backing.currentTime = game.time;
        return dt;
      }
      return (media - game.time) / speed;
    }
    this.learnStall += dt;
    return this.learnStall > STALL ? dt : 0;
  }

  /** Learn mode: the recording plays on up to the waiting note, then holds there until the key is pressed. */
  private holdInLearn(backing: Backing): void {
    const game = this.game;
    if (backing.paused) return;
    if (game.time < 0 || game.finished || backing.ended) {
      backing.pause();
      return;
    }
    if (game.waiting) {
      const behind = game.time - backing.currentTime;
      if (behind <= 0.01 || behind > RESYNC) backing.pause();
    }
  }

  /** Takes back notes handed to the audio clock that have not started (pause, seek, speed change). */
  private dropAhead(): void {
    if (!this.ahead) return;
    this.ahead = false;
    this.deps.audio.instrument.cancelPending?.();
    this.game.forgetAhead(this.game.time);
  }

  /** True when `muteOwnPart` is on and this note belongs to the hand(s) the learner plays. */
  private isOwn(n: { hand: 'right' | 'left' }): boolean {
    if (!this.muteOwnPart || this.options.mode === 'listen') return false;
    return this.options.hands === 'both' || this.options.hands === n.hand;
  }

  private wrapLoop(loop: Loop): void {
    let hit = 0;
    let missed = 0;
    const { notes, state } = this.game;
    for (let i = firstAtOrAfter(notes, loop.start - 1e-6); i < notes.length && notes[i].start < loop.end; i++) {
      if (state[i] === 'hit') hit++;
      else if (state[i] === 'miss' || state[i] === 'pending') missed++;
    }
    this.pass.count++;
    const payload = { loop: { ...loop }, pass: this.pass.count, hit, missed, wrong: this.pass.wrong };
    this.pass.wrong = 0;
    this.seek(loop.start - this.loopLead());
    this.emit('loop', payload);
  }

  /** Keeps the recording on the song clock after a jump. */
  private syncBacking(): void {
    const backing = this.backing;
    if (!backing || !this.usesRecording()) return;
    if (this.game.time >= 0) {
      backing.currentTime = this.game.time;
      if (this.isRunning && backing.paused) {
        backing.playbackRate = this.options.speed;
        void backing.play().catch(() => {});
      }
    } else {
      // Still in the lead-in: tick starts the recording when the song reaches 0.
      backing.pause();
    }
  }

  /** Subscribes to an event. Returns an unsubscribe function. */
  on<K extends SessionEventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as Handler<SessionEventName>);
    return () => set.delete(handler as Handler<SessionEventName>);
  }

  /** Stops sound and forgets every subscriber. */
  destroy(): void {
    this.dropAhead();
    this.isRunning = false;
    this.previewState = null;
    this.backing?.pause();
    this.handlers.clear();
  }

  private finish(): void {
    this.setRunningFlag(false);
    this.backing?.pause();
    this.emit('finished', { result: this.game.result(), mode: this.options.mode, song: this.song });
    if (this.options.mode === 'listen') this.reset();
  }

  private setRunning(on: boolean): void {
    if (!on) this.dropAhead();
    this.setRunningFlag(on);
    if (!on) this.backing?.pause();
    else if (this.backing && this.usesRecording() && this.game.time >= 0) {
      this.backing.playbackRate = this.options.speed;
      void this.backing.play().catch(() => {});
    }
  }

  private setRunningFlag(on: boolean): void {
    if (this.isRunning === on) return;
    this.isRunning = on;
    this.emit('running', { running: on });
  }

  private emit<K extends SessionEventName>(event: K, payload: SessionEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        (h as Handler<K>)(payload);
      } catch (error) {
        console.error(`A ${event} listener failed.`, error);
      }
    }
  }
}

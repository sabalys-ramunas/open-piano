import { audioContext } from './context';

/** Clicks along with the beat. */
export interface Metronome {
  readonly running: boolean;
  /**
   * Starts clicking. `beats` are song beat times in seconds (from Song.beats);
   * without them it clicks evenly at `bpm` from song time 0. `songTime` reads
   * the current song position so the clicks follow pauses, jumps and speed
   * changes (the speed is worked out from how fast `songTime` moves, or read
   * from `speed` when given). It can be called at any song time.
   */
  start(options: MetronomeOptions): void;
  stop(): void;
  /** Master volume, 0..1. */
  setVolume(volume: number): void;
  /** The metronome's own loudness on top of the master volume, 0..1 (settings.metronomeVolume). */
  setClickVolume(level: number): void;
  /**
   * Clicks `beats` times at `bpm` (scaled by `speed`), the first click
   * accented, then resolves true on the moment the next beat would fall: start
   * the song then. Resolves false if `stop()` is called first.
   */
  countIn(options: CountInOptions): Promise<boolean>;
}

export interface MetronomeOptions {
  bpm?: number;
  beats?: readonly number[];
  beatsPerBar?: number;
  songTime: () => number;
  /** Playback speed (1 = normal). Optional: measured from songTime when missing. */
  speed?: () => number;
}

export interface CountInOptions {
  beats: number;
  bpm: number;
  beatsPerBar?: number;
  speed?: number;
}

export interface Beat {
  /** Song time in seconds. */
  time: number;
  /** Beat number from the start (can be negative before song time 0 on an even grid). */
  index: number;
  /** First beat of a bar. */
  accent: boolean;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Beats with song time in (from, to], from the song's beat list or an even grid. */
export function beatsBetween(
  from: number,
  to: number,
  grid: { bpm?: number; beats?: readonly number[]; beatsPerBar?: number },
): Beat[] {
  const perBar = Math.max(1, Math.round(grid.beatsPerBar ?? 4));
  const out: Beat[] = [];
  if (!(to > from)) return out;
  const beats = grid.beats;
  if (beats && beats.length > 1) {
    // Past the last listed beat, keep going at the last spacing.
    const last = beats.length - 1;
    const spacing = beats[last] - beats[last - 1];
    for (let i = 0; i < beats.length; i++) {
      if (beats[i] > from && beats[i] <= to) out.push({ time: beats[i], index: i, accent: mod(i, perBar) === 0 });
    }
    if (spacing > 0.05 && to > beats[last]) {
      let k = Math.max(last + 1, Math.floor((from - beats[last]) / spacing) + last + 1);
      for (; ; k++) {
        const t = beats[last] + (k - last) * spacing;
        if (t > to) break;
        if (t > from) out.push({ time: t, index: k, accent: mod(k, perBar) === 0 });
      }
    }
    return out;
  }
  const bpm = grid.bpm && grid.bpm > 0 ? Math.min(400, Math.max(20, grid.bpm)) : 100;
  const step = 60 / bpm;
  for (let k = Math.floor(from / step); k * step <= to; k++) {
    const t = k * step;
    if (t > from + 1e-9) out.push({ time: t, index: k, accent: mod(k, perBar) === 0 });
  }
  return out;
}

/**
 * Follows the song clock against the audio clock: a straight line
 * song = anchor.song + (audio - anchor.audio) * rate, redrawn when the song
 * jumps, pauses or changes speed. Smooths over the frame-by-frame steps of
 * songTime so clicks land exactly on time.
 */
export class SongClock {
  private anchor: { song: number; audio: number } | null = null;
  private rate = 1;
  private lastSong = NaN;
  private stillSince = NaN;
  paused = true;

  constructor(
    private readonly speed?: () => number,
    private readonly tolerance = 0.04,
  ) {}

  /** Feeds one reading. Returns true when the line was redrawn (scheduled clicks may be wrong). */
  observe(song: number, audio: number): boolean {
    let redrawn = false;
    if (song === this.lastSong) {
      if (Number.isNaN(this.stillSince)) this.stillSince = audio;
      // The song has not moved for 60 ms of audio time: it is paused.
      if (!this.paused && audio - this.stillSince >= 0.06) {
        this.paused = true;
        redrawn = true;
      }
    } else {
      this.stillSince = NaN;
      if (this.speed) this.rate = Math.min(4, Math.max(0.05, this.speed()));
      if (this.paused || !this.anchor) {
        this.anchor = { song, audio };
        this.paused = false;
        redrawn = true;
      } else {
        const predicted = this.songAt(audio);
        const span = audio - this.anchor.audio;
        const error = song - predicted;
        if (Math.abs(error) > this.tolerance) {
          // The song jumped, or its speed changed. A steady drift means a new
          // speed (learn it); a big step means a jump (keep the speed).
          const measured = span > 0 ? (song - this.anchor.song) / span : NaN;
          // Drift crosses the tolerance a little at a time; a jump overshoots it at once.
          if (!this.speed && span > 0.05 && measured > 0.05 && measured < 4 && Math.abs(error) < this.tolerance * 2) {
            this.rate = measured;
          }
          this.anchor = { song, audio };
          redrawn = true;
        } else if (!this.speed && span > 1) {
          // Fine-tune the speed from how far the song moved since the anchor.
          const measured = (song - this.anchor.song) / span;
          if (measured > 0.05 && Math.abs(measured - this.rate) > 0.03 * this.rate) {
            this.rate = Math.min(4, measured);
            this.anchor = { song, audio };
            redrawn = true;
          }
        }
      }
    }
    this.lastSong = song;
    return redrawn;
  }

  songAt(audio: number): number {
    if (!this.anchor) return 0;
    return this.anchor.song + (audio - this.anchor.audio) * this.rate;
  }

  audioAt(song: number): number {
    if (!this.anchor) return 0;
    return this.anchor.audio + (song - this.anchor.song) / this.rate;
  }

  get speedNow(): number {
    return this.rate;
  }
}

const LATE_GRACE = 0.03;

export interface ScheduledClick {
  /** Audio-clock time of the click. */
  at: number;
  beat: Beat;
}

/**
 * The look-ahead scheduler: called every ~25 ms, it books every click that
 * falls in the next `lookahead` seconds at its exact audio time, and cancels
 * booked clicks when the song pauses or jumps. Pure apart from the callbacks.
 */
export class BeatScheduler {
  readonly clock: SongClock;
  private booked: ScheduledClick[] = [];
  private lastBeatSong = -Infinity;

  constructor(
    private readonly options: MetronomeOptions,
    private readonly play: (click: ScheduledClick) => void,
    private readonly cancel: (click: ScheduledClick) => void,
    private readonly lookahead = 0.12,
  ) {
    this.clock = new SongClock(options.speed);
  }

  tick(audioNow: number): void {
    const song = this.options.songTime();
    if (!Number.isFinite(song)) return;
    const redrawn = this.clock.observe(song, audioNow);
    // Forget clicks already heard.
    this.booked = this.booked.filter((c) => c.at > audioNow - 0.05);
    if (redrawn) {
      for (const c of this.booked) if (c.at > audioNow) this.cancel(c);
      this.booked = this.booked.filter((c) => c.at <= audioNow);
      // A beat that fell up to 30 ms ago (just before this tick) still clicks, straight away.
      this.lastBeatSong = this.clock.songAt(audioNow) - LATE_GRACE;
    }
    if (this.clock.paused) return;
    const from = Math.max(this.lastBeatSong, this.clock.songAt(audioNow) - LATE_GRACE);
    const to = this.clock.songAt(audioNow + this.lookahead);
    for (const beat of beatsBetween(from, to, this.options)) {
      const click = { at: Math.max(audioNow, this.clock.audioAt(beat.time)), beat };
      this.booked.push(click);
      this.play(click);
      this.lastBeatSong = beat.time;
    }
  }

  /** Cancels every click not yet heard. */
  clear(audioNow: number): void {
    for (const c of this.booked) if (c.at > audioNow) this.cancel(c);
    this.booked = [];
  }

  get pending(): readonly ScheduledClick[] {
    return this.booked;
  }
}

export interface MetronomeDeps {
  context?: () => BaseAudioContext;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

/** The app's metronome, sharing the instrument's audio context. */
export function createMetronome(deps: MetronomeDeps = {}): Metronome {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => window.setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id: number) => window.clearTimeout(id));
  let ctx: BaseAudioContext | null = null;
  let out: GainNode | null = null;
  let volume = 0.8;
  let clickVolume = 0.7;
  let scheduler: BeatScheduler | null = null;
  let timer: number | null = null;
  const sounding = new Map<ScheduledClick, OscillatorNode>();
  let countInCancel: (() => void) | null = null;

  const level = (): number => volume * clickVolume * 0.9;

  const ensure = (): BaseAudioContext | null => {
    if (ctx) return ctx;
    if (!deps.context && typeof AudioContext === 'undefined') return null;
    ctx = deps.context ? deps.context() : audioContext();
    out = ctx.createGain();
    out.gain.value = level();
    out.connect(ctx.destination);
    return ctx;
  };

  /** A short wooden tick: higher and louder on beat one. */
  const click = (at: number, accent: boolean): OscillatorNode | null => {
    const c = ensure();
    if (!c || !out) return null;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accent ? 1760 : 1250, at);
    osc.frequency.exponentialRampToValueAtTime(accent ? 1100 : 800, at + 0.04);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(accent ? 1 : 0.6, at + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + 0.08);
    return osc;
  };

  const loop = (): void => {
    timer = null;
    if (!scheduler || !ctx) return;
    scheduler.tick(ctx.currentTime);
    timer = setTimer(loop, 25);
  };

  const metronome: Metronome = {
    get running() {
      return scheduler !== null;
    },
    start(options) {
      metronome.stop();
      const c = ensure();
      if (!c) return;
      scheduler = new BeatScheduler(
        options,
        (sc) => {
          const osc = click(sc.at, sc.beat.accent);
          if (osc) sounding.set(sc, osc);
        },
        (sc) => {
          const osc = sounding.get(sc);
          sounding.delete(sc);
          try {
            osc?.stop();
          } catch {
            // never started or already stopped
          }
        },
      );
      loop();
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (scheduler && ctx) scheduler.clear(ctx.currentTime);
      scheduler = null;
      sounding.clear();
      countInCancel?.();
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      if (out && ctx) out.gain.setTargetAtTime(level(), ctx.currentTime, 0.02);
    },
    setClickVolume(v) {
      clickVolume = Math.min(1, Math.max(0, v));
      if (out && ctx) out.gain.setTargetAtTime(level(), ctx.currentTime, 0.02);
    },
    countIn({ beats, bpm, beatsPerBar, speed = 1 }) {
      countInCancel?.();
      const n = Math.max(0, Math.min(16, Math.round(beats)));
      const interval = 60 / Math.min(400, Math.max(20, bpm || 100)) / Math.min(4, Math.max(0.1, speed));
      const perBar = Math.max(1, Math.round(beatsPerBar ?? n));
      const c = ensure();
      const startReal = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
      const nowAudio = (): number => (c ? c.currentTime : (performance.now() / 1000 - startReal));
      const first = nowAudio() + 0.1;
      const oscs: OscillatorNode[] = [];
      for (let i = 0; i < n; i++) {
        const osc = click(first + i * interval, i % perBar === 0);
        if (osc) oscs.push(osc);
      }
      const end = first + n * interval;
      return new Promise<boolean>((resolve) => {
        let id: number | null = null;
        const finish = (ok: boolean): void => {
          if (id !== null) clearTimer(id);
          countInCancel = null;
          resolve(ok);
        };
        countInCancel = () => {
          const now = nowAudio();
          for (const o of oscs) {
            try {
              o.stop(now);
            } catch {
              // already stopped
            }
          }
          finish(false);
        };
        const wait = (): void => {
          const left = end - nowAudio();
          if (left <= 0.004) finish(true);
          else id = setTimer(wait, Math.max(1, Math.min(50, left * 1000 - 2)));
        };
        wait();
      });
    },
  };
  return metronome;
}

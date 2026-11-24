import { describe, expect, it } from 'vitest';
import { BeatScheduler, beatsBetween, createMetronome, SongClock, type ScheduledClick } from '../src/audio/metronome';
import { FakeContext } from './audio-fake';

describe('beat maths', () => {
  it('lays an even grid from the bpm, accenting beat one of each bar', () => {
    const beats = beatsBetween(0, 2, { bpm: 120, beatsPerBar: 3 });
    expect(beats.map((b) => b.time)).toEqual([0.5, 1, 1.5, 2]);
    expect(beats.map((b) => b.accent)).toEqual([false, false, true, false]);
    expect(beatsBetween(-0.0001, 0.1, { bpm: 120 })[0]).toEqual({ time: 0, index: 0, accent: true });
  });

  it('works before song time 0 (the lead-in) with correct accents', () => {
    const beats = beatsBetween(-2.1, 0, { bpm: 60, beatsPerBar: 4 });
    expect(beats.map((b) => [b.time, b.index, b.accent])).toEqual([
      [-2, -2, false],
      [-1, -1, false],
      [0, 0, true],
    ]);
  });

  it('follows the song\'s own beat times and continues past the last one', () => {
    const grid = { beats: [0.2, 0.7, 1.25, 1.75], beatsPerBar: 2 };
    expect(beatsBetween(0, 1.5, grid).map((b) => b.time)).toEqual([0.2, 0.7, 1.25]);
    const after = beatsBetween(1.5, 3, grid);
    expect(after.map((b) => b.time)).toEqual([1.75, 2.25, 2.75]);
    expect(after.map((b) => b.accent)).toEqual([false, true, false]);
  });

  it('returns nothing for an empty window and survives silly bpm values', () => {
    expect(beatsBetween(1, 1, { bpm: 100 })).toEqual([]);
    expect(beatsBetween(0, 1, { bpm: 0 }).length).toBeGreaterThan(0);
    expect(beatsBetween(0, 1, { bpm: 100000 }).length).toBeLessThan(10);
  });
});

describe('song clock', () => {
  it('draws a straight line through a jittery song time', () => {
    const clock = new SongClock();
    // The song time steps once per 16.7 ms animation frame; we sample it every 25 ms.
    for (let audio = 0; audio < 2; audio += 0.025) {
      const frame = Math.floor(audio / (1 / 60)) / 60;
      clock.observe(frame, audio);
    }
    expect(clock.songAt(2)).toBeCloseTo(2, 1);
    expect(clock.paused).toBe(false);
  });

  it('notices a pause, a jump and a new speed', () => {
    const clock = new SongClock();
    let song = 0;
    let audio = 0;
    const step = (rate: number, seconds: number): void => {
      for (let t = 0; t < seconds; t += 0.025) {
        audio += 0.025;
        song += 0.025 * rate;
        clock.observe(song, audio);
      }
    };
    step(1, 1);
    expect(clock.speedNow).toBeCloseTo(1, 5);
    // Pause: song time stops.
    for (let i = 0; i < 5; i++) {
      audio += 0.025;
      clock.observe(song, audio);
    }
    expect(clock.paused).toBe(true);
    // Jump back and play at half speed.
    song = 0.2;
    step(0.5, 2);
    expect(clock.paused).toBe(false);
    expect(clock.speedNow).toBeCloseTo(0.5, 1);
    expect(clock.songAt(audio)).toBeCloseTo(song, 2);
  });

  it('uses the given speed when it is provided', () => {
    const clock = new SongClock(() => 0.75);
    clock.observe(0, 0);
    clock.observe(0.0001, 0.001);
    expect(clock.speedNow).toBe(0.75);
    expect(clock.audioAt(0.75)).toBeCloseTo(1, 6);
  });
});

describe('look-ahead scheduler', () => {
  function run(rate: number, seconds: number, bpm = 120, startSong = 0) {
    let audio = 10; // the audio clock does not start at 0
    let song = startSong;
    const played: ScheduledClick[] = [];
    const cancelled: ScheduledClick[] = [];
    const s = new BeatScheduler(
      { bpm, beatsPerBar: 4, songTime: () => song },
      (c) => played.push(c),
      (c) => cancelled.push(c),
    );
    const tick = (dt: number, advance = true): void => {
      audio += dt;
      if (advance) song += dt * rate;
      s.tick(audio);
    };
    for (let t = 0; t < seconds; t += 0.025) tick(0.025);
    return { s, played, cancelled, tick, audioNow: () => audio, songNow: () => song, setSong: (v: number) => (song = v) };
  }

  it('books every beat exactly once, at the exact audio time', () => {
    const { played } = run(1, 3);
    const times = played.map((c) => c.beat.time);
    expect(new Set(times).size).toBe(times.length);
    // Beat 0 fell 25 ms before the first tick, so it clicks straight away.
    expect(times).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(played[0].at).toBeCloseTo(10.025, 9);
    // After that, audio time = 10 (start) + song time, to well under a millisecond.
    for (const c of played.slice(1)) expect(c.at - 10 - c.beat.time).toBeCloseTo(0, 6);
    const gaps = played.slice(2).map((c, i) => c.at - played[i + 1].at);
    for (const g of gaps) expect(g).toBeCloseTo(0.5, 6);
    expect(played.map((c) => c.beat.accent)).toEqual([true, false, false, false, true, false, false]);
  });

  it('spaces clicks by the playback speed', () => {
    const { played } = run(0.5, 4);
    const gaps = played.slice(2).map((c, i) => c.at - played[i + 1].at);
    for (const g of gaps) expect(g).toBeCloseTo(1, 2);
  });

  it('cancels booked clicks when the song pauses, and picks up after a jump', () => {
    const r = run(1, 1.4);
    const before = r.played.length;
    // Pause for 0.2 s of audio time.
    for (let i = 0; i < 8; i++) r.tick(0.025, false);
    expect(r.s.clock.paused).toBe(true);
    expect(r.s.pending.every((c) => c.at <= r.audioNow())).toBe(true);
    expect(r.cancelled.length).toBeGreaterThanOrEqual(0);
    // Jump to 3.9 s and keep playing.
    r.setSong(3.9);
    for (let i = 0; i < 20; i++) r.tick(0.025);
    const after = r.played.slice(before).map((c) => c.beat.time);
    expect(after[0]).toBe(4);
    expect(after).toContain(4.5);
  });

  it('can start in the middle of a song', () => {
    const { played } = run(1, 1, 60, 12.3);
    expect(played.map((c) => c.beat.time)).toEqual([13]);
    expect(played[0].beat.accent).toBe(false);
  });
});

describe('metronome', () => {
  function fakeTimers() {
    let id = 0;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let now = 0;
    return {
      set: (fn: () => void, ms: number) => {
        timers.set(++id, { fn, at: now + ms });
        return id;
      },
      clear: (i: number) => void timers.delete(i),
      advance(ms: number, ctx: FakeContext) {
        const end = now + ms;
        for (;;) {
          const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (!next || next[1].at > end) break;
          timers.delete(next[0]);
          now = next[1].at;
          ctx.currentTime = now / 1000;
          next[1].fn();
        }
        now = end;
        ctx.currentTime = now / 1000;
      },
      get size() {
        return timers.size;
      },
    };
  }

  it('counts in and resolves when the song should start', async () => {
    const ctx = new FakeContext();
    const t = fakeTimers();
    const m = createMetronome({ context: () => ctx.asContext(), setTimer: t.set, clearTimer: t.clear });
    let done: boolean | null = null;
    void m.countIn({ beats: 4, bpm: 120 }).then((ok) => (done = ok));
    expect(ctx.oscillators.map((o) => o.started)).toEqual([0.1, 0.6, 1.1, 1.6]);
    // Beat one is higher.
    expect(ctx.oscillators[0].frequency.events[0]).toMatch(/^set 1760/);
    expect(ctx.oscillators[1].frequency.events[0]).toMatch(/^set 1250/);
    t.advance(2000, ctx);
    await Promise.resolve();
    expect(done).toBeNull(); // the fourth beat has not finished yet
    t.advance(200, ctx);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('a count-in honours speed, and stop() cancels it', async () => {
    const ctx = new FakeContext();
    const t = fakeTimers();
    const m = createMetronome({ context: () => ctx.asContext(), setTimer: t.set, clearTimer: t.clear });
    let done: boolean | null = null;
    void m.countIn({ beats: 3, bpm: 60, speed: 0.5 }).then((ok) => (done = ok));
    expect(ctx.oscillators.map((o) => o.started)).toEqual([0.1, 2.1, 4.1]);
    t.advance(500, ctx);
    m.stop();
    await Promise.resolve();
    expect(done).toBe(false);
    expect(ctx.oscillators.every((o) => o.stoppedAt !== null)).toBe(true);
  });

  it('clicks along with a running song and stops cleanly', () => {
    const ctx = new FakeContext();
    const t = fakeTimers();
    const m = createMetronome({ context: () => ctx.asContext(), setTimer: t.set, clearTimer: t.clear });
    m.start({ bpm: 120, beatsPerBar: 4, songTime: () => ctx.currentTime });
    expect(m.running).toBe(true);
    t.advance(2100, ctx);
    const starts = ctx.oscillators.map((o) => o.started!);
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (const [i, s] of starts.entries()) if (i > 0) expect(s - starts[i - 1]).toBeCloseTo(0.5, 6);
    m.stop();
    expect(m.running).toBe(false);
    expect(t.size).toBe(0);
  });

  it('volume and click loudness multiply', () => {
    const ctx = new FakeContext();
    const t = fakeTimers();
    const m = createMetronome({ context: () => ctx.asContext(), setTimer: t.set, clearTimer: t.clear });
    m.setVolume(0.5);
    m.setClickVolume(0.5);
    void m.countIn({ beats: 1, bpm: 100 });
    const out = ctx.gains[0];
    expect(out.gain.value).toBeCloseTo(0.5 * 0.5 * 0.9, 6);
  });
});

describe('starting exactly on a beat', () => {
  it('does not miss the first click when the song starts at a beat', () => {
    let audio = 5;
    let song = 0.004; // a few ms into the song on the first tick
    const played: ScheduledClick[] = [];
    const s = new BeatScheduler({ bpm: 60, beatsPerBar: 4, songTime: () => song }, (c) => played.push(c), () => {});
    s.tick(audio);
    for (let i = 0; i < 10; i++) {
      audio += 0.025;
      song += 0.025;
      s.tick(audio);
    }
    expect(played[0].beat.time).toBe(0);
    expect(played[0].at).toBe(5);
    expect(played[0].beat.accent).toBe(true);
  });
});

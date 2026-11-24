import { describe, expect, it } from 'vitest';
import type { Instrument } from '../src/audio/instrument';
import { Session, type Backing, type SessionEvents } from '../src/player/session';
import { seq, toMidi, type Song } from '../src/song';

const tune: Song = {
  id: 't',
  title: 't',
  by: '',
  notes: [...seq('right', 1, 'C4/1 D4/1'), ...seq('left', 1, 'C3/2')].sort((a, b) => a.start - b.start),
};

function fakeInstrument() {
  const played: number[] = [];
  const instrument: Instrument = {
    wake() {},
    noteOn() {},
    noteOff() {},
    play: (midi) => void played.push(midi),
    setVolume() {},
  };
  return { instrument, played };
}

function fakeBacking(): Backing & { plays: number } {
  return {
    src: '',
    currentTime: 0,
    playbackRate: 1,
    muted: false,
    paused: true,
    ended: false,
    plays: 0,
    async play() {
      this.plays++;
      (this as { paused: boolean }).paused = false;
    },
    pause() {
      (this as { paused: boolean }).paused = true;
    },
  };
}

function record(session: Session) {
  const log: string[] = [];
  const names: (keyof SessionEvents)[] = ['hit', 'miss', 'wrong', 'finished', 'running', 'reset'];
  for (const name of names) session.on(name, () => log.push(name));
  return log;
}

describe('session', () => {
  it('reports hits with timing, wrong keys and the finish in Learn mode', () => {
    const { instrument, played } = fakeInstrument();
    const session = new Session({ audio: { instrument }, backing: fakeBacking() }, tune, { mode: 'wait', hands: 'right', speed: 1 });
    const log = record(session);
    const hits: SessionEvents['hit'][] = [];
    session.on('hit', (e) => hits.push(e));

    session.press(60); // not running yet: ignored
    session.toggle();
    session.tick(0.1);
    session.tick(5); // waits at the first note
    session.press(toMidi('E4'));
    session.press(toMidi('C4'));
    session.tick(5);
    session.press(toMidi('D4'));
    for (let i = 0; i < 40; i++) session.tick(0.1);

    expect(log).toEqual(['running', 'wrong', 'hit', 'hit', 'running', 'finished']);
    expect(hits[0].error).toBe(0);
    expect(hits[0].note.midi).toBe(60);
    expect(played).toEqual([toMidi('C3')]); // the left hand is played for you
    expect(session.running).toBe(false);
  });

  it('reports misses in Play along mode', () => {
    const { instrument } = fakeInstrument();
    const session = new Session({ audio: { instrument }, backing: fakeBacking() }, tune, { mode: 'flow', hands: 'right', speed: 1 });
    const misses: number[] = [];
    session.on('miss', (e) => misses.push(e.note.midi));
    session.start();
    for (let i = 0; i < 60; i++) session.tick(0.1);
    expect(misses).toEqual([60, 62]);
  });

  it('uses the recording as the clock when there is one', () => {
    const { instrument, played } = fakeInstrument();
    const backing = fakeBacking();
    const song = { ...tune, audioUrl: 'blob:x' };
    const session = new Session({ audio: { instrument }, backing }, song, { mode: 'listen', hands: 'both', speed: 0.5 });
    expect(backing.src).toBe('blob:x');
    session.start();
    session.tick(1.5); // lead-in: 1.5 s at half speed covers 0.75 s of song
    session.tick(1.5); // reaches the start of the song
    session.tick(0.016); // the recording takes over
    expect(backing.plays).toBe(1);
    expect(backing.playbackRate).toBe(0.5);
    const before = played.length;
    backing.currentTime = 1.2;
    session.tick(0.016);
    expect(session.game.time).toBeCloseTo(1.2);
    expect(played.length).toBeGreaterThan(before); // Listen mode sounds the lesson's notes over the recording
  });

  it('plays the recording in Learn mode and pauses it while the song waits', () => {
    const { instrument, played } = fakeInstrument();
    const backing = fakeBacking();
    const song = { ...tune, audioUrl: 'blob:x' };
    const session = new Session({ audio: { instrument }, backing }, song, { mode: 'wait', hands: 'right', speed: 1 });
    session.start();
    for (let i = 0; i < 2000 && !session.game.waiting; i++) session.tick(0.01);
    expect(session.game.waiting).toBe(true);
    expect(backing.paused).toBe(true); // silent while waiting for the key
    session.press(toMidi('C4'));
    session.tick(0.01);
    expect(backing.paused).toBe(false);
    expect(backing.currentTime).toBeCloseTo(session.game.time, 1);
    expect(played.length).toBe(0); // the recording makes the sound, not the synth
  });

  it('plays the notes itself when the recording is muted', () => {
    const { instrument, played } = fakeInstrument();
    const backing = fakeBacking();
    const session = new Session({ audio: { instrument }, backing }, { ...tune, audioUrl: 'blob:x' }, { mode: 'listen', hands: 'both', speed: 1 });
    session.recordingMuted = true;
    expect(backing.muted).toBe(true);
    session.start();
    for (let i = 0; i < 400; i++) session.tick(0.01);
    backing.currentTime = 0.5;
    session.tick(0.01);
    expect(played.length).toBeGreaterThan(0);
  });

  it('resets itself after Listen mode finishes', () => {
    const { instrument } = fakeInstrument();
    const session = new Session({ audio: { instrument }, backing: fakeBacking() }, tune, { mode: 'listen', hands: 'both', speed: 1 });
    const log = record(session);
    session.start();
    for (let i = 0; i < 60; i++) session.tick(0.1);
    expect(log.slice(-3)).toEqual(['running', 'finished', 'reset']);
    expect(session.game.time).toBeLessThan(0);
  });

  it('survives a listener that throws', () => {
    const { instrument } = fakeInstrument();
    const session = new Session({ audio: { instrument }, backing: fakeBacking() }, tune, { mode: 'wait', hands: 'right', speed: 1 });
    const error = console.error;
    console.error = () => {};
    let after = false;
    session.on('running', () => {
      throw new Error('boom');
    });
    session.on('running', () => (after = true));
    session.start();
    console.error = error;
    expect(after).toBe(true);
  });
});

describe('session audio look-ahead', () => {
  function timedInstrument() {
    const calls: { midi: number; delay: number }[] = [];
    let cancelled = 0;
    const instrument: Instrument = {
      wake() {},
      noteOn() {},
      noteOff() {},
      play: (midi, _s, _v, delay = 0) => void calls.push({ midi, delay }),
      setVolume() {},
      cancelPending: () => void cancelled++,
    };
    return { instrument, calls, cancelled: () => cancelled };
  }

  it('hands notes due in the next moment to the audio clock with their exact delay, once each', () => {
    const { instrument, calls } = timedInstrument();
    const song: Song = { id: 'a', title: 'a', by: '', notes: seq('right', 0.1, 'C4/1 D4/1 E4/1 F4/1 G4/1 A4/1') };
    const session = new Session({ audio: { instrument }, backing: fakeBacking() }, song, { mode: 'listen', hands: 'both', speed: 1 });
    session.start();
    session.game.time = 0;
    session.tick(0.01);
    // At 0.01 s: C4 (0) now, then D4 (0.1) and E4 (0.2) ahead, each with its own delay.
    expect(calls.map((c) => c.midi)).toEqual([toMidi('C4'), toMidi('D4'), toMidi('E4')]);
    expect(calls[1].delay).toBeCloseTo(0.09);
    expect(calls[2].delay).toBeCloseTo(0.19);
    for (let i = 0; i < 100; i++) session.tick(0.01);
    expect(calls.map((c) => c.midi)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4'].map(toMidi)); // never twice
  });

  it('takes notes back on pause and hands them out again on continue', () => {
    const { instrument, calls, cancelled } = timedInstrument();
    const song: Song = { id: 'a', title: 'a', by: '', notes: seq('right', 0.1, 'C4/1 D4/1 E4/1') };
    const session = new Session({ audio: { instrument }, backing: fakeBacking() }, song, { mode: 'listen', hands: 'both', speed: 1 });
    session.start();
    session.game.time = 0;
    session.tick(0.01);
    expect(calls.length).toBe(3);
    session.pause();
    expect(cancelled()).toBe(1);
    session.start();
    session.tick(0.01);
    expect(calls.slice(3).map((c) => c.midi)).toEqual([toMidi('D4'), toMidi('E4')]);
  });

  it('never looks ahead in Learn mode or past a loop end', () => {
    const { instrument, calls } = timedInstrument();
    const song: Song = { id: 'a', title: 'a', by: '', notes: [...seq('left', 0.1, 'C3/1 D3/1 E3/1 F3/1')] };
    const learn = new Session({ audio: { instrument }, backing: fakeBacking() }, song, { mode: 'wait', hands: 'right', speed: 1 });
    learn.start();
    learn.game.time = 0;
    learn.tick(0.01);
    expect(calls.every((c) => c.delay === 0)).toBe(true);
    calls.length = 0;
    const flow = new Session({ audio: { instrument }, backing: fakeBacking() }, song, { mode: 'flow', hands: 'right', speed: 1 });
    flow.setLoop({ start: 0, end: 0.15 });
    flow.start();
    flow.game.time = 0;
    flow.tick(0.01);
    expect(calls.map((c) => c.midi)).toEqual([toMidi('C3'), toMidi('D3')]);
  });
});

describe('Learn mode with a recording', () => {
  /** A media element that, like a real one, takes a moment to start after play(). */
  function slowBacking(startDelay: number) {
    const b = fakeBacking();
    let since = 0;
    const play = b.play.bind(b);
    b.play = async () => {
      since = 0;
      await play();
    };
    const pause = b.pause.bind(b);
    b.pause = () => pause();
    return Object.assign(b, {
      run(dt: number) {
        if (b.paused) return;
        since += dt;
        if (since > startDelay) b.currentTime += dt * b.playbackRate;
      },
    });
  }

  it('the recording reaches each waiting note, however slowly it starts', () => {
    const { instrument } = fakeInstrument();
    const backing = slowBacking(0.18);
    const song: Song = { id: 'r', title: 'r', by: '', notes: seq('right', 1, '_/1 C4/1 D4/1 E4/1'), audioUrl: 'blob:x' };
    const session = new Session({ audio: { instrument }, backing }, song, { mode: 'wait', hands: 'right', speed: 1 });
    session.start();
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) {
        backing.run(1 / 60);
        session.tick(1 / 60);
      }
    };
    for (const [midi, at] of [['C4', 1], ['D4', 2], ['E4', 3]] as const) {
      frames(240);
      expect(session.game.waiting).toBe(true);
      expect(session.game.time).toBeCloseTo(at, 6);
      expect(backing.paused).toBe(true);
      // The sound got all the way to the note (within a frame), not 0.2 s short of it.
      expect(Math.abs(backing.currentTime - at)).toBeLessThan(0.02);
      session.press(toMidi(midi));
    }
  });

  it('goes on by itself when the recording never starts', () => {
    const { instrument } = fakeInstrument();
    const backing = fakeBacking(); // play() succeeds but the time never moves
    const song: Song = { id: 'r', title: 'r', by: '', notes: seq('right', 1, '_/1 C4/1'), audioUrl: 'blob:x' };
    const session = new Session({ audio: { instrument }, backing }, song, { mode: 'wait', hands: 'right', speed: 1 });
    session.start();
    for (let i = 0; i < 600 && !session.game.waiting; i++) session.tick(1 / 60);
    expect(session.game.waiting).toBe(true);
  });
});

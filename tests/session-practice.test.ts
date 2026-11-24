import { describe, expect, it } from 'vitest';
import type { Instrument } from '../src/audio/instrument';
import { Session, type Backing, type SessionEvents } from '../src/player/session';
import { seq, toMidi, type Song } from '../src/song';

// Right hand C4 D4 E4 F4 G4 one second apart, left hand C3 held under the first two.
const tune: Song = {
  id: 't',
  title: 't',
  by: '',
  notes: [...seq('right', 1, 'C4/1 D4/1 E4/1 F4/1 G4/1'), ...seq('left', 1, 'C3/2')].sort((a, b) => a.start - b.start || a.midi - b.midi),
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

/** A pretend audio element: currentTime only moves when the test moves it, like a real one between frames. */
function fakeBacking(): Backing & { plays: number } {
  return {
    src: '',
    currentTime: 0,
    playbackRate: 1,
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

function make(mode: 'wait' | 'flow' | 'listen', song: Song = tune, backing = fakeBacking()) {
  const { instrument, played } = fakeInstrument();
  const session = new Session({ audio: { instrument }, backing }, song, { mode, hands: 'right', speed: 1 });
  return { session, played, backing };
}

function run(session: Session, seconds: number, step = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += step) session.tick(step);
}

describe('session event stream', () => {
  it('reports hit with timing error, miss, wrong and finished in Play along', () => {
    const { session } = make('flow');
    const log: string[] = [];
    const hits: SessionEvents['hit'][] = [];
    const misses: number[] = [];
    let finished: SessionEvents['finished'] | null = null;
    session.on('hit', (e) => {
      hits.push(e);
      log.push('hit');
    });
    session.on('miss', (e) => {
      misses.push(e.note.midi);
      log.push('miss');
    });
    session.on('wrong', () => log.push('wrong'));
    session.on('finished', (e) => {
      finished = e;
      log.push('finished');
    });
    session.start();
    run(session, 1.6); // lead-in 1.5 s, so 0.1 s after C4
    session.press(toMidi('C4')); // 0.1 s late
    session.press(toMidi('A4')); // wrong
    run(session, 0.85); // now 0.95: D4 is 0.05 s away
    session.press(toMidi('D4')); // 0.05 s early
    run(session, 8);
    expect(log.slice(0, 3)).toEqual(['hit', 'wrong', 'hit']);
    expect(hits[0].error).toBeCloseTo(0.1, 5);
    expect(hits[1].error).toBeCloseTo(-0.05, 5);
    expect(misses).toEqual([toMidi('E4'), toMidi('F4'), toMidi('G4')]);
    expect(log[log.length - 1]).toBe('finished');
    expect(finished).not.toBeNull();
    const r = finished!.result;
    expect(r.hit).toBe(2);
    expect(r.missed).toBe(3);
    expect(r.wrong).toBe(1);
  });

  it('takes the input delay off before judging', () => {
    const { session } = make('flow');
    const hits: number[] = [];
    session.on('hit', (e) => hits.push(e.error));
    session.inputDelay = 0.08;
    session.start();
    run(session, 1.6); // 0.1 s after C4
    session.press(toMidi('C4'));
    expect(hits[0]).toBeCloseTo(0.02, 5);
  });

  it('never reports late in Learn mode, however long you wait', () => {
    const { session } = make('wait');
    const errors: number[] = [];
    session.on('hit', (e) => errors.push(e.error));
    session.start();
    run(session, 20);
    session.press(toMidi('C4'));
    expect(errors).toEqual([0]);
  });
});

describe('seek', () => {
  it('jumps forward, skipping notes without counting them as missed', () => {
    const { session } = make('flow');
    const misses: number[] = [];
    session.on('miss', (e) => misses.push(e.note.midi));
    const seeks: number[] = [];
    session.on('seek', (e) => seeks.push(e.time));
    session.start();
    session.seek(2.9);
    expect(seeks).toEqual([2.9]);
    expect(session.running).toBe(true);
    run(session, 0.2); // 3.1
    session.press(toMidi('F4'));
    run(session, 4);
    expect(misses).toEqual([toMidi('G4')]);
    const r = session.game.result();
    expect(r.hit).toBe(1);
    expect(r.missed).toBe(1); // C4, D4, E4 were skipped, not missed
  });

  it('jumps back and makes notes playable again', () => {
    const { session } = make('wait');
    session.start();
    run(session, 2);
    session.press(toMidi('C4'));
    run(session, 2);
    session.press(toMidi('D4'));
    expect(session.game.state.filter((s) => s === 'hit').length).toBe(2);
    session.seek(0);
    expect(session.game.time).toBe(0);
    expect(session.game.state.filter((s) => s === 'hit').length).toBe(0);
    expect(session.game.nextGroup().map((i) => session.game.notes[i].midi)).toEqual([toMidi('C4')]);
  });

  it('moves the recording with it, so notes stay on the recording', () => {
    const backing = fakeBacking();
    const { session } = make('listen', { ...tune, audioUrl: 'blob:x' }, backing);
    session.start();
    run(session, 1.6);
    backing.currentTime = 0.1;
    session.tick(0.016);
    session.seek(3.25);
    expect(backing.currentTime).toBeCloseTo(3.25);
    backing.currentTime = 3.5;
    session.tick(0.016);
    expect(session.game.time).toBeCloseTo(3.5);
    // Seeking into the lead-in pauses the recording until the song reaches 0 again.
    session.seek(-0.5);
    expect(backing.paused).toBe(true);
    run(session, 0.6);
    expect(backing.paused).toBe(false);
    expect(Math.abs(session.game.time - backing.currentTime)).toBeLessThan(0.06);
  });
});

describe('loop', () => {
  it('goes back to the loop start, judges only the loop and reports each pass', () => {
    const { session } = make('flow');
    const passes: SessionEvents['loop'][] = [];
    session.on('loop', (e) => passes.push(e));
    session.setLoop({ start: 1, end: 2.5 }); // D4 at 1 and E4 at 2
    const lead = session.loopLead();
    expect(session.game.time).toBeCloseTo(1 - lead);
    // Notes outside the loop are played for you.
    expect(session.game.state[session.game.notes.findIndex((n) => n.midi === toMidi('F4'))]).toBe('auto');
    session.start();
    run(session, lead + 0.02);
    session.press(toMidi('D4'));
    run(session, 2);
    expect(passes.length).toBe(1);
    expect(passes[0]).toMatchObject({ pass: 1, hit: 1, missed: 1, wrong: 0 });
    expect(session.game.time).toBeLessThan(2.5);
    expect(session.running).toBe(true);
    // Second pass: all right.
    while (session.game.time < 1) session.tick(0.01);
    session.press(toMidi('D4'));
    while (session.game.time < 2) session.tick(0.01);
    session.press(toMidi('E4'));
    run(session, 1);
    expect(passes[1]).toMatchObject({ pass: 2, hit: 2, missed: 0 });
  });

  it('never finishes while looping, and plays on after the loop is cleared', () => {
    const { session } = make('flow');
    let finished = 0;
    session.on('finished', () => finished++);
    session.setLoop({ start: 0, end: 1.5 });
    session.start();
    run(session, 30);
    expect(finished).toBe(0);
    session.setLoop(null);
    expect(session.loop).toBeNull();
    // Notes after the old loop are yours again.
    expect(session.game.state).toContain('pending');
    run(session, 30);
    expect(finished).toBe(1);
  });

  it('ignores a loop that ends before it starts', () => {
    const { session } = make('flow');
    session.setLoop({ start: 3, end: 2 });
    expect(session.loop).toBeNull();
  });
});

describe('speed change', () => {
  it('changes speed without restarting or losing the place', () => {
    const { session } = make('flow');
    let resets = 0;
    session.on('reset', () => resets++);
    session.start();
    run(session, 2); // 0.5 s into the song
    const before = session.game.time;
    session.setSpeed(0.5);
    expect(resets).toBe(0);
    expect(session.game.time).toBe(before);
    session.tick(0.5);
    expect(session.game.time).toBeCloseTo(before + 0.25);
    expect(session.options.speed).toBe(0.5);
  });

  it('keeps the recording as the clock at the new speed', () => {
    const backing = fakeBacking();
    const { session } = make('flow', { ...tune, audioUrl: 'blob:x' }, backing);
    session.start();
    run(session, 1.55);
    session.tick(0.016);
    expect(backing.paused).toBe(false);
    session.setSpeed(0.75);
    expect(backing.playbackRate).toBe(0.75);
    backing.currentTime = 1.234;
    session.tick(0.016);
    expect(session.game.time).toBeCloseTo(1.234);
  });

  it('sets the recording speed when continuing after a pause', () => {
    const backing = fakeBacking();
    const song = { ...tune, audioUrl: 'blob:x' };
    const { instrument } = fakeInstrument();
    const session = new Session({ audio: { instrument }, backing }, song, { mode: 'listen', hands: 'both', speed: 0.5 });
    session.start();
    run(session, 3.1);
    session.pause();
    backing.playbackRate = 1;
    session.start();
    expect(backing.playbackRate).toBe(0.5);
  });

  it('pausing and continuing never lets the notes drift from the recording', () => {
    const backing = fakeBacking();
    const { session } = make('listen', { ...tune, audioUrl: 'blob:x' }, backing);
    session.start();
    run(session, 1.6);
    for (let i = 0; i < 20; i++) {
      backing.currentTime += 0.05;
      session.tick(0.05);
      if (i % 5 === 0) {
        session.pause();
        session.tick(1); // a frame while paused moves nothing
        session.start();
      }
      expect(session.game.time).toBeCloseTo(backing.currentTime, 6);
    }
  });
});

describe('show me', () => {
  it('plays the coming notes, then comes back to the same spot, paused', () => {
    const { session, played } = make('wait');
    const events: boolean[] = [];
    session.on('preview', (e) => events.push(e.on));
    session.start();
    run(session, 2);
    expect(session.game.time).toBe(0);
    session.preview(2.5);
    expect(session.running).toBe(false);
    expect(session.previewing).toBe(true);
    played.length = 0;
    run(session, 3);
    expect(played).toEqual([toMidi('C3'), toMidi('C4'), toMidi('D4'), toMidi('E4')]);
    expect(session.previewing).toBe(false);
    expect(events).toEqual([true, false]);
    expect(session.game.time).toBe(0);
    expect(session.game.state.includes('hit')).toBe(false);
  });
});

describe('muting the learner\'s own part (microphone)', () => {
  it('keeps playing the other hand but never the learner\'s hand, even in a loop', () => {
    const { session, played } = make('wait');
    session.muteOwnPart = true;
    // A loop around the third note makes the first two right-hand notes "played for you".
    session.setLoop({ start: 2, end: 3 });
    session.seek(0);
    session.start();
    run(session, 1.9);
    expect(played).toContain(toMidi('C3'));
    expect(played).not.toContain(toMidi('C4'));
    expect(played).not.toContain(toMidi('D4'));
  });

  it('plays the learner\'s auto notes when not muted', () => {
    const { session, played } = make('wait');
    session.setLoop({ start: 2, end: 3 });
    session.seek(0);
    session.start();
    run(session, 1.9);
    expect(played).toContain(toMidi('C4'));
  });

  it('leaves Listen mode alone', () => {
    const { session, played } = make('listen');
    session.muteOwnPart = true;
    session.start();
    run(session, 1.5);
    expect(played).toContain(toMidi('C4'));
  });
});

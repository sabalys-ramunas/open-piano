import { describe, expect, it } from 'vitest';
import { announcePlay } from '../src/audio/sounding';
import { browserKind, noMidiAdvice } from '../src/input/browser';
import { describeOffset, measureOffset } from '../src/input/calibrate';
import { InputHub, type NoteSink, type NoteSource } from '../src/input/hub';
import { guessKeyboard, RangeTracker } from '../src/input/key-range';
import { MidiSource, type MidiAccessLike, type MidiInputLike, type MidiOutputLike } from '../src/input/midi';
import { MidiOutput } from '../src/input/midi-out';
import { applyVelocity, FIXED_VELOCITY, parseMidi, pedalIsDown } from '../src/input/midi-parse';

// ---------- A fake Web MIDI system ----------

class FakeInput implements MidiInputLike {
  onmidimessage: ((e: { data: Uint8Array | null }) => void) | null = null;
  constructor(
    readonly id: string,
    readonly name: string | null,
    public state = 'connected',
    readonly manufacturer: string | null = null,
  ) {}
  send(...bytes: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes) });
  }
}

class FakeOutput implements MidiOutputLike {
  sent: { data: number[]; at?: number }[] = [];
  constructor(
    readonly id: string,
    readonly name: string | null,
    public state = 'connected',
  ) {}
  send(data: number[] | Uint8Array, timestamp?: number): void {
    this.sent.push({ data: [...data], at: timestamp });
  }
}

class FakeAccess implements MidiAccessLike {
  inputList: FakeInput[] = [];
  outputList: FakeOutput[] = [];
  onstatechange: ((e: unknown) => void) | null = null;
  get inputs() {
    return { forEach: (fn: (p: MidiInputLike) => void) => this.inputList.forEach(fn) };
  }
  get outputs() {
    return { forEach: (fn: (p: MidiOutputLike) => void) => this.outputList.forEach(fn) };
  }
  plug(port: FakeInput): void {
    this.inputList.push(port);
    this.onstatechange?.({});
  }
  unplug(port: FakeInput): void {
    port.state = 'disconnected';
    this.onstatechange?.({});
  }
  remove(port: FakeInput): void {
    this.inputList = this.inputList.filter((p) => p !== port);
    this.onstatechange?.({});
  }
}

function recorder(): { sink: NoteSink; log: string[] } {
  const log: string[] = [];
  return {
    log,
    sink: {
      down: (m, v) => log.push(`down ${m} ${v.toFixed(2)}`),
      up: (m) => log.push(`up ${m}`),
      pedal: (on, depth) => log.push(`pedal ${on}${depth === undefined ? '' : ` ${depth.toFixed(2)}`}`),
      changed: () => log.push('changed'),
    },
  };
}

async function connected(...ports: FakeInput[]) {
  const access = new FakeAccess();
  access.inputList.push(...ports);
  const midi = new MidiSource(async () => access);
  const { sink, log } = recorder();
  await midi.start(sink);
  log.length = 0;
  return { access, midi, log };
}

// ---------- Parsing ----------

describe('MIDI parsing', () => {
  it('reads notes on every channel, and note-on with velocity 0 as note-off', () => {
    expect(parseMidi([0x90, 60, 100])).toEqual([{ type: 'down', channel: 0, note: 60, velocity: 100 }]);
    expect(parseMidi([0x9f, 61, 1])).toEqual([{ type: 'down', channel: 15, note: 61, velocity: 1 }]);
    expect(parseMidi([0x93, 60, 0])).toEqual([{ type: 'up', channel: 3, note: 60 }]);
    expect(parseMidi([0x85, 60, 64])).toEqual([{ type: 'up', channel: 5, note: 60 }]);
  });

  it('ignores clock, active sensing and other noise, even in the middle of a message', () => {
    expect(parseMidi([0xf8])).toEqual([]);
    expect(parseMidi([0xfe])).toEqual([]);
    expect(parseMidi([0x90, 0xf8, 60, 0xfe, 90])).toEqual([{ type: 'down', channel: 0, note: 60, velocity: 90 }]);
    expect(parseMidi([0xe0, 0, 64])).toEqual([]); // pitch bend
    expect(parseMidi([0xc0, 5])).toEqual([]); // instrument change
    expect(parseMidi([0xd0, 40])).toEqual([]); // aftertouch
    expect(parseMidi([0xb0, 7, 100])).toEqual([]); // volume knob
    expect(parseMidi([0xb0, 1, 100])).toEqual([]); // mod wheel
  });

  it('handles running status, sysex blocks, system messages and truncated data', () => {
    expect(parseMidi([0x90, 60, 100, 62, 90, 60, 0])).toEqual([
      { type: 'down', channel: 0, note: 60, velocity: 100 },
      { type: 'down', channel: 0, note: 62, velocity: 90 },
      { type: 'up', channel: 0, note: 60 },
    ]);
    expect(parseMidi([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7, 0x90, 64, 80])).toEqual([
      { type: 'down', channel: 0, note: 64, velocity: 80 },
    ]);
    expect(parseMidi([0xf2, 10, 20, 64, 80])).toEqual([]); // song position, then stray data: no running status
    expect(parseMidi([0x90, 60])).toEqual([]);
    expect(parseMidi(new Uint8Array(0))).toEqual([]);
    expect(parseMidi(null)).toEqual([]);
  });

  it('reads the sustain pedal, half-pedal values and "all notes off"', () => {
    expect(parseMidi([0xb0, 64, 127])).toEqual([{ type: 'pedal', channel: 0, value: 127 }]);
    expect(parseMidi([0xb2, 64, 50])).toEqual([{ type: 'pedal', channel: 2, value: 50 }]);
    expect(parseMidi([0xb0, 123, 0])).toEqual([{ type: 'all-off', channel: 0 }]);
    expect(parseMidi([0xb1, 120, 0])).toEqual([{ type: 'all-off', channel: 1 }]);
  });
});

describe('touch (velocity curves)', () => {
  it('normal is linear, light is louder, heavy is softer, and fixed ignores the key speed', () => {
    expect(applyVelocity(127)).toBe(1);
    expect(applyVelocity(64)).toBeCloseTo(64 / 127, 10);
    for (const raw of [10, 40, 64, 100]) {
      expect(applyVelocity(raw, 'light')).toBeGreaterThan(applyVelocity(raw, 'normal'));
      expect(applyVelocity(raw, 'heavy')).toBeLessThan(applyVelocity(raw, 'normal'));
    }
    for (const curve of ['light', 'normal', 'heavy'] as const) {
      expect(applyVelocity(127, curve)).toBe(1);
      let last = 0;
      for (let raw = 1; raw <= 127; raw++) {
        const v = applyVelocity(raw, curve);
        expect(v).toBeGreaterThan(last);
        last = v;
      }
    }
    expect(applyVelocity(5, 'normal', true)).toBe(FIXED_VELOCITY);
    expect(applyVelocity(127, 'heavy', true)).toBe(FIXED_VELOCITY);
    expect(applyVelocity(0)).toBeGreaterThan(0);
    expect(applyVelocity(500)).toBe(1);
  });

  it('pedal on/off has a dead band so half-pedal values do not flicker', () => {
    expect(pedalIsDown(127, false)).toBe(true);
    expect(pedalIsDown(0, true)).toBe(false);
    expect(pedalIsDown(25, false)).toBe(false);
    expect(pedalIsDown(25, true)).toBe(true);
    expect(pedalIsDown(32, false)).toBe(true);
    expect(pedalIsDown(19, true)).toBe(false);
  });
});

// ---------- The MIDI source ----------

describe('MIDI source', () => {
  it('reports no support when the browser has no Web MIDI', async () => {
    const midi = new MidiSource(null);
    const { sink, log } = recorder();
    await midi.start(sink);
    expect(midi.status).toBe('unsupported');
    expect(midi.connected).toBe(false);
    expect(log).toEqual([]);
  });

  it('reports a refusal and can ask again', async () => {
    let allow = false;
    const access = new FakeAccess();
    access.inputList.push(new FakeInput('a', 'Stage Piano'));
    const midi = new MidiSource(async () => {
      if (!allow) throw new DOMException('no', 'NotAllowedError');
      return access;
    });
    const statuses: string[] = [];
    midi.onChange(() => statuses.push(midi.status));
    const { sink } = recorder();
    await midi.start(sink);
    expect(midi.status).toBe('denied');
    allow = true;
    expect(await midi.requestAccess()).toBe('ready');
    expect(midi.devices).toEqual(['Stage Piano']);
    expect(statuses).toContain('asking');
    expect(statuses).toContain('denied');
    expect(statuses).toContain('ready');
  });

  it('lists every connected device and plays notes from all of them on all channels', async () => {
    const a = new FakeInput('a', 'Digital Piano');
    const b = new FakeInput('b', null, 'connected', 'Acme');
    const { midi, log } = await connected(a, b);
    expect(midi.devices).toEqual(['Digital Piano', 'Acme keyboard']);
    expect(midi.connected).toBe(true);
    a.send(0x90, 60, 127);
    b.send(0x9a, 48, 64);
    a.send(0x80, 60, 0);
    b.send(0x9a, 48, 0);
    expect(log).toEqual(['down 60 1.00', 'down 48 0.50', 'up 60', 'up 48']);
  });

  it('holds a note pressed on two devices until both let go', async () => {
    const a = new FakeInput('a', 'A');
    const b = new FakeInput('b', 'B');
    const { log } = await connected(a, b);
    a.send(0x90, 60, 100);
    b.send(0x90, 60, 100);
    a.send(0x80, 60, 0);
    expect(log).toEqual(['down 60 0.79']);
    b.send(0x80, 60, 0);
    expect(log).toEqual(['down 60 0.79', 'up 60']);
  });

  it('counts a key struck again without a release as a new press', async () => {
    const a = new FakeInput('a', 'A');
    const { log } = await connected(a);
    a.send(0x90, 60, 100);
    a.send(0x90, 60, 50);
    expect(log).toEqual(['down 60 0.79', 'up 60', 'down 60 0.39']);
  });

  it('accepts a release on a different channel than the press', async () => {
    const a = new FakeInput('a', 'A');
    const { log } = await connected(a);
    a.send(0x91, 62, 64);
    a.send(0x80, 62, 0);
    expect(log).toEqual(['down 62 0.50', 'up 62']);
  });

  it('finds a piano plugged in while playing', async () => {
    const a = new FakeInput('a', 'First');
    const { access, midi, log } = await connected(a);
    const b = new FakeInput('b', 'Second');
    access.plug(b);
    expect(midi.devices).toEqual(['First', 'Second']);
    expect(log).toContain('changed');
    b.send(0x90, 72, 127);
    expect(log).toContain('down 72 1.00');
  });

  it('lets go of every note and the pedal when a piano is unplugged mid-song', async () => {
    const a = new FakeInput('a', 'A');
    const b = new FakeInput('b', 'B');
    const { access, midi, log } = await connected(a, b);
    a.send(0x90, 60, 100);
    a.send(0x90, 64, 100);
    a.send(0xb0, 64, 127);
    b.send(0x90, 67, 100);
    log.length = 0;
    access.unplug(a);
    expect(log).toEqual(['up 60', 'up 64', 'pedal false 0.00', 'changed']);
    expect(midi.devices).toEqual(['B']);
    // The other piano is unaffected.
    b.send(0x80, 67, 0);
    expect(log).toContain('up 67');
  });

  it('also copes with a device that vanishes from the list entirely', async () => {
    const a = new FakeInput('a', 'A');
    const { access, midi, log } = await connected(a);
    a.send(0x90, 50, 100);
    access.remove(a);
    expect(log).toContain('up 50');
    expect(midi.connected).toBe(false);
    expect(midi.ports()).toEqual([]);
  });

  it('switches a device off and on, releasing its notes', async () => {
    const a = new FakeInput('a', 'Pad controller');
    const b = new FakeInput('b', 'Piano');
    const { midi, log } = await connected(a, b);
    const activity: string[] = [];
    midi.onActivity((x) => activity.push(`${x.port} ${x.event.type}`));
    a.send(0x90, 36, 100);
    midi.setDisabled(['Pad controller']);
    expect(log).toContain('up 36');
    expect(midi.devices).toEqual(['Piano']);
    expect(midi.ports().map((p) => [p.name, p.enabled])).toEqual([
      ['Pad controller', false],
      ['Piano', true],
    ]);
    log.length = 0;
    a.send(0x90, 38, 100);
    expect(log).toEqual([]); // plays nothing
    expect(activity).toEqual(['Pad controller down', 'Pad controller down']); // but the helper still sees it
    midi.setDisabled([]);
    a.send(0x90, 38, 100);
    expect(log).toContain('down 38 0.79');
  });

  it('sends pedal depth for half-pedalling and only flips on/off at the thresholds', async () => {
    const a = new FakeInput('a', 'A');
    const { log } = await connected(a);
    a.send(0xb0, 64, 10);
    a.send(0xb0, 64, 40);
    a.send(0xb0, 64, 25);
    a.send(0xb0, 64, 0);
    a.send(0xb0, 64, 127);
    a.send(0xb0, 64, 127); // repeated full value: nothing new
    expect(log).toEqual(['pedal false 0.08', 'pedal true 0.31', 'pedal true 0.20', 'pedal false 0.00', 'pedal true 1.00']);
  });

  it('applies the touch setting and the fixed loudness option', async () => {
    const a = new FakeInput('a', 'A');
    const { midi, log } = await connected(a);
    midi.velocityCurve = 'heavy';
    a.send(0x90, 60, 64);
    midi.fixedVelocity = true;
    a.send(0x90, 62, 10);
    expect(log).toEqual([`down 60 ${applyVelocity(64, 'heavy').toFixed(2)}`, `down 62 ${FIXED_VELOCITY.toFixed(2)}`]);
  });

  it('obeys "all notes off" from the device', async () => {
    const a = new FakeInput('a', 'A');
    const { log } = await connected(a);
    a.send(0x90, 60, 100);
    a.send(0x91, 64, 100);
    a.send(0xb0, 123, 0);
    expect(log).toEqual(['down 60 0.79', 'down 64 0.79', 'up 60']);
  });

  it('releases everything and detaches on stop', async () => {
    const a = new FakeInput('a', 'A');
    const { midi, log } = await connected(a);
    a.send(0x90, 60, 100);
    a.send(0xb0, 64, 127);
    midi.stop();
    expect(log).toEqual(['down 60 0.79', 'pedal true 1.00', 'up 60', 'pedal false 0.00']);
    expect(a.onmidimessage).toBeNull();
    expect(midi.connected).toBe(false);
  });
});

// ---------- Hub with device loss ----------

class FlakySource implements NoteSource {
  readonly id = 'flaky';
  readonly name = 'Flaky';
  connected = true;
  sink: NoteSink | null = null;
  start(sink: NoteSink): void {
    this.sink = sink;
  }
  stop(): void {
    this.sink = null;
  }
}

describe('input hub, device loss', () => {
  it('releases notes and the pedal of a source that loses its device', async () => {
    const hub = new InputHub();
    const src = new FlakySource();
    hub.register(src);
    const log: string[] = [];
    hub.on('up', (e) => log.push(`up ${e.midi}`));
    hub.on('pedal', (e) => log.push(`pedal ${e.on}`));
    await hub.start();
    src.sink!.down(60, 1);
    src.sink!.pedal(true);
    log.length = 0;
    src.connected = false;
    src.sink!.changed();
    expect(log).toEqual(['up 60', 'pedal false']);
    expect(hub.held.size).toBe(0);
    expect(hub.pedal).toBe(false);
  });

  it('passes half-pedal depth on and keeps the other listeners going when one fails', async () => {
    const hub = new InputHub();
    const src = new FlakySource();
    hub.register(src);
    const depths: number[] = [];
    hub.on('down', () => {
      throw new Error('a screen bug');
    });
    const downs: number[] = [];
    hub.on('down', (e) => downs.push(e.midi));
    hub.on('pedalDepth', (e) => depths.push(e.depth));
    await hub.start();
    const original = console.error;
    console.error = () => {};
    try {
      src.sink!.down(62, 0.5);
    } finally {
      console.error = original;
    }
    src.sink!.pedal(true, 0.4);
    src.sink!.pedal(true, 2);
    expect(downs).toEqual([62]);
    expect(depths).toEqual([0.4, 1]);
  });

  it('works end to end with a MIDI device unplugged while a key is down', async () => {
    const access = new FakeAccess();
    const a = new FakeInput('a', 'A');
    access.inputList.push(a);
    const hub = new InputHub();
    hub.register(new MidiSource(async () => access));
    const log: string[] = [];
    hub.on('down', (e) => log.push(`down ${e.midi}`));
    hub.on('up', (e) => log.push(`up ${e.midi}`));
    await hub.start();
    a.send(0x90, 60, 90);
    expect([...hub.held]).toEqual([60]);
    access.unplug(a);
    expect(log).toEqual(['down 60', 'up 60']);
    expect(hub.held.size).toBe(0);
    expect(hub.devices()).toEqual([]);
  });
});

// ---------- MIDI output ----------

describe('MIDI output', () => {
  it('is off by default and sends the app\'s own notes once a device is chosen', async () => {
    const access = new FakeAccess();
    const out = new FakeOutput('o', 'Light-up Keys');
    access.outputList.push(out);
    const midi = new MidiSource(async () => access);
    await midi.start(recorder().sink);
    const sender = new MidiOutput(midi);
    expect(sender.list()).toEqual(['Light-up Keys']);
    announcePlay({ midi: 60, seconds: 0.5, velocity: 0.5 });
    expect(out.sent).toEqual([]);
    sender.select('Light-up Keys');
    announcePlay({ midi: 64, seconds: 0.5, velocity: 1 });
    expect(out.sent[0]).toEqual({ data: [0x90, 64, 127], at: undefined });
    expect(out.sent[1].data).toEqual([0x80, 64, 0]);
    expect(out.sent[1].at).toBeGreaterThan(performance.now() + 400); // timed by the browser
    sender.light(67, true);
    sender.channel = 4;
    sender.noteOn(69, 0.5);
    sender.select('');
    const last = out.sent.slice(-4).map((s) => s.data);
    expect(last).toContainEqual([0xb3, 123, 0]); // all notes off on the chosen channel
    out.sent.length = 0;
    announcePlay({ midi: 70, seconds: 0.5, velocity: 1 });
    expect(out.sent).toEqual([]);
  });
});

// ---------- Keyboard size ----------

describe('keyboard size', () => {
  it('recognises the common sizes from the lowest and highest key', () => {
    expect(guessKeyboard(48, 72)).toEqual({ keys: 25, low: 48, high: 72 });
    expect(guessKeyboard(50, 70)).toEqual({ keys: 25, low: 48, high: 72 });
    expect(guessKeyboard(36, 84)).toEqual({ keys: 49, low: 36, high: 84 });
    expect(guessKeyboard(36, 96)).toEqual({ keys: 61, low: 36, high: 96 });
    expect(guessKeyboard(28, 103)).toEqual({ keys: 76, low: 28, high: 103 });
    expect(guessKeyboard(21, 108)).toEqual({ keys: 88, low: 21, high: 108 });
    expect(guessKeyboard(24, 100)).toEqual({ keys: 88, low: 21, high: 108 });
    expect(guessKeyboard(72, 48)).toEqual({ keys: 25, low: 48, high: 72 }); // order does not matter
  });

  it('follows octave buttons: a 25-key keyboard shifted up an octave', () => {
    expect(guessKeyboard(60, 84)).toEqual({ keys: 25, low: 60, high: 84 });
  });

  it('tracks pressed keys', () => {
    const t = new RangeTracker();
    expect(t.guess()).toBeNull();
    t.add(60);
    expect(t.guess()).toBeNull();
    t.add(36);
    t.add(84);
    expect(t.guess()).toEqual({ keys: 49, low: 36, high: 84 });
    t.reset();
    expect(t.guess()).toBeNull();
  });
});

// ---------- Timing check ----------

describe('timing check maths', () => {
  const clicks = Array.from({ length: 10 }, (_, i) => 1000 + i * 600);

  it('measures a steady late player', () => {
    const taps = clicks.map((c, i) => c + 80 + (i % 2 ? 5 : -5));
    const r = measureOffset(clicks, taps)!;
    expect(r.offsetMs).toBe(80);
    expect(r.used).toBe(8); // the first two clicks are warm-up
    expect(describeOffset(r)).toMatch(/80 ms after the beat/);
  });

  it('measures an early player and ignores a stray double tap and a missed beat', () => {
    const taps = clicks.filter((_, i) => i !== 5).map((c) => c - 30);
    taps.push(clicks[7] + 250); // a stray tap
    const r = measureOffset(clicks, taps)!;
    expect(r.offsetMs).toBe(-30);
    expect(describeOffset(r)).toMatch(/ahead of the beat/);
  });

  it('needs enough taps', () => {
    expect(measureOffset(clicks, [clicks[3] + 20, clicks[4] + 20])).toBeNull();
    expect(measureOffset([1000], [1000])).toBeNull();
  });
});

describe('browser tips', () => {
  it('tells the browsers apart', () => {
    expect(browserKind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1')).toBe('ios');
    expect(browserKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/17.0 Safari/605.1.15', 5)).toBe('ios');
    expect(browserKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/17.0 Safari/605.1.15')).toBe('safari');
    expect(browserKind('Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe('firefox');
    expect(browserKind('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('chromium');
    for (const k of ['ios', 'safari', 'firefox', 'chromium', 'other'] as const) expect(noMidiAdvice(k).length).toBeGreaterThan(20);
  });
});

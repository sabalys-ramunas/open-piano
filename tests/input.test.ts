import { describe, expect, it } from 'vitest';
import { InputHub, type NoteSink, type NoteSource } from '../src/input/hub';
import { MicSource } from '../src/input/mic';
import { MidiSource } from '../src/input/midi';

class FakeSource implements NoteSource {
  sink: NoteSink | null = null;
  connected = true;
  devices: string[] = [];
  stopped = 0;
  constructor(
    readonly id: string,
    readonly name = id,
  ) {}
  start(sink: NoteSink) {
    this.sink = sink;
  }
  stop() {
    this.stopped++;
    this.sink = null;
  }
}

function setup() {
  const hub = new InputHub();
  const a = new FakeSource('a');
  const b = new FakeSource('b');
  hub.register(a);
  hub.register(b);
  const log: string[] = [];
  hub.on('down', (e) => log.push(`down ${e.midi} ${e.source}`));
  hub.on('up', (e) => log.push(`up ${e.midi}`));
  hub.on('pedal', (e) => log.push(`pedal ${e.on}`));
  return { hub, a, b, log };
}

describe('input hub', () => {
  it('merges sources and tracks held keys', async () => {
    const { hub, a, b, log } = setup();
    await hub.start();
    a.sink!.down(60, 0.5);
    b.sink!.down(64, 1);
    expect([...hub.held].sort()).toEqual([60, 64]);
    a.sink!.up(60);
    expect([...hub.held]).toEqual([64]);
    expect(log).toEqual(['down 60 a', 'down 64 b', 'up 60']);
  });

  it('holds a note until every source lets go of it', async () => {
    const { hub, a, b, log } = setup();
    await hub.start();
    a.sink!.down(60, 1);
    b.sink!.down(60, 1);
    a.sink!.up(60);
    expect(hub.held.has(60)).toBe(true);
    b.sink!.up(60);
    expect(hub.held.has(60)).toBe(false);
    expect(log).toEqual(['down 60 a', 'down 60 b', 'up 60']);
  });

  it('ignores sources that have not started, and releases keys when one stops', async () => {
    const { hub, a, b, log } = setup();
    await hub.start('a');
    expect(b.sink).toBeNull();
    a.sink!.down(62, 1);
    hub.stop('a');
    expect(a.stopped).toBe(1);
    expect(hub.held.size).toBe(0);
    expect(log).toEqual(['down 62 a', 'up 62']);
  });

  it('tracks the sustain pedal across sources', async () => {
    const { hub, a, b, log } = setup();
    await hub.start();
    a.sink!.pedal(true);
    b.sink!.pedal(true);
    a.sink!.pedal(false);
    expect(hub.pedal).toBe(true);
    b.sink!.pedal(false);
    expect(log).toEqual(['pedal true', 'pedal false']);
  });

  it('reports device changes and lists connected devices', async () => {
    const { hub, a } = setup();
    let events = 0;
    hub.on('devices', () => events++);
    await hub.start();
    const before = events;
    a.devices = ['Digital Piano'];
    a.sink!.changed();
    expect(events).toBe(before + 1);
    expect(hub.devices()).toEqual(['Digital Piano']);
    a.connected = false;
    expect(hub.devices()).toEqual([]);
  });

  it('refuses two sources with the same id', () => {
    const hub = new InputHub();
    hub.register(new FakeSource('x'));
    expect(() => hub.register(new FakeSource('x'))).toThrow();
  });
});

describe('MIDI messages', () => {
  it('turns note and pedal messages into sink calls', () => {
    const midi = new MidiSource();
    const calls: string[] = [];
    void midi.start({
      down: (m, v) => calls.push(`down ${m} ${v.toFixed(2)}`),
      up: (m) => calls.push(`up ${m}`),
      pedal: (on) => calls.push(`pedal ${on}`),
      changed: () => calls.push('changed'),
    });
    midi.onMessage(new Uint8Array([0x90, 60, 127]));
    midi.onMessage(new Uint8Array([0x91, 62, 64])); // channel 2
    midi.onMessage(new Uint8Array([0x90, 60, 0])); // note on, velocity 0 means off
    midi.onMessage(new Uint8Array([0x80, 62, 40]));
    midi.onMessage(new Uint8Array([0xb0, 64, 127]));
    midi.onMessage(new Uint8Array([0xb0, 64, 0]));
    midi.onMessage(new Uint8Array([0xb0, 7, 100])); // volume knob: ignored
    midi.onMessage(new Uint8Array([0xf8])); // clock: ignored
    expect(calls).toEqual(['down 60 1.00', 'down 62 0.50', 'up 60', 'up 62', 'pedal true', 'pedal false']);
  });
});

describe('microphone source', () => {
  it('stays disconnected and reports no support when the browser has no microphone access', async () => {
    const hub = new InputHub();
    const mic = new MicSource();
    hub.register(mic);
    await hub.start('mic');
    expect(mic.connected).toBe(false);
    expect(mic.status).toBe('unsupported');
    expect(hub.devices()).toEqual([]);
    hub.stop('mic');
  });
});

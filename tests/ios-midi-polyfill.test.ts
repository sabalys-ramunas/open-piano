import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteSink } from '../src/input/hub';
import { MidiSource, type MidiAccessLike, type RequestMidi } from '../src/input/midi';

// The polyfill is injected as a plain string into the iOS web view, so the
// test runs the same file text against fake window, navigator and performance.
const SOURCE = readFileSync(fileURLToPath(new URL('../ios/App/midi-polyfill.js', import.meta.url)), 'utf8');

interface PortInfo {
  id: string;
  name: string;
  manufacturer?: string;
}

interface NativeMessage {
  type: string;
  id?: string;
  data?: number[];
}

interface PolyPort {
  id: string;
  name: string;
  state: string;
  connection: string;
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  send(data: ArrayLike<number>, timestamp?: number): void;
}

interface PolyAccess {
  inputs: Map<string, PolyPort>;
  outputs: Map<string, PolyPort>;
  onstatechange: ((e: { port: PolyPort }) => void) | null;
}

interface NativeMidi {
  ports(inputs: PortInfo[], outputs: PortInfo[]): void;
  receive(id: string, bytes: number[]): void;
}

interface FakeWindow {
  webkit?: { messageHandlers: { midi: { postMessage(message: NativeMessage): void } } };
  __nativeMidi?: NativeMidi;
}

interface FakeNavigator {
  requestMIDIAccess?: () => Promise<PolyAccess>;
}

interface Harness {
  win: FakeWindow;
  nav: FakeNavigator;
  posted: NativeMessage[];
  clock: { t: number };
}

/** Runs the polyfill once, the way the web view does at document start. */
function harness(options: { bridge?: boolean; nav?: FakeNavigator } = {}): Harness {
  const posted: NativeMessage[] = [];
  const clock = { t: 0 };
  const win: FakeWindow = {};
  if (options.bridge !== false) {
    win.webkit = { messageHandlers: { midi: { postMessage: (message) => void posted.push(message) } } };
  }
  const nav: FakeNavigator = options.nav ?? {};
  const perf = { now: () => clock.t };
  const run = new Function('window', 'navigator', 'performance', 'console', SOURCE) as (...args: unknown[]) => void;
  run(win, nav, perf, console);
  return { win, nav, posted, clock };
}

function native(h: Harness): NativeMidi {
  if (!h.win.__nativeMidi) throw new Error('window.__nativeMidi was not defined');
  return h.win.__nativeMidi;
}

function request(h: Harness): Promise<PolyAccess> {
  if (!h.nav.requestMIDIAccess) throw new Error('navigator.requestMIDIAccess was not defined');
  return h.nav.requestMIDIAccess();
}

/** Asks for access and lets native answer with the given device lists. */
async function grant(h: Harness, inputs: PortInfo[] = [], outputs: PortInfo[] = []): Promise<PolyAccess> {
  const pending = request(h);
  native(h).ports(inputs, outputs);
  return pending;
}

function sends(h: Harness): NativeMessage[] {
  return h.posted.filter((m) => m.type === 'send');
}

const PIANO = { id: 'a', name: 'Piano', manufacturer: 'Acme' };

afterEach(() => {
  vi.useRealTimers();
});

describe('ios midi polyfill: setup', () => {
  it('does nothing without the native bridge, so navigator is left untouched', () => {
    const h = harness({ bridge: false });
    expect(h.nav).toEqual({});
    expect(h.win.__nativeMidi).toBeUndefined();
  });

  it('never replaces a real navigator.requestMIDIAccess', () => {
    const real = vi.fn();
    const h = harness({ nav: { requestMIDIAccess: real as unknown as () => Promise<PolyAccess> } });
    expect(h.nav.requestMIDIAccess).toBe(real);
    expect(h.posted).toEqual([]);
    expect(h.win.__nativeMidi).toBeUndefined();
  });
});

describe('ios midi polyfill: requestMIDIAccess', () => {
  it('asks native to start and resolves when the port list arrives, even when it is empty', async () => {
    const h = harness();
    const pending = request(h);
    expect(h.posted).toEqual([{ type: 'start' }]);
    native(h).ports([], []);
    const access = await pending;
    expect(access.inputs.size).toBe(0);
    expect(access.outputs.size).toBe(0);
  });

  it('sends one start message for requests made before the list arrives, and all of them resolve', async () => {
    const h = harness();
    const first = request(h);
    const second = request(h);
    expect(h.posted.filter((m) => m.type === 'start')).toHaveLength(1);
    native(h).ports([PIANO], []);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
  });

  it('a later request resolves at once with the same access and posts nothing', async () => {
    const h = harness();
    const access = await grant(h, [PIANO]);
    const again = await request(h);
    expect(again).toBe(access);
    expect(h.posted.filter((m) => m.type === 'start')).toHaveLength(1);
  });

  it('a page reload starts from nothing: the new page asks native again', async () => {
    const first = harness();
    await grant(first, [PIANO]);
    const reloaded = harness();
    const pending = request(reloaded);
    expect(reloaded.posted).toEqual([{ type: 'start' }]);
    native(reloaded).ports([PIANO], []);
    const access = await pending;
    expect(access.inputs.get('a')?.state).toBe('connected');
  });
});

describe('ios midi polyfill: devices', () => {
  it('plugging a device in later fires statechange on the port and on the access', async () => {
    const h = harness();
    const access = await grant(h);
    const events: string[] = [];
    access.onstatechange = (e) => events.push(`${e.port.id}:${e.port.state}`);
    native(h).ports([PIANO], []);
    expect(events).toEqual(['a:connected']);
    expect(access.inputs.get('a')?.name).toBe('Piano');
  });

  it('unplugging keeps the port listed as disconnected and fires statechange', async () => {
    const h = harness();
    const access = await grant(h, [PIANO]);
    const events: string[] = [];
    access.onstatechange = (e) => events.push(`${e.port.id}:${e.port.state}`);
    native(h).ports([], []);
    expect(events).toEqual(['a:disconnected']);
    expect(access.inputs.get('a')?.state).toBe('disconnected');
    expect(access.inputs.get('a')?.connection).toBe('closed');
  });

  it('plugging the same device back reuses its port object and reports it connected', async () => {
    const h = harness();
    const access = await grant(h, [PIANO]);
    const port = access.inputs.get('a');
    native(h).ports([], []);
    native(h).ports([PIANO], []);
    expect(access.inputs.get('a')).toBe(port);
    expect(port?.state).toBe('connected');
    expect(port?.connection).toBe('open');
  });

  it('messages for an unknown port, or for an unplugged one, are dropped', async () => {
    const h = harness();
    const access = await grant(h, [PIANO]);
    const heard: number[][] = [];
    access.inputs.get('a')!.onmidimessage = (e) => heard.push([...e.data]);
    expect(() => native(h).receive('zzz', [0x90, 60, 100])).not.toThrow();
    native(h).receive('a', [0x90, 60, 100]);
    native(h).ports([], []);
    native(h).receive('a', [0x90, 61, 100]);
    expect(heard).toEqual([[0x90, 60, 100]]);
  });

  it('onmidimessage can be set to null and set again', async () => {
    const h = harness();
    const access = await grant(h, [PIANO]);
    const port = access.inputs.get('a')!;
    const first: number[][] = [];
    const second: number[][] = [];
    port.onmidimessage = (e) => first.push([...e.data]);
    native(h).receive('a', [0x90, 60, 100]);
    port.onmidimessage = null;
    expect(() => native(h).receive('a', [0x90, 61, 100])).not.toThrow();
    port.onmidimessage = (e) => second.push([...e.data]);
    native(h).receive('a', [0x90, 62, 100]);
    expect(first).toEqual([[0x90, 60, 100]]);
    expect(second).toEqual([[0x90, 62, 100]]);
  });

  it('access.inputs.forEach visits every known input, plugged in or not', async () => {
    const h = harness();
    const access = await grant(h, [PIANO, { id: 'b', name: 'Second' }]);
    native(h).ports([PIANO], []);
    const seen: string[] = [];
    access.inputs.forEach((port) => seen.push(`${port.id}:${port.state}`));
    expect(seen).toEqual(['a:connected', 'b:disconnected']);
  });
});

describe('ios midi polyfill: sending', () => {
  it('send with a Uint8Array and with a plain array both post a plain array of bytes', async () => {
    const h = harness();
    const access = await grant(h, [], [{ id: 'o', name: 'Out' }]);
    const out = access.outputs.get('o')!;
    out.send(new Uint8Array([0x90, 60, 100]));
    out.send([0x80, 60, 0]);
    expect(sends(h)).toEqual([
      { type: 'send', id: 'o', data: [0x90, 60, 100] },
      { type: 'send', id: 'o', data: [0x80, 60, 0] },
    ]);
  });

  it('bytes are forced into 0..255, because native converts them to UInt8', async () => {
    const h = harness();
    const access = await grant(h, [], [{ id: 'o', name: 'Out' }]);
    access.outputs.get('o')!.send([256, -1, 300]);
    expect(sends(h)[0]?.data).toEqual([0, 255, 44]);
  });

  it('a timestamp in the future holds the message until that time', async () => {
    vi.useFakeTimers();
    const h = harness();
    const access = await grant(h, [], [{ id: 'o', name: 'Out' }]);
    h.clock.t = 1000;
    access.outputs.get('o')!.send([0x80, 60, 0], 1500);
    expect(sends(h)).toHaveLength(0);
    vi.advanceTimersByTime(499);
    expect(sends(h)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sends(h)).toEqual([{ type: 'send', id: 'o', data: [0x80, 60, 0] }]);
  });

  it('a timestamp in the past sends at once', async () => {
    const h = harness();
    h.clock.t = 2000;
    const access = await grant(h, [], [{ id: 'o', name: 'Out' }]);
    access.outputs.get('o')!.send([0x90, 60, 100], 1000);
    expect(sends(h)).toHaveLength(1);
  });

  it('sending on an unplugged output posts nothing', async () => {
    const h = harness();
    const access = await grant(h, [], [{ id: 'o', name: 'Out' }]);
    const out = access.outputs.get('o')!;
    native(h).ports([], []);
    out.send([0x90, 60, 100]);
    expect(sends(h)).toEqual([]);
  });
});

describe('ios midi polyfill with the app MidiSource', () => {
  /** Starts the real MidiSource on the polyfill's requestMIDIAccess, with one device plugged in. */
  async function started(h: Harness) {
    const request: RequestMidi = () => h.nav.requestMIDIAccess!() as unknown as Promise<MidiAccessLike>;
    const source = new MidiSource(request);
    const down = vi.fn();
    const up = vi.fn();
    const changed = vi.fn();
    const sink: NoteSink = {
      down: (midi, velocity) => down(midi, velocity),
      up: (midi) => up(midi),
      pedal: () => undefined,
      changed: () => changed(),
    };
    const pending = source.start(sink);
    native(h).ports([PIANO], []);
    await pending;
    return { source, down, up, changed };
  }

  it('note on and note off from the device reach the sink as down and up', async () => {
    const h = harness();
    const { source, down, up } = await started(h);
    expect(source.status).toBe('ready');
    expect(source.devices).toEqual(['Piano']);

    native(h).receive('a', [0x90, 60, 100]);
    expect(down).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledWith(60, expect.any(Number));
    const velocity = down.mock.calls[0]?.[1] as number;
    expect(velocity).toBeGreaterThan(0);
    expect(velocity).toBeLessThanOrEqual(1);

    native(h).receive('a', [0x80, 60, 0]);
    expect(up).toHaveBeenCalledWith(60);
  });

  it('unplugging the device releases the notes it was holding', async () => {
    const h = harness();
    const { source, down, up, changed } = await started(h);
    native(h).receive('a', [0x90, 62, 90]);
    expect(down).toHaveBeenCalledWith(62, expect.any(Number));

    native(h).ports([], []);
    expect(up).toHaveBeenCalledWith(62);
    expect(changed).toHaveBeenCalled();
    expect(source.connected).toBe(false);
    expect(source.ports()).toEqual([expect.objectContaining({ id: 'a', connected: false })]);
  });

  it('plugging the same device back in makes its notes work again', async () => {
    const h = harness();
    const { down, up } = await started(h);
    native(h).ports([], []);
    native(h).ports([PIANO], []);
    native(h).receive('a', [0x90, 64, 100]);
    native(h).receive('a', [0x80, 64, 0]);
    expect(down).toHaveBeenCalledWith(64, expect.any(Number));
    expect(up).toHaveBeenCalledWith(64);
  });
});

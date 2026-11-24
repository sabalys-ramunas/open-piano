import type { NoteSink, NoteSource } from './hub';
import { applyVelocity, parseMidi, pedalIsDown, type MidiEvent, type VelocityCurve } from './midi-parse';

/**
 * Where MIDI access stands:
 * - idle: not asked yet
 * - unsupported: this browser has no Web MIDI (Safari, iPhone and iPad)
 * - insecure: the page is not on https or localhost, so the browser hides MIDI
 * - asking: waiting for the person to answer the browser's question
 * - denied: the person (or a browser setting) said no
 * - ready: listening to every connected device
 */
export type MidiStatus = 'idle' | 'unsupported' | 'insecure' | 'asking' | 'denied' | 'ready';

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
  enabled: boolean;
}

/** Something that arrived from a device, for the connection helper's live display. */
export interface MidiActivity {
  port: string;
  event: MidiEvent;
  at: number;
}

/** Minimal shapes of the Web MIDI objects we use, so tests can pass fakes. */
export interface MidiInputLike {
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer?: string | null;
  readonly state: string;
  onmidimessage: ((e: { data: Uint8Array | null }) => void) | null;
  close?(): Promise<unknown>;
}
export interface MidiOutputLike {
  readonly id: string;
  readonly name: string | null;
  readonly state: string;
  send(data: number[] | Uint8Array, timestamp?: number): void;
}
export interface MidiAccessLike {
  readonly inputs: { forEach(fn: (port: MidiInputLike) => void): void };
  readonly outputs: { forEach(fn: (port: MidiOutputLike) => void): void };
  onstatechange: ((e: unknown) => void) | null;
}
export type RequestMidi = () => Promise<MidiAccessLike>;

/** Port id used by `onMessage` when no real port is involved (tests, old callers). */
const DIRECT = 'direct';

function defaultRequest(): RequestMidi | null {
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') return null;
  return () => navigator.requestMIDIAccess({ sysex: false }) as unknown as Promise<MidiAccessLike>;
}

/**
 * Connects every MIDI keyboard plugged into the computer (USB, or Bluetooth
 * where the system supports it), now and later. Handles plugging in and out
 * while playing, several devices at once with a per-device on/off switch,
 * every channel, note-on with velocity 0, the sustain pedal (including
 * half-pedal values) and stuck notes when a device disappears.
 */
export class MidiSource implements NoteSource {
  readonly id = 'midi';
  readonly name = 'Piano keyboard';
  status: MidiStatus = 'idle';
  /** Touch: how hard you need to play for a loud note. */
  velocityCurve: VelocityCurve = 'normal';
  /** Every key press at the same loudness. */
  fixedVelocity = false;
  /**
   * When true, `start` does not ask the browser for MIDI access: the browser
   * would show a permission question with no context. The connection helper
   * then calls `requestAccess` from a button press. The app sets this unless
   * access was already granted on an earlier visit.
   */
  deferAccess = false;

  private access: MidiAccessLike | null = null;
  private sink: NoteSink | null = null;
  private disabled = new Set<string>();
  private known = new Map<string, MidiInputLike>();
  private heldBy = new Map<string, Map<string, number>>(); // port -> "channel:note" -> note
  private noteCount = new Map<number, number>(); // note -> how many port/channel pairs hold it
  private pedalBy = new Map<string, number>(); // port -> last pedal value
  private pedalDown = new Set<string>();
  private listeners = new Set<() => void>();
  private activity = new Set<(a: MidiActivity) => void>();
  private request: RequestMidi | null;

  constructor(request?: RequestMidi | null) {
    this.request = request === undefined ? defaultRequest() : request;
  }

  /** True once the browser has granted MIDI access. */
  get available(): boolean {
    return this.status === 'ready';
  }

  /** Names of the connected devices that are switched on. */
  get devices(): string[] {
    return this.ports()
      .filter((p) => p.connected && p.enabled)
      .map((p) => p.name);
  }

  get connected(): boolean {
    return this.devices.length > 0;
  }

  /** Every input device the browser knows about, plugged in or not. */
  ports(): MidiPortInfo[] {
    return [...this.known.values()].map((p) => ({
      id: p.id,
      name: portName(p),
      manufacturer: p.manufacturer ?? '',
      connected: p.state === 'connected',
      enabled: !this.disabled.has(portName(p)),
    }));
  }

  /** Output devices, for sending the app's notes to the piano. */
  outputs(): MidiOutputLike[] {
    const out: MidiOutputLike[] = [];
    this.access?.outputs.forEach((p) => {
      if (p.state === 'connected') out.push(p);
    });
    return out;
  }

  /** Names of devices the player switched off (from settings.midiDisabled). */
  setDisabled(names: Iterable<string>): void {
    const next = new Set(names);
    const same = next.size === this.disabled.size && [...next].every((n) => this.disabled.has(n));
    if (same) return;
    this.disabled = next;
    this.hook();
  }

  isEnabled(name: string): boolean {
    return !this.disabled.has(name);
  }

  /** Called when status, devices or switches change. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every note and pedal message from any device (switched off ones too), for the connection helper. */
  onActivity(listener: (a: MidiActivity) => void): () => void {
    this.activity.add(listener);
    return () => this.activity.delete(listener);
  }

  async start(sink: NoteSink): Promise<void> {
    this.sink = sink;
    if (this.deferAccess && !this.access) {
      if (this.request) this.setStatus('idle');
      else this.setStatus(typeof isSecureContext !== 'undefined' && !isSecureContext ? 'insecure' : 'unsupported');
      return;
    }
    await this.connect();
  }

  /**
   * Asks the browser for MIDI access (again). Call from a button press so the
   * browser shows its question; safe to call when already connected.
   */
  async requestAccess(): Promise<MidiStatus> {
    await this.connect();
    return this.status;
  }

  private async connect(): Promise<void> {
    if (this.access) return;
    if (!this.request) {
      this.setStatus(typeof isSecureContext !== 'undefined' && !isSecureContext ? 'insecure' : 'unsupported');
      return;
    }
    this.setStatus('asking');
    let access: MidiAccessLike;
    try {
      access = await this.request();
    } catch (error) {
      // The person said no, a browser setting blocks it, or (Firefox) the site permission add-on was refused.
      console.info('MIDI access was not granted.', error);
      this.setStatus('denied');
      return;
    }
    if (this.access) return; // a second request finished first
    this.access = access;
    access.onstatechange = () => this.hook();
    this.setStatus('ready');
    this.hook();
  }

  stop(): void {
    if (this.access) {
      this.access.onstatechange = null;
      this.access.inputs.forEach((port) => (port.onmidimessage = null));
    }
    for (const port of [...this.heldBy.keys()]) this.releasePort(port);
    this.releasePort(DIRECT);
    this.access = null;
    this.known.clear();
    this.sink = null;
    if (this.status === 'ready') this.status = 'idle';
  }

  private setStatus(status: MidiStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.notify(false);
  }

  /** Tells listeners; `devices` also tells the hub (the device list may have changed). */
  private notify(devices: boolean): void {
    if (devices) this.sink?.changed();
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (error) {
        console.error('A MIDI change listener failed.', error);
      }
    }
  }

  /** Re-reads the device list: listens to new devices, lets go of notes from lost or switched-off ones. */
  private hook(): void {
    if (!this.access) return;
    const seen = new Set<string>();
    this.access.inputs.forEach((port) => {
      seen.add(port.id);
      this.known.set(port.id, port);
      const live = port.state === 'connected' && !this.disabled.has(portName(port));
      if (live) {
        // Setting the handler also opens the port.
        port.onmidimessage = (e) => this.onMessage(e.data, port.id);
      } else {
        port.onmidimessage = this.disabled.has(portName(port)) ? (e) => this.spy(e.data, port.id) : null;
        this.releasePort(port.id);
      }
    });
    for (const id of [...this.known.keys()]) {
      if (seen.has(id)) continue;
      this.known.delete(id);
      this.releasePort(id);
    }
    this.notify(true);
  }

  /** A switched-off device still shows activity in the helper, but plays nothing. */
  private spy(data: Uint8Array | null, port: string): void {
    for (const event of parseMidi(data)) this.emitActivity(port, event);
  }

  private emitActivity(port: string, event: MidiEvent): void {
    if (this.activity.size === 0) return;
    const a: MidiActivity = { port: this.known.get(port) ? portName(this.known.get(port)!) : port, event, at: now() };
    for (const l of [...this.activity]) {
      try {
        l(a);
      } catch (error) {
        console.error('A MIDI activity listener failed.', error);
      }
    }
  }

  /** Handles one MIDI packet from `port`. Public for tests. */
  onMessage(data: Uint8Array | null, port = DIRECT): void {
    for (const event of parseMidi(data)) {
      this.emitActivity(port, event);
      if (!this.sink) continue;
      switch (event.type) {
        case 'down':
          this.down(port, event.channel, event.note, applyVelocity(event.velocity, this.velocityCurve, this.fixedVelocity));
          break;
        case 'up':
          this.up(port, event.channel, event.note);
          break;
        case 'pedal':
          this.pedal(port, event.value);
          break;
        case 'all-off':
          this.releasePort(port, event.channel);
          break;
      }
    }
  }

  private down(port: string, channel: number, note: number, velocity: number): void {
    let held = this.heldBy.get(port);
    if (!held) this.heldBy.set(port, (held = new Map()));
    const key = `${channel}:${note}`;
    if (held.has(key)) {
      // Struck again without a release in between: count it as a new press.
      this.sink?.up(note);
      this.sink?.down(note, velocity);
      return;
    }
    held.set(key, note);
    const count = (this.noteCount.get(note) ?? 0) + 1;
    this.noteCount.set(note, count);
    if (count === 1) this.sink?.down(note, velocity);
  }

  private up(port: string, channel: number, note: number): void {
    const held = this.heldBy.get(port);
    if (!held) return;
    if (!held.delete(`${channel}:${note}`)) {
      // Some devices release a note on a different channel than they pressed it.
      const other = [...held].find(([, n]) => n === note)?.[0];
      if (other === undefined) return;
      held.delete(other);
    }
    const count = (this.noteCount.get(note) ?? 1) - 1;
    if (count > 0) {
      this.noteCount.set(note, count);
      return;
    }
    this.noteCount.delete(note);
    this.sink?.up(note);
  }

  private pedal(port: string, value: number): void {
    const was = this.pedalDown.size > 0;
    const portWas = this.pedalDown.has(port);
    if (pedalIsDown(value, portWas)) this.pedalDown.add(port);
    else this.pedalDown.delete(port);
    this.pedalBy.set(port, value);
    const depth = Math.max(0, ...this.pedalBy.values()) / 127;
    const is = this.pedalDown.size > 0;
    if (is !== was || value % 127 !== 0) this.sink?.pedal(is, depth);
  }

  /** Lets go of every note (on one channel, or all) and the pedal of a device. */
  private releasePort(port: string, channel?: number): void {
    const held = this.heldBy.get(port);
    if (held) {
      for (const [key, note] of [...held]) {
        if (channel !== undefined && !key.startsWith(`${channel}:`)) continue;
        this.up(port, Number(key.split(':')[0]), note);
      }
      if (held.size === 0) this.heldBy.delete(port);
    }
    if (channel === undefined && this.pedalBy.has(port)) {
      this.pedalBy.delete(port);
      const was = this.pedalDown.delete(port);
      if (was && this.pedalDown.size === 0) this.sink?.pedal(false, 0);
    }
  }
}

function portName(port: { name: string | null; manufacturer?: string | null }): string {
  const name = (port.name ?? '').trim();
  if (name) return name;
  const maker = (port.manufacturer ?? '').trim();
  return maker ? `${maker} keyboard` : 'MIDI keyboard';
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

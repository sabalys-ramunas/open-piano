/** A tiny stand-in for the Web Audio API: records what was asked of it, makes no sound. */

export class FakeParam {
  value: number;
  events: string[] = [];
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime(v: number, t: number): this {
    this.events.push(`set ${v} @${t}`);
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.events.push(`linear ${v} @${t}`);
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.events.push(`exp ${v} @${t}`);
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number): this {
    this.events.push(`target ${v} @${t} tau ${tau}`);
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.events.push(`cancel @${t}`);
    return this;
  }
  cancelAndHoldAtTime(t: number): this {
    this.events.push(`hold @${t}`);
    return this;
  }
}

export class FakeNode {
  connections: unknown[] = [];
  connect<T>(node: T): T {
    this.connections.push(node);
    return node;
  }
  disconnect(): void {
    this.connections = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  private data: Float32Array[];
  constructor(
    channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.numberOfChannels = channels;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam(1);
  started: { when: number; offset: number } | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(when = 0, offset = 0): void {
    this.started = { when, offset };
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
  /** Pretends playback finished. */
  end(): void {
    this.onended?.();
  }
}

export class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam(440);
  started: number | null = null;
  stoppedAt: number | null = null;
  start(when = 0): void {
    this.started = when;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

export class FakeContext {
  currentTime = 0;
  sampleRate = 44100;
  state = 'running';
  destination = new FakeNode();
  sources: FakeSource[] = [];
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam; Q: FakeParam } {
    return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) });
  }
  createConvolver(): FakeNode & { buffer: FakeBuffer | null } {
    return Object.assign(new FakeNode(), { buffer: null as FakeBuffer | null });
  }
  createDynamicsCompressor(): FakeNode & Record<'threshold' | 'knee' | 'ratio' | 'attack' | 'release', FakeParam> {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  asContext(): BaseAudioContext {
    return this as unknown as BaseAudioContext;
  }
}

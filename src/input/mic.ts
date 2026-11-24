import { audioContext } from '../audio/context';
import { isSounding } from '../audio/sounding';
import type { NoteSink, NoteSource } from './hub';
import type { NoteTracker } from './pitch';

/**
 * Where the microphone stands:
 * - off: not listening
 * - asking: waiting for the person to allow the microphone
 * - listening: hearing notes
 * - denied: the person or the browser said no
 * - unsupported: no microphone access in this browser (or the page is not on https)
 * - error: something else went wrong (no microphone plugged in, it is busy)
 */
export type MicStatus = 'off' | 'asking' | 'listening' | 'denied' | 'unsupported' | 'error';

/** The capture step runs on the audio thread and only copies samples out, in blocks of 512. */
const WORKLET = `
class PianoMicTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(512); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('piano-mic-tap', PianoMicTap);
`;

/**
 * Hears an acoustic piano through the microphone and reports the notes it
 * recognises. Works best one note at a time; simple two-note chords mostly
 * work; bigger chords and octaves are often incomplete. Ignores the notes
 * the app itself is playing (they come back through the speakers), but
 * headphones work better still. Started by the hub only while
 * settings.micEnabled is on; asks for the microphone in `start`.
 */
export class MicSource implements NoteSource {
  readonly id = 'mic';
  readonly name = 'Microphone';
  connected = false;
  status: MicStatus = 'off';
  /** Name of the microphone in use, when the browser tells us. */
  deviceName = '';
  private sink: NoteSink | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private tracker: NoteTracker | null = null;
  private sensitivityValue = 0.5;
  private noiseFloorValue = 0;
  private listeners = new Set<() => void>();
  private levelListeners = new Set<(rms: number) => void>();
  private noteListeners = new Set<(midi: number) => void>();
  private startToken = 0;

  get devices(): readonly string[] {
    return this.connected && this.deviceName ? [this.deviceName] : [];
  }

  /** True while the microphone is open and notes are being listened for. */
  get listening(): boolean {
    return this.sink !== null && this.connected;
  }

  set sensitivity(value: number) {
    this.sensitivityValue = Math.min(1, Math.max(0, value));
    if (this.tracker) this.tracker.sensitivity = this.sensitivityValue;
  }

  get sensitivity(): number {
    return this.sensitivityValue;
  }

  set noiseFloor(value: number) {
    this.noiseFloorValue = Math.min(1, Math.max(0, value));
    if (this.tracker) this.tracker.noiseFloor = this.noiseFloorValue;
  }

  get noiseFloor(): number {
    return this.noiseFloorValue;
  }

  /** Called when status changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sound level (RMS, 0..1) about 86 times a second while listening, for a level meter. */
  onLevel(listener: (rms: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  /** Every note heard (also when nothing else is listening), for the settings screen. */
  onNote(listener: (midi: number) => void): () => void {
    this.noteListeners.add(listener);
    return () => this.noteListeners.delete(listener);
  }

  private setStatus(status: MicStatus): void {
    if (status === this.status) return;
    this.status = status;
    for (const l of [...this.listeners]) l();
  }

  async start(sink: NoteSink): Promise<void> {
    this.sink = sink;
    const token = ++this.startToken;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media || typeof media.getUserMedia !== 'function' || typeof AudioContext === 'undefined') {
      this.setStatus('unsupported');
      return;
    }
    this.setStatus('asking');
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({
        audio: {
          // Speech processing hurts music: keep the piano sound as it is.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      this.setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
      console.info('The microphone could not be opened.', error);
      return;
    }
    if (token !== this.startToken || !this.sink) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.stream = stream;
    this.deviceName = stream.getAudioTracks()[0]?.label ?? '';
    try {
      await this.connectGraph(stream);
    } catch (error) {
      console.warn('Listening through the microphone failed.', error);
      this.close();
      this.setStatus('error');
      return;
    }
    if (token !== this.startToken) return;
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        // Unplugged or taken away by the system.
        this.release();
        this.close();
        this.setStatus('error');
        this.sink?.changed();
      });
    }
    this.connected = true;
    this.setStatus('listening');
    this.sink.changed();
  }

  private async connectGraph(stream: MediaStream): Promise<void> {
    const ctx = audioContext();
    // Pitch detection is loaded only when the microphone is used: most visits never need it.
    const { NoteTracker } = await import('./pitch');
    this.tracker = new NoteTracker({
      sampleRate: ctx.sampleRate,
      sensitivity: this.sensitivityValue,
      noiseFloor: this.noiseFloorValue,
      isAppSounding: (midi) => isSounding(midi),
    });
    const source = ctx.createMediaStreamSource(stream);
    const silent = ctx.createGain();
    silent.gain.value = 0; // keeps the capture node running without playing the microphone back
    silent.connect(ctx.destination);
    this.nodes = [source, silent];
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const tap = new AudioWorkletNode(ctx, 'piano-mic-tap', { numberOfInputs: 1, numberOfOutputs: 1 });
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.hear(e.data);
      source.connect(tap).connect(silent);
      this.nodes.push(tap);
    } else {
      // Older browsers: the deprecated ScriptProcessor does the same job on the main thread.
      const proc = ctx.createScriptProcessor(1024, 1, 1);
      proc.onaudioprocess = (e) => this.hear(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(proc).connect(silent);
      this.nodes.push(proc);
    }
  }

  private hear(samples: Float32Array): void {
    const tracker = this.tracker;
    if (!tracker) return;
    if (this.levelListeners.size) {
      let s = 0;
      for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
      const rms = Math.sqrt(s / samples.length);
      for (const l of this.levelListeners) l(rms);
    }
    for (const event of tracker.push(samples)) {
      if (event.type === 'on') {
        this.sink?.down(event.midi, event.velocity);
        for (const l of this.noteListeners) l(event.midi);
      } else {
        this.sink?.up(event.midi);
      }
    }
  }

  /**
   * Measures the room's background noise for `ms` milliseconds (stay quiet).
   * Resolves with the level to store in settings.micNoiseFloor, or null when
   * the microphone is not listening.
   */
  measureNoise(ms = 2000): Promise<number | null> {
    if (!this.listening) return Promise.resolve(null);
    return new Promise((resolve) => {
      const levels: number[] = [];
      const off = this.onLevel((rms) => levels.push(rms));
      setTimeout(() => {
        off();
        if (levels.length === 0) return resolve(null);
        levels.sort((a, b) => a - b);
        // A high percentile, so a cough or a chair creak does not count but steady noise does.
        resolve(Math.min(1, levels[Math.floor(levels.length * 0.8)]));
      }, ms);
    });
  }

  private release(): void {
    if (!this.tracker) return;
    for (const event of this.tracker.flush()) this.sink?.up(event.midi);
  }

  private close(): void {
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
      if (typeof AudioWorkletNode !== 'undefined' && node instanceof AudioWorkletNode) node.port.onmessage = null;
      if (typeof ScriptProcessorNode !== 'undefined' && node instanceof ScriptProcessorNode) node.onaudioprocess = null;
    }
    this.nodes = [];
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.tracker = null;
    this.connected = false;
  }

  stop(): void {
    this.startToken++;
    this.release();
    this.close();
    this.sink = null;
    this.setStatus('off');
  }
}

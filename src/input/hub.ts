/** Where a source sends what it hears. */
export interface NoteSink {
  /** A key went down. Velocity 0..1. */
  down(midi: number, velocity: number): void;
  up(midi: number): void;
  /** Sustain pedal (MIDI CC 64). `depth` 0..1 when the pedal reports how far it is pressed. */
  pedal(on: boolean, depth?: number): void;
  /** Call when `connected` or `devices` changed. */
  changed(): void;
}

/** Anything that produces notes: computer keys, the on-screen keys, a MIDI piano, a microphone. */
export interface NoteSource {
  /** Stable id, e.g. 'keyboard', 'pointer', 'midi', 'mic'. */
  readonly id: string;
  /** Friendly name for the UI. */
  readonly name: string;
  /** True when the source can produce notes right now (for MIDI: a device is plugged in). */
  readonly connected: boolean;
  /** Names of physical devices behind this source, if any (MIDI keyboards). */
  readonly devices?: readonly string[];
  start(sink: NoteSink): void | Promise<void>;
  stop(): void;
}

export interface HubEvents {
  down: { midi: number; velocity: number; source: string };
  up: { midi: number; source: string };
  pedal: { on: boolean; source: string };
  /** How far the sustain pedal is pressed, 0..1 (pianos with half-pedal support). */
  pedalDepth: { depth: number; source: string };
  /** A source connected, disconnected, or its device list changed. */
  devices: { sources: readonly NoteSource[] };
}

type Handler<K extends keyof HubEvents> = (event: HubEvents[K]) => void;

/**
 * Merges every note source into one stream and tracks which keys are held.
 * A note pressed on two sources at once stays held until both let go.
 */
export class InputHub {
  private sources = new Map<string, { source: NoteSource; running: boolean; held: Set<number> }>();
  private counts = new Map<number, number>();
  private handlers: { [K in keyof HubEvents]: Set<Handler<K>> } = {
    down: new Set(),
    up: new Set(),
    pedal: new Set(),
    pedalDepth: new Set(),
    devices: new Set(),
  };
  private pedalBy = new Set<string>();

  /** Adds a source. It does not start until `start` is called. */
  register(source: NoteSource): void {
    if (this.sources.has(source.id)) throw new Error(`Input source ${source.id} is already registered`);
    this.sources.set(source.id, { source, running: false, held: new Set() });
  }

  /** Starts one source by id, or every registered source. */
  async start(id?: string): Promise<void> {
    const entries = id ? [this.sources.get(id)].filter((e) => e !== undefined) : [...this.sources.values()];
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.running) return;
        entry.running = true;
        try {
          await entry.source.start(this.sinkFor(entry.source.id));
        } catch (error) {
          console.warn(`Input source ${entry.source.id} could not start.`, error);
        }
        this.emit('devices', { sources: this.list() });
      }),
    );
  }

  /** Stops one source by id, or all. Keys it was holding are released. */
  stop(id?: string): void {
    const entries = id ? [this.sources.get(id)].filter((e) => e !== undefined) : [...this.sources.values()];
    for (const entry of entries) {
      if (!entry.running) continue;
      entry.running = false;
      entry.source.stop();
      for (const midi of [...entry.held]) this.release(entry.source.id, midi);
      if (this.pedalBy.delete(entry.source.id) && this.pedalBy.size === 0) {
        this.emit('pedal', { on: false, source: entry.source.id });
      }
    }
  }

  get<T extends NoteSource = NoteSource>(id: string): T | undefined {
    return this.sources.get(id)?.source as T | undefined;
  }

  list(): NoteSource[] {
    return [...this.sources.values()].map((e) => e.source);
  }

  /** Names of every connected physical device, e.g. MIDI keyboards. */
  devices(): string[] {
    return this.list().flatMap((s) => (s.connected ? [...(s.devices ?? [])] : []));
  }

  /** Keys held right now, across all sources. */
  get held(): ReadonlySet<number> {
    return new Set(this.counts.keys());
  }

  get pedal(): boolean {
    return this.pedalBy.size > 0;
  }

  on<K extends keyof HubEvents>(event: K, handler: Handler<K>): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
  }

  private sinkFor(id: string): NoteSink {
    return {
      down: (midi, velocity) => {
        const entry = this.sources.get(id);
        if (!entry?.running || entry.held.has(midi)) return;
        entry.held.add(midi);
        this.counts.set(midi, (this.counts.get(midi) ?? 0) + 1);
        this.emit('down', { midi, velocity, source: id });
      },
      up: (midi) => this.release(id, midi),
      pedal: (on, depth) => {
        if (!this.sources.get(id)?.running) return;
        const was = this.pedal;
        if (on) this.pedalBy.add(id);
        else this.pedalBy.delete(id);
        if (this.pedal !== was) this.emit('pedal', { on: this.pedal, source: id });
        if (depth !== undefined && Number.isFinite(depth)) {
          this.emit('pedalDepth', { depth: Math.min(1, Math.max(0, depth)), source: id });
        }
      },
      changed: () => {
        const entry = this.sources.get(id);
        // Stuck-note protection: a source that lost its device lets go of everything.
        if (entry && !entry.source.connected) {
          for (const midi of [...entry.held]) this.release(id, midi);
          if (this.pedalBy.delete(id) && this.pedalBy.size === 0) this.emit('pedal', { on: false, source: id });
        }
        this.emit('devices', { sources: this.list() });
      },
    };
  }

  private release(id: string, midi: number): void {
    const entry = this.sources.get(id);
    if (!entry?.held.delete(midi)) return;
    const count = (this.counts.get(midi) ?? 1) - 1;
    if (count > 0) {
      this.counts.set(midi, count);
      return;
    }
    this.counts.delete(midi);
    this.emit('up', { midi, source: id });
  }

  private emit<K extends keyof HubEvents>(event: K, payload: HubEvents[K]): void {
    // One failing listener (a screen bug) must never stop the others, e.g. the sound.
    for (const h of [...this.handlers[event]]) {
      try {
        h(payload);
      } catch (error) {
        console.error(`An input ${event} listener failed.`, error);
      }
    }
  }
}

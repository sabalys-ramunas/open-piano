import { onAppNote } from '../audio/sounding';
import type { MidiOutputLike, MidiSource } from './midi';

/**
 * Sends notes to the player's piano: the notes the app plays by itself (the
 * other hand, "Listen" mode) so the piano's own sound plays them, or keys
 * lit on keyboards with light-up keys. Off until an output is chosen.
 */
export class MidiOutput {
  private name = '';
  private sent = new Map<number, number>(); // midi -> notes on not yet off
  private unsubscribe: (() => void) | null = null;
  /** MIDI channel 1..16 the notes go out on. Light-up keyboards sometimes need a particular one. */
  channel = 1;

  constructor(private readonly source: MidiSource) {}

  /** Output devices you can choose from right now. */
  list(): string[] {
    return [...new Set(this.source.outputs().map((p) => p.name ?? 'MIDI output'))];
  }

  /** The chosen output name ('' = off). */
  get selected(): string {
    return this.name;
  }

  /** Chooses an output by name; '' turns sending off. Follows the app's own notes while on. */
  select(name: string): void {
    if (name === this.name) return;
    this.allOff();
    this.name = name;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (name) {
      this.unsubscribe = onAppNote(({ midi, seconds, velocity }) => {
        this.noteOn(midi, velocity);
        this.noteOff(midi, seconds * 1000);
      });
    }
  }

  private port(): MidiOutputLike | null {
    if (!this.name) return null;
    return this.source.outputs().find((p) => (p.name ?? 'MIDI output') === this.name) ?? null;
  }

  private status(kind: number): number {
    return kind | (Math.min(16, Math.max(1, Math.round(this.channel))) - 1);
  }

  /** Key down on the piano (or light the key). */
  noteOn(midi: number, velocity = 0.7): void {
    const port = this.port();
    if (!port || midi < 0 || midi > 127) return;
    const v = Math.min(127, Math.max(1, Math.round(velocity * 127)));
    try {
      port.send([this.status(0x90), midi, v]);
      this.sent.set(midi, (this.sent.get(midi) ?? 0) + 1);
    } catch (error) {
      console.warn('Could not send a note to the piano.', error);
    }
  }

  /** Key up, now or `afterMs` from now (timed by the browser, so it stays exact). */
  noteOff(midi: number, afterMs = 0): void {
    const port = this.port();
    if (!port || midi < 0 || midi > 127) return;
    const at = afterMs > 0 && typeof performance !== 'undefined' ? performance.now() + afterMs : undefined;
    try {
      port.send([this.status(0x80), midi, 0], at);
    } catch (error) {
      console.warn('Could not send a note to the piano.', error);
    }
    const left = (this.sent.get(midi) ?? 1) - 1;
    if (left > 0) this.sent.set(midi, left);
    else this.sent.delete(midi);
  }

  /** Lights a key (light-up keyboards) without a loud note. */
  light(midi: number, on: boolean): void {
    if (on) this.noteOn(midi, 0.01);
    else this.noteOff(midi);
  }

  /** Releases everything the app sent: no key is left sounding or lit. */
  allOff(): void {
    const port = this.port();
    if (!port) {
      this.sent.clear();
      return;
    }
    try {
      for (const midi of this.sent.keys()) port.send([this.status(0x80), midi, 0]);
      port.send([this.status(0xb0), 123, 0]); // all notes off on our channel
    } catch {
      // the device went away; nothing left to release
    }
    this.sent.clear();
  }
}

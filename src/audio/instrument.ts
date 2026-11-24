import { SampledPiano } from './sampler';
import { announcePlay, markHeld, markReleased } from './sounding';
import { Synth } from './synth';

/** Something that makes piano sounds: the sampled grand piano, or the small synth. */
export interface Instrument {
  /** Browsers only allow sound after a click or key press, so call this from one. Safe to call often. */
  wake(): void;
  /** Key down: rings until noteOff. Velocity 0..1. */
  noteOn(midi: number, velocity?: number): void;
  noteOff(midi: number): void;
  /**
   * Plays a note of a known length, for the parts the app plays itself.
   * `delay` (seconds, default 0) starts it that much later on the audio clock,
   * so notes scheduled a moment ahead sound on time even when a frame is late.
   */
  play(midi: number, seconds: number, velocity?: number, delay?: number): void;
  /** Cancels notes given to `play` with a delay that have not started yet. Optional. */
  cancelPending?(): void;
  /** Master volume, 0..1. */
  setVolume(volume: number): void;
  /** Sustain pedal: while on, released keys keep ringing. Optional. */
  sustain?(on: boolean): void;
  /** How far the sustain pedal is pressed, 0..1, for pianos that send half-pedal values. Optional. */
  pedalDepth?(depth: number): void;
  /** Room echo, 0..1. Optional. */
  setReverb?(amount: number): void;
  /** Lets go of every note at once (a device vanished, the screen changed). Optional. */
  allOff?(): void;
}

export const INSTRUMENT_KINDS = ['piano', 'synth'] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

/** Friendly names for the settings screen. */
export const INSTRUMENT_LABELS: Record<InstrumentKind, string> = {
  piano: 'Grand piano (recorded)',
  synth: 'Simple piano (light, no download)',
};

/**
 * Wraps an engine so the rest of the app knows which notes the app is making
 * (the microphone ignores them, MIDI output forwards lesson notes).
 */
class Announcing implements Instrument {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(readonly engine: Instrument) {}
  wake(): void {
    this.engine.wake();
  }
  noteOn(midi: number, velocity?: number): void {
    markHeld(midi);
    this.engine.noteOn(midi, velocity);
  }
  noteOff(midi: number): void {
    markReleased(midi);
    this.engine.noteOff(midi);
  }
  play(midi: number, seconds: number, velocity?: number, delay = 0): void {
    const note = { midi, seconds, velocity: velocity ?? 0.6 };
    if (delay > 0.004) {
      // Tell the microphone and MIDI output when the note really starts.
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        announcePlay(note);
      }, delay * 1000);
      this.timers.add(timer);
    } else {
      announcePlay(note);
    }
    this.engine.play(midi, seconds, velocity, delay);
  }
  cancelPending(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.engine.cancelPending?.();
  }
  setVolume(volume: number): void {
    this.engine.setVolume(volume);
  }
  sustain(on: boolean): void {
    this.engine.sustain?.(on);
  }
  pedalDepth(depth: number): void {
    this.engine.pedalDepth?.(depth);
  }
  setReverb(amount: number): void {
    this.engine.setReverb?.(amount);
  }
  allOff(): void {
    this.cancelPending();
    this.engine.allOff?.();
  }
}

/** The one place instruments are made. Add new kinds here and to INSTRUMENT_KINDS. */
export function createInstrument(kind: InstrumentKind = 'piano'): Instrument {
  switch (kind) {
    case 'piano':
      return new Announcing(new SampledPiano());
    case 'synth':
      return new Announcing(new Synth());
  }
}

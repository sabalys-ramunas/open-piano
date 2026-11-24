import { audioContext } from './context';
import type { Instrument } from './instrument';

interface Voice {
  gain: GainNode;
  oscs: OscillatorNode[];
  /** Audio clock time the voice starts. */
  at: number;
}

/** A small piano-like synth. Good enough to learn with, and it needs no samples. */
export class Synth implements Instrument {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private volume = 0.8;
  private held = new Map<number, Voice>();
  private pedal = false;
  private sustained = new Map<number, Voice>();
  /** Timed notes handed to `play` with a delay, until they have started. */
  private pending: Voice[] = [];

  wake(): void {
    if (!this.ctx) {
      if (typeof AudioContext === 'undefined') return; // no Web Audio: play silently
      this.ctx = audioContext();
      const limiter = this.ctx.createDynamicsCompressor();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.level();
      this.out.connect(limiter).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The single-screen version ran at a fixed 0.5; volume 0.8 keeps that loudness. */
  private level(): number {
    return this.volume * 0.625;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.02);
  }

  private voice(midi: number, velocity: number, at?: number): Voice {
    const ctx = this.ctx!;
    const now = at ?? ctx.currentTime;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const gain = ctx.createGain();
    // Low notes ring longer than high ones, as on a real piano.
    const ring = 2.6 - ((midi - 21) / 87) * 1.9;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32 * velocity, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + ring);
    gain.connect(this.out!);

    const oscs = [
      { type: 'triangle' as const, mult: 1, level: 1 },
      { type: 'sine' as const, mult: 2, level: 0.35 },
      { type: 'sine' as const, mult: 3, level: 0.12 },
    ].map(({ type, mult, level }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      g.gain.value = level;
      osc.connect(g).connect(gain);
      osc.start(now);
      osc.stop(now + ring + 0.1);
      return osc;
    });
    return { gain, oscs, at: now };
  }

  private release(v: Voice, at: number): void {
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setTargetAtTime(0, at, 0.06);
    for (const o of v.oscs) o.stop(Math.max(at, v.at) + 0.4);
  }

  noteOn(midi: number, velocity = 0.8): void {
    if (!this.ctx) return;
    this.noteOff(midi);
    const ringing = this.sustained.get(midi);
    if (ringing) {
      this.sustained.delete(midi);
      this.release(ringing, this.ctx.currentTime);
    }
    this.held.set(midi, this.voice(midi, velocity));
  }

  noteOff(midi: number): void {
    const v = this.held.get(midi);
    if (!v || !this.ctx) return;
    this.held.delete(midi);
    if (this.pedal) this.sustained.set(midi, v);
    else this.release(v, this.ctx.currentTime);
  }

  sustain(on: boolean): void {
    this.pedal = on;
    if (on || !this.ctx) return;
    for (const v of this.sustained.values()) this.release(v, this.ctx.currentTime);
    this.sustained.clear();
  }

  /** Lets go of every note at once. */
  allOff(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    for (const v of this.held.values()) this.release(v, at);
    for (const v of this.sustained.values()) this.release(v, at);
    this.held.clear();
    this.sustained.clear();
  }

  play(midi: number, seconds: number, velocity = 0.6, delay = 0): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const at = now + Math.max(0, delay);
    const v = this.voice(midi, velocity, at);
    this.release(v, at + Math.max(0.08, seconds));
    if (at > now) {
      this.pending = this.pending.filter((p) => p.at > now);
      this.pending.push(v);
    }
  }

  cancelPending(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.pending) {
      if (v.at <= now) continue;
      v.gain.gain.cancelScheduledValues(0);
      v.gain.gain.value = 0;
      for (const o of v.oscs) {
        try {
          o.stop();
        } catch {
          // already stopped
        }
      }
      try {
        v.gain.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.pending = [];
  }
}

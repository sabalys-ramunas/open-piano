/** Turning raw MIDI bytes into the few things a piano app cares about. Pure, so it is easy to test. */

export type MidiEvent =
  | { type: 'down'; channel: number; note: number; velocity: number } // velocity 1..127
  | { type: 'up'; channel: number; note: number }
  | { type: 'pedal'; channel: number; value: number } // sustain pedal, 0..127 (half-pedal values in between)
  | { type: 'all-off'; channel: number }; // all notes off / all sound off / reset controllers

/** Data bytes that follow each channel message type (status high nibble). */
const DATA_LENGTH: Record<number, number> = { 0x80: 2, 0x90: 2, 0xa0: 2, 0xb0: 2, 0xc0: 1, 0xd0: 1, 0xe0: 2 };
/** Data bytes after system common messages. */
const SYSTEM_LENGTH: Record<number, number> = { 0xf1: 1, 0xf2: 2, 0xf3: 1, 0xf6: 0 };

/**
 * Reads every message in `data`. Copes with running status, real-time bytes
 * (clock, active sensing) mixed in anywhere, system exclusive blocks and
 * truncated messages. Only notes, the sustain pedal and "all notes off"
 * come out; everything else (knobs, pitch bend, clock) is ignored.
 */
export function parseMidi(data: ArrayLike<number> | null | undefined): MidiEvent[] {
  const out: MidiEvent[] = [];
  if (!data) return out;
  let status = 0;
  let need = 0;
  const bytes: number[] = [];
  let inSysex = false;
  for (let i = 0; i < data.length; i++) {
    const b = data[i] & 0xff;
    if (b >= 0xf8) continue; // real-time: clock, start, stop, active sensing, reset
    if (b === 0xf0) {
      inSysex = true;
      status = 0;
      continue;
    }
    if (b === 0xf7) {
      inSysex = false;
      continue;
    }
    if (b & 0x80) {
      inSysex = false;
      bytes.length = 0;
      if (b >= 0xf0) {
        // System common: swallow its data bytes; it also cancels running status.
        status = b;
        need = SYSTEM_LENGTH[b] ?? 0;
        continue;
      }
      status = b;
      need = DATA_LENGTH[b & 0xf0];
      continue;
    }
    if (inSysex || status === 0) continue;
    bytes.push(b);
    if (bytes.length < need) continue;
    if (status < 0xf0) {
      const event = toEvent(status, bytes[0], bytes[1] ?? 0);
      if (event) out.push(event);
      bytes.length = 0; // running status: the next data bytes reuse `status`
    } else {
      status = 0;
      bytes.length = 0;
    }
  }
  return out;
}

function toEvent(status: number, a: number, b: number): MidiEvent | null {
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  if (kind === 0x90) return b > 0 ? { type: 'down', channel, note: a, velocity: b } : { type: 'up', channel, note: a };
  if (kind === 0x80) return { type: 'up', channel, note: a };
  if (kind === 0xb0) {
    if (a === 64) return { type: 'pedal', channel, value: b };
    // 120 all sound off, 121 reset controllers, 123 to 127 all notes off (and mode changes that imply it)
    if (a === 120 || a === 121 || a >= 123) return { type: 'all-off', channel };
  }
  return null;
}

export type VelocityCurve = 'light' | 'normal' | 'heavy';

/** Fixed loudness used when the player turns velocity off. */
export const FIXED_VELOCITY = 0.7;

/**
 * Raw key velocity (1..127) to the app's 0..1. "Light" makes soft playing
 * sound louder (for stiff or small keyboards), "heavy" needs a firmer touch.
 */
export function applyVelocity(raw: number, curve: VelocityCurve = 'normal', fixed = false): number {
  if (fixed) return FIXED_VELOCITY;
  const v = Math.min(127, Math.max(1, raw)) / 127;
  if (curve === 'light') return Math.pow(v, 0.6);
  if (curve === 'heavy') return Math.pow(v, 1.6);
  return v;
}

/**
 * Sustain pedal on/off with a dead band, so continuous (half-pedal) pedals do
 * not flicker: presses count from 32, releases below 20.
 */
export function pedalIsDown(value: number, wasDown: boolean): boolean {
  return wasDown ? value >= 20 : value >= 32;
}

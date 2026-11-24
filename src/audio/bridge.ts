import type { Settings } from '../app/settings';
import type { InputHub } from '../input/hub';
import type { MicSource } from '../input/mic';
import type { MidiSource } from '../input/midi';
import { MidiOutput } from '../input/midi-out';
import type { Instrument } from './instrument';
import type { Metronome } from './metronome';

interface SettingsLike {
  get(): Readonly<Settings>;
  subscribe(listener: (settings: Readonly<Settings>, changed: (keyof Settings)[]) => void): () => void;
}

export interface SoundDeps {
  settings: SettingsLike;
  audio: { readonly instrument: Instrument; readonly metronome: Metronome };
  sources: { midi: MidiSource; mic: MicSource };
  input: InputHub;
}

let output: MidiOutput | null = null;

/** The app's MIDI output (sending notes to the piano). Null before connectSoundSettings ran. */
export function midiOutput(): MidiOutput | null {
  return output;
}

/**
 * Applies the sound and input settings (room echo, metronome loudness, touch,
 * switched-off devices, MIDI output, microphone sensitivity) now and whenever
 * they change, passes half-pedal depth to the instrument, and starts loading
 * the piano recordings on the first click or key press anywhere.
 * Call once at start-up. Returns a function that undoes it.
 */
export function connectSoundSettings({ settings, audio, sources, input }: SoundDeps): () => void {
  output = new MidiOutput(sources.midi);
  const out = output;
  let instrument = audio.instrument;

  const apply = (s: Readonly<Settings>, changed: readonly (keyof Settings)[] | null): void => {
    const all = changed === null;
    const has = (k: keyof Settings): boolean => all || changed.includes(k);
    if (audio.instrument !== instrument) {
      // A new instrument was chosen: silence the old one so nothing keeps ringing.
      instrument.allOff?.();
      instrument = audio.instrument;
    }
    if (has('reverb') || has('instrument')) audio.instrument.setReverb?.(s.reverb);
    if (has('metronomeVolume')) audio.metronome.setClickVolume(s.metronomeVolume);
    if (has('velocityCurve')) sources.midi.velocityCurve = s.velocityCurve;
    if (has('fixedVelocity')) sources.midi.fixedVelocity = s.fixedVelocity;
    if (has('midiDisabled')) sources.midi.setDisabled(s.midiDisabled);
    if (has('midiOutput')) out.select(s.midiOutput);
    if (has('micSensitivity')) sources.mic.sensitivity = s.micSensitivity;
    if (has('micNoiseFloor')) sources.mic.noiseFloor = s.micNoiseFloor;
  };
  apply(settings.get(), null);
  const offSettings = settings.subscribe((s, changed) => apply(s, changed));
  const offDepth = input.on('pedalDepth', ({ depth }) => audio.instrument.pedalDepth?.(depth));

  // Load the piano recordings after the first interaction (browsers only allow sound after one).
  const wake = (): void => {
    audio.instrument.wake();
    removeWake();
  };
  const removeWake = (): void => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', wake, true);
    window.removeEventListener('keydown', wake, true);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
  }

  return () => {
    offSettings();
    offDepth();
    removeWake();
    out.select('');
  };
}

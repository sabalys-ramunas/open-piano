import { INSTRUMENT_KINDS, type InstrumentKind } from '../audio/instrument';
import type { Hands, Mode } from '../player/game';
import type { Store } from './store';

export type ViewKind = 'falling' | 'sheet';

/**
 * What the original recording does while playing: the whole recording, the
 * recording without its guitars and keys (songs that were split; others play
 * the whole recording), or nothing (only the piano sound).
 */
export type SongSound = 'full' | 'backing' | 'off';
export const SONG_SOUNDS: readonly SongSound[] = ['full', 'backing', 'off'];

export interface Settings {
  /** Master volume, 0..1. */
  volume: number;
  instrument: InstrumentKind;
  /** Which picture the player shows. */
  view: ViewKind;
  /** Last used player choices, so the next song starts the same way. */
  mode: Mode;
  hands: Hands;
  speed: number;
  /** Computer-key letters on the on-screen keys (only shown when no piano is connected). */
  showKeyLetters: boolean;
  /** Note names (C, D, E...) on falling notes. */
  showNoteNames: boolean;
  /** Click along with the beat. */
  metronome: boolean;
  /** What the song's original recording plays (see SongSound). Older versions stored true or false. */
  songSound: SongSound;
  /**
   * Split recordings into voice, drums, bass and the rest when adding them, so
   * the piano can replace the guitars and keys. 'ask' until the person chose
   * (it needs a one-time download).
   */
  splitSongs: 'ask' | 'yes' | 'no';
  /** Extra delay to allow for slow Bluetooth or audio output, in milliseconds. */
  latencyMs: number;
  /** Fewer moving effects. Starts from the system preference. */
  reduceMotion: boolean;
  /** Listen through the microphone for an acoustic piano. */
  micEnabled: boolean;
  /** Room echo on the piano sound, 0..1 (sound and input area). */
  reverb: number;
  /** Metronome click loudness, 0..1, on top of the master volume. */
  metronomeVolume: number;
  /** How hard a MIDI piano has to be played for a loud note. */
  velocityCurve: VelocityCurve;
  /** Every MIDI key press plays at the same loudness. */
  fixedVelocity: boolean;
  /** Names of MIDI devices the player switched off. */
  midiDisabled: string[];
  /** Name of the MIDI output that receives the app's own notes; '' means off. */
  midiOutput: string;
  /** Lowest and highest key of the player's piano (MIDI numbers), from the connection helper. */
  keyLow: number;
  keyHigh: number;
  /** Microphone: 0..1, higher hears quieter playing (and more noise). */
  micSensitivity: number;
  /** Microphone: measured room noise level (RMS, 0..1); 0 means not measured. */
  micNoiseFloor: number;
  /** Address of the shared songs list (community catalog); '' means the one that comes with the app. */
  catalogUrl: string;
}

export type VelocityCurve = 'light' | 'normal' | 'heavy';

const stringList = (x: unknown): x is string[] =>
  Array.isArray(x) && x.length <= 64 && x.every((v) => typeof v === 'string' && v.length <= 200);
const shortText = (x: unknown): x is string => typeof x === 'string' && x.length <= 200;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  volume: 0.8,
  instrument: 'piano',
  view: 'falling',
  mode: 'wait',
  hands: 'right',
  speed: 1,
  showKeyLetters: true,
  showNoteNames: true,
  metronome: false,
  songSound: 'backing',
  splitSongs: 'ask',
  latencyMs: 0,
  reduceMotion: false,
  micEnabled: false,
  reverb: 0.25,
  metronomeVolume: 0.7,
  velocityCurve: 'normal',
  fixedVelocity: false,
  midiDisabled: [],
  midiOutput: '',
  keyLow: 21,
  keyHigh: 108,
  micSensitivity: 0.5,
  micNoiseFloor: 0,
  catalogUrl: '',
});

const SETTINGS_KEY = 'settings';
/** Where older versions kept the shared songs address, before it became a setting. */
export const LEGACY_CATALOG_URL_KEY = 'community:catalog-url';

const oneOf =
  <T extends string>(...values: T[]) =>
  (x: unknown): x is T =>
    typeof x === 'string' && (values as string[]).includes(x);
const num = (lo: number, hi: number) => (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const bool = (x: unknown): x is boolean => typeof x === 'boolean';

const VALID: { [K in keyof Settings]: (x: unknown) => x is Settings[K] } = {
  volume: num(0, 1),
  instrument: oneOf(...INSTRUMENT_KINDS),
  view: oneOf('falling', 'sheet'),
  mode: oneOf('listen', 'wait', 'flow'),
  hands: oneOf('right', 'left', 'both'),
  speed: num(0.25, 2),
  showKeyLetters: bool,
  showNoteNames: bool,
  metronome: bool,
  songSound: oneOf(...SONG_SOUNDS),
  splitSongs: oneOf('ask', 'yes', 'no'),
  latencyMs: num(-500, 500),
  reduceMotion: bool,
  micEnabled: bool,
  reverb: num(0, 1),
  metronomeVolume: num(0, 1),
  velocityCurve: oneOf('light', 'normal', 'heavy'),
  fixedVelocity: bool,
  midiDisabled: stringList,
  midiOutput: shortText,
  keyLow: num(0, 127),
  keyHigh: num(0, 127),
  micSensitivity: num(0, 1),
  micNoiseFloor: num(0, 1),
  catalogUrl: (x: unknown): x is string => typeof x === 'string' && x.length <= 2000 && !/[\s<>"]/.test(x),
};

/** Keeps only the fields that are valid; everything else falls back to the defaults. */
export function sanitize(value: unknown, base: Settings = { ...DEFAULT_SETTINGS }): Settings {
  const out = { ...base };
  if (typeof value !== 'object' || value === null) return out;
  const input = { ...(value as Record<string, unknown>) };
  // songSound was on or off before songs could be split: on now means "without guitars and
  // keys" where a song has that (and the whole recording where it does not), off stays off.
  if (typeof input.songSound === 'boolean') input.songSound = input.songSound ? 'backing' : 'off';
  for (const key of Object.keys(VALID) as (keyof Settings)[]) {
    if (VALID[key](input[key])) (out as Record<keyof Settings, unknown>)[key] = input[key];
  }
  return out;
}

type Listener = (settings: Readonly<Settings>, changed: (keyof Settings)[]) => void;

/** The player's preferences, saved through the store. */
export class SettingsService {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor(
    private store: Store,
    initial: Partial<Settings> = {},
  ) {
    this.value = sanitize(initial);
  }

  /** Reads saved settings (and moves settings older versions kept elsewhere). Call once at start-up. */
  async load(): Promise<void> {
    try {
      const saved = await this.store.getValue(SETTINGS_KEY);
      if (saved !== undefined) this.apply(sanitize(saved, this.value));
    } catch {
      // keep the defaults
    }
    await this.migrate();
  }

  /** One-time moves of values older versions stored under their own keys. */
  private async migrate(): Promise<void> {
    try {
      const legacy = await this.store.getValue(LEGACY_CATALOG_URL_KEY);
      if (legacy === undefined || legacy === null) return;
      if (typeof legacy === 'string' && legacy.trim() && !this.value.catalogUrl) this.set({ catalogUrl: legacy.trim() });
      await this.store.setValue(LEGACY_CATALOG_URL_KEY, null);
    } catch {
      // nothing to move, or storage is unavailable
    }
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  /** Changes some settings. Invalid values are ignored. */
  set(patch: Partial<Settings>): void {
    const next = sanitize({ ...this.value, ...patch }, this.value);
    if (this.apply(next)) void this.store.setValue(SETTINGS_KEY, next).catch(() => {});
  }

  /** Calls `listener` after every change. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(next: Settings): boolean {
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== this.value[k]);
    if (changed.length === 0) return false;
    this.value = next;
    for (const l of this.listeners) l(this.value, changed);
    return true;
  }
}

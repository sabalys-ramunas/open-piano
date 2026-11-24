import { setCheerVolume } from '../audio/cheer';
import { connectSoundSettings } from '../audio/bridge';
import { createInstrument, type Instrument } from '../audio/instrument';
import { createMetronome, type Metronome } from '../audio/metronome';
import { InputHub } from '../input/hub';
import { KeyboardSource } from '../input/keyboard';
import { MicSource } from '../input/mic';
import { MidiSource } from '../input/midi';
import { PointerSource } from '../input/pointer';
import { BUILT_IN, loadSongPackIndex } from '../songs';
import { MIDI_ALLOWED_KEY, midiAlreadyAllowed } from './first-run';
import { Library } from './library';
import type { Route } from './router';
import { SettingsService } from './settings';
import { openStore, type Store } from './store';

export interface AudioService {
  /** The current instrument. Read it at call time; it is replaced when settings.instrument changes. */
  instrument: Instrument;
  metronome: Metronome;
}

export interface InputSources {
  keyboard: KeyboardSource;
  pointer: PointerSource;
  midi: MidiSource;
  mic: MicSource;
}

/** The services every screen receives. Created once at start-up. */
export interface AppContext {
  library: Library;
  store: Store;
  settings: SettingsService;
  input: InputHub;
  /** Direct access to each built-in source, e.g. to attach the pointer to a stage. */
  sources: InputSources;
  audio: AudioService;
  /** Goes to another screen. */
  navigate(route: Route): void;
  /** Settles once the built-in song pack index has been read (or failed to load). */
  songPack: Promise<void>;
}

/**
 * Builds the context: opens storage, loads settings and saved songs, starts
 * the input sources and connects them to the instrument so every key press
 * makes a sound on any screen.
 */
export async function createContext(navigate: (route: Route) => void): Promise<AppContext> {
  const store = await openStore();
  const settings = new SettingsService(store, {
    reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  await settings.load();

  const library = new Library(store, BUILT_IN);
  await library.load();
  // The song pack index is small; each song's notes are fetched when it is opened.
  const songPack = loadSongPackIndex().then(({ lazy, songs }) => {
    library.registerLazy(lazy);
    library.register(songs);
  });

  const audio: AudioService = {
    instrument: createInstrument(settings.get().instrument),
    metronome: createMetronome(),
  };
  audio.instrument.setVolume(settings.get().volume);
  audio.metronome.setVolume(settings.get().volume);
  setCheerVolume(settings.get().volume);
  settings.subscribe((s, changed) => {
    if (changed.includes('instrument')) {
      audio.instrument = createInstrument(s.instrument);
    }
    if (changed.includes('volume') || changed.includes('instrument')) {
      audio.instrument.setVolume(s.volume);
      audio.metronome.setVolume(s.volume);
      setCheerVolume(s.volume);
    }
  });

  const sources: InputSources = {
    keyboard: new KeyboardSource(),
    pointer: new PointerSource(),
    midi: new MidiSource(),
    mic: new MicSource(),
  };
  const input = new InputHub();
  input.register(sources.keyboard);
  input.register(sources.pointer);
  input.register(sources.midi);
  input.register(sources.mic);

  input.on('down', ({ midi, velocity, source }) => {
    if (source === 'mic') return; // an acoustic piano makes its own sound
    audio.instrument.wake();
    audio.instrument.noteOn(midi, velocity);
  });
  input.on('up', ({ midi, source }) => {
    if (source !== 'mic') audio.instrument.noteOff(midi);
  });
  input.on('pedal', ({ on }) => audio.instrument.sustain?.(on));
  // MIDI: connect quietly when the browser already allowed it on an earlier
  // visit. Otherwise wait for the connection helper, so the browser's question
  // never appears out of nowhere.
  sources.midi.deferAccess = !(await midiAlreadyAllowed(store));
  sources.midi.onChange(() => {
    if (sources.midi.status === 'ready') void store.setValue(MIDI_ALLOWED_KEY, true).catch(() => {});
  });
  // The microphone only starts when the player turns it on in settings.
  for (const id of ['keyboard', 'pointer', 'midi']) void input.start(id);
  if (settings.get().micEnabled) void input.start('mic');
  settings.subscribe((s, changed) => {
    if (!changed.includes('micEnabled')) return;
    if (s.micEnabled) void input.start('mic');
    else input.stop('mic');
  });

  connectSoundSettings({ settings, audio, sources, input });

  return { library, store, settings, input, sources, audio, navigate, songPack };
}

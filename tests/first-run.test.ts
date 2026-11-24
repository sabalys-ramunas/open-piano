import { describe, expect, it } from 'vitest';
import { finishWelcome, MIDI_ALLOWED_KEY, midiAlreadyAllowed, readWelcome, shouldWelcome, WELCOME_KEY } from '../src/app/first-run';
import { recordLesson, recordPlay } from '../src/app/progress';
import { DEFAULT_SETTINGS, SettingsService } from '../src/app/settings';
import { memoryStore } from '../src/app/store';
import { MidiSource, type MidiAccessLike } from '../src/input/midi';

describe('first-run welcome', () => {
  it('reads stored state defensively', () => {
    expect(readWelcome(undefined)).toEqual({ done: false });
    expect(readWelcome('yes')).toEqual({ done: false });
    expect(readWelcome({ done: 'true' })).toEqual({ done: false });
    expect(readWelcome({ done: true, playWith: 'mic' })).toEqual({ done: true, playWith: 'mic' });
    expect(readWelcome({ done: true, playWith: 'banjo' })).toEqual({ done: true });
  });

  it('welcomes a brand new visitor once', async () => {
    const store = memoryStore();
    expect(await shouldWelcome(store)).toBe(true);
    await finishWelcome(store, 'keys');
    expect(await shouldWelcome(store)).toBe(false);
    expect(readWelcome(await store.getValue(WELCOME_KEY))).toEqual({ done: true, playWith: 'keys' });
  });

  it('never sends people who already used the app through the welcome', async () => {
    const played = memoryStore();
    await recordPlay(played, 'twinkle', 0.8);
    expect(await shouldWelcome(played)).toBe(false);

    const learner = memoryStore();
    await recordLesson(learner, 'find-c', { completed: true, stars: 3 });
    expect(await shouldWelcome(learner)).toBe(false);

    const collector = memoryStore();
    await collector.putSong({ id: 'mine:x', title: 'X', by: '', notes: [{ midi: 60, start: 0, dur: 1, hand: 'right' }] });
    expect(await shouldWelcome(collector)).toBe(false);
  });

  it('does not trap anyone when storage fails', async () => {
    const store = memoryStore();
    const broken = { ...store, getValue: () => Promise.reject(new Error('blocked')) };
    expect(await shouldWelcome(broken)).toBe(false);
  });
});

describe('MIDI permission on start-up', () => {
  const ask = (state: string) => ({ query: async () => ({ state }) });

  it('trusts the browser when it can tell us', async () => {
    const store = memoryStore();
    await store.setValue(MIDI_ALLOWED_KEY, true);
    expect(await midiAlreadyAllowed(store, ask('granted'))).toBe(true);
    expect(await midiAlreadyAllowed(store, ask('prompt'))).toBe(false); // revoked since: ask again from the helper
    expect(await midiAlreadyAllowed(store, ask('denied'))).toBe(false);
  });

  it('falls back to what it remembered when the browser cannot tell', async () => {
    const store = memoryStore();
    const unknown = { query: () => Promise.reject(new TypeError('midi is not a permission name here')) };
    expect(await midiAlreadyAllowed(store, unknown)).toBe(false);
    expect(await midiAlreadyAllowed(store, undefined)).toBe(false);
    await store.setValue(MIDI_ALLOWED_KEY, true);
    expect(await midiAlreadyAllowed(store, unknown)).toBe(true);
  });

  it('does not ask the browser on start when access is deferred, but asks from a button press', async () => {
    let asked = 0;
    const access: MidiAccessLike = { inputs: new Map(), outputs: new Map(), onstatechange: null } as unknown as MidiAccessLike;
    const midi = new MidiSource(async () => {
      asked++;
      return access;
    });
    midi.deferAccess = true;
    await midi.start({ down() {}, up() {}, pedal() {}, changed() {} });
    expect(asked).toBe(0);
    expect(midi.status).toBe('idle');
    expect(await midi.requestAccess()).toBe('ready');
    expect(asked).toBe(1);
  });

  it('reports a browser without MIDI instead of waiting forever', async () => {
    const midi = new MidiSource(null);
    midi.deferAccess = true;
    await midi.start({ down() {}, up() {}, pedal() {}, changed() {} });
    expect(['unsupported', 'insecure']).toContain(midi.status);
  });
});

describe('settings migration', () => {
  it('keeps a catalog address already in the settings over the old key, and clears the old key', async () => {
    const store = memoryStore();
    await store.setValue('settings', { ...DEFAULT_SETTINGS, catalogUrl: 'https://mine.example/index.json' });
    await store.setValue('community:catalog-url', 'https://old.example/index.json');
    const settings = new SettingsService(store);
    await settings.load();
    expect(settings.get().catalogUrl).toBe('https://mine.example/index.json');
    expect(await store.getValue('community:catalog-url')).toBeNull();
  });

  it('ignores a broken old value', async () => {
    const store = memoryStore();
    await store.setValue('community:catalog-url', 42);
    const settings = new SettingsService(store);
    await settings.load();
    expect(settings.get().catalogUrl).toBe('');
  });

  it('rejects addresses with spaces or markup', () => {
    const settings = new SettingsService(memoryStore());
    settings.set({ catalogUrl: 'https://a.example/x y.json' });
    expect(settings.get().catalogUrl).toBe('');
    settings.set({ catalogUrl: 'https://a.example/<b>.json' });
    expect(settings.get().catalogUrl).toBe('');
    settings.set({ catalogUrl: 'https://a.example/list.json' });
    expect(settings.get().catalogUrl).toBe('https://a.example/list.json');
  });
});

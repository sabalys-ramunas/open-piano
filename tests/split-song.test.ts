// A split song: its extra rendition (the recording without guitars and keys)
// in storage and the library, the songSound setting, and switching between the
// renditions in the session without losing the place.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Library } from '../src/app/library';
import { DEFAULT_SETTINGS, SettingsService, sanitize } from '../src/app/settings';
import { memoryStore, openStore } from '../src/app/store';
import type { Instrument } from '../src/audio/instrument';
import { toLesson } from '../src/lesson';
import { Session, type Backing } from '../src/player/session';
import { seq, type Song } from '../src/song';

const song: Song = {
  id: 'mine:split:10',
  title: 'Split',
  by: '',
  notes: seq('right', 1, 'C4/1 D4/1 E4/1 F4/1'),
  audioUrl: 'blob:full',
  backingUrl: 'blob:backing',
  recording: { name: 'split.mp3', bytes: 10 },
  source: 'mine',
};

describe('storing a split song', () => {
  it('keeps the backing as bytes with its type, across reopening, and deletes it with the song', async () => {
    const indexedDB = new IDBFactory();
    const first = await openStore({ indexedDB, localStorage: null });
    await first.putSong(song);
    await first.putAudio(song.id, new Blob(['full'], { type: 'audio/mpeg' }));
    await first.putBacking(song.id, new Blob(['backing'], { type: 'audio/ogg; codecs=opus' }));

    const second = await openStore({ indexedDB, localStorage: null });
    const [stored] = await second.getSongs();
    expect(stored.song.audioUrl).toBeUndefined();
    expect(stored.song.backingUrl).toBeUndefined();
    expect(await stored.audio!.text()).toBe('full');
    expect(stored.backing!.type).toBe('audio/ogg; codecs=opus');
    expect(await stored.backing!.text()).toBe('backing');
    // Not a Blob in the database (Safari's private windows refuse those).
    const raw = await new Promise<unknown>((resolve) => {
      const req = indexedDB.open('piano');
      req.onsuccess = () => {
        const get = req.result.transaction('audio').objectStore('audio').get(`backing:${song.id}`);
        get.onsuccess = () => resolve(get.result);
      };
    });
    expect(raw).toMatchObject({ type: 'audio/ogg; codecs=opus' });
    expect((raw as { bytes: unknown }).bytes).toBeInstanceOf(ArrayBuffer);

    await second.deleteSong(song.id);
    expect(await second.getSongs()).toEqual([]);
    const third = await openStore({ indexedDB, localStorage: null });
    await third.putSong(song);
    await third.putAudio(song.id, new Blob(['again'], { type: 'audio/mpeg' }));
    expect((await third.getSongs())[0].backing).toBeUndefined();
  });

  it('gives the library song a backing URL, after adding, attaching and reloading, and never puts it in a lesson file', async () => {
    const store = memoryStore();
    let n = 0;
    const made: string[] = [];
    const dropped: string[] = [];
    const urls = {
      make: () => {
        const url = `blob:${++n}`;
        made.push(url);
        return url;
      },
      drop: (url: string) => void dropped.push(url),
    };
    const library = new Library(store, [], urls.make, urls.drop);
    const plain = { ...song, audioUrl: undefined, backingUrl: undefined };
    const added = await library.add(plain, { audio: new Blob(['full']), backing: new Blob(['backing'], { type: 'audio/wav' }) });
    expect(added.audioUrl).toBe('blob:1');
    expect(added.backingUrl).toBe('blob:2');

    // A song added without splitting gets it later ("Split this song").
    const other = await library.add({ ...plain, id: 'mine:other:1' }, { audio: new Blob(['x']) });
    expect(other.backingUrl).toBeUndefined();
    const split = await library.attachBacking(other.id, new Blob(['b'], { type: 'audio/ogg; codecs=opus' }));
    expect(split.backingUrl).toBe('blob:4');
    expect(library.get(other.id)?.backingUrl).toBe('blob:4');
    await expect(library.attachBacking('nope', new Blob([]))).rejects.toThrow();

    const reloaded = new Library(store, [], urls.make, urls.drop);
    await reloaded.load();
    expect(reloaded.get(other.id)?.backingUrl).toMatch(/^blob:/);
    expect(reloaded.get(song.id)?.backingUrl).toMatch(/^blob:/);

    const lesson = JSON.stringify(toLesson(reloaded.get(song.id)!));
    expect(lesson).not.toMatch(/blob:|backing/);

    await reloaded.remove(song.id);
    expect(dropped.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a backing for a song without its recording', async () => {
    const library = new Library(memoryStore(), [], () => 'blob:x', () => {});
    await library.add({ ...song, audioUrl: undefined, backingUrl: undefined, id: 'mine:lesson:1' });
    await expect(library.attachBacking('mine:lesson:1', new Blob(['b']))).rejects.toThrow();
  });
});

describe('the songSound setting', () => {
  it('moves the old on/off switch over: on becomes "without guitars and keys" where there is one, off stays off', () => {
    expect(DEFAULT_SETTINGS.songSound).toBe('backing');
    expect(sanitize({ songSound: true }).songSound).toBe('backing');
    expect(sanitize({ songSound: false }).songSound).toBe('off');
    expect(sanitize({ songSound: 'full' }).songSound).toBe('full');
    expect(sanitize({ songSound: 'loud' }).songSound).toBe('backing');
    expect(sanitize({ splitSongs: 'yes' }).splitSongs).toBe('yes');
    expect(sanitize({ splitSongs: true }).splitSongs).toBe('ask');
  });

  it('migrates a stored false on load', async () => {
    const store = memoryStore();
    await store.setValue('settings', { ...DEFAULT_SETTINGS, songSound: false });
    const settings = new SettingsService(store);
    await settings.load();
    expect(settings.get().songSound).toBe('off');
  });
});

function fakeInstrument(): Instrument {
  return { wake() {}, noteOn() {}, noteOff() {}, play() {}, setVolume() {} };
}

/** A media element stand-in: changing src pauses it and resets the rate, like the real one. */
function fakeMedia(): Backing & { plays: number; loads: string[] } {
  const media = {
    _src: '',
    currentTime: 0,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    muted: false,
    paused: true,
    ended: false,
    plays: 0,
    loads: [] as string[],
    get src() {
      return this._src;
    },
    set src(url: string) {
      this._src = url;
      this.loads.push(url);
      this.paused = true;
      this.currentTime = 0;
      this.playbackRate = this.defaultPlaybackRate;
    },
    async play() {
      this.plays++;
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
  };
  return media;
}

describe('switching the recording in the session', () => {
  it('starts with the whole recording and switches mid-song keeping the place, the speed and playing', () => {
    const media = fakeMedia();
    const session = new Session({ audio: { instrument: fakeInstrument() }, backing: media }, song, { mode: 'flow', hands: 'right', speed: 0.75 });
    expect(media.src).toBe('blob:full');
    session.setSpeed(0.5);
    session.seek(0); // past the lead-in, where the recording plays
    session.start();
    session.tick(0.016);
    expect(media.paused).toBe(false);
    media.currentTime = 2.4; // the recording moved on
    session.tick(0.016);
    const before = session.game.time;
    expect(before).toBeCloseTo(2.4, 5);

    session.setRecordingSource('backing');
    expect(session.recordingSource).toBe('backing');
    expect(media.src).toBe('blob:backing');
    expect(media.currentTime).toBeCloseTo(2.4, 5);
    expect(media.playbackRate).toBe(0.5);
    expect(media.paused).toBe(false);
    expect(session.running).toBe(true);
    // No jump: the song stays where it was while the new recording loads.
    session.tick(0.1);
    expect(session.game.time).toBeCloseTo(before, 5);

    // And back, paused this time.
    session.pause();
    media.currentTime = 3;
    session.setRecordingSource('full');
    expect(media.src).toBe('blob:full');
    expect(media.currentTime).toBeCloseTo(3, 5);
    expect(media.paused).toBe(true);
  });

  it('keeps the chosen version across a restart and plays the whole recording for songs without a split', () => {
    const media = fakeMedia();
    const session = new Session({ audio: { instrument: fakeInstrument() }, backing: media }, song, { mode: 'listen', hands: 'both', speed: 1 });
    session.setRecordingSource('backing');
    session.reset();
    expect(media.src).toBe('blob:backing');
    session.load({ ...song, id: 'other', backingUrl: undefined });
    expect(media.src).toBe('blob:full');
    // "Piano only" is the recording muted: it still keeps time silently.
    session.recordingMuted = true;
    expect(media.muted).toBe(true);
    session.setRecordingSource('full');
    expect(media.muted).toBe(true);
  });

  it('does not reload when the version does not change', () => {
    const media = fakeMedia();
    const session = new Session({ audio: { instrument: fakeInstrument() }, backing: media }, song, { mode: 'wait', hands: 'right', speed: 1 });
    const loads = media.loads.length;
    session.setRecordingSource('full');
    expect(media.loads.length).toBe(loads);
  });
});

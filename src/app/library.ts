import { songLength, type Difficulty, type Song, type SongSource } from '../song';
import { inAppShell } from './shell';
import { toast } from '../ui/toast';
import type { Store } from './store';

export interface AddOptions {
  /** The original recording. Stored with the song and turned into `audioUrl`. */
  audio?: Blob;
  /** The recording without guitars and keys (a split song). Stored and turned into `backingUrl`. */
  backing?: Blob;
}

/**
 * What lists need to show a song without its notes: enough for a song card,
 * search and filters. Every song in the library has one, loaded or not.
 */
export interface SongSummary {
  id: string;
  title: string;
  by: string;
  source: SongSource;
  difficulty?: Difficulty;
  tags: readonly string[];
  /** Length in seconds, when known. */
  seconds?: number;
  /** Number of notes, when known. */
  noteCount?: number;
  licence?: string;
  /** The song was made from a recording that has to be added again (a shared lesson). */
  needsRecording: boolean;
  /** The song plays along with its original recording. */
  hasRecording: boolean;
  /** Notes were changed by hand in the editor. */
  edited: boolean;
  /** Date.now() when it was added (songs that are not built-in). */
  addedAt?: number;
  /** False while only the summary is known and the notes still have to be fetched. */
  loaded: boolean;
}

/** A built-in song whose notes are fetched the first time someone opens it. */
export interface LazySong {
  summary: Omit<SongSummary, 'loaded' | 'source' | 'needsRecording' | 'hasRecording' | 'edited'>;
  load: () => Promise<Song>;
}

type Listener = (songs: readonly Song[]) => void;

/** Key of a song's split rendition in the object URL map. */
const backingUrlKey = (id: string) => `${id}#backing`;

/** The summary of a loaded song. */
export function summarize(song: Song): SongSummary {
  return {
    id: song.id,
    title: song.title,
    by: song.by,
    source: song.source ?? 'mine',
    difficulty: song.difficulty,
    tags: song.tags ?? [],
    seconds: song.notes.length ? songLength(song) : undefined,
    noteCount: song.notes.length,
    licence: song.licence,
    needsRecording: Boolean(song.recording && !song.audioUrl),
    hasRecording: Boolean(song.audioUrl),
    edited: Boolean(song.edited),
    addedAt: song.addedAt,
    loaded: true,
  };
}

/**
 * Every song the app knows: built-in, the player's own, and ones added from
 * the community. Songs that are not built-in are saved to the store, together
 * with their recording, and come back on the next visit.
 *
 * Built-in song packs can be registered lazily: the library then knows their
 * summary at once (for lists) and fetches the notes on `ensure(id)`.
 *
 * Songs are plain objects. Do not mutate one in place; call `update` with a
 * changed copy so listeners hear about it and the change is saved.
 */
export class Library {
  private songs: Song[] = [];
  private lazy = new Map<string, LazySong>();
  private loading = new Map<string, Promise<Song | undefined>>();
  private listeners = new Set<Listener>();
  private urls = new Map<string, string>();
  private summaryCache: SongSummary[] | null = null;

  constructor(
    private store: Store,
    builtIn: readonly Song[] = [],
    private makeUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private dropUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {
    this.register(builtIn);
  }

  /** Reads saved songs from the store. Call once at start-up. */
  async load(): Promise<void> {
    let stored: Awaited<ReturnType<Store['getSongs']>> = [];
    try {
      stored = await this.store.getSongs();
    } catch (error) {
      console.warn('Saved songs could not be read.', error);
    }
    for (const { song, audio, backing } of stored) {
      if (this.songs.some((s) => s.id === song.id)) continue;
      const restored = { ...song, source: song.source ?? 'mine' };
      delete restored.backingUrl;
      if (audio) restored.audioUrl = this.urlFor(song.id, audio);
      if (audio && backing) restored.backingUrl = this.urlFor(backingUrlKey(song.id), backing);
      this.songs.push(restored);
    }
    this.emit();
  }

  /** Adds songs that ship with the app (never saved to the store). Existing ids are kept. */
  register(songs: readonly Song[]): void {
    let changed = false;
    for (const song of songs) {
      if (this.songs.some((s) => s.id === song.id)) continue;
      this.lazy.delete(song.id);
      this.songs.push({ ...song, source: 'built-in' });
      changed = true;
    }
    if (changed) this.emit();
  }

  /** Adds built-in songs known by summary only; their notes are fetched by `ensure`. */
  registerLazy(entries: readonly LazySong[]): void {
    let changed = false;
    for (const entry of entries) {
      const id = entry.summary.id;
      if (this.lazy.has(id) || this.songs.some((s) => s.id === id)) continue;
      this.lazy.set(id, entry);
      changed = true;
    }
    if (changed) this.emit();
  }

  /** Songs whose notes are loaded. Lazily registered songs appear here once `ensure` fetched them. */
  all(): readonly Song[] {
    return this.songs;
  }

  bySource(source: SongSource): Song[] {
    return this.songs.filter((s) => (s.source ?? 'mine') === source);
  }

  /** A loaded song. For a song that may still have to be fetched, use `ensure`. */
  get(id: string): Song | undefined {
    return this.songs.find((s) => s.id === id);
  }

  /** True when the library knows this id, loaded or not. */
  has(id: string): boolean {
    return this.lazy.has(id) || this.songs.some((s) => s.id === id);
  }

  /** Summaries of every song, loaded or not, in library order (built-in first as registered). */
  summaries(): readonly SongSummary[] {
    if (this.summaryCache) return this.summaryCache;
    const out: SongSummary[] = this.songs.map(summarize);
    for (const entry of this.lazy.values()) {
      out.push({ ...entry.summary, tags: entry.summary.tags ?? [], source: 'built-in', needsRecording: false, hasRecording: false, edited: false, loaded: false });
    }
    this.summaryCache = out;
    return out;
  }

  /** The summary of one song, loaded or not. */
  summary(id: string): SongSummary | undefined {
    return this.summaries().find((s) => s.id === id);
  }

  /**
   * The song with its notes, fetching them first when it was registered
   * lazily. Resolves undefined for unknown ids and songs that failed to load.
   */
  ensure(id: string): Promise<Song | undefined> {
    const ready = this.get(id);
    if (ready) return Promise.resolve(ready);
    const entry = this.lazy.get(id);
    if (!entry) return Promise.resolve(undefined);
    let pending = this.loading.get(id);
    if (!pending) {
      pending = entry
        .load()
        .then((song) => {
          const already = this.get(id);
          if (already) return already;
          this.lazy.delete(id);
          const full: Song = { ...song, id, source: 'built-in' };
          this.songs.push(full);
          this.emit();
          return full;
        })
        .catch((error: unknown) => {
          console.warn(`The song ${id} could not be loaded.`, error);
          return undefined;
        })
        .finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return pending;
  }

  /** Adds a song, replacing one with the same id. Songs without a source become 'mine'. */
  async add(song: Song, options: AddOptions = {}): Promise<Song> {
    const i = this.songs.findIndex((s) => s.id === song.id);
    if ((i >= 0 && this.songs[i].source === 'built-in') || this.lazy.has(song.id)) throw new Error('Built-in songs cannot be replaced.');
    const added: Song = {
      ...song,
      source: song.source === 'built-in' ? 'mine' : (song.source ?? 'mine'),
      addedAt: song.addedAt ?? (i >= 0 ? this.songs[i].addedAt : undefined) ?? Date.now(),
    };
    if (options.audio) added.audioUrl = this.urlFor(added.id, options.audio);
    if (options.backing && added.audioUrl) added.backingUrl = this.urlFor(backingUrlKey(added.id), options.backing);
    if (i >= 0) this.songs[i] = added;
    else this.songs.push(added);
    this.emit();
    await this.save(added, options.audio);
    if (options.backing && added.backingUrl) await this.saveBacking(added, options.backing);
    return added;
  }

  /** Replaces a song with a changed copy. Built-in songs change only in memory. */
  async update(song: Song): Promise<void> {
    const i = this.songs.findIndex((s) => s.id === song.id);
    if (i < 0) throw new Error(`No song with id ${song.id}`);
    const source = this.songs[i].source;
    this.songs[i] = { ...song, source };
    this.emit();
    if (source !== 'built-in') await this.save(this.songs[i]);
  }

  /** Attaches a recording to a song, e.g. the one a shared lesson was made for. */
  async attachAudio(id: string, audio: Blob): Promise<Song> {
    const song = this.get(id);
    if (!song) throw new Error(`No song with id ${id}`);
    const next = { ...song, audioUrl: this.urlFor(id, audio) };
    const i = this.songs.indexOf(song);
    this.songs[i] = next;
    this.emit();
    if (next.source !== 'built-in') await this.save(next, audio);
    return next;
  }

  /**
   * Keeps the split rendition of a song's recording (the recording without its
   * guitars and keys) and gives the song a `backingUrl` for it.
   */
  async attachBacking(id: string, backing: Blob): Promise<Song> {
    const song = this.get(id);
    if (!song) throw new Error(`No song with id ${id}`);
    if (!song.audioUrl) throw new Error('Only a song with its recording can be split.');
    const next = { ...song, backingUrl: this.urlFor(backingUrlKey(id), backing) };
    this.songs[this.songs.indexOf(song)] = next;
    this.emit();
    if (next.source !== 'built-in') await this.saveBacking(next, backing);
    return next;
  }

  /** Removes one of the player's songs. Built-in songs cannot be removed. */
  async remove(id: string): Promise<void> {
    if (this.lazy.has(id)) throw new Error('Built-in songs cannot be removed.');
    const song = this.get(id);
    if (!song) return;
    if (song.source === 'built-in') throw new Error('Built-in songs cannot be removed.');
    this.songs = this.songs.filter((s) => s.id !== id);
    for (const key of [id, backingUrlKey(id)]) {
      const url = this.urls.get(key);
      if (url) this.dropUrl(url);
      this.urls.delete(key);
    }
    this.emit();
    try {
      await this.store.deleteSong(id);
    } catch (error) {
      console.warn('The song could not be removed from storage.', error);
    }
  }

  /** Calls `listener` after every change. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private urlFor(id: string, audio: Blob): string {
    const old = this.urls.get(id);
    if (old) this.dropUrl(old);
    const url = this.makeUrl(audio);
    this.urls.set(id, url);
    return url;
  }

  private async save(song: Song, audio?: Blob): Promise<void> {
    try {
      await this.store.putSong(song);
      if (audio) await this.store.putAudio(song.id, audio);
    } catch (error) {
      console.warn('The song could not be saved.', error);
      // Say so plainly: the song works now but would be gone after a reload.
      if (typeof document !== 'undefined') toast(`"${song.title}" could not be saved on this device. It will be gone ${inAppShell() ? 'when the app closes' : 'after a reload'}.`, { kind: 'error' });
    }
  }

  private async saveBacking(song: Song, backing: Blob): Promise<void> {
    try {
      await this.store.putBacking(song.id, backing);
    } catch (error) {
      // The song still plays with its whole recording; the split version is back to make next time.
      console.warn('The split version of the song could not be saved.', error);
    }
  }

  private emit(): void {
    this.summaryCache = null;
    for (const l of this.listeners) l(this.songs);
  }
}

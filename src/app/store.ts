import type { Song } from '../song';
import { openDatabase, request, transact } from './idb';
import { starsFor } from './progress';

export type Stars = 0 | 1 | 2 | 3;

/** How the player has done on one song, across all plays. */
export interface SongProgress {
  songId: string;
  /** Best accuracy so far, 0..1. */
  best: number;
  stars: Stars;
  plays: number;
  /** Date.now() of the last finished play. */
  lastPlayed: number;
}

/** One course lesson's state. */
export interface LessonProgress {
  lessonId: string;
  completed: boolean;
  stars: Stars;
  attempts: number;
  completedAt?: number;
}

/** A stored song with its original recording, when it came from an audio file. */
export interface StoredSong {
  /** Never has `audioUrl` or `backingUrl`: object URLs do not survive a reload. Recreate them from `audio` and `backing`. */
  song: Song;
  audio?: Blob;
  /** The recording without guitars and keys, when the song was split. */
  backing?: Blob;
}

/**
 * Everything the app remembers between visits. All methods are async and may
 * reject when the browser refuses storage mid-session; callers should treat
 * a failed write as "not remembered", never as fatal.
 */
export interface Store {
  /** False when nothing survives a reload (private windows, storage blocked). */
  readonly persistent: boolean;

  getSongs(): Promise<StoredSong[]>;
  /** Saves the song (without `audioUrl`). Keeps any audio already stored for this id. */
  putSong(song: Song): Promise<void>;
  putAudio(songId: string, audio: Blob): Promise<void>;
  /** Saves the split rendition of a song's recording (the backing without guitars and keys). */
  putBacking(songId: string, backing: Blob): Promise<void>;
  /** Removes the song, its audio and its progress. */
  deleteSong(songId: string): Promise<void>;

  /** Small key-value records (settings, streak, area-private data). Values are untrusted on read: validate them. */
  getValue(key: string): Promise<unknown>;
  setValue(key: string, value: unknown): Promise<void>;

  getProgress(songId: string): Promise<SongProgress | undefined>;
  putProgress(progress: SongProgress): Promise<void>;
  allProgress(): Promise<SongProgress[]>;

  getLessonProgress(lessonId: string): Promise<LessonProgress | undefined>;
  putLessonProgress(progress: LessonProgress): Promise<void>;
  allLessonProgress(): Promise<LessonProgress[]>;
}

type Table = 'songs' | 'audio' | 'kv' | 'progress' | 'lessons';
const TABLES: Table[] = ['songs', 'audio', 'kv', 'progress', 'lessons'];

/** The four operations a storage engine has to offer. */
interface Backend {
  get(table: Table, key: string): Promise<unknown>;
  put(table: Table, key: string, value: unknown): Promise<void>;
  delete(keys: [Table, string][]): Promise<void>;
  all(table: Table): Promise<unknown[]>;
  keys(table: Table): Promise<string[]>;
}

class MemoryBackend implements Backend {
  private tables = new Map<Table, Map<string, unknown>>(TABLES.map((t) => [t, new Map()]));

  async get(table: Table, key: string) {
    const v = this.tables.get(table)!.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }
  async put(table: Table, key: string, value: unknown) {
    this.tables.get(table)!.set(key, structuredClone(value));
  }
  async delete(keys: [Table, string][]) {
    for (const [t, k] of keys) this.tables.get(t)!.delete(k);
  }
  async all(table: Table) {
    return [...this.tables.get(table)!.values()].map((v) => structuredClone(v));
  }
  async keys(table: Table) {
    return [...this.tables.get(table)!.keys()];
  }
}

class IdbBackend implements Backend {
  constructor(private db: IDBDatabase) {}

  get(table: Table, key: string) {
    return transact(this.db, [table], 'readonly', (tx) => request(tx.objectStore(table).get(key)));
  }
  put(table: Table, key: string, value: unknown) {
    return transact(this.db, [table], 'readwrite', (tx) => {
      tx.objectStore(table).put(value, key);
    });
  }
  delete(keys: [Table, string][]) {
    const tables = [...new Set(keys.map(([t]) => t))];
    return transact(this.db, tables, 'readwrite', (tx) => {
      for (const [t, k] of keys) tx.objectStore(t).delete(k);
    });
  }
  all(table: Table) {
    return transact(this.db, [table], 'readonly', (tx) => request(tx.objectStore(table).getAll()));
  }
  async keys(table: Table) {
    const keys = await transact(this.db, [table], 'readonly', (tx) => request(tx.objectStore(table).getAllKeys()));
    return keys.map(String);
  }
}

function withoutUrl(song: Song): Song {
  const copy = { ...song };
  delete copy.audioUrl;
  delete copy.backingUrl;
  return copy;
}

/** Where a song's split rendition is kept: the audio table, under its own key (no new table, so no database upgrade). */
const backingKey = (songId: string) => `backing:${songId}`;

/** How a recording is kept: its bytes and media type. Older versions stored the Blob itself. */
interface StoredAudio {
  type: string;
  bytes: ArrayBuffer;
}

/** A stored recording back as a Blob, from either way it may have been stored. */
function audioFrom(value: unknown): Blob | undefined {
  if (value instanceof Blob) return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const { type, bytes } = value as Partial<StoredAudio>;
  if (!(bytes instanceof ArrayBuffer)) return undefined;
  return new Blob([bytes], { type: typeof type === 'string' ? type : '' });
}

class BackendStore implements Store {
  constructor(
    private backend: Backend,
    readonly persistent: boolean,
  ) {}

  async getSongs(): Promise<StoredSong[]> {
    const songs = (await this.backend.all('songs')) as Song[];
    const out: StoredSong[] = [];
    for (const song of songs) {
      const audio = audioFrom(await this.backend.get('audio', song.id));
      const backing = audio ? audioFrom(await this.backend.get('audio', backingKey(song.id))) : undefined;
      out.push({ song, ...(audio ? { audio } : {}), ...(backing ? { backing } : {}) });
    }
    return out;
  }
  putSong(song: Song) {
    return this.backend.put('songs', song.id, withoutUrl(song));
  }
  async putAudio(songId: string, audio: Blob) {
    // Plain bytes, not the Blob: Safari's private windows refuse Blobs in IndexedDB
    // ("transaction failed"), so the recording was lost on reload there.
    const stored: StoredAudio = { type: audio.type, bytes: await audio.arrayBuffer() };
    return this.backend.put('audio', songId, stored);
  }
  async putBacking(songId: string, backing: Blob) {
    const stored: StoredAudio = { type: backing.type, bytes: await backing.arrayBuffer() };
    return this.backend.put('audio', backingKey(songId), stored);
  }
  deleteSong(songId: string) {
    return this.backend.delete([
      ['songs', songId],
      ['audio', songId],
      ['audio', backingKey(songId)],
      ['progress', songId],
    ]);
  }
  getValue(key: string) {
    return this.backend.get('kv', key);
  }
  setValue(key: string, value: unknown) {
    return this.backend.put('kv', key, value);
  }
  async getProgress(songId: string) {
    return (await this.backend.get('progress', songId)) as SongProgress | undefined;
  }
  putProgress(progress: SongProgress) {
    return this.backend.put('progress', progress.songId, progress);
  }
  async allProgress() {
    return (await this.backend.all('progress')) as SongProgress[];
  }
  async getLessonProgress(lessonId: string) {
    return (await this.backend.get('lessons', lessonId)) as LessonProgress | undefined;
  }
  putLessonProgress(progress: LessonProgress) {
    return this.backend.put('lessons', progress.lessonId, progress);
  }
  async allLessonProgress() {
    return (await this.backend.all('lessons')) as LessonProgress[];
  }
}

/** A store that forgets everything on reload. Used when real storage is unavailable, and in tests. */
export function memoryStore(): Store {
  return new BackendStore(new MemoryBackend(), false);
}

export interface OpenStoreOptions {
  /** Defaults to the browser's indexedDB. Pass null to force the memory store. */
  indexedDB?: IDBFactory | null;
  /** Where old best scores may be waiting to be moved in. Defaults to window.localStorage. */
  localStorage?: Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'> | null;
  name?: string;
  timeoutMs?: number;
}

const DB_VERSION = 1;

/**
 * Opens persistent storage, falling back to memory when the browser refuses
 * (some private windows) or takes too long. Never rejects.
 */
export async function openStore(options: OpenStoreOptions = {}): Promise<Store> {
  const factory = options.indexedDB !== undefined ? options.indexedDB : (globalThis.indexedDB ?? null);
  if (!factory) return memoryStore();

  let db: IDBDatabase;
  try {
    db = await Promise.race([
      openDatabase(factory, options.name ?? 'piano', DB_VERSION, (database) => {
        for (const t of TABLES) if (!database.objectStoreNames.contains(t)) database.createObjectStore(t);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('IndexedDB timed out')), options.timeoutMs ?? 4000),
      ),
    ]);
  } catch {
    return memoryStore();
  }

  const store = new BackendStore(new IdbBackend(db), true);
  const legacy =
    options.localStorage !== undefined ? options.localStorage : typeof localStorage === 'undefined' ? null : localStorage;
  await migrateBestScores(store, legacy);
  return store;
}

/** Moves the `best:<songId>` scores the single-screen version kept in localStorage. */
async function migrateBestScores(store: Store, legacy: OpenStoreOptions['localStorage']): Promise<void> {
  if (!legacy) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < legacy.length; i++) {
      const key = legacy.key(i);
      if (key?.startsWith('best:')) keys.push(key);
    }
    for (const key of keys) {
      const songId = key.slice(5);
      const best = Number(legacy.getItem(key)) || 0;
      const old = await store.getProgress(songId);
      if (!old || old.best < best) {
        await store.putProgress({
          songId,
          best,
          stars: Math.max(old?.stars ?? 0, starsFor(best)) as Stars,
          plays: old?.plays ?? 1,
          lastPlayed: old?.lastPlayed ?? 0,
        });
      }
      legacy.removeItem(key);
    }
  } catch {
    // localStorage refused: the old scores stay where they are
  }
}

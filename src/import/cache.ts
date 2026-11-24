// Remembers what was heard in a recording, keyed by the file's contents, so
// adding the same file again (or after deleting the song) is instant. Lives in
// its own small database; any failure just means listening again.
import type { Analysis } from '../analysis';
import type { RawNote } from '../song';

/** Bump when listening changes enough that old results should be redone. */
export const CACHE_VERSION = 3; // 3: chords from the model's frame activations, with sevenths, slash chords and confidence
const DB = 'piano-import-cache';
const STORE = 'heard';
const KEEP = 25;

export interface CachedHearing {
  version: number;
  raw: RawNote[];
  analysis: Analysis;
  startsAt: number;
  savedAt: number;
}

/** SHA-256 of a file's bytes, as hex. */
export async function fingerprint(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function valid(value: unknown): value is CachedHearing {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CachedHearing>;
  return (
    v.version === CACHE_VERSION &&
    Array.isArray(v.raw) &&
    v.raw.every(
      (n) =>
        n &&
        typeof n.midi === 'number' &&
        typeof n.start === 'number' &&
        typeof n.dur === 'number' &&
        typeof n.amp === 'number' &&
        (n.part === undefined || n.part === 'melody'),
    ) &&
    typeof v.analysis === 'object' &&
    v.analysis !== null &&
    typeof v.startsAt === 'number'
  );
}

export async function readCache(key: string): Promise<CachedHearing | undefined> {
  try {
    const db = await open();
    try {
      const value: unknown = await done(db.transaction(STORE).objectStore(STORE).get(key));
      return valid(value) ? value : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

export async function writeCache(key: string, entry: Omit<CachedHearing, 'version' | 'savedAt'>): Promise<void> {
  try {
    const db = await open();
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      await done(store.put({ ...entry, version: CACHE_VERSION, savedAt: Date.now() }, key));
      // Keep the newest few only.
      const all = await done(db.transaction(STORE).objectStore(STORE).getAll());
      const keys = await done(db.transaction(STORE).objectStore(STORE).getAllKeys());
      if (keys.length > KEEP) {
        const order = keys
          .map((k, i) => ({ k, at: (all[i] as Partial<CachedHearing> | undefined)?.savedAt ?? 0 }))
          .sort((a, b) => a.at - b.at);
        const tx = db.transaction(STORE, 'readwrite').objectStore(STORE);
        for (const { k } of order.slice(0, keys.length - KEEP)) tx.delete(k);
      }
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn('Could not remember this recording; it will be listened to again next time.', error);
  }
}

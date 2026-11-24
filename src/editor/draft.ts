import { fromLesson, toLesson } from '../lesson';
import type { Song } from '../song';

/**
 * Unsaved work is kept as a draft in the store while editing, so closing the
 * tab or a crash never loses it. The draft is stored as lesson-file text and
 * read back through the lesson reader, which already checks everything.
 */

export interface DraftRecord {
  v: 1;
  /** The song being edited (for a new song, the id it will get). */
  songId: string;
  savedAt: number;
  lesson: string;
}

export interface Draft {
  songId: string;
  savedAt: number;
  /** Notes and details. Id, source and recording are not in it. */
  song: Song;
}

const PREFIX = 'editor:draft:';

/** Store key for a song's draft. A new song that was never saved uses "new". */
export function draftKey(songId: string | null): string {
  return PREFIX + (songId ?? 'new');
}

export function encodeDraft(song: Song, now = Date.now()): DraftRecord {
  return { v: 1, songId: song.id, savedAt: now, lesson: JSON.stringify(toLesson(song)) };
}

const PLACEHOLDER: [number, number, number, number] = [60, 0, 1, 0];

/** Reads a stored draft, or null if it is missing or damaged. */
export function decodeDraft(value: unknown): Draft | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Partial<DraftRecord>;
  if (r.v !== 1 || typeof r.songId !== 'string' || r.songId.length > 300 || typeof r.savedAt !== 'number' || !Number.isFinite(r.savedAt) || typeof r.lesson !== 'string') {
    return null;
  }
  try {
    // A draft may have no notes yet, which lesson files do not allow: check it with a stand-in note.
    const data = JSON.parse(r.lesson) as { notes?: unknown };
    const empty = Array.isArray(data.notes) && data.notes.length === 0;
    const song = fromLesson(empty ? JSON.stringify({ ...data, notes: [PLACEHOLDER] }) : r.lesson);
    if (empty) song.notes = [];
    return { songId: r.songId, savedAt: r.savedAt, song };
  } catch {
    return null;
  }
}

/** True when two songs have the same notes and details (what a lesson file holds). */
export function sameContent(a: Song, b: Song): boolean {
  return JSON.stringify(toLesson(a)) === JSON.stringify(toLesson(b));
}

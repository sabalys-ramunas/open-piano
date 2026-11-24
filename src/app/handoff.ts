/**
 * One-time messages from one screen to the next, kept in memory only. For
 * example the import flow tells the player that a song was just made
 * automatically, so the player can say so once.
 */
import type { Mode } from '../player/game';

export type Handoff =
  /**
   * A song was just made from a file. `automatic` is true when the notes were worked out from a
   * recording; `note` is a short sentence about something that did not work (splitting the song).
   */
  | { kind: 'imported'; songId: string; automatic: boolean; note?: string }
  /** The editor just saved this song. */
  | { kind: 'saved'; songId: string }
  /** The song sheet on home: the way to play was just chosen there, so the player need not ask again. */
  | { kind: 'mode-chosen'; songId: string; mode: Mode };

let pending: Handoff | null = null;

export function setHandoff(message: Handoff): void {
  pending = message;
}

/** Returns and clears the message if it is about this song. */
export function takeHandoff(songId: string): Handoff | null {
  if (!pending || pending.songId !== songId) return null;
  const message = pending;
  pending = null;
  return message;
}

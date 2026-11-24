import type { Hands, Mode } from '../player/game';
import type { Difficulty, Level } from '../song';
import { SPLITTER_BYTES } from '../split/model-files';
import type { SongSound } from './settings';

/**
 * The words the app uses for its main ideas, in one place, so every screen
 * names them the same way. Use these instead of writing labels by hand.
 */

/** Song difficulty, 1..5. Shown as "Level 2 · Easy". */
export const DIFFICULTY_WORD: Record<Difficulty, string> = {
  1: 'First steps',
  2: 'Easy',
  3: 'Medium',
  4: 'Harder',
  5: 'Advanced',
};

export function difficultyLabel(d: Difficulty): string {
  return `Level ${d} · ${DIFFICULTY_WORD[d]}`;
}

/** How much of a song made from a recording is played ("Notes to play"). */
export const NOTES_TO_PLAY_LABEL = 'Notes to play';
export const LEVELS: readonly { level: Level; label: string; hint: string }[] = [
  { level: 'melody', label: 'Melody only', hint: 'Just the tune, one note at a time.' },
  { level: 'melody-bass', label: 'Melody and bass', hint: 'The tune in the right hand and low notes in the left.' },
  { level: 'melody-chords', label: 'Melody and chords', hint: 'The tune with simple chords in the left hand.' },
  { level: 'full', label: 'Everything', hint: 'All the notes that were heard. The hardest.' },
];

export function levelLabel(level: Level): string {
  return LEVELS.find((l) => l.level === level)?.label ?? 'Melody only';
}

/** Ways to play a song. */
export const MODES: readonly { mode: Mode; label: string; hint: string }[] = [
  { mode: 'listen', label: 'Listen', hint: 'Sit back and hear how the song goes.' },
  { mode: 'wait', label: 'Learn', hint: 'The music waits for you to press each note. No rush.' },
  { mode: 'flow', label: 'Play along', hint: 'The music keeps going. Play in time with it!' },
];

/** Which hands play. */
export const HANDS: readonly { hands: Hands; label: string }[] = [
  { hands: 'right', label: 'Right hand' },
  { hands: 'left', label: 'Left hand' },
  { hands: 'both', label: 'Both hands' },
];

export function handsLabel(hands: Hands): string {
  return HANDS.find((x) => x.hands === hands)?.label ?? 'Right hand';
}

/** Where songs come from, as section names. */
export const SOURCE_LABEL = {
  'built-in': 'Comes with the app',
  mine: 'My songs',
  community: 'Shared songs',
} as const;

/** "1:05" for 65 seconds; "0:09" for 9. */
export function minutesSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What the original recording plays, for songs that were split (see SongSound in settings). */
export const SONG_SOUND_WORDS: Record<SongSound, { label: string; hint: string }> = {
  full: { label: 'Full song', hint: 'The whole recording plays along' },
  backing: { label: 'Without guitars and keys', hint: 'Voice, drums and bass. Your piano plays the rest' },
  off: { label: 'Piano only', hint: 'The recording stays quiet' },
};

/** The offer to split songs when adding them, and "Split this song" in the player. */
export const SPLIT_OFFER = 'Split the song so the piano replaces the guitars';
/** "one-time 80 MB download" (the size rounded to tens of MB). */
export const SPLIT_DOWNLOAD = `one-time ${Math.round(SPLITTER_BYTES / 1e7) * 10} MB download`;

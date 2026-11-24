import { type Analysis, analyse, findHarmony } from '../analysis';
import type { Library } from '../app/library';
import { acceptList, soundFormatWords } from '../app/formats';
import { fromLesson } from '../lesson';
import type { Level, RawNote, Song } from '../song';
import { type ArrangeContext, arrange } from './arrange';
import { type HandChoice, readMidiSong } from './midifile';

/** What the add-song flow is doing, for a progress display. */
export type ImportStage = 'reading' | 'downloading' | 'splitting' | 'listening' | 'analysing';

export interface ImportOptions {
  /** How to simplify a recording. Defaults to the melody only. */
  level?: Level;
  onProgress?: (stage: ImportStage, fraction: number) => void;
  /** Cancels the import; the promise then rejects with an error named 'Cancelled'. */
  signal?: AbortSignal;
  /** "The song starts here", in seconds: notes before this are dropped. */
  startAt?: number;
  /** For MIDI files: which tracks each hand plays (see `midiTracks`). */
  hands?: HandChoice;
  /**
   * Recordings: split the song into voice, drums, bass and the rest (on this
   * device), downloading the splitter first if needed. The song then also
   * plays without its guitars and keys, and its chords are heard without the
   * drums and voice. If that fails the song is made as without it, and
   * `onNote` hears a short sentence saying so.
   */
  split?: boolean;
  /** A short friendly sentence about something that did not work but did not stop the import. */
  onNote?: (text: string) => void;
}

/** File types the "Add your own song" picker accepts. Video files are tried too: many hold a sound track the browser can read. */
export const ACCEPT = acceptList(); // Ogg and Opus only where this engine can decode them (src/app/formats.ts)

/** An error whose message is fit to show the player as is. */
export class FriendlyError extends Error {}

/** Longest recording we take on, in seconds. Longer ones need more memory than many devices have. */
export const MAX_SECONDS = 20 * 60;

const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|opus|m4a|m4b|aac|flac|webm|weba|mp4|m4v|mov|mkv|aif|aiff|caf|wma|ape|m4p|aa|aax|amr|3gp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|avi|wmv|3gp|webm)$/i;
const PROTECTED_EXT = /\.(m4p|aa|aax|m4b)$/i;
const RARE_EXT = /\.(wma|ape|amr|aif|aiff|caf)$/i;

const isCancel = (error: unknown) => error instanceof Error && error.name === 'Cancelled';

/** What kind of file this is, the same way `importFile` decides. */
export function fileKind(file: { name: string; type: string }): 'lesson' | 'midi' | 'audio' {
  if (/\.json$/i.test(file.name)) return 'lesson';
  if (/\.(midi?|kar)$/i.test(file.name) || file.type === 'audio/midi' || file.type === 'audio/x-midi') return 'midi';
  return 'audio';
}

/** A loaded lesson still waiting for exactly this recording, which `importFile` would attach it to. */
export function waitingLessonFor(file: { name: string; type: string; size: number }, library: Pick<Library, 'all'>): Song | undefined {
  const isAudio = file.type.startsWith('audio/') || file.type.startsWith('video/') || AUDIO_EXT.test(file.name);
  if (!isAudio || fileKind(file) !== 'audio') return undefined;
  return library.all().find((s) => !s.audioUrl && s.recording?.bytes === file.size);
}

/**
 * Turns a file into a song in the library and returns it.
 * - A recording that a loaded lesson was made for is attached to that lesson.
 * - .json lesson files are read as they are.
 * - .mid / .midi files are read as notes.
 * - Anything else is treated as a recording: the notes are worked out in this
 *   browser tab (nothing is uploaded) and the recording is kept as backing.
 */
export async function importFile(file: File, library: Library, options: ImportOptions = {}): Promise<Song> {
  const progress = options.onProgress ?? (() => {});
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'My song';
  const id = `mine:${title}:${file.size}`;
  const isAudio = file.type.startsWith('audio/') || file.type.startsWith('video/') || AUDIO_EXT.test(file.name);

  if (file.size === 0) throw new FriendlyError('That file is empty.');
  const waiting = library.all().find((s) => !s.audioUrl && s.recording?.bytes === file.size);
  if (waiting && isAudio) return library.attachAudio(waiting.id, file);

  let song: Song;
  let audio: Blob | undefined;
  let backing: Blob | undefined;
  progress('reading', 0);
  if (/\.json$/i.test(file.name)) {
    song = fromLesson(await file.text());
  } else if (/\.(midi?|kar)$/i.test(file.name) || file.type === 'audio/midi' || file.type === 'audio/x-midi') {
    let midi;
    try {
      midi = readMidiSong(await file.arrayBuffer(), options.hands);
    } catch {
      throw new FriendlyError('That MIDI file could not be read.');
    }
    const notes = options.startAt ? midi.notes.filter((n) => n.start >= options.startAt!) : midi.notes;
    song = { id, title, by: '', notes };
    progress('analysing', 0);
    // The file's own tempo map beats anything we could work out; analysis adds key and chords.
    const found = await safeAnalyse(notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur, amp: 0.8 })));
    Object.assign(song, songFacts({ ...found, ...pick(midi, ['bpm', 'beats', 'timeSignature']) }));
  } else {
    const listened = await listenToFile(file, options, progress);
    const heard = listened.heard;
    backing = listened.backing;
    if (options.signal?.aborted) throw cancelled();
    const level = options.level ?? 'melody';
    progress('analysing', 0.5);
    const facts = songFacts(heard.analysis);
    // "The song starts here": notes stay in recording time (the recording is
    // the clock while playing along), only stray notes heard in the silence
    // before the music are dropped. Detected while listening unless given.
    const startAt = songStartFor(options.startAt, heard.startsAt);
    const raw = startAt > 0 ? heard.raw.filter((n) => n.start >= startAt) : heard.raw;
    song = {
      id,
      title,
      by: '',
      raw,
      level,
      notes: arrange(raw, level, contextOf(facts)),
      recording: { name: file.name, bytes: file.size },
      ...facts,
    };
    audio = file;
  }

  if (song.notes.length === 0) {
    throw new FriendlyError(
      audio
        ? 'No notes could be heard in that recording. Try a song with a clear tune.'
        : 'No notes were found in that file.',
    );
  }
  progress('analysing', 1);
  if (options.signal?.aborted) throw cancelled();
  return library.add({ ...song, source: 'mine' }, { audio, backing });
}

/**
 * Where the notes of a recording begin: the caller's choice when given,
 * otherwise what was detected while listening. Anything not a finite,
 * non-negative number counts as "from the start".
 */
export function songStartFor(given: number | undefined, detected: number | undefined): number {
  const pick = given !== undefined ? given : detected;
  return typeof pick === 'number' && Number.isFinite(pick) && pick > 0 ? pick : 0;
}

interface Heard {
  raw: RawNote[];
  analysis: Analysis;
  startsAt: number;
}

/** Decodes and listens to a recording (splitting it first when asked), or reuses what was heard last time this exact file was added. */
async function listenToFile(
  file: File,
  options: ImportOptions,
  progress: (stage: ImportStage, fraction: number) => void,
): Promise<{ heard: Heard; backing?: Blob }> {
  const bytes = await file.arrayBuffer();
  progress('reading', 0.2);
  const { fingerprint, readCache, writeCache } = await import('./cache');
  const note = (text: string) => options.onNote?.(text);
  // The splitter first: a download that fails leaves the song to be made as before.
  let split = options.split === true && (await splitterReady(options, progress, note));
  let key: string | undefined;
  let cached: Heard | undefined;
  try {
    // Hearing a split song is different (chords from its harmony), so it is remembered apart.
    key = (await fingerprint(bytes)) + (split ? ':split' : '');
    cached = await readCache(key);
    if (cached && !split) {
      progress('listening', 1);
      return { heard: cached };
    }
  } catch {
    key = undefined; // no crypto (insecure page): just listen
  }
  if (options.signal?.aborted) throw cancelled();

  // Loaded on demand: listening needs a large model that most visits never use.
  progress('reading', 0.4);
  const { decodeFile, toModelRate, listen } = await import('./transcribe');
  if (options.signal?.aborted) throw cancelled();
  progress('reading', 0.6);
  let decoded: AudioBuffer;
  try {
    decoded = await decodeFile(new Blob([bytes], { type: file.type }));
  } catch {
    throw new FriendlyError(decodeProblem(file));
  }
  if (decoded.duration < 1) throw new FriendlyError('That recording is too short. Try one that is at least a few seconds long.');
  if (decoded.duration > MAX_SECONDS) {
    throw new FriendlyError(`That recording is longer than ${MAX_SECONDS / 60} minutes. Try a single song, or cut it shorter first.`);
  }
  progress('reading', 1);
  let backing: Blob | undefined;
  let harmony: Float32Array | undefined;
  if (split) {
    // The split worker is ended before the note model starts, so the two never hold memory at once.
    try {
      const { splitRecording } = await import('../split');
      const result = await splitRecording(decoded, { stems: !cached, signal: options.signal, onProgress: (f) => progress('splitting', f) });
      backing = result.backing;
      harmony = result.harmony;
    } catch (error) {
      if (isCancel(error)) throw error;
      console.warn('Splitting the song failed; making the lesson from the whole recording.', error);
      note(splitProblem(error));
      split = false;
      key = key?.replace(/:split$/, '');
    }
    if (split && cached) {
      progress('listening', 1);
      return { heard: cached, backing };
    }
  }
  if (options.signal?.aborted) throw cancelled();
  const samples = await toModelRate(decoded);
  if (options.signal?.aborted) throw cancelled();
  if (silent(samples.left) && (!samples.right || silent(samples.right))) {
    throw new FriendlyError('That recording seems to be silent.');
  }
  if (key && !split) {
    // Splitting failed after all: what was heard in the whole recording may be remembered.
    const plain = await readCache(key);
    if (plain) {
      progress('listening', 1);
      return { heard: plain };
    }
  }
  progress('listening', 0);
  try {
    const result = await listen(harmony ? { ...samples, harmony } : samples, { signal: options.signal, onProgress: (f) => progress('listening', f) });
    console.info(
      `Listened to ${decoded.duration.toFixed(0)} s of audio in ${result.seconds.toFixed(1)} s on ${result.backend}` +
        ` (${(decoded.duration / result.seconds).toFixed(1)} times faster than playing it; speed test: ` +
        `${Object.entries(result.speeds).map(([name, speed]) => `${name} ${speed.toFixed(1)}x`).join(', ') || 'skipped'}).`,
    );
    const heard = { raw: result.raw, analysis: result.analysis, startsAt: result.startsAt };
    if (key) void writeCache(key, heard);
    return { heard, backing };
  } catch (error) {
    if (isCancel(error)) throw error;
    console.error(error);
    throw new FriendlyError('Something went wrong while listening to that song. Please try again, or try another file.');
  }
}

/** One friendly sentence for why a song was not split (the import went on without it). */
function splitProblem(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/longer than/i.test(message)) return `${message} This one plays as it is.`;
  if (/memory/i.test(message)) return 'This device did not have enough memory to split the song, so it plays as it is.';
  return 'We could not split this song, so it plays as it is.';
}

/**
 * True when the splitter is on this device, downloading it first if needed.
 * A failed download is not an error: the song is made without splitting.
 */
async function splitterReady(options: ImportOptions, progress: (stage: ImportStage, fraction: number) => void, note: (text: string) => void): Promise<boolean> {
  try {
    const split = await import('../split');
    const support = split.splitSupport();
    if (!support.ok) {
      note(support.reason === 'memory' ? 'This device does not have enough memory to split songs, so it plays as it is.' : 'This browser cannot split songs, so it plays as it is.');
      return false;
    }
    if (await split.splitterStored()) return true;
    progress('downloading', 0);
    await split.downloadSplitter({ signal: options.signal, onProgress: (got, total) => progress('downloading', total > 0 ? got / total : 0) });
    return true;
  } catch (error) {
    if (isCancel(error)) throw error;
    console.warn('The song splitter could not be downloaded.', error);
    note('We could not download the song splitter, so this song plays as it is. You can try again later from the player.');
    return false;
  }
}

/**
 * "Split this song": makes the version of a song's recording without its
 * guitars and keys, downloading the splitter first if needed. The notes stay
 * as they are. Rejects with a FriendlyError, or an error named 'Cancelled'.
 */
export async function splitSong(
  song: Song,
  library: Library,
  options: { signal?: AbortSignal; onProgress?: (step: 'downloading' | 'reading' | 'splitting', fraction: number) => void } = {},
): Promise<Song> {
  const progress = options.onProgress ?? (() => {});
  if (!song.audioUrl) throw new FriendlyError('This song has no recording to split.');
  const split = await import('../split');
  const support = split.splitSupport();
  if (!support.ok) throw new FriendlyError(support.reason === 'memory' ? 'This device does not have enough memory to split songs.' : 'This browser cannot split songs.');
  if (!(await split.splitterStored())) {
    progress('downloading', 0);
    try {
      await split.downloadSplitter({ signal: options.signal, onProgress: (got, total) => progress('downloading', total > 0 ? got / total : 0) });
    } catch (error) {
      if (isCancel(error)) throw error;
      throw new FriendlyError(error instanceof split.SplitterDownloadError ? error.message : 'The song splitter could not be downloaded. Please try again later.');
    }
  }
  progress('reading', 0);
  const { decodeFile } = await import('./transcribe');
  let decoded: AudioBuffer;
  try {
    decoded = await decodeFile(await (await fetch(song.audioUrl)).blob());
  } catch {
    throw new FriendlyError('The recording could not be opened. It still plays as before.');
  }
  if (options.signal?.aborted) throw cancelled();
  progress('splitting', 0);
  try {
    const result = await split.splitRecording(decoded, { stems: false, signal: options.signal, onProgress: (f) => progress('splitting', f) });
    if (options.signal?.aborted) throw cancelled();
    return await library.attachBacking(song.id, result.backing);
  } catch (error) {
    if (isCancel(error)) throw error;
    console.warn('Splitting the song failed.', error);
    const message = error instanceof Error ? error.message : '';
    if (/longer than/i.test(message)) throw new FriendlyError(`${message} It still plays as before.`);
    throw new FriendlyError(error instanceof split.SplitError && error.kind === 'memory' ? 'This device ran out of memory while splitting. The song still plays as before.' : 'The song could not be split. It still plays as before.');
  }
}

function cancelled(): Error {
  const e = new Error('Cancelled');
  e.name = 'Cancelled';
  return e;
}

function silent(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i += 7) if (Math.abs(samples[i]) > 0.003) return false;
  return true;
}

/** Plain words for why a file could not be opened as sound. */
export function decodeProblem(file: { name: string; type: string }): string {
  if (PROTECTED_EXT.test(file.name)) {
    return 'That file is copy-protected, so it cannot be opened here. Try a plain MP3, M4A or WAV file.';
  }
  if (file.type.startsWith('video/') || VIDEO_EXT.test(file.name)) {
    return 'The sound in that video could not be read here. Save the sound as an MP3 or M4A file, then add that.';
  }
  if (RARE_EXT.test(file.name)) {
    return `This browser cannot open that kind of sound file. Try ${soundFormatWords()}.`;
  }
  return `That file could not be opened as music. Try an ${soundFormatWords()} recording, a MIDI file or a lesson file.`;
}

/** The track list of a MIDI file, with the suggested hands, for letting the player choose. */
export async function midiTracks(file: Blob) {
  try {
    return readMidiSong(await file.arrayBuffer()).tracks;
  } catch {
    throw new FriendlyError('That MIDI file could not be read.');
  }
}

/** Where the music starts in a recording, in seconds, skipping silence at the beginning. */
export async function findSongStart(file: Blob): Promise<number> {
  const { decodeFile, toModelRate } = await import('./transcribe');
  const { musicStart } = await import('./pipeline');
  let decoded: AudioBuffer;
  try {
    decoded = await decodeFile(file);
  } catch {
    throw new FriendlyError(decodeProblem({ name: file instanceof File ? file.name : '', type: file.type }));
  }
  return musicStart((await toModelRate(decoded)).left);
}

function pick<T extends object, K extends keyof T>(from: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (from[k] !== undefined) out[k] = from[k];
  return out;
}

/** The analysis fields a song stores. */
function songFacts(a: Analysis): Partial<Song> {
  return pick(a, ['bpm', 'beats', 'timeSignature', 'chords']);
}

function contextOf(song: Partial<Song>): ArrangeContext {
  return { beats: song.beats, chords: song.chords, beatsPerBar: song.timeSignature?.beats };
}

async function safeAnalyse(raw: RawNote[]): Promise<Analysis> {
  try {
    return await analyse(raw);
  } catch (error) {
    console.warn('Song analysis failed; the song works without it.', error);
    return {};
  }
}

/**
 * Chords for re-arranging a song made from a recording. Songs added before
 * chords carried a confidence were analysed by an older chord finder (triads
 * only, flickering): their chords are worked out again from the notes kept in
 * `raw`, so changing the level gives them the better chords too.
 */
export function chordsFor(song: Pick<Song, 'raw' | 'chords' | 'beats' | 'timeSignature'>): Song['chords'] {
  const current = song.chords;
  const fresh = current && current.length > 0 && current.every((c) => typeof (c as { confidence?: unknown }).confidence === 'number');
  if (fresh || !song.raw || !song.beats || song.beats.length < 4) return current;
  try {
    const found = findHarmony(
      song.raw.filter((n) => n.part !== 'melody'),
      song.beats,
      { beatsPerBar: song.timeSignature?.beats, melody: song.raw.filter((n) => n.part === 'melody') },
    ).chords;
    return found.length > 0 ? found : current;
  } catch (error) {
    console.warn('Could not work out the chords again; keeping the old ones.', error);
    return current;
  }
}

/** Changes how a recording is simplified, and saves the result. */
export async function rearrange(song: Song, level: Level, library: Library): Promise<Song> {
  if (!song.raw) return song;
  const chords = chordsFor(song);
  const updated = chords ? { ...song, chords } : song;
  const next = { ...updated, level, notes: arrange(song.raw, level, contextOf(updated)) };
  await library.update(next);
  return next;
}

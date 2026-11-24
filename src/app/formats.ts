/**
 * Which sound files this browser (or the iPad/iPhone app) can open. Safari's
 * engine may not decode Ogg files, so the picker and the error advice only
 * offer Ogg and Opus where the engine says it can play them.
 */

/** Anything with `canPlayType`, such as `new Audio()`. Tests pass a fake. */
export interface AudioProbe {
  canPlayType(type: string): string;
}

function defaultProbe(): AudioProbe | null {
  try {
    return typeof Audio === 'function' ? new Audio() : null;
  } catch {
    return null;
  }
}

let cached: { ogg: boolean; opus: boolean } | null = null;

/**
 * Whether Ogg Vorbis and Ogg Opus files can be decoded. Without a way to ask
 * (a worker, a test without a DOM) both count as yes.
 */
export function oggSupport(probe: AudioProbe | null = null): { ogg: boolean; opus: boolean } {
  if (!probe && cached) return cached;
  const p = probe ?? defaultProbe();
  const result = p
    ? { ogg: p.canPlayType('audio/ogg; codecs="vorbis"') !== '', opus: p.canPlayType('audio/ogg; codecs="opus"') !== '' }
    : { ogg: true, opus: true };
  if (!probe) cached = result;
  return result;
}

/** The file picker's accept list: sound, video, MIDI and lesson files, Ogg and Opus only where they play. */
export function acceptList(probe: AudioProbe | null = null): string {
  const { ogg, opus } = oggSupport(probe);
  return ['audio/*', 'video/*', '.mp3', '.m4a', '.aac', '.wav', ogg ? '.ogg' : '', ogg ? '.oga' : '', opus ? '.opus' : '', '.flac', '.webm', '.mp4', '.mid', '.midi', '.json']
    .filter(Boolean)
    .join(',');
}

/** "MP3, M4A, WAV, OGG or FLAC" (without OGG where it does not play). */
export function soundFormatWords(probe: AudioProbe | null = null): string {
  return oggSupport(probe).ogg ? 'MP3, M4A, WAV, OGG or FLAC' : 'MP3, M4A, WAV or FLAC';
}

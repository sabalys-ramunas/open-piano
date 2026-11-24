// Everything that turns audio samples into notes and song facts. Runs inside
// the import worker (and directly in tests); no DOM, no Web Audio.
import type { GraphModel } from '@tensorflow/tfjs-converter';
import { type Analysis, type AudioInput, type Salience, analyseSync } from '../analysis';
import type { RawNote } from '../song';
import { blockLevels, centre, channelSimilarity } from './dsp';
import { extractMelody } from './melody';
import { type Activations, Cancelled, KEYS, MIDI_OFFSET, MODEL_RATE, frameTime, runModel } from './model';
import { decodeNotes } from './notes';

export interface SongAudio {
  /** Left channel (or the only one) at MODEL_RATE. */
  left: Float32Array;
  /** Right channel at MODEL_RATE, when the recording is stereo. */
  right?: Float32Array;
  /**
   * When the song was split: its harmony (the "other" layer plus the bass,
   * without voice and drums), mono at MODEL_RATE. Chords and accompaniment
   * notes are then heard in it; the tune is still traced in the whole
   * recording (measured: see docs/architecture.md, "Song splitting").
   */
  harmony?: Float32Array;
}

export interface Heard {
  /** Notes heard, including the tune marked with part: 'melody'. */
  raw: RawNote[];
  analysis: Analysis;
  /** When the music starts, in seconds: everything before is near silence. */
  startsAt: number;
  /** Whether the tune was taken from the middle of a stereo recording. */
  usedCentre: boolean;
  /** What the note model heard frame by frame (only when asked for: it is large). */
  activations?: Activations;
}

export interface ListenOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  batch?: number;
  /** Also return the frame activations (tests and tools). */
  keepActivations?: boolean;
}

/** Below this, the two channels are different enough for centre extraction to help. */
const STEREO_ENOUGH = 0.97;

export async function listenToSong(model: GraphModel, audio: SongAudio, options: ListenOptions = {}): Promise<Heard> {
  const { signal } = options;
  const progress = options.onProgress ?? (() => {});
  const { left, right, harmony } = audio;
  const mono = right ? mix(left, right) : left;
  const stereo = right !== undefined && channelSimilarity(left, right) < STEREO_ENOUGH;
  const twice = stereo || harmony !== undefined;

  progress(0);
  // Chords and accompaniment: the harmony stem of a split song (no drums or voice), else the whole recording.
  const everything = await runModel(model, harmony ?? mono, {
    signal,
    batch: options.batch,
    onProgress: (f) => progress((twice ? 0.45 : 0.9) * f),
  });
  const heard = decodeNotes(everything);

  // The tune: the middle of a stereo recording, else the whole of it.
  let melodyFrom = everything;
  if (twice) {
    if (signal?.aborted) throw new Cancelled();
    const source = stereo && right ? centre(left, right) : mono;
    progress(0.5);
    melodyFrom = await runModel(model, source, {
      signal,
      batch: options.batch,
      onProgress: (f) => progress(0.5 + 0.4 * f),
    });
  }
  if (signal?.aborted) throw new Cancelled();
  const melody = extractMelody(melodyFrom).map((n): RawNote => ({ ...n, part: 'melody' }));
  progress(0.93);
  const raw = [...heard, ...melody].sort((a, b) => a.start - b.start);
  const analysis = analyseHeard(
    raw,
    { sampleRate: MODEL_RATE, length: mono.length, numberOfChannels: 1, getChannelData: () => mono },
    everything,
  );
  progress(1);
  return { raw, analysis, startsAt: musicStart(mono), usedCentre: stereo, ...(options.keepActivations ? { activations: everything } : {}) };
}

/**
 * Song facts from everything heard (the tune marked with part: 'melody'), the
 * mixed-down audio and, when there, the model's frame activations.
 *
 * For a split song, `raw` (apart from the tune) and `activations` come from
 * the harmony stem, and `audio` (beats) is still the whole recording.
 */
export function analyseHeard(raw: readonly RawNote[], audio?: AudioInput, activations?: Activations): Analysis {
  const melody = raw.filter((n) => n.part === 'melody');
  return analyseSync(
    raw.filter((n) => n.part !== 'melody'),
    audio,
    { melody, salience: activations ? salienceOf(activations) : undefined },
  );
}

/** The model's frame activations in the shape the chord finder reads. */
export function salienceOf(act: Activations): Salience {
  return { frames: act.frames, frameCount: act.frameCount, keys: KEYS, lowest: MIDI_OFFSET, time: frameTime };
}

function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.min(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}

/** First moment the recording rises above near silence (2% of its loudest 50 ms). */
export function musicStart(audio: Float32Array, rate = MODEL_RATE): number {
  const block = Math.round(rate * 0.05);
  const levels = blockLevels(audio, block);
  let peak = 0;
  for (const l of levels) peak = Math.max(peak, l);
  if (peak === 0) return 0;
  const i = levels.findIndex((l) => l > peak * 0.02);
  return i <= 0 ? 0 : Math.max(0, (i * block) / rate - 0.05);
}

// Page side of the song splitter: checks the device can do it, brings the
// recording to 44.1 kHz stereo, runs the split worker and ends it as soon as it
// answers. Loaded on demand (by the import and by "Split this song").
import { OGG_OPUS_TYPE } from './encode';
import type { SplitInfo, SplitReply, SplitRequest } from './worker';

export { SplitterDownloadError, downloadSplitter, forgetSplitter, splitterStored } from './model-store';
export type { SplitInfo };

export interface SplitResult {
  /** The recording without the guitars and keys layer, ready to store. */
  backing: Blob;
  /** The harmony stem (other + bass), mono at 22.05 kHz, for the note model, when asked for. */
  harmony?: Float32Array;
  info: SplitInfo;
}

/** Why a song could not be split: friendly words for the person, and a kind for the code. */
export class SplitError extends Error {
  constructor(
    message: string,
    readonly kind: 'memory' | 'unsupported' | 'failed',
  ) {
    super(message);
    this.name = 'SplitError';
  }
}

/** Devices that report less memory than this (in GB) are not asked to split. */
const MIN_DEVICE_MEMORY = 4;
/** Longer recordings are not split: the worker holds the whole recording at 44.1 kHz (about 21 MB a minute). */
export const SPLIT_MAX_SECONDS = 10 * 60;
/** The worker reports progress at least once per 12 s block; this long without any means it is stuck. */
const STALL_MS = 90_000;

/**
 * Whether this device can split songs at all: workers, WebAssembly, and enough
 * memory where the browser says how much there is (Chrome does, Safari does not).
 */
export function splitSupport(env: { deviceMemory?: number; hasWorker?: boolean; hasWasm?: boolean } = {}): { ok: boolean; reason?: 'memory' | 'unsupported' } {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number });
  const memory = env.deviceMemory ?? nav?.deviceMemory;
  const hasWorker = env.hasWorker ?? typeof Worker !== 'undefined';
  const hasWasm = env.hasWasm ?? typeof WebAssembly !== 'undefined';
  if (!hasWorker || !hasWasm) return { ok: false, reason: 'unsupported' };
  if (typeof memory === 'number' && memory > 0 && memory < MIN_DEVICE_MEMORY) return { ok: false, reason: 'memory' };
  return { ok: true };
}

/** Opus in Ogg when this engine can play it back, otherwise WAV. */
export function backingFormat(): 'opus' | 'wav' {
  try {
    const probe = document.createElement('audio');
    return probe.canPlayType(OGG_OPUS_TYPE) ? 'opus' : 'wav';
  } catch {
    return 'wav';
  }
}

/** Both channels at 44.1 kHz, as fresh arrays the worker can take over. */
export async function toSplitRate(audio: AudioBuffer): Promise<{ left: Float32Array; right: Float32Array }> {
  try {
    if (audio.sampleRate === 44100) {
      const left = audio.getChannelData(0).slice();
      const right = (audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)).slice();
      return { left, right };
    }
    const offline = new OfflineAudioContext(2, Math.ceil(audio.duration * 44100), 44100);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { left: rendered.getChannelData(0).slice(), right: rendered.getChannelData(1).slice() };
  } catch (error) {
    if (error instanceof RangeError) throw new SplitError('This device does not have enough memory to split this song.', 'memory');
    throw error;
  }
}

export interface SplitOptions {
  /** Also return the harmony stem for the note model. */
  stems: boolean;
  /** Skip the WebGPU check and run this way (measurements and tests). */
  prefer?: 'webgpu' | 'wasm';
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/** Splits a decoded recording in a worker. Rejects with a SplitError, or an error named 'Cancelled'. */
export async function splitRecording(audio: AudioBuffer, options: SplitOptions): Promise<SplitResult> {
  const support = splitSupport();
  if (!support.ok) {
    throw new SplitError(
      support.reason === 'memory' ? 'This device does not have enough memory to split songs.' : 'This browser cannot split songs.',
      support.reason ?? 'unsupported',
    );
  }
  if (options.signal?.aborted) throw cancelled();
  if (audio.duration > SPLIT_MAX_SECONDS) throw new SplitError(`Songs longer than ${SPLIT_MAX_SECONDS / 60} minutes are not split.`, 'memory');
  const { left, right } = await toSplitRate(audio);
  const prefer = options.prefer ?? devPreference();
  return runWorker({ type: 'split', left, right, stems: options.stems, format: backingFormat(), ...(prefer ? { prefer } : {}) }, options);
}

/** Development servers only: `localStorage['split:prefer'] = 'wasm'` (or 'webgpu') skips the WebGPU check, for measuring. */
function devPreference(): 'webgpu' | 'wasm' | undefined {
  if (!import.meta.env.DEV) return undefined;
  try {
    const v = localStorage.getItem('split:prefer');
    return v === 'webgpu' || v === 'wasm' ? v : undefined;
  } catch {
    return undefined;
  }
}

function runWorker(request: SplitRequest, options: SplitOptions): Promise<SplitResult> {
  return new Promise<SplitResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new SplitError('This browser cannot split songs.', 'unsupported'));
      return;
    }
    // A worker that stops making progress (a runtime that cannot start its threads, say) is ended,
    // so the import goes on without splitting instead of waiting forever.
    let watchdog = 0;
    const stalled = () => {
      finish();
      console.warn(`Splitting made no progress for ${STALL_MS / 1000} s; stopped.`);
      reject(new SplitError('The song could not be split.', 'failed'));
    };
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(stalled, STALL_MS) as unknown as number;
    };
    alive();
    const finish = () => {
      clearTimeout(watchdog);
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(cancelled());
    };
    options.signal?.addEventListener('abort', abort);
    worker.onmessage = (event: MessageEvent<SplitReply>) => {
      const reply = event.data;
      if (reply.type === 'progress') {
        alive();
        options.onProgress?.(reply.fraction);
        return;
      }
      finish();
      if (reply.type === 'done') {
        const { backing, harmony, info } = reply;
        console.info(
          `Split ${info.type.startsWith('audio/ogg') ? 'to Opus' : 'to WAV'} in ${info.seconds.toFixed(1)} s on ${info.ep}` +
            ` (${info.threads} thread${info.threads === 1 ? '' : 's'}; networks ${info.modelSeconds.toFixed(1)} s, maths ${info.mathSeconds.toFixed(1)} s` +
            `${info.webgpuDifference !== undefined ? `; graphics card against processor: masks differ by ${info.webgpuDifference.toExponential(1)}` : ''}).`,
        );
        resolve({ backing: new Blob([backing.bytes], { type: backing.type }), harmony, info });
      } else if (reply.name === 'Cancelled') {
        reject(cancelled());
      } else {
        console.warn('Splitting failed:', reply.message);
        const memory = /memory|allocation|RangeError|out of bounds/i.test(`${reply.name} ${reply.message}`);
        reject(new SplitError(memory ? 'This device ran out of memory while splitting the song.' : 'The song could not be split.', memory ? 'memory' : 'failed'));
      }
    };
    worker.onerror = (event) => {
      finish();
      console.warn('The split worker stopped.', event.message);
      reject(new SplitError('The song could not be split.', 'failed'));
    };
    try {
      worker.postMessage(request, [request.left.buffer, request.right.buffer]);
    } catch (error) {
      finish();
      reject(error instanceof RangeError ? new SplitError('This device does not have enough memory to split this song.', 'memory') : error);
    }
  });
}

function cancelled(): Error {
  const e = new Error('Cancelled');
  e.name = 'Cancelled';
  return e;
}

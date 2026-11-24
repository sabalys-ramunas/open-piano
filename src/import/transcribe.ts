// Main-thread side of listening to a recording: decode it, bring it to the
// network's sample rate, and hand it to the import worker. Loaded on demand.
import type { BackendName } from './backend';
import { Cancelled, MODEL_RATE } from './shared';
import type { Heard, SongAudio } from './pipeline';
import type { WorkerReply, WorkerRequest } from './worker';

/** Decodes any audio file the browser can play. */
export async function decodeFile(file: Blob): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(bytes);
  } finally {
    void ctx.close();
  }
}

/** Both channels at the network's rate (the browser's own resampler is better than ours). */
export async function toModelRate(decoded: AudioBuffer): Promise<SongAudio> {
  const channels = Math.min(2, decoded.numberOfChannels);
  const offline = new OfflineAudioContext(channels, Math.ceil(decoded.duration * MODEL_RATE), MODEL_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return channels === 2
    ? { left: rendered.getChannelData(0), right: rendered.getChannelData(1) }
    : { left: rendered.getChannelData(0) };
}

export interface ListenResult extends Heard {
  backend: BackendName | 'page';
  speeds: Partial<Record<BackendName, number>>;
  /** Seconds of processing. */
  seconds: number;
}

export interface ListenOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const modelUrl = () => new URL(`${import.meta.env.BASE_URL}model/model.json`, location.href).href;

/**
 * Listens to a recording in a background worker and returns the notes heard.
 * Cancelling stops the worker at once and frees its memory. Falls back to the
 * page itself where workers are unavailable.
 */
export async function listen(audio: SongAudio, options: ListenOptions = {}): Promise<ListenResult> {
  const started = performance.now();
  if (options.signal?.aborted) throw new Cancelled();
  let worker: Worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return listenInPage(audio, options, started);
  }
  return new Promise<ListenResult>((resolve, reject) => {
    let answered = false;
    const finish = () => {
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Cancelled());
    };
    options.signal?.addEventListener('abort', abort);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      answered = true;
      if (reply.type === 'progress') options.onProgress?.(reply.fraction);
      else if (reply.type === 'done') {
        finish();
        resolve({ ...reply.heard, backend: reply.backend, speeds: reply.speeds, seconds: (performance.now() - started) / 1000 });
      } else {
        finish();
        reject(new Error(reply.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      // A worker that never started (old browser, blocked module workers): do the work here instead.
      if (!answered) listenInPage(audio, options, started).then(resolve, reject);
      else reject(new Error(event.message || 'The listening worker stopped.'));
    };
    // Copies, so the caller keeps its audio; the copies move to the worker without another copy.
    const request: WorkerRequest = {
      type: 'listen',
      modelUrl: modelUrl(),
      left: audio.left.slice(),
      right: audio.right?.slice(),
      harmony: audio.harmony?.slice(),
    };
    worker.postMessage(request, [request.left.buffer, ...(request.right ? [request.right.buffer] : []), ...(request.harmony ? [request.harmony.buffer] : [])]);
  });
}

async function listenInPage(audio: SongAudio, options: ListenOptions, started: number): Promise<ListenResult> {
  const [{ loadFastest }, { listenToSong }] = await Promise.all([import('./backend'), import('./pipeline')]);
  const { model, backend, speeds } = await loadFastest(modelUrl());
  try {
    const heard = await listenToSong(model, audio, { onProgress: options.onProgress, signal: options.signal });
    return { ...heard, backend, speeds, seconds: (performance.now() - started) / 1000 };
  } finally {
    model.dispose();
  }
}

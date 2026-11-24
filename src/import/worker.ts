// The import worker: listens to a song away from the page, so the page never freezes.
import './worker-env';
import { type BackendName, loadFastest } from './backend';
import { listenToSong, type Heard } from './pipeline';

export type WorkerRequest = {
  type: 'listen';
  modelUrl: string;
  left: Float32Array;
  right?: Float32Array;
  /** The harmony stem of a split song (see SongAudio). */
  harmony?: Float32Array;
  backend?: BackendName;
};

export type WorkerReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; heard: Heard; backend: BackendName; speeds: Partial<Record<BackendName, number>> }
  | { type: 'error'; message: string };

const post = (reply: WorkerReply) => (self as unknown as Worker).postMessage(reply);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'listen') return;
  try {
    post({ type: 'progress', fraction: 0 });
    const { model, backend, speeds } = await loadFastest(request.modelUrl, request.backend);
    const heard = await listenToSong(
      model,
      { left: request.left, right: request.right, harmony: request.harmony },
      { onProgress: (fraction) => post({ type: 'progress', fraction }), batch: backend === 'webgl' ? 4 : 2 },
    );
    post({ type: 'done', heard, backend, speeds });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

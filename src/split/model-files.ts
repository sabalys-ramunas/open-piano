// Where the song splitter's networks come from. This is the one place to
// change it.
//
// The networks are Deezer's Spleeter 4stems (code and trained models MIT,
// https://github.com/deezer/spleeter), converted to ONNX with fp16 weights by
// Best-Practice on Hugging Face (Apache-2.0). The address is pinned to one
// revision, so the files never change under us; each file's size and SHA-256
// are checked after downloading.
//
// They are not part of the app (about 79 MB): they are downloaded once, when
// someone chooses to split a song, and kept on the device. A copy under
// `models/spleeter-4stems/` next to the app (public/models/ in this repo,
// ignored by git) is used first when it is there, for development, tests and
// anyone hosting the app with the files themselves.

import type { StemName } from './spleeter';

/** Public upstream copy: Hugging Face, pinned revision. */
export const SPLITTER_UPSTREAM = 'https://huggingface.co/Best-Practice/spleeter-4stems-onnx/resolve/486643021f18a4d057d282fff1d11b89a30e9887/';

/** Same-origin copy, relative to the app's base URL. */
export const SPLITTER_LOCAL_PATH = 'models/spleeter-4stems/';

/** Bumped when the files change, so an old cached copy is not used. */
export const SPLITTER_VERSION = 1;

export interface SplitterFile {
  stem: StemName;
  file: string;
  bytes: number;
  sha256: string;
}

export const SPLITTER_FILES: readonly SplitterFile[] = [
  { stem: 'vocals', file: 'vocals.fp16.onnx', bytes: 19_714_141, sha256: 'db47148ab1c52709ce694893f532c91abfe3edc4d46238939570e036a22878ca' },
  { stem: 'drums', file: 'drums.fp16.onnx', bytes: 19_714_140, sha256: '7ae4002e5633634674f74dc3356d5875b0da894d59ce0f60e844bb8f9cb8aa92' },
  { stem: 'bass', file: 'bass.fp16.onnx', bytes: 19_714_139, sha256: 'ba4c4949a27222492cca49859901a873b4b71461dc48c7c5a51f93d31eb11f55' },
  { stem: 'other', file: 'other.fp16.onnx', bytes: 19_714_140, sha256: '3cc59116cb7195946ab9596d8ca25984d09c0f8a70db8cf85d063132f97bc61d' },
];

/** Total download size in bytes (about 79 MB). */
export const SPLITTER_BYTES = SPLITTER_FILES.reduce((sum, f) => sum + f.bytes, 0);

/** "79 MB", for the words on screen. */
export const SPLITTER_MB = Math.round(SPLITTER_BYTES / 1_000_000);

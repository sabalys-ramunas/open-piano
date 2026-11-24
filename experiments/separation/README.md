# Stem separation spike (throwaway)

Tests music source separation running fully in the browser, for the song import. Nothing here is part of the app
build: it has its own `package.json` and `node_modules`, and it changes nothing outside this folder.

**Result in one line:** ship Spleeter (MIT weights) on onnxruntime-web, using WebGPU when it is available and
WASM otherwise. Do not ship Demucs: its author says the weights are "provided only for scientific purposes".

## Run it

```sh
cd experiments/separation
npm install
./fetch-models.sh                      # about 640 MB into models/ (gitignored)
node synth-testmix.mjs 30 testdata     # test song with known stems (see below)
node serve.mjs 5191 --coi              # then open http://127.0.0.1:5191/ ; drop --coi to test without threads
```

On the page: choose a recording, a model and a backend, then press **Split into stems**. When it finishes you can
download each stem as WAV, set a volume per stem, and press **Backing for piano** (mutes other, guitar and piano).
Playback starts only when you press Play.

`models/spleeter5.fp16w.onnx` is not published anywhere. To build it: make a Python 3.12 venv with `tensorflow`,
`torch`, `onnx` and `numpy`. Download and unpack `5stems.tar.gz` from the deezer/spleeter v1.4.0 release, then run
`python -I convert/spleeter_export.py <dir> 5stems models/spleeter5.fp16w.onnx`. The same script built from the
4stems checkpoint matches the published Best-Practice 4stems ONNX to 1.2e-4 (fp32), so the rebuilt U-Net is right.

Measuring:

| Script | What it does |
|---|---|
| `bench.mjs --browser chromium\|webkit --model M --ep wasm\|webgpu --sec 30\|210 [--coi] [--lowmem] [--score]` | Drives the page in Playwright (resolved from the app's `node_modules`), records times and peak RSS, and with `--score` the SDR. Appends to `results/bench.jsonl`. |
| `run-matrix.sh`, `run-matrix2.sh` | The runs behind the numbers below (about 45 min in all). |
| `node-check.mjs M 30` | The same separation code under onnxruntime-node, as a reference. |
| `evaluate.mjs <dir> 30` | SDR and leakage against the true stems. |
| `probe-features.mjs` | WebCodecs, codecs, WebGPU, SharedArrayBuffer and quota in both browsers. |

Chromium is launched with `--mute-audio`. The benchmarks only decode (`OfflineAudioContext`) and never play sound.

## Files

- `src/separate.js`: model registry, Demucs chunking (7.8 s segments, 25% overlap, triangular cross-fade) and Spleeter
  STFT, ratio masks and iSTFT (two channels packed into one complex FFT). Runs unchanged in the worker and in Node.
- `src/worker.js`: module worker that loads onnxruntime-web, downloads the model, runs, posts progress, and supports cancel.
- `src/main.js`, `index.html`: page (decode at 44.1 kHz, worker, progress, Web Audio mixer, WAV download).
- `src/fft.js`, `src/metrics.js`: radix-2 FFT, SDR and leakage.
- `synth-testmix.mjs`: the test song. Speech from macOS `say` (Samantha, plus the "Good News" singing voice) for
  vocals, the app's Salamander piano samples (CC BY 3.0) for keys, a Karplus-Strong strummed "guitar", a synthesized
  bass and drums. 100 bpm, C G Am F. Writes a 16-bit WAV of the mix and float32 ground truth for each stem.
- `convert/spleeter_export.py`: Spleeter TF1 checkpoint to ONNX (4stems or 5stems).
- `results/`: `bench.jsonl` (every run), `bench-summary.txt`, `quality_*.json`, `quality_node_30.txt`, logs.

## Caveats

- Headless Playwright WebKit 27.2 on macOS is not Safari on iPad and not WKWebView. Nothing here ran on an iPad.
- RSS is the browser's whole process tree. For WebKit it also counts WebKit XPC processes that started during
  the run, which could include a WebKit started by someone else on this machine at the same time.
- The test song is partly synthetic. Absolute SDRs are not comparable with MUSDB papers. The Karplus-Strong guitar
  was never put in a guitar stem by any model, so guitar stems could not be judged.

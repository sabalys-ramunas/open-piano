#!/bin/sh
# Runs the measurement matrix used in the memo. Appends to results/bench.jsonl.
# Takes roughly 30-40 minutes on an M1 Pro.
cd "$(dirname "$0")"
run() { echo "== $*"; node bench.mjs "$@" 2>&1 | grep -E '"(error|separateMs|realtimeFactor|rssPeakMb)"'; }
for b in chromium webkit; do
  run --browser $b --model spleeter4 --ep wasm --sec 30 --coi --score
  run --browser $b --model spleeter4 --ep wasm --sec 30
  run --browser $b --model spleeter4 --ep webgpu --sec 30 --coi
  run --browser $b --model spleeter4 --ep wasm --sec 210 --coi
  run --browser $b --model spleeter4 --ep webgpu --sec 210 --coi
  run --browser $b --model htdemucs --ep wasm --sec 30 --coi --score
  run --browser $b --model htdemucs --ep wasm --sec 30 --threads 1
  run --browser $b --model htdemucs --ep webgpu --sec 30 --coi --score
  run --browser $b --model htdemucs --ep webgpu --sec 30
  run --browser $b --model htdemucs --ep wasm --sec 210 --coi
  run --browser $b --model htdemucs --ep webgpu --sec 210 --coi
  run --browser $b --model htdemucs_6s --ep webgpu --sec 30 --coi --score
  run --browser $b --model htdemucs_6s --ep wasm --sec 30 --coi
done

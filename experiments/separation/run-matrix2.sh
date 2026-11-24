#!/bin/sh
# Second pass: Spleeter 5stems, single-thread 3.5 min runs, low-memory sessions.
cd "$(dirname "$0")"
run() { echo "== $*"; node bench.mjs "$@" 2>&1 | grep -E '"(error|separateMs|inferenceMs|realtimeFactor|rssPeakMb)"'; }
for b in chromium webkit; do
  run --browser $b --model spleeter5 --ep wasm --sec 30 --coi --score
  run --browser $b --model spleeter5 --ep webgpu --sec 30 --coi --score
  run --browser $b --model spleeter5 --ep wasm --sec 210 --coi
  run --browser $b --model spleeter5 --ep webgpu --sec 210 --coi
  run --browser $b --model spleeter5 --ep wasm --sec 210
  run --browser $b --model spleeter4 --ep wasm --sec 210
  run --browser $b --model spleeter5 --ep wasm --sec 210 --coi --lowmem
  run --browser $b --model spleeter4 --ep wasm --sec 210 --coi --lowmem
done

#!/bin/sh
# Downloads the model files the spike uses into models/ (about 640 MB in all).
# Spleeter 5stems is not published as ONNX; build it with convert/spleeter_export.py (see README).
set -e
cd "$(dirname "$0")"
mkdir -p models
get() { [ -f "models/$2" ] || curl -fL -o "models/$2" "$1"; }
HF=https://huggingface.co
for s in vocals drums bass other; do get "$HF/Best-Practice/spleeter-4stems-onnx/resolve/main/$s.fp16.onnx" "spleeter4_$s.fp16.onnx"; done
get "$HF/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx" htdemucs_embedded.onnx
get "$HF/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx" htdemucs_6s_kramp.onnx
ls -la models

#!/bin/bash
# SCRATCH: build the theta-method C++ arms. For each theta in the list: copy the worktree's src/cpp, apply theta-cpp-patch.py, em++ with -DPOLE_THETA=<theta> (flags as build-wasm.sh),
# write v2_dsp.{cjs,wasm} to <out>/<theta>/. emsdk 6.0.4 from ~/projects/emsdk (read-only use).
#   build-theta-wasm.sh <worktree> <scratch dir> <out dir> 0.5 0.6 0.75 1.0
set -e
W=$1; S=$2; OUT=$3; shift 3
source ~/projects/emsdk/emsdk_env.sh > /dev/null 2>&1
for TH in "$@"; do
  T=$S/theta-cpp-$TH; rm -rf $T; mkdir -p $T/packages/runtime/src $OUT/$TH
  cp -r $W/packages/runtime/src/cpp $T/packages/runtime/src/cpp
  python3 -I $W/docs/spikes/pole-order2/theta-cpp-patch.py $T
  EXPORTS=$(grep -o "EXPORTED_FUNCTIONS='\[[^']*\]'" $W/packages/runtime/scripts/build-wasm.sh | sed "s/EXPORTED_FUNCTIONS=//")
  em++ -O3 -msimd128 -std=c++17 -DPOLE_THETA=$TH -I"$T/packages/runtime/src/cpp/include" -fwasm-exceptions \
    -sEXPORTED_FUNCTIONS="${EXPORTS//\'/}" \
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","stringToUTF8","UTF8ToString","lengthBytesUTF8","HEAP8","HEAPU8","HEAPF32","HEAPF64","getValue","setValue"]' \
    -sMODULARIZE=1 -sEXPORT_NAME="createV2DspModule" -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 \
    $T/packages/runtime/src/cpp/Engine.cpp $T/packages/runtime/src/cpp/ProgramJson.cpp $T/packages/runtime/src/cpp/GeneratedKernels.cpp $T/packages/runtime/src/cpp/Resample.cpp $T/packages/runtime/src/cpp/V2Exports.cpp \
    -o $OUT/$TH/v2_dsp.cjs 2>&1 | grep -v "warning\|^ *[0-9]* |\|\^\|~" || true
  sha256sum $OUT/$TH/v2_dsp.wasm
done

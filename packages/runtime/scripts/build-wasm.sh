#!/usr/bin/env bash
# Builds the compiled solver console (`v2_dsp.cjs` + `v2_dsp.wasm`) from `src/cpp`.
#
# The wasm is a release artifact of this package: gitignored, written to `src/wasm/` for bun and
# node running from source, then copied to `dist/wasm/` by `bun run build` so the published
# package finds it at the same relative path (`./wasm/v2_dsp.cjs`) as the source tree does.
set -euo pipefail

PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$PKG_ROOT/src/wasm"
mkdir -p "$OUT_DIR"
# Staged inside the output directory so the rename below stays on one filesystem.
STAGE="$(mktemp -d "$OUT_DIR/.v2dsp-stage-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

if ! command -v em++ >/dev/null 2>&1; then
    echo "em++ not found: install emsdk and source emsdk_env.sh first" >&2
    exit 1
fi

echo "Building src/wasm/v2_dsp.cjs and v2_dsp.wasm with em++..."

em++ -O3 -msimd128 -std=c++17 \
    -I"$PKG_ROOT/src/cpp/include" \
    -fwasm-exceptions \
    -sEXPORTED_FUNCTIONS='["_malloc","_free","_v2_engine_create","_v2_engine_destroy","_v2_engine_load_json","_v2_engine_prepare","_v2_engine_reset","_v2_engine_set_control","_v2_engine_get_control","_v2_engine_set_supply","_v2_engine_process_sample","_v2_engine_process_block","_v2_engine_get_input_buffer","_v2_engine_get_output_buffer","_v2_engine_process_internal","_v2_engine_get_last_iteration_count","_v2_engine_get_last_converged","_v2_engine_get_max_iterations","_v2_engine_get_operating_point","_v2_engine_get_state","_v2_engine_get_last_error","_v2_engine_get_schedule_solves","_v2_engine_get_schedule_fallbacks","_v2_engine_get_kernel_solves","_v2_engine_get_repivoted_schedule_blocks","_v2_engine_get_abandoned_schedule_blocks","_v2_engine_get_dropped_schedule_blocks","_v2_engine_get_host_sample_rate","_v2_engine_get_oversample_latency","_v2_resample_prototype_length","_v2_resample_prototype_tap","_v2_testonly_resample_create","_v2_testonly_resample_reset","_v2_testonly_resample_process","_v2_testonly_resample_destroy"]' \
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","stringToUTF8","UTF8ToString","lengthBytesUTF8","HEAP8","HEAPU8","HEAPF32","HEAPF64","getValue","setValue"]' \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="createV2DspModule" \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=67108864 \
    "$PKG_ROOT/src/cpp/Engine.cpp" \
    "$PKG_ROOT/src/cpp/ProgramJson.cpp" \
    "$PKG_ROOT/src/cpp/GeneratedKernels.cpp" \
    "$PKG_ROOT/src/cpp/Resample.cpp" \
    "$PKG_ROOT/src/cpp/V2Exports.cpp" \
    -o "$STAGE/v2_dsp.cjs"

# ATOMIC PUBLISH: em++ writes progressively, so a reader mid-build would see a partial file that
# a browser then caches under a content-addressed URL. `mv` within one filesystem is a rename.
mv -f "$STAGE/v2_dsp.wasm" "$OUT_DIR/v2_dsp.wasm"
mv -f "$STAGE/v2_dsp.cjs" "$OUT_DIR/v2_dsp.cjs"

echo "Build successful: src/wasm/v2_dsp.cjs and v2_dsp.wasm updated (atomic rename)."

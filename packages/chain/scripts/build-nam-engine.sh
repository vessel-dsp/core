#!/usr/bin/env bash
# Rebuild the NAM inference engine as a PLAIN WASM LIBRARY and vendor it into nam-engine/.
#
# Why this exists: the module we shipped before (`web/t3k-wasm-module.*`) is an Emscripten
# *Wasm Audio Worklet* build. It creates and owns its own AudioWorkletProcessor and exposes no
# synchronous inference entry point, so it can only be a sibling node in the Web Audio graph --
# it cannot be called from inside our own worklet's `process()`, which is what the v2 chain's
# `ExternalProcessor` requires. Upstream abandoned that architecture too, and says why: a second
# instantiation on the audio thread triggered a ~500 MB wasm recompile storm in WebKit that
# crossed the iOS Jetsam limit at play time (tab crash).
#
# What this builds instead is upstream's current `nam-engine` target: single-threaded,
# multi-instance, no Web Audio or threading scaffolding, no SharedArrayBuffer and therefore no
# COOP/COEP requirement. Its exports are synchronous C functions -- `nam_createInstance`,
# `nam_loadModel`, `nam_getBuffer`, `nam_process`, `nam_getLoudness`, and the A2/slimmable set --
# which is exactly the shape a chain slot needs.
#
# Requires an activated Emscripten SDK (`source <emsdk>/emsdk_env.sh`). Nothing else: the upstream
# build uses CMake, and this reproduces its flags directly with `em++` so no CMake is needed.
#
# Usage: scripts/build-nam-engine.sh [workdir]
set -euo pipefail

# Pinned, because "latest upstream" is not a reproducible build. Bump deliberately.
NAM_WASM_REV="a6c895049771bacc40c74dfa19369c2ebf75cdb1"   # tone-3000/neural-amp-modeler-wasm
EXPECT_CORE_REV="1f42f88535884450104b8711d7595019afa0495b" # NeuralAmpModelerCore v0.5.4

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-${TMPDIR:-/tmp}/nam-engine-build}"

if ! command -v em++ >/dev/null 2>&1; then
	echo "em++ not found. Install and activate the Emscripten SDK first:" >&2
	echo "  git clone https://github.com/emscripten-core/emsdk && cd emsdk" >&2
	echo "  ./emsdk install latest && ./emsdk activate latest" >&2
	echo "  source ./emsdk_env.sh" >&2
	exit 1
fi

mkdir -p "$WORK"
SRC="$WORK/neural-amp-modeler-wasm"
if [ ! -d "$SRC/.git" ]; then
	git clone https://github.com/tone-3000/neural-amp-modeler-wasm "$SRC"
fi
git -C "$SRC" fetch --depth 1 origin "$NAM_WASM_REV"
git -C "$SRC" checkout -q "$NAM_WASM_REV"
git -C "$SRC" submodule update --init --recursive --depth 1

CORE_REV="$(git -C "$SRC/core" rev-parse HEAD)"
if [ "$CORE_REV" != "$EXPECT_CORE_REV" ]; then
	echo "NeuralAmpModelerCore is at $CORE_REV, expected $EXPECT_CORE_REV." >&2
	echo "Upstream moved its submodule; re-verify the ABI and bump EXPECT_CORE_REV." >&2
	exit 1
fi

cd "$SRC"
# **Recursive**, and this is the one thing that silently breaks the build if you get it wrong.
# `core/NAM/wavenet/` holds model.cpp, a2_fast.cpp and slimmable.cpp -- the architecture
# registrations. A non-recursive glob still links and still runs; every model then fails to load
# with "No config parser registered for architecture: WaveNet", because the registry is empty.
# Upstream's CMakeLists uses GLOB_RECURSE for exactly this reason.
mapfile -t NAM_SOURCES < <(find core/NAM -name '*.cpp' | sort)
echo "Compiling ${#NAM_SOURCES[@]} core sources + nam-engine.cpp"

mkdir -p "$WORK/out"
# Flags transcribed from wasm/CMakeLists.txt at the pinned revision, with ONE deliberate change:
# `-sENVIRONMENT=web,worker` where upstream has `web,worker,node`. Dropping `node` removes the
# glue's `require`/`node:module` paths, and it has to go: bundling the glue into our single-file
# worklet made Vite externalise `node:module` into a SECOND chunk, which an AudioWorkletGlobalScope
# cannot load -- it has no module loader. The engine still runs fine under Bun for
# `scripts/check-nam-engine.ts`, because we always pass `wasmBinary` and never fetch or read a file.
# Keep the rest in step when bumping the pinned revision.
em++ wasm/nam-engine.cpp "${NAM_SOURCES[@]}" \
	-I core -I core/Dependencies/eigen -I core/Dependencies/nlohmann \
	-DNAM_SAMPLE_FLOAT -DEIGEN_STACK_ALLOCATION_LIMIT=0 -DNAM_USE_INLINE_GEMM \
	-std=c++20 -Os -msimd128 -fwasm-exceptions -fvisibility=hidden \
	-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createNamEngine \
	-sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 \
	-sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=512MB -sSTACK_SIZE=4MB \
	-sINCOMING_MODULE_JS_API=wasmBinary,locateFile,instantiateWasm,onRuntimeInitialized,print,printErr \
	-sEXPORTED_FUNCTIONS=_malloc,_free \
	-sEXPORTED_RUNTIME_METHODS=stringToUTF8,lengthBytesUTF8,UTF8ToString,HEAPF32,HEAPU8 \
	-sFILESYSTEM=0 -sDYNAMIC_EXECUTION=0 --no-entry \
	-o "$WORK/out/nam-engine.js"

cp "$WORK/out/nam-engine.js" "$WORK/out/nam-engine.wasm" "$REPO_ROOT/nam-engine/"
chmod 644 "$REPO_ROOT/nam-engine/nam-engine.js" "$REPO_ROOT/nam-engine/nam-engine.wasm"
echo
echo "Vendored into nam-engine/:"
ls -la "$REPO_ROOT/nam-engine/nam-engine.js" "$REPO_ROOT/nam-engine/nam-engine.wasm"
echo
echo "Verify with: bun scripts/check-nam-engine.ts"

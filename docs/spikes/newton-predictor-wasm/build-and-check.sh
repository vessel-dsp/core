#!/bin/bash
# Rebuild the console from the ported sources, record hashes, then run the port-side checks.
cd /home/joseph/projects/VesselDSP/core/newton-iteration-budget
D=docs/spikes/newton-predictor-wasm
source ~/projects/emsdk/emsdk_env.sh > /dev/null 2>&1
echo "command: bun run --cwd packages/runtime build:wasm  (= bash scripts/build-wasm.sh, em++ -O3 -msimd128 -std=c++17 -fwasm-exceptions)" > $D/03-build-port.log
bun run --cwd packages/runtime build:wasm >> $D/03-build-port.log 2>&1; echo "exit $?" >> $D/03-build-port.log
sha256sum packages/runtime/src/wasm/v2_dsp.wasm packages/runtime/src/wasm/v2_dsp.cjs >> $D/03-build-port.log
mkdir -p /tmp/claude-1000/-home-joseph-projects-VesselDSP-core-newton-iteration-budget/b059fa1b-eb2c-449a-aeec-085604df5b29/scratchpad/wasm-port
cp packages/runtime/src/wasm/v2_dsp.* /tmp/claude-1000/-home-joseph-projects-VesselDSP-core-newton-iteration-budget/b059fa1b-eb2c-449a-aeec-085604df5b29/scratchpad/wasm-port/
bun $D/baseline-render.ts --label=port > $D/04-port-render.log 2>&1
bun $D/parity-os.ts --label=post-port > $D/05-parity-post-port.log 2>&1
bun $D/decision-parity.ts --os=1,4 > $D/06-decision-parity.log 2>&1
bun test packages/runtime/tests/v2-wasm-newton-predictor.test.ts packages/runtime/tests/public-surface.test.ts packages/runtime/tests/v2-wasm-oversample.test.ts > $D/07-tests-port.log 2>&1; echo "exit $?" >> $D/07-tests-port.log
echo done > $D/.step2-done

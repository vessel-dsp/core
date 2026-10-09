#!/bin/bash
cd /home/joseph/projects/VesselDSP/core/newton-iteration-budget
D=docs/spikes/newton-predictor-wasm
S=/tmp/claude-1000/-home-joseph-projects-VesselDSP-core-newton-iteration-budget/b059fa1b-eb2c-449a-aeec-085604df5b29/scratchpad
bun test packages/runtime/tests/v2-wasm-newton-predictor.test.ts packages/runtime/tests/public-surface.test.ts packages/runtime/tests/v2-wasm-oversample.test.ts packages/runtime/tests/sparse-pivot-cross-console.test.ts > $D/07-tests-port.log 2>&1; echo "exit $?" >> $D/07-tests-port.log
# TS iterations per host sample for the A column (reference count at the same settings).
sha256sum packages/runtime/src/wasm/v2_dsp.wasm > $D/09-cost.log
bun $D/cost-ab.ts --base=$S/wasm-base --repeats=5 >> $D/09-cost.log 2>&1
echo done > $D/.step5-done

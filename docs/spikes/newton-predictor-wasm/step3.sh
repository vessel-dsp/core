#!/bin/bash
cd /home/joseph/projects/VesselDSP/core/newton-iteration-budget
D=docs/spikes/newton-predictor-wasm
S=/tmp/claude-1000/-home-joseph-projects-VesselDSP-core-newton-iteration-budget/b059fa1b-eb2c-449a-aeec-085604df5b29/scratchpad
bun $D/decision-parity.ts --os=1,4 > $D/06-decision-parity.log 2>&1
bun test packages/runtime/tests/v2-wasm-newton-predictor.test.ts packages/runtime/tests/public-surface.test.ts packages/runtime/tests/v2-wasm-oversample.test.ts packages/runtime/tests/sparse-pivot-cross-console.test.ts > $D/07-tests-port.log 2>&1; echo "exit $?" >> $D/07-tests-port.log
(cd $S/base-1aa0c56 && bun docs/spikes/newton-predictor-wasm/iter-parity-base.ts > /home/joseph/projects/VesselDSP/core/newton-iteration-budget/$D/06b-iter-parity-pre-predictor.log 2>&1)
$D/break-control.sh
echo done > $D/.step3-done

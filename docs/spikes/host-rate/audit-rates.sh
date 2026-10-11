#!/usr/bin/env bash
# Check 5b: every hard-coded rate in the shipped sources, with file:line, from a clone root. Prose and comment-only lines are filtered;
# the classification (scales / default / does not scale) is in the note, written by hand from reading each site.
set -euo pipefail
cd "${1:-.}"
echo "## rate literals (48000 / 48_000 / 44100 / 96000 / 192000) outside comments"
rg -n '48000|48_000|44100|44_100|96000|192000' packages/runtime/src packages/chain/src packages/player/src packages/compiler/src \
  --glob '!*.d.ts' --glob '!**/wasm/**' --glob '!**/part-catalog.ts' | rg -v '^\S+:[0-9]+:\s*(//|\*|/\*)' || true
echo
echo "## C++ engine rate literals"
rg -n '48000|44100' packages/runtime/src/cpp | rg -v '^\S+:[0-9]+:\s*(//|\*|/\*)' || true
echo
echo "## the DC blocker and parameter smoothing (rate enters as a divisor of a Hz or seconds figure)"
rg -n 'DC_BLOCK_HZ|dcPole|alphaSmooth|MODULATION_DC_SECONDS|kModulationDcSeconds|alphaMod|exp\(\(-2\.0 \* M_PI \* 5\.0\)' packages/runtime/src/chain.ts packages/runtime/src/reference-runtime.ts packages/runtime/src/cpp/Engine.cpp
echo
echo "## constants counted in SAMPLES (do not follow the rate)"
rg -n '^(export )?const (TRACK_[A-Z_]+|PITCH_[A-Z_]+|TELEMETRY_INTERVAL_SAMPLES|NEWTON_UNPRODUCTIVE_PROBATION_SAMPLES|DEFAULT_MAX_IR_TAPS) = ' packages/runtime/src packages/player/src | rg -v 'TRACK_SILENCE'
rg -n 'constexpr int32_t (TRACK_[A-Z_]+|PITCH_[A-Z_]+) = ' packages/runtime/src/cpp/Engine.cpp | rg -v 'SILENCE'
echo
echo "## where the worklet takes its rate"
rg -n 'runtime\.prepare\(sampleRate|hostSampleRate: sampleRate|currentSr' packages/runtime/src/worklet/v2-audio-worklet.ts
echo
echo "## the NAM rate check and the IR resample trigger"
rg -n 'SAMPLE_RATE_TOLERANCE_HZ|refusing to run it at the wrong rate|expected >= 0' packages/chain/src/nodes/nam-node.ts
rg -n 'sourceRate !== undefined && this.sourceRate !== this.sampleRate|resampleImpulseResponse\(' packages/chain/src/nodes/ir-node.ts
echo
echo "## the predictor gate (factor-keyed, not dt-keyed)"
rg -n 'this\.oversample > 1' packages/runtime/src/reference-runtime.ts
rg -n 'predictorPass = oversample_ > 1' packages/runtime/src/cpp/Engine.cpp

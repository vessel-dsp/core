#!/bin/bash
# 3(b): THE CHECK CAN FAIL, on one console only. In a scratch COPY of the worktree (never the worktree), break the new pole in ONE console and run opamp-pole-order.test.ts:
#   1. TS only:  the state advance carries 2 d[n] instead of d[n] + d[n-1] (the differential history is dropped from the advance but not from the solve): TS suites red, WASM suites green.
#   2. C++ only: the same mutation in Engine.cpp (wasm rebuilt in the scratch copy): WASM suites red, TS suites green.
# Each mutated file is compared with the original afterwards. Run: break-controls.sh <worktree> <scratch dir> <log dir>
W=$1; S=$2; L=$3; mkdir -p $L
B=$S/brk; rm -rf $B; mkdir -p $B
(cd $W && (git ls-files; git ls-files -o --exclude-standard) | sort -u | grep -v '^docs/public/' | grep -v '^docs/spikes/pole-order2/logs/') > $S/brk-files.txt
rsync -a --files-from=$S/brk-files.txt $W/ $B/
ln -s $S/base/node_modules $B/node_modules
cp -r $W/packages/runtime/src/wasm $B/packages/runtime/src/wasm
TS=$B/packages/runtime/src/reference-runtime.ts; CPP=$B/packages/runtime/src/cpp/Engine.cpp
sha256sum $TS $CPP $B/packages/runtime/src/wasm/v2_dsp.wasm > $L/05-sha-before.txt
cd $B
echo "== clean copy" > $L/05-clean.log; bun test packages/runtime/tests/opamp-pole-order.test.ts >> $L/05-clean.log 2>&1; tail -n 5 $L/05-clean.log
# 1. TS only
python3 - <<PY
p="$TS"; s=open(p).read()
old="weight * stamp.openLoopGain * (differential + previousDifferential) +"
assert s.count(old)==1
open(p,"w").write(s.replace(old,"weight * stamp.openLoopGain * (2 * differential) +"))
PY
echo "== TS-only break" > $L/05-break-ts.log; bun test packages/runtime/tests/opamp-pole-order.test.ts >> $L/05-break-ts.log 2>&1; grep -E "^\(fail\)|pass$|fail$| pass| fail" $L/05-break-ts.log | tail -n 14
cp $W/packages/runtime/src/reference-runtime.ts $TS
# 2. C++ only
python3 - <<PY
p="$CPP"; s=open(p).read()
old="(*weight * stamp.openLoopGain * (differential + prevDifferential) + (1.0 - 2.0 * *weight) * prevRaw)"
assert s.count(old)==1
open(p,"w").write(s.replace(old,"(*weight * stamp.openLoopGain * (2.0 * differential) + (1.0 - 2.0 * *weight) * prevRaw)"))
PY
source ~/projects/emsdk/emsdk_env.sh > /dev/null 2>&1
bun run --cwd packages/runtime build:wasm > $L/05-rebuild-broken-cpp.log 2>&1; tail -n 1 $L/05-rebuild-broken-cpp.log
sha256sum $B/packages/runtime/src/wasm/v2_dsp.wasm > $L/05-sha-broken-wasm.txt
echo "== C++-only break" > $L/05-break-cpp.log; bun test packages/runtime/tests/opamp-pole-order.test.ts >> $L/05-break-cpp.log 2>&1; grep -E "^\(fail\)|pass$|fail$| pass| fail" $L/05-break-cpp.log | tail -n 14
# restore
cp $W/packages/runtime/src/cpp/Engine.cpp $CPP
bun run --cwd packages/runtime build:wasm > $L/05-rebuild-restored.log 2>&1
sha256sum $TS $CPP $B/packages/runtime/src/wasm/v2_dsp.wasm > $L/05-sha-after.txt
echo "== restored" > $L/05-restored.log; bun test packages/runtime/tests/opamp-pole-order.test.ts >> $L/05-restored.log 2>&1; tail -n 4 $L/05-restored.log
diff $L/05-sha-before.txt $L/05-sha-after.txt && echo "sources and wasm byte-identical after restore"

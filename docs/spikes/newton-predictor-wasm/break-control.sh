#!/bin/bash
# Control (c): deliberately break the port (drop the `used > 2` gate), rebuild, show the
# decision-parity counts diverge and the output delta grow, then revert and rebuild to the
# recorded port hash.
cd /home/joseph/projects/VesselDSP/core/newton-iteration-budget
D=docs/spikes/newton-predictor-wasm
source ~/projects/emsdk/emsdk_env.sh > /dev/null 2>&1
E=packages/runtime/src/cpp/Engine.cpp
sha256sum $E > $D/08-break-control.log
grep -c "if (used > 2) {" $E >> $D/08-break-control.log
sed -i 's/    if (used > 2) {\n        best = 0;/XX/' $E
python3 - <<'PY'
p='packages/runtime/src/cpp/Engine.cpp'
s=open(p).read()
old="    if (used > 2) {\n        best = 0;\n    }\n    scratch.predictorOrder = best;"
assert s.count(old)==1
s=s.replace(old,"    if (false) { // CONTROL (c): gate removed on purpose\n        best = 0;\n    }\n    scratch.predictorOrder = best;")
open(p,'w').write(s)
print("gate removed")
PY
bun run --cwd packages/runtime build:wasm >> $D/08-break-control.log 2>&1
echo "broken build:" >> $D/08-break-control.log; sha256sum packages/runtime/src/wasm/v2_dsp.wasm >> $D/08-break-control.log
bun $D/decision-parity.ts --os=1,4 --packet=muff,sd1,ts808,gro100 --samples=2400 > $D/08b-decision-parity-broken.log 2>&1
bun $D/parity-os.ts --label=broken-gate --os=1,4 --packet=muff,sd1,ts808,gro100 > $D/08c-parity-broken.log 2>&1
python3 - <<'PY'
p='packages/runtime/src/cpp/Engine.cpp'
s=open(p).read()
old="    if (false) { // CONTROL (c): gate removed on purpose\n        best = 0;\n    }\n    scratch.predictorOrder = best;"
assert s.count(old)==1
s=s.replace(old,"    if (used > 2) {\n        best = 0;\n    }\n    scratch.predictorOrder = best;")
open(p,'w').write(s)
print("gate restored")
PY
echo "restored source:" >> $D/08-break-control.log; sha256sum $E >> $D/08-break-control.log
bun run --cwd packages/runtime build:wasm >> $D/08-break-control.log 2>&1
echo "restored build:" >> $D/08-break-control.log; sha256sum packages/runtime/src/wasm/v2_dsp.wasm packages/runtime/src/wasm/v2_dsp.cjs >> $D/08-break-control.log
echo done > $D/.step3c-done

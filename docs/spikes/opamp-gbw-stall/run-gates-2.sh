#!/usr/bin/env bash
# The gate runs (G1-G6) on the current tree, after a WASM rebuild. Logs under logs/10-*. Run from the repo root.
set -u
L=docs/spikes/opamp-gbw-stall/logs
H=docs/spikes/opamp-gbw-stall
until grep -q 'wasm exit' $L/12-wasm-build.log 2>/dev/null; do sleep 3; done
echo "build: $(tail -1 $L/12-wasm-build.log)"; sha256sum packages/runtime/src/wasm/v2_dsp.wasm
# G1: the canary, WASM, os1 / os2 / os4, 8 s; TS os1 as well
bun docs/spikes/hotfix-0.4.1/mt2-timeline.ts --console=wasm --os=1 --seconds=8 > $L/14-g1-canary-os1-wasm.log 2>&1 &
bun docs/spikes/hotfix-0.4.1/mt2-timeline.ts --console=wasm --os=2 --seconds=8 > $L/14-g1-canary-os2-wasm.log 2>&1 &
bun docs/spikes/hotfix-0.4.1/mt2-timeline.ts --console=wasm --os=4 --seconds=8 > $L/14-g1-canary-os4-wasm.log 2>&1 &
# G1 bonus: main-equivalent (forced null) os4 on the fixed solver
bun $H/trace-wasm.ts --packet=boss-mt-2 --os=4 --force-gbp=null --stop-after-cap=300 > $L/14-g1-mt2-os4-null-trace.log 2>&1 &
# G2: blue-box detail and the seven documents' parity
bun docs/spikes/opamp-gbw/bluebox-detail.ts --f32-input > $L/14-g2-bluebox-product.log 2>&1
bun docs/spikes/opamp-gbw/bluebox-detail.ts --f32-input --force-gbp=null > $L/14-g2-bluebox-null.log 2>&1
bun docs/spikes/opamp-gbw/parity-moved.ts --slugs=boss-mt-2,mxr-blue-box,electro-harmonix-slapback-echo,boss-od-3,boss-pq-4,boss-ph-1r,boss-dd-3b --out=$L/14-g2-parity-product.json > $L/14-g2-parity-product.log 2>&1
wait
# G3/G6: profile levels at 100 mV and 10 mV
bun $H/profile-levels.ts --out=$L/14-g3-profile-levels-100mV.json > $L/14-g3-profile-levels-100mV.log 2>&1 &
bun $H/profile-levels.ts --amp=0.01 --out=$L/14-g3-profile-levels-10mV.json > $L/14-g3-profile-levels-10mV.log 2>&1 &
# G5: TS-vs-WASM parity on the six profile packets
bun docs/spikes/opamp-gbw/parity-os.ts --label=fixed-samefirst --os=1,2,4 > $L/14-g5-parity-os.log 2>&1 &
# G4: corpus movement (38 documents)
bun docs/spikes/opamp-gbw/movement.ts --stall-ms=20000 --out=$L/14-g4-movement.json > $L/14-g4-movement.log 2>&1 &
wait
python3 $H/levels-compare.py $L/03-profile-levels-product-100mV.json $L/14-g3-profile-levels-100mV.json > $L/14-g3-compare-100mV.log 2>&1
python3 $H/levels-compare.py $L/03-profile-levels-product-10mV.json $L/14-g3-profile-levels-10mV.json > $L/14-g3-compare-10mV.log 2>&1
python3 $H/levels-compare.py $L/03-movement-product.json $L/14-g4-movement.json --bar 0.05 > $L/14-g4-compare.log 2>&1
echo "gates done"

#!/bin/bash
# After the three-way-engine.ts runs finish in both trees: analyse the WAVs with the study's own analyser, build the before/after table sets, run pool.py on each.
S=$1; HERE=$(cd "$(dirname "$0")" && pwd)
python3 -I $HERE/three-way-analyse.py $S/data/tw-base $S/data/tw-base.json
python3 -I $HERE/three-way-analyse.py $S/data/tw-new  $S/data/tw-new.json
python3 -I $HERE/hw-merge.py $S/data/tw-base.json $S/data/tw-new.json $S/data/ng $S/hw
for set in orig-check before after; do (cd $S/hw/$set/hardware-consistency && python3 -I pool.py > $S/hw/pool-$set.txt 2>&1); done
echo collected

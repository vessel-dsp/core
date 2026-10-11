#!/bin/bash
# After the three-way-engine.ts runs finish for the three arms: analyse the WAVs with the study's own analyser, build the table sets, run pool.py on each.
S=$1; HERE=$(cd "$(dirname "$0")" && pwd)
python3 -I $HERE/three-way-analyse.py $S/data/tw-base $S/data/tw-base.json
python3 -I $HERE/three-way-analyse.py $S/data/tw-tr   $S/data/tw-tr.json
BDF2=-; if [ -d $S/data/tw-bdf2 ] && [ "$(ls $S/data/tw-bdf2 | wc -l)" -ge 220 ]; then python3 -I $HERE/three-way-analyse.py $S/data/tw-bdf2 $S/data/tw-bdf2.json; BDF2=$S/data/tw-bdf2.json; fi
python3 -I $HERE/hw-merge.py $S/data/tw-base.json $S/data/tw-tr.json $BDF2 $S/hw
for set in orig-check before after-tr after-bdf2; do [ -d $S/hw/$set ] && (cd $S/hw/$set/hardware-consistency && python3 -I pool.py > $S/hw/pool-$set.txt 2>&1); done
echo collected

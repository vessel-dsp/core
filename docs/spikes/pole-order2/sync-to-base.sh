#!/bin/bash
# Copy the scratch harness and the stage fixture into another tree (the unchanged-main baseline clone, a scratch clone), so the same scripts measure either tree.
#   sync-to-base.sh <tree>
set -e
W=$(cd "$(dirname "$0")/../../.." && pwd); T=$1
mkdir -p "$T/docs/spikes/pole-order2" "$T/packages/runtime/tests"
rsync -a --exclude logs --exclude data --exclude '*.md' "$W/docs/spikes/pole-order2/" "$T/docs/spikes/pole-order2/"
cp "$W/packages/runtime/tests/non-inverting-stage.ts" "$T/packages/runtime/tests/non-inverting-stage.ts"

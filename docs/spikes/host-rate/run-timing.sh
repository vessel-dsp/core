#!/usr/bin/env bash
# The idle-gated timing series, in the order it was run: every script prints and records /proc/loadavg before each run and waits (one 20-minute budget per
# script) for the 1-minute load average to fall below 1.5. Usage: run-timing.sh <clone-root> <data-dir>
set -u
CLONE="${1:?clone root}"; DATA="${2:?data dir}"
export NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules
cd "$CLONE"
stage() { echo "=== $(date -u +%FT%TZ) $1: $(uptime)"; }
stage blocks-wasm;  bun docs/spikes/host-rate/blocks.ts --consoles=wasm --out="$DATA/blocks-wasm.jsonl" --port=8751 > "$DATA/blocks-wasm.log" 2>&1
stage cost-wasm;    bun docs/spikes/host-rate/cost.ts   --consoles=wasm --out="$DATA/cost-wasm.jsonl"   --port=8741 > "$DATA/cost-wasm.log" 2>&1
stage live;         bun docs/spikes/host-rate/live.ts   --out="$DATA/live.jsonl"                       --port=8761 > "$DATA/live.log" 2>&1
stage blocks-ts;    bun docs/spikes/host-rate/blocks.ts --consoles=ts --subjects=divider,muff,sd1,ts9,chain3 --out="$DATA/blocks-ts.jsonl" --port=8752 > "$DATA/blocks-ts.log" 2>&1
stage cost-ts;      bun docs/spikes/host-rate/cost.ts   --consoles=ts --subjects=divider,muff,sd1,ts9,chain3 --out="$DATA/cost-ts.jsonl" --port=8742 > "$DATA/cost-ts.log" 2>&1
stage done

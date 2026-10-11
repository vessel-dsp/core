#!/bin/bash
# Item 5: the fresh-clone gate. Core worktrees nest inside the main checkout and resolve into its stale dist, so the diff is proven in a clean clone:
# git clone the branch, apply the diff (copy the modified + untracked files, which is the diff), then install / typecheck / build:wasm (emsdk 6.0.4) / build /
# test (WASM tests RUN) / build:pages / every pack:dry-run. Logs and exit codes per step in $L. Run: fresh-clone-gate.sh <worktree> <scratch> <logdir>
W=$1; S=$2; L=$3; mkdir -p $L
C=$S/fresh-clone
rm -rf $C
git clone --no-hardlinks -q $W $C || exit 1
cd $W && (git ls-files -m -o --exclude-standard | grep -v '^docs/spikes/opamp-gbw/logs/' | grep -v '^docs/spikes/opamp-gbw/ngspice/' ) > $L/00-diff-files.txt
cd $W && git diff --stat HEAD > $L/00-diff-stat.txt
while read f; do mkdir -p "$C/$(dirname "$f")"; cp -a "$W/$f" "$C/$f"; done < $L/00-diff-files.txt
cd $C && git rev-parse HEAD > $L/00-base-commit.txt && git status --short > $L/00-clone-status.txt
step() { name=$1; shift; echo "== $name: $*" > $L/$name.log; ( "$@" ) >> $L/$name.log 2>&1; echo "exit $?" >> $L/$name.log; tail -1 $L/$name.log; }
source ~/projects/emsdk/emsdk_env.sh > /dev/null 2>&1
em++ --version 2>&1 | head -1 > $L/00-em-version-6.0.4.txt
step 01-install bun install --frozen-lockfile
git diff --quiet -- bun.lock && echo "bun.lock unchanged" >> $L/01-install.log
step 02-typecheck bun run typecheck
step 03-build-wasm bun run --cwd packages/runtime build:wasm
sha256sum packages/runtime/src/wasm/v2_dsp.wasm packages/runtime/src/wasm/v2_dsp.cjs > $L/03-wasm-sha-6.0.4.txt
step 04-build bun run build
step 05-test bun test
step 06-pages bun run build:pages
for p in core stompbox control-ui visual-effects amp cabinet compiler runtime chain player; do step 07-pack-$p bun run --cwd packages/$p pack:dry-run; done
echo done > $L/FRESH-DONE

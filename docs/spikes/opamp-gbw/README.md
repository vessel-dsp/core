# Op-amp gain-bandwidth harness (2026-10-10)

Scratch instruments for `docs/spikes/2026-10-10-opamp-gbw.md`. Nothing here is a test or a shipped script. Every `.ts` file runs under bun from a repository
root (the root `tsconfig.json` maps `@vessel-dsp/*` to `src`, and the WASM console loads `packages/runtime/src/wasm`), so the same file measures whichever tree it is run
from: the worktree, or a clone of unchanged main (`49cc15c`) for the "before" numbers. The corpus is read from `$ARTIFACTS` (default `~/projects/VesselDSP/artifacts`,
checkout `6a5c01bfe`); the study packets and tables from `~/projects/VesselDSP/workbench` (read-only).

| file | what it measures |
|---|---|
| `lib.ts` | corpus listing, compile, renders on both consoles (with stall detection), the probe's harmonic fit, the parity metrics |
| `baseline-render.ts` | check 1 and 2(b)/2(c): x1 and os4 output hashes of muff / sd1 / ts9; `--force-gbp=null|<Hz>` sets every op-amp stamp |
| `sweep.ts` | stepped-sine sweep 100 Hz-16 kHz at os4 / native 192 kHz (the "before" numbers) |
| `analytic-stage.ts`, `be-closed-form.ts`, `be-vs-measured.ts` | control 2(a): the non-inverting stage against the continuous closed form (a-accuracy, failing) and the backward-Euler discrete closed form (a-wire, passing) |
| `corpus-programs.ts`, `corpus-program-diff.ts` | export every corpus program from a tree and prove the new tree's equal main's once the new member is removed |
| `corpus-hash.ts`, `corpus-hash-compare.py` | control 2(c): per-document render hashes in both trees |
| `break-controls.sh` | control 2(d): the check can fail (C++ only, TS only, wrong unit parse); run in a scratch copy |
| `ngspice-deck.ts`, `ngspice/`, `ng-compare.py` | control 2(e): the scratch copy of the workbench deck emitter reading the stamp's product, engine vs deck |
| `parity-os.ts`, `decision-parity.ts` | control 2(f): TS-vs-WASM parity and decision parity (copies of the Newton-predictor port's harness) |
| `three-way-engine.ts`, `three-way-analyse.py`, `hw-merge.py`, `hw-collect.sh`, `hw-table.py` | the hardware consequence: the three-way engine columns through this tree's engine, the study's own analyser, before/after table sets for the study's `pool.py` |
| `rate-scan.ts`, `rate-scan-analyse.py` | scratch-only attribution of the engine's HF change to the product vs the backward-Euler error (native 192 / 384 / 768 kHz) |
| `census.ts`, `list-opamp-entries.ts`, `stamps-of.ts`, `probe-gbp-properties.ts` | the coverage census and the forms a declared GBP arrives in |
| `movement.ts`, `movement-compare.py`, `parity-moved.ts`, `parity-moved-compare.py`, `bluebox-detail.ts`, `follower-stability.ts` | corpus movement and stability |
| `mt2-probe.ts`, `mt2-gbp-scan.ts` | the boss-mt-2 stall (os4 on main; the canary's os1 stall) and a forced-product scan |
| `cost-ab.ts` | WASM cost, baseline binary vs this tree's, interleaved |
| `stale-runtime.ts` | what a 0.4.x runtime does with a program carrying the new field (run in the baseline clone) |
| `fresh-clone-gate.sh` | the fresh-clone gate (clone, apply the diff, install, typecheck, wasm, build, test, pages, pack) |
| `datasheet-gbp-report.md` | the per-datasheet read of the vendored op-amp datasheets (printed rows, pages, cross-checks) |
| `logs/` | the outputs quoted in the note; `logs/data/` the JSON behind them |

The exact commands and outputs are in the note. Baseline numbers come from `git clone --no-hardlinks` of this repo at `49cc15c` built with emsdk 6.0.4 in a scratch directory.

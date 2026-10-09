# core 0.4.1 hotfix harness (2026-10-09)

Scratch instruments for `docs/releases/2026-10-09-release-prep-0.4.1.md`. Nothing here is a test or a shipped
script. Every file runs under bun from a repository root (the root `tsconfig.json` maps `@vessel-dsp/*` to
`src`) **or** from a scratch directory whose `node_modules` holds the published packages (`npm i
@vessel-dsp/runtime@0.3.1 @vessel-dsp/compiler@0.3.0`, scripts copied beside it), so the same file measures
whichever runtime it resolves. The corpus is read from `$ARTIFACTS` (default
`~/projects/VesselDSP/artifacts`, checkout `b9508b71c`, clean).

| file | what it measures |
|---|---|
| `lib.ts` | corpus listing, compile, program fingerprints, the two-tone / 1 kHz stimuli (note `tone(n, hz, amp, offset)`, not the Newton-budget spike's order) |
| `mt2-timeline.ts` | F1: `boss-mt-2` under the scoreboard stimulus, per-second us/sample, every block over 50 ms with its start sample and the predictor telemetry |
| `mt2-seed-timing.ts` | where the predictor's seeds fall relative to the stall onset on the 0.4.0 WASM console |
| `x1-dump.ts`, `x1-compare.ts` | render the corpus (TS and WASM) at any factor and compare two runtimes bit for bit, bucketed like the workbench's F3 table, with the numeric re-pivot attribution |
| `export-programs-release-compiler.ts` | check 7: export the corpus programs with this tree's compiler for `generate-kernels.ts` |
| `os-factor-probe.ts`, `os-factor-join.ts`, `os-factor-identical.ts` | what the predictor buys and moves at every factor, and exact equality of two trees above 1 |
| `toolchain-parity.ts` | two wasm binaries (emsdk 6.0.4 and 3.1.74) in one process on the six profile packets |
| `rule-trace.ts`, `rule-trace-compare.ts`, `solution-compare.ts`, `dm2-corrected-row.ts`, `sweep-table-recheck.ts` | check 4: the Newton-budget table's `boss-dm-2` row against the shipped rule |
| `bluebox-x1.ts` | `mxr-blue-box` TS-vs-WASM at x1 under the parity method, on whichever runtime it resolves |

The exact commands and outputs are in the release note. Predecessor harnesses reused unchanged:
`docs/spikes/newton-predictor-wasm/decision-parity.ts` (decision parity), `docs/spikes/newton-budget/` (the
spike's own `corpus-sweep.ts`, `measure.ts`, scratch loop).

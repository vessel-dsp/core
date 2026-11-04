# Release prep: core 0.19.0 / compiler 0.22.0 / runtime 0.17.0 / chain 0.1.26 / player 0.2.24 (2026-11-04, exact per-stamp sparse-schedule pattern)

**Status: PREPARED (versions final). Publish by tag from main, one tag at a time, in the order below.**
Prepared 2026-11-04 on branch `indiejoseph/release-0220` at `b066d40` (plus this
note): origin main `9da954e` (the 0.21.1 release record) plus two commits, verified in the same clone (control run before any
edit, gates below). Core 0.19.0 unchanged, not tagged; stompbox unchanged.

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.19.0 | 0.19.0 (unchanged) | no change; not tagged |
| compiler | 0.21.1 | 0.22.0 | exact per-stamp audio write sets for the sparse-schedule pattern (`stampPatternCells`, all 31 Stamp kinds; two-direction compiler test); exact core pin stays 0.19.0 |
| runtime | 0.16.2 | 0.17.0 | sources untouched apart from the regenerated table: `GeneratedKernels.cpp` rebuilt wholesale (137 kernels from 556 scheduled blocks) from the programs compiled with 0.22.0; exact compiler pin 0.22.0 (a published version cannot carry a new pin) |
| chain | 0.1.25 | 0.1.26 | exact re-pin (compiler 0.22.0, core 0.19.0, runtime 0.17.0) |
| player | 0.2.23 | 0.2.24 | no source change; exact re-pin (chain 0.1.26, compiler 0.22.0, core 0.19.0, runtime 0.17.0) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin stays 0.19.0 |

## What changed

Two commits on top of origin main `9da954e` (workbench board-p2 row 14), plus the versions/changelog/prep-note commit:

- Compiler (`packages/compiler/src/sparse-schedule.ts`, plus `packages/compiler/tests/sparse-schedule.test.ts`): `schedulePattern` no longer takes the full square over each stamp's terminals. `stampPatternCells` lists, for every Stamp kind, the exact union of (row, column) cells `applyStamp` can write on an audio pass in either console (railed and unrailed op-amp, diode breakdown/series resistance, FET gate junctions, pentode screen share, both flip-flop halves, every clock-driver phase, selector/switch positions, VCA floors, comparator and OTA ground guards, transformer series-resistance diagonal). A cell the stamp can write that is missing from the pattern silently corrupts the kernel, so the rule is superset-or-exact, never a subset; DC-only extras need no cover because both consoles solve the operating point densely.
- Tests: 5 new `sparse-schedule.test.ts` pattern-coverage tests driving all 31 kinds through the reference runtime into a write-tracking matrix over every writable branch, asserting the recorded set equals the hand-derived set and is covered by the pattern, with removal-of-one-cell negative and full-square positive controls.
- Runtime (`packages/runtime/src/cpp/GeneratedKernels.cpp`, regenerated, 137 kernels): rebuilt from the 145 programs exported from a clean artifacts extract at `b9dd49ba1` and compiled with the exact-pattern compiler. Every schedule fingerprint changed with the pattern, so the table is all new content; blocks below the floor and the one structurally singular block stay on the interpreter by construction.

## Evidence

- Control run (clone at origin main `9da954e`, before any edit): `bun install
  --frozen-lockfile` exit 0 (411 packages); wasm built in CI order (emcc on PATH);
  `bun run typecheck` exit 0; `bun run build` exit 0 (`dist entrypoints ok`); root
  `bun test` 2743 pass / 2 fail (both pre-existing
  `tests/appearance/corpus-integration.test.ts` failures -- pedal-block count + CE-2 colour).
- Post-change gates: `bun run typecheck` exit 0; root `bun test`
  **2748 pass / same 2 pre-existing fail** (+5 new `sparse-schedule.test.ts`
  pattern-coverage tests, all pass).
- `git diff <base>..HEAD -- packages/runtime/src packages/runtime/scripts`
  is empty apart from the regenerated `GeneratedKernels.cpp` and its scripts:
  the runtime solver and its scripts are untouched.

## Expected movers (Phase-1 program control)

`diff -rq programs-old programs-new` is expected to differ in 144 of 145 programs
(schedule data changed; exactly one program byte-identical -- named in the phase-1
control). Full tables in the workbench gate record
`thoughts/shared/2026-11-04-sparse-pattern/README.md` (gates 2 and 4):

- Totals: slots 43339 to 34890, factors 18150 to 13448, update ops (op-1)
  49255 to 23476 (-52.3%), unproven pivots 541 to 582 (+41).
- `boss-oc-2` analog:0: slots 1070 to 490, factors 472 to 188, update ops
  2954 to 387 (the 387 target), unproven 14 to 16.
- Owner decision 2026-11-04, accepted as stated in the release note (no
  bit-identity claimed): `boss-hr-2 analog:3` loses its sparse schedule
  (grounded-output op-amp, aux column truly all-zero; the old schedule pivoted
  on phantom cells and the block is planned dense in both arms, audio
  bit-identical) and 33 blocks gain 41 unproven pivots in total (Markowitz
  re-steering under an unchanged eligible set; every order validates at prepare,
  solver-plan 0 fallbacks / 0 abandoned / 0 dropped on pedals and amps, both
  arms). Four rounding-sensitive packets sit outside the maxAbs tolerance band
  with zero silent/plays verdict moves across 145 (`boss-tw-1` and
  `moogerfooger-mf-102` diverge between the two consoles on the unchanged
  program; `mxr-blue-box` is a bistable divider whose C++ console latches the
  other phase from a 5e-12 sample-one difference, TS side 0.015%;
  `boss-dd-3b` 0.7% on wasm only).
- Cost lines (worklet scoreboard, wasm console, budget 20833 ns/sample, local
  emcc 6.0.4 build; the published binary is CI's emcc 3.1.74, which is why
  phase 3 re-measures): `boss-oc-2` 27115 ns/sample 1.30x OVER to 18718
  0.90x REALTIME; `boss-ge-7` 8539 to 7037; `boss-ce-2` 9862 to 9440.

Kernel table control: regenerating `GeneratedKernels.cpp` from the new programs
gives **137 kernels from 556 scheduled blocks** with an **empty diff** against
the committed table. Any churn is a finding: report, do not commit the table,
stop before pushing.

## Checklist

1. Versions and exact pins bumped per the table; core `VERSION`, dist, and the
   release-metadata test move together; CHANGELOG heading added. No tags, no publish.
2. No `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change (runtime sources
   untouched apart from the regenerated table and its scripts).
3. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
4. Nothing loose in `~`; scratch only under `/tmp/release-0220-worker/` and the
   `tmp/release-0220/` tree.
5. **No push.**

## Release record (published 2026-11-04, workbench release-0220 worker)

**Status: PUBLISHED.** Main pushed fast-forward `9da954e` -> `f378eaa`
(no force); four tags pushed one at a time in order, each watched to success
before the next, each confirmed on npm before proceeding. No reruns, no tag
moves, no core tag (core unchanged).

| package | version | tag | publish run | npm time (UTC) |
|---|---|---|---|---|
| compiler | 0.22.0 | `compiler-v0.22.0` | 41871457810 success | 2026-11-04T16:54:23 |
| runtime | 0.17.0 | `runtime-v0.17.0` | 41872309363 success | 2026-11-04T16:59:43 |
| chain | 0.1.26 | `chain-v0.1.26` | 41873157138 success | 2026-11-04T17:03:52 |
| player | 0.2.24 | `player-v0.2.24` | 41873903697 success | 2026-11-04T17:09:42 |

Acceptance in an empty dir (`npm i` all five at the new versions): `npm ls
--all` clean, one copy of each, deduped, no nested older core or compiler.

Published wasm proof: published 0.17.0 `dist/wasm/v2_dsp.wasm` sha256
`9a3819832b7d89df18e516269184fef23e418bd70cce3863c0a95a898a16847a`
(1,607,272 bytes) -- differs from published 0.16.2's `5f9754f1…` (2,283,801
bytes, the interpreter-only table era) and from the sibling worker's local
emcc 6.0.4 build `566003ad…` (CI builds with emcc 3.1.74), as expected for a
wholesale-regenerated kernel table on the CI toolchain.

Phase-1 controls (workbench, logged in the release-0220 report): kernel-table
regen from the clean-extract programs gives 137 kernels / 556 blocks with an
empty diff against the committed table; program control 144 of 145 programs
differ, the byte-identical one being `boss-ps-2`; solver-plan pivot fallbacks
0, abandoned 0, dropped 0 on pedals (108 sparse) and amps (30 sparse), logs
byte-identical to the sibling's gate-2 runs; the two programs differing from
the sibling's dirty-tree exports are fully characterized (`boss-oc-2`
`controls[3]` defaultPosition 0 vs 1; `jim-dunlop-cry-baby-gcb-95` one stamp's
`seriesResistanceOhms` present only in the dirty tree) and neither moves the
kernel table.

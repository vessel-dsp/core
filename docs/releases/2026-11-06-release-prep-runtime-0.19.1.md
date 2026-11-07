# Release prep: core 0.19.0 / compiler 0.22.0 / runtime 0.19.1 / chain 0.1.29 / player 0.2.27 (2026-11-06, exact lever B, bit-identical)

**Status: PREPARED (2026-11-06, on branch `indiejoseph/release-lever-b`; no push, no tags, no publish yet).**
Prepared 2026-11-06 on branch `indiejoseph/release-lever-b`: origin main `6ee8a23`
(the 0.19.0 release record) plus one `git apply --index`'d runtime commit (workbench
board-p2 row 22 lever B) plus the versions/changelog/prep-note commit,
verified in the same fresh clone (control run before any change, gates below).
Owner approval 2026-11-06: "Land B" (lever B only; levers A, C, D NOT landing).
Core 0.19.0 and compiler 0.22.0 unchanged, not tagged; stompbox unchanged.

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.19.0 | 0.19.0 (unchanged) | no change; not tagged |
| compiler | 0.22.0 | 0.22.0 (unchanged) | untouched; not tagged |
| runtime | 0.19.0 | 0.19.1 | exact one-pass convergence check (lever B below), bit-identical; no `Program.h`/`Stamp`/`ProgramJson.cpp` change (runtime patch); exact compiler pin stays 0.22.0 |
| chain | 0.1.28 | 0.1.29 | exact re-pin (compiler 0.22.0, core 0.19.0, runtime 0.19.1) |
| player | 0.2.26 | 0.2.27 | no source change; exact re-pin (chain 0.1.29, compiler 0.22.0, core 0.19.0, runtime 0.19.1) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin stays 0.19.0 |

## What changed

One commit `git apply --index`'d from `~/patches-open/exact-levers/lever-B.patch`
(sha256 `765cc6fcd89d3024932385af0613da4041bea57d875046451c9baf8eb9dc4a78`, 326 lines,
verified before applying; made against `origin/main` = `6ee8a23`), committed as one commit
naming board-p2 row 22 and workbench board row X20, linear history on top of main.

- Lever B (`ff6a7b2` here): one pass for the convergence check (`Engine.cpp` +
  `reference-runtime.ts` mirror). `checkConvergenceAndMaxDelta` and `worstDifferenceIndex`
  (plus `maxAbsDifference` and `withinTolerance` on the eliminated and unconverged paths)
  walked the same unknowns twice per Newton iteration; one `convergencePass` produces the
  identical verdict, max delta and worst index with the identical per-element expressions
  (ties and NaN handling identical; strict `>` first-index tie-break; TS max accumulates
  through the same `Math.max`).

`git diff 6ee8a23..HEAD --stat` touches only `packages/runtime/src/cpp/Engine.cpp` and
`packages/runtime/src/reference-runtime.ts`: no compiler, chain, player, `Program.h`,
`Stamp` or `ProgramJson.cpp` change, so the AOT kernel table and every program are expected
unchanged (the phase-1 kernel-table and program controls confirm).

## Evidence

- Control run (clone at origin main `6ee8a23`, before any edit): `bun install
  --frozen-lockfile` exit 0; wasm built in CI order (local emcc 6.0.4, control
  `src/wasm/v2_dsp.wasm` sha256
  `4b33bd9e0ca48feaeb1e9c977a67bdd5ab35d5a79a552c48128d571ff92248a9` --
  matches the recorded pristine rebuild bit for bit); `bun run typecheck` exit 0;
  `bun run build` exit 0; root `bun test` 2746 pass / 5 fail first run (the 2 documented
  `tests/appearance/corpus-integration.test.ts` failures plus 3 `timed out after 5000ms`
  load flakes at box load 9-15, zero assertion failures; isolated reruns
  `dbx-vca.test.ts` 47/0 and `pipeline.test.ts` 176/0 green), second full run 3 fail
  (same 2 documented + 1 load-flake timeout). EQUAL to the 0.19.0 record's control pattern.
- Post-change (lever B applied): wasm rebuilt in CI order, sha256
  `637b53a00dc8d4213557817eb3c2d92252de03b8f22b3133649a02b6ec8446e6` --
  matches the exact-levers record's certified B-alone hash bit for bit (kernels on);
  `bun run typecheck` exit 0; `bun run build` exit 0; root `bun test` 2746 pass /
  5 fail first run (same 2 documented + load-flake timeouts, zero assertion failures;
  isolated rerun `dbx-vca.test.ts` 47/0 green), second full run 3 fail
  (same 2 documented + 1 load-flake timeout). EQUAL to control.
- `bun test tests/package.test.ts` with the new strings: release-metadata
  heading and the exact-pin guard (the 0.17.1 guard) pass.

## Expected movers (Phase-1 controls)

None. Programs from the unchanged compiler: expected 145/145 byte-identical
(npm 0.22.0 vs clone); kernel-table regeneration expected an empty diff; TS
and WASM renders expected bit-identical 145/145 on both the
published-0.19.0-vs-clone A/B (7a: published 0.19.0 CI emcc 3.1.74 vs clone local
emcc 6.0.4; the record's control-vs-published arm was identical 145/145, so a
difference here is news) and the control-clone-vs-release-clone A/B (7b: same local
toolchain both sides, three arms kernels-on / kernels-off / new-interpreter-vs-control-kernels,
where a single difference is a stop; negative tie-break `>` to `>=` re-run on TS with the
record's 1/145 `moogerfooger-mf-102` expectation and on wasm with the 0/145 expectation).
Iteration counts unchanged, so `report-newton-deadline` peaks must equal the 0.19.0 record's
exactly (OC-2 peak 13 / steady 3.4, AW-2 peak 14 / steady 2.9, 0 cap hits).
Cost on the published binaries is measured after publish (phase 3) and
recorded in the release record below; this note and the tagged commit carry
no unmeasured cost figure.

## Checklist

1. Versions and exact pins bumped per the table; compiler/core pins and the
   release-metadata test move together; CHANGELOG heading added. No tags, no
   publish.
2. No `Program.h`/`Stamp`/`ProgramJson.cpp` change (runtime TS + C++ console change
   only, hence a runtime patch); compiler and core sources untouched.
3. Local core `main` -- NOT TOUCHED (another session's uncommitted edits; all
   core work in the fresh clone `tmp/release-lever-b/core`).
4. Nothing loose in `~` except `~/patches-open/release-lever-b/`; scratch only
   under `/tmp/release-lever-b-worker/` and the `tmp/release-lever-b/` tree.
5. **No push until every phase-1 control holds.**

## Release record (published 2026-11-06, workbench release-lever-b worker)

**Status: PUBLISHED.** Main pushed fast-forward `6ee8a23` -> `535818f`
(no force); three tags pushed one at a time in order, each watched to success
and each version confirmed on npm before the next. No reruns, no tag moves,
no compiler tag (compiler unchanged), no core tag (core unchanged). The repo's
documentation-deploy workflow fails on main pushes -- pre-existing, unrelated
to this release (same failure on the 0.19.0 push).

| package | version | tag | publish run | run completed (UTC) | npm time (UTC) |
|---|---|---|---|---|---|
| runtime | 0.19.1 | `runtime-v0.19.1` | 42312618742 success | 2026-11-06T23:37:40Z | 2026-11-06T23:38:52.852Z |
| chain | 0.1.29 | `chain-v0.1.29` | 42313320780 success | 2026-11-06T23:41:29Z | 2026-11-06T23:42:41.538Z |
| player | 0.2.27 | `player-v0.2.27` | 42313748171 success | 2026-11-06T23:44:51Z | 2026-11-06T23:46:25.397Z |

Acceptance in an empty dir (`npm i` all five at core 0.19.0 / compiler 0.22.0 /
runtime 0.19.1 / chain 0.1.29 / player 0.2.27): `npm ls --all` clean, one copy
of each package, fully deduped.

Published wasm proof: published 0.19.1 `dist/wasm/v2_dsp.wasm` sha256
`de67a3d07bc304c063d545cf06b98c6810edc72e372775e43b3dffa0cb36c596`
(1,599,490 bytes, verified from the `npm pack` tarball itself) -- differs from the
clone's local emcc 6.0.4 build `637b53a0…` (1,605,364 bytes; CI builds with
emcc 3.1.74), as expected for a toolchain difference with no source difference
on that path. Published 0.19.0 for the A/B below: `94548c3d…` (1,600,011 bytes).

Phase-1 controls (workbench, logged in the release-lever-b report): kernel-table
regen empty diff (137 kernels / 556 blocks, 416 below min-ops); program control 145/145
byte-identical (clone vs npm compiler 0.22.0 over the clean `b9dd49ba1`
extract); solver-plan pedals 496 blocks / 108 sparse, amps 61 / 30, fallbacks
0, abandoned 0, dropped 0; A/B 7a (published 0.19.0 `94548c3d…` vs B
`637b53a0…`) and 7b (control `4b33bd9e…` vs B: kernels-on `637b53a0…` vs
control-off `659dd566…` / B-off `54830e0b…` built via the record's build-off.sh,
and cross control-on vs B-off) both consoles: programs 145, TS bit-identical
145/145, WASM bit-identical 145/145, 0 band diffs, 8 both-silent rows per arm;
7c tie-break negative (`>` to `>=`, same-mutation build `6b1393c0…` as the
record): re-run here 0/145 TS and 0/145 WASM (the record reads 1/145 TS
`moogerfooger-mf-102` / 0/145 WASM; discrepancy reported in the workbench
record, not reconciled); wasm parity default 10/10 + OC-2/GE-7/CE-2/TS808
r=1.000000 + mutate caught (r=0.617833, all identical to the 0.19.0 record);
newton-deadline OC-2 peak 13 / steady 3.4, AW-2 peak 14 / steady 2.9, 0 cap
hits (identical to the 0.19.0 record).

Gate 9 (player-proof): NOT PASSED, six runs (coordinator ruling 2026-11-06:
PROCEED on consoleDelta). consoleDelta identical to all digits on every leg in
every run in both arms (buffer 3.01e-8, fuzz 5.22e-8, ir 4.33e-8, nam
2.04e-7, phase90 9.76e-2). tightMax and chooser admissions are load-driven
(refusals at 5391 vs 5547 ns fit; B nam 5.43e-3 exceeds the 0.19.0 record's
3.79e-3 maximum, unexplained beyond the overrun/load note); phase90 passes
its own 4.88e-1 bound in all runs that reach it. Nothing about gate 9 in the
CHANGELOG.

Phase-3 cost on the published binaries (`floor-lever-b.ts`, OC-2, same
clone-compiled program JSON on both arms, medians of 5 interleaved pairs, ns
per host sample at 48 kHz against the 20833 ns/sample real-time budget):
A = published runtime 0.19.0 `94548c3d…`, B = published runtime 0.19.1
`de67a3d…` (both CI emcc 3.1.74; no toolchain confound). Quiet-box protocol
per the 0.19.0 ruling (start-or-end load1 > 2.0, or a foreign process at >=
90% CPU in either top snapshot, names and discards the cell): all six cells
clean on attempt 1, no discards (foreign 8-process python batch ended mid-wait;
loads 1.0-1.9 quoted per cell in `floor-lever-b.log`).

| cell | A pub 0.19.0 | B pub 0.19.1 | B−A |
|---|---|---|---|
| 1x silence | 5031 | 4967 | −1.3% |
| 1x 1 kHz 0.3 V | 15418 | 14434 | −6.4% |
| 2x silence | 11702 (5851/sub) | 11543 (5772/sub) | −1.4% |
| 2x 1 kHz 0.3 V | 25383 | 23682 | −6.7% |
| 4x silence | 23420 (5855/sub) | 23319 (5830/sub) | −0.4% |
| 4x 1 kHz 0.3 V | 36270 | 34485 | −4.9% |

Published 0.19.1 is faster than published 0.19.0 on all six cells
(−0.4..−6.7%); that pair is the headline. 4x is still over the real-time
budget on both inputs (23319 / 34485 ns/host vs 20833) and 2x fits only the
silent input (11543 vs 23682), so no real-time claim is made at 2x or 4x.

Published-binary worklet scoreboard (`--console=wasm`, run from the pinned
workbench; 0.19.1 arm at box load ~15, 0.19.0 arm in the same session at load
~16, both REALTIME): `boss-oc-2: -14.8 dBFS, 15490 ns/sample, 0.74x` vs
published 0.19.0's 16661 (−7.0%); `boss-ge-7: -10.6 dBFS, 8448 ns/sample,
0.41x` vs 9708 (−13.0%); `boss-ce-2: -10.5 dBFS, 9792 ns/sample, 0.47x` vs
8679 (+12.8%, load noise at load 15-16; not the headline, which is the
quiet-box floor above); all REALTIME.

Workbench pin (board row X20): `@vessel-dsp/runtime` 0.19.0 -> 0.19.1 pinned;
typecheck 0 errors; `bun run test` 90/0; wasm parity default 10/10 + OC-2 /
GE-7 / CE-2 / TS808 r=1.000000 + `--mutate` caught (r=0.617833); hardware
ratchet SD-1 −30.1 / TS-9 −30.4 / Fuzz −10.9, all delta 0.0 (self-check
passed, not updated); corpus-ratchet log byte-identical to the 0190 log;
`render:v2` OC-2 (`7df39fa4…`) and mxr-blue-box (`6832e71e…`) WAVs bit-identical
on the published 0.19.0 and 0.19.1 arms. The workbench commit stays on its
branch: merge, website pin and deploy are the owner's moves.

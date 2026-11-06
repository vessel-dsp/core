# Release prep: core 0.19.0 / compiler 0.22.0 / runtime 0.19.0 / chain 0.1.28 / player 0.2.26 (2026-11-05, runtime-cost rows 16/17/20, bit-identical)

**Status: PUBLISHED (2026-11-05, tags pushed one at a time from main in the order below; see the release record at the bottom).**
Prepared 2026-11-05 on branch `indiejoseph/release-0190`: origin main `ec21bec`
(the 0.18.0 release record) plus three `git am`'d runtime commits (workbench
board-p2 rows 16, 17 and 20) plus the versions/changelog/prep-note commit,
verified in the same fresh clone (control run before any change, gates below).
Owner approval 2026-11-05: "releasing rows 16, 17 and 20 as one runtime minor".
Core 0.19.0 and compiler 0.22.0 unchanged, not tagged; stompbox unchanged.

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.19.0 | 0.19.0 (unchanged) | no change; not tagged |
| compiler | 0.22.0 | 0.22.0 (unchanged) | untouched; not tagged |
| runtime | 0.18.0 | 0.19.0 | solve-path cost cut (rows 16 + 17 + 20 below), bit-identical; `Program.h` `SparseSchedule` record fields (runtime minor); exact compiler pin stays 0.22.0 |
| chain | 0.1.27 | 0.1.28 | exact re-pin (compiler 0.22.0, core 0.19.0, runtime 0.19.0) |
| player | 0.2.25 | 0.2.26 | no source change; exact re-pin (chain 0.1.28, compiler 0.22.0, core 0.19.0, runtime 0.19.0) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin stays 0.19.0 |

## What changed

Three commits `git am`'d from the sibling workers' patch bundles (sha256
verified before applying: `~/patches-open/engine-combine/core.patch`
`7dac6fb469fd9342…`, `~/patches-open/stamp-hoists/core.patch`
`46990dfc8335f74a…`), original messages kept, linear history on top of main.
The stamp-hoists patch applies on top of the row-16/17 pair, not on `ec21bec`
alone (against `ec21bec` it lands only with offsets -- the wrong-base trap).

- Row 16 (`3a43902` upstream; `a73875e` here): iteration-0 union copy replaces
  the per-solve dense matrix copy (`Engine.cpp` iterate, `Engine.h`). The
  prepare-computed union of nonlinear + per-sample-linear touched cells is
  restored instead of the full dense matrix+rhs, under
  `canUseSelectiveMatrixCopy` and a `matrixNeedsFullCopy` flag re-armed by
  prepare/reset/control rebuild; every other path keeps the full copy.
- Row 17 (`5f4a5c5` upstream; `5cf8b15` here): per-pivot interpreter records
  for the sparse solve (`runSparseSchedule`, `Program.h`, `ProgramJson.cpp`;
  `SparseOp`/`structuredOps` deleted, `buildSparseRecords()` derives the
  records at schedule load). No Program-format or compiler change; the
  generated-kernel path is untouched.
- Row 20 candidate A (`4664d52` upstream; `b1f895c` here): exact prepare-time
  hoists for the nonlinear stamps (`Engine.cpp` `limitJunctionCore` +
  prepare-filled `BlockScratch` slots + call-site reads + op-amp damping index
  list; `Engine.h` slot declarations). Candidates B and C failed their gates
  and are not in the bundle.

Tree checks after each `git am` (expected values from the patch READMEs):
after the row-16/17 pair `HEAD^{tree}` = `6fc932fe2f3430bc34f267f7920d2225af7dd995`;
after row 20 `HEAD^{tree}` = `9dacca72898404fc6aeba1bff0c2842ebf510301`. Both match.

`git diff ec21bec..HEAD --stat` touches only `packages/runtime/src/cpp/`
(`Engine.cpp`, `ProgramJson.cpp`, `include/v2/Engine.h`,
`include/v2/Program.h`): no compiler, chain, player or TS change, so the AOT
kernel table and every program are expected unchanged (the phase-1
kernel-table and program controls confirm).

## Evidence

- Control run (clone at origin main `ec21bec`, before any edit): `bun install
  --frozen-lockfile` exit 0; wasm built in CI order (emcc on PATH, local
  emcc 6.0.4, control `src/wasm/v2_dsp.wasm` sha256
  `e486c911727c589b3129efcc5c3aefd8a48a0671ffebeedee578d6bcf9c33edf` --
  matches the certified control hash of the row-16/17/19/20 records bit for
  bit); `bun run typecheck` exit 0; `bun run build` exit 0; root `bun test`
  2745 pass / 6 fail (the 2 documented
  `tests/appearance/corpus-integration.test.ts` failures -- pedal-block count
  + CE-2 colour -- plus 4 `timed out after 5000ms` load flakes at box load
  8-10, zero assertion failures; quiet rerun of the three affected files
  green, see the release-0190 workbench report).
- Post-change (rows 16+17+20 applied): wasm rebuilt in CI order, sha256
  `4b33bd9e0ca48feaeb1e9c977a67bdd5ab35d5a79a552c48128d571ff92248a9` --
  matches the row-20 record's certified final hash bit for bit; `bun run
  typecheck` exit 0; `bun run build` exit 0; root `bun test` 2748 pass /
  3 fail (the same 2 documented + 1 load-flake timeout, zero assertion
  failures; quiet rerun green). EQUAL to control.
- `bun test tests/package.test.ts` with the new strings: release-metadata
  heading and the exact-pin guard (the 0.17.1 guard) pass.

## Expected movers (Phase-1 controls)

None. Programs from the unchanged compiler: expected 145/145 byte-identical
(npm 0.22.0 vs clone); kernel-table regeneration expected an empty diff; TS
and WASM renders expected bit-identical 145/145 on both the
published-0.18.0-vs-clone A/B (grading any last-bit toolchain difference
against the Newton tolerance band, reported per packet) and the
control-clone-vs-release-clone A/B (same local toolchain both sides, where a
single difference is a stop). Iteration counts unchanged, so
`report-newton-deadline` peaks must equal the 0.18.0 record's exactly.
Cost on the published binaries is measured after publish (phase 3) and
recorded in the release record below; this note and the tagged commit carry
no unmeasured cost figure.

## Checklist

1. Versions and exact pins bumped per the table; compiler/core pins and the
   release-metadata test move together; CHANGELOG heading added. No tags, no
   publish.
2. `Program.h` changes in the runtime C++ only (runtime minor); compiler and
   core sources untouched; no TS console change (`reference-runtime.ts`
   untouched by all three commits).
3. Local core `main` -- NOT TOUCHED (another session's uncommitted edits; all
   core work in the fresh clone `tmp/release-0190/core`).
4. Nothing loose in `~` except `~/patches-open/release-0190/`; scratch only
   under `/tmp/release-0190-worker/` and the `tmp/release-0190/` tree.
5. **No push until every phase-1 control holds.**

## Release record (published 2026-11-05, workbench release-0190 worker)

**Status: PUBLISHED.** Main pushed fast-forward `ec21bec` -> `233e332`
(no force); three tags pushed one at a time in order, each watched to success
before the next, each confirmed on npm before proceeding. No reruns, no tag
moves, no compiler tag (compiler unchanged), no core tag (core unchanged). The
repo's documentation-deploy workflow fails on main pushes -- pre-existing,
unrelated to this release.

| package | version | tag | publish run | npm time (UTC) |
|---|---|---|---|---|
| runtime | 0.19.0 | `runtime-v0.19.0` | 42114192434 success | 2026-11-05T21:43:52.361Z |
| chain | 0.1.28 | `chain-v0.1.28` | 42115340456 success | 2026-11-05T21:50:40.662Z |
| player | 0.2.26 | `player-v0.2.26` | 42116914677 success | 2026-11-05T21:58:34.234Z |

Acceptance in an empty dir (`npm i` all five at the new versions): `npm ls
--all` clean, one copy of each package, fully deduped.

Published wasm proof: published 0.19.0 `dist/wasm/v2_dsp.wasm` sha256
`94548c3d0c641d5d4e728061f635fb3453ac49bde3a0ac5452bbf02d792c5a30`
(1,600,011 bytes, verified from the npm tarball itself) -- differs from the
clone's local emcc 6.0.4 build `4b33bd9e…` (1,605,364 bytes; CI builds with
emcc 3.1.74), as expected for a toolchain difference with no source difference
on that path.

Phase-1 controls (workbench, logged in the release-0190 report): kernel-table
regen empty diff (137 kernels / 556 blocks); program control 145/145
byte-identical (clone vs npm compiler 0.22.0 over the clean `b9dd49ba1`
extract); solver-plan pedals 496 blocks / 108 sparse, amps 61 / 30, fallbacks
0, abandoned 0, dropped 0; A/B 7a (published 0.18.0 `aae2fcd1…` vs patched
`4b33bd9e…`) and 7b (control `e486c911…` vs patched) both consoles: programs
145, TS bit-identical 145/145, WASM bit-identical 145/145, 0 band diffs, 8
both-silent rows per arm; wasm parity default 10/10 + OC-2/GE-7/CE-2/TS808
r=1.000000 + mutate caught (r=0.617833); newton-deadline OC-2 peak 13 /
steady 3.4, AW-2 peak 14 / steady 2.9, 0 cap hits (identical to the 0.18.0
record).

Gate 9 (player-proof, new in this release spec): player-proof FAILS on the
patched clone and identically on the `ec21bec` control; consoleDelta <= 2e-7
(3.01e-8..2.04e-7 per leg, identical across all four runs below);
pre-existing harness-vs-player drift, not caused by rows 16/17/20; triage
separately. Four gated legs over the 2e-3 tightMax bound, patched / control:
buffer-pedal 2.94e-3 / 2.91e-3, fuzz-pedal 4.03e-3 / 4.03e-3, buffer-plus-ir
2.82e-3 / 2.82e-3, buffer-plus-nam 3.79e-3 / 3.79e-3. phase90-pedal passed
its vsTs bound on the patched build (vsTsMax 6.68e-2 <= 4.88e-1; its
console-vs-console delta 9.76e-2 is identical in every run and is what scales
that leg's loose bound) and was chooser-refused on the control build
(8437 ns -- the chooser's fit measurement is load-sensitive and the control
run started at box 5-min load 4.91). Oracle scale 1.0000 and refPeak agreement
on every ran leg; chromium 149.0.7827.55, playwright-core 1.61.0 both trees.
Coordinator ruling 2026-11-05 after reading both logs: proceed.
Published-wasm repeat (ruling condition): ran legs match the local-build
control within 0.03e-3 (2.93/4.00/3.77e-3 vs 2.91/4.03/3.79e-3) with oracle
scale 1.0000, refPeak agreement and consoleDelta unchanged; buffer-plus-ir
(4062+2148) and phase90-pedal (6797) were chooser-REFUSED over the 5208
ns/sample budget and the ran legs carried nonzero overruns (3/0/5). The same
refusals and nonzero overruns appear on a published-0.18.0 repeat minutes
later (ir 3984+1953, phase90 6250, overruns 1/0/3), and 0.18.0 does not
contain rows 16/17/20, which attributes both symptoms to the published CI
binaries' chooser/CPU overhead on this box rather than to the rows; local
builds of the same sources showed the same tightMax drift with far fewer
overruns (buffer/fuzz/ir/nam 0/0/1/0 patched, 0/0/1/2 control). The toolchain magnitude behind that
attribution -- previously quoted as an inference ("emcc 3.1.74 20-30% slower
than local 6.0.4", from single-shot chooser numbers) and flagged as unmeasured
by the ruling -- is measured by the three-arm floor below: C−B −4.6..−9.9% per
cell. Coordinator ruling 2026-11-05 after reading the repeat: proceed to
phase 3, with the headline cost restricted to published-vs-published, the
quiet-box protocol on every timed cell, and both phase-3 tables carried into
the worker report. Nothing about the browser proof goes in the CHANGELOG.

Phase-3 cost on the published binaries (`floor-published.ts`, OC-2, same
clone-compiled program JSON on every arm, medians of 5 interleaved triples, ns
per host sample at 48 kHz against the 20833 ns/sample real-time budget):
A = published runtime 0.18.0 `aae2fcd1…`, B = published runtime 0.19.0
`94548c3d…`, C = local emcc 6.0.4 build `4b33bd9e…` (toolchain arm, never the
shipped cost). Box state quoted per cell (START/END uptime, loadavg, top-CPU
snapshots); the first pass discarded and named three cells in
`floor-published.log` under a running-tasks proxy stricter than the ruling's
criterion (loads 1.4-1.7, only residents and the harness's own bun in the top
snapshots); they were rerun fresh under the ruling-aligned criterion
(start-or-end load1 > 2.0, or a foreign process at >= 90% CPU in either top
snapshot) and came back clean on attempt 1 (`floor-published-rerun.log`). The
three cells that passed the first pass also satisfy the aligned criterion
(their only >= 90% process is the harness's own bun).

| cell | A pub 0.18.0 | B pub 0.19.0 | B−A | C local 6.0.4 | C−B |
|---|---|---|---|---|---|
| 1x silence | 6805 | 4933 | −27.5% | 4537 | −8.0% |
| 1x 1 kHz 0.3 V | 19936 | 15324 | −23.1% | 14624 | −4.6% |
| 2x silence | 16087 | 12059 | −25.0% | 10866 | −9.9% |
| 2x 1 kHz 0.3 V | 30781 | 25334 | −17.7% | 23939 | −5.5% |
| 4x silence | 31278 | 23575 | −24.6% | 21786 | −7.6% |
| 4x 1 kHz 0.3 V | 45971 | 36388 | −20.8% | 34169 | −6.1% |

Published 0.19.0 is faster than published 0.18.0 on all six cells
(−17.7..−27.5%); that pair is the headline. 4x is still over the real-time
budget on both inputs (23575 / 36388 ns/host vs 20833) and 2x fits only the
silent input (12059 vs 25334), so no real-time claim is made at 2x or 4x. The
toolchain arm measures the local emcc 6.0.4 binary 4.6..9.9% faster than the
CI emcc 3.1.74 binary per cell.

Published-binary worklet scoreboard (`--console=wasm`, run from the pinned
workbench, budget 20833 ns/sample, box loads 1.53-1.57 quoted in the logs):
`boss-oc-2 (pedal): -14.8 dBFS (settled 1.5s), 11094 ns/sample, 0.53x RT
steady (0.53x whole-render)` vs published 0.18.0's 13685 (−18.9%);
`boss-ge-7: -10.6 dBFS, 4852 ns/sample, 0.23x (0.24x)` vs 6269 (−22.6%);
`boss-ce-2: -10.5 dBFS, 6164 ns/sample, 0.30x (0.30x)` vs 9519 (−35.2%); all
REALTIME.

Workbench pin (board row X19): `@vessel-dsp/runtime` 0.18.0 -> 0.19.0 pinned
in the release-0190 worktree; typecheck 0 errors; `bun run test` 90/0; wasm
parity default 10/10 + OC-2 / GE-7 / CE-2 / TS808 r=1.000000 + `--mutate`
caught (r=0.617833); newton-deadline OC-2 peak 13 / steady 3.4, AW-2 peak 14
/ steady 2.9, 0 cap hits; hardware ratchet SD-1 −30.1 / TS-9 −30.4 / Fuzz
−10.9, all delta 0.0 (self-check passed, not updated); corpus-ratchet log
byte-identical to the 0180 log; `render:v2` OC-2 and mxr-blue-box WAVs
bit-identical on the published 0.18.0 and 0.19.0 arms. The workbench commit
stays on its branch: merge, website pin and deploy are the owner's moves.

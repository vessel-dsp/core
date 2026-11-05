# Release prep: core 0.19.0 / compiler 0.22.0 / runtime 0.19.0 / chain 0.1.28 / player 0.2.26 (2026-11-05, runtime-cost rows 16/17/20, bit-identical)

**Status: PREPARED (versions final). Publish by tag from main, one tag at a time, in the order below.**
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

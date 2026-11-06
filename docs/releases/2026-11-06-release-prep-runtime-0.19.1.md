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

## Release record (PREPARED; flips to PUBLISHED after phase 2 + phase 3)

**Status: PREPARED.** Main not yet pushed; no tags pushed; nothing on npm yet.
The tagged commit carries no cost number not measured on the published pair:
the Phase-3 cost sentence lands in the CHANGELOG only in the record commit after
Phase 3 measures it.

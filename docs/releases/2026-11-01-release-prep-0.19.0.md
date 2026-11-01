# Release prep: core 0.18.0 / compiler 0.19.0 / runtime 0.16.0 / chain 0.1.23 / player 0.2.21 (2026-11-01, taper table + fet body diode)

**Status: PUSHED, NOT TAGGED.** Pushed 2026-11-01 to origin main as `07377ac`
(fast-forward from `69f6c2a`). Prepared 2026-11-01 on branch
`indiejoseph/core-release-0190` at the prep commit `766128a` (see report):
main `3a266f1` plus this prep. Built and verified in the release clone. Do not tag from any
other state. Publication order is `v0.18.0`, then `compiler-v0.19.0`,
`runtime-v0.16.0`, `chain-v0.1.23`, `player-v0.2.21` (core first: the compiler
pins it exactly). No push, no tags, no publish; local core main untouched
(another session has uncommitted work there).

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.17.1 | 0.18.0 | new format surface: `TaperTable` property (`TAPER_TABLE_PROPERTY_KEY`, `taperTableFieldsOf`, ...), `VERSION` to 0.18.0 |
| compiler | 0.18.1 | 0.19.0 | Program/stamp change: body-diode fields in the fet stamp, taper table in the pot law; exact core pin 0.18.0 (this also fixes the website player import break: the 0.17.1 pin lacked the taper export) |
| runtime | 0.15.1 | 0.16.0 | `Program.h`/stamp-union change; exact compiler pin 0.19.0; kernel table regenerated |
| chain | 0.1.22 | 0.1.23 | exact re-pin (compiler 0.19.0, core 0.18.0, runtime 0.16.0) |
| player | 0.2.20 | 0.2.21 | exact re-pin (chain 0.1.23, compiler 0.19.0, core 0.18.0, runtime 0.16.0) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin moves to 0.18.0 (the pin-guard test requires it); not tagged, not published |

## What changed

Two merges since the published 0.18.1 set (`69f6c2a`), both already on main
`3a266f1`, no code change in this prep:

- Row 25 (`53edbb3`): measured pot-taper table on a control through format,
  compiler and both consoles (new typed `TaperTable` format property).
- Row 27 (`3a266f1`): MOSFET body diode inside the fet law, both consoles,
  with cited defaults.

Measured 2026-11-01 (this prep, A = published 0.18.1 compiler over
`schematics/vessel-dsp`, B = this prep head over `git archive HEAD` =
`da97fc07b`, in-tree resolution so both arms use their own compiler; the
`/tmp`-script cache pitfall from the merge-check was avoided): exactly 3
program movers, zero status movers -- `boss-bf-3` (program text only),
`fulltone-ocd-v1.4`, `mxr-carbon-copy` (see Evidence). Zero taper-table movers:
no filed packet declares a taper table.

## Evidence

Kernel table: regenerated from scratch with the release compiler over the
committed HEAD corpus (`git archive` of artifacts `da97fc07b`, 124 pedals +
23 amps, `examples/` excluded): 138 kernels from 557 scheduled blocks
(416 below the 64-op floor). The release table is byte-identical to a control
regen with the published 0.18.1 compiler over the same corpus (138 kernels,
557 blocks) -- i.e. **the compiler moves no kernel**: the three MOSFET movers'
changed blocks all sit below the 64-op floor on the interpreter. Against the
committed 0.18.0 table the diff is two fingerprints out, one in: out
`0x63ec0fb5` (boss-oc-2's older schedule) and `0x80e7ceac` (stale, owner
unknown from available data -- no live program uses it); in `0x3c71d0ec`
(filed boss-oc-2 at `da97fc07b`, 18792-op schedule, present under BOTH
compilers). That churn is artifacts source drift since the 0.18.0 table build
(filed oc-2 re-trace revisions), not compiler churn; dropping stale kernels is
safe (a miss degrades to the interpreter, never to a wrong answer). lm-2
(`0x2cc049fd`) and cs-3 (`0xcbc73add`) kernels carry over unchanged.
Procedure: throwaway workbench at `09a6c46d`, its
`node_modules/@vessel-dsp/{compiler,core,runtime}` replaced by symlinks to
this prep's built packages (restored afterwards with `bun install`),
`generate-all-catalogs.ts --artifact-root=<clean extract>`,
`export-programs.ts --out=<programs>` (145 programs), `generate-kernels.ts
--programs=<programs>`, wasm rebuilt.

Wasm fingerprints (local emsdk build): pre-table build at `3a266f1`
`e1f5fa2c6253ea5cd92d8c20d55661f41493787d037b4ff30282e91add825c5a`
(identical to the merge-check NEW build -- same sources); release build with
the regenerated table
`d8ed56447768b0eb36aac1c2cd770e28aa319723474fbb1e9adf55017b57e7c8`
(src and dist agree; the table IS linked in -- `0x3c71d0ec` present,
`0x63ec0fb5`/`0x80e7ceac` absent). CI emcc 3.1.74 differs from local; expect
a different hash from the published wasm, as in previous releases.

### Program movers A/B (A = published 0.18.1, B = prep head, same clean corpus)

Per-program sha256 over `emit(program).text`, in-tree `compile(text,
{registry: pedalPartCatalog})`: 159 files digested, exactly 3 differ, zero
refusal changes:

| packet | A | B |
|---|---|---|
| boss-bf-3 | `eebb1c22...` | `28ec2cf9...` (program text only; audio bit-identical both consoles both drives -- switch fully on/off) |
| fulltone-ocd-v1.4 | `48e016bd...` | `b28dae9a...` |
| mxr-carbon-copy | `49fcaba4...` | `8ffa9f77...` |

boss-oc-2 byte-identical both arms (`d7f5a0c9...`, matching the 0.18.1 prep's
`d7f5a0c98ef834bb` prefix). Audio magnitudes per the merge-check (quoted,
not re-measured here): OCD 3.46e-1 / carbon-copy 4.18e-12 at drive 1.0, OCD
1.54e-1 at drive 0.1; 8 WASM-silent both arms, no silence transition.

### Clone verification (this prep)

- `bun install --frozen-lockfile` exit 0 (411 packages); `build:wasm` exit 0;
  `bun run typecheck` exit 0 (root + all packages); `bun run build` exit 0,
  `dist entrypoints ok`.
- Root `bun test`: **2706 pass / 2 fail** (171 files). The 2 failures are both
  in `tests/appearance/corpus-integration.test.ts` (CE-2 blue `#5ca8d4` vs
  `#59B1E6` + the 121-block parse gate) and are PRE-EXISTING on main: a
  pristine clone at `3a266f1` fails the same 2 tests (7 pass / 2 fail on the
  file). Per coordinator verification, those tests read the canonical
  artifacts checkout (default `../../../artifacts`, dirty at
  `da97fc07b` + CHANGELOG/boss-oc-2 edits), so they assert drifted corpus
  data -- unreachable by any prep file (prep touches versions, pins,
  VERSION, changelog/test metadata, kernel table). Publish CI
  (`publish.yml`) packs and publishes per package and does not run the root
  suite. Finding recorded, not a fix (out of scope: no engine change beyond
  the named files). Release content itself is green, see below.
- `bun run --cwd packages/player typecheck` exit 0.
- `packages/player/scripts/player-proof.ts` (NODE_PATH = workbench
  node_modules for playwright-core): FAIL on timing legs only, under box load
  11.9 on 12 cores (other agents' jobs) -- fuzz-pedal `newOverruns=1`,
  buffer-plus-nam `newOverruns=5`, phase90 admission-refused on measured
  11094 ns; oracle scales 1.0000 throughout, consoleDelta 4.33e-8 / 2.04e-7
  (audio matches the reference tightly). No functional failure; rerun when
  the box is quiet. The 0.18.1 prep passed this with 0 new overruns on a
  quieter box.
- TS-vs-WASM parity from the workbench (symlinked release packages, release
  wasm `d8ed5644` staged at `src/web/public/v2_dsp.wasm`, restored
  afterwards): default 10/10 PASS, plus `fulltone-ocd-v1.4`, `mxr-carbon-copy`,
  `boss-bf-3` all PASS (ratchet clean, no recorded failures).
- `report:fixture-parity --self-check` (workbench, release arms): SELF-CHECK
  PASS (exit 0).
- Fresh-clone verification of the prep commit `766128a` (clone of the
  release clone, checkout the prep commit, outside any worktree nesting):
  `bun install --frozen-lockfile` PASS (411 packages -- the check that failed
  for `compiler-v0.17.1`); `build:wasm` then root `bun run build` PASS, `dist
  entrypoints ok`; `bun run typecheck` PASS. Root `bun test`: 2702-2703 pass
  / 5-6 fail across repeated full runs (171 files) -- the 2 appearance
  failures above plus load-timeout flakes that come and go between runs
  (Belton BTDR-2H brick level test: bun 5000 ms timeout at 5.4-8.2 s under
  box load ~11-12; reproduced on the release clone under the same load after
  passing there earlier; dbx-vca session-sweep files pass in isolation 47/0).
  No new failure attributable to the prep: the same tree passes everything
  but the 2 pre-existing appearance tests when the box is quieter. The
  scratch clone was removed after verification.

## Checklist

1. npm holds core 0.17.1 and the last published set (compiler 0.18.1, runtime
   0.15.1, chain 0.1.22, player 0.2.20) -- verified at publish time (phase 2
   preconditions). `publish.yml` tag patterns and dependencies-published gates
   unchanged (no workflow edits in this prep). PASS by inspection.
2. This clone: install/wasm/typecheck/build all exit 0. PASS.
3. `git diff 3a266f1..HEAD --stat` touches only the six package manifests,
   `packages/core/src/index.ts` (VERSION), `tests/package.test.ts`,
   `CHANGELOG.md`, `docs/releases/2026-11-01-release-prep-0.19.0.md` and
   `packages/runtime/src/cpp/GeneratedKernels.cpp`. No `Program`/`Stamp`
   source change (that shipped on main); the exact-pin guard test passes
   unedited. PASS.
4. 145 programs exported with the release compiler over HEAD artifacts; 145
   compile, same 2 refused as the 0.18.1 arm. Kernel regen: 138 kernels, zero
   compiler-attributed churn (byte-identical to the 0.18.1 control regen).
   PASS.
5. Corpus A/B: exactly the 3 predicted movers, zero warning-code or status
   changes beyond the predicted `fet-law-default-parameters` 18-to-20 census
   shift (merge-check). No unattributed mover. PASS.
6. Versions and exact pins bumped per the table; release-metadata test and
   CHANGELOG heading moved; stompbox core pin to 0.18.0 (version untouched).
   Fresh-clone checks: (recorded when complete).
7. Commit the prep on `indiejoseph/core-release-0190`. **No push, no tags:
   the owner publishes via phase 2.**
8. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
   **No push.**

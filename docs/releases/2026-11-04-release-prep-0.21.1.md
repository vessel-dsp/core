# Release prep: core 0.19.0 / compiler 0.21.1 / runtime 0.16.2 / chain 0.1.25 / player 0.2.23 (2026-11-04, TL022 output-swing pair)

**Status: PREPARED (versions final). Publish by tag from main, one tag at a time, in the order below.**
Prepared 2026-11-04 on branch `indiejoseph/release-0211` at `8b9dad5` (plus this
note): origin main `93a3a8d` (the published 0.21.0 release commit `616f2fd` plus its
record commit) plus two commits, verified in the same clone (control run before any
edit, gates below). Core 0.19.0 unchanged, not tagged; stompbox unchanged.

## What ships

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.19.0 | 0.19.0 (unchanged) | no change; not tagged |
| compiler | 0.21.0 | 0.21.1 | TL022 output-swing pair typed from TI SLOS076 (data only); exact core pin stays 0.19.0 |
| runtime | 0.16.1 | 0.16.2 | sources untouched: no `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change; patch because the exact compiler pin moves to 0.21.1 (a published version cannot carry a new pin) |
| chain | 0.1.24 | 0.1.25 | exact re-pin (compiler 0.21.1, core 0.19.0, runtime 0.16.2) |
| player | 0.2.22 | 0.2.23 | no source change; exact re-pin (chain 0.1.25, compiler 0.21.1, core 0.19.0, runtime 0.16.2) |
| stompbox | 0.6.17 (unchanged) | -- | exact `@vessel-dsp/core` pin stays 0.19.0 |

## What changed

One registry commit, plus the versions/changelog/prep-note commit:

- Registry (`packages/compiler/src/registry-data/opamp.ts`, two edits and nothing else
  in the registry): the record `partIds: ["TL022", "TL022C", "TL022CP", "TL022CD",
  "TL022CN"]` (gainBandwidthHz 0.5e6) gains `outputSwingDropHighVolts` and
  `outputSwingDropLowVolts`, both `value: 2.0`, `basis: "datasheet"`, each `source`
  quoting TI SLOS076 (Sep 1973 rev Sep 1990) p3: `VO(PP)` maximum peak-to-peak output
  voltage swing, RL = 10 kOhm, VCC+- = +-15 V, 25C, TL022C MIN 20 TYP 26 (TL022M the
  same; full range MIN 20 both grades). A peak-to-peak row states both sides at
  once: (30 - 26) / 2 = 2.0 V a side TYP (the MIN row gives (30 - 20) / 2 = 5.0 V a
  side). `outputSwingPrinted: { supplyVolts: 30, loadOhms: 10000, translation:
  "constant", column: "TL022C, TYP" }`. `constant` is the TL061/TL062 convention
  (owner decision 2026-10-17, row 16, D3) applied to this TI low-power family: the
  sheet prints no figure below +-15 V (the `Power Dissipation With +-2-V Supplies`
  bullet and Figure 2 are dissipation, not swing). The matching `opampOutputSwingAbsent`
  entry (reason: peak-to-peak figure only, no per-side figure) is removed; the loader
  throws on an id both typed and absent. Every other absent entry and its D4 wording
  is untouched. Owner decision 2026-11-04: the D4 freeze is lifted for TL022 only, for
  the `boss-oc-2` comparator stage (IC2B with D6/D7; the packet runs ten TL022 sections,
  all previously full-swing `not-stated`).
- Tests (`packages/compiler/tests/output-swing.test.ts`): two new tests, no count
  update needed (`opampRegistryRecords` stays 26: the TL022 record is modified in
  place, not added; the structural loops hold). Positive control: TL022CP stamps 2.0 V
  inside each rail (rails +-7 V on the +-9 V stage) with `stated-at-other-supply`
  (30 V print carried to the 18 V stage). Negative control: TL072CP (frozen) still
  states no pair, swings the full supply, `not-stated`.

## Evidence

- Control run (clone at origin main `93a3a8d`, before any edit): `bun install
  --frozen-lockfile` exit 0 (411 packages); wasm built in CI order (emcc on PATH);
  `bun run typecheck` exit 0; `bun run build` exit 0 (`dist entrypoints ok`); root
  `bun test` 2740 pass / 3 fail first run (the 2 pre-existing
  `tests/appearance/corpus-integration.test.ts` failures -- CE-2 colour `#59B1E6` vs
  `#5ca8d4`, block count -- plus one flaky `packages/runtime/tests/pipeline.test.ts`
  Belton BTDR-2H timeout at 5000 ms), rerun shows only the 2 pre-existing failures
  (2741 pass / 2 fail across 175 files, matching the 0210 record).
- Post-edit gates: `bun run typecheck` exit 0; `bun test
  packages/compiler/tests/output-swing.test.ts packages/compiler/tests/registry-data.test.ts
  packages/compiler/tests/gain-bandwidth.test.ts
  packages/compiler/tests/package-pin-binding.test.ts` **288 pass / 0 fail** (286
  before + the 2 new TL022/TL072 tests).
- `git diff <base>..HEAD -- packages/runtime/src packages/runtime/scripts` is empty:
  the runtime solver and its scripts are untouched.

## Expected movers (Phase-1 program control)

`diff -rq programs-old programs-new` is expected to differ in exactly the packets
that carry a TL022 id and nothing else. By `PartNumber` grep of the clean-extract
`schematics/vessel-dsp/*.vdsp`: `boss-bf-2`, `boss-ce-2`, `boss-ce-2b`, `boss-ge-7`,
`boss-oc-2`, `boss-ph-1r`, `boss-vb-2`, `dod-envelope-filter-440-vintage-green`.
For `boss-oc-2`, the ten TL022 sections' rails sit 2.0 V inside the supply and the
compile's warnings no longer include `not-stated` `opamp-law-default-parameters`
(the pair carries across supplies, so `stated-at-other-supply` names them instead).

Kernel table control: a swing change moves rail constants, not operators, so the
regenerated `GeneratedKernels.cpp` is expected to show an empty diff. Any churn is a
finding: report, do not commit the table, stop before pushing.

## Checklist

1. Versions and exact pins bumped per the table; core `VERSION`, dist, and the
   release-metadata test move together; CHANGELOG heading added. No tags, no publish.
2. No `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h`/kernel-table change (runtime
   sources untouched -- verified by empty diff).
3. Local core `main` -- NOT TOUCHED (another session's uncommitted edits).
4. Nothing loose in `~`; scratch only under `/tmp/release-0211-worker/` and the
   `tmp/release-0211/` tree.
5. **No push.**

## Release record (published 2026-11-04, workbench release-0211 worker)

**Status: PUBLISHED.** Main pushed fast-forward `93a3a8d` -> `0a55a06`
(no force); four tags pushed one at a time in order, each watched to success
before the next, each confirmed on npm before proceeding. No reruns, no tag
moves, no core tag (core unchanged).

| package | version | tag | publish run | npm time (UTC) |
|---|---|---|---|---|
| compiler | 0.21.1 | `compiler-v0.21.1` | 41816260164 success | 2026-11-04T10:47:56 |
| runtime | 0.16.2 | `runtime-v0.16.2` | 41816684285 success | 2026-11-04T10:56:04 |
| chain | 0.1.25 | `chain-v0.1.25` | 41817570424 success | 2026-11-04T11:00:19 |
| player | 0.2.23 | `player-v0.2.23` | 41818033347 success | 2026-11-04T11:05:42 |

Acceptance in an empty dir (`npm i` all five at the new versions): `npm ls
--all` clean, one copy of each, deduped, no nested older core or compiler.

Program control (the release claim): 145 programs (122 pedals + 23 amps)
exported from a clean `git archive` extract of artifacts
`fd050cf3881fa36eef91506b066b7367554aaaf2`, compiled once with the release
compiler (clone symlinked into the workbench) and once with the published npm
compiler 0.21.0 / core 0.19.0 / runtime 0.16.1: `diff -rq programs-old
programs-new` differs in exactly the seven executing TL022 packets --
`boss-bf-2`, `boss-ce-2`, `boss-ce-2b`, `boss-ge-7`, `boss-oc-2`, `boss-ph-1r`,
`dod-envelope-filter-440-vintage-green` -- and nothing else. `boss-vb-2` is
listed by the `PartNumber` grep but is not a mover: its IC5 (TL022CP) declares
0 connected terminals (`unconnected-behavior-component`, skipped from MNA
modeling) and `SRC_TL022CP` is empty-terminal source evidence, so its program
carries no TL022 stamp (its sole ideal-opamp stamp is IC1B NJM4558DD) and is
correctly byte-identical -- the same unconnected-inventory precedent as
`boss-ps-2`'s 1S188FM in the 0.17.0 record. All seven movers verified
non-rail-identical (every block and stamp equal after removing ideal-opamp
`railLow`/`railHigh`): TL022 sections move 0/9 to 2/7, every other part's
stamps untouched. `boss-oc-2` positive control (release compiler): 10 of 10
ideal-opamp stamps at rails low 2 / high 7 (2.0 V inside the 9 V supply), all
ten sections (IC1A/B, IC2A/B including the comparator, IC3A/B, IC4A/B, IC5A/B)
`stated-at-other-supply`, zero `not-stated` (old compiler: 10 stamps 0/9,
10x `not-stated`).

Kernel table control: regenerating `GeneratedKernels.cpp` from the new programs
gives **138 kernels from 557 scheduled blocks** with an **empty diff** against
the committed table -- a swing change moves rail constants, not operators, as
expected. The regenerated table was not committed (nothing to commit).

Published wasm proof: published 0.16.2 `dist/wasm/v2_dsp.wasm` sha256
`5f9754f1f0c35792bcab58b94bf0fe670f394a236fa35016a047e421411df813`
(2,283,801 bytes) is **byte-identical to published 0.16.1** -- the runtime did
not move.

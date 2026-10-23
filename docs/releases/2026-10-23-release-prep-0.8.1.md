# Release prep: compiler 0.8.1 / runtime 0.6.3 / chain 0.1.11 / player 0.2.9 (2026-10-23)

**Status: PREPARED, NOT PUSHED, NOT TAGGED.** Prepared 2026-10-23 on branch `indiejoseph/release-0.8.1` at the prep commit
(see report). Built and verified in a fresh clone at `/home/joseph/projects/VesselDSP/tmp/release-0.8.1/clone`; evidence
under `/home/joseph/projects/VesselDSP/tmp/release-0.8.1/` (never under `/tmp`). Every figure below was measured for this
release; nothing is carried over. Do not tag from any other state. Publication order is compiler, runtime, chain,
player (`publish.yml` has a dependencies-published gate for chain, runtime and player but none for the compiler, so the
compiler must not go before its dependencies are ready — same order as 0.8.0, minus core which does not ship here).

## What ships (prepared; the owner may change the versions before any tag)

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.17.0 | — (not bumped, not tagged) | `git log v0.17.0..HEAD -- packages/core/src` is empty: nothing changed since 0.17.0 |
| compiler | 0.8.0 | 0.8.1 | wave-1 datasheet-derived BJT gain / JFET channel records + wave-2 provisional community IS for 2SC2458/2SC2459 (data only, no public type change); exact core pin unchanged at 0.17.0 |
| runtime | 0.6.2 | 0.6.3 | exact compiler pin, the regenerated `GeneratedKernels.cpp`; no `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change, confirmed |
| chain | 0.1.10 | 0.1.11 | exact re-pin |
| player | 0.2.8 | 0.2.9 | exact re-pin |

Unreleased on core `main` since `compiler-v0.8.0` (all sixteen `registry-data` + spike-note commits listed in the
task brief: transistor-records waves 1 and 2, bjt/jfet/index plus the inventory test update). Nothing else is queued.

## Who measured, and where the credit goes

Wave 1 (2026-10-23, `docs/spikes/2026-10-23-transistor-records-wave-1.md`): datasheet-derived geometric-midpoint
Beta and form-3 JFET channel records for 2SC3324, 2SA1048, 2SC2459, 2SC4116, MMBT5089, KTC3198-BL, 2SK30A-O (+ bare
2SK30ATM alias), 2SK879(+Y), 2SK880(+GR) and Vt0-only J113, every parameter cited to a printed manufacturer sheet row;
arithmetic recomputed in `python3 -I` (Vt = 0.025852 V throughout). Wave 2 (`docs/spikes/2026-10-23-transistor-records-wave-2.md`):
provisional `community`-basis IS for 2SC2458 and 2SC2459 (15.2e-15, 10.1e-15) from the Intusoft-authored QSC2458/QSC2459
cards in a third-party SPICE collection, taken under the owner's 2026-10-23 decision ("we have no other option"); the
compiler flags them with `registry-provisional-value`. The A/B mover analysis below is measured against the published
0.8.0 / 0.6.2 for this release, not carried from either note.

## Draft CHANGELOG entry (moved to the top of `CHANGELOG.md` at release; `tests/package.test.ts` "release metadata" updated to match)

```
## compiler 0.8.1 / runtime 0.6.3 / chain 0.1.11 / player 0.2.9

[... as written in CHANGELOG.md ...]
```

## Checklist (the 0.8.0 sequence, `docs/releases/2026-10-21-release-prep-0.8.0.md`; every row measured 2026-10-23)

1. npm holds core 0.17.0, compiler 0.8.0, runtime 0.6.2, chain 0.1.10, player 0.2.8 (`npm view`, measured 2026-10-23;
   all five match the expected set, so the prep proceeds). `git log v0.17.0..HEAD -- packages/core/src` is empty:
   core stays 0.17.0 and is NOT bumped or tagged. `publish.yml` tag patterns `v*`, `compiler-v*`, `runtime-v*`,
   `chain-v*`, `player-v*` confirmed (unchanged since 0.8.0; dependencies-published gates exist only for chain,
   runtime, player — compiler has none, which is why the order matters). PASS.
2. Fresh clone of `indiejoseph/release-0.8.1` at the tip under `tmp/release-0.8.1/clone` (the worktree nests inside
   the main checkout and would resolve stale `node_modules`/`dist`). `bun install --frozen-lockfile` passes;
   `build:wasm` (emcc 6.0.4) then root `bun run build` passes, `dist entrypoints ok`. A probe import of
   `@vessel-dsp/core` from inside the clone resolves to the clone workspace (`LED_INDICATOR_COLOURS` present);
   every measuring script ran from inside the clone. PASS.
3. `git diff compiler-v0.8.0..HEAD --stat -- packages/runtime/src` is empty (and likewise from `runtime-v0.6.2`):
   no `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change, and no other runtime change either. Patch release
   justified. PASS.
4. Exported 145 programs with the new compiler over artifacts `418c5c50` (committed files only via `git archive`;
   123 pedals + 23 amps, `examples/` excluded as in 0.8.0; `boss-dd-3t` refused) and regenerated: 139 kernels
   from 559 scheduled blocks (committed table 139 from 559). One fingerprint out (`0x5f19ae34`), one in
   (`0x711f403d`), both `boss-aw-2`: the packet was re-traced between `892d3b9cd` and `418c5c50`, and exporting
   the old corpus with this compiler reproduces the old fingerprint, so zero compiler-attributable kernel churn.
   WASM outputs are bit-identical with and without the regenerated table over the whole corpus (145 of 145). PASS.
5. Corpus A/B, published 0.8.0/0.6.2 from npm in an empty dir vs the new tree: 145 compile on both,
   `boss-dd-3t` refused on both. Program text: 124 identical, 21 differ, all bjt/fet-stamps-only (per-device
   old/new values in the report; every mover named by a wave-1/wave-2 part). Audio: every unchanged program
   renders bit-identical on both consoles (124 of 124 — no same-program mover); 5 movers are program-only with
   bit-identical audio (`boss-bf-3`, `boss-hr-2` silent, `boss-dd-3a`, `boss-ph-3`, `boss-rv-5` out-of-path); the
   rest move 1e-9 to volts, largest `mxr-carbon-copy`, `ibanez-ts9-reissue`, both `boss-bd-2` builds,
   `boss-md-2`, `boss-dd-5`. Prose-only or evidence-role mentions (`ibanez-pql`, `boss-oc-3`, `boss-st-2`) and
   already-shipped spellings do not move: no unexplained mover. Positive control A-vs-repeat identical 145/145
   both consoles; negative control B-vs-perturb moves 122 TS / 118 WASM (8 silent in both). Pre-existing
   TS-vs-WASM gaps (`mf-102`, 1959, rockerverb, `tw-1`) unchanged in kind. PASS (controls in the report).
6. Versions and exact pins bumped (compiler 0.8.1, runtime 0.6.3, chain 0.1.11, player 0.2.9), `bun.lock`
   refreshed, `tests/package.test.ts` release metadata and `CHANGELOG.md` heading moved to
   `## compiler 0.8.1 / runtime 0.6.3 / chain 0.1.11 / player 0.2.9`. Core's version, `VERSION` constant and the
   stompbox core pin are untouched (already 0.17.0; the contract test requires no change). Checks (fresh clone):
   see report.
7. Commit the prep on `indiejoseph/release-0.8.1`. **No ff-merge, no push: phase 2 (coordinator) owns push and tags.**
8. Tags one at a time in publication order (compiler, runtime, chain, player), `gh run watch` + `npm view` poll
   between each. **Phase 2, not this prep.**
9. Empty-dir install of the four, `npm ls`, render the corpus through the published wasm and compare hashes with the local
   build. **Phase 2, after the tags.**
10. Workbench: pin bump, `bun run build:v2-worklet`, `bun run generate:catalogs` from a `git archive` of the artifacts
    commit, `bun run report:hardware-ratchet`, changelog, commit. **Not this repo, not this prep.**

`scripts/next-bundle-proof.ts` is stale (reads a removed blog file): not run, as in the 0.8.0 prep.

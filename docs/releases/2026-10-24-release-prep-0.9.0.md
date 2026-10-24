# Release prep: compiler 0.9.0 / runtime 0.7.0 / chain 0.1.12 / player 0.2.10 (2026-10-24)

**Status: PREPARED, NOT PUSHED, NOT TAGGED.** Prepared 2026-10-24 on branch `indiejoseph/release-0.9.0` at the prep commit
(see report). Built and verified in a fresh clone at `/home/joseph/projects/VesselDSP/tmp/release-0.9.0/clone`; evidence
under `/home/joseph/projects/VesselDSP/tmp/release-0.9.0/` (never under `/tmp`). Every figure below was measured for this
release; nothing is carried over. Do not tag from any other state. Publication order is compiler, runtime, chain,
player (`publish.yml` has a dependencies-published gate for chain, runtime and player but none for the compiler, so the
compiler must not go before its dependencies are ready — same order as 0.8.1, minus core which does not ship here).

## What ships (prepared; the owner may change the versions before any tag)

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.17.0 | — (not bumped, not tagged) | `git log v0.17.0..HEAD -- packages/core/src` is empty: nothing changed since 0.17.0 |
| compiler | 0.8.1 | 0.9.0 | zener-clamped op-amp rail + `opamp-supply-undeclared`, P873/VTL5C2 measured-table cells, latch polarity fix, LED-derived engaged side + `latch-engaged-disagrees`, engaged bypass default, new `ldrTableCurrentAmps`/`ldrTableOhms` law/stamp fields (minor) |
| runtime | 0.6.3 | 0.7.0 | exact compiler pin, the regenerated `GeneratedKernels.cpp`, and the measured-table law on both consoles (`Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change, confirmed) |
| chain | 0.1.11 | 0.1.12 | exact re-pin |
| player | 0.2.9 | 0.2.10 | exact re-pin |

Unreleased on core `main` since `compiler-v0.8.1` (the twelve AW-2/latch/optocoupler commits listed in the
task brief plus their four spike reports). Nothing else is queued.

## Who measured, and where the credit goes

Rows A–C (2026-10-23, `docs/spikes/2026-10-23-aw2-latch-zener-p873.md`): the zener-clamped op-amp supply rail
(IC5 `railHigh` 9 → 5.235 on `boss-aw-2`, `opamp-supply-undeclared` on 15 documents) and the `P873G35` entry split
were applied from the specified patch; the AW-2 bypass latch was investigated and left on the fallback seed under
the stop rule. Rows 1–2 (2026-10-23, `docs/spikes/2026-10-23-latch-polarity-effect-status.md`): the bistable latch
engaged/bypassed polarity fix (seed + steering stamps backed the member that must be OFF when engaged; renamed to
the transistor ON when engaged) and the typed `effect-status` LED engaged-side read for fallback latches
(`boss-dm-3` the one mover, `latch-engaged-disagrees` firing nowhere). Table law (2026-10-24,
`docs/spikes/2026-10-24-opto-table-law.md`): `ldrTableCurrentAmps`/`ldrTableOhms` through the catalog, lowering,
program, `Program.h`/`ProgramJson.cpp` and both consoles (log-log interpolation); the P873 6-point table
(geometric mean of 18 measured `-380` units, electro-music.org topic 27276, provisional) replaces the power-law
fit, VTL5C2 becomes its three cited anchors. Engaged default (2026-10-24,
`docs/spikes/2026-10-24-bypass-default-engaged.md`): a typed `role: bypass` control steered by a
connectivity-derived latch defaults to 1. The A/B mover analysis below is measured against the published
0.8.1 / 0.6.3 for this release, not carried from any note.

## Draft CHANGELOG entry (moved to the top of `CHANGELOG.md` at release; `tests/package.test.ts` "release metadata" updated to match)

```
## compiler 0.9.0 / runtime 0.7.0 / chain 0.1.12 / player 0.2.10

[... as written in CHANGELOG.md ...]
```

## Checklist (the 0.8.1 sequence, `docs/releases/2026-10-23-release-prep-0.8.1.md`; every row measured 2026-10-24)

1. npm holds core 0.17.0, compiler 0.8.1, runtime 0.6.3, chain 0.1.11, player 0.2.9 (`npm view`, measured 2026-10-24;
   all five match the expected set, so the prep proceeds). `git log v0.17.0..HEAD -- packages/core/src` is empty:
   core stays 0.17.0 and is NOT bumped or tagged. `publish.yml` tag patterns `v*`, `compiler-v*`, `runtime-v*`,
   `chain-v*`, `player-v*` confirmed (unchanged since 0.8.1; empty diff `327322e..HEAD` over `.github/workflows`);
   dependencies-published gates exist only for chain, runtime, player — compiler has none, which is why the order
   matters. PASS.
2. Fresh clone of `indiejoseph/release-0.9.0` at the tip under `tmp/release-0.9.0/clone` (the worktree nests inside
   the main checkout and would resolve stale `node_modules`/`dist`). `bun install --frozen-lockfile` passes;
   `build:wasm` (emcc 6.0.4) then root `bun run build` passes, `dist entrypoints ok`. A probe import of
   `@vessel-dsp/compiler` from inside the measuring tree resolves to that tree's source (verified in the
   worktree; the A/B arms below ran there). The clone re-verification is exact: exporting the corpus with the
   clone's compiler reproduces the worktree's 146 program JSONs byte-identically, and re-running
   `generate-kernels` in the clone reproduces the committed table byte-identically. PASS.
3. `git diff compiler-v0.8.1..HEAD --stat -- packages/runtime/src` is `Engine.cpp` + `ProgramJson.cpp` +
   `Program.h` + `index.ts` + `reference-runtime.ts`: the measured-table law on both consoles, i.e. a
   `Program`/`Stamp` change. Minor release justified. Compiler changes since `compiler-v0.8.1` are the twelve
   feature commits (latch-seed, netlist, lower, device-laws, part-catalog, types, diagnostics, fixtures, compile,
   partition, index plus four new test files). PASS.
4. Exported 146 programs with the new compiler over artifacts `8fd6c8a6` (committed files only via `git archive`;
   124 pedals + 23 amps, `examples/` excluded as in 0.8.1; `boss-dd-3t` refused) and regenerated: 140 kernels
   from 562 scheduled blocks (committed table 139 from 559). Two fingerprints out (`0x711f403d` on `boss-aw-2`,
   `0x83ca2d95` on the slapback) and three in (`0xb672b06f`, `0x092663a0`, `0x2b074d31` on the re-traced AW-2,
   the re-traced slapback, and the new `maestro-discoverer-delay` packet): exporting the old corpus with this
   compiler reproduces the committed 139 exactly, so zero compiler-attributable kernel churn. WASM outputs are
   bit-identical with and without the regenerated table over the whole corpus (146 of 146). PASS.
5. Corpus A/B, published 0.8.1/0.6.3 from npm in an empty dir vs the new tree: 146 compile on both,
   `boss-dd-3t` refused on both. Program text: 139 identical, 7 differ — `boss-aw-2` (rail + P873 table),
   `boss-tw-1` (P873 table), `runoffgroove-tremulus-lune` (VTL5C2 anchors), `boss-sd-1`/`boss-ce-2`/`boss-dm-2`
   (latch swap + engaged default), `boss-dm-3` (LED swap); the 15 `opamp-supply-undeclared` documents change
   warning codes only. Audio: every unchanged program renders bit-identical on both consoles (139 of 139 — no
   same-program mover); the three engaged-default pedals' new defaults render the effect at the old default's
   level (`boss-sd-1` 0.4529, `boss-ce-2` 2.381, `boss-dm-2` 1.135 peaks, both arms both consoles); largest movers
   `boss-dm-3` 4.01 both consoles, `boss-tw-1` 3.90 both, `boss-aw-2` 1.07 both, `runoffgroove-tremulus-lune`
   7.35e-3 both. Positive control A-vs-repeat identical 146/146 both consoles; negative control B-vs-perturb
   moves 123 TS / 119 WASM (8 silent in both). Pre-existing TS-vs-WASM gaps (`mf-102`, 1959, rockerverb, `tw-1`)
   unchanged in kind. PASS (controls in the report).
6. Versions and exact pins bumped (compiler 0.9.0, runtime 0.7.0, chain 0.1.12, player 0.2.10), `bun.lock`
   refreshed, `tests/package.test.ts` release metadata and `CHANGELOG.md` heading moved to
   `## compiler 0.9.0 / runtime 0.7.0 / chain 0.1.12 / player 0.2.10`. Core's version, `VERSION` constant and the
   stompbox core pin are untouched (already 0.17.0; the contract test requires no change). Checks (fresh clone):
   see report.
7. Commit the prep on `indiejoseph/release-0.9.0`. **No ff-merge, no push: phase 2 (coordinator) owns push and tags.**
8. Tags one at a time in publication order (compiler, runtime, chain, player), `gh run watch` + `npm view` poll
   between each. **Phase 2, not this prep.**
9. Empty-dir install of the four, `npm ls`, render the corpus through the published wasm and compare hashes with the local
   build. **Phase 2, after the tags.**
10. Workbench: pin bump, `bun run build:v2-worklet`, `bun run generate:catalogs` from a `git archive` of the artifacts
    commit, `bun run report:hardware-ratchet`, changelog, commit. **Not this repo, not this prep.**

`scripts/next-bundle-proof.ts` is stale (reads a removed blog file): not run, as in the 0.8.1 prep.

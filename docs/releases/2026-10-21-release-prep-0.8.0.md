# Release prep: core 0.17.0 / compiler 0.8.0 / runtime 0.6.2 / chain 0.1.10 / player 0.2.8 (2026-10-22)

**Status: PREPARED, NOT PUSHED, NOT TAGGED.** Prepared 2026-10-22 on branch `indiejoseph/release-0.8.0` at the prep commit
(see report). Built and verified in a fresh clone at `/home/joseph/projects/VesselDSP/tmp/release-0.8.0/clone`; evidence
under `/home/joseph/projects/VesselDSP/tmp/release-0.8.0/` (never under `/tmp`). Every figure below was measured for this
release; nothing is carried over. Do not tag from any other state. Publication order is core, compiler, runtime, chain,
player (`publish.yml` has no dependencies-published gate for the compiler, so the compiler must not go before core).

## What ships (prepared; the owner may change the versions before any tag)

| package | from | to | why |
|---|---|---|---|
| core (`@vessel-dsp/core`) | 0.16.0 | 0.17.0 | new export `LED_INDICATOR_COLOURS` (minor) and the s-curve/taper change already on main; published 0.16.0 lacks both, and the compiler imports the new export, so core is published first |
| compiler | 0.7.0 | 0.8.0 | the measured 1N4148 pair and LED colour records, typed `Color`, `led-colour-unmatched`, full-quad `custom` LED override; exact pin on core 0.17.0 |
| runtime | 0.6.1 | 0.6.2 | exact compiler pin, the regenerated `GeneratedKernels.cpp`, and the sparse-refinement fix `1073c4f` (`Engine.cpp` + `reference-runtime.ts` only; no `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change, confirmed) |
| chain | 0.1.9 | 0.1.10 | exact re-pin |
| player | 0.2.7 | 0.2.8 | exact re-pin |

Unreleased on core `main` since `compiler-v0.7.0` (all of `adf0792`, the `indiejoseph/led-registry` merge): `d9f2d5c`,
`7b60412`, `f8cd567`, `ab26251`, `d428a28`. Nothing else is queued.

## Who measured, and where the credit goes

The 1N4148 pair and the five LED colour records are **the first `measured`-basis records in the registry, and the measurement
is Joseph Cheng's** (the project owner): bench of 2026-10-20, UNI-T UT107 DC volts (10 mV effective count), USB 5 V breadboard
shield read 4.99 V, 2.2 k / 270 ohm and 20 k / 150 ohm resistors as typed, room 20 C; two 1N4148 and two LEDs per colour and
size from one kit, maker unrecorded. Evidence files and fits: workbench `packet-study/led-default/` (`RESULT.md`,
`HANDOFF-core.md`, `measurements/2026-10-20-led-default.json` sha256 `72abc43a…f7b37a`,
`measurements/2026-10-20-led-default-cd-points.json` sha256 `d0c55601…6fb41`). The record `source` and `note` strings in
`packages/compiler/src/registry-data/diode.ts` and `led.ts` now say so ("Owner bench 2026-10-20 (measured by Joseph Cheng,
the project owner)"), and the changelog entry below credits the author in its first paragraph. The workbench changelog of
2026-10-20 carries the same credit.

## Draft CHANGELOG entry (move to the top of `CHANGELOG.md` at release; update `tests/package.test.ts` "release metadata" to match)

```
## compiler 0.8.0 / runtime 0.6.2 / chain 0.1.10 / player 0.2.8

**The registry's first bench-measured records, measured by Joseph Cheng (the project owner) on 2026-10-20.** The 1N4148's
community card (LTspice Standard.dio IS 2.52 nA, N 1.752, RS 0.568) is replaced by the owner's two-point pair
(IS 2.124272112914455e-8, n 2.17468223817758 at the engine's 1.0 ohm default and VT 0.025852 V; anchors 1.9705 mA at 0.645 V
and 15.611 mA at 0.775 V, means of two diodes, UNI-T UT107, 10 mV count). The pair holds only between those two currents and
cannot separate n from series resistance; the record says so. Five LED colour defaults (red, yellow, green, blue, white) carry
measured IS and n (blue, white and green from a four-point fit with a fitted series resistance of 22 to 30 ohm; red and
yellow from a two-point pair valid about 1.4 to 11 mA) with the thermal voltage they were referred to stated as `derived`; a
`kind: led` device reaches them by whole part id (`RED LED`, `5mm red LED`, `LED-RED`, `LED-GREEN`) or by the new typed `Color`
(closed vocabulary red, yellow, green, blue, white, compared as a whole value; `LED_INDICATOR_COLOURS` in `@vessel-dsp/core`;
an out-of-vocabulary colour keeps the class defaults and raises `led-colour-unmatched`). A `custom` LED override must now state
the full quad (IS, n, VT, Rs). Green misses the fit's 20 mV limit by 12 mV and the record discloses it. No manufacturer model
exists for an indicator green or yellow LED; the published white and blue models sit 60 to 700 mV from the kit.

**What moves (measured 2026-10-20 in the workbench study, to be re-measured against the published 0.7.0 for this release):**
13 corpus programs move on the 1N4148 record, 5 more on the keyed LED records, 26 in all on the typed colour, every change in
diode stamps only, no compile status change. Both consoles agree on the records on 24 bench and 18 clipper circuits and on 38
of the 39 corpus programs that carry one; `boss-ph-1r` fails console parity on the published 0.7.0 with or without them
(bisected to the wave-4 JFET records in 0.6.0, not these). `boss-tw-1`'s startup convergence moved with the red record;
its settled audio agrees to 2.8e-5 V. Marshall Guvnor D2/D3 (plain diodes with PartNumber `LED-RED`) clip as red LEDs and
read +9.2 dB RMS at one 1 kHz 0.25 V sine. Two packets state `Color: red-green` (`boss-bf-3`, `boss-ph-3`) and keep class
defaults with the warning. Workbench evidence: `packet-study/led-default/WASM-CHECK.md`.

The runtime changes only its exact pin and the regenerated kernel table; chain and player change only their exact pins.
```

## Checklist (the 0.7.0 sequence, `docs/releases/2026-10-20-release-prep-0.7.0.md`; every row measured 2026-10-22)

1. npm holds core 0.16.0, compiler 0.7.0, runtime 0.6.1, chain 0.1.9, player 0.2.7. `git log v0.16.0..HEAD -- packages/core/src`
   lists `d428a28` (`LED_INDICATOR_COLOURS`, imported by the new compiler) and `bb5b6aa` (s-curve/taper): published 0.16.0
   lacks both, so core 0.17.0 goes first. `publish.yml` tag patterns `v*`, `compiler-v*`, `runtime-v*`, `chain-v*`,
   `player-v*` confirmed; only chain, runtime and player have a dependencies-published gate (compiler has none, which is
   why the order matters). PASS.
2. Fresh clone of `indiejoseph/release-0.8.0` at `1073c4f` under `tmp/release-0.8.0/clone` (the worktree nests inside the
   main checkout and would resolve stale `node_modules`/`dist`). `bun install --frozen-lockfile` passes; `build:wasm`
   (emcc 6.0.4) then root `bun run build` passes, `dist entrypoints ok`. A bare `@vessel-dsp/compiler` import from outside
   the clone resolves to bun's install cache (published code): all measuring scripts run from inside the clone. PASS.
3. `git diff compiler-v0.7.0..HEAD --stat -- packages/runtime/src` is `Engine.cpp` + `reference-runtime.ts` only: no
   `Program`/`Stamp`/`ProgramJson.cpp`/`Program.h` change. Patch release justified. PASS.
4. Exported 145 programs with the new compiler over artifacts `892d3b9cd` (committed files only; the live checkout's two
   untracked Maestro paths excluded) and regenerated: 139 kernels from 559 blocks (committed table 139 from 563).
   One fingerprint out (`0x5a687ace`), one in (`0x5f19ae34`), both `boss-aw-2`: the packet was re-traced between `67fb504c7`
   and `892d3b9cd`, so the old entry was dead and the new schedule ran on the interpreter. No compiler-attributable kernel
   churn (`boss-aw-2` program text is byte-identical between old and new compilers over the same corpus). WASM outputs are
   bit-identical with and without the regenerated table over the whole corpus (145 of 145). PASS.
5. Corpus A/B, published 0.7.0/0.6.1 from npm in an empty dir vs the new tree: 145 compile on both, `boss-dd-3t` refused
   on both. Program text: 106 identical, 39 differ, all diode-stamps-only (13 on the 1N4148 record, 22 on red, 2 on blue
   Rs-fit, 2 mixed; 21 further LED carriers keep class defaults and do not move). Audio: every unchanged program renders
   bit-identical on both consoles except `boss-aw-2` (TS 2.74e-2, WASM 2.51e-2 at a 0.27 peak: the `1073c4f` repivot at 1x);
   4 movers are program-only with identical audio; the rest move 1e-14 to volts, largest `boss-tw-1`, Guvnor, `jan-ray`.
   No unexplained mover. Positive control A-vs-repeat identical 145/145 both consoles; negative control B-vs-perturb moves
   122 TS / 118 WASM (8 silent in both). Pre-existing TS-vs-WASM gaps (`mf-102`, 1959, rockerverb, `tw-1`) unchanged in kind. PASS (controls
   in the report).
6. Versions and exact pins bumped (core 0.17.0, compiler 0.8.0, runtime 0.6.2, chain 0.1.10, player 0.2.8), `bun.lock`
   refreshed, `tests/package.test.ts` release metadata and `CHANGELOG.md` heading moved to
   `## core 0.17.0 / compiler 0.8.0 / runtime 0.6.2 / chain 0.1.10 / player 0.2.8`. Checks (fresh clone): see report.
7. Commit the prep on `indiejoseph/release-0.8.0`. **No ff-merge, no push: phase 2 (coordinator) owns push and tags.**
8. Tags one at a time in publication order (core, compiler, runtime, chain, player), `gh run watch` + `npm view` poll
   between each. **Phase 2, not this prep.**
9. Empty-dir install of the five, `npm ls`, render the corpus through the published wasm and compare hashes with the local
   build. **Phase 2, after the tags.**
10. Workbench: pin bump, `bun run build:v2-worklet`, `bun run generate:catalogs` from a `git archive` of the artifacts
    commit, `bun run report:hardware-ratchet`, changelog, commit. **Not this repo, not this prep.**

`scripts/next-bundle-proof.ts` is stale (reads a removed blog file): not run, as in the 0.7.0 prep.

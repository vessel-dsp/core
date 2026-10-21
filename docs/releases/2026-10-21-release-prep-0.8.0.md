# Release prep: compiler 0.8.0 (and the exact re-pins it forces), 2026-10-21

**Status: DRAFTED, NOT RUN.** Written on 2026-10-21 when the owner asked to publish the bench-measured diode records. The
session that drafted it lost its shell before any check could run, so nothing below is measured for this release yet, no
version is bumped, no tag exists, and the only edits on the tree are the two registry files (author credit in the `source`
and `note` strings of the measured records) and this document. Every row of the checklist is still owed. Do not tag from this
state.

## What ships (proposed; the owner may change the versions before any tag)

| package | from | to | why |
|---|---|---|---|
| compiler | 0.7.0 | 0.8.0 | the measured 1N4148 pair replaces the community record; measured LED colour defaults (red, yellow, green, blue, white) with typed `Color`; a `custom` LED override must state the full quad; assumed fit constants relabelled `derived`; `led-colour-unmatched` diagnostic. Minor because `Color` is a new typed vocabulary the compiler reads from a document |
| runtime | 0.6.1 | 0.6.2 | exact compiler pin and the regenerated `GeneratedKernels.cpp` only; `Program`, `Stamp`, `ProgramJson.cpp` and `Program.h` untouched (to be confirmed by `git diff compiler-v0.7.0 -- packages/runtime/src/cpp`) |
| chain | 0.1.9 | 0.1.10 | exact re-pin |
| player | 0.2.7 | 0.2.8 | exact re-pin |
| core (`@vessel-dsp/core`) | 0.16.0 | **check first** | `d428a28` added `LED_INDICATOR_COLOURS` to `@vessel-dsp/core`. If npm's 0.16.0 predates that commit, core must be bumped and published BEFORE the compiler, or the published compiler imports a symbol the published core does not export |

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

## Checklist (the 0.7.0 sequence, `docs/releases/2026-10-20-release-prep-0.7.0.md`; every row owed)

1. `npm view @vessel-dsp/core version` and `git log -1 --format=%h -- packages/core/src` against the `v0.16.0` tag: decide the core bump above.
2. Fresh clone of core `main` (worktrees nest; do not prepare in the main checkout). `bun install --frozen-lockfile`, root `bun run build` (after `bun run --cwd packages/runtime build:wasm`, emsdk on PATH).
3. Confirm no runtime C++ or `Program` change: `git diff compiler-v0.7.0..HEAD --stat -- packages/runtime/src/cpp packages/runtime/src/program*`.
4. Regenerate `GeneratedKernels.cpp` with this compiler over the artifacts corpus (`export-programs-release-compiler.ts`, `generate-kernels.ts`), rebuild wasm, record fingerprints in and out against the committed table.
5. Corpus A/B against the published 0.7.0 / 0.6.1 installed from npm into an empty directory: program text and 2048-sample two-tone audio on both consoles, with the repeat and nudge controls; expect exactly the diode-stamp movers above and name any other.
6. Bump the versions, exact pins, `tests/package.test.ts` release metadata, move the entry to `CHANGELOG.md`; `bun test` (compiler 652 pass on the branch at `adf0792`), `bun run typecheck`.
7. Commit the prep, ff-merge to `main`, push, confirm `git rev-parse HEAD == origin/main`.
8. Tags one at a time, `gh run watch`, `npm view` poll between each, in the order core (if bumped), compiler, runtime, chain, player.
9. Empty-dir install of the four, `npm ls --all`, render the corpus through the published wasm and compare hashes with the local build.
10. Workbench: pin bump, `bun run build:v2-worklet`, `bun run generate:catalogs` from a `git archive` of the artifacts commit, `bun run report:hardware-ratchet` (the SD-1 lane's diode ablation in `packet-study/boss-sd-1-et521-5108/specimen-profile/` should be rerun on the measured 1N4148 record), changelog, commit.

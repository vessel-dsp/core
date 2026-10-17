# Release prep: compiler 0.6.0, runtime 0.6.0, chain 0.1.9, player 0.2.7 (2026-10-17)

Prepared on a fresh clone of core `main` at `9cbfe0e` (the 0.5.0 release prep), with three worker commits applied in order: the
per-side op-amp swing pair (`a06baac` in the worker clone of `core-swing-diode-n`), the declared diode `EmissionCoefficient` reader
(`ff9723d`, same clone) and `s-curve` as Alpha W(4B) with a loud taper parser (`8f6f122`, clone `core-s-curve`). Nothing in this
document is a hardware claim. The workbench studies behind the three commits are in the workbench repo under
`thoughts/shared/2026-10-17-core-swing-diode-n/`, `2026-10-17-core-s-curve/` and `2026-10-17-core-thermal-slew/`.

## What ships
| package | from | to | why |
|---|---|---|---|
| compiler | 0.5.0 | 0.6.0 | printed per-side op-amp swing pair with its printed condition (`outputSwingDropHighVolts`, `outputSwingDropLowVolts`, `outputSwingPrinted`) replacing `outputSwingDropVolts`; declared diode `EmissionCoefficient` read; `s-curve` taper kind |
| runtime | 0.5.0 | 0.6.0 | `s-curve` law on both consoles (`taper.ts`, new `Taper.h`, `Program.h` enum, `ProgramJson.cpp`); an unknown taper string is a load refusal that names it; test-only wasm export `v2_testonly_taper_fraction` |
| chain | 0.1.8 | 0.1.9 | exact re-pin to compiler 0.6.0 and runtime 0.6.0 |
| player | 0.2.6 | 0.2.7 | exact re-pin to chain 0.1.9, compiler 0.6.0 and runtime 0.6.0 |
`@vessel-dsp/core` stays 0.16.0; its source gains a doc comment in `taper.ts` that defines `s-curve`, which ships with the next core release. A change to the program format's taper vocabulary and the removal of a registry field are why compiler and runtime take a minor bump.

**Breaking surface.** `outputSwingDropVolts` is removed from the registry shape with no alias. A taper string a console does not know now refuses to load where it used to read as linear. The C++ alias `anti-logarithmic` is removed (no compiler release emitted it). A runtime older than this one plays `s-curve` as linear without saying so, which only the exact pins in chain and player guard.

## Evidence (measured 2026-10-17 on this tree, artifacts `f84464799` with 0 dirty files)
The two instruments are the frozen ones of the three worker studies: a compile-level corpus diff (every pedal and amp document compiled with each arm's own `compile` and `pedalPartCatalog`, whole `Program` compared as JSON, per-stamp field differences listed, every block's sparse schedule compared) and a default-controls render comparison written by `render-one.ts` and read by `compare.py`. Arm A is the published 0.5.0 byte-copied from a lockfile install (wasm sha256 `8b3802fa...`, equal to the committed public wasm). Arm C is this tree's own build (wasm `dfe8af77...`, emscripten 6.0.4). Arm M is the compiler of A with the runtime of C.

Compile level, 146 documents (123 pedals, 23 amps):
| measure | result |
|---|---|
| negative control, A against A | 145 identical, 0 differing, 1 refused on both (`boss-dd-3t`) |
| A against C | 137 identical, **8 program differ**, 1 refused on both, 0 status changes, 0 compile throws |
| sparse schedules that differ | 0 of 146, so no kernel fingerprint moves |
| the 8 | `pro-co-rat-2-v4b-op07cp`, `mxr-phase-90`, `mxr-phase-90-script`, `mxr-micro-flanger`, `mxr-micro-amp`, `mxr-carbon-copy` (rails only), `boss-sd-1` (`emissionCoefficient` only), `sunn-beta-lead` (4 conductance stamps, `taper` linear to `s-curve`) |
| `opamp-law-default-parameters` | 81 documents to 87, gained exactly the six swing movers, lost none; items 331 `not-stated`, 19 `stated-at-other-supply` |
| other warning codes | one document differs: `sunn-beta-lead` loses its two `taper-not-executable` |

Audio, default controls, both consoles (two-tone, 440 Hz at 0.25 and 1320 Hz at 0.1, 48 kHz):
| set | A against C |
|---|---|
| S1, 2048 samples, 145 compiling documents | 138 bit-identical on both consoles, 7 movers, `sunn-beta-lead` among the identical (its controls sit at 0.5) |
| S2, 3 s, the 74-document set (metric window the last second, mean removed) | 67 bit-identical on both consoles, the same 7 movers |
| S1, arm M against A (the new runtime given the 0.5.0 compiler's programs) | 145 of 145 bit-identical on both consoles, no refusal |
| comparator controls, known answers | identical copy reads bit-identical, a +1.0000 dB copy reads +1.000000000 dB, one flipped mantissa bit is found at its index, a 1e-9 perturbation outside the window is seen by the bit test and not by the window metric: all four pass |

The seven movers, level change in dB (TS equals WASM to the digits printed at both windows):
| document | cause | S1 (43 ms) | S2 (last 1 s of 3 s) |
|---|---|---|---|
| `pro-co-rat-2-v4b-op07cp` | OP07 rails 6.8 and 2.2 V to 8.34 and 0.66 V | +0.414 | +0.412 |
| `boss-sd-1` | D4 to D6 n 1.752 to 1.9 | +0.531 | +0.529 |
| `mxr-carbon-copy` | TL062C 1.5 V; MC33178 7.9 and 1.1 V to 9 and 0 V | +0.742 | +0.0024 |
| `mxr-phase-90-script` | TL061 7.8 and 1.2 V to 7.5 and 1.5 V | +3.2e-6 | +0.499 |
| `mxr-phase-90` | TL062 same | -1.4e-4 | -0.113 |
| `mxr-micro-amp` | TL061 same | -4.0e-7 | -4.5e-7 |
| `mxr-micro-flanger` | TL061 and TL062 same | -1.1e-12 | 0.000 |
The two phasers' 3 s figures are a snapshot of a swept circuit and move with the oscillator's phase; read them as "moves", not as a gain.

The Phase 90 sweep (the check registered with decision D3). On the swing series by itself `report-phaser-sweep` (WASM, 72 s after an 8 s settle, defaults, self-check passed first) reads `mxr-phase-90` SWEEPING with depth 144.4 to 131.7 degrees and a reported period of 7.80 s to 16.04 s, and `mxr-phase-90-script` SWEEPING with 383.0 to 379.8 degrees and 3.63 s on both. The worker left the period doubling uninvestigated. **Investigated here by a direct probe** (TS console, the instrument's stimulus, every node sampled each 10 ms, direct DFT on a 1 to 30 s grid of 0.05 s): the oscillator's triangle node swings 6.60 V peak to peak on 0.5.0 and 6.00 V on this tree, with dominant period 7.90 s and 8.00 s. The circuit's period moves by 1.3 percent, so the instrument's 16.04 s is its estimator choosing a doubled period, not the oscillator. The probe is a one-circuit, one-stimulus result and was not run on `mxr-phase-90-script`.

## Kernels and toolchain
The kernel table was regenerated with this compiler over the corpus (145 programs that compile, `export-programs` then `generate-kernels.ts`): 139 kernels from 561 scheduled blocks, **byte-identical to the committed `GeneratedKernels.cpp`** (sha256 prefix `290224e0...`) and to the table generated with the 0.5.0 compiler over the same corpus. Nothing was regenerated. The wasm was built locally with emscripten 6.0.4; CI publishes with 3.1.74, found equal on 64 packets in the 0.5.0 release and not re-checked here until the post-publish comparison below.

## Decision record
The owner's instruction of 2026-10-17 (relayed by a worker) was to apply both series, prepare the release, ship the diode `n` reader as item C, and close the Vt-only temperature knob and the datasheet slew clamp as do-not-build. The plan decisions D1 to D9 are in `thoughts/shared/plans/2026-10-17-release-row-draft.md` in the workbench. Two corrections to that instruction were made by the workers and kept: OP07 is the printed proportional rule (0.66 V a side at a 9 V circuit), not a fitted 0.93 V, and the TS-9 declares no `n` (only `boss-sd-1` does, 1.9, a 2026-07-14 packet declaration with no datasheet figure behind it).

## Not measured
Non-default controls and switch states, oversample above 1, real-time cost (no worklet scoreboard), a guitar take in this gate, the 72 documents outside the 74-document set at 3 s, the packet catalogs, `sunn-beta-lead` at non-default controls on this combined build (the s-curve study measured it on its own: +0.00042 and -0.00318 dB at 0.3 and 0.7), ngspice for the taper law (it imports the law), the browser beyond the two proofs below, and whether any change is closer to hardware.

## Release checks (run 2026-10-17 in a fresh clone made from core at `9cbfe0e`, on the final tree)
| check | result |
|---|---|
| `bun install --frozen-lockfile` | passes |
| `bun run build` (all packages, `check:dist`) | passes; the runtime needs `build:wasm` first in a fresh clone (emscripten 6.0.4) |
| `bun run typecheck` | passes, 0 errors |
| `bun test` | 2165 pass, 0 fail. A first run on a box loaded by 12 render jobs failed 6 tests on the 5 s timeout and one test (`release metadata`) on a missing `packages/stompbox/dist` in a partial build; the rerun on a quiet box after the full build is the figure above |
| `bun run pack:dry-run` | passes for all packages, including compiler 0.6.0, runtime 0.6.0, chain 0.1.9 and player 0.2.7 |
| `bun run build:pages` | passes |
| `packages/runtime/scripts/worklet-proof.ts` (headless Chromium 149) | PASS: worklet against the chain render 1.1e-8 (bar 1e-4), with and without `structuredClone` |
| `packages/player/scripts/player-proof.ts` (headless Chromium) | PASS on four sound-checked legs (buffer, fuzz, buffer plus IR, buffer plus NAM): worst chunk distance 8.0e-5, 2.4e-5, 8.0e-4 and 4.3e-5 against a 2e-3 bar, zero wasm or worklet requests before the click, 0 new overruns over the measured 3 s on every gating leg (two legs show 2 and 3 overruns in the startup window). The fifth leg, `mxr-phase-90`, is refused by admission on this box (7812 ns per sample measured against a 5208 ns budget, 6250 ns at 0.5.0), which the proof counts as a pass; it was not compared with the published packages |
| `packages/player/scripts/next-bundle-proof.ts` | **NOT RUN.** The instrument is stale (it copies `website/apps/blog`, which no longer holds the page it needs); bundler compatibility of the worklet is covered only by the worklet proof's `structuredClone` leg |

## Tag sequence (not started)
Release prep committed and fast-forwarded onto `main`, then `main` pushed and `HEAD == origin/main` confirmed before any tag (the gate refuses a tag that does not match the package version). Then one tag at a time, `git tag X && git push origin X`, `gh run watch <id> --exit-status`, poll `npm view <package> version` until it prints (about 3.5 to 5 minutes after the run goes green): `compiler-v0.6.0`, `runtime-v0.6.0`, `chain-v0.1.9`, `player-v0.2.7`. The player run can fail once with `TLOG_CREATE_ENTRY_ERROR (409)`; `gh run rerun <id> --failed` fixed it. Afterwards: install all four from npm into an empty directory, `npm ls`, render the corpus through the published wasm and compare output hashes with the local build (this is also the CI-against-local emscripten check). Workbench follow-up, after publish: the pin bump, `generate:catalogs` (expected: the amp catalog changes only in `sunn-beta-lead`, the pedal catalog in the seven movers), `build:v2-worklet`, the two workbench patches (`component-opamp-chips.json` with the drift report and engine notes; the source-to-spice deck reading the declared `n`), and the ratchet re-baseline as its own argued step.

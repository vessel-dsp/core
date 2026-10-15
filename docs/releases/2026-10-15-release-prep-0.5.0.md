# Release prep: compiler 0.5.0, runtime 0.5.0, chain 0.1.8, player 0.2.6 (2026-10-15)

Prepared on a fresh clone of core `main` at `47c719e` (the merge of the `JRC4558D` catalog change on top of the op-amp
gain-bandwidth work merged 2026-10-11). Nothing in this document is a hardware claim.

## What ships
| package | from | to | why |
|---|---|---|---|
| compiler | 0.4.0 | 0.5.0 | typed op-amp gain-bandwidth product (`10f2ca1`), `JRC4558D` catalog entry (`1b6165d`); optional `gainBandwidthHz` on the ideal op-amp stamp |
| runtime | 0.4.1 | 0.5.0 | reads the field on both consoles (`Program.h`, `ProgramJson.cpp`, `Engine.cpp`, `reference-runtime.ts`); transient-solver fixes (`5ed3ca9`) |
| chain | 0.1.7 | 0.1.8 | exact re-pin to compiler 0.5.0 and runtime 0.5.0 |
| player | 0.2.5 | 0.2.6 | exact re-pin to chain 0.1.8, compiler 0.5.0 and runtime 0.5.0 |
Core `@vessel-dsp/core` stays 0.16.0. A change to the program format is a minor bump of compiler and runtime, which is why they are 0.5.0.

## Evidence (measured 2026-10-15, workbench note `thoughts/shared/2026-10-15-unreleased-core-corpus-diff/`)
Compile level: published compiler 0.4.0 against this source over the 123 packets in `schematics/vessel-dsp`: 48 change an op-amp
gain-bandwidth value, 37 differ only structurally (the field is present, value unchanged), 38 are identical, none changes compile
status. Three of the 48 come from the `JRC4558D` entry; 45 come from the typed bandwidth work.

Audio level: 836 renders, published compiler 0.4.0 + runtime 0.4.1 ("old") against this source ("new"). The new stack was run from
source with a tsconfig path override, because core's compiler `dist` is stale and a bare import from the runtime source silently
loads it. One 1 kHz sine at 0.5, 20 and 200 mV, default controls, 48 kHz. Window: 8 s, metrics over the last 3 s with DC removed; old
and new use the identical window. No wall-clock figure is quoted (the box was loaded by the sweep itself).
| measure | result |
|---|---|
| silent with a sine (level deltas meaningless) | 5 of 48: `boss-bf-3`, `boss-dd-3b`, `boss-dm-3`, `boss-oc-2`, `boss-rv-5` |
| live movers within 0.1 dB at 0.5 / 20 / 200 mV | 35 / 38 / 39 of 43 |
| `boss-aw-2` | +16.1 / +15.9 / +15.3 dB (output -102 to -52 dB, scales with input) |
| `nobels-odr-1` | +8.9 / +0.1 / +0.05 dB (a bandwidth-limited high-gain stage; clipped at 20 mV and above) |
| `dod-envelope-filter-440-vintage-green` | -6.1 / -4.6 / -1.0 dB |
| `pro-co-rat-2-v4b-op07cp` | +0.82 / -0.02 / 0.00 dB |
| `boss-ce-5` | -0.95 dB at every level; output constant near -77.5 dB, a floor, not a signal path |
| negative control, identical programs (8 packets) | max 2.9e-7 dB, 19 of 24 renders bit-identical |
| negative control, structural-only (8 packets) | max 0.13 dB, 11 of 24 bit-identical (`electro-harmonix-deluxe-memory-man` +0.105 to +0.130, `boss-ch-1` -0.003 to -0.017) |
| non-converged samples, packets with any (of 48, 20 mV, 8 s) | os1 old 3 / new 3; os2 old 2 / new 2; os4 old 2 / new 1 |
| `boss-mt-2` | published stack does not finish 8 s at os2 or os4 (killed at 900 s); new finishes; os1 148 to 76 non-converged in 8 s, 472 to 191 in 20 s, peak 1024 |
| `mxr-blue-box` | os2 regresses 0 to 1 non-converged, peak 342 to 1024; os1, os4 and a 20 s os1 run are clean |
| console agreement (TS against WASM, 2 s) | 126 of 128 within 0.01 dB; `boss-dd-3b` 0.12 dB (old) and 0.14 dB (new) |
| generated-kernel share of schedule solves | not lower on any of the 64 packets; no abandoned or dropped schedule blocks on either stack |
The negative control means the runtime fixes move packets whose bandwidth did not change, so **the 0.4.1 statement that the default
path is bit-identical to the previous release is not repeated here.** Only 16 of the 75 unchanged packets were sampled.

## Kernels and toolchain
`GeneratedKernels.cpp` was regenerated with this tree's compiler over the 145 corpus programs that compile (`docs/spikes/hotfix-0.4.1/export-programs-release-compiler.ts`, then `scripts/generate-kernels.ts`): 139 kernels from 561 scheduled blocks both before and after, but 6 fingerprints changed, so those six blocks lost their kernel under the committed table (they would have run on the interpreter, same answer, slower). The wasm built from the clone before regeneration is bit-identical (sha256 prefix `dc49a0b3...`, glue `af9897c8...`) to the binary the audio measurement above used. After regeneration the wasm is `b9b920f4...`. The local build used emscripten 6.0.4; CI publishes with 3.1.74, found bit-identical on six packets in an earlier release and not re-checked here.

## Decision record
The owner accepted the `mxr-blue-box` oversample-2 regression and the level movers above on 2026-10-15, after the measurement, with
the typed bandwidth work previously parked on the `boss-mt-2` / `mxr-blue-box` stability trade.

## Not measured
Real-time cost (no worklet scoreboard, no CPU budget), the browser (see the release checks below), a guitar take, non-default
controls and switch states, oversample 3 and 8, the 59 unsampled packets, hardware.

## Release checks (run 2026-10-15 in a fresh clone of the final prep tree)
| check | result |
|---|---|
| `bun install --frozen-lockfile` | passes (the lockfile does not record workspace versions) |
| `bun run build` (all packages, `check:dist`) | passes; the runtime build needs `build:wasm` first in a fresh clone (emscripten 6.0.4) |
| `bun run typecheck` | passes |
| `bun test` | 2063 pass, 0 fail (one test, `release metadata`, pins the changelog heading and was updated for this release) |
| `bun run pack:dry-run` | passes for all packages, including `@vessel-dsp/player` 0.2.6 |
| `bun run build:pages` | passes (873 pages) |
| kernel regeneration | done, see above; all 64 measured packets render bit-identical output with the regenerated kernels (8 s, 20 mV, os1, WASM), and three packets (`boss-ph-1r`, `boss-ce-2b`, `boss-sp-1-spectrum`) go from no kernel solves to all |
| `scripts/worklet-proof.ts` (runtime, headless Chromium) | PASS: worklet against the chain render 1.1e-8 (bar 1e-4), with and without `structuredClone` |
| `scripts/player-proof.ts` (player, headless Chromium) | PASS on four sound-checked legs (buffer, fuzz, buffer plus IR, buffer plus NAM: non-silent output, worst chunk distance 1.9e-7 to 7.8e-4 against a 2e-3 bar, zero requests for wasm or worklet before the click). The fifth leg, `mxr-phase-90`, is refused by admission on this box (measured 6250 ns per sample against a 5208 ns budget), which the proof counts as a pass; it was not compared with the published packages. |
| `scripts/next-bundle-proof.ts` (real Next build) | **NOT RUN.** It copies `website/apps/blog` and that path no longer holds `LivePlayer.tsx` (the blog moved to its own repo on 2026-09-15), so it fails with ENOENT before any build. The instrument is stale; the proof needs rewriting against the blog repo. Bundler compatibility of the worklet is covered only by the worklet proof's `structuredClone` leg. |
Tags are pushed one at a time, compiler then runtime then chain then player, with an `npm view` check between each.

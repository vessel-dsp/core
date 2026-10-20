# Release prep: compiler 0.7.0, runtime 0.6.1, chain 0.1.9, player 0.2.7 (2026-10-20)

Prepared on a fresh clone of core `main` at `49c7e2e` (the BJT and JFET default-warning fix). It was prepared twice: the first
copy lived only in a scratch clone under `/tmp` and was lost when Orca's `PrivateTmp` directory was deleted under a running
session, so every figure below was re-measured on 2026-10-20 after the loss and none is carried over. Nothing here is a hardware
claim.

## What ships
| package | from | to | why |
|---|---|---|---|
| compiler | 0.6.0 | 0.7.0 | the Slap-Back Echo compiles (`SCL4013A` on the `CD4013AE` entry, UJT relaxation clock derivation, `ujt` registry class and `DeviceOverride` target, 2N4871 record, `SAD1024A` cascade exit at section B); `BAT85` and `BAT85S` records; `PartEntry.citedParams` and truthful BJT and JFET default-parameter warnings |
| runtime | 0.6.0 | 0.6.1 | exact compiler pin and the regenerated `GeneratedKernels.cpp`; no `Program`, `Stamp`, `ProgramJson.cpp` or `Program.h` change |
| chain | 0.1.9 | 0.1.9 | exact re-pin to compiler 0.7.0 and runtime 0.6.1 (0.1.9 was bumped at the 0.6.0 prep and never tagged or published; npm holds 0.1.8) |
| player | 0.2.7 | 0.2.7 | exact re-pin to chain 0.1.9, compiler 0.7.0 and runtime 0.6.1 (same: npm holds 0.2.6) |

The version choice is the preparer's: compiler takes a minor because public types change (`MacroPortRoles.cascade`, the `ujt`
class, `PartEntry.citedParams`, a new `DeviceLaw` kind), runtime a patch because its program format and C++ sources are
untouched. The owner may change it before any tag; every pin and heading follows from five lines.

**What npm holds now, which `package.json` did not say:** compiler 0.6.0, runtime 0.6.0, chain 0.1.8, player 0.2.6. The tags
`compiler-v0.6.0` and `runtime-v0.6.0` sit at `28dc820`, twenty commits after the prep commit `bbef01b`, so the published 0.6.0
contains the whole parameter-registry programme the 0.6.0 changelog entry never mentioned. The changelog now carries a correction
at the top of that entry with the measured effect.

## Evidence (measured 2026-10-20, artifacts `67fb504c7`, committed files only)
Corpus: `git archive 67fb504c7 schematics/vessel-dsp` into a scratch directory, so the untracked Maestro document in the live
checkout cannot move a count. 146 documents (123 pedals, 23 amps). Arm A is the published compiler 0.6.0 and runtime 0.6.0
installed from npm into an empty directory (`npm ls` clean). Arm B is this tree's compiler and this tree's own wasm build
(emscripten 6.0.4, built after the kernel table was regenerated; CI publishes with 3.1.74, found equal on 64 packets in the 0.5.0
release and not re-checked here until the post-publish comparison below). The renderer is one script run from each arm's root
(`render-corpus.ts`: every document through `compile` with `pedalPartCatalog`, program text hashed, the two-tone 440 Hz at 0.25
plus 1320 Hz at 0.1 at 48 kHz at default controls through the TS console and the WASM console, outputs kept).

| measure | result |
|---|---|
| compiled on both | 144 of 146; `boss-dd-3t` is refused on both (`unsupported`) |
| Slap-Back (`electro-harmonix-slapback-echo`) | A refuses at `IC3_SCL4013A` ("its part number \"SCL4013A\" matched no registry entry"); B compiles, 145 against 144 |
| program text, A against B | 144 of 144 byte-identical |
| audio, 2048 samples, TS console | 144 of 144 bit-identical, 136 non-silent (the other 8 are silent in both arms) |
| audio, 2048 samples, WASM console | 144 of 144 bit-identical, 136 non-silent |
| audio, 3 s, WASM console | 144 of 144 bit-identical, 136 non-silent |
| positive control, A against a repeat of A | identical on every document, both consoles, both windows (144 of 144) |
| negative control, B against B with one input sample nudged by 1e-6 | different on 122 (TS) and 119 (WASM) of 145 at 2048 samples, 122 of 145 at 3 s; the unchanged ones are the 8 silent documents and 15 non-silent documents whose output did not move |
| kernel table | 139 kernels from 563 blocks, the committed table 139 from 561; see below |

A comparator that reports only agreement has not been shown to work, and two silences agreeing prove little, so the table says
both what the controls did and how many of the identical documents were non-silent. It does not prove the outputs are right:
the 144 are the same as before, not correct.

Compile level, 0.5.0 against 0.6.0 (the undocumented step, same corpus): 144 documents compile on both, 95 emit different
program text and 49 are identical. Documents whose stamps of a kind changed: `bjt` 62, `diode` 49, `fet` 37, `ideal-opamp` 13,
`dc-source` 1, `input-source` 1, `controlled-conductance` 1. The eight documents the `bbef01b` content moved (six by the swing
pair, `boss-sd-1` by the declared diode n, `sunn-beta-lead` by the taper) all sit inside those counts, so the registry programme
alone is a subset; the one document whose `dc-source` and `input-source` changed is `moogerfooger-mf-102`, which is also the
document with the largest TS-against-WASM gap below (whether the two are related was not examined). The
instrument is `stampkinds.ts` plus `kinddiff.ts`; its self-comparison reads 144 identical and no kind changed. **No audio was
measured for the 0.5.0 to 0.6.0 step.**

### Kernel table
`GeneratedKernels.cpp` was regenerated with this compiler over the 145 programs that compile (`export-programs-release-compiler.ts`
then `generate-kernels.ts`): 139 kernels from 563 scheduled blocks (421 below the 64-op floor). Against the committed table, three
fingerprints go (`04ebbc7d`, `4417c5cf`, `b34a86d0`) and three come (`795e96ff`, `cdab4ff6`, `83ca2d95`). Regenerating with the
published 0.6.0 compiler over the same artifacts gives 138 kernels and exactly the first five of those, so those five are
artifacts having moved since the table was last generated (without them, blocks of the documents involved would run on the
interpreter, slower, same answer), and the compiler in this release adds `83ca2d95`, the Slap-Back's, and nothing else. The
wasm built from the tree with the regenerated table is the one the audio rows above measured.

### What the Slap-Back does and does not do
It compiles and runs. Its delay is derived from the UJT relaxation clock: 55.0 ms and 38.2 ms for the two DELAY positions. **It
makes no echo as shipped**: the packet's ideal `VBIAS` source sits on the BBD input node and grounds the audio there (impulse
echo 3.7e-5, measured when the cascade port was written); with that rail removed in a scratch copy the echo sits at 56.0 ms and
38.9 ms against the derived 55.0 and 38.2. The defect is the packet's, the artifacts branch that tried to repair it
(`slapback-bias-reread`, v1.24) was found unstable and is not merged, and nothing in this release claims the pedal is
playable. Three seconds of the Slap-Back through both consoles differ by 2.4e-7 against a 4.9 peak, which is the float32 rounding
of the WASM output buffer and not a console disagreement (an earlier figure of 2.7e-14 recorded before the loss does not
reproduce in this harness and is withdrawn).

### TS against WASM, not a regression
On the 2048-sample two-tone the two consoles differ by volts on four documents, identically in both arms: `moogerfooger-mf-102`
(2.7e3 against a 6.4e3 peak), `marshall-1959-super-lead-plexi` (38 V against 34 V), `orange-rockerverb` (34 V against 48 V) and
`boss-tw-1` (3.4 V against 3.4 V). Not examined here; it is the pre-existing state of the packets in this corpus and a
reminder that "bit-identical across versions" is silent on whether they are right.

## Release checks (2026-10-20, fresh clone of `49c7e2e` plus the prep commit)
| check | result |
|---|---|
| `bun install --frozen-lockfile` | passes; the bumped versions leave `bun.lock` unchanged |
| `bun run --cwd packages/runtime build:wasm` | passes (emscripten 6.0.4, about 35 s); needed before `bun run build` in a fresh clone |
| `bun run typecheck` | passes, exit 0 |
| `bun run build` | passes, `check-dist-entrypoints` ok |
| `bun test` | 2299 pass, 0 fail (a first run before the changelog heading was written failed exactly one test, `release metadata`, which pins that heading; the rerun is the figure) |
| `bun run pack:dry-run` | passes for all four packages (compiler 0.7.0, runtime 0.6.1, chain 0.1.9, player 0.2.7) |
| `bun run build:pages` | passes, 913 pages |
| `packages/runtime/scripts/worklet-proof.ts` (headless Chromium 153) | PASS: worklet against the chain render 1.1e-8 (bar 1e-4), with and without `structuredClone` |
| `packages/player/scripts/player-proof.ts` (headless Chromium 153) | PASS on four sound-checked legs (buffer, fuzz, buffer plus IR, buffer plus NAM): worst chunk distance 9.6e-5, 3.1e-5, 8.0e-4 and 4.5e-5 against a 2e-3 bar, zero wasm requests before the click, 0 new overruns on every leg (the IR leg shows one overrun in the startup window). The fifth leg, `mxr-phase-90`, is refused by admission on this box (6250 ns measured against a 5208 ns budget), which the proof counts as a pass; it was not compared with the published packages |
| `packages/player/scripts/next-bundle-proof.ts` | **NOT RUN.** The instrument is stale (it copies `website/apps/blog`, which no longer holds the page it needs); bundler compatibility of the worklet is covered only by the worklet proof's `structuredClone` leg |

Both browser proofs ran through `bun --preload` that points `chromium.launch` at the cached `chromium_headless_shell-1243`
(playwright wants a build that is not installed here), with `NODE_PATH` at the workbench `node_modules` for `playwright-core`.

## Not measured
Non-default controls and switch states, oversample above 1, real-time cost (no worklet scoreboard), a guitar take, ngspice for
the UJT derivation (the derived times are a model of the printed network, not a bench figure), the packet catalogs, the audio
of the 0.5.0 to 0.6.0 step, and whether anything here is closer to hardware.

## Release procedure (owner's calls)
1. Land the branch: merge `release-prep-0.7.0` into core `main` (fast-forward from `49c7e2e`).
2. Push `main` and confirm `git rev-parse HEAD` equals `origin/main` before any tag (the "tag matches package version" gate
   reads the tagged commit).
3. Tags, one at a time, in this order, each followed by `gh run watch` and an `npm view` poll before the next:
   `compiler-v0.7.0`, `runtime-v0.6.1`, `chain-v0.1.9`, `player-v0.2.7`.
4. Install all four from npm into an empty directory, `npm ls`, and run `render-corpus.ts` through the published wasm
   against the numbers above (CI emcc 3.1.74 against local 6.0.4 on the full 145).
5. Workbench: pin compiler 0.7.0 and runtime 0.6.1 exactly, `bun run generate:catalogs`, `bun run build:v2-worklet`.

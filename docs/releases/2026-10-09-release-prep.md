# Release prep: compiler 0.4.0 / runtime 0.4.0 / chain 0.1.6 / player 0.2.4 (2026-10-09)

Ships core main `aa8a1cb` (band-limited oversampling with the stage-specific low-latency
cascade, numeric-aware pivoting, the gated Newton start predictor, all in both consoles).
Worktree `~/projects/VesselDSP/core/release-2026-10`, branch `indiejoseph/release-2026-10` off
`aa8a1cb`. The release-prep diff is left UNCOMMITTED in the worktree; nothing was tagged, pushed,
published or committed, and the workbench, artifacts and `~/projects/emsdk` were not modified.

## 1. The diff (15 files; mirrors `84ac372`, the previous release-prep commit, plus this note)

| file | change |
|---|---|
| `packages/compiler/package.json` | version 0.3.0 -> 0.4.0 |
| `packages/runtime/package.json` | version 0.3.1 -> 0.4.0; pins compiler 0.4.0 |
| `packages/chain/package.json` | version 0.1.5 -> 0.1.6; pins compiler 0.4.0, runtime 0.4.0 |
| `packages/player/package.json` | version 0.2.3 -> 0.2.4; pins chain 0.1.6, compiler 0.4.0, runtime 0.4.0 |
| `tests/package.test.ts` | changelog head expectation -> the new entry; the 0.3.0 entry added to the `toContain` list |
| `CHANGELOG.md` | one entry `compiler 0.4.0 / runtime 0.4.0 / chain 0.1.6 / player 0.2.4` (numbers quoted from the five spike reports under `docs/spikes/`, rejected methods listed) |
| `packages/compiler/README.md` | install version; export table gains `gateOnlyFetPartIds` (exported since 0.3.0, never listed), `computeNumericRepivot`, `NUMERIC_REPIVOT_TAU` |
| `packages/runtime/README.md` | install version; the `oversample` bullet rewritten from "zero order hold, no decimator" to what ships (half-band cascade 41/29/21 taps, latency 19.5/26.25/28.625 via `oversampleLatency()`, held path for non-power-of-two, default 1); a paragraph on the Newton start predictor; the WASM console paragraph now lists `oversample`, `hostSampleRate()`/`oversampleLatency()`, `getPredictorTelemetry()`/`getPredictorOrder()`, the `v2_engine_prepare` signature change and the new native exports |
| `packages/chain/README.md` | install line (was stale at compiler 0.2.0 / runtime 0.2.1) -> 0.1.6 / 0.4.0 / 0.4.0; limits paragraph runtime 0.4.0 |
| `packages/player/README.md` | install version 0.2.4 (the historical "newer than runtime 0.2.3" note is true and kept) |
| `docs/src/content/docs/guides/runtime.mdx` | install line; `oversample` bullet; the worked example's `oversample: 2` sentence re-measured on the shipped path (peak 1.3502 at 2, 1.3498 at 4, latency 19.5 / 26.25; measured in the clone, `tools/os2-peak.ts`); WASM `prepare()` sentence; Limits bullet |
| `docs/src/content/docs/guides/compiler.mdx`, `signal-chain.mdx`, `docs/src/content/docs/index.mdx` | version strings |
| `docs/releases/2026-10-09-release-prep.md` | this note |

Grep for stale text after the edits (`hold`, `last sub`, `57`, `41.25`, `27.5`, `zero order`,
`no band limiting`) across `packages/*/README.md`, the guides and `index.mdx`: no remaining
hit describes the old path. `GeneratedKernels.cpp` is unchanged (section 3).

## 2. Principle honoured

Everything below ran in a fresh `git clone` of this branch (`aa8a1cb`) in a scratch directory
with the diff applied by `git apply`, never in the nested worktree (which resolves into the
main checkout's stale `dist`). Pins are exact, order compiler -> runtime -> chain -> player.
No per-packet anything, no knob, no shim: the changed `v2_engine_prepare` signature ships as a
documented change.

## 3. Kernels: `GeneratedKernels.cpp` is current (zero diff)

The workbench's `scripts/export-programs.ts` exports the catalogs its OLD pinned compiler
(0.3.0) compiled, so the programs were exported with THIS release's compiler instead:
`tools/export-programs-release-compiler.ts` (scratch, 40 lines) imports the clone's
`packages/compiler/src/index.ts` (package version 0.4.0) and the workbench's
`scripts/lib/artifact-root.ts` read-only, and compiles every `.vdsp` under
`artifacts/schematics/vessel-dsp` and `.../amps` with `pedalPartCatalog`, writing
`emit(program).text` per id exactly as the catalog generator does.

```
$ bun tools/export-programs-release-compiler.ts --clone=<clone> --out=<scratch>/programs
compiler: <clone>/packages/compiler/src/index.ts (package version 0.4.0)
artifacts: /home/joseph/projects/VesselDSP/artifacts @ b9508b71cb0be46caae6d47381b7a6c81a26f0fb dirty=false
wrote 145 programs to <scratch>/programs; skipped 1
  skip boss-dd-3t: unsupported
$ bun packages/runtime/scripts/generate-kernels.ts --programs=<scratch>/programs --out=<scratch>/GeneratedKernels.regen.cpp
generate-v2-kernels: wrote ... with 139 kernels (561 scheduled blocks, 419 below min ops 64)
$ diff <scratch>/GeneratedKernels.regen.cpp packages/runtime/src/cpp/GeneratedKernels.cpp && echo ZERO DIFF
ZERO DIFF
sha256 both: 6328392fe36be27964872f585ce7445549d41d6983489523eb723065c1228c41
```

145 programs (123 pedals + 23 amps, `boss-dd-3t` unsupported as before), 139 kernels, byte-identical
to the committed table. Artifacts checkout `b9508b71c`, clean.

## 4. Fresh-clone verification (the real gate)

Clone: `git clone --branch indiejoseph/release-2026-10 /home/joseph/projects/VesselDSP/core <scratch>/verify`
at `aa8a1cb`, then `git apply <scratch>/release-prep.patch` (14 files; this note excluded from the
patch, it is documentation). bun 1.3.14, node v24.14.0. Local emsdk 6.0.4 for the wasm unless stated.

| command | output |
|---|---|
| `bun install --frozen-lockfile` | `411 packages installed`, exit 0 (the lockfile does not pin workspace versions; the version bumps need no lockfile change, as in `84ac372`) |
| `bun run typecheck` | root + all packages, 0 errors, exit 0 |
| `bun run --cwd packages/runtime build:wasm` (em++ 6.0.4) | `Build successful`; `v2_dsp.wasm` sha256 `aef38274384e36db5433963f6893a1f32045daf8685f7d10df9aeba0c01adf02`, `v2_dsp.cjs` `af9897c81b08fb6f7546ca7f72acf8b83c21449a3cf2f68428148b815159a567` — byte-identical to the hashes recorded in `docs/spikes/2026-10-09-newton-predictor-wasm-port.md` §2 and §6 |
| `bun run build` | all packages, worklet bundles built, `dist entrypoints ok`, exit 0 |
| `bun test` (wasm present) | **1994 pass / 0 fail**, 513950 expect() calls, 142 files, 72.6 s; WASM tests ran (the cross-console, oversample, pivot and predictor suites are in the count). Re-run after the final doc edit: 1994 pass / 0 fail, exit 0 |
| `bun run build:pages` | 872 pages built, Pagefind index, sitemap, `Complete!`; re-run on the final patch exit 0 |
| `bun run pack:dry-run` | every package packs: core 0.16.0, stompbox 0.6.17, control-ui 0.6.15, visual-effects 0.6.15, amp 0.6.15, cabinet 0.6.15, **compiler 0.4.0** (708.0 kB / 226 files), **runtime 0.4.0** (1.2 MB / 65 files, prepack rebuilt the wasm, same hash), **chain 0.1.6** (210.9 kB / 58 files), **player 0.2.4** (1.1 MB / 110 files) |
| `bun run --cwd packages/{compiler,runtime,chain,player} pack:dry-run` | compiler 0.4.0, runtime 0.4.0, chain 0.1.6, player 0.2.4, each with its prepack (runtime/chain/player rebuild the wasm; `v2_dsp.wasm` still `aef38274…` afterwards) |

Note on exit codes: the first `bun test` / `build:pages` / pack runs were captured through a
`| tail` pipe whose status was not recorded (zsh); the outputs above are their real tails. The
re-runs of `bun test` and `build:pages` on the final patch were captured without a pipe and
read `exit 0`. Full logs: `<scratch>/logs/01..16-*.log`.

## 5. Browser proofs (headless Chromium 149.0.7827.55, playwright-core 1.61.0 from the workbench's `node_modules`)

`packages/runtime/scripts/worklet-proof.ts` (clone, `--port=8491`): **PASS**.
```
worklet-proof: bun legs chainTS-vs-ref 6.218e-3, wasmBun-vs-ref 4.344e-9
worklet-proof: structuredClone=present ... isWasmConsole=true ... cpuLoad=2.34375 overruns=0
worklet-proof: worklet peak 0.128883 rms 0.095237 maxAbsVsChain 1.102e-8 (PASS vs 0.0001) maxAbsVsReference 6.218e-3 [baseline]
worklet-proof: structuredClone=deleted ... cpuLoad=4.6875 overruns=0
worklet-proof: worklet peak 0.128883 rms 0.095237 maxAbsVsChain 1.102e-8 (PASS vs 0.0001) [no-structuredClone]
worklet-proof: PASS
```

`packages/player/scripts/player-proof.ts` (clone, `--port=8492`): **PASS**, four playing legs,
sound in every captured chunk (30 chunks of 2048 at 48 kHz, peak/rms non-zero), correlation leg
(`tightMax` vs the bun-side reference render) under the 2e-3 bar on each, zero overruns, zero
wasm/worklet requests and no AudioContext before the click; the fifth leg harvests the
admission refusal:
```
buffer-pedal    peak=0.2562 rms=0.1844 tightMax=6.70e-5 vsTsMax=6.70e-5 consoleDelta=3.02e-8 cpuLoadMean=6.63 overruns=0 PASS
fuzz-pedal      peak=0.1419 rms=0.1058 tightMax=1.34e-5 vsTsMax=1.34e-5 consoleDelta=5.22e-8 cpuLoadMean=1.24 overruns=0 PASS
buffer-plus-ir  peak=5.1691 rms=3.1547 tightMax=7.75e-4 vsTsMax=7.75e-4 consoleDelta=4.21e-8 cpuLoadMean=8.44 overruns=0 PASS
buffer-plus-nam peak=0.0697 rms=0.0503 tightMax=3.02e-5 vsTsMax=3.02e-5 consoleDelta=2.05e-7 cpuLoadMean=7.83 overruns=0 PASS
phase90-pedal   HARVEST admission-refused with measured 7812 ns (... cannot be shown to fit inside 5208 ns/sample ...)
player-proof: PASS
```

`packages/player/scripts/next-bundle-proof.ts` (clone, emsdk 6.0.4 sourced, `--port=8493`):
**NOT RUN — NOT APPLICABLE to this release (coordinator's ruling), neither a pass nor a failure.** The proof targets the blog's player embed, which does not exist yet. It packed all five
tarballs from the clone (core 0.16.0, compiler 0.4.0, runtime 0.4.0 with its prepack wasm build,
chain 0.1.6, player 0.2.4), copied `website/apps/blog` + `ui-theme` into a scratch dir, found
`LIVE_ENGINE = true`, then failed with
`ENOENT ... /tmp/next-proof-*/apps/blog/src/components/figures/LivePlayer.tsx` (exit 1) before
`npm install` / `next build`. That file was never tracked in the website repo
(`git log --all -- '*LivePlayer*'` is empty) and does not exist in the blog repo either
(`~/projects/VesselDSP/blog` has no player embed yet); the website working tree is mid-teardown
of `apps/blog` (86 uncommitted changes, `layout.tsx` and `[slug]/page.tsx` deleted) since the blog
moved to its own repo on 2026-09-15. The proof script was last changed 2026-10-04 and must have run
against an untracked `LivePlayer.tsx` that has since gone. Not worked around (the website is
read-only to this task and the script is not release-touched). Stated plainly: player 0.2.4's
bundling inside a Next app (the real `next build` chunk assertion, no `v2_dsp.cjs` in client
chunks) is UNVERIFIED for this release; player 0.2.4's own player-proof passed. That assertion was
last proven on 2026-10-04 for player 0.2.2, and player/chain source is unchanged since (re-pin only).

## 6. Toolchain gap measured: emsdk 3.1.74 (CI) vs 6.0.4 (local)

`publish.yml` builds the wasm in CI with `mymindstorm/setup-emsdk@v14`, version 3.1.74; every
hash in the spike reports is from 6.0.4. emsdk 3.1.74 was installed in the scratch dir
(`emsdk install 3.1.74 && emsdk activate 3.1.74`; `~/projects/emsdk` untouched), the clone's
C++ built with it, and the publish workflow's cross-console step plus a two-binary parity run
executed against that binary (`tools/build-3.1.74.sh`, log `10-build-3.1.74.log`).

```
em++ 3.1.74 (1092ec30a3fb1d46b1782ff1b4db5094d3d06ae5)
bun run --cwd packages/runtime build:wasm   -> Build successful, exit 0
  (one warning, identical under 6.0.4: V2Exports.cpp:97 'resampleStagePrototypes' has C-linkage
   specified, but returns user-defined type ... [-Wreturn-type-c-linkage]; test-only getter, pre-existing)
sha256 v2_dsp.wasm (3.1.74): 24747d093d99c1c8845f0e605a197a2e2f62c61ab11983aa6b79a1d86e57b573
sha256 v2_dsp.cjs  (3.1.74): e2c12f7a4a8f61a506aad94ce40c6e575b778ee1b251dc6217c50e33b94e5e22
sha256 v2_dsp.wasm (6.0.4):  aef38274384e36db5433963f6893a1f32045daf8685f7d10df9aeba0c01adf02
sha256 v2_dsp.cjs  (6.0.4):  af9897c81b08fb6f7546ca7f72acf8b83c21449a3cf2f68428148b815159a567
bun test packages/compiler/tests packages/runtime/tests  (3.1.74 binary in src/wasm; = publish.yml's
  "Cross-console agreement on the built wasm" step)   -> 909 pass / 0 fail, 58 files, exit 0
```

3.1.74 compiles the current C++ (`-fwasm-exceptions`, `std::optional`, structured bindings): no
blocker. Different hash, same behaviour: `tools/parity-toolchains.ts` loads both binaries in one
process (`V2WasmEngine.create(program, mod)`) and runs the workbench parity method (440 Hz @0.25 +
1320 Hz @0.1, cap 1024, settle 100 / window 2048, bars r >= 0.9999 and max abs < 1e-4) on the six
profile packets at x1/os2/os4/os8:

| packet | os | 6.0.4 vs 3.1.74 | bit-identical | each vs TS reference |
|---|---|---|---|---|
| muff | 1/2/4/8 | 0 | yes | 5.0e-9 / 4.4e-9 / 4.2e-9 / 3.4e-9 |
| sd1 | 1/2/4/8 | 0 | yes | 7.7e-6 (libm offset, known) |
| ts9 | 1/2/4/8 | 0 | yes | 2.7e-5 (libm offset, known) |
| ts808 | 1/2/4/8 | 0 | yes | 1.8e-8 / 1.4e-8 / 1.9e-8 / 1.5e-8 |
| gro100 | 1/2/4/8 | 0 | yes | 7.4e-9 |
| blue-box | 1/2/4/8 | 0 | yes | 7.0e-7 / **1.043e-4 FAIL (pre-existing marginal, identical on both binaries)** / 9.3e-10 / 9.3e-10 |

The two toolchains' binaries produce **bit-identical float32 output on all 24 rows** (max abs
delta exactly 0), and every row's TS-vs-WASM figure reproduces the predictor-port report's
post-port table to the digit. The only FAIL is blue-box os2 at 1.043e-4 against the 1e-4 bar,
the pre-existing chaotic-trajectory marginal adjudicated in the latency and predictor port
reports; it is the same on both binaries. The `prepack` in `publish.yml` builds the wasm in CI,
so the binary users get is CI's (emsdk 3.1.74, hash `24747d09…`), not the `aef38274…` measured
in the spike reports; this section is what makes that acceptable.

## 7. Findings (none blocks tagging; coordinator ruled the Next proof not applicable)

1. `next-bundle-proof.ts` is NOT RUN / not applicable for this release (section 5): its
   `LivePlayer.tsx` precondition no longer exists anywhere, so player 0.2.4's Next bundling is
   unverified. The proof must be re-established against the blog repo when its player embed
   lands; until then no release can prove the Next chunk assertion.
2. `V2Exports.cpp:97` C-linkage warning on both toolchains (test-only getter); cosmetic.
3. blue-box os2 parity marginal (1.043e-4 vs 1e-4), pre-existing and toolchain-independent.

## 8. Owner commands, in order (paste-ready)

After reviewing the worktree diff and committing it on the branch as
`release prep: compiler 0.4.0 (band-limited oversampling, numeric pivoting, Newton predictor), runtime 0.4.0, chain 0.1.6, player 0.2.4; versions, pins, changelog, docs`:

```
git -C ~/projects/VesselDSP/core merge --ff-only indiejoseph/release-2026-10
cd ~/projects/VesselDSP/core
git tag compiler-v0.4.0 && git push origin main compiler-v0.4.0
#   wait for publish.yml green, then (npm lags ~2.5 min):
npm view @vessel-dsp/compiler@0.4.0 version
git tag runtime-v0.4.0 && git push origin runtime-v0.4.0
npm view @vessel-dsp/runtime@0.4.0 version          # after publish.yml green
git tag chain-v0.1.6 && git push origin chain-v0.1.6
npm view @vessel-dsp/chain@0.1.6 version            # after publish.yml green
git tag player-v0.2.4 && git push origin player-v0.2.4
npm view @vessel-dsp/player@0.2.4 version           # after publish.yml green
# then, in an EMPTY directory:
npm init -y && npm i @vessel-dsp/player@0.2.4 && npm ls
#   expect exactly: @vessel-dsp/player@0.2.4 -> chain@0.1.6, compiler@0.4.0, runtime@0.4.0 (core@0.16.0 beneath)
```

Each tag's workflow refuses to publish while a pinned `@vessel-dsp` dependency is missing from
npm, so the order above is enforced, not just advised. The runtime's `prepack` builds the wasm in
CI with emsdk 3.1.74 (section 6).

## 9. Phase B (workbench; separate task once npm shows the four versions)

Worktree of the workbench on a branch; bump `@vessel-dsp/compiler` and `@vessel-dsp/runtime`
pins to 0.4.0, `bun install`, `bun run generate:catalogs`, `bun run build:v2-worklet`,
`bun run typecheck`, `bun run test`; then the Verification Routing gates (corpus ratchet
self-check + run, `test-v2-wasm-parity.ts` on the corpus expecting only the sd1/ts9 libm offsets
and the blue-box os2 marginal, fixture parity self-check + corpus, worklet scoreboard at factor 1
not below the current 98 of 117, idle-noise report, `render:v2` listen on Big Muff / SD-1 / TS-9
at x1 and os4), a `changelog/2026-10-DD.md` entry and the board rows. No default-factor change, no
tier chooser.

## Scratch inventory (session scratchpad, not in the repo)

`verify/` (the clone), `wasm-6.0.4/`, `wasm-3.1.74/`, `emsdk-3.1.74/`, `programs/` (145 exported
programs), `GeneratedKernels.regen.cpp`, `release-prep.patch`, `tools/{export-programs-release-compiler.ts,
parity-toolchains.ts,build-3.1.74.sh,os2-peak.ts}`, `logs/01..16-*.log`.

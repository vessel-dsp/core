# Spike: band-limited oversampling ported to the C++/WASM console (2026-10-09)

## Outcome

`V2WasmEngine.prepare({ sampleRate, oversample })` now behaves like
`ReferenceRuntime.prepare(sampleRate, { oversample })`: same solver rate, same
half-band cascades with bit-identical coefficients and statement-for-statement
arithmetic, same held path for factor 1 and non-power-of-two factors, same
`hostSampleRate()` / `oversampleLatency()` readings. Console parity holds
within the existing 1e-4 / 0.9999 bars at x1/os2/os3/os4/os8 on all six
packets; the resampler alone agrees to exactly 0 on impulse and ≤1e-15 on
swept sine; transparency reads ≤0.00092 dB everywhere except one row at
0.00104 dB that the TS reference reproduces to the digit (port exact, bar
marginally missed on the reference itself). Recommendation: **ADOPT** (reason
at the end).

## What changed (the diff; wasm binary gitignored, never committed)

New files:

- `packages/runtime/src/cpp/include/v2/Resample.h`, `packages/runtime/src/cpp/Resample.cpp` —
  exact C++ port of `src/resample.ts` (the fixed reference): `besselI0`,
  `designHalfBand2x` (same validation messages), `HalfBandStage2x`
  (`interpolate`/`decimate`, newest-first histories, same accumulation order),
  `cascadeLatencyHostSamples`, plus the shared `resamplePrototype()` singleton
  every stage is built from. Double precision end to end.
- `packages/runtime/tests/v2-wasm-oversample.test.ts` — 9 tests (below).

Edited files (nothing else touched; solver, schedule, pivot, op-amp pole,
worklet protocol and ChainRuntime code untouched):

- `packages/runtime/src/cpp/include/v2/Engine.h` — `EngineOptions.oversample`
  (default 1, documented as host property); `Engine::hostSampleRate()` /
  `Engine::oversampleLatency()` (-1.0 when unprepared, mirroring the TS null);
  private cascade/scratch/latency state; `solveSubSample` /
  `processHeldSample` / `processResampledSample` declarations.
- `packages/runtime/src/cpp/Engine.cpp` — `prepare()` clamps the factor,
  multiplies the solver rate (host × factor), builds fresh zero-state cascades
  plus factor-sized scratch for powers of two ≥ 2 (bitwise exact power check,
  no `log2` float); `reset()` zeroes stage histories; `processSample()` /
  `processBlock()` dispatch to the held or resampled per-host-sample body
  sharing one extracted `solveSubSample` body (the old loop moved verbatim,
  so factor 1 executes the same operations in the same order). Per-solve
  telemetry (`lastIterationCount_`, `lastConverged_`) therefore reads the last
  sub-sample while `maxIterationsObserved_` accumulates every one — the C++
  analogue of the reference's last-sub-sample-out census, stated in the code.
- `packages/runtime/src/cpp/V2Exports.cpp` — **`v2_engine_prepare` signature
  changed** (not added alongside): `(handle, sampleRate, maxNewtonIterations,
  inputSourceOhms, oversample int32)`; new `v2_engine_get_host_sample_rate`
  and `v2_engine_get_oversample_latency` (double; -1.0 unprepared); test-only
  `v2_resample_prototype_length` / `v2_resample_prototype_tap` (bit-for-bit
  coefficient assertion) and `v2_testonly_resample_create` / `_reset` /
  `_process` / `_destroy` (circuit-free cascade round-trip: up-cascade,
  identity, down-cascade). The only in-repo caller of the native prepare was
  the TS wrapper, updated in the same diff; the worklet calls the wrapper with
  `{ sampleRate }` and keeps factor 1.
- `packages/runtime/src/v2-wasm-engine.ts` — `prepare` gains optional
  `oversample` (default 1; floor/clamp/non-finite refusal with the reference's
  exact message via `RuntimeError`); new `hostSampleRate()` /
  `oversampleLatency()` with the TS names, semantics, and null-before-prepare.
- `packages/runtime/scripts/build-wasm.sh` — adds `Resample.cpp` and the six
  new exports to `EXPORTED_FUNCTIONS`.

Tests: `packages/runtime/tests/v2-wasm-oversample.test.ts` (9 tests, all
skip-by-name when `src/wasm/` is absent per `wasm-presence.ts`): prototype
taps bit-for-bit (all 57 via `Object.is`); factor validation incl. NaN/Inf
refusal, 0-clamp and 2.7-floor; host/latency at 1/2/4/8, legacy-3-is-zero plus
length, null-before-prepare; block-split bit-identity at 1/2/3/4/8 on the
nonlinear clipper (1×4800 vs 2×2400 vs 10×480 vs 4800×1 vs 37×128+64, float
transport); process_sample/process_block bit agreement at every factor;
reset/prepare state clearing at 2/4/8; parity within bars at 1/2/3/4/8;
cascade-alone ≤1e-12 (impulse + 100/1k/8k/19k sines, 1/2/3 stages);
transparency osN-vs-native on the RC fixture. `tests/public-surface.test.ts`
needed **no change**: the wrapper option is optional, the methods additive,
every existing assertion passes unmodified (verified in the clone run).

## 1. Baseline FIRST (before any C++ edit)

Build (this branch unchanged, emsdk em++ 6.0.4):

```
source ~/projects/emsdk/emsdk_env.sh
bun run build:wasm   # packages/runtime: bash scripts/build-wasm.sh
# em++ -O3 -msimd128 -std=c++17 -fwasm-exceptions, explicit EXPORTED_FUNCTIONS
```

- `src/wasm/v2_dsp.wasm`:
  `069c5108cb4240cf123c5567b3a8e9b28bbdb860be867fef978c56a2fe6a2a79`
- `src/wasm/v2_dsp.cjs`:
  `de6cf1d753e0e4fb1abc80cf9af1fb69c38381d1ea007b7ebed0cd6d31f52b87`
- Both reproduce bit-identically from a fresh clone (§10) — the toolchain is
  deterministic, so hash equality below is meaningful.

Factor-1 WASM renders (`/tmp/osr-wasm/baseline.ts`: 1 kHz 10 mV peak, 1 s at
48 kHz, study controls after prepare, `inputSourceOhms: 94`, 512-frame
`processBlock` calls; sha256 over raw float32 output bytes):

| pedal | WASM x1 sha256 | TS x1 sha256 | TS↔WASM max abs |
|---|---|---|---|
| muff | `4303e23b…02fd9c` | `acf3ed8d…6520c1a` | 1.8e-9 |
| sd1 | `3afad366…563ae8` | `85f286e2…12d6ec` | 8.3e-6 |
| ts9 | `54249f62…afee2e` | `a28ea636…40525e` | 2.8e-5 |

(Full hashes in `/tmp/osr-wasm/baseline-summary.json`; first-8 samples and RMS
there too. The sd1/ts9 TS↔WASM gaps are pre-existing libm-level systematic
offsets, inside the 1e-4 bar — see §3.)

Probe reproduction (`/tmp/osr-wasm/probe-repro.ts`, line-for-line copy of the
saved probe's fit/drive, SD-1 10 mV at 1/4/8/16 kHz vs saved `sd1-fr.json`):

| hz | x1 | n192 | os2 | os4 |
|---|---|---|---|---|
| 1000 | 0.00000 | 0.00000 | 0.00268 | 0.00308 |
| 4000 | 0.00000 | 0.00000 | 0.03446 | 0.03026 |
| 8000 | 0.00000 | 0.00000 | 0.22621 | 0.20771 |
| 16000 | 0.00000 | 0.00000 | 1.49389 | 1.29669 |

(dB of repro fundamental vs saved.) x1/n192 reproduce to 0.00000 dB: the
harness IS the probe and the legacy path is untouched by both merged parents.
os2/os4 differ from the saved JSONs **as they must**: the saved rows are the
old hold path; this branch carries the band-limited resampler. The real check
is osN-vs-native on the new code: repro os4-vs-n192 reads +0.00026/+0.00038/
+0.00048/+0.00015 dB at 1/4/8/16 kHz — the spike's transparency result
reproduced on the merged tree before the port (the pivot merge moves os4 at
16 kHz by 1.3 dB vs the spike branch — adjudicated in §7, it is the
settle-at-solver-rate re-pivot improving sparse-vs-dense 6.8e-8 → 5.1e-12,
measured, not asserted).

## 2. Implementation + rebuild

Port as specified (§Outcome for the file list). Rebuild with the identical
command:

- `src/wasm/v2_dsp.wasm`:
  `74c25e2b37555c55b234afbf16d725b19a12e50e01f781839fa88ee3c01a8423`
- `src/wasm/v2_dsp.cjs`:
  `a7469e392e6466d79dafe3c71a99c1a0fd38b4578ff1b924d1ecb2e756d662e9`
- Rebuilt in the fresh clone to the same bytes (§10). No new configuration
  beyond the integer factor; no knob shipped, none needed (prototype fixed by
  the 0.4/0.6 fs spec, same as the spike).

## 3. Controls, both directions

Harness for (b): `/tmp/osr-wasm/parity-os.ts` — the workbench parity method
copied verbatim (440 Hz @0.25 + 1320 Hz @0.1, cap 1024, settle 100 / window
2048; long leg 8000/24000), plus relative RMS. Both consoles same cap, same
controls (study controls for muff/sd1/ts9, defaults for ts808/gro100/
blue-box). Bars: r ≥ 0.9999 AND maxDelta < 1e-4 (silent: delta only).

(a) Factor 1 bit-identical (new WASM vs baseline WASM, same stimulus as §1):
**identical hashes on all three pedals** (`4303e23b…`, `3afad366…`,
`54249f62…` — full hashes §1). The legacy path survives the refactor
bit-for-bit: "nothing changed" has a hash.

(b) Console parity WASM-vs-TS, short window (maxDelta / relRms; all PASS):

| pedal | x1 | os2 | os3 (held) | os4 | os8 |
|---|---|---|---|---|---|
| muff | 3.6e-12 / 5.0e-12 | 2.6e-12 / 6.0e-12 | 7.3e-12 / 1.1e-11 | 4.0e-12 / 7.9e-12 | 6.6e-12 / 1.0e-11 |
| sd1 | 7.7e-6 / 4.4e-5 | 7.7e-6 / 4.4e-5 | 7.7e-6 / 4.4e-5 | 7.8e-6 / 4.4e-5 | 7.8e-6 / 4.4e-5 |
| ts9 | 2.7e-5 / 1.7e-4 | 2.7e-5 / 1.7e-4 | 2.7e-5 / 1.7e-4 | 2.7e-5 / 1.7e-4 | 2.7e-5 / 1.7e-4 |
| ts808 | 5.6e-10 / 7.4e-10 | 5.9e-10 / 1.1e-9 | 1.0e-9 / 1.7e-9 | 1.1e-9 / 1.8e-9 | 4.0e-9 / 4.6e-9 |
| gro100 | 3.8e-11 / 5.9e-11 | 2.1e-11 / 3.2e-11 | 1.9e-11 / 2.8e-11 | 1.4e-11 / 2.4e-11 | 9.7e-12 / 1.7e-11 |
| blue-box | 4.1e-15 / 1.5e-14 | 4.7e-5 / 2.1e-4 | 3.6e-7 / 1.3e-6 | 3.1e-15 / 7.8e-14 | 1.2e-15 / 2.7e-14 |

All 30 rows PASS (r = 1.000000 throughout). The sd1/ts9 rows carry the
pre-existing systematic TS↔WASM offsets (§1), flat across factors — the
resampler adds nothing measurable. Blue-box swings (4e-15 → 4.7e-5 → 3.6e-7
→ 3e-15 → 1.2e-15) are that packet's chaotic trajectory, still inside the
bars at every factor.

Resampler alone (test-only cascade, no circuit; impulse + 100/1k/8k/19k Hz
swept sine vs identically-wired TS stages, 1/2/3 stages): impulse agrees to
**exactly 0.0** at every stage count; swept sine ≤1e-15 relative (bar
1e-12). Coefficients: all 57 taps `Object.is`-equal (`bun test
packages/runtime/tests/v2-wasm-oversample.test.ts`).

Long window (8000/24000, os4): muff/sd1/ts9/ts808/blue-box PASS
(maxDelta 5.3e-12 / 6.3e-7 / 9.3e-7 / 1.4e-9 / 2.0e-7). **gro100 FAILs**
(r = 0.999806, maxDelta 5.07, relRms 1.9e-2) — adjudicated as pre-existing:
x1 long-window fails identically (r = 0.998906, maxDelta 13.0) on the
byte-proven legacy path; TS-vs-TS is bit-deterministic (maxDelta 0.0);
chunked profile shows ~1e-10 agreement for 22 k samples then a discrete snap
at ~21.9 k (TS telemetry: 4 non-converged samples, peak 1024 — a Newton
cap-hit event one console takes and the other doesn't after 1e-10 libm
noise). Same class as the pivot report's cap-storm lottery gaps. Reported as
FAIL with mechanism, not folded away.

(c) Transparency on the WASM console (`/tmp/osr-wasm/transparency-wasm.ts`:
probe method, both legs WASM, osN@48k vs native 48k·N): dB of os-vs-native
fundamental —

| pedal | hz | os2-vs-n96 | os4-vs-n192 | os8-vs-n384 |
|---|---|---|---|---|
| sd1 | 1k / 4k / 8k / 16k | 0.00020 / 0.00013 / 0.00034 / -0.00023 | 0.00026 / 0.00038 / 0.00048 / 0.00015 | 0.00028 / 0.00058 / 0.00073 / 0.00031 |
| muff | 1k / 4k / 8k / 16k | 0.00016 / 0.00019 / 0.00047 / -0.00028 | 0.00022 / 0.00056 / 0.00067 / 0.00020 | 0.00023 / 0.00085 / **0.00104** / 0.00039 |
| ts9 | 1k / 4k / 8k / 16k | 0.00026 / 0.00017 / 0.00042 / -0.00027 | 0.00034 / 0.00048 / 0.00059 / 0.00019 | 0.00036 / 0.00073 / 0.00092 / 0.00038 |

35 of 36 rows ≤ 0.001 dB. The muff@8k/os8 row reads 0.00104 — over by 4e-5
dB — and the TS reference console reads **identically 0.00104 dB** on the
same comparison (`/tmp/osr-wasm/ts-adjudicate.ts`; WASM os8 fund
0.0025314960916 vs TS 0.0025314960824, relative 3.6e-12): the port is exact
to the digit and the residual is the reference's own transition-band answer
at a 2.5 µV fundamental, not a port defect. (During adjudication a scratch
script briefly read NaN from an 8-harmonic fit above Nyquist — a harness bug,
hardcoded nh=8; fixed, engine outputs verified finite with clean telemetry.)

(d) The check can fail. Temporary patch (take the newest sub-sample instead
of decimating; Engine.cpp sha `3dcfc7fc…` saved before, restored after —
verified identical hash and zero marker text, rebuilt wasm back to
`74c25e2b…` deterministically): (b) at os4 fails on **all six packets**
(muff r 0.295 relRms 1.18; sd1 r 0.092 relRms 1.36; ts9 r 0.187; ts808 r 0.179;
gro100 r 0.9995 maxDelta 5.2e-3 = 50× over bar; blue-box r 0.865) — the
mechanism is unfiltered solver harmonics folding at full level. (c) fails 9×
over bar on sd1@8k (0.009 vs 0.001); muff/rcLowPass fundamental rows do not
move — expected and consistent with the parent spike (a pure tone survives
any decimation phase; folds land off the fundamental), which is why (b)'s
wideband correlation is the discriminating leg. Reverted, rebuilt, parity
re-PASSed and the 9 in-repo tests re-green — the control was demonstrated,
not left in the tree.

(e) Block-size invariance and process_sample/process_block agreement: pinned
bit-exact in-repo (splits 1×4800/2×2400/10×480/4800×1/37×128+64 at 1/2/3/4/8
on the clipper; float32-quantized sample path vs block path `ToBe`-equal at
every factor). (f) reset/prepare clearing: render→reset→render and
render→prepare→render bit-equal at 2/4/8 in-repo.

## 4. Acceptance

| criterion | result |
|---|---|
| (a) exact (factor 1 bit-identical to baseline) | **PASS** — three identical hashes |
| (b) within parity bars every factor/row; resampler-alone ≤1e-12 | **PASS** short-window 30/30; long-window 5/6 with gro100 FAIL adjudicated pre-existing (x1 fails identically, mechanism evidenced); resampler-alone exact-0/≤1e-15 |
| (c) ≤0.001 dB | **MARGINAL** — 35/36; muff@8k/os8 0.00104 reproduced to the digit on the TS reference (port exact; bar missed on the reference itself) |
| (d) demonstrated | **PASS** — (b) catastrophic everywhere, (c) 9× over on sd1@8k, reverted |
| (e)(f) exact | **PASS** — bit-equality in-repo |
| hostSampleRate()/oversampleLatency() at 1/2/4/8 and held-3 | **PASS** — 48000 and 0/27.5/41.25/48.125 on both consoles, null→null unprepared, os3 latency 0 length preserved |

## 5. Pivot × oversample interaction (measured, was flagged-not-measured)

TS (`/tmp/osr-wasm/pivot-os.ts`, sparse-vs-dense, 2400+9600 host samples,
1 kHz @0.1 V, cap 64, default controls) and WASM engine counters
(`/tmp/osr-wasm/wasm-sched.ts`):

| packet | os1 | os2 | os4 | os8 |
|---|---|---|---|---|
| boss-sd-1 (study variant) | TS kept, 6.8e-8; WASM repiv 1 | TS kept, 3.4e-8; WASM kept | TS repiv [analog:0], 5.1e-12; WASM repiv 1 | TS repiv [analog:0], 5.9e-12; WASM repiv 1 |
| boss-od-1 | kept, 1.8e-10; WASM kept | kept, 1.6e-10; kept | kept, 2.2e-10; kept | kept, 1.6e-10; kept |
| boss-hm-2 | kept, 5.8e-9; kept | kept, 5.8e-9; kept | kept, 1.6e-9; kept | kept, 4.1e-9; kept |
| trainwreck-express | kept, 2.6e-8; kept | kept, 3.3e-8; kept | kept, 4.3e-8; kept | kept, 5.8e-8; kept |

Zero dropped, zero abandoned, zero mid-run fallbacks on either console at any
factor (fb=0 on 20k–350k solves). Only sd-1's `analog:0` moves: the 1x
shipped order (6.8e-8 on this variant/controls) is re-pivoted at the os4/os8
operating point on both consoles, landing at ~5e-12 — the settle rule working
as designed under the rate change, improving agreement. (WASM repivots sd-1
at os1 where TS keeps: the pivot report's §9 noise-dominated bar — the two
libms sit on opposite sides of it below ~1e-8 — while parity still passes at
7.7e-6. Neither side regresses.) This interaction explains the §1 os-row
movement vs the spike branch: it is the pivot merge, not the resampler.

## 6. Public-surface changes (flagged for the owner)

1. **Native `v2_engine_prepare` changed, no second export** (deliberate,
   per brief): +`int32_t oversample`. Only caller was the TS wrapper.
2. **New native exports** `v2_engine_get_host_sample_rate`,
   `v2_engine_get_oversample_latency` (double; -1.0 unprepared, documented in
   `Engine.h` and `V2Exports.cpp`).
3. **Test-only native exports** `v2_resample_prototype_{length,tap}`,
   `v2_testonly_resample_{create,reset,process,destroy}` — linked into the
   binary (6 names in `EXPORTED_FUNCTIONS`) but not shipping surface; documented
   as such at the declaration sites.
4. **Wrapper**: `prepare` options gain optional `oversample` (default 1, same
   validation/message as the reference); new `hostSampleRate()` /
   `oversampleLatency()` (TS names/semantics, null unprepared).
5. `tests/public-surface.test.ts`: **unchanged** — nothing in it legitimately
   moves (optional option, additive methods; all its assertions pass as-is).
6. Doc debt (not in diff, owner to decide on adopt): `packages/runtime/README.md`
   still documents the OLD hold path ("no band limiting decimator is
   implemented", stale since the parent spike) and its `V2WasmEngine.prepare`
   line lacks `oversample` and the two new readers.

No knob shipped; none needed. `elapsedSamples()` now counts sub-samples with
`options_.sampleRate` the solver rate — the TS `elapsedSamples`/`sampleRate`
model exactly (tap intervals, shift detectors and delay sizings stay
seconds-correct); the value is not exported to JS.

## 7. Cost (reported, not a gate)

`/tmp/osr-wasm/cost.ts`: 1 kHz 10 mV, 1 s, cap 1024, `process()`-only, median
of 5 interleaved repeats per factor; resampler share via the identical cascade
operations without the solver; Newton census from `telemetry()` (TS exact)
and `getMaxIterations()` + per-host last-sub-sample sampling on WASM (peak
exact; mean/non-converged labeled proxies — the WASM surface has no totals;
the proxy tracks TS mean/sub to 0.01 on muff/sd1/ts9/ts808).

ns per host sample (xRT-equiv = /20833 ns; resampler ns; peak/mean-host/mean-sub/nonconv):

| pedal | | x1 | os2 | os4 | os8 |
|---|---|---|---|---|---|
| muff TS | ns (xRT) / res / peak / mHost / mSub / nc | 41212 (1.98) / 0 / 6 / 3.04 / 3.04 / 0 | 70209 (3.37) / 87 / 4 / 5.10 / 2.55 / 0 | 133811 (6.42) / 443 / 3 / 9.42 / 2.35 / 0 | 242088 (11.62) / 855 / 3 / 16.91 / 2.11 / 0 |
| muff WASM | | 8530 (0.41) / 0 / 6 / 3.04 / — / 0 | 14747 (0.71) / 65 / 4 / 2.54 / — / 0 | 28110 (1.35) / 167 / 3 / 2.37 / — / 0 | 51495 (2.47) / 350 / 3 / 2.12 / — / 0 |
| sd1 TS | | 38759 (1.86) / 0 / 4 / 2.75 / 2.75 / 0 | 64402 (3.09) / 88 / 3 / 4.87 / 2.44 / 0 | 114696 (5.51) / 381 / 3 / 8.65 / 2.16 / 0 | 207056 (9.94) / 889 / 3 / 16.10 / 2.01 / 0 |
| sd1 WASM | | 16006 (0.77) / 0 / 4 / 2.75 / — / 0 | 28373 (1.36) / 64 / 3 / 2.48 / — / 0 | 50970 (2.45) / 150 / 3 / 2.17 / — / 0 | 95511 (4.58) / 336 / 3 / 2.02 / — / 0 |
| ts9 TS | | 27586 (1.32) / 0 / 3 / 2.08 / 2.08 / 0 | 51733 (2.48) / 86 / 2 / 4.00 / 2.00 / 0 | 103068 (4.95) / 398 / 2 / 8.00 / 2.00 / 0 | 204794 (9.83) / 855 / 2 / 16.00 / 2.00 / 0 |
| ts9 WASM | | 5253 (0.25) / 0 / 3 / 2.08 / — / 0 | 10266 (0.49) / 64 / 2 / 2.00 / — / 0 | 20808 (1.00) / 157 / 2 / 2.00 / — / 0 | 41467 (1.99) / 329 / 2 / 2.00 / — / 0 |
| ts808 TS | | 30158 (1.45) / 0 / 3 / 2.44 / 2.44 / 0 | 52489 (2.52) / 85 / 3 / 4.31 / 2.16 / 0 | 100651 (4.83) / 411 / 3 / 8.12 / 2.03 / 0 | 188496 (9.05) / 887 / 2 / 16.00 / 2.00 / 0 |
| ts808 WASM | | 5701 (0.27) / 0 / 3 / 2.44 / — / 0 | 10409 (0.50) / 65 / 3 / 2.17 / — / 0 | 19792 (0.95) / 154 / 3 / 2.02 / — / 0 | 38522 (1.85) / 341 / 2 / 2.00 / — / 0 |
| gro100 TS | | 464655 (22.30) / 0 / 1024 / 7.19 / 7.19 / 141 | 657701 (31.57) / 89 / 1024 / 9.68 / 4.84 / 140 | 914349 (43.89) / 418 / 1024 / 13.02 / 3.26 / 105 | 1457195 (69.95) / 950 / 1024 / 19.42 / 2.43 / 46 |
| gro100 WASM | | 96776 (4.65) / 0 / 1024 / 7.58 / — / 166 | 136179 (6.54) / 66 / 1024 / 4.57 / — / 70 | 196577 (9.44) / 165 / 1024 / 3.42 / — / 33 | 306084 (14.69) / 378 / 1024 / 2.45 / — / 7 |
| blue-box TS | | 35193 (1.69) / 0 / 1024 / 4.04 / 4.04 / 1 | 65570 (3.15) / 87 / 44 / 7.73 / 3.86 / 0 | 103995 (4.99) / 385 / 169 / 12.76 / 3.19 / 0 | 160110 (7.69) / 899 / 102 / 19.59 / 2.45 / 0 |
| blue-box WASM | | 5022 (0.24) / 0 / 1024 / 4.04 / — / 1 | 9221 (0.44) / 64 / 44 / 3.27 / — / 0 | 15889 (0.76) / 180 / 169 / 3.07 / — / 0 | 25320 (1.22) / 338 / 102 / 2.37 / — / 0 |

WASM/TS ratio per factor: muff 0.21 flat; sd1 0.41→0.46 (interpreter path —
no kernel match — on both sides' schedules); ts9/ts808 0.19–0.20; gro100
0.21; blue-box 0.14–0.16. TS muff/sd1 figures reproduce the parent spike's
§6 (ns within noise; peak/mean/nonconv exact). Peaks fall with rate on the
pedals (6→3, 4→3); mean/sub falls everywhere; oversampling stabilizes
blue-box (peak 1024→44, nonconv 1→0) and halves gro100's non-converged
count per doubling. Resampler share: ≤0.35% TS, ≤0.68% WASM (muff os8 the
max) — accuracy-first buys this for free on both consoles.

Over a 20.8 µs (1.0 xRT) budget **on this machine, in-process, not a worklet
claim**: WASM exceeds at muff os4/os8; sd1 os2/os4/os8; ts9 os8; ts808 os8;
gro100 all factors; blue-box os8. Within budget: muff x1/os2; sd1 x1; ts9
x1/os2/os4; ts808 x1/os2/os4; blue-box x1/os2/os4. (TS exceeds everywhere
except nothing — cheapest TS row is ts9 x1 at 1.32 xRT.)

## 8. What this cannot prove

- Native 48k·N stands in for analog truth (inherited bound from the parent
  spike: agreement-with-192 kHz is agreement-with-ngspice only inside its
  0.04–0.59 dB substitution bounds).
- Three pedals at centre controls, stepped sines (10 mV; 100 mV only in the
  parent spike's aliasing rows, not re-run here), plus three corpus packets at
  default controls on a two-tone stimulus. No chords, plucks, swept controls,
  sustained high-gain clipping where changed input spectra meet heavy Newton
  limiting, no listening test.
- Timing is a dev-machine ratio table (bun 1.3.14, shared noise), not a
  worklet budget claim; WASM in-process is 2–7× faster than TS in-process and
  neither is the AudioWorklet.
- WASM mean-iteration/non-converged figures are last-sub-sample proxies (the
  WASM surface exposes no totals); peaks are exact.
- Transition-band folds are only partially suppressed (inherited honest
  limitation); content that must survive above ~19 kHz at a 48 kHz host pays
  the half-band transition droop.
- The shipped default is still factor 1: nothing changes for any existing
  caller until one passes `oversample`. Non-power-of-two factors keep the
  legacy path (os3 measured: parity PASS, latency 0, length preserved).

## 9. Recommendation: ADOPT

The port is general (every circuit; coefficients from the stage alone; factor
from the host; no per-packet gate, no new `.vdsp` field), accuracy-first
(resampler ≤0.7% on the shipping console), latency reported not hidden, exact
where exactness is checkable (coefficients bit-identical, x1 hashes
identical, cascade-alone exact-0, transparency digits identical to the
reference including its one marginal row), and discriminated by a failing
control that was demonstrated and reverted. The two marginal rows (muff
0.00104, gro100 long-window) are both evidenced to live on the reference /
pre-existing side of the port boundary. Suggested default factor stays an
owner decision (the parent spike's data says 4); this task only proves the
WASM console reproduces the reference at every factor. If the README's stale
oversample line and the new prepare surface want documenting, that is a
follow-up, not part of this diff.

## 10. Verification (fresh clone `/tmp/wv-verify`, branch
`indiejoseph/warp-oversample-wasm` at d1531c5)

| step | base (no wasm) | base + wasm | patched + wasm |
|---|---|---|---|
| `bun install --frozen-lockfile` | 411 pkgs OK | — | — (same tree) |
| `bun run typecheck` | 0 errors | — | 0 errors |
| `bun run build:wasm` (emsdk, same command) | — | `069c5108…` (== §1 worktree build) | `74c25e2b…` (== §2 worktree build) |
| `bun run build` | fails at `cp -r src/wasm` (pre-existing, as 2026-10-08) | — | green, entrypoints ok |
| `bun test` | 1946 pass / 5 fail (missing-wasm-module, as expected) | 1973 pass / 0 fail | **1982 pass / 0 fail, 140 files** (incl. the 9 new tests, verified RUN: `bun test packages/runtime/tests/v2-wasm-oversample.test.ts` → 9 pass) |
| `bun run build:pages` | 872 pages OK | — | 872 pages OK |

`scripts/worklet-proof.ts` (worktree, after `bun run build`,
`NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules`,
headless Chromium 149.0.7827.55) at factor 1: **PASS** — worklet-vs-chain
1.102e-8 (bar 1e-4) with and without `structuredClone`; vs-reference
6.218e-3 (documented DC-blocker baseline); bun legs wasm-vs-ref 4.344e-9.
The native signature change does not reach the worklet (wrapper default 1).

Exact commands (bun 1.3.14; worktree src imports; scratch in `/tmp/osr-wasm/`):

```
source ~/projects/emsdk/emsdk_env.sh; bun run build:wasm   # §1 (§2 identical)
bun /tmp/osr-wasm/baseline.ts       # §1 hashes (before AND after: identical)
bun /tmp/osr-wasm/probe-repro.ts    # §1 SD-1 os-row reproduction
bun /tmp/osr-wasm/pivot-os.ts 1|2|4|8   # §5 TS interaction
bun test packages/runtime/tests/v2-wasm-oversample.test.ts  # 9 pass
bun /tmp/osr-wasm/parity-os.ts [os] [window] [settle] [packet]  # §3b
bun /tmp/osr-wasm/transparency-wasm.ts [pedal]  # §3c
bun /tmp/osr-wasm/ts-adjudicate.ts  # §3c muff-8k reference twin
bun /tmp/osr-wasm/gro100-profile.ts # §3b gro100 adjudication
bun /tmp/osr-wasm/cost.ts [packet] [os]  # §7
bun /tmp/osr-wasm/wasm-sched.ts     # §5 WASM counters
git clone --branch indiejoseph/warp-oversample-wasm . /tmp/wv-verify  # §10
  (base sequence, then) git apply /tmp/osr-wasm/port.patch + 3 new files
NODE_PATH=.../workbench/node_modules bun packages/runtime/scripts/worklet-proof.ts
```

Beside every figure: harness, window, controls and cap as captioned above;
proves small-signal response parity, resampler transparency and cost ratios
on the stated packets — not large-signal clipping shape, chords, control
sweeps, audibility, or worklet timing.

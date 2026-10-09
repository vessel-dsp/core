# Spike follow-up: stage-specific resampler ported to the C++/WASM console (2026-10-09)

## Outcome

`Engine::prepare` now builds one freshly designed half-band prototype **per 2x stage**
from the stage table `[41, 6.0] / [29, 7.0] / [21, 6.0]` (stages past the table reuse the
last entry), `cascadeLatencyHostSamples(stages)` sums per stage exactly as the TS
reference, and the test-only getters expose per-stage coefficients. The two consoles
agree again: the in-repo parity test
("agrees with the reference console within the parity bars at every factor") is green
at 1/2/3/4/8/16 **without weakening its bars**; cascade-alone is bit-exact (impulse
exactly 0, swept sine relative exactly 0.0); factor-1 WASM renders are bit-identical
to the pre-change binary on all three study pedals. Two honest deltas vs the previous
port report: blue-box os2 short-window parity reads 1.012e-4 (1.2% over the 1e-4 bar,
mechanism evidenced below), and pedal transparency residuals are the AB reference's own
answer (worst 0.0075 dB at 16 kHz os2, TS-twinned digit-identical), not the old 57-tap
bar. Recommendation: **ADOPT** (reason at the end).

## What changed (the diff; wasm binary gitignored, never committed)

7 files, 189 insertions / 88 deletions. No TS source touched, no solver / schedule /
pivot / op-amp / worklet / protocol change, no version bump:

- `packages/runtime/src/cpp/include/v2/Resample.h` — `kResampleHalfBandTaps` /
  `kResampleKaiserBeta` / `resamplePrototype()` replaced (not kept beside) by
  `ResampleStageSpec`, `kResampleStageSpecs` (`{41,6.0},{29,7.0},{21,6.0}`),
  `kResampleStageSpecCount`, and `resampleStageSpec(index)` with the reference's
  clamp-to-last rule (negative index throws; the reference fails there too).
  `designHalfBand2x` keeps the `(57, 8.3)` defaults as the parity anchor.
  `cascadeLatencyHostSamples(stages, taps)` becomes `(stages)`, refuses stages < 1
  like the TS, and sums `(2C_s-1)/2^(s+1)` per stage in stage order.
- `packages/runtime/src/cpp/Resample.cpp` — singleton deleted; latency loop mirrors
  the reference's operation order (all values dyadic-exact: 19.5 / 26.25 / 28.625,
  then +19/16, +19/32).
- `packages/runtime/src/cpp/Engine.cpp` — `prepare()` designs one fresh prototype
  per stage with the same algorithm (same `besselI0` series + early-out, window loop,
  odd-tap normalisation order); `reset()` still zeroes every stage (loop, unchanged).
- `packages/runtime/src/cpp/V2Exports.cpp` — test-only getters are now per-stage:
  new `v2_resample_stage_count`, `v2_resample_prototype_length(stage)`,
  `v2_resample_prototype_tap(stage, index)` (negative stage reads 0 taps / NaN, as
  out-of-range taps always did); `v2_testonly_resample_create(stages)` builds each
  stage from its own spec (clamp-to-last past the table, so 4 stages = os16 works).
- `packages/runtime/scripts/build-wasm.sh` — adds `_v2_resample_stage_count`; no
  name removed (the two prototype getters keep their names with a stage parameter).
- `packages/runtime/tests/v2-wasm-oversample.test.ts` — prototype test pins every
  stage's coefficients `Object.is`-equal to `designHalfBand2x(taps, beta)` (stages
  0..3, so the clamp rule is pinned too); latency table 0 / 19.5 / 26.25 / 28.625 /
  TS(4) / TS(5) at 1/2/4/8/16/32; block-split, sample-vs-block, reset/prepare and
  parity loops extended to 16; cascade-alone at 1..4 stages with impulse `toBe(0)`.
  One bar moved (see §3c): the RC transparency bar 0.001 -> 0.01 dB, re-baselined to
  the adopted AB design with TS-twin evidence in the test comment. The parity test's
  bars (r >= 0.9999, maxDelta < 1e-4) are untouched.

## 1. Build hashes (before / after)

```
source ~/projects/emsdk/emsdk_env.sh; bun run build:wasm   # cwd packages/runtime
```

| binary | before (dc7f16b unchanged, 57-tap) | after (stage-specific) |
|---|---|---|
| `src/wasm/v2_dsp.wasm` | `74c25e2b…01a8423` | `1b98ea79…b1ac6c8` |
| `src/wasm/v2_dsp.cjs` | `a7469e39…756d662e9` | `63fd0d0d…944594fe53` |

Full: before `74c25e2b37555c55b234afbf16d725b19a12e50e01f781839fa88ee3c01a8423` /
`a7469e392e6466d79dafe3c71a99c1a0fd38b4578ff1b924d1ecb2e756d662e9` — byte-identical
to the previous port report's §1/§2 (toolchain deterministic). After
`1b98ea796085ebad24d4fce0683b09f2d8be7c4a958190a8bcde05490b1ac6c8` /
`63fd0d0d0edef9b2c315dd9cdb8811598a91b227f868b636cd9839244594fe53` — reproduced
byte-identically by the fresh-clone rebuild (§7). The detune-control build was
rebuilt over; the revert rebuild returned to these exact bytes (patch hash check §3d).

## 2. Check (a): factor 1 bit-identical (new WASM vs pre-change WASM)

Harness `/tmp/lat-wasm/baseline.ts` (previous worker's script, only the worktree import
prefix retargeted): 1 kHz 10 mV, 1 s at 48 kHz, study controls set after prepare,
`inputSourceOhms: 94`, 512-frame `processBlock`, sha256 over raw float32 bytes.

| pedal | WASM x1 sha256 (new) | identical to pre-change? | TS x1 (unchanged?) | TS<->WASM max abs |
|---|---|---|---|---|
| muff | `4303e23b…02fd9c` | yes, full hash equal | `acf3ed8d…6520c1a` unchanged | 1.8e-9 |
| sd1 | `3afad366…563ae8` | yes | `85f286e2…12d6ec` unchanged | 8.3e-6 |
| ts9 | `54249f62…afee2e` | yes | `a28ea636…40525e` unchanged | 2.8e-5 |

**PASS.** The held path survives the refactor bit-for-bit ("nothing changed" has a hash),
and the TS hashes confirm the reference was not touched.

## 3. Check (b): console parity WASM-vs-TS (workbench method, unmodified)

Harness `/tmp/lat-wasm/parity-os.ts` (workbench
`scripts/test-v2-wasm-parity.ts` method: 440 Hz @0.25 + 1320 Hz @0.1, cap 1024, settle
100 / window 2048; bars r >= 0.9999 AND maxDelta < 1e-4; study controls for
muff/sd1/ts9, defaults otherwise). Short window, maxDelta / relRms:

| pedal | x1 | os2 | os3 (held) | os4 | os8 | os16 (new) |
|---|---|---|---|---|---|---|
| muff | 3.6e-12 / PASS | 2.8e-12 / PASS | 7.3e-12 / PASS | 5.5e-12 / PASS | 5.9e-12 / PASS | 7.5e-12 / PASS |
| sd1 | 7.7e-6 / PASS | 7.7e-6 / PASS | 7.7e-6 / PASS | 7.7e-6 / PASS | 7.8e-6 / PASS | 7.8e-6 / PASS |
| ts9 | 2.7e-5 / PASS | 2.7e-5 / PASS | 2.7e-5 / PASS | 2.7e-5 / PASS | 2.7e-5 / PASS | 2.7e-5 / PASS |
| ts808 | 5.6e-10 / PASS | 6.7e-10 / PASS | 1.0e-9 / PASS | 1.3e-9 / PASS | 2.3e-9 / PASS | 5.0e-9 / PASS |
| gro100 | 3.8e-11 / PASS | 1.9e-11 / PASS | 1.9e-11 / PASS | 1.5e-11 / PASS | 8.6e-12 / PASS | 9.0e-12 / PASS |
| blue-box | 4.1e-15 / PASS | **1.012e-4 / FAIL** | 3.6e-7 / PASS | 2.9e-15 / PASS | 1.0e-15 / PASS | 1.1e-14 / PASS |

(r = 1.000000 on every row, including the FAIL.) Row-by-row vs the previous report:
muff/sd1/ts9/ts808/gro100 rows are unchanged to the digit class at every factor —
the sd1/ts9 pre-existing systematic libm offsets stay flat across factors (the
resampler adds nothing measurable), gro100 short-window stays clean. Blue-box os2 is
the one mover: 4.7e-5 PASS -> 1.012e-4 FAIL, 1.2% over the bar, deterministic across
repeats. Adjudication (`/tmp/lat-wasm/bb-probe.ts`): the divergence is episodic spikes
(worst at sample 305; blocks [256-512] 1.01e-4, [1280-1536] and [3072-3328] 6.7e-5,
all other 256-blocks <= 2.5e-6 decaying to 1e-9..1e-7 between events); TS-vs-TS is
exactly 0; the in-repo cascade-alone test proves the resampler itself bit-exact. Same
mechanism as the report's blue-box swings (chaotic octave-divider trajectory amplifying
sub-threshold libm seed), landing 1.2% over the line on this factor — and os3/os4/os8/
os16 on the same packet read 3.6e-7..1.1e-14, which a systematic resampler defect would
not do. Reported as a marginal FAIL with mechanism, not folded away. The in-repo
parity test (clipper circuit, unweakened bars) is green at all six factors.

Long window (8000/24000, os4): gro100 FAILs (r = 0.999652, maxDelta 6.46) — and x1
FAILs identically (r = 0.998906, maxDelta 13.0, digit-identical to the previous report)
on the byte-proven legacy path. x1 chunk profile: ~1e-10 agreement through 22k samples,
discrete snap in 22k-24k; TS-vs-TS exactly 0. Pre-existing cap-hit lottery, unchanged
in class (exact lottery numbers moved: os4 was r = 0.999806 / 5.07 — a different draw
from a different sub-sample trajectory, expected for a chaotic event).

Resampler alone (test-only cascade vs identically-wired TS stages, 1/2/3/4 stages):
impulse worst **exactly 0** at every stage count; swept sine (100/1k/8k/19k Hz)
worst-relative **exactly 0.0** (bar 1e-12). Coefficients: every stage `Object.is`-equal
(in-repo, stages 0..3 incl. the clamp).

## 4. Check (c): transparency on the WASM console (probe method, both legs WASM)

Harness `/tmp/lat-wasm/transparency-wasm.ts`: osN@48k vs native 48k·N, 10 mV, study
controls, ohms 94, LS fundamental over 0.9-1.7 s. dB of os-vs-native:

| pedal | hz | os2-vs-n96 | os4-vs-n192 | os8-vs-n384 |
|---|---|---|---|---|
| sd1 | 1k / 4k / 8k / 16k | 0.00177 / 0.00053 / 0.00202 / 0.00614 | 0.00171 / 0.00013 / 0.00165 / 0.00448 | 0.00168 / 0.00057 / 0.00020 / 0.00210 |
| muff | 1k / 4k / 8k / 16k | 0.00147 / 0.00077 / 0.00280 / 0.00747 | 0.00141 / 0.00019 / 0.00230 / 0.00565 | 0.00139 / 0.00083 / 0.00022 / 0.00285 |
| ts9 | 1k / 4k / 8k / 16k | 0.00230 / 0.00067 / 0.00250 / 0.00726 | 0.00222 / 0.00017 / 0.00203 / 0.00548 | 0.00218 / 0.00071 / 0.00018 / 0.00276 |

9 of 36 rows meet the old 0.001 dB bar (the old bar was the 57-tap design's number).
TS-twin adjudication (`/tmp/lat-wasm/transparency-ts.ts`, same harness on the reference
console): every twinned row reproduces **digit-identically** — muff/sd1/ts9 @16 kHz all
depths (0.00747/0.00565/0.00285 etc. to all 5 printed digits) and all three pedals @1 kHz
all depths. Untwinned rows share the identical code path while the console gap there is
100-1000x smaller than the residual (parity §3), so the residual cannot be the port.
Cross-check against the latency spike's own TS table (§3a: AB os4-vs-n192 0.0045/0.0056/
0.0055 at 16 kHz): this tree's WASM reads 0.00448/0.00565/0.00548. **The port is exact;
the residual is the adopted AB reference's own answer** (41-tap first-stage ripple),
inside the spike's pedal acceptance (0.1 dB to 8 kHz, 0.3 at 16 kHz) with >= 40x margin.
The marginal muff-8k-os8 row of the previous report (0.00104) now reads 0.00022 — same
class, smaller. The in-repo RC transparency test's bar moved 0.001 -> 0.01 dB for the
same evidenced reason (its worst row now 0.00473, TS-twinned identical); the parity
test's bars were not touched.

## 5. Check (d): the check can fail (detuned stage 2, then reverted)

Temporary patch (stage index 1 built from the shipped 57-tap `designHalfBand2x()`
defaults at both cascade construction sites; table, latency and getters untouched):
cascade-alone impulse reads **0.866** (vs exactly 0) and the parity test fails at
**maxDelta 0.748 vs the 1e-4 bar**; the other 7 in-repo tests still pass (getters read
the table, latency is table-driven, x1/os3 need no stage 2). Reverted and rebuilt:
`git diff` patch hash identical before/after (`8ad28ade…`), wasm bytes back to §1
(`1b98ea79…`), in-repo 9/9 green. The control was demonstrated, not left in the tree.

## 6. Check (e): latency exports

| oversample | WASM `oversampleLatency()` | TS `cascadeLatencyHostSamples` | host rate | unprepared |
|---|---|---|---|---|
| 1 | 0 | — | 48000 | null / null |
| 2 | 19.5 | 19.5 | 48000 | — |
| 4 | 26.25 | 26.25 | 48000 | — |
| 8 | 28.625 | 28.625 | 48000 | — |
| 16 | 29.8125 | 29.8125 | 48000 | — |
| 32 | 30.40625 | 30.40625 | 48000 | — |
| 3 (held) | 0, length preserved | — | 48000 | — |

**PASS** — asserted in-repo with `toBe` (exact doubles), null-before-prepare and the
held-3 row included. os32 exercises 5-stage `prepare()` (export equality); no audio-level
os32 parity run was made (stated gap).

## 7. Check (f): cost (reported, not a gate)

Harness `/tmp/lat-wasm/cost.ts` (previous worker's script; the TS resampler-share
wiring updated to per-stage specs): 1 kHz 10 mV, 1 s, cap 1024, `process()`-only,
median of 5 interleaved repeats; resampler share via the identical cascade operations
without the solver; Newton census exact on TS, last-sub-sample proxies on WASM (peaks
exact, as before). **Load caveat: box load averaged 5-8.6 during these runs** (previous
report ran idle), so absolutes read ~15-30% high; ratios and shares are the robust
columns. WASM ns per host sample (xRT-equiv = /20833 ns; resampler ns; peak / mean-host):

| pedal | x1 | os2 | os4 | os8 |
|---|---|---|---|---|
| ts9 WASM | 6856 (0.33) / 0 / 3 / 2.08 | 11401 (0.55) / 56 / 2 / 2.00 | 23320 (1.12) / 144 / 2 / 2.00 | 47665 (2.29) / 253 / 2 / 2.00 |
| ts808 WASM | 10980 (0.53) / 0 / 3 / 2.44 | 19862 (0.95) / 94 / 3 / 2.17 | 39036 (1.87) / 140 / 3 / 2.02 | 48017 (2.30) / 237 / 2 / 2.00 |
| muff WASM | 9899 (0.48) / 0 / 6 / 3.04 | 17881 (0.86) / 61 / 4 / 2.54 | 32319 (1.55) / 109 / 3 / 2.33 | 58611 (2.81) / 236 / 3 / 2.12 |
| sd1 WASM | 16425 (0.79) / 0 / 4 / 2.75 | 29513 (1.42) / 60 / 3 / 2.48 | 52456 (2.52) / 112 / 3 / 2.15 | 98994 (4.75) / 214 / 3 / 2.02 |

WASM/TS ratios: ts9 0.19-0.21, ts808 0.15-0.20, muff 0.21 flat, sd1 0.36-0.42
(interpreter path on both sides, as before). Newton census reproduces the previous
table's shape (peaks fall with rate; means fall; zero non-converged on these four).
Resampler share <= 0.53% everywhere (prev <= 0.68%) — accuracy-first stays free.
Over a 20.8 us budget **on this loaded machine, in-process, not a worklet claim**:
within — ts9 x1/os2, ts808 x1/os2, muff x1/os2, sd1 x1; over — ts9/ts808/muff
os4/os8, sd1 os2/os4/os8. (Idle, the previous run additionally held ts9/ts808 os4;
the difference is box load, stated so the tables are not miscompared.)

## 8. Check (g): fresh clone (`/tmp/lat-verify`, branch `indiejoseph/warp-latency-spike`)

Clone, apply `/tmp/lat-wasm/port.patch` (the worktree `git diff`, 505 lines), then:

| step | result |
|---|---|
| `bun install --frozen-lockfile` | 411 pkgs OK |
| `bun run typecheck` | 0 errors |
| `bun run build:wasm` (emsdk, same command) | `1b98ea79…` / `63fd0d0d…` — byte-identical to the worktree build |
| `bun run build` | green, dist entrypoints ok |
| `bun test` | **1987 pass / 0 fail, 140 files** (WASM tests RAN: `v2-wasm-oversample` 9/9) |
| `bun run build:pages` | 872 pages OK |

The Belton slow-test flake the previous worker saw did **not** recur (0 fail). The
worktree's own full run reads 1986/1, the 1 being `release metadata > pins…` — the
known pre-existing environmental failure (worktree `dist/` never built here; the clone
with a fresh build passes it). Stash-verified as pre-existing class in the latency
spike's §9; zero new failures from this change.

## 9. What this cannot prove

- Native 48k·N stands in for analog truth (inherited bound: agreement with 192 kHz is
  agreement with ngspice only inside the earlier spike's 0.04-0.59 dB bounds).
- Three pedals at centre controls (max drive only in the inherited aliasing rows, not
  re-run), stepped sines (10 mV; two-tone parity stimulus on six packets), plus the RC
  fixture. No chords, plucks, swept controls, sustained high-gain clipping where changed
  spectra meet heavy Newton limiting, no listening test.
- Timing is a loaded-machine ratio table (load 5-8.6 stated per run), not a worklet
  budget claim; WASM in-process is ~2-7x faster than TS in-process and neither is the
  AudioWorklet. WASM mean-iteration figures remain last-sub-sample proxies (peaks exact).
- Blue-box os2 sits 1.2% over the parity bar (§3: chaotic amplification of libm-level
  seed, evidenced episodic, deterministic). gro100 long-window still fails pre-existing.
- os32 verified by export equality + 5-stage prepare only; no audio-level os32 parity run.
- Transition-band folds stay partially suppressed (inherited honest limitation); content
  above ~19 kHz pays the half-band droop (AB slightly more than the 57-tap design —
  that is what §4 measures).
- Default stays factor 1: nothing changes for existing callers until one passes
  `oversample`. Non-power-of-two factors keep the legacy path (os3 parity PASS, latency
  0, verified again here).

## 10. Recommendation: ADOPT

The port is general (every circuit; coefficients from the stage alone; factor from the
host), accuracy-first (resampler <= 0.53% on the shipping console), latency reported
not hidden (19.5/26.25/28.625/29.8125/30.40625, null-safe), exact where exactness is
checkable (per-stage coefficients bit-identical, x1 hashes identical, cascade-alone
exact-0, transparency digits identical to the reference on every twinned row), and
discriminated by a failing control that was demonstrated and byte-verifiably reverted.
The two over-bar rows (blue-box os2 parity, pedal transparency vs the old 0.001 bar)
are both evidenced to live on the pre-existing-chaos / reference-design side of the
port boundary. The in-repo suite is green with the wasm present (9/9, bars unweakened
except the evidenced transparency re-baselining); the full tree is 1987/0 in a fresh
clone.

Exact commands (bun 1.3.14; worktree src imports; scratch in `/tmp/lat-wasm/`):

```
source ~/projects/emsdk/emsdk_env.sh; bun run build:wasm   # §1 (before AND after)
bun /tmp/lat-wasm/baseline.ts                              # §2 hashes
bun /tmp/lat-wasm/parity-os.ts [os] [window] [settle] [packet]  # §3
bun /tmp/lat-wasm/bb-probe.ts 2                            # §3 blue-box adjudication
bun /tmp/lat-wasm/gro100-profile.ts                        # §3 gro100 adjudication
bun /tmp/lat-wasm/transparency-wasm.ts [pedal]             # §4 WASM legs
bun /tmp/lat-wasm/transparency-ts.ts [pedal] [hz]          # §4 TS twins
bun /tmp/lat-wasm/alone-numbers.ts                         # §3 alone maxima + §6 values
bun /tmp/lat-wasm/cost.ts [packet]                         # §7
git diff > /tmp/lat-wasm/port.patch
git clone --branch indiejoseph/warp-latency-spike /home/joseph/projects/VesselDSP/core /tmp/lat-verify
git -C /tmp/lat-verify apply /tmp/lat-wasm/port.patch
bun install --frozen-lockfile; bun run typecheck            # (clone)
bun run build:wasm; bun run build; bun test; bun run build:pages  # (clone)
```

Beside every figure: harness, window, controls and cap as captioned above; proves
small-signal response parity, resampler transparency and cost ratios on the stated
packets — not large-signal clipping shape, chords, control sweeps, audibility, or
worklet timing.

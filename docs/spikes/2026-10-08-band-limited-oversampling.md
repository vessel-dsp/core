# Spike: band-limited oversampling in @vessel-dsp/runtime (2026-10-08)

## Question

The runtime integrates reactive elements trapezoidally, which warps frequency; at a
48 kHz host the engine droops against native 192 kHz by up to several dB in the
presence band. The existing `prepare(rate, { oversample })` solved at rate\*N but
held each input sample flat across the N sub-samples (zero-order hold) and kept the
last sub-sample (no band-limiting), leaving the hold's own sinc droop and most of
the aliasing. This spike replaces both ends with band-limited half-band FIR
interpolation and decimation (TypeScript `ReferenceRuntime` only), and measures
whether a 48 kHz host at oversample N then behaves like a true N-times-rate
simulation of the band-limited host signal.

Short answer: **yes, to measurement precision. os4 at a 48 kHz host renders
identically to native 192 kHz (<= 0.001 dB) on all three pedals at every test
frequency, and the aliasing residual lands within 2 dB of native 192 kHz (on the
clean side). Recommendation: ADOPT as the accuracy path (reason at the end).**

## What changed

`packages/runtime/src/resample.ts` (new, ~200 lines, no imports):

- `designHalfBand2x(taps = 57, beta = 8.3)`: windowed-sinc (Kaiser) half-band
  lowpass prototype, cutoff 0.25 cycles/sample at the stage's 2x rate. Odd length
  1 mod 4 so the center tap sits on an even index; the window preserves the ideal
  response's exact even-tap zeros, so the center is exactly 0.5, every other even
  tap is exactly 0, and the odd taps are normalized to sum to exactly 1/2 (DC gain
  1 by construction). Coefficients are a function of the stage only, never of the
  circuit. The `beta` parameter exists so the failing control can design a worse
  prototype; the runtime always uses the default.
- `HalfBandStage2x`: one bidirectional 2x stage. `interpolate(x, out, at)` writes
  the delayed input bit-exactly on the even sub-sample (coefficient exactly 1) and
  the filtered midpoint on the odd one (odd taps at gain 2, summing to 1 on DC).
  `decimate(first, second)` consumes a consecutive pair at gain 1. Fixed-size
  newest-first histories, fixed arithmetic order, `reset()` zeroes both.
- `cascadeLatencyHostSamples(stages, taps)`: total group delay in host samples,
  `(2C-1)*(1-2^-stages)` for `C = (taps-1)/2`. The `-1` is the decimation phase:
  each down-stage consumes its pair newest-first, i.e. it decimates the stream
  advanced by one high-rate sample and pulls the center one sample earlier. This is
  derived AND confirmed by an impulse centroid (os2: 27.5) and an aligned
  multi-frequency phase slope (27.50 / 41.25 / 48.12).

`packages/runtime/src/reference-runtime.ts`:

- `prepare()` designs one prototype and builds fresh zero-state up/down stage
  cascades plus scratch buffers when `oversample` is a power of two >= 2
  (`Math.log2` integer check); any other factor leaves the stage arrays empty.
  `prepare()` therefore clears the filter state; there is no `reset()` method on
  `ReferenceRuntime` (the brief's "reset()/prepare()" reduces to `prepare()` here).
- `process()` dispatches per host sample to `processHeldSample()` (the old loop,
  moved verbatim into a method) or `processResampledSample()` (up-cascade, solve
  each sub-sample, down-cascade, one host sample out). Both share one extracted
  `solveSubSample()` body, so factor 1 executes the same operations in the same
  order as before. `samples` and the non-converged counters stay in host samples;
  delay lines, poles and clocks still convert from seconds at the solver rate.
- New read-only method `oversampleLatency(): number | null` (name mirrors
  `hostSampleRate()`, `null` before `prepare()`): 0 on the legacy path,
  27.5 / 41.25 / 48.125 host samples at 2x/4x/8x. **This is the spike's one
  public-API addition** (no new module exports: `resample.ts` is internal, reached
  by tests through `../src/resample` exactly as the existing oversample tests
  reach `../src/reference-runtime`). No configuration beyond the existing
  `oversample` integer; non-power-of-two factors keep the legacy path.
- Untouched: op-amp dominant pole, DC initialisation, Newton machinery, telemetry
  semantics, C++ console (out of scope; the WASM port is a separate later task).

## Harness (read this before quoting any figure)

- Baseline reproduction (`/tmp/osr/baseline.ts`) is a line-for-line copy of the
  saved probe's fit and drive (`workbench/packet-study/oversample-probe/probe.ts`,
  read-only, never modified): `compile` with `pedalPartCatalog`, controls set AFTER
  `prepare` (`SUSTAIN=0.5,TONE=0.5,VOLUME=0.3` muff;
  `Drive=0.5,Tone=0.5,Level=0.3` SD-1/TS-9), `prepare(rate,
  { inputSourceOhms: 94 })`, 0.5 s + 1.5 s stepped sine at **10 mV peak** from
  `t = 0`, least-squares fit of DC + harmonics 1..8 over the 0.9-1.7 s window with
  f0 refined +/-1 Hz in 0.25 Hz steps, 512-sample process blocks. Netlists
  (read-only): `packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp`,
  `packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp`,
  `artifacts/schematics/vessel-dsp/ibanez-ts9-reissue.vdsp` (absolute paths under
  /home/joseph/projects). Aliasing runs: 100 mV, SUSTAIN/Drive = max, 1013 and
  2311 Hz. All harnesses import the worktree `packages/*/src` directly (never a
  dist), all scratch state lives in `/tmp/osr/`; nothing outside this worktree's
  diff and `/tmp` was written.
- Frequencies: 100, 250, 500, 1000, 2000, 3150, 4000, 6300, 8000, 12500, 16000 Hz.
- Determinism: re-running any point reproduces gain to 0.00000 dB (the engine is
  deterministic; the re-applied final diff re-renders the spot-check to 0.00000 dB).

## 1. Baseline reproduction (before anything else)

x1/os2/os4/n192 rows re-rendered with the probe copy vs the six saved JSONs:
**worst fundamental difference 0.0000 dB over all 156 rows** (44+44+44 FR rows,
8+8+8 aliasing rows) -- bit-identical reproduction, inside the 0.05 dB requirement
with the whole budget unspent. (Expected: the code path is unchanged and bun's
Math is deterministic; the value of the check is that the harness is proven to be
the probe before it measures anything new.)

## 2. Resampler alone (before it ever touches a circuit)

Prototype (57 taps, beta 8.3), direct DTFT at the 96 kHz stage rate:

| f (Hz) | 0 | 5000 | 10000 | 15000 | 19200 | 20000 | 24000 | 28800 | 30000 | 40000 |
|---|---|---|---|---|---|---|---|---|---|---|
| gain (dB) | 0.000 | 0.000 | -0.000 | 0.000 | 0.001 | -0.015 | -6.021 | -82.2 | -92.0 | -91.3 |

- Coefficient properties: length 57 (1 mod 4), center exactly 0.5, all other even
  taps exactly 0, sum 1.0000000000000002, odd-tap sum 0.5000000000000001.
- Passband ripple to 0.4\*fs_host (19.2 kHz): worst 0.0007 dB over a 100 Hz grid
  (spec: <= 0.01 dB). Round-trip (up-then-down, 1/2/3 stages) swept-sine gain:
  <= 0.002 dB at every test frequency to 19.2 kHz.
- Stopband beyond 0.6\*fs_host (28.8 kHz): -82.2 dB at 28.8 kHz, worst -82.2 dB
  over 28.8-67.2 kHz on a 200 Hz grid (spec: >= 80 dB). What the folding actually
  needs: decimation folds [24k, 48k] into [0, 24k]; content at/above 28.8 kHz that
  would land at/below 19.2 kHz is killed >= 82 dB. Content in the 24-28.8 kHz
  transition band is only partially suppressed (measured -14.6 dB for a 25.4 kHz
  tone folding to 22.6 kHz in control (e)) -- the honest price of the transition
  band, stated plainly.
- Image rejection (8 kHz sine upsampled, 40 kHz image at 96 kHz): -86 dB.
  Decimation fold rejection (30 kHz tone into the 96->48 kHz stage, 18 kHz fold):
  -92 dB.
- Latency: formula 27.5 / 41.25 / 48.125 host samples at 2x/4x/8x; impulse
  centroid 27.500 / 41.817 / 48.713 (peak at formula-1 for the integer cases);
  aligned phase-slope 27.50 / 41.25 / 48.12. (An earlier unaligned phase-slope
  script disagreed by a constant: its fit window offset aliased into the slope.
  Re-measured with the window aligned to whole periods; the three methods agree.)

## 3. Pedal results: 48 kHz host os2/os4/os8 vs native 192 kHz (10 mV, centre)

dB of each 48 kHz mode against native 192 kHz (fundamental ratio):

Big Muff:

| f (Hz) | 100 | 250 | 500 | 1k | 2k | 3.15k | 4k | 6.3k | 8k | 12.5k | 16k |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x1 | -0.00 | -0.00 | -0.00 | -0.01 | -0.00 | -0.14 | -0.42 | -1.28 | -2.22 | -6.40 | -12.34 |
| os2 (new) | -0.00 | -0.00 | -0.00 | -0.00 | -0.00 | -0.027 | -0.082 | -0.247 | -0.420 | -1.109 | -1.905 |
| os4 (new) | +0.000 | +0.000 | +0.000 | +0.000 | +0.000 | +0.000 | +0.001 | -0.000 | +0.001 | -0.000 | +0.000 |
| os8 (new) | +0.00 | +0.00 | +0.00 | +0.00 | +0.00 | +0.007 | +0.021 | +0.062 | +0.104 | +0.266 | +0.447 |

Boss SD-1:

| f (Hz) | 100 | 250 | 500 | 1k | 2k | 3.15k | 4k | 6.3k | 8k | 12.5k | 16k |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x1 | +0.00 | +0.00 | -0.00 | -0.02 | -0.08 | -0.20 | -0.31 | -0.72 | -1.21 | -2.71 | -4.95 |
| os2 (new) | +0.00 | -0.00 | -0.00 | -0.01 | -0.02 | -0.051 | -0.078 | -0.175 | -0.275 | -0.630 | -0.961 |
| os4 (new) | +0.000 | +0.000 | +0.000 | +0.000 | +0.000 | +0.000 | +0.000 | -0.000 | +0.000 | -0.000 | +0.000 |
| os8 (new) | +0.00 | +0.00 | +0.00 | +0.00 | +0.01 | +0.020 | +0.030 | +0.064 | +0.098 | +0.228 | +0.365 |

Ibanez TS-9:

| f (Hz) | 100 | 250 | 500 | 1k | 2k | 3.15k | 4k | 6.3k | 8k | 12.5k | 16k |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x1 | +0.00 | +0.00 | +0.00 | -0.01 | -0.07 | -0.19 | -0.31 | -0.78 | -1.26 | -3.07 | -5.66 |
| os2 (new) | +0.00 | +0.00 | -0.00 | -0.00 | -0.02 | -0.049 | -0.079 | -0.194 | -0.308 | -0.699 | -1.080 |
| os4 (new) | -0.000 | +0.000 | +0.000 | +0.000 | +0.001 | +0.000 | +0.000 | -0.000 | +0.001 | -0.000 | +0.000 |
| os8 (new) | -0.00 | +0.00 | +0.00 | +0.00 | +0.01 | +0.020 | +0.031 | +0.074 | +0.118 | +0.262 | +0.386 |

The x1 column reproduces the task's stated baseline to 0.01 dB. os4 is
indistinguishable from native 192 kHz (<= 0.001 dB, every pedal, every frequency).
os2/os8 deviate from n192 in opposite directions, and both deviations are solver
warp, not resampler error -- proven by rendering against the matching native rate:

- os2 vs native 96 kHz: 0.000 dB (muff/SD-1/TS-9 at 8/12.5/16 kHz).
- os8 vs native 384 kHz: <= 0.001 dB (same points).
- Hence osN === native (48k\*N) to <= 0.001 dB at every factor: the resampler is
  transparent, and every remaining os-vs-n192 number above is the trapezoid-warp
  delta between solving at 48k\*N and solving at 192 kHz. os8 moves *past* n192
  toward analog truth (it solves at 384 kHz), which is why it reads +0.1..0.45 dB
  against n192 at the top -- more accurate, not less.

## 4. Aliasing (100 mV, high drive)

Residual outside DC + first 8 harmonics, in dBc (lower = cleaner):

| case | x1 | os2 | os4 | os8 | n192 |
|---|---|---|---|---|---|
| SD-1 1013 Hz | -44.49 | -44.24 | -43.87 | -43.74 | -43.84 |
| SD-1 2311 Hz | -30.43 | -48.05 | **-48.69** | -48.35 | **-46.68** |
| TS-9 1013 Hz | -44.69 | -43.26 | -42.88 | -42.76 | -42.86 |
| TS-9 2311 Hz | -33.28 | -48.49 | **-48.31** | -47.92 | **-46.53** |
| Muff 1013 Hz | -13.21 | -13.26 | -13.15 | -13.12 | -12.73 |
| Muff 2311 Hz | -18.61 | -21.79 | -21.51 | -21.40 | -18.06 |

SD-1/TS-9 at 2311 Hz: the old hold path left -30.4/-32.5/-34.6 dBc at x1/2x/4x
against -46.7 native; the band-limited os4 lands at -48.69/-48.31 against
-46.68/-46.53 -- within the 3 dB acceptance, on the clean side by ~2 dB (the
decimation filter also removes genuine 24-28.8 kHz content that native 192 kHz
keeps; honest, reported). At 1013 Hz the metric is harmonic-dominated and does not
separate modes (all within ~1 dB), as the scoping note already records. The Muff
rows are harmonic-dominated at both frequencies (h3 = -6.4..-6.7 dBc: a
heavily-clipping fuzz whose 9th+ harmonics are genuine signal, not folds); os4
reads ~3.4 dB cleaner than n192 at 2311 Hz because the transition band droops
genuine harmonics above ~20 kHz. That metric cannot isolate aliasing on the Muff
and is reported as such, not as a pass.

## 5. Analytic controls

Own small complex AC solver (nodal R/sC/1/sL stamps, Gaussian elimination with
partial pivoting, 1 V drive at node 1) gives exact analog |H(f)|. It reproduces
the RC/RL closed forms to < 1e-9 dB at every test point (asserted in the harness,
not eyeballed). Runtime renders at 100 mV peak, stiff source
(`inputSourceOhms: 0`), same LS fundamental fit. Circuits: one-pole RC (10k
series, 10n shunt, fc = 1591.549 Hz), one-pole RL (1k series, 10 mH shunt to
ground, high-pass fc = 15915.494 Hz), two-pole RC ladder (10k/10n + 10k/10n:
series-shunt-series-shunt), two-capacitor tone network (series 10n in->mid, 10k
mid->ground, series 10k mid->out, 10n out->ground). OLD os4 comes from a scratch
copy of the pre-change runtime (`git show HEAD:...reference-runtime.ts`, class
renamed, deleted after use) -- no flag in the shipped code.

Error vs exact (dB); x1 = unwarped 48 kHz, old4 = legacy hold-and-last at 4x,
new4 = band-limited at 4x, n192 = native 192 kHz:

| circuit | f (Hz) | exact (dB) | x1 err | old4 err | new4 err | n192 err |
|---|---|---|---|---|---|---|
| RC | 100 | -0.0171 | -0.0000 | -0.0000 | +0.0000 | -0.0000 |
| RC | 1000 | -1.4451 | -0.0035 | -0.0008 | +0.0002 | -0.0002 |
| RC | 4000 | -8.6431 | -0.1747 | -0.0195 | -0.0102 | -0.0107 |
| RC | 8000 | -14.1940 | -0.8194 | -0.0661 | -0.0473 | -0.0479 |
| RC | 12000 | -17.6230 | -2.0693 | -0.0800 | -0.1104 | -0.1107 |
| RL | 100 | -44.0366 | +0.0001 | -8.4307 | +0.0000 | +0.0000 |
| RL | 1000 | -24.0535 | +0.0124 | -8.4311 | +0.0012 | +0.0008 |
| RL | 4000 | -12.2612 | +0.1894 | -8.4382 | +0.0122 | +0.0117 |
| RL | 8000 | -6.9529 | +0.6637 | -8.4696 | +0.0404 | +0.0397 |
| RL | 12000 | -4.4076 | +1.2164 | -8.5446 | +0.0717 | +0.0715 |
| LAD | 100 | -0.1185 | -0.0000 | -0.0001 | +0.0000 | -0.0000 |
| LAD | 1000 | -5.9321 | -0.0097 | -0.0067 | -0.0002 | -0.0006 |
| LAD | 4000 | -19.3000 | -0.2951 | -0.1185 | -0.0175 | -0.0181 |
| LAD | 8000 | -29.1182 | -1.5255 | -0.5213 | -0.0881 | -0.0888 |
| LAD | 12000 | -35.6000 | -4.0093 | -1.3294 | -0.2127 | -0.2130 |
| TONE | 100 | -24.1549 | +0.0001 | -0.0126 | +0.0000 | +0.0000 |
| TONE | 1000 | -9.9685 | +0.0027 | -0.0122 | +0.0006 | +0.0002 |
| TONE | 4000 | -11.2952 | -0.0934 | -0.0119 | -0.0051 | -0.0057 |
| TONE | 8000 | -15.0928 | -0.6767 | -0.0087 | -0.0383 | -0.0389 |
| TONE | 12000 | -18.0527 | -1.9111 | +0.0535 | -0.1001 | -0.1004 |

The x1 column reproduces the previous spike's unwarped numbers to 0.001 dB
(RC -0.1747/-0.8194/-2.0693, RL +0.1894/+0.6637/+1.2164), which cross-validates
this harness against that one. new4 agrees with n192 to <= 0.001 dB on every
circuit at every frequency: the resampler contributes at most 0.001 dB anywhere,
and the new4 residue is the 192 kHz trapezoid warp.

Two findings to report plainly:

1. The legacy hold path is catastrophically wrong on the shunt-inductor
   high-pass: old4 err is -8.43 dB at ALL five frequencies (and -6.39/-8.43/-9.47
   dB at old-os2/4/8 at 1 kHz -- the error GROWS with N, with zero non-converged
   samples). Mechanism (hypothesis, stated as such): the higher-N solve converges
   more exactly on the wrong staircase-driven input; the held steps keep kicking
   a 10 us inductor tau and the shunt topology differentiates every kick into the
   output. The new path is +0.001 dB on the same circuit.
2. RC at 12 kHz: new4 err -0.1104 dB misses the 0.1 dB single-pole criterion by
   0.010 dB. The miss is 192 kHz warp (n192 err -0.1107, resampler delta 0.0003),
   not resampling -- but the criterion as written does not pass on RC@12k. RL
   passes (worst +0.0717 at 12 kHz).

(b) No-reactive circuit. Resistive divider (10k/10k): x1 render hash (SHA-256 over
raw output bytes) is identical old-vs-new (`61e4135d...` both, full 64 hex chars
match); os4 fundamental gain is 0.5x to 0.0000/0.0004/0.0007/0.0010 dB at
100/1k/8k/19k Hz (within the resampler's own passband behaviour). Block-split
invariance is bit-identical (full-hash match) for 1x4800 vs 10x480 vs 4800x1 at
os1 AND os4 on the divider, and at os1/2/4/8 on the nonlinear clipping-overdrive
fixture.

(c) The check can fail, both directions.

- Halve the stopband (Kaiser beta 8.3 -> 3.5, prototype worst stopband -82.2 ->
  -44.8 dB; temporary sed patch, reverted, diff verified clean): the resampler's
  own 30 kHz -> 18 kHz fold rejection degrades from -92.0 dB to -48.3 dB -- the
  unit-level check fails loudly. At pedal level the SD-1 2311 Hz aliasing metric
  barely moves (-48.57 vs -48.69 dBc): that metric is dominated by folding at the
  192 kHz solver rate, which no baseband stopband depth can touch. Reported as
  measured: stopband depth matters where the stimulus is in the stopband, and the
  pedal aliasing metric is mostly not that.
- Drop the interpolation back to a hold (the legacy path, measured via the
  scratch copy): SD-1 2311 Hz aliasing -34.58 vs -48.69 dBc (14 dB worse), RC@8k
  error -0.066 vs -0.047 dB, LAD@8k -0.521 vs -0.088 dB, RL catastrophic (above).
  The hold is worse on every metric that separates the two.

(d) Swept sine of the resampler alone against its design response: section 2
(DTFT table, round-trip gains, -86 dB image, -92 dB fold, three-method latency).
All design targets met with margin.

(e) Known aliasing case with an analytic answer. Symmetrically hard-clipped sine
(clip at 0.6 of peak, f0 = 2311 Hz): exact odd-harmonic amplitudes in closed form
(b_k = (4/pi)(I1 + a cos(k th0)/k), th0 = asin(a)). A long high-rate render
(32x, 2^19 samples) matches the analytic amplitudes to <= 0.03 dB (k = 1..13;
k = 5 at 0.11 dB is LS leakage on a near-zero amplitude, stated as such). After
32x decimation: naive take-every-32nd folds harmonics 11/13/15/17/19 into band at
full level (0.00566/0.00543/0.00076/0.00358/0.00101); the half-band cascade (5
stages, the same class the runtime uses) reproduces in-band harmonics 1-9 to
<= 0.014 dB and suppresses stopband folds by 30-50 dB (13th: 0.00543 ->
0.000016). The 11th harmonic (25.421 kHz, transition band) folds to 22.579 kHz at
0.001048 vs 0.00566 naive -- 14.6 dB suppressed, i.e. exactly the filter's
transition attenuation there, the same honest limitation as in section 2.

## 6. Cost (reported, not a gate)

1 kHz 10 mV tone, 1 s render, `process()`-only, median of 5 interleaved repeats
per factor (dev machine, shared noise applies; worklet numbers will differ --
this is a ratio table, not a budget claim). Resampler split timed separately
through the identical stage operations without the solver. Newton census from
`telemetry()` on the same renders.

| pedal | factor | ns/host-sample | xRT-equiv | resampler ~ns | solver ~ns | peak iter | mean/host | mean/sub | nonconv |
|---|---|---|---|---|---|---|---|---|---|
| muff | x1 | 44496 | 2.14 | 0 | 44496 | 6 | 3.04 | 3.04 | 0 |
| muff | os2 | 77235 | 3.71 | 108 | 77127 | 4 | 5.10 | 2.55 | 0 |
| muff | os4 | 145372 | 6.98 | 291 | 145081 | 3 | 9.42 | 2.35 | 0 |
| muff | os8 | 281867 | 13.53 | 648 | 281219 | 3 | 16.91 | 2.11 | 0 |
| sd1 | x1 | 46763 | 2.24 | 0 | 46763 | 4 | 2.75 | 2.75 | 0 |
| sd1 | os2 | 78073 | 3.75 | 99 | 77974 | 3 | 4.87 | 2.44 | 0 |
| sd1 | os4 | 134037 | 6.43 | 278 | 133759 | 3 | 8.65 | 2.16 | 0 |
| sd1 | os8 | 244524 | 11.74 | 690 | 243834 | 3 | 16.10 | 2.01 | 0 |

xRT-equiv = ns per host sample / 20833 ns (48 kHz sample period) on this machine.
The resampler is <= 0.3% of the total at every factor (accuracy-first buys this
for free). Total scales ~3.1-3.3x at os4, sub-linearly, because mean iterations
per sub-sample fall with rate (3.04 -> 2.35 -> 2.11 on the muff). Peak iterations
fall (6 -> 3); zero non-converged samples at every factor on both pedals.

## 7. Acceptance (coordinator's, reported against, not bent)

| criterion | result |
|---|---|
| os4 within 0.1 dB of n192 to 8 kHz, 0.3 dB at 16 kHz, all three pedals | **PASS** with two orders of margin: worst os4-vs-n192 is 0.001 dB (muff/ts9 4k/8k), 0.000 dB on SD-1 everywhere |
| aliasing residual at 2311 Hz, 100 mV, high drive within 3 dB of n192 | **PASS** on SD-1 (-48.69 vs -46.68) and TS-9 (-48.31 vs -46.53); Muff metric is harmonic-dominated (h3 ~ -6.7 dBc) and cannot isolate aliasing -- reported, not claimed |
| at/below 1 kHz unchanged within 0.02 dB vs x1 on every circuit | **PASS**: pedals worst +0.0179 (SD-1 1 kHz, a move *toward* n192, i.e. warp removal); analytic RC/RL/ladder/tone worst 0.0012 dB |
| factor 1 bit-identical | **PASS**: full-SHA-256 identical old-vs-new on a divider render; existing test (absent-vs-explicit 1) still passes |
| analytic single-pole sections within 0.1 dB to 12 kHz | **MIXED**: RL passes (worst +0.072); RC misses by 0.010 dB at 12 kHz (-0.1104), and the miss is 192 kHz warp (n192 -0.1107), resampler delta 0.0003 dB |
| resampler specs (0.01 dB ripple to 0.4 fs, 80 dB stop beyond 0.6 fs, DC = 1) | **PASS**: 0.0007 dB, -82.2 dB worst, sum 1.0000000000000002 |
| latency in host samples reported for 2x/4x/8x | **PASS**: 27.5 / 41.25 / 48.125 via the new `oversampleLatency()` |

## 8. Verification (fresh clone, per the brief)

```
git clone --branch indiejoseph/warp-oversample-resampler /home/joseph/projects/VesselDSP/core /tmp/osr-verify
# copy the 5 changed/new files in (diff is uncommitted by instruction)
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun run build:pages
```

| step | base (84ac372) | with change | note |
|---|---|---|---|
| `bun install --frozen-lockfile` | 411 pkgs pass | 411 pkgs pass | identical |
| `bun run typecheck` (root + all packages) | pass, exit 0 | pass, exit 0 | the brief's "170 errors" do not reproduce on this branch in either state; runtime package typecheck passes both |
| `bun run build` | fails at runtime `cp -r src/wasm dist/wasm` | fails identically | pre-existing: no `src/wasm` in base (needs the emsdk wasm build); package `tsc` steps succeed |
| `bun test` | 1915 pass / 5 fail / 1941 | 1933 pass / 5 fail / 1959 | +18 new tests, all passing; the 5 shared failures are missing-wasm-module errors, identical without the change |
| `bun run build:pages` | pass (870 pages) | pass (870 pages) | identical |

Local worktree `bun test`: 1932 pass / 6 fail -- the 6th is `tests/package.test.ts`
"pins the current package release", which reads `packages/core/dist/index.js`;
there is no `dist/` in an unbuilt worktree, and it passes in the clone where the
(partial) build produced one. Artifact availability, not a code failure; verified
by the passing clone run.

Existing `packages/runtime/tests/oversample.test.ts` (5 tests): 4 still pass
unchanged (factor-1 bit-identical, output length at 1/2/4/8, hostSampleRate,
below-1 clamp). The 5th ("a divider is a no-op") legitimately changes: with a
41.25-host-sample fractional group delay, sample-by-sample equality cannot hold
for ANY shift, so it now pins the divider's fundamental gain at 4x vs 1x to
< 0.01 dB at 100/1k/8k Hz. Two tests added (latency values incl. legacy-3-is-zero,
block-split bit-identity at 1/2/4/8 on the nonlinear clipper). New
`packages/runtime/tests/resample.test.ts` (13 tests: design shape, DC gain,
ripple/stopband/cutoff bands, worse-prototype failing control, streaming
identity, fold kill, round-trip, latency formula). New
`packages/runtime/tests/band-limited-oversample.test.ts` (3 tests: RC-vs-exact
bands + RC-vs-native-12k, RL-vs-exact bands, latency method). Note: these live in
`packages/runtime/tests/` rather than root `tests/` deliberately -- root
`tsconfig.json` excludes `packages/runtime`/`packages/compiler` sources, and a
root-level test importing them pulls all 170 strict-flag (`noUncheckedIndexed-
Access`/`exactOptionalPropertyTypes`) errors of those trees into `bun run
typecheck` (measured: 170 errors with a root test file, 0 without). The spike
report doc itself is the `docs/spikes/` deliverable.

## 9. What this cannot prove

- Native 192 kHz stands in for analog truth everywhere pedals are concerned; the
  old spike bounds that substitution (muff 0.04-0.12 dB to 8 kHz; SD-1 0.05-0.15
  dB to 8 kHz, 0.33/0.59 dB at 12.5/16 kHz including the untouched backward-Euler
  op-amp pole). Agreement-with-192 kHz is agreement-with-ngspice only inside
  those bounds.
- Three pedals (two diode clippers into tone stacks + one op-amp overdrive),
  centre controls, 10 mV stepped sines (100 mV for aliasing). No chords, plucks,
  swept controls, sustained high-gain clipping where changed input spectra meet
  heavy Newton limiting (census shows no convergence movement at these levels),
  no listening test.
- Timing is a dev-machine ratio table, not a worklet budget claim; the resampler
  is 0.3% of the total, so the budget question is the solver's, unchanged.
- No C++ mirror (out of scope per brief) and no TS<->WASM parity run.
- Transition-band folds are only partially suppressed (14.6 dB at 22.6 kHz);
  content that must survive above ~19 kHz at a 48 kHz host pays the half-band
  transition droop (Muff 2311 Hz residual reads cleaner than native for exactly
  this reason).
- The shipped default is still factor 1: nothing changes for any existing caller
  until one passes `oversample`. Non-power-of-two factors keep the legacy path
  (measured only as "runs, latency 0, length preserved").

## 10. Recommendation: ADOPT as the accuracy path (default factor 4)

The fix is general (every circuit, coefficients from the stage alone, no
per-packet gate/calibration/correction, no new `.vdsp` field), accuracy-first
(resampler <= 0.3% cost, solver dominates as before), latency reported not hidden
(27.5/41.25/48.125 host samples via `oversampleLatency()` -- the one public-API
addition, flagged for the owner), bit-identical at factor 1, and transparent to
<= 0.001 dB at every measured factor (osN === native 48k\*N). It meets the
proposed acceptance on every leg except RC@12k, where it misses by 0.010 dB with
the miss proven to be 192 kHz trapezoid warp rather than resampling
(new4-vs-n192 = 0.0003 dB there) -- reported as a marginal fail, not rounded away.

Suggested default factor from the data: **4**. os2 still leaves -0.25..-1.9 dB
against n192 at 6-16 kHz (a real warp residue, not a resampler flaw -- os2 ===
native 96 kHz exactly); os4 is indistinguishable from the 192 kHz reference the
corpus already trusts, at ~3.2x solver cost; os8 doubles that cost to move past
n192 toward 384 kHz truth (+0.1..0.45 dB vs n192), which is the offline/maximum-
accuracy choice, not the default. Changing the shipped default (still 1: zero
behaviour change until opted in) is a separate owner decision; this spike only
shows what each factor buys. If a knob is ever wanted, the data says there is
nothing to tune -- the prototype is fixed by the 0.4/0.6 fs spec, and no knob was
shipped.

Exact commands and real output (worktree src imports; `bun` 1.3.14):

```
bun /tmp/osr/baseline.ts muff 10 'SUSTAIN=0.5,TONE=0.5,VOLUME=0.3' '100,...,16000' /tmp/osr/muff-fr.json
# + sd1/ts9 FR and muff/sd1/ts9 alias runs; worst saved-JSON diff 0.0000 dB over 156 rows
bun /tmp/osr/resample-alone.ts   # taps=57 sum=1.0000000000000002 center=0.5 evenMax=0; proto -82.2 dB at 28.8k;
                                 # round-trip <=0.002 dB to 19.2k; image -86.0 dB; fold -92.0 dB
bun /tmp/osr/tune.ts             # taps=57 beta=8.3: ripple 0.0007 dB, worst stop -82.20 dB (adopted)
bun /tmp/osr/impulse.ts          # os2/4/8 centroid +27.500/+41.817/+48.713
bun /tmp/osr/groupdelay.ts       # (superseded: unaligned window; see report) -> aligned slope 27.50/41.25/48.12
bun /tmp/osr/meas.ts ...         # new-muff/sd1/ts9-fr.json (os2/4/8) + new-*-alias.json: section 3/4 tables
bun /tmp/osr/n384.ts             # os8-vs-n384 <= 0.001 dB all pedals at 8/12.5/16 kHz
bun /tmp/osr/n96.ts              # os2-vs-n96 0.000 dB all pedals at 8/12.5/16 kHz
bun /tmp/osr/analytic.ts         # section 5 table; solver-vs-closed-form asserted < 1e-9 dB
bun /tmp/osr/oldscale.ts         # old-os2/4/8 RL@1k err -6.3884/-8.4311/-9.4726 dB, 0 non-converged
bun /tmp/osr/control-b.ts        # divider x1 hash 61e4135d... identical; os4 gain diff <= 0.0010 dB;
                                 # splits identical os1+os4
bun /tmp/osr/blockinv.ts         # clipper splits identical os1/2/4/8
bun /tmp/osr/failctl.ts          # (beta=3.5 patched, reverted) SD-1 aliasing -48.57 vs -48.69 dBc
bun /tmp/osr/clip.ts             # high-rate-vs-analytic <= 0.03 dB; naive folds full-level; cascade kills 30-50 dB
bun /tmp/osr/cost.ts             # section 6 table (muff + sd1, x1/os2/os4/os8, interleaved x5)
bun test packages/runtime/tests/resample.test.ts packages/runtime/tests/oversample.test.ts \
  packages/runtime/tests/band-limited-oversample.test.ts  # 23 pass
git clone --branch indiejoseph/warp-oversample-resampler ... /tmp/osr-verify (+5 files) &&
  bun install --frozen-lockfile (411) && bun run typecheck (exit 0 both) &&
  bun run build (fails at cp src/wasm both) && bun test (1915/5 base -> 1933/5 change) &&
  bun run build:pages (870 pages both)
```

Beside every figure: harness as in "Harness" above, window 0.9-1.7 s (0.1-0.5 s
for the analytic/RC controls), controls as stated per pedal, stepped sines only;
proves small-signal frequency response and high-drive aliasing at centre
controls, not large-signal clipping shape, chords, sweeps, or audibility.

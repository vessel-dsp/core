# Spike: lowest-latency resampler that keeps the pedal-level results (2026-10-09)

## Question

The shipped band-limited oversampling resampler (one 57-tap linear-phase Kaiser
half-band prototype, beta 8.3, reused for every 2x stage) costs 27.5 / 41.25 /
48.125 host samples at os2/os4/os8. What is the lowest-latency resampler that
keeps the pedal-level results, and what does each step down cost in accuracy?

Short answer: **a stage-specific + relaxed-spec linear-phase FIR cascade
(`AB`: [41 taps beta 6.0] / [29 taps beta 7.0] / [21 taps beta 6.0]) at
19.5 / 26.25 / 28.625 host samples, with zero measured accuracy cost against
every pedal-level bar. Recommendation: ADOPT AB, replacing the shipped design
(no backward compatibility).** The minimum-phase variant reaches ~4 host
samples but doubles the clipped-waveform error on fuzz (rejected with
evidence); the IIR polyphase half-band fails magnitude by 12x the budget
(rejected with evidence).

## Principle (binding)

GENERAL: coefficients a function of the stage only, never of the circuit; no
per-packet anything; no new `.vdsp` field; no knob beyond the existing integer
`oversample`. ACCURACY FIRST, real time secondary. Every candidate below is
general and measured; nothing is assumed.

## 0. Baseline FIRST (before any edit)

Harness `docs/spikes/latency/baseline.ts` is a line-for-line copy of the saved
probe's fit and drive (`workbench/packet-study/oversample-probe/probe.ts`,
read-only, never modified): `compile` with `pedalPartCatalog`, controls set
AFTER `prepare` (`SUSTAIN=0.5,TONE=0.5,VOLUME=0.3` muff;
`Drive=0.5,Tone=0.5,Level=0.3` SD-1/TS-9), `prepare(rate,
{ inputSourceOhms: 94 })`, 0.5 s + 1.5 s stepped sine at 10 mV peak from
`t = 0`, least-squares fit of DC + harmonics 1..8 over the 0.9-1.7 s window
with f0 refined +/-1 Hz in 0.25 Hz steps, 512-sample process blocks. Netlists
(read-only): `packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp`,
`packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp`,
`artifacts/schematics/vessel-dsp/ibanez-ts9-reissue.vdsp`. Aliasing runs:
100 mV, SUSTAIN/Drive = max, 1013 and 2311 Hz. All harnesses import the worktree
`packages/*/src` directly (never a dist); scratch state in `/tmp/lat/`.

Frequencies: 100, 250, 500, 1000, 2000, 3150, 4000, 6300, 8000, 12500, 16000 Hz.

- x1 and n192 rows reproduce the six saved JSONs **bit-identically
  (worst fundamental difference 0.00000 dB over all 66 x1+n192 FR rows and all
  12 x1+n192 aliasing rows)**: the harness IS the probe.
- The saved os2/os4 rows are the OLD hold path (as the WASM-port report §1
  already documents: SD-1 os2/os4 at 16 kHz differ by 1.49389/1.29669 dB, and
  this worktree reproduces those exact diffs). The real baseline check is
  os4-vs-n192 on this worktree (the shipped band-limited design):

| pedal | worst os4-vs-n192 over 11 freqs |
|---|---|
| Muff | 0.0007 dB (8 kHz) |
| SD-1 | 0.0005 dB (8 kHz) |
| TS-9 | 0.0006 dB (8 kHz) |

Transparency re-derived (<= 0.001 dB bar). Aliasing baselines reproduce the
shipped report exactly: SD-1 2311 Hz os4 -48.69 vs n192 -46.68 dBc; TS-9 -48.31
vs -46.53; Muff -21.51 vs -18.06 (harmonic-dominated, reported as such).

A second harness equivalence is proven before any candidate runs: the scratch
pedal harness (`docs/spikes/latency/pedal-cand.ts`) renders candidates as an
EXTERNAL cascade (candidate upsample -> stock `ReferenceRuntime` at
48k·2^stages with `oversample: 1` -> candidate decimate). External-vs-internal
os4 on the SD-1 renders **bit-identical (max abs diff 0)** for the shipped
design, so every candidate number below is directly comparable to the runtime's
internal path.

## 1. Candidate designs (all general, all measured)

- **shipped**: 57 taps beta 8.3 every stage (reference).
- **A** (stage-specific linear-phase FIRs): first stage keeps the sharp
  19.2-28.8 kHz transition (57 beta 8.3); later stages work at 2x/4x the rate
  where the absolute transition is wider. Folding analysis: 192->96 kHz folds
  [48k,96k] into [0,48k]; content landing in the host baseband [0,24k] comes
  from [72k,96k]. 384->192 kHz folds [96k,192k] into [0,96k]; content landing
  below 60 kHz comes from above 132 kHz. Sized from the alone-scan (not
  argued): stage 2 = 29 taps beta 7.0 (ripple 0.0020 dB to 30 kHz, stopband
  -38.4 dB beyond 60 kHz at 192 kHz); stage 3 = 21 taps beta 6.0 (ripple
  0.0102 dB to 60 kHz, stopband -26.4 dB beyond 120 kHz at 384 kHz). Pedal
  aliasing verifies the sizing (section 4).
- **B** (relaxed spec, still linear phase): 41 taps beta 6.0 every stage
  (ripple 0.0076 dB to 19.2 kHz, stopband -61.0 dB beyond 28.8 kHz at 96 kHz).
  The knee scan (taps x beta grid, section 2) puts 37 taps beta 5.5
  (0.0099 dB / -58.9 dB, latency 26.25) just past the knee and 41/6.0 at the
  knee with margin; both measured at pedal level (B37: magnitude -0.016 dB at
  16 kHz, 1 kHz-vs-x1 0.0142 eating 70% of the 0.02 budget to save 3 samples).
- **AB** (recommended: relaxed first stage + lean later stages):
  [41 beta 6.0] / [29 beta 7.0] / [21 beta 6.0].
- **C** (minimum-phase FIR, SAME magnitude as shipped): 57-tap cepstral
  (homomorphic) redesign of the shipped prototype (Oppenheim & Schafer
  log-magnitude -> real cepstrum -> causal window -> exp). Magnitude preserved
  to 0.0006 dB ripple / -82.0 dB stopband; polyphase DC balance 0.500001 /
  0.499999 (the half-band Nyquist zero in magnitude forces it); peak tap moves
  28 -> 4 (causal, no pre-ringing). Latency is measured, not analytic
  (frequency-dependent: 3.7 host samples at 200 Hz rising to 7.1 at 19.2 kHz
  at os4).
- **D3/D5** (IIR polyphase half-band, Regalia/Mitra two-branch allpass form
  H(z) = (A0(z^2) + z^-1 A1(z^2))/2; Vaidyanathan §5 for the decomposition):
  D3 (A0 = bypass, A1 = single section a = 1/3, derived maximally-flat at DC)
  is **analytically invalid as a lowpass** (passband notch to -25.7 dB at
  19.2 kHz; flatness at a point is not a lowpass) and is carried no further
  than the alone-measurements. D5 (A0 = [a0], A1 = [a1], (a0, a1) solving the
  two maximal-flatness equations psi'(0) = 0 and psi'''(0) = 0 by a
  deterministic Newton solve in `solveD5()`, no magic table: a0 = 0.1056,
  a1 = 0.5279, max |a| = 0.528 < 1 stable) is a proper lowpass (-3.01 dB at
  quarter rate, -14 dB at 28.8 kHz, -57 dB at 40 kHz) and is carried to one
  pedal. The branch-phase-skew mechanism is measured, not assumed: the
  up/down pair reconstructs as (A0^2 + A1^2)/2, whose magnitude is |cos(delta)|
  for branch-phase difference delta (-1.236 dB at 8 kHz for D5, derived and
  measured identically).
- **E** (hybrid: FIR 57 first stage + IIR-D5 later): carried to one pedal.
- **F1/F2/F3** (failing controls, scratch-only, reverted by construction):
  F1 = shipped prototype at beta 3.5 (halved stopband); F2 = D5 with the A1
  coefficient dropped; F3 = shipped FIR with the decimation pair crossed
  (branch order reversed on the way down only).

## 2. Resampler-alone measurements (before any circuit)

Harness `alone2.ts` (DTFT grids, whole-period LS windows sized per frequency,
aligned phase slope with input-phase subtraction), `debug-spur.ts`
(polyphase balance, DC + spur), `stability.ts` (10 s white noise +
full-scale 100 Hz square, block splits, state clearing), `fail-alone.ts`,
`clip-analytic.ts` (Parseval-validated analytic harmonics + high-rate
injection). Key rows (os4 unless noted):

| candidate | latency analytic (2x/4x/8x host) | centroid x2/x4/x8 | ripple | stopband | GD variation to 0.4 fs_host |
|---|---|---|---|---|---|
| shipped | 27.5 / 41.25 / 48.125 | 27.500 / 41.193 / 48.085 | 0.0007 dB to 19.2k | -82.2 dB beyond 28.8k | 0 (linear) |
| A [57/29/21] | 27.5 / 34.25 / 36.625 | 27.500 / 34.193 / 36.665 | s1 0.0007 | s2 -38.4, s3 -26.4 | 0 |
| B [41] | 19.5 / 29.25 / 34.125 | 15.500 / 23.191 / 27.084 | 0.0076 dB | -61.0 dB | 0 |
| AB [41/29/21] | 19.5 / 26.25 / 28.625 | (measured 26.20 lag at pedal level) | s1 0.0076 | s1 -61.0 | 0 |
| C min-phase | measured: ~2.5 / ~3.8 / ~4.3 (200 Hz-1 kHz spots) | 4.462 / 5.677 / 6.452 (energy) | 0.0006 dB | -82.0 dB | 3.7 -> 7.1 host samples (200 Hz -> 19.2 kHz, os4) |
| D5 IIR | measured: ~1.1 / ~1.7 / ~2.0 (low-freq GD) | 1.947 / 2.077 / 2.572 | gentle (Butterworth-like) | -14 dB at 28.8k | 1.7 -> 3.6 (os4) |
| E hybrid | 27.5 / ~28.1 / ~28.4 (centroid) | 27.500 / 28.082 / 28.374 | s1 0.0007 | IIR-limited later | ~flat + IIR tail |

Two methods agree for every FIR cascade (analytic formula vs impulse
centroid/peak: 19.5 vs 19.500 peak@19-class; the phase-slope fine-step spots
confirm 19.5 / 26.25 / 28.625 exactly and alias at wider steps for large
delays, a stated method limit). Round-trip swept-sine gain (host 48 kHz):

- shipped/A/C: 0.000-0.002 dB at every test frequency to 19.2 kHz at all depths.
- AB: <= 0.0061 dB (worst 19.2 kHz, x2).
- B: +0.015/+0.021 dB at 8 kHz x4/x8; -0.160 dB at 19.2 kHz.
- D5: -0.019/-0.301/-1.236 dB at 1/4/8 kHz x2 (branch skew, predicted -1.25).
- E: -0.004/-0.074/-0.300 dB at 1/4/8 kHz x4.
- F2: -4.46 dB at 8 kHz; F3: -1.55 dB at 8 kHz (both fail loudly as designed).
- F1: 30 kHz -> 18 kHz fold rejection -92.0 -> -48.3 dB (reproduces the shipped
  report's failing control to the digit).

Stability: IIR poles 0.1056/0.5279 (strictly inside unit circle by
construction, asserted); 10 s white noise + full-scale square through every
candidate at every depth: bounded (peaks 1.1-2.0), zero non-finite.
Block-size invariance: 1x4800 vs 10x480 vs 4800x1 bit-identical (maxdiff 0)
for every candidate; fresh-vs-fresh and reset-vs-fresh exact.

Known-aliasing control with analytic answer (`clip-analytic.ts`):
symmetrically hard-clipped sine (clip 0.6, f0 2311 Hz), closed-form
odd-harmonic amplitudes (Parseval-validated to 5.3e-9 RMS^2). In-band
harmonics k=1..9 preserved through os4 round-trip: shipped/A/C to
0.001 dB (k9 -0.265 dB: honest transition droop at 20.8 kHz, identical for
all three); B to 0.011 dB (k9 -0.627 dB, wider transition); AB same class;
D5 to -10.8 dB at k9 (fails); F1/F2/F3 fail increasingly. Stopband harmonics
k=11..19 injected AT the 192 kHz high rate (as solver harmonics appear):
shipped suppresses k13 (30 kHz) 5.5e-3 -> 1.1e-7 (-94 dB); k11 (25.4 kHz,
transition) 5.7e-3 -> 1.0e-3 (-15 dB, the honest limitation, matching the
shipped report's 14.6 dB); A/C identical; B slightly worse at k11; D5 only
2-20 dB; F1 170x worse than shipped at k13 (fails loudly as designed).

## 3. Pedal results

Candidate pedal harness (`pedal-cand.ts`): external cascade proven
bit-identical to the internal path (section 0). FR: 10 mV centre controls,
probe fit; aliasing: 100 mV high drive; time-domain: (i) 10 mV 1 kHz sine,
(ii) two-tone 0.25 V 440 Hz + 0.1 V 1320 Hz (parity stimulus), (iii) pluck
(decaying 6-harmonic 110 Hz stack, 0.5 ms attack, peak 100 mV) + square-ish
burst (110 Hz tanh square, 100 mV, windowed [0.1, 0.3] s, 2 ms edges) into
high-drive SD-1 and Muff; all compared against native 192 kHz after
cross-correlation delay removal (integer +/-120 + fractional 0.1-grid
relRMS minimization, FFT advance; period-alias windowed to the causal
[-5, 70] host-sample range; edges trimmed both ends after a wrap-artifact
find-and-fix documented in the report log).

### 3a. Magnitude vs native 192 kHz, os4 (dB, candidate minus native)

AB (recommended):

| pedal | 100 | 250 | 500 | 1k | 2k | 3.15k | 4k | 6.3k | 8k | 12.5k | 16k |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Muff | +0.0000 | +0.0001 | +0.0004 | +0.0014 | +0.0037 | +0.0031 | -0.0002 | +0.0048 | +0.0023 | +0.0019 | +0.0056 |
| SD-1 | +0.0000 | +0.0002 | +0.0005 | +0.0017 | +0.0039 | +0.0024 | -0.0001 | +0.0033 | +0.0017 | +0.0014 | +0.0045 |
| TS-9 | +0.0000 | +0.0002 | +0.0007 | +0.0022 | +0.0050 | +0.0031 | -0.0002 | +0.0042 | +0.0020 | +0.0018 | +0.0055 |

A: <= 0.0021 dB everywhere (worst muff 16 kHz). B: <= 0.0103 dB (worst muff
16 kHz; 6.3 kHz +0.0102). C: <= 0.0024 dB (worst SD-1 16 kHz -0.0024).
D5 (SD-1): -0.023/-0.376/-1.548/-6.667 at 1/4/8/16 kHz (FAILS, as predicted).
E (SD-1): -0.004/-0.074/-0.301/-1.244 (FAILS). Muff/TS-9 D5/E spots identical
in pattern (-1.54 dB at 8 kHz, -6.3..-6.5 at 16 kHz; E -0.30/-1.24).

AB os2 matches shipped-os2 warp deltas to <= 0.008 dB (resampler adds
nothing); AB os8 matches the shipped report's os8 table to <= 0.002 dB
(muff +0.009/+0.020/+0.064/+0.104/+0.265/+0.449 at 3.15k..16k). A/B/C os2/os8
likewise carry the shipped warp pattern (C os2 at 16 kHz reads -1.022 vs
-0.961 for A/B: a 0.06 dB dispersion-warp interaction, stated as observed).

<= 1 kHz vs x1: AB worst +0.0193 (SD-1 1 kHz), B +0.0199, A +0.0177,
C +0.0179, shipped +0.0179 -- all within the 0.02 bar. The bar is 90%
warp-removal (shared by shipped at 0.0179) plus <= 0.0014 resampler ripple;
margins are thin but deterministic. Factor 1 bit-identical (hash
61e4135d... identical, matching the shipped report's prefix).

### 3b. Aliasing, 2311 Hz 100 mV high drive (residual dBc)

| pedal | shipped os4 | A | B | AB | C | D5 | E | native 192 |
|---|---|---|---|---|---|---|---|---|
| SD-1 | -48.69 | -48.69 | -48.85 | -48.85 | -48.69 | -53.53 | -50.81 | -46.68 |
| TS-9 | -48.31 | -48.31 | -48.47 | -48.47 | -48.31 | (spot pattern as SD-1) | (as SD-1) | -46.53 |
| Muff | -21.51 | -21.51 | -21.65 | -21.65 | -21.51 | - | - | -18.06 |

All within the 3 dB bar (A/C identical to shipped to 0.01 dB; B/AB read
0.16 dB cleaner -- wider transition droops genuine HF harmonics, the same
"clean side" mechanism the shipped report notes). D5/E read cleaner still
(-53.5/-50.8: their droop removes genuine signal; the FR table is what
catches them). AB os2/os8 at 2311 Hz: -48.15/-48.51 (SD-1), consistent.
Failing controls (SD-1 os4): F1 -48.57 (barely moves -- reproduces the
shipped report's own finding that this metric is dominated by folding at the
solver rate); F2 -38.41 (8.3 dB worse than native -- LOUD fail); F3 -56.13
(cleaner-reading through droop; caught by its -1.55 dB round-trip instead --
a stated metric limit).

### 3c. Time-domain phase metrics (candidate os4 vs native 192 kHz, delay-removed)

Shipped floors (the baseline every candidate is judged against):

| pedal | two-tone | pluck | burst | sine1k |
|---|---|---|---|---|
| SD-1 | 0.591% / -42.2 dBpk / lag 41.20 | 0.335% / -43.9 / 41.20 | 0.203% / -45.2 / 41.20 | 0.670% / -41.8 / 41.20 |
| Muff | 3.186% / -12.1 / 41.20 | 0.589% / -14.0 / 41.20 | 1.480% / -11.1 / 41.20 | 1.498% / -29.7 / 41.20 |
| TS-9 | 0.498% / -44.1 / 41.20 | 0.287% / -44.5 / 41.20 | 0.184% / -45.3 / 41.20 | 0.655% / -42.9 / 41.20 |

(relRMS % / maxAbs dB rel peak / estimated lag in host samples; harmonic
amplitude diffs ~0.000-0.005 dB throughout -- the floors are residual/fold
differences, not harmonic errors. Muff floors are higher: fuzz residual.)

- A: identical to shipped to 3 decimals on every stimulus/pedal
  (e.g. SD-1 pluck 0.335% / -44.0 / lag 34.20). Direct A-vs-shipped:
  0.000-0.003% (-77..-102 dBpk) -- bit-near-identical. Latency saved: 7.0.
- B: identical to shipped within noise (SD-1 pluck 0.336% / lag 29.20).
  Direct B-vs-shipped: 0.006-0.10% (-51..-79 dBpk, ripple only). Saved: 12.0.
- AB: identical to shipped within noise (SD-1 pluck 0.336% / lag 26.20;
  muff/ts9 same pattern). Direct AB-vs-shipped: 0.004-0.10%. Saved: 15.0.
- C: 1.7-2.1x the shipped floor on EVERY stimulus/pedal with harmonic
  amplitudes intact (pure waveform/phase cost): SD-1 two-tone 0.986% (1.67x),
  pluck 0.575% (1.72x), burst 0.352% (1.73x), sine1k 1.134% (1.69%);
  muff two-tone 6.497% (2.04x), pluck 1.227% (2.08x), burst 2.935% (1.98x).
  Direct C-vs-shipped: SD-1/TS-9 0.15-0.58%, Muff 1.2-5.5% (-11 dBpk on
  two-tone). Estimated lag 3.8-4.0 host samples (sine1k shows a 3.8/51.8
  period ambiguity differing by <0.001% -- immaterial, stated).
- D5: lags 1.6; harmonic amplitude errors visible (-0.04 dB two-tone h3).
- E: lag 28.0; near floors on td (0.71%/0.40%) but fails magnitude.

Margin rule (set before judging, justified from the numbers): a candidate
passes the phase bar if its total error stays within 1.5x the shipped total
on every stimulus (relRMS) and +6 dB (maxAbs) -- i.e. the accepted baseline's
own deviation from truth dominates. A/B/AB pass at 1.00-1.01x. C fails at
1.7-2.1x everywhere. The known-positive (single 2nd-order allpass, f0 1200 Hz
Q5, GD peak ~200 host samples in-band) registers 3.15% / -24.4 dBpk on the
SD-1 pluck -- 5x that pedal's floor -- proving the metric sees phase; C's
muff two-tone (5.5% / -11 dBpk) EXCEEDS the known-positive's muff numbers
(0.70% / -18.1 dBpk). A weaker allpass (3 kHz Q4, dispersion out of band)
reads 0.51% -- at the floor, as expected. Phase cost verdict: real,
circuit-dependent (mild on soft clippers, severe on hard fuzz), and C pays it.

## 4. Analytic controls

Own complex-AC nodal solver (R/sC/1/sL, partial-pivot elimination) reproduces
RC/RL closed forms to < 1e-9 dB (asserted in-harness). Renders at 100 mV,
stiff source, LS fundamental; error vs exact in dB:

- RC/RL/LADDER/TONE at 100/1k/4k/8k/12k: x1 column reproduces the shipped
  report's warp numbers to 0.001 dB (RC -0.1747/-0.8194/-2.0693; RL
  +0.1894/+0.6637/+1.2164), cross-validating the harness. AB-os4 agrees with
  native-192 to +0.0055 worst (RC 12 kHz: AB -0.1052 vs n192 -0.1107);
  RC bands admit AB unchanged (4 kHz -0.0109 in (-0.03, 0.01); 8 kHz -0.0456
  in (-0.07, -0.02)); RL within 0.1 dB to 12 kHz (+0.0815 worst at B, AB
  +0.0115 at 4 kHz). A/B/C rows same class (B RC12k-vs-native +0.0100 sits
  exactly on the test boundary; AB's later stages pull it to +0.0055).
- No-reactive circuit (10k/10k divider): factor-1 absent-vs-explicit hash
  identical (61e4135d..., matching the shipped report); os4-vs-x1 gain:
  shipped 0.0000/0.0004/0.0007/0.0010 at 100/1k/8k/19k (exact match),
  AB 0.0000/0.0025/0.0023/0.0131, D5/E fail as expected.
- The check fails both directions: F1/F2/F3 fail loudly at unit level
  (section 2) and F2 degrades pedal aliasing by 8.3 dB; the legacy hold path
  remains worse on every separating metric.

## 5. Acceptance (pass/fail with numbers)

| criterion | A | B | AB (recommended) | C | D5 | E |
|---|---|---|---|---|---|---|
| os4 within 0.1 dB of n192 to 8 kHz, 0.3 at 16 kHz (3 pedals) | PASS (0.0021) | PASS (0.0103) | PASS (0.0056) | PASS (0.0024) | FAIL (-1.55/-6.7) | FAIL (-0.30/-1.24) |
| aliasing 2311 Hz high drive within 3 dB of n192 | PASS (0.0) | PASS (0.2) | PASS (0.2) | PASS (0.0) | misleading-clean (caught by FR) | misleading-clean (caught by FR) |
| <= 1 kHz within 0.02 dB vs x1 | PASS (0.0177) | PASS (0.0199) | PASS (0.0193) | PASS (0.0179) | PASS | PASS |
| factor 1 bit-identical | PASS | PASS | PASS | PASS | PASS | PASS |
| phase metrics within 1.5x / +6 dB of shipped | PASS (1.00x) | PASS (1.01x) | PASS (1.01x) | FAIL (1.7-2.1x) | FAIL | PASS on td but fails FR |
| latency at os4 vs 41.25 (os8 vs 48.125) | 34.25 (36.625) | 29.25 (34.125) | 26.25 (28.625) | ~3.7-7.1 (~4.3-6.0) | ~1.7 (~2.0) | ~28.1 (~28.4) |

AB passes every bar; its 1 kHz margin (0.0193 vs 0.02) is warp-removal shared
with shipped (0.0179), deterministic, stated plainly.

## 6. Cost (reported, not a gate)

1 kHz 10 mV tone, 1 s render, `process()`-only external cascade at os4,
median of 5 interleaved repeats per candidate for the resampler split
(round-trip cascade without the solver) and 3 for the totals (dev machine,
idle for the final run; first attempt ran under fleet load and was discarded
and re-run clean -- stated so the noisy draft numbers never surface).
Newton census from `telemetry()` unchanged from the shipped report (peaks
fall with rate; zero non-converged on Muff/SD-1 at every factor).

Resampler ns per host sample (medians; xRT-equiv = /20833 ns):

| candidate | x2 | x4 | x8 |
|---|---|---|---|
| shipped | 117 (0.006) | 600 (0.029) | 972 (0.047) |
| A | 88 (0.004) | 390 (0.019) | 845 (0.041) |
| B | 109 (0.005) | 468 (0.022) | 894 (0.043) |
| AB | 76 (0.004) | 383 (0.018) | 893 (0.043) |
| C | 165 (0.008) | 598 (0.029) | 1490 (0.072) |
| D5 | 35 (0.002) | 264 (0.013) | 559 (0.027) |
| E | 90 (0.004) | 342 (0.016) | 606 (0.029) |

Totals at os4, ns per host sample (median of 3; resampler share):

| pedal | shipped | AB | B | A | C | D5 | E |
|---|---|---|---|---|---|---|---|
| Muff | 153025 (0.26%*) | 149488 | 150975 | 155335 | 149015 | 151125 | 149160 |
| SD-1 | 122844 (0.31%*) | 122237 | 123991 | 119265 | 121314 | 122703 | 122733 |

*resampler share of the total at os4: shipped 600/153025 = 0.39% (Muff) and
600/122844 = 0.49% (SD-1); AB 383/149488 = 0.26% and 383/122237 = 0.31%.) Totals sit inside run-to-run noise
(solver-dominated, as before): the resampler choice moves the total by less
than the noise. The effect on total ns per host sample for Muff and SD-1 at
os4 is therefore nil either way; the purchase is latency, not CPU.

## 7. Recommendation: ADOPT AB (41/6.0 - 29/7.0 - 21/6.0)

AB is the lowest-latency cascade with zero measured accuracy cost: linear
phase preserved (no waveform cost possible beyond magnitude, and magnitude is
pinned to <= 0.006 dB round-trip / <= 0.010 dB pedal); latency 19.5 / 26.25 /
28.625 host samples at 2x/4x/8x (0.41 / 0.55 / 0.60 ms at 48 kHz), saving
8 / 15 / 19.5 host samples (29% / 36% / 41%) against the shipped design. It is
general (per-stage fixed table, no knob, no .vdsp change), bit-identical at
factor 1, and the held path for non-power-of-two factors is untouched. The
diff replaces the runtime's uniform-57 cascade with the stage table (no
backward compatibility; replaced path removed).

Why not C (4 host samples)? Its phase cost is real and circuit-dependent
(2x floors; worse than a deliberately strong allpass on fuzz). Why not B
alone? AB dominates it (same first stage, 3 more samples saved at zero
measured cost). Why not A alone? AB dominates it too (8 more saved).
"a few samples" in the owner's words is 3.8 (C), 26.25 (AB), 29.25 (B),
34.25 (A) at os4; 4.3-6.0 (C), 28.625 (AB), 34.125 (B), 36.625 (A) at os8 --
only the rejected designs reach "a few", and the report shows exactly what
that costs.

## 8. What the C++ port will need (follow-up, NOT done here)

The console carries an exact port of the shipped FIR
(`cpp/Resample.cpp`, `include/v2/Resample.h`, C++ `Engine::prepare`,
`V2Exports.cpp`, wrapper `v2-wasm-engine.ts`). This task does NOT port AB;
the C++ and its tests are untouched. The port will need:

1. `kResampleHalfBandTaps` (57) -> a per-stage spec table mirroring
   `RESAMPLE_STAGE_SPECS` ([41, 6.0], [29, 7.0], [21, 6.0]); same for the
   `designHalfBand2x` defaults only if desired (keep 57/8.3 defaults: the
   TS defaults are kept as the C++ parity anchor).
2. `resamplePrototype()` singleton -> three per-stage prototypes designed in
   `prepare()` as design-time code (same algorithm: 32-term `besselI0`
   series with the same early-out, same window loop, same odd-tap
   normalization order) -- a table is unnecessary and would break bit-parity;
   generate, don't hard-code.
3. `HalfBandStage2x` UNCHANGED (histories already size from the prototype;
   odd-tap extraction, newest-first discipline, fixed accumulation order all
   carry over per stage).
4. `Engine::prepare`: build per-stage up/down cascades from the three
   prototypes (mirroring the TS `prepare` diff); `reset()` zeroes all stages
   (loop, as now).
5. `cascadeLatencyHostSamples(stages, taps)` -> `(stages)` reading the table
   (19.5/26.25/28.625); `v2_engine_get_oversample_latency` then agrees with
   the TS `oversampleLatency()` again.
6. Arithmetic order constraints for bit-parity: identical loop order in
   `designHalfBand2x` (tap loop, odd-sum loop, scale loop), identical
   `interpolate`/`decimate` statement order, double precision end to end
   (Float64 <-> double), newest-first histories. The TS->C++ cascade-alone
   test compares to 1e-12 relative; any reordering breaks it audibly (in the
   test sense).

Known divergence until the follow-up lands:
`packages/runtime/tests/v2-wasm-oversample.test.ts` >
"agrees with the reference console within the parity bars at every factor":
its os2/os4/os8 legs compare the TS reference (now AB) against the WASM
console (still 57-tap) and will read ~1e-3 abs against the 1e-4 bar. DO NOT
weaken it; it goes green again when the C++ port lands. Every other WASM
test keeps passing unchanged (prototype bit-for-bit vs the kept TS 57
default; cascade-alone vs TS-57 wiring; all WASM-only latency/transparency/
block-split/reset tests). These tests skip when `src/wasm/` is absent.

## 9. Verification

Fresh-clone sequence per the brief (clone branch to /tmp, apply the diff,
`bun install --frozen-lockfile`, `bun run typecheck`, `bun run build:wasm`
with emsdk (note: the script lives in `packages/runtime`, i.e.
`bun run build:wasm` with cwd `packages/runtime` -- the root has no such
script), `bun run build`, `bun test` with WASM tests RUNNING,
`bun run build:pages`): the wasm binary is gitignored and stays out; the diff
is uncommitted by instruction.

| step | base (1d9b6f2, no wasm) | base + wasm | patched + wasm |
|---|---|---|---|
| `bun install --frozen-lockfile` | - | 411 pkgs OK | 411 pkgs OK (same tree + patch) |
| `bun run typecheck` | 0 errors | - | 0 errors |
| `bun run build:wasm` (emsdk) | - | builds v2_dsp.wasm/cjs | builds identically (C++ untouched) |
| `bun run build` | fails at `cp -r src/wasm` (pre-existing, as 2026-10-08) | - | green, entrypoints ok |
| `bun test` | 10 fail / 1983 (5 missing-wasm + pins + 3 slow-timeout flakes + 1 player load-flake; all adjudicated below) | (not run separately; the wasm-port report has 1982/0 on its branch) | **1984 pass / 2 fail, 140 files**: the Belton reverb slow-timeout flake (fails on base too, verified by stash) + the predicted parity divergence below |
| `bun run build:pages` | - | - | 872 pages OK |
| parity test `v2-wasm-oversample > agrees with the reference console` | - | pass | **FAIL at os2/4/8 legs (maxAbs 0.76 vs 1e-4 bar), x1/os3 pass** -- the known divergence: TS AB cascade (latency 19.5/26.25/28.625) vs WASM 57-tap cascade (27.5/41.25/48.125); dominated by the group-delay difference, ~1e-3 ripple underneath. Test left UNCHANGED (not weakened); goes green when the C++ port (section 8) lands. |

Local worktree checks: `bun test packages/runtime/tests/resample.test.ts
packages/runtime/tests/oversample.test.ts
packages/runtime/tests/band-limited-oversample.test.ts` -> 27 pass (23 before
+ 4 new stage-spec tests); `bun run --cwd packages/runtime typecheck` ->
clean; full worktree `bun test` -> 9 fail / 1987 with the change vs 10 fail /
1983 on stashed base (all pre-existing environmental/slow-timeout class:
release-metadata pins needs `dist/`, 5 missing-wasm cross-console, Belton +
bucket-brigade slow timeouts, one player load-flake that passes in isolation
21/21; zero new failures from the change, +4 new tests all green).

Exact commands and real output (bun 1.3.14; worktree src imports; scratch in
`docs/spikes/latency/`, outputs in `/tmp/lat/`):

```
git diff > /tmp/lat/change.patch   # tracked diff only (385 lines)
git clone --branch indiejoseph/warp-latency-spike /home/joseph/projects/VesselDSP/core /tmp/lat-verify
git -C /tmp/lat-verify apply /tmp/lat/change.patch
bun install --frozen-lockfile        # 411 pkgs OK (clone)
bun run typecheck                    # 0 errors (clone, all packages)
source ~/projects/emsdk/emsdk_env.sh; bun run build:wasm   # (cwd packages/runtime) builds v2_dsp.wasm/cjs
bun run build                        # green, dist entrypoints ok
bun test                             # 1984 pass / 2 fail (above)
bun run build:pages                  # 872 pages OK
bun docs/spikes/latency/baseline.ts muff 10 'SUSTAIN=0.5,...' '100,...,16000' /tmp/lat/muff-fr.json  # + sd1/ts9, alias runs
bun docs/spikes/latency/compare-fr.ts
bun docs/spikes/latency/alone2.ts    # B/A-stage scans, round-trip, GD, centroid
bun docs/spikes/latency/debug-spur.ts
bun docs/spikes/latency/stability.ts
bun docs/spikes/latency/pedal-cand.ts <pedal> <cand> <stages> <job> <out>  # FR/alias/td fleet
bun docs/spikes/latency/td-metrics.ts <pedal> <candTag>
bun docs/spikes/latency/c-vs-shipped.ts <pedal> <candTag>
bun docs/spikes/latency/analytic.ts  # RC/RL/ladder/tone vs exact
bun docs/spikes/latency/noreactive.ts
bun docs/spikes/latency/fail-alone.ts
bun docs/spikes/latency/clip-analytic.ts
bun docs/spikes/latency/phase-positive.ts
bun docs/spikes/latency/cost.ts
```

Beside every figure: harness as in section 0 (probe fit) or captioned
(resampler-alone: DTFT grids / whole-period windows / 10 s noise; analytic:
100 mV stiff-source LS fundamental; time-domain: delay-removed relRMS +
maxAbs + harmonic diffs); proves small-signal response, high-drive aliasing,
and clipped-waveform fidelity at centre controls -- not chords, control
sweeps, audibility, or worklet timing.

## 10. What this cannot prove

- Native 192 kHz stands in for analog truth (inherited bound: agreement with
  192 kHz is agreement with ngspice only inside the earlier spike's
  0.04-0.59 dB substitution bounds).
- Three pedals (two diode clippers + one op-amp overdrive into tone stacks),
  centre controls (max drive only for aliasing), stepped sines (10 mV;
  100 mV for aliasing; 250/100 mV two-tone; 100 mV pluck/burst); no chords,
  swept controls, sustained high-gain clipping beyond the SD-1/Muff hot runs,
  no listening test. Audibility claims are explicitly NOT made: the phase
  margin is set relative to the accepted baseline (1.5x/+6 dB), not to hearing.
- The C-vs-shipped direct comparison uses a 0.25-sample search grid (a
  <= 0.125-sample residual may hide in the last digit of the 0.00x% rows).
- Timing is a dev-machine ratio table (contaminated runs were re-run clean;
  stated per table), not a worklet budget claim; the resampler is <= 0.5% of
  the total either way.
- Transition-band folds are still only partially suppressed (k11 -15 dB at
  22.6 kHz, same honest limitation as shipped); content above ~19 kHz pays
  the half-band transition droop (B/AB droop slightly more: k9 -0.63 dB).
- The shipped default is still factor 1: nothing changes for existing callers
  until one passes `oversample`. Non-power-of-two factors keep the legacy
  path (untouched, verified by the unchanged legacy tests).
- C++ port outstanding (section 8); until it lands, TS and WASM consoles
  diverge at os2/4/8 by the AB-vs-57 ripple (~0.01 dB worst-case magnitude).

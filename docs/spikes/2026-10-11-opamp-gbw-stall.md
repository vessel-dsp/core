# Op-amp gain-bandwidth patch: the two stability defects (2026-10-11)

Worker note, written in the order the work was done. Worktree at core main `8cb0439` plus `~/opamp-gbw-phase1.patch`
(the product); the delta on top is `~/opamp-gbw-stall-fix-delta.patch`. WASM built from source with emsdk
(`packages/runtime/scripts/build-wasm.sh`) at every C++ change. Harness: `docs/spikes/opamp-gbw-stall/` (new) over
`docs/spikes/opamp-gbw/lib.ts` (the product's). Logs under `docs/spikes/opamp-gbw-stall/logs/`, numbered in the order
they were taken. Corpus read-only at `~/projects/VesselDSP/artifacts` (`6a5c01bfe`).

## 1. Baseline: the product tree before any change (logs `00-*`, `01-*`)

The two defects reproduce on this box with the product tree's own WASM build:

| check | main (report / forced-null here) | product tree, before the fix |
|---|---|---|
| `boss-mt-2` canary, WASM os1, 8 s (`hotfix-0.4.1/mt2-timeline.ts`) | 0 blocks over 50 ms | 24-28 us/sample for seconds 0-5, then **STALL at 6.440 s** (block of 3743 ms, every sample at the cap) |
| `boss-mt-2` canary, WASM os4 | stall at 0.667 s (report; forced-null trace here: a cap run from sample 31986 = 0.666 s, 293 samples long and ongoing) | 97 us/sample seconds 0-2, 523-903 us/sample seconds 3-5 with 878 blocks over 50 ms, no block over 1 s in the first 6 s; `trace-wasm` sees a 98-sample cap run from 6.369 s and a 28-sample one from 6.593 s |
| `mxr-blue-box` two-tone 2148 samples, TS vs WASM (`bluebox-detail.ts --f32-input`) | os1 r 1.000000 maxAbs 1.80e-4, it/host 4.74, NC 0, peaks 301/301; os2 maxAbs 1.04e-4, it 8.46, peaks 258/345; os4 9.27e-10, it 14.63, peaks 210/210 | os1 **r 0.999996 maxAbs 7.09e-4, it/host 13.10, NC 1, peaks 1024/884**; os2 **r 0.051551 maxAbs 3.65e-2**, it 10.13, peaks 598/**1024**, consoles differ from sample 139; os4 1.21e-5, it 16.55, peaks 599/595 |
| growth documents, os4, parity two-tone (`parity-moved.ts`) | slapback 4.1, od-3 8.0, pq-4 8.1, ph-1r 4.8, dd-3b NC 3 (report) | slapback **16.0** (peak 4: every sub-sample 4 iterations), od-3 **12.0**, pq-4 **12.0**, ph-1r **7.7**, dd-3b NC **4** |

Two facts the report did not have:

- **The stall is a property of the stimulus's rounding and of the console.** The canary generates its two tones as
  `t = i/rate; sin(2*pi*f*t)` (hotfix lib) and feeds the WASM console float32. With that exact input the WASM console
  stalls at 6.440 s; the same input through the TS reference does not (184 non-converged samples in 8 s, no block over
  2 s: `00-baseline-canary-os1-ts.log`, float64 input; `01-trace-ts-mt2-os1-product.log`, float32 input, 145 non-
  converged to 6.4 s and no cap run at 309120). With the other rounding (`(2*pi*f*i)/rate`, `mt2-gbp-scan.ts`) the WASM
  console does not stall either (`01-trace-wasm-mt2-os1-product.log` first run: 184 isolated cap hits, no run longer
  than 3). The consoles are in decision parity over the 2048-sample parity window and drift apart over 6 s; what they
  share is **the same single-sample cap hits at the same places** (TS 2735, 4874-5, 9127, 13383-4, 15518-9; WASM 2735-
  2744, 4877, 9127, 13384, 15514), and a stall is one of those recurring on consecutive samples.
- **Every cap hit is one op-amp section.** On `boss-mt-2` it is stamp 87 (`+=37 -=36 out=38`), with stamp 88
  (`+=41 -=42 out=42`, a unity follower) alongside; on main at os4 (forced null) the 0.666 s stall is the same pair.

## 2. Root cause, with the minimal repro

Instrument: `trace-ts.ts` patches `ReferenceRuntime.prototype.applyStamp` / `iterate` (no source change) and prints,
per Newton iteration, every railed op-amp's differential, step and cap in linear widths, the limited and folded flags,
raw pole state, model output and the solved output node, plus the iterate's max delta and every limiter that fired.
`trace-wasm.ts` reads `getLastIterationCount` per host sample on the WASM console.

### 2.1 M1: the step-cap extremum trap (boss-mt-2, both trees)

`nodes-of.ts boss-mt-2 36 37 38`: section 87's inverting input is the 47k/47k (+100 pF) inverting network from node
35; its **non-inverting input (37) is fed from its own output (38) through a 1 uF capacitor (s79)**, with 330 R to
node 39 and 100 nF to 40. At 48 kHz the capacitor's companion conductance is ~0.1 S against 3 mS, so within one sample
the non-inverting input follows the output at ~0.9 while the inverting one follows it at 0.5: **the per-sample Newton
problem has net positive feedback**. (The 0.4.1 note already documents `boss-mt-2` as dynamically unstable as drawn.)

For such a stage the residual as a function of the differential, `F(d) = d - beta * h(d)` with `h` the tanh output,
has turning points where `h'(d) = 1/beta` on both flanks of the sigmoid. Newton from a turning point jumps far away in
a direction that flips sign across it. The op-amp step cap halves on every reversal ("a straddle"), which is the
right move when a reversal brackets a root inside the linear region, and the wrong one at a turning point, where a
reversal brackets nothing. The cap falls to its floor (`width/64`) and pins the iterate **on** the turning point:

```
sample 4874 (0.1015 s), TS os1, product tree (02-trace-ts-mt2-os1-caphits.log)
it  663: s87 d=1.57w step=-3.99w cap=0.019w LIM FOLD raw=-16.514 out=0.006 vout=...   delta 1.12e-1 @ node 38
it  714: s87 d=1.58w step=+2.82w cap=0.019w LIM FOLD raw=-16.460 out=0.006             delta 2.32e-2 @ node 38
... identical pairs to it 1023: 1024 iterations, limited on 1023 of them, folded on 1016
```

The requested step alternates -4 w / +2.8 w while the cap allows 1/52 w; the Jacobian's sign flips between
d = 1.57 w and 1.58 w. The fold reseed (`OPAMP_FOLD_STREAK`, one per solve) had already fired at iteration ~20 on a
transient streak and cannot fire again; iterations 20-51 and 102-612 show the iterate hunting rail to rail (steps of
+10 w decaying as the cap regrows, then back) before settling into the trap at ~660.

Main's own os4 stall is the same trap: `02-trace-ts-mt2-os4-null.log`, sample 31986.2 (0.6664 s, forced 1 MHz),
s87 and s88 both `LIM FOLD` at `cap=0.016w`, delta 6.80 V at node 38 alternating `vout` 2.408 / 9.209 for the last
hundreds of iterations.

**Minimal repro:** `bun docs/spikes/opamp-gbw-stall/trace-ts.ts --packet=boss-mt-2 --os=1 --from=4874 --to=4876
--detail-min=1000` (one sample, ~1 s wall) shows the two-cycle above; `--os=4 --force-gbp=null --from=31986
--to=31987` shows main's.

What the product changes: nothing in the mechanism. It changes the per-sample effective gain (131 -> 910 at 7 MHz)
and so the trajectory, which is why the report's product scan stalls at 3, 5, 15 MHz and not at 1, 2, 7, 10 with one
rounding and at 7 with another. The trap exists at every product.

### 2.2 M2: the rail leak (mxr-blue-box, and the iteration growth)

The stamp clamps the differential it evaluates to the band (`OPAMP_DIFFERENTIAL_BAND = 12` widths) and floors the
Jacobian at the saturation band, both by design. But the row was linearised at the **clamped** point while its matrix
term uses the unbounded unknown, so at the fixed point the solved output is `f(band) + slope * (Vdiff - band)`: off
its rail by a leak proportional to `slope = alpha*A0*(1 - tanh^2)`, which is proportional to the product.

```
blue-box sample 127.1 (os2), product tree (02-trace-ts-bluebox-127.log): the op-amp switches rails in 6 iterations,
then sits at d=-12.00w raw=-18.094 out=0.003 with the SOLVED output node at -0.290 V (rail 0 V):
  slope = 261 * (1 - tanh(4.02)^2) = 0.17, excess = -1.7 V.
it 7-30: the two NPN stages it drives (s26 b=16, s32 b=18) junction-limited; it 31-200: delta pinned at 5.17e-3 with
no limiter (a clamped-exponent walk at node 18); converged at 309. Forced 1 MHz: the same sample converges in 14.
```

**Minimal repro:** `bun docs/spikes/opamp-gbw-stall/trace-ts.ts --packet=blue-box --os=2 --from=127 --to=128
--detail-min=20`.

The decision divergence at os2 (sample 139) is a sample where one console's long solve reaches the cap and the other's
does not; the iteration growth on the five documents is the same leak on saturated sections (a Schmitt oscillator or a
clipped stage whose output drifts with its input instead of sitting on the rail, so the predictor cannot land a one-
iteration solve).

## 3. Pre-registered predictions and candidates

`docs/spikes/2026-10-11-opamp-gbw-stall-predictions.md`, sha256
`690f1845d4a6d50a30064a620304ab9bee1917056e7b016617aa51d4079896c5`, recorded 2026-10-11T19:33:09Z in
`2026-10-11-opamp-gbw-stall-predictions.sha256` with the pre-fix tree's `git status`. Candidates: **C2** (consistent
linearisation beyond the band, for M2), **C1** (re-armed fold reseed, for M1), **C3** (cap reset at the floor,
fallback for M1).

## 4. What was tried, in order, and what each did (TS console, same stimulus; logs `04-*` to `09-*`)

Every step below was measured on the TS reference before the C++ mirror was written, on the parity two-tone
(2148 host samples for blue-box, 2048 for the growth documents, the first 20000 samples of the canary for mt-2).
`it/host` is total Newton iterations over host samples; `NC` non-converged host samples; `peak` the largest solve.

| step | blue-box os1 it/host, NC, peak | blue-box os2 / os4 | slapback / od-3 / pq-4 / ph-1r os4 it/host | dd-3b os4 NC | mt-2 os1 NC (20000 samples), peak |
|---|---|---|---|---|---|
| product tree, before | 13.10, 1, 1024 | 10.0 / 16.6 | 16.0 / 12.0 / 12.0 / 7.7 | 4 | 6, 1024 |
| main (forced 1 MHz, same binary) | 4.80, 0, 301 | 8.46 / 14.6 | 4.1 / 8.0 / 8.1 / 4.8 (report) | 3 | 14 at os4 (null) |
| C2 alone (consistent row beyond the band) | 12.13, 0, 921 | 10.0 / 16.6 | 16.0 / 12.0 / 12.0 / 7.7 | 4 | 4, 1024 |
| + C1 (re-armed fold reseed, limited-only trigger) | - | - | - | - | **0, 167**; but main's os4 31986.2 diverges to NaN |
| + C4 (seed-relative first step) + C8 (op-amp-ratio damping, raw differential) | 1073 NC: a saturated section beyond the band "requests" its excess forever | | od-3 every sample at the cap | | 184 NC |
| C8 measured against the band-clamped differential | 7.56, 1, 1024 | 7.75 / 6.2 | 4.07 / 8.0 / 8.7 / 7.5 | 4 | 2, 1024 |
| + C5b (relaxation engages on reversal only) + fold = cap at floor while reversing | 3.88, 0, 234 | 5.86 / 5.78 (os4 NC 1) | 4.07 / 8.0 / 8.7 / 7.5 | 3 | 0, 198 |
| **final: fold = cap at floor (reversing or not)** | **3.81, 0, 74** | **5.74 / 5.37**, NC 0 | 4.07 / 8.0 / 8.7 / 7.5 | **0** | **0, 193** |

The final solver change, both consoles (`reference-runtime.ts` ideal-opamp stamp and `iterate`, `Engine.cpp` the
same two places plus `opAmpStepDamping`, declared in `Engine.h`):

1. **Consistent linearisation beyond the band (C2).** `rhs = output - slope * (limited ? differential : rawDifferential)`.
   The fixed point is `Vout = f(bounded)` exactly; inside the band nothing changes.
2. **Seed-relative first step (C4).** With no history, `previousDifferential = bounded` so the first step is 0.
3. **Fold = the cap at its floor (C1').** `folded = cap <= linearWidth / 8`, recorded on `limitedOpamp` whether or
   not this step overran the cap (`limitedIterate` is still set only when it did).
4. **Re-armed fold reseed (C1).** Every fresh `OPAMP_FOLD_STREAK` streak earns a reseed; odd ones to the rail
   opposite the sample's start, even ones back.
5. **Op-amp-ratio step damping (C8).** After the linear solve and before relaxation the whole update is scaled by
   the smallest of `cap / |band-clamped requested step|` and `2 * halfSwing / |output step|` over the block's railed
   op-amps. An unlimited op-amp scales nothing.
6. **Reversal-gated relaxation (C5b).** `noImprovement` advances only when the worst node's step reversed sign
   against the previous iteration (same node, opposite sign); engagement and tightening are otherwise unchanged.

Not changed: the products, the catalog, the pole discretisation, the bands, the floors, the tolerances, the
budget/probation, the predictor, the eliminated-block path (`iterateEliminated`, untouched on both consoles).

`boss-ph-1r` (TL022, 0.5 MHz) is the one growth document the fix does not bring under 1.25x main: its stages are
never limited; at the stated product every sub-sample's first Newton step from the predicted start lands 1.9e-4 V
off at node 25 against a 1e-3-relative tolerance and the solve takes a second iteration (`07-all-ts-*`, sample
1000: used 2, worstDelta 1.2e-10 at the second), where at 1 MHz the first step is within tolerance (used 1,
4.0e-5). That is the predictor meeting the tolerance by a hair at one pole and missing it by a hair at another;
no solver mechanism in this note is involved and I did not tune the tolerance or predictor to it.

## 5. Console parity at os4 on `mxr-blue-box`: a finding, not a fix (logs `15-*`, `16-sensitivity.log`)

With the fix on both consoles the blue-box parity rows pass at os1 and os2 to 1e-9 (they failed on the product tree
and at os1 on main) but **fail at os4**, where the product tree passed at 1.2e-5: the consoles agree to 1e-7 up to
sample 135, then separate exponentially (6.6e-7 at 135, 1.8e-4 at 144, 2.9e-2 at 155) while both converge every
sample in one to four iterations and no reseed fires (`diverge.ts`). That is not a decision mismatch but the circuit
amplifying a rounding difference, and `sensitivity.ts` shows it on one console alone: perturbing one input sample
by **1e-12 V** separates two TS renders of blue-box at os4 by 3.0e-5 (1e-9 reached at sample 411, 1e-6 at 960; the
perturbed run hits the cap once), by 4.1e-6 at the forced 1 MHz product, and by **2e-15 at os1 and 4e-16 at os2**.
`boss-mt-2` at os4 over 48000 samples with 188 reseeds stays at 5.7e-11 between the consoles and 4e-12 under the
same perturbation. The blue-box's octave-divider stage is metastable at os4 on this stimulus at either product; the
two consoles differ in their `tanh`/`exp` libraries by ulps, so which side they fall on is luck, and the product
tree's 1.2e-5 at os4 (four orders above its other rows) was that luck holding. The first reseed is sent to the
start's rail (section 4) because the opposite-rail order was measured to turn one such ulp difference into a
different root choice (sample 76 / 89 before that change); it did not and cannot make a metastable sample
deterministic across libms. **G2's os4 parity row is reported as FAIL for this reason**; the G2 cost and
non-convergence rows pass.

## 6. Two regressions the first full gate run found, and what fixed them (logs `18-*` to `23-*`, `26-*`)

- **`boss-aw-2` rendered a dead output on TS and a latched 85 mV one on WASM** (product tree: 1.383 mV on both,
  peak 4). Toggling each candidate (`level.ts`) attributed it to the op-amp-ratio damping acting **at the DC
  operating point**, where `alpha = 1` makes the linear width 45 uV and the damping quenched the continuation into
  a latched envelope stage. Damping and the reversal-gated brake are now transient-only; the DC walk is left exactly
  as it was. aw-2 is back to 1.383 / 1.396 mV, peak 3 / 2 at os1 / os4.
- **An idle section was reseeded onto a rail.** With "fold = cap at the floor" alone, a section whose differential
  merely jitters by 1e-6 widths reverses sign every iteration, its cap collapses to the floor, and after six
  iterations it was thrown to a rail (`boss-aw-2` sample 1489: 527 iterations). The fold now also requires the step
  to be at least a quarter of the floor cap (`linearWidth / 256`); jitter is four orders below that, a trapped
  iterate moves by the cap or by a damped fraction of it.
- **The gate run's own contamination.** The G2 parity job of the final run started while I was toggling candidates
  on the TS source to attribute the aw-2 regression, and it measured the "reseeds off" source (dd-3b os1: 98
  non-converged, identical to that toggle). The G2 rows were re-run on the clean source (`28-g2-*`); the table
  below uses those. Nothing else in the run overlapped a toggle (G3/G4/G5 and `bun test` started after the source
  was restored, `grep -c TOGGLE` = 0).

## 7. Results against the gates (final tree: logs `24-*`, `28-*`, `25-bun-test-final.log`)

| gate | bar | result | verdict |
|---|---|---|---|
| **G1** canary 8 s, WASM, no block over 20 s | os1, os2, os4 | os1 **0 blocks over 50 ms** (18-25 us/sample, was 24-28 then a 3.7 s block at 6.44 s); os2 one block over 50 ms, none over 1 s; os4 one block over 50 ms, none over 1 s (57-70 us/sample, was 97-1300 with 878 slow blocks). TS os1 (20000 samples): 1-4 isolated exhausted samples, no run | **PASS** |
| G1 bonus: main's os4 stall | shares the cause? | forced-null os4 on the fixed solver: 8 s, one isolated cap hit, no run (was a 293-sample run from 0.666 s); 48000 samples TS-vs-WASM 5.7e-11 | **same cause, removed** |
| **G2** blue-box parity | no worse than main at x1 / os2 / os4 | x1 max abs 1.03e-9 (main 1.80e-4), r 1.000000; os2 9.29e-10 (main 1.04e-4); **os4 3.49e-2, r 0.016 (main 9.27e-10)** | x1, os2 PASS; **os4 FAIL** (section 5: metastable, not a decision) |
| G2 blue-box cost | it/host <= 1.25x main; NC <= main; WASM peak < cap | it/host x1 3.79 (main 4.74), os2 5.73 (8.46), os4 5.8 (14.6); NC x1 0, os2 0, **os4 1** (main 0); peaks x1 77/77, os2 499/233, **os4 1024/1024**; 1 kHz 100 mV os4 NC 11 -> 13 (main 0), 10 mV x1 NC 255 -> 17 | cost PASS at all factors; NC and peak PASS at x1/os2, **FAIL at os4** (the metastable sample) |
| G2 growth documents | it/host <= 1.25x main at os4 | slapback 16.0 -> **4.1** (main 4.1), od-3 12.0 -> **8.0** (8.0), pq-4 12.0 -> **8.7** (8.1, x1.07), **ph-1r 7.7 -> 7.5 (4.8, x1.56)**, dd-3b NC 4 -> **0** (3) | 4 of 5 PASS; **ph-1r FAIL** (section 4: the predictor's start misses the tolerance by 1.9e-4 V at 0.5 MHz; not a limiter effect) |
| **G3** accuracy on six packets + Rat | <= 0.1 dB at 1/8/16 kHz vs product tree | muff, sd1, ts9, ts808, gro100, rat: **0.000 dB on every cell at 100 mV and 10 mV, iteration counts identical** (no op-amp in them is ever limited, so the path is bit-identical); **blue-box moves** (+0.4 / -40.6 / +118.6 dB at 1/8/16 kHz x1 100 mV: the clipped octave-fuzz content, rendered without the rail leak and the held samples; its pre-fix 10 mV x1 render held 255 samples) | 6 of 7 PASS; **blue-box FAIL** on the numbers, by construction of that packet |
| **G4** identity on the 38 moved documents | <= 0.05 dB where unmoved | **36 of 38 within 0.05 dB at every cell** (74 of 76 rows); the 2 outside are blue-box's rows above; aw-2 restored to 0.000 dB; no stall anywhere | PASS with blue-box listed |
| **G5** suite and parity | full `bun test`, three typechecks, WASM rebuilt, six-packet parity unchanged | `bun test` 2062 pass / 1 fail (the known `release metadata` dist failure); runtime, player, compiler typecheck exit 0; WASM `dc49a0b3...` from source; parity-os: 17 of 18 rows PASS, blue-box os4 FAIL as above. One test bar moved: `pipeline.test.ts` S6 unstable-loop peak <= 10 -> **12** (it reads 11 with the damping; comment in the test) | PASS with the S6 bar and the os4 row stated |
| **G6** speed | profile-packet it/host within 5 % at x1 and os4 | identical (x1.00) on all six and the Rat; blue-box 23.2 -> 4.6 (x1) and 16.0 -> 7.5 (os4); the canary 25 -> 20 us/sample at os1 and 97 -> 65 at os4 | PASS |

## 8. Prediction scorecard (`2026-10-11-opamp-gbw-stall-predictions.md` and its three addenda)

| prediction | outcome |
|---|---|
| P1 C1 alone removes the os1 canary stall; main's os4 stall too | **held** (TS cap hits 6 -> 0 with C1+C2; the WASM canary passes with the final set; main's os4 run gone) |
| P2 C2 alone brings blue-box x1 to <= 7 it/host, os2 peak < 700, os4 NC 11 -> 0 | **failed**: 13.1 -> 12.1; the leak is real but is not the cost (P7's negative control fired, as written) |
| P3 C2 alone brings the growth documents under 1.25x main | **failed**: unchanged; the cause was the per-sample re-walk (C4), not the leak |
| P4 accuracy within 0.1 dB except blue-box <= 0.5 dB | **held for six packets and the Rat at 0.000 dB; failed for blue-box** (far beyond 0.5 dB; reported as G3 FAIL for it) |
| P5 identity: fewer than 10 moved documents move | **held**: 1 (blue-box) |
| P6 speed within 5 % | **held** (identical) |
| P8 if C1 does not remove the stall, M1 is incomplete | C1 removed the cap hits but exposed the explosion (M4) and NaN on main's os4; M1 **was** incomplete as stated |
| P9 C4 brings slapback <= 8, od-3/pq-4 <= 8, ph-1r <= 6 | **held for slapback (4.1), od-3 (8.0); pq-4 8.7 just over; ph-1r failed (7.5)** |
| P10 C8 brings blue-box per-switch cost under 150 and x1 it/host under 6, no NaN | **held** (peak 77 at x1, it/host 3.8; no NaN on main's os4) |
| P11 profile packets within 5 % | **held** (identical) |
| P12 same-rail-first restores blue-box os4 parity | **failed**: the os4 divergence is metastability, not reseed order (section 5) |
| P13 TS set keeps its figures after same-rail-first | **held** (and improved: mt-2 os4 null NC 3 -> 0) |
| P14 tr-2-style Schmitt LFOs may cost a streak more, NC must not rise | not measured directly; `bun test` (which covers the tr-2 LFO fold) passes |
| P15 aw-2 returns to the product tree's levels; G4 holds except blue-box | **held** (0.000 dB; 36 of 38) |
| P16 TS set keeps its figures after the DC gating and fold motion test | **mostly held**: blue-box x1/os2 and dd-3b unchanged; mt-2 os1 TS shows 1-4 isolated exhausted samples in 20000 (0 before the aw-2 fix, which had been reseeding idle sections as a random kick); the canary still passes |
| P17 S6 passes at 12 | **held** |

## 9. What was NOT fixed, and what this cannot prove

- **`mxr-blue-box` at os4** is metastable on this stimulus at either product (section 5): one non-converged sample
  per 2148 on both consoles, console parity by luck, levels that move by tens of dB in the clipped harmonics. No
  solver decision makes that deterministic across libms; a listening or hardware comparison of the fixed render
  against the product tree's is the only way to say which is right, and neither is claimed.
- **`boss-ph-1r`** stays at 1.56x main's iterations at os4: the predictor's start misses the tolerance by a hair at
  the stated 0.5 MHz. Fixable only by touching the predictor or the tolerance, which this change does not.
- **`boss-mt-2` at os1** still has isolated single-sample exhaustions (1-4 in 20000 on TS, one cap hit in 8 s on
  WASM at os4 forced null): the tangency (a double root of the per-sample Schmitt problem) at which neither rail
  converges. They no longer run consecutively, which is what a stall was; the sample is held and counted as before.
- **The relaxation brake at DC and the DC damping** were left exactly as they were because turning them on at DC
  broke `boss-aw-2`; the explosion mechanism exists at DC too and is covered only by the existing continuation.
- **NaN iterates read as within tolerance** (`maxAbsDifference` of NaN is 0; `31986.2` was once classified "solved
  but flagged" on a NaN). Not fixed; reported.
- **What the pass means.** SPICE parity and hardware were not re-measured; the six profile packets and the Rat
  render bit-identically, so the product's hardware evidence (TS-9 +0.20 dB, RAT -2.68 dB at 16 kHz) is unchanged
  by construction, not re-proven. The corpus movement is one stimulus per cell. The canary is one input and one
  rounding; a different rounding reached different samples before, and it was the isolated cap hits, not the run,
  that this change removed the mechanism of.

## 10. Deliverables and handoffs

- `~/opamp-gbw-stall-fix-delta.patch`: the diff of this worktree against main plus `~/opamp-gbw-phase1.patch`
  (code in `packages/runtime/src/reference-runtime.ts`, `packages/runtime/src/cpp/Engine.cpp`,
  `packages/runtime/src/cpp/include/v2/Engine.h`; the S6 test bar in `packages/runtime/tests/pipeline.test.ts`;
  this note, the predictions file and its hashes; the harness and logs under `docs/spikes/opamp-gbw-stall/`),
  checked to apply on a fresh clone of main after the product patch.
- Owner decisions, unchanged from the product report and not decided here: the stale-runtime policy for the new
  stamp field; whether to pursue the second-order pole. New for the owner: whether `mxr-blue-box` at os4 (metastable
  on both trees) is acceptable as shipped, and whether the S6 budget of 12 is.

Note on the logs: the per-iteration trace logs over 1 MB (`01-trace-ts-*`, `02-trace-ts-*`, `04-*`, `06-*`, `07-*`,
`09-*`, `13-*`, `18-*`, `20-*`, `23-*`, `26-*`, `27-*` with full detail) were deleted before the delta patch was cut,
since the patch would otherwise be 100 MB; every one regenerates from the `trace-ts.ts` command quoted beside its
finding, and the summary lines quoted in this note were taken from them before deletion.

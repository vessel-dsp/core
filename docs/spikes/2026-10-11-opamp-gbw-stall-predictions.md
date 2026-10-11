# Op-amp GBP stall fix: predictions, written BEFORE any engine change (2026-10-11)

Hash and time are in `2026-10-11-opamp-gbw-stall-predictions.sha256`. Nothing in `packages/` has been edited
beyond `~/opamp-gbw-phase1.patch` at the time of writing; the only files I have added are the harness under
`docs/spikes/opamp-gbw-stall/` and the logs it wrote.

## What the traces found (the basis for the predictions)

Two mechanisms, both in the ideal-op-amp stamp's Newton machinery, both on both consoles:

**M1, the extremum trap (boss-mt-2).** Op-amp section s87 (`+=37 -=36 out=38`, 7 MHz) has its non-inverting
input fed from its own output through a 1 uF capacitor (s79) and 330 R to node 39: at 48 kHz the capacitor's
companion conductance is ~0.1 S, so within one sample the stage has net positive feedback and the per-sample
Newton problem is a Schmitt trigger. Its residual as a function of the differential has turning points where
`slope * beta = 1`; the step cap halves on every reversal and so drives the iterate onto a turning point, where
the Newton direction flips sign across one floor-sized step (`cap = width/64`, `step` alternating -4 w / +2.8 w,
measured at sample 4874 iterations 663-1023 and at every cap-hit sample traced). The one-shot fold reseed has
already fired early in the solve (the first transient streak) and cannot fire again. The same two-cycle (s87 and
s88 `LIM FOLD` at `cap=0.016w`, delta 6.8 V alternating at node 38) is what unchanged main does at os4 at 0.666 s
on the TS console, so main's os4 stall is the same mechanism. A stall is this trap recurring on consecutive samples
once the circuit state has been advanced from the non-converged iterate.

**M2, the rail leak (mxr-blue-box).** When the solved differential lies beyond the differential band (12 widths)
the row is linearised at the band edge but its matrix term uses the unbounded unknown, so the solved output is
`f(band) + slope * (Vdiff - band)` rather than `f(band)`. `slope = alpha*A0*(1 - tanh^2)` is proportional to the
product, so the leak is 4x larger at 4 MHz than at 1 MHz. Measured at blue-box sample 127.1 (os2): the op-amp's
own output is 0.003 V against a 0 V rail while the solved node is -0.290 V; the next 300 iterations are the two
NPN stages downstream (`s26 b=16`, `s32 b=18`) walking out of the junction state that sub-rail output put them in.

## Candidates (chosen on mechanism; tried in this order)

- **C2 (M2): consistent linearisation beyond the band.** In the op-amp row, when the step limiter is not active
  and the differential is beyond the band, linearise at the actual previous differential: `rhs = output -
  slope * rawDifferential` instead of `- slope * bounded`. The fixed point becomes `Vout = f(bounded)` exactly
  (the rail), the Jacobian floor still gives Newton a direction out of saturation, the step limiter path is
  untouched. Both consoles.
- **C1 (M1): re-arm the fold reseed.** Allow the fold reseed to fire again when a fresh floor streak forms after
  the first, alternating the target rail (odd reseeds to the rail opposite the sample's start, even ones back),
  each needing its own `OPAMP_FOLD_STREAK` run. Bounded by the iteration budget. Both consoles.
- **C3 (fallback for M1 if C1 does not hold):** reset the step cap to `maxStep` instead of pinning at the floor
  when a limited op-amp reverses at the floor (a kick off the turning point).

Not candidates: changing declared products, the catalog, the pole discretisation, the bands, the tolerances.

## Predictions (each falsifiable; failures will be scored as plainly as successes)

- **P1 (C1 alone, mt-2):** the WASM os1 canary (8 s, 128-sample blocks, cap 1024) completes with no block over
  1 s; WASM last-sub-sample cap hits over 8 s at os1 fall from 184 to under 40. The forced-null (main-equivalent)
  os4 run no longer stalls at 0.666 s (bonus: same mechanism).
- **P2 (C2 alone, blue-box, two-tone 2148 samples):** os1 TS iterations/host 13.1 -> 7 or fewer (main 4.7), TS
  non-converged 1 -> 0, peaks below 1024 on both consoles; os2 WASM peak 1024 -> below 700 and r >= 0.9999,
  max abs < 1.5e-4 (main 1.04e-4); os4 TS it/host 16.6 -> 15 or fewer (main 14.6) and the 1 kHz 100 mV
  non-converged 11 -> 0.
- **P3 (C2 alone, the five growth documents at os4, parity two-tone):** slapback-echo 16.0 -> 10 or fewer,
  od-3 12.0 -> 10 or fewer, pq-4 12.0 -> 10 or fewer, ph-1r 7.7 -> 6 or fewer, dd-3b non-converged 4 -> 3 or
  fewer. Mechanism claim being tested: their op-amps are saturated (Schmitt oscillators / clipping) and the leak
  is why the predictor cannot land a one-iteration solve.
- **P4 (accuracy, C1+C2):** the six profile packets and the Rat fixture move by no more than 0.1 dB at 1, 8 and
  16 kHz against the product tree (this worktree before the fix), except that blue-box at 8 and 16 kHz may move
  up to 0.5 dB (its 8/16 kHz content is clipped harmonics and its op-amps are saturated, where C2 changes the
  solved output by the removed leak). If blue-box moves by more than 0.5 dB I will report G3 as failed for it.
- **P5 (identity, C1+C2):** of the 38 moved documents, those whose op-amps never saturate and never fold render
  within 0.05 dB of the product tree at 1/8/16 kHz, x1 and os4. Documents that move more will be listed with
  their numbers; I predict fewer than 10 (the saturating/oscillating ones).
- **P6 (speed):** iterations per host sample on the six profile packets at x1 and os4 within 5 % of the product
  tree before the fix; blue-box improves.
- **P7 (negative control):** if C2 does not reduce blue-box's os1 it/host below 10, M2 is not the blue-box's cause
  and I will say so.
- **P8 (negative control):** if C1 does not remove the os1 canary stall, M1 as stated is incomplete.

## What the result cannot prove even if all pass

That the physical MT-2 stage is stable (it is drawn with per-sample positive feedback; the engine's fold is a
property of the drawing at this rate); that the leak-free saturated output is closer to hardware (no capture
here); anything about the os4 cost of boss-mt-2 beyond "no stall".

## Addendum 1 (2026-10-11, after measuring C2 and C1 on the TS console; hashed separately below)

Measured so far (TS only, same stimulus): C2 alone moves blue-box os1 from 13.1 to 12.1 it/host and the growth
documents not at all (P2, P3 fail as written; P7's negative control fires: the leak is real but is not the cost).
C1 removes every mt-2 cap hit in the first 20000 samples at os1 (6 -> 0, peak 1024 -> 167; P1's TS half holds) but
main's os4 sample 31986.2 now diverges to NaN by iteration 30 instead of two-cycling. The traces behind both show
the same thing: the linear solve through an op-amp row whose slope times the loop's positive-feedback fraction is
near 1 is singular, and its iterates leave the physical domain (blue-box sample 336: the solved output node at
910, -1424, 10335 V during a rail switch; mt-2 31986.2: -30 V at iteration 4, then every limiter in the block
firing and 1e88 by iteration 26). The downstream junctions then walk back at 0.2 Vt per iteration because the
non-contracting detector latched relaxation during the mess. A second, independent cost: `opampHistory` is
cleared every sample, so the first iterations of every sample re-walk each saturated section's differential from
zero to its operating point at 4 widths per iteration, which is why `electro-harmonix-slapback-echo` needs exactly
4 iterations per sub-sample at 4 MHz (its differential sits at the 12-width band) and od-3/pq-4 exactly 3.

Two further candidates, both mechanism-level and both in the same stamp/loop:

- **C4 (history seeded from the start):** at a solve's first iteration, an op-amp's previous differential is the
  seed's own (bounded) differential and its step is 0, instead of 0 and `bounded`. This is what SPICE does (the
  first iterate of a time point is compared against the previous time point's solution). Prediction P9: slapback
  os4 16.0 -> 8 or fewer, od-3 and pq-4 12.0 -> 8 or fewer, ph-1r 7.7 -> 6 or fewer (all within 1.25x main);
  blue-box os1 it/host falls by at least 2. Converged solutions unchanged; iteration counts fall on every document
  with a saturated section at any product, so G4 will list the moved documents.
- **C8 (global damping by the op-amp's own limiting ratio):** when a railed op-amp's requested differential step
  exceeds its cap, the whole Newton update is scaled by `cap / |step|` (the smallest over the block's op-amps),
  so the iterate stays consistent and the output node cannot leave the physical domain through a near-singular
  tangent. Prediction P10: blue-box's per-switch cost falls from 250-900 iterations to under 150 (main's peak is
  301), os1 it/host under 6 (G2 bar 5.9), peaks below the cap on both consoles; mt-2 os4 31986.2 (forced null)
  converges or exhausts finitely without NaN; mt-2 os1 20000-sample cap hits stay at 0 with C1. Prediction P11
  (risk): iterations on the six profile packets within 5 % (their op-amps are not limited at 10-100 mV).
- Finding to report, not fix: a NaN iterate reads as within tolerance (`maxAbsDifference` of NaN is 0) and, with
  the limiter flag set, is classified by the residual; `31986.2` was counted "solved but flagged" on a NaN.

## Addendum 2 (2026-10-11, after the first gate run on both consoles; hashed below)

Measured with C1, C1', C2, C4, C5b, C8 on both consoles (WASM rebuilt): G1 holds at os1, os2 and os4 and main's
forced-null os4 stall is gone; blue-box parity passes at os1 and os2 but **fails at os4** (r 0.016, max abs
3.5e-2 from sample 89), where the product tree passed. `diverge.ts`: the TS console took a fold reseed at sample
76 (its second) and flipped rails, the WASM console converged in four iterations without one, and the two drifted
apart from sample 89. Change made after that measurement: **the first reseed goes to the rail the sample started on
(the physical continuation), the second to the opposite**, both consoles. Prediction P12: blue-box os4 parity
returns to pass (r >= 0.9999, max abs < 1e-4) on the rebuilt WASM; P13: every TS figure in addendum 1's set stays
within its bars (blue-box NC 0 at all factors, mt-2 os1 NC 0 in 20000 samples); P14 (risk): `boss-tr-2`-style
Schmitt LFOs whose start rail has vanished now spend one extra streak before the opposite-rail reseed, so their
peak iterations may rise but their non-converged counts must not.

## Addendum 3 (2026-10-11, after the first full gate run; hashed below)

Two regressions the gate run found, both fixed before the final run: (1) `boss-aw-2` rendered a dead output on the
TS console and a latched 85 mV one on WASM (product tree: 1.383 mV on both, peak 4). Attributed by toggling to the
op-amp-ratio damping applied **at the DC operating point**, where `alpha = 1` makes the linear width a hundred-
thousandth of the swing and the damping quenched the continuation into a latched envelope stage; the damping and
the reversal-gated brake are now transient-only (`dc` leaves both exactly as they were). (2) With the fold defined
as "cap at the floor" alone, an idle section whose differential jitters by 1e-6 widths also reached the floor and
was reseeded onto a rail (`boss-aw-2` sample 1489, 527 iterations); the fold now also requires the step to be at
least half the cap. Prediction P15: `boss-aw-2` returns to the product tree's levels at every cell (within 0.05 dB)
and the G4 identity holds for all moved documents except `mxr-blue-box`; P16: the TS set of addendum 1/2 keeps its
figures; P17: the S6 pipeline budget test passes at 12 (it reads 11 with the damping, 10 without).

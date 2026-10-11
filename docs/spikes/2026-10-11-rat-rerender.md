# RAT2 RT-301860 re-render with the current engine

Date: 2026-10-11. Engine: core 49cc15c (runtime 0.4.1, audio taper 17.5 % at half rotation), TS ReferenceRuntime, 96 kHz native, one render per cell, analysis window 0.8 s after 0.4 s of settling. Fixture: the Rat study fixture (sha256 prefix adc16103f4aeaf2a), compiled with `pedalPartCatalog`, edited only on the compiled program. Predictions: `2026-10-11-rat-rerender-predictions.md` (hashes and times in `2026-10-11-rat-rerender-predictions.sha256`; round 1 and its lane C amendment before any run, round 2 after round 1 and before its lanes). Scripts: `rat-rerender/rerender.ts`, `nodes.ts`. Raw numbers: `rat-rerender/results-round1.json`, `results.json` (round 2). Analysis only: no source, engine or packet value changed.

## Hardware comparison points

Volume at maximum (capture session 2, 1 kHz, Distortion 0.5 / Filter 0.5 by resistance): H1 565.5 / 592.1 / 595.3 mV, H2 -39.25 / -27.06 / -24.75 dBc, H3 -14.78 / -13.49 / -13.19 dBc, THD -14.28 / -12.68 / -12.18 dB at 10 / 30 / 100 mV. Volume at 17.5 % (session 1, 100 mV only): H1 99.5 mV, H2 -24.76, H3 -13.18, THD -12.18.

## Result: with every measured input set, level, H3 and THD agree and only H2 misses, and only when the op-amp saturates

| Lane (Volume 1.0) | mV | H1 mV | H2 dBc | H3 dBc | THD dB |
|---|---|---|---|---|---|
| hardware | 10 / 30 / 100 | 565.5 / 592.1 / 595.3 | -39.25 / -27.06 / -24.75 | -14.78 / -13.49 / -13.19 | -14.28 / -12.68 / -12.18 |
| A baseline | 10 / 30 / 100 | 554.3 / 555.7 / 555.9 | -37.07 / -37.75 / -38.51 | -12.81 / -12.65 / -12.62 | -12.13 / -11.93 / -11.90 |
| G all measured | 10 / 30 / 100 | 590.6 / 634.3 / 634.6 | -41.92 / -41.19 / -41.74 | -14.52 / -12.77 / -12.74 | -14.05 / -12.07 / -12.03 |

- G reproduces H1 within +0.4 to +0.6 dB, H3 within 0.7 dB and THD within 0.6 dB at all three levels.
- G's H2 is 2.7 dB from the hardware at 10 mV, where the op-amp is not saturated, and 14 to 17 dB short at 30 and 100 mV, where it saturates. The 10 to 30 mV H2 jump of about 12 dB on the hardware is absent from G (it moves 0.7 dB).

## Lane effects on H2 at 100 mV (Volume 0.5; Volume 1.0 differs by under 0.1 dB)

| Lane | H2 dBc | change from A |
|---|---|---|
| A baseline | -38.57 | |
| B pot tracks | -38.51 | +0.1 |
| D 10k load removed | -47.90 | -9.3 (H1 +1.0 dB) |
| E JFET at the measured point | -32.22 | +6.4 |
| F op-amp limits 1.0 / 7.9 V | -41.98 | -3.4 |
| C supply 8.88 V (unplanned finding) | -25.18 | +13.4 |
| G all measured | -41.85 | -3.3 |

## Round 2: sensitivity of H2 to the offset between the op-amp's limits and the bias (lane G, Volume 1.0)

a = (railHigh + railLow) / 2 minus the bias of 4.435 V. The measured limits give a = +0.015 V (lane G); the OT3's readout step of 0.05 V cannot resolve a.

| a (V) | H2 at 10 mV | H2 at 30 mV | H2 at 100 mV |
|---|---|---|---|
| -0.065 | -44.67 | -36.75 | -35.01 |
| 0.000 | -42.44 | -43.42 | -43.39 |
| +0.015 (lane G) | -41.92 | -41.19 | -41.74 |
| +0.040 | -41.08 | -36.57 | -36.47 |
| +0.065 | -40.27 | -31.76 | -30.71 |
| +0.090 | -39.51 | -27.79 | -28.42 |
| +0.115 | -38.78 | -25.58 | -25.65 |
| +0.165 | -37.42 | -24.07 | -24.11 |
| hardware | -39.25 | -27.06 | -24.75 |

At a between +0.09 and +0.115 V one parameter reproduces all three hardware H2 values to within about 1.5 dB, including the jump between 10 and 30 mV. H1, H3 and THD stay put across the scan (H1 633.9 to 634.7 mV, H3 within 0.2 dB, THD within 0.2 dB).

## Prediction scorecard (pre-registered; stated plainly)

| | Held? | Evidence |
|---|---|---|
| P1 A and B agree on H1 within 0.5 dB | yes | 0.04 dB at 100 mV, 0.14 dB at 10 mV |
| P2 A has H2 within 3 dB of -40 | yes | -37.1 to -38.6 |
| P3 E alone gives H2 between -38 and -30, not above -28 | yes | -32.2 (my estimate was -34) |
| P4 D changes H2 by under 2 dB and H1 by under 0.5 dB | **no** | H2 -9.3 dB, H1 +1.0 dB |
| P5 F changes 100 mV H2 by under 2 dB and 10 mV H3 by 3 dB or more | **no, both parts** | H2 -3.4 dB; 10 mV H3 only -1.4 dB |
| P6 G stays at or below -30.8 dBc | yes | -41.85 (17 dB short of the hardware) |
| P7 A's 10 to 30 mV jump under 4 dB, and G reproduces at least 6 dB | A yes, **G no** | A: -0.7 dB; G: +0.7 dB |
| P8 G H1 at Volume 1.0 within 1.5 dB of 595 mV | yes | +0.56 dB |
| R1 H2 at 100 mV rises with |a|, and is between -31 and -20 at |a| = 0.065 | **partly** | rises 0.015 to 0.165 (-41.7 to -24.1); +0.065 gives -30.7 (just inside), -0.065 gives -35.0 (outside) |
| R2 for |a| of 0.065 or more, 30 mV H2 is 5 dB or more above 10 mV | yes | +7.9 to +13.3 dB |
| R3 H1 changes under 0.5 dB across the scan | yes | under 0.01 dB |
| R4 H3 and THD change under 0.7 dB across the scan | yes | 0.2 dB |
| R5 sign symmetry within 3 dB | **not met, not falsified** | 4.3 dB apart (-35.0 and -30.7); the falsifier was 6 dB |

## What this does and does not show

- **Shown:** every measured input set on the compiled program reproduces the hardware's level, third harmonic and total distortion, and the 10 mV second harmonic (2.7 dB). Of those inputs, the JFET operating point (+6.4 dB of H2) and the missing 10k load (-9.3 dB of H2) matter most for the second harmonic; the 10k load matters more than I expected.
- **Shown:** the second harmonic the hardware has at 30 and 100 mV is reproduced by a small offset between the op-amp's swing limits and its bias. A 65 mV offset moves H2 by about 10 dB, and about 100 mV reproduces the hardware.
- **Not shown:** that the hardware has such an offset. The scope's resolution, about 0.05 V on each of VMAX and VPP, leaves the offset uncertain by about 0.05 V, and the offset the hardware would need is about 0.1 V above the measured 0.015 V. The honest claim is "consistent with, not demonstrated". Other candidates for the saturated-state H2 are untouched: the real clip diode curves and the op-amp's output stage shape.
- **Withdrawn:** my earlier statement that the swing is symmetric and so cannot be the source of H2. The scan shows a swing asymmetry invisible to that scope is enough.
- Lane C was not predicted. Its H2 jump is an artifact of fixed absolute op-amp limits against a shifted bias, which is what led to round 2; it is not evidence about the supply.

## A cheap measurement that tests it (engine prediction, exploratory, `nodes.ts`)

Mean DC with a 100 mV tone against no tone, Volume 1.0:

| Lane | pin 6 shift | clip-diode node shift |
|---|---|---|
| G (a = +0.015) | +98 mV | +17 mV |
| a = +0.065 | +102 mV | +8 mV |
| a = +0.115 | +105 mV | -2 mV |
| a = -0.065 | +93 mV | +28 mV |

The pin 6 shift is the same in every lane, so it tests the engine, not the offset. The clip-diode node, the junction of D2 and D3, is the discriminator: +17 mV if the limits are centred on the bias, about 0 mV if they are 0.1 V above it. A multimeter on a millivolt range reads that. The node is high impedance, so a 10 MOhm meter will read about 10 % low. This needs the enclosure open again.

## Caveats

TS reference engine at 96 kHz native, op-amp bandwidth at the class default of 1 MHz (the datasheet's 0.6 MHz is not applied), JFET as a square-law device, one render per cell. The supply lane sets the source to 8.88 V with no dynamic droop. The interface scale is confirmed to about 1 dB by the pin 3 check, so a 0.5 dB level difference is within it.

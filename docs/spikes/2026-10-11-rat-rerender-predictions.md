# RAT2 RT-301860 re-render with the current engine: predictions, written BEFORE any lane is run

Date: 2026-10-11. Engine: core 49cc15c (runtime 0.4.1, audio taper base 1089/49, 17.5 % at half rotation), TS ReferenceRuntime, 96 kHz native, oversample 1.
Fixture: `workbench/packet-study/pro-co-rat-2-v4b-op07cp/pro-co-rat-2-v4b-op07cp.fixture.vdsp` (sha256 prefix adc16103f4aeaf2a), compiled with `pedalPartCatalog`. The fixture carries the 94 ohm interface source and the 1.1 Mohm load, so `inputSourceOhms` is 0.
Hardware: `artifacts/pedals/pro-co-rat-2-v4b-op07cp/measurements/2026-10-11-joseph-rt-301860` (sessions 1 and 2) and `2026-07-22-joseph-rt-301860` (July report table, power source unrecorded).

## Rules

- Every lane input below is a **measured value from the specimen, set explicitly on the compiled program**. Nothing is fitted to the captured harmonics. No parameter is chosen after seeing a lane result.
- The instrument is one analyser for every lane: least-squares fundamental and harmonics 2 to 6 of a 1 kHz sine over an integer number of cycles after settling, H2 and H3 in dBc, THD as the RSS of H2 to H6 over H1, the same definition as `specimen-capture.html`.
- Hardware comparison points. Volume 0.5 (intended 20.2k), 100 mV: H1 99.5 mV, H2 -24.76 dBc, H3 -13.18, THD -12.18 (session 1). July at Volume noon by mark: H2 -38.7 / -26.1 / -24.1 dBc at 10 / 30 / 100 mV. Volume maximum (session 2): H1 565.5 / 592.1 / 595.3 mV, H2 -39.25 / -27.06 / -24.75 dBc, H3 -14.78 / -13.49 / -13.19, THD -14.28 / -12.68 / -12.18 at 10 / 30 / 100 mV.

## Lanes (each adds one measured input to the previous baseline; G adds all)

| Lane | Change on the compiled program | Measured source |
|---|---|---|
| A | none (baseline, current engine) | |
| B | pot tracks: Distortion 94.9k, Filter 102.9k, Volume 115.6k | ohmmeter, lug to lug, 2026-10-11 |
| C | supply: source 9.16 V and a 0.70 mS constant load on the VCC node, so the node reads about 8.87 V | adapter at the plug 9.16 V, U1 pin 7 8.87 V |
| D | the 10k from the Volume pot top to ground removed (1 Gohm) | output jack read 0 / 20.0k / 115.5k at CCW / noon / CW |
| E | 2N5458: threshold -1.34 V, beta 1.27 mA per V squared | source 1.05 V at 105 uA plus follower gain 0.88 |
| F | op-amp output limits 1.0 V and 7.9 V (engine default 2.2 V and 6.8 V) | scope at pin 6, VMAX 7.90 V, VPP 6.90 V |
| G | B + C + D + E + F | all of the above |

## Predictions (numbers are for 100 mV, Volume 0.5, unless stated)

- **P1.** A and B agree on H1 within 0.5 dB (the divider fraction is set by the law, not the track). Falsified if they differ by more than 1 dB.
- **P2.** A has H2 within 3 dB of -40 dBc (the March study's engine lane read -40.8 dBc with the same laws and the default JFET). Falsified if A is above -35 dBc.
- **P3.** E alone raises H2 above A and lands between -38 and -30 dBc (my estimate from the follower's changing transconductance is about -34 dBc). Falsified if E reaches -28 dBc or higher, or if it lowers H2.
- **P4.** D alone changes H2 by less than 2 dB and H1 by less than 0.5 dB.
- **P5.** F alone changes 100 mV H2 by less than 2 dB (the limits are symmetric about the bias), and at 10 mV lowers H3 by at least 3 dB because the engine's op-amp stops clipping.
- **P6.** G does NOT reach the hardware second harmonic: G has H2 at 100 mV at or below -30.8 dBc, at least 6 dB under the hardware -24.76. Falsified if G is above -28 dBc.
- **P7.** The hardware H2 jump between 10 and 30 mV (about 12 dB) is not reproduced by A (A's 30 mV minus 10 mV H2 stays under 4 dB). G reproduces at least half of it (30 mV minus 10 mV H2 of 6 dB or more) because the op-amp enters saturation between those levels only when its limits are 1.0 V and 7.9 V.
- **P8.** At Volume 1.0, G's H1 is within 1.5 dB of the hardware 595 mV at 100 mV. Falsified if it differs by more than 3 dB.

## What each outcome decides

- If G reaches within 3 dB of the hardware H2, the measured JFET, headroom and supply values explain the second harmonic, and the specimen lane is closed without fitting.
- If G stays 6 dB or more short (P6), the second-harmonic gap is not in the measured items. The remaining candidates are the clip diodes' real curves, the pot tapers away from noon, and the op-amp's output stage shape, none of which is touched here.
- The re-render is analysis only. It changes no source file, no engine code and no packet value.

## Amendment, written before any lane was run (2026-10-11)

Lane C cannot add a stamp: the compiled block carries a precomputed stamp partition and sparse schedule, so a new shunt load on the VCC node would invalidate them. Lane C is therefore **the DC source set to 8.88 V**, so the VCC node reads about 8.87 V, with no dynamic droop. The measured input is the same (U1 pin 7 at 8.87 V) and none of P1 to P8 depends on the supply droop. The table row above is superseded by this amendment. No other lane changes.

## Round 2, written after round 1 and before any round-2 lane was run (2026-10-11)

**Round 1 outcome that prompted this (for the record, not a prediction):** lane C (supply 8.88 V, nothing else) raised the 100 mV second harmonic from -38.6 to -25.2 dBc. The compiled op-amp carries absolute output limits of 2.2 V and 6.8 V (centre 4.50 V), and lane C moved the bias to 4.435 V, so the limits became asymmetric about the bias by 0.065 V. My hypothesis: the second harmonic is extremely sensitive to a small asymmetry between the op-amp's swing limits and the bias, and the OT3's 0.05 V readout step cannot see it. This was not predicted and is a post-hoc reading of lane C.

**Status of round 2: a sensitivity scan, not a calibration.** The asymmetry is not a measured quantity. It is scanned, not chosen, and no value is selected to match the hardware. The scan answers what asymmetry the hardware second harmonic would imply and whether the other hardware features (the 10 to 30 mV onset) follow from it.

Scan: lane G (all measured inputs) with both op-amp limits shifted together, so that a = centre - bias takes the values -0.065, 0.000, +0.015 (this is lane G), +0.040, +0.065, +0.090, +0.115, +0.165 V (the bias is 4.435 V; the limits are 1.0 V and 7.9 V before shifting, which is a = +0.015). Volume 1.0 (the hardware set that has all three levels), 10 / 30 / 100 mV.

- **R1.** H2 at 100 mV rises with |a|, and at |a| = 0.065 V lies between -31 and -20 dBc. Falsified if H2 at |a| = 0.065 is below -34 dBc, or does not rise between |a| = 0.015 and 0.165.
- **R2.** For |a| of 0.065 V or more, H2 at 30 mV is at least 5 dB above H2 at 10 mV, because only the clipped 30 mV case sees the asymmetry. Falsified if the jump is under 3 dB at |a| = 0.065.
- **R3.** H1 at 100 mV changes by less than 0.5 dB across the whole scan (shifting the limits moves levels only slightly). Falsified if it moves more than 1 dB.
- **R4.** H3 and THD at 100 mV change by less than 0.7 dB across the scan. Falsified if either moves more than 1.5 dB.
- **R5.** The scan is sign-symmetric: H2 at a = -0.065 is within 3 dB of H2 at a = +0.065. Falsified if the two differ by more than 6 dB.

**What round 2 cannot show.** It cannot show that the hardware has an asymmetry, only that one of the right size reproduces its second harmonic and its onset. The test of the hypothesis is a measurement: the DC offset the asymmetric clip leaves at the diode node with the tone on, which the engine predicts in millivolts and a multimeter can read.

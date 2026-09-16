// Hand-computed expected values.
//
// Written down from the circuit, never captured from the implementation. A snapshot
// of current output only proves the code still does what it did; a divider ratio
// proves it is right.

/** Two equal resistors in series: the midpoint sits at half the input. */
export const dividerGain = 0.5;

/** R = 10k, C = 10n -> f_c = 1 / (2*pi*R*C). */
export const rcCornerHz = 1 / (2 * Math.PI * 10_000 * 10e-9);

/** A first-order low pass is -3 dB at its corner: |H| = 1/sqrt(2). */
export const rcGainAtCorner = 1 / Math.SQRT2;

/** A linear pot at position x divides by x. */
export function potGainAt(position: number): number {
	return position;
}

/**
 * A 10k series resistor into anti-parallel diodes clips well below the drive level.
 * Silicon conducts hard by roughly 0.7 V, so a 5 V peak must come out under 1 V.
 */
export const clipperCeilingVolts = 1;

/**
 * Diode clipper peak voltage knee at 5 V drive with 10 kΩ series resistor.
 * Shockley equation: I ≈ (5 - 0.55)/10k = 0.445 mA.
 * V_d = n * V_t * ln(I / I_s) = 1.752 * 0.02585 * ln(0.445e-3 / 2.52e-9) ≈ 0.546 V.
 */
export const diodeClipperPeakVolts = 0.546;

/**
 * LED clipper peak voltage knee at 5 V drive with 10 kΩ series resistor.
 * Shockley equation: I ≈ (5 - 1.72)/10k = 0.328 mA.
 * V_led = n * V_t * ln(I / I_s) = 1.752 * 0.05 * ln(0.328e-3 / 1e-12) ≈ 1.718 V.
 */
export const ledClipperPeakVolts = 1.718;

/** Inverting amplifier: -R_feedback / R_in = -100k / 10k. Magnitude 10. */
export const invertingGain = 10;

/**
 * A 100k rheostat at mid travel on a linear sweep is 50k, so a 100k series feed reads
 * 50k / (100k + 50k). With a 20k residual minimum the sweep runs 20k..100k, and mid
 * travel is 60k, giving 60k / 160k.
 */
export const rheostatMidGain = 50_000 / 150_000;
export const rheostatMidGainWithMinimum = 60_000 / 160_000;

/**
 * `quietSeedRheostat` at 1 kHz with a 1 V input. The stage is an inverting amplifier whose
 * feedback is a 100k DC path in parallel with the track: a 10 uF coupling capacitor
 * (15.915 ohms at 1 kHz), the wiper-adjacent share of the 100k pot, and 30k of series feed
 * back to the inverting input.
 *
 * With the track oriented to its input-adjacent end (the decision this fixture pins), the
 * wiper-adjacent share is `100k * p` on a linear taper, so the magnitude is
 * `(100k || (30k + 100k*p + 15.915)) / 10k`:
 * p = 0.25 -> 3.5490, p = 0.50 -> 4.4449, p = 0.75 -> 5.1223.
 *
 * Before 2026-08-25, `vplus` seeded the orientation evidence, so the rail-adjacent end won
 * and the share was `100k * (1 - p)`: the 0.25 and 0.75 values are mirrored (5.1223 and
 * 3.5490) while the 0.50 midpoint is identical, which is why the mid-travel value here is an
 * anchor, not a discriminator, and the pair off centre is what detects the flip.
 */
export const quietSeedGainQuarter = 3.549;
export const quietSeedGainMid = 4.4449;
export const quietSeedGainThreeQuarter = 5.1223;

/**
 * A 10k pot with an audio (logarithmic) taper at half rotation: **exactly** a tenth of the
 * track, not approximately.
 *
 * `runtime/taper.ts` evaluates `(81^x - 1)/(81 - 1)`, and base 81 is not a fitted constant --
 * it is the value for which that expression is exactly 0.1 at `x = 0.5`, which is the audio-taper
 * convention of 10% at half rotation. `81^0.5 = 9`, so the fraction is `(9 - 1)/80 = 0.1`, and
 * the fixture measures 0.10000000 with no loading error to absorb.
 *
 * Stated as exact on purpose: describing it as "roughly 10%" invites a later tolerance loosening
 * that this reference does not need, and it is one of the few numbers in this file that is a
 * closed form rather than a hand-solved approximation.
 */
export const logTaperMidGain = 0.1;

/** Ideal 1:2 step-up: turns ratio Np/Ns = 0.5, so V_secondary = V_primary / 0.5. */
export const transformerStepUpGain = 2;

/** Ideal 2:1 step-down: turns ratio Np/Ns = 2.0, so V_secondary = V_primary / 2.0. */
export const transformerStepDownGain = 0.5;

/**
 * The peak amplitude a winding stated as `volts` RMS is driven at. The source states RMS by
 * this project's convention and `device-laws.ts` converts once, so a driven winding's stamp
 * carries peak -- the same reading `ac-source`'s own `amplitudeVolts` has.
 */
export const drivenWindingPeak = (rmsVolts: number): number =>
	rmsVolts * Math.SQRT2;

/** `twoWindingVoltageDerivedTransformer`: a 6 V RMS filament winding. */
export const twoWindingVoltageDerivedRms = 6;

/**
 * `centerTappedVoltageDerivedTransformer`: a `20-0-20` winding, so **20 V RMS across each
 * half**, not 40 across the pair. The typed 20 V already is the per-half voltage, the same
 * convention `fender-5e3-deluxe-tweed`'s `Derivation` states for its own HV winding, and
 * doubling it would be the silent-truncation failure this work has already been bitten by.
 */
export const centerTappedVoltageDerivedRmsPerHalf = 20;

/**
 * `powerTransformerVoltageDerived`: three windings off one core at three different voltages,
 * which is exactly what no single `Ratio` can express.
 */
export const powerTransformerHvRmsPerHalf = 250;
export const powerTransformerRectifierHeaterRms = 5;
export const powerTransformerFilamentRms = 10;

/**
 * `reverbTankInputOutputTransformer`: `n = sqrt(Zinput / Zoutput) = sqrt(8 / 2250)`, the same
 * `parametersFor` arithmetic `tappedPrimaryOutputTransformer` already exercises via
 * `PrimaryImpedance`/`SecondaryImpedance` -- `InputImpedance`/`OutputImpedance` is the reverb-tank
 * spelling of the same two properties, and `input_hot`/`input_return`/`output_hot`/`output_return`
 * (added to `transformerTerminalRoles` 2026-08-14) is the terminal-side half of that same synonym.
 */
export const reverbTankInputOutputRatio = Math.sqrt(8 / 2250);

/**
 * JFET source follower, hand-solved. With Vto = -2 V and beta = 1e-3, the quiescent
 * source voltage solves Vs / 2200 = beta * (2 - Vs)^2, giving Vs ~ 1.247 V and
 * Id ~ 0.567 mA. Then gm = 2 * beta * (2 - Vs) ~ 1.506 mS and the follower's gain is
 * gm * Rs / (1 + gm * Rs) ~ 0.77.
 */
export const jfetFollowerGain = 0.77;

/** RL low pass: f_c = R / (2*pi*L), with R = 10k and L = 1 H. */
export const rlCornerHz = 10_000 / (2 * Math.PI * 1);

/**
 * MOSFET source follower, hand-solved the same way as the JFET but with an
 * enhancement threshold of +2 V and a 4.5 V gate bias. Vs solves
 * 2.2 * (2.5 - Vs)^2 = Vs, giving Vs ~ 1.633 V, so gm = 2 * beta * (2.5 - Vs)
 * ~ 1.734 mS and the follower gain gm * Rs / (1 + gm * Rs) ~ 0.79.
 */
export const mosfetFollowerGain = 0.79;

/**
 * The common-emitter BJT stage mid-band AC gain and operating point.
 *
 * 9 V rail, RB1=100k, RB2=22k divider, RC=4.7k, RE=1k into 1M load.
 * Vth = 9 * 22 / 122 = 1.623 V, Rth = 100k || 22k = 18.03k.
 * With Vbe ~ 0.68 V and beta ~ 100:
 *   Ib ~ (1.623 - 0.68) / (18.03k + 101 * 1k) ~ 7.92 uA
 *   Ie ~ 101 * Ib ~ 0.80 mA
 *   re = Vt / Ie ~ 25.85 mV / 0.80 mA ~ 32.3 ohm
 *   Rc || Rload = 4.7k || 1M = 4.678k
 * Small-signal AC voltage gain: |Av| = (Rc || Rload) / (RE + re) ~ 4.678k / 1032.3 = 4.532 V/V.
 */
export const commonEmitterGain = 4.532;

/**
 * The 5F1's V1A stage operating point, from `whole-amp-5f1`.
 *
 * A 12AX7 with a 1.5k cathode resistor and a 100k plate load on a 250 V rail. The three
 * numbers are self-consistent and hand-checkable independently of the experiment, which is
 * what makes them an oracle rather than a snapshot: `Ip = Vk / Rk = 1.251 / 1500 = 0.834 mA`,
 * and `Vp = 250 - Ip * 100k = 166.6 V`. Any two of them plus Koren's law fix the third.
 */
export const triodeStageCathodeVolts = 1.251;
export const triodeStagePlateVolts = 166.6;

/**
 * `hybridDelayPedal`'s end-to-end gain: two passive dividers the `coupled` port's boundary
 * stamps create, with nothing from the macro's own core -- a delay cannot change a steady
 * sine's amplitude, only its phase, so the whole gain is electrical.
 *
 * Input: R_IN (10k) into R_IN_SHUNT (10k) *parallel with* the macro's declared input
 * impedance (`fixtureRegistry`'s `audioPortImpedanceOhms.input`, 47k) -- the `conductance`
 * stamp `couple.ts` adds to the driver region, and the number that proves the coupled port is
 * really loading it: without that stamp this divider would be the bare 10k/10k half gate 1a's
 * own README already established, not this smaller one.
 *
 * Output: the macro's declared output impedance (1k) in series with R_OUT (10k), dividing
 * against R_OUT_LOAD (1meg).
 */
const hybridDelayInputLoadOhms = 1 / (1 / 10_000 + 1 / 47_000);
export const hybridDelayInputGain =
	hybridDelayInputLoadOhms / (10_000 + hybridDelayInputLoadOhms);
export const hybridDelayOutputGain = 1_000_000 / (1_000_000 + 1_000 + 10_000);
export const hybridDelayPedalGain =
	hybridDelayInputGain * hybridDelayOutputGain;
export const hybridDelayLoadedOutputGain =
	hybridDelayInputGain * (10_000 / (10_000 + 1_000 + 10_000));

/**
 * Expected values for physical BBD stamps (MN3007/MN3207 family).
 *
 * Modeled output impedance is 400 Ohms.
 * - Driving 10k load: divider is 10k / (10k + 400) = 10000 / 10400 ~ 0.961538.
 * - Driving 400 Ohm matched load: divider is 400 / (400 + 400) = 0.500000.
 *
 * Forward VGG clipping with 0.6V threshold:
 * - N-channel at +5V drive: (5.0 - 0.6) * (10000 / 10400) ~ 4.230769 V.
 * - N-channel at +5V drive with matched 400 Ohm load: (5.0 - 0.6) * 0.5 = 2.20 V.
 * - P-channel at -5V drive: (-5.0 + 0.6) * (10000 / 10400) ~ -4.230769 V.
 */
export const bbdStampOutputGain10k = 10_000 / (10_000 + 400);
export const bbdStampOutputGainMatched = 400 / (400 + 400);
export const bbdStampNChannelPeakVolts = (5.0 - 0.6) * bbdStampOutputGain10k;
export const bbdStampNChannelMatchedLoadPeakVolts =
	(5.0 - 0.6) * bbdStampOutputGainMatched;
export const bbdStampPChannelPeakVolts = (-5.0 + 0.6) * bbdStampOutputGain10k;

/**
 * The unloaded input divider `hybridDelayInputGain` is NOT: R_IN (10k) into R_IN_SHUNT (10k)
 * alone, ignoring the macro's input impedance entirely. The gap between this and the measured
 * gain is what a missing `coupled` port would look like -- silent under-loading, the same
 * class of error as a single-sample port the architecture already forbids.
 */
export const hybridDelayUnloadedInputGain = 10_000 / (10_000 + 10_000);

/**
 * `ne570Expander`'s gain, from the datasheet's own closed form rather than from our
 * output: onsemi NE570/D Rev. 4, Figure 6.
 *
 *   GAIN = 2 * R3 * VIN(avg) / (R1 * R2 * IB)
 *
 * with the five internal values Figure 5 draws (R1 10k, R2 20k, R3 20k, IB 140 uA). The
 * three-way cross-check that this reading of the datasheet is right: the same numbers put
 * unity gain at VIN(avg) = 0.7 V, which is 0 dBm -- the reference level a telephone-system
 * compandor is specified at, and the level Figure 6's own text describes as nominal.
 *
 * `VIN(avg)` is the **full-wave average** of the input, so for a sine of amplitude A it is
 * `2A/pi`, not A and not A/sqrt(2). Getting this wrong is a 1.11x error that would sit
 * just inside a loose tolerance, which is why it is spelled out.
 */
const ne570R1 = 10_000;
const ne570R2 = 20_000;
const ne570R3 = 20_000;
const ne570IBias = 140e-6;
export const ne570ExpanderGainAt = (amplitudeVolts: number): number =>
	(2 * ne570R3 * ((2 * amplitudeVolts) / Math.PI)) /
	(ne570R1 * ne570R2 * ne570IBias);

/**
 * `ne570Expander`'s quiescent output, which the datasheet states outright: "The output of
 * the expander will bias up to VOUT_DC = (1 + R3/R4) * VREF ... The output will bias to
 * 3.0 V when the internal resistors are used."
 *
 * This is the number that fixes the *topology* rather than the gain. It is the
 * non-inverting-amplifier form, so it only comes out at 3.0 V with R4 returned to
 * **ground**; returned to VREF instead, R4 would carry no current and the output would
 * sit at VREF's own 1.8 V. A 1.2 V discrepancy is what a mis-referenced R4 looks like.
 */
export const ne570ExpanderBiasVolts = 3.0;

/** `ne570Compressor`'s external network, and the two internal values its DC bias needs. */
const ne570CompressorRin = 20_000;
const ne570CompressorRfb = 36_000;
const ne570Vref = 1.8;
const ne570R4 = 30_000;

/**
 * `ne570Compressor`'s output level for a sine of `amplitudeVolts`, and the only assertion in
 * this file that pins the gain cell's **direction** rather than its magnitude.
 *
 * The expander cannot pin it. Its cell is outside the op amp's loop, so reversing the cell's
 * current inverts that fixture's output and changes nothing measurable: `ne570ExpanderGainAt`
 * is a magnitude, `ne570ExpanderBiasVolts` comes from R3/R4 with the cell carrying no DC, and
 * the harness reads half peak-to-peak. Figure 7 puts the cell inside the loop, driven from the
 * output, and the direction becomes the whole behaviour.
 *
 * KCL at the summing node, which the op amp holds at VREF:
 *
 *   A_out * (1/Rfb + k * A_out) = A_in / (Rin + R3),   k = 4 / (pi * R1 * R2 * IB)
 *
 * `k` is the cell's conductance per volt of output, and it is the expander's own closed form
 * rearranged -- `ne570ExpanderGainAt(A) = R3 * k * A` -- so both fixtures are checked against
 * one reading of the datasheet, not two. The `4/pi` is `2 * (2/pi)`: the factor of two Figure 9
 * states for the mirrored rectifier current, times the full-wave average of a sine.
 *
 * Solving the quadratic gives the level below. Two properties make it the right assertion:
 * it is external to our output, and it separates the signs by a factor of fourteen at unit
 * drive (0.4965 against a measured 6.8 with the current delivered the wrong way). A
 * monotonic-compression check would not separate them at all -- **both** signs produce gain
 * that falls with level, one of them by walking away from a pole at `gCell = 1/Rfb`.
 */
export const ne570CompressorOutputAt = (amplitudeVolts: number): number => {
	const k = 4 / (Math.PI * ne570R1 * ne570R2 * ne570IBias);
	const g = 1 / ne570CompressorRfb;
	return (
		(-g +
			Math.sqrt(
				g * g +
					(4 * k * amplitudeVolts) / (ne570CompressorRin + ne570R3),
			)) /
		(2 * k)
	);
};

/**
 * `ne570Compressor`'s quiescent output: `VREF + Rfb * (VREF / R4)` = 3.96 V.
 *
 * Figure 7 takes pin 6 away for the signal input, so the internal R3 no longer closes the DC
 * loop and the external leg does. That makes the bias a different arithmetic from the
 * expander's stated `(1 + R3/R4) * VREF`, and checking it is what proves the fixture wired
 * Figure 7 rather than a mis-drawn Figure 6: R4's 60 uA has to return through Rfb, and only
 * through Rfb.
 */
export const ne570CompressorBiasVolts =
	ne570Vref + (ne570CompressorRfb * ne570Vref) / ne570R4;

/**
 * Optocoupler attenuator small-signal AC gain.
 *
 * Series resistor R1=10k, shunt LDR to ground.
 * - Dark (LED = 0V): Rldr = 10M, gain = 10M / (10k + 10M) ~ 0.9990.
 * - Illuminated (LED = 2V): Rldr = 100, gain = 100 / (10k + 100) ~ 0.00990.
 */
export const optocouplerDarkGain = 0.999;
export const optocouplerIlluminatedGain = 0.0099;

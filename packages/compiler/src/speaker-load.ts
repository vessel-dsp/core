// Stage B: a speaker as a linear one-port, instead of a resistor.
//
// Stage A terminated an output transformer's secondary with the jack's declared nominal impedance,
// which made the plate load line real. A real driver is not a resistor: its impedance rises to a
// peak at cone resonance and climbs again with voice-coil inductance, and the power tubes see that
// curve rather than a flat 8 or 16 ohms.
//
// The standard linear equivalent, and the one `speakerThieleSmallSpiceReferenceDeck()` already
// emits so its curve is the acceptance test:
//
//     Re --- Le --- ( Rmot || Lmot || Cmot ) --- return
//
//     Rmot = Bl^2 / Rms      Cmot = Mms / Bl^2      Lmot = Cms * Bl^2      Rms = 2*pi*fs*Mms / Qms
//
// Five plain elements over two extra nodes. No new operator, no Newton cost -- every one of them is
// linear, and the v2 runtime already stamps resistors, inductors and capacitors.
//
// **This is a generic driver, never a named one, and that is a deliberate decision rather than a
// shortcut.** No corpus packet identifies its driver in a form that resolves: the five that §5
// credits with driver identity all declare prose (`SpeakerModel: "Celestion T4437"`, `SpeakerSet:
// "two 8 ohm 12 inch speakers in parallel"`). Matching the first to a `celestion-blue-alnico-8`
// profile is a name inference this pipeline forbids, and the other two name no driver at all. So
// the choice is a generic profile or no Stage B, and every application of it carries a
// `generic-speaker-profile` warning naming the jack, so a render can never be quoted as *this
// amp's* speaker.
//
// The numbers below are the `celestion-vintage-30-8` seed from
// `src/web/assets/cab-mic-profiles.vdsp`, which v1 names as its own default profile. Transcribed
// rather than imported, because the v2 compiler may not read `src/web` -- the same reason
// `GENERIC_TRIODE` holds a 12AX7 fit as data here. Its own record states
// `sourceConfidence: official-basic-aggregate-physical-seed` and says the full T-S row is a
// "non-factory consensus seed for runtime-load development, not a promotion-grade exact driver
// revision claim". That bound travels with anything this produces: it is the *shape* of a real
// driver's impedance, not a measurement of one.

/** The one generic driver, as its source states it. 8 ohm nominal. */
const GENERIC_DRIVER = {
	nominalOhms: 8,
	reOhms: 7.3,
	leHenries: 0.00045,
	fsHz: 75,
	qms: 4.88,
	mmsKg: 0.0331,
	cmsMetersPerNewton: 0.00013604724221864757,
	blTeslaMeters: 13.1,
} as const;

export type SpeakerOnePort = {
	readonly reOhms: number;
	readonly leHenries: number;
	readonly motionalOhms: number;
	readonly motionalHenries: number;
	readonly motionalFarads: number;
	/** What the whole network was scaled by, for the warning to quote. */
	readonly nominalOhms: number;
};

/**
 * The generic driver's one-port, impedance-scaled to a declared nominal impedance.
 *
 * A 16 ohm driver is not a different curve from an 8 ohm one, it is the same curve twice as high:
 * scaling `Re`, `Rmot` and `Lmot` by `k` and dividing `Cmot` by `k` multiplies the impedance by `k`
 * at every frequency and leaves the resonance and its Q exactly where they were. That is exact for
 * the electrical one-port, which is what makes one seed profile usable for the corpus's 8 and 16
 * ohm jacks without inventing a second driver.
 */
export function speakerOnePort(nominalOhms: number): SpeakerOnePort {
	const k = nominalOhms / GENERIC_DRIVER.nominalOhms;
	const rms =
		(2 * Math.PI * GENERIC_DRIVER.fsHz * GENERIC_DRIVER.mmsKg) /
		GENERIC_DRIVER.qms;
	const motor = GENERIC_DRIVER.blTeslaMeters * GENERIC_DRIVER.blTeslaMeters;
	return {
		reOhms: GENERIC_DRIVER.reOhms * k,
		leHenries: GENERIC_DRIVER.leHenries * k,
		motionalOhms: (motor / rms) * k,
		motionalHenries: GENERIC_DRIVER.cmsMetersPerNewton * motor * k,
		motionalFarads: GENERIC_DRIVER.mmsKg / motor / k,
		nominalOhms,
	};
}

/**
 * `Z` of the one-port at a frequency, complex.
 *
 * Series `Re + jwLe`, then the three motional elements in parallel. Kept here beside the element
 * values so a check cannot drift from the thing it checks.
 *
 * **Complex, not a magnitude, because a divider needs the phase.** Reflecting this through a
 * transformer and dividing against a power stage's output impedance with magnitudes alone is wrong
 * wherever the load is reactive: measured on `report-speaker-load.ts`'s fixture, a scalar divider
 * agrees at resonance and at the impedance minimum -- both nearly real -- and is 14.7% off at 5 kHz,
 * where the voice-coil inductance dominates.
 */
export function speakerImpedance(
	port: SpeakerOnePort,
	frequencyHz: number,
): { readonly re: number; readonly im: number } {
	const w = 2 * Math.PI * frequencyHz;
	const gr = 1 / port.motionalOhms;
	const bl = w === 0 ? Number.POSITIVE_INFINITY : -1 / (w * port.motionalHenries);
	const bc = w * port.motionalFarads;
	const b = bl === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : bl + bc;
	const denom = gr * gr + b * b;
	const zr = denom === 0 || !Number.isFinite(b) ? 0 : gr / denom;
	const zi = denom === 0 || !Number.isFinite(b) ? 0 : -b / denom;
	return { re: port.reOhms + zr, im: w * port.leHenries + zi };
}

/** `|Z|` of the one-port, from {@link speakerImpedance}. */
export function speakerImpedanceMagnitude(
	port: SpeakerOnePort,
	frequencyHz: number,
): number {
	const z = speakerImpedance(port, frequencyHz);
	return Math.hypot(z.re, z.im);
}

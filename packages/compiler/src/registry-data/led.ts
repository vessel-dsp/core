// LED colour-default registry data: owner bench 2026-10-20 (measured IS and n;
// derived VT and, for the two-point colours, derived Rs -- assumed fit constants,
// never measurements).
//
// Keying (whole folded part ids packets already use; no format or typed-field change):
// - red: "RED LED" (marshall-blues-breaker LED1, 9 V power indicator through 470 ohm),
//   "5mm red LED" (pigtronix-philosophers-tone D13), "LED-RED" (bk-butler-tube-driver
//   D_EFFECT_LED_RED, EFFECT 5 mm red led). Three spellings, one colour.
// - green: "LED-GREEN" (bk-butler-tube-driver D_POWER_LED_GREEN, POWER 5 mm green led).
// - blue: "3mm blue" (keeley-compressor-plus LED, 3 mm blue indicator, Color: blue).
//
// Not keyed and not landed: bare "LED" (10 connected devices, colour unknown), "5mm LED"
// (colourless), "unspecified-indicator-led (...)" (12 devices, explicitly unknown part),
// empty PartNumber, and every manufacturer part number (LN28RP, SLP-135B, GL-32AR, ...:
// real parts the bench kit cannot speak for). White and yellow have no packet spelling at
// all, so no white or yellow record can be keyed without a new typed colour fact, which
// the owner has not approved: the values stay in HANDOFF-core.md.
//
// Every record states `thermalVoltage: 0.025852` explicitly (the VT the fit was referred
// to; the LED class default is 0.05, with which the engine does not reproduce these Vf at
// all) and its own fitted `seriesResistance` (the 2.0 ohm LED default is a placeholder,
// not a measurement). IS depends exponentially on n: each triple ships as fitted, digits
// unrounded, one fit per record. Blue/white/green fit both evidence files (A/B from the
// identified four LEDs per colour, C/D from one unidentified LED per size from the same
// bags); red keeps the first-session two-point pair (Rs fixed at the 2.0 ohm default,
// valid about 1.4 to 11 mA only).

import { definePartData, type PartDataEntry } from "./loader";

const LED_INSTRUMENT =
	"UNI-T UT107, DC volts. Every voltage was entered to 0.01 V, so the effective " +
	"count is 10 mV (2 V or 20 V range not recorded)";

const EVIDENCE_FIRST_PATH =
	"packet-study/led-default/measurements/2026-10-20-led-default.json";
const EVIDENCE_FIRST_SHA256 =
	"72abc43aa3d562351212dd6045e4bbf1914cf4e660dfe0e4288644c7f1f7b37a";
const EVIDENCE_SECOND_PATH =
	"packet-study/led-default/measurements/2026-10-20-led-default-cd-points.json";
const EVIDENCE_SECOND_SHA256 =
	"d0c5560161745f40616b0f0ed7852edfe6734029bb4a3105bc4503a737b6fb41";

const FOUR_POINT_CONDITIONS =
	"USB 5 V breadboard shield 4.99 V read once; first session 2.2 kohm and 270 ohm, " +
	"second session 20 kohm and 150 ohm, all as typed exactly nominal, probably not metered " +
	"(kit tolerance 1 %); room 20 C; 4 LEDs per colour at A/B (2 per size, one kit, maker not " +
	"recorded) plus one unidentified LED per size at C/D (same bags, may not be among the four)";

const FOUR_POINT_SOURCE_TAIL =
	`Evidence ${EVIDENCE_FIRST_PATH} sha256 ${EVIDENCE_FIRST_SHA256} and ` +
	`${EVIDENCE_SECOND_PATH} sha256 ${EVIDENCE_SECOND_SHA256}, schema ` +
	"vesseldsp.junction-default-measurement.v1 perDevice isEngine/nEngine pooled over every " +
	"sample at the engine VT 0.025852 V.";

const RED_CONDITIONS =
	"USB 5 V breadboard shield measured 4.99 V; 2.2 kohm and 270 ohm resistors as typed, " +
	"exactly nominal, probably not metered (kit tolerance 1 %); room 20 C; 4 red LEDs " +
	"(2 per size, one kit, maker not recorded); anchors 1.435 mA at 1.8275 V and 11.07 mA " +
	"at 1.9925 V (pooled means)";

// Assumed fit constants, never measurements (derived basis): the thermal voltage the
// IS and n were referred to, and the series resistance fixed for a two-point fit.
const VT_DERIVATION =
	"The engine constant 0.025852 V the IS and n fit was referred to: IS and n " +
	"reproduce the bench Vf only at this value (the LED class default is 0.05 V). " +
	"Assumed, not measured.";
const TWO_POINT_RS_DERIVATION =
	"Fixed at the 2.0 ohm LED class default for the two-point fit, so the stamp must " +
	"run at 2.0 ohm. Assumed, not measured.";

export const ledRegistryRecords: readonly PartDataEntry[] = definePartData([
	{
		// Red indicator default: first-session two-point pair, Rs fixed at the 2.0 ohm
		// class default (which is then correct for it). Valid about 1.4 to 11 mA only:
		// the marshall-blues-breaker power indicator this keys runs about 15 mA off 9 V
		// through 470 ohm, an extrapolated use disclosed here. n 2.76 would need Rs 6.2
		// ohm were the junction n 2, so it may carry a small version of the inflated-n
		// structure that sank the blue/white/green pairs; unverified outside the anchors.
		partIds: ["RED LED", "5mm red LED", "LED-RED"],
		class: "led",
		note:
			"Owner bench 2026-10-20, 4 samples, maker unrecorded, two currents: the pair " +
			"(1.1110898624e-14, 2.7587062 at Rs 2.0 ohm) holds only about 1.4 to 11 mA. " +
			"The marshall-blues-breaker RED LED indicator runs about 15 mA (9 V through " +
			"470 ohm), above the window: an extrapolated use. n 2.76 is above a junction " +
			"n of 2 and unverified outside the two anchors. Published-model cross-check " +
			"(LTspice Standard.dio, third-party library, not a manufacturer model): " +
			"Kingbright APT1608SURCK (SMD, N 2.139, RS 2) -61 mV at 1.4 mA and -93 mV at " +
			"11 mA (model minus measured); Fairchild QTLP690C (N 1.5, RS 6) -108 mV at " +
			"1.4 mA and -136 mV at 11 mA.",
		params: {
			saturationCurrent: {
				value: 1.1110898624e-14,
				basis: "measured",
				source:
					"Owner bench 2026-10-20, same sitting and fit as the emissionCoefficient " +
					"record (one two-point fit at the 2.0 ohm LED class default and VT 0.025852 V; " +
					"IS depends exponentially on n, so both digits ship as fitted). Valid about " +
					"1.4 to 11 mA only; unverified outside the anchors. Evidence " +
					`${EVIDENCE_FIRST_PATH} sha256 ${EVIDENCE_FIRST_SHA256}.`,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: RED_CONDITIONS,
				measurementSampleCount: 4,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
			emissionCoefficient: {
				value: 2.7587062,
				basis: "measured",
				source:
					"Owner bench 2026-10-20, red two-point pair (n 2.76 may carry inflated-n " +
					"structure; Rs fixed at 2.0 ohm). Valid about 1.4 to 11 mA only. Evidence " +
					`${EVIDENCE_FIRST_PATH} sha256 ${EVIDENCE_FIRST_SHA256}.`,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: RED_CONDITIONS,
				measurementSampleCount: 4,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
			thermalVoltage: {
				value: 0.025852,
				basis: "derived",
				source:
					"The VT the red fit was referred to (the LED class default is 0.05, with " +
					"which the engine does not reproduce these Vf). Evidence " +
					`${EVIDENCE_FIRST_PATH} sha256 ${EVIDENCE_FIRST_SHA256}.`,
				derivation: VT_DERIVATION,
			},
			seriesResistance: {
				value: 2.0,
				basis: "derived",
				source:
					"The Rs the red fit assumed (the 2.0 ohm LED class default, fixed for the " +
					"two-point fit, so the stamp must run at 2.0 ohm). Evidence " +
					`${EVIDENCE_FIRST_PATH} sha256 ${EVIDENCE_FIRST_SHA256}.`,
				derivation: TWO_POINT_RS_DERIVATION,
			},
		},
	},
	{
		// Green indicator default: colour-level four-point effective values over 0.13 to
		// 13 mA. MISSES the 20 mV page limit (residual 32 mV at B): green does not follow
		// V = a + b ln I + R I within 30 mV. Per-LED #1/#2 agreement is 0 to 10 mV in both
		// sizes, so most of the misfit is the model form, not noise; the unidentified C/D
		// LED explains at most about a quarter of it. Sizes agree within the fit (Rs 28.8
		// 3 mm vs 30.8 5 mm).
		partIds: ["LED-GREEN"],
		class: "led",
		note:
			"Owner bench 2026-10-20, 4 + 2 samples (A/B four identified LEDs, C/D one " +
			"unidentified LED per size from the same bags), maker unrecorded. Four-point " +
			"effective values (5.275788e-17, 3.02001, 29.7599 ohm); residuals (model minus " +
			"measured) -9.2 mV " +
			"at 0.13 mA, +23.9 at 1.1 mA, -31.9 at 8 mA, +17.1 at 13 mA: green misses the " +
			"20 mV limit (32 mV), a stated misfit of the one-diode form, not noise. No " +
			"published model for an indicator green LED was found (manufacturer sites not " +
			"searched).",
		params: {
			saturationCurrent: {
				value: 5.275788e-17,
				basis: "measured",
				source:
					"Owner bench 2026-10-20 green four-point fit (V = a + n VT ln I + I Rs over " +
					"C 0.13 mA, A 1.1 mA, B 8 mA, D 13 mA; IS depends exponentially on n, so " +
					"all three digits ship as fitted). " + FOUR_POINT_SOURCE_TAIL,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: FOUR_POINT_CONDITIONS,
				measurementSampleCount: 6,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
			emissionCoefficient: {
				value: 3.02001,
				basis: "measured",
				source:
					"Owner bench 2026-10-20 green four-point fit (n 3.02 is an effective value " +
					"over 0.13 to 13 mA with a stated 32 mV misfit). " + FOUR_POINT_SOURCE_TAIL,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: FOUR_POINT_CONDITIONS,
				measurementSampleCount: 6,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
			thermalVoltage: {
				value: 0.025852,
				basis: "derived",
				source:
					"The VT the green fit was referred to (the LED class default is 0.05, with " +
					"which the engine does not reproduce these Vf). " + FOUR_POINT_SOURCE_TAIL,
				derivation: VT_DERIVATION,
			},
			seriesResistance: {
				value: 29.7599,
				basis: "measured",
				source:
					"Owner bench 2026-10-20 green four-point fit (Rs 29.76 ohm is why the " +
					"first-session n read 8.0; the stamp must run at the fitted Rs, not the " +
					"2.0 ohm class default). " + FOUR_POINT_SOURCE_TAIL,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: FOUR_POINT_CONDITIONS,
				measurementSampleCount: 6,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
		},
	},
	{
		// Blue indicator default: colour-level four-point effective values over 0.13 to
		// 13 mA, within the 20 mV page limit (residuals +6.4/-8.3/-2.5/+4.4 mV at
		// 1/8/0.13/13 mA, model minus measured). Weaker evidence than green's "over it":
		// the 3 mm A/B LEDs differed by up to 50 mV at 8 mA, so the unidentified C/D LED
		// could by itself account for the 8 mV residual. Sizes: Rs 20.3 (3 mm) vs 24.1
		// (5 mm), within the fit's resolution; the colour default pools both per the
		// owner's by-colour rule.
		partIds: ["3mm blue"],
		class: "led",
		note:
			"Owner bench 2026-10-20, 4 + 2 samples (A/B four identified LEDs, C/D one " +
			"unidentified LED per size from the same bags), maker unrecorded. Four-point " +
			"effective values (8.668086e-34, 1.42282, 22.2290 ohm); residuals (model minus " +
			"measured) +6.4 mV at 1 mA, -8.3 at 8 mA, -2.5 at 0.13 mA, +4.4 at 13 mA: " +
			"within the 20 mV limit, but the unidentified C/D LED could by itself account " +
			"for the residual (3 mm A/B spread reached 50 mV at 8 mA), so 'within limit' " +
			"is weaker evidence than green's 'over it'. The keyed packet device is 3 mm; " +
			"the record pools 3 and 5 mm per the owner's by-colour rule. Published-model " +
			"cross-check (LTspice Standard.dio, third-party library): Microsemi UPBLED-470B " +
			"(power LED, N 1.923, RS 32) sits +516 to +716 mV from the kit, a different " +
			"part, not a generic blue.",
		params: {
			saturationCurrent: {
				value: 8.668086e-34,
				basis: "measured",
				source:
					"Owner bench 2026-10-20 blue four-point fit (V = a + n VT ln I + I Rs over " +
					"C 0.13 mA, A 1.1 mA, B 8 mA, D 13 mA; IS depends exponentially on n, so " +
					"all three digits ship as fitted). " + FOUR_POINT_SOURCE_TAIL,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: FOUR_POINT_CONDITIONS,
				measurementSampleCount: 6,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
			emissionCoefficient: {
				value: 1.42282,
				basis: "measured",
				source:
					"Owner bench 2026-10-20 blue four-point fit (effective value over 0.13 to " +
					"13 mA). " + FOUR_POINT_SOURCE_TAIL,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: FOUR_POINT_CONDITIONS,
				measurementSampleCount: 6,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
			thermalVoltage: {
				value: 0.025852,
				basis: "derived",
				source:
					"The VT the blue fit was referred to (the LED class default is 0.05, with " +
					"which the engine does not reproduce these Vf). " + FOUR_POINT_SOURCE_TAIL,
				derivation: VT_DERIVATION,
			},
			seriesResistance: {
				value: 22.229,
				basis: "measured",
				source:
					"Owner bench 2026-10-20 blue four-point fit (Rs 22.229 ohm is why the " +
					"first-session n read 4.4; the stamp must run at the fitted Rs, not the " +
					"2.0 ohm class default). " + FOUR_POINT_SOURCE_TAIL,
				measurementInstrument: LED_INSTRUMENT,
				measurementConditions: FOUR_POINT_CONDITIONS,
				measurementSampleCount: 6,
				measurementDate: "2026-10-20",
				measurementEvidencePath: EVIDENCE_FIRST_PATH,
				measurementEvidenceSha256: EVIDENCE_FIRST_SHA256,
			},
		},
	},
]);

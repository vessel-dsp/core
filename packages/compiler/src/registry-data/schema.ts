// Per-class parameter schemas, as data.
// 
// **Schemas are data, not code.** Stage 2's override block ("an override may set only the
// part's own class parameters") checks override names against this same table, so the table
// is the one place that says what a class accepts. Parameter *names* follow exactly the
// fields the engine's laws accept for each class, read from `types.ts` (`DeviceLaw`) and
// the resolution narrowings in `device-laws.ts`; no name here is invented:
// 
// - `bjt`: `device-laws.ts` `case "bjt"` stamps `polarity` plus these five numerics.
// - `jfet` / `mosfet`: both lower to the shared `fet` law; the seven numerics below are the
//   law's numeric fields (`gateSaturationCurrent: 0` is the MOSFET's insulated gate).
// - `diode` / `zener` / `led`: all three lower to the `diode` law; a zener adds a reverse
//   knee (`breakdownVolts`), an LED adds `isLed`, and a Schottky is a diode with a low
//   forward knee -- all fit these five numeric names. Silicon records omit
//   `thermalVoltage` (the engine constant 0.025852 V, not a per-part figure); LED records
//   state it explicitly, because the LED class default is 0.05 V and each LED fit was
//   referred to 0.025852 V.
// - `opamp`: the `ideal-opamp` law's numeric part facts. `openLoopGain` is listed because it
//   is a class parameter (stage 2 must allow overriding it) even though stage 1 keeps its
//   values in `part-catalog.ts` code; `gainBandwidthHz` and the swing pair move to data now.
// - `regulator`: a fixed-rail `voltage-source` section; the part contributes its rail and
//   the series impedance stamps carry.
// - `charge-pump`: a switched-capacitor inverter section plus the entry-level loss term the
//   `pumpDerivation` reads. `volts` is deliberately NOT a parameter: the rail is derived per
//   circuit from the input node, and the `volts: 0` in each entry is an unused placeholder.
// - `ujt`: the unijunction transistor's own two facts -- the tap fraction (intrinsic
//   standoff ratio eta) and the bar resistance (interbase resistance Rbb). The emitter
//   junction is a silicon diode by construction (law constants, like the JFET gate's
//   stated silicon-junction current) and the conductivity modulation is the lowering's
//   business (it needs a hysteretic switch stamp, so neither is a per-part parameter).
// 
// Structural (non-numeric) law fields -- `polarity`, `channel`, the swing `translation` and
// printed condition, rails, pinouts -- stay in code at stage 1: a cited value is a number,
// and stage 2 decides how an override states an enum. Classes with no migrated entries yet
// (`bjt`, `mosfet`, `diode`, `led`) carry their schema here and no entry file; their fill
// is stage 3.

/** Every parameter name a class accepts, exactly as the engine's law fields spell it. */
export const CLASS_PARAM_SCHEMAS = {
	bjt: [
		"saturationCurrent",
		"forwardBeta",
		"reverseBeta",
		"thermalVoltage",
		"leakageAmps",
	],
	jfet: [
		"thresholdVolts",
		"transconductance",
		"channelLengthModulation",
		"subthresholdVolts",
		"gateSaturationCurrent",
		"gateOnsetVolts",
		"gateScaleVolts",
	],
	mosfet: [
		"thresholdVolts",
		"transconductance",
		"channelLengthModulation",
		"subthresholdVolts",
		"gateSaturationCurrent",
		"gateOnsetVolts",
		"gateScaleVolts",
	],
	diode: [
		"saturationCurrent",
		"emissionCoefficient",
		"thermalVoltage",
		"breakdownVolts",
		"seriesResistance",
	],
	zener: [
		"saturationCurrent",
		"emissionCoefficient",
		"thermalVoltage",
		"breakdownVolts",
		"seriesResistance",
	],
	led: [
		"saturationCurrent",
		"emissionCoefficient",
		"thermalVoltage",
		"breakdownVolts",
		"seriesResistance",
	],
	opamp: [
		"openLoopGain",
		"gainBandwidthHz",
		"outputSwingDropHighVolts",
		"outputSwingDropLowVolts",
	],
	regulator: ["volts", "sourceOhms"],
	"charge-pump": ["sourceOhms", "chargePumpLossVolts"],
	ujt: ["intrinsicStandoffRatio", "interbaseResistanceOhms"],
} as const;

/** The closed set of part classes the registry holds parameters for. */
export type PartClassName = keyof typeof CLASS_PARAM_SCHEMAS;

/** The accepted parameter names for a class, in schema order. */
export function classParamNames(cls: PartClassName): readonly string[] {
	return CLASS_PARAM_SCHEMAS[cls] as readonly string[];
}

/**
 * The parameters a `custom` override must supply for each class, in schema order.
 *
 * Stage 2 (explicit `DeviceOverride` block, `measured` | `custom`): a `custom` block is for a
 * part the registry does not have, so it must state every parameter that moves behaviour --
 * anything it omits falls back to a class default that was never measured against that part.
 * `measured` needs no completeness (it refines known values), and an unknown name for the
 * class is an error either way (checked against `CLASS_PARAM_SCHEMAS`).
 *
 * Minimal by class, and why the rest may default:
 *
 * - `bjt`: saturationCurrent (the Vbe knee) and forwardBeta (stage gain). reverseBeta keeps 1,
 *   thermalVoltage is a physical constant, leakageAmps keeps 0 (silicon: no excess leakage).
 * - `jfet` / `mosfet`: thresholdVolts (pinch-off) and transconductance (gain). Geometry and
 *   gate refinements (channelLengthModulation, subthresholdVolts, gate terms) keep defaults.
 * - `diode` / `led`: saturationCurrent (knee position) and emissionCoefficient (knee slope).
 *   Silicon leaves thermalVoltage omitted (the engine constant), breakdownVolts 0 is an
 *   ordinary diode, seriesResistance keeps its class default (1.0 ohm diode, 2.0 ohm LED).
 *   An LED record states the VT its fit was referred to and its fitted Rs explicitly.
 *   A `custom` LED override must state the full quad: an (IS, n) measured at the engine
 *   VT silently mis-stamps when VT falls back to the 0.05 class default, and an Rs left
 *   at 2.0 ohm repeats the inflated-n failure the four-point fits exposed.
 * - `zener`: the diode pair plus breakdownVolts -- the breakdown IS the part, and without it
 *   the law stamps an ordinary diode.
 * - `opamp`: openLoopGain and gainBandwidthHz. The swing pair is deliberately absent: per the
 *   D4 freeze no entry states one, and requiring it would stop every custom op-amp.
 * - `regulator`: volts -- the rail is the part; sourceOhms keeps the supply convention.
 * - `charge-pump`: sourceOhms and chargePumpLossVolts -- both shape the derived rail, and an
 *   unknown pump has no safe default for either.
 * - `ujt`: intrinsicStandoffRatio and interbaseResistanceOhms -- the tap fraction and the
 *   bar are the whole part model (emitter diode and modulation are law structure).
 */
export const REQUIRED_CLASS_PARAMS = {
	bjt: ["saturationCurrent", "forwardBeta"],
	jfet: ["thresholdVolts", "transconductance"],
	mosfet: ["thresholdVolts", "transconductance"],
	diode: ["saturationCurrent", "emissionCoefficient"],
	zener: ["saturationCurrent", "emissionCoefficient", "breakdownVolts"],
	led: ["saturationCurrent", "emissionCoefficient", "thermalVoltage", "seriesResistance"],
	opamp: ["openLoopGain", "gainBandwidthHz"],
	regulator: ["volts"],
	"charge-pump": ["sourceOhms", "chargePumpLossVolts"],
	ujt: ["intrinsicStandoffRatio", "interbaseResistanceOhms"],
} as const satisfies Record<PartClassName, readonly string[]>;

/** The parameters a `custom` override must supply for a class, in schema order. */
export function requiredClassParams(cls: PartClassName): readonly string[] {
	return REQUIRED_CLASS_PARAMS[cls] as readonly string[];
}

// Loud at module load when a required set names a parameter its class schema does not
// accept: the two tables must agree, and a drift between them would refuse valid customs
// (or admit unknown names) silently.
for (const cls of Object.keys(CLASS_PARAM_SCHEMAS) as readonly PartClassName[]) {
	const allowed = new Set<string>(classParamNames(cls));
	for (const name of requiredClassParams(cls)) {
		if (!allowed.has(name)) {
			throw new Error(
				`REQUIRED_CLASS_PARAMS[${cls}] lists "${name}", which CLASS_PARAM_SCHEMAS[${cls}] does not accept`,
			);
		}
	}
}

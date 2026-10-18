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
//   forward knee -- all fit these five numeric names.
// - `opamp`: the `ideal-opamp` law's numeric part facts. `openLoopGain` is listed because it
//   is a class parameter (stage 2 must allow overriding it) even though stage 1 keeps its
//   values in `part-catalog.ts` code; `gainBandwidthHz` and the swing pair move to data now.
// - `regulator`: a fixed-rail `voltage-source` section; the part contributes its rail and
//   the series impedance stamps carry.
// - `charge-pump`: a switched-capacitor inverter section plus the entry-level loss term the
//   `pumpDerivation` reads. `volts` is deliberately NOT a parameter: the rail is derived per
//   circuit from the input node, and the `volts: 0` in each entry is an unused placeholder.
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
} as const;

/** The closed set of part classes the registry holds parameters for. */
export type PartClassName = keyof typeof CLASS_PARAM_SCHEMAS;

/** The accepted parameter names for a class, in schema order. */
export function classParamNames(cls: PartClassName): readonly string[] {
	return CLASS_PARAM_SCHEMAS[cls] as readonly string[];
}

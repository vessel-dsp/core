// The closed `sourceTypeName` vocabulary, and the drift that has accumulated
// against it.
//
// `sourceTypeName` is typed `string | null`, so until now any spelling parsed
// silently. A survey of a 118-document corpus found **107 distinct values across
// 8,699 components**, expressing roughly 40 concepts: five spellings for a bipolar
// transistor, five for a JFET, three for a power jack, and one-offs that put a part
// number (`Circuit.Cd4047Clock`) or a topology (`Circuit.DualDiodeClamp`) where a
// device class belongs.
//
// Every consumer matches this field exactly, so each unrecognised spelling is a
// component that silently fails to resolve. Nothing reported it, because nothing
// validated it.
//
// This module is data, not policy: it recognises a value, and where a value is a
// known spelling of a supported concept it names the canonical form so the warning
// can say what to write instead. It never rewrites the document — source fidelity
// comes first, and rewriting would hide the drift rather than surface it.

/** Canonical spellings. A value outside this set is reported, not rejected. */
export const SUPPORTED_SOURCE_TYPE_NAMES: ReadonlySet<string> = new Set([
	// Passive elements
	"Circuit.Resistor",
	"Circuit.VariableResistor",
	"Circuit.Potentiometer",
	"Circuit.Trimmer",
	"Circuit.Thermistor",
	"Circuit.Capacitor",
	"Circuit.Inductor",
	"Circuit.FerriteBead",
	"Circuit.Transformer",
	"Circuit.CenterTapTransformer",

	// Discrete semiconductors
	"Circuit.Diode",
	"Circuit.ZenerDiode",
	"Circuit.LED",
	"Circuit.BipolarJunctionTransistor",
	"Circuit.JunctionFieldEffectTransistor",
	"Circuit.Mosfet",
	"Circuit.UnijunctionTransistor",
	"Circuit.Triode",

	// Integrated circuits, by what the silicon is
	"Circuit.IC",
	"Circuit.OpAmp",
	"Circuit.OTA",
	"Circuit.Comparator",
	"Circuit.Optocoupler",
	"Circuit.AnalogSwitch",
	"Circuit.LogicIC",
	"Circuit.FlipFlop",
	"Circuit.VoltageRegulator",
	"Circuit.PowerConverter",
	"Circuit.ChargePump",
	"Circuit.DelayMemoryChip",
	"Circuit.BucketBrigadeDelay",
	"Circuit.BbdClockDriver",
	"Circuit.ReverbModule",
	"Circuit.Compander",
	"Circuit.AudioCodec",
	"Circuit.ADC",
	"Circuit.DAC",
	"Circuit.DigitalSignalProcessor",
	"Circuit.Microcontroller",
	"Circuit.MemoryIC",
	"Circuit.Crystal",
	"Circuit.ResetSupervisor",
	"Circuit.Display",

	// Interface, power and structure
	"Circuit.Input",
	"Circuit.Output",
	"Circuit.Jack",
	"Circuit.PowerJack",
	"Circuit.ControlJack",
	"Circuit.Speaker",
	"Circuit.Port",
	"Circuit.Connector",
	"Circuit.Switch",
	"Circuit.Footswitch",
	"Circuit.MomentarySwitch",
	"Circuit.Relay",
	"Circuit.Battery",
	"Circuit.VoltageSource",
	"Circuit.Rail",
	"Circuit.Ground",
	"Circuit.NamedWire",
	"Circuit.Label",
	"Circuit.Unsupported",
]);

/**
 * Known spellings of a supported concept, mapped to the canonical form. These are
 * drift rather than distinct meanings: a `Circuit.Bjt` and a
 * `Circuit.BipolarJunctionTransistor` are the same device.
 */
export const SOURCE_TYPE_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
	// Bipolar transistors: five spellings observed for one device.
	["Circuit.BJT", "Circuit.BipolarJunctionTransistor"],
	["Circuit.Bjt", "Circuit.BipolarJunctionTransistor"],
	["Circuit.NpnBjt", "Circuit.BipolarJunctionTransistor"],
	["Circuit.Transistor.BJT", "Circuit.BipolarJunctionTransistor"],

	// Field-effect transistors.
	["Circuit.JFET", "Circuit.JunctionFieldEffectTransistor"],
	["Circuit.Jfet", "Circuit.JunctionFieldEffectTransistor"],
	["Circuit.JunctionFet", "Circuit.JunctionFieldEffectTransistor"],
	["Circuit.Transistor.JFET", "Circuit.JunctionFieldEffectTransistor"],
	["Circuit.MOSFET", "Circuit.Mosfet"],

	// Diodes.
	["Circuit.Zener", "Circuit.ZenerDiode"],
	["Circuit.LightEmittingDiode", "Circuit.LED"],

	// Jacks and connectors.
	["Circuit.InputJack", "Circuit.Input"],
	["Circuit.InputJackSwitch", "Circuit.Input"],
	["Circuit.OutputJack", "Circuit.Output"],
	["Circuit.DcJack", "Circuit.PowerJack"],
	["Circuit.DCPowerJack", "Circuit.PowerJack"],
	["Circuit.ControlInput", "Circuit.ControlJack"],

	// Amplifier packages: a package count is not a device class.
	["Circuit.DualOpAmp", "Circuit.OpAmp"],
	["Circuit.DualOpAmpPackage", "Circuit.OpAmp"],

	// Regulators, rails and converters.
	["Circuit.Regulator", "Circuit.VoltageRegulator"],
	["Circuit.PowerRail", "Circuit.Rail"],
	["Circuit.PowerRails", "Circuit.Rail"],
	["Circuit.DcDcConverter", "Circuit.PowerConverter"],
	["Circuit.Converter", "Circuit.PowerConverter"],

	// Chips.
	["Circuit.IntegratedCircuit", "Circuit.IC"],
	["Circuit.Codec", "Circuit.AudioCodec"],
	["Circuit.Memory", "Circuit.MemoryIC"],
	["Circuit.ClockDriver", "Circuit.BbdClockDriver"],
	["Circuit.ClockDriverChip", "Circuit.BbdClockDriver"],
	["Circuit.Logic", "Circuit.LogicIC"],
	["Circuit.ClockLogic", "Circuit.LogicIC"],
	["Circuit.ControlLogic", "Circuit.LogicIC"],
	["Circuit.DigitalDsp", "Circuit.DigitalSignalProcessor"],

	// Switch throw counts describe wiring, not a device class.
	["Circuit.SPST", "Circuit.Switch"],
	["Circuit.SPDT", "Circuit.Switch"],
	["Circuit.Switch3PDT", "Circuit.Switch"],
	["Circuit.Toggle", "Circuit.Switch"],
]);

/**
 * Values that record **what a consumer does with a component** rather than what the
 * component is.
 *
 * The test that identifies this class: would the value change if the consumer's
 * coverage changed, with the same schematic? For these it would.
 * `Circuit.SupportChip` covers op-amps, NAND gates and analog switches
 * indiscriminately, so it cannot route a model. `Circuit.SourceEvidence` marks
 * components that are traced, real and electrically active but sit inside a region a
 * consumer lowers to one macro model -- in one surveyed document, 223 parts across
 * named analog sections, against four wired components. The day that region is
 * modelled in detail, all 223 become resistors again without the schematic changing.
 *
 * The author cannot supply either correctly even in principle, because answering
 * requires knowing which regions a particular runtime makes opaque. Reported
 * separately because the fix differs from a misspelling: state what the part is, and
 * let the boundary that owns a region declare what it encloses.
 */
export const MODELLING_INTENT_SOURCE_TYPE_NAMES: ReadonlySet<string> = new Set([
	"Circuit.SupportChip",
	"Circuit.SourceEvidence",
	"Circuit.AnalogSupportShell",
	"Circuit.SourceVisibleSubsystem",
	"Circuit.DigitalPrimitive",
	"Circuit.Component",
]);

export type SourceTypeNameVerdict =
	| { readonly status: "supported" }
	| { readonly status: "alias"; readonly canonical: string }
	| { readonly status: "modelling-intent" }
	| { readonly status: "unknown" };

/** Classify a `sourceTypeName`. `null` and empty are simply absent, not wrong. */
export function classifySourceTypeName(
	sourceTypeName: string | null,
): SourceTypeNameVerdict | null {
	if (sourceTypeName === null || sourceTypeName.trim().length === 0) {
		return null;
	}
	const value = sourceTypeName.trim();
	if (SUPPORTED_SOURCE_TYPE_NAMES.has(value)) {
		return { status: "supported" };
	}
	const canonical = SOURCE_TYPE_NAME_ALIASES.get(value);
	if (canonical !== undefined) {
		return { status: "alias", canonical };
	}
	if (MODELLING_INTENT_SOURCE_TYPE_NAMES.has(value)) {
		return { status: "modelling-intent" };
	}
	return { status: "unknown" };
}

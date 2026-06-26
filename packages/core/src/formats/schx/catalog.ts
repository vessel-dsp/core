import type { ComponentKind, Point } from "../../model/types";

export type SchxTerminalLocal = Readonly<{ name: string; local: Point }>;

export type SchxComponentDef = Readonly<{
	shortType: string;
	kind: ComponentKind;
	terminals: readonly SchxTerminalLocal[];
	quantityProps: readonly string[];
}>;

const TWO_TERMINAL_AB: readonly SchxTerminalLocal[] = [
	{ name: "a", local: { x: 0, y: 20 } },
	{ name: "b", local: { x: 0, y: -20 } },
];

const TWO_TERMINAL_DIODE: readonly SchxTerminalLocal[] = [
	{ name: "anode", local: { x: 0, y: 20 } },
	{ name: "cathode", local: { x: 0, y: -20 } },
];

const TWO_TERMINAL_SOURCE: readonly SchxTerminalLocal[] = [
	{ name: "+", local: { x: 0, y: 20 } },
	{ name: "-", local: { x: 0, y: -20 } },
];

const SINGLE_TERMINAL: readonly SchxTerminalLocal[] = [
	{ name: "t", local: { x: 0, y: 0 } },
];

const BJT_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "collector", local: { x: 0, y: 20 } },
	{ name: "base", local: { x: -20, y: 0 } },
	{ name: "emitter", local: { x: 10, y: -20 } },
];

const SPDT_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "common", local: { x: -20, y: 0 } },
	{ name: "throw0", local: { x: 0, y: 20 } },
	{ name: "throw1", local: { x: 10, y: -20 } },
];

const SP3T_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "common", local: { x: -20, y: 0 } },
	{ name: "throw0", local: { x: 0, y: 20 } },
	{ name: "throw1", local: { x: 10, y: 0 } },
	{ name: "throw2", local: { x: 0, y: -20 } },
];

const SP4T_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "common", local: { x: -20, y: 0 } },
	{ name: "throw0", local: { x: 0, y: 20 } },
	{ name: "throw1", local: { x: 10, y: 7 } },
	{ name: "throw2", local: { x: 10, y: -7 } },
	{ name: "throw3", local: { x: 0, y: -20 } },
];

const JFET_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "drain", local: { x: 0, y: 20 } },
	{ name: "gate", local: { x: -20, y: 0 } },
	{ name: "source", local: { x: 0, y: -20 } },
];

const LIVE_SPICE_JUNCTION_FET_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "drain", local: { x: 10, y: 20 } },
	{ name: "gate", local: { x: -20, y: 0 } },
	{ name: "source", local: { x: 10, y: -20 } },
];

const MOSFET_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "drain", local: { x: 0, y: 20 } },
	{ name: "gate", local: { x: -20, y: 0 } },
	{ name: "source", local: { x: 0, y: -20 } },
	{ name: "body", local: { x: 10, y: 0 } },
];

const OPAMP_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "vin+", local: { x: -30, y: 10 } },
	{ name: "vin-", local: { x: -30, y: -10 } },
	{ name: "vout", local: { x: 30, y: 0 } },
	{ name: "vcc", local: { x: 0, y: 20 } },
	{ name: "vee", local: { x: 0, y: -20 } },
];

const TRIODE_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "plate", local: { x: 0, y: 20 } },
	{ name: "grid", local: { x: -20, y: 0 } },
	{ name: "cathode", local: { x: -10, y: -20 } },
];

const PENTODE_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "plate", local: { x: 0, y: 20 } },
	{ name: "screen", local: { x: 10, y: 10 } },
	{ name: "grid", local: { x: -20, y: 0 } },
	{ name: "cathode", local: { x: -10, y: -20 } },
	{ name: "suppressor", local: { x: 10, y: -10 } },
];

const POT_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "a", local: { x: -10, y: 40 } },
	{ name: "wiper", local: { x: 10, y: 0 } },
	{ name: "b", local: { x: -10, y: -40 } },
];

const TRANSFORMER_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "p+", local: { x: -10, y: 20 } },
	{ name: "p-", local: { x: -10, y: -20 } },
	{ name: "s+", local: { x: 10, y: 20 } },
	{ name: "s-", local: { x: 10, y: -20 } },
];

const CENTER_TAP_TRANSFORMER_TERMINALS: readonly SchxTerminalLocal[] = [
	...TRANSFORMER_TERMINALS,
	{ name: "sct", local: { x: 10, y: 0 } },
];

const VOLTAGE_DEFINITION_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "+", local: { x: 0, y: -50 } },
	{ name: "-", local: { x: 0, y: 50 } },
];

// 3PDT footswitch — 3 columns (one per pole) × 3 rows (top throw / pole / bottom throw).
// Pole names are p1..p3; per-pole throws are tNa (top, world-down → SVG y=+20) and tNb (bottom).
// The "ganged" mechanical link is implicit — wires define which throws are connected to what.
const THREE_PDT_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "t1a", local: { x: -20, y: 20 } },
	{ name: "p1", local: { x: -20, y: 0 } },
	{ name: "t1b", local: { x: -20, y: -20 } },
	{ name: "t2a", local: { x: 0, y: 20 } },
	{ name: "p2", local: { x: 0, y: 0 } },
	{ name: "t2b", local: { x: 0, y: -20 } },
	{ name: "t3a", local: { x: 20, y: 20 } },
	{ name: "p3", local: { x: 20, y: 0 } },
	{ name: "t3b", local: { x: 20, y: -20 } },
];

// LM13700-style OTA: differential inputs + bias current + output. Two amps per package
// are modeled as separate symbols sharing the same supply.
const OTA_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "vin+", local: { x: -30, y: 10 } },
	{ name: "vin-", local: { x: -30, y: -10 } },
	{ name: "ibias", local: { x: -30, y: 20 } },
	{ name: "iout", local: { x: 30, y: 0 } },
	{ name: "vcc", local: { x: 0, y: 20 } },
	{ name: "vee", local: { x: 0, y: -20 } },
];

// Bucket-brigade delay (MN3007/3008/3205 family). Symmetric balanced outputs.
const BBD_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "vdd", local: { x: -30, y: 20 } },
	{ name: "vgg", local: { x: -30, y: 0 } },
	{ name: "vss", local: { x: -30, y: -20 } },
	{ name: "cp1", local: { x: 0, y: 20 } },
	{ name: "cp2", local: { x: 0, y: -20 } },
	{ name: "in", local: { x: -30, y: -10 } },
	{ name: "out1", local: { x: 30, y: 10 } },
	{ name: "out2", local: { x: 30, y: -10 } },
];

// PT2399 digital echo IC (16-pin DIP). Key audio + control pins; others omitted from the
// terminal map but still preserved as raw_attributes properties on the component.
const PT2399_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "vcc", local: { x: -30, y: 20 } },
	{ name: "gnd", local: { x: -30, y: -20 } },
	{ name: "vref", local: { x: -30, y: 10 } },
	{ name: "vco", local: { x: -30, y: 0 } },
	{ name: "in", local: { x: -30, y: -10 } },
	{ name: "out", local: { x: 30, y: 10 } },
	{ name: "fb", local: { x: 30, y: 0 } },
	{ name: "da1", local: { x: 30, y: -5 } },
	{ name: "da2", local: { x: 30, y: -10 } },
];

// LM386 mini power amp (8-pin DIP).
const LM386_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "gain1", local: { x: -30, y: 20 } },
	{ name: "vin-", local: { x: -30, y: 10 } },
	{ name: "vin+", local: { x: -30, y: 0 } },
	{ name: "gnd", local: { x: -30, y: -20 } },
	{ name: "vout", local: { x: 30, y: 0 } },
	{ name: "vs", local: { x: 30, y: 20 } },
	{ name: "bypass", local: { x: 30, y: 10 } },
	{ name: "gain8", local: { x: 30, y: -20 } },
];

const MICROBLOCK_STAGE_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "in", local: { x: 0, y: 20 } },
	{ name: "out", local: { x: 0, y: -20 } },
];

const RUNTIME_DESCRIPTOR_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "input", local: { x: 0, y: 20 } },
	{ name: "output", local: { x: 0, y: -20 } },
];

const MICROBLOCK_STAGE_QUANTITY_PROPS: readonly string[] = [
	"ClipThreshold",
	"InputHighpassHz",
	"OutputLowpassHz",
	"MinDriveGain",
	"MaxDriveGain",
	"DriveControlWipe",
	"MinOutputLevel",
	"MaxOutputLevel",
	"OutputControlWipe",
	"MinToneHz",
	"MaxToneHz",
	"ToneControlWipe",
	"DecaySeconds",
	"PreDelaySeconds",
	"DelaySeconds",
	"MinDelaySeconds",
	"MaxDelaySeconds",
	"Feedback",
	"FeedbackControlWipe",
	"Mix",
	"MixControlWipe",
	"WetMix",
	"DryMix",
	"RoomSize",
	"Damping",
	"DampingHz",
	"ModDepth",
	"ModRateHz",
	"SampleRateHz",
];

const RUNTIME_DESCRIPTOR_QUANTITY_PROPS: readonly string[] = [
	...MICROBLOCK_STAGE_QUANTITY_PROPS,
	"MinDelayMs",
	"MaxDelayMs",
	"DelayMs",
	"PreDelayMs",
	"Decay",
	"Damping",
	"Size",
	"Tone",
	"ModDepthMs",
	"MinModDepthMs",
	"MaxModDepthMs",
	"ModRateHz",
	"MinModRateHz",
	"MaxModRateHz",
	"InputDrive",
	"Headroom",
	"Sensitivity",
	"MinSensitivity",
	"MaxSensitivity",
	"AttackMs",
	"MinAttackMs",
	"MaxAttackMs",
	"ReleaseMs",
	"TriggerThreshold",
	"MinGain",
	"MinInputGain",
	"MaxInputGain",
	"BandFrequencyControlWipes",
	"BandControlWipes",
	"MinMix",
	"MaxMix",
	"ToneHz",
	"RateHz",
	"MinRateHz",
	"MaxRateHz",
	"Depth",
	"StageCount",
	"MinFeedback",
	"MaxFeedback",
	"SemitoneShift",
	"MinSemitoneShift",
	"MaxSemitoneShift",
];

const MICROBLOCK_OVERDRIVE_STAGE_DEF: SchxComponentDef = {
	shortType: "MicroBlockOverdriveStage",
	kind: "ic",
	terminals: MICROBLOCK_STAGE_TERMINALS,
	quantityProps: MICROBLOCK_STAGE_QUANTITY_PROPS,
};

// 78L05 / 78xx 3-terminal linear regulator (TO-92 / TO-220 pinout: input / ground / output).
const REGULATOR_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "vin", local: { x: -20, y: 0 } },
	{ name: "gnd", local: { x: 0, y: -20 } },
	{ name: "vout", local: { x: 20, y: 0 } },
];

// CD4066 quad bilateral switch — one switch element of four. Each instance models one of
// the four switches in the package; the package itself is implied by Name + Group metadata.
const ANALOG_SWITCH_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "a", local: { x: -20, y: 10 } },
	{ name: "b", local: { x: 20, y: 10 } },
	{ name: "ctrl", local: { x: 0, y: -20 } },
];

// CD4013 dual D flip-flop — single FF instance (D, CLK, Q, Q̅, S, R).
const FLIPFLOP_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "d", local: { x: -20, y: 10 } },
	{ name: "clk", local: { x: -20, y: -10 } },
	{ name: "s", local: { x: 0, y: 20 } },
	{ name: "r", local: { x: 0, y: -20 } },
	{ name: "q", local: { x: 20, y: 10 } },
	{ name: "qbar", local: { x: 20, y: -10 } },
];

// Generic opaque IC fallback (4 + 4 pins, DIP-8 layout). Used when no specific catalog
// entry exists — preserves the source type name for round-tripping.
const GENERIC_IC_TERMINALS: readonly SchxTerminalLocal[] = [
	{ name: "p1", local: { x: -20, y: 15 } },
	{ name: "p2", local: { x: -20, y: 5 } },
	{ name: "p3", local: { x: -20, y: -5 } },
	{ name: "p4", local: { x: -20, y: -15 } },
	{ name: "p5", local: { x: 20, y: -15 } },
	{ name: "p6", local: { x: 20, y: -5 } },
	{ name: "p7", local: { x: 20, y: 5 } },
	{ name: "p8", local: { x: 20, y: 15 } },
];

const DEFS: readonly SchxComponentDef[] = [
	{
		shortType: "Resistor",
		kind: "resistor",
		terminals: TWO_TERMINAL_AB,
		quantityProps: ["Resistance"],
	},
	{
		shortType: "Capacitor",
		kind: "capacitor",
		terminals: TWO_TERMINAL_AB,
		quantityProps: ["Capacitance"],
	},
	{
		shortType: "Inductor",
		kind: "inductor",
		terminals: TWO_TERMINAL_AB,
		quantityProps: ["Inductance"],
	},
	{
		shortType: "Conductor",
		kind: "unsupported",
		terminals: TWO_TERMINAL_AB,
		quantityProps: [],
	},
	{
		shortType: "Buffer",
		kind: "unsupported",
		terminals: TWO_TERMINAL_AB,
		quantityProps: [],
	},
	{
		shortType: "Diode",
		kind: "diode",
		terminals: TWO_TERMINAL_DIODE,
		quantityProps: ["IS", "Is", "N", "n", "Rs"],
	},
	{
		shortType: "TubeDiode",
		kind: "tube-diode",
		terminals: TWO_TERMINAL_DIODE,
		quantityProps: [],
	},
	{
		shortType: "BipolarJunctionTransistor",
		kind: "bjt",
		terminals: BJT_TERMINALS,
		quantityProps: ["IS", "BF", "BR", "Is", "Vt", "Bf", "Br", "n"],
	},
	{
		shortType: "NpnBjt",
		kind: "bjt",
		terminals: BJT_TERMINALS,
		quantityProps: ["Is", "Vt", "Bf", "Br"],
	},
	{
		shortType: "PnpBjt",
		kind: "bjt",
		terminals: BJT_TERMINALS,
		quantityProps: ["Is", "Vt", "Bf", "Br"],
	},
	{
		shortType: "Bjt",
		kind: "bjt",
		terminals: BJT_TERMINALS,
		quantityProps: ["Is", "Vt", "Bf", "Br"],
	},
	{
		shortType: "NjfJfet",
		kind: "jfet",
		terminals: JFET_TERMINALS,
		quantityProps: ["Is", "Beta", "Vt", "Lambda"],
	},
	{
		shortType: "PjfJfet",
		kind: "jfet",
		terminals: JFET_TERMINALS,
		quantityProps: ["Is", "Beta", "Vt", "Lambda"],
	},
	{
		shortType: "Jfet",
		kind: "jfet",
		terminals: JFET_TERMINALS,
		quantityProps: ["Is", "Beta", "Vt", "Lambda"],
	},
	{
		shortType: "JunctionFieldEffectTransistor",
		kind: "jfet",
		terminals: LIVE_SPICE_JUNCTION_FET_TERMINALS,
		quantityProps: ["IS", "Is", "n", "Vt0", "Vt", "Beta", "Lambda"],
	},
	{
		shortType: "NMosfet",
		kind: "mosfet",
		terminals: MOSFET_TERMINALS,
		quantityProps: ["Vto", "Kp", "Lambda"],
	},
	{
		shortType: "PMosfet",
		kind: "mosfet",
		terminals: MOSFET_TERMINALS,
		quantityProps: ["Vto", "Kp", "Lambda"],
	},
	{
		shortType: "Mosfet",
		kind: "mosfet",
		terminals: MOSFET_TERMINALS,
		quantityProps: ["Vto", "Kp", "Lambda"],
	},
	{
		shortType: "OpAmp",
		kind: "opamp",
		terminals: OPAMP_TERMINALS,
		quantityProps: ["SupplyVoltage"],
	},
	{
		shortType: "IdealOpAmp",
		kind: "opamp",
		terminals: OPAMP_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "OTA",
		kind: "ota",
		terminals: OTA_TERMINALS,
		quantityProps: ["SupplyVoltage"],
	},
	{
		shortType: "BBD",
		kind: "bbd",
		terminals: BBD_TERMINALS,
		quantityProps: ["Stages"],
	},
	{
		shortType: "PT2399",
		kind: "delay-ic",
		terminals: PT2399_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "LM386",
		kind: "power-amp",
		terminals: LM386_TERMINALS,
		quantityProps: ["SupplyVoltage"],
	},
	{
		shortType: "Regulator",
		kind: "regulator",
		terminals: REGULATOR_TERMINALS,
		quantityProps: ["Vout"],
	},
	{
		shortType: "AnalogSwitch",
		kind: "analog-switch",
		terminals: ANALOG_SWITCH_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "FlipFlop",
		kind: "flipflop",
		terminals: FLIPFLOP_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "IC",
		kind: "ic",
		terminals: GENERIC_IC_TERMINALS,
		quantityProps: [],
	},
	MICROBLOCK_OVERDRIVE_STAGE_DEF,
	{
		shortType: "Triode",
		kind: "triode",
		terminals: TRIODE_TERMINALS,
		quantityProps: ["Mu", "K", "Kp", "Kvb", "Ex"],
	},
	{
		shortType: "Pentode",
		kind: "pentode",
		terminals: PENTODE_TERMINALS,
		quantityProps: ["Mu", "K", "Kp", "Kvb", "Ex"],
	},
	{
		shortType: "Transformer",
		kind: "transformer",
		terminals: TRANSFORMER_TERMINALS,
		quantityProps: ["Lp", "Ls", "k"],
	},
	{
		shortType: "CenterTapTransformer",
		kind: "transformer",
		terminals: CENTER_TAP_TRANSFORMER_TERMINALS,
		quantityProps: ["Turns"],
	},
	{
		shortType: "Potentiometer",
		kind: "potentiometer",
		terminals: POT_TERMINALS,
		quantityProps: ["Resistance", "Wipe", "Sweep"],
	},
	{
		shortType: "VariableResistor",
		kind: "variable-resistor",
		terminals: TWO_TERMINAL_AB,
		quantityProps: ["Resistance"],
	},
	{
		shortType: "Switch",
		kind: "switch",
		terminals: TWO_TERMINAL_AB,
		quantityProps: [],
	},
	{
		shortType: "SPDT",
		kind: "switch",
		terminals: SPDT_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "SP3T",
		kind: "switch",
		terminals: SP3T_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "SP4T",
		kind: "switch",
		terminals: SP4T_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "3PDT",
		kind: "switch",
		terminals: THREE_PDT_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "VoltageSource",
		kind: "voltage-source",
		terminals: TWO_TERMINAL_SOURCE,
		quantityProps: ["Voltage"],
	},
	{
		shortType: "CurrentSource",
		kind: "current-source",
		terminals: TWO_TERMINAL_SOURCE,
		quantityProps: ["Current"],
	},
	{
		shortType: "Battery",
		kind: "battery",
		terminals: TWO_TERMINAL_SOURCE,
		quantityProps: ["Voltage"],
	},
	{
		shortType: "Rail",
		kind: "rail",
		terminals: SINGLE_TERMINAL,
		quantityProps: ["Voltage"],
	},
	{
		shortType: "Ground",
		kind: "ground",
		terminals: SINGLE_TERMINAL,
		quantityProps: [],
	},
	{
		shortType: "VoltageDefinition",
		kind: "unsupported",
		terminals: VOLTAGE_DEFINITION_TERMINALS,
		quantityProps: [],
	},
	{
		shortType: "Input",
		kind: "jack",
		terminals: TWO_TERMINAL_AB,
		quantityProps: ["V0dBFS"],
	},
	{
		shortType: "Speaker",
		kind: "jack",
		terminals: TWO_TERMINAL_AB,
		quantityProps: ["Impedance", "V0dBFS"],
	},
	{
		shortType: "NamedWire",
		kind: "named-wire",
		terminals: SINGLE_TERMINAL,
		quantityProps: [],
	},
	{ shortType: "Label", kind: "label", terminals: [], quantityProps: [] },
	{
		shortType: "Port",
		kind: "port",
		terminals: SINGLE_TERMINAL,
		quantityProps: [],
	},
];

const BY_SHORT_TYPE = new Map<string, SchxComponentDef>(
	DEFS.map((d) => [d.shortType, d]),
);
const BY_KIND = new Map<ComponentKind, SchxComponentDef>(
	DEFS.reduce<Array<[ComponentKind, SchxComponentDef]>>((acc, def) => {
		if (!acc.some(([k]) => k === def.kind)) {
			acc.push([def.kind, def]);
		}
		return acc;
	}, []),
);

export function shortenSchxType(fullType: string): string {
	if (fullType.includes("Circuit.Components.Diode")) {
		return "TubeDiode";
	}
	const match = fullType.match(/Circuit\.(?:Components\.)?([A-Za-z0-9_]+)/);
	return match?.[1] ?? fullType;
}

export function lookupSchxDef(shortType: string): SchxComponentDef | undefined {
	return (
		BY_SHORT_TYPE.get(shortType) ??
		lookupMicroBlockStageDef(shortType) ??
		lookupRuntimeDescriptorDef(shortType)
	);
}

export function isSchxRuntimeDescriptor(shortType: string): boolean {
	return (
		/^MicroBlock[A-Za-z0-9_]*$/.test(shortType) ||
		shortType === "MacroTremolo" ||
		shortType === "MacroPhaser"
	);
}

export function defaultDefForKind(
	kind: ComponentKind,
): SchxComponentDef | undefined {
	return BY_KIND.get(kind);
}

const CIRCUIT_ASSEMBLY =
	"Circuit, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null";
export const SCHX_SYMBOL_ELEMENT_TYPE = `Circuit.Symbol, ${CIRCUIT_ASSEMBLY}`;
export const SCHX_WIRE_ELEMENT_TYPE = `Circuit.Wire, ${CIRCUIT_ASSEMBLY}`;

export function fullSchxType(shortType: string): string {
	if (shortType === "TubeDiode") {
		return `Circuit.Components.Diode, ${CIRCUIT_ASSEMBLY}`;
	}
	const namespace = shortType === "Pentode" ? "Circuit.Components" : "Circuit";
	return `${namespace}.${shortType}, ${CIRCUIT_ASSEMBLY}`;
}

function lookupMicroBlockStageDef(
	shortType: string,
): SchxComponentDef | undefined {
	if (!/^MicroBlock[A-Za-z0-9_]*Stage$/.test(shortType)) {
		return undefined;
	}
	return {
		...MICROBLOCK_OVERDRIVE_STAGE_DEF,
		shortType,
	};
}

function lookupRuntimeDescriptorDef(
	shortType: string,
): SchxComponentDef | undefined {
	if (!isSchxRuntimeDescriptor(shortType)) {
		return undefined;
	}
	return {
		shortType,
		kind: "ic",
		terminals: RUNTIME_DESCRIPTOR_TERMINALS,
		quantityProps: RUNTIME_DESCRIPTOR_QUANTITY_PROPS,
	};
}

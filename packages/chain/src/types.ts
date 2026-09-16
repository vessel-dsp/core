export type PickupType = "single-coil" | "humbucker" | "active" | "piezo" | "custom";

export interface InputProfileConfig {
	pickupType: PickupType;
	/** Input impedance in Ohms (e.g. 250000, 500000, 1000000) */
	impedanceOhms: number;
	/** Input trim gain in dB (-24 to +24 dB) */
	inputGainDb: number;
	/** Guitar to first pedal cable length in meters (default: 3m) */
	guitarCableLengthMeters?: number;
	/** Inter-pedal patch cable length in meters (default: 0.15m) */
	patchCableLengthMeters?: number;
	/** Last pedal to amp cable length in meters (default: 3m) */
	ampCableLengthMeters?: number;
	/** Cable capacitance in pF/meter (default: 100 pF/m) */
	cableCapacitancePfPerM?: number;
	/** Resonant peak frequency in Hz (calculated from pickup inductance & cable capacitance) */
	resonantFreqHz?: number;
	/** Resonant peak Q factor */
	resonantQ?: number;
}

export interface MasterConfig {
	/** Master output volume in dB (-60 to +12 dB) */
	volumeDb: number;
	/** Master mute flag */
	muted: boolean;
	/** Enable soft-knee safety limiter to prevent harsh digital clipping */
	limiter: boolean;
}

export interface ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	bypassed: boolean;
	mix: number;
	prepare(sampleRate: number): void;
	process(input: Float64Array | Float32Array): Float64Array;
	reset(): void;
	getParam(id: string): number | undefined;
	setParam(id: string, value: number): void;
	getParams(): Record<string, number>;
}

export interface NodeSnapshot {
	id: string;
	name: string;
	kind: string;
	bypassed: boolean;
	mix: number;
	params: Record<string, number>;
}

export type PowerSupplyType =
	| "alkaline-9v"
	| "zinc-carbon-9v"
	| "dying-battery"
	| "regulated-9v"
	| "regulated-18v"
	| "unregulated-ac-dc"
	| "custom";

export interface PowerSupplyConfig {
	type: PowerSupplyType;
	/** Nominal voltage in Volts (e.g. 9.0, 18.0, 6.8) */
	nominalVoltageV: number;
	/** Internal source series resistance in Ohms (0.01 to 500 Ohms) */
	internalResistanceOhms: number;
	/** Dynamic sag factor under transient load (0.0 to 1.0) */
	sagFactor: number;
	/** AC mains ripple voltage amplitude in Volts (0.0 to 0.5 V) */
	rippleVoltageV?: number;
	/** AC mains ripple frequency in Hz (e.g. 50, 60, 100, 120 Hz) */
	rippleFrequencyHz?: number;
}

export const DEFAULT_POWER_SUPPLY_PROFILES: Record<
	PowerSupplyType,
	PowerSupplyConfig
> = {
	"alkaline-9v": {
		type: "alkaline-9v",
		nominalVoltageV: 9.0,
		internalResistanceOhms: 1.5,
		sagFactor: 0.05,
		rippleVoltageV: 0.0,
		rippleFrequencyHz: 120,
	},
	"zinc-carbon-9v": {
		type: "zinc-carbon-9v",
		nominalVoltageV: 9.0,
		internalResistanceOhms: 25.0,
		sagFactor: 0.2,
		rippleVoltageV: 0.0,
		rippleFrequencyHz: 120,
	},
	"dying-battery": {
		type: "dying-battery",
		nominalVoltageV: 6.8,
		internalResistanceOhms: 180.0,
		sagFactor: 0.55,
		rippleVoltageV: 0.0,
		rippleFrequencyHz: 120,
	},
	"regulated-9v": {
		type: "regulated-9v",
		nominalVoltageV: 9.0,
		internalResistanceOhms: 0.05,
		sagFactor: 0.0,
		rippleVoltageV: 0.0,
		rippleFrequencyHz: 120,
	},
	"regulated-18v": {
		type: "regulated-18v",
		nominalVoltageV: 18.0,
		internalResistanceOhms: 0.05,
		sagFactor: 0.0,
		rippleVoltageV: 0.0,
		rippleFrequencyHz: 120,
	},
	"unregulated-ac-dc": {
		type: "unregulated-ac-dc",
		nominalVoltageV: 9.2,
		internalResistanceOhms: 15.0,
		sagFactor: 0.15,
		rippleVoltageV: 0.08,
		rippleFrequencyHz: 120,
	},
	custom: {
		type: "custom",
		nominalVoltageV: 9.0,
		internalResistanceOhms: 10.0,
		sagFactor: 0.1,
		rippleVoltageV: 0.0,
		rippleFrequencyHz: 120,
	},
};

export interface ChainPreset {
	name: string;
	version: "1.0";
	inputProfile: InputProfileConfig;
	powerSupply?: PowerSupplyConfig;
	nodes: NodeSnapshot[];
	master: MasterConfig;
}

export interface SignalChainOptions {
	sampleRate?: number;
	inputProfile?: Partial<InputProfileConfig>;
	powerSupply?: Partial<PowerSupplyConfig>;
	master?: Partial<MasterConfig>;
}

export type CableLengthPreset =
	| "15cm"
	| "30cm"
	| "50cm"
	| "1m"
	| "3m"
	| "6m"
	| "10m"
	| number;

export function parseCableLengthMeters(
	value: CableLengthPreset | string | number | undefined,
	fallbackMeters = 3.0,
): number {
	if (value === undefined || value === null) return fallbackMeters;
	if (typeof value === "number") return Math.max(0, value);
	const str = String(value).trim().toLowerCase();
	if (str.endsWith("cm")) {
		const val = parseFloat(str.slice(0, -2));
		return Number.isFinite(val) ? val / 100 : fallbackMeters;
	}
	if (str.endsWith("m")) {
		const val = parseFloat(str.slice(0, -1));
		return Number.isFinite(val) ? val : fallbackMeters;
	}
	if (str.endsWith("ft")) {
		const val = parseFloat(str.slice(0, -2));
		return Number.isFinite(val) ? val * 0.3048 : fallbackMeters;
	}
	const num = parseFloat(str);
	return Number.isFinite(num) ? num : fallbackMeters;
}


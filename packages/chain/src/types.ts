export type PickupType =
	| "single-coil"
	| "humbucker"
	| "active"
	| "piezo"
	| "custom";

export interface InputProfileConfig {
	pickupType: PickupType;
	/** Input impedance in Ohms (e.g. 250000, 500000, 1000000) */
	impedanceOhms: number;
	/** Input trim gain in dB (-24 to +24 dB) */
	inputGainDb: number;
	/** Guitar to first pedal cable length in meters (default: 3m) */
	guitarCableLengthMeters?: number;
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
	/**
	 * Release resources the node holds outside the chain -- a WASM instance, a file handle.
	 * Called on the node a chain drops: `removeNode`, `clearNodes`, and the replace-by-id path
	 * in `addNode`. Optional because most nodes hold nothing that outlives them.
	 */
	dispose?(): void;
}

export interface NodeSnapshot {
	id: string;
	name: string;
	kind: string;
	bypassed: boolean;
	mix: number;
	params: Record<string, number>;
}

export interface ChainPreset {
	name: string;
	version: "1.0";
	inputProfile: InputProfileConfig;
	nodes: NodeSnapshot[];
	master: MasterConfig;
}

export interface SignalChainOptions {
	sampleRate?: number;
	inputProfile?: Partial<InputProfileConfig>;
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

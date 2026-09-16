export type PickupType = "single-coil" | "humbucker" | "active" | "piezo" | "custom";

export interface InputProfileConfig {
	pickupType: PickupType;
	/** Input impedance in Ohms (e.g. 250000, 500000, 1000000) */
	impedanceOhms: number;
	/** Input trim gain in dB (-24 to +24 dB) */
	inputGainDb: number;
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

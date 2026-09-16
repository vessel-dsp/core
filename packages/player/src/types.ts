import type { Program } from "@vessel-dsp/compiler";
import type { SlotContract } from "@vessel-dsp/runtime";

export interface PlayerSlot {
	readonly id: string;
	readonly name: string;
	readonly program?: Program;
	readonly contract?: SlotContract;
	readonly bypass?: boolean;
}

export interface SignalChain {
	readonly slots: readonly PlayerSlot[];
}

export interface PlayerAudioBuffer {
	readonly left: Float32Array;
	readonly right?: Float32Array;
}

import type { Program } from "@vessel-dsp/compiler";
import type { SlotContract } from "@vessel-dsp/runtime";

export type EntityType = "pedal" | "amp" | "board";

export interface EntityPayload {
	readonly id: string;
	readonly userId?: string;
	readonly username: string;
	readonly type: EntityType;
	readonly slug?: string;
	readonly name: string;
	readonly description?: string;
	readonly vdspSource: string;
	readonly version?: string;
	readonly metadata?: Record<string, unknown>;
	readonly createdAt?: number | string;
	readonly updatedAt?: number | string;
}

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

import type { ChainNode } from "../types.js";

export class GainNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "gain";
	bypassed = false;
	mix = 1.0;

	private gainDb = 0;
	private linearGain = 1.0;

	constructor(id = "gain", name = "Level Trim", gainDb = 0) {
		this.id = id;
		this.name = name;
		this.gainDb = gainDb;
		this.updateGain();
	}

	prepare(_sampleRate: number): void {}
	reset(): void {}

	getParam(id: string): number | undefined {
		if (id === "gainDb") return this.gainDb;
		return undefined;
	}

	setParam(id: string, value: number): void {
		if (id === "gainDb") {
			this.gainDb = value;
			this.updateGain();
		}
	}

	getParams(): Record<string, number> {
		return { gainDb: this.gainDb };
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const output = new Float64Array(length);

		if (this.bypassed) {
			for (let i = 0; i < length; i++) {
				output[i] = input[i] ?? 0;
			}
			return output;
		}

		for (let i = 0; i < length; i++) {
			output[i] = (input[i] ?? 0) * this.linearGain;
		}

		return output;
	}

	private updateGain(): void {
		this.linearGain = Math.pow(10, this.gainDb / 20);
	}
}

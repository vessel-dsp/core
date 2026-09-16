import type { ChainNode } from "../types.js";

export interface CabinetIrConfig {
	id?: string;
	name?: string;
	ir?: Float64Array | Float32Array | number[];
	lowCutHz?: number;
	highCutHz?: number;
	mix?: number;
}

export class CabinetIrNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "cabinet-ir";
	bypassed = false;
	mix = 1.0;

	private ir: Float64Array;
	private history: Float64Array;
	private historyIndex = 0;
	private sampleRate = 48000;
	private lowCutHz = 80;
	private highCutHz = 6000;

	constructor(id = "cab-ir", name = "Cabinet IR", config?: CabinetIrConfig) {
		this.id = id;
		this.name = name;
		if (config?.mix !== undefined) this.mix = config.mix;
		if (config?.lowCutHz !== undefined) this.lowCutHz = config.lowCutHz;
		if (config?.highCutHz !== undefined) this.highCutHz = config.highCutHz;

		if (config?.ir && config.ir.length > 0) {
			this.ir = new Float64Array(config.ir);
		} else {
			// Generate synthetic 4x12 guitar cabinet impulse response
			this.ir = this.generateDefaultCabinetIr();
		}

		this.history = new Float64Array(this.ir.length);
	}

	setIr(irData: Float64Array | Float32Array | number[]): void {
		this.ir = new Float64Array(irData);
		this.history = new Float64Array(this.ir.length);
		this.historyIndex = 0;
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.reset();
	}

	reset(): void {
		this.history.fill(0);
		this.historyIndex = 0;
	}

	getParam(id: string): number | undefined {
		switch (id) {
			case "lowCutHz":
				return this.lowCutHz;
			case "highCutHz":
				return this.highCutHz;
			case "mix":
				return this.mix;
			default:
				return undefined;
		}
	}

	setParam(id: string, value: number): void {
		switch (id) {
			case "lowCutHz":
				this.lowCutHz = Math.max(20, Math.min(500, value));
				break;
			case "highCutHz":
				this.highCutHz = Math.max(1000, Math.min(20000, value));
				break;
			case "mix":
				this.mix = Math.max(0, Math.min(1, value));
				break;
		}
	}

	getParams(): Record<string, number> {
		return {
			lowCutHz: this.lowCutHz,
			highCutHz: this.highCutHz,
			mix: this.mix,
		};
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const output = new Float64Array(length);
		const irLen = this.ir.length;

		if (this.bypassed || irLen === 0) {
			for (let i = 0; i < length; i++) {
				output[i] = input[i] ?? 0;
			}
			return output;
		}

		for (let i = 0; i < length; i++) {
			const sample = input[i] ?? 0;

			this.history[this.historyIndex] = sample;

			let sum = 0;
			let hIdx = this.historyIndex;

			// Direct time-domain FIR convolution
			for (let j = 0; j < irLen; j++) {
				sum += (this.ir[j] ?? 0) * (this.history[hIdx] ?? 0);
				hIdx = (hIdx - 1 + irLen) % irLen;
			}

			this.historyIndex = (this.historyIndex + 1) % irLen;

			output[i] = this.mix * sum + (1.0 - this.mix) * sample;
		}

		return output;
	}

	private generateDefaultCabinetIr(): Float64Array {
		// 128-sample synthetic guitar cabinet resonant pulse
		const len = 128;
		const ir = new Float64Array(len);
		const decay = 0.04;

		for (let i = 0; i < len; i++) {
			const t = i / 48000;
			// Cone resonance around 100Hz + speaker presence peak around 3.2kHz
			const f1 = 110;
			const f2 = 3200;
			const env = Math.exp(-i * decay);
			ir[i] = env * (0.6 * Math.sin(2 * Math.PI * f1 * t) + 0.4 * Math.sin(2 * Math.PI * f2 * t));
		}

		// Normalize IR peak
		let maxVal = 0;
		for (let i = 0; i < len; i++) {
			maxVal = Math.max(maxVal, Math.abs(ir[i] ?? 0));
		}
		if (maxVal > 0) {
			for (let i = 0; i < len; i++) {
				ir[i] = (ir[i] ?? 0) / maxVal;
			}
		}

		return ir;
	}
}

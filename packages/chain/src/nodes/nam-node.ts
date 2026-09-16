import type { ChainNode } from "../types.js";

export interface NamModelConfig {
	id?: string;
	name?: string;
	gain?: number;
	bass?: number;
	middle?: number;
	treble?: number;
	presence?: number;
	master?: number;
	bias?: number;
}

export class NamNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "nam";
	bypassed = false;
	mix = 1.0;

	private gain = 1.5;
	private bass = 0.5;
	private middle = 0.5;
	private treble = 0.5;
	private presence = 0.5;
	private master = 1.0;
	private bias = 0.1;

	private sampleRate = 48000;

	// Tone stack filter states
	private lpState = 0;
	private hpState = 0;

	constructor(id = "nam-amp", name = "Neural Amp Model", config?: NamModelConfig) {
		this.id = id;
		this.name = name;
		if (config) {
			if (config.gain !== undefined) this.gain = config.gain;
			if (config.bass !== undefined) this.bass = config.bass;
			if (config.middle !== undefined) this.middle = config.middle;
			if (config.treble !== undefined) this.treble = config.treble;
			if (config.presence !== undefined) this.presence = config.presence;
			if (config.master !== undefined) this.master = config.master;
			if (config.bias !== undefined) this.bias = config.bias;
		}
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.reset();
	}

	reset(): void {
		this.lpState = 0;
		this.hpState = 0;
	}

	getParam(id: string): number | undefined {
		switch (id) {
			case "gain":
				return this.gain;
			case "bass":
				return this.bass;
			case "middle":
				return this.middle;
			case "treble":
				return this.treble;
			case "presence":
				return this.presence;
			case "master":
				return this.master;
			case "bias":
				return this.bias;
			default:
				return undefined;
		}
	}

	setParam(id: string, value: number): void {
		switch (id) {
			case "gain":
				this.gain = Math.max(0.1, Math.min(10, value));
				break;
			case "bass":
				this.bass = Math.max(0, Math.min(1, value));
				break;
			case "middle":
				this.middle = Math.max(0, Math.min(1, value));
				break;
			case "treble":
				this.treble = Math.max(0, Math.min(1, value));
				break;
			case "presence":
				this.presence = Math.max(0, Math.min(1, value));
				break;
			case "master":
				this.master = Math.max(0, Math.min(3, value));
				break;
			case "bias":
				this.bias = Math.max(-1, Math.min(1, value));
				break;
		}
	}

	getParams(): Record<string, number> {
		return {
			gain: this.gain,
			bass: this.bass,
			middle: this.middle,
			treble: this.treble,
			presence: this.presence,
			master: this.master,
			bias: this.bias,
		};
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

		// Simple 3-band tone stack and nonlinear tube waveshaper
		const dt = 1.0 / this.sampleRate;
		const rcHp = 1.0 / (2 * Math.PI * (80 + 120 * this.bass));
		const alphaHp = dt / (rcHp + dt);

		const rcLp = 1.0 / (2 * Math.PI * (2500 + 4000 * this.treble));
		const alphaLp = dt / (rcLp + dt);

		const midGain = 0.5 + this.middle;
		const presenceBoost = 1.0 + this.presence * 0.5;

		for (let i = 0; i < length; i++) {
			const x = (input[i] ?? 0) * this.gain;

			// Asymmetric triode transfer function: tanh with DC bias point shift
			const biased = x + this.bias;
			const saturated = Math.tanh(biased) - Math.tanh(this.bias);

			// High-pass (bass shelf)
			this.hpState += alphaHp * (saturated - this.hpState);
			const postHp = saturated - this.hpState * (1.0 - this.bass);

			// Low-pass (treble shelf)
			this.lpState += alphaLp * (postHp - this.lpState);
			const postLp = this.lpState * this.treble + postHp * (1.0 - this.treble);

			const shaped = (postLp * midGain * presenceBoost) * this.master;

			output[i] = shaped;
		}

		return output;
	}
}

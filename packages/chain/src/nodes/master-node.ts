import type { ChainNode, MasterConfig } from "../types.js";

export class MasterNode implements ChainNode {
	readonly id = "master";
	readonly name = "Master Output";
	readonly kind = "master";
	bypassed = false;
	mix = 1.0;

	private config: MasterConfig;
	private linearGain = 1.0;

	constructor(config?: Partial<MasterConfig>) {
		this.config = {
			volumeDb: config?.volumeDb ?? 0,
			muted: config?.muted ?? false,
			limiter: config?.limiter ?? true,
		};
		this.updateGain();
	}

	getConfig(): MasterConfig {
		return { ...this.config };
	}

	setVolumeDb(db: number): void {
		this.config.volumeDb = Math.max(-60, Math.min(12, db));
		this.updateGain();
	}

	setMuted(muted: boolean): void {
		this.config.muted = muted;
	}

	setLimiter(enabled: boolean): void {
		this.config.limiter = enabled;
	}

	prepare(_sampleRate: number): void {
		this.reset();
	}

	reset(): void {}

	getParam(id: string): number | undefined {
		switch (id) {
			case "volumeDb":
				return this.config.volumeDb;
			case "muted":
				return this.config.muted ? 1 : 0;
			case "limiter":
				return this.config.limiter ? 1 : 0;
			default:
				return undefined;
		}
	}

	setParam(id: string, value: number): void {
		switch (id) {
			case "volumeDb":
				this.setVolumeDb(value);
				break;
			case "muted":
				this.setMuted(value > 0.5);
				break;
			case "limiter":
				this.setLimiter(value > 0.5);
				break;
		}
	}

	getParams(): Record<string, number> {
		return {
			volumeDb: this.config.volumeDb,
			muted: this.config.muted ? 1 : 0,
			limiter: this.config.limiter ? 1 : 0,
		};
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const output = new Float64Array(length);

		if (this.config.muted) {
			return output; // All zeros
		}

		const gain = this.linearGain;
		const useLimiter = this.config.limiter;

		for (let i = 0; i < length; i++) {
			let sample = (input[i] ?? 0) * gain;

			if (useLimiter) {
				// Soft-knee tanh limiter above 0.8 to prevent harsh digital clipping
				if (sample > 0.8) {
					sample = 0.8 + 0.2 * Math.tanh((sample - 0.8) / 0.2);
				} else if (sample < -0.8) {
					sample = -0.8 + 0.2 * Math.tanh((sample + 0.8) / 0.2);
				}
			}

			output[i] = sample;
		}

		return output;
	}

	private updateGain(): void {
		this.linearGain = Math.pow(10, this.config.volumeDb / 20);
	}
}

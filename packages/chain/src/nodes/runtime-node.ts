import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import type { ChainNode } from "../types.js";

export class RuntimeNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "circuit-runtime";
	bypassed = false;
	mix = 1.0;

	private runtime: ReferenceRuntime;
	private program: Program;
	private params: Record<string, number> = {};

	private sampleRate = 48000;

	constructor(id: string, name: string, program: Program) {
		this.id = id;
		this.name = name;
		this.program = program;
		this.runtime = new ReferenceRuntime(program);

		// Initialize default parameters from program controls
		if (program.controls) {
			for (const ctrl of program.controls) {
				this.params[ctrl.id] = ctrl.defaultPosition ?? 0.5;
				this.runtime.setControl(ctrl.id, this.params[ctrl.id]!);
			}
		}
	}

	getProgram(): Program {
		return this.program;
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.runtime.prepare(sampleRate);
	}

	reset(): void {
		if (this.sampleRate > 0) {
			this.runtime.prepare(this.sampleRate);
		}
	}

	getParam(id: string): number | undefined {
		return this.params[id];
	}

	setParam(id: string, value: number): void {
		this.params[id] = value;
		this.runtime.setControl(id, value);
	}

	getParams(): Record<string, number> {
		return { ...this.params };
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const input64 = input instanceof Float64Array ? input : new Float64Array(input);

		if (this.bypassed) {
			return new Float64Array(input64);
		}

		const wet = this.runtime.process(input64);

		if (this.mix >= 0.999) {
			return wet;
		}

		const output = new Float64Array(length);
		const wetMix = this.mix;
		const dryMix = 1.0 - wetMix;

		for (let i = 0; i < length; i++) {
			output[i] = dryMix * (input64[i] ?? 0) + wetMix * (wet[i] ?? 0);
		}

		return output;
	}
}

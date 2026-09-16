import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PowerSupplyNode } from "./power-supply-node.js";
import {
	type ChainNode,
	DEFAULT_POWER_SUPPLY_PROFILES,
	type PowerSupplyConfig,
	type PowerSupplyType,
} from "../types.js";

export class RuntimeNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "circuit-runtime";
	bypassed = false;
	mix = 1.0;

	private runtime: ReferenceRuntime;
	private program: Program;
	private powerSupply: PowerSupplyNode | null = null;
	private params: Record<string, number> = {};

	private sampleRate = 48000;

	constructor(
		id: string,
		name: string,
		program: Program,
		powerSupplyConfig?: Partial<PowerSupplyConfig> | PowerSupplyType,
	) {
		this.id = id;
		this.name = name;
		this.program = program;
		this.runtime = new ReferenceRuntime(program);

		if (powerSupplyConfig) {
			this.setPowerSupply(powerSupplyConfig);
		}

		// Initialize default parameters from program controls
		if (program.controls) {
			for (const ctrl of program.controls) {
				this.params[ctrl.id] = ctrl.defaultPosition ?? 0.5;
				this.runtime.setControl(ctrl.id, this.params[ctrl.id]!);
			}
		}
	}

	setPowerSupply(
		config: Partial<PowerSupplyConfig> | PowerSupplyType,
	): PowerSupplyNode {
		const cfg =
			typeof config === "string"
				? DEFAULT_POWER_SUPPLY_PROFILES[config]
				: config;
		this.powerSupply = new PowerSupplyNode(
			`${this.id}-psu`,
			`${this.name} Supply`,
			cfg,
		);
		this.powerSupply.prepare(this.sampleRate);
		return this.powerSupply;
	}

	getPowerSupply(): PowerSupplyNode | null {
		return this.powerSupply;
	}

	getProgram(): Program {
		return this.program;
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.runtime.prepare(sampleRate);
		this.powerSupply?.prepare(sampleRate);
	}

	reset(): void {
		if (this.sampleRate > 0) {
			this.runtime.prepare(this.sampleRate);
		}
		this.powerSupply?.reset();
	}

	getParam(id: string): number | undefined {
		if (id.startsWith("psu_") && this.powerSupply) {
			return this.powerSupply.getParam(id.slice(4));
		}
		return this.params[id];
	}

	setParam(id: string, value: number): void {
		if (id.startsWith("psu_") && this.powerSupply) {
			this.powerSupply.setParam(id.slice(4), value);
			return;
		}
		this.params[id] = value;
		this.runtime.setControl(id, value);
	}

	getParams(): Record<string, number> {
		const res = { ...this.params };
		if (this.powerSupply) {
			for (const [k, v] of Object.entries(this.powerSupply.getParams())) {
				res[`psu_${k}`] = v;
			}
		}
		return res;
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const input64 =
			input instanceof Float64Array ? input : new Float64Array(input);

		if (this.bypassed) {
			return new Float64Array(input64);
		}

		let wet = this.runtime.process(input64);

		if (this.powerSupply) {
			wet = this.powerSupply.process(wet);
		}

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

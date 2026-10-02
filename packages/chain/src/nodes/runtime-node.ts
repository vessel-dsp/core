import type { Program, SupplyResolution } from "@vessel-dsp/compiler";
import { resolveSupplyStamps } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import type { SupplyAddress } from "@vessel-dsp/runtime";
import type { SupplyProfile } from "../supply-profile.js";
import { customSupplyProfile } from "../supply-profile.js";
import type { ChainNode } from "../types.js";

export type RuntimeNodeOptions = {
	readonly source?: string;
};

const SUPPLY_VOLTS_PARAM = "supplyOpenCircuitVolts";
const SUPPLY_OHMS_PARAM = "supplyInternalResistanceOhms";

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

	private source: string | undefined;
	private supplyResolution: SupplyResolution | null = null;
	private supplyProfile: SupplyProfile | null = null;
	private appliedVoltsMagnitude: number | null = null;
	private appliedOhms: number | null = null;

	constructor(
		id: string,
		name: string,
		program: Program,
		options?: RuntimeNodeOptions,
	) {
		this.id = id;
		this.name = name;
		this.program = program;
		this.source = options?.source;
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

	/**
	 * Apply a supply profile to the circuit's external supply stamps.
	 *
	 * Resolves once (lazily, cached) with `resolveSupplyStamps(source,
	 * program)`, then retargets every resolved stamp through the runtime's
	 * `setSupply`. A null `openCircuitVolts` keeps each stamp's compiled
	 * magnitude; an explicit value replaces the magnitude. The sign always
	 * follows the stamp's own volts sign read from `getSupplies()`, so a
	 * positive-ground germanium rail stays negative.
	 *
	 * Throws when no source text was given or when nothing resolves, naming
	 * the refusal reason codes and rail ids. A program with refused derived
	 * rails but one resolved external rail applies to the resolved one and
	 * keeps the refusals visible via `getSupplyResolution()`.
	 *
	 * Callable before and after `prepare()` and between `process()` calls,
	 * following the runtime's contract. There is no audio-domain processing
	 * in this path.
	 */
	setSupplyProfile(profile: SupplyProfile): void {
		if (
			profile.openCircuitVolts !== null &&
			(!Number.isFinite(profile.openCircuitVolts) ||
				profile.openCircuitVolts <= 0)
		) {
			throw new Error(
				`setSupplyProfile: openCircuitVolts must be null or a finite positive magnitude, got ${String(profile.openCircuitVolts)}`,
			);
		}
		if (
			!Number.isFinite(profile.internalResistanceOhms) ||
			profile.internalResistanceOhms < 0
		) {
			throw new Error(
				`setSupplyProfile: internalResistanceOhms must be a finite non-negative resistance, got ${String(profile.internalResistanceOhms)}`,
			);
		}
		const resolution = this.resolveSupplies();
		if (resolution.supplies.length === 0) {
			throw new Error(
				`setSupplyProfile: no external supply resolved (${this.describeRefusals(resolution)})`,
			);
		}
		this.applyProfileToRuntime(profile, resolution);
		this.supplyProfile = profile;
		if (profile.openCircuitVolts !== null) {
			this.appliedVoltsMagnitude = profile.openCircuitVolts;
		} else {
			const first = resolution.supplies[0];
			if (first === undefined) {
				throw new Error(
					`setSupplyProfile: no external supply resolved (${this.describeRefusals(resolution)})`,
				);
			}
			this.appliedVoltsMagnitude = Math.abs(
				this.compiledVoltsFor(first.address),
			);
		}
		this.appliedOhms = profile.internalResistanceOhms;
	}

	/**
	 * The cached supply resolution, or null until `setSupplyProfile` has
	 * resolved once.
	 */
	getSupplyResolution(): SupplyResolution | null {
		return this.supplyResolution;
	}

	/**
	 * The last applied supply profile, or null until one has been applied.
	 */
	getSupplyProfile(): SupplyProfile | null {
		return this.supplyProfile;
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.runtime.prepare(sampleRate);
		if (this.supplyProfile !== null && this.supplyResolution !== null) {
			this.applyProfileToRuntime(
				this.supplyProfile,
				this.supplyResolution,
			);
		}
	}

	reset(): void {
		if (this.sampleRate > 0) {
			this.runtime.prepare(this.sampleRate);
			if (this.supplyProfile !== null && this.supplyResolution !== null) {
				this.applyProfileToRuntime(
					this.supplyProfile,
					this.supplyResolution,
				);
			}
		}
	}

	getParam(id: string): number | undefined {
		if (id === SUPPLY_VOLTS_PARAM) {
			return this.appliedVoltsMagnitude ?? undefined;
		}
		if (id === SUPPLY_OHMS_PARAM) {
			return this.appliedOhms ?? undefined;
		}
		return this.params[id];
	}

	setParam(id: string, value: number): void {
		if (id === SUPPLY_VOLTS_PARAM || id === SUPPLY_OHMS_PARAM) {
			const currentVolts =
				this.appliedVoltsMagnitude ?? this.fallbackVoltsMagnitude();
			const currentOhms =
				this.appliedOhms ?? this.fallbackOhms();
			const nextVolts =
				id === SUPPLY_VOLTS_PARAM ? value : currentVolts;
			const nextOhms =
				id === SUPPLY_OHMS_PARAM ? value : currentOhms;
			const custom = customSupplyProfile({
				openCircuitVolts: nextVolts,
				internalResistanceOhms: nextOhms,
				name: "Custom supply (preset)",
			});
			this.setSupplyProfile(custom);
			return;
		}
		this.params[id] = value;
		this.runtime.setControl(id, value);
	}

	getParams(): Record<string, number> {
		const base = { ...this.params };
		if (
			this.supplyProfile !== null &&
			this.appliedVoltsMagnitude !== null &&
			this.appliedOhms !== null
		) {
			base[SUPPLY_VOLTS_PARAM] = this.appliedVoltsMagnitude;
			base[SUPPLY_OHMS_PARAM] = this.appliedOhms;
		}
		return base;
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		const input64 =
			input instanceof Float64Array ? input : new Float64Array(input);

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

	private resolveSupplies(): SupplyResolution {
		if (this.supplyResolution !== null) {
			return this.supplyResolution;
		}
		if (this.source === undefined) {
			throw new Error(
				"setSupplyProfile: no source text was given to this RuntimeNode, so no external supply can be resolved: pass the .vdsp text as the fourth constructor argument",
			);
		}
		const resolution = resolveSupplyStamps(this.source, this.program);
		this.supplyResolution = resolution;
		return resolution;
	}

	private describeRefusals(resolution: SupplyResolution): string {
		if (resolution.refused.length === 0) {
			return "no refusals recorded";
		}
		return resolution.refused
			.map(
				(entry) =>
					`${entry.reason}(${entry.railComponentId ?? "no-rail"})`,
			)
			.join(", ");
	}

	private compiledVoltsFor(address: SupplyAddress): number {
		const block = this.program.blocks[address.blockIndex];
		if (block?.kind !== "mna") {
			throw new Error(
				`setSupplyProfile: resolved block index ${String(address.blockIndex)} is not an MNA block`,
			);
		}
		for (const stamp of block.stamps) {
			if (
				stamp.kind === "dc-source" &&
				stamp.sourceIndex === address.sourceIndex
			) {
				return stamp.volts;
			}
		}
		throw new Error(
			`setSupplyProfile: resolved supply at block ${String(address.blockIndex)} source ${String(address.sourceIndex)} has no compiled dc-source stamp`,
		);
	}

	private applyProfileToRuntime(
		profile: SupplyProfile,
		resolution: SupplyResolution,
	): void {
		const liveByKey = new Map<string, number>();
		for (const info of this.runtime.getSupplies()) {
			liveByKey.set(
				`${info.address.blockIndex}:${info.address.sourceIndex}`,
				info.volts,
			);
		}
		const grouped = new Map<number, SupplyAddress[]>();
		for (const supply of resolution.supplies) {
			const compiled = this.compiledVoltsFor(supply.address);
			const live = liveByKey.get(
				`${supply.address.blockIndex}:${supply.address.sourceIndex}`,
			);
			const signSource = live ?? compiled;
			const sign = signSource < 0 ? -1 : 1;
			const magnitude =
				profile.openCircuitVolts ?? Math.abs(compiled);
			const targetVolts = sign * magnitude;
			const key = targetVolts;
			let list = grouped.get(key);
			if (list === undefined) {
				list = [];
				grouped.set(key, list);
			}
			list.push(supply.address);
		}
		for (const [targetVolts, addresses] of grouped) {
			this.runtime.setSupply(
				addresses,
				targetVolts,
				profile.internalResistanceOhms,
			);
		}
	}

	private fallbackVoltsMagnitude(): number {
		const live = this.runtime.getSupplies()[0];
		if (live !== undefined && Number.isFinite(live.volts)) {
			const magnitude = Math.abs(live.volts);
			if (magnitude > 0) {
				return magnitude;
			}
		}
		if (this.supplyResolution !== null) {
			for (const supply of this.supplyResolution.supplies) {
				return Math.abs(this.compiledVoltsFor(supply.address));
			}
		}
		throw new Error(
			"setSupplyProfile: supplyOpenCircuitVolts has no current value to pair with: apply a profile first",
		);
	}

	private fallbackOhms(): number {
		const live = this.runtime.getSupplies()[0];
		if (live !== undefined && Number.isFinite(live.sourceOhms)) {
			return live.sourceOhms;
		}
		throw new Error(
			"setSupplyProfile: supplyInternalResistanceOhms has no current value to pair with: apply a profile first",
		);
	}
}

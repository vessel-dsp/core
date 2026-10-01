import {
	loadNamModel,
	namLoudness,
	type NamEngineModule,
	type NamLoudness,
} from "../nam/engine.js";
import type { ChainNode } from "../types.js";

export interface NamNodeConfig {
	/** An instantiated engine. Async instantiation belongs to the caller -- see `nam/engine.js`. */
	readonly engine: NamEngineModule;
	/** The `.nam` document's text. Parsed by the engine, not here. */
	readonly model: string;
	/** A2/slimmable size in [0,1]; negative selects full size. Ignored by other architectures. */
	readonly slimSize?: number;
	/** Input trim in dB, applied before the model. Clamped to -24..24. */
	readonly inputGainDb?: number;
	/** Output trim in dB, applied after the model. Clamped to -24..24. */
	readonly outputGainDb?: number;
}

export interface NamNodeInfo {
	/** What the engine will do to this instance's level, read from the loaded model's metadata. */
	readonly loudness: NamLoudness;
	/** The rate the model was captured at, or `null` when it states none. */
	readonly expectedSampleRate: number | null;
	/** True for A2 models -- NAM's newer architecture. */
	readonly slimmable: boolean;
	/** The model's internal slimmable-size breakpoints in (0,1); 0.0 and 1.0 bounds are implied. */
	readonly slimmableBreakpoints: number[];
}

const MAX_FRAMES = 1024;
const GAIN_DB_LIMIT = 24;
/** A model stating a rate this far from the chain rate is refused, not run silently. */
const SAMPLE_RATE_TOLERANCE_HZ = 0.5;

/**
 * A NAM (Neural Amp Modeler) capture as a chain node.
 *
 * **The node applies no loudness gain of its own, deliberately.** `nam_process` already implements
 * NAM's `Normalized` output mode internally -- `10^((-18 - modelLoudness)/20)`, smoothed against
 * clicks -- which is the policy the workbench validated by listening. Applying it again here would
 * double it. `getInfo().loudness` reports what the engine did so a host can show it.
 *
 * The engine instance is created at `prepare`, not in the constructor, because instantiation is
 * asynchronous and belongs to the caller. Until then the node passes audio through.
 */
export class NamNode implements ChainNode {
	readonly id: string;
	readonly name: string;
	readonly kind = "nam";
	/** The engine adds no algorithmic delay; the buffer is in-place and sample-aligned. */
	readonly latencySamples = 0;
	bypassed = false;
	mix = 1.0;

	private readonly engine: NamEngineModule;
	private modelJson: string;
	private slimSize: number;
	private inputGainDb: number;
	private outputGainDb: number;

	private sampleRate = 48000;
	private instanceId = 0;
	private bufferPointer = 0;
	private view: Float32Array | null = null;

	private loudness: NamLoudness = { modelLoudnessDb: null, appliedGain: 1 };
	private expectedSampleRate: number | null = null;
	private slimmable = false;
	private slimmableBreakpoints: number[] = [];

	constructor(id = "nam-amp", name = "NAM Amp", config: NamNodeConfig) {
		this.id = id;
		this.name = name;
		this.engine = config.engine;
		this.modelJson = config.model;
		this.slimSize = config.slimSize ?? -1;
		this.inputGainDb = clampGainDb(config.inputGainDb ?? 0);
		this.outputGainDb = clampGainDb(config.outputGainDb ?? 0);
	}

	prepare(sampleRate: number): void {
		this.sampleRate = sampleRate;
		this.destroyInstance();
		this.adoptInstance(this.createLoadedInstance(this.modelJson));
	}

	reset(): void {
		// Recreating the instance is what "reload the state" means for this node: the engine's
		// prewarm settles the network's initial conditions, which is the point of a reset.
		this.prepare(this.sampleRate);
	}

	getParam(id: string): number | undefined {
		switch (id) {
			case "inputGainDb":
				return this.inputGainDb;
			case "outputGainDb":
				return this.outputGainDb;
			case "slimSize":
				// Not a param the engine will act on for this model, so it is not reported as
				// one: a host that offered it would be offering a control that does nothing.
				return this.slimmable ? this.slimSize : undefined;
			default:
				return undefined;
		}
	}

	setParam(id: string, value: number): void {
		switch (id) {
			case "inputGainDb":
				this.inputGainDb = clampGainDb(value);
				break;
			case "outputGainDb":
				this.outputGainDb = clampGainDb(value);
				break;
			case "slimSize":
				// Ignored for non-slimmable models, and ignored rather than refused: the
				// parameter is a host-level control that only some models answer to.
				if (this.slimmable) {
					this.slimSize = value;
					this.engine._nam_setSlimmableSize(this.instanceId, value);
				}
				break;
		}
	}

	getParams(): Record<string, number> {
		const params: Record<string, number> = {
			inputGainDb: this.inputGainDb,
			outputGainDb: this.outputGainDb,
		};
		if (this.slimmable) params.slimSize = this.slimSize;
		return params;
	}

	getInfo(): NamNodeInfo {
		return {
			loudness: { ...this.loudness },
			expectedSampleRate: this.expectedSampleRate,
			slimmable: this.slimmable,
			slimmableBreakpoints: [...this.slimmableBreakpoints],
		};
	}

	/**
	 * Swap the model. The replacement is loaded into a **new** instance; the current one keeps
	 * running until the new one is ready, and is released only then. A refused model therefore
	 * never interrupts playback -- the engine's own reason is thrown and the old model stays.
	 */
	setModel(modelJson: string): void {
		const instanceId = this.createLoadedInstance(modelJson);
		const previous = this.instanceId;
		this.modelJson = modelJson;
		this.adoptInstance(instanceId);
		if (previous > 0) this.engine._nam_destroyInstance(previous);
	}

	process(input: Float64Array | Float32Array): Float64Array {
		const length = input.length;
		if (this.bypassed || this.instanceId <= 0) {
			return new Float64Array(input);
		}

		const output = new Float64Array(length);
		const inputGain = 10 ** (this.inputGainDb / 20);
		const outputGain = 10 ** (this.outputGainDb / 20);
		const wetMix = Math.max(0, Math.min(1, this.mix));
		const dryMix = 1 - wetMix;
		const engine = this.engine;

		for (let offset = 0; offset < length; offset += MAX_FRAMES) {
			const frames = Math.min(MAX_FRAMES, length - offset);
			// Re-derived only when the heap identity changes. `ALLOW_MEMORY_GROWTH` means a growth
			// detaches every existing view, and a detached `Float32Array` reads as zeros rather
			// than throwing -- so the check is an identity comparison, not a try/catch.
			const heap = this.bufferView();
			for (let i = 0; i < frames; i++) {
				heap[i] = (input[offset + i] ?? 0) * inputGain;
			}
			engine._nam_process(this.instanceId, frames);
			// `nam_process` never allocates, so the view above is still attached here.
			for (let i = 0; i < frames; i++) {
				const wet = (heap[i] ?? 0) * outputGain;
				const dry = input[offset + i] ?? 0;
				output[offset + i] = dryMix * dry + wetMix * wet;
			}
		}

		return output;
	}

	dispose(): void {
		this.destroyInstance();
	}

	/**
	 * Create an instance with `modelJson` loaded, or throw. The instance is released on every
	 * failure path so a refused model does not strand one.
	 */
	private createLoadedInstance(modelJson: string): number {
		const instanceId = this.engine._nam_createInstance(
			this.sampleRate,
			MAX_FRAMES,
		);
		if (instanceId <= 0) {
			throw new Error("nam_createInstance refused");
		}
		try {
			loadNamModel(this.engine, instanceId, modelJson, this.slimSize);
			const expected = this.engine._nam_getExpectedSampleRate(instanceId);
			if (
				expected >= 0 &&
				Math.abs(expected - this.sampleRate) > SAMPLE_RATE_TOLERANCE_HZ
			) {
				throw new Error(
					`NAM model ${labelOf(modelJson)} states ${expected} Hz but the chain runs at ` +
						`${this.sampleRate} Hz; refusing to run it at the wrong rate`,
				);
			}
			return instanceId;
		} catch (error) {
			this.engine._nam_destroyInstance(instanceId);
			throw error;
		}
	}

	private adoptInstance(instanceId: number): void {
		this.instanceId = instanceId;
		this.bufferPointer = this.engine._nam_getBuffer(instanceId);
		this.view = null;
		this.loudness = namLoudness(this.engine, instanceId);
		const expected = this.engine._nam_getExpectedSampleRate(instanceId);
		this.expectedSampleRate = expected < 0 ? null : expected;
		this.slimmable = this.engine._nam_isSlimmable(instanceId) === 1;
		this.slimmableBreakpoints = [];
		if (this.slimmable) {
			const count = this.engine._nam_getSlimmableBreakpointCount(instanceId);
			for (let index = 0; index < count; index++) {
				const breakpoint = this.engine._nam_getSlimmableBreakpoint(
					instanceId,
					index,
				);
				if (breakpoint >= 0) this.slimmableBreakpoints.push(breakpoint);
			}
		}
	}

	private bufferView(): Float32Array {
		if (this.view === null || this.view.buffer !== this.engine.HEAPF32.buffer) {
			const offset = this.bufferPointer >> 2;
			this.view = this.engine.HEAPF32.subarray(offset, offset + MAX_FRAMES);
		}
		return this.view;
	}

	private destroyInstance(): void {
		if (this.instanceId > 0) {
			this.engine._nam_destroyInstance(this.instanceId);
		}
		this.instanceId = 0;
		this.bufferPointer = 0;
		this.view = null;
		this.loudness = { modelLoudnessDb: null, appliedGain: 1 };
		this.expectedSampleRate = null;
		this.slimmable = false;
		this.slimmableBreakpoints = [];
	}
}

function clampGainDb(value: number): number {
	return Math.max(-GAIN_DB_LIMIT, Math.min(GAIN_DB_LIMIT, value));
}

/** A short, stable label for a model document, for error messages. */
function labelOf(modelJson: string): string {
	try {
		const parsed: unknown = JSON.parse(modelJson);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"name" in parsed &&
			typeof parsed.name === "string" &&
			parsed.name.length > 0
		) {
			return parsed.name;
		}
	} catch {
		// Not parseable, or has no name: fall through to the truncated document.
	}
	return `${modelJson.slice(0, 80)}...`;
}

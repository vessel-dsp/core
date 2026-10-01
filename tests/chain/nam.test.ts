import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	instantiateNamEngine,
	loadNamModel,
	NamNode,
	type NamEngineModule,
	SignalChain,
} from "@vessel-dsp/chain";

const GLUE_PATH = join(
	import.meta.dir,
	"../../packages/chain/nam-engine/nam-engine.js",
);
const WASM_PATH = join(
	import.meta.dir,
	"../../packages/chain/nam-engine/nam-engine.wasm",
);

/**
 * A tiny synthetic Linear model, built here so the test owns its licence.
 *
 * `Linear` is the pinned core's simplest architecture: the weights ARE the impulse response, in
 * natural order, plus an optional bias. `bias: false` keeps a silent input exactly silent (the
 * engine's DC blocker then has nothing to ring on), which is what the silence floor needs.
 */
const SYNTHETIC_WEIGHTS = [0.5, -0.25, 0.125, 0.0625];
const SYNTHETIC_MODEL = JSON.stringify({
	version: "0.5.0",
	architecture: "Linear",
	config: {
		receptive_field: SYNTHETIC_WEIGHTS.length,
		bias: false,
		in_channels: 1,
		out_channels: 1,
		implementation: "direct",
	},
	weights: SYNTHETIC_WEIGHTS,
	metadata: { loudness: -14.0 },
	sample_rate: 48000,
});

const FAKE_MODEL = JSON.stringify({
	version: "0.5.0",
	architecture: "Linear",
	config: { receptive_field: 2, bias: false },
	weights: [0.5, 0.25],
});

/**
 * What the pinned engine does to a signal, mirrored in float64: the model's convolution, then the
 * loudness normalisation `nam_process` applies internally, then its 10 Hz DC blocker. Validated
 * against the real engine's actual output for an impulse (max error 2.5e-8).
 */
function referenceEngineOutput(
	input: readonly number[],
	weights: readonly number[],
	loudnessDb: number,
	sampleRate: number,
): number[] {
	const gain = 10 ** ((-18 - loudnessDb) / 20);
	const coeff = 1 - (2 * Math.PI * 10) / sampleRate;
	const gained: number[] = [];
	for (let i = 0; i < input.length; i++) {
		let acc = 0;
		for (let j = 0; j < weights.length; j++) {
			const x = i - j >= 0 ? (input[i - j] ?? 0) : 0;
			acc += (weights[j] ?? 0) * x;
		}
		gained.push(gain * acc);
	}
	const out: number[] = [];
	let prevIn = 0;
	let prevOut = 0;
	for (let i = 0; i < gained.length; i++) {
		const sample = (gained[i] ?? 0) - prevIn + coeff * prevOut;
		out.push(sample);
		prevIn = gained[i] ?? 0;
		prevOut = sample;
	}
	return out;
}

function maxAbsDiff(a: readonly number[], b: readonly number[]): number {
	let max = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
	}
	return max;
}

function rms(samples: readonly number[]): number {
	let sum = 0;
	for (const sample of samples) sum += (sample ?? 0) * (sample ?? 0);
	return Math.sqrt(sum / Math.max(samples.length, 1));
}

function sine(amplitude: number, length: number): Float64Array {
	const out = new Float64Array(length);
	for (let i = 0; i < length; i++) {
		out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / 48000);
	}
	return out;
}

async function createRealEngine(): Promise<NamEngineModule> {
	const factory = (await import(GLUE_PATH)).default as (options: {
		wasmBinary: ArrayBufferLike;
	}) => Promise<NamEngineModule>;
	return instantiateNamEngine(readFileSync(WASM_PATH), factory);
}

interface FakeEngine {
	readonly engine: NamEngineModule;
	readonly destroyCount: number;
	readonly loadedModels: readonly string[];
	readonly slimSizes: readonly number[];
}

/**
 * A hand-written engine double. `_nam_process` is a one-pole low-pass whose state carries across
 * calls, so a block processed in chunks equals the same block processed one-shot -- which is the
 * property the chunking test asserts.
 */
function createFakeEngine(
	options: {
		expectedSampleRate?: number | null;
		slimmable?: boolean;
		breakpoints?: readonly number[];
		refuseIf?: (modelJson: string) => boolean;
	} = {},
): FakeEngine {
	const BUFFER_OFFSET = 4096;
	const ERROR_OFFSET = 12288;
	const ALPHA = 0.5;

	const state = {
		destroyCount: 0,
		loadedModels: [] as string[],
		slimSizes: [] as number[],
		nextId: 1,
		instances: new Map<number, { state: number; model: string | null }>(),
		nextPtr: 8192,
	};

	const module: NamEngineModule = {
		HEAPF32: new Float32Array(16384),

		_nam_createInstance(_sampleRate: number, _maxFrames: number): number {
			const id = state.nextId++;
			state.instances.set(id, { state: 0, model: null });
			return id;
		},

		_nam_destroyInstance(id: number): void {
			state.instances.delete(id);
			state.destroyCount++;
		},

		_nam_loadModel(id: number, jsonPtr: number, _slimSize: number): number {
			const instance = state.instances.get(id);
			if (!instance) return 0;
			const json = module.UTF8ToString(jsonPtr);
			if (options.refuseIf?.(json)) {
				module.stringToUTF8("fake engine refused the model", ERROR_OFFSET, 64);
				return 0;
			}
			try {
				JSON.parse(json);
			} catch {
				module.stringToUTF8(
					"fake engine: model is not valid JSON",
					ERROR_OFFSET,
					64,
				);
				return 0;
			}
			instance.model = json;
			state.loadedModels.push(json);
			return 1;
		},

		_nam_hasModel(id: number): number {
			const instance = state.instances.get(id);
			return instance?.model != null ? 1 : 0;
		},

		_nam_getBuffer(_id: number): number {
			return BUFFER_OFFSET;
		},

		_nam_process(id: number, frames: number): void {
			const instance = state.instances.get(id);
			if (!instance) return;
			const heap = module.HEAPF32;
			const base = BUFFER_OFFSET >> 2;
			for (let i = 0; i < frames; i++) {
				const x = heap[base + i] ?? 0;
				const y = instance.state + ALPHA * (x - instance.state);
				heap[base + i] = y;
				instance.state = y;
			}
		},

		_nam_hasLoudness(_id: number): number {
			return 1;
		},

		_nam_getLoudness(_id: number): number {
			return -14;
		},

		_nam_getExpectedSampleRate(_id: number): number {
			return options.expectedSampleRate === undefined
				? 48000
				: (options.expectedSampleRate ?? -1);
		},

		_nam_isSlimmable(_id: number): number {
			return options.slimmable ? 1 : 0;
		},

		_nam_setSlimmableSize(_id: number, slimSize: number): void {
			state.slimSizes.push(slimSize);
		},

		_nam_getSlimmableBreakpointCount(_id: number): number {
			return options.breakpoints?.length ?? 0;
		},

		_nam_getSlimmableBreakpoint(_id: number, index: number): number {
			return options.breakpoints?.[index] ?? -1;
		},

		_nam_getLastError(): number {
			return ERROR_OFFSET;
		},

		_malloc(bytes: number): number {
			const pointer = state.nextPtr;
			state.nextPtr += bytes;
			return pointer + bytes > module.HEAPF32.buffer.byteLength ? 0 : pointer;
		},

		_free(_ptr: number): void {},

		lengthBytesUTF8(text: string): number {
			return new TextEncoder().encode(text).length;
		},

		stringToUTF8(text: string, ptr: number, maxBytes: number): void {
			const bytes = new TextEncoder().encode(text);
			const view = new Uint8Array(module.HEAPF32.buffer, ptr, maxBytes);
			view.set(bytes.subarray(0, Math.max(maxBytes - 1, 0)));
			view[Math.min(bytes.length, Math.max(maxBytes - 1, 0))] = 0;
		},

		UTF8ToString(ptr: number): string {
			const heapBytes = new Uint8Array(module.HEAPF32.buffer);
			let end = ptr;
			while (end < heapBytes.length && heapBytes[end] !== 0) end++;
			return new TextDecoder().decode(heapBytes.subarray(ptr, end));
		},
	};

	return {
		engine: module,
		get destroyCount() {
			return state.destroyCount;
		},
		get loadedModels() {
			return state.loadedModels;
		},
		get slimSizes() {
			return state.slimSizes;
		},
	};
}

describe("NamNode with the real engine", () => {
	test("an impulse comes out as the model's convolution, to float32 precision", async () => {
		const engine = await createRealEngine();
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine,
			model: SYNTHETIC_MODEL,
		});
		node.prepare(48000);

		const info = node.getInfo();
		expect(info.expectedSampleRate).toBe(48000);
		expect(info.slimmable).toBe(false);
		expect(info.loudness.modelLoudnessDb).toBe(-14);
		expect(info.loudness.appliedGain).toBeCloseTo(10 ** -0.2, 6);

		const length = 16;
		const impulse = new Float64Array(length);
		impulse[0] = 1;
		const out = node.process(impulse);

		const expected = referenceEngineOutput(
			Array.from(impulse),
			SYNTHETIC_WEIGHTS,
			-14,
			48000,
		);
		expect(maxAbsDiff(out, expected)).toBeLessThan(1e-6);
	});

	test("silence in stays below -120 dB, and a larger input gives a larger output", async () => {
		const engine = await createRealEngine();
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine,
			model: SYNTHETIC_MODEL,
		});
		node.prepare(48000);

		const silent = node.process(new Float64Array(256));
		let peak = 0;
		for (const sample of silent) peak = Math.max(peak, Math.abs(sample));
		expect(peak).toBeLessThan(1e-6);

		const small = node.process(sine(0.1, 512));
		const large = node.process(sine(0.5, 512));
		expect(rms(large)).toBeGreaterThan(rms(small));
	});

	test("a corrupted model is refused while the valid one loads", async () => {
		const engine = await createRealEngine();

		const bad = new NamNode("nam-bad", "Bad Model", {
			engine,
			model: "this is not json",
		});
		expect(() => bad.prepare(48000)).toThrow();

		const good = new NamNode("nam-good", "Good Model", {
			engine,
			model: SYNTHETIC_MODEL,
		});
		good.prepare(48000);
		expect(good.getInfo().expectedSampleRate).toBe(48000);
	});
});

describe("NamNode with a fake engine", () => {
	test("a block longer than maxFrames is chunked and equals one-shot processing", () => {
		const fake = createFakeEngine();
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		node.prepare(48000);

		const block = new Float64Array(2048);
		for (let i = 0; i < block.length; i++) {
			block[i] = 0.5 + 0.25 * Math.sin((2 * Math.PI * 220 * i) / 48000);
		}
		const chunked = node.process(block);

		const oneShotId = fake.engine._nam_createInstance(48000, 2048);
		loadNamModel(fake.engine, oneShotId, FAKE_MODEL, -1);
		const bufferPointer = fake.engine._nam_getBuffer(oneShotId);
		const view = new Float32Array(
			fake.engine.HEAPF32.buffer,
			bufferPointer,
			2048,
		);
		for (let i = 0; i < block.length; i++) view[i] = block[i] ?? 0;
		fake.engine._nam_process(oneShotId, 2048);
		const oneShot = Array.from(
			new Float32Array(fake.engine.HEAPF32.buffer, bufferPointer, 2048),
		);
		fake.engine._nam_destroyInstance(oneShotId);

		expect(maxAbsDiff(chunked, oneShot)).toBeLessThan(1e-6);
	});

	test("a sample-rate mismatch refuses, naming both rates and the model", () => {
		const fake = createFakeEngine({ expectedSampleRate: 44100 });
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		expect(() => node.prepare(48000)).toThrow(/44100/);
		expect(() => node.prepare(48000)).toThrow(/48000/);
	});

	test("a model stating no rate is accepted, and a rate within tolerance is accepted", () => {
		const unstated = createFakeEngine({ expectedSampleRate: null });
		const node = new NamNode("nam-unstated", "NAM", {
			engine: unstated.engine,
			model: FAKE_MODEL,
		});
		node.prepare(48000);
		expect(node.getInfo().expectedSampleRate).toBeNull();

		const close = createFakeEngine({ expectedSampleRate: 48000.3 });
		const closeNode = new NamNode("nam-close", "NAM", {
			engine: close.engine,
			model: FAKE_MODEL,
		});
		closeNode.prepare(48000);
		expect(closeNode.getInfo().expectedSampleRate).toBe(48000.3);
	});

	test("a refused model throws with the engine's own reason", () => {
		const fake = createFakeEngine({
			refuseIf: (json) => json.includes("REFUSE"),
		});
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: '{"REFUSE":true}',
		});
		expect(() => node.prepare(48000)).toThrow(/fake engine refused the model/);
	});

	test("a setModel failure keeps the previous model running", () => {
		const fake = createFakeEngine({
			refuseIf: (json) => json.includes("REFUSE"),
		});
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		node.prepare(48000);

		expect(() => node.setModel('{"REFUSE":true}')).toThrow(
			/fake engine refused the model/,
		);
		expect(fake.loadedModels).toEqual([FAKE_MODEL]);
		expect(node.getInfo().expectedSampleRate).toBe(48000);

		const out = node.process(new Float64Array(64).fill(0.5));
		expect(Number.isFinite(out[0] ?? 0)).toBe(true);
	});

	test("HEAPF32 is re-read after the buffer is replaced mid-stream", () => {
		const fake = createFakeEngine();
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		node.prepare(48000);

		const first = node.process(new Float64Array(64).fill(0.5));
		expect(Math.abs(first[0] ?? 0)).toBeGreaterThan(0);

		fake.engine.HEAPF32 = new Float32Array(16384);

		const second = node.process(new Float64Array(64).fill(0.5));

		// The double's low-pass state carries across the replacement; a stale view would read
		// zeros from the new heap and ring the state down toward zero instead.
		let filterState = 0;
		const expected: number[] = [];
		for (let block = 0; block < 2; block++) {
			for (let i = 0; i < 64; i++) {
				const y = filterState + 0.5 * (0.5 - filterState);
				expected.push(y);
				filterState = y;
			}
		}
		expect(maxAbsDiff(second, expected.slice(64))).toBeLessThan(1e-6);
	});

	test("removeNode, clearNodes and the addNode replace path dispose the node they drop", () => {
		const fake = createFakeEngine();
		const chain = new SignalChain({ sampleRate: 48000 });

		const first = new NamNode("nam-1", "NAM 1", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		chain.addNode(first);
		expect(fake.destroyCount).toBe(0);

		chain.removeNode("nam-1");
		expect(fake.destroyCount).toBe(1);

		chain.addNode(
			new NamNode("nam-2", "NAM 2", { engine: fake.engine, model: FAKE_MODEL }),
		);
		chain.addNode(
			new NamNode("nam-3", "NAM 3", { engine: fake.engine, model: FAKE_MODEL }),
		);
		expect(fake.destroyCount).toBe(1);

		chain.clearNodes();
		expect(fake.destroyCount).toBe(3);

		chain.addNode(
			new NamNode("nam-4", "NAM 4", { engine: fake.engine, model: FAKE_MODEL }),
		);
		chain.addNode(
			new NamNode("nam-4", "NAM 4 again", {
				engine: fake.engine,
				model: FAKE_MODEL,
			}),
		);
		expect(fake.destroyCount).toBe(4);
	});

	test("bypass returns the input", () => {
		const fake = createFakeEngine();
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		node.prepare(48000);
		node.bypassed = true;

		const input = new Float64Array(128).fill(0.25);
		expect(Array.from(node.process(input))).toEqual(Array.from(input));
	});

	test("mix=0 equals the input", () => {
		const fake = createFakeEngine();
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		node.prepare(48000);
		node.mix = 0;

		const input = new Float64Array(128).fill(0.25);
		expect(Array.from(node.process(input))).toEqual(Array.from(input));
	});

	test("params survive getPreset -> loadPreset with a nodeFactory", () => {
		const fake = createFakeEngine();
		const chain = new SignalChain({ sampleRate: 48000 });
		chain.addNode(
			new NamNode("nam-1", "NAM", {
				engine: fake.engine,
				model: FAKE_MODEL,
				inputGainDb: 6,
				outputGainDb: -3,
			}),
		);

		const preset = chain.getPreset("Rig");
		const snapshot = preset.nodes.find((n) => n.id === "nam-1");
		expect(snapshot?.params).toEqual({ inputGainDb: 6, outputGainDb: -3 });

		const restored = new SignalChain({ sampleRate: 48000 });
		restored.loadPreset(preset, (snap) => {
			if (snap.kind === "nam") {
				return new NamNode(snap.id, snap.name, {
					engine: fake.engine,
					model: FAKE_MODEL,
				});
			}
			return undefined;
		});

		const node = restored.getNode("nam-1");
		expect(node).toBeInstanceOf(NamNode);
		expect(node?.getParam("inputGainDb")).toBe(6);
		expect(node?.getParam("outputGainDb")).toBe(-3);
	});

	test("slimSize is reported only for slimmable models", () => {
		const slim = createFakeEngine({
			slimmable: true,
			breakpoints: [0.25, 0.5, 0.75],
		});
		const slimNode = new NamNode("nam-slim", "NAM", {
			engine: slim.engine,
			model: FAKE_MODEL,
			slimSize: 0.5,
		});
		slimNode.prepare(48000);
		expect(slimNode.getParam("slimSize")).toBe(0.5);
		expect(slimNode.getInfo().slimmable).toBe(true);
		expect(slimNode.getInfo().slimmableBreakpoints).toEqual([0.25, 0.5, 0.75]);

		slimNode.setParam("slimSize", 0.75);
		expect(slim.slimSizes).toContain(0.75);

		const plain = createFakeEngine();
		const plainNode = new NamNode("nam-plain", "NAM", {
			engine: plain.engine,
			model: FAKE_MODEL,
		});
		plainNode.prepare(48000);
		expect(plainNode.getParam("slimSize")).toBeUndefined();
		plainNode.setParam("slimSize", 0.5);
		expect(plainNode.getInfo().slimmable).toBe(false);
		expect(plain.slimSizes).toEqual([]);
	});

	test("latency is zero samples", () => {
		const fake = createFakeEngine();
		const node = new NamNode("nam-amp", "NAM Amp", {
			engine: fake.engine,
			model: FAKE_MODEL,
		});
		expect(node.latencySamples).toBe(0);
		expect(node.kind).toBe("nam");
	});
});

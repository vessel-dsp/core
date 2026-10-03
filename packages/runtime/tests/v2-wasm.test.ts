// Unit tests for V2 WASM C++ Engine console.
//
// Verifies:
// 1. Creation, compilation, prepare, processSample, and processBlock on deterministic fixtures.
// 2. Refusal contracts: an unknown requiredOperator, requiredModel, or stamp kind is refused
//    by name at load time, never executing or failing silently.
// 3. Corrupted / invalid input handling.

import { describe, expect, it } from "bun:test";
import { compile, type CompileOptions } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import { pedalPartCatalog } from "@vessel-dsp/compiler";
import {
	beltonBrickReverb,
	hybridDelayPedal,
	rcLowPass,
	resistorDivider,
} from "@vessel-dsp/compiler/fixtures/circuits";
import {
	digitalDelayLineRegistry,
	fixtureRegistry,
} from "@vessel-dsp/compiler/fixtures/registry";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { wasmBinaryPresent } from "./wasm-presence";

function compileFixture(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

describe.skipIf(!wasmBinaryPresent)("V2 WASM Engine lifecycle & execution", () => {
	it("compiles, loads, prepares, and renders deterministic samples and blocks", async () => {
		const prog = compileFixture(resistorDivider);
		const engine = await V2WasmEngine.create(prog);
		engine.prepare({ sampleRate: 48000, maxNewtonIterations: 64, inputSourceOhms: 0 });

		// Single sample processing
		const outSample = engine.processSample(1.0);
		expect(outSample).toBeCloseTo(0.5, 4);

		// Block processing
		const inBlock = new Float32Array([1.0, 0.5, -0.5, -1.0]);
		const outBlock = new Float32Array(4);
		engine.processBlock(inBlock, outBlock);

		expect(outBlock[0]).toBeCloseTo(0.5, 4);
		expect(outBlock[1]).toBeCloseTo(0.25, 4);
		expect(outBlock[2]).toBeCloseTo(-0.25, 4);
		expect(outBlock[3]).toBeCloseTo(-0.5, 4);

		engine.destroy();
	});

	it("renders dynamic filter transient accurately on RC low-pass", async () => {
		const prog = compileFixture(rcLowPass);
		const engine = await V2WasmEngine.create(prog);
		engine.prepare({ sampleRate: 48000, maxNewtonIterations: 64, inputSourceOhms: 0 });

		// Step response
		let prev = 0;
		for (let i = 0; i < 50; ++i) {
			const s = engine.processSample(1.0);
			expect(s).toBeGreaterThanOrEqual(prev);
			expect(s).toBeLessThanOrEqual(1.0);
			prev = s;
		}
		expect(prev).toBeGreaterThan(0.9);
		engine.destroy();
	});
});

describe.skipIf(!wasmBinaryPresent)("V2 WASM Engine refusal contracts (Phase 6f)", () => {
	it("refuses unknown requiredOperator by name at load", async () => {
		const prog = compileFixture(resistorDivider);
		const corruptedProg: Program = {
			...prog,
			requiredOperators: [...prog.requiredOperators, "quantum-tunnel-junction" as any],
		};

		const engine = await V2WasmEngine.create();
		expect(() => engine.loadProgram(corruptedProg)).toThrow(
			/unimplemented operators:.*quantum-tunnel-junction/,
		);
		engine.destroy();
	});

	it("refuses unknown requiredModel by name at load", async () => {
		const prog = compileFixture(resistorDivider);
		const corruptedProg: Program = {
			...prog,
			requiredModels: [...prog.requiredModels, "exotic-waveguide" as any],
		};

		const engine = await V2WasmEngine.create();
		expect(() => engine.loadProgram(corruptedProg)).toThrow(
			/unimplemented models:.*exotic-waveguide/,
		);
		engine.destroy();
	});

	it("refuses unknown stamp kind by name at load", async () => {
		const prog = compileFixture(resistorDivider);
		const corruptedBlocks = prog.blocks.map((b, idx) => {
			if (idx === 0 && b.kind === "mna") {
				return {
					...b,
					stamps: [
						...b.stamps,
						{
							kind: "memristor" as any,
							nodes: [0, 1],
							value: 1000,
						} as any,
					],
				};
			}
			return b;
		});

		const corruptedProg: Program = {
			...prog,
			blocks: corruptedBlocks,
		};

		const engine = await V2WasmEngine.create();
		expect(() => engine.loadProgram(corruptedProg)).toThrow(
			/unimplemented stamp kind: memristor/,
		);
		engine.destroy();
	});

	it("refuses unknown block kind by name at load", async () => {
		const prog = compileFixture(resistorDivider);
		const corruptedBlocks = prog.blocks.map((b) => ({
			...b,
			kind: "flux-capacitor" as any,
		}));

		const corruptedProg: Program = {
			...prog,
			blocks: corruptedBlocks,
		};

		const engine = await V2WasmEngine.create();
		expect(() => engine.loadProgram(corruptedProg)).toThrow(
			/unimplemented block kind: flux-capacitor/,
		);
		engine.destroy();
	});
});

describe.skipIf(!wasmBinaryPresent)("V2 WASM composed blocks: the C++ interpreter agrees with TS (row 4)", () => {
	// Each shipped model as a composition, rendered on both consoles from the same program.
	// Same-algorithm-different-implementation agreement cannot be bit-exact in general (libm
	// exp/pow may differ by 1 ULP), so the cross-console bar is a tight delta.
	//
	// Until board-p3 row 7 this compiled the legacy route and swapped each macro block for its
	// decomposition in memory, and carried a second case asserting that the same engine rendered
	// macro and composed identically. The dispatched kernels are gone, so there is no macro side
	// left to swap or compare: `compile` yields the composition directly. That bit-level
	// equivalence is not lost, it is pinned -- see `scripts/composition-reference-renders.json`,
	// recorded from a tree where both routes still existed and agreed.
	function compileComposed(
		source: string,
		options: CompileOptions,
	): Program {
		const result = compile(source, options);
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result)}`);
		}
		if (!result.program.blocks.some((block) => block.kind === "composed")) {
			throw new Error("compiled program carries no composition");
		}
		return result.program;
	}

	async function renderWasm(program: Program, input: Float64Array): Promise<Float64Array> {
		const engine = await V2WasmEngine.create(program);
		engine.prepare({ sampleRate: 48_000 });
		const out = new Float64Array(input.length);
		for (let index = 0; index < input.length; index += 1) {
			out[index] = engine.processSample(input[index] as number);
		}
		engine.destroy();
		return out;
	}

	function renderTs(program: Program, input: Float64Array): Float64Array {
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(48_000);
		return runtime.process(input);
	}

	function sine(length: number): Float64Array {
		const input = new Float64Array(length);
		for (let index = 0; index < length; index += 1) {
			input[index] = 0.5 * Math.sin((2 * Math.PI * 220 * index) / 48_000);
		}
		input[0] = 1;
		return input;
	}

	function maxDelta(a: Float64Array, b: Float64Array): number {
		let worst = 0;
		for (let index = 0; index < a.length; index += 1) {
			const d = Math.abs((a[index] as number) - (b[index] as number));
			if (d > worst) {
				worst = d;
			}
		}
		return worst;
	}

	it("delay, brigade, and reverb compositions agree across consoles", async () => {
		const cases = [
			{
				source: hybridDelayPedal,
				registry: digitalDelayLineRegistry,
				modelId: "digital-delay-line",
				samples: 48_000,
			},
			{
				source: hybridDelayPedal,
				registry: fixtureRegistry,
				modelId: "bucket-brigade-delay-line",
				samples: 48_000,
			},
			{
				source: beltonBrickReverb,
				registry: pedalPartCatalog,
				modelId: "digital-reverb-module",
				samples: 96_000,
			},
		] as const;
		for (const { source, registry, modelId, samples } of cases) {
			const composed = compileComposed(source, { registry });
			expect(
				composed.blocks.some(
					(block) => block.kind === "composed" && block.modelId === modelId,
				),
			).toBe(true);
			const input = sine(samples);
			const ts = renderTs(composed, input);
			const wasm = await renderWasm(composed, input);
			expect(maxDelta(ts, wasm)).toBeLessThan(1e-9);
		}
	});
});

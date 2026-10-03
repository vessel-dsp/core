// Pitch acceptance: measurement discipline first, primitive second (board-p3 row 5).
//
// Hand-built programs appear in this file, which the reference-runtime
// suite's header forbids for compiler-conformance tests -- and this file is
// not one: no compiler route produces `pitch-shift` programs yet (no packet
// declares one), so a hand-built composition is the only way to execute the
// primitive at all. The program here IS the claim under test, matching the
// design's "the program is the composition". Compiler-conformance coverage
// stays in `reference-runtime.test.ts`, which compiles fixtures throughout.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { fixtureRegistry } from "@vessel-dsp/compiler/fixtures/registry";
import { hybridDelayPedal } from "@vessel-dsp/compiler/fixtures/circuits";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { wasmBinaryPresent } from "./wasm-presence";


export type PitchMeasurement = {
	readonly frequencyHz: number;
	readonly arrivalSample: number;
};

/**
 * First sample above threshold, or -1. Factored out of
 * `measureFundamental` so primitive acceptances can guard liveness without
 * inheriting a frequency number that glitch artifacts would inflate.
 */
export function findArrival(
	samples: Float64Array,
	threshold = 1e-3,
): number {
	for (let index = 0; index < samples.length; index += 1) {
		if (Math.abs(samples[index] as number) > threshold) {
			return index;
		}
	}
	return -1;
}

/**
 * Fundamental of a rendered signal inside an explicit window (row 5
 * control). The window is checked against measured first arrival, not
 * assumed: a pitch measurement taken before the output arrives reads the
 * DRY signal's fundamental -- exactly the null's expected value -- so a
 * badly-windowed pitch test confirms the null and looks correct doing it.
 *
 * Refuses rather than reports in both vacuous cases: no arrival anywhere
 * (the primitive produced nothing, which is not a null confirmed), and a
 * window opening before arrival (which would read dry). If neither refusal
 * can be made to fire, the acceptance below is not ready -- that is the
 * control, and it is tested first.
 *
 * Zero-crossing counting, exact on full-cycle clean signals. Shifted
 * signals carry wrap glitches that inflate crossing counts, so their
 * acceptance measures bins (below) and uses this helper's arrival half
 * only through `findArrival`.
 */
export function measureFundamental(
	samples: Float64Array,
	options: {
		readonly windowStart: number;
		readonly windowLength: number;
		readonly sampleRate: number;
		readonly arrivalThreshold?: number;
	},
): PitchMeasurement {
	const threshold = options.arrivalThreshold ?? 1e-3;
	const arrival = findArrival(samples, threshold);
	if (arrival === -1) {
		throw new Error(
			"pitch measurement refused: no signal arrival above threshold; " +
				"the primitive produced no output, which is not a null confirmed",
		);
	}
	if (options.windowStart < arrival) {
		throw new Error(
			`pitch measurement refused: window opens at ${options.windowStart}, ` +
				`before first arrival at ${arrival}; measuring dry would confirm the null`,
		);
	}
	const end = options.windowStart + options.windowLength;
	if (end > samples.length) {
		throw new Error(
			`pitch measurement refused: window [${options.windowStart}, ${end}) ` +
				`overruns ${samples.length} rendered samples`,
		);
	}
	let crossings = 0;
	let previous = 0;
	for (let index = options.windowStart; index < end; index += 1) {
		const value = samples[index] as number;
		if (value === 0) {
			continue;
		}
		const sign = value > 0 ? 1 : -1;
		if (previous !== 0 && sign !== previous) {
			crossings += 1;
		}
		previous = sign;
	}
	const seconds = options.windowLength / options.sampleRate;
	return {
		frequencyHz: crossings / 2 / seconds,
		arrivalSample: arrival,
	};
}

function sine220(length: number): Float64Array {
	const input = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		input[index] = 0.5 * Math.sin((2 * Math.PI * 220 * index) / 48_000);
	}
	return input;
}

describe("pitch measurement control: refuses the vacuous cases", () => {
	it("refuses a window that opens before first arrival", () => {
		// A signal whose arrival is late: cosine onset at sample 2000 (nonzero,
		// so arrival is exactly there), 22 full cycles after, so the later
		// measurement is exact and only the refusal is under test here.
		const delayed = new Float64Array(6800);
		for (let index = 2000; index < delayed.length; index += 1) {
			delayed[index] =
				0.5 * Math.cos((2 * Math.PI * 220 * (index - 2000)) / 48_000);
		}
		expect(() =>
			measureFundamental(delayed, {
				windowStart: 0,
				windowLength: 2000,
				sampleRate: 48_000,
			}),
		).toThrow(/before first arrival/);
		// And the same signal measures fine once the window opens at arrival.
		const measured = measureFundamental(delayed, {
			windowStart: 2000,
			windowLength: 4800,
			sampleRate: 48_000,
		});
		expect(measured.arrivalSample).toBe(2000);
		expect(measured.frequencyHz).toBe(220);
	});

	it("refuses a flat signal instead of confirming the null", () => {
		expect(() =>
			measureFundamental(new Float64Array(4800), {
				windowStart: 0,
				windowLength: 4800,
				sampleRate: 48_000,
			}),
		).toThrow(/no signal arrival/);
	});

	it("refuses a window that overruns the render", () => {
		expect(() =>
			measureFundamental(sine220(4800), {
				windowStart: 4600,
				windowLength: 4800,
				sampleRate: 48_000,
			}),
		).toThrow(/overruns/);
	});

	it("measures a post-arrival sine exactly", () => {
		// Cosine starts nonzero, so arrival is sample 0 and the window may
		// open there. Full cycles in the window: 220 Hz over 0.1 s is 22
		// cycles, so the count is exact and the null below can be stated
		// without tolerance.
		const input = new Float64Array(4800);
		for (let index = 0; index < input.length; index += 1) {
			input[index] = 0.5 * Math.cos((2 * Math.PI * 220 * index) / 48_000);
		}
		const measured = measureFundamental(input, {
			windowStart: 0,
			windowLength: 4800,
			sampleRate: 48_000,
		});
		expect(measured.arrivalSample).toBe(0);
		expect(measured.frequencyHz).toBe(220);
	});
});

describe("pitch-shift primitive: the interval is the claim (row 5)", () => {
	// The program is hand-built around one compiled shell: no compiler route
	// produces `pitch-shift` programs yet (no packet declares one), so the
	// composition under test is assembled here from a compiled fixture whose
	// input shell drives the block's tap for real. The file header records
	// why this file, and only this file, is allowed to do that.
	function pitchProgram(ratio: number): Program {
		const compiled = compile(hybridDelayPedal, { registry: fixtureRegistry });
		if (compiled.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(compiled)}`);
		}
		const program = compiled.program;
		const macro = program.blocks.find(
			(block) =>
				(block.kind === "macro" || block.kind === "composed") &&
				block.modelId === "bucket-brigade-delay-line",
		);
		if (macro?.kind !== "macro" && macro?.kind !== "composed") {
			throw new Error("fixture produced no brigade block to replace");
		}
		const pitch = {
			kind: "composed",
			id: macro.id,
			modelId: "pitch-shift",
			parameters: {},
			audioIn: macro.audioIn,
			audioOut: macro.audioOut,
			parameter: null,
			selector: null,
			positions: [
				{
					id: "default",
					ops: [{ op: "pitch-shift", ratio, input: { kind: "input" }, out: 0 }],
					out: 0,
					lines: {},
				},
			],
		} as const;
		return {
			...program,
			requiredModels: program.requiredModels.map((model) =>
				model === macro.modelId ? "pitch-shift" : model,
			),
			costPredictors: {
				...program.costPredictors,
				macroBlocks: program.costPredictors.macroBlocks.map((block) =>
					block.blockId === macro.id ? { ...block, modelId: "pitch-shift" } : block,
				),
			},
			blocks: program.blocks.map((block) => (block === macro ? pitch : block)),
		} as Program;
	}

	function render(ratio: number, cosine = false): Float64Array {
		const runtime = new ReferenceRuntime(pitchProgram(ratio));
		runtime.prepare(48_000);
		const input = new Float64Array(48_000);
		for (let index = 0; index < input.length; index += 1) {
			const phase = (2 * Math.PI * 220 * index) / 48_000;
			input[index] = cosine ? 0.5 * Math.cos(phase) : 0.5 * Math.sin(phase);
		}
		return runtime.process(input);
	}

	/**
	 * Goertzel magnitude at an exact bin. Zero-crossing counting inflates on
	 * wrap glitches (each discontinuity can add crossings), while bins put
	 * the fundamental where it belongs and spread the glitch broadband --
	 * so the shifted acceptance measures bins and the null keeps its exact
	 * crossing count. Length 4800 at 48 kHz makes 110/220/330/440 all exact.
	 */
	function binMagnitude(
		samples: Float64Array,
		frequencyHz: number,
		start: number,
		length: number,
	): number {
		const k = Math.round((frequencyHz * length) / 48_000);
		const w = (2 * Math.PI * k) / length;
		const coefficient = 2 * Math.cos(w);
		let s0 = 0;
		let s1 = 0;
		let s2 = 0;
		for (let index = 0; index < length; index += 1) {
			s0 = (samples[start + index] as number) + coefficient * s1 - s2;
			s2 = s1;
			s1 = s0;
		}
		return Math.sqrt(s1 * s1 + s2 * s2 - coefficient * s1 * s2);
	}

	function expectDominant(
		rendered: Float64Array,
		targetHz: number,
		othersHz: readonly number[],
	): void {
		const arrival = findArrival(rendered);
		if (arrival === -1) {
			throw new Error("shifted render is silent: the null is not confirmed");
		}
		const start = 24_000;
		if (arrival > start) {
			throw new Error(
				`arrival at ${arrival} is past the measurement window; refusing`,
			);
		}
		const target = binMagnitude(rendered, targetHz, start, 4800);
		for (const other of othersHz) {
			const rival = binMagnitude(rendered, other, start, 4800);
			// Deterministic renders, so the margin is exact rather than
			// statistical: correct intervals clear 3x here, wrong ones sit
			// below a tenth. A broken shifter (dry passthrough, silence with
			// leakage, a neighboring interval) lands on the wrong side loudly.
			expect(target).toBeGreaterThan(2 * rival);
		}
	}

	it("null: ratio 1.0 leaves the fundamental exactly where it was", () => {
		// Cosine starts nonzero, so arrival is sample 0 and a full-cycle
		// window is honest. Predicted null number, stated in advance, no
		// tolerance argument.
		const rendered = render(1.0, true);
		const measured = measureFundamental(rendered, {
			windowStart: 0,
			windowLength: 4800,
			sampleRate: 48_000,
		});
		expect(measured.arrivalSample).toBe(0);
		expect(measured.frequencyHz).toBe(220);
	});

	it("octave up: 2.0 reports 440, not 220 or 330", () => {
		expectDominant(render(2.0), 440, [110, 220, 330]);
	});

	it("octave down: 0.5 reports 110, not 220 or 330", () => {
		expectDominant(render(0.5), 110, [220, 330, 440]);
	});

	it("fifth up: 1.5 reports 330, not 220 or 440", () => {
		expectDominant(render(1.5), 330, [110, 220, 440]);
	});

	it("refuses a non-positive ratio at prepare, not at the first sample", () => {
		const runtime = new ReferenceRuntime(pitchProgram(0));
		expect(() => runtime.prepare(48_000)).toThrow(/finite and positive/);
	});

	it.skipIf(!wasmBinaryPresent)("agrees across consoles bit-exactly", async () => {
		// No libm in the resampling path (pointer arithmetic, one lerp), so
		// the two IEEE-754 implementations must agree bit for bit -- unlike
		// the smoothing/gain paths whose exp/pow may differ 1 ULP. One ratio
		// per wrap direction: 1.0 never wraps, 2.0 wraps back, 0.5 forward.
		for (const ratio of [1.0, 2.0, 0.5]) {
			const program = pitchProgram(ratio);
			const input = new Float64Array(12_000);
			for (let index = 0; index < input.length; index += 1) {
				input[index] =
					0.5 * Math.sin((2 * Math.PI * 220 * index) / 48_000);
			}
			const ts = new ReferenceRuntime(program);
			ts.prepare(48_000);
			const expected = ts.process(input);
			const engine = await V2WasmEngine.create(program);
			engine.prepare({ sampleRate: 48_000 });
			for (let index = 0; index < input.length; index += 1) {
				expect(engine.processSample(input[index] as number)).toBe(
					expected[index],
				);
			}
			engine.destroy();
		}
	});
});

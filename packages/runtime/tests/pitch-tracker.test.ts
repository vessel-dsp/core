// Pitch-tracker acceptance (board-p3 row 6): the estimator is graded
// against a reference with a tolerance, never pinned.
//
// Like the pitch-shift file, hand-built programs appear here: no compiler
// route produces `pitch-tracker` programs yet (no packet declares one), so
// the composition under test is assembled from a compiled fixture whose
// input shell drives the block's tap for real. The anti-vacuity design is
// the glide: a constant-output fake passes every static and the silence
// case, and only a tracker that follows a moving fundamental passes the
// glide -- so the glide, not the statics, is what licenses the primitive.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { fixtureRegistry } from "@vessel-dsp/compiler/fixtures/registry";
import { hybridDelayPedal } from "@vessel-dsp/compiler/fixtures/circuits";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime, trackPitchFundamental } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { wasmBinaryPresent } from "./wasm-presence";


const RATE = 48_000;
const WINDOW = 2048;

function sine(frequencyHz: number, samples: number): Float64Array {
	const out = new Float64Array(samples);
	for (let index = 0; index < samples; index += 1) {
		out[index] =
			0.5 * Math.sin((2 * Math.PI * frequencyHz * index) / RATE);
	}
	return out;
}

/** Pluck-like harmonic complex with exponential decay, analytic f0. */
function pluck(frequencyHz: number, samples: number): Float64Array {
	const out = new Float64Array(samples);
	for (let index = 0; index < samples; index += 1) {
		const t = index / RATE;
		let v = 0;
		for (let k = 1; k <= 5; k += 1) {
			v += Math.sin(2 * Math.PI * frequencyHz * k * t + 0.3 * k) / k;
		}
		out[index] = 0.3 * v * Math.exp(-1.5 * t);
	}
	return out;
}

/** Linear chirp 220 -> 440 over one second; f0(t) = 220 + 220t exactly. */
function glide(samples: number): { signal: Float64Array; f0At: (t: number) => number } {
	const out = new Float64Array(samples);
	for (let index = 0; index < samples; index += 1) {
		const t = index / RATE;
		out[index] = 0.5 * Math.sin(2 * Math.PI * (220 * t + 110 * t * t));
	}
	return { signal: out, f0At: (t: number) => 220 + 220 * t };
}

describe("trackPitchFundamental: the estimator without a program", () => {
	it("reads clean sines within half a percent", () => {
		for (const frequency of [82.4, 110, 220, 330, 440]) {
			const measured = trackPitchFundamental(sine(frequency, WINDOW), RATE);
			expect(Math.abs(measured - frequency) / frequency).toBeLessThan(0.005);
		}
	});

	it("reads harmonic complexes at the fundamental, not an octave", () => {
		// The loud failure: a peak-picker that prefers short lags reports
		// 440/880 here, a longest-lag picker 55/110. Both are 2x errors.
		for (const frequency of [110, 220]) {
			const measured = trackPitchFundamental(pluck(frequency, WINDOW), RATE);
			expect(Math.abs(measured - frequency) / frequency).toBeLessThan(0.015);
		}
	});

	it("reads silence and constants as no pitch, not a guess", () => {
		expect(trackPitchFundamental(new Float64Array(WINDOW), RATE)).toBe(0);
		expect(trackPitchFundamental(new Float64Array(WINDOW).fill(0.5), RATE)).toBe(0);
		expect(trackPitchFundamental(new Float64Array(WINDOW).fill(-3), RATE)).toBe(0);
	});

	it("reads a moving fundamental at its window mean", () => {
		const { signal } = glide(RATE);
		// Window ending at 0.75 s; f0 runs 375.6 -> 385 across it.
		const measured = trackPitchFundamental(
			signal.slice(36_000 - WINDOW, 36_000),
			RATE,
		);
		expect(Math.abs(measured - 380.3) / 380.3).toBeLessThan(0.015);
	});
});

describe("pitch-tracker primitive: reference-graded acceptance (row 6)", () => {
	function trackerProgram(): Program {
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
		const tracker = {
			kind: "composed",
			id: macro.id,
			modelId: "pitch-tracker",
			parameters: {},
			audioIn: macro.audioIn,
			audioOut: macro.audioOut,
			parameter: null,
			selector: null,
			positions: [
				{
					id: "default",
					ops: [{ op: "pitch-tracker", input: { kind: "input" }, out: 0 }],
					out: 0,
					lines: {},
				},
			],
		} as const;
		return {
			...program,
			requiredModels: program.requiredModels.map((model) =>
				model === macro.modelId ? "pitch-tracker" : model,
			),
			costPredictors: {
				...program.costPredictors,
				macroBlocks: program.costPredictors.macroBlocks.map((block) =>
					block.blockId === macro.id ? { ...block, modelId: "pitch-tracker" } : block,
				),
			},
			blocks: program.blocks.map((block) => (block === macro ? tracker : block)),
		} as Program;
	}

	function render(input: Float64Array): Float64Array {
		const runtime = new ReferenceRuntime(trackerProgram());
		runtime.prepare(RATE);
		return runtime.process(input);
	}

	/** Estimates are DC values through a near-unity shell: read the tail mean. */
	function tailMean(output: Float64Array, from = 40_000): number {
		let sum = 0;
		for (let index = from; index < output.length; index += 1) {
			sum += output[index] as number;
		}
		return sum / (output.length - from);
	}

	it("reports static fundamentals within two percent", () => {
		// Integration band, stated as one: the helper units above pin the
		// estimator itself sub-half-percent, but through a shell the reading
		// also carries the shell's near-unity DC gain (measured ~0.99 here --
		// dividing it out would be a back-solved multiplier of exactly the
		// kind the hybrid-gain tests forbid, so the band absorbs it instead).
		// Octave errors would miss by 2x either way.
		const means = new Map<number, number>();
		for (const frequency of [110, 220, 440]) {
			const mean = tailMean(render(sine(frequency, RATE)));
			means.set(frequency, mean);
			expect(Math.abs(mean - frequency) / frequency).toBeLessThan(0.02);
		}
		// Gain-invariant octave proof: ratios cancel the shell entirely.
		const r21 = (means.get(220) as number) / (means.get(110) as number);
		const r42 = (means.get(440) as number) / (means.get(220) as number);
		expect(Math.abs(r21 - 2) / 2).toBeLessThan(0.005);
		expect(Math.abs(r42 - 2) / 2).toBeLessThan(0.005);
	});

	it("reports a plucked complex at its fundamental", () => {
		// Wider than the statics: decayed harmonics add estimator bias on
		// top of the shell gain (measured -2.0% total: ~1% shell, ~1%
		// harmonic-phase bias at the helper level). An octave error would
		// still miss by 2x.
		const mean = tailMean(render(pluck(220, RATE)));
		expect(Math.abs(mean - 220) / 220).toBeLessThan(0.025);
	});

	it("follows a glide: the anti-vacuity case", () => {
		// A constant-output fake passes every static above and the silence
		// below. Only a tracker that follows a moving fundamental passes
		// here, so this test, not the statics, licenses the primitive.
		// Reference is the analytic f0 at window-center time; the estimator
		// looks backward, so late windows compare against earlier pitch.
		const { signal, f0At } = glide(RATE);
		const output = render(signal);
	 for (const t of [0.5, 0.65, 0.8, 0.95]) {
			const at = Math.floor(t * RATE);
			let sum = 0;
			const count = 2048;
			for (let index = at; index < at + count; index += 1) {
				sum += output[index] as number;
			}
			const mean = sum / count;
			const expected = f0At(t - 1024 / RATE);
			expect(Math.abs(mean - expected) / expected).toBeLessThan(0.025);
		}
	});

	it("reports silence as zero, never stale", () => {
		const output = render(new Float64Array(RATE));
		for (let index = 0; index < output.length; index += 1) {
			expect(output[index]).toBe(0);
		}
	});

	it.skipIf(!wasmBinaryPresent)("agrees across consoles bit-exactly", async () => {
		// Divisions and comparisons in identical order, no libm calls: the
		// two IEEE-754 implementations must agree bit for bit. Sine plus
		// glide cover static and moving estimates with hop updates firing.
		for (const input of [sine(220, 12_000), glide(12_000).signal]) {
			const program = trackerProgram();
			const ts = new ReferenceRuntime(program);
			ts.prepare(RATE);
			const expected = ts.process(input);
			const engine = await V2WasmEngine.create(program);
			engine.prepare({ sampleRate: RATE });
			for (let index = 0; index < input.length; index += 1) {
				expect(engine.processSample(input[index] as number)).toBe(
					expected[index],
				);
			}
			engine.destroy();
		}
	});
});

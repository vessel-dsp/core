// The op-amp stamp's `gainBandwidthHz` reaches the solver, on both consoles.
//
// The known answer is a non-inverting stage with exact resistors, whose closed loop under the engine's own
// pole law has a closed form (`beClosedLoopMagnitudeDb`): measured magnitude must match it, and the response
// must MOVE with the declared product by exactly the amount that form predicts. Nothing here is an ngspice
// number or a capture, and no assertion is a snapshot of what the engine happens to print.
//
// **What this proves and what it does not.** It proves the stamp field is read by the console and that the
// pole is computed from it. It does not prove accuracy: the pole is discretised with backward Euler, which
// is low against the continuous closed form (`closedLoopMagnitudeDb`) by about `w^2 tau dt`. That departure
// is a standing finding recorded in `docs/spikes/2026-10-10-opamp-gbw.md` and is deliberately not asserted
// away here.

import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { beClosedLoopMagnitudeDb, nonInvertingStage } from "./non-inverting-stage";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

const RATE = 48_000;
const OVERSAMPLE = 4;
const AMPLITUDE = 0.01;
const SETTLE_SECONDS = 0.04;
const WINDOW_SECONDS = 0.12;
/** Each case renders a few dozen short os4 captures; a loaded box needs more than bun's 5 s default. */
const CASE_TIMEOUT_MS = 120_000;
const FREQUENCIES = [1000, 4000, 10_000, 16_000];
const STAGES: ReadonlyArray<readonly [gain: number, rf: number, rg: number]> = [
	[10, 9000, 1000],
	[100, 99_000, 1000],
];
const PRODUCTS = [1e6, 3e6, 1e7];
/** (a-wire): measured against the engine's own discrete law. */
const WIRE_TOLERANCE_DB = 0.01;
/** The declared-value move: the 3 MHz minus 1 MHz difference against the same difference in the discrete law. */
const MOVE_TOLERANCE_DB = 0.02;

function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") throw new Error(`stage did not compile: ${JSON.stringify(result)}`);
	return result.program;
}

/** Least-squares fundamental amplitude (with a DC term) of a settled window at the host rate. */
function fundamental(output: ArrayLike<number>, hz: number): number {
	const n = output.length;
	const basis = (i: number) => [Math.cos((2 * Math.PI * hz * i) / RATE), Math.sin((2 * Math.PI * hz * i) / RATE), 1];
	const m = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	];
	const rhs = [0, 0, 0];
	for (let i = 0; i < n; i += 1) {
		const row = basis(i);
		for (let a = 0; a < 3; a += 1) {
			rhs[a] = (rhs[a] as number) + (row[a] as number) * (output[i] ?? 0);
			for (let b = 0; b < 3; b += 1) {
				(m[a] as number[])[b] = ((m[a] as number[])[b] as number) + (row[a] as number) * (row[b] as number);
			}
		}
	}
	// 3x3 Gaussian elimination.
	for (let i = 0; i < 3; i += 1) {
		for (let r = i + 1; r < 3; r += 1) {
			const f = ((m[r] as number[])[i] as number) / ((m[i] as number[])[i] as number);
			for (let c = i; c < 3; c += 1) {
				(m[r] as number[])[c] = ((m[r] as number[])[c] as number) - f * ((m[i] as number[])[c] as number);
			}
			rhs[r] = (rhs[r] as number) - f * (rhs[i] as number);
		}
	}
	const x = [0, 0, 0];
	for (let i = 2; i >= 0; i -= 1) {
		let t = rhs[i] as number;
		for (let c = i + 1; c < 3; c += 1) t -= ((m[i] as number[])[c] as number) * (x[c] as number);
		x[i] = t / ((m[i] as number[])[i] as number);
	}
	return Math.hypot(x[0] as number, x[1] as number);
}

function stimulus(hz: number): Float64Array {
	const length = Math.round(RATE * (SETTLE_SECONDS + WINDOW_SECONDS));
	const input = new Float64Array(length);
	for (let i = 0; i < length; i += 1) input[i] = AMPLITUDE * Math.sin((2 * Math.PI * hz * i) / RATE);
	return input;
}

function renderTs(program: Program, input: Float64Array): Float64Array {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(RATE, { oversample: OVERSAMPLE });
	return runtime.process(input);
}
async function renderWasm(program: Program, input: Float64Array): Promise<Float64Array> {
	const engine = await V2WasmEngine.create(program);
	engine.prepare({ sampleRate: RATE, oversample: OVERSAMPLE });
	const out = new Float64Array(input.length);
	for (let i = 0; i < input.length; i += 1) out[i] = engine.processSample(input[i] ?? 0);
	engine.destroy();
	return out;
}

type Render = (program: Program, input: Float64Array) => Promise<Float64Array> | Float64Array;

function measuredDb(program: Program, hz: number, render: Render): Promise<number> {
	return Promise.resolve(render(program, stimulus(hz))).then((out) => {
		const window = out.subarray(Math.round(RATE * SETTLE_SECONDS));
		return 20 * Math.log10(fundamental(window, hz) / AMPLITUDE);
	});
}

const expectedDb = (gain: number, product: number, hz: number) =>
	beClosedLoopMagnitudeDb(gain, product, hz, RATE * OVERSAMPLE);

function suite(name: string, render: Render, skip: boolean, reason = "") {
	describe.skipIf(skip)(`${name}: the declared gain-bandwidth product reaches the solver${reason ? ` (${reason})` : ""}`, () => {
		it("renders every stage at every declared product within 0.01 dB of the engine's own pole law", async () => {
			for (const [gain, rf, rg] of STAGES) {
				for (const product of PRODUCTS) {
					const program = programFor(nonInvertingStage({ rfOhms: rf, rgOhms: rg, gbp: `${product} Hz` }));
					for (const hz of FREQUENCIES) {
						const error = (await measuredDb(program, hz, render)) - expectedDb(gain, product, hz);
						expect(Math.abs(error)).toBeLessThan(WIRE_TOLERANCE_DB);
					}
				}
			}
		}, CASE_TIMEOUT_MS);

		it("moves with the declared product by the amount the pole law predicts", async () => {
			for (const [gain, rf, rg] of STAGES) {
				const at = async (product: number, hz: number) =>
					measuredDb(programFor(nonInvertingStage({ rfOhms: rf, rgOhms: rg, gbp: `${product} Hz` })), hz, render);
				for (const hz of FREQUENCIES) {
					const measuredMove = (await at(3e6, hz)) - (await at(1e6, hz));
					const predictedMove = expectedDb(gain, 3e6, hz) - expectedDb(gain, 1e6, hz);
					expect(Math.abs(measuredMove - predictedMove)).toBeLessThan(MOVE_TOLERANCE_DB);
				}
			}
			// And the move is real, not zero: a gain-100 stage's closed-loop corner is GBP / 100, so tripling the
			// product lifts it by well over 1 dB at 10 kHz.
			const at = async (product: number) =>
				measuredDb(programFor(nonInvertingStage({ rfOhms: 99_000, rgOhms: 1000, gbp: `${product} Hz` })), 10_000, render);
			expect((await at(3e6)) - (await at(1e6))).toBeGreaterThan(1.5);
		}, CASE_TIMEOUT_MS);

		it("renders a null product exactly as a declared 1 MHz: the default is the value, not a second behaviour", async () => {
			const bare = programFor(nonInvertingStage({ rfOhms: 99_000, rgOhms: 1000 }));
			const declared = programFor(nonInvertingStage({ rfOhms: 99_000, rgOhms: 1000, gbp: "1 MHz" }));
			for (const hz of [1000, 10_000]) {
				const a = await render(bare, stimulus(hz));
				const b = await render(declared, stimulus(hz));
				expect(Array.from(a)).toEqual(Array.from(b));
			}
		}, CASE_TIMEOUT_MS);

		it("reads a program compiled before the field existed as null", async () => {
			const bare = programFor(nonInvertingStage({ rfOhms: 99_000, rgOhms: 1000 }));
			const stale: Program = {
				...bare,
				blocks: bare.blocks.map((block) =>
					block.kind === "mna"
						? {
								...block,
								stamps: block.stamps.map((stamp) => {
									if (stamp.kind !== "ideal-opamp") return stamp;
									const { gainBandwidthHz: _removed, ...rest } = stamp;
									return rest as typeof stamp;
								}),
							}
						: block,
				),
			};
			const a = await render(bare, stimulus(10_000));
			const b = await render(stale, stimulus(10_000));
			expect(Array.from(a)).toEqual(Array.from(b));
		}, CASE_TIMEOUT_MS);
	});
}

suite("TS console", renderTs, false);
suite("WASM console", renderWasm, !wasmBinaryPresent, WASM_SKIP_REASON);

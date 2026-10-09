// Cross-console parity for the sparse path: `ReferenceRuntime` (TypeScript)
// and `V2WasmEngine` (C++/WASM) must render the same audio from the same
// program and report the same schedule behaviour.
//
// Instrument: `rcLadder(30)` -- large enough to clear the schedule admission
// floor, linear (so Newton cannot hide a solve difference), rendered 2048
// samples of 1 kHz at 0.1. Verdict: relative RMS between the consoles over
// [0, 2048) below 1e-5 (f32 worklet I/O rounding is ~1e-7; the bar sits 100x
// above it), identical schedule-solve counts, zero fallbacks and zero
// abandonments on both. Controls: forcing the program dense on the TypeScript
// side must reproduce the same render to rounding (the ladder is linear, so
// the schedule is exact, not an approximation) -- agreement is not two
// silences. What it cannot prove: any nonlinear packet -- corpus identity is
// covered by `docs/spikes/sparse-pivot/cpp-compare.ts`, not here.
//
// Skips BY NAME when the compiled artifact is absent (`wasm-presence.ts`).
import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { rcLadder } from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { wasmBinaryPresent, WASM_SKIP_REASON } from "./wasm-presence";

const SR = 48000;
const N = 2048;

function tone(): Float64Array {
	const out = new Float64Array(N);
	for (let i = 0; i < N; i += 1) {
		out[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / SR);
	}
	return out;
}

function compileLadder(): Program {
	const result = compile(rcLadder(30), { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`ladder fixture should compile: ${result.status}`);
	}
	return result.program;
}

function relRms(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let diff2 = 0;
	let b2 = 0;
	for (let i = 0; i < a.length; i += 1) {
		const d = (a[i] as number) - (b[i] as number);
		diff2 += d * d;
		b2 += (b[i] as number) ** 2;
	}
	return Math.sqrt(diff2 / a.length) / Math.max(Math.sqrt(b2 / a.length), 1e-12);
}

describe.skipIf(!wasmBinaryPresent)(
	`sparse schedule cross-console parity${wasmBinaryPresent ? "" : ` (${WASM_SKIP_REASON})`}`,
	() => {
		it("renders the same audio with the same schedule behaviour", async () => {
			const program = compileLadder();
			const input = tone();

			const ts = new ReferenceRuntime(structuredClone(program));
			ts.prepare(SR, { maxNewtonIterations: 64 });
			const tsOut = ts.process(input);
			const tsPlan = ts.solverPlan();

			const engine = await V2WasmEngine.create(structuredClone(program));
			try {
				engine.prepare({ sampleRate: SR, maxNewtonIterations: 64 });
				const cppIn = Float32Array.from(input);
				const cppOut = new Float32Array(N);
				engine.processBlock(cppIn, cppOut);
				const tele = engine.getScheduleTelemetry();

				expect(relRms(cppOut, tsOut)).toBeLessThan(1e-5);
				expect(tele.fallbacks).toBe(0);
				expect(tele.abandonedBlocks).toBe(0);
				expect(tele.solves).toBe(tsPlan.scheduleSolves);
				expect(tsPlan.scheduleFallbacks).toBe(0);
			} finally {
				engine.destroy();
			}
		});

		it("matches forced-dense on a linear ladder (control: the schedule is exact)", async () => {
			const program = compileLadder();
			const input = tone();
			const nulled = structuredClone(program);
			for (const block of nulled.blocks) {
				if (block.kind === "mna") {
					(block as { sparseSchedule: null }).sparseSchedule = null;
				}
			}
			const dense = new ReferenceRuntime(nulled);
			dense.prepare(SR, { maxNewtonIterations: 64 });
			const denseOut = dense.process(input);

			const engine = await V2WasmEngine.create(structuredClone(program));
			try {
				engine.prepare({ sampleRate: SR, maxNewtonIterations: 64 });
				const cppOut = new Float32Array(N);
				engine.processBlock(Float32Array.from(input), cppOut);
				// A linear ladder's schedule is exact: sparse must equal dense
				// to rounding on both consoles, or agreement above is vacuous.
				expect(relRms(cppOut, denseOut)).toBeLessThan(1e-5);
			} finally {
				engine.destroy();
			}
		});
	},
);

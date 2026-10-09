// The Newton start predictor on the C++/WASM console (`Engine::recordNewtonSolution`), ported
// from `ReferenceRuntime` (`newtonStartHistory`): the decision -- which extrapolation order
// seeds the next solve -- must be the reference's decision, sample for sample, and the
// counters that make the saving attributable must read the same on both consoles. Every
// test needs the compiled console, so the suite skips by name when `src/wasm/` is absent.
import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { diodeClipper, resistorDivider } from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

const RATE = 48_000;
function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") throw new Error(`fixture no longer compiles: ${JSON.stringify(result)}`);
	return result.program;
}
/** The clipper with its lower diode replaced by a 100 nF shunt: an RC that still carries a diode. */
const rcWithDiode = diodeClipper.replace(
	/ {2}- id: D2[\s\S]*?Description: "Clipping diode\."\n(?=wires)/,
	`  - id: C1
    kind: capacitor
    name: C_SHUNT
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: -20
      - name: b
        node: 0
        position:
          x: 120
          y: 20
    properties:
      Capacitance: "100n"
      Description: "Shunt."
`,
);
if (rcWithDiode === diodeClipper) throw new Error("fixture derivation matched nothing");

type Internals = {
	newtonStartHistory: Map<string, { order: number }>;
	predictedNewtonStart: (blockId: string, size: number) => number[] | null;
	recordNewtonSolution: (blockId: string, solution: readonly number[], converged: boolean, used: number) => void;
};

/**
 * Drive both consoles one host sample at a time and compare, after every sample, the
 * per-block order, the cumulative seeds, one-iteration solves and total iterations. The
 * reference is counted by wrapping its private methods on the instance (no runtime change).
 */
async function lockstep(program: Program, os: number, input: (index: number) => number, samples: number, cap = 1024) {
	const rt = new ReferenceRuntime(program);
	rt.prepare(RATE, { maxNewtonIterations: cap, ...(os > 1 ? { oversample: os } : {}) });
	const internals = rt as unknown as Internals;
	let tsSeeds = 0;
	let tsOne = 0;
	const origPredict = internals.predictedNewtonStart;
	const origRecord = internals.recordNewtonSolution;
	internals.predictedNewtonStart = function (blockId: string, size: number) {
		const r = origPredict.call(this, blockId, size);
		if (r !== null) tsSeeds += 1;
		return r;
	};
	internals.recordNewtonSolution = function (blockId, solution, converged, used) {
		if (used === 1) tsOne += 1;
		return origRecord.call(this, blockId, solution, converged, used);
	};
	const eng = await V2WasmEngine.create(program);
	eng.prepare({ sampleRate: RATE, maxNewtonIterations: cap, ...(os > 1 ? { oversample: os } : {}) });
	const mna = program.blocks.map((b, i) => ({ id: b.id, i })).filter((_, i) => program.blocks[i]?.kind === "mna");
	const chunk = new Float64Array(1);
	const fin = new Float32Array(1);
	const fout = new Float32Array(1);
	// Per host sample: the order per block and the per-sample DELTA of each counter. The
	// decision (order, seeds) is the predictor's and must agree exactly; the iteration count of
	// a solve can differ by one on a knife-edge sample because the two consoles' stamps differ
	// at libm level (the pre-predictor consoles already disagree on 6 of 4800 gro100 samples
	// at x1), so those are reported separately and bounded, not required exact.
	let orderMismatches = 0;
	let seedMismatches = 0;
	let countMismatches = 0;
	let orderWithoutCount = 0;
	let first = "";
	let maxDelta = 0;
	let pSeeds = 0;
	let pOne = 0;
	let pIt = 0;
	let pwSeeds = 0;
	let pwOne = 0;
	let pwIt = 0;
	for (let index = 0; index < samples; index += 1) {
		// The console takes float32 input; the reference is fed the same rounded value, so
		// both decide from identical inputs (a 6e-8 input difference is enough to flip a
		// near-tied order score on the symmetric clipper).
		fin[0] = input(index);
		chunk[0] = fin[0] as number;
		const ts = rt.process(chunk)[0] as number;
		eng.processBlock(fin, fout);
		maxDelta = Math.max(maxDelta, Math.abs(ts - (fout[0] as number)));
		const tel = eng.getPredictorTelemetry();
		const tsIt = rt.telemetry().totalIterations;
		let bad = "";
		for (const { id, i } of mna) {
			const to = internals.newtonStartHistory.get(id)?.order ?? 0;
			const wo = eng.getPredictorOrder(i);
			if (to !== wo) {
				orderMismatches += 1;
				if (bad === "") bad = `order of ${id}: TS ${to}, WASM ${wo}`;
			}
		}
		if (tsSeeds - pSeeds !== tel.seedsUsed - pwSeeds) {
			seedMismatches += 1;
			if (bad === "") bad = `seeds this sample: TS ${tsSeeds - pSeeds}, WASM ${tel.seedsUsed - pwSeeds}`;
		}
		if (tsOne - pOne !== tel.oneIterationSolves - pwOne || tsIt - pIt !== tel.totalIterations - pwIt) {
			countMismatches += 1;
			if (bad === "") bad = `counts this sample: one-iteration TS ${tsOne - pOne} / WASM ${tel.oneIterationSolves - pwOne}, iterations TS ${tsIt - pIt} / WASM ${tel.totalIterations - pwIt}`;
		}
		pSeeds = tsSeeds;
		pOne = tsOne;
		pIt = tsIt;
		pwSeeds = tel.seedsUsed;
		pwOne = tel.oneIterationSolves;
		pwIt = tel.totalIterations;
		if (bad !== "" && first === "") first = `sample ${index}: ${bad}`;
		if (bad.startsWith("order") && !(tsOne - pOne !== tel.oneIterationSolves - pwOne || tsIt - pIt !== tel.totalIterations - pwIt)) orderWithoutCount += 1;
	}
	const result = { orderMismatches, seedMismatches, countMismatches, orderWithoutCount, first, maxDelta, seeds: tsSeeds, one: tsOne, iterations: rt.telemetry().totalIterations, wasm: eng.getPredictorTelemetry(), orders: mna.map(({ i }) => eng.getPredictorOrder(i)) };
	eng.destroy();
	return result;
}

describe.skipIf(!wasmBinaryPresent)(`V2WasmEngine Newton start predictor${WASM_SKIP_REASON ? ` (${WASM_SKIP_REASON})` : ""}`, () => {
	it("decides the same order as the reference, sample for sample, and counts the same (smooth signal at 4x)", async () => {
		const program = programFor(rcWithDiode);
		const sine = (index: number) => 0.01 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const r = await lockstep(program, 4, sine, 1440);
		expect(r.orderMismatches).toBe(0);
		expect(r.seedMismatches).toBe(0);
		expect(r.countMismatches).toBe(0);
		// The predictor is actually working on this signal: the quadratic order, nearly
		// every sub-sample seeded and solved in one iteration.
		expect(r.orders).toEqual([2]);
		expect(r.wasm.seedsUsed).toBeGreaterThan(1440 * 4 * 0.9);
		expect(r.wasm.oneIterationSolves).toBeGreaterThan(1440 * 4 * 0.9);
		expect(r.wasm.totalIterations).toBe(r.iterations);
		// Output parity within the public-surface bar (float32 transport).
		expect(r.maxDelta).toBeLessThan(1e-6);
	});

	it("decides the same order on a clipping signal at x1, where the gate and the tie rule do the work", async () => {
		const program = programFor(diodeClipper);
		const square = (index: number) => (Math.floor(index / 24) % 2 === 0 ? 1 : -1);
		const r = await lockstep(program, 1, square, 960);
		expect(r.orderMismatches).toBe(0);
		expect(r.seedMismatches).toBe(0);
		expect(r.countMismatches).toBe(0);
		// A hard square never predicts once settled (every order ties on the plateau, the
		// edge sample scores worse): the few seeds are the start-up transient, the same count
		// on both consoles, and the ring ends at order 0.
		expect(r.wasm.seedsUsed).toBe(r.seeds);
		expect(r.wasm.seedsUsed).toBeLessThan(20);
		expect(r.orders).toEqual([0]);
		const sine = (index: number) => 0.5 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const c = await lockstep(program, 1, sine, 1440);
		// Clipping at x1: on a few samples the solve itself sits on the convergence knife
		// edge and the consoles' libm-level stamp differences decide it differently (a 2- vs
		// 3-iteration solve). The predictor's gate reads that count, so its decision follows
		// the solve on exactly those samples -- never on its own: an order difference without
		// an iteration-count difference at the same sample would be a port defect.
		expect(c.orderWithoutCount).toBe(0);
		expect(c.orderMismatches).toBeLessThanOrEqual(c.countMismatches);
		expect(c.seedMismatches).toBeLessThanOrEqual(c.countMismatches + c.orderMismatches);
		expect(c.countMismatches).toBeLessThan(1440 * 0.05);
		expect(c.maxDelta).toBeLessThan(1e-6);
	});

	it("leaves a linear block untouched: no seeds, no one-iteration count, output unchanged", async () => {
		const program = programFor(resistorDivider);
		const sine = (index: number) => 0.5 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const r = await lockstep(program, 1, sine, 480);
		expect(r.orderMismatches).toBe(0);
		expect(r.seedMismatches).toBe(0);
		expect(r.countMismatches).toBe(0);
		expect(r.wasm.seedsUsed).toBe(0);
		expect(r.wasm.oneIterationSolves).toBe(0);
		// Float32 transport bounds this (0.5 V peak: one ULP is 6e-8), not the solver.
		expect(r.maxDelta).toBeLessThan(1e-6);
	});

	it("clears the ring on reset() and prepare(): render, reset, render agree bit for bit", async () => {
		const program = programFor(rcWithDiode);
		const input = new Float32Array(2400);
		for (let index = 0; index < input.length; index += 1) input[index] = 0.01 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		for (const os of [1, 4]) {
			const eng = await V2WasmEngine.create(program);
			eng.prepare({ sampleRate: RATE, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
			const a = new Float32Array(input.length);
			eng.processBlock(input, a);
			const seeded = eng.getPredictorTelemetry().seedsUsed;
			expect(seeded).toBeGreaterThan(0);
			eng.reset();
			expect(eng.getPredictorTelemetry().seedsUsed).toBe(0);
			expect(eng.getPredictorOrder(0)).toBe(0);
			const b = new Float32Array(input.length);
			eng.processBlock(input, b);
			expect(Array.from(b)).toEqual(Array.from(a));
			eng.prepare({ sampleRate: RATE, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
			expect(eng.getPredictorOrder(0)).toBe(0);
			const c = new Float32Array(input.length);
			eng.processBlock(input, c);
			expect(Array.from(c)).toEqual(Array.from(a));
			eng.destroy();
		}
	});
});

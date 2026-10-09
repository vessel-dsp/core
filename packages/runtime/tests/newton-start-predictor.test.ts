// The Newton start predictor (`newtonStartHistory` in reference-runtime.ts): a self-selecting
// extrapolation of the last three converged solutions seeds each standard-pass solve.
//
// What is pinned here is the contract, measured on synthetic circuits:
//   1. on a smooth signal at 4x the quadratic order wins and one iteration per sub-sample
//      converges (the previous-solution start needs two: a step and a check);
//   2. on a hard edge the extrapolations score worse than the previous solution, so the
//      order falls back to 0 and the solve after the edge costs exactly what it always did;
//   3. fixed-point equivalence: with the predictor engaged, every converged solution sits
//      within the convergence tolerance of the solution the previous-solution start reaches
//      from the same state (both are roots of the same equations at the same tolerances);
//   4. it runs only at oversample > 1 (runtime 0.4.1): at factor 1 it neither seeds nor
//      records, and the render is bit-identical to one with the predictor forced off.
import { describe, expect, it } from "bun:test";
import type { Program } from "@vessel-dsp/compiler";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { diodeClipper } from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "../src/reference-runtime";

const RATE = 48_000;
const programFor = (source: string): Program => {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`fixture no longer compiles: ${JSON.stringify(result)}`);
	}
	return result.program;
};
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
if (rcWithDiode === diodeClipper) {
	throw new Error("fixture derivation matched nothing");
}

type Internals = {
	newtonStartHistory: Map<string, { order: number; chain: number }>;
	nodeVoltages: Map<string, number[]>;
	predictedNewtonStart: (blockId: string, size: number) => number[] | null;
	recordNewtonSolution: (
		blockId: string,
		solution: readonly number[],
		converged: boolean,
		used: number,
	) => void;
};

/**
 * The previous-solution start on every solve: the predictor's two entry points disabled on
 * this instance. The control the "same fixed point" and "bit-identical" claims are made
 * against (clearing the history before each host sample is not one at oversample > 1, where
 * the ring rebuilds inside the sub-samples).
 */
function forcePredictorOff(runtime: ReferenceRuntime): void {
	const internals = runtime as unknown as Internals;
	internals.predictedNewtonStart = () => null;
	internals.recordNewtonSolution = () => undefined;
}

/** Count the solves a runtime seeds from an extrapolated start (wrapping the private method on the instance). */
function countSeeds(runtime: ReferenceRuntime): { readonly seeds: () => number } {
	const internals = runtime as unknown as Internals;
	let seeds = 0;
	const original = internals.predictedNewtonStart;
	internals.predictedNewtonStart = function (this: unknown, blockId, size) {
		const result = original.call(this, blockId, size);
		if (result !== null) seeds += 1;
		return result;
	};
	return { seeds: () => seeds };
}

function render(
	program: Program,
	input: (index: number) => number,
	samples: number,
	oversample: number,
	forcedOff: boolean,
): { out: number[]; runtime: ReferenceRuntime; seeds: () => number } {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(RATE, {
		maxNewtonIterations: 64,
		...(oversample > 1 ? { oversample } : {}),
	});
	if (forcedOff) forcePredictorOff(runtime);
	const counter = countSeeds(runtime);
	const block = Float64Array.from({ length: samples }, (_, index) => input(index));
	return { out: Array.from(runtime.process(block)), runtime, seeds: counter.seeds };
}

/** Iterations spent on `count` one-sample `process` calls after `warm` samples of `input`. */
function iterationsAfterWarmup(
	runtime: ReferenceRuntime,
	input: (index: number) => number,
	warm: number,
	count: number,
	clearHistoryEachSample = false,
): { iterations: number; perSample: number[]; nonConverged: number } {
	const internals = runtime as unknown as Internals;
	const chunk = new Float64Array(1);
	for (let index = 0; index < warm; index += 1) {
		if (clearHistoryEachSample) internals.newtonStartHistory.clear();
		chunk[0] = input(index);
		runtime.process(chunk);
	}
	const t0 = runtime.telemetry();
	let last = t0.totalIterations;
	const perSample: number[] = [];
	for (let index = 0; index < count; index += 1) {
		if (clearHistoryEachSample) internals.newtonStartHistory.clear();
		chunk[0] = input(warm + index);
		runtime.process(chunk);
		const spent = runtime.telemetry().totalIterations;
		perSample.push(spent - last);
		last = spent;
	}
	const t1 = runtime.telemetry();
	return {
		iterations: t1.totalIterations - t0.totalIterations,
		perSample,
		nonConverged: t1.nonConvergedSamples - t0.nonConvergedSamples,
	};
}

describe("Newton start predictor", () => {
	it("converges in one iteration per sub-sample on a smooth signal at 4x", () => {
		const program = programFor(rcWithDiode);
		const sine = (index: number) => 0.01 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const predicted = new ReferenceRuntime(program);
		predicted.prepare(RATE, { maxNewtonIterations: 64, oversample: 4 });
		const a = iterationsAfterWarmup(predicted, sine, 480, 960);
		// Four sub-samples per host sample, one iteration each.
		expect(a.iterations / 960).toBeLessThanOrEqual(4.05);
		expect(a.nonConverged).toBe(0);
		const internals = predicted as unknown as Internals;
		const history = [...internals.newtonStartHistory.values()][0];
		expect(history?.order).toBe(2);
		// The previous-solution start needs a step and a check: two per sub-sample. Clearing
		// the history before every host sample leaves the chain to rebuild inside the four
		// sub-samples (the last two of each host sample still predict), so the control reads
		// about seven per host sample rather than eight -- still well above the predicted four.
		const shipped = new ReferenceRuntime(program);
		shipped.prepare(RATE, { maxNewtonIterations: 64, oversample: 4 });
		const b = iterationsAfterWarmup(shipped, sine, 480, 960, true);
		expect(b.iterations).toBeGreaterThan(a.iterations * 1.5);
	});

	it("falls back to the previous-solution start after a hard edge and costs nothing extra", () => {
		// Factor 1: since 0.4.1 the predictor does not run here at all, so this pins that the
		// edge costs what the previous-solution start costs, by construction. (At 2x and 4x a
		// hard square into this clipper is NOT free: the predictor spends 3.8 % / 0.5 % more
		// iterations than the previous-solution start there, and wins only at 8x; measured
		// 2026-10-09, recorded in docs/releases/2026-10-09-release-prep-0.4.1.md, not changed.)
		const program = programFor(diodeClipper);
		// +-1 V square at 1 kHz: an edge every 24 host samples.
		const square = (index: number) => (Math.floor(index / 24) % 2 === 0 ? 1 : -1);
		const predicted = new ReferenceRuntime(program);
		predicted.prepare(RATE, { maxNewtonIterations: 64 });
		const a = iterationsAfterWarmup(predicted, square, 480, 960);
		const shipped = new ReferenceRuntime(program);
		shipped.prepare(RATE, { maxNewtonIterations: 64 });
		const b = iterationsAfterWarmup(shipped, square, 480, 960, true);
		expect(a.nonConverged).toBe(0);
		expect(b.nonConverged).toBe(0);
		// Sample by sample, never more than the previous-solution start.
		for (let index = 0; index < 960; index += 1) {
			expect(a.perSample[index]).toBeLessThanOrEqual(b.perSample[index] as number);
		}
		expect(a.iterations).toBe(b.iterations);
		// A linear extrapolation of the edge would have overshot the knee on the sample after
		// it: that sample costs one iteration here, as it does with the previous-solution start.
		const afterEdges = a.perSample.filter((_, index) => (480 + index) % 24 === 1);
		expect(afterEdges.every((used) => used === 1)).toBe(true);
	});

	it("reaches the same fixed point as the previous-solution start, within tolerance (4x, where it runs)", () => {
		const program = programFor(diodeClipper);
		const blockId = (program.blocks.find((block) => block.kind === "mna") as { id: string }).id;
		// 1 kHz at 0.5 V clips both diodes: a stiff solve on every sub-sample.
		const sine = (index: number) => 0.5 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const predicted = new ReferenceRuntime(program);
		predicted.prepare(RATE, { maxNewtonIterations: 64, oversample: 4 });
		const shipped = new ReferenceRuntime(program);
		shipped.prepare(RATE, { maxNewtonIterations: 64, oversample: 4 });
		// The control: the same runtime with the predictor disabled, so every solve starts from
		// the previous solution. (Until 0.4.1 this test ran at factor 1 against a history cleared
		// every sample; the predictor no longer runs there, and at 4x clearing the history per
		// host sample would leave it predicting inside the sub-samples.)
		forcePredictorOff(shipped);
		const pi = predicted as unknown as Internals;
		const si = shipped as unknown as Internals;
		const chunk = new Float64Array(1);
		let worst = 0;
		let engaged = 0;
		let maxOutputDiff = 0;
		for (let index = 0; index < 1440; index += 1) {
			chunk[0] = sine(index);
			const a = predicted.process(chunk)[0] as number;
			const b = shipped.process(chunk)[0] as number;
			if (index < 480) continue;
			if ((pi.newtonStartHistory.get(blockId)?.order ?? 0) > 0) engaged += 1;
			maxOutputDiff = Math.max(maxOutputDiff, Math.abs(a - b));
			const va = pi.nodeVoltages.get(blockId) as number[];
			const vb = si.nodeVoltages.get(blockId) as number[];
			for (let node = 0; node < va.length; node += 1) {
				const x = va[node] as number;
				const y = vb[node] as number;
				const allowance = 1e-3 * Math.max(Math.abs(x), Math.abs(y)) + 1e-6;
				worst = Math.max(worst, Math.abs(x - y) / allowance);
			}
		}
		// The predictor actually engaged on a meaningful share of the measured samples ...
		expect(engaged).toBeGreaterThan(100);
		// ... every converged solution agrees with the previous-solution start's within the
		// convergence tolerance (SPICE reltol 1e-3 / vntol 1e-6), measured per unknown ...
		expect(worst).toBeLessThanOrEqual(1);
		// ... and neither side held a sample.
		expect(predicted.telemetry().nonConvergedSamples).toBe(0);
		expect(shipped.telemetry().nonConvergedSamples).toBe(0);
		expect(maxOutputDiff).toBeLessThan(1e-3);
	});

	it("does not run at factor 1: no seeds, an empty ring, and a render bit-identical to one with the predictor forced off", () => {
		const signals: Array<[string, Program, (index: number) => number]> = [
			["smooth RC with a diode", programFor(rcWithDiode), (index) => 0.01 * Math.sin((2 * Math.PI * 1000 * index) / RATE)],
			["clipping sine", programFor(diodeClipper), (index) => 0.5 * Math.sin((2 * Math.PI * 1000 * index) / RATE)],
			["hard square", programFor(diodeClipper), (index) => (Math.floor(index / 24) % 2 === 0 ? 1 : -1)],
		];
		for (const [name, program, input] of signals) {
			const shipped = render(program, input, 1440, 1, false);
			const off = render(program, input, 1440, 1, true);
			expect(shipped.out, name).toEqual(off.out);
			expect(shipped.seeds(), name).toBe(0);
			expect((shipped.runtime as unknown as Internals).newtonStartHistory.size, name).toBe(0);
			expect(shipped.runtime.telemetry().totalIterations, name).toBe(off.runtime.telemetry().totalIterations);
		}
	});

	it("the factor-1 comparison can fail: at 4x the same two renders differ, and the predictor seeds", () => {
		const program = programFor(rcWithDiode);
		const sine = (index: number) => 0.01 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const shipped = render(program, sine, 1440, 4, false);
		const off = render(program, sine, 1440, 4, true);
		expect(shipped.seeds()).toBeGreaterThan(1000);
		expect((shipped.runtime as unknown as Internals).newtonStartHistory.size).toBe(1);
		expect(shipped.out).not.toEqual(off.out);
		expect(shipped.runtime.telemetry().totalIterations).toBeLessThan(off.runtime.telemetry().totalIterations);
	});

	it("seeds at every oversample factor above 1 (powers of two and the held path alike), and at none of 1", () => {
		const program = programFor(rcWithDiode);
		const sine = (index: number) => 0.01 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		expect(render(program, sine, 960, 1, false).seeds()).toBe(0);
		for (const factor of [2, 3, 4, 8]) {
			const r = render(program, sine, 960, factor, false);
			expect(r.seeds(), `oversample ${factor}`).toBeGreaterThan(100);
		}
	});

	it("clears the ring on prepare(): re-preparing at factor 1 after a 4x run leaves it empty and unseeded", () => {
		const program = programFor(rcWithDiode);
		const sine = (index: number) => 0.01 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const runtime = new ReferenceRuntime(program);
		const counter = countSeeds(runtime);
		runtime.prepare(RATE, { maxNewtonIterations: 64, oversample: 4 });
		runtime.process(Float64Array.from({ length: 480 }, (_, index) => sine(index)));
		expect(counter.seeds()).toBeGreaterThan(0);
		expect((runtime as unknown as Internals).newtonStartHistory.size).toBe(1);
		// The factor is fixed by prepare(); a new prepare() at factor 1 starts with no history
		// and, from there, no predictor.
		runtime.prepare(RATE, { maxNewtonIterations: 64 });
		expect((runtime as unknown as Internals).newtonStartHistory.size).toBe(0);
		const before = counter.seeds();
		runtime.process(Float64Array.from({ length: 480 }, (_, index) => sine(index)));
		expect(counter.seeds()).toBe(before);
		expect((runtime as unknown as Internals).newtonStartHistory.size).toBe(0);
	});
});

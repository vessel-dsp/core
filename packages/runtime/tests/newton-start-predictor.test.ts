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
//      from the same state (both are roots of the same equations at the same tolerances).
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
};

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

	it("reaches the same fixed point as the previous-solution start, within tolerance", () => {
		const program = programFor(diodeClipper);
		const blockId = (program.blocks.find((block) => block.kind === "mna") as { id: string }).id;
		// 1 kHz at 0.5 V clips both diodes: a stiff solve on every sample.
		const sine = (index: number) => 0.5 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		const predicted = new ReferenceRuntime(program);
		predicted.prepare(RATE, { maxNewtonIterations: 64 });
		const shipped = new ReferenceRuntime(program);
		shipped.prepare(RATE, { maxNewtonIterations: 64 });
		const pi = predicted as unknown as Internals;
		const si = shipped as unknown as Internals;
		const chunk = new Float64Array(1);
		let worst = 0;
		let engaged = 0;
		let maxOutputDiff = 0;
		for (let index = 0; index < 1440; index += 1) {
			chunk[0] = sine(index);
			const a = predicted.process(chunk)[0] as number;
			si.newtonStartHistory.clear();
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
});

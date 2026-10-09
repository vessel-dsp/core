// OP-matrix diagnostics per tau: for each packet x tau, build the numeric
// candidate from the operating-point matrix, swap it in as the shipped order,
// run settle (empty process), and report the plan row's OP disagreement,
// worst pivot ratio, violations, and adopt/drop verdict. No audio renders.
//
// Usage:
//   bun docs/spikes/sparse-pivot/op-diagnostic.ts --packet=boss-hm-2 [--amps]
//       [--taus=0.3,0.1,0.03,0.01,0.003,0.001,0.0003,0.0001]
import { computeNumericRepivot } from "@vessel-dsp/compiler";
import type { SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, loadProgram, type Program } from "./lib";

const only = arg("packet", "boss-hm-2").split(",").map((s) => s.trim());
const TAUS = arg("taus", "0.3,0.1,0.03,0.01,0.003,0.001,0.0003,0.0001").split(",").map(Number);
const AMPS = process.argv.includes("--amps");
const MIN_SIZE = Number(arg("min-size", "30"));

for (const packet of only) {
	const program = loadProgram(packet, AMPS) as Program & {
		blocks: { kind: string; id: string; nodeCount: number; auxCount: number; sparseSchedule: SparseSchedule | null }[];
	};
	// Settled twin: shipped verdict + matrix source.
	const probe = new ReferenceRuntime(structuredClone(program));
	probe.prepare(48000, { maxNewtonIterations: 64 });
	probe.process(new Float64Array(0));
	const settled = probe.solverPlan();
	const internals = probe as unknown as {
		assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
		blocksById: Map<string, unknown>;
	};
	for (const block of program.blocks) {
		if (block.kind !== "mna" || block.sparseSchedule === null) continue;
		const size = block.nodeCount + block.auxCount;
		if (size < MIN_SIZE) continue;
		const shipped = block.sparseSchedule;
		const row = settled.blocks.find((b) => b.blockId === block.id);
		console.log(
			`${packet} [${block.id} n=${size}] shipped opDis=${row?.pivotDisagreement?.toExponential(1)} ` +
				`worst=${typeof row?.worstPivotRatio === "number" ? row.worstPivotRatio.toExponential(1) : row?.worstPivotRatio} ` +
				`viol=${row?.pivotViolations} repiv=${row?.repivoted} path=${row?.path}`,
		);
		const live = internals.blocksById.get(block.id);
		if (live === undefined) continue;
		const { matrix } = internals.assembleAudioMatrix(live);
		for (const tau of TAUS) {
			const candidate = computeNumericRepivot(shipped, size, matrix, tau);
			if (candidate === null) {
				console.log(`  tau=${tau}: refused(null)`);
				continue;
			}
			const swapped = structuredClone(program) as typeof program;
			(swapped.blocks.find((b) => b.kind === "mna" && b.id === block.id) as unknown as { sparseSchedule: SparseSchedule | null }).sparseSchedule = candidate;
			const r2 = new ReferenceRuntime(swapped);
			r2.prepare(48000, { maxNewtonIterations: 64 });
			r2.process(new Float64Array(0));
			const row2 = r2.solverPlan().blocks.find((b) => b.blockId === block.id);
			console.log(
				`  tau=${tau}: opDis=${row2?.pivotDisagreement?.toExponential(1)} ` +
					`worst=${typeof row2?.worstPivotRatio === "number" ? row2.worstPivotRatio.toExponential(1) : row2?.worstPivotRatio} ` +
					`viol=${row2?.pivotViolations} repiv=${row2?.repivoted} path=${row2?.path} ` +
					`slots ${shipped.slots}->${candidate.slots} ops ${shipped.sparseOps}->${candidate.sparseOps}`,
			);
		}
	}
}

// E2E exercise of the mid-run re-pivot path: swap a tau=0 (threshold-free)
// order into jcm800 with settle skipped, render a short window, and report
// whether the consecutive-trip limit attempted a re-pivot (plan reason names
// the refusal) before abandoning. The tau=0 order trips its pivot guard on
// essentially every solve, which is exactly the storm the re-pivot-once is
// for.
//
// Usage:
//   bun docs/spikes/sparse-pivot/midrun-storm.ts
import { computeNumericRepivot, type SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { loadProgram, tone, type Program } from "./lib";

const program = loadProgram("marshall-jcm800", true) as Program & {
	blocks: { kind: string; id: string; nodeCount: number; auxCount: number; sparseSchedule: SparseSchedule | null }[];
};
const block = program.blocks.find((b) => b.kind === "mna" && b.nodeCount + b.auxCount >= 30) as unknown as {
	id: string;
	nodeCount: number;
	auxCount: number;
	sparseSchedule: SparseSchedule;
};

// Operating-point matrix from a settled twin.
const probe = new ReferenceRuntime(structuredClone(program));
probe.prepare(48000, { maxNewtonIterations: 64 });
probe.process(new Float64Array(0));
const internals = probe as unknown as {
	assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
	blocksById: Map<string, unknown>;
};
const live = internals.blocksById.get(block.id);
const { matrix } = internals.assembleAudioMatrix(live as unknown);
const size = block.nodeCount + block.auxCount;
const storm = computeNumericRepivot(block.sparseSchedule, size, matrix, 0);
if (storm === null) {
	console.log("tau=0 refused outright; nothing to storm with");
	process.exit(0);
}
const swapped = structuredClone(program) as typeof program;
(swapped.blocks.find((b) => b.kind === "mna" && b.id === block.id) as unknown as { sparseSchedule: SparseSchedule }).sparseSchedule = storm;
const runtime = new ReferenceRuntime(swapped);
runtime.prepare(48000, { maxNewtonIterations: 64 });
(runtime as unknown as { pivotOrdersSettled: boolean }).pivotOrdersSettled = true;
runtime.process(tone(1200));
const plan = runtime.solverPlan();
console.log(
	`solves=${plan.scheduleSolves} fb=${plan.scheduleFallbacks} abandoned=${plan.abandoned} repivoted=${plan.repivoted}`,
);
for (const row of plan.blocks) {
	if (row.blockId === block.id) {
		console.log(`reason: ${row.reason}`);
	}
}

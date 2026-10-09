// Corpus OP census at one tau: for every packet, shipped OP disagreement /
// worst ratio / violations / path, plus the tau candidate's, plus slots/ops.
// Enumerates the adoption shortlist under the bar-crossing rule without audio.
//
// Usage:
//   bun docs/spikes/sparse-pivot/op-census.ts [--amps] [--out=path.jsonl] [--taus=0.001]
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { computeNumericRepivot } from "@vessel-dsp/compiler";
import type { SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, corpusFiles, loadProgram, type Program } from "./lib";

const AMPS = process.argv.includes("--amps");
const OUT = arg("out", "");
const TAUS = arg("taus", "0.001").split(",").map(Number);

type BigBlock = {
	kind: string;
	id: string;
	nodeCount: number;
	auxCount: number;
	sparseSchedule: SparseSchedule | null;
};

function packetOf(file: string): string {
	return basename(file, ".vdsp");
}

for (const file of corpusFiles(AMPS)) {
	const packet = packetOf(file);
	try {
		const program = loadProgram(packet, AMPS) as Program & { blocks: BigBlock[] };
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
			if (size < 30) continue;
			const shipped = block.sparseSchedule;
			const row = settled.blocks.find((b) => b.blockId === block.id);
			const live = internals.blocksById.get(block.id);
			if (live === undefined) continue;
			const { matrix } = internals.assembleAudioMatrix(live);
			for (const tau of TAUS) {
				const candidate = computeNumericRepivot(shipped, size, matrix, tau);
				let crow: unknown = null;
				if (candidate !== null) {
					const swapped = structuredClone(program) as typeof program;
					(swapped.blocks.find((b) => b.kind === "mna" && b.id === block.id) as unknown as { sparseSchedule: SparseSchedule | null }).sparseSchedule = candidate;
					const r2 = new ReferenceRuntime(swapped);
					r2.prepare(48000, { maxNewtonIterations: 64 });
					r2.process(new Float64Array(0));
					const found = r2.solverPlan().blocks.find((b) => b.blockId === block.id);
					crow = {
						opDis: found?.pivotDisagreement ?? null,
						worst: found?.worstPivotRatio ?? null,
						viol: found?.pivotViolations ?? null,
						path: found?.path ?? null,
						repivoted: found?.repivoted ?? null,
						slots: candidate.slots,
						ops: candidate.sparseOps,
					};
				}
				const out = {
					packet, block: block.id, size, tau,
					shippedOpDis: row?.pivotDisagreement ?? null,
					shippedWorst: row?.worstPivotRatio ?? null,
					shippedViol: row?.pivotViolations ?? null,
					shippedPath: row?.path ?? null,
					shippedRepivoted: row?.repivoted ?? null,
					shippedSlots: shipped.slots,
					shippedOps: shipped.sparseOps,
					candidate: crow,
				};
				const line = JSON.stringify(out);
				if (OUT !== "") appendFileSync(OUT, `${line}\n`);
				else console.log(line);
			}
		}
	} catch {
		continue;
	}
}
console.log(OUT === "" ? "done (stdout)" : `done, appended ${OUT}`);

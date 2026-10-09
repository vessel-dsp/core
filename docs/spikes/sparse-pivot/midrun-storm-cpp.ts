// C++ console exercise of the mid-run re-pivot path: same tau=0 storm
// order as midrun-storm.ts, rendered through V2WasmEngine, telemetry read
// back. Expect: 64 fallbacks, one re-pivot attempt, adopted (repivotedBlocks
// up, abandonedBlocks flat) -- the same shape as the TypeScript console.
//
// Usage:
//   bun docs/spikes/sparse-pivot/midrun-storm-cpp.ts
import { computeNumericRepivot, type SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
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

const engine = await V2WasmEngine.create(swapped);
engine.prepare({ sampleRate: 48000, maxNewtonIterations: 64 });
const signal = tone(1200);
const input = Float32Array.from(signal);
const output = new Float32Array(1200);
const BLOCK = 1024;
for (let at = 0; at < 1200; at += BLOCK) {
	const n = Math.min(BLOCK, 1200 - at);
	engine.processBlock(input.subarray(at, at + n), output.subarray(at, at + n));
}
const tele = engine.getScheduleTelemetry();
console.log(
	`cpp: solves=${tele.solves} fb=${tele.fallbacks} kernel=${tele.kernelSolves} ` +
		`repiv=${tele.repivotedBlocks} aband=${tele.abandonedBlocks} dropped=${tele.droppedBlocks}`,
);
engine.destroy();

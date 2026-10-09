// Extended-settle probe: does a longer warmup remove the residual sparse-vs-dense
// disagreement on packets whose 2400-sample warmup still hits the Newton cap?
// Renders forced-dense and swapped-candidate fresh at the same long warmup,
// so both paths start from settled state.
//
// Usage:
//   bun docs/spikes/sparse-pivot/settle-probe.ts --packet=boss-aw-2 [--amps]
//       [--taus=0.001] [--warmup=12000] [--samples=9600]
import { computeNumericRepivot } from "@vessel-dsp/compiler";
import type { SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import {
	arg,
	loadProgram,
	nullSchedules,
	relRms,
	tone,
	type Program,
} from "./lib";

const packet = arg("packet", "boss-aw-2");
const TAUS = arg("taus", "0.001").split(",").map(Number);
const WARMUP = Number(arg("warmup", "12000"));
const SAMPLES = Number(arg("samples", "9600"));
const AMPS = process.argv.includes("--amps");

function render(program: Program, skipSettle: boolean): { out: Float64Array; warmNC: number; nonConv: number; meanIter: number } {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(48000, { maxNewtonIterations: 64 });
	if (skipSettle) {
		(runtime as unknown as { pivotOrdersSettled: boolean }).pivotOrdersSettled = true;
	}
	const warm = tone(WARMUP);
	runtime.process(warm);
	const tWarm = runtime.telemetry();
	const out = Float64Array.from(runtime.process(tone(SAMPLES)));
	const t1 = runtime.telemetry();
	return {
		out,
		warmNC: tWarm.nonConvergedSamples,
		nonConv: t1.nonConvergedSamples - tWarm.nonConvergedSamples,
		meanIter: (t1.totalIterations - tWarm.totalIterations) / Math.max(t1.samples - tWarm.samples, 1),
	};
}

const program = loadProgram(packet, AMPS) as Program & {
	blocks: { kind: string; id: string; nodeCount: number; auxCount: number; sparseSchedule: SparseSchedule | null }[];
};
const denseRun = render(nullSchedules(program), false);
const denseOut = denseRun.out;
console.log(`${packet} warmup=${WARMUP}: dense rendered warmNC=${denseRun.warmNC} nonConv=${denseRun.nonConv}`);

const probe = new ReferenceRuntime(structuredClone(program));
probe.prepare(48000, { maxNewtonIterations: 64 });
probe.process(new Float64Array(0));
const internals = probe as unknown as {
	assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
	blocksById: Map<string, unknown>;
};
for (const block of program.blocks) {
	if (block.kind !== "mna" || block.sparseSchedule === null) continue;
	const size = block.nodeCount + block.auxCount;
	if (size < 30) continue;
	const shipped = block.sparseSchedule;
	const live = internals.blocksById.get(block.id);
	if (live === undefined) continue;
	const { matrix } = internals.assembleAudioMatrix(live);
	for (const tau of TAUS) {
		const candidate = computeNumericRepivot(shipped, size, matrix, tau);
		if (candidate === null) {
			console.log(`  [${block.id}] tau=${tau}: refused`);
			continue;
		}
		const swapped = structuredClone(program) as typeof program;
		(swapped.blocks.find((b) => b.kind === "mna" && b.id === block.id) as unknown as { sparseSchedule: SparseSchedule | null }).sparseSchedule = candidate;
		const r = render(swapped, true);
		console.log(
			`  [${block.id}] tau=${tau}: agree=${relRms(r.out, denseOut).toExponential(1)} ` +
				`meanIter=${r.meanIter.toFixed(2)} nonConv=${r.nonConv} warmNC=${r.warmNC}`,
		);
	}
}

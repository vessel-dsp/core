// Step 2: tau sweep against cached dense references.
//
// For each packet x tau: assemble the operating-point matrix from a settled
// twin, build the numeric candidate, swap it into a program copy with settle
// skipped, render, compare to the cached dense output. Also renders the
// shipped-order-with-settle-skipped as a control (isolates order quality from
// the settle decision) and reports fill/ops vs shipped.
//
// Usage:
//   bun docs/spikes/sparse-pivot/tau-sweep2.ts --packet=boss-aw-2 [--amps]
//       [--taus=0.3,0.1,0.03,0.01,0.003,0.001,0.0003,0.0001,0]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { computeNumericRepivot } from "@vessel-dsp/compiler";
import {
	arg,
	CACHE_DIR,
	loadProgram,
	relRms,
	tone,
	type Program,
} from "./lib";

const only = arg("packet", "boss-aw-2").split(",").map((s) => s.trim());
const TAUS = arg(
	"taus",
	"0.3,0.1,0.03,0.01,0.003,0.001,0.0003,0.0001,0",
)
	.split(",")
	.map(Number);
const WARMUP = Number(arg("warmup", "2400"));
const SAMPLES = Number(arg("samples", "9600"));
const AMPS = process.argv.includes("--amps");
const MIN_SIZE = Number(arg("min-size", "30"));

function render(program: Program, skipSettle: boolean): {
	out: Float64Array;
	ms: number;
	nonConv: number;
	warmNonConv: number;
	meanIter: number;
	peakIter: number;
	fallbacks: number;
	solves: number;
} {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(48000, { maxNewtonIterations: 64 });
	if (skipSettle) {
		(runtime as unknown as { pivotOrdersSettled: boolean }).pivotOrdersSettled = true;
	}
	runtime.process(tone(WARMUP));
	const tWarm = runtime.telemetry();
	const start = process.hrtime.bigint();
	const out = Float64Array.from(runtime.process(tone(SAMPLES)));
	const end = process.hrtime.bigint();
	const t1 = runtime.telemetry();
	const plan = runtime.solverPlan();
	return {
		out,
		ms: Number(end - start) / 1e6,
		nonConv: t1.nonConvergedSamples - tWarm.nonConvergedSamples,
		warmNonConv: tWarm.nonConvergedSamples,
		meanIter:
			(t1.totalIterations - tWarm.totalIterations) / Math.max(t1.samples - tWarm.samples, 1),
		peakIter: t1.peakIterations,
		fallbacks: plan.scheduleFallbacks,
		solves: plan.scheduleSolves,
	};
}

for (const packet of only) {
	const cacheFile = join(CACHE_DIR, `${packet}.f64`);
	if (!existsSync(cacheFile)) {
		console.log(`${packet}: no dense cache, run tau-cache-dense.ts first`);
		continue;
	}
	const denseOut = new Float64Array(
		readFileSync(cacheFile).buffer as ArrayBuffer,
	);
	const program = loadProgram(packet, AMPS) as Program & {
		blocks: {
			kind: string;
			id: string;
			nodeCount: number;
			auxCount: number;
			sparseSchedule: SparseSchedule | null;
		}[];
	};
	// Settled twin for matrix assembly (settle does not mutate program).
	const probe = new ReferenceRuntime(structuredClone(program));
	probe.prepare(48000, { maxNewtonIterations: 64 });
	probe.process(new Float64Array(0));
	const settledPlan = probe.solverPlan();
	const internals = probe as unknown as {
		assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
		blocksById: Map<string, unknown>;
	};
	const sparseBlocks = program.blocks.filter(
		(b) =>
			b.kind === "mna" &&
			b.sparseSchedule !== null &&
			b.nodeCount + b.auxCount >= MIN_SIZE,
	);
	console.log(
		`=== ${packet}: settled=[${settledPlan.dropped.length > 0 ? `dropped:${settledPlan.dropped}` : ""}${settledPlan.repivoted.length > 0 ? `repiv:${settledPlan.repivoted}` : ""}] ` +
			`sparseBlocks=[${sparseBlocks.map((b) => `${b.id}:n=${b.nodeCount + b.auxCount}`).join(" ")}]`,
	);
	// Shipped with settle skipped, once per packet: isolates order quality from
	// the settle gate. This is the old behaviour end-to-end (control b).
	const shipped = render(structuredClone(program), true);
	console.log(
		`  shipped-noskip agree=${relRms(shipped.out, denseOut).toExponential(1)} ` +
			`meanIter=${shipped.meanIter.toFixed(2)} nonConv=${shipped.nonConv} warmNC=${shipped.warmNonConv} fb=${shipped.fallbacks}/${shipped.solves}`,
	);
	for (const block of sparseBlocks) {
		const size = block.nodeCount + block.auxCount;
		const shipped = block.sparseSchedule as SparseSchedule;
		const live = internals.blocksById.get(block.id);
		if (live === undefined) continue;
		const { matrix } = internals.assembleAudioMatrix(live);
		for (const tau of TAUS) {
			const candidate = computeNumericRepivot(shipped, size, matrix, tau);
			if (candidate === null) {
				console.log(`  [${block.id} n=${size}] tau=${tau}: refused(null)`);
				continue;
			}
			const swapped = structuredClone(program) as typeof program;
			const target = swapped.blocks.find(
				(b) => b.kind === "mna" && b.id === block.id,
			) as unknown as { sparseSchedule: SparseSchedule | null };
			target.sparseSchedule = candidate;
			let line: string;
			try {
				const r = render(swapped, true);
				line =
					`agree=${relRms(r.out, denseOut).toExponential(1)} meanIter=${r.meanIter.toFixed(2)} ` +
					`nonConv=${r.nonConv} warmNC=${r.warmNonConv} fb=${r.fallbacks}/${r.solves} ` +
					`slots ${shipped.slots}->${candidate.slots} ` +
					`ops ${shipped.sparseOps}->${candidate.sparseOps} ms=${r.ms.toFixed(0)}`;
			} catch (error) {
				line = `threw ${String(error).slice(0, 120)}`;
			}
			console.log(`  [${block.id} n=${size}] tau=${tau}: ${line}`);
		}
	}
}

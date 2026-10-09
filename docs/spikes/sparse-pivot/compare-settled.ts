// Settled comparison: warm up in 2400-sample chunks until a chunk renders
// with zero Newton-cap hits (or a chunk budget runs out), then render the
// measured window. Compares forced-dense vs a swapped numeric candidate (or
// the settled shipped behavior) from equally-settled starts, so the number
// measures solve agreement rather than warmup-state divergence.
//
// Usage:
//   bun docs/spikes/sparse-pivot/compare-settled.ts --packet=boss-tw-1 [--amps]
//       [--taus=0.001] [--chunks=20] [--chunk=2400] [--samples=9600]
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

const packet = arg("packet", "boss-tw-1");
const TAUS = arg("taus", "0.001").split(",").map(Number);
const CHUNK = Number(arg("chunk", "2400"));
const MAX_CHUNKS = Number(arg("chunks", "20"));
const SAMPLES = Number(arg("samples", "9600"));
const AMPS = process.argv.includes("--amps");
const CANDIDATE_ONLY = process.argv.includes("--candidate-only");

function makeRuntime(program: Program, skipSettle: boolean): ReferenceRuntime {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(48000, { maxNewtonIterations: 64 });
	if (skipSettle) {
		(runtime as unknown as { pivotOrdersSettled: boolean }).pivotOrdersSettled = true;
	}
	return runtime;
}

// Warmup tone as one phase-continuous buffer, consumed chunk by chunk.
const warmBuffer = tone(CHUNK * MAX_CHUNKS);

function settle(
	program: Program,
	skipSettle: boolean,
): { runtime: ReferenceRuntime; chunks: number; warmNC: number } {
	const runtime = makeRuntime(program, skipSettle);
	let warmNC = 0;
	let chunks = 0;
	for (let c = 0; c < MAX_CHUNKS; c += 1) {
		const before = runtime.telemetry().nonConvergedSamples;
		runtime.process(warmBuffer.subarray(c * CHUNK, (c + 1) * CHUNK));
		const hits = runtime.telemetry().nonConvergedSamples - before;
		warmNC += hits;
		chunks += 1;
		if (hits === 0) break;
	}
	return { runtime, chunks, warmNC };
}

function measure(runtime: ReferenceRuntime): { out: Float64Array; nonConv: number; meanIter: number } {
	const t0 = runtime.telemetry();
	const out = Float64Array.from(runtime.process(tone(SAMPLES)));
	const t1 = runtime.telemetry();
	return {
		out,
		nonConv: t1.nonConvergedSamples - t0.nonConvergedSamples,
		meanIter: (t1.totalIterations - t0.totalIterations) / Math.max(t1.samples - t0.samples, 1),
	};
}

const program = loadProgram(packet, AMPS) as Program & {
	blocks: { kind: string; id: string; nodeCount: number; auxCount: number; sparseSchedule: SparseSchedule | null }[];
};
const denseSettled = settle(nullSchedules(program), false);
const denseMeasured = measure(denseSettled.runtime);
console.log(
	`${packet}: dense chunks=${denseSettled.chunks} warmNC=${denseSettled.warmNC} ` +
		`measNC=${denseMeasured.nonConv} mean=${denseMeasured.meanIter.toFixed(2)}`,
);

// Operating-point matrix from a settled twin for candidate construction.
const probe = new ReferenceRuntime(structuredClone(program));
probe.prepare(48000, { maxNewtonIterations: 64 });
probe.process(new Float64Array(0));
const internals = probe as unknown as {
	assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
	blocksById: Map<string, unknown>;
};

if (!CANDIDATE_ONLY) {
	const shippedSettled = settle(structuredClone(program), false);
	const shippedMeasured = measure(shippedSettled.runtime);
	console.log(
		`  shipped chunks=${shippedSettled.chunks} warmNC=${shippedSettled.warmNC} ` +
			`measNC=${shippedMeasured.nonConv} mean=${shippedMeasured.meanIter.toFixed(2)} ` +
			`agree=${relRms(shippedMeasured.out, denseMeasured.out).toExponential(1)}`,
	);
}

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
		const s = settle(swapped, true);
		const m = measure(s.runtime);
		console.log(
			`  [${block.id}] tau=${tau}: chunks=${s.chunks} warmNC=${s.warmNC} ` +
				`measNC=${m.nonConv} mean=${m.meanIter.toFixed(2)} ` +
				`agree=${relRms(m.out, denseMeasured.out).toExponential(1)} ` +
				`slots ${shipped.slots}->${candidate.slots}`,
		);
	}
}

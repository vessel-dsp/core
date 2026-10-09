// Min guard-ratio census: replicate the settle replay in-script with per-pivot
// tracking to measure min(|updated pivot| / gatheredMax) per block on the
// operating-point matrix. Sets the relative-guard floor from data instead of
// guesses: the guard tau must sit comfortably below every healthy block's
// minimum, or healthy blocks trip.
//
// Usage:
//   bun docs/spikes/sparse-pivot/min-guard-ratio.ts --packet=boss-ce-5 [--amps]
import type { SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, loadProgram, type Program } from "./lib";

const only = arg("packet", "boss-ce-5").split(",").map((s) => s.trim());
const AMPS = process.argv.includes("--amps");
const MIN_SIZE = Number(arg("min-size", "30"));

for (const packet of only) {
	const program = loadProgram(packet, AMPS) as Program & {
		blocks: { kind: string; id: string; nodeCount: number; auxCount: number; sparseSchedule: SparseSchedule | null }[];
	};
	const runtime = new ReferenceRuntime(structuredClone(program));
	runtime.prepare(48000, { maxNewtonIterations: 64 });
	runtime.process(new Float64Array(0));
	const internals = runtime as unknown as {
		assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
		blocksById: Map<string, unknown>;
	};
	for (const block of program.blocks) {
		if (block.kind !== "mna" || block.sparseSchedule === null) continue;
		const size = block.nodeCount + block.auxCount;
		if (size < MIN_SIZE) continue;
		const schedule = block.sparseSchedule;
		const live = internals.blocksById.get(block.id);
		if (live === undefined) continue;
		const { matrix } = internals.assembleAudioMatrix(live);
		// Gather + track max, then walk the op stream tracking updated pivots.
		const values = new Float64Array(schedule.slots);
		let gatheredMax = 0;
		for (let i = 0; i < schedule.slots; i += 1) {
			const v = (matrix[schedule.gatherRow[i] as number] as number[])[schedule.gatherColumn[i] as number] as number;
			values[i] = v;
			if (Math.abs(v) > gatheredMax) gatheredMax = Math.abs(v);
		}
		const factors = new Float64Array(schedule.factorCount);
		let minRatio = Infinity;
		let minPivot = "";
		let trips12 = 0;
		let trips14 = 0;
		let trips16 = 0;
		for (let at = 0; at < schedule.ops.length; at += 4) {
			const op = schedule.ops[at] as number;
			const a = schedule.ops[at + 1] as number;
			const b = schedule.ops[at + 2] as number;
			const c = schedule.ops[at + 3] as number;
			if (op === 1) values[a] = (values[a] as number) - (factors[b] as number) * (values[c] as number);
			else if (op === 0) factors[a] = (values[b] as number) / (values[c] as number);
			else if (op === 6) {
				const ratio = gatheredMax > 0 ? Math.abs(values[a] as number) / gatheredMax : 0;
				if (ratio < minRatio) {
					minRatio = ratio;
					const slot = a;
					minPivot = `(${schedule.gatherRow[slot]},${schedule.gatherColumn[slot]})=${(values[a] as number).toExponential(1)}`;
				}
				if (ratio < 1e-12) trips12 += 1;
				if (ratio < 1e-14) trips14 += 1;
				if (ratio < 1e-16) trips16 += 1;
			}
		}
		console.log(
			`${packet} [${block.id} n=${size}] gatheredMax=${gatheredMax.toExponential(1)} ` +
				`minRatio=${minRatio.toExponential(1)} at ${minPivot} trips(<1e-12)=${trips12} trips(<1e-14)=${trips14} trips(<1e-16)=${trips16}`,
		);
	}
}

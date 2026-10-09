// Knife-edge test: does libm-level noise in the operating-point matrix move
// the settle disagreements across the refinement bar? Replays the shipped
// order and the numeric candidate on sd-1's assembled matrix plus relative
// 1e-15 noise, several draws, and reports the disagreement spread. If the
// spread straddles 1e-9, the TS-vs-C++ adoption split is input noise at a
// threshold, not a console bug.
//
// Usage:
//   bun docs/spikes/sparse-pivot/knife-edge.ts
import { computeNumericRepivot, type SparseSchedule } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { runSparseSchedule } from "../../../packages/runtime/src/reference-runtime";
import { loadProgram, type Program } from "./lib";

const program = loadProgram("boss-sd-1", false) as Program & {
	blocks: { kind: string; id: string; nodeCount: number; auxCount: number; sparseSchedule: SparseSchedule | null }[];
};
const block = program.blocks.find((b) => b.kind === "mna" && b.id === "analog:0") as unknown as {
	nodeCount: number;
	auxCount: number;
	sparseSchedule: SparseSchedule;
};
const size = block.nodeCount + block.auxCount;
const shipped = block.sparseSchedule;

const probe = new ReferenceRuntime(structuredClone(program));
probe.prepare(48000, { maxNewtonIterations: 64 });
probe.process(new Float64Array(0));
const internals = probe as unknown as {
	assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
	blocksById: Map<string, unknown>;
};
const live = internals.blocksById.get("analog:0");
const { matrix, rhs } = internals.assembleAudioMatrix(live as unknown);

function disagreements(m: number[][], r: number[]): { shipped: number; candidate: number | null } {
	const dense = m.map((row) => [...row]);
	const denseRhs = [...r];
	const denseOut = new Array<number>(size).fill(0);
	// Local dense solve with partial pivoting (mirrors the runtime's).
	const order = Array.from({ length: size }, (_, i) => i);
	for (let col = 0; col < size; col += 1) {
		let piv = col;
		for (let row = col + 1; row < size; row += 1) {
			if (Math.abs((dense[order[row] as number] as number[])[col] ?? 0) > Math.abs((dense[order[piv] as number] as number[])[col] ?? 0)) piv = row;
		}
		if (Math.abs((dense[order[piv] as number] as number[])[col] ?? 0) < 1e-18) continue;
		const tb = denseRhs[col] as number; denseRhs[col] = denseRhs[piv] as number; denseRhs[piv] = tb;
		const t = order[col] as number; order[col] = order[piv] as number; order[piv] = t;
		const pr = order[col] as number;
		const pv = (dense[pr] as number[])[col] as number;
		for (let row = col + 1; row < size; row += 1) {
			const cr = order[row] as number;
			const f = ((dense[cr] as number[])[col] as number) / pv;
			if (f === 0) continue;
			for (let k = col; k < size; k += 1) (dense[cr] as number[])[k] -= f * ((dense[pr] as number[])[k] as number);
			denseRhs[row] -= f * denseRhs[col];
		}
	}
	for (let row = size - 1; row >= 0; row -= 1) {
		const cr = order[row] as number;
		const d = (dense[cr] as number[])[row] as number;
		if (Math.abs(d) < 1e-18) { denseOut[row] = 0; continue; }
		let s = denseRhs[row] as number;
		for (let col = row + 1; col < size; col += 1) s -= ((dense[cr] as number[])[col] as number) * (denseOut[col] as number);
		denseOut[row] = s / d;
	}
	const replay = (s: SparseSchedule): number => {
		const values = new Float64Array(s.slots);
		const srhs = new Float64Array(size);
		const factors = new Float64Array(s.factorCount);
		const out = new Array<number>(size).fill(0);
		const ok = runSparseSchedule(s, m, r, values, srhs, factors, out);
		let d2 = 0;
		let n2 = 0;
		for (let i = 0; i < size; i += 1) {
			d2 += ((out[i] as number) - (denseOut[i] as number)) ** 2;
			n2 += (denseOut[i] as number) ** 2;
		}
		return ok ? Math.sqrt(d2) / Math.max(Math.sqrt(n2), 1e-9) : Infinity;
	};
	const candidate = computeNumericRepivot(shipped, size, m);
	return { shipped: replay(shipped), candidate: candidate === null ? null : replay(candidate) };
}

const base = disagreements(matrix, rhs);
console.log(`clean: shipped=${base.shipped.toExponential(1)} candidate=${base.candidate?.toExponential(1)}`);
let seed = 42;
const rand = (): number => {
	seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
	return seed / 0x7fffffff - 0.5;
};
for (let draw = 0; draw < 10; draw += 1) {
	const noisy = matrix.map((row) => row.map((v) => v * (1 + 1e-15 * rand())));
	const d = disagreements(noisy, rhs);
	console.log(`noisy[${draw}]: shipped=${d.shipped.toExponential(1)} candidate=${d.candidate?.toExponential(1) ?? "null"}`);
}

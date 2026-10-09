// Scratch Newton loop for the iteration-budget experiment (2026-10-09).
//
// NOT the shipped loop. `install()` replaces `ReferenceRuntime.prototype.iterate` and
// `.iterateEliminated` with copies of the shipped bodies (reference-runtime.ts at 1d9b6f2,
// `iterate` ~4742, `iterateEliminated` ~5328) that carry three optional methods and a set of
// counters. With every method off the copies execute the shipped arithmetic statement for
// statement (control (e) hashes that), so any difference a method shows is the method's.
//
//   M1 predictor   start Newton from a linear / quadratic extrapolation of the previous
//                  converged sub-sample solutions instead of the previous solution.
//   M2 chord       keep the LU (dense `factorLU`, or the sparse schedule's `values`/`factors`
//                  left in place by `runSparseSchedule`) and take further steps as
//                  x <- x + J0^-1 (rhs(x) - J(x) x); refactor when a chord step stops
//                  contracting (delta_k > ratio * delta_{k-1}) or after `chordMaxSteps`.
//                  "within" reuses inside one sub-sample only; "across" also starts the next
//                  sub-sample on the previous one's LU.
//   M3 broyden     rank-1 "good Broyden" updates between chord steps, applied to the solve
//                  through Sherman-Morrison (O(n) per stored update); the update vector is
//                  the new residual itself because the chord step solved J_k s = -F(x_k).
//
// Tolerances, device laws, limiting, relaxation constants and the integrator are the shipped
// values, copied, never changed. Everything the shipped loop does on a DC pass, a gmin/source
// stepping pass or a linear block it still does here, untouched: the methods only engage on a
// standard audio pass of a nonlinear block.
import {
	ReferenceRuntime,
	runSparseSchedule,
	SCHEDULE_PIVOT_FLOOR,
} from "@vessel-dsp/runtime/reference-runtime";
import type { Block, SparseSchedule, Stamp } from "@vessel-dsp/compiler";

// --- shipped constants, copied ------------------------------------------------------------
export const NEWTON_RELATIVE_TOLERANCE = 1e-3;
export const NEWTON_VOLTAGE_TOLERANCE = 1e-6;
export const NEWTON_RESIDUAL_TOLERANCE = 1e-9;
const NEWTON_UNPRODUCTIVE_ITERATIONS = 64;
const NEWTON_UNPRODUCTIVE_PROBATION_SAMPLES = 1024;
const NEWTON_NON_CONTRACTING_LIMIT = 2;
const NEWTON_RELAXATION_EARLIEST_ITERATION = 8;
const NEWTON_RELAXATION_FACTOR = 0.5;
const GMIN_SIEMENS = 1e-12;
const OPAMP_FOLD_STREAK = 6;
const SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT = 64;
const SCHEDULE_OP_WIDTH = 4;
const EMPTY_SOLUTION: readonly number[] = [];

type MnaBlock = Extract<Block, { kind: "mna" }>;

// --- configuration ------------------------------------------------------------------------
export type Predictor = "none" | "linear" | "quadratic" | "wrong-sign" | "adaptive" | "adaptive2" | "adaptive3";
export type Chord = "none" | "within" | "across";
export type ScratchConfig = {
	predictor: Predictor;
	chord: Chord;
	/** Refactor when a chord step's delta exceeds this times the previous delta. */
	chordRatio: number;
	/** Refactor after this many consecutive chord steps regardless. */
	chordMaxSteps: number;
	/** Control (b): never refactor on stall. */
	chordStallDisabled: boolean;
	/** Chord-step acceptance: the shipped delta test alone, or also the contraction bound. */
	chordAccept: "delta" | "bound";
	broyden: boolean;
	/** Run a dense full-Newton twin from the same state on every standard sub-sample. */
	fixedPointCheck: boolean;
	/** Per-sub-sample trace callback (census). */
	onSubSample: ((info: SubSampleInfo) => void) | null;
};
export const SHIPPED: ScratchConfig = {
	predictor: "none", chord: "none", chordRatio: 0.5, chordMaxSteps: 8, chordStallDisabled: false,
	chordAccept: "delta", broyden: false, fixedPointCheck: false, onSubSample: null,
};
export let CONFIG: ScratchConfig = { ...SHIPPED };
export function configure(partial: Partial<ScratchConfig>): void {
	CONFIG = { ...SHIPPED, ...partial };
}

export type IterationTrace = {
	iteration: number;
	delta: number;
	worstNode: number;
	limited: boolean;
	limitedBy: string | null;
	relaxing: boolean;
	alpha: number;
	reused: boolean;
	refactoredOnStall: boolean;
	residual: number;
};
export type SubSampleInfo = {
	blockId: string;
	elapsedSamples: number;
	input: number;
	used: number;
	converged: boolean;
	start: number[];
	predicted: number[] | null;
	solution: number[];
	iterations: IterationTrace[];
	relaxEngaged: boolean;
	twin: { used: number; converged: boolean; solution: number[]; relaxEngaged: boolean; deviationTol: number; iterations: IterationTrace[] | null } | null;
};

// --- counters -----------------------------------------------------------------------------
export type Counters = {
	subSamples: number;
	iterations: number;
	assembles: number;
	factorisations: number;
	reuseSolves: number;
	convergenceChecks: number;
	broydenUpdates: number;
	stallRefactors: number;
	capRefactors: number;
	limitedRefactors: number;
	boundRejects: number;
	oneStepConverged: number;
	predictorUsed: number;
	relaxEngaged: number;
	nonConverged: number;
	limitedFirstIterations: number;
	twinSubSamples: number;
	twinIterations: number;
	twinNonConverged: number;
	twinRelaxEngaged: number;
	methodMoreIterations: number;
	methodFewerIterations: number;
	extraIterationsVsTwin: number;
	worstDeviationTol: number;
	worstDeviationBlock: string;
	worstDeviationSample: number;
	deviationOver1: number;
	deviationOver0p1: number;
};
export const counters: Counters = freshCounters();
function freshCounters(): Counters {
	return {
		subSamples: 0, iterations: 0, assembles: 0, factorisations: 0, reuseSolves: 0, convergenceChecks: 0,
		broydenUpdates: 0, stallRefactors: 0, capRefactors: 0, limitedRefactors: 0, boundRejects: 0, oneStepConverged: 0, predictorUsed: 0,
		relaxEngaged: 0, nonConverged: 0, limitedFirstIterations: 0,
		twinSubSamples: 0, twinIterations: 0, twinNonConverged: 0, twinRelaxEngaged: 0,
		methodMoreIterations: 0, methodFewerIterations: 0, extraIterationsVsTwin: 0,
		worstDeviationTol: 0, worstDeviationBlock: "", worstDeviationSample: -1, deviationOver1: 0, deviationOver0p1: 0,
	};
}
export function resetCounters(): void {
	Object.assign(counters, freshCounters());
}
export function snapshotCounters(): Counters {
	return { ...counters };
}

// --- per-runtime, per-block method state ---------------------------------------------------
type BroydenUpdate = { w: number[]; v: number[]; denom: number };
type ChordState = {
	haveLU: boolean;
	/** Dense LU of the last factorised Jacobian (iterate path, no schedule / fallback). */
	lu: number[][] | null;
	perm: number[] | null;
	/** Whether the LU currently held is the schedule's (values/factors) or the dense buffer. */
	luIsSparse: boolean;
	lastDelta: number;
	chordSteps: number;
	mustRefactor: boolean;
	broyden: BroydenUpdate[];
	lastStep: number[] | null;
	lastStepClean: boolean;
	residual: number[];
	direction: number[];
	scratchRhs: number[];
};
type PredictorState = { x1: number[] | null; x2: number[] | null; x3: number[] | null; chain: number; order: 0 | 1 | 2; lastErrors: [number, number, number]; prevErrors: [number, number, number]; candidate: number[] };
type BlockMethodState = { chord: ChordState; chordReduced: ChordState; predictor: PredictorState; solveOps: Int32Array | null };
const methodState = new WeakMap<object, Map<string, BlockMethodState>>();
function stateFor(runtime: object, block: MnaBlock, size: number): BlockMethodState {
	let map = methodState.get(runtime);
	if (map === undefined) {
		map = new Map();
		methodState.set(runtime, map);
	}
	let s = map.get(block.id);
	if (s === undefined) {
		const mk = (): ChordState => ({
			haveLU: false, lu: null, perm: null, luIsSparse: false, lastDelta: Number.POSITIVE_INFINITY, chordSteps: 0,
			mustRefactor: false, broyden: [], lastStep: null, lastStepClean: false, residual: [], direction: [], scratchRhs: [],
		});
		s = {
			chord: mk(), chordReduced: mk(),
			predictor: { x1: null, x2: null, x3: null, chain: 0, order: 0, lastErrors: [0, 0, 0], prevErrors: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY], candidate: [] },
			solveOps: block.sparseSchedule === null ? null : splitSolveOps(block.sparseSchedule),
		};
		map.set(block.id, s);
	}
	void size;
	return s;
}
/** The schedule's rhs-elimination and back-substitution ops (2,3,4,5) alone, in order. */
function splitSolveOps(schedule: SparseSchedule): Int32Array {
	const out: number[] = [];
	const ops = schedule.ops;
	for (let at = 0; at < ops.length; at += SCHEDULE_OP_WIDTH) {
		const op = ops[at] as number;
		if (op >= 2 && op <= 5) out.push(op, ops[at + 1] as number, ops[at + 2] as number, ops[at + 3] as number);
	}
	return Int32Array.from(out);
}
/** Back-substitute one rhs against the factors `runSparseSchedule` left in `values`/`factors`. */
function sparseSolveOnly(solveOps: Int32Array, values: Float64Array, factors: Float64Array, rhs: readonly number[], scratchRhs: Float64Array, out: number[], size: number): void {
	for (let index = 0; index < size; index += 1) scratchRhs[index] = rhs[index] as number;
	let accumulator = 0;
	for (let at = 0; at < solveOps.length; at += SCHEDULE_OP_WIDTH) {
		const op = solveOps[at] as number;
		const a = solveOps[at + 1] as number;
		const b = solveOps[at + 2] as number;
		if (op === 2) {
			scratchRhs[a] = (scratchRhs[a] as number) - (factors[b] as number) * (scratchRhs[solveOps[at + 3] as number] as number);
		} else if (op === 4) {
			accumulator -= (values[a] as number) * (out[b] as number);
		} else if (op === 3) {
			accumulator = scratchRhs[a] as number;
		} else {
			out[a] = accumulator / (values[b] as number);
		}
	}
}

// --- shipped helpers, copied verbatim ------------------------------------------------------
function solve(matrix: number[][], rhs: number[], out: number[]): void {
	const size = rhs.length;
	const rowOrder = Array.from({ length: size }, (_, index) => index);
	const b = rhs;
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (Math.abs((matrix[rowOrder[row] as number] as number[])[column] ?? 0) > Math.abs((matrix[rowOrder[pivot] as number] as number[])[column] ?? 0)) {
				pivot = row;
			}
		}
		if (Math.abs((matrix[rowOrder[pivot] as number] as number[])[column] ?? 0) < 1e-18) {
			continue;
		}
		if (pivot !== column) {
			const p = rowOrder[column] as number;
			rowOrder[column] = rowOrder[pivot] as number;
			rowOrder[pivot] = p;
			const value = b[column] as number;
			b[column] = b[pivot] as number;
			b[pivot] = value;
		}
		const pivotRow = rowOrder[column] as number;
		const pivotValue = (matrix[pivotRow] as number[])[column] as number;
		for (let row = column + 1; row < size; row += 1) {
			const currentRow = rowOrder[row] as number;
			const factor = ((matrix[currentRow] as number[])[column] as number) / pivotValue;
			if (factor === 0) {
				continue;
			}
			for (let inner = column; inner < size; inner += 1) {
				(matrix[currentRow] as number[])[inner] -= factor * ((matrix[pivotRow] as number[])[inner] as number);
			}
			b[row] = (b[row] as number) - factor * (b[column] as number);
		}
	}
	for (let row = size - 1; row >= 0; row -= 1) {
		const currentRow = rowOrder[row] as number;
		const diagonal = (matrix[currentRow] as number[])[row] as number;
		if (Math.abs(diagonal) < 1e-18) {
			out[row] = 0;
			continue;
		}
		let sum = b[row] as number;
		for (let column = row + 1; column < size; column += 1) {
			sum -= ((matrix[currentRow] as number[])[column] as number) * (out[column] as number);
		}
		out[row] = sum / diagonal;
	}
}
export function factorLU(matrix: number[][]): { readonly permutation: readonly number[] } {
	const size = matrix.length;
	const a = matrix;
	const permutation = Array.from({ length: size }, (_, index) => index);
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (Math.abs((a[row] as number[])[column] ?? 0) > Math.abs((a[pivot] as number[])[column] ?? 0)) pivot = row;
		}
		if (pivot !== column) {
			const rowA = a[column] as number[];
			a[column] = a[pivot] as number[];
			a[pivot] = rowA;
			const p = permutation[column] as number;
			permutation[column] = permutation[pivot] as number;
			permutation[pivot] = p;
		}
		const pivotValue = (a[column] as number[])[column] as number;
		if (Math.abs(pivotValue) < 1e-18) continue;
		for (let row = column + 1; row < size; row += 1) {
			const factor = ((a[row] as number[])[column] as number) / pivotValue;
			(a[row] as number[])[column] = factor;
			if (factor === 0) continue;
			for (let inner = column + 1; inner < size; inner += 1) {
				(a[row] as number[])[inner] -= factor * ((a[column] as number[])[inner] as number);
			}
		}
	}
	return { permutation };
}
export function solveLU(factored: readonly (readonly number[])[], permutation: readonly number[], rhs: readonly number[], out: number[]): void {
	const size = factored.length;
	for (let i = 0; i < size; i += 1) out[i] = rhs[permutation[i] as number] as number;
	for (let i = 0; i < size; i += 1) {
		let sum = out[i] as number;
		const row = factored[i] as readonly number[];
		for (let column = 0; column < i; column += 1) sum -= (row[column] as number) * (out[column] as number);
		out[i] = sum;
	}
	for (let i = size - 1; i >= 0; i -= 1) {
		let sum = out[i] as number;
		const row = factored[i] as readonly number[];
		for (let column = i + 1; column < size; column += 1) sum -= (row[column] as number) * (out[column] as number);
		const diagonal = row[i] as number;
		out[i] = Math.abs(diagonal) < 1e-18 ? 0 : sum / diagonal;
	}
}
function relativeResidual(matrix: readonly (readonly number[])[], rhs: readonly number[], x: readonly number[], pairs: Int32Array | null, size: number): number {
	const acc = new Float64Array(size);
	const scale = new Float64Array(size);
	if (pairs === null) {
		for (let row = 1; row < size; row += 1) {
			const rowRef = matrix[row] as readonly number[];
			for (let col = 0; col < size; col += 1) {
				const term = (rowRef[col] as number) * (x[col] as number);
				acc[row] += term;
				scale[row] += Math.abs(term);
			}
		}
	} else {
		for (let index = 0; index < pairs.length; index += 2) {
			const row = pairs[index] as number;
			if (row === 0) continue;
			const col = pairs[index + 1] as number;
			const term = ((matrix[row] as readonly number[])[col] as number) * (x[col] as number);
			acc[row] += term;
			scale[row] += Math.abs(term);
		}
	}
	let worst = 0;
	for (let row = 1; row < size; row += 1) {
		const b = rhs[row] as number;
		const rel = Math.abs((acc[row] as number) - b) / ((scale[row] as number) + Math.abs(b) + 1e-30);
		if (rel > worst) worst = rel;
	}
	return Number.isFinite(worst) ? worst : Number.POSITIVE_INFINITY;
}
export function withinTolerance(next: readonly number[], previous: readonly number[]): boolean {
	for (let index = 0; index < next.length; index += 1) {
		const a = next[index] ?? 0;
		const b = previous[index] ?? 0;
		const allowance = NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b)) + NEWTON_VOLTAGE_TOLERANCE;
		if (Math.abs(a - b) > allowance) return false;
	}
	return true;
}
/** The shipped test with the difference scaled by `factor` (the chord contraction bound). */
function withinToleranceScaled(next: readonly number[], previous: readonly number[], factor: number): boolean {
	for (let index = 0; index < next.length; index += 1) {
		const a = next[index] ?? 0;
		const b = previous[index] ?? 0;
		const allowance = NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b)) + NEWTON_VOLTAGE_TOLERANCE;
		if (Math.abs(a - b) * factor > allowance) return false;
	}
	return true;
}
function worstDifferenceIndex(a: readonly number[], b: readonly number[]): number {
	let index = -1;
	let worst = -1;
	for (let position = 0; position < a.length; position += 1) {
		const x = a[position] ?? 0;
		const y = b[position] ?? 0;
		const allowance = NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(x), Math.abs(y)) + NEWTON_VOLTAGE_TOLERANCE;
		const ratio = Math.abs(x - y) / allowance;
		if (ratio > worst) {
			worst = ratio;
			index = position;
		}
	}
	return index;
}
function maxAbsDifference(a: readonly number[], b: readonly number[]): number {
	let largest = 0;
	for (let index = 0; index < a.length; index += 1) largest = Math.max(largest, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
	return largest;
}
/** Worst per-unknown deviation in tolerance units: |a-b| / (reltol*max|.| + vntol). */
export function deviationInToleranceUnits(a: readonly number[], b: readonly number[]): number {
	let worst = 0;
	for (let i = 0; i < a.length; i += 1) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		const allowance = NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(x), Math.abs(y)) + NEWTON_VOLTAGE_TOLERANCE;
		const r = Math.abs(x - y) / allowance;
		if (r > worst) worst = r;
	}
	return worst;
}

// --- residual, chord step, Broyden ---------------------------------------------------------
/** r = rhs - J x over the stamped pattern (row 0 is the ground pin: r0 = rhs0 - x0). */
function residualVector(matrix: readonly (readonly number[])[], rhs: readonly number[], x: readonly number[], pairs: Int32Array | null, size: number, out: number[]): void {
	for (let row = 0; row < size; row += 1) out[row] = rhs[row] as number;
	if (pairs === null) {
		for (let row = 0; row < size; row += 1) {
			const rowRef = matrix[row] as readonly number[];
			let acc = 0;
			for (let col = 0; col < size; col += 1) acc += (rowRef[col] as number) * (x[col] as number);
			out[row] = (out[row] as number) - acc;
		}
	} else {
		for (let index = 0; index < pairs.length; index += 2) {
			const row = pairs[index] as number;
			const col = pairs[index + 1] as number;
			out[row] = (out[row] as number) - ((matrix[row] as readonly number[])[col] as number) * (x[col] as number);
		}
		// The ground pin row is outside the stamp pattern: matrix[0][0] = 1, rhs[0] = 0.
		out[0] = (rhs[0] as number) - (x[0] as number);
	}
}
function applyBroyden(updates: readonly BroydenUpdate[], z: number[], size: number): void {
	for (const u of updates) {
		let dot = 0;
		for (let i = 0; i < size; i += 1) dot += (u.v[i] as number) * (z[i] as number);
		const s = dot / u.denom;
		for (let i = 0; i < size; i += 1) z[i] = (z[i] as number) - (u.w[i] as number) * s;
	}
}

// --- side-effect snapshot for the twin -----------------------------------------------------
function snapshotSide(rt: any, blockId: string) {
	const sparse = rt.sparseSchedules.get(blockId);
	const scratch = rt.iterationScratch.get(blockId);
	return {
		diode: new Map(rt.diodeHistory), bjt: new Map(rt.bjtHistory), fet: new Map(rt.fetHistory),
		opamp: new Map(rt.opampHistory), triode: new Map(rt.triodeHistory),
		probation: rt.unproductiveUntilSample.get(blockId),
		census: rt.blockNewtonCensus.get(blockId) === undefined ? undefined : { ...rt.blockNewtonCensus.get(blockId) },
		stalled: rt.stalledSamples, flagged: rt.solvedButFlaggedSamples,
		scheduleSolves: rt.scheduleSolves, scheduleFallbacks: rt.scheduleFallbacks,
		sparseFallbacks: sparse?.consecutiveFallbacks, sparseRepivot: sparse?.repivotAttempted,
		denseDirty: scratch?.denseDirty,
		limitedIterate: rt.limitedIterate, limitedBy: rt.limitedBy, limitedOpamp: rt.limitedOpamp,
	};
}
function restoreSide(rt: any, blockId: string, s: ReturnType<typeof snapshotSide>): void {
	rt.diodeHistory.clear(); for (const [k, v] of s.diode) rt.diodeHistory.set(k, v);
	rt.bjtHistory.clear(); for (const [k, v] of s.bjt) rt.bjtHistory.set(k, v);
	rt.fetHistory.clear(); for (const [k, v] of s.fet) rt.fetHistory.set(k, v);
	rt.opampHistory.clear(); for (const [k, v] of s.opamp) rt.opampHistory.set(k, v);
	rt.triodeHistory.clear(); for (const [k, v] of s.triode) rt.triodeHistory.set(k, v);
	if (s.probation === undefined) rt.unproductiveUntilSample.delete(blockId); else rt.unproductiveUntilSample.set(blockId, s.probation);
	if (s.census === undefined) rt.blockNewtonCensus.delete(blockId); else rt.blockNewtonCensus.set(blockId, s.census);
	rt.stalledSamples = s.stalled; rt.solvedButFlaggedSamples = s.flagged;
	rt.scheduleSolves = s.scheduleSolves; rt.scheduleFallbacks = s.scheduleFallbacks;
	const sparse = rt.sparseSchedules.get(blockId);
	if (sparse !== undefined && s.sparseFallbacks !== undefined) { sparse.consecutiveFallbacks = s.sparseFallbacks; sparse.repivotAttempted = s.sparseRepivot; }
	// The twin's dense solve leaves fill OUTSIDE the stamp pattern in the shared matrix
	// buffer. The sparse path never reads outside the pattern, so the method is immune, but
	// a later dense solve (the next twin, or a fallback) would read it: force the full copy.
	// Arithmetic is unchanged by a full copy; only its cost is.
	const scratch = rt.iterationScratch.get(blockId);
	if (scratch !== undefined) scratch.denseDirty = true;
	rt.limitedIterate = s.limitedIterate; rt.limitedBy = s.limitedBy; rt.limitedOpamp = s.limitedOpamp;
}

// --- predictor ----------------------------------------------------------------------------
/** Order-k extrapolation of the converged history into `out`; false when the chain is too short. */
function extrapolateInto(p: PredictorState, order: 0 | 1 | 2, n: number, out: number[]): boolean {
	if (order === 0) {
		if (p.chain < 1 || p.x1 === null) return false;
		for (let i = 0; i < n; i += 1) out[i] = p.x1[i] as number;
		return true;
	}
	if (order === 1) {
		if (p.chain < 2 || p.x1 === null || p.x2 === null) return false;
		for (let i = 0; i < n; i += 1) out[i] = 2 * (p.x1[i] as number) - (p.x2[i] as number);
		return true;
	}
	if (p.chain < 3 || p.x1 === null || p.x2 === null || p.x3 === null) return false;
	for (let i = 0; i < n; i += 1) out[i] = 3 * (p.x1[i] as number) - 3 * (p.x2[i] as number) + (p.x3[i] as number);
	return true;
}
function predictStart(p: PredictorState, start: number[], mode: Predictor): number[] | null {
	if (mode === "none") return null;
	const n = start.length;
	if (p.candidate.length !== n) p.candidate = new Array<number>(n).fill(0);
	if (mode === "adaptive" || mode === "adaptive2" || mode === "adaptive3") {
		// Self-selecting order: the extrapolation order (0 = the shipped start, 1, 2) that
		// would have predicted the LAST converged solution best is the one used now. No
		// constant, no knob: a comparison of three errors measured on this block's own history.
		if (p.order === 0) return null;
		return extrapolateInto(p, p.order, n, p.candidate) ? p.candidate : null;
	}
	if (mode === "linear") return extrapolateInto(p, 1, n, p.candidate) ? p.candidate : null;
	if (mode === "quadratic") return extrapolateInto(p, 2, n, p.candidate) ? p.candidate : null;
	// wrong-sign: x1 - (x1 - x2) -- the linear extrapolation taken backwards.
	if (p.chain < 2 || p.x1 === null || p.x2 === null) return null;
	for (let i = 0; i < n; i += 1) p.candidate[i] = (p.x1[i] as number) - ((p.x1[i] as number) - (p.x2[i] as number));
	return p.candidate;
}
function recordConverged(p: PredictorState, solution: readonly number[], converged: boolean, adaptive: boolean, hysteresis = false, smoothGate = false, used = 0): void {
	if (!converged) { p.chain = 0; p.order = 0; p.prevErrors = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]; return; }
	const n = solution.length;
	if (adaptive) {
		// Score every order against the solution just reached, from the history BEFORE it,
		// in one fused allocation-free pass (the same tolerance-unit measure as `toleranceUnits`).
		const c1 = p.chain >= 1 && p.x1 !== null, c2 = p.chain >= 2 && p.x2 !== null, c3 = p.chain >= 3 && p.x3 !== null;
		let e0 = c1 ? 0 : Number.POSITIVE_INFINITY, e1 = c2 ? 0 : Number.POSITIVE_INFINITY, e2 = c3 ? 0 : Number.POSITIVE_INFINITY;
		for (let i = 0; i < n; i += 1) {
			const s = solution[i] as number;
			const abs = Math.abs(s);
			if (c1) {
				const x1 = (p.x1 as number[])[i] as number;
				const g0 = x1;
				const r0 = Math.abs(g0 - s) / (NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(g0), abs) + NEWTON_VOLTAGE_TOLERANCE);
				if (r0 > e0) e0 = r0;
				if (c2) {
					const x2 = (p.x2 as number[])[i] as number;
					const g1 = 2 * x1 - x2;
					const r1 = Math.abs(g1 - s) / (NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(g1), abs) + NEWTON_VOLTAGE_TOLERANCE);
					if (r1 > e1) e1 = r1;
					if (c3) {
						const g2 = 3 * x1 - 3 * x2 + ((p.x3 as number[])[i] as number);
						const r2 = Math.abs(g2 - s) / (NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(g2), abs) + NEWTON_VOLTAGE_TOLERANCE);
						if (r2 > e2) e2 = r2;
					}
				}
			}
		}
		p.prevErrors = p.lastErrors;
		p.lastErrors = [e0, e1, e2];
		let best: 0 | 1 | 2 = 0;
		if (hysteresis) {
			// An order is eligible only if it beat the previous-solution start on the last TWO
			// scored solves; among eligible orders the smallest last error wins.
			const q = p.prevErrors;
			const ok1 = e1 < e0 && q[1] < q[0], ok2 = e2 < e0 && q[2] < q[0];
			if (ok1) best = 1;
			if (ok2 && e2 < (ok1 ? e1 : e0)) best = 2;
		} else {
			if (e1 < e0) best = 1;
			if (e2 < (best === 0 ? e0 : e1)) best = 2;
		}
		// Smooth-regime gate: extrapolate only after a solve that took at most two iterations
		// (one step + one check, the floor). A solve that needed more is hunting across a knee,
		// where a closer start in tolerance units does not mean a cheaper solve.
		if (smoothGate && used > 2) best = 0;
		p.order = best;
	}
	// Rotate the ring without allocating: the oldest buffer receives the new solution.
	const oldest = p.x3;
	p.x3 = p.x2; p.x2 = p.x1;
	p.x1 = oldest !== null && oldest.length === n ? oldest : new Array<number>(n).fill(0);
	for (let i = 0; i < n; i += 1) p.x1[i] = solution[i] as number;
	p.chain += 1;
}

// --- the loops -----------------------------------------------------------------------------
type IterateResult = { solution: number[]; converged: boolean; used: number; worstNode: number; worstDelta: number };

function scratchIterate(this: any, block: MnaBlock, input: number, dt: number, state: number[], start: number[], dc: boolean, gmin: number = GMIN_SIEMENS, sourceScale: number = 1): IterateResult {
	const cfg = CONFIG;
	const size = block.nodeCount + block.auxCount;
	const standard = !dc && sourceScale === 1 && gmin === GMIN_SIEMENS && !block.linear;
	const ms = stateFor(this, block, size);
	let twin: SubSampleInfo["twin"] = null;
	let twinTrace: IterationTrace[] | null = null;
	if (cfg.fixedPointCheck && standard) {
		const snap = snapshotSide(this, block.id);
		const sc = this.iterationScratch.get(block.id);
		if (sc !== undefined) sc.denseDirty = true;
		twinTrace = cfg.onSubSample === null ? null : [];
		const t = coreIterate.call(this, block, input, dt, state, start, dc, gmin, sourceScale, SHIPPED, ms, true, null, false, twinTrace);
		const relaxEngaged = twinTrace === null ? false : twinTrace.some((x) => x.relaxing);
		twin = { used: t.used, converged: t.converged, solution: t.solution.slice(), relaxEngaged, deviationTol: 0, iterations: twinTrace };
		restoreSide(this, block.id, snap);
	}
	const trace: IterationTrace[] | null = cfg.onSubSample === null ? null : [];
	const predicted = standard ? predictStart(ms.predictor, start, cfg.predictor) : null;
	if (standard) counters.subSamples += 1;
	if (predicted !== null) counters.predictorUsed += 1;
	const result = coreIterate.call(this, block, input, dt, state, predicted ?? start, dc, gmin, sourceScale, cfg, ms, false, predicted === null ? null : start, standard, trace);
	if (standard) {
		counters.iterations += result.used;
		if (!result.converged) counters.nonConverged += 1;
		if (result.converged && result.used === 1) counters.oneStepConverged += 1;
		if (trace !== null && trace.some((x) => x.relaxing)) counters.relaxEngaged += 1;
		recordConverged(ms.predictor, result.solution, result.converged, cfg.predictor === "adaptive" || cfg.predictor === "adaptive2" || cfg.predictor === "adaptive3", cfg.predictor === "adaptive2", cfg.predictor === "adaptive3", result.used);
		if (twin !== null) {
			counters.twinSubSamples += 1;
			counters.twinIterations += twin.used;
			if (!twin.converged) counters.twinNonConverged += 1;
			if (twin.relaxEngaged) counters.twinRelaxEngaged += 1;
			if (result.used > twin.used) { counters.methodMoreIterations += 1; counters.extraIterationsVsTwin += result.used - twin.used; }
			if (result.used < twin.used) counters.methodFewerIterations += 1;
			const dev = result.converged && twin.converged ? deviationInToleranceUnits(result.solution, twin.solution) : Number.NaN;
			twin.deviationTol = dev;
			if (Number.isFinite(dev)) {
				if (dev > counters.worstDeviationTol) { counters.worstDeviationTol = dev; counters.worstDeviationBlock = block.id; counters.worstDeviationSample = this.elapsedSamples; }
				if (dev > 1) counters.deviationOver1 += 1;
				if (dev > 0.1) counters.deviationOver0p1 += 1;
			}
		}
		if (cfg.onSubSample !== null) {
			cfg.onSubSample({
				blockId: block.id, elapsedSamples: this.elapsedSamples, input, used: result.used, converged: result.converged,
				start: start.slice(), predicted: predicted === null ? null : predicted.slice(), solution: result.solution.slice(),
				iterations: trace ?? [], relaxEngaged: (trace ?? []).some((x) => x.relaxing), twin,
			});
		}
	}
	return result;
}

/**
 * The shipped `iterate` body with the method hooks. `forceDense` is the twin's switch (no
 * schedule, no counters). `shippedStart` is the un-predicted start the fold reseed reads.
 */
function coreIterate(this: any, block: MnaBlock, input: number, dt: number, state: number[], start: number[], dc: boolean, gmin: number, sourceScale: number, cfg: ScratchConfig, ms: BlockMethodState, forceDense: boolean, shippedStart: number[] | null, count: boolean, trace: IterationTrace[] | null): IterateResult {
	const size = block.nodeCount + block.auxCount;
	const probationEnds = this.unproductiveUntilSample.get(block.id);
	const onProbation = !dc && probationEnds !== undefined && this.elapsedSamples < probationEnds;
	const iterations = block.linear ? 1 : onProbation ? Math.min(NEWTON_UNPRODUCTIVE_ITERATIONS, this.maxNewtonIterations) : this.maxNewtonIterations;
	let converged = block.linear;
	let used = 0;
	let worstNode = -1;
	let worstDelta = 0;
	const scratch = this.iterationScratch.get(block.id);
	if (scratch === undefined) throw new Error(`no iteration scratch for block "${block.id}" -- prepare() was not called`);
	const { matrix, rhs, solutionA, solutionB } = scratch as { matrix: number[][]; rhs: number[]; solutionA: number[]; solutionB: number[]; clearPairs: Int32Array | null; denseDirty: boolean };
	const sparse = dc || forceDense ? undefined : this.sparseSchedules.get(block.id);
	const blockIndex = this.blockIndexById.get(block.id) ?? 0;
	for (let index = 0; index < size; index += 1) solutionA[index] = start[index] ?? 0;
	let current = solutionA;
	let next = solutionB;
	const base = this.baseMatrices.get(block.id);
	const isStandardAudioPass = !dc && sourceScale === 1 && gmin === GMIN_SIEMENS && base !== undefined;
	const methodsOn = isStandardAudioPass && !block.linear && !forceDense;
	const chordOn = methodsOn && cfg.chord !== "none";
	const cs = ms.chord;
	if (chordOn) {
		// A new sub-sample: "within" starts from a fresh factorisation, "across" keeps the last one.
		if (cfg.chord === "within") cs.haveLU = false;
		// An abandoned schedule takes its factors with it.
		if (cs.luIsSparse && sparse === undefined) cs.haveLU = false;
		cs.lastDelta = Number.POSITIVE_INFINITY;
		cs.chordSteps = 0;
		cs.mustRefactor = false;
		cs.broyden.length = 0;
		cs.lastStep = null;
		cs.lastStepClean = false;
		if (cs.residual.length !== size) { cs.residual = new Array<number>(size).fill(0); cs.direction = new Array<number>(size).fill(0); cs.scratchRhs = new Array<number>(size).fill(0); }
	} else if (!forceDense) {
		cs.haveLU = false;
	}

	let lastBlockedResidual = Number.NaN;
	let relaxing = false;
	let alpha = NEWTON_RELAXATION_FACTOR;
	let bestDelta = Number.POSITIVE_INFINITY;
	let noImprovement = 0;
	let foldStreak = 0;
	let foldReseeded = false;
	const startForFold = shippedStart ?? start;
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		used = iteration + 1;
		this.limitedIterate = false;
		this.limitedBy = null;
		this.limitedOpamp = null;

		if (isStandardAudioPass) {
			const pairs = scratch.clearPairs as Int32Array | null;
			if (pairs === null || scratch.denseDirty) {
				for (let row = 0; row < size; row += 1) {
					const dstRow = matrix[row] as number[];
					const srcRow = base.matrix[row] as number[];
					for (let column = 0; column < size; column += 1) dstRow[column] = srcRow[column] as number;
				}
				scratch.denseDirty = false;
			} else {
				for (let index = 0; index < pairs.length; index += 2) {
					const row = pairs[index] as number;
					const column = pairs[index + 1] as number;
					(matrix[row] as number[])[column] = (base.matrix[row] as number[])[column] as number;
				}
			}
			for (let row = 0; row < size; row += 1) rhs[row] = base.rhs[row] as number;
			for (const stamp of base.nonConstantStamps as Stamp[]) {
				this.applyStamp(stamp, matrix, rhs, block, dt, state, current, input, false, 1, blockIndex);
			}
			for (let column = 0; column < size; column += 1) (matrix[0] as number[])[column] = 0;
			(matrix[0] as number[])[0] = 1;
			rhs[0] = 0;
		} else {
			const pairs = scratch.clearPairs as Int32Array | null;
			if (pairs === null || scratch.denseDirty) {
				for (let row = 0; row < size; row += 1) (matrix[row] as number[]).fill(0);
				scratch.denseDirty = false;
			} else {
				for (let index = 0; index < pairs.length; index += 2) (matrix[pairs[index] as number] as number[])[pairs[index + 1] as number] = 0;
			}
			for (let row = 0; row < size; row += 1) rhs[row] = 0;
			for (const stamp of block.stamps) {
				this.applyStamp(stamp, matrix, rhs, block, dt, state, current, input, dc, sourceScale, blockIndex);
			}
			for (let node = 1; node < block.nodeCount; node += 1) (matrix[node] as number[])[node] += gmin;
			for (let column = 0; column < size; column += 1) (matrix[0] as number[])[column] = 0;
			(matrix[0] as number[])[0] = 1;
			rhs[0] = 0;
		}
		if (count) { counters.assembles += 1; counters.convergenceChecks += 1; }
		if (count && iteration === 0 && this.limitedIterate) counters.limitedFirstIterations += 1;

		const residualAtCurrent = this.limitedIterate ? relativeResidual(matrix, rhs, current, scratch.clearPairs as Int32Array | null, size) : Number.POSITIVE_INFINITY;

		let reused = false;
		let refactoredOnStall = false;
		// A limited assembly never reuses a factorisation: the limiter has replaced the
		// companion model at this iterate by one linearised elsewhere, so the stored LU is not
		// an approximation of this Jacobian and the residual is not F(x). Counted separately.
		if (chordOn && cs.haveLU && !cs.mustRefactor && this.limitedIterate) { cs.mustRefactor = true; if (count) counters.limitedRefactors += 1; }
		const wantReuse = chordOn && cs.haveLU && !cs.mustRefactor;
		if (wantReuse) {
			// Chord / Broyden step against the stored factorisation.
			reused = true;
			const r = cs.residual;
			residualVector(matrix, rhs, current, scratch.clearPairs as Int32Array | null, size, r);
			if (cfg.broyden && cs.lastStep !== null && cs.lastStepClean && !this.limitedIterate) {
				// Good Broyden: J+ = J + (y - J s) s^T / (s.s), and the chord step gave J s = -F(x_k),
				// so y - J s = F(x_{k+1}) = -r. Sherman-Morrison on the solve: w = J^-1 u.
				const s = cs.lastStep;
				let ss = 0;
				for (let i = 0; i < size; i += 1) ss += (s[i] as number) * (s[i] as number);
				if (ss > 0) {
					const u = new Array<number>(size);
					for (let i = 0; i < size; i += 1) u[i] = -(r[i] as number) / ss;
					const w = new Array<number>(size).fill(0);
					if (cs.luIsSparse) sparseSolveOnly(ms.solveOps as Int32Array, (sparse as any).values, (sparse as any).factors, u, (sparse as any).rhs, w, size);
					else solveLU(cs.lu as number[][], cs.perm as number[], u, w);
					applyBroyden(cs.broyden, w, size);
					let denom = 1;
					for (let i = 0; i < size; i += 1) denom += (s[i] as number) * (w[i] as number);
					if (Math.abs(denom) > 1e-12) {
						cs.broyden.push({ w, v: s.slice(), denom });
						if (count) counters.broydenUpdates += 1;
					}
				}
			}
			const d = cs.direction;
			if (cs.luIsSparse) sparseSolveOnly(ms.solveOps as Int32Array, (sparse as any).values, (sparse as any).factors, r, (sparse as any).rhs, d, size);
			else solveLU(cs.lu as number[][], cs.perm as number[], r, d);
			if (cs.broyden.length > 0) applyBroyden(cs.broyden, d, size);
			for (let i = 0; i < size; i += 1) next[i] = (current[i] as number) + (d[i] as number);
			if (count) counters.reuseSolves += 1;
			cs.chordSteps += 1;
		} else if (sparse === undefined) {
			if (chordOn) {
				// Fresh dense factorisation, kept: x = J^-1 rhs through the stored LU.
				if (cs.lu === null || cs.lu.length !== size) { cs.lu = Array.from({ length: size }, () => new Array<number>(size).fill(0)); cs.perm = new Array<number>(size).fill(0); }
				for (let row = 0; row < size; row += 1) {
					const dst = (cs.lu as number[][])[row] as number[];
					const src = matrix[row] as number[];
					for (let col = 0; col < size; col += 1) dst[col] = src[col] as number;
				}
				const { permutation } = factorLU(cs.lu as number[][]);
				for (let i = 0; i < size; i += 1) (cs.perm as number[])[i] = permutation[i] as number;
				solveLU(cs.lu as number[][], cs.perm as number[], rhs, next);
				cs.haveLU = true; cs.luIsSparse = false;
			} else {
				scratch.denseDirty = true;
				solve(matrix, rhs, next);
			}
			if (count) counters.factorisations += 1;
		} else {
			this.scheduleSolves += 1;
			if (count) counters.factorisations += 1;
			if (runSparseSchedule(sparse.schedule, matrix, rhs, sparse.values, sparse.rhs, sparse.factors, next)) {
				sparse.consecutiveFallbacks = 0;
				if (chordOn) { cs.haveLU = true; cs.luIsSparse = true; }
			} else {
				if (chordOn) cs.haveLU = false;
				this.scheduleFallbacks += 1;
				sparse.consecutiveFallbacks += 1;
				if (sparse.consecutiveFallbacks >= SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT) {
					if (!sparse.repivotAttempted) {
						sparse.repivotAttempted = true;
						const matrixCopy = matrix.map((row: number[]) => [...row]);
						const rhsCopy = [...rhs];
						scratch.denseDirty = true;
						solve(matrix, rhs, next);
						if (!this.adoptMidRunRepivot(block.id, sparse, matrixCopy, rhsCopy, next)) {
							this.sparseSchedules.delete(block.id);
							this.abandonedSchedules.add(block.id);
						}
					} else {
						this.sparseSchedules.delete(block.id);
						this.abandonedSchedules.add(block.id);
						scratch.denseDirty = true;
						solve(matrix, rhs, next);
					}
				} else {
					scratch.denseDirty = true;
					solve(matrix, rhs, next);
				}
			}
		}
		if (chordOn && !reused) {
			// A fresh factorisation resets the chord bookkeeping.
			if (cs.mustRefactor) refactoredOnStall = true;
			cs.mustRefactor = false;
			cs.chordSteps = 0;
			cs.broyden.length = 0;
			cs.lastDelta = Number.POSITIVE_INFINITY;
		}
		if (relaxing) {
			for (let i = 0; i < size; i++) next[i] = current[i] + alpha * (next[i] - current[i]);
		}
		const delta = maxAbsDifference(next, current);
		worstNode = worstDifferenceIndex(next, current);
		worstDelta = delta;
		if (delta < bestDelta * 0.999) {
			bestDelta = delta;
			noImprovement = 0;
			if (relaxing) {
				if (delta < 0.05) { relaxing = false; alpha = NEWTON_RELAXATION_FACTOR; }
				else alpha = Math.min(NEWTON_RELAXATION_FACTOR, alpha * 1.15);
			}
		} else {
			noImprovement += 1;
			if (!relaxing) {
				if (noImprovement >= NEWTON_NON_CONTRACTING_LIMIT && iteration >= NEWTON_RELAXATION_EARLIEST_ITERATION) { relaxing = true; noImprovement = 0; }
			} else if (noImprovement >= NEWTON_NON_CONTRACTING_LIMIT) { alpha = Math.max(0.2, alpha * 0.7); noImprovement = 0; }
		}
		if (this.limiterTrace) {
			this.limitedIterationCount += this.limitedIterate ? 1 : 0;
			this.limitedIterationPerSample.push(this.limitedIterate ? 1 : 0);
		}
		const withinDelta = withinTolerance(next, current);
		if (withinDelta && this.limitedIterate && !block.linear) lastBlockedResidual = residualAtCurrent;
		let convergedNow = block.linear || (withinDelta && !this.limitedIterate);
		// Chord bookkeeping: contraction test and the acceptance bound.
		if (chordOn) {
			if (reused) {
				const ratio = delta / cs.lastDelta;
				if (convergedNow && cfg.chordAccept === "bound" && Number.isFinite(ratio) && ratio > 0) {
					const factor = ratio / Math.max(1e-9, 1 - Math.min(ratio, 0.999));
					if (factor > 1 && !withinToleranceScaled(next, current, factor)) { convergedNow = false; if (count) counters.boundRejects += 1; }
				}
				if (!convergedNow && !cfg.chordStallDisabled) {
					if (delta > cfg.chordRatio * cs.lastDelta) { cs.mustRefactor = true; if (count) counters.stallRefactors += 1; }
					else if (cs.chordSteps >= cfg.chordMaxSteps) { cs.mustRefactor = true; if (count) counters.capRefactors += 1; }
				}
			}
			cs.lastDelta = delta;
			if (cs.lastStep === null || cs.lastStep.length !== size) cs.lastStep = new Array<number>(size).fill(0);
			for (let i = 0; i < size; i += 1) (cs.lastStep as number[])[i] = (next[i] as number) - (current[i] as number);
			cs.lastStepClean = reused && !relaxing;
		}
		if (trace !== null) trace.push({ iteration, delta, worstNode, limited: this.limitedIterate, limitedBy: this.limitedBy, relaxing, alpha, reused, refactoredOnStall, residual: residualAtCurrent });
		const swap = current;
		current = next;
		next = swap;
		if (convergedNow) { converged = true; break; }
		const limitedOpamp = this.limitedOpamp;
		foldStreak = limitedOpamp?.folded === true ? foldStreak + 1 : 0;
		if (!dc && !foldReseeded && limitedOpamp !== null && foldStreak >= OPAMP_FOLD_STREAK) {
			foldReseeded = true;
			foldStreak = 0;
			const wasHigh = (startForFold[limitedOpamp.output] ?? limitedOpamp.centre) >= limitedOpamp.centre;
			current[limitedOpamp.output] = wasHigh ? limitedOpamp.railLow : limitedOpamp.railHigh;
			this.opampHistory.set(limitedOpamp.key, { differential: wasHigh ? -limitedOpamp.band : limitedOpamp.band, step: 0, cap: limitedOpamp.maxStep });
			relaxing = false;
			alpha = NEWTON_RELAXATION_FACTOR;
			bestDelta = Number.POSITIVE_INFINITY;
			noImprovement = 0;
			if (chordOn) cs.mustRefactor = true;
		}
	}
	if (!converged && !block.linear && Number.isFinite(lastBlockedResidual)) {
		const stalled = lastBlockedResidual > NEWTON_RESIDUAL_TOLERANCE;
		if (stalled) this.stalledSamples += 1;
		else this.solvedButFlaggedSamples += 1;
		if (!dc && !stalled) this.unproductiveUntilSample.set(block.id, this.elapsedSamples + NEWTON_UNPRODUCTIVE_PROBATION_SAMPLES);
	}
	{
		const census = this.blockNewtonCensus.get(block.id);
		if (census === undefined) this.blockNewtonCensus.set(block.id, { samples: 1, exhausted: converged ? 0 : 1, peakIterations: used });
		else { census.samples += 1; if (!converged) census.exhausted += 1; if (used > census.peakIterations) census.peakIterations = used; }
	}
	return { solution: current, converged, used, worstNode, worstDelta };
}

function scratchIterateEliminated(this: any, block: MnaBlock, input: number, dt: number, state: number[], start: number[], dc: boolean, gmin: number = GMIN_SIEMENS, sourceScale: number = 1): IterateResult {
	const cfg = CONFIG;
	const size = block.nodeCount + block.auxCount;
	const standard = !dc && sourceScale === 1 && gmin === GMIN_SIEMENS && !block.linear;
	const ms = stateFor(this, block, size);
	let twin: SubSampleInfo["twin"] = null;
	let twinTrace: IterationTrace[] | null = null;
	if (cfg.fixedPointCheck && standard) {
		const snap = snapshotSide(this, block.id);
		const sc = this.iterationScratch.get(block.id);
		if (sc !== undefined) sc.denseDirty = true;
		twinTrace = cfg.onSubSample === null ? null : [];
		// The twin of an eliminated block is the FULL dense Newton solve of the unreduced
		// system (`iterate`'s path with no schedule): the independent reference, not the same
		// Schur-complement loop run twice.
		const t = coreIterate.call(this, block, input, dt, state, start, dc, gmin, sourceScale, SHIPPED, ms, true, null, false, twinTrace);
		twin = { used: t.used, converged: t.converged, solution: t.solution.slice(), relaxEngaged: twinTrace === null ? false : twinTrace.some((x) => x.relaxing), deviationTol: 0, iterations: twinTrace };
		restoreSide(this, block.id, snap);
	}
	const trace: IterationTrace[] | null = cfg.onSubSample === null ? null : [];
	const predicted = standard ? predictStart(ms.predictor, start, cfg.predictor) : null;
	if (standard) counters.subSamples += 1;
	if (predicted !== null) counters.predictorUsed += 1;
	const result = coreIterateEliminated.call(this, block, input, dt, state, predicted ?? start, dc, gmin, sourceScale, cfg, ms, false, standard, trace);
	if (standard) {
		counters.iterations += result.used;
		if (!result.converged) counters.nonConverged += 1;
		if (result.converged && result.used === 1) counters.oneStepConverged += 1;
		if (trace !== null && trace.some((x) => x.relaxing)) counters.relaxEngaged += 1;
		recordConverged(ms.predictor, result.solution, result.converged, cfg.predictor === "adaptive" || cfg.predictor === "adaptive2" || cfg.predictor === "adaptive3", cfg.predictor === "adaptive2", cfg.predictor === "adaptive3", result.used);
		if (twin !== null) {
			counters.twinSubSamples += 1;
			counters.twinIterations += twin.used;
			if (!twin.converged) counters.twinNonConverged += 1;
			if (twin.relaxEngaged) counters.twinRelaxEngaged += 1;
			if (result.used > twin.used) { counters.methodMoreIterations += 1; counters.extraIterationsVsTwin += result.used - twin.used; }
			if (result.used < twin.used) counters.methodFewerIterations += 1;
			const dev = result.converged && twin.converged ? deviationInToleranceUnits(result.solution, twin.solution) : Number.NaN;
			twin.deviationTol = dev;
			if (Number.isFinite(dev)) {
				if (dev > counters.worstDeviationTol) { counters.worstDeviationTol = dev; counters.worstDeviationBlock = block.id; counters.worstDeviationSample = this.elapsedSamples; }
				if (dev > 1) counters.deviationOver1 += 1;
				if (dev > 0.1) counters.deviationOver0p1 += 1;
			}
		}
		if (cfg.onSubSample !== null) {
			cfg.onSubSample({
				blockId: block.id, elapsedSamples: this.elapsedSamples, input, used: result.used, converged: result.converged,
				start: start.slice(), predicted: predicted === null ? null : predicted.slice(), solution: result.solution.slice(),
				iterations: trace ?? [], relaxEngaged: (trace ?? []).some((x) => x.relaxing), twin,
			});
		}
	}
	return result;
}

function coreIterateEliminated(this: any, block: MnaBlock, input: number, dt: number, state: number[], start: number[], dc: boolean, gmin: number, sourceScale: number, cfg: ScratchConfig, ms: BlockMethodState, isTwin: boolean, count: boolean, trace: IterationTrace[] | null): IterateResult {
	const ports = this.eliminationPorts.get(block.id);
	const scratch = this.eliminationScratch.get(block.id);
	if (ports === undefined || scratch === undefined) throw new Error(`no elimination scratch for block "${block.id}" -- prepare() was not called`);
	const { ports: portRows, portIndexOf, lRows, lIndexOf, size, linearStamps, nonlinearStamps } = ports;
	const portCount = portRows.length;
	const lCount = lRows.length;
	const blockIndex = this.blockIndexById.get(block.id) ?? 0;
	this.buildLinearBackground(block, linearStamps, dt, state, input, dc, gmin, sourceScale, blockIndex, scratch.linear, scratch.linearRhs);
	if (dc || gmin !== GMIN_SIEMENS || scratch.cachedGeneration !== this.controlGeneration) {
		for (let i = 0; i < lCount; i += 1) {
			const globalRow = lRows[i] as number;
			const sourceRow = scratch.linear[globalRow] as number[];
			const llRow = scratch.ll[i] as number[];
			for (let j = 0; j < lCount; j += 1) llRow[j] = sourceRow[lRows[j] as number] as number;
		}
		const { permutation } = factorLU(scratch.ll);
		for (let i = 0; i < lCount; i += 1) scratch.permutation[i] = permutation[i] as number;
		for (let p = 0; p < portCount; p += 1) {
			const globalP = portRows[p] as number;
			for (let i = 0; i < lCount; i += 1) scratch.zRhsScratch[i] = (scratch.linear[lRows[i] as number] as number[])[globalP] as number;
			solveLU(scratch.ll, scratch.permutation, scratch.zRhsScratch, scratch.z[p] as number[]);
		}
		for (let p = 0; p < portCount; p += 1) {
			const globalP = portRows[p] as number;
			const sourceRow = scratch.linear[globalP] as number[];
			const kRow = scratch.kReduced[p] as number[];
			for (let j = 0; j < portCount; j += 1) kRow[j] = sourceRow[portRows[j] as number] as number;
			for (let i = 0; i < lCount; i += 1) {
				const mPL = sourceRow[lRows[i] as number] as number;
				if (mPL === 0) continue;
				for (let j = 0; j < portCount; j += 1) kRow[j] -= mPL * ((scratch.z[j] as number[])[i] as number);
			}
		}
		if (!dc && gmin === GMIN_SIEMENS) scratch.cachedGeneration = this.controlGeneration;
		else scratch.cachedGeneration = -1;
	}
	for (let i = 0; i < lCount; i += 1) scratch.z0Rhs[i] = scratch.linearRhs[lRows[i] as number] as number;
	solveLU(scratch.ll, scratch.permutation, scratch.z0Rhs, scratch.z0);
	for (let p = 0; p < portCount; p += 1) {
		const globalP = portRows[p] as number;
		const sourceRow = scratch.linear[globalP] as number[];
		let u = scratch.linearRhs[globalP] as number;
		for (let i = 0; i < lCount; i += 1) {
			const mPL = sourceRow[lRows[i] as number] as number;
			if (mPL === 0) continue;
			u -= mPL * (scratch.z0[i] as number);
		}
		scratch.uReduced[p] = u;
	}
	const reconstructFull = (y: readonly number[], full: number[]): void => {
		for (let i = 0; i < lCount; i += 1) {
			let value = scratch.z0[i] as number;
			for (let p = 0; p < portCount; p += 1) value -= ((scratch.z[p] as number[])[i] as number) * (y[p] as number);
			full[lRows[i] as number] = value;
		}
		for (let p = 0; p < portCount; p += 1) full[portRows[p] as number] = y[p] as number;
	};
	for (let p = 0; p < portCount; p += 1) scratch.yCurrent[p] = start[portRows[p] as number] ?? 0;
	reconstructFull(scratch.yCurrent, scratch.fullCurrent);

	const iterations = this.maxNewtonIterations;
	let converged = false;
	let used = 0;
	let worstNode = -1;
	let worstDelta = 0;
	let current = scratch.fullCurrent;
	let next = scratch.fullNext;
	let yCurrentArr = scratch.yCurrent;
	let yNextArr = scratch.yNext;
	const methodsOn = !dc && sourceScale === 1 && gmin === GMIN_SIEMENS && !block.linear && !isTwin;
	const chordOn = methodsOn && cfg.chord !== "none";
	const cs = ms.chordReduced;
	if (chordOn) {
		if (cfg.chord === "within") cs.haveLU = false;
		cs.lastDelta = Number.POSITIVE_INFINITY;
		cs.chordSteps = 0;
		cs.mustRefactor = false;
		cs.broyden.length = 0;
		cs.lastStep = null;
		cs.lastStepClean = false;
		if (cs.residual.length !== portCount) { cs.residual = new Array<number>(portCount).fill(0); cs.direction = new Array<number>(portCount).fill(0); }
	} else if (!isTwin) {
		cs.haveLU = false;
	}
	let relaxing = false;
	let alpha = NEWTON_RELAXATION_FACTOR;
	let bestDelta = Number.POSITIVE_INFINITY;
	let noImprovement = 0;
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		used = iteration + 1;
		this.limitedIterate = false;
		this.limitedBy = null;
		this.limitedOpamp = null;
		for (let p = 0; p < portCount; p += 1) {
			(scratch.rawNl[portRows[p] as number] as number[]).fill(0);
			scratch.rawNlRhs[portRows[p] as number] = 0;
		}
		for (const stamp of nonlinearStamps as Stamp[]) {
			this.applyStamp(stamp, scratch.rawNl, scratch.rawNlRhs, block, dt, state, current, input, dc, sourceScale, blockIndex);
		}
		for (let p = 0; p < portCount; p += 1) {
			const jacobianRow = scratch.reducedJacobian[p] as number[];
			const kRow = scratch.kReduced[p] as number[];
			for (let j = 0; j < portCount; j += 1) jacobianRow[j] = kRow[j] as number;
			let rhsValue = scratch.uReduced[p] as number;
			const rawRow = scratch.rawNl[portRows[p] as number] as number[];
			for (let c = 0; c < size; c += 1) {
				const value = rawRow[c] as number;
				if (value === 0) continue;
				const portIndex = portIndexOf[c] as number;
				if (portIndex !== -1) { jacobianRow[portIndex] += value; continue; }
				const lIndex = lIndexOf[c] as number;
				for (let j = 0; j < portCount; j += 1) jacobianRow[j] -= value * ((scratch.z[j] as number[])[lIndex] as number);
				rhsValue -= value * (scratch.z0[lIndex] as number);
			}
			rhsValue += scratch.rawNlRhs[portRows[p] as number] as number;
			scratch.reducedRhs[p] = rhsValue;
		}
		if (count) { counters.assembles += 1; counters.convergenceChecks += 1; }
		if (count && iteration === 0 && this.limitedIterate) counters.limitedFirstIterations += 1;

		let reused = false;
		let refactoredOnStall = false;
		if (chordOn && cs.haveLU && !cs.mustRefactor && this.limitedIterate) { cs.mustRefactor = true; if (count) counters.limitedRefactors += 1; }
		if (chordOn && cs.haveLU && !cs.mustRefactor) {
			reused = true;
			const r = cs.residual;
			residualVector(scratch.reducedJacobian, scratch.reducedRhs, yCurrentArr, null, portCount, r);
			if (cfg.broyden && cs.lastStep !== null && cs.lastStepClean && !this.limitedIterate) {
				const s = cs.lastStep;
				let ss = 0;
				for (let i = 0; i < portCount; i += 1) ss += (s[i] as number) * (s[i] as number);
				if (ss > 0) {
					const u = new Array<number>(portCount);
					for (let i = 0; i < portCount; i += 1) u[i] = -(r[i] as number) / ss;
					const w = new Array<number>(portCount).fill(0);
					solveLU(cs.lu as number[][], cs.perm as number[], u, w);
					applyBroyden(cs.broyden, w, portCount);
					let denom = 1;
					for (let i = 0; i < portCount; i += 1) denom += (s[i] as number) * (w[i] as number);
					if (Math.abs(denom) > 1e-12) { cs.broyden.push({ w, v: s.slice(), denom }); if (count) counters.broydenUpdates += 1; }
				}
			}
			const d = cs.direction;
			solveLU(cs.lu as number[][], cs.perm as number[], r, d);
			if (cs.broyden.length > 0) applyBroyden(cs.broyden, d, portCount);
			for (let i = 0; i < portCount; i += 1) yNextArr[i] = (yCurrentArr[i] as number) + (d[i] as number);
			if (count) counters.reuseSolves += 1;
			cs.chordSteps += 1;
		} else if (chordOn) {
			if (cs.lu === null || cs.lu.length !== portCount) { cs.lu = Array.from({ length: portCount }, () => new Array<number>(portCount).fill(0)); cs.perm = new Array<number>(portCount).fill(0); }
			for (let row = 0; row < portCount; row += 1) {
				const dst = (cs.lu as number[][])[row] as number[];
				const src = scratch.reducedJacobian[row] as number[];
				for (let col = 0; col < portCount; col += 1) dst[col] = src[col] as number;
			}
			const { permutation } = factorLU(cs.lu as number[][]);
			for (let i = 0; i < portCount; i += 1) (cs.perm as number[])[i] = permutation[i] as number;
			solveLU(cs.lu as number[][], cs.perm as number[], scratch.reducedRhs, yNextArr);
			cs.haveLU = true; cs.luIsSparse = false;
			if (cs.mustRefactor) refactoredOnStall = true;
			cs.mustRefactor = false; cs.chordSteps = 0; cs.broyden.length = 0; cs.lastDelta = Number.POSITIVE_INFINITY;
			if (count) counters.factorisations += 1;
		} else {
			solve(scratch.reducedJacobian, scratch.reducedRhs, yNextArr);
			if (count) counters.factorisations += 1;
		}
		if (relaxing) {
			for (let i = 0; i < portCount; i += 1) yNextArr[i] = (yCurrentArr[i] as number) + alpha * ((yNextArr[i] as number) - (yCurrentArr[i] as number));
		}
		reconstructFull(yNextArr, next);
		const delta = maxAbsDifference(next, current);
		worstNode = worstDifferenceIndex(next, current);
		worstDelta = delta;
		if (delta < bestDelta * 0.999) {
			bestDelta = delta;
			noImprovement = 0;
			if (relaxing) {
				if (delta < 0.05) { relaxing = false; alpha = NEWTON_RELAXATION_FACTOR; }
				else alpha = Math.min(NEWTON_RELAXATION_FACTOR, alpha * 1.15);
			}
		} else {
			noImprovement += 1;
			if (!relaxing) {
				if (noImprovement >= NEWTON_NON_CONTRACTING_LIMIT && iteration >= NEWTON_RELAXATION_EARLIEST_ITERATION) { relaxing = true; noImprovement = 0; }
			} else if (noImprovement >= NEWTON_NON_CONTRACTING_LIMIT) { alpha = Math.max(0.2, alpha * 0.7); noImprovement = 0; }
		}
		if (this.limiterTrace) {
			this.limitedIterationCount += this.limitedIterate ? 1 : 0;
			this.limitedIterationPerSample.push(this.limitedIterate ? 1 : 0);
		}
		let convergedNow = withinTolerance(next, current) && !this.limitedIterate;
		if (chordOn) {
			if (reused) {
				const ratio = delta / cs.lastDelta;
				if (convergedNow && cfg.chordAccept === "bound" && Number.isFinite(ratio) && ratio > 0) {
					const factor = ratio / Math.max(1e-9, 1 - Math.min(ratio, 0.999));
					if (factor > 1 && !withinToleranceScaled(next, current, factor)) { convergedNow = false; if (count) counters.boundRejects += 1; }
				}
				if (!convergedNow && !cfg.chordStallDisabled) {
					if (delta > cfg.chordRatio * cs.lastDelta) { cs.mustRefactor = true; if (count) counters.stallRefactors += 1; }
					else if (cs.chordSteps >= cfg.chordMaxSteps) { cs.mustRefactor = true; if (count) counters.capRefactors += 1; }
				}
			}
			cs.lastDelta = delta;
			if (cs.lastStep === null || cs.lastStep.length !== portCount) cs.lastStep = new Array<number>(portCount).fill(0);
			for (let i = 0; i < portCount; i += 1) (cs.lastStep as number[])[i] = (yNextArr[i] as number) - (yCurrentArr[i] as number);
			cs.lastStepClean = reused && !relaxing;
		}
		if (trace !== null) trace.push({ iteration, delta, worstNode, limited: this.limitedIterate, limitedBy: this.limitedBy, relaxing, alpha, reused, refactoredOnStall, residual: Number.NaN });
		const swapFull = current; current = next; next = swapFull;
		const swapY = yCurrentArr; yCurrentArr = yNextArr; yNextArr = swapY;
		if (convergedNow) { converged = true; break; }
	}
	{
		const census = this.blockNewtonCensus.get(block.id);
		if (census === undefined) this.blockNewtonCensus.set(block.id, { samples: 1, exhausted: converged ? 0 : 1, peakIterations: used });
		else { census.samples += 1; if (!converged) census.exhausted += 1; if (used > census.peakIterations) census.peakIterations = used; }
	}
	return { solution: current, converged, used, worstNode, worstDelta };
}

// --- install / uninstall ------------------------------------------------------------------
const proto = ReferenceRuntime.prototype as any;
const shippedIterate = proto.iterate;
const shippedIterateEliminated = proto.iterateEliminated;
export function install(): void {
	proto.iterate = scratchIterate;
	proto.iterateEliminated = scratchIterateEliminated;
}
export function uninstall(): void {
	proto.iterate = shippedIterate;
	proto.iterateEliminated = shippedIterateEliminated;
}
export function installed(): boolean {
	return proto.iterate === scratchIterate;
}

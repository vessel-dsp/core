// Value-aware schedule construction (`computeNumericRepivot`).
//
// The compiler owns order construction -- pattern-based (`computeSparseSchedule`)
// and value-based (here). These are the builder-level controls for the numeric
// pivoting work: a synthetic matrix with a known tiny diagonal and a known-good
// alternative must pivot away from the tiny entry; a matrix where every
// candidate is tiny must refuse (`null`) rather than divide silently; the
// choice must be deterministic; and the emitted order must replay to the dense
// solution on a well-conditioned matrix. End-to-end corpus behaviour (adoption,
// audio agreement) is pinned by the runtime's settle tests and the
// `docs/spikes/2026-10-08-numeric-pivoting.md` instruments, not here.

import { describe, expect, it } from "bun:test";
import {
	NUMERIC_REPIVOT_TAU,
	computeNumericRepivot,
} from "../src/sparse-schedule";
import type { SparseSchedule } from "../src/types";

function patternSchedule(size: number, pattern: readonly number[]): SparseSchedule {
	const gatherRow: number[] = [];
	const gatherColumn: number[] = [];
	for (const key of pattern) {
		gatherRow.push(Math.floor(key / size));
		gatherColumn.push(key % size);
	}
	return {
		ops: [],
		slots: gatherRow.length,
		factorCount: 0,
		gatherRow,
		gatherColumn,
		size,
		sparseOps: 0,
		denseOps: 0,
		unprovenPivots: 0,
	};
}

function replay(
	schedule: SparseSchedule,
	matrix: readonly (readonly number[])[],
	rhs: readonly number[],
): number[] {
	const values = new Array<number>(schedule.slots).fill(0);
	for (let slot = 0; slot < schedule.slots; slot += 1) {
		values[slot] = matrix[schedule.gatherRow[slot] as number]?.[
			schedule.gatherColumn[slot] as number
		] as number;
	}
	const scratchRhs = [...rhs];
	const factors = new Array<number>(schedule.factorCount).fill(0);
	const out = new Array<number>(schedule.size).fill(0);
	let accumulator = 0;
	for (let at = 0; at < schedule.ops.length; at += 4) {
		const op = schedule.ops[at] as number;
		const a = schedule.ops[at + 1] as number;
		const b = schedule.ops[at + 2] as number;
		const c = schedule.ops[at + 3] as number;
		switch (op) {
			case 0:
				factors[a] = (values[b] as number) / (values[c] as number);
				break;
			case 1:
				values[a] = (values[a] as number) - (factors[b] as number) * (values[c] as number);
				break;
			case 2:
				scratchRhs[a] =
					(scratchRhs[a] as number) - (factors[b] as number) * (scratchRhs[c] as number);
				break;
			case 3:
				accumulator = scratchRhs[a] as number;
				break;
			case 4:
				accumulator = accumulator - (values[a] as number) * (out[b] as number);
				break;
			case 5:
				out[a] = accumulator / (values[b] as number);
				break;
			case 6:
				if (!(Math.abs(values[a] as number) >= 1e-18)) {
					throw new Error("pivot floor tripped in re-pivot replay");
				}
				break;
			default:
				throw new Error(`unknown opcode ${op}`);
		}
	}
	return out;
}

function denseSolve(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] {
	const size = rhs.length;
	const a = matrix.map((row) => [...row]);
	const b = [...rhs];
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (Math.abs(a[row]?.[column] ?? 0) > Math.abs(a[pivot]?.[column] ?? 0)) {
				pivot = row;
			}
		}
		const swap = a[column] as number[];
		a[column] = a[pivot] as number[];
		a[pivot] = swap;
		const bSwap = b[column] as number;
		b[column] = b[pivot] as number;
		b[pivot] = bSwap;
		const diagonal = a[column]?.[column] as number;
		for (let row = column + 1; row < size; row += 1) {
			const factor = (a[row]?.[column] as number) / diagonal;
			for (let col = column; col < size; col += 1) {
				(a[row] as number[])[col] =
					(a[row]?.[col] as number) - factor * (a[column]?.[col] as number);
			}
			b[row] = (b[row] as number) - factor * (b[column] as number);
		}
	}
	const x = new Array<number>(size).fill(0);
	for (let row = size - 1; row >= 0; row -= 1) {
		let sum = b[row] as number;
		for (let column = row + 1; column < size; column += 1) {
			sum -= (a[row]?.[column] as number) * (x[column] as number);
		}
		x[row] = sum / (a[row]?.[row] as number);
	}
	return x;
}

describe("numeric re-pivot", () => {
	it("is deterministic and emits one pivot guard per unknown", () => {
		const size = 4;
		const pattern = Array.from({ length: size * size }, (_, index) => index);
		const schedule = patternSchedule(size, pattern);
		const matrix = [
			[4, 1, 0, 0],
			[1, 5, 1, 0],
			[0, 1, 6, 1],
			[0, 0, 1, 7],
		];
		const first = computeNumericRepivot(schedule, size, matrix);
		const second = computeNumericRepivot(schedule, size, matrix);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect((first as SparseSchedule).ops.join(",")).toBe(
			(second as SparseSchedule).ops.join(","),
		);
		let guards = 0;
		for (let at = 0; at < (first?.ops.length ?? 0); at += 4) {
			if (first?.ops[at] === 6) guards += 1;
		}
		expect(guards).toBe(size);
	});

	it("rejects a tiny pivot in favour of a numerically strong entry", () => {
		const size = 3;
		const pattern = Array.from({ length: size * size }, (_, index) => index);
		const schedule = patternSchedule(size, pattern);
		const matrix = [
			[1e-12, 1, 0],
			[1, 2, 1],
			[0, 1, 3],
		];
		const repivoted = computeNumericRepivot(schedule, size, matrix, NUMERIC_REPIVOT_TAU);
		expect(repivoted).not.toBeNull();
		// The first op-6 guard must not sit on the (0,0) diagonal: its column max is 1.
		const firstGuard = repivoted?.ops[1] as number;
		const row = repivoted?.gatherRow[firstGuard] as number;
		const column = repivoted?.gatherColumn[firstGuard] as number;
		expect(row === 0 && column === 0).toBe(false);
	});

	it("returns null when no candidate meets the threshold", () => {
		const size = 2;
		const pattern = [0, 1, 2, 3];
		const schedule = patternSchedule(size, pattern);
		const matrix = [
			[0, 0],
			[0, 0],
		];
		expect(computeNumericRepivot(schedule, size, matrix)).toBeNull();
	});

	it("returns null at tau 0 only when a column is empty, and otherwise orders plainly", () => {
		// tau = 0 keeps every nonzero column eligible: a full matrix still
		// orders (the old pattern-only behaviour), while an empty column --
		// nothing to pivot on at any threshold -- refuses.
		const size = 3;
		const full = patternSchedule(
			size,
			Array.from({ length: size * size }, (_, index) => index),
		);
		const matrix = [
			[1e-12, 1, 0],
			[1, 2, 1],
			[0, 1, 3],
		];
		expect(computeNumericRepivot(full, size, matrix, 0)).not.toBeNull();
		const empty: number[][] = [
			[0, 0],
			[0, 0],
		];
		expect(
			computeNumericRepivot(patternSchedule(2, [0, 1, 2, 3]), 2, empty, 0),
		).toBeNull();
	});

	it("replays to the dense solution on a well-conditioned matrix", () => {
		const size = 5;
		const pattern: number[] = [];
		for (let row = 0; row < size; row += 1) {
			for (let column = 0; column < size; column += 1) {
				pattern.push(row * size + column);
			}
		}
		const schedule = patternSchedule(size, pattern);
		const matrix: number[][] = [];
		for (let row = 0; row < size; row += 1) {
			matrix.push(
				Array.from({ length: size }, (_, column) => {
					if (row === column) return 6 + row * 0.5;
					if (Math.abs(row - column) === 1) return 0.7;
					return 0.05;
				}),
			);
		}
		const rhs = [1, -2, 3, 0.5, -1];
		const repivoted = computeNumericRepivot(schedule, size, matrix);
		expect(repivoted).not.toBeNull();
		const replayed = replay(repivoted as SparseSchedule, matrix, rhs);
		const dense = denseSolve(matrix, rhs);
		let differenceSquares = 0;
		let referenceSquares = 0;
		for (let index = 0; index < size; index += 1) {
			const difference = (replayed[index] as number) - (dense[index] as number);
			differenceSquares += difference * difference;
			referenceSquares += (dense[index] as number) ** 2;
		}
		const relative = Math.sqrt(differenceSquares) / Math.sqrt(referenceSquares);
		expect(relative).toBeLessThan(1e-9);
	});
});

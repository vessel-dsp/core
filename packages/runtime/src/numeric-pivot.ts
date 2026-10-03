// Runtime numeric re-pivot: choose a sparse elimination order from the block's
// actual operating-point matrix instead of the compiler's value-blind pattern.
//
// The compiler's schedule is built from symbol sets, so a pivot that is
// structurally present but numerically tiny (a node diagonal whose only
// unconditional contributor is `gmin`) can be chosen because it minimises fill.
// Replaying that order divides by ~1e-12 against entries of order 1e2, which is
// the `boss-aw-2` non-convergence and the `hiwatt`/`tr-2` sparse-vs-dense
// disagreement. `settlePivotOrders` validates the shipped order on the assembled
// operating-point matrix and, when it disagrees with dense, used to drop the
// block to dense for the life of the engine. This module gives it a second
// order to try first: threshold Markowitz (a pivot must be at least `tau` of its
// column's remaining maximum) over the schedule's own filled pattern, with the
// candidate scan in ascending row/column order so both consoles choose the same
// pivots.
//
// The interpreter (`runSparseSchedule`) and the C++ port in `Engine.cpp` replay
// the returned schedule exactly as the compiler's; the caller re-validates it
// against dense before adopting it, so a failed re-pivot degrades to dense
// rather than to a wrong answer.

import type { SparseSchedule } from "@vessel-dsp/compiler";

export const NUMERIC_REPIVOT_TAU = 1e-3;

type Pivot = { readonly row: number; readonly column: number };

export function computeNumericRepivot(
	schedule: SparseSchedule,
	size: number,
	matrix: readonly (readonly number[])[],
	tau: number = NUMERIC_REPIVOT_TAU,
): SparseSchedule | null {
	const rows: Set<number>[] = Array.from({ length: size }, () => new Set<number>());
	const columns: Set<number>[] = Array.from({ length: size }, () => new Set<number>());
	for (let slot = 0; slot < schedule.gatherRow.length; slot += 1) {
		const row = schedule.gatherRow[slot] as number;
		const column = schedule.gatherColumn[slot] as number;
		(rows[row] as Set<number>).add(column);
		(columns[column] as Set<number>).add(row);
	}

	const working = matrix.map((row) => [...row]);
	const doneRow = new Array<boolean>(size).fill(false);
	const doneColumn = new Array<boolean>(size).fill(false);
	const pivots: Pivot[] = [];

	for (let step = 0; step < size; step += 1) {
		let bestRow = -1;
		let bestColumn = -1;
		let bestKey = Infinity;
		for (let row = 0; row < size; row += 1) {
			if (doneRow[row] === true) continue;
			const rowSet = rows[row] as Set<number>;
			let rowCount = 0;
			for (const column of rowSet) {
				if (doneColumn[column] !== true) rowCount += 1;
			}
			if (rowCount === 0) continue;
			for (const column of rowSet) {
				if (doneColumn[column] === true) continue;
				let columnCount = 0;
				let columnMax = 0;
				for (const other of columns[column] as Set<number>) {
					if (doneRow[other] === true) continue;
					columnCount += 1;
					const magnitude = Math.abs(
						((working[other] as number[])[column] as number) ?? 0,
					);
					if (magnitude > columnMax) columnMax = magnitude;
				}
				const value = Math.abs(((working[row] as number[])[column] as number) ?? 0);
				if (!(columnMax > 0) || value < tau * columnMax) continue;
				const key =
					(rowCount - 1) * (columnCount - 1) * 2 + (row === column ? 0 : 1);
				if (
					key < bestKey ||
					(key === bestKey &&
						(row < bestRow || (row === bestRow && column < bestColumn)))
				) {
					bestKey = key;
					bestRow = row;
					bestColumn = column;
				}
			}
		}
		if (bestRow < 0) {
			return null;
		}
		const pivotValue = (working[bestRow] as number[])[bestColumn] as number;
		const pivotRowSymbolic = [...(rows[bestRow] as Set<number>)].filter(
			(column) => doneColumn[column] !== true && column !== bestColumn,
		);
		const pivotColumnSymbolic = [...(columns[bestColumn] as Set<number>)].filter(
			(row) => doneRow[row] !== true && row !== bestRow,
		);
		for (const row of pivotColumnSymbolic) {
			for (const column of pivotRowSymbolic) {
				if (!(rows[row] as Set<number>).has(column)) {
					(rows[row] as Set<number>).add(column);
					(columns[column] as Set<number>).add(row);
				}
			}
		}
		for (const row of pivotColumnSymbolic) {
			const target = working[row] as number[];
			const factor = (target[bestColumn] as number) / pivotValue;
			if (factor !== 0) {
				const source = working[bestRow] as number[];
				for (let column = 0; column < size; column += 1) {
					if (doneColumn[column] !== true && column !== bestColumn) {
						target[column] =
							(target[column] as number) - factor * (source[column] as number);
					}
				}
			}
			target[bestColumn] = 0;
		}
		pivots.push({ row: bestRow, column: bestColumn });
		doneRow[bestRow] = true;
		doneColumn[bestColumn] = true;
	}
	if (pivots.length !== size) {
		return null;
	}

	const slotOf = new Map<number, number>();
	const gatherRow: number[] = [];
	const gatherColumn: number[] = [];
	for (let row = 0; row < size; row += 1) {
		const sorted = [...(rows[row] as Set<number>)].sort((a, b) => a - b);
		for (const column of sorted) {
			slotOf.set(row * size + column, gatherRow.length);
			gatherRow.push(row);
			gatherColumn.push(column);
		}
	}
	const slot = (row: number, column: number): number => {
		const found = slotOf.get(row * size + column);
		if (found === undefined) {
			throw new Error(`numeric re-pivot: no slot for (${row}, ${column})`);
		}
		return found;
	};
	const liveRows: Set<number>[] = Array.from({ length: size }, () => new Set<number>());
	const liveColumns: Set<number>[] = Array.from({ length: size }, () => new Set<number>());
	for (let slotIndex = 0; slotIndex < schedule.gatherRow.length; slotIndex += 1) {
		const row = schedule.gatherRow[slotIndex] as number;
		const column = schedule.gatherColumn[slotIndex] as number;
		(liveRows[row] as Set<number>).add(column);
		(liveColumns[column] as Set<number>).add(row);
	}
	const eliminatedRow = new Array<boolean>(size).fill(false);
	const eliminatedColumn = new Array<boolean>(size).fill(false);
	const ops: number[] = [];
	let factorCount = 0;
	let sparseOps = 0;
	for (const pivot of pivots) {
		ops.push(6, slot(pivot.row, pivot.column), 0, 0);
		const pivotRow = [...(liveRows[pivot.row] as Set<number>)]
			.filter((column) => eliminatedColumn[column] !== true && column !== pivot.column)
			.sort((a, b) => a - b);
		const pivotColumn = [...(liveColumns[pivot.column] as Set<number>)]
			.filter((row) => eliminatedRow[row] !== true && row !== pivot.row)
			.sort((a, b) => a - b);
		for (const row of pivotColumn) {
			const factor = factorCount;
			factorCount += 1;
			ops.push(0, factor, slot(row, pivot.column), slot(pivot.row, pivot.column));
			for (const column of pivotRow) {
				if (!(liveRows[row] as Set<number>).has(column)) {
					(liveRows[row] as Set<number>).add(column);
					(liveColumns[column] as Set<number>).add(row);
				}
				ops.push(1, slot(row, column), factor, slot(pivot.row, column));
				sparseOps += 1;
			}
			ops.push(2, row, factor, pivot.row);
			sparseOps += 1;
		}
		eliminatedRow[pivot.row] = true;
		eliminatedColumn[pivot.column] = true;
	}
	for (let step = pivots.length - 1; step >= 0; step -= 1) {
		const pivot = pivots[step] as Pivot;
		ops.push(3, pivot.row, 0, 0);
		for (let later = step + 1; later < pivots.length; later += 1) {
			const column = (pivots[later] as Pivot).column;
			if ((liveRows[pivot.row] as Set<number>).has(column)) {
				ops.push(4, slot(pivot.row, column), column, 0);
				sparseOps += 1;
			}
		}
		ops.push(5, pivot.column, slot(pivot.row, pivot.column), 0);
	}
	return {
		ops,
		slots: gatherRow.length,
		factorCount,
		gatherRow,
		gatherColumn,
		size,
		sparseOps,
		denseOps: (size * size * size - size) / 3,
		unprovenPivots: 0,
	};
}

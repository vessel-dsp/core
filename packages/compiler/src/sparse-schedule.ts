import {
	stampAuxRows,
	stampNodeValue,
	stampShape,
} from "./stamp-partition";
import type { SparseSchedule, Stamp } from "./types.js";

/**
 * Default threshold for value-aware re-pivoting (see `computeNumericRepivot`).
 *
 * A pivot must be at least this fraction of its column's remaining maximum to
 * be chosen. Measured across the corpus 2026-10-08: every tau in
 * 3e-4 .. 1e-1 fixes the `boss-aw-2` non-convergence with identical audio and
 * fill falling as tau falls; tau = 0.3 breaks `boss-aw-2` (34 iterations, 1.2
 * relative disagreement) and tau = 1e-4 degrades `boss-ch-1` (1.3e-5). 1e-3
 * sits mid-window. One value for all circuits; see
 * `docs/spikes/2026-10-08-numeric-pivoting.md`.
 */
export const NUMERIC_REPIVOT_TAU = 1e-3;

/**
 * Every matrix entry a stamp can write, over-approximated as the full square over the stamp's
 * own terminals.
 *
 * Read off the shape table in `stamp-partition.ts` rather than restated here. `terminalNodes`
 * lets a kind narrow the set -- only `vccs` does, to its output pair -- and `terminalsDropGround`
 * lets it drop ground, which `vccs` also does and nothing else may, because `schedulePattern`
 * removes row 0 globally but keeps column 0.
 *
 * Order is not significant: the caller expands these into every (row, column) pair and collects
 * them in a `Set`.
 */
export function stampTerminals(
	stamp: Stamp,
	nodeCount: number,
): readonly number[] {
	const shape = stampShape(stamp);
	const fields = shape.terminalNodes ?? shape.nodes;
	const rows = [
		...stampAuxRows(stamp, nodeCount),
		...fields.map((field) => stampNodeValue(stamp, field)),
	];
	return shape.terminalsDropGround ? rows.filter((row) => row !== 0) : rows;
}

/**
 * Entries that are provably nonzero at every control position and every Newton iterate,
 * and are therefore the only ones allowed to be pivots.
 *
 * **Two conditions, and both are load-bearing. An entry belongs here only when the stamp
 * writes it (a) in the direction being claimed and (b) on every iterate.** Marking an entry
 * the stamp leaves zero does not produce a wrong answer -- the runtime's pivot guard catches
 * the collapse and re-solves densely -- but it produces a *silently dense* block, which is
 * worse than a slow one because nothing reports it. Measured 2026-09-18 on the shipping
 * console: `boss-ch-1` gave its schedule up inside `prepare()` and ran 100x100 dense for the
 * whole session (12.8x real time), `boss-ce-5` tripped the guard on half its iterations and
 * paid for the schedule *and* the dense solve (6.6x), and `boss-ce-2`, `boss-ce-2b`,
 * `boss-dm-2` and `boss-dd-3b` abandoned within their first 64 audio iterations. Every one of
 * those traced back to an entry marked here that the owning stamp cannot guarantee. See
 * `thoughts/shared/2026-09-18-sparse-schedule-runtime-audit.md`.
 *
 * So `pair()` is for symmetric writes only. A stamp that writes `matrix[row][column]` and not
 * its transpose -- every controlled-source coupling in this file's device set does exactly
 * that -- marks the one entry with `eligible.add`, or marks nothing when the value can vanish.
 *
 * **What this does NOT establish is that an eligible pivot is numerically usable.** Every node
 * diagonal is listed below because the runtime adds `gmin` to it, which is true and nearly
 * useless: a pivot of 1e-12 against entries of order 1e2 is a growth factor of 1e14, and dense
 * partial pivoting would never choose it. That is a separate, open defect (`boss-aw-2` fails to
 * converge on the sparse path and converges in four iterations densely), and it cannot be fixed
 * from the pattern alone -- it needs the pivot search to see magnitudes. Recorded in §6 of the
 * audit above.
 */
export function provablyNonzeroEntries(
	block: { nodeCount: number; stamps: readonly Stamp[] },
	size: number,
): Set<number> {
	const eligible = new Set<number>();
	for (let node = 0; node < block.nodeCount; node += 1) {
		eligible.add(node * size + node);
	}
	/** For entries a stamp writes in BOTH directions on every iterate, and only those. */
	const pair = (row: number, column: number): void => {
		eligible.add(row * size + column);
		eligible.add(column * size + row);
	};
	const auxRow = (sourceIndex: number, offset = 0): number =>
		block.nodeCount + sourceIndex + offset;
	for (const stamp of block.stamps) {
		switch (stamp.kind) {
			// **The three by-inspection cases, and they were the largest omission.** A resistor's
			// conductance is `g > 0` at every control position and every iterate; a capacitor's
			// trapezoidal companion is `2C/dt`; an inductor's is `dt/2L` (scaled by `1/(1+Rk)`
			// when a winding resistance is declared, which is still strictly positive). None can
			// vanish, so all four entries of each pair are provable by inspection rather than by
			// analysis.
			//
			// Their absence is why ~74% of every packet's pivot candidates read as "unproven" --
			// 407 of 544 on `mxr-carbon-copy` and **185 of 268 on healthy `marshall-jtm45`** --
			// which left Markowitz choosing from a quarter of its real options everywhere, and
			// forced 10 unproven pivots on carbon-copy that then failed 144,188 times.
			case "conductance":
			case "capacitor":
			case "inductor": {
				const { a, b } = stamp;
				if (a === b) {
					break;
				}
				pair(a, a);
				pair(b, b);
				pair(a, b);
				break;
			}
			case "dc-source":
			case "ac-source": {
				if (stamp.positive === stamp.negative) {
					break;
				}
				const row = auxRow(stamp.sourceIndex);
				pair(row, stamp.positive);
				pair(row, stamp.negative);
				break;
			}
			case "logic-divider": {
				if (stamp.qNode === stamp.gndNode) {
					break;
				}
				const row = auxRow(stamp.sourceIndex);
				pair(row, stamp.qNode);
				pair(row, stamp.gndNode);
				break;
			}
			case "analog-switch": {
				// **The channel only.** `g = gOff + (gOn - gOff) * sigmoid` is bounded below by
				// `gOff = 1/offOhms > 0` at every control voltage, and `stampConductance` writes
				// all four of its cells, so the channel pair is provable.
				//
				// The gate couplings are not, on both counts. `coupling = dg/dvCtrl * (vA - vB)`
				// is written into `matrix[a][control]` and `matrix[b][control]` and **never their
				// transposes**, and it is exactly zero twice over: the sigmoid derivative
				// underflows once the gate is more than ~8 V past threshold (which is where a
				// CMOS switch spends all of its time), and `vA - vB` is zero across a closed
				// switch feeding a settled node. `boss-dd-3b` pivoted on `(node23, node6)` and
				// abandoned its schedule 27 iterations into the operating point.
				if (stamp.a !== stamp.b) {
					pair(stamp.a, stamp.b);
				}
				break;
			}
			case "compandor": {
				// **Nothing is provable here.** `(sumNode, cellIn)` carries `-gCell`, where
				// `gCell` is the *envelope* state: zero until the rectifier's capacitor has
				// charged, which on a fresh `prepare()` is every iterate of the operating point
				// and the first few hundred samples after it. It is also written one way only.
				// `mxr-carbon-copy` and `electro-harmonix-deluxe-memory-man` carry two of these
				// each on their dominant block.
				break;
			}
			case "clock-driver": {
				// **The phase rows and their own diagonals; NOT the supply couplings.**
				//
				// Each phase row is an ideal source row for one output pin: `matrix[row][cpN] +=
				// 1`, `matrix[cpN][row] += 1`, `matrix[row][row] -= 1`. All three are
				// unconditional, the first two are symmetric, and an aux row belongs to exactly
				// one stamp, so nothing else can cancel the -1 on its diagonal. That diagonal is
				// the best pivot in the block and was previously not listed at all.
				//
				// The supply couplings are the opposite of provable. `couple(theta < 0.5 ? vdd :
				// gnd, row1, 1.0)` writes ONE of the two pins per iterate, into `matrix[row][pin]`
				// and never the transpose. Both were listed, so at any instant at least half of
				// what was marked was zero, and the alternation guaranteed that a pivot chosen on
				// one phase collapsed on the next. This is what `boss-ch-1` (aux10, node2),
				// `boss-ce-5` (aux4, node1), `boss-ce-2` (node2, aux5 -- a transpose that no
				// stamp ever writes) and `boss-dm-2` (node1, aux7) each pivoted on.
				//
				// The *pattern* still needs both pins, and still has them: `stampTerminals` reads
				// the shape table, which is a different question from what may be a pivot. The
				// bug the old comment here describes -- a pattern missing a cell the stamp writes
				// -- is real and is not this set's job to prevent.
				const row1 = auxRow(stamp.sourceIndex);
				pair(row1, stamp.cp1);
				eligible.add(row1 * size + row1);
				const row2 = auxRow(stamp.sourceIndex, 1);
				pair(row2, stamp.cp2);
				eligible.add(row2 * size + row2);
				const row3 = auxRow(stamp.sourceIndex, 2);
				pair(row3, stamp.vgg);
				eligible.add(row3 * size + row3);
				break;
			}
			case "comparator": {
				// **The pull-down only.** `gCell = gOn * sigma + gOff` is bounded below by
				// `gOff = 1/floatOhms > 0` and goes through `stampConductance`, so it is
				// symmetric and cannot vanish.
				//
				// The input couplings carry `gControl = gOn * dsigma * (vOut - vVee)`, written
				// into the output and vee rows only, never the transpose, and zero whenever the
				// comparator is saturated -- which for a comparator is its entire working life,
				// the linear band being a few millivolts wide. `moogerfooger-mf-102` carries four.
				if (stamp.output !== stamp.vee) {
					pair(stamp.output, stamp.vee);
				}
				break;
			}
			case "transformer": {
				const nodes = [
					stamp.primaryPlus,
					stamp.primaryMinus,
					stamp.secondaryPlus,
					stamp.secondaryMinus,
				];
				if (new Set(nodes).size !== 4) {
					break;
				}
				const row = block.nodeCount + stamp.sourceIndex;
				pair(row, stamp.primaryPlus);
				pair(row, stamp.primaryMinus);
				break;
			}
			case "input-source":
			case "macro-audio-source":
				pair(auxRow(stamp.sourceIndex), stamp.node);
				break;
			case "ideal-opamp":
				eligible.add(
					stamp.output * size + auxRow(stamp.sourceIndex),
				);
				break;
			case "vccs": {
				const gm = stamp.transconductance;
				if (gm !== 0) {
					if (stamp.outP !== 0) {
						if (stamp.inP !== 0) eligible.add(stamp.outP * size + stamp.inP);
						if (stamp.inN !== 0) eligible.add(stamp.outP * size + stamp.inN);
					}
					if (stamp.outN !== 0) {
						if (stamp.inP !== 0) eligible.add(stamp.outN * size + stamp.inP);
						if (stamp.inN !== 0) eligible.add(stamp.outN * size + stamp.inN);
					}
				}
				break;
			}
			case "ota": {
				if (stamp.bias !== stamp.vee) {
					pair(stamp.bias, stamp.vee);
				}
				break;
			}
			default:
				break;
		}
	}
	return eligible;
}

/**
 * The block's structural pattern: every entry any stamp can write, plus the gmin diagonals,
 * with ground-pin overwrite applied.
 */
export function schedulePattern(
	block: { nodeCount: number; stamps: readonly Stamp[] },
	size: number,
): Set<number> {
	const pattern = new Set<number>();
	for (const stamp of block.stamps) {
		const terminals = stampTerminals(stamp, block.nodeCount);
		for (const row of terminals) {
			for (const column of terminals) {
				pattern.add(row * size + column);
			}
		}
	}
	for (let node = 1; node < block.nodeCount; node += 1) {
		pattern.add(node * size + node);
	}
	for (let column = 0; column < size; column += 1) {
		pattern.delete(column);
	}
	pattern.add(0);
	return pattern;
}

/**
 * Work out the elimination order and emit its opcode stream.
 *
 * Returns null when the pattern cannot be eliminated at all (a structurally singular block).
 */
export function computeSparseSchedule(
	block: { nodeCount: number; auxCount: number; stamps: readonly Stamp[] },
): SparseSchedule | null {
	const size = block.nodeCount + block.auxCount;
	if (size === 0) {
		return null;
	}
	const pattern = schedulePattern(block, size);
	const eligible = provablyNonzeroEntries(block, size);

	const rows: Set<number>[] = Array.from(
		{ length: size },
		() => new Set<number>(),
	);
	const columns: Set<number>[] = Array.from(
		{ length: size },
		() => new Set<number>(),
	);
	for (const key of pattern) {
		const row = Math.floor(key / size);
		rows[row]?.add(key % size);
		columns[key % size]?.add(row);
	}

	const doneRow = new Set<number>();
	const doneColumn = new Set<number>();
	const pivots: { row: number; column: number }[] = [];
	let unprovenPivots = 0;
	for (let step = 0; step < size; step += 1) {
		let bestRow = -1;
		let bestColumn = -1;
		let bestKey = Infinity;
		let bestProven = false;
		for (let row = 0; row < size; row += 1) {
			if (doneRow.has(row)) {
				continue;
			}
			let rowCount = 0;
			for (const column of rows[row] as Set<number>) {
				if (!doneColumn.has(column)) {
					rowCount += 1;
				}
			}
			if (rowCount === 0) {
				continue;
			}
			for (const column of rows[row] as Set<number>) {
				if (doneColumn.has(column)) {
					continue;
				}
				let columnCount = 0;
				for (const other of columns[column] as Set<number>) {
					if (!doneRow.has(other)) {
						columnCount += 1;
					}
				}
				const key =
					(rowCount - 1) * (columnCount - 1) * 2 + (row === column ? 0 : 1);
				const proven = eligible.has(row * size + column);
				if (proven && !bestProven) {
					bestProven = true;
					bestKey = key;
					bestRow = row;
					bestColumn = column;
					continue;
				}
				if (!proven && bestProven) {
					continue;
				}
				if (key < bestKey) {
					bestKey = key;
					bestRow = row;
					bestColumn = column;
				}
			}
		}
		if (bestRow < 0) {
			break;
		}
		if (!bestProven) {
			unprovenPivots += 1;
		}
		const pivotRow = [...(rows[bestRow] as Set<number>)].filter(
			(column) => !doneColumn.has(column) && column !== bestColumn,
		);
		const pivotColumn = [...(columns[bestColumn] as Set<number>)].filter(
			(row) => !doneRow.has(row) && row !== bestRow,
		);
		for (const row of pivotColumn) {
			for (const column of pivotRow) {
				if (!(rows[row] as Set<number>).has(column)) {
					rows[row]?.add(column);
					columns[column]?.add(row);
				}
			}
		}
		pivots.push({ row: bestRow, column: bestColumn });
		doneRow.add(bestRow);
		doneColumn.add(bestColumn);
	}
	if (pivots.length !== size) {
		return null;
	}

	const slotOf = new Map<number, number>();
	const gatherRow: number[] = [];
	const gatherColumn: number[] = [];
	for (let row = 0; row < size; row += 1) {
		for (const column of rows[row] as Set<number>) {
			slotOf.set(row * size + column, gatherRow.length);
			gatherRow.push(row);
			gatherColumn.push(column);
		}
	}
	const slot = (row: number, column: number): number => {
		const found = slotOf.get(row * size + column);
		if (found === undefined) {
			throw new Error(
				`sparse schedule has no slot for entry (${row}, ${column})`,
			);
		}
		return found;
	};

	const liveRows: Set<number>[] = Array.from(
		{ length: size },
		() => new Set<number>(),
	);
	const liveColumns: Set<number>[] = Array.from(
		{ length: size },
		() => new Set<number>(),
	);
	for (const key of pattern) {
		const row = Math.floor(key / size);
		liveRows[row]?.add(key % size);
		liveColumns[key % size]?.add(row);
	}
	const eliminatedRow = new Set<number>();
	const eliminatedColumn = new Set<number>();
	const ops: number[] = [];
	let factorCount = 0;
	let sparseOps = 0;
	for (const pivot of pivots) {
		ops.push(6, slot(pivot.row, pivot.column), 0, 0);
		const pivotRow = [...(liveRows[pivot.row] as Set<number>)].filter(
			(column) => !eliminatedColumn.has(column) && column !== pivot.column,
		);
		const pivotColumn = [...(liveColumns[pivot.column] as Set<number>)].filter(
			(row) => !eliminatedRow.has(row) && row !== pivot.row,
		);
		for (const row of pivotColumn) {
			const factor = factorCount;
			factorCount += 1;
			ops.push(
				0,
				factor,
				slot(row, pivot.column),
				slot(pivot.row, pivot.column),
			);
			for (const column of pivotRow) {
				if (!(liveRows[row] as Set<number>).has(column)) {
					liveRows[row]?.add(column);
					liveColumns[column]?.add(row);
				}
				ops.push(1, slot(row, column), factor, slot(pivot.row, column));
				sparseOps += 1;
			}
			ops.push(2, row, factor, pivot.row);
			sparseOps += 1;
		}
		eliminatedRow.add(pivot.row);
		eliminatedColumn.add(pivot.column);
	}
	for (let step = pivots.length - 1; step >= 0; step -= 1) {
		const pivot = pivots[step] as { row: number; column: number };
		ops.push(3, pivot.row, 0, 0);
		for (let later = step + 1; later < pivots.length; later += 1) {
			const column = (pivots[later] as { row: number; column: number }).column;
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
		unprovenPivots,
	};
}

type NumericPivot = { readonly row: number; readonly column: number };

/**
 * Value-aware re-pivot: choose a sparse elimination order from a real assembled
 * matrix instead of the compiler's value-blind pattern.
 *
 * The static schedule (`computeSparseSchedule`) is built from symbol sets, so a
 * pivot that is structurally present but numerically tiny (a node diagonal
 * whose only unconditional contributor is `gmin`) can be chosen because it
 * minimises fill. Replaying that order divides by ~1e-12 against entries of
 * order 1e2, which is the `boss-aw-2` non-convergence and the
 * `hiwatt`/`tr-2` sparse-vs-dense disagreement. The runtime validates the
 * shipped order on the assembled operating-point matrix and, when a
 * value-aware order is warranted, adopts the order this function returns
 * instead of dropping the block to dense.
 *
 * Threshold Markowitz over the shipped schedule's own filled pattern: a pivot
 * must be at least `tau` of its column's remaining maximum. The candidate scan
 * is in ascending row/column order so both consoles (TypeScript and the C++
 * port in `Engine.cpp`, which mirrors this function op for op) choose the same
 * pivots.
 *
 * Returns `null` when no candidate meets the threshold -- a refusal, never a
 * silent division. The caller drops the block to dense with a named reason.
 * The interpreter (`runSparseSchedule`) and its C++ port replay the returned
 * schedule exactly as the compiler's; the caller re-validates it against dense
 * before adopting it, so a failed re-pivot degrades to dense rather than to a
 * wrong answer.
 *
 * This lives in the compiler package (not the runtime) because order
 * construction -- pattern-based and value-based -- is the schedule builder's
 * job; the runtime only supplies the matrix both consoles assemble
 * identically at `prepare()`. The schedule stays data either way.
 *
 * Adoption-safety note for future editors: the returned schedule's slots are a
 * superset of the shipped schedule's filled pattern, and every slot outside
 * the shipped pattern is a fill cell no stamp writes, so it reads the correct
 * zero from a matrix the runtime refreshed for the shipped pattern. Replacing
 * the order therefore needs no refresh-pattern change on either console.
 */
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
	const pivots: NumericPivot[] = [];

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
		const pivot = pivots[step] as NumericPivot;
		ops.push(3, pivot.row, 0, 0);
		for (let later = step + 1; later < pivots.length; later += 1) {
			const column = (pivots[later] as NumericPivot).column;
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

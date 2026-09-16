import {
	stampAuxRows,
	stampNodeValue,
	stampShape,
} from "./stamp-partition";
import type { SparseSchedule, Stamp } from "./types.js";

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
 */
export function provablyNonzeroEntries(
	block: { nodeCount: number; stamps: readonly Stamp[] },
	size: number,
): Set<number> {
	const eligible = new Set<number>();
	for (let node = 0; node < block.nodeCount; node += 1) {
		eligible.add(node * size + node);
	}
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
				if (stamp.a !== stamp.b) {
					pair(stamp.a, stamp.b);
				}
				if (stamp.a !== stamp.control) {
					pair(stamp.a, stamp.control);
				}
				if (stamp.b !== stamp.control) {
					pair(stamp.b, stamp.control);
				}
				break;
			}
			case "compandor": {
				if (stamp.cellIn !== stamp.sumNode) {
					pair(stamp.cellIn, stamp.sumNode);
				}
				break;
			}
			case "clock-driver": {
				// **Both supply pins on every row, not the one this sample selects.** CP1 couples
				// to `vdd` while the phase is high and to `gnd` while it is low, alternating every
				// few samples, so a pattern holding only the current pin drops the other entry on
				// the next flip and the per-iterate matrix copy writes into a slot the schedule
				// never reserved. The optocoupler shipped with exactly that omission -- its stamp
				// wrote `ledAnode` rows the pattern did not list -- and it is invisible until the
				// alternation happens to land badly.
				const row1 = auxRow(stamp.sourceIndex);
				pair(row1, stamp.cp1);
				if (stamp.vdd !== 0) pair(row1, stamp.vdd);
				if (stamp.gnd !== 0) pair(row1, stamp.gnd);
				const row2 = auxRow(stamp.sourceIndex, 1);
				pair(row2, stamp.cp2);
				if (stamp.vdd !== 0) pair(row2, stamp.vdd);
				if (stamp.gnd !== 0) pair(row2, stamp.gnd);
				const row3 = auxRow(stamp.sourceIndex, 2);
				pair(row3, stamp.vgg);
				if (stamp.vdd !== 0) pair(row3, stamp.vdd);
				if (stamp.gnd !== 0) pair(row3, stamp.gnd);
				break;
			}
			case "comparator": {
				if (stamp.output !== stamp.vee) {
					pair(stamp.output, stamp.vee);
				}
				if (stamp.output !== stamp.plus) {
					pair(stamp.output, stamp.plus);
				}
				if (stamp.output !== stamp.minus) {
					pair(stamp.output, stamp.minus);
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

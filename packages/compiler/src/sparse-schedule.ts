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
 * The stamp's terminals as row indices: its auxiliary rows plus every node the shape table
 * names for its kind.
 *
 * Kept for the pattern's positive control (the old full-square behaviour) and for callers
 * that need the terminal set rather than the write set. `schedulePattern` no longer uses
 * this: it reads `stampPatternCells`, which is exact per stamp kind rather than the square
 * over these rows.
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
 * Every matrix entry a stamp can write on an audio pass, as the exact union over the stamp's
 * branches -- never the full square over its terminals.
 *
 * Read off `applyStamp` in `packages/runtime/src/reference-runtime.ts` and its C++ twin in
 * `packages/runtime/src/cpp/Engine.cpp`, not off the shape table in `stamp-partition.ts`.
 * The two consoles write the same cells for every kind (the one structural divergence, the
 * transformer's series-resistance diagonal, is present in the TS console only and is included
 * conditionally on the stamp field so both consoles stay covered). The DC-only extras need no
 * cover: both consoles solve the operating point densely (`iterate` with `dc=true` never
 * touches the schedule; see the runtime's sparse-schedule test), so the pattern is an
 * audio-path plan and the union is over audio branches only (railed and unrailed op-amp,
 * diode with and without breakdown/series resistance, FET with and without gate junctions,
 * pentode with and without screen share, both flip-flop halves, every clock-driver phase,
 * switch/selector positions, VCA floors).
 *
 * The rule is superset-or-exact, never a subset: a cell the stamp can write that is missing
 * from the pattern silently corrupts the kernel (the runtime gathers only pattern slots).
 * Where a kind's write set depends on a stamp field (`gateSaturationCurrent`,
 * `screenShare`, `seriesResistanceOhms`, ground guards both consoles share), the pattern
 * reads that field, so the set is exact in every case. `terminalNodes`/`terminalsDropGround`
 * narrowing is subsumed by this: no kind needs it.
 *
 * Order is not significant: the caller adds each pair to a `Set`.
 */
export function stampPatternCells(
	stamp: Stamp,
	nodeCount: number,
): Array<readonly [row: number, column: number]> {
	const cells: Array<readonly [row: number, column: number]> = [];
	const add = (row: number, column: number): void => {
		cells.push([row, column]);
	};
	const addSquare2 = (a: number, b: number): void => {
		add(a, a);
		add(a, b);
		add(b, a);
		add(b, b);
	};
	const auxRow = (sourceIndex: number, offset = 0): number =>
		nodeCount + sourceIndex + offset;
	switch (stamp.kind) {
		case "conductance":
		case "controlled-conductance":
		case "controlled-resistance":
		case "capacitor":
		case "inductor":
		case "switch": {
			// `stampConductance(a, b, g)` on every branch (the capacitor's DC branch writes
			// nothing; the union is over audio branches, so the audio cells stand).
			addSquare2(stamp.a, stamp.b);
			break;
		}
		case "selector": {
			// One throw's conductance per control position; the multi-throw execution shape
			// stamps every throw in its list, so the union covers the list as well.
			const shaped = stamp as unknown as {
				readonly common: number;
				readonly throwNode: number;
				readonly throwsList?: readonly number[];
			};
			if (shaped.throwNode !== undefined && shaped.throwNode !== -1) {
				addSquare2(shaped.common, shaped.throwNode);
			}
			for (const t of shaped.throwsList ?? []) {
				addSquare2(shaped.common, t);
			}
			break;
		}
		case "dc-source":
		case "ac-source": {
			const row = auxRow(stamp.sourceIndex);
			add(row, stamp.positive);
			add(stamp.positive, row);
			add(row, stamp.negative);
			add(stamp.negative, row);
			add(row, row);
			break;
		}
		case "input-source": {
			// The C++ console resolves legacy single-ended shapes; the union covers the
			// resolution so an old program's cell is never missing.
			const shaped = stamp as unknown as {
				readonly node: number;
				readonly input?: number;
				readonly plus?: number;
				readonly positive?: number;
			};
			const node =
				shaped.node !== undefined && shaped.node !== -1
					? shaped.node
					: (shaped.input ?? shaped.plus ?? shaped.positive ?? shaped.node);
			const row = auxRow(stamp.sourceIndex);
			add(row, node);
			add(node, row);
			add(row, row);
			break;
		}
		case "macro-audio-source": {
			// Audio pass only. The DC branch additionally couples the composed tap node,
			// but both consoles solve DC densely, so no schedule slot covers it.
			const row = auxRow(stamp.sourceIndex);
			add(row, stamp.node);
			add(stamp.node, row);
			add(row, row);
			break;
		}
		case "logic-divider": {
			const row = auxRow(stamp.sourceIndex);
			add(row, stamp.qNode);
			add(stamp.qNode, row);
			add(row, stamp.gndNode);
			add(stamp.gndNode, row);
			add(row, row);
			break;
		}
		case "d-flip-flop": {
			// One auxiliary row per driven output; the degenerate VSS-tied half collapses
			// to three distinct cells, which this same list produces.
			const rowQ = auxRow(stamp.sourceIndex);
			add(rowQ, stamp.qNode);
			add(stamp.qNode, rowQ);
			add(rowQ, stamp.vssNode);
			add(stamp.vssNode, rowQ);
			add(rowQ, rowQ);
			const rowQbar = auxRow(stamp.sourceIndex2);
			add(rowQbar, stamp.qBarNode);
			add(stamp.qBarNode, rowQbar);
			add(rowQbar, stamp.vssNode);
			add(stamp.vssNode, rowQbar);
			add(rowQbar, rowQbar);
			break;
		}
		case "vccs": {
			// One-directional couplings only; both consoles skip ground terminals.
			if (stamp.outP !== 0) {
				if (stamp.inP !== 0) add(stamp.outP, stamp.inP);
				if (stamp.inN !== 0) add(stamp.outP, stamp.inN);
			}
			if (stamp.outN !== 0) {
				if (stamp.inP !== 0) add(stamp.outN, stamp.inP);
				if (stamp.inN !== 0) add(stamp.outN, stamp.inN);
			}
			break;
		}
		case "transformer": {
			const row = auxRow(stamp.sourceIndex);
			add(row, stamp.primaryPlus);
			add(stamp.primaryPlus, row);
			add(row, stamp.primaryMinus);
			add(stamp.primaryMinus, row);
			add(row, stamp.secondaryPlus);
			add(stamp.secondaryPlus, row);
			add(row, stamp.secondaryMinus);
			add(stamp.secondaryMinus, row);
			// The TS console's copper-loss diagonal; the C++ console never writes it.
			// Conditional on the field so the set stays exact either way.
			if (
				stamp.seriesResistanceOhms !== undefined &&
				stamp.seriesResistanceOhms > 0
			) {
				add(row, row);
			}
			break;
		}
		case "spring-reverb": {
			add(stamp.inputPlus, stamp.inputPlus);
			add(stamp.inputPlus, stamp.inputMinus);
			add(stamp.inputMinus, stamp.inputPlus);
			add(stamp.inputMinus, stamp.inputMinus);
			const row = auxRow(stamp.sourceIndex);
			add(row, stamp.outputPlus);
			add(stamp.outputPlus, row);
			add(row, stamp.outputMinus);
			add(stamp.outputMinus, row);
			add(row, row);
			break;
		}
		case "ideal-opamp": {
			// The output column is unconditional; the constraint row reads plus/minus when
			// unrailed and the slope-weighted pair when railed. Neither console writes the
			// row's own diagonal.
			add(stamp.output, auxRow(stamp.sourceIndex));
			const row = auxRow(stamp.sourceIndex);
			add(row, stamp.output);
			add(row, stamp.plus);
			add(row, stamp.minus);
			break;
		}
		case "diode":
		case "tube-diode": {
			// Forward and breakdown/space-charge branches share the terminal pair.
			const pair = stamp as unknown as {
				readonly anode?: number;
				readonly plate?: number;
				readonly cathode: number;
			};
			addSquare2(pair.anode ?? pair.plate ?? 0, pair.cathode);
			break;
		}
		case "bjt": {
			const { base: b, collector: c, emitter: e } = stamp;
			for (const r of [b, c, e] as const) {
				for (const col of [b, c, e] as const) {
					add(r, col);
				}
			}
			break;
		}
		case "fet": {
			const g = stamp.gate;
			const d = stamp.drain;
			const s = stamp.source;
			// The channel, both channel-signed directions included.
			add(d, g);
			add(d, d);
			add(d, s);
			add(s, g);
			add(s, d);
			add(s, s);
			// The gate junctions (source and drain sides) exist only on a part whose gate
			// draws current. The body diode's cells are already in the channel set above.
			if (stamp.gateSaturationCurrent > 0) {
				add(g, g);
				add(g, s);
				add(g, d);
			}
			break;
		}
		case "triode": {
			const p = stamp.plate;
			const k = stamp.cathode;
			const g = stamp.grid;
			add(p, g);
			add(p, p);
			add(p, k);
			add(k, g);
			add(k, p);
			add(k, k);
			add(g, g);
			add(g, k);
			break;
		}
		case "pentode": {
			const p = stamp.plate;
			const k = stamp.cathode;
			const g = stamp.grid;
			const sc = stamp.screen;
			add(p, g);
			add(p, sc);
			add(p, p);
			add(p, k);
			add(k, g);
			add(k, sc);
			add(k, p);
			add(k, k);
			add(g, g);
			add(g, k);
			// The screen-share source exists only when the stamp declares a share.
			if ((stamp.screenShare ?? 0) > 0) {
				add(sc, g);
				add(sc, sc);
				add(sc, p);
				add(sc, k);
			}
			break;
		}
		case "ota": {
			// The bias diode is unconditional; the output row exists on the conducting
			// branch, so the union carries it, with the ground guards both consoles share.
			add(stamp.bias, stamp.bias);
			add(stamp.bias, stamp.vee);
			add(stamp.vee, stamp.bias);
			add(stamp.vee, stamp.vee);
			if (stamp.output !== 0) {
				if (stamp.plus !== 0) add(stamp.output, stamp.plus);
				if (stamp.minus !== 0) add(stamp.output, stamp.minus);
				if (stamp.bias !== 0) add(stamp.output, stamp.bias);
				if (stamp.vee !== 0) add(stamp.output, stamp.vee);
			}
			break;
		}
		case "optocoupler": {
			// The LED junction pair and the LDR pair.
			addSquare2(stamp.ledAnode, stamp.ledCathode);
			addSquare2(stamp.ldrA, stamp.ldrB);
			break;
		}
		case "analog-switch": {
			// The channel plus the one-directional gate couplings both consoles guard on
			// the channel node.
			addSquare2(stamp.a, stamp.b);
			if (stamp.a !== 0) add(stamp.a, stamp.control);
			if (stamp.b !== 0) add(stamp.b, stamp.control);
			break;
		}
		case "compandor": {
			// The gain cell; the rectifier current rides the RHS. The TS console stamps
			// these unconditionally while the C++ console guards the nodes, so the union
			// carries them and ground-row deletion handles node 0.
			add(stamp.sumNode, stamp.cellIn);
			add(stamp.sumNode, stamp.vref);
			break;
		}
		case "clock-driver": {
			// Each phase row couples its pin plus the supply pin of the current half-phase,
			// so the union carries both supply pins per row with the guards both consoles
			// share. The third row's weights differ; its cells do not.
			const row1 = auxRow(stamp.sourceIndex);
			add(row1, stamp.cp1);
			add(stamp.cp1, row1);
			if (stamp.vdd !== 0) add(row1, stamp.vdd);
			if (stamp.gnd !== 0) add(row1, stamp.gnd);
			add(row1, row1);
			const row2 = auxRow(stamp.sourceIndex, 1);
			add(row2, stamp.cp2);
			add(stamp.cp2, row2);
			if (stamp.vdd !== 0) add(row2, stamp.vdd);
			if (stamp.gnd !== 0) add(row2, stamp.gnd);
			add(row2, row2);
			const row3 = auxRow(stamp.sourceIndex, 2);
			add(row3, stamp.vgg);
			add(stamp.vgg, row3);
			if (stamp.vdd !== 0) add(row3, stamp.vdd);
			if (stamp.gnd !== 0) add(row3, stamp.gnd);
			add(row3, row3);
			break;
		}
		case "comparator": {
			// The pull-down conductance plus the one-directional input couplings, with the
			// ground guards both consoles share.
			addSquare2(stamp.output, stamp.vee);
			if (stamp.output !== 0) {
				if (stamp.plus !== 0) add(stamp.output, stamp.plus);
				if (stamp.minus !== 0) add(stamp.output, stamp.minus);
			}
			if (stamp.vee !== 0) {
				if (stamp.plus !== 0) add(stamp.vee, stamp.plus);
				if (stamp.minus !== 0) add(stamp.vee, stamp.minus);
			}
			break;
		}
		case "linear-vca":
		case "dbx-vca": {
			// Voltage-sense control: the output row reads plus/minus/control and no row
			// reads back onto control. Both consoles guard every terminal.
			if (stamp.output !== 0) {
				if (stamp.plus !== 0) add(stamp.output, stamp.plus);
				if (stamp.minus !== 0) add(stamp.output, stamp.minus);
				if (stamp.control !== 0) add(stamp.output, stamp.control);
			}
			break;
		}
	}
	return cells;
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
			case "d-flip-flop": {
				// Each driven output pairs its own auxiliary row. A degenerate side
				// (output on the VSS pin, as a fixture ties an unused half) pairs
				// nothing, the same guard the divider carries for its one row.
				if (stamp.qNode !== stamp.vssNode) {
					const row = auxRow(stamp.sourceIndex);
					pair(row, stamp.qNode);
					pair(row, stamp.vssNode);
				}
				if (stamp.qBarNode !== stamp.vssNode) {
					const rowBar = auxRow(stamp.sourceIndex2);
					pair(rowBar, stamp.qBarNode);
					pair(rowBar, stamp.vssNode);
				}
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
				// The *pattern* still needs both pins, and still has them: `stampPatternCells`
				// carries the union over both half-phases, which is a different question from
				// what may be a pivot. The bug the old comment here describes -- a pattern
				// missing a cell the stamp writes -- is real and is not this set's job to prevent.
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
 *
 * Per-stamp cells come from `stampPatternCells` (exact audio-write sets); the node diagonals
 * below are the runtime's `gmin` contributors, and the ground-row handling matches the
 * solver's overwrite of row 0.
 */
export function schedulePattern(
	block: { nodeCount: number; stamps: readonly Stamp[] },
	size: number,
): Set<number> {
	const pattern = new Set<number>();
	for (const stamp of block.stamps) {
		for (const [row, column] of stampPatternCells(stamp, block.nodeCount)) {
			pattern.add(row * size + column);
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

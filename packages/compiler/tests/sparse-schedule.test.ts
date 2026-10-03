// Which matrix entries the static elimination order is allowed to pivot on.
//
// **These are negative controls, and the defect they guard against does not look like a bug.**
// An entry wrongly listed as provably nonzero never produces wrong audio: the runtime's pivot
// guard notices the collapse and re-solves the block densely. What it produces is a block that
// silently stops using the schedule it was compiled with -- at 2-12x the cost, with correct
// output, and with nothing in any report saying so. Six corpus packets were in that state until
// 2026-09-18; the four stamp kinds below are the four that put them there.
//
// The rule each case encodes: an entry qualifies only when the stamp writes it in the direction
// being claimed AND cannot leave it zero on any iterate. A stamp that writes `matrix[r][c]` and
// not `matrix[c][r]` may claim the first and never the second, and a term that vanishes in
// saturation, at rest, or on the other half of a clock phase may not be claimed at all.

import { describe, expect, it } from "bun:test";
import { provablyNonzeroEntries } from "../src/sparse-schedule";
import type { Stamp } from "../src/types";

const NODES = 8;

/**
 * Enough of a block for the entry set to be computed: one resistor so the matrix is not empty,
 * plus whatever the case under test contributes.
 */
function eligibilityOf(
	stamps: readonly Stamp[],
	auxCount: number,
): { has: (row: number, column: number) => boolean; size: number } {
	const size = NODES + auxCount;
	const withBackground: Stamp[] = [
		{ kind: "conductance", a: 1, b: 2, siemens: 1e-3 } as Stamp,
		...stamps,
	];
	const eligible = provablyNonzeroEntries(
		{ nodeCount: NODES, stamps: withBackground },
		size,
	);
	return { has: (row, column) => eligible.has(row * size + column), size };
}

describe("provablyNonzeroEntries", () => {
	it("claims a clock driver's phase rows but neither supply coupling", () => {
		const sourceIndex = 0;
		const stamp = {
			kind: "clock-driver",
			cp1: 3,
			cp2: 4,
			vgg: 5,
			vdd: 6,
			ox1: 7,
			gnd: 2,
			defaultFrequency: 100_000,
			stateIndex: 0,
			sourceIndex,
		} as Stamp;
		const { has } = eligibilityOf([stamp], 3);
		const phaseRow = NODES + sourceIndex;

		// Written unconditionally and in both directions: `matrix[row][cp] += 1`,
		// `matrix[cp][row] += 1`, and `matrix[row][row] -= 1` on a row no other stamp owns.
		expect(has(phaseRow, 3)).toBe(true);
		expect(has(3, phaseRow)).toBe(true);
		expect(has(phaseRow, phaseRow)).toBe(true);

		// The phase couples to ONE supply pin per iterate and alternates between them, so
		// whichever is claimed is zero for half of the clock's period.
		expect(has(phaseRow, 6)).toBe(false);
		expect(has(phaseRow, 2)).toBe(false);
		// And the coupling is one-directional even while it is nonzero.
		expect(has(6, phaseRow)).toBe(false);
		expect(has(2, phaseRow)).toBe(false);
	});

	it("claims an analog switch's channel but not its gate coupling", () => {
		const stamp = {
			kind: "analog-switch",
			a: 3,
			b: 4,
			control: 5,
			onOhms: 100,
			offOhms: 1e8,
			thresholdVolts: 2.5,
		} as Stamp;
		const { has } = eligibilityOf([stamp], 0);

		// `g = gOff + (gOn - gOff) * sigmoid` never falls below `1/offOhms`, and it goes
		// through `stampConductance`, which writes all four cells.
		expect(has(3, 4)).toBe(true);
		expect(has(4, 3)).toBe(true);

		// `coupling = dg/dvCtrl * (vA - vB)` is written into the channel rows only, and is
		// exactly zero both when the gate is saturated and when the channel carries no
		// voltage across it -- which between them is a CMOS switch's whole working life.
		expect(has(3, 5)).toBe(false);
		expect(has(4, 5)).toBe(false);
		expect(has(5, 3)).toBe(false);
		expect(has(5, 4)).toBe(false);
	});

	it("claims a comparator's pull-down but not its input couplings", () => {
		const stamp = {
			kind: "comparator",
			plus: 3,
			minus: 4,
			output: 5,
			vee: 6,
			pullDownOhms: 1e3,
			floatOhms: 1e9,
			sensitivity: 100,
		} as Stamp;
		const { has } = eligibilityOf([stamp], 0);

		// `gCell = gOn * sigma + gOff` is bounded below by `1/floatOhms`.
		expect(has(5, 6)).toBe(true);
		expect(has(6, 5)).toBe(true);

		// `gControl` carries the sigmoid's derivative, which underflows to zero the moment the
		// comparator saturates, and it is written one way only.
		expect(has(5, 3)).toBe(false);
		expect(has(5, 4)).toBe(false);
		expect(has(3, 5)).toBe(false);
		expect(has(4, 5)).toBe(false);
	});

	it("claims nothing for a compandor's gain cell", () => {
		const stamp = {
			kind: "compandor",
			rectIn: 3,
			rectCap: 4,
			cellIn: 5,
			sumNode: 6,
			vref: 7,
			r1: 10_000,
			r2: 20_000,
			r5: 20_000,
			iBias: 140e-6,
			stateIndex: 0,
		} as Stamp;
		const { has } = eligibilityOf([stamp], 0);

		// `-gCell` is the rectifier's envelope, which is zero until its capacitor has charged --
		// every iterate of a fresh operating point, and the first hundreds of samples after it.
		// One-directional as well.
		expect(has(6, 5)).toBe(false);
		expect(has(5, 6)).toBe(false);
	});

	it("still claims the passive elements a fill-reducing order depends on", () => {
		// The counterweight to the four cases above: this set is a restriction on which pivots
		// the search may use, so emptying it would be "safe" and would also make every block
		// choose its pivots blind. A resistor's conductance, a capacitor's `2C/dt` and an
		// inductor's `dt/2L` are strictly positive on every iterate and symmetric, and they are
		// the bulk of what makes a usable order exist at all.
		const { has } = eligibilityOf(
			[
				{ kind: "capacitor", a: 3, b: 4, farads: 1e-8, stateIndex: 0 } as Stamp,
				{ kind: "inductor", a: 5, b: 6, henries: 1e-3, stateIndex: 2 } as Stamp,
			],
			0,
		);
		expect(has(3, 4)).toBe(true);
		expect(has(4, 3)).toBe(true);
		expect(has(3, 3)).toBe(true);
		expect(has(5, 6)).toBe(true);
		expect(has(6, 5)).toBe(true);
	});
});

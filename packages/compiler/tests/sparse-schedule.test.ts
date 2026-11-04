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

// schedulePattern covers every stamp kind's audio write set.
//
// The companion contract to the pivot set above, in the other direction: where a wrongly
// listed pivot entry costs a silently dense block, a pattern cell missing for an entry the
// stamp writes corrupts the kernel outright (the runtime gathers only pattern slots). The
// rule each case encodes is therefore superset-or-exact, never a subset: every cell either
// console writes on an audio pass must be in `schedulePattern`, over every branch the case
// drives (railed and unrailed op-amp, diode breakdown, FET gate junctions and body diode,
// pentode screen share, both flip-flop halves and the degenerate VSS-tied half, every
// clock-driver phase, switch/selector positions, VCA floors).
//
// Both directions are guarded. The negative control deletes one exact cell from the pattern
// and requires the coverage check to fail; the positive control requires the old full
// square (every terminal pair, via `stampTerminals`) to still cover everything the runtime
// writes. The DC-only extras (the macro-audio-source tap coupling, the inductor short) need
// no cover: both consoles solve the operating point densely and never touch the schedule
// there. Row 0 is filtered from the recorded set before comparing: both consoles overwrite
// the ground equation after stamping, so no schedule slot can exist there.

import { ReferenceRuntime } from "../../runtime/src/reference-runtime";
import {
	schedulePattern,
	stampPatternCells,
	stampTerminals,
} from "../src/sparse-schedule";
import type { Program } from "../src/types";

type PatternRun = {
	readonly solution?: ReadonlyArray<number>;
	readonly state?: ReadonlyArray<number>;
	readonly input?: number;
	readonly positions?: Readonly<Record<string, number>>;
	readonly timeSeconds?: number;
};

type PatternCase = {
	readonly name: string;
	readonly nodeCount: number;
	readonly auxCount: number;
	readonly stamp: Stamp;
	/** Hand-derived from both consoles' applyStamp; the runtime drive must match it exactly. */
	readonly expected: ReadonlyArray<readonly [number, number]>;
	readonly runs: ReadonlyArray<PatternRun>;
};

type SubsetCase = {
	readonly name: string;
	readonly nodeCount: number;
	readonly auxCount: number;
	readonly stamp: Stamp;
	readonly runs: ReadonlyArray<PatternRun>;
};

const PATTERN_DT = 1 / 48_000;

function trackingMatrix(size: number): {
	matrix: number[][];
	written: Set<number>;
} {
	const written = new Set<number>();
	const matrix: number[][] = [];
	for (let row = 0; row < size; row += 1) {
		const backing = new Array<number>(size).fill(0);
		matrix.push(
			new Proxy(backing, {
				set(target, property, value): boolean {
					if (typeof property === "string" && /^\d+$/.test(property)) {
						written.add(row * size + Number(property));
					}
					return Reflect.set(target, property, value);
				},
			}) as number[],
		);
	}
	return { matrix, written };
}

function driveStamp(
	stamp: Stamp,
	nodeCount: number,
	auxCount: number,
	runs: ReadonlyArray<PatternRun>,
): Set<number> {
	const size = nodeCount + auxCount;
	const covered = new Set<number>();
	for (const run of runs) {
		const runtime = new ReferenceRuntime({ blocks: [], controls: [] } as unknown as Program);
		const inner = runtime as unknown as {
			sampleRate: number | null;
			inputSourceOhms: number;
			timeSeconds: number;
			elapsedSamples: number;
			positions: Map<string, number>;
			applyStamp: (
				stamp: Stamp,
				matrix: number[][],
				rhs: number[],
				block: unknown,
				dt: number,
				state: number[],
				solution: number[],
				input: number,
				dc: boolean,
				sourceScale: number,
				blockIndex: number,
			) => void;
		};
		inner.sampleRate = 48_000;
		inner.inputSourceOhms = 0;
		inner.timeSeconds = run.timeSeconds ?? 0.001;
		inner.elapsedSamples = 7;
		for (const [id, position] of Object.entries(run.positions ?? {})) {
			inner.positions.set(id, position);
		}
		const { matrix, written } = trackingMatrix(size);
		const rhs = new Array<number>(size).fill(0);
		const state = [...(run.state ?? [])];
		while (state.length < 16) state.push(0);
		const solution = [...(run.solution ?? [])];
		while (solution.length < size) solution.push(0);
		const block = {
			kind: "mna",
			id: "schedule-pattern-test",
			nodeCount,
			auxCount,
			stamps: [stamp],
		};
		inner.applyStamp(
			stamp,
			matrix,
			rhs,
			block,
			PATTERN_DT,
			state,
			solution,
			run.input ?? 0,
			false,
			1.0,
			0,
		);
		// Row 0 is the ground equation both consoles overwrite after stamping; no schedule
		// slot can exist there (the pattern deletes the whole row), so it is not compared.
		for (const key of written) {
			if (Math.floor(key / size) !== 0) covered.add(key);
		}
	}
	return covered;
}

function patternOf(
	stamp: Stamp,
	nodeCount: number,
	auxCount: number,
): { pattern: Set<number>; size: number } {
	const size = nodeCount + auxCount;
	return { pattern: schedulePattern({ nodeCount, stamps: [stamp] }, size), size };
}

/** The pre-exact behaviour: the full square over the stamp's terminals. */
function fullSquareOf(
	stamp: Stamp,
	nodeCount: number,
	auxCount: number,
): { pattern: Set<number>; size: number } {
	const size = nodeCount + auxCount;
	const pattern = new Set<number>();
	const terminals = stampTerminals(stamp, nodeCount);
	for (const row of terminals) {
		for (const column of terminals) {
			pattern.add(row * size + column);
		}
	}
	for (let node = 1; node < nodeCount; node += 1) {
		pattern.add(node * size + node);
	}
	for (let column = 0; column < size; column += 1) {
		pattern.delete(column);
	}
	pattern.add(0);
	return { pattern, size };
}

const key = (size: number, row: number, column: number): number => row * size + column;

function solutionOf(size: number, entries: ReadonlyArray<readonly [number, number]>): number[] {
	const solution = new Array<number>(size).fill(0);
	for (const [node, value] of entries) {
		solution[node] = value;
	}
	return solution;
}

function stateOf(entries: ReadonlyArray<readonly [number, number]>): number[] {
	const state = new Array<number>(16).fill(0);
	for (const [index, value] of entries) {
		state[index] = value;
	}
	return state;
}

describe("schedulePattern covers every stamp kind's audio write set", () => {
	const cases: PatternCase[] = [
		{
			name: "conductance",
			nodeCount: 3,
			auxCount: 0,
			stamp: { kind: "conductance", a: 1, b: 2, siemens: 1e-3 } as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [{}],
		},
		{
			name: "controlled-conductance",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "controlled-conductance",
				a: 1,
				b: 2,
				control: "pattern-cc",
				taper: "linear",
				totalOhms: 100_000,
				side: "lower",
				residualOhms: 0,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [
				{ positions: { "pattern-cc": 0 } },
				{ positions: { "pattern-cc": 0.5 } },
				{ positions: { "pattern-cc": 1 } },
			],
		},
		{
			name: "controlled-resistance",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "controlled-resistance",
				a: 1,
				b: 2,
				control: "pattern-cr",
				taper: "linear",
				minOhms: 1000,
				maxOhms: 100_000,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [{ positions: { "pattern-cr": 0 } }, { positions: { "pattern-cr": 1 } }],
		},
		{
			name: "capacitor",
			nodeCount: 3,
			auxCount: 0,
			stamp: { kind: "capacitor", a: 1, b: 2, farads: 1e-8, stateIndex: 0 } as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [{ state: stateOf([[0, 0.5], [1, 0.01]]) }],
		},
		{
			name: "inductor",
			nodeCount: 3,
			auxCount: 0,
			stamp: { kind: "inductor", a: 1, b: 2, henries: 1e-3, stateIndex: 0 } as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [{ state: stateOf([[0, 0.5], [1, 0.01]]) }],
		},
		{
			name: "inductor with series resistance",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "inductor",
				a: 1,
				b: 2,
				henries: 1e-3,
				stateIndex: 0,
				seriesResistanceOhms: 10,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [{ state: stateOf([[0, 0.5], [1, 0.01]]) }],
		},
		{
			name: "switch",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "switch",
				a: 1,
				b: 2,
				control: "pattern-sw",
				onOhms: 10,
				offOhms: 1e7,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [{ positions: { "pattern-sw": 0 } }, { positions: { "pattern-sw": 1 } }],
		},
		{
			name: "selector",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "selector",
				common: 1,
				throwNode: 2,
				control: "pattern-sel",
				throwIndex: 0,
				throwCount: 2,
				onOhms: 10,
				offOhms: 1e7,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [{ positions: { "pattern-sel": 0 } }, { positions: { "pattern-sel": 0.75 } }],
		},
		{
			name: "dc-source",
			nodeCount: 3,
			auxCount: 1,
			stamp: {
				kind: "dc-source",
				positive: 1,
				negative: 2,
				volts: 9,
				sourceIndex: 0,
				sourceOhms: 0.5,
			} as Stamp,
			expected: [[3, 1], [1, 3], [3, 2], [2, 3], [3, 3]],
			runs: [{}],
		},
		{
			name: "ac-source",
			nodeCount: 3,
			auxCount: 1,
			stamp: {
				kind: "ac-source",
				positive: 1,
				negative: 2,
				amplitudeVolts: 1,
				frequencyHz: 1000,
				sourceIndex: 0,
				sourceOhms: 0.5,
			} as Stamp,
			expected: [[3, 1], [1, 3], [3, 2], [2, 3], [3, 3]],
			runs: [{ timeSeconds: 0 }, { timeSeconds: 0.005 }],
		},
		{
			name: "input-source",
			nodeCount: 2,
			auxCount: 1,
			stamp: { kind: "input-source", node: 1, sourceIndex: 0 } as Stamp,
			expected: [[2, 1], [1, 2], [2, 2]],
			runs: [{ input: 0 }, { input: 0.5 }],
		},
		{
			name: "macro-audio-source",
			nodeCount: 2,
			auxCount: 1,
			stamp: {
				kind: "macro-audio-source",
				node: 1,
				macroId: "pattern-macro",
				sourceOhms: 10,
				sourceIndex: 0,
			} as Stamp,
			expected: [[2, 1], [1, 2], [2, 2]],
			runs: [{}],
		},
		{
			name: "logic-divider",
			nodeCount: 4,
			auxCount: 1,
			stamp: {
				kind: "logic-divider",
				clockNode: 1,
				qNode: 2,
				gndNode: 3,
				thresholdVolts: 2.5,
				highVolts: 5,
				sourceIndex: 0,
				stateIndex: 0,
			} as Stamp,
			expected: [[4, 2], [2, 4], [4, 3], [3, 4], [4, 4]],
			runs: [
				{ state: stateOf([[0, 0], [1, 0]]), solution: solutionOf(5, [[1, 5], [3, 0]]) },
				{ state: stateOf([[0, 1], [1, 5]]), solution: solutionOf(5, [[1, 0], [3, 0]]) },
			],
		},
		{
			name: "d-flip-flop",
			nodeCount: 9,
			auxCount: 2,
			stamp: {
				kind: "d-flip-flop",
				clockNode: 1,
				dNode: 2,
				setNode: 3,
				resetNode: 4,
				qNode: 5,
				qBarNode: 6,
				vddNode: 7,
				vssNode: 8,
				sourceIndex: 0,
				sourceIndex2: 1,
				stateIndex: 0,
			} as Stamp,
			expected: [
				[9, 5], [5, 9], [9, 8], [8, 9], [9, 9],
				[10, 6], [6, 10], [10, 8], [8, 10], [10, 10],
			],
			runs: [
				{
					state: stateOf([[0, 0], [1, 1], [2, 0]]),
					solution: solutionOf(11, [[1, 0], [2, 9], [3, 9], [4, 0], [7, 9], [8, 0]]),
				},
				{
					state: stateOf([[0, 1], [1, 0], [2, 0]]),
					solution: solutionOf(11, [[1, 0], [2, 0], [3, 0], [4, 9], [7, 9], [8, 0]]),
				},
				{
					state: stateOf([[0, 0], [1, 1], [2, 0]]),
					solution: solutionOf(11, [[1, 9], [2, 9], [3, 0], [4, 0], [7, 9], [8, 0]]),
				},
				{
					state: stateOf([[0, 1], [1, 0], [2, 9]]),
					solution: solutionOf(11, [[1, 0], [2, 0], [3, 0], [4, 0], [7, 9], [8, 0]]),
				},
			],
		},
		{
			name: "d-flip-flop with VSS-tied half",
			nodeCount: 9,
			auxCount: 2,
			stamp: {
				kind: "d-flip-flop",
				clockNode: 1,
				dNode: 2,
				setNode: 3,
				resetNode: 4,
				qNode: 5,
				qBarNode: 8,
				vddNode: 7,
				vssNode: 8,
				sourceIndex: 0,
				sourceIndex2: 1,
				stateIndex: 0,
			} as Stamp,
			expected: [
				[9, 5], [5, 9], [9, 8], [8, 9], [9, 9],
				[10, 8], [8, 10], [10, 10],
			],
			runs: [
				{
					state: stateOf([[0, 0], [1, 1], [2, 0]]),
					solution: solutionOf(11, [[1, 9], [2, 9], [3, 0], [4, 0], [7, 9], [8, 0]]),
				},
			],
		},
		{
			name: "vccs",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "vccs",
				outP: 1,
				outN: 2,
				inP: 3,
				inN: 4,
				transconductance: 0.01,
			} as Stamp,
			expected: [[1, 3], [1, 4], [2, 3], [2, 4]],
			runs: [{}],
		},
		{
			name: "vccs with grounded terminals",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "vccs",
				outP: 1,
				outN: 0,
				inP: 3,
				inN: 0,
				transconductance: 0.01,
			} as Stamp,
			expected: [[1, 3]],
			runs: [{}],
		},
		{
			name: "transformer",
			nodeCount: 5,
			auxCount: 1,
			stamp: {
				kind: "transformer",
				primaryPlus: 1,
				primaryMinus: 2,
				secondaryPlus: 3,
				secondaryMinus: 4,
				turnsRatio: 2,
				sourceIndex: 0,
			} as Stamp,
			expected: [
				[5, 1], [1, 5], [5, 2], [2, 5], [5, 3], [3, 5], [5, 4], [4, 5],
			],
			runs: [{}],
		},
		{
			name: "transformer with series resistance",
			nodeCount: 5,
			auxCount: 1,
			stamp: {
				kind: "transformer",
				primaryPlus: 1,
				primaryMinus: 2,
				secondaryPlus: 3,
				secondaryMinus: 4,
				turnsRatio: 2,
				sourceIndex: 0,
				seriesResistanceOhms: 100,
			} as Stamp,
			expected: [
				[5, 1], [1, 5], [5, 2], [2, 5], [5, 3], [3, 5], [5, 4], [4, 5], [5, 5],
			],
			runs: [{}],
		},
		{
			name: "spring-reverb",
			nodeCount: 5,
			auxCount: 1,
			stamp: {
				kind: "spring-reverb",
				inputPlus: 1,
				inputMinus: 2,
				outputPlus: 3,
				outputMinus: 4,
				inputOhms: 1000,
				outputOhms: 8000,
				delaySeconds: 0.03,
				decaySeconds: 1.5,
				dispersionStages: 2,
				sourceIndex: 0,
			} as Stamp,
			expected: [
				[1, 1], [1, 2], [2, 1], [2, 2],
				[5, 3], [3, 5], [5, 4], [4, 5], [5, 5],
			],
			runs: [{ solution: solutionOf(6, [[1, 0.5], [2, 0]]) }],
		},
		{
			name: "ideal-opamp railed",
			nodeCount: 4,
			auxCount: 1,
			stamp: {
				kind: "ideal-opamp",
				plus: 1,
				minus: 2,
				output: 3,
				openLoopGain: 100_000,
				gainBandwidthHz: 1_000_000,
				sourceIndex: 0,
				railHigh: 9,
				railLow: 0,
			} as Stamp,
			expected: [[3, 4], [4, 3], [4, 1], [4, 2]],
			runs: [
				{ solution: solutionOf(5, [[1, 5], [2, 0]]) },
				{ solution: solutionOf(5, [[1, 0], [2, 5]]) },
				{ solution: solutionOf(5, [[1, 4.5], [2, 4.5]]) },
			],
		},
		{
			name: "ideal-opamp unrailed",
			nodeCount: 4,
			auxCount: 1,
			stamp: {
				kind: "ideal-opamp",
				plus: 1,
				minus: 2,
				output: 3,
				openLoopGain: 100_000,
				gainBandwidthHz: null,
				sourceIndex: 0,
				railHigh: null,
				railLow: null,
			} as Stamp,
			expected: [[3, 4], [4, 1], [4, 2]],
			runs: [{ solution: solutionOf(5, [[1, 4.5], [2, 4.5]]) }],
		},
		{
			name: "diode",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "diode",
				anode: 1,
				cathode: 2,
				saturationCurrent: 1e-14,
				emissionCoefficient: 1,
				thermalVoltage: 0.025_852,
				breakdownVolts: 0,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [
				{ solution: solutionOf(3, [[1, 0.7], [2, 0]]) },
				{ solution: solutionOf(3, [[1, -1], [2, 0]]) },
			],
		},
		{
			name: "diode with breakdown and series resistance",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "diode",
				anode: 1,
				cathode: 2,
				saturationCurrent: 1e-14,
				emissionCoefficient: 1,
				thermalVoltage: 0.025_852,
				breakdownVolts: 50,
				seriesResistance: 0.5,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [
				{ solution: solutionOf(3, [[1, 0.7], [2, 0]]) },
				{ solution: solutionOf(3, [[1, -60], [2, 0]]) },
			],
		},
		{
			name: "tube-diode",
			nodeCount: 3,
			auxCount: 0,
			stamp: {
				kind: "tube-diode",
				plate: 1,
				cathode: 2,
				perveance: 1e-3,
				exponent: 1.5,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2]],
			runs: [
				{ solution: solutionOf(3, [[1, 5], [2, 0]]) },
				{ solution: solutionOf(3, [[1, -5], [2, 0]]) },
			],
		},
		{
			name: "bjt npn",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "bjt",
				base: 1,
				collector: 2,
				emitter: 3,
				polarity: "npn",
				saturationCurrent: 1e-14,
				forwardBeta: 100,
				reverseBeta: 1,
				thermalVoltage: 0.025_852,
				leakageAmps: 0,
			} as Stamp,
			expected: [
				[1, 1], [1, 2], [1, 3],
				[2, 1], [2, 2], [2, 3],
				[3, 1], [3, 2], [3, 3],
			],
			runs: [
				{ solution: solutionOf(4, [[1, 0.7], [2, 5], [3, 0]]) },
				{ solution: solutionOf(4, [[1, 0.8], [2, 0.2], [3, 0]]) },
			],
		},
		{
			name: "bjt pnp with leakage",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "bjt",
				base: 1,
				collector: 2,
				emitter: 3,
				polarity: "pnp",
				saturationCurrent: 1e-14,
				forwardBeta: 100,
				reverseBeta: 1,
				thermalVoltage: 0.025_852,
				leakageAmps: 1e-9,
			} as Stamp,
			expected: [
				[1, 1], [1, 2], [1, 3],
				[2, 1], [2, 2], [2, 3],
				[3, 1], [3, 2], [3, 3],
			],
			runs: [{ solution: solutionOf(4, [[1, 8.3], [2, 4], [3, 9]]) }],
		},
		{
			name: "fet n-channel jfet",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "fet",
				gate: 1,
				drain: 2,
				source: 3,
				channel: "n",
				thresholdVolts: -2,
				transconductance: 1e-3,
				channelLengthModulation: 0.01,
				subthresholdVolts: 0.2,
				gateSaturationCurrent: 1e-12,
				gateOnsetVolts: 0.5,
				gateScaleVolts: 0.1,
			} as Stamp,
			expected: [
				[2, 1], [2, 2], [2, 3],
				[3, 1], [3, 2], [3, 3],
				[1, 1], [1, 3], [1, 2],
			],
			runs: [
				{ solution: solutionOf(4, [[1, 0], [2, 5], [3, 0]]) },
				{ solution: solutionOf(4, [[1, 0], [2, -1], [3, 0]]) },
				{ solution: solutionOf(4, [[1, 1], [2, 5], [3, 0]]) },
			],
		},
		{
			name: "fet n-channel mosfet with body diode",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "fet",
				gate: 1,
				drain: 2,
				source: 3,
				channel: "n",
				thresholdVolts: 0.7,
				transconductance: 1e-3,
				channelLengthModulation: 0.01,
				subthresholdVolts: 0,
				gateSaturationCurrent: 0,
				gateOnsetVolts: 0.5,
				gateScaleVolts: 0.1,
				bodySaturationCurrent: 1e-14,
				bodyEmissionCoefficient: 1.2,
			} as Stamp,
			expected: [
				[2, 1], [2, 2], [2, 3],
				[3, 1], [3, 2], [3, 3],
			],
			runs: [
				{ solution: solutionOf(4, [[1, 2], [2, 5], [3, 0]]) },
				{ solution: solutionOf(4, [[1, 0], [2, -0.8], [3, 0]]) },
			],
		},
		{
			name: "fet mosfet without gate or body",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "fet",
				gate: 1,
				drain: 2,
				source: 3,
				channel: "n",
				thresholdVolts: 0.7,
				transconductance: 1e-3,
				channelLengthModulation: 0.01,
				subthresholdVolts: 0,
				gateSaturationCurrent: 0,
				gateOnsetVolts: 0.5,
				gateScaleVolts: 0.1,
			} as Stamp,
			expected: [
				[2, 1], [2, 2], [2, 3],
				[3, 1], [3, 2], [3, 3],
			],
			runs: [{ solution: solutionOf(4, [[1, 2], [2, 5], [3, 0]]) }],
		},
		{
			name: "fet p-channel jfet",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "fet",
				gate: 1,
				drain: 2,
				source: 3,
				channel: "p",
				thresholdVolts: -2,
				transconductance: 1e-3,
				channelLengthModulation: 0.01,
				subthresholdVolts: 0.2,
				gateSaturationCurrent: 1e-12,
				gateOnsetVolts: 0.5,
				gateScaleVolts: 0.1,
			} as Stamp,
			expected: [
				[2, 1], [2, 2], [2, 3],
				[3, 1], [3, 2], [3, 3],
				[1, 1], [1, 3], [1, 2],
			],
			runs: [{ solution: solutionOf(4, [[1, 9], [2, 4], [3, 9]]) }],
		},
		{
			name: "triode",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "triode",
				grid: 1,
				cathode: 2,
				plate: 3,
				mu: 100,
				kg1: 2000,
				kp: 600,
				kvb: 300,
				ex: 1.5,
				gridSaturationCurrent: 1e-9,
				gridOnsetVolts: 0.5,
				gridScaleVolts: 0.1,
				contactPotentialVolts: 0.5,
			} as Stamp,
			expected: [
				[3, 1], [3, 3], [3, 2],
				[2, 1], [2, 3], [2, 2],
				[1, 1], [1, 2],
			],
			runs: [
				{ solution: solutionOf(4, [[1, 0], [2, 0], [3, 100]]) },
				{ solution: solutionOf(4, [[1, 1], [2, 0], [3, 100]]) },
			],
		},
		{
			name: "pentode with screen share",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "pentode",
				grid: 1,
				cathode: 2,
				plate: 3,
				screen: 4,
				mu: 100,
				kg1: 2000,
				kp: 600,
				kvb: 300,
				ex: 1.5,
				gridSaturationCurrent: 1e-9,
				gridOnsetVolts: 0.5,
				gridScaleVolts: 0.1,
				contactPotentialVolts: 0.5,
				screenShare: 0.2,
			} as Stamp,
			expected: [
				[3, 1], [3, 4], [3, 3], [3, 2],
				[2, 1], [2, 4], [2, 3], [2, 2],
				[4, 1], [4, 4], [4, 3], [4, 2],
				[1, 1], [1, 2],
			],
			runs: [
				{ solution: solutionOf(5, [[1, 0], [2, 0], [3, 100], [4, 100]]) },
				{ solution: solutionOf(5, [[1, 1], [2, 0], [3, 100], [4, 100]]) },
			],
		},
		{
			name: "pentode without screen share",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "pentode",
				grid: 1,
				cathode: 2,
				plate: 3,
				screen: 4,
				mu: 100,
				kg1: 2000,
				kp: 600,
				kvb: 300,
				ex: 1.5,
				gridSaturationCurrent: 1e-9,
				gridOnsetVolts: 0.5,
				gridScaleVolts: 0.1,
				contactPotentialVolts: 0.5,
				screenShare: 0,
			} as Stamp,
			expected: [
				[3, 1], [3, 4], [3, 3], [3, 2],
				[2, 1], [2, 4], [2, 3], [2, 2],
				[1, 1], [1, 2],
			],
			runs: [{ solution: solutionOf(5, [[1, 0], [2, 0], [3, 100], [4, 100]]) }],
		},
		{
			name: "ota conducting",
			nodeCount: 6,
			auxCount: 0,
			stamp: {
				kind: "ota",
				plus: 1,
				minus: 2,
				bias: 3,
				output: 4,
				vee: 5,
				saturationCurrent: 1e-6,
				thermalVoltage: 0.025_852,
			} as Stamp,
			expected: [
				[3, 3], [3, 5], [5, 3], [5, 5],
				[4, 1], [4, 2], [4, 3], [4, 5],
			],
			runs: [
				{ solution: solutionOf(6, [[1, 0.1], [2, 0], [3, 1], [5, 0]]) },
				{ solution: solutionOf(6, [[1, 0.1], [2, 0], [3, -0.5], [5, 0]]) },
			],
		},
		{
			name: "ota with grounded output",
			nodeCount: 6,
			auxCount: 0,
			stamp: {
				kind: "ota",
				plus: 1,
				minus: 2,
				bias: 3,
				output: 0,
				vee: 5,
				saturationCurrent: 1e-6,
				thermalVoltage: 0.025_852,
			} as Stamp,
			expected: [[3, 3], [3, 5], [5, 3], [5, 5]],
			runs: [{ solution: solutionOf(6, [[1, 0.1], [2, 0], [3, 1], [5, 0]]) }],
		},
		{
			name: "optocoupler",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "optocoupler",
				ldrA: 3,
				ldrB: 4,
				ledAnode: 1,
				ledCathode: 2,
				ledThresholdVolts: 1,
				ledTransconductance: 1e-3,
				ldrMinOhms: 1000,
				ldrMaxOhms: 1e7,
			} as Stamp,
			expected: [
				[1, 1], [1, 2], [2, 1], [2, 2],
				[3, 3], [3, 4], [4, 3], [4, 4],
			],
			runs: [
				{ solution: solutionOf(5, [[1, 0], [2, 0]]) },
				{ solution: solutionOf(5, [[1, 2], [2, 0]]) },
			],
		},
		{
			name: "optocoupler with power-law fit",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "optocoupler",
				ldrA: 3,
				ldrB: 4,
				ledAnode: 1,
				ledCathode: 2,
				ledThresholdVolts: 1,
				ledTransconductance: 1e-3,
				ldrMinOhms: 1000,
				ldrMaxOhms: 1e7,
				ldrPowerLawCoefficientOhms: 1e5,
				ldrPowerLawExponent: -0.8,
			} as Stamp,
			expected: [
				[1, 1], [1, 2], [2, 1], [2, 2],
				[3, 3], [3, 4], [4, 3], [4, 4],
			],
			runs: [{ solution: solutionOf(5, [[1, 2], [2, 0]]) }],
		},
		{
			name: "analog-switch",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "analog-switch",
				a: 1,
				b: 2,
				control: 3,
				onOhms: 100,
				offOhms: 1e8,
				thresholdVolts: 2.5,
			} as Stamp,
			expected: [[1, 1], [1, 2], [2, 1], [2, 2], [1, 3], [2, 3]],
			runs: [
				{ solution: solutionOf(4, [[1, 1], [2, 0], [3, 0]]) },
				{ solution: solutionOf(4, [[1, 1], [2, 0.5], [3, 5]]) },
				{ solution: solutionOf(4, [[1, 1], [2, 1], [3, 5]]) },
			],
		},
		{
			name: "compandor",
			nodeCount: 6,
			auxCount: 0,
			stamp: {
				kind: "compandor",
				rectIn: 1,
				rectCap: 2,
				cellIn: 3,
				sumNode: 4,
				vref: 5,
				r1: 10_000,
				r2: 20_000,
				r5: 20_000,
				iBias: 140e-6,
				stateIndex: 0,
			} as Stamp,
			expected: [[4, 3], [4, 5]],
			runs: [
				{ solution: solutionOf(6, [[1, 1], [2, 0.5], [5, 1.8]]) },
				{ solution: solutionOf(6, [[1, 1.8], [2, 1.8], [5, 1.8]]) },
			],
		},
		{
			name: "clock-driver",
			nodeCount: 7,
			auxCount: 3,
			stamp: {
				kind: "clock-driver",
				cp1: 1,
				cp2: 2,
				vgg: 3,
				vdd: 4,
				ox1: 5,
				gnd: 6,
				defaultFrequency: 100_000,
				stateIndex: 0,
				sourceIndex: 0,
			} as Stamp,
			expected: [
				[7, 1], [1, 7], [7, 4], [7, 6], [7, 7],
				[8, 2], [2, 8], [8, 4], [8, 6], [8, 8],
				[9, 3], [3, 9], [9, 4], [9, 6], [9, 9],
			],
			runs: [
				{ state: stateOf([[0, 0.2]]), solution: solutionOf(10, [[5, 2.5]]) },
				{ state: stateOf([[0, 0.7]]), solution: solutionOf(10, [[5, 2.5]]) },
			],
		},
		{
			name: "clock-driver with grounded gnd pin",
			nodeCount: 7,
			auxCount: 3,
			stamp: {
				kind: "clock-driver",
				cp1: 1,
				cp2: 2,
				vgg: 3,
				vdd: 4,
				ox1: 5,
				gnd: 0,
				defaultFrequency: 100_000,
				stateIndex: 0,
				sourceIndex: 0,
			} as Stamp,
			expected: [
				[7, 1], [1, 7], [7, 4], [7, 7],
				[8, 2], [2, 8], [8, 4], [8, 8],
				[9, 3], [3, 9], [9, 4], [9, 9],
			],
			runs: [
				{ state: stateOf([[0, 0.2]]), solution: solutionOf(10, [[5, 2.5]]) },
				{ state: stateOf([[0, 0.7]]), solution: solutionOf(10, [[5, 2.5]]) },
			],
		},
		{
			name: "comparator",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "comparator",
				plus: 1,
				minus: 2,
				output: 3,
				vee: 4,
				pullDownOhms: 1000,
				floatOhms: 1e9,
				sensitivity: 100,
			} as Stamp,
			expected: [
				[3, 3], [3, 4], [4, 3], [4, 4],
				[3, 1], [3, 2], [4, 1], [4, 2],
			],
			runs: [
				{ solution: solutionOf(5, [[1, 5], [2, 0], [3, 9], [4, 0]]) },
				{ solution: solutionOf(5, [[1, 0], [2, 5], [3, 0], [4, 0]]) },
				{ solution: solutionOf(5, [[1, 0.001], [2, 0], [3, 4.5], [4, 0]]) },
			],
		},
		{
			name: "comparator with grounded vee",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "comparator",
				plus: 1,
				minus: 2,
				output: 3,
				vee: 0,
				pullDownOhms: 1000,
				floatOhms: 1e9,
				sensitivity: 100,
			} as Stamp,
			expected: [[3, 3], [3, 0], [3, 1], [3, 2]],
			runs: [{ solution: solutionOf(5, [[1, 5], [2, 0], [3, 9]]) }],
		},
		{
			name: "linear-vca",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "linear-vca",
				plus: 1,
				minus: 2,
				output: 3,
				control: 4,
				inputSiemens: 1e-3,
				vrefVolts: 1,
				minGain: 0.01,
			} as Stamp,
			expected: [[3, 1], [3, 2], [3, 4]],
			runs: [
				{ solution: solutionOf(5, [[1, 1], [2, 0], [4, 2]]) },
				{ solution: solutionOf(5, [[1, 1], [2, 0], [4, 0.001]]) },
			],
		},
		{
			name: "linear-vca with grounded minus",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "linear-vca",
				plus: 1,
				minus: 0,
				output: 2,
				control: 3,
				inputSiemens: 1e-3,
				vrefVolts: 1,
				minGain: 0.01,
			} as Stamp,
			expected: [[2, 1], [2, 3]],
			runs: [{ solution: solutionOf(5, [[1, 1], [3, 2]]) }],
		},
		{
			name: "dbx-vca",
			nodeCount: 5,
			auxCount: 0,
			stamp: {
				kind: "dbx-vca",
				plus: 1,
				minus: 2,
				output: 3,
				control: 4,
				inputSiemens: 1e-3,
				sustainGain: 1,
				sustainRef: 4.65,
				envelopeSlope: 0.1,
				kneeBaseVolts: 0.5,
				kneeTrack: 0.1,
				attackSeconds: 0.001,
				releaseSeconds: 0.1,
				releaseSlowdown: 2,
				releaseShape: 1,
				releaseMaxSeconds: 1,
				shutdownEdgeVolts: 1,
				shutdownGain: 1,
				primeRiseSeconds: 0.01,
				primeFallSeconds: 0.01,
				shutdownAttackSeconds: 0.001,
				shutdownFastSeconds: 0.01,
				shutdownSlowSeconds: 0.1,
				primeRefCurrent: 1e-6,
				minGainDb: -100,
				maxGainDb: 20,
				stateIndex: 0,
			} as Stamp,
			expected: [[3, 1], [3, 2]],
			runs: [
				{ solution: solutionOf(5, [[1, 1], [2, 0], [4, 5]]) },
				{ solution: solutionOf(5, [[1, 0], [2, 0], [4, 5]]) },
			],
		},
	];

	const subsets: SubsetCase[] = [
		{
			name: "analog-switch with grounded channel",
			nodeCount: 4,
			auxCount: 0,
			stamp: {
				kind: "analog-switch",
				a: 1,
				b: 0,
				control: 3,
				onOhms: 100,
				offOhms: 1e8,
				thresholdVolts: 2.5,
			} as Stamp,
			runs: [{ solution: solutionOf(4, [[1, 1], [3, 5]]) }],
		},
		{
			name: "d-flip-flop with grounded vss",
			nodeCount: 8,
			auxCount: 2,
			stamp: {
				kind: "d-flip-flop",
				clockNode: 1,
				dNode: 2,
				setNode: 3,
				resetNode: 4,
				qNode: 5,
				qBarNode: 6,
				vddNode: 7,
				vssNode: 0,
				sourceIndex: 0,
				sourceIndex2: 1,
				stateIndex: 0,
			} as Stamp,
			runs: [
				{
					state: stateOf([[0, 0], [1, 1], [2, 0]]),
					solution: solutionOf(10, [[1, 9], [2, 9], [3, 0], [4, 0], [7, 9]]),
				},
			],
		},
	];

	it("records exactly the hand-derived write set for every stamp kind", () => {
		for (const kase of cases) {
			const size = kase.nodeCount + kase.auxCount;
			const recorded = driveStamp(kase.stamp, kase.nodeCount, kase.auxCount, kase.runs);
			const expected = new Set(
				kase.expected.map(([row, column]) => key(size, row, column)),
			);
			expect(
				[...recorded].sort((a, b) => a - b),
				`${kase.name}: runtime write set`,
			).toEqual([...expected].sort((a, b) => a - b));
		}
	});

	it("covers every runtime-written cell in schedulePattern", () => {
		for (const kase of [...cases, ...subsets]) {
			const { pattern, size } = patternOf(kase.stamp, kase.nodeCount, kase.auxCount);
			const recorded = driveStamp(kase.stamp, kase.nodeCount, kase.auxCount, kase.runs);
			for (const cell of recorded) {
				expect(pattern.has(cell), `${kase.name}: cell ${cell} in pattern`).toBe(true);
			}
		}
	});

	it("fails when one exact cell is removed from the pattern (negative control)", () => {
		for (const kase of cases) {
			const { pattern, size } = patternOf(kase.stamp, kase.nodeCount, kase.auxCount);
			const recorded = driveStamp(kase.stamp, kase.nodeCount, kase.auxCount, kase.runs);
			const first = kase.expected.length > 0 ? kase.expected[0] : undefined;
			if (first === undefined) continue;
			const mutated = new Set(pattern);
			mutated.delete(key(size, first[0], first[1]));
			const missing = [...recorded].filter((cell) => !mutated.has(cell));
			expect(missing.length, `${kase.name}: removing one exact cell must break coverage`).toBeGreaterThan(0);
		}
	});

	it("is covered by the old full square (positive control)", () => {
		for (const kase of [...cases, ...subsets]) {
			const { pattern: square } = fullSquareOf(kase.stamp, kase.nodeCount, kase.auxCount);
			const recorded = driveStamp(kase.stamp, kase.nodeCount, kase.auxCount, kase.runs);
			for (const cell of recorded) {
				expect(square.has(cell), `${kase.name}: cell ${cell} in full square`).toBe(true);
			}
		}
	});

	it("covers the execution-only selector and legacy input shapes", () => {
		// The C++ console executes a multi-throw selector shape the compiler never emits;
		// the union covers its list exactly.
		const multi = {
			kind: "selector",
			common: 1,
			throwNode: -1,
			throwsList: [2, 3],
		} as unknown as Stamp;
		const listed = new Set<number>();
		for (const [row, column] of stampPatternCells(multi, 4)) {
			listed.add(row * 7 + column);
		}
		const wanted = new Set([1 * 7 + 1, 1 * 7 + 2, 2 * 7 + 1, 2 * 7 + 2, 1 * 7 + 3, 3 * 7 + 1, 3 * 7 + 3]);
		expect([...listed].sort((a, b) => a - b)).toEqual([...wanted].sort((a, b) => a - b));
		// And the legacy single-ended input resolution the C++ console keeps.
		const legacy = {
			kind: "input-source",
			node: -1,
			input: 2,
			sourceIndex: 0,
		} as unknown as Stamp;
		const resolved = new Set<number>();
		for (const [row, column] of stampPatternCells(legacy, 3)) {
			resolved.add(row * 4 + column);
		}
		expect([...resolved].sort((a, b) => a - b)).toEqual(
			[3 * 4 + 2, 2 * 4 + 3, 3 * 4 + 3].sort((a, b) => a - b),
		);
	});
});

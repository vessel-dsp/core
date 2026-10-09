// Pivot-guard and re-pivot contracts.
//
// Three load-bearing predicates the corpus never exercises (no corpus solve
// trips the guard), so only synthetic matrices pin them:
//
// - `shouldRefinePivotOrder`: the settle refinement predicate, table-driven
//   with the measured corpus numbers (`boss-sd-1` adopts; `boss-mt-2` is
//   cost-blocked; `boss-hm-2` ties and keeps shipped; `marshall-jcm800`'s
//   candidate never reaches the bar).
// - `runSparseSchedule`'s pivot floor: a collapsed pivot trips; a healthy
//   one does not; an all-zero gather trips rather than dividing silently.
//   (A relative guard was tried here and reverted: magnitude cannot separate
//   a healthy late-order gmin pivot from a fatal one -- see
//   `SCHEDULE_PIVOT_FLOOR` and `docs/spikes/2026-10-08-numeric-pivoting.md`.)
// - `adoptMidRunRepivot`: the one mid-run attempt adopts on a validating
//   candidate (buffers, flags and plan row all move) and refuses with a named
//   reason when no candidate meets the threshold.

import { describe, expect, it } from "bun:test";
import { compile, computeNumericRepivot, emptyRegistry } from "@vessel-dsp/compiler";
import { rcLadder } from "@vessel-dsp/compiler/fixtures/circuits";
import type { SparseSchedule } from "@vessel-dsp/compiler";
import {
	ReferenceRuntime,
	runSparseSchedule,
	SCHEDULE_PIVOT_FLOOR,
	shouldRefinePivotOrder,
} from "../src/reference-runtime";

function denseSolve(matrix: number[][], rhs: number[]): number[] {
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

describe("shouldRefinePivotOrder", () => {
	it("adopts the measured boss-sd-1 crossing", () => {
		expect(
			shouldRefinePivotOrder({
				shippedDisagreement: 1.8e-9,
				candidateDisagreement: 4.2e-13,
				shippedOps: 567,
				shippedSlots: 306,
				candidateOps: 604,
				candidateSlots: 317,
			}),
		).toBe(true);
	});
	it("refuses the boss-mt-2 cost blowout", () => {
		expect(
			shouldRefinePivotOrder({
				shippedDisagreement: 5.3e-9,
				candidateDisagreement: 5.6e-14,
				shippedOps: 1774,
				shippedSlots: 705,
				candidateOps: 2385,
				candidateSlots: 818,
			}),
		).toBe(false);
	});
	it("keeps shipped on ties", () => {
		// boss-hm-2: identical replays; adoption would be churn for noise.
		expect(
			shouldRefinePivotOrder({
				shippedDisagreement: 3.5e-9,
				candidateDisagreement: 3.5e-9,
				shippedOps: 1118,
				shippedSlots: 513,
				candidateOps: 1293,
				candidateSlots: 559,
			}),
		).toBe(false);
	});
	it("keeps shipped when the candidate never reaches the bar", () => {
		// marshall-jcm800: no threshold order replays the matrix cleanly.
		expect(
			shouldRefinePivotOrder({
				shippedDisagreement: 2.0e-6,
				candidateDisagreement: 2.0e-6,
				shippedOps: 757,
				shippedSlots: 444,
				candidateOps: 783,
				candidateSlots: 450,
			}),
		).toBe(false);
	});
	it("keeps shipped when it already replays cleanly", () => {
		expect(
			shouldRefinePivotOrder({
				shippedDisagreement: 1.6e-12,
				candidateDisagreement: 4.0e-14,
				shippedOps: 1065,
				shippedSlots: 463,
				candidateOps: 1242,
				candidateSlots: 498,
			}),
		).toBe(false);
	});
	it("never refines a bar-clean shipped order, however clean the candidate", () => {
		// trainwreck-express: 1000x replay gap at zero fill cost, audio
		// identical either way. Refining would churn the schedule -- and lose
		// its generated kernel -- for noise, and hiwatt-dr103 showed the two
		// consoles can read such a tie differently.
		expect(
			shouldRefinePivotOrder({
				shippedDisagreement: 2.5e-11,
				candidateDisagreement: 2.4e-14,
				shippedOps: 789,
				shippedSlots: 400,
				candidateOps: 789,
				candidateSlots: 400,
			}),
		).toBe(false);
	});
	it("never adopts on a non-positive or non-finite reading", () => {
		const base = {
			shippedDisagreement: 1.8e-9,
			candidateDisagreement: 4.2e-13,
			shippedOps: 567,
			shippedSlots: 306,
			candidateOps: 604,
			candidateSlots: 317,
		};
		expect(shouldRefinePivotOrder({ ...base, shippedDisagreement: 0 })).toBe(false);
		expect(
			shouldRefinePivotOrder({ ...base, candidateDisagreement: Infinity }),
		).toBe(false);
		expect(
			shouldRefinePivotOrder({ ...base, shippedDisagreement: Infinity }),
		).toBe(false);
	});
});

describe("relative pivot guard", () => {
	const size = 4;
	const pattern = Array.from({ length: size * size }, (_, index) => index);
	const base: SparseSchedule = {
		ops: [],
		slots: pattern.length,
		factorCount: 0,
		gatherRow: pattern.map((key) => Math.floor(key / size)),
		gatherColumn: pattern.map((key) => key % size),
		size,
		sparseOps: 0,
		denseOps: 0,
		unprovenPivots: 0,
	};
	const healthy: number[][] = [
		[4, 1, 0, 0],
		[1, 5, 1, 0],
		[0, 1, 6, 1],
		[0, 0, 1, 7],
	];
	const rhs = [1, -2, 3, 0.5];
	const schedule = computeNumericRepivot(base, size, healthy) as SparseSchedule;

	function replayOn(matrix: number[][]): boolean {
		return runSparseSchedule(
			schedule,
			matrix,
			rhs,
			new Float64Array(schedule.slots),
			new Float64Array(size),
			new Float64Array(schedule.factorCount),
			new Array<number>(size).fill(0),
		);
	}

	function pivotSlots(): { row: number; column: number }[] {
		const found: { row: number; column: number }[] = [];
		for (let at = 0; at < schedule.ops.length; at += 4) {
			if (schedule.ops[at] === 6) {
				const slot = schedule.ops[at + 1] as number;
				found.push({
					row: schedule.gatherRow[slot] as number,
					column: schedule.gatherColumn[slot] as number,
				});
			}
		}
		return found;
	}

	it("replays healthy matrices", () => {
		expect(replayOn(healthy.map((row) => [...row]))).toBe(true);
	});

	it("trips below the floor and holds an order above it", () => {
		const pivots = pivotSlots();
		expect(pivots.length).toBe(size);
		const target = pivots[0] as { row: number; column: number };
		const collapsed = healthy.map((row) => [...row]);
		(collapsed[target.row] as number[])[target.column] = SCHEDULE_PIVOT_FLOOR / 10;
		expect(replayOn(collapsed)).toBe(false);
		const zero = healthy.map((row) => [...row]);
		(zero[target.row] as number[])[target.column] = 0;
		expect(replayOn(zero)).toBe(false);
		const holding = healthy.map((row) => [...row]);
		(holding[target.row] as number[])[target.column] = SCHEDULE_PIVOT_FLOOR * 10;
		expect(replayOn(holding)).toBe(true);
	});

	it("trips an all-zero gather rather than dividing silently", () => {
		const zero = Array.from({ length: size }, () => new Array<number>(size).fill(0));
		expect(replayOn(zero)).toBe(false);
	});
});

describe("adoptMidRunRepivot", () => {
	function ladder(): { runtime: ReferenceRuntime; blockId: string } {
		const result = compile(rcLadder(10), { registry: emptyRegistry });
		if (result.status !== "ok") {
			throw new Error("ladder fixture should compile");
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		runtime.process(new Float64Array(0));
		const plan = runtime.solverPlan();
		const sparse = plan.blocks.find((block) => block.path === "sparse");
		if (sparse === undefined) {
			throw new Error("ladder fixture should admit a sparse block");
		}
		return { runtime, blockId: sparse.blockId };
	}

	type Internals = {
		sparseSchedules: Map<string, { schedule: SparseSchedule }>;
		repivotedSchedules: Set<string>;
		assembleAudioMatrix: (block: unknown) => { matrix: number[][]; rhs: number[] };
		blocksById: Map<string, unknown>;
		adoptMidRunRepivot: (
			blockId: string,
			entry: { schedule: SparseSchedule },
			matrix: number[][],
			rhs: number[],
			denseAnswer: number[],
		) => boolean;
		solverPlanRows: { blockId: string; reason: string }[];
	};

	it("adopts a validating candidate and marks the order spent", () => {
		const { runtime, blockId } = ladder();
		const internals = runtime as unknown as Internals;
		const entry = internals.sparseSchedules.get(blockId) as { schedule: SparseSchedule };
		const live = internals.blocksById.get(blockId);
		const { matrix, rhs } = internals.assembleAudioMatrix(live);
		const denseAnswer = denseSolve(
			matrix.map((row) => [...row]),
			[...rhs],
		);
		const adopted = internals.adoptMidRunRepivot(blockId, entry, matrix, rhs, denseAnswer);
		expect(adopted).toBe(true);
		expect(internals.repivotedSchedules.has(blockId)).toBe(true);
		const replaced = internals.sparseSchedules.get(blockId) as unknown as {
			consecutiveFallbacks: number;
			repivotAttempted: boolean;
		};
		expect(replaced.consecutiveFallbacks).toBe(0);
		expect(replaced.repivotAttempted).toBe(true);
		const row = internals.solverPlanRows.find((candidate) => candidate.blockId === blockId);
		expect(row?.reason).toContain("mid-run numeric re-pivot");
	});

	it("refuses with a named reason when no candidate meets the threshold", () => {
		const { runtime, blockId } = ladder();
		const internals = runtime as unknown as Internals;
		const entry = internals.sparseSchedules.get(blockId) as { schedule: SparseSchedule };
		const live = internals.blocksById.get(blockId);
		const { matrix } = internals.assembleAudioMatrix(live);
		const size = matrix.length;
		const zero = Array.from({ length: size }, () => new Array<number>(size).fill(0));
		const refused = internals.adoptMidRunRepivot(
			blockId,
			entry,
			zero,
			new Array<number>(size).fill(0),
			new Array<number>(size).fill(0),
		);
		expect(refused).toBe(false);
		expect(internals.repivotedSchedules.has(blockId)).toBe(false);
		const row = internals.solverPlanRows.find((candidate) => candidate.blockId === blockId);
		expect(row?.reason).toContain("refused");
	});
});

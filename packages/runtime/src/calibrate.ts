// Runtime calibration harness: measure this host's own dense-solve cost per
// unknown count, so the admission check in `./admission.ts` can be enforced.
//
// Method (the whole measurement, stated once so a reader can audit it).
// For each system size, in ascending order:
//  1. Call the caller-supplied factory once to prepare one workload, then run
//     `warmupSolves` untimed solves so caches, JIT state, and branch
//     predictors settle before any reading is taken.
//  2. Time batches of solves. A batch starts at `solvesPerSample` solves and
//     grows by factors of ten until the batch elapsed time is at least one
//     hundred times the stated timer resolution, so the clock resolution is
//     under one percent of every timed batch. Growth stops at
//     MAX_SOLVES_PER_SAMPLE; if even that batch is unresolved, calibration
//     refuses with `timer-too-coarse` instead of reporting a number the clock
//     cannot support. Probe batches are discarded, never counted as samples.
//  3. Take `samples` timed batches. Each sample is the batch elapsed time
//     divided by the batch solve count, in nanoseconds per solve.
//  4. Report the MEDIAN of the samples as the size's cost. Median, not mean:
//     a single huge sample (a scheduling pause, a garbage collection, a
//     thermal excursion) moves the mean by a large fraction and barely moves
//     the median, and with a handful of samples the median stays
//     representative of the sustained cost admission must budget for.
//  5. Report spread as the interquartile range over the median
//     (`spreadFraction = (q3 - q1) / median`, Tukey hinges: q1 is the median
//     of the lower floor(n/2) samples, q3 the median of the upper
//     floor(n/2)). A single sample gives spread zero.
//  6. Enforce a monotone non-decreasing envelope across sizes: a larger
//     system never reports cheaper than a smaller one. Correction is a
//     running maximum over ascending sizes (each size is raised to the
//     largest median seen so far, never lowered), and every correction is
//     listed in `corrections` with both the measured and the reported
//     figure, so no adjustment is silent.
//
// The `nsPerSolve` curve interpolates log-log between measured sizes,
// clamps below the smallest measured size (a tiny system is charged at the
// smallest measured cost, which is conservative), and extrapolates beyond
// the largest measured size with one fitted exponent: the least-squares
// slope of log cost on log size over the whole corrected table, anchored at
// the largest measured point so the curve is continuous there. A
// single-size table is constant everywhere. Non-positive or non-finite
// counts throw a RangeError.
//
// This module is ENGINE-AGNOSTIC. The caller passes the thing to time (a
// factory returning a one-solve function), so today it times a TypeScript
// solve and later the WebAssembly console. It invents no engine numbers:
// every nanosecond in the table was read off the injected clock.
//
// Clocks. `now` returns NANOSECONDS. The default wraps `performance.now`
// (which reports milliseconds) with the millisecond-to-nanosecond factor.
// `minTimerResolutionNs` is the smallest difference the clock can honestly
// report; the batch-growth loop enforces the one-percent rule against it.

import type { RealtimeBudget } from "./admission";

/** Sizes measured when the caller states none. */
export const DEFAULT_CALIBRATION_SIZES: readonly number[] = [2, 4, 8, 16, 32, 64];

/** Batches never grow past this many solves; beyond it the clock is refused. */
const MAX_SOLVES_PER_SAMPLE = 1_000_000;

/** A timed batch must last at least this many times the stated resolution. */
const BATCH_RESOLUTION_MARGIN = 100;

/** Default assumed resolution of a `performance.now`-derived clock. */
const DEFAULT_TIMER_RESOLUTION_NS = 1000;

export type CalibrateOptions = {
	/** Factory: prepare a workload for `unknownCount` unknowns, return one solve. */
	readonly solve: (unknownCount: number) => () => void;
	/** System sizes to measure. Defaults to DEFAULT_CALIBRATION_SIZES. */
	readonly sizes?: readonly number[];
	/** Untimed solves per size before sampling. Default 50. Zero skips warmup. */
	readonly warmupSolves?: number;
	/** Starting solves per timed batch; grows until the clock resolves it. Default 100. */
	readonly solvesPerSample?: number;
	/** Timed batches per size. Default 7. */
	readonly samples?: number;
	/** Injected clock in nanoseconds. Default wraps `performance.now`. */
	readonly now?: () => number;
	/** Smallest honest clock difference in ns. Default 1000. */
	readonly minTimerResolutionNs?: number;
};

export type CalibrationRow = {
	readonly unknownCount: number;
	/** Median ns per solve across samples, after the monotone envelope. */
	readonly medianNsPerSolve: number;
	/** Interquartile range over the median, before the envelope. */
	readonly spreadFraction: number;
	/** How many timed batches the median and spread were computed from. */
	readonly samples: number;
};

export type CalibrationCorrection = {
	readonly unknownCount: number;
	readonly measuredNsPerSolve: number;
	readonly correctedNsPerSolve: number;
};

export type ToRealtimeBudgetArgs = {
	/**
	 * The host's own measured per-sample cost of the named DSP model.
	 * Calibration cannot measure this (it times dense solves, not models),
	 * so the host supplies it here; it is required, never defaulted, because
	 * admission refuses unpriced models and a silent zero would waive that.
	 */
	readonly nsPerMacroSample: (modelId: string) => number;
	/** Host policy, passed through when given; omitted otherwise. */
	readonly budgetedIterationsPerSample?: number;
	/** Host policy, passed through when given; omitted otherwise. */
	readonly cpuBudgetFraction?: number;
};

export type CalibrationResult = {
	readonly ok: true;
	readonly table: readonly CalibrationRow[];
	readonly corrections: readonly CalibrationCorrection[];
	readonly nsPerSolve: (unknownCount: number) => number;
	readonly toRealtimeBudget: (args: ToRealtimeBudgetArgs) => RealtimeBudget;
};

/** Closed reason codes; compare whole values, never message text. */
export type CalibrationReason =
	| "no-sizes"
	| "bad-size"
	| "zero-solves"
	| "timer-too-coarse"
	| "solve-threw"
	| "non-finite-time";

export type CalibrationRefusal =
	| { readonly ok: false; readonly reason: "no-sizes" }
	| {
			readonly ok: false;
			readonly reason: "bad-size";
			readonly size: number;
			readonly index: number;
	  }
	| {
			readonly ok: false;
			readonly reason: "zero-solves";
			readonly field: "warmupSolves" | "solvesPerSample" | "samples";
			readonly value: number;
	  }
	| {
			readonly ok: false;
			readonly reason: "timer-too-coarse";
			readonly unknownCount: number;
			readonly resolutionNs: number;
			readonly largestBatchSolves: number;
			readonly elapsedNs: number;
	  }
	| {
			readonly ok: false;
			readonly reason: "solve-threw";
			readonly unknownCount: number;
			readonly thrown: unknown;
	  }
	| {
			readonly ok: false;
			readonly reason: "non-finite-time";
			readonly unknownCount: number;
			readonly t0Ns: number;
			readonly t1Ns: number;
	  };

function defaultNowNs(): number {
	return performance.now() * 1e6;
}

function isPositiveInt(value: number): boolean {
	return Number.isInteger(value) && value > 0;
}

function medianOfSorted(sorted: readonly number[]): number {
	const n = sorted.length;
	const mid = Math.floor(n / 2);
	if (n % 2 === 1) {
		return sorted[mid] as number;
	}
	return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Least-squares slope of log(cost) on log(size); 0 when no slope exists. */
function fitLogLogExponent(
	points: readonly { unknownCount: number; costNs: number }[],
): number {
	const usable = points.filter((p) => p.unknownCount > 0 && p.costNs > 0);
	if (usable.length < 2) {
		return 0;
	}
	let sumX = 0;
	let sumY = 0;
	let sumXX = 0;
	let sumXY = 0;
	for (const p of usable) {
		const x = Math.log(p.unknownCount);
		const y = Math.log(p.costNs);
		sumX += x;
		sumY += y;
		sumXX += x * x;
		sumXY += x * y;
	}
	const m = usable.length;
	const denominator = m * sumXX - sumX * sumX;
	if (denominator === 0 || !Number.isFinite(denominator)) {
		return 0;
	}
	const slope = (m * sumXY - sumX * sumY) / denominator;
	return Number.isFinite(slope) ? slope : 0;
}

function buildNsPerSolve(
	rows: readonly { unknownCount: number; costNs: number }[],
): (unknownCount: number) => number {
	const bySize = new Map<number, number>();
	for (const row of rows) {
		bySize.set(row.unknownCount, row.costNs);
	}
	const ascending = [...rows].sort((a, b) => a.unknownCount - b.unknownCount);
	const exponent = fitLogLogExponent(ascending);
	const smallest = ascending[0] as { unknownCount: number; costNs: number };
	const largest = ascending[ascending.length - 1] as {
		unknownCount: number;
		costNs: number;
	};
	return (unknownCount: number): number => {
		if (!Number.isFinite(unknownCount) || unknownCount <= 0) {
			throw new RangeError(
				`nsPerSolve requires a positive finite unknown count, got ${unknownCount}`,
			);
		}
		const exact = bySize.get(unknownCount);
		if (exact !== undefined) {
			return exact;
		}
		if (unknownCount < smallest.unknownCount) {
			return smallest.costNs;
		}
		if (ascending.length === 1) {
			return smallest.costNs;
		}
		for (let i = 0; i < ascending.length - 1; i++) {
			const lo = ascending[i] as { unknownCount: number; costNs: number };
			const hi = ascending[i + 1] as { unknownCount: number; costNs: number };
			if (unknownCount > lo.unknownCount && unknownCount < hi.unknownCount) {
				const t =
					(Math.log(unknownCount) - Math.log(lo.unknownCount)) /
					(Math.log(hi.unknownCount) - Math.log(lo.unknownCount));
				return Math.exp(
					Math.log(lo.costNs) + t * (Math.log(hi.costNs) - Math.log(lo.costNs)),
				);
			}
		}
		return largest.costNs * (unknownCount / largest.unknownCount) ** exponent;
	};
}

/**
 * Measure this host's dense-solve cost per unknown count. Refuses with a
 * typed reason instead of reporting a number the inputs cannot support.
 */
export function calibrateNsPerSolve(
	options: CalibrateOptions,
): CalibrationResult | CalibrationRefusal {
	const solve = options.solve;
	if (typeof solve !== "function") {
		throw new TypeError("calibrateNsPerSolve requires a solve factory");
	}
	const sizes = options.sizes ?? DEFAULT_CALIBRATION_SIZES;
	if (sizes.length === 0) {
		return { ok: false, reason: "no-sizes" };
	}
	for (const [index, size] of sizes.entries()) {
		if (!isPositiveInt(size)) {
			return { ok: false, reason: "bad-size", size, index };
		}
	}
	const warmupSolves = options.warmupSolves ?? 50;
	if (!Number.isInteger(warmupSolves) || warmupSolves < 0 || !Number.isFinite(warmupSolves)) {
		return {
			ok: false,
			reason: "zero-solves",
			field: "warmupSolves",
			value: warmupSolves,
		};
	}
	const solvesPerSample = options.solvesPerSample ?? 100;
	if (!isPositiveInt(solvesPerSample)) {
		return {
			ok: false,
			reason: "zero-solves",
			field: "solvesPerSample",
			value: solvesPerSample,
		};
	}
	const samples = options.samples ?? 7;
	if (!isPositiveInt(samples)) {
		return {
			ok: false,
			reason: "zero-solves",
			field: "samples",
			value: samples,
		};
	}
	const now = options.now ?? defaultNowNs;
	const resolutionNs = options.minTimerResolutionNs ?? DEFAULT_TIMER_RESOLUTION_NS;
	if (!Number.isFinite(resolutionNs) || resolutionNs < 0) {
		throw new RangeError(
			`minTimerResolutionNs must be a finite number at least 0, got ${resolutionNs}`,
		);
	}
	const requiredBatchNs = BATCH_RESOLUTION_MARGIN * resolutionNs;

	const ordered = [...sizes].sort((a, b) => a - b);
	const measured: { unknownCount: number; median: number; spread: number }[] = [];
	for (const unknownCount of ordered) {
		let run: () => void;
		try {
			run = solve(unknownCount);
		} catch (thrown) {
			return { ok: false, reason: "solve-threw", unknownCount, thrown };
		}
		if (typeof run !== "function") {
			return {
				ok: false,
				reason: "solve-threw",
				unknownCount,
				thrown: new TypeError(
					`solve factory for ${unknownCount} unknowns did not return a function`,
				),
			};
		}
		try {
			for (let i = 0; i < warmupSolves; i++) {
				run();
			}
		} catch (thrown) {
			return { ok: false, reason: "solve-threw", unknownCount, thrown };
		}
		// Grow the batch until the clock resolves it with margin, or refuse.
		let batch = solvesPerSample;
		let elapsedNs = 0;
		for (;;) {
			let t0Ns: number;
			let t1Ns: number;
			try {
				t0Ns = now();
				for (let i = 0; i < batch; i++) {
					run();
				}
				t1Ns = now();
			} catch (thrown) {
				return { ok: false, reason: "solve-threw", unknownCount, thrown };
			}
			if (
				!Number.isFinite(t0Ns) ||
				!Number.isFinite(t1Ns) ||
				!Number.isFinite(t1Ns - t0Ns) ||
				t1Ns - t0Ns < 0
			) {
				return {
					ok: false,
					reason: "non-finite-time",
					unknownCount,
					t0Ns,
					t1Ns,
				};
			}
			elapsedNs = t1Ns - t0Ns;
			if (elapsedNs >= requiredBatchNs) {
				break;
			}
			if (batch >= MAX_SOLVES_PER_SAMPLE) {
				return {
					ok: false,
					reason: "timer-too-coarse",
					unknownCount,
					resolutionNs,
					largestBatchSolves: batch,
					elapsedNs,
				};
			}
			batch = Math.min(batch * 10, MAX_SOLVES_PER_SAMPLE);
		}
		const perSolve: number[] = [];
		for (let s = 0; s < samples; s++) {
			let t0Ns: number;
			let t1Ns: number;
			try {
				t0Ns = now();
				for (let i = 0; i < batch; i++) {
					run();
				}
				t1Ns = now();
			} catch (thrown) {
				return { ok: false, reason: "solve-threw", unknownCount, thrown };
			}
			if (
				!Number.isFinite(t0Ns) ||
				!Number.isFinite(t1Ns) ||
				!Number.isFinite(t1Ns - t0Ns) ||
				t1Ns - t0Ns < 0
			) {
				return {
					ok: false,
					reason: "non-finite-time",
					unknownCount,
					t0Ns,
					t1Ns,
				};
			}
			perSolve.push((t1Ns - t0Ns) / batch);
		}
		const sorted = [...perSolve].sort((a, b) => a - b);
		const median = medianOfSorted(sorted);
		const half = Math.floor(sorted.length / 2);
		const q1 = medianOfSorted(sorted.slice(0, half === 0 ? 1 : half));
		const q3 = medianOfSorted(
			sorted.slice(sorted.length - (half === 0 ? 1 : half)),
		);
		const spread = median > 0 ? (q3 - q1) / median : 0;
		measured.push({ unknownCount, median, spread });
	}
	// Monotone non-decreasing envelope over ascending sizes, reporting fixes.
	const table: CalibrationRow[] = [];
	const corrections: CalibrationCorrection[] = [];
	let ceiling = 0;
	for (const row of measured) {
		const corrected = Math.max(row.median, ceiling);
		if (corrected > row.median) {
			corrections.push({
				unknownCount: row.unknownCount,
				measuredNsPerSolve: row.median,
				correctedNsPerSolve: corrected,
			});
		}
		ceiling = corrected;
		table.push({
			unknownCount: row.unknownCount,
			medianNsPerSolve: corrected,
			spreadFraction: row.spread,
			samples,
		});
	}
	const nsPerSolve = buildNsPerSolve(
		table.map((row) => ({
			unknownCount: row.unknownCount,
			costNs: row.medianNsPerSolve,
		})),
	);
	return {
		ok: true,
		table,
		corrections,
		nsPerSolve,
		toRealtimeBudget: (args: ToRealtimeBudgetArgs): RealtimeBudget => {
			const budget: RealtimeBudget = {
				nsPerSolve,
				nsPerMacroSample: args.nsPerMacroSample,
			};
			return {
				...budget,
				...(args.budgetedIterationsPerSample !== undefined
					? {
							budgetedIterationsPerSample: args.budgetedIterationsPerSample,
						}
					: {}),
				...(args.cpuBudgetFraction !== undefined
					? { cpuBudgetFraction: args.cpuBudgetFraction }
					: {}),
			};
		},
	};
}

// Sink the timed solution checksum here so the solve loop stays observable
// work no engine may legally skip. Module-private: it is a DCE guard, not
// part of the interface.
let denseSolveSink = 0;

/**
 * A TEST WORKLOAD for calibration, not a claim about the real engine. It
 * performs one dense Gaussian elimination with partial pivoting on a fixed
 * well-conditioned diagonally dominant n by n system in plain TypeScript,
 * deterministically (same entries every call), with no allocation inside the
 * timed function (all working buffers are preallocated by the factory).
 * Later the same harness times the WebAssembly console instead; figures from
 * this workload describe the TypeScript loop under the calibrating host and
 * nothing else.
 */
export function denseLinearSolveWorkload(unknownCount: number): () => void {
	if (!isPositiveInt(unknownCount)) {
		throw new RangeError(
			`denseLinearSolveWorkload requires a positive integer unknown count, got ${unknownCount}`,
		);
	}
	const n = unknownCount;
	const base = new Float64Array(n * n);
	const rhs = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			// Diagonal 2n dominates the harmonic off-diagonal tail, so the
			// system is strictly diagonally dominant and well-conditioned.
			base[i * n + j] = i === j ? 2 * n : 1 / (1 + Math.abs(i - j));
		}
		rhs[i] = 1 + (i % 7);
	}
	const lu = new Float64Array(n * n);
	const x = new Float64Array(n);
	return (): void => {
		lu.set(base);
		x.set(rhs);
		for (let col = 0; col < n; col++) {
			let pivot = col;
			let best = Math.abs(lu[col * n + col] as number);
			for (let row = col + 1; row < n; row++) {
				const mag = Math.abs(lu[row * n + col] as number);
				if (mag > best) {
					best = mag;
					pivot = row;
				}
			}
			if (pivot !== col) {
				for (let k = col; k < n; k++) {
					const tmp = lu[col * n + k] as number;
					lu[col * n + k] = lu[pivot * n + k] as number;
					lu[pivot * n + k] = tmp;
				}
				const tmp = x[col] as number;
				x[col] = x[pivot] as number;
				x[pivot] = tmp;
			}
			const diag = lu[col * n + col] as number;
			for (let row = col + 1; row < n; row++) {
				const factor = (lu[row * n + col] as number) / diag;
				lu[row * n + col] = factor;
				for (let k = col + 1; k < n; k++) {
					lu[row * n + k] =
						(lu[row * n + k] as number) - factor * (lu[col * n + k] as number);
				}
				x[row] = (x[row] as number) - factor * (x[col] as number);
			}
		}
		for (let row = n - 1; row >= 0; row--) {
			let sum = x[row] as number;
			for (let k = row + 1; k < n; k++) {
				sum -= (lu[row * n + k] as number) * (x[k] as number);
			}
			x[row] = sum / (lu[row * n + row] as number);
		}
		let checksum = 0;
		for (let i = 0; i < n; i++) {
			checksum += x[i] as number;
		}
		denseSolveSink += checksum;
	};
}

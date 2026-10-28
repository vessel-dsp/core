// Per-device oversample chooser: the pure decision half.
//
// This module is deliberately dependency-free (only a `Program` TYPE
// import, erased at build): it is imported by BOTH the page-side engine
// (`player-engine.ts`) and the audio-thread worklet bundle
// (`worklet/player-worklet.ts`), so it must add no runtime edge to either
// bundle -- the worklet bundle's no-external-imports assertion depends on
// it. Measurement lives in the worklet (the path that actually plays, on
// the shipped WASM console); the rule that turns measurements into a
// factor lives here, once, so both sides decide identically.
//
// Inputs to the decision are ONLY the measured cost on this device and
// typed program facts (operators). Nothing here keys on pedal ids, packet
// names, or prose, and no new `.vdsp` field exists.

import type { Program } from "@vessel-dsp/compiler";

/**
 * Factors the worklet measures, highest first. 1 is never measured: it is
 * today's behaviour and the fail-closed default. 8 is deliberately absent:
 * on the bench pedal (mxr distortion-plus, 0.1 V, latency-aligned) parity
 * was 0.9964 / 0.9988 / 0.9993 at 2/4/8, so 8 buys ~0.0005 of correlation
 * for roughly double the cost of 4 -- accuracy first does not justify it.
 */
export const OVERSAMPLE_MEASURED_CANDIDATES: readonly number[] = [4, 2];

/** The fail-closed factor: today's behaviour, never measured, always allowed. */
export const OVERSAMPLE_DEFAULT_FACTOR = 1;

/**
 * Audio quantum the measurement prices, in frames. 128 is the real path:
 * both worklets render 128-frame quanta, so a block time measured here is
 * directly comparable to the deadline the audio thread must meet.
 */
export const OVERSAMPLE_QUANTUM_FRAMES = 128;

/** Warm-up blocks per factor before timing starts (state settling, not priced). */
export const OVERSAMPLE_WARMUP_BLOCKS = 16;

/**
 * Timed blocks per factor. p99 over 100 is the 2nd-worst block: a robust
 * tail statistic that still fits in ~270 ms of audio per factor.
 */
export const OVERSAMPLE_MEASURE_BLOCKS = 100;

/**
 * Measurement drive: 0.3 V peak sine at 1 kHz. Cost is much lower at quiet
 * input (the nonlinear solve converges in 1-2 iterations), so a quiet
 * probe would price the linear regime and admit a factor the guitar then
 * blows past. 0.3 V is well above the ~70-100 mV point where the bench
 * pedal's clipper network breaks from ngspice, exercising the Newton solve
 * every cycle; it is the SAME drive for every packet, so the rule cannot
 * favour one circuit over another.
 */
export const OVERSAMPLE_DRIVE_VOLTS_PEAK = 0.3;
export const OVERSAMPLE_DRIVE_HZ = 1000;

/**
 * Headroom fraction of one quantum a factor's p99 block may cost.
 *
 * p99 <= 50% of the quantum (1.33 ms at 48 kHz / 128 frames). Three
 * margins in one number, all documented because the number is a judgment:
 * (1) the 1% tail beyond p99 still has the other half of the quantum to
 * land in -- the audio thread MUTES a stage that misses its deadline, so
 * the failure mode is silence, not delay; (2) NAM/IR add their own cost on
 * top, priced separately by the admission gate; (3) this device's load
 * varies (thermal, background work) and the measurement is one moment.
 * The same fraction prices every packet on every device.
 */
export const OVERSAMPLE_HEADROOM_FRACTION = 0.5;

/** Largest factor the chooser can select (candidates plus the 1x default). */
export const OVERSAMPLE_MAX_FACTOR = 4;

/**
 * DSP algorithms that count SOLVER samples and therefore mistune when the
 * solver rate rises under oversampling. The host-rate audit
 * (`docs/spikes/2026-10-10-host-rate.md` §5b) classified every rate and
 * sample-count site in the shipped sources: every delay length, LFO
 * increment, envelope alpha and tap-tempo time derives from the solver
 * rate in seconds and stays correct -- EXCEPT the pitch tracker (window
 * 2048, hop 256, lags 20..1024 in solver samples: loses the low E at any
 * solver rate >= 96 kHz, measured) and the pitch shifter (history 4096,
 * window 2048 in solver samples: a 42.7 ms grain at 48 kHz is 10.7 ms at
 * 192 kHz, read from source). No MNA stamp kind (`requiredOperators`) is
 * rate-dependent, so the exclusion below reads the two places these
 * algorithms are TYPED program facts: `requiredModels` (registry-derived
 * compositions) and composed blocks' primitive ops (declared
 * compositions). Never pedal ids, names, or prose.
 */
export const RATE_DEPENDENT_PROGRAM_ALGORITHMS: readonly string[] = [
	"pitch-shift",
	"pitch-tracker",
];

/** One factor's measured cost, as the worklet reports it. */
export type OversampleFactorMeasurement = {
	readonly factor: number;
	/** False when the factor threw or returned a non-finite cost. */
	readonly ok: boolean;
	/** 99th-percentile block time in ms (nearest-rank over MEASURE blocks). */
	readonly p99Ms?: number;
	/** Mean block time in ms (re-gates chain changes without re-measuring). */
	readonly meanMs?: number;
	/** Worst block time in ms (context, not the decision input). */
	readonly maxMs?: number;
	/** Blocks timed (MEASURE blocks when ok). */
	readonly blocks?: number;
	/** Why this factor was not measured or failed, when ok is false. */
	readonly note?: string;
};

/** The decision both sides share: the factor, why, and what was priced. */
export type OversampleDecision = {
	readonly factor: number;
	readonly reason: string;
	readonly costs: readonly OversampleFactorMeasurement[];
	readonly excluded: boolean;
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function formatMs(value: number): string {
	return `${value.toFixed(2)} ms`;
}

/**
 * Whether oversampling must stay off for this program, derived from typed
 * program facts only. Returns the first rate-dependent algorithm found and
 * where the program declares it, for the reason string.
 */
export function oversampleExclusion(program: Program | null | undefined): {
	readonly excluded: boolean;
	readonly reason: string;
} {
	if (program === null || program === undefined) {
		return { excluded: false, reason: "no program to inspect" };
	}
	const models = program.requiredModels ?? [];
	for (const algorithm of RATE_DEPENDENT_PROGRAM_ALGORITHMS) {
		if (models.includes(algorithm)) {
			return {
				excluded: true,
				reason: `program needs ${algorithm} (requiredModels), which counts solver samples and mistunes above 1x`,
			};
		}
	}
	for (const block of program.blocks ?? []) {
		if (block.kind !== "composed") {
			continue;
		}
		for (const position of block.positions ?? []) {
			for (const op of position.ops ?? []) {
				if (
					op.op === "pitch-shift" ||
					op.op === "pitch-tracker"
				) {
					return {
						excluded: true,
						reason: `program needs ${op.op} (composed block "${block.id}"), which counts solver samples and mistunes above 1x`,
					};
				}
			}
		}
	}
	return { excluded: false, reason: "no rate-dependent algorithm in this program" };
}

/**
 * Validate an explicit override (the ONLY configuration surface besides
 * the measurement itself). A finite integer >= 1 is honoured as-is --
 * benchmarking is exactly what it is for, so it bypasses the exclusion
 * too, and says so in the reason. Anything else is ignored (the normal
 * path runs) and the reason says so: a misconfiguration must not fail a
 * load, and must not silently change it either.
 */
export function validateOversampleOverride(
	override: number | undefined,
): { readonly factor: number | null; readonly note: string | null } {
	if (override === undefined) {
		return { factor: null, note: null };
	}
	if (Number.isInteger(override) && override >= 1 && Number.isFinite(override)) {
		return { factor: override, note: null };
	}
	return {
		factor: null,
		note: `ignoring invalid oversample override ${String(override)}`,
	};
}

/**
 * The decision rule, pure: measured costs in, factor and reason out.
 * Highest fitting candidate wins (accuracy first); anything unmeasured or
 * failed steps down; 1x is the fail-closed default. The SAME rule prices
 * every packet: no pedal identity enters, only costs and operators.
 */
export function chooseOversampleFactor(options: {
	readonly costs: readonly OversampleFactorMeasurement[];
	readonly quantumMs: number;
	readonly headroomFraction?: number;
	readonly exclusion?: { readonly excluded: boolean; readonly reason: string };
	readonly override?: number;
}): OversampleDecision {
	const headroom = options.headroomFraction ?? OVERSAMPLE_HEADROOM_FRACTION;
	const budgetMs = options.quantumMs * headroom;
	const costs = [...options.costs];
	const prefix: string[] = [];

	const override = validateOversampleOverride(options.override);
	if (override.note !== null) {
		prefix.push(override.note);
	}
	if (override.factor !== null) {
		return {
			factor: override.factor,
			reason: [...prefix, `explicit override ${String(override.factor)}x (measurement and exclusion bypassed)`].join("; "),
			costs,
			excluded: false,
		};
	}
	if (options.exclusion?.excluded === true) {
		return {
			factor: OVERSAMPLE_DEFAULT_FACTOR,
			reason: [...prefix, `held at 1x: ${options.exclusion.reason}`].join("; "),
			costs,
			excluded: true,
		};
	}
	const failures: string[] = [];
	const seen = new Set<number>();
	for (const factor of OVERSAMPLE_MEASURED_CANDIDATES) {
		seen.add(factor);
		const measured = costs.find((entry) => entry.factor === factor);
		if (measured === undefined) {
			failures.push(`${String(factor)}x not tried`);
			continue;
		}
		if (measured.ok !== true || !isFiniteNumber(measured.p99Ms)) {
			failures.push(
				`${String(factor)}x not priced (${measured.note ?? "no usable cost"})`,
			);
			continue;
		}
		if (measured.p99Ms <= budgetMs) {
			const picked = `${String(factor)}x: p99 ${formatMs(measured.p99Ms)} of ${formatMs(options.quantumMs)} quantum (headroom ${String(Math.round(headroom * 100))}%)`;
			// Lower candidates never priced because a higher one fit: name
			// them as not tried, not as failed.
			const tail: string[] = [...failures];
			for (const lower of OVERSAMPLE_MEASURED_CANDIDATES) {
				if (!seen.has(lower) && costs.every((entry) => entry.factor !== lower)) {
					tail.push(`${String(lower)}x not tried`);
				}
			}
			return {
				factor,
				reason: [...prefix, tail.length > 0 ? `${picked}; ${tail.join("; ")}` : picked].join("; "),
				costs,
				excluded: false,
			};
		}
		failures.push(
			`${String(factor)}x p99 ${formatMs(measured.p99Ms)} exceeded ${formatMs(budgetMs)} budget`,
		);
	}
	const detail = failures.length > 0 ? `: ${failures.join("; ")}` : "";
	return {
		factor: OVERSAMPLE_DEFAULT_FACTOR,
		reason: [...prefix, `fail closed to 1x (today's behaviour)${detail}`].join("; "),
		costs,
		excluded: false,
	};
}

/**
 * Re-decide when the chain changes (NAM/IR added or removed) WITHOUT
 * re-measuring: the program is unchanged, so its cached per-factor means
 * still price it, and only the extras moved. Steps down from the current
 * factor through measured factors; 1x is always allowed (today's path --
 * the worklet re-measures and the admission gate decides there). Returns
 * null only when even the measured factors are unusable AND 1x must take
 * over -- which is not a refusal: the caller still runs the existing
 * admission gate at 1x, unchanged.
 */
export function redecideOversampleOnRebuild(options: {
	readonly costs: readonly OversampleFactorMeasurement[];
	readonly currentFactor: number;
	readonly extrasNsPerSample: number;
	readonly budgetNsPerSample: number;
}): { readonly factor: number; readonly reason: string } {
	for (const factor of [...new Set([options.currentFactor, ...OVERSAMPLE_MEASURED_CANDIDATES, OVERSAMPLE_DEFAULT_FACTOR])]) {
		if (factor > options.currentFactor || factor < OVERSAMPLE_DEFAULT_FACTOR) {
			continue;
		}
		if (factor === OVERSAMPLE_DEFAULT_FACTOR) {
			return {
				factor,
				reason: `stepped down to 1x after the chain change (today's path; the worklet gate decides)`,
			};
		}
		const measured = options.costs.find((entry) => entry.factor === factor);
		if (measured?.ok !== true || !isFiniteNumber(measured.meanMs)) {
			continue;
		}
		const totalNs = (measured.meanMs * 1e6) / OVERSAMPLE_QUANTUM_FRAMES + options.extrasNsPerSample;
		if (totalNs <= options.budgetNsPerSample) {
			return {
				factor,
				reason: `kept ${String(factor)}x after the chain change (cached mean ${(measured.meanMs).toFixed(3)} ms/block plus ${(options.extrasNsPerSample).toFixed(0)} ns extras inside ${(options.budgetNsPerSample).toFixed(0)} ns budget)`,
			};
		}
	}
	return {
		factor: OVERSAMPLE_DEFAULT_FACTOR,
		reason: `stepped down to 1x after the chain change (today's path; the worklet gate decides)`,
	};
}

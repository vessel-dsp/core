// The executable semantics of the program format: a compiled program in, audio out.
//
// This is the definition of what a program *means*, in the same repository as the
// compiler that produces one, so the pipeline can be proven end to end without a build
// step and so any other implementer -- C++/WASM today, ESP32 later -- has something exact
// to match. It interprets stamps directly, which makes it both the first executor and
// the **reference every optimised path is diffed against**: same program, same input,
// exact agreement. See `thoughts/shared/plans/2026-08-12-runtime-modules.md`.
//
// It is where decisions 2 and 3 stop being prose:
//
//   - `prepare(sampleRate)` is the ONLY place a rate enters. There is no default and
//     no fallback: an unusable rate throws. A capacitor's companion conductance is
//     2C/dt computed here, so one program runs correctly at any rate.
//   - `setControl(id, position)` takes 0..1 and applies the program's own taper.
//     Moving a knob re-stamps conductances; it never re-lowers.
//
// Boundary: this module imports the program *contract* from `src/compiler/` and nothing
// else, and `src/compiler/` never imports this. Either can be deleted without the other
// noticing. Nothing from the old spine (`src/web`, `src/admission`, `src/container`,
// `src/dsp`) may be imported here.

import type {
	ComposedLineSweep,
	Block,
	ClockLawParams,
	ComposedSource,
	Control,
	ControlId,
	DelayLengthSpec,
	OperatorKind,
	Program,
	SparseSchedule,
	Stamp,
} from "@vessel-dsp/compiler";
import { computeNumericRepivot } from "@vessel-dsp/compiler";
import { admissionVerdict, type RealtimeBudget } from "./admission";
import {
	HalfBandStage2x,
	cascadeLatencyHostSamples,
	designHalfBand2x,
	resampleStageSpec,
} from "./resample";
import type { SupplyAddress, SupplyInfo } from "./supply";
import { taperFraction } from "./taper";

/**
 * What the solver did, so that failing to solve is never silent.
 *
 * A Newton loop that exhausts its iteration cap and then uses whatever iterate it
 * happens to hold produces plausible audio for a circuit it did not actually solve --
 * the same shape as a device law with no stamp, and just as invisible. Counting the
 * failures is the minimum; a real-time runtime cannot throw mid-buffer, but it must
 * never pretend.
 */
export type RuntimeTelemetry = {
	readonly samples: number;
	/** Samples where Newton hit the iteration cap without meeting tolerance. */
	readonly nonConvergedSamples: number;
	/** Samples that stopped moving without satisfying the equations. See `stalledSamples`. */
	readonly stalledSamples: number;
	/** Samples that stopped moving WITH the equations satisfied, rejected only by a limiter flag. */
	readonly solvedButFlaggedSamples: number;
	/**
	 * Per-block Newton census, most-exhausted first. The only counter here that can say which
	 * packets a change to the iteration budget would touch — the two host-level ones cannot.
	 */
	readonly blockNewtonCensus: readonly {
		readonly blockId: string;
		readonly samples: number;
		readonly exhausted: number;
		readonly peakIterations: number;
	}[];
	/** Samples where the solve produced a non-finite value and was discarded. */
	readonly nonFiniteSamples: number;
	/** Largest iteration count any sample needed. */
	readonly peakIterations: number;
	/**
	 * Blocks whose DC operating point did not solve, so they started from zero state and
	 * are charging through a transient the run will otherwise measure as the circuit.
	 */
	readonly operatingPointFailures: number;
	/**
	 * The largest supply current the DC solve drew, in amps, across every `dc-source` branch.
	 *
	 * A pedal draws single-digit milliamps. This exists because an **ideal source hides a
	 * catastrophic load**: measured, `ibanez-ts808` draws **193 A** through the short that
	 * `diode-forward-across-supply` warns about, and renders a plausible gain of 0.506 anyway,
	 * because a source with no impedance supplies whatever is asked of it. Nothing in the audio
	 * says so and no telemetry counter moved.
	 *
	 * Reported rather than judged: the runtime does not know what a plausible draw is for a
	 * circuit it was handed, and a threshold here would be a guess. A consumer comparing this
	 * against a pedal's datasheet current does know.
	 *
	 * **It is blind to an AC supply, by construction, and zero here is not "no short".** The
	 * operating point evaluates an `ac-source` at its `t = 0` value, which is zero volts, so a
	 * mains inlet with a dead short across it draws nothing at DC and this figure stays at 0.
	 * `renderedSupplyPeakAmps` is the figure that can see it.
	 */
	readonly operatingPointSupplyAmps: number;
	/**
	 * The largest supply current seen **while rendering**, in amps, across every `dc-source` and
	 * `ac-source` branch — or `null` when no sample has been processed.
	 *
	 * `null` rather than 0 for the unmeasured case, deliberately. The failure this field exists
	 * to prevent is a reader taking `operatingPointSupplyAmps: 0` for "no short", and a second
	 * zero would reproduce it exactly: a reader cannot tell "measured, and nothing flowed" from
	 * "nobody rendered anything". A skipped input is a skip, not a pass.
	 *
	 * It answers a question the DC figure cannot even ask. An AC supply is zero at the operating
	 * point, so its whole current lives in the render; and a DC short that only appears under
	 * drive — a diode that turns on when the signal arrives — is invisible at DC as well. On a
	 * static DC circuit the two figures agree, which is what makes this one checkable against the
	 * older one rather than a second opinion.
	 *
	 * A **peak** rather than a mean, for the same reason the Newton deadline reports peak
	 * iterations: a mean over a mains cycle hides the conduction pulse, which is where a
	 * rectifier's current is. Read from the solved branch unknowns, so a held sample contributes
	 * the last state that actually solved.
	 */
	readonly renderedSupplyPeakAmps: number | null;
	/**
	 * Iterations summed over every sample and every nonlinear block.
	 *
	 * Peak alone cannot tell a deadline apart from a spike: a circuit averaging 4
	 * iterations with one 1500-iteration sample and a circuit needing 1500 every sample
	 * report the same peak and have completely different real-time answers. The first
	 * needs a bounded solver, the second is not a real-time circuit at all.
	 */
	readonly totalIterations: number;
	/**
	 * Why the last non-converged sample failed, which the counts alone cannot say.
	 *
	 * Two failures look identical in `nonConvergedSamples` and need opposite fixes: a node
	 * still genuinely moving (`delta` large) is a solver or model problem, while a tiny
	 * `delta` with `limited` set means the answer had arrived and a limiter was still
	 * firing, so the convergence *test* is what refused. Guessing between them cost two
	 * wrong hypotheses on `boss-od-3`.
	 */
	readonly lastFailure: {
		readonly node: number;
		readonly delta: number;
		readonly limited: boolean;
		/** Which element limited, as kind plus nodes, when one did. */
		readonly limitedBy: string | null;
	} | null;
};

/**
 * A solved branch current, one per auxiliary unknown.
 *
 * **Sign convention: positive is current flowing into the element's first terminal from the
 * circuit**, which is the MNA stamp's own orientation — a `dc-source` row asserts
 * `v(positive) - v(negative) = volts` and contributes `+i` to the positive node's equation, so
 * a supply *delivering* power to the circuit reads **negative**. Corroborated on the corpus:
 * every compiled pedal's supply reads negative, `boss-bd-2-blues-driver` at `-9.92 mA`.
 *
 * This exists because the current through a supply is not derivable from node voltages: the
 * source is ideal, so no impedance relates its voltage to its current, and the aux unknown is
 * the only place the value lives. `nodeVoltageSnapshot` slices the aux tail off, which left rail
 * current unreachable through the public API — the first thing the power-domain rail/sag
 * contract in `thoughts/shared/experiments/power-domain-rail-sag-contract/` asks for.
 */
export type RuntimeBranchCurrent = {
	readonly blockId: string;
	/** The stamp kind owning the unknown: the five that add an auxiliary row. */
	readonly kind:
		| "dc-source"
		| "ac-source"
		| "input-source"
		| "ideal-opamp"
		| "transformer";
	readonly sourceIndex: number;
	readonly amps: number;
};

export type RuntimeNodeVoltageSnapshot = {
	readonly blockId: string;
	readonly nodeCount: number;
	/** `outputNode` and every index into `voltages` is a row, not a source node id. */
	readonly outputNode: number | null;
	readonly voltages: readonly number[];
	/**
	 * The block's `nodeIds`, carried through so a caller can name a row.
	 *
	 * Without it a consumer holding source-keyed data -- the terminal labels
	 * `render-v2-audio.ts --held` prints beside each voltage, say -- has no way back from a
	 * row to the net the document authored, and indexing that data by the row instead
	 * attaches the wrong label to a real voltage. That reads as a circuit fault rather than
	 * a reporting one.
	 */
	readonly nodeIds: readonly number[];
};

export class RuntimeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuntimeError";
	}
}

/**
 * Newton's per-sample iteration cap.
 *
 * **64 rather than 32, because 32 was self-poisoning.** A converged sample leaves the next
 * one starting from a solved state and it converges in a few iterations; a *held* sample
 * leaves its successor starting from a stale state, which needs more iterations, which makes
 * it more likely to be held too. So a cap set below what the hardest samples need does not
 * cost a few held samples — it cascades.
 *
 * Measured on `boss-hm-2`, a two-transistor loop with feedback from `Q9.collector` back to
 * `Q8.base`, at 1 kHz and 0.1 V over 4800 samples:
 *
 * ```
 * cap    held          avgIter   peak
 *   8    4800 (100%)      9.0    0.000e+0
 *  32    1857 (38.7%)    15.9    1.106e-1
 *  64      21 ( 0.4%)     5.3    1.534e-1
 * 2000     21 ( 0.4%)    13.8    1.534e-1
 * ```
 *
 * On that packet at that drive, raising the cap **lowers** the average iteration count from
 * 15.9 to 5.3, because the cascade stops. Every cap from 64 to 2000 gives the same 0.4%, so
 * 64 is the smallest value that lands the whole improvement rather than a number chosen for
 * headroom.
 *
 * **~~It is cheaper and more correct at once.~~ That was measured on one packet at one drive
 * and is false corpus-wide.** Over all 52 compiled packets at a played level (0.5 at 220 Hz,
 * 4800 samples):
 *
 * ```
 * cap=32   mean 6.17 iter/sample   peak 32   held 11469
 * cap=64   mean 7.47 iter/sample   peak 64   held 10624
 * ```
 *
 * So the mean rises 21% and the peak doubles by construction, buying a 7% fall in held
 * samples. The gain is concentrated (`boss-ds-2` improves on both counts, 9.1 to 7.6 mean and
 * 939 to 321 held) and so is the loss: `boss-ph-1r` never converges either way and now burns
 * 64 iterations a sample instead of 32, and `boss-hm-2` at *this* drive goes 14.2 to 25.8 mean
 * for **no** change in held count.
 *
 * The cap is therefore a blunt instrument, and the honest reading is that a packet which will
 * not converge should be *detected* rather than handed more iterations. Doing that is the
 * follow-up; this constant buys the packets that genuinely needed a few more steps and the
 * cost above is the price.
 *
 * It also explains why this packet's failures looked trajectory-dependent rather than
 * parameter-dependent: it held 96.9% at 1 kHz/0.1 V but 0.0% at 220 Hz/0.5 V, and converged
 * at 96 kHz while failing at both 48 and 192 kHz. Whether a run falls into the poisoned
 * regime depends on whether an early sample happened to exceed the cap, not on drive or step
 * size.
 *
 * The honesty guarantee is untouched: a sample that fails at this cap is still held and
 * counted, and a limited iterate still cannot satisfy the convergence test.
 */
/**
 * Schroeder reverberator delays, in **seconds** so the program stays rate-independent.
 *
 * These are Schroeder's published mutually-prime comb lengths (1557, 1617, 1491, 1422 samples)
 * and allpass lengths (225, 556) divided by the 44.1 kHz they were published at. They are a
 * *modelling choice* and the one part of this model that is not a datasheet number: the BTDR-2
 * datasheet states decay, gain and impedances but not the internal tap structure, and the
 * packet's own record says the module's internals are "not present". They set timbre and
 * echo density; they do not set decay time or level, which are the two figures the datasheet
 * does give and which this model matches by construction and by measurement respectively.
 */
const REVERB_COMB_SECONDS = [
	1557 / 44100,
	1617 / 44100,
	1491 / 44100,
	1422 / 44100,
] as const;
const REVERB_ALLPASS_SECONDS = [225 / 44100, 556 / 44100] as const;
/** Schroeder's allpass coefficient. Shapes diffusion, not decay. */
const REVERB_ALLPASS_GAIN = 0.7;
/**
 * Pitch-shift resampling window (board-p3 row 5): 4096 samples of history,
 * wraps of 2048. Covers fundamentals down to ~23 Hz at ratio 0.5 with more
 * than two periods in the window; the wrap cadence is the documented
 * discontinuity, not a tunable.
 */
/**
 * Where one composed block's per-position state lives.
 *
 * A composed block holds independent delay lines, comb sections and pitch history **per
 * selectable program**, because two modes need not share a buffer and a switch must not have to
 * clear one. Everything is allocated at prepare, so selecting is an index change.
 */
const composedStateKey = (blockId: string, position: number): string =>
	`${blockId}#${position}`;

/**
 * Which program a composed block is running, from the pin that selects it.
 *
 * **The knob is not read here; the pin is.** The panel control reaches the chip through the
 * circuit, so the mode arrives as a solved node voltage exactly as `parameter` does. The fraction
 * is `|volts| / referenceVolts` spread across the positions and clamped, so a pin at or below
 * 0 V picks the first program and one at or above the reference picks the last.
 *
 * A block with no selector, which is every composition derived from a registry macro, always runs
 * its single position.
 */
const selectedPosition = (
	block: Extract<Block, { kind: "composed" }>,
	voltageOf: (blockId: string, node: number) => number,
	positionOf: (controlId: string) => number,
): number => {
	const router = block.router;
	if (router === null || router === undefined || block.positions.length <= 1) {
		return 0;
	}
	if (router.positions < 2) {
		return 0;
	}
	// **Two ways to reach the control, and the source says which.** A node is the stronger
	// claim: the wiper drives something the solver produces. A scanned control has no node,
	// because the chip that reads it sits behind a path the source cannot state, so the
	// position is taken directly -- the same road `clockControl` already travels.
	let fraction: number;
	if (router.port === null) {
		fraction = positionOf(router.controlId);
	} else {
		if (!(router.port.referenceVolts > 0)) {
			return 0;
		}
		fraction =
			Math.abs(voltageOf(router.port.block, router.port.node)) / router.port.referenceVolts;
	}
	if (!Number.isFinite(fraction)) {
		return 0;
	}
	// **Detents, not an even split across declared programs.** An N-detent control puts detent
	// k at k/(N-1) of full scale, so the reading rounds to the nearest detent. Dividing by the
	// number of *declared* programs instead would smear four modes across an eleven-position
	// knob and land them where the undeclared ones live.
	const last = router.positions - 1;
	const detent = Math.min(
		last,
		Math.max(0, Math.round(fraction * last)),
	);
	return router.routes[detent] ?? -1;
};

const PITCH_HISTORY = 4096;
const PITCH_WINDOW = 2048;

/**
 * Pitch-tracking window and hop (board-p3 row 6): 2048 samples cover
 * fundamentals down to ~23 Hz with two periods in view; lags 20..1024 span
 * 46.9 Hz..2.4 kHz, the guitar range with margin both ends. Estimates
 * refresh every 256 samples (5.3 ms) and hold between -- control-rate
 * output for an octave divider, not sample-rate vibrato tracking.
 */
const TRACK_WINDOW = 2048;
const TRACK_HOP = 256;
const TRACK_MIN_LAG = 20;
const TRACK_MAX_LAG = 1024;
/** Below this window energy the input is silence, not unpitched audio. */
const TRACK_SILENCE_ENERGY = 1e-12;

/**
 * Fundamental of a window by normalized autocorrelation (board-p3 row 6).
 * Pure over its inputs so the estimator is unit-testable without a program:
 * the lag with peak energy-normalized correlation, parabolically refined,
 * converted to Hz. 0 when the window holds no energy. Harmonic complexes
 * peak at the fundamental period (all partials agree there); octave errors
 * are the documented mistuning mode, graded by the acceptance, not defined
 * away here.
 */
export function trackPitchFundamental(
	window: Float64Array,
	sampleRate: number,
): number {
	let energy = 0;
	for (let index = 0; index < window.length; index += 1) {
		const sample = window[index] as number;
		energy += sample * sample;
	}
	if (!(energy > TRACK_SILENCE_ENERGY)) {
		return 0;
	}
	// YIN difference function with cumulative-mean normalization and first
	// dip below threshold (board-p3 row 6). Correlation-max fails in opposite
	// directions at the range ends -- biased normalization rails short (a 110 Hz
	// sine peaks below lag 20), unbiased rails long (a 220 Hz sine ties at 4x
	// its period) -- because both pick a global extreme. Scanning upward for
	// the first dip instead finds the fundamental period itself: sub-period
	// lags of a periodic signal do not dip, multiples come later and lose.
	// Flat input (constant, DC bias without AC) dips everywhere, so a
	// max-min variation gate reads it 0 rather than inventing 2400 Hz.
	let peak = -Infinity;
	let trough = Infinity;
	for (let index = 0; index < window.length; index += 1) {
		const sample = window[index] as number;
		if (sample > peak) {
			peak = sample;
		}
		if (sample < trough) {
			trough = sample;
		}
	}
	if (!(peak - trough > 1e-9)) {
		return 0;
	}
	const maxLag = Math.min(TRACK_MAX_LAG, Math.floor(window.length / 2));
	let running = 0;
	let bestLag = -1;
	for (let lag = TRACK_MIN_LAG; lag <= maxLag; lag += 1) {
		let difference = 0;
		for (let index = lag; index < window.length; index += 1) {
			const delta =
				(window[index] as number) - (window[index - lag] as number);
			difference += delta * delta;
		}
		running += difference;
		// Cumulative mean normalized difference: 1 at lag 0 by construction,
		// dipping toward 0 at periods. The first dip under threshold wins.
		const normalized = (difference * lag) / running;
		if (normalized < 0.1) {
			bestLag = lag;
			break;
		}
	}
	if (bestLag === -1) {
		return 0;
	}
	// Parabolic refinement around the dip: sub-sample period without
	// another pass over the window.
	let refined = bestLag;
	if (bestLag > TRACK_MIN_LAG && bestLag < maxLag) {
		const at = (lag: number): number => {
			let difference = 0;
			for (let index = lag; index < window.length; index += 1) {
				const delta =
					(window[index] as number) - (window[index - lag] as number);
				difference += delta * delta;
			}
			return difference;
		};
		const previous = at(bestLag - 1);
		const center = at(bestLag);
		const next = at(bestLag + 1);
		const denominator = previous - 2 * center + next;
		if (denominator > 0) {
			refined = bestLag + (0.5 * (previous - next)) / denominator;
		}
	}
	if (!(refined > 0)) {
		return 0;
	}
	return sampleRate / refined;
}
/**
 * The comb feedback that reaches -60 dB in `decaySeconds`.
 *
 * A comb of delay `d` loses `g` per pass, so after `T60 / d` passes it is at `g^(T60/d)`, and
 * setting that to `10^-3` gives this closed form. Decay is therefore *designed*, not tuned, and
 * the design is measured: `pipeline.test.ts`'s "the Belton BTDR-2H reverb brick, against its own
 * datasheet" renders a burst into `beltonBrickReverb` and checks the attenuation 2.5 s after it
 * stops against `-60 * 2.5 / decaySeconds` dB at three values of `decaySeconds`. Until
 * 2026-09-07 this comment claimed that check and no such check existed.
 */
function reverbCombGain(delaySeconds: number, decaySeconds: number): number {
	if (!(decaySeconds > 0) || !(delaySeconds > 0)) {
		return 0;
	}
	return Math.min(0.999, 10 ** ((-3 * delaySeconds) / decaySeconds));
}

/**
 * How long a nonlinear block's Newton loop may keep trying before the iterate it has is the
 * answer it returns.
 *
 * **A correctness bound, and nothing else.** It stopped being the admission gate's cost input
 * on 2026-09-09 (`RealtimeBudget.budgetedIterationsPerSample`); while it was both, no value
 * could satisfy both, which is why it sat at 64 below the requirement of several legitimate
 * circuits.
 *
 * **64 was too low, and truncating does not merely return a worse answer.** It leaves a
 * residual that re-seeds the next sample, so the packet never recovers:
 * `moogerfooger-mf-102` needs **183** iterations once and then 2.1 per sample forever after,
 * but capped at 64 it burned all 64 on every sample of a ten-second render — and
 * `boss-tw-1` shipped audio **11,900x too loud** for the same reason.
 *
 * **The bound is 801** — `fender-twin-reverb`'s one-off transient, with `mxr-blue-box` at 356
 * — so this sits above the observed maximum with headroom, because a bound equal to the
 * population maximum is a coincidence rather than a bound.
 */
export const DEFAULT_NEWTON_MAX_ITERATIONS = 1024;

/**
 * The budget a block falls back to for the length of a probation, once one of its samples has
 * shown that more iterations could not help that sample.
 *
 * **This is what makes the raise above safe**, and it is the reason the stall verdict had to
 * exist first. Two verdicts gain nothing from a larger budget: a **stalled** block has stopped
 * moving with the equations unsatisfied, and a **solved-but-flagged** block already has its
 * answer and is only being refused by a limiter flag. Left on the raised budget they pay for it
 * and get nothing: `marshall-1959-super-lead-plexi` spends 1256 of 4800 samples there and costs
 * **7.8x** more per sample without this fallback, for an output that differs by `8e-12`.
 *
 * A block that never exhausts its budget is unaffected by either constant, which is why 129 of
 * the 140 compiling corpus packets never reach this code at all (measured 2026-09-19).
 *
 * The `vox-ac30-top-boost` half of this comment's original justification (63.8 -> 1020.6
 * iterations per sample) no longer reproduces: on the current tree it peaks at **37** iterations
 * and exhausts nothing, so it never falls back. Re-measured rather than deleted, because a
 * justification that has stopped being true is the thing a reader most needs told.
 */
const NEWTON_UNPRODUCTIVE_ITERATIONS = 64;

/**
 * How long a probation lasts before the block is offered the full budget again.
 *
 * **This length is insurance, not a tuned win, and the sweep that says so is the reason it is
 * written down.** At 64, 256 and 1024 samples every measured figure in the corpus is identical
 * -- `mf-102` and `plexi` both render the same audio at the same cost -- because a block whose
 * flagged samples recur is re-armed faster than any of these windows expire, and a block whose
 * do not is never on probation long enough for the length to matter. So the length is chosen for
 * the failure it forecloses rather than for a measurement: with no expiry at all, one flagged
 * sample condemns a block for the whole render, which is what rendered `mf-102` silent. 1024
 * samples is 21 ms at 48 kHz and costs the pathological case one full-budget sample in 1024 --
 * under one extra iteration per sample against the 64 it falls back to.
 */
const NEWTON_UNPRODUCTIVE_PROBATION_SAMPLES = 1024;

/**
 * SPICE's convergence criterion: relative tolerance plus an absolute floor, per unknown.
 *
 * This replaces a flat 1e-9 absolute delta, which was not a strict version of the right
 * test but a different and unmeetable one. On a node sitting at 4.5 V it demands ten
 * significant digits -- far below the precision the companion models themselves carry,
 * and far below anything audible -- so a circuit with real dynamics grinds against it for
 * hundreds of iterations chasing a figure that means nothing. `boss-od-3` reported a
 * failure at a delta of 1.5e-7 V, which is 150 nanovolts.
 *
 * The values are SPICE's defaults (`reltol` 1e-3, `vntol` 1e-6). The honesty guarantee is
 * untouched: a limited iterate still cannot satisfy this, and a sample that fails it is
 * still held and counted rather than emitted.
 *
 * These two constants are the convergence contract, and the C++ console carries the same
 * pair (`Engine.cpp`'s `NEWTON_RELATIVE_TOLERANCE`/`NEWTON_VOLTAGE_TOLERANCE`): a change
 * here without the mirror change there makes the consoles disagree on when a solve is
 * finished, which surfaced as corpus-wide peak-iteration mismatches when the voltage
 * floor was briefly loosened to 1e-3 while this comment still claimed SPICE defaults.
 * Iteration counts measured across a tolerance change are not comparable.
 */
const NEWTON_RELATIVE_TOLERANCE = 1e-3;
const NEWTON_VOLTAGE_TOLERANCE = 1e-6;

/**
 * How small the **KCL residual** must be before an iterate the limiter is still flagging may be
 * accepted as a solution.
 *
 * **A small delta does not mean converged, and that is the whole reason this constant exists.**
 * An iterate stops moving for two opposite reasons: it has converged, or it is stuck against a
 * non-smooth boundary -- a diode clamp, a switch discontinuity, a limiter that damping is holding
 * it against. Those are identical in the delta. They are six orders apart in the residual:
 * measured over the corpus, `marshall-1959-super-lead-plexi` sits at **0** on all 654 of its
 * flagged samples (genuine solutions the flag was rejecting) while `vox-ac30-top-boost` sits at
 * **3.17e-3** on 2,245 of its 2,392 (genuinely stuck, and its audio is wrong by the size of its
 * own signal). 1e-9 is inside that gap with room in both directions.
 */
const NEWTON_RESIDUAL_TOLERANCE = 1e-9;
/**
 * Where a junction exponent is truncated, in multiples of its emission-scaled thermal voltage.
 * `exp(60)` is finite and the voltage it stands for is far outside any pedal's range -- at
 * `N*Vt = 43.8 mV` it is `2.63 V` across a silicon diode -- so this keeps the exponential from
 * overflowing mid-iteration without capping the answer. The BJT case truncates at the same place.
 */
const JUNCTION_EXPONENT_LIMIT = 60;
/**
 * The reverse current at which a zener's declared breakdown voltage is taken to hold, in amps.
 *
 * A datasheet does not state a breakdown voltage on its own; it states one **at a test current**
 * — `Izt = 20 mA` for the 500 mW 1N52xx series that supplies most of this corpus's references.
 * The source carries the voltage and not the current, so the current has to live here, and it is
 * a host modelling constant in the same sense as `SUPPLY_SOURCE_OHMS`: named, and wrong to invent
 * silently inside an expression.
 *
 * 5 mA rather than the series' own 20 mA, deliberately. The corpus's zener references are fed
 * from 10k-ish droppers off a 9 V rail, so they run near 400 uA — two orders under `Izt`. Placing
 * the anchor nearer the operating decade keeps `scale * ln(I / Iz)` small where these parts
 * actually sit, and it is the conservative direction: the modelled rail lands a few tens of
 * millivolts *under* nominal, which is what a real zener below its test current does, instead of
 * hundreds of millivolts over, which is what nothing does.
 *
 * This is a modelled reference point, not a measured one, and it is the whole of the assumption:
 * a packet that declares 4.7 V is read as 4.7 V at 5 mA. If a per-part test current ever becomes
 * a source fact, it belongs on the stamp and this constant becomes its default.
 */
const ZENER_TEST_CURRENT_AMPS = 5e-3;

/**
 * How far a triode's controlling voltages may move in one Newton iteration.
 *
 * The grid's is small because Koren's `E1` is exponential in `Vgk`, exactly as a junction
 * is: an undamped first step overshoots and the iterate either diverges or oscillates. The
 * plate's is large because a plate legitimately sits at hundreds of volts and swings tens,
 * so a step sized for the grid would take hundreds of iterations to reach the operating
 * point. Damping, not clamping — the solved point is unchanged.
 */
const TRIODE_GRID_CUTOFF_THRESHOLD_VOLTS = -3.0;
const TRIODE_GRID_STEP_VOLTS = 5.0;
const TRIODE_GRID_STEP_DOWN_VOLTS = 40.0;
const TRIODE_PLATE_STEP_VOLTS = 40.0;

/**
 * Consecutive non-contracting iterations that engage under-relaxation.
 *
 * **Engaged on evidence of oscillation rather than at a fixed iteration count.** This used to
 * fire unconditionally from iteration 8 on every unknown in the block, which taxed the whole
 * corpus to brake one packet. Measured 2026-09-01 by disabling it: peak Newton iterations fell
 * on most packets (`moogerfooger-mf-102` 86 -> 39, `electro-harmonix-q-tron` 66 -> 37,
 * `boss-ce-5` 57 -> 52, and fuzz-face, hm-2 and micro-flanger left the worst-case list), while
 * `electro-harmonix-bad-stone` went from `steady=2.3` to `all=1951.5` -- it stops converging.
 * So the brake is real but was priced wrong.
 *
 * A Newton step that is not contracting is the condition it was fitted for: `delta` failing to
 * fall twice running means the iterate is circling or stalled, which is exactly when halving
 * the step turns it into a contraction. A run that converges monotonically never engages it.
 *
 * **Latched once engaged**, for the rest of that solve. Relaxation halves `delta` by
 * construction, so an unlatched detector would read its own damping as contraction, switch off,
 * oscillate, and cycle.
 */
const NEWTON_NON_CONTRACTING_LIMIT = 2;
/**
 * Earliest iteration relaxation may engage, kept from the previous fixed-threshold rule.
 *
 * The non-contracting test alone engaged on transient bumps -- a limiter activating, a mode
 * switch -- and once latched, halving every step roughly doubled the iterations. Measured:
 * `jim-dunlop-fuzz-face` peak 67 -> 98 and `boss-ce-2` under 39 -> 115. Requiring both keeps
 * the brake off the early transient and off any run that is still contracting at 8.
 */
const NEWTON_RELAXATION_EARLIEST_ITERATION = 8;
/**
 * Under-relaxation factor (alpha): `x_{k+1} = x_k + alpha * (x_newton - x_k)`.
 *
 * Halving the step turns an oscillating iterate into a contraction toward the fixed point
 * **without moving the fixed point**, since the damped and undamped steps coincide wherever
 * `x_newton == x_k`. That is what makes damping safe to switch on mid-solve: it changes how the
 * iteration approaches the answer, not which answer it is approaching.
 *
 * The nonlinearities that need it are the stiff ones — antiparallel diode clippers, saturating
 * op-amps, vacuum-tube grid conduction — which enter period-2 limit cycles or oscillatory
 * overshoot under undamped Newton.
 */
const NEWTON_RELAXATION_FACTOR = 0.5;

/**
 * Maximum number of backtrack failures and minimum step size permitted during adaptive source stepping.
 *
 * Used during DC operating point continuation when gmin stepping fails. Limits the backtrack search tree
 * to prevent runaway loops when encountering a non-physical circuit fold or bifurcation.
 */
const SOURCE_STEPPING_MAX_FAILURES = 50;
const SOURCE_STEPPING_MIN_STEP_SIZE = 1e-6;

/** Damp a step toward the previous iterate without moving where the solution lies. */
function limitTriodeStep(
	next: number,
	previous: number,
	maxStep: number,
): number {
	const delta = next - previous;
	return Math.abs(delta) <= maxStep
		? next
		: previous + (delta > 0 ? 1 : -1) * maxStep;
}

function limitTriodeGridStep(next: number, previous: number): number {
	return limitTriodeStep(next, previous, TRIODE_GRID_STEP_VOLTS);
}

/**
 * SPICE's `gmin`: a conductance from every node to ground, 1e12 ohms.
 *
 * Not a numerical fudge -- it is what keeps the matrix non-singular when a node has no
 * stamped conductance of its own. Some device terminals draw no current by construction:
 * a FET gate and an ideal op-amp input contribute nothing to their own row, so a node
 * carrying only those has a **structurally zero row**, and the solve returns whatever
 * the elimination happens to produce. `boss-od-3` diverged to 5591 V on node 38, which
 * carries `Q4.gate` and nothing else, and reported it as 2000 iterations of
 * non-convergence -- a symptom that reads as a hard circuit rather than a singular one.
 * 32 such terminals exist across 9 corpus packets.
 *
 * At 1e-12 S the current through it is below every other term in the system by orders of
 * magnitude, so a well-posed circuit's operating point is unchanged: the exact
 * hand-computed follower gains in the fixtures still hold to their stated precision.
 */
const GMIN_SIEMENS = 1e-12;
/**
 * Build-order step 6: the `solution` placeholder `buildLinearBackground` passes to every
 * linear stamp kind, none of which reads it -- see that function's own comment.
 */
const EMPTY_SOLUTION: readonly number[] = [];
const EMPTY_STATE: number[] = [];
/**
 * Where gmin stepping starts, and how fast it walks back to `GMIN_SIEMENS`.
 *
 * `1e-2 S` is a hundred ohms from every node to ground, which is low enough impedance to
 * dominate most pedal networks and make the first solve nearly linear. A ratio of 10 gives
 * eleven passes to reach `1e-12`, matching ngspice's default step count closely enough that
 * the sequence is continuous in practice.
 *
 * The start was raised from `1e-3` in `618049d0` and this comment kept describing the old
 * value -- it read "a kilohm" and "nine passes" against a constant meaning 100 Ω and eleven.
 * Corrected 2026-09-10 after the stale figure was quoted back as the basis of a hypothesis
 * about corpus-wide attenuation. A constant and the prose beside it disagreeing is a defect
 * even when the code is right, because the prose is what gets reasoned from.
 */
const GMIN_STEPPING_START_SIEMENS = 1e-2;
const GMIN_STEPPING_RATIO = 10;
/**
 * Linear steps SPICE's second continuation method takes from a dead circuit to a powered one.
 *
 * Gmin stepping deforms the *devices* toward linearity; source stepping deforms the *excitation*
 * toward zero, and they fail on different circuits. With every supply at zero every junction is
 * unambiguously off, which is a state Newton finds trivially, and each step from there is a small
 * perturbation of an answer already in hand.
 */
const SOURCE_STEPPING_STEPS = 10;

/**
 * What an inductor becomes in the operating-point solve. The exact DC limit is a
 * zero-ohm short; this is the same magnitude the compiler gives a closed switch, which
 * keeps the matrix conditioned where an unbounded conductance would not.
 */
const DC_INDUCTOR_SHORT_OHMS = 1e-2;

/** Open-loop gain of the generic op-amp. High enough that feedback sets the gain. */
/**
 * Retained only for the unrailed op-amp path, which has no saturation to scale and so no stamped
 * gain to read. Every railed op-amp uses `stamp.openLoopGain`, which the source states for 31 of
 * the corpus's 52.
 */
const OPAMP_OPEN_LOOP_GAIN = 1e5;

/**
 * How far an op-amp's differential input may move in one Newton iteration, in units of
 * its linear-region width. Large enough that a converging solve is not slowed, small
 * enough that the iterate cannot jump rail to rail.
 */
const OPAMP_MAX_DIFFERENTIAL_STEP = 4;

/**
 * Where an op-amp's differential stops meaning anything, in units of its linear-region
 * width. `tanh(8)` is 1 to within 2e-7, so the output at the edge of this band and the
 * output a volt beyond it are the same rail -- but the distance between them is what a
 * step limiter would have to walk. Bounding the differential here makes saturation cost
 * a few iterations instead of thousands, and costs no fidelity to do it.
 */
const OPAMP_SATURATION_BAND = 8;

/**
 * Where an overdriven op-amp's *state* stops following its differential, in units of the
 * linear-region width. `OPAMP_SATURATION_BAND` bounds the differential Newton feeds the
 * row (and floors its Jacobian); this, wider band, bounds the differential the pole
 * *integrates*. The two are not the same move: bounding the integrated differential at
 * the tighter band pins the pole's state for a packet whose differential genuinely
 * oscillates (measured 2026-09-16: `mxr-blue-box` at the 8-wide band sat at its
 * non-converged cap, `98.7%` of samples, with a dead output).
 *
 * **12, not 16, because the band is a convergence knob, not just a clamp.** The wider a
 * band, the further an overdriven op-amp's differential is allowed to march before the pole
 * turns it around, and a positive-feedback loop through that op-amp's output converges only
 * inside a narrow window. `moogerfooger-mf-102`'s vee op-amp (`plus=0 minus=47 output=4`)
 * drives the `vee` of all eight OTAs and closes the loop through the OTA bias and back to its
 * own minus input; at the 16-wide band that loop is 100% non-converged (a 2.3-hour hang that
 * withheld the corpus baseline), and it only converges at the 12-wide band (peak 2.38e-4, 0
 * non-converged, an 865-iteration first sample that settles to ~2/sample). A 12-wide band is
 * also the widest that keeps `mxr-blue-box` converging and the windup packets the pole band was
 * built for (`boss-ce-5`, `boss-ch-1`) measured unchanged -- both render identically at 12 and 16
 * because their op-amp differentials never reach the band, so the change touches `mf-102` alone.
 * A 18-wide band re-opens `boss-ch-1` (939/960 non-converged, a 5.3 V self-oscillation), which is
 * the ceiling the 12 sits safely below.
 */
const OPAMP_DIFFERENTIAL_BAND = 12;

/**
 * Consecutive Newton iterations an op-amp's step cap may sit near its floor, limited, before the
 * solve treats it as a **fold** rather than a straddle and reseeds that op-amp on its other rail.
 *
 * The halving cap (see the stamp) is built for negative feedback: the iterate straddles a
 * solution inside the linear region, the cap halves until it lands there, the limiter releases
 * and the solve converges. Positive feedback breaks that. A Schmitt trigger's comparator
 * (`boss-tr-2`'s LFO, `+=31 -=32 out=53`) runs at an effective per-sample gain of about 130
 * inside a loop whose gain is well above one, so when the timing capacitor crosses the
 * threshold the branch the iterate starts on **ceases to exist**. The only solution is on the
 * other rail, the Jacobian keeps pointing back at the vanished one, and the cap pins at its floor
 * in a two-cycle it cannot leave. Measured: from iteration ~20 to the 1024 cap on every LFO edge,
 * 51 held samples in 3 s, each costing the whole cap -- the Studio's per-quantum overrun.
 * Oversampling thins it (51 -> 29 at 8x) and does not remove it: the fold exists at any step.
 *
 * A straddle lands inside the linear region once the cap is below one linear width, and an
 * iterate there is not limited, so it cannot accumulate this streak: the floor test is an eighth
 * of a width, three halvings past that.
 */
const OPAMP_FOLD_STREAK = 6;

/**
 * The op-amp's half rail-to-rail swing, with a floor so a zero-width supply cannot divide by
 * zero. Shared by the stamp and by the pole's state so both bound themselves the same way.
 */
function opAmpHalfSwing(railHigh: number, railLow: number): number {
	return Math.max((railHigh - railLow) / 2, 1e-9);
}

/**
 * The op-amp's gain-bandwidth product, in hertz. A class default rather than a part fact:
 * the source's per-packet GBP is not read (see `netlist.ts`), so every op-amp in the corpus
 * gets the same pole. With a 1e5 gain the open-loop pole sits at `GBP / gain`, 10 Hz here.
 */
const OPAMP_GAIN_BANDWIDTH_HZ = 1e6;

/**
 * Anti-windup bound for the op-amp pole's raw state, in units of halfSwing.
 *
 * `tanh(8)` is `0.99999977` -- indistinguishable from the rail -- so clamping raw here
 * does not change the output in any regime the deck's TABLE (which spans `±4 halfSwing`)
 * can represent.  The bound prevents unbounded windup: a real op-amp's compensation node
 * cannot exceed its own supply, and the closed-loop recovery this shortens was measured at
 * `boss-od-1`'s billion-fold gain error and 18 signal-independent dead rows (2026-08-21).
 *
 * Must be matched on both the runtime state writes **and** the deck emitter's B-source
 * clamp or parity degrades from 41/6 to 36/10 (2026-08-21 measurement).  The deck
 * snippet and full measurement are in
 * `docs/troubleshootings/pole-state-makes-a-saturated-opamp-row-signal-independent.md`.
 */
const OPAMP_POLE_BAND = 8;

/** Clamp the raw open-loop output to the pole band. */
function boundOpAmpRaw(raw: number, halfSwing: number): number {
	const limit = OPAMP_POLE_BAND * halfSwing;
	return Math.min(limit, Math.max(-limit, raw));
}

/**
 * How far the `modulation` port may scale a delay, either way.
 *
 * A bound rather than a tuning. The law `delay = base * (Vdc / V)` has a pole as `V` approaches
 * zero, and a control node that swings to its rail would otherwise ask for an unbounded buffer
 * read; clamping is what makes the ring buffer's size a decidable number at `prepare()`. The
 * span is wide enough for any chorus or flanger sweep in the corpus -- a CE-2's is a few tens of
 * percent -- and narrow enough that a mis-resolved node cannot turn a 5 ms delay into a second
 * of echo.
 */
const MODULATION_SCALE_MIN = 0.5;
const MODULATION_SCALE_MAX = 2.0;
/**
 * Time constant of the modulation node's DC reference, in seconds.
 *
 * It must sit **below** the slowest LFO the corpus runs so the reference tracks the operating
 * point rather than the sweep. `boss-ce-2`'s measured range is 0.61-2.68 Hz, so a 10 s window is
 * two orders below its slowest cycle: the reference follows supply drift and bias settling, and
 * the LFO passes through as modulation instead of being tracked out.
 */
const MODULATION_DC_SECONDS = 10.0;

/**
 * The backward-Euler step coefficient of the op-amp's dominant pole. The open-loop gain rolls
 * off at `gainBandwidthHz / openLoopGain`; at the class defaults that pole is 10 Hz, so a
 * single sample sees `alpha` times the DC gain and the raw state carries the rest from the
 * previous sample. Above Nyquist the pole is inaudible and the coefficient is 1, the no-pole
 * limit the operating point solves at.
 */
function opAmpPoleAlpha(
	openLoopGain: number,
	gainBandwidthHz: number,
	dt: number,
	sampleRate: number,
): number {
	const poleHz = gainBandwidthHz / openLoopGain;
	if (
		sampleRate <= 0 ||
		!Number.isFinite(poleHz) ||
		poleHz <= 0 ||
		poleHz >= sampleRate / 2
	) {
		return 1;
	}
	const tau = 1 / (2 * Math.PI * poleHz);
	return dt / (dt + tau);
}

/**
 * SPICE's junction limiting. Without it a transistor's exponential overshoots on the
 * first Newton step and the iteration either diverges or oscillates forever -- which
 * is the single reason naive nonlinear MNA fails on real circuits rather than on
 * textbook ones. It damps a step across a forward-biased junction instead of
 * clamping the voltage, so the operating point is still solved exactly.
 */
function limitJunction(
	next: number,
	previous: number,
	thermalVoltage: number,
	saturationCurrent: number,
	seriesResistance = 0,
): number {
	const critical =
		thermalVoltage *
		Math.log(thermalVoltage / (Math.SQRT2 * saturationCurrent));
	if (seriesResistance > 1e-6 && previous > 0) {
		const criticalTerminal = critical + thermalVoltage / Math.SQRT2;
		if (next > criticalTerminal && Math.abs(next - previous) > 2 * thermalVoltage) {
			const iPrev = saturationCurrent * Math.exp(Math.min(previous / thermalVoltage, 40));
			const rJunction = thermalVoltage / Math.max(1e-12, iPrev);
			const linearFrac = seriesResistance / (seriesResistance + rJunction);
			const step = next - previous;
			const junctionStep =
				1 + (step * (1 - linearFrac)) / thermalVoltage > 0
					? thermalVoltage * Math.log(1 + (step * (1 - linearFrac)) / thermalVoltage)
					: thermalVoltage * 2;
			return previous + junctionStep + step * linearFrac;
		}
	}
	if (next > critical && Math.abs(next - previous) > 2 * thermalVoltage) {
		if (previous > 0) {
			const arg = 1 + (next - previous) / thermalVoltage;
			return arg > 0 ? previous + thermalVoltage * Math.log(arg) : critical;
		}
		return critical;
	}
	// Damp a crossing into reverse only when the junction it left was actually conducting.
	//
	// `previous > 0` was the guard, and `previous` is a *previous Newton iterate*, not a
	// settled voltage: `mxr-carbon-copy` reaches here with `previous = 6.66e-16` -- 0.67
	// femtovolts -- and `next = -4.36e-6`, whereupon this branch returns `-4.360855e-6` for a
	// raw `-4.361223e-6`. **A change of 0.37 nanovolts, which then flags the whole iterate
	// limited**, and the convergence rule bars a limited iterate by construction. The sample
	// runs to the iteration cap with `delta = 1.138e-12` -- arrived, and refused.
	//
	// One thermal voltage is the line because below it the junction is not conducting in any
	// sense this damping could protect: the transport current is `is*(exp(v/vt)-1)`, so at
	// `previous = vt` it is `1.7*is` and its slope is `is*e/vt` ~ 1e-12 S. There is no forward
	// excursion to walk back. Above it the branch is untouched and still catches the real case
	// -- a conducting junction thrown far negative in one step, where landing at `-vt*ln(...)`
	// keeps the exponential usable on the next iterate.
	//
	// This is the third instance of one class, after `limitFetDrain` on a FET's off region and
	// `limitTriodeStep` on a cut-off grid: a limiter firing where the law has no dependence on
	// the quantity being limited, so it damps nothing and only bars convergence. The fix is the
	// same shape each time -- gate the limiter on the region where it can damp something, never
	// relax the convergence rule, which would let a limiter pin the iterate at a bound that is
	// not the solution and call it converged.
	if (next < 0 && previous > thermalVoltage) {
		const arg = -1 + next / thermalVoltage;
		return arg < 0 ? -thermalVoltage * Math.log(-arg) : -thermalVoltage;
	}
	return next;
}


/**
 * Principal branch of the Lambert W function W_0(z) for z >= 0.
 * Solves w * exp(w) = z.
 */
function lambertW0(z: number): number {
	if (z <= 0) return 0;
	if (z < 1e-6) {
		return z * (1 - z);
	}
	let w: number;
	if (z < Math.E) {
		// Pade rational approximation for z in [0, e]
		w = (z * (1 + 1.2 * z)) / (1 + 2.2 * z + 0.8 * z * z);
	} else {
		const lnZ = Math.log(z);
		const lnLnZ = Math.log(lnZ);
		w = lnZ - lnLnZ + lnLnZ / lnZ;
	}

	// 2-3 Halley iterations
	for (let i = 0; i < 3; i++) {
		const eW = Math.exp(w);
		const f = w * eW - z;
		const fp = eW * (w + 1);
		const fpp = eW * (w + 2);
		const delta = f / (fp - (f * fpp) / (2 * fp));
		w -= delta;
		if (Math.abs(delta) < 1e-13 * (w + 1)) break;
	}
	return w;
}

/**
 * Principal branch of the Lambert W function directly from log(z) for z > 0.
 * Solves w + ln(w) = log(z). Avoids intermediate overflow of exp(logZ) when logZ is large.
 */
function lambertW0FromLogZ(logZ: number): number {
	if (logZ < -15) {
		const z = Math.exp(logZ);
		return z * (1 - z);
	}
	if (logZ < 1.0) {
		return lambertW0(Math.exp(logZ));
	}
	const lnLnZ = Math.log(logZ);
	let w = logZ - lnLnZ + lnLnZ / logZ;

	// Halley iteration using log formulation
	for (let i = 0; i < 3; i++) {
		const lnW = Math.log(w);
		const g = w + lnW - logZ;
		const gp = 1 + 1 / w;
		const gpp = -1 / (w * w);
		const delta = g / (gp - (g * gpp) / (2 * gp));
		w -= delta;
		if (Math.abs(delta) < 1e-13 * w) break;
	}
	return w;
}

/**
 * SPICE's `DEVfetlim`: damp a gate-source step, measured against the threshold.
 *
 * A FET needs different limiting from a junction. `limitJunction` damps an exponential;
 * a Shichman-Hodges channel is quadratic with a **hard region boundary** at the
 * threshold, where conductance drops to a token 1e-12 and the Jacobian is discontinuous.
 * An undamped Newton step can jump the boundary in both directions forever -- cut off,
 * saturated, cut off -- and the iterate cycles rather than diverging, so it looks like a
 * hard circuit instead of a missing limiter. `boss-od-3` has 7 FETs and burned its whole
 * 2000-iteration cap on every sample.
 *
 * The step allowances are SPICE's and are deliberately asymmetric: turning a device *on*
 * is allowed to move further than turning it off, because the off state carries no
 * gradient information to steer by.
 */
function limitFetGate(
	next: number,
	previous: number,
	threshold: number,
): number {
	const highStep = Math.abs(2 * (previous - threshold)) + 2;
	const lowStep = highStep / 2 + 2;
	const strongOn = threshold + 3.5;
	const delta = next - previous;

	if (previous >= threshold) {
		if (previous >= strongOn) {
			if (delta <= 0) {
				return next >= strongOn
					? -delta > lowStep
						? previous - lowStep
						: next
					: Math.max(next, threshold + 2);
			}
			return delta >= highStep ? previous + highStep : next;
		}
		// Near the threshold, where the quadratic is weakest and overshoot is worst.
		return delta <= 0
			? Math.max(next, threshold - 0.5)
			: Math.min(next, threshold + 4);
	}
	if (delta <= 0) {
		return -delta > highStep ? previous - highStep : next;
	}
	const justOn = threshold + 0.5;
	return next <= justOn
		? delta > lowStep
			? previous + lowStep
			: next
		: justOn;
}

/**
 * SPICE's `DEVlimvds`: damp a drain-source step.
 *
 * Separate from the gate limiter because `vds` selects between the triode and saturation
 * branches, which is a second discontinuity independent of the on/off one. Limiting only
 * the gate leaves a device free to oscillate between the two branches.
 */
function limitFetDrain(next: number, previous: number): number {
	if (previous >= 3.5) {
		return next > previous
			? Math.min(next, 3 * previous + 2)
			: next < 3.5
				? Math.max(next, 2)
				: next;
	}
	return next > previous ? Math.min(next, 4) : Math.max(next, -0.5);
}

/**
 * The operators this runtime implements — the console's instruction set.
 *
 * A map rather than a set so that adding an operator to the program contract is a
 * **compile error here** until someone decides whether this runtime executes it. The
 * `applyStamp` switch's `never` binding already forces the implementation; this forces the
 * declaration, and the two together are what make `unimplementedOperators` below able to
 * answer honestly instead of by construction.
 *
 * Every entry is `true` because the reference runtime implements the whole contract, which
 * is its job: it is the definition of what a program means. A second implementer — C++,
 * WASM, ESP32 — will hold a shorter list, and that is the case the lockout exists for.
 */
const IMPLEMENTED_OPERATORS: Readonly<Record<OperatorKind, true>> = {
	"spring-reverb": true,
	conductance: true,
	"controlled-conductance": true,
	"controlled-resistance": true,
	capacitor: true,
	inductor: true,
	diode: true,
	switch: true,
	selector: true,
	"dc-source": true,
	"ac-source": true,
	bjt: true,
	fet: true,
	triode: true,
	pentode: true,
	"tube-diode": true,
	transformer: true,
	"input-source": true,
	"ideal-opamp": true,
	"macro-audio-source": true,
	vccs: true,
	optocoupler: true,
	"logic-divider": true,
	"analog-switch": true,
	ota: true,
	compandor: true,
	"clock-driver": true,
			comparator: true,
			// Linear-control VCA cell. Reads the control node, draws nothing.
			"linear-vca": true,
};

/**
 * Which of a program's declared operators this runtime cannot execute.
 *
 * Takes `readonly string[]` rather than `readonly OperatorKind[]` on purpose. A program
 * that arrived through `decode` was cast from JSON, so its declared set is **untrusted
 * text from another producer** — possibly a newer compiler — and typing the parameter as
 * the closed union here would make the check read as vacuous and tempt someone to delete
 * it.
 */
function unimplementedOperators(
	required: readonly string[],
): readonly string[] {
	return required.filter(
		(operator) => !Object.hasOwn(IMPLEMENTED_OPERATORS, operator),
	);
}

/**
 * The DSP algorithms this runtime implements — the other half of the console's instruction
 * set, and the half that used to be missing entirely.
 *
 * **The defect this closes.** `processMacroBlock` implemented exactly one behaviour, a
 * bucket-brigade delay line, and never read `block.macro.modelId` at all. So a macro naming a
 * compander, an OTA, a chorus's own core or an SAD1024 executed *as an MN3007-style delay*:
 * plausible, silent, and completely wrong — the failure mode this program contract argues
 * against elsewhere (see `types.ts` on why `ac-source` is an operator rather than a field),
 * and strictly worse than silence, because a wrong delay is something a player would accept
 * as the pedal.
 *
 * Same shape as `IMPLEMENTED_OPERATORS` deliberately, rather than a second mechanism: a
 * declaration here, an exhaustive dispatch in `processMacroBlock`, and the two joined by a
 * `never` binding so adding a key here is a compile error until the dispatch executes it.
 * What differs is the direction of the closure — `OperatorKind` is a closed union this
 * repository owns, while a `modelId` is artifact-owned registry text, so **this map is the
 * vocabulary's only definition** and `ImplementedModelId` is derived from it rather than the
 * other way round.
 *
	 * **A model, not a chip** (see `MacroModel.modelId`). `bucket-brigade-delay-line` is what an
	 * MN3007, an MN3005 and an SAD1024 all are, differing in their delay time, and
	 * `digital-delay-line` is what a fixed-function digital echo LSI such as the Mitsubishi
	 * M50195P is — a sample-accurate echo with a feedback tap, not the analog charge-shifting a
	 * bucket brigade does. What each keeps the console/ROM invariant true is the same: fitting a
	 * different part of the same model to a pedal is registry data and needs no runtime change,
	 * while a compander is a *new algorithm* and legitimately does need one. That case is exactly
	 * why it must refuse loudly rather than substitute.
	 */
	const IMPLEMENTED_MODELS = {
		"bucket-brigade-delay-line": true,
		"digital-delay-line": true,
		"digital-reverb-module": true,
		"pitch-shift": true,
		"pitch-tracker": true,
	} as const;

type ImplementedModelId = keyof typeof IMPLEMENTED_MODELS;

/**
 * Which of a program's declared models this runtime cannot execute.
 *
 * `readonly string[]` for the same reason `unimplementedOperators` takes one, and here the
 * reason is not even hypothetical: `modelId` is `string` in the program contract by design,
 * because the algorithm vocabulary belongs to the runtime and the registry naming them is
 * artifact-owned.
 */
function unimplementedModels(required: readonly string[]): readonly string[] {
	return required.filter((model) => !Object.hasOwn(IMPLEMENTED_MODELS, model));
}

function isImplementedModel(model: string): model is ImplementedModelId {
	return Object.hasOwn(IMPLEMENTED_MODELS, model);
}

/**
 * Lower bound on a stamped resistance, so a source stating `0 Ohm` cannot put an infinity in
 * the matrix. Well below any real winding or coil, so it never perturbs a stated value.
 */
const MIN_STAMP_OHMS = 1e-6;

/**
 * The three springs of one transducer pair, as multiples of the shortest transit time.
 *
 * A tank has several springs of slightly different length precisely so their echo patterns do
 * not line up -- one spring alone is a pitched, ringing echo rather than reverb. These are the
 * published transit times for the Accutronics type 4 pan (29 / 34 / 41 ms) expressed as ratios,
 * so a tank whose shortest spring is stated gets the other two without restating them.
 */
const SPRING_TRANSIT_RATIOS = [1, 34 / 29, 41 / 29] as const;

/**
 * Dispersion allpass coefficient.
 *
 * A spring is dispersive: low frequencies travel more slowly than high, so an impulse arrives
 * smeared into the descending "boing" rather than as an echo. A first-order allpass with a
 * positive coefficient has exactly that sense -- more group delay at low frequency, unity
 * magnitude everywhere, so the chain colours timing without colouring level. The value sets how
 * pronounced the chirp is; it is a voicing choice, not a measured constant.
 */
const SPRING_DISPERSION_COEFFICIENT = 0.6;

/** One spring: a dispersive feedback delay line. */
type SpringLine = {
	readonly buffer: Float64Array;
	writeIndex: number;
	/** Per-round-trip loss that reaches -60 dB after the tank's stated decay time. */
	readonly feedback: number;
	/** First-order allpass state, one pair per dispersion stage. */
	readonly allpassX: Float64Array;
	readonly allpassY: Float64Array;
};

type SpringTankState = {
	readonly lines: readonly SpringLine[];
	/** Transducer step-up, see `advanceSpringReverb`. */
	readonly transduction: number;
	driveX1: number;
	driveY1: number;
};

/** Unique per stamp within a block, because `lower.ts` allocates `sourceIndex` that way. */
function springKey(blockId: string, sourceIndex: number): string {
	return `${blockId}:${sourceIndex}`;
}


/**
 * One sample of `hold-loop`: the manual's idle -> record while held -> loop -> erase on the next
 * press, on the line's buffer. Exported through the consoles' contract test only by behaviour.
 */
function holdLoop(
	line: {
		buffer: number[];
		capacity: number;
		hold: { state: 0 | 1 | 2; length: number; index: number; gateWas: boolean };
	},
	input: number,
	gate: boolean,
): number {
	const hold = line.hold;
	const rising = gate && !hold.gateWas;
	hold.gateWas = gate;
	if (hold.state === 0) {
		if (rising) {
			hold.state = 1;
			hold.length = 0;
		} else {
			return 0;
		}
	} else if (hold.state === 2 && rising) {
		hold.state = 0;
		hold.length = 0;
		hold.index = 0;
		return 0;
	}
	if (hold.state === 1) {
		if (gate && hold.length < line.capacity) {
			line.buffer[hold.length] = input;
			hold.length += 1;
			return 0;
		}
		hold.state = hold.length > 0 ? 2 : 0;
		hold.index = 0;
		if (hold.state === 0) return 0;
	}
	const out = line.buffer[hold.index] ?? 0;
	hold.index = (hold.index + 1) % hold.length;
	return out;
}

/**
 * One sample of `delay-tap-reverse`, advancing the line's segment phase.
 *
 * Two heads half a segment apart read backwards (`2p + 1` samples back at phase `p`), each
 * weighted `sin^2(pi p / L)`. The weights sum to 1 at every phase, so a constant input plays back
 * constant, and each head's jump from the end of a segment to the start of the next falls where
 * its weight is zero. The segment is kept even so the offset is exactly half of it, which is what
 * makes the two weights sum to 1.
 */
function reverseRead(
	line: { buffer: number[]; writeIndex: number; capacity: number; reversePhase: number },
	lengthSamples: number,
): number {
	// The oldest read is 2 * segment - 1 back, so an even segment may not exceed half the buffer.
	const longest = 2 * Math.floor(line.capacity / 4);
	const segment = Math.min(longest, Math.max(2, 2 * Math.round(lengthSamples / 2)));
	const phase = line.reversePhase % segment;
	let out = 0;
	for (const offset of [0, segment / 2]) {
		const p = (phase + offset) % segment;
		const weight = Math.sin((Math.PI * p) / segment) ** 2;
		const readIndex =
			(((line.writeIndex - (2 * p + 1)) % line.capacity) + line.capacity) % line.capacity;
		out += weight * (line.buffer[readIndex] ?? 0);
	}
	line.reversePhase = (phase + 1) % segment;
	return out;
}

/**
 * A delay-tap read length, pure over its inputs (board-p3 row 4). Factored
 * out of the interpreter so every mode is unit-testable without a program:
 * the smoothing arithmetic, the modulation estimator, the parameter scale,
 * and the capacity default mirror the delay kernels branch for branch, in
 * the same priority. `min`/`headroom`/`round` carry the kernels' shaping --
 * DDL rounds to whole samples above 1, BBD reads fractionally above 0 with
 * two slots of headroom -- so one function serves both without blurring them.
 */
export function composedDelayLength(input: {
	readonly mode: DelayLengthSpec["mode"];
	readonly capacity: number;
	readonly current: number;
	readonly target: number;
	readonly sampleRate: number;
	readonly paramScale: number | null;
	/**
	 * A tapped length in samples (a `tapped` line's interval times its ratio), or null. In
	 * `parameter` mode it wins over `paramScale` and is clamped to `floor..capacity`.
	 */
	readonly tapped: number | null;
	readonly modVolts: number | null;
	readonly modEstimate: number;
	readonly modSeeded: boolean;
	/**
	 * The open-OX2 law constants plus stage count, or null. Read only by the
	 * `clock-law` branch; every other mode ignores it, exactly as they ignore
	 * `modVolts` outside `modulation`. Optional so existing callers keep
	 * compiling; absent reads as no law, and the branch falls to capacity.
	 */
	readonly clockLaw?: (ClockLawParams & { readonly stages: number }) | null;
	readonly min: number;
	/**
	 * The shortest length, in samples, a `parameter` read may produce: the source's cited
	 * floor. The control sweeps `floor..capacity` rather than `0..capacity`. 0 reproduces the
	 * old `capacity x scale` reading exactly, and is what every registry decomposition passes.
	 */
	readonly floor: number;
	readonly headroom: number;
	readonly round: boolean;
}): {
	length: number;
	current: number;
	modEstimate: number;
	modSeeded: boolean;
} {
	const cap = input.capacity - input.headroom;
	const shape = (x: number): number =>
		Math.min(
			cap,
			Math.max(input.min, input.round ? Math.round(x) : x),
		);
	if (input.mode === "clock") {
		let next = input.current;
		if (Math.abs(input.current - input.target) > 1e-6) {
			const alphaSmooth = 1 - Math.exp(-1 / (0.01 * input.sampleRate));
			next = input.current + (input.target - input.current) * alphaSmooth;
		} else {
			next = input.target;
		}
		return {
			length: shape(next),
			current: next,
			modEstimate: input.modEstimate,
			modSeeded: input.modSeeded,
		};
	}
	if (input.mode === "modulation" && input.modVolts !== null) {
		let estimate = input.modEstimate;
		let seeded = input.modSeeded;
		if (!seeded) {
			estimate = input.modVolts;
			seeded = true;
		} else {
			const alphaMod = 1 / (MODULATION_DC_SECONDS * input.sampleRate);
			estimate += alphaMod * (input.modVolts - estimate);
		}
		const denominator =
			Math.abs(input.modVolts) < 1e-6
				? 1e-6 * Math.sign(input.modVolts || 1)
				: input.modVolts;
		const raw = estimate / denominator;
		const scale = Math.min(
			MODULATION_SCALE_MAX,
			Math.max(
				MODULATION_SCALE_MIN,
				Number.isFinite(raw) ? raw : 1,
			),
		);
		return {
			length: shape(input.target * scale),
			current: input.current,
			modEstimate: estimate,
			modSeeded: seeded,
		};
	}
	if (input.mode === "clock-law" && input.modVolts !== null && input.clockLaw != null) {
		// The open-OX2 relaxation law, absolute in the slow node's solved
		// voltage: no DC estimator, no self-normalisation, no ratio clamp.
		// delay = stages × R × C × ln((VDD − V0)/(VDD − Vth)) with
		// V0 = max(V − Vf, floor). The guards are the contract with the C++
		// console, which duplicates them and says so; a degenerate law reads
		// capacity rather than NaN.
		const law = input.clockLaw;
		const v0 = Math.max(input.modVolts - law.vfVolts, law.floorVolts);
		const chargeSpan = law.vddVolts - v0;
		const thresholdSpan = law.vddVolts - law.vthVolts;
		const fallback = {
			length: cap,
			current: input.current,
			modEstimate: input.modEstimate,
			modSeeded: input.modSeeded,
		};
		if (
			!(law.rOhms > 0) ||
			!(law.cFarads > 0) ||
			!(law.stages > 0) ||
			!(chargeSpan > 1e-9) ||
			!(thresholdSpan > 1e-9)
		) {
			return fallback;
		}
		const chargeSeconds =
			law.rOhms * law.cFarads * Math.log(chargeSpan / thresholdSpan);
		if (!Number.isFinite(chargeSeconds) || !(chargeSeconds > 0)) {
			return fallback;
		}
		return {
			length: shape(law.stages * chargeSeconds * input.sampleRate),
			current: input.current,
			modEstimate: input.modEstimate,
			modSeeded: input.modSeeded,
		};
	}
	if (input.mode === "parameter" && input.tapped !== null) {
		const floor = Math.min(cap, Math.max(0, input.floor));
		return {
			length: shape(Math.min(cap, Math.max(floor, input.tapped))),
			current: input.current,
			modEstimate: input.modEstimate,
			modSeeded: input.modSeeded,
		};
	}
	if (input.mode === "parameter" && input.paramScale !== null) {
		const floor = Math.min(cap, Math.max(0, input.floor));
		return {
			length: shape(floor + (cap - floor) * input.paramScale),
			current: input.current,
			modEstimate: input.modEstimate,
			modSeeded: input.modSeeded,
		};
	}
	return {
		length: cap,
		current: input.current,
		modEstimate: input.modEstimate,
		modSeeded: input.modSeeded,
	};
}

export class ReferenceRuntime {
	private readonly program: Program;
	private sampleRate: number | null = null;
	/**
	 * Solver sub-samples per host sample; 1 is the plain path and costs nothing.
	 *
	 * `sampleRate` above is the **solver's** rate, already multiplied by this, because every
	 * `dt`, delay length and pole coefficient in this file is derived from it and each is
	 * correct at the sub-sample rate. `hostSampleRate()` is the rate a caller passed in.
	 */
	private oversample = 1;
	/**
	 * Band-limited resampling around the solver, one 2x half-band stage per
	 * entry, cascaded for 4x and 8x. Empty unless `oversample` is a power of
	 * two greater than 1; any other factor keeps the legacy hold-and-last
	 * path below. Built fresh (zero state) in `prepare()`, so the filter
	 * state never leaks across renders and block splits stay bit-identical.
	 */
	private resampleUp: HalfBandStage2x[] = [];
	private resampleDown: HalfBandStage2x[] = [];
	/** Scratch for the sub-sample streams, sized to `oversample` in `prepare()`. */
	private resampleBufA: Float64Array = new Float64Array(0);
	private resampleBufB: Float64Array = new Float64Array(0);
	/** Total resampler group delay in host samples (0 on the legacy path). */
	private resampleLatencyHost = 0;
	private readonly positions = new Map<ControlId, number>();
	private readonly lastShiftedSample = new Map<string, number>();
	/**
	 * Build-order step 6: bumped by every `setControl` call. `eliminationScratch`'s cached
	 * factorisation, `Z` and `K_reduced` are valid only while this has not moved since they
	 * were built (see `setControl`'s own comment) -- starts at 0 and the cache's own
	 * `cachedGeneration` starts at -1, so the first sample always builds fresh regardless of
	 * whether a control was ever explicitly set.
	 */
	private controlGeneration = 0;
	/**
	 * Block base-matrix rebuilds performed by `setSupply`, one per affected block
	 * per call. A call whose values already match, an empty address list, or a call
	 * before `prepare()` rebuilds nothing and leaves this unchanged.
	 */
	private supplyRebuildCount = 0;
	private readonly capacitorState = new Map<string, number[]>();
	private readonly nodeVoltages = new Map<string, number[]>();
	/**
	 * Previous-iterate junction voltages, which junction limiting needs.
	 *
	 * Keyed by a packed integer (`packHistoryKey2`/`3`) rather than a `${block.id}:${node}...`
	 * string built fresh on every lookup -- same intent as the id-lookup maps built in the
	 * constructor, applied to the per-iteration, per-stamp case. **Keying by the stamp object
	 * itself was tried first and reverted**: it changes behaviour, not just performance.
	 * `boss-hm-2` has two distinct `diode` stamps sharing one node pair (anode 0, cathode 19)
	 * -- a real, if unusual, circuit shape -- and the string key's collision on them is not a
	 * latent bug to fix here, it is part of the exact trajectory this runtime is the reference
	 * for: the two diodes sharing one limiter history slot changes which of them a later
	 * iteration damps against, and that changed `boss-hm-2`'s digest. A packed integer of
	 * (block index, node indices) reproduces that exact collision -- two same-kind stamps at
	 * the same nodes still hash identically -- while costing an arithmetic combine instead of a
	 * string allocation. See `applyStamp`'s `bjt` case and `packHistoryKey2`/`3`'s own comment.
	 */
	private readonly bjtHistory = new Map<number, { vbe: number; vbc: number }>();
	/**
	 * Previous-iterate grid and plate voltages, for the triode's step limiter.
	 *
	 * Shared with the `pentode` case below, and keyed the same way as `bjtHistory` -- which
	 * also means a triode and a pentode sharing grid/cathode/plate node numbers in the same
	 * block still collide, exactly as the old string key made them (see `bjtHistory`'s comment
	 * for why that is the correct thing to reproduce here, not a bug to fix).
	 */
	private readonly triodeHistory = new Map<
		number,
		{ vgk: number; vpk: number; vsk?: number }
	>();
	/**
	 * Previous-iterate op-amp differentials, which the gain step needs damping against,
	 * plus the step that produced each -- a step's *sign* is what tells a march toward
	 * the solution apart from an oscillation straddling it. See the `ideal-opamp` case.
	 * Keyed the same way as `bjtHistory`.
	 */
	private readonly opampHistory = new Map<
		number,
		{ differential: number; step: number; cap: number }
	>();
	/**
	 * The op-amp dominant pole's raw open-loop state, in volts -- the backward-Euler memory the
	 * `ideal-opamp` case steps against, seeded from the operating point in `solveOperatingPoint`
	 * and advanced once per sample in `processBlock` rather than per Newton iterate, because it
	 * is a property of the circuit's clock, not of the iteration. Keyed like `opampHistory`.
	 */
	private readonly opampRawState = new Map<number, number>();
	/**
	 * Previous-iterate diode junction voltages, which `limitJunction` damps against.
	 * Keyed the same way as `bjtHistory`.
	 */
	private readonly diodeHistory = new Map<number, number>();
	/**
	 * Previous-iterate FET channel voltages, which both FET limiters need.
	 * Keyed the same way as `bjtHistory`.
	 */
	private readonly fetHistory = new Map<number, { vgs: number; vds: number }>();
	/**
	 * One composed block's delay lines, by line id (board-p3 row 4). Same ring
	 * discipline the retired macro state kept, but allocated from the composition's
	 * own `lines` table rather than a model's parameters, and with the
	 * clock-smoothing pair every delay line carries whether a macro or a
	 * composition owns it.
	 */
	/**
	 * Per-block, per-position state keys, built once at prepare.
	 *
	 * `composedStateKey` concatenates, and `processComposedBlock` runs once per sample, so
	 * calling it there allocated a string 48,000 times a second per composed block. Measured
	 * as test timeouts on the brigade and reverb decks before this table existed.
	 */
	private readonly composedStateKeys = new Map<string, readonly string[]>();
	/**
	 * Per momentary control: the sample of its last press, and the interval between its last two.
	 * A press is a rising edge through `setControl`; the time is the sample clock at that call,
	 * which is a host block boundary, so a tap is timed to within one block (2.7 ms at 128 / 48k).
	 */
	private readonly tapState = new Map<
		ControlId,
		{
			lastPressSample: number | null;
			intervalSeconds: number | null;
			/** The current run under a tap law: its first press and how many presses it holds. */
			runStartSample: number | null;
			runCount: number;
		}
	>();
	/** The position each composed block ran last sample, to know when a mode was just selected. */
	private readonly lastComposedPosition = new Map<string, number>();
	private readonly composedLineState = new Map<
		string,
		Map<
			string,
			{
				buffer: number[];
				writeIndex: number;
				capacity: number;
				/**
				 * The capacity a tap length is clamped to: the declared maximum. Equal to
				 * `capacity` except on a line a reverse tap reads, whose buffer is twice this.
				 */
				lengthCapacity: number;
				/** A reverse tap's segment phase, in samples. Unused by every other op. */
				reversePhase: number;
				/** A hold sampler's state: 0 idle, 1 recording, 2 looping; its length, index and gate. */
				hold: { state: 0 | 1 | 2; length: number; index: number; gateWas: boolean };
				/** The cited floor a `parameter` read sweeps up from, in samples. */
				floorSamples: number;
				targetLengthSamples: number;
				currentLengthSamples: number;
			}
		>
	>();
	/**
	 * Per-composed-block DC seed, carrying the `dcEstimate` /
	 * `dcOperatingPoint` pair (board-p3 row 4). The `macro-audio-source`
	 * stamp adds the operating point back to a block's published AC, so a
	 * composition must carry the same seed seeded from the same tap, or the
	 * shell solves a different source -- measured as a ULP divergence at the
	 * first echo on `ibanez-dl5`, whose shell carries real DC bias.
	 */
	private readonly composedDcState = new Map<
		string,
		{
			dcEstimate: number;
			dcOperatingPoint: number;
			modDcEstimate: number;
			modSeeded: boolean;
		}
	>();
	/**
	 * One composed block's Schroeder sections, allocated at prepare from the
	 * composition's own comb/allpass ops (board-p3 row 4). Same buffers,
	 * indices, and gains the reverb kernel owns -- the interpreter factors
	 * the kernel's state per op rather than re-deriving it.
	 */
	private readonly composedFilterState = new Map<
		string,
		{
			combs: { buffer: Float64Array; index: number; gain: number }[];
			allpasses: { buffer: Float64Array; index: number }[];
		}
	>();
	/**
	 * One pitch-shift op's resampling state, keyed by block then op position
	 * (board-p3 row 5). Absolute positions, never wrapped counters: the read
	 * pointer advances `ratio` per sample through a fixed history window and
	 * wraps by whole windows when it outruns or falls behind, which is the
	 * documented discontinuity -- no crossfade, fundamental preserved.
	 */
	private readonly composedPitchState = new Map<
		string,
		Map<
			number,
			{ buffer: number[]; writeAbs: number; readAbs: number; ratio: number }
		>
	>();
	/**
	 * One pitch-tracker op's estimator state, keyed by block then op
	 * position (board-p3 row 6): the ring the autocorrelation window is
	 * copied from, samples since the last estimate, and the held output.
	 */
	private readonly composedTrackerState = new Map<
		string,
		Map<
			number,
			{ buffer: number[]; writeAbs: number; sinceUpdate: number; estimate: number }
		>
	>();
	/**
	 * Each macro's current write-back value, read by a `macro-audio-source` stamp in whatever
	 * block shares its audio-out node. Updated once per sample, when the macro block's own turn
	 * in `program.order` comes up -- and `couple.ts`'s corrected schedule (spec clause 3) places
	 * that turn strictly before the block reading this map, so the value read is this sample's,
	 * not last sample's. Written by whichever composition publishes into it -- today
	 * only the delay-line compositions.
	 */
	private readonly macroOutputVolts = new Map<string, number>();
	/**
	 * Each spring reverb tank's mechanical state, keyed by {@link springKey}.
	 *
	 * A tank is not a macro block: it stays inside the MNA block its terminals belong to,
	 * because unlike a BBD it has no audio-in/audio-out *port* to couple -- it has two ordinary
	 * terminal pairs the surrounding driver and recovery stages are wired to. So its state
	 * lives here and advances with the block's other memory, once per solved sample.
	 */
	private readonly springState = new Map<string, SpringTankState>();
	/** Each tank's current pickup voltage, read by its own `spring-reverb` stamp. */
	private readonly springOutputVolts = new Map<string, number>();
	private lastFailure: RuntimeTelemetry["lastFailure"] = null;
	/**
	 * Whether a limiter damped a step during the current Newton iteration.
	 *
	 * An iterate the limiter moved is a step towards the solution, not the solution, so
	 * it cannot be allowed to satisfy the convergence test. See `limitedIterate`.
	 */
	private limitedIterate = false;
	/**
	 * Which element limited, as kind plus its nodes.
	 *
	 * `lastFailure` said *that* a limiter was active and never *which*, and on `boss-ge-7`
	 * that was the whole distance between "the convergence test refused" and a fix: 7
	 * op-amps, 2 FETs and a BJT share one boolean, and a stationary iterate barred by any
	 * one of them looks identical. Nodes rather than a device id because a stamp does not
	 * carry one.
	 */
	private limitedBy: string | null = null;
	/**
	 * The op-amp whose limiter fired on the current iteration, with what a fold reseed needs.
	 * `folded` means its cap sat within an eighth of a linear width. See `OPAMP_FOLD_STREAK`.
	 */
	private limitedOpamp: {
		readonly key: number;
		readonly output: number;
		readonly centre: number;
		readonly railHigh: number;
		readonly railLow: number;
		readonly band: number;
		readonly maxStep: number;
		readonly folded: boolean;
	} | null = null;
	private maxNewtonIterations = DEFAULT_NEWTON_MAX_ITERATIONS;
	/**
	 * Cap-hit diagnostics, **off unless `VESSEL_LIMITER_TRACE=1`**. Both are written once
	 * per Newton iteration, so leaving the per-iteration array on costs ~1.7M pushes on a
	 * 3 s 48 kHz render of a stiff amp -- it grows without bound and it inflates the cost
	 * of the very solver anyone is benchmarking. Nothing in the repository reads them; they
	 * exist for an external probe reaching in past `private`, which is why the gate is an
	 * env var rather than a `prepare()` option.
	 */
	private readonly limiterTrace =
		typeof process !== "undefined" && process.env?.VESSEL_LIMITER_TRACE === "1";
	private limitedIterationCount = 0;
	private limitedIterationPerSample: number[] = [];
	/** Series ohms of whatever drives the input jack -- see `prepare()`'s option. */
	private inputSourceOhms = 0;

	/**
	 * Seconds since `prepare`, for the sample being processed. The program's only clock.
	 *
	 * A sine EMF needs absolute time, and nothing else in a program does: every other stamp is a
	 * function of node voltages and reactive state. It is advanced **once per sample** inside the
	 * sample loop rather than per buffer, so a callback boundary cannot shift the waveform --
	 * the invariance the power-domain rectifier experiment measures as `rmsDelta = 0` across
	 * callback sizes. It is not a program field: `t = n / sampleRate` is computed from the rate
	 * `prepare` was given, so one program still runs at any rate.
	 */
	private timeSeconds = 0;
	private elapsedSamples = 0;

	private samples = 0;
	private nonConvergedSamples = 0;
	/**
	 * Newton iterations that stopped moving while the equations stayed **unsatisfied** — stuck
	 * against a non-smooth boundary rather than converged. `nonConvergedSamples` counts these
	 * together with iterations still moving when the budget ran out, and the two need opposite
	 * fixes: a stall wants damping or a formulation change, a still-moving one wants a larger
	 * budget. Diagnostic only — nothing branches on it.
	 */
	private stalledSamples = 0;
	/**
	 * Newton iterations that stopped moving with the equations **satisfied**, which the current
	 * test rejects because a limiter fired. Diagnostic only, and deliberately so: see the
	 * comment at the convergence test for the 37-packet gate failure that keeps it that way.
	 */
	private solvedButFlaggedSamples = 0;
	/**
	 * Per-block Newton census: how many samples each block solved, how many **exhausted its
	 * iteration budget**, and the most iterations it ever used.
	 *
	 * **Per block, because the level a counter aggregates at is part of its meaning.**
	 * `nonConvergedSamples` sums at the host and `peakIterations` at the host, so a *secondary*
	 * block running out of budget is invisible in both — which is how a cap raise moved ten
	 * packets that those two counters said it could not touch, `electro-harmonix-q-tron` among
	 * them at +0.9 dB with a clean bill of health from every failure counter.
	 *
	 * **And the identity is load-bearing, not decoration.** "Some block here exhausted" detects
	 * the affected class but cannot predict a packet's delta, and predicting each affected
	 * packet's delta in advance is the whole point of the two-sided gate. Which block, how many
	 * of its samples, and how badly is what supports a prediction.
	 */
	/**
	 * Blocks on probation, and the sample index each one's probation ends at.
	 *
	 * A block lands here when one of its samples stalled, or was already solved, at the moment
	 * the budget ran out. Both verdicts say more iterations cannot help *that sample*, so the
	 * ones after it are bought at `NEWTON_UNPRODUCTIVE_ITERATIONS` instead of the full budget.
	 *
	 * **It is a probation and not a sentence, and the difference is a packet that plays.** This
	 * was a `Set` with no expiry until 2026-09-19: one qualifying sample revoked a block's budget
	 * for the rest of the render, so a block that needs a one-off large budget never got one
	 * again. `moogerfooger-mf-102` is the case -- it needs 183 iterations once and 2.1 per sample
	 * after that (see `DEFAULT_NEWTON_MAX_ITERATIONS`), and under the permanent form it was
	 * capped at 64 from its first flagged sample onward and rendered **digital silence** for the
	 * whole render, while the C++ console, which has no revocation at all, played it. Measured
	 * 2026-09-19 at 1 kHz/0.1 V over 4800 samples: RMS `0.00e+0` -> `3.10e-2`, non-converged
	 * samples 4800 of 4800 -> 22.
	 */
	private readonly unproductiveUntilSample = new Map<string, number>();
	/**
	 * Per block, the last three converged sub-sample solutions and the extrapolation order
	 * that would have predicted the newest of them best, for the Newton start predictor.
	 *
	 * **The start of a Newton solve is a guess, and the previous solution is only the
	 * cheapest guess, not the best one.** At 4x oversampling the circuit moves a quarter as
	 * far per solve, and a quadratic extrapolation of the last three solutions lands inside
	 * the convergence tolerance on most sub-samples, so the first Newton step is already the
	 * answer and the check that follows it is the whole solve: one iteration where the
	 * previous-solution start needs two (one step, one check). Measured 2026-10-09 on the six
	 * profile packets at os4 (`docs/spikes/2026-10-09-newton-iteration-budget.md`): iterations
	 * per host sample fall 38-47 % on the pedals with every converged solution within 0.02
	 * tolerance units of the full-Newton solution from the same state.
	 *
	 * **The order is chosen by the block's own history, not by a constant.** After every
	 * converged solve the three candidate starts the history could have produced (order 0 =
	 * the previous solution, 1 = linear, 2 = quadratic) are scored against the solution just
	 * reached, in tolerance units, and the best one is used for the next solve -- but only
	 * when that solve took at most two iterations (the floor: one step and one check). A
	 * solve that needed more was hunting across a knee, and there a closer start is not a
	 * cheaper one (`recordNewtonSolution` has the measurement). On a hard edge the
	 * extrapolations overshoot the clipping knee and score worse than the previous solution,
	 * so the next solve starts exactly where it always did; on a signal it cannot predict it
	 * costs nothing. A non-converged solve breaks the chain (no history to extrapolate from).
	 *
	 * Only the start moves. The convergence test, the limiter histories, the relaxation rule
	 * and the fold reseed (which reads the caller's `start`, the previous solution) are
	 * untouched, so what converges is still the circuit's equations at the shipped
	 * tolerances -- a different first iterate, the same fixed point.
	 *
	 * **It runs only when `prepare()` was given `oversample > 1`; at factor 1 (the default)
	 * it neither seeds nor records, so the ring stays empty and the solve is the one runtime
	 * 0.3.1 ran.** It shipped in 0.4.0 at every factor and was gated here in 0.4.1 because at
	 * factor 1 it buys little and moves the output more than that saving is worth: iterations
	 * fall 2.9 % across the pedal corpus and 10.1 % across the amps (1 kHz 0.1 V, cap 64),
	 * against `boss-dm-2` moving 6.2 % of its cold-start peak (0.5-0.8 % of the settled peak)
	 * and `boss-mt-2` stalling the WASM console permanently from 2.752 s of two-tone drive
	 * (it does not stall with the predictor off). Above 1 it stays on for every factor, the
	 * held path included (iterations on the profile packets: 2x -6..-15 %, 3x 0..-1 %, 4x
	 * -39..-47 %, 5x/6x -8..-24 %, 8x -44..-50 %; output movement at most 6e-6 relative RMS).
	 * The factor is fixed by `prepare()` (which also clears the ring), so there is no mid-run
	 * switch to reason about.
	 */
	private readonly newtonStartHistory = new Map<
		string,
		{
			x1: number[] | null;
			x2: number[] | null;
			x3: number[] | null;
			chain: number;
			order: 0 | 1 | 2;
			/** Scratch for the predicted start, reused so a solve allocates nothing for it. */
			candidate: number[];
		}
	>();
	private readonly blockNewtonCensus = new Map<
		string,
		{ samples: number; exhausted: number; peakIterations: number }
	>();
	private totalIterations = 0;
	private nonFiniteSamples = 0;
	private peakIterations = 0;
	/** Whether any block failed on the sample being processed, counted once per sample. */
	private sampleNonConverged = false;
	private sampleNonFinite = false;
	/**
	 * Blocks whose operating point did not solve. Those keep zero state -- the old
	 * behaviour -- and this counts them so a silent fallback cannot look like a settled
	 * circuit.
	 */
	private operatingPointFailures = 0;
	private operatingPointSupplyAmps = 0;
	private renderedSupplyPeakAmps = 0;
	/**
	 * Where each supply branch's current sits in each block's solution, resolved once.
	 *
	 * The per-sample cost of the rendered peak has to be a handful of array reads, not a walk of
	 * every stamp in the program: `branchCurrentSnapshot` does that walk and is a diagnostic
	 * called once, while this runs inside the sample loop.
	 */
	private supplyBranchSlots: readonly {
		readonly blockId: string;
		readonly slot: number;
	}[] = [];
	/**
	 * The operating point is solved once, on the first `process` after `prepare`, and
	 * deliberately not on `setControl`.
	 *
	 * Deferring it that far is what lets a caller set its knobs first, so the circuit
	 * settles at the positions it will be played at. Not re-solving afterwards is the
	 * physical answer: powering on establishes an operating point, and turning a knob
	 * after that is a transient the solver follows. Re-solving would discard the reactive
	 * memory mid-stream, which is both a click and a circuit that does not exist.
	 */
	private operatingPointPending = false;
	/**
	 * Block lookup by id, built once here rather than searched per use.
	 *
	 * `process`'s sample loop walks `program.order` and previously resolved each id with
	 * `program.blocks.find(...)` -- a linear scan repeated for every scheduled block on every
	 * sample. `program.blocks` does not change after construction, so the scan's answer
	 * cannot change either; this trades an O(blocks) search, paid every sample, for one map
	 * build paid once.
	 */
	private readonly blocksById = new Map<string, Block>();
	/**
	 * Control lookup by id, built once for the same reason as `blocksById`.
	 *
	 * `applyStamp`'s `controlled-conductance`/`controlled-resistance` cases resolved the
	 * owning control with `program.controls.find(...)` to read its taper -- a scan repeated
	 * for every such stamp, every Newton iteration, every sample. Hotter than the block scan
	 * by a wide margin (stamps x iterations x samples versus blocks x samples), and the same
	 * fix applies: `program.controls` is fixed after construction.
	 */
	private readonly controlsById = new Map<ControlId, Control>();
	/**
	 * A small integer per block, in place of `block.id` (a string), for the packed history
	 * keys `packHistoryKey2`/`3` build. Built once here from `program.blocks`'s fixed order,
	 * same as `blocksById`. See `bjtHistory`'s comment for why the key needs a block
	 * component at all: two blocks (a real shape -- `boss-hm-2` has two) can each stamp a
	 * device at the same local node numbers, and those must not collide with each other the
	 * way two co-located devices *within* one block are meant to.
	 */
	private readonly blockIndexById = new Map<string, number>();
	/**
	 * Reusable Newton-iteration scratch, one entry per MNA block, sized once in `prepare`.
	 *
	 * Every Newton iteration used to allocate a fresh N x N matrix and an N-vector rhs
	 * (`zeros(size)`, `new Array(size).fill(0)`), and `solve` then made its own defensive
	 * copies of both before eliminating -- four allocations, up to N^2 numbers each, for
	 * every iteration of every block of every sample. Reused here: the same arrays are
	 * zeroed in place at the top of each iteration instead of replaced, and `solve` now
	 * eliminates directly on the caller's buffers (see its own comment for why that is safe).
	 *
	 * `solutionA`/`solutionB` close the gap that reuse left open: `solve` used to return a
	 * fresh N-length array every iteration (`iterate`'s closing comment used to say this was
	 * deliberate, because the alternative -- writing into one of two buffers `iterate` keeps
	 * across iterations -- hadn't been done yet). Measured on `pro-co-rat`, whose 33x33 block
	 * needs ~3.2 Newton iterations a sample on average: that line alone was 5.5% of total
	 * runtime self-time under `--cpu-prof-md`, on top of `solve`'s own 56%. `iterate` now pings
	 * between these two instead, so `solve` writes into whichever one is not currently `current`
	 * -- see `iterate`'s and `solve`'s own comments for why swapping is safe.
	 */
	private readonly iterationScratch = new Map<
		string,
		{
			readonly matrix: number[][];
			readonly rhs: number[];
			readonly solutionA: number[];
			readonly solutionB: number[];
			/**
			 * Row/column pairs the sparse path touches, or `null` when this block has no
			 * schedule and the dense clear is the only correct one. See the clear sites.
			 * Mutable because `settlePivotOrders` can take a schedule away after `prepare`
			 * validated it against the assembled matrix -- a dropped block must rebuild
			 * the full matrix every iteration, exactly like a block that never had one.
			 */
			clearPairs: Int32Array | null;
			/**
			 * Whether a dense `solve` has eliminated on `matrix` since it was last built in
			 * full. **`solve` factorises in place and writes fill everywhere**, so one dense
			 * fallback destroys the "zero outside the pattern" invariant that makes the
			 * pattern-only refresh below exact. The next build pays for one full pass and
			 * clears this; the pattern path resumes after it.
			 */
			denseDirty: boolean;
		}
	>();

	/**
	 * Per-block static elimination schedules, built once in `prepare()` and replayed by
	 * `iterate` in place of the dense `solve` -- see `buildSparseSchedule`.
	 *
	 * A block appears here only when the schedule is worth replaying (`solverPlan()` reports
	 * the split and its reason). Absent means the dense path, which is also where a block
	 * lands mid-solve if its pivot guard trips.
	 */
	private readonly sparseSchedules = new Map<
		string,
		{
			readonly schedule: SparseSchedule;
			readonly values: Float64Array;
			readonly rhs: Float64Array;
			readonly factors: Float64Array;
			/**
			 * Runs of consecutive pivot-guard trips, so a block the static order does not suit
			 * can give the schedule up instead of paying for it and the dense solve forever.
			 * See `SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT`.
			 */
			consecutiveFallbacks: number;
			/**
			 * Whether the mid-run re-pivot below has already spent its one attempt on
			 * this order. Set when the consecutive-trip limit is reached: the first
			 * limit-hit re-pivots once from the current matrix instead of
			 * abandoning, and only a second limit-hit on the same order abandons.
			 * Fresh orders (admitted or adopted at settle) start false.
			 */
			repivotAttempted: boolean;
		}
	>();

	/**
	 * Precomputed base matrices from constant stamps for each MNA block.
	 *
	 * Fold constant, control-free, dynamic-free stamp values into a precomputed base
	 * matrix and RHS vector per block, initialized with standard GMIN and ground row.
	 * During audio processing, iterate only copies the base matrix and applies the
	 * non-constant stamps.
	 */
	private readonly baseMatrices = new Map<
		string,
		{
			readonly matrix: number[][];
			readonly rhs: number[];
			readonly nonConstantStamps: readonly Stamp[];
			readonly nonConstantLinearStamps: readonly Stamp[];
		}
	>();

	/** Blocks that gave up their schedule at runtime, for `solverPlan()` to report. */
	private readonly abandonedSchedules = new Set<string>();

	/**
	 * Blocks whose shipped elimination order divides by a pivot the assembled
	 * operating-point matrix cannot support, dropped to the dense solve at the
	 * first `process()` call. See `settlePivotOrders`.
	 */
	private readonly droppedSchedules = new Set<string>();

	/**
	 * Blocks whose shipped order failed numeric validation and whose replacement
	 * order (threshold Markowitz on the assembled operating-point matrix) was
	 * adopted instead of dropping to dense. See `computeNumericRepivot`.
	 */
	private readonly repivotedSchedules = new Set<string>();

	/** Set once the shipped orders have been validated against the real matrix. */
	private pivotOrdersSettled = false;

	/** Why each block took the path it did, for `solverPlan()`. */
	private readonly solverPlanRows: {
		readonly blockId: string;
		readonly size: number;
		patternEntries: number;
		readonly fillIn: number;
		sparseOps: number;
		readonly denseOps: number;
		unprovenPivots: number;
		path: "sparse" | "dense";
		reason: string;
		/** Shipped-order threshold violations at the operating point, if checked. */
		pivotViolations: number;
		/** Smallest `|pivot| / columnMax` over the shipped order, if checked. */
		worstPivotRatio: number | null;
		/**
		 * Relative disagreement between the sparse replay and the dense solve on
		 * the assembled operating-point matrix, if checked. This is what drops
		 * a block; the ratios above stay on as diagnostics.
		 */
		pivotDisagreement: number | null;
		/** True when the shipped order failed validation and a numeric re-pivot was adopted. */
		repivoted: boolean;
	}[] = [];

	/**
	 * How many solves hit a pivot below `SCHEDULE_PIVOT_FLOOR` and ran again densely, against
	 * how many the schedule ran at all. A fallback is correct but not free: it pays for the
	 * schedule and then the dense solve. A rate that is not small means that block is not
	 * suited to a static order, not that the net is doing its job.
	 */
	private scheduleFallbacks = 0;
	private scheduleSolves = 0;

	/**
	 * Build-order step 6, vertical slice: which blocks run through symbolic elimination
	 * instead of `iterate`'s full-system Newton solve.
	 *
	 * **Deliberately opt-in, per block id, and empty by default.** Every packet other than
	 * one named for this experiment takes the untouched `iterate` path; nothing here changes
	 * unless a caller explicitly asks for it. The plan's own rule ("the stamp interpreter is
	 * never deleted out from under that role until behavioural parity replaces it by
	 * decision") is honoured by construction: `iterate` is not touched, is still what
	 * `solveOperatingPoint`'s continuation methods use unconditionally, and is exactly what
	 * this path is diffed against -- see `scripts/report-elimination-parity.ts`.
	 */
	private readonly eliminateBlocks: ReadonlySet<string>;

	/**
	 * Per-block port analysis, computed once in `prepare()` from the block's own stamps
	 * (`computeNewtonPortRows`) -- never re-derived per sample, since the set of rows a
	 * stamp's law can write to is a static fact about the program, not the operating point.
	 */
	private readonly eliminationPorts = new Map<
		string,
		{
			/** Global rows (nodes or aux rows) a nonlinear law writes into, sorted. */
			readonly ports: readonly number[];
			/**
			 * Global row -> local port index, or `-1`. An `Int32Array` rather than a `Map`:
			 * measured directly (`--cpu-prof`), `Map.get` in the reduction's innermost loop
			 * (every column, every port row, every Newton iteration, every sample) was the
			 * single largest self-time in the whole eliminated path -- larger than either
			 * linear solve. Plain array indexing removed it.
			 */
			readonly portIndexOf: Int32Array;
			/** Every other row, i.e. the part eliminated once per sample. */
			readonly lRows: readonly number[];
			/** Global row -> local L index, or `-1`. Same reasoning as `portIndexOf`. */
			readonly lIndexOf: Int32Array;
			readonly size: number;
			/**
			 * `block.stamps`, partitioned by `newtonPortRowsOf` once here rather than on every
			 * call -- measured directly (`--cpu-prof`): re-classifying all 47 stamps (calling
			 * `newtonPortRowsOf`, which allocates a fresh row array for every nonlinear kind)
			 * on every Newton iteration, for every sample, was the largest single self-time in
			 * the whole path, ahead of both linear solves. The partition is a static fact about
			 * the program, exactly like `ports` itself.
			 */
			readonly linearStamps: readonly Stamp[];
			readonly nonlinearStamps: readonly Stamp[];
		}
	>();

	/**
	 * Reused per-sample/per-iteration scratch for the eliminated path, sized once per block
	 * in `prepare()` -- the same discipline `iterationScratch` already follows, for the same
	 * reason: an allocation inside the hot loop is exactly the cost this path exists to
	 * remove.
	 *
	 * **`ll`/`permutation`/`z`/`kReduced` are control-generation-cached, not per-sample.**
	 * `M_lin[L][L]`'s factorisation, the port-response matrix `Z`, and `K_reduced` all depend
	 * only on control positions -- never on the time-varying input or on capacitor history --
	 * exactly the `linear && controlFree` distinction build-order step 3/4 already established
	 * for baking a whole block's realisation. `iterateEliminated` rebuilds these three only
	 * when `cachedGeneration` disagrees with `this.controlGeneration`; every sample still
	 * rebuilds `linear`/`linearRhs` (cheap, and needed for the RHS regardless) and always
	 * recomputes `z0`/`uReduced` fresh, since those depend on capacitor state and the sample's
	 * own input.
	 */
	private readonly eliminationScratch = new Map<
		string,
		{
			/** The full linear background matrix, rebuilt (not reallocated) every sample. */
			readonly linear: number[][];
			readonly linearRhs: number[];
			/**
			 * `M_lin[L][L]` until `factorLU` runs on it, then its own LU decomposition in
			 * place (multipliers below the diagonal, the eliminated upper-triangular matrix
			 * at and above it) -- reused across samples until `cachedGeneration` goes stale.
			 */
			readonly ll: number[][];
			/** The row order `factorLU` settled on, for `solveLU` to apply to a later RHS. */
			readonly permutation: number[];
			/** The generation `ll`/`permutation`/`z`/`kReduced` were last built for. */
			cachedGeneration: number;
			/** `Z`'s columns: `L`-length responses to a unit current at each port. */
			readonly z: number[][];
			/** Scratch for a single `Z` column's right-hand side while rebuilding it. */
			readonly zRhsScratch: number[];
			/** The reduced port system's fixed matrix, control-generation-cached. */
			readonly kReduced: number[][];
			/** `z0`, the "open-circuit" `L` response to this sample's own `b_L` -- always fresh. */
			readonly z0: number[];
			readonly z0Rhs: number[];
			readonly uReduced: number[];
			/** The nonlinear laws' own contribution this Newton iteration, port rows only. */
			readonly rawNl: number[][];
			readonly rawNlRhs: number[];
			/** The reduced Newton system solved fresh each iteration. */
			readonly reducedJacobian: number[][];
			readonly reducedRhs: number[];
			readonly yCurrent: number[];
			readonly yNext: number[];
			readonly fullCurrent: number[];
			readonly fullNext: number[];
		}
	>();

	constructor(
		program: Program,
		options: { readonly eliminateBlocks?: ReadonlySet<string> } = {},
	) {
		// Copy-on-write ownership of the supply-editable half of the program. The
		// blocks array and every MNA block's stamps array are fresh copies owned by
		// this runtime, so `setSupply` can replace a `dc-source` stamp object
		// without writing into the caller's structures. The stamp objects themselves
		// stay shared until the first `setSupply` touching them, and no other stamp
		// kind is ever replaced. A deep-frozen caller program therefore never throws
		// here or in `setSupply`, and two runtimes built from one program never
		// interact.
		this.program = {
			...program,
			blocks: program.blocks.map((block) =>
				block.kind !== "mna" ? block : { ...block, stamps: [...block.stamps] },
			),
		};
		this.eliminateBlocks = options.eliminateBlocks ?? new Set();
		for (const control of program.controls) {
			this.positions.set(control.id, control.defaultPosition);
			this.controlsById.set(control.id, control);
		}
		for (const [index, block] of program.blocks.entries()) {
			this.blocksById.set(block.id, block);
			this.blockIndexById.set(block.id, index);
		}
	}

	/**
	 * The only entry point that accepts a sample rate. No default exists.
	 *
	 * The Newton iteration cap is a real CPU-versus-accuracy knob, the same role
	 * SPICE's ITL settings play, so a host may lower it. Lowering it does not make
	 * the runtime lie: samples that then fail to converge are held and counted.
	 *
	 * `realtimeBudget` is the real-time admission gate (see `./admission.ts`): supplying
	 * one asks "can this program be shown to fit", refusing by name and by number when it
	 * cannot. Omitting it opts out of the gate entirely -- this runtime has no honest
	 * per-machine default to fall back on.
	 */
	prepare(
		sampleRate: number,
		options: {
			readonly maxNewtonIterations?: number;
			readonly realtimeBudget?: RealtimeBudget;
			/**
			 * Series impedance of whatever drives the input jack, in ohms. **A console
			 * setting, not a program one** -- the same compiled pedal is driven by a guitar
			 * (~5-15 kOhm plus pickup inductance), a buffered board (~100 Ohm), or a stiff
			 * test source (0), and none of that belongs in the ROM.
			 *
			 * Defaults to 0, the historical stiff-drive behavior. It exists because a fuzz
			 * face's defining dynamics ARE the loading interaction between its low, nonlinear
			 * input impedance and the pickup's source impedance; driven from an ideal source
			 * it renders at constant maximum harshness -- found by ear on the 2026-08-18
			 * listening pass, twice, either side of the cabinet IR landing.
			 */
			readonly inputSourceOhms?: number;
			/**
			 * Solver sub-samples per host sample. **A console setting, not a program one**, for
			 * the same reason `inputSourceOhms` is: the rate a host runs at is not a property of
			 * the circuit, and decision 3 already puts sample rate on this side of the
			 * boundary.
			 *
			 * **Why it earns its place, measured 2026-09-07.** At 4x,
			 * `report:compiler-spice-parity` goes from 47 to 50 `agrees` over 118 packets, five
			 * packets move and every one improves, and none loses agreement. It also removes
			 * `boss-ce-5`'s full-scale limit cycle -- 4.000 V of AC from silence at 48 kHz,
			 * 1.01e-3 at 96 kHz -- and that cycle is *gone* rather than folded down, so raw,
			 * zero-order- and boxcar-decimated output are identical at every rate.
			 *
			 * **Why it is not on by default.** Cost is about 3.2x the solver work at the corpus
			 * median (2.6 iterations per output sample against 8.3), because everything floors
			 * at 2.0-2.4 iterations per sub-sample whatever the rate and only packets above that
			 * floor save anything. Those are the stiff ones: `boss-ce-5` costs 1.23x and has the
			 * limit cycle, `mxr-phase-45` costs 3.84x and already agrees at 0.9710. A global
			 * multiplier spends the most where it buys least, so the factor belongs with whoever
			 * knows the packet -- `report-newton-deadline` computes the stiffness signal.
			 *
			 * **What it does.** At a power-of-two factor (2, 4, 8, ...), each
			 * host sample is band-limited interpolated up by cascaded half-band
			 * FIR 2x stages, solved at the sub-sample rate, and FIR-decimated
			 * back to one host sample per input sample. The interpolation
			 * removes the input hold's sinc droop and the decimation removes
			 * folded harmonics, so a 48 kHz host at 4x renders like a true
			 * 192 kHz simulation of the band-limited host signal. The filters
			 * are linear-phase, designed in `prepare()` from the stage alone
			 * (never the circuit), with their state carried across `process()`
			 * calls; the total group delay in host samples is reported by
			 * `oversampleLatency()`.
			 *
			 * **What it does not do.** At factor 1, or a factor that is not a
			 * power of two, decimation here is zero-order: the last
			 * sub-sample of each host sample is the output. That is what the
			 * 47-to-50 measurement was taken with. A band-limiting decimator
			 * for non-power-of-two factors is not implemented.
			 */
			readonly oversample?: number;
		} = {},
	): void {
		// The cartridge lockout, and it comes before the rate because it is a question about
		// the program rather than about the host: a program this runtime cannot execute is
		// refused at any rate.
		//
		// Load time, not first sample. The dispatch in `applyStamp` still throws when it meets
		// an operator it does not implement, and that throw is the backstop for a program whose
		// declaration *understates* its stamps -- but reaching it means the refusal arrives
		// mid-buffer, after a host has committed to playing. Every missing operator is named,
		// not just the first, so one load says what a runtime would need to gain rather than
		// making the host discover them one at a time.
		const missing = unimplementedOperators(this.program.requiredOperators);
		if (missing.length > 0) {
			throw new RuntimeError(
				`program requires ${missing.length === 1 ? "an operator" : "operators"} this runtime does not implement: ${missing.join(", ")}`,
			);
		}
		// The same lockout for the macro half of the instruction set. Separate from the operator
		// check and separately worded on purpose: a missing operator and a missing DSP model are
		// different work for whoever has to close the gap, and a refusal that could not say which
		// could not say what this runtime would need to gain. See `IMPLEMENTED_MODELS`.
		//
		// Before a note *and* before any per-block state is sized below: the ring buffer the
		// bucket-brigade model owns is allocated in this method's own block loop, and allocating
		// state for a model nothing executes would be the first half of running the wrong one.
		const missingModels = unimplementedModels(this.program.requiredModels);
		if (missingModels.length > 0) {
			throw new RuntimeError(
				`program requires ${missingModels.length === 1 ? "a DSP model" : "DSP models"} this runtime does not implement: ${missingModels.join(", ")}`,
			);
		}
		// A dispatched macro block is refused by name, never executed and never ignored.
		//
		// **Ordered after the model lockout on purpose.** Both can fire on the same program and
		// they answer different questions, so the more specific one goes first: a macro naming
		// `compander` fails above because nothing implements compander, which is the useful
		// sentence, and "macro dispatch was retired" would be a true statement explaining the
		// wrong thing.
		//
		// What reaches here is the case the lockout cannot see: a macro naming a model that *is*
		// implemented -- which all three deleted kernels were, as compositions. Such a block
		// passes every other check and then finds no executor, and a block that executes nothing
		// renders silence. That is the one outcome the console/ROM contract forbids, so the block
		// kind itself is refused. This is the gap that made deleting the kernels safe.
		const dispatched = this.program.blocks.filter(
			(block) => block.kind === "macro",
		);
		if (dispatched.length > 0) {
			const named = dispatched
				.map((block) => `${block.id} (${block.modelId})`)
				.join(", ");
			throw new RuntimeError(
				`program carries ${dispatched.length === 1 ? "a dispatched macro block" : "dispatched macro blocks"} this runtime no longer executes: ${named}. Macro dispatch was retired in board-p3 row 7; these models ship as compositions.`,
			);
		}
		if (
			!Number.isFinite(sampleRate) ||
			sampleRate < 1000 ||
			sampleRate > 768_000
		) {
			throw new RuntimeError(
				`sample rate ${sampleRate} is not usable; a program has no default rate`,
			);
		}
		const maxNewtonIterations = Math.max(
			1,
			Math.floor(options.maxNewtonIterations ?? DEFAULT_NEWTON_MAX_ITERATIONS),
		);

		// Real-time admission (see admission.ts for the design and why it is opt-in). Computed
		// from locals and checked before `this.sampleRate`/`this.maxNewtonIterations` are
		// touched, so a refusal leaves this instance exactly as unprepared as it was -- same
		// atomicity the cartridge lockout above already has. Assigning first and refusing
		// after would leave `this.sampleRate` non-null with every per-block map still holding
		// whatever a *previous* prepare() left there (or nothing, on a first call), so a
		// caller's `process()` after a caught refusal would fail confusingly instead of with
		// the same "prepare(sampleRate) was never called" it gets today.
		if (options.realtimeBudget !== undefined) {
			// A one-element chain: admission's unit is the ordered list the console runs, and
			// a single program is the degenerate case of one, not a separate question. See
			// `./chain.ts`, which gates the whole list once and prepares its slots ungated --
			// gating each slot against the whole budget here would admit three pedals at 0.9x
			// apiece.
			const verdict = admissionVerdict(
				[this.program],
				sampleRate,
				options.realtimeBudget,
			);
			if (!verdict.fits) {
				throw new RuntimeError(verdict.reason);
			}
		}

		// Validated before assignment, like everything else in this block, so a refusal leaves the
		// instance as unprepared as it was.
		const oversample = Math.max(1, Math.floor(options.oversample ?? 1));
		if (!Number.isFinite(oversample)) {
			throw new RuntimeError(
				`oversample must be a finite integer of at least 1, got ${String(options.oversample)}`,
			);
		}
		this.oversample = oversample;
		// The solver runs at the sub-sample rate. Delay lines and pole coefficients are held in
		// *seconds* and converted here, so they stay correct without knowing about oversampling.
		this.sampleRate = sampleRate * oversample;
		// The band-limited resampler is designed here, from the stage alone: one
		// windowed-sinc half-band prototype per 2x stage (`RESAMPLE_STAGE_SPECS`),
		// fresh zero-state instances per direction, so `prepare()` clears the
		// filter state and a re-prepared run starts clean. Powers of two only;
		// any other factor keeps the legacy hold-and-last path in `process()`.
		const resampleStages = Math.log2(oversample);
		if (Number.isInteger(resampleStages) && resampleStages >= 1) {
			const prototypes = Array.from({ length: resampleStages }, (_, stage) => {
				const [taps, beta] = resampleStageSpec(stage);
				return designHalfBand2x(taps, beta);
			});
			this.resampleUp = prototypes.map(
				(prototype) => new HalfBandStage2x(prototype),
			);
			this.resampleDown = prototypes.map(
				(prototype) => new HalfBandStage2x(prototype),
			);
			this.resampleBufA = new Float64Array(oversample);
			this.resampleBufB = new Float64Array(oversample);
			this.resampleLatencyHost = cascadeLatencyHostSamples(resampleStages);
		} else {
			this.resampleUp = [];
			this.resampleDown = [];
			this.resampleBufA = new Float64Array(0);
			this.resampleBufB = new Float64Array(0);
			this.resampleLatencyHost = 0;
		}
		this.maxNewtonIterations = maxNewtonIterations;
		// Negative would be a source that supplies energy under load; refuse the nonsense
		// rather than solve it.
		this.inputSourceOhms = Math.max(0, options.inputSourceOhms ?? 0);

		this.timeSeconds = 0;
		this.elapsedSamples = 0;
		// A tap timed against the previous clock would read a meaningless interval.
		this.tapState.clear();
		this.lastComposedPosition.clear();
		// A latch is firmware state, and firmware powers up where its declaration says: a knob keeps
		// its position across prepare, a latch does not.
		for (const control of this.program.controls) {
			if (control.latch !== undefined) this.positions.set(control.id, control.defaultPosition);
		}
		this.samples = 0;
		this.nonConvergedSamples = 0;
		this.stalledSamples = 0;
		this.solvedButFlaggedSamples = 0;
		this.blockNewtonCensus.clear();
		this.unproductiveUntilSample.clear();
		this.newtonStartHistory.clear();
		this.totalIterations = 0;
		this.nonFiniteSamples = 0;
		this.peakIterations = 0;
		// Counts are not the whole of a run's state. A stale `lastFailure` would be read
		// as this run's, and the limiter histories are previous-iterate operating points:
		// left behind, the first iterations of a re-prepared run damp their steps against
		// voltages from a circuit state that no longer exists.
		this.lastFailure = null;
		this.bjtHistory.clear();
		this.diodeHistory.clear();
		this.triodeHistory.clear();
		this.opampHistory.clear();
		this.opampRawState.clear();
		this.fetHistory.clear();
			this.composedStateKeys.clear();
			this.composedLineState.clear();
			this.composedDcState.clear();
			this.composedFilterState.clear();
			this.composedPitchState.clear();
			this.composedTrackerState.clear();
		this.macroOutputVolts.clear();
		this.sparseSchedules.clear();
		this.abandonedSchedules.clear();
		this.droppedSchedules.clear();
		this.repivotedSchedules.clear();
		this.pivotOrdersSettled = false;
		this.solverPlanRows.length = 0;
		this.scheduleFallbacks = 0;
		this.scheduleSolves = 0;
		for (const block of this.program.blocks) {
			if (block.kind === "macro") {
				// Unreachable: refused at the top of `prepare()`, before any per-block state is
				// sized. Present because narrowing by `composed` no longer yields `mna` now that
				// the dispatched kernels are gone, and a throw is the honest way to say so.
				throw new RuntimeError(
					`block ${block.id} is a dispatched macro (${block.modelId}); macro dispatch was retired in board-p3 row 7`,
				);
			}
			if (block.kind === "composed") {
				// **Every position's state is allocated here, not on the switch.** A mode change
				// is an index change on the audio thread, so it must not touch the heap; the cost
				// of that is holding N sets of delay buffers, which is the right trade for a chip
				// with a handful of programs.
				this.composedStateKeys.set(
					block.id,
					block.positions.map((_, index) => composedStateKey(block.id, index)),
				);
				for (const [positionIndex, program] of block.positions.entries()) {
					// Delay capacities are times, converted here where the rate lives, so a
					// program is rate-invariant. A block with clock control sizes for the
					// longest delay the knob can ask for, so smoothing can never address
					// past the buffer.
					const lines = new Map<
						string,
						{
							buffer: number[];
							writeIndex: number;
							capacity: number;
							lengthCapacity: number;
							reversePhase: number;
							hold: { state: 0 | 1 | 2; length: number; index: number; gateWas: boolean };
							floorSamples: number;
							targetLengthSamples: number;
							currentLengthSamples: number;
						}
					>();
					// A reverse head at phase p reads 2p + 1 back, so its line holds two segments.
					const reversedLines = new Set(
						program.ops.flatMap((op) => (op.op === "delay-tap-reverse" ? [op.line] : [])),
					);
					const clock = block.clockControl ?? null;
					for (const [lineId, line] of Object.entries(program.lines)) {
						let maxDelaySeconds = line.delaySeconds;
						let initialDelaySeconds = maxDelaySeconds;
						if (clock !== null) {
							const maxR = Math.max(
								clock.ohmsAtControlMin,
								clock.ohmsAtControlMax,
							);
							const maxClockDelay =
								clock.offsetSeconds +
								clock.stages * clock.formulaConstant * maxR * clock.farads;
							maxDelaySeconds = Math.max(maxDelaySeconds, maxClockDelay);
							const pos = this.positions.get(clock.controlId) ?? 0.5;
							const frac = taperFraction(clock.taper, pos);
							const r =
								clock.ohmsAtControlMin +
								frac * (clock.ohmsAtControlMax - clock.ohmsAtControlMin);
							initialDelaySeconds =
								clock.offsetSeconds +
								clock.stages * clock.formulaConstant * r * clock.farads;
						}
						// Headroom for the `modulation` port, mirroring the macro
						// branch: it lengthens as well as shortens the delay. The
						// `clock-law` port sweeps an absolute law over a similar
						// span, so it shares the bound: what makes the ring
						// buffer's size decidable is the declared base times two.
						if (
							(block.modulation !== undefined &&
								block.modulation !== null) ||
							(block.clockLaw !== undefined && block.clockLaw !== null)
						) {
							maxDelaySeconds *= MODULATION_SCALE_MAX;
						}
						const capacity = Math.max(
							2,
							Math.ceil(maxDelaySeconds * sampleRate) + 2,
						);
						const initialSamples = Math.max(
							0,
							initialDelaySeconds * sampleRate,
						);
						const bufferCapacity = reversedLines.has(lineId) ? 2 * capacity : capacity;
						lines.set(lineId, {
							buffer: new Array(bufferCapacity).fill(0),
							writeIndex: 0,
							capacity: bufferCapacity,
							lengthCapacity: capacity,
							reversePhase: 0,
							hold: { state: 0, length: 0, index: 0, gateWas: false },
							floorSamples: Math.max(0, line.minSeconds * sampleRate),
							targetLengthSamples: initialSamples,
							currentLengthSamples: initialSamples,
						});
					}
					this.composedLineState.set(composedStateKey(block.id, positionIndex), lines);
					const combs: { buffer: Float64Array; index: number; gain: number }[] =
						[];
					const allpasses: { buffer: Float64Array; index: number }[] = [];
					for (const op of program.ops) {
						if (op.op === "comb") {
							if (op.index < 0 || op.index >= REVERB_COMB_SECONDS.length) {
								throw new RuntimeError(
									`composed block "${block.id}" names comb ${op.index} outside the interpreter's table`,
								);
							}
							const seconds = REVERB_COMB_SECONDS[op.index] as number;
							if (seconds === undefined) {
								throw new RuntimeError(
									`composed block "${block.id}" names comb ${op.index} outside the interpreter's table`,
								);
							}
							const n = Math.max(1, Math.round(seconds * sampleRate));
							combs.push({
								buffer: new Float64Array(n),
								index: 0,
								gain: reverbCombGain(seconds, op.decaySeconds),
							});
						} else if (op.op === "allpass") {
							if (op.index < 0 || op.index >= REVERB_ALLPASS_SECONDS.length) {
								throw new RuntimeError(
									`composed block "${block.id}" names allpass ${op.index} outside the interpreter's table`,
								);
							}
							const seconds = REVERB_ALLPASS_SECONDS[op.index] as number;
							if (seconds === undefined) {
								throw new RuntimeError(
									`composed block "${block.id}" names allpass ${op.index} outside the interpreter's table`,
								);
							}
							const n = Math.max(1, Math.round(seconds * sampleRate));
							allpasses.push({ buffer: new Float64Array(n), index: 0 });
						}
					}
					this.composedFilterState.set(composedStateKey(block.id, positionIndex), { combs, allpasses });
					const pitch = new Map<
						number,
						{ buffer: number[]; writeAbs: number; readAbs: number; ratio: number }
					>();
					program.ops.forEach((op, position) => {
						if (op.op !== "pitch-shift") {
							return;
						}
						if (!Number.isFinite(op.ratio) || op.ratio <= 0) {
							throw new RuntimeError(
								`composed block "${block.id}" carries a pitch-shift ratio that is not finite and positive: ${String(op.ratio)}`,
							);
						}
						pitch.set(position, {
							buffer: new Array<number>(PITCH_HISTORY).fill(0),
							writeAbs: 0,
							readAbs: 0,
							ratio: op.ratio,
						});
					});
					this.composedPitchState.set(composedStateKey(block.id, positionIndex), pitch);
					const trackers = new Map<
						number,
						{
							buffer: number[];
							writeAbs: number;
							sinceUpdate: number;
							estimate: number;
						}
					>();
					program.ops.forEach((op, position) => {
						if (op.op !== "pitch-tracker") {
							return;
						}
						trackers.set(position, {
							buffer: new Array<number>(TRACK_WINDOW).fill(0),
							writeAbs: 0,
							sinceUpdate: TRACK_HOP,
							estimate: 0,
						});
					});
					this.composedTrackerState.set(composedStateKey(block.id, positionIndex), trackers);
				}
				// DC state is per block rather than per position: it estimates the offset of the
				// block's own input tap, which every position shares because they share the pin.
				this.composedDcState.set(block.id, {
					dcEstimate: 0,
					dcOperatingPoint: 0,
					modDcEstimate: 0,
					modSeeded: false,
				});
				this.macroOutputVolts.set(block.id, 0);
				continue;
			}
			this.capacitorState.set(block.id, new Array(block.stateCount).fill(0));
			this.nodeVoltages.set(
				block.id,
				new Array(block.nodeCount + block.auxCount).fill(0),
			);
			// Sized once per block here rather than once per Newton iteration; `iterate` zeroes
			// these in place instead of replacing them. See `iterationScratch`'s own comment.
			const size = block.nodeCount + block.auxCount;
			this.planSparseSchedule(block, size);
			// **The dense clear was the dominant cost, not the elimination.** `zeros(size)` is
			// n x n and every row was `fill(0)`ed per solve: on `moogerfooger-mf-102` that is
			// 12,544 writes against 869 elimination ops -- 14.4x more work clearing than solving.
			// Measured across 142 packets, wall-clock scales as `unknowns^1.60`, which sits
			// between the n^1 elimination and this n^2 clear, and `state bytes` predicts cost
			// better than block count, stamps or unknowns because bytes go as n^2.
			//
			// So clear only what the sparse path touches: `gatherRow`/`gatherColumn` are the
			// matrix positions the schedule reads, and the diagonal is added because a stamp may
			// write it. **Exactly equivalent arithmetic, so bit-identical** -- this is not a
			// reordering and takes no parity carve-out.
			//
			// `null` when the block has no schedule: the dense path touches entries outside this
			// set, so it keeps the full clear. That distinction is the correctness gate -- nine
			// corpus packets fall back, and they are the ones a pattern-only clear would corrupt.
			const sched = block.sparseSchedule;
			let clearPairs: Int32Array | null = null;
			if (sched !== null) {
				const seen = new Set<number>();
				const gr = sched.gatherRow;
				const gc = sched.gatherColumn;
				for (let i = 0; i < gr.length; i += 1) {
					seen.add((gr[i] as number) * size + (gc[i] as number));
				}
				for (let d = 0; d < size; d += 1) seen.add(d * size + d);
				const pairs = new Int32Array(seen.size * 2);
				let w = 0;
				for (const key of seen) {
					pairs[w] = Math.floor(key / size);
					pairs[w + 1] = key % size;
					w += 2;
				}
				clearPairs = pairs;
			}
			this.iterationScratch.set(block.id, {
				matrix: zeros(size),
				rhs: new Array<number>(size).fill(0),
				solutionA: new Array<number>(size).fill(0),
				solutionB: new Array<number>(size).fill(0),
				clearPairs,
				denseDirty: false,
			});

			if (!block.stampPartition) {
				throw new RuntimeError(
					`block "${block.id}" is missing required stampPartition`,
				);
			}

		this.rebuildBaseMatrix(block);

		if (block.eliminate || this.eliminateBlocks.has(block.id)) {
				if (!block.stampPartition) {
					throw new RuntimeError(
						`block "${block.id}" is missing required stampPartition`,
					);
				}
				const ports = block.stampPartition.portRows;
				const portIndexOfMap = new Map<number, number>(
					ports.map((row, index) => [row, index]),
				);
				const lRows = Array.from({ length: size }, (_, row) => row).filter(
					(row) => !portIndexOfMap.has(row),
				);
				const portIndexOf = new Int32Array(size).fill(-1);
				for (const [row, index] of portIndexOfMap) {
					portIndexOf[row] = index;
				}
				const lIndexOf = new Int32Array(size).fill(-1);
				for (const [index, row] of lRows.entries()) {
					lIndexOf[row] = index;
				}
				const linearStamps = block.stampPartition.linearStampIndices.map(
					(i) => block.stamps[i] as Stamp,
				);
				const nonlinearStamps = block.stampPartition.nonlinearStampIndices.map(
					(i) => block.stamps[i] as Stamp,
				);
				this.eliminationPorts.set(block.id, {
					ports,
					portIndexOf,
					lRows,
					lIndexOf,
					size,
					linearStamps,
					nonlinearStamps,
				});
				const portCount = ports.length;
				const lCount = lRows.length;
				this.eliminationScratch.set(block.id, {
					linear: zeros(size),
					linearRhs: new Array<number>(size).fill(0),
					ll: zeros(lCount),
					permutation: new Array<number>(lCount).fill(0),
					// Never equal to a real `controlGeneration` (which starts at 0 and only
					// increases), so the first sample always builds fresh.
					cachedGeneration: -1,
					z: Array.from({ length: portCount }, () =>
						new Array<number>(lCount).fill(0),
					),
					zRhsScratch: new Array<number>(lCount).fill(0),
					kReduced: zeros(portCount),
					z0: new Array<number>(lCount).fill(0),
					z0Rhs: new Array<number>(lCount).fill(0),
					uReduced: new Array<number>(portCount).fill(0),
					// Full size, not `portCount` rows -- `applyStamp` is called on this with
					// unmodified global indices, exactly as `iterate` calls it, so a nonlinear
					// stamp needs nowhere else to write. Only the port rows are ever nonzero
					// (that is `computeNewtonPortRows`'s whole guarantee) or ever read back.
					rawNl: zeros(size),
					rawNlRhs: new Array<number>(size).fill(0),
					reducedJacobian: zeros(portCount),
					reducedRhs: new Array<number>(portCount).fill(0),
					yCurrent: new Array<number>(portCount).fill(0),
					yNext: new Array<number>(portCount).fill(0),
					fullCurrent: new Array<number>(size).fill(0),
					fullNext: new Array<number>(size).fill(0),
				});
			}
		}
		this.operatingPointFailures = 0;
		this.springState.clear();
		this.springOutputVolts.clear();
		this.operatingPointSupplyAmps = 0;
		this.renderedSupplyPeakAmps = 0;
		this.supplyBranchSlots = this.program.blocks.flatMap((block) =>
			block.kind !== "mna"
				? []
				: block.stamps.flatMap((stamp) =>
						stamp.kind === "dc-source" || stamp.kind === "ac-source"
							? [
									{
										blockId: block.id,
										slot: block.nodeCount + stamp.sourceIndex,
									},
								]
							: [],
					),
		);
		this.operatingPointPending = true;
	}

	/** Read after processing. Non-zero failure counts mean the audio is not trustworthy. */
	telemetry(): RuntimeTelemetry {
		return {
			samples: this.samples,
			nonConvergedSamples: this.nonConvergedSamples,
			stalledSamples: this.stalledSamples,
			solvedButFlaggedSamples: this.solvedButFlaggedSamples,
			blockNewtonCensus: [...this.blockNewtonCensus.entries()]
				.map(([blockId, v]) => ({ blockId, ...v }))
				.sort((a, b) => b.exhausted - a.exhausted),
			nonFiniteSamples: this.nonFiniteSamples,
			peakIterations: this.peakIterations,
			totalIterations: this.totalIterations,
			lastFailure: this.lastFailure,
			operatingPointFailures: this.operatingPointFailures,
			operatingPointSupplyAmps: this.operatingPointSupplyAmps,
			// Unmeasured until a sample has been rendered, and said so rather than shown as zero.
			renderedSupplyPeakAmps:
				this.samples === 0 ? null : this.renderedSupplyPeakAmps,
		};
	}

	/** Read-only solved MNA node voltages for diagnostics after prepare/process. */
	nodeVoltageSnapshot(): readonly RuntimeNodeVoltageSnapshot[] {
		if (this.sampleRate === null) {
			throw new RuntimeError("prepare(sampleRate) was never called");
		}
		return this.program.blocks.flatMap((block) => {
			if (block.kind !== "mna") return [];
			const voltages = this.nodeVoltages.get(block.id) ?? [];
			return [
				{
					blockId: block.id,
					nodeCount: block.nodeCount,
					outputNode: block.outputNode,
					voltages: voltages.slice(0, block.nodeCount),
					nodeIds: block.nodeIds,
				},
			];
		});
	}

	/**
	 * Read-only solved branch currents after prepare/process. See `RuntimeBranchCurrent` for
	 * the sign convention.
	 *
	 * Ordered by block, then by the stamp order within it, so a caller pairing these against
	 * `program.blocks[].stamps` sees the same sequence.
	 */
	branchCurrentSnapshot(): readonly RuntimeBranchCurrent[] {
		if (this.sampleRate === null) {
			throw new RuntimeError("prepare(sampleRate) was never called");
		}
		return this.program.blocks.flatMap((block) => {
			if (block.kind !== "mna") {
				return [];
			}
			const solution = this.nodeVoltages.get(block.id) ?? [];
			return block.stamps.flatMap((stamp) => {
				if (
					stamp.kind !== "dc-source" &&
					stamp.kind !== "ac-source" &&
					stamp.kind !== "input-source" &&
					stamp.kind !== "ideal-opamp" &&
					stamp.kind !== "transformer"
				) {
					return [];
				}
				return [
					{
						blockId: block.id,
						kind: stamp.kind,
						sourceIndex: stamp.sourceIndex,
						amps: solution[block.nodeCount + stamp.sourceIndex] ?? 0,
					},
				];
			});
		});
	}

	/**
	 * Get the physical, causal brightness of any LED or indicator in the circuit.
	 *
	 * Brightness is a normalized value between 0.0 (completely dark) and 1.0 (fully glowing),
	 * calculated in real-time from the physical forward current flowing through the LED diode junction.
	 */
	getLedBrightness(deviceId: string): number {
		// Find the block and stamp that correspond to this LED device ID
		for (const block of this.program.blocks) {
			if (block.kind !== "mna") {
				continue;
			}
			const solution = this.nodeVoltages.get(block.id);
			if (solution === undefined) {
				continue;
			}
			// Find the diode stamp associated with this LED device
			const stamp = block.stamps.find(
				(s) => s.kind === "diode" && s.device === deviceId && s.isLed === true,
			);
			if (stamp === undefined || stamp.kind !== "diode") {
				continue;
			}
			// Read the solved node voltages
			const anodeVolts = solution[stamp.anode] ?? 0.0;
			const cathodeVolts = solution[stamp.cathode] ?? 0.0;
			const across = anodeVolts - cathodeVolts;

			// Calculate Ebers-Moll LED current
			// Iled = Is * (e^(V_across / (N * Vt)) - 1)
			const is = stamp.saturationCurrent;
			const vt = stamp.emissionCoefficient * stamp.thermalVoltage;
			// Deliberately NOT the solver's `JUNCTION_EXPONENT_LIMIT`, which is 60. This is an
			// overflow guard on a brightness readout that is normalised and clamped to 0..1 a few
			// lines below, not a term in the matrix, so it does not have to agree with the
			// solver's truncation point -- and it is named apart so that it cannot be read as
			// having drifted from it. (The comment here used to claim they were the same.)
			const LED_BRIGHTNESS_EXPONENT_LIMIT = 80;
			const exponent = Math.min(across / vt, LED_BRIGHTNESS_EXPONENT_LIMIT);
			const ledCurrent = exponent > 0 ? is * (Math.exp(exponent) - 1.0) : 0.0;

			// Normalize brightness relative to nominal 10mA target current
			const nominalCurrent = 10e-3; // 10 mA
			return Math.max(0.0, Math.min(ledCurrent / nominalCurrent, 1.0));
		}
		return 0.0;
	}

	setControl(id: ControlId, position: number): void {
		if (!this.program.controls.some((control) => control.id === id)) {
			throw new RuntimeError(`program has no control "${id}"`);
		}
		if (!Number.isFinite(position) || position < 0 || position > 1) {
			throw new RuntimeError(`control position ${position} is outside 0..1`);
		}
		const was = this.positions.get(id) ?? 0;
		this.positions.set(id, position);
		if (
			this.controlsById.get(id)?.momentary === true &&
			was < 0.5 &&
			position >= 0.5 &&
			this.sampleRate !== null
		) {
			const now = this.elapsedSamples;
			const tap = this.tapState.get(id) ?? {
				lastPressSample: null,
				intervalSeconds: null,
				runStartSample: null,
				runCount: 0,
			};
			const law = this.controlsById.get(id)?.tap;
			if (law === undefined) {
				if (tap.lastPressSample !== null && now > tap.lastPressSample) {
					tap.intervalSeconds = (now - tap.lastPressSample) / this.sampleRate;
				}
			} else {
				// A run of presses each within the timeout; once it is long enough, the tempo is its
				// mean interval, updated by every further press. A longer gap starts a new run and
				// leaves the tempo where it was.
				const inRun =
					tap.lastPressSample !== null &&
					tap.runStartSample !== null &&
					(now - tap.lastPressSample) / this.sampleRate <= law.timeoutSeconds;
				if (inRun) {
					tap.runCount += 1;
				} else {
					tap.runStartSample = now;
					tap.runCount = 1;
				}
				if (tap.runCount >= law.presses && tap.runStartSample !== null && now > tap.runStartSample) {
					tap.intervalSeconds = (now - tap.runStartSample) / (tap.runCount - 1) / this.sampleRate;
				}
			}
			tap.lastPressSample = now;
			this.tapState.set(id, tap);
		}
		// A press of a latch's toggle flips it, before anything reads the new state this sample.
		if (was < 0.5 && position >= 0.5) {
			for (const control of this.program.controls) {
				if (control.latch?.toggledBy !== id) continue;
				this.setControl(control.id, (this.positions.get(control.id) ?? control.defaultPosition) >= 0.5 ? 0 : 1);
			}
		}
		for (const block of this.program.blocks) {
			if (
				block.kind === "composed" &&
				block.clockControl &&
				block.clockControl.controlId === id
			) {
				const cc = block.clockControl;
				const frac = taperFraction(cc.taper, position);
				const r =
					cc.ohmsAtControlMin +
					frac * (cc.ohmsAtControlMax - cc.ohmsAtControlMin);
				const delaySec =
					cc.offsetSeconds + cc.stages * cc.formulaConstant * r * cc.farads;
				{
					// **Every position, not just the running one.** A knob moved while the
					// pedal sits in DELAY 1 must still have moved DELAY 2's line, or the
					// first sample after a mode change plays a length the knob left behind.
					if (this.sampleRate !== null) {
						for (const positionIndex of block.positions.keys()) {
							const lines = this.composedLineState.get(
								composedStateKey(block.id, positionIndex),
							);
							if (lines === undefined) continue;
							for (const line of lines.values()) {
								line.targetLengthSamples = Math.max(0, delaySec * this.sampleRate);
							}
						}
					}
				}
			}
		}
		// Build-order step 6: invalidates every block's cached elimination factorisation
		// (`eliminationScratch`'s `cachedGeneration` check in `iterateEliminated`). Global
		// rather than per-control-per-block: this program has one `mna` block using
		// elimination today, and a global counter can only ever cause an unnecessary rebuild,
		// never a stale reuse -- the direction `bake.ts`'s own `load-shift` finding says to
		// err in. `linear-core-state-space-gate`'s measured lesson applies here without
		// qualification: a factorisation derived at one control position and evaluated at
		// another erred 80% of the signal, because a pot sits *inside* the matrix a
		// factorisation is derived from -- so this counter exists specifically to make that
		// mistake impossible rather than merely unlikely.
		this.controlGeneration += 1;
	}

	/**
	 * Block base-matrix rebuilds performed by `setSupply` so far. Read-only:
	 * re-applying the values a stamp already has rebuilds nothing and leaves this
	 * unchanged.
	 */
	get supplyRebuilds(): number {
		return this.supplyRebuildCount;
	}

	/**
	 * Every addressable `dc-source` stamp in `program.blocks` order, then stamp
	 * order within each block. `blockIndex` is the index into `program.blocks`;
	 * pass `infos.map((info) => info.address)` straight to `setSupply`.
	 */
	getSupplies(): readonly SupplyInfo[] {
		const infos: SupplyInfo[] = [];
		for (const [blockIndex, block] of this.program.blocks.entries()) {
			if (block.kind !== "mna") {
				continue;
			}
			for (const stamp of block.stamps) {
				if (stamp.kind !== "dc-source") {
					continue;
				}
				infos.push({
					address: { blockIndex, sourceIndex: stamp.sourceIndex },
					positive: stamp.positive,
					negative: stamp.negative,
					volts: stamp.volts,
					sourceOhms: stamp.sourceOhms,
				});
			}
		}
		return infos;
	}

	/**
	 * Retarget one or more supply stamps between `process()` calls: every named
	 * `dc-source` stamp solves `V(positive) - V(negative) - sourceOhms * i =
	 * volts` with the new values from the next sample on.
	 *
	 * Call between `process()` calls, never concurrently with one -- the same
	 * contract as `setControl`. Effect starts at the next sample: the affected
	 * blocks' cached base matrices are rebuilt exactly the way `prepare()`
	 * builds them, and `controlGeneration` is bumped so the eliminated-path
	 * factorisation, Z, and K_reduced rebuild on next use. The sparse schedule is
	 * untouched: its pattern is value-independent.
	 *
	 * Reactive state (capacitor and op-amp pole memory) carries over, which is
	 * the physically honest response to hot-swapping a battery, and the DC
	 * operating point is deliberately NOT re-solved -- same transient-following
	 * rule as `setControl`'s `operatingPointPending` comment.
	 *
	 * Validation mirrors `setControl` and is atomic: `volts` must be finite,
	 * `sourceOhms` must be finite and non-negative (a negative resistance is
	 * gain, not sag), and every address must name an existing `dc-source` stamp
	 * (unknown block index, non-MNA block, or a `sourceIndex` with no
	 * `dc-source` all throw `RuntimeError`). All addresses are validated before
	 * any state is touched, so a bad address leaves even the valid ones in the
	 * same call unchanged. An empty address list changes nothing, and a call
	 * whose values already match the stamps rebuilds nothing (`supplyRebuilds`
	 * unchanged).
	 *
	 * Never mutates the caller's `Program`: the touched stamp objects are
	 * replaced on this runtime's own copies (copy on write), so two runtimes
	 * built from one program, or a frozen program, never interact.
	 *
	 * NOTE (cross-repo, gated by the extraction plan): the C++ console needs the
	 * same setter -- update its loaded program's supply fields and re-derive
	 * whatever it caches from them, with parity rows in the workbench harness.
	 * This method changes no `Program` or `Stamp` shape, so it triggers no
	 * format bump.
	 */
	setSupply(
		addresses: readonly SupplyAddress[],
		volts: number,
		sourceOhms: number,
	): void {
		if (!Number.isFinite(volts)) {
			throw new RuntimeError(`supply volts ${String(volts)} is not finite`);
		}
		if (!Number.isFinite(sourceOhms) || sourceOhms < 0) {
			throw new RuntimeError(
				`supply sourceOhms ${String(sourceOhms)} is not a finite non-negative resistance`,
			);
		}
		type Target = {
			block: Extract<Block, { kind: "mna" }>;
			stampIndex: number;
			stamp: Extract<Stamp, { kind: "dc-source" }>;
		};
		const targets: Target[] = [];
		for (const address of addresses) {
			const block =
				Number.isInteger(address.blockIndex) &&
				address.blockIndex >= 0 &&
				address.blockIndex < this.program.blocks.length
					? (this.program.blocks[address.blockIndex] as Block)
					: undefined;
			if (block === undefined) {
				throw new RuntimeError(
					`setSupply: unknown block index ${String(address.blockIndex)}`,
				);
			}
			if (block.kind !== "mna") {
				throw new RuntimeError(
					`setSupply: block index ${address.blockIndex} ("${block.id}") is not an MNA block`,
				);
			}
			let matched = false;
			for (const [stampIndex, stamp] of block.stamps.entries()) {
				if (
					stamp.kind === "dc-source" &&
					stamp.sourceIndex === address.sourceIndex
				) {
					targets.push({ block, stampIndex, stamp });
					matched = true;
				}
			}
			if (!matched) {
				throw new RuntimeError(
					`setSupply: block index ${address.blockIndex} ("${block.id}") has no dc-source with sourceIndex ${String(address.sourceIndex)}`,
				);
			}
		}
		if (targets.length === 0) {
			return;
		}
		// Group by block, dropping stamps that already carry the values (and
		// deduplicating an address listed twice): only a real change rebuilds.
		const byBlock = new Map<string, { block: Target["block"]; indices: number[] }>();
		const seenStamps = new Set<string>();
		for (const target of targets) {
			const key = `${target.block.id}:${target.stampIndex}`;
			if (seenStamps.has(key)) {
				continue;
			}
			seenStamps.add(key);
			if (
				target.stamp.volts === volts &&
				target.stamp.sourceOhms === sourceOhms
			) {
				continue;
			}
			let entry = byBlock.get(target.block.id);
			if (entry === undefined) {
				entry = { block: target.block, indices: [] };
				byBlock.set(target.block.id, entry);
			}
			entry.indices.push(target.stampIndex);
		}
		if (byBlock.size === 0) {
			return;
		}
		let rebuilt = 0;
		for (const { block, indices } of byBlock.values()) {
			// Copy on write: replace the stamp objects on this runtime's own stamps
			// array -- the caller's program keeps its objects.
			const stamps = block.stamps as Stamp[];
			const replaced = new Map<Stamp, Stamp>();
			for (const stampIndex of indices) {
				const oldStamp = stamps[stampIndex] as Extract<
					Stamp,
					{ kind: "dc-source" }
				>;
				const newStamp = { ...oldStamp, volts, sourceOhms };
				stamps[stampIndex] = newStamp;
				replaced.set(oldStamp, newStamp);
			}
			if (this.sampleRate !== null) {
				this.rebuildBaseMatrix(block);
				// The eliminated path holds stamp object references, not indices --
				// refresh them to the replacements. Port rows are structural and
				// unchanged.
				const ports = this.eliminationPorts.get(block.id);
				if (ports !== undefined) {
					this.eliminationPorts.set(block.id, {
						...ports,
						linearStamps: ports.linearStamps.map(
							(stamp) => replaced.get(stamp) ?? stamp,
						),
						nonlinearStamps: ports.nonlinearStamps.map(
							(stamp) => replaced.get(stamp) ?? stamp,
						),
					});
				}
				this.supplyRebuildCount += 1;
				rebuilt += 1;
			}
		}
		// Invalidate the eliminated-path factorisation cache only when a rebuild
		// happened: a stale reuse is a stale rail that looks fine, and a spare bump
		// would rebuild a cache that is still valid.
		if (rebuilt > 0) {
			this.controlGeneration += 1;
		}
	}

	/**
	 * Fold one block's constant stamps into its cached base matrix and RHS, with
	 * the standard GMIN and ground-row pinning. This is the `prepare()` build,
	 * factored so `setSupply` rebuilds exactly what `prepare()` built.
	 */
	private rebuildBaseMatrix(block: Extract<Block, { kind: "mna" }>): void {
		if (!block.stampPartition) {
			throw new RuntimeError(
				`block "${block.id}" is missing required stampPartition`,
			);
		}
		const constantIndices = new Set(block.stampPartition.constantStampIndices);
		const constantStamps = block.stampPartition.constantStampIndices.map(
			(i) => block.stamps[i] as Stamp,
		);
		const nonConstantStamps = block.stamps.filter(
			(_, i) => !constantIndices.has(i),
		);
		const nonConstantLinearStamps = block.stampPartition.linearStampIndices
			.filter((i) => !constantIndices.has(i))
			.map((i) => block.stamps[i] as Stamp);

		const size = block.nodeCount + block.auxCount;
		const baseMatrix = zeros(size);
		const baseRhs = new Array<number>(size).fill(0);
		const blockIndex = this.blockIndexById.get(block.id) ?? 0;
		const dt = 1 / (this.sampleRate as number);
		for (const stamp of constantStamps) {
			this.applyStamp(
				stamp,
				baseMatrix,
				baseRhs,
				block,
				dt,
				EMPTY_STATE,
				EMPTY_SOLUTION,
				0,
				false,
				1,
				blockIndex,
			);
		}
		for (let node = 1; node < block.nodeCount; node += 1) {
			(baseMatrix[node] as number[])[node] += GMIN_SIEMENS;
		}
		for (let col = 0; col < size; col += 1) {
			(baseMatrix[0] as number[])[col] = 0;
		}
		(baseMatrix[0] as number[])[0] = 1;
		baseRhs[0] = 0;

		this.baseMatrices.set(block.id, {
			matrix: baseMatrix,
			rhs: baseRhs,
			nonConstantStamps,
			nonConstantLinearStamps,
		});
	}

	/**
	 * Decide, once per block, whether its static elimination schedule is worth replaying.
	 *
	 * The rule is a **cost ratio computed from the block's own pattern**, not a size cutoff.
	 * Two reasons, both measured. Dense cost is not a function of `size` alone -- `solve`
	 * skips a zero multiplier, so two 28-unknown blocks in this corpus differ by 4x in dense
	 * wall clock -- and node counts are about to shrink when the compiler stops sizing a block
	 * by its largest authored node *label*, which would silently move any absolute threshold.
	 * A ratio re-derives itself correctly on both counts.
	 *
	 * The floor is set where the measured wall-clock win stops being worth the branch: at a
	 * predicted saving of 4x the smallest corpus block that clears it measured 2.9x real, and
	 * the one that does not clear it measured 2.0x on a 4-unknown block that costs nothing
	 * either way.
	 */
	private planSparseSchedule(
		block: Extract<Block, { kind: "mna" }>,
		size: number,
	): void {
		const schedule = block.sparseSchedule;
		if (schedule === null) {
			this.solverPlanRows.push({
				blockId: block.id,
				size,
				patternEntries: 0,
				fillIn: 0,
				sparseOps: 0,
				denseOps: (size * size * size - size) / 3,
				unprovenPivots: 0,
				path: "dense",
				reason: "no elimination order covers the pattern",
			pivotViolations: 0,
			worstPivotRatio: null,
			pivotDisagreement: null,
			repivoted: false,
		});
		return;
	}
		// The gather and the right-hand side copy are per-solve costs the dense path does not
		// pay, so they belong in the comparison rather than beside it.
		const cost = schedule.sparseOps + schedule.slots + size;
		const saving = schedule.denseOps / Math.max(cost, 1);
		const row = {
			blockId: block.id,
			size,
			patternEntries: schedule.slots,
			fillIn: 0,
			sparseOps: schedule.sparseOps,
			denseOps: schedule.denseOps,
			unprovenPivots: schedule.unprovenPivots,
			path:
				saving >= SCHEDULE_MINIMUM_SAVING
					? ("sparse" as const)
					: ("dense" as const),
			reason:
				saving >= SCHEDULE_MINIMUM_SAVING
					? `predicted ${saving.toFixed(1)}x`
					: `predicted ${saving.toFixed(1)}x, below the ${SCHEDULE_MINIMUM_SAVING}x floor`,
		pivotViolations: 0,
		worstPivotRatio: null as number | null,
		pivotDisagreement: null as number | null,
		repivoted: false,
	};
	this.solverPlanRows.push(row);
		if (row.path === "dense") {
			return;
		}
		this.sparseSchedules.set(block.id, {
			schedule,
			values: new Float64Array(schedule.slots),
			rhs: new Float64Array(size),
			factors: new Float64Array(schedule.factorCount),
			consecutiveFallbacks: 0,
			repivotAttempted: false,
		});
	}

	/**
	 * Assemble one block's audio-structure Jacobian at the solved operating
	 * point, for validating the shipped elimination order before the first
	 * audio sample replays it.
	 *
	 * This mirrors `iterate`'s standard audio pass exactly -- base-matrix copy,
	 * non-constant stamps at the operating-point voltages with zero input,
	 * ground-row overwrite -- so the matrix is what the first Newton iteration
	 * would stamp. `applyStamp` also advances limiter histories, divider state
	 * and clock/bucket state, which belong to the audio run, not to this probe:
	 * every mutable stamp state it touches is snapshotted and restored, and
	 * the state vector itself is passed as a copy, never live. A unit test
	 * pins that the audio is bit-identical with and without this call.
	 */
	private assembleAudioMatrix(
		block: Extract<Block, { kind: "mna" }>,
	): { readonly matrix: number[][]; readonly rhs: number[] } {
		const size = block.nodeCount + block.auxCount;
		const base = this.baseMatrices.get(block.id);
		if (base === undefined) {
			throw new RuntimeError(
				`no base matrix for block "${block.id}" -- prepare() was not called`,
			);
		}
		const savedLimitedIterate = this.limitedIterate;
		const savedLimitedBy = this.limitedBy;
		const savedDiode = new Map(this.diodeHistory);
		const savedBjt = new Map(this.bjtHistory);
		const savedTriode = new Map(this.triodeHistory);
		const savedFet = new Map(this.fetHistory);
		const savedShifted = new Map(this.lastShiftedSample);
		try {
			const matrix = base.matrix.map((row) => [...row]);
			const rhs = [...base.rhs];
			const dt = 1 / (this.sampleRate as number);
			// A copy, for the same reason the histories below are snapshotted:
			// divider, clock-driver and bucket-brigade stamps advance `state`
			// on every call, and this probe must not toggle a flip-flop.
			const state = [...(this.capacitorState.get(block.id) ?? [])];
			const current = this.nodeVoltages.get(block.id) ?? [];
			const blockIndex = this.blockIndexById.get(block.id) ?? 0;
			for (const stamp of base.nonConstantStamps) {
				this.applyStamp(
					stamp,
					matrix,
					rhs,
					block,
					dt,
					state,
					current,
					0,
					false,
					1,
					blockIndex,
				);
			}
			for (let column = 0; column < size; column += 1) {
				(matrix[0] as number[])[column] = 0;
			}
			(matrix[0] as number[])[0] = 1;
			rhs[0] = 0;
			return { matrix, rhs };
		} finally {
			this.limitedIterate = savedLimitedIterate;
			this.limitedBy = savedLimitedBy;
			this.diodeHistory.clear();
			for (const [key, value] of savedDiode) {
				this.diodeHistory.set(key, value);
			}
			this.bjtHistory.clear();
			for (const [key, value] of savedBjt) {
				this.bjtHistory.set(key, value);
			}
			this.triodeHistory.clear();
			for (const [key, value] of savedTriode) {
				this.triodeHistory.set(key, value);
			}
			this.fetHistory.clear();
			for (const [key, value] of savedFet) {
				this.fetHistory.set(key, value);
			}
			this.lastShiftedSample.clear();
			for (const [key, value] of savedShifted) {
				this.lastShiftedSample.set(key, value);
			}
		}
	}

	/**
	 * Validate every admitted block's shipped elimination order against the
	 * assembled operating-point matrix, once, before the first audio sample.
	 *
	 * The order was chosen from the stamp pattern alone, where every node
	 * diagonal reads as a pivot candidate because the runtime adds `gmin` to
	 * it. A pivot of `1e-12` against entries of order `1e2` is a growth factor
	 * of `1e14` that dense partial pivoting would never choose, and replaying
	 * it is what makes the sparse and dense solves disagree on the row-6
	 * packets (`boss-aw-2` never converges sparsely and converges in four
	 * iterations densely).
	 *
 * The gate is a comparison, not a pivot theory: both solves run on the
 * same assembled matrix and their answers are compared. Per-pivot ratios
 * do not separate healthy blocks from broken ones -- healthy `boss-ce-5`
 * carries 18 pivots below any absolute-scaled threshold and still matches
 * dense to `1e-10`, because a tiny pivot is harmless late in the order
 * and fatal early -- so the ratios stay on as diagnostics while the
 * disagreement drops the block. A dropped block renders exactly what the
 * forced-dense control renders; correctness first, and the cost of the
 * dense path belongs to phase 2.
 *
 * The tolerance sits in a measured canyon: the largest disagreement among
 * kept corpus blocks is `boss-tw-1` at `7.1e-5` (whose sparse audio agrees
 * with dense to `1e-9` and converges 100% -- dropping it would regress its
 * 0.83x budget fix to ~850x, so the gate must NOT fire there), while the
 * smallest dropped disagreement is `boss-aw-2` at `9.8e+3`. Dense is not
 * assumed right -- `tw-1` diverges on 61 samples densely while converging
 * sparsely -- the gate only fires where the replay demonstrably collapses.
 *
 * A validating shipped order is still replaced when the value-aware candidate
 * reaches the audio-agreement bar (1e-9) an order of magnitude more cleanly
 * without meaningful fill cost -- the refinement in `SCHEDULE_REFINEMENT_BAR`.
 * Bar-clean ties keep shipped even when the audios differ: the
 * operating-point replay cannot adjudicate audio-time divergence (`boss-os-2`
 * replays 3.4e-10 shipped vs 2.5e-13 candidate while the audios differ 1000x),
 * so the rule only moves past the bar it can measure, never on a tie.
 * Measured adopters: `boss-sd-1` (1.8e-9 to 4.2e-13, audio 6.9e-8 to
 * 6.5e-12).
 */
	private settlePivotOrders(): void {
		if (this.pivotOrdersSettled) {
			return;
		}
		this.pivotOrdersSettled = true;
		for (const [blockId, entry] of this.sparseSchedules) {
			const block = this.blocksById.get(blockId);
			if (
				block === undefined ||
				block.kind !== "mna" ||
				block.eliminate ||
				this.eliminateBlocks.has(block.id)
			) {
				continue;
			}
			const size = block.nodeCount + block.auxCount;
			const { matrix, rhs } = this.assembleAudioMatrix(block);
			const schedule = entry.schedule;
			const pivots: { row: number; column: number }[] = [];
			for (let at = 0; at < schedule.ops.length; at += SCHEDULE_OP_WIDTH) {
				if (schedule.ops[at] === 6) {
					const slot = schedule.ops[at + 1] as number;
					pivots.push({
						row: schedule.gatherRow[slot] as number,
						column: schedule.gatherColumn[slot] as number,
					});
				}
			}
			const columnMax = new Array<number>(size).fill(0);
			for (
				let slot = 0;
				slot < schedule.gatherRow.length;
				slot += 1
			) {
				const row = schedule.gatherRow[slot] as number;
				const column = schedule.gatherColumn[slot] as number;
				const value = Math.abs(matrix[row]?.[column] ?? 0);
				if (value > (columnMax[column] as number)) {
					columnMax[column] = value;
				}
			}
			const working = matrix.map((row) => [...row]);
			let violations = 0;
			let worstRatio = Infinity;
			for (const pivot of pivots) {
				const max = columnMax[pivot.column] ?? 0;
				const value = Math.abs(
					working[pivot.row]?.[pivot.column] ?? 0,
				);
				const ratio = max > 0 ? value / max : 0;
				if (ratio < worstRatio) {
					worstRatio = ratio;
				}
				// Diagnostic only: the drop decision comes from the replay
				// comparison below, not from this count.
				if (!(value >= 1e-9 * max) || !(max > 0)) {
					violations += 1;
				}
				if (value === 0) {
					continue;
				}
				for (let row = 0; row < size; row += 1) {
					if (row === pivot.row) {
						continue;
					}
					const target = working[row] as number[];
					const factor = (target[pivot.column] as number) / value;
					if (factor === 0) {
						continue;
					}
					const pivotRow = working[pivot.row] as number[];
					for (let column = 0; column < size; column += 1) {
						target[column] =
							(target[column] as number) -
							factor * (pivotRow[column] as number);
					}
				}
			}
			// Both solves on the same matrix: the replay through a scratch
			// buffer, the dense solve on a copy (it factorises in place).
			const values = new Float64Array(schedule.slots);
			const scratchRhs = new Float64Array(size);
			const factors = new Float64Array(schedule.factorCount);
			const sparseOut = new Array<number>(size).fill(0);
			const replayed = runSparseSchedule(
				schedule,
				matrix,
				rhs,
				values,
				scratchRhs,
				factors,
				sparseOut,
			);
			const denseMatrix = matrix.map((row) => [...row]);
			const denseRhs = [...rhs];
			const denseOut = new Array<number>(size).fill(0);
			solve(denseMatrix, denseRhs, denseOut);
			let diffSquares = 0;
			let denseSquares = 0;
			for (let index = 0; index < size; index += 1) {
				const difference =
					(sparseOut[index] as number) - (denseOut[index] as number);
				diffSquares += difference * difference;
				denseSquares += (denseOut[index] as number) * (denseOut[index] as number);
			}
			const denseNorm = Math.sqrt(denseSquares);
			const disagreement = replayed
				? Math.sqrt(diffSquares) / Math.max(denseNorm, 1e-9)
				: Infinity;
			const planRow = this.solverPlanRows.find(
				(candidate) => candidate.blockId === blockId,
			);
			if (planRow !== undefined) {
				planRow.pivotViolations = violations;
				planRow.worstPivotRatio = worstRatio;
				planRow.pivotDisagreement = Number.isFinite(disagreement)
					? disagreement
					: null;
			}
			// The value-aware order, computed always now rather than only when
			// the shipped order fails: threshold Markowitz over the schedule's
			// own filled pattern, replayed and compared to the same dense
			// solve. A refused candidate (null) or a replay that trips its own
			// guard (Infinity) behaves exactly like a disagreeing one below.
			const candidate = computeNumericRepivot(schedule, size, matrix);
			let candidateDisagreement = Infinity;
			if (candidate !== null) {
				const candidateValues = new Float64Array(candidate.slots);
				const candidateRhs = new Float64Array(size);
				const candidateFactors = new Float64Array(candidate.factorCount);
				const candidateOut = new Array<number>(size).fill(0);
				const candidateReplayed = runSparseSchedule(
					candidate,
					matrix,
					rhs,
					candidateValues,
					candidateRhs,
					candidateFactors,
					candidateOut,
				);
				let candidateDiffSquares = 0;
				let candidateDenseSquares = 0;
				for (let index = 0; index < size; index += 1) {
					const difference =
						(candidateOut[index] as number) - (denseOut[index] as number);
					candidateDiffSquares += difference * difference;
					candidateDenseSquares += (denseOut[index] as number) ** 2;
				}
				candidateDisagreement = candidateReplayed
					? Math.sqrt(candidateDiffSquares) /
						Math.max(Math.sqrt(candidateDenseSquares), 1e-9)
					: Infinity;
			}
			if (disagreement <= SCHEDULE_VALIDATION_TOL) {
				// The shipped order validates. Replace it only on a refinement:
				// the candidate reaches the audio-agreement bar while the
				// shipped order does not, by an order of magnitude, without
				// meaningful fill cost (see `shouldRefinePivotOrder`). Ties
				// keep shipped, so adoption never churns a schedule for noise
				// -- measured, `boss-hm-2`, `boss-ch-1` and `boss-od-3` tie
				// and keep shipped while `boss-sd-1` crosses (1.8e-9 to
				// 4.2e-13, audio 6.9e-8 to 6.5e-12).
				if (
					candidate !== null &&
					shouldRefinePivotOrder({
						shippedDisagreement: disagreement,
						candidateDisagreement,
						shippedOps: schedule.sparseOps,
						shippedSlots: schedule.slots,
						candidateOps: candidate.sparseOps,
						candidateSlots: candidate.slots,
					})
				) {
					this.adoptRepivotedSchedule(
						blockId,
						candidate,
						size,
						planRow,
						`numeric re-pivot ${candidateDisagreement.toExponential(1)} vs dense ` +
							`(shipped ${Number.isFinite(disagreement) ? disagreement.toExponential(1) : "replay refused"}); ` +
							`+${(((candidate.sparseOps / Math.max(schedule.sparseOps, 1)) - 1) * 100).toFixed(1)}% ops`,
						candidateDisagreement,
					);
					continue;
				}
				continue;
			}
			// The shipped order failed on the real matrix. Before giving the
			// schedule up, try the value-aware order computed above: adoption
			// needs the same tolerance the shipped order failed; a refused or
			// still-disagreeing candidate drops as before.
			if (
				candidate !== null &&
				candidateDisagreement <= SCHEDULE_VALIDATION_TOL
			) {
				this.adoptRepivotedSchedule(
					blockId,
					candidate,
					size,
					planRow,
					`numeric re-pivot ${candidateDisagreement.toExponential(1)} vs dense`,
					candidateDisagreement,
				);
				continue;
			}
			this.sparseSchedules.delete(blockId);
			this.droppedSchedules.add(blockId);
			const scratch = this.iterationScratch.get(blockId);
			if (scratch !== undefined) {
				scratch.clearPairs = null;
			}
			if (planRow !== undefined) {
				planRow.path = "dense";
				planRow.reason =
					`shipped order disagrees with dense by ${Number.isFinite(disagreement) ? disagreement.toExponential(1) : "replay refused"} ` +
					`on the operating-point matrix (tolerance ${SCHEDULE_VALIDATION_TOL.toExponential(0)}); ` +
					`dropped to dense at the operating point`;
			}
		}
	}

	/**
	 * Adopt a value-aware replacement order for a block, from settle or from
	 * the mid-run re-pivot, with one shared bookkeeping shape.
	 *
	 * The replacement's slots are a superset of the shipped filled pattern
	 * whose extra cells no stamp writes (see `computeNumericRepivot`), so the
	 * pattern-sized matrix refresh keeps reading correct zeros and neither
	 * `clearPairs` nor the selective-copy machinery needs a rebuild -- the
	 * same reason a dropped block, which does change the refresh, sets
	 * `clearPairs` to null where this does not.
	 */
	private adoptRepivotedSchedule(
		blockId: string,
		candidate: SparseSchedule,
		size: number,
		planRow:
			| {
					path: "sparse" | "dense";
					reason: string;
					pivotDisagreement: number | null;
					repivoted: boolean;
					patternEntries: number;
					sparseOps: number;
					unprovenPivots: number;
			  }
			| undefined,
		reason: string,
		pivotDisagreement: number,
	): void {
		this.sparseSchedules.set(blockId, {
			schedule: candidate,
			values: new Float64Array(candidate.slots),
			rhs: new Float64Array(size),
			factors: new Float64Array(candidate.factorCount),
			consecutiveFallbacks: 0,
			repivotAttempted: false,
		});
		this.repivotedSchedules.add(blockId);
		this.droppedSchedules.delete(blockId);
		if (planRow !== undefined) {
			planRow.path = "sparse";
			planRow.reason = reason;
			planRow.pivotDisagreement = pivotDisagreement;
			planRow.repivoted = true;
			planRow.patternEntries = candidate.slots;
			planRow.sparseOps = candidate.sparseOps;
			planRow.unprovenPivots = candidate.unprovenPivots;
		}
	}

	/**
	 * The mid-run half of the pivot-guard contract: at the consecutive-trip
	 * limit, re-pivot once from the current matrix instead of abandoning.
	 *
	 * Takes the stamped matrix and rhs snapshotted before the dense fallback
	 * destroyed them, plus the fallback's answer, and returns whether a
	 * value-aware order was adopted. Adoption needs the rescue standard --
	 * replay within `SCHEDULE_VALIDATION_TOL` of the dense answer on this
	 * matrix -- the same bar a collapse rescue clears at settle, because this
	 * is a rescue: the shipped order demonstrably does not suit this
	 * operating region. A refusal (null candidate, tripped replay, or a
	 * disagreeing replay) returns false and the caller abandons exactly as
	 * before, with the reason naming the refusal. Either outcome lands in
	 * the plan row, so a mid-run adoption is as visible as a settle one.
	 *
	 * Structured for direct unit testing (pure inputs, boolean verdict): the
	 * corpus never trips the guard, so no corpus run exercises this path.
	 */
	private adoptMidRunRepivot(
		blockId: string,
		entry: { readonly schedule: SparseSchedule },
		matrix: number[][],
		rhs: readonly number[],
		denseAnswer: readonly number[],
	): boolean {
		const planRow = this.solverPlanRows.find(
			(candidate) => candidate.blockId === blockId,
		);
		const block = this.blocksById.get(blockId);
		const size =
			block !== undefined && block.kind === "mna"
				? block.nodeCount + block.auxCount
				: 0;
		const refuse = (reason: string): boolean => {
			if (planRow !== undefined) {
				planRow.reason += ` mid-run re-pivot ${reason}; abandoned`;
			}
			return false;
		};
		if (block === undefined || block.kind !== "mna" || size <= 0) {
			return refuse("refused (unknown block)");
		}
		const candidate = computeNumericRepivot(entry.schedule, size, matrix);
		if (candidate === null) {
			return refuse("refused (no candidate meets the threshold)");
		}
		const values = new Float64Array(candidate.slots);
		const scratchRhs = new Float64Array(size);
		const factors = new Float64Array(candidate.factorCount);
		const out = new Array<number>(size).fill(0);
		const replayed = runSparseSchedule(
			candidate,
			matrix,
			rhs,
			values,
			scratchRhs,
			factors,
			out,
		);
		let diffSquares = 0;
		let denseSquares = 0;
		for (let index = 0; index < size; index += 1) {
			const difference =
				(out[index] as number) - (denseAnswer[index] as number);
			diffSquares += difference * difference;
			denseSquares += (denseAnswer[index] as number) ** 2;
		}
		const disagreement = replayed
			? Math.sqrt(diffSquares) / Math.max(Math.sqrt(denseSquares), 1e-9)
			: Infinity;
		if (!(disagreement <= SCHEDULE_VALIDATION_TOL)) {
			return refuse(
				`refused (replay ${Number.isFinite(disagreement) ? disagreement.toExponential(1) : "tripped"} vs dense)`,
			);
		}
		this.adoptRepivotedSchedule(
			blockId,
			candidate,
			size,
			planRow,
			`mid-run numeric re-pivot ${disagreement.toExponential(1)} vs dense after ${SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT} guard trips`,
			disagreement,
		);
		// The one attempt is spent: a second limit-hit on the adopted order
		// abandons rather than re-pivoting again.
		const adopted = this.sparseSchedules.get(blockId);
		if (adopted !== undefined) {
			adopted.repivotAttempted = true;
		}
		return true;
	}

	/**
	 * Which blocks took the static schedule and which kept the dense solve, and how often the
	 * pivot guard sent a solve back to the dense path.
	 *
	 * Exists so "the sparse solver landed" is never read as "every block got faster". Valid
	 * only after `prepare()`.
	 */
	solverPlan(): {
		readonly blocks: readonly {
			readonly blockId: string;
			readonly size: number;
			readonly patternEntries: number;
			readonly sparseOps: number;
			readonly denseOps: number;
			readonly unprovenPivots: number;
			readonly path: "sparse" | "dense";
			readonly reason: string;
			readonly pivotViolations: number;
			readonly worstPivotRatio: number | null;
			readonly pivotDisagreement: number | null;
			readonly repivoted: boolean;
		}[];
		/** Blocks that gave the schedule up mid-run after a run of pivot-guard trips. */
		readonly abandoned: readonly string[];
		/** Blocks whose shipped order failed numeric validation at the operating point. */
		readonly dropped: readonly string[];
		/** Blocks running a numeric re-pivot order instead of their shipped order. */
		readonly repivoted: readonly string[];
		readonly scheduleSolves: number;
		readonly scheduleFallbacks: number;
	} {
		return {
			blocks: this.solverPlanRows,
			abandoned: [...this.abandonedSchedules],
			dropped: [...this.droppedSchedules],
			repivoted: [...this.repivotedSchedules],
			scheduleSolves: this.scheduleSolves,
			scheduleFallbacks: this.scheduleFallbacks,
		};
	}

	process(input: Float64Array): Float64Array {
		if (this.sampleRate === null) {
			throw new RuntimeError("prepare(sampleRate) was never called");
		}
		if (this.operatingPointPending) {
			this.operatingPointPending = false;
			this.solveOperatingPoint();
			this.settlePivotOrders();
		}
		const output = new Float64Array(input.length);
		this.samples += input.length;
		// `samples` and the non-converged counters stay in **host** samples however many
		// sub-samples each one costs, because their only job is to report the share of rendered
		// audio that is untrustworthy, and a listener hears host samples.
		if (this.resampleUp.length === 0) {
			for (let index = 0; index < input.length; index += 1) {
				output[index] = this.processHeldSample(input[index] ?? 0);
			}
		} else {
			for (let index = 0; index < input.length; index += 1) {
				output[index] = this.processResampledSample(input[index] ?? 0);
			}
		}
		return output;
	}

	/**
	 * One host sample through the legacy path: the input held flat across the
	 * sub-samples, the last sub-sample kept. Bit-identical to the behaviour
	 * before the band-limited resampler existed, which is what makes factor 1
	 * (and non-power-of-two factors) cost nothing and change nothing.
	 */
	private processHeldSample(sample: number): number {
		// Every block is solved, but the result comes from the block that owns the
		// output jack -- not from whichever ran last. Regions are independent
		// subcircuits; only their shared nodes couple them.
		let hostResult = 0;
		let hostNonConverged = false;
		let hostNonFinite = false;
		// The input is **held** across the sub-samples rather than interpolated. A host
		// sample is one measurement and inventing intermediate values is inventing signal;
		// holding is the zero-order reading of what was actually delivered.
		for (let sub = 0; sub < this.oversample; sub += 1) {
			hostResult = this.solveSubSample(sample);
			if (this.sampleNonConverged) {
				hostNonConverged = true;
			}
			if (this.sampleNonFinite) {
				hostNonFinite = true;
			}
		}
		// Zero-order decimation: the last sub-sample is the host sample. This is what the
		// 47-to-50 parity measurement was taken with, and on `boss-ce-5` it is bit-identical
		// to a boxcar average because the limit cycle oversampling removes is *gone* rather
		// than moved above Nyquist.
		if (hostNonConverged) {
			this.nonConvergedSamples += 1;
		}
		if (hostNonFinite) {
			this.nonFiniteSamples += 1;
		}
		return hostResult;
	}

	/**
	 * One host sample through the band-limited path: half-band interpolate up
	 * by 2 per stage, solve each sub-sample, FIR-decimate back to one host
	 * sample. The resampler state lives on the stages across `process()`
	 * calls, so any block split renders bit-identically to one long call;
	 * the group delay this adds is reported by `oversampleLatency()`.
	 */
	private processResampledSample(sample: number): number {
		const stages = this.resampleUp.length;
		// Up cascade: alternate the two scratch buffers, doubling each stage.
		let cur = this.resampleBufA;
		let next = this.resampleBufB;
		(this.resampleUp[0] as HalfBandStage2x).interpolate(sample, cur, 0);
		let width = 2;
		for (let stage = 1; stage < stages; stage += 1) {
			for (let i = 0; i < width; i += 1) {
				(this.resampleUp[stage] as HalfBandStage2x).interpolate(
					cur[i] as number,
					next,
					2 * i,
				);
			}
			const swap = cur;
			cur = next;
			next = swap;
			width *= 2;
		}
		// Solve every sub-sample; outputs land in the idle buffer.
		let hostNonConverged = false;
		let hostNonFinite = false;
		for (let sub = 0; sub < width; sub += 1) {
			next[sub] = this.solveSubSample(cur[sub] as number);
			if (this.sampleNonConverged) {
				hostNonConverged = true;
			}
			if (this.sampleNonFinite) {
				hostNonFinite = true;
			}
		}
		// Down cascade, highest rate first, halving in place of `next`.
		const hi = next;
		for (let stage = stages - 1; stage >= 0; stage -= 1) {
			const half = width / 2;
			for (let i = 0; i < half; i += 1) {
				hi[i] = (this.resampleDown[stage] as HalfBandStage2x).decimate(
					hi[2 * i] as number,
					hi[2 * i + 1] as number,
				);
			}
			width = half;
		}
		if (hostNonConverged) {
			this.nonConvergedSamples += 1;
		}
		if (hostNonFinite) {
			this.nonFiniteSamples += 1;
		}
		return hi[0] as number;
	}

	/**
	 * One sub-sample solve at the solver rate: every block stepped once at
	 * `t = elapsedSamples / sampleRate`, returning the output jack's value.
	 * Shared by the held and the resampled paths, so factor 1 executes the
	 * same operations in the same order as before the resampler existed.
	 */
	private solveSubSample(subInput: number): number {
		// Sample `n` is the circuit at `t = n / sampleRate`, counted from `prepare`. Set here
		// so every block in this sample sees one time, and advanced below so buffer
		// boundaries are invisible.
		this.timeSeconds = this.elapsedSamples / (this.sampleRate as number);
		let result = 0;
		// A sample is counted once however many of its blocks failed. Counting each
		// failing block instead let `nonConvergedSamples` exceed `samples` in a
		// multi-region program, so the number could not be read as the share of audio
		// that is untrustworthy -- which is the only thing it is for.
		this.sampleNonConverged = false;
		this.sampleNonFinite = false;
		for (const id of this.program.order) {
			const block = this.blocksById.get(id);
			if (block === undefined) {
				continue;
			}
			const blockOutput = this.processBlock(block, subInput);
			if (block.kind === "mna" && block.outputNode !== null) {
				result = blockOutput;
			}
		}
		// The rendered supply peak, read from the solved branch unknowns. Every sample, because
		// a rectifier's current is a pulse a few samples wide and a coarser sampling of it
		// would report a smaller number for no physical reason.
		for (const branch of this.supplyBranchSlots) {
			const amps = this.nodeVoltages.get(branch.blockId)?.[branch.slot] ?? 0;
			const magnitude = Math.abs(amps);
			if (magnitude > this.renderedSupplyPeakAmps) {
				this.renderedSupplyPeakAmps = magnitude;
			}
		}
		this.elapsedSamples += 1;
		return result;
	}

	/**
	 * The rate the caller passed to `prepare`, as opposed to the solver's sub-sample rate.
	 *
	 * `this.sampleRate` is the rate the circuit is actually solved at; a console that needs to
	 * know what it asked for -- to size a buffer, or to report -- wants this one.
	 */
	hostSampleRate(): number | null {
		return this.sampleRate === null ? null : this.sampleRate / this.oversample;
	}

	/**
	 * The resampler's total group delay in **host** samples, or `null` before
	 * `prepare()`. Zero when the resampler is bypassed (factor 1, or a factor
	 * that is not a power of two and keeps the legacy path): the held path
	 * adds no latency by construction. At 2x/4x/8x this is 19.5/26.25/28.625
	 * host samples for the stage-specific half-band cascade -- a real, reported
	 * latency the caller must absorb or declare, not a hidden one.
	 */
	oversampleLatency(): number | null {
		return this.sampleRate === null ? null : this.resampleLatencyHost;
	}

	private processBlock(block: Block, input: number): number {
		if (block.kind === "composed") {
			this.processComposedBlock(block);
			// A composition never owns the output jack -- only an `mna` block's `outputNode`
			// does -- so this return value is discarded by `process()`. It exists only because
			// every block in `program.order` is processed through this one dispatch. A
			// composition publishes through `macroOutputVolts` for a `macro-audio-source`
			// stamp to read instead.
			return 0;
		}
		if (block.kind === "macro") {
			// Unreachable: `prepare()` refuses a program carrying one, and nothing executes
			// before `prepare()`. It is here because the type system asked. Narrowing the union
			// by eliminating `composed` no longer yields `mna`, and the honest way to close that
			// is a throw rather than a cast -- if this ever fires, the load-time refusal was
			// bypassed, and a named error is the one outcome better than a silent wrong render.
			throw new RuntimeError(
				`block ${block.id} is a dispatched macro (${block.modelId}); macro dispatch was retired in board-p3 row 7`,
			);
		}
		this.opampHistory.clear();
		const dt = 1 / (this.sampleRate as number);
		const state = this.capacitorState.get(block.id) as number[];
		const previous = this.nodeVoltages.get(block.id) as number[];

		// Build-order step 6, vertical slice: an opt-in per-block substitution, diffed
		// against `iterate` by `scripts/report-elimination-parity.ts` rather than trusted
		// here. `solveOperatingPoint`'s continuation methods (gmin/source stepping) call
		// `iterate` directly and are never routed through this -- the DC operating point
		// this block's first sample warm-starts from is always the unreduced answer.
		const { solution, converged, used, worstNode, worstDelta } =
			(block.eliminate || this.eliminateBlocks.has(block.id))
				? this.iterateEliminated(
						block,
						input,
						dt,
						state,
						previous.slice(),
						false,
					)
				: this.iterate(block, input, dt, state, previous.slice(), false);
		this.peakIterations = Math.max(this.peakIterations, used);
		this.totalIterations += used;

		// Hold the last solved state rather than emit an iterate that does not satisfy
		// the circuit equations. Holding is audibly wrong too, but it is bounded and
		// it is counted; an unconverged iterate is unbounded and invisible.
		//
		// Safe to read `previous` here, after `iterate` has already run and mutated its own
		// ping-pong scratch buffers: `previous` is never one of them: both `nodeVoltages.set`
		// call sites (this function's convergent return, and `solveOperatingPoint`) store a
		// `.slice()` copy rather than `iterate`'s live return value, precisely so that a run of
		// held samples -- which call `iterate` and mutate scratch on every one of them, whether
		// or not that sample converges -- can never corrupt the last genuinely settled state
		// this array holds until a converged sample earns the right to replace it.
		const held =
			block.outputNode === null ? 0 : (previous[block.outputNode] ?? 0);

		if (!solution.every((value) => Number.isFinite(value))) {
			this.sampleNonFinite = true;
			return held;
		}
		if (!converged) {
			this.sampleNonConverged = true;
			this.lastFailure = {
				node: worstNode,
				delta: worstDelta,
				limited: this.limitedIterate,
				limitedBy: this.limitedBy,
			};
			// **Time advances even when the solve fails.** This looks like the unsafe
			// choice and is the safe one, and the measurement is unambiguous.
			//
			// Freezing the reactive state was never conservative: a capacitor charges
			// across that sample interval whether or not Newton converged, so freezing it
			// stops the circuit's clock while the input's keeps running. The next sample
			// then faces a larger jump, which makes *it* fail, which freezes again -- the
			// cascade that made the iteration cap look like the problem. Freezing is a
			// bigger modelling error than advancing from a nearly-converged iterate, and
			// it is the error that propagates.
			//
			// Measured over all 52 compiled packets, 4800 samples at 0.5 / 220 Hz:
			//
			// ```
			// freeze (was)     mean 7.47 iter/sample   held 10624
			// advance          mean 4.91 iter/sample   held   509
			// ```
			//
			// Fewer held samples *and* fewer iterations, because the cascade stops:
			// `boss-ph-1r` 4800 -> 42, `boss-hm-2` 1733 -> 1, `ibanez-pql` 3133 -> 97.
			// Seeding the node voltages from the operating point as well was measured and
			// is not worth its machinery (held 441 against 509).
			//
			// The honesty guarantee is untouched. The **output** is still the last solved
			// value, and the sample is still counted in `nonConvergedSamples`; what changes
			// is that the circuit's memory no longer stops. A packet with no held samples
			// never reaches this line, so the clean majority is bit-identical.
			//
			// Guard: only advance from solution if it is a near-miss (worstDelta < 0.05).
			// If Newton diverged with large residual, advancing reactive state from the exploded
			// iterate corrupts circuit memory into astronomical voltages. In that case, advance
			// from previous and preserve the last known nodeVoltages.
			const stateSeed = worstDelta < 0.05 ? solution : previous;
			this.advanceReactiveState(block, state, stateSeed, dt);
			this.advanceOpAmpRawState(block, stateSeed, dt);
			if (worstDelta < 0.05) {
				this.nodeVoltages.set(block.id, solution.slice());
			}
			return held;
		}

		this.advanceReactiveState(block, state, solution, dt);
		this.advanceOpAmpRawState(block, solution, dt);

		// A copy, not the ping-pong buffer itself. `solution` is `iterate`'s `current` -- one
		// of the two persistent per-block scratch arrays `iterate` reuses on every future call
		// for this block, converged or not. A held (non-converged) sample deliberately skips
		// this `set`, leaving whatever is already stored here as next sample's starting guess
		// (see the comment above this return's sibling) -- but `iterate` still runs on every
		// held sample, seeding and ping-ponging through both scratch buffers regardless of
		// whether that sample converges. If this stored a live alias into one of them, a run of
		// held samples would silently overwrite the very state the next attempt is supposed to
		// start from, out from under it, between one held sample and the next -- corrupting the
		// last genuinely converged operating point into whatever those samples' half-solved
		// iterates happened to leave behind. Copying once per converged sample is what keeps a
		// stored answer stable until this line replaces it on purpose.
		this.nodeVoltages.set(block.id, solution.slice());
		return block.outputNode === null ? 0 : (solution[block.outputNode] ?? 0);
	}


	/**
	 * The composition interpreter (board-p3 row 4): a data-driven graph of
	 * closed-vocabulary primitive ops, evaluated top to bottom each sample.
	 * No pedal id, no part number, no registry lookup -- the program the
	 * packet supplies is the whole instruction, which is what makes this a
	 * machine that runs a program rather than a library of classes the
	 * compiler dispatches to.
	 *
	 * Evaluation order is load-bearing for the bit-identical gate: float
	 * addition is not associative, so ops run strictly in listed order and a
	 * source may only name the block input, a constant, or an earlier op's
	 * output. Feedback flows through delay-line state, never through
	 * temporaries.
	 */
	/**
	 * What a `parameter`-mode tap reads for one line: a 0..1 fraction of its range, or a tapped
	 * length in samples, or neither (the tap then reads capacity, the cited maximum).
	 *
	 * Three sources, never two. A line's own `sweep` wins: `scanned` reads its control by
	 * position through the control's taper, `tapped` reads the interval between the control's
	 * last two presses times `ratio`. With no sweep, the block's solved `parameter` node, which is
	 * a registry model's reading.
	 */
	private composedLineReading(
		block: Extract<Block, { kind: "composed" }>,
		sweep: ComposedLineSweep | undefined,
	): { readonly paramScale: number | null; readonly tapped: number | null } {
		if (sweep !== undefined) {
			if (sweep.read === "scanned") {
				const control = this.controlsById.get(sweep.controlId);
				return {
					paramScale: taperFraction(
						control?.taper ?? "linear",
						this.positions.get(sweep.controlId) ?? 0.5,
					),
					tapped: null,
				};
			}
			const interval =
				this.tapState.get(sweep.controlId)?.intervalSeconds ??
				this.controlsById.get(sweep.controlId)?.tap?.defaultSeconds ??
				null;
			return {
				paramScale: null,
				tapped: interval === null ? null : interval * sweep.ratio * (this.sampleRate ?? 48000),
			};
		}
		const port = block.parameter;
		if (port === null || !(port.referenceVolts > 0)) return { paramScale: null, tapped: null };
		return {
			paramScale:
				Math.abs(this.nodeVoltages.get(port.block)?.[port.node] ?? 0) / port.referenceVolts,
			tapped: null,
		};
	}

	/**
	 * A delay core's DC transfer, derived from its own ops for the
	 * operating-point solve: at steady state every delay line holds what is
	 * pushed into it, so taps read line values and pushes update them, iterated
	 * to a fixed point. Ops that are DC-blocking by construction
	 * (`filter-dcblock`) push 0, so a core behind a DC block correctly reports
	 * no transfer; `mix` applies its gains, including swept ones. Anything
	 * else (combs, allpasses, pitch, hold, trackers) makes the transfer
	 * ill-defined and returns null -- the macro then reads 0 during the
	 * solve, exactly as before, rather than a guess.
	 *
	 * `null` also for programs owning no delay lines (reverb owns combs, not
	 * lines): those keep their established no-DC behavior, which this
	 * derivation must reproduce rather than revisit. No per-chip flag, no
	 * name reading; the ops are the whole input. The loop is contractive
	 * exactly when the program's own feedback is (gain < 1); capped well
	 * past any such settling, with null on non-convergence.
	 */
	private composedDcTransfer(
		block: Extract<Block, { kind: "composed" }>,
		tap: number,
		voltageOf: (blockId: string, node: number) => number,
	): number | null {
		const position = selectedPosition(
			block,
			voltageOf,
			(controlId) => this.positions.get(controlId) ?? 0.5,
		);
		const program = position < 0 ? undefined : block.positions[position];
		if (program === undefined) {
			return null;
		}
		if (!program.ops.some((op) => op.op.startsWith("delay-tap"))) {
			// Lines mark delay-line behavior; filter-only compositions have none.
			// (Checked on ops rather than `lines` so a declared program with a
			// line entry but no tap cannot claim a transfer either.)
			return null;
		}
		for (const op of program.ops) {
			if (
				op.op !== "delay-tap" &&
				op.op !== "delay-tap-fractional" &&
				op.op !== "delay-tap-reverse" &&
				op.op !== "filter-dcblock" &&
				op.op !== "mix" &&
				op.op !== "delay-push"
			) {
				return null;
			}
		}
		const evalOnce = (lines: Map<string, number>): number | null => {
			const temps = new Array<number>(program.ops.length).fill(0);
			for (const op of program.ops) {
				if (op.op === "delay-push") {
					// No out temp; its value settles the line.
					const value =
						op.input.kind === "input"
							? tap
							: op.input.kind === "const"
								? op.input.value
								: (temps[op.input.index] ?? 0);
					lines.set(op.line, value);
				} else if (
					op.op === "delay-tap" ||
					op.op === "delay-tap-fractional" ||
					op.op === "delay-tap-reverse"
				) {
					temps[op.out] = lines.get(op.line) ?? 0;
				} else if (op.op === "filter-dcblock") {
					temps[op.out] = 0;
				} else if (op.op === "mix") {
					let acc = 0;
					for (const term of op.terms) {
						const sweep = term.sweep;
						const gain =
							sweep === undefined
								? term.gain
								: sweep.min +
									taperFraction(
										this.controlsById.get(sweep.controlId)?.taper ?? "linear",
										this.positions.get(sweep.controlId) ?? 0.5,
									) *
										(sweep.max - sweep.min);
						const value =
							term.source.kind === "input"
								? tap
								: term.source.kind === "const"
									? term.source.value
									: (temps[term.source.index] ?? 0);
						acc += value * gain;
					}
					temps[op.out] = acc;
				} else {
					// Unreachable: the vocabulary gate above returned null for
					// anything else. Present so a future op cannot silently join
					// the DC evaluation.
					return null;
				}
			}
			return temps[program.out] ?? 0;
		};
		// Settle the lines to their fixed point: each pass pushes from the
		// current line values and taps read them back. Contractive exactly
		// when the program's own feedback is; anything else returns null
		// rather than a half-settled value.
		const lines = new Map<string, number>();
		let previous: number | null = null;
		for (let pass = 0; pass < 1024; pass += 1) {
			const published = evalOnce(lines);
			if (published === null) {
				return null;
			}
			if (
				previous !== null &&
				Math.abs(published - previous) <=
					1e-12 * Math.max(1, Math.abs(published))
			) {
				return published;
			}
			previous = published;
		}
		return null;
	}

	private processComposedBlock(block: Extract<Block, { kind: "composed" }>): void {		// Which program is running, read from the selector pin the knob drives. Resolved once
		// per sample rather than per op: a mode cannot change mid-sample, and re-reading it
		// inside the loop would let a half-executed graph mix two programs' temporaries.
		const position = selectedPosition(
			block,
			(id, node) => this.nodeVoltages.get(id)?.[node] ?? 0,
			(controlId) => this.positions.get(controlId) ?? 0.5,
		);
		const tap =
			block.audioIn === null
				? 0
				: (this.nodeVoltages.get(block.audioIn.block)?.[block.audioIn.node] ??
					0);
		// A hold sampler's recording is erased when its program is selected afresh: the manual's
		// "the recorded data will be erased when you change the positions of the Mode Switch".
		if (this.lastComposedPosition.get(block.id) !== position) {
			this.lastComposedPosition.set(block.id, position);
			const key = this.composedStateKeys.get(block.id)?.[position];
			for (const line of (key === undefined ? undefined : this.composedLineState.get(key))?.values() ?? []) {
				line.hold = { state: 0, length: 0, index: 0, gateWas: false };
			}
		}
		const program = position < 0 ? undefined : block.positions[position];
		if (program === undefined) {
			// **A detent the source declares no program for.** The chip is doing something the
			// packet does not model, so the block makes no claim and passes its input through.
			// Publishing zero would be silence, which is indistinguishable from a severed net,
			// and returning early would leave the previous sample's output standing. The gap is
			// named at compile time, where a reader sees it, rather than here every sample.
			this.macroOutputVolts.set(block.id, tap);
			return;
		}
		const stateKey = this.composedStateKeys.get(block.id)?.[position];
		if (stateKey === undefined) {
			return;
		}
		const lines = this.composedLineState.get(stateKey);
		if (lines === undefined) {
			return;
		}
		const temps = new Array<number>(program.ops.length).fill(0);
		const read = (source: ComposedSource): number => {
			if (source.kind === "input") {
				return tap;
			}
			if (source.kind === "const") {
				return source.value;
			}
			return temps[source.index] ?? 0;
		};
		for (const [opIndex, op] of program.ops.entries()) {
			if (op.op === "delay-tap") {
				const line = lines.get(op.line);
				if (line === undefined) {
					return;
				}
				// Length priority mirrors the delay kernels: a clock-smoothed
				// control first, then a parameter-port scale, else the capacity.
				// DDL shaping: whole samples above 1.
				const reading =
					op.length.mode === "parameter"
						? this.composedLineReading(block, program.lines[op.line]?.sweep)
						: { paramScale: null, tapped: null };
				const paramScale = reading.paramScale;
				const resolved = composedDelayLength({
					mode: op.length.mode,
					capacity: line.lengthCapacity,
					current: line.currentLengthSamples,
					target: line.targetLengthSamples,
					sampleRate: this.sampleRate ?? 48000,
					paramScale,
					tapped: reading.tapped,
					modVolts: null,
					modEstimate: 0,
					modSeeded: true,
					clockLaw: null,
					min: 1,
					floor: line.floorSamples,
					headroom: 0,
					round: true,
				});
				line.currentLengthSamples = resolved.current;
				const effectiveLength = resolved.length;
				const readIndex =
					(line.writeIndex - effectiveLength + line.capacity) % line.capacity;
				temps[op.out] = line.buffer[readIndex] ?? 0;
			} else if (op.op === "delay-tap-fractional") {
				const line = lines.get(op.line);
				if (line === undefined) {
					return;
				}
				const dc = this.composedDcState.get(block.id);
				if (dc === undefined) {
					return;
				}
				// BBD shaping: fractional reads above 0 with two slots of
				// headroom; only the parameter scale rounds.
				const reading =
					op.length.mode === "parameter"
						? this.composedLineReading(block, program.lines[op.line]?.sweep)
						: { paramScale: null, tapped: null };
				const paramScale = reading.paramScale;
				const modVolts =
					op.length.mode === "modulation" && block.modulation != null
						? (this.nodeVoltages.get(block.modulation.block)?.[
								block.modulation.node
							] ?? 0)
						: op.length.mode === "clock-law" && block.clockLaw != null
							? (this.nodeVoltages.get(block.clockLaw.block)?.[
									block.clockLaw.node
								] ?? 0)
							: null;
				const resolved = composedDelayLength({
					mode: op.length.mode,
					capacity: line.lengthCapacity,
					current: line.currentLengthSamples,
					target: line.targetLengthSamples,
					sampleRate: this.sampleRate ?? 48000,
					paramScale,
					modVolts,
					modEstimate: dc.modDcEstimate,
					tapped: reading.tapped,
					modSeeded: dc.modSeeded,
					clockLaw:
						op.length.mode === "clock-law"
							? {
									rOhms: op.length.rOhms,
									cFarads: op.length.cFarads,
									vddVolts: op.length.vddVolts,
									vthVolts: op.length.vthVolts,
									vfVolts: op.length.vfVolts,
									floorVolts: op.length.floorVolts,
									stages: op.length.stages,
								}
							: null,
					min: 0,
					floor: line.floorSamples,
					headroom: 2,
					round: op.length.mode === "parameter",
				});
				line.currentLengthSamples = resolved.current;
				dc.modDcEstimate = resolved.modEstimate;
				dc.modSeeded = resolved.modSeeded;
				const effectiveLength = resolved.length;
				// Fractional delay read with linear interpolation, exactly the
				// kernel's read-before-write discipline: the slot this sample
				// is about to occupy still holds the value from `dInt` samples
				// ago, and reading first is what keeps it that way.
				const dInt = Math.floor(effectiveLength);
				const frac = effectiveLength - dInt;
				const readIndex0 =
					(line.writeIndex - dInt + line.capacity) % line.capacity;
				const readIndex1 =
					(line.writeIndex - dInt - 1 + line.capacity) % line.capacity;
				const s0 = line.buffer[readIndex0] ?? 0;
				const s1 = line.buffer[readIndex1] ?? 0;
				temps[op.out] = s0 + frac * (s1 - s0);
			} else if (op.op === "delay-tap-reverse") {
				const line = lines.get(op.line);
				if (line === undefined) {
					return;
				}
				// The segment length resolves exactly as a `delay-tap`'s does -- whole samples,
				// swept by the line's control -- so a mode's cited range means the same thing
				// forwards and backwards. See `PrimitiveOp` for the two-head law.
				const reading =
					op.length.mode === "parameter"
						? this.composedLineReading(block, program.lines[op.line]?.sweep)
						: { paramScale: null, tapped: null };
				const resolved = composedDelayLength({
					mode: op.length.mode,
					capacity: line.lengthCapacity,
					current: line.currentLengthSamples,
					target: line.targetLengthSamples,
					sampleRate: this.sampleRate ?? 48000,
					paramScale: reading.paramScale,
					tapped: reading.tapped,
					modVolts: null,
					modEstimate: 0,
					modSeeded: true,
					clockLaw: null,
					min: 2,
					floor: line.floorSamples,
					headroom: 0,
					round: true,
				});
				line.currentLengthSamples = resolved.current;
				temps[op.out] = reverseRead(line, resolved.length);
			} else if (op.op === "hold-loop") {
				const line = lines.get(op.line);
				if (line === undefined) {
					return;
				}
				const gateLevel =
					op.gate.min +
					taperFraction(
						this.controlsById.get(op.gate.controlId)?.taper ?? "linear",
						this.positions.get(op.gate.controlId) ?? 0,
					) *
						(op.gate.max - op.gate.min);
				temps[op.out] = holdLoop(line, read(op.input), gateLevel >= 0.5);
			} else if (op.op === "filter-dcblock") {
				const dc = this.composedDcState.get(block.id);
				if (dc === undefined) {
					return;
				}
				// The BBD input coupling estimator: a 1 s one-pole that blocks
				// true DC while passing audio, so the buffer stores signal
				// above the operating point and feedback reinforces audio.
				const x = read(op.input);
				const alpha = 1 / (1.0 * (this.sampleRate ?? 48000));
				dc.dcEstimate += alpha * (x - dc.dcEstimate);
				temps[op.out] = x - dc.dcEstimate;
			} else if (op.op === "delay-push") {
				const line = lines.get(op.line);
				if (line === undefined) {
					return;
				}
				line.buffer[line.writeIndex] = read(op.input);
				line.writeIndex = (line.writeIndex + 1) % line.capacity;
			} else if (op.op === "comb") {
				const filters = this.composedFilterState.get(stateKey);
				if (filters === undefined) {
					return;
				}
				const st = filters.combs[op.index];
				if (st === undefined) {
					return;
				}
				// Schroeder feedback comb, exactly the kernel's order: read
				// the delayed sample, write back input plus gain times
				// delayed, advance, publish the delayed sample.
				const inVal = read(op.input);
				const delayed = st.buffer[st.index] ?? 0;
				st.buffer[st.index] = inVal + st.gain * delayed;
				st.index = (st.index + 1) % st.buffer.length;
				temps[op.out] = delayed;
			} else if (op.op === "allpass") {
				const filters = this.composedFilterState.get(stateKey);
				if (filters === undefined) {
					return;
				}
				const st = filters.allpasses[op.index];
				if (st === undefined) {
					return;
				}
				// Schroeder allpass diffuser, exactly the kernel's order:
				// output disperses phase at flat magnitude, the write-back
				// feeds input plus gain times delayed forward.
				const inVal = read(op.input);
				const delayed = st.buffer[st.index] ?? 0;
				const out = delayed - REVERB_ALLPASS_GAIN * inVal;
				st.buffer[st.index] = inVal + REVERB_ALLPASS_GAIN * delayed;
				st.index = (st.index + 1) % st.buffer.length;
				temps[op.out] = out;
			} else if (op.op === "pitch-tracker") {
				const trackers = this.composedTrackerState.get(stateKey);
				if (trackers === undefined) {
					return;
				}
				const st = trackers.get(opIndex);
				if (st === undefined) {
					return;
				}
				// Autocorrelation estimate every hop, held between: the ring
				// takes every input sample, and each TRACK_HOP-th sample the
				// window is copied oldest-first into estimator order for
				// `trackPitchFundamental`. Silence estimates 0, never stale.
				st.buffer[st.writeAbs % TRACK_WINDOW] = read(op.input);
				st.writeAbs += 1;
				st.sinceUpdate += 1;
				if (st.sinceUpdate >= TRACK_HOP) {
					st.sinceUpdate = 0;
					const window = new Float64Array(TRACK_WINDOW);
					for (let index = 0; index < TRACK_WINDOW; index += 1) {
						window[index] =
							st.buffer[(st.writeAbs + index) % TRACK_WINDOW] ?? 0;
					}
					st.estimate = trackPitchFundamental(
						window,
						this.sampleRate ?? 48000,
					);
				}
				temps[op.out] = st.estimate;
			} else if (op.op === "pitch-shift") {
				const pitch = this.composedPitchState.get(stateKey);
				if (pitch === undefined) {
					return;
				}
				const st = pitch.get(opIndex);
				if (st === undefined) {
					return;
				}
				// Static transposition by asynchronous resampling (row 5): the
				// write pointer takes every input sample; the read pointer
				// advances `ratio` per output sample through linear
				// interpolation, wrapping by whole windows when it outruns the
				// write pointer (ratio above 1) or falls out of history
				// (below 1). The wrap is a real discontinuity -- repeated
				// material for upward shifts, skipped material for downward --
				// and the fundamental survives it, which is what the
				// acceptance measures. No crossfade, no formant correction.
				const slot = (position: number): number =>
					((position % PITCH_HISTORY) + PITCH_HISTORY) % PITCH_HISTORY;
				st.buffer[slot(st.writeAbs)] = read(op.input);
				st.writeAbs += 1;
				const base = Math.floor(st.readAbs);
				const frac = st.readAbs - base;
				const s0 = st.buffer[slot(base)] ?? 0;
				const s1 = st.buffer[slot(base + 1)] ?? 0;
				temps[op.out] = s0 + frac * (s1 - s0);
				st.readAbs += st.ratio;
				while (st.readAbs > st.writeAbs) {
					st.readAbs -= PITCH_WINDOW;
				}
				while (st.readAbs <= st.writeAbs - PITCH_HISTORY) {
					st.readAbs += PITCH_WINDOW;
				}
			} else if (op.op === "mix") {
				let acc = 0;
				for (const term of op.terms) {
					const sweep = term.sweep;
					// A swept gain reads its knob by position through the knob's own taper,
					// exactly as a scanned delay parameter does; absent is a fixed gain.
					const gain =
						sweep === undefined
							? term.gain
							: sweep.min +
								taperFraction(
									this.controlsById.get(sweep.controlId)?.taper ?? "linear",
									this.positions.get(sweep.controlId) ?? 0.5,
								) *
									(sweep.max - sweep.min);
					// A direct input term enters AC-coupled: the block's operating
					// point rides the output (added back at the macro source), so
					// the line must not carry it a second time or every biased
					// input double-counts its DC through the repeat. Temp and
					// const terms recirculate verbatim. BBD and reverb programs
					// have no input-term mixes and behave exactly as before.
					const value =
						term.source.kind === "input"
							? tap -
								(this.composedDcState.get(block.id)?.dcOperatingPoint ?? 0)
							: term.source.kind === "const"
								? term.source.value
								: read(term.source);
					acc += value * gain;
				}
				temps[op.out] = acc;
			} else {
				// A decoded program naming a primitive this runtime lacks refuses
				// by name -- the same fail-closed shape as an unimplemented model.
				const kind = (op as { readonly op: string }).op;
				throw new RuntimeError(
					`composed block "${block.id}" names a DSP primitive this runtime does not implement: ${kind}`,
				);
			}
		}
		this.macroOutputVolts.set(block.id, temps[program.out] ?? 0);
	}




	/**
	 * One Newton solve of a block, shared by a sample and by the operating point.
	 *
	 * Extracted rather than copied: the operating point differs from a sample only in
	 * which elements conduct, and a second copy of the limiter rule, the gmin row, the
	 * ground pin and the convergence test would drift from this one and then describe a
	 * circuit the sample loop does not solve.
	 */
	private iterate(
		block: Extract<Block, { kind: "mna" }>,
		input: number,
		dt: number,
		state: number[],
		start: number[],
		dc: boolean,
		/**
		 * The node-to-ground conductance for this pass. Raised above `GMIN_SIEMENS` only by
		 * `solveOperatingPoint`'s continuation, never by a sample.
		 */
		gmin: number = GMIN_SIEMENS,
		/**
		 * How much of each independent supply this pass applies, from 0 to 1. Below 1 only by
		 * `solveOperatingPointForBlock`'s source stepping, never by a sample.
		 */
		sourceScale: number = 1,
	): {
		solution: number[];
		converged: boolean;
		used: number;
		worstNode: number;
		worstDelta: number;
	} {
		const size = block.nodeCount + block.auxCount;
		// **The DC solve is never on probation.** `solveOperatingPointForBlock` walks
		// direct -> gmin stepping -> source stepping, and each continuation exists precisely to
		// spend iterations on a problem the direct pass could not solve. Letting that pass's own
		// failure cut the budget for the walk that follows it defeats the walk: the probation
		// starts at sample 0, so every continuation pass, and then the whole first probation
		// window, inherits a 64-iteration budget.
		//
		// **This did not fix `mf-102`'s operating point, and the distinction is the point.**
		// That block still fails its DC solve with the exemption in place (`operatingPointFailures`
		// 1, measured 2026-09-19), so the exemption removes a mechanism that could only ever make
		// a continuation worse -- it does not explain the failure. Why that solve fails is open on
		// phase-1 row 7.
		const probationEnds = this.unproductiveUntilSample.get(block.id);
		const onProbation =
			!dc && probationEnds !== undefined && this.elapsedSamples < probationEnds;
		const iterations = block.linear
			? 1
			: onProbation
				? Math.min(NEWTON_UNPRODUCTIVE_ITERATIONS, this.maxNewtonIterations)
				: this.maxNewtonIterations;
		let converged = block.linear;
		let used = 0;
		let worstNode = -1;
		let worstDelta = 0;
		// Sized once in `prepare` per block id; every block reaching `iterate` was walked
		// there, so a missing entry means `prepare` was skipped, not a legitimate state.
		const scratch = this.iterationScratch.get(block.id);
		if (scratch === undefined) {
			throw new RuntimeError(
				`no iteration scratch for block "${block.id}" -- prepare() was not called`,
			);
		}
		const { matrix, rhs, solutionA, solutionB } = scratch;
		// Resolved once per call rather than once per Newton iteration, the same reason
		// `blockIndex` below is: a `Map.get` in the innermost loop was measured as the largest
		// self-time in the eliminated path, and this one would run on every iteration.
		//
		// **`dc` takes the dense path, and that is a correctness decision before it is a cost
		// one.** The schedule's pivot order was chosen against the transient matrix, where a
		// capacitor contributes `2C/dt`. In a DC pass a capacitor contributes *nothing* (see
		// `applyStamp`) and an inductor contributes a short, so entries the order depends on are
		// exactly zero, the pivot guard trips, and the block burns its way to
		// `SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT` before it has rendered a sample. The C++ console
		// carries the same gate and the same reasoning; see its comment in `Engine::iterate` and
		// `thoughts/shared/2026-09-18-sparse-schedule-runtime-audit.md` §4 for the measurement.
		const sparse = dc ? undefined : this.sparseSchedules.get(block.id);
		// Resolved once per call rather than once per stamp -- see `packHistoryKey2`/`3` and
		// `bjtHistory`'s comment for what this feeds.
		const blockIndex = this.blockIndexById.get(block.id) ?? 0;
		// Seed the ping-pong pair from the caller's `start`, once, rather than letting `solve`
		// allocate a fresh N-length array every Newton iteration the way it used to. `start`
		// itself is read-only here and is never handed back to the caller aliased to either
		// buffer, so a caller that still holds it (`[...guess]` in the continuation methods,
		// `previous.slice()` in `processBlock`) sees it unchanged.
		//
		// On a standard audio pass of a nonlinear block, and only when the runtime was prepared
		// with `oversample > 1`, the seed is the predicted start (see `newtonStartHistory`),
		// falling back to `start`. At factor 1 nothing seeds and nothing records. `start`
		// itself stays the previous solution for the fold reseed below.
		const predictorPass =
			this.oversample > 1 &&
			!dc &&
			sourceScale === 1 &&
			gmin === GMIN_SIEMENS &&
			!block.linear;
		const seed = (predictorPass ? this.predictedNewtonStart(block.id, size) : null) ?? start;
		for (let index = 0; index < size; index += 1) {
			solutionA[index] = seed[index] ?? 0;
		}
		let current = solutionA;
		let next = solutionB;
		const base = this.baseMatrices.get(block.id);
		const isStandardAudioPass =
			!dc && sourceScale === 1 && gmin === GMIN_SIEMENS && base !== undefined;

		// The residual at the last iterate the limiter blocked. **Classified after the loop, not
		// inside it**, because the sampling point is what decides whether the populations
		// separate at all — measured, and it is not a matter of picking a better tolerance:
		//
		//   at the FIRST blocked iterate  `marshall-1959-super-lead-plexi` median 1.28e-8 against
		//                                 `vox-ac30-top-boost` 5.61e-9 — overlapping and INVERTED,
		//                                 with 37 healthy packets straddling both from 8.4e-17 to
		//                                 1.0. No threshold exists here.
		//   at the LAST blocked iterate   plexi <= 1e-9 against vox-ac30 up to 3.17e-3 — six
		//                                 orders apart, and the classification is clean.
		//
		// So this only records; `convergedNow` is untouched and the returned iterate is the same
		// one either way, which is what makes the verdict free of behavioural risk.
		let lastBlockedResidual = Number.NaN;
		let relaxing = false;
		let alpha = NEWTON_RELAXATION_FACTOR;
		let bestDelta = Number.POSITIVE_INFINITY;
		let noImprovement = 0;
		let foldStreak = 0;
		let foldReseeded = false;
		for (let iteration = 0; iteration < iterations; iteration += 1) {
			used = iteration + 1;

			this.limitedIterate = false;
			this.limitedBy = null;
			this.limitedOpamp = null;

			if (isStandardAudioPass) {
				// **This copy was the block's dominant cost, not the elimination.** It is n^2
				// per Newton iteration against a schedule that does `sparseOps` work:
				// `moogerfooger-mf-102` copied 12,544 entries to run 869 multiply-adds, so
				// 93% of the per-iteration work was rebuilding entries that are structurally
				// zero and stay zero. Corpus-wide the wall-clock exponent was `unknowns^1.60`,
				// between the schedule's ~n^1 and this n^2, and `state bytes` predicted a
				// packet's cost better than its block count did.
				//
				// Only the pattern needs rebuilding: every entry any stamp can write is in it
				// by construction (`schedulePattern` is the outer product of each stamp's own
				// terminals), `base.matrix` is zero outside it, and the entries outside it are
				// therefore zero in both buffers already. Same values, same order of
				// accumulation, so the arithmetic is **bit-identical** -- this is not a
				// reordering and claims no parity carve-out.
				const pairs = scratch.clearPairs;
				if (pairs === null || scratch.denseDirty) {
					for (let row = 0; row < size; row += 1) {
						const dstRow = matrix[row] as number[];
						const srcRow = base.matrix[row] as number[];
						for (let column = 0; column < size; column += 1) {
							dstRow[column] = srcRow[column] as number;
						}
					}
					scratch.denseDirty = false;
				} else {
					for (let index = 0; index < pairs.length; index += 2) {
						const row = pairs[index] as number;
						const column = pairs[index + 1] as number;
						(matrix[row] as number[])[column] = (base.matrix[row] as number[])[
							column
						] as number;
					}
				}
				for (let row = 0; row < size; row += 1) {
					rhs[row] = base.rhs[row] as number;
				}

				for (const stamp of base.nonConstantStamps) {
					this.applyStamp(
						stamp,
						matrix,
						rhs,
						block,
						dt,
						state,
						current,
						input,
						false,
						1,
						blockIndex,
					);
				}

				// Ground is the reference: node 0 is pinned to zero volts.
				for (let column = 0; column < size; column += 1) {
					(matrix[0] as number[])[column] = 0;
				}
				(matrix[0] as number[])[0] = 1;
				rhs[0] = 0;
			} else {
				// Zeroed in place rather than replaced -- see `iterationScratch`'s comment.
				// Pattern-only for the same reason the copy above is: nothing outside the
				// pattern is ever stamped, so nothing outside it is ever nonzero to clear.
				const pairs = scratch.clearPairs;
				if (pairs === null || scratch.denseDirty) {
					for (let row = 0; row < size; row += 1) {
						(matrix[row] as number[]).fill(0);
					}
					scratch.denseDirty = false;
				} else {
					for (let index = 0; index < pairs.length; index += 2) {
						(matrix[pairs[index] as number] as number[])[
							pairs[index + 1] as number
						] = 0;
					}
				}
				for (let row = 0; row < size; row += 1) {
					rhs[row] = 0;
				}

				for (const stamp of block.stamps) {
					this.applyStamp(
						stamp,
						matrix,
						rhs,
						block,
						dt,
						state,
						current,
						input,
						dc,
						sourceScale,
						blockIndex,
					);
				}

				// Every node gets a path to ground before anything else reads the matrix, so a
				// terminal that draws no current cannot leave its row empty.
				for (let node = 1; node < block.nodeCount; node += 1) {
					(matrix[node] as number[])[node] += gmin;
				}

				// Ground is the reference: node 0 is pinned to zero volts.
				for (let column = 0; column < size; column += 1) {
					(matrix[0] as number[])[column] = 0;
				}
				(matrix[0] as number[])[0] = 1;
				rhs[0] = 0;
			}

			// Writes into `next` -- the buffer NOT currently `current` -- in place, rather
			// than allocating a fresh array. See `solve`'s own comment for why that is safe.
			//
			// The static schedule, where this block has one, is the same elimination with
			// every structural zero already removed at `prepare()` time. It is not allowed to
			// be the only answer: a pivot that has collapsed at this operating point sends the
			// solve back to the dense path, which reaches its own near-singular convention
			// (`continue` past the pivot, zero that unknown) rather than dividing by ~0. The
			// fallback reads `matrix` and `rhs` unharmed -- the schedule only gathers out of
			// the matrix and works on its own copy of the right-hand side.
			// **Before the solve, and only when the limiter fired.** `solve` destroys `matrix`
			// and `rhs`, so this cannot be deferred; and the residual only ever changes a
			// decision in the one state where the delta is ambiguous, so computing it in any
			// other iteration would be cost for nothing.
			const residualAtCurrent = this.limitedIterate
				? relativeResidual(matrix, rhs, current, scratch.clearPairs, size)
				: Number.POSITIVE_INFINITY;
			if (sparse === undefined) {
				scratch.denseDirty = true;
				solve(matrix, rhs, next);
			} else {
				this.scheduleSolves += 1;
				if (
					runSparseSchedule(
						sparse.schedule,
						matrix,
						rhs,
						sparse.values,
						sparse.rhs,
						sparse.factors,
						next,
					)
				) {
					sparse.consecutiveFallbacks = 0;
				} else {
					this.scheduleFallbacks += 1;
					sparse.consecutiveFallbacks += 1;
					if (
						sparse.consecutiveFallbacks >= SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT
					) {
						// The old shape abandoned here, silently dense for the rest
						// of the run after paying for both solvers on every one of
						// the 64 trips. Re-pivot once from the current matrix
						// instead: a control position the operating-point matrix
						// never showed can still suit a value-aware order, and
						// only a refused or still-disagreeing re-pivot abandons.
						// `solve` destroys `matrix` and `rhs`, so the re-pivot's
						// inputs are snapshotted first -- once per order, on this
						// trip only.
						if (!sparse.repivotAttempted) {
							sparse.repivotAttempted = true;
							const matrixCopy = matrix.map((row) => [...row]);
							const rhsCopy = [...rhs];
							scratch.denseDirty = true;
							solve(matrix, rhs, next);
							if (
								!this.adoptMidRunRepivot(block.id, sparse, matrixCopy, rhsCopy, next)
							) {
								this.sparseSchedules.delete(block.id);
								this.abandonedSchedules.add(block.id);
							}
						} else {
							this.sparseSchedules.delete(block.id);
							this.abandonedSchedules.add(block.id);
							scratch.denseDirty = true;
							solve(matrix, rhs, next);
						}
					} else {
						scratch.denseDirty = true;
						solve(matrix, rhs, next);
					}
				}
			}
			if (relaxing) {
				for (let i = 0; i < size; i++) {
					next[i] = current[i] + alpha * (next[i] - current[i]);
				}
			}
			const delta = maxAbsDifference(next, current);
			worstNode = worstDifferenceIndex(next, current);
			worstDelta = delta;
			if (delta < bestDelta * 0.999) {
				bestDelta = delta;
				noImprovement = 0;
				if (relaxing) {
					if (delta < 0.05) {
						relaxing = false;
						alpha = NEWTON_RELAXATION_FACTOR;
					} else {
						alpha = Math.min(NEWTON_RELAXATION_FACTOR, alpha * 1.15);
					}
				}
			} else {
				noImprovement += 1;
				if (!relaxing) {
					if (
						noImprovement >= NEWTON_NON_CONTRACTING_LIMIT &&
						iteration >= NEWTON_RELAXATION_EARLIEST_ITERATION
					) {
						relaxing = true;
						noImprovement = 0;
					}
				} else {
					if (noImprovement >= NEWTON_NON_CONTRACTING_LIMIT) {
						alpha = Math.max(0.2, alpha * 0.7);
						noImprovement = 0;
					}
				}
			}
			// Track how many iterations hit a limiter (for cap-hit diagnostics).
			// Gated: see `limiterTrace`.
			if (this.limiterTrace) {
				this.limitedIterationCount += this.limitedIterate ? 1 : 0;
				this.limitedIterationPerSample.push(this.limitedIterate ? 1 : 0);
			}
			// A limited iterate must not satisfy the tolerance, which is SPICE's rule and
			// not a refinement of it. A limiter damps the step towards the solution, so
			// while it is active the iterate is *by construction* somewhere short of it --
			// and a small delta then measures the limiter's step size rather than the
			// residual. The op-amp case is the sharp one: at a gain of 1e5 the step cap is
			// ~1.8e-4 V of differential, and deep in `tanh` saturation that moves the
			// output by far less than the 1e-9 tolerance, so every clamped iteration looks
			// converged. Measured before this clause: 22 of 52 corpus packets declared
			// convergence while clamping, several on nearly every sample while reporting
			// `nonConvergedSamples: 0`. That made the held-and-counted guarantee below
			// void exactly where it was load-bearing.
			// **Three states, not two.** The old test was `delta small AND the limiter did not
			// fire`, which collapses two opposite situations into "keep iterating":
			//
			//   delta small, residual small -> a solution the limiter flag was rejecting.
			//                                  `marshall-1959-super-lead-plexi` spent 654 samples
			//                                  here, burning the whole cap on an answer it already
			//                                  had -- bit-accurate to -268 dB the entire time.
			//   delta small, residual large -> STALLED against a non-smooth boundary.
			//                                  `vox-ac30-top-boost` sits here on 2,245 of 2,392
			//                                  samples, and its audio is wrong by the size of its
			//                                  own signal. **A delta-only detector accepts this**,
			//                                  turning a fidelity defect into a silent pass.
			//   delta large                 -> still iterating, unchanged.
			//
			// The residual is what separates them, and a stalled sample stops rather than
			// spending the remaining budget on an iterate that has already stopped moving.
			const withinDelta = withinTolerance(next, current);
			if (withinDelta && this.limitedIterate && !block.linear) {
				lastBlockedResidual = residualAtCurrent;
			}
			const convergedNow =
				block.linear || (withinDelta && !this.limitedIterate);
			// Swap so `current` names the iterate just solved for the next pass (or for the
			// return below), and the buffer that held the previous iterate becomes free for
			// `solve` to overwrite next time -- the same role its discarded allocation used
			// to play, without allocating.
			const swap = current;
			current = next;
			next = swap;
			if (convergedNow) {
				converged = true;
				break;
			}
			// **A fold is reseeded on the other rail, once, inside this solve.** See
			// `OPAMP_FOLD_STREAK`. Only the Newton *guess* moves -- the folded op-amp's output
			// node and its limiter history -- never the pole's raw state or any reactive state,
			// so what converges is still the circuit's equations. No restart and no second
			// budget: a sample that never folds takes exactly the path it always did.
			// Measured on `boss-tr-2`: held samples 51 -> 0 in 3 s, peak iterations 1024 -> 52.
			// `limitedOpamp` is written by the stamps in this iteration; TS narrows it to `null`
			// from the reset above, so it is read through its declared type.
			const limitedOpamp = this.limitedOpamp as ReferenceRuntime["limitedOpamp"];
			foldStreak = limitedOpamp?.folded === true ? foldStreak + 1 : 0;
			if (!dc && !foldReseeded && limitedOpamp !== null && foldStreak >= OPAMP_FOLD_STREAK) {
				foldReseeded = true;
				foldStreak = 0;
				const wasHigh =
					(start[limitedOpamp.output] ?? limitedOpamp.centre) >= limitedOpamp.centre;
				current[limitedOpamp.output] = wasHigh
					? limitedOpamp.railLow
					: limitedOpamp.railHigh;
				this.opampHistory.set(limitedOpamp.key, {
					differential: wasHigh ? -limitedOpamp.band : limitedOpamp.band,
					step: 0,
					cap: limitedOpamp.maxStep,
				});
				// A clean Newton run from the reseeded point: the damping earned by the two-cycle
				// would otherwise slow the march to the new rail.
				relaxing = false;
				alpha = NEWTON_RELAXATION_FACTOR;
				bestDelta = Number.POSITIVE_INFINITY;
				noImprovement = 0;
			}
		}
		if (!converged && !block.linear && Number.isFinite(lastBlockedResidual)) {
			const stalled = lastBlockedResidual > NEWTON_RESIDUAL_TOLERANCE;
			if (stalled) this.stalledSamples += 1;
			else this.solvedButFlaggedSamples += 1;
			// **Only the flagged verdict buys a probation, and the residual is the reason.**
			// Flagged means the delta is small AND the residual is under
			// `NEWTON_RESIDUAL_TOLERANCE`: the equations are satisfied, the iterate IS a root,
			// and the only objection is a limiter flag -- so more iterations provably cannot
			// improve it, and `marshall-1959-super-lead-plexi` keeps the 7.8x this saves it.
			// A **stalled** sample is the opposite claim: wedged against a non-smooth boundary
			// with the equations unsatisfied, which says nothing about the next sample, whose
			// operating region is different. Cutting the budget there is how `mxr-blue-box`
			// turned one non-converged sample into 86 (measured 2026-09-19, 4800 samples).
			// A DC pass never starts one either: see the budget site above.
			if (!dc && !stalled) {
				this.unproductiveUntilSample.set(
					block.id,
					this.elapsedSamples + NEWTON_UNPRODUCTIVE_PROBATION_SAMPLES,
				);
			}
		}
		{
			const census = this.blockNewtonCensus.get(block.id);
			if (census === undefined) {
				this.blockNewtonCensus.set(block.id, {
					samples: 1,
					exhausted: converged ? 0 : 1,
					peakIterations: used,
				});
			} else {
				census.samples += 1;
				if (!converged) census.exhausted += 1;
				if (used > census.peakIterations) census.peakIterations = used;
			}
		}
		if (predictorPass) {
			this.recordNewtonSolution(block.id, current, converged, used);
		}
		return { solution: current, converged, used, worstNode, worstDelta };
	}

	/**
	 * Build-order step 6, vertical slice: the part of a block's matrix that is the same for
	 * every Newton iteration of this sample -- every stamp `newtonPortRowsOf` calls linear,
	 * plus `gmin` and the ground pin, in exactly `iterate`'s own order. Rebuilt once per
	 * sample (not once per iteration, and not once per program) because a control-bearing
	 * stamp's conductance can move between samples even though it never moves within one.
	 *
	 * Nonlinear stamps are skipped entirely here -- their current lives only in
	 * `reduceNonlinearContribution`, re-evaluated at the current iterate every time, exactly
	 * as `iterate` re-evaluates them every time. `solution` is passed as an all-zero
	 * placeholder because every linear stamp kind ignores it (verified by inspection of
	 * `applyStamp`'s own linear cases); a nonlinear stamp reaching here would read garbage,
	 * which is exactly why it must never be one of the stamps this loop calls.
	 */
	private buildLinearBackground(
		block: Extract<Block, { kind: "mna" }>,
		linearStamps: readonly Stamp[],
		dt: number,
		state: number[],
		input: number,
		dc: boolean,
		gmin: number,
		sourceScale: number,
		blockIndex: number,
		matrix: number[][],
		rhs: number[],
	): void {
		const size = block.nodeCount + block.auxCount;
		const base = this.baseMatrices.get(block.id);
		const isStandardAudioPass =
			!dc && sourceScale === 1 && gmin === GMIN_SIEMENS && base !== undefined;

		if (isStandardAudioPass) {
			for (let row = 0; row < size; row += 1) {
				const dstRow = matrix[row] as number[];
				const srcRow = base.matrix[row] as number[];
				for (let column = 0; column < size; column += 1) {
					dstRow[column] = srcRow[column] as number;
				}
				rhs[row] = base.rhs[row] as number;
			}

			for (const stamp of base.nonConstantLinearStamps) {
				this.applyStamp(
					stamp,
					matrix,
					rhs,
					block,
					dt,
					state,
					EMPTY_SOLUTION,
					input,
					false,
					1,
					blockIndex,
				);
			}

			// Ground is the reference: node 0 is pinned to zero volts.
			for (let column = 0; column < size; column += 1) {
				(matrix[0] as number[])[column] = 0;
			}
			(matrix[0] as number[])[0] = 1;
			rhs[0] = 0;
		} else {
			for (let row = 0; row < size; row += 1) {
				(matrix[row] as number[]).fill(0);
				rhs[row] = 0;
			}
			// No linear stamp kind reads `solution` (verified against every case `applyStamp`
			// dispatches to `newtonPortRowsOf(...) === null` for), so an empty placeholder is
			// safe here and cheaper than allocating a real one. A stamp that did read it would
			// be a nonlinear kind by definition and would never be in `linearStamps`.
			//
			// `linearStamps` is precomputed once in `prepare()`, not re-derived from
			// `block.stamps` here -- measured directly (`--cpu-prof`): calling
			// `newtonPortRowsOf` per stamp per sample (or, worse, per Newton iteration) was the
			// dominant cost in an earlier version of this path, because every nonlinear-kind
			// call allocates a fresh row array that is thrown away immediately.
			for (const stamp of linearStamps) {
				this.applyStamp(
					stamp,
					matrix,
					rhs,
					block,
					dt,
					state,
					EMPTY_SOLUTION,
					input,
					dc,
					sourceScale,
					blockIndex,
				);
			}
			for (let node = 1; node < block.nodeCount; node += 1) {
				(matrix[node] as number[])[node] += gmin;
			}
			for (let column = 0; column < size; column += 1) {
				(matrix[0] as number[])[column] = 0;
			}
			(matrix[0] as number[])[0] = 1;
			rhs[0] = 0;
		}
	}

	/**
	 * Build-order step 6, vertical slice: `iterate`'s exact per-sample contract, produced by
	 * symbolic elimination around the block's nonlinear devices instead of a full-system
	 * Newton solve every iteration.
	 *
	 * **The method, in one paragraph.** Partition every row into `P` (the union of rows a
	 * nonlinear law writes, `computeNewtonPortRows`) and `L` (everything else). `M_lin[L][L]`
	 * is eliminated once per sample, carrying the `P`-count port-response columns and the
	 * constant column `b_L` together (`solveMulti`) -- this is the factorisation `iterate`
	 * pays for fresh on every Newton iteration, paid here exactly once. `K_reduced` and
	 * `u_reduced` fold `M_lin[P][P]` and `b_lin[P]` against that response, giving the small
	 * `|P| x |P|` system every Newton iteration on the *port* voltages actually solves;
	 * `reduceNonlinearContribution` adds each iteration's own nonlinear current and Jacobian,
	 * chain-ruled through the same response so an L-node a law reads (an op-amp's inputs, a
	 * FET's gate) is exactly as correct as one it does not. `x_L` is reconstructed from the
	 * current port voltages every iteration via one cheap matrix-vector product, never solved
	 * for directly, so every node's value is always available to the laws and to the
	 * convergence test without re-deriving anything.
	 *
	 * **What must stay identical to `iterate` for the exactness gate to mean anything**: the
	 * convergence test (`withinTolerance` plus `!limitedIterate`, same functions), the
	 * limiter/history side effects (the same `applyStamp`, the same history maps, so a
	 * limited iterate here is limited for the identical reason it would be in `iterate`), and
	 * the return contract (`solution` is the latest iterate whether or not it converged,
	 * matching `iterate`'s own "advance the clock even on failure" rule one level up in
	 * `processBlock`).
	 */
	private iterateEliminated(
		block: Extract<Block, { kind: "mna" }>,
		input: number,
		dt: number,
		state: number[],
		start: number[],
		dc: boolean,
		gmin: number = GMIN_SIEMENS,
		sourceScale: number = 1,
	): {
		solution: number[];
		converged: boolean;
		used: number;
		worstNode: number;
		worstDelta: number;
	} {
		const ports = this.eliminationPorts.get(block.id);
		const scratch = this.eliminationScratch.get(block.id);
		if (ports === undefined || scratch === undefined) {
			throw new RuntimeError(
				`no elimination scratch for block "${block.id}" -- prepare() was not called`,
			);
		}
		const {
			ports: portRows,
			portIndexOf,
			lRows,
			lIndexOf,
			size,
			linearStamps,
			nonlinearStamps,
		} = ports;
		const portCount = portRows.length;
		const lCount = lRows.length;
		const blockIndex = this.blockIndexById.get(block.id) ?? 0;

		this.buildLinearBackground(
			block,
			linearStamps,
			dt,
			state,
			input,
			dc,
			gmin,
			sourceScale,
			blockIndex,
			scratch.linear,
			scratch.linearRhs,
		);

		// Control-generation-cached: `M_lin[L][L]`'s factorisation, `Z` and `K_reduced` all
		// depend only on control positions, never on capacitor state or the time-varying
		// input, so they are rebuilt only when `setControl` has bumped `controlGeneration`
		// since they were last built -- see `setControl`'s and this scratch map's own
		// comments for why a stale reuse is impossible by construction, not merely unlikely.
		if (
			dc ||
			gmin !== GMIN_SIEMENS ||
			scratch.cachedGeneration !== this.controlGeneration
		) {
			for (let i = 0; i < lCount; i += 1) {
				const globalRow = lRows[i] as number;
				const sourceRow = scratch.linear[globalRow] as number[];
				const llRow = scratch.ll[i] as number[];
				for (let j = 0; j < lCount; j += 1) {
					llRow[j] = sourceRow[lRows[j] as number] as number;
				}
			}
			const { permutation } = factorLU(scratch.ll);
			for (let i = 0; i < lCount; i += 1) {
				scratch.permutation[i] = permutation[i] as number;
			}

			// Z's columns: for each port, the L-response to a unit current injected there,
			// via the now-cached factorisation -- one `O(L^2)` substitution per port instead
			// of a fresh `O(L^3)` elimination each needed before this cache existed.
			for (let p = 0; p < portCount; p += 1) {
				const globalP = portRows[p] as number;
				for (let i = 0; i < lCount; i += 1) {
					scratch.zRhsScratch[i] = (
						scratch.linear[lRows[i] as number] as number[]
					)[globalP] as number;
				}
				solveLU(
					scratch.ll,
					scratch.permutation,
					scratch.zRhsScratch,
					scratch.z[p] as number[],
				);
			}

			// K_reduced = M_lin[P][P] - M_lin[P][L] @ Z -- fixed for as long as the cache is
			// valid, unlike `u_reduced` below, which needs this sample's own `b_L`.
			for (let p = 0; p < portCount; p += 1) {
				const globalP = portRows[p] as number;
				const sourceRow = scratch.linear[globalP] as number[];
				const kRow = scratch.kReduced[p] as number[];
				for (let j = 0; j < portCount; j += 1) {
					kRow[j] = sourceRow[portRows[j] as number] as number;
				}
				for (let i = 0; i < lCount; i += 1) {
					const mPL = sourceRow[lRows[i] as number] as number;
					if (mPL === 0) {
						continue;
					}
					for (let j = 0; j < portCount; j += 1) {
						kRow[j] -= mPL * ((scratch.z[j] as number[])[i] as number);
					}
				}
			}
			if (!dc && gmin === GMIN_SIEMENS) {
				scratch.cachedGeneration = this.controlGeneration;
			} else {
				scratch.cachedGeneration = -1;
			}
		}

		// z0 and u_reduced: always fresh, since `b_L`/`b_P` depend on this sample's own
		// capacitor state and input, which the cached factorisation above does not carry.
		for (let i = 0; i < lCount; i += 1) {
			scratch.z0Rhs[i] = scratch.linearRhs[lRows[i] as number] as number;
		}
		solveLU(scratch.ll, scratch.permutation, scratch.z0Rhs, scratch.z0);
		for (let p = 0; p < portCount; p += 1) {
			const globalP = portRows[p] as number;
			const sourceRow = scratch.linear[globalP] as number[];
			let u = scratch.linearRhs[globalP] as number;
			for (let i = 0; i < lCount; i += 1) {
				const mPL = sourceRow[lRows[i] as number] as number;
				if (mPL === 0) {
					continue;
				}
				u -= mPL * (scratch.z0[i] as number);
			}
			scratch.uReduced[p] = u;
		}

		const reconstructFull = (y: readonly number[], full: number[]): void => {
			for (let i = 0; i < lCount; i += 1) {
				let value = scratch.z0[i] as number;
				for (let p = 0; p < portCount; p += 1) {
					value -= ((scratch.z[p] as number[])[i] as number) * (y[p] as number);
				}
				full[lRows[i] as number] = value;
			}
			for (let p = 0; p < portCount; p += 1) {
				full[portRows[p] as number] = y[p] as number;
			}
		};

		// The predicted start (see `newtonStartHistory`), falling back to `start`: the same
		// rule and the same `oversample > 1` gate as `iterate`, applied through the port
		// unknowns the reduced solve iterates on.
		const predictorPass =
			this.oversample > 1 &&
			!dc &&
			sourceScale === 1 &&
			gmin === GMIN_SIEMENS &&
			!block.linear;
		const seed = (predictorPass ? this.predictedNewtonStart(block.id, size) : null) ?? start;
		for (let p = 0; p < portCount; p += 1) {
			scratch.yCurrent[p] = seed[portRows[p] as number] ?? 0;
		}
		reconstructFull(scratch.yCurrent, scratch.fullCurrent);

		const iterations = this.maxNewtonIterations;
		let converged = false;
		let used = 0;
		let worstNode = -1;
		let worstDelta = 0;
		let current = scratch.fullCurrent;
		let next = scratch.fullNext;
		let yCurrentArr = scratch.yCurrent;
		let yNextArr = scratch.yNext;

		let relaxing = false;
		let alpha = NEWTON_RELAXATION_FACTOR;
		let bestDelta = Number.POSITIVE_INFINITY;
		let noImprovement = 0;
		for (let iteration = 0; iteration < iterations; iteration += 1) {
			used = iteration + 1;
			this.limitedIterate = false;
			this.limitedBy = null;
			this.limitedOpamp = null;

			for (let p = 0; p < portCount; p += 1) {
				(scratch.rawNl[portRows[p] as number] as number[]).fill(0);
				scratch.rawNlRhs[portRows[p] as number] = 0;
			}
			// `nonlinearStamps` precomputed once in `prepare()` -- see `linearStamps`'s own
			// comment in the port-analysis cache for why re-deriving this per iteration was
			// the dominant cost of an earlier version.
			for (const stamp of nonlinearStamps) {
				// Global indices throughout, unmodified -- exactly the call `iterate` makes.
				// Only port rows are ever written (`computeNewtonPortRows`'s guarantee), so
				// this scratch needs no remapping and no proxy: it is read back below at
				// exactly the rows it was zeroed at, and nowhere else.
				this.applyStamp(
					stamp,
					scratch.rawNl,
					scratch.rawNlRhs,
					block,
					dt,
					state,
					current,
					input,
					dc,
					sourceScale,
					blockIndex,
				);
			}

			for (let p = 0; p < portCount; p += 1) {
				const jacobianRow = scratch.reducedJacobian[p] as number[];
				const kRow = scratch.kReduced[p] as number[];
				for (let j = 0; j < portCount; j += 1) {
					jacobianRow[j] = kRow[j] as number;
				}
				let rhsValue = scratch.uReduced[p] as number;
				const rawRow = scratch.rawNl[portRows[p] as number] as number[];
				for (let c = 0; c < size; c += 1) {
					const value = rawRow[c] as number;
					if (value === 0) {
						continue;
					}
					const portIndex = portIndexOf[c] as number;
					if (portIndex !== -1) {
						jacobianRow[portIndex] += value;
						continue;
					}
					const lIndex = lIndexOf[c] as number;
					for (let j = 0; j < portCount; j += 1) {
						jacobianRow[j] -=
							value * ((scratch.z[j] as number[])[lIndex] as number);
					}
					rhsValue -= value * (scratch.z0[lIndex] as number);
				}
				rhsValue += scratch.rawNlRhs[portRows[p] as number] as number;
				scratch.reducedRhs[p] = rhsValue;
			}

			solve(scratch.reducedJacobian, scratch.reducedRhs, yNextArr);
			if (relaxing) {
				for (let i = 0; i < portCount; i += 1) {
					yNextArr[i] =
						(yCurrentArr[i] as number) +
						alpha * ((yNextArr[i] as number) - (yCurrentArr[i] as number));
				}
			}
			reconstructFull(yNextArr, next);

			const delta = maxAbsDifference(next, current);
			worstNode = worstDifferenceIndex(next, current);
			worstDelta = delta;
			if (delta < bestDelta * 0.999) {
				bestDelta = delta;
				noImprovement = 0;
				if (relaxing) {
					if (delta < 0.05) {
						relaxing = false;
						alpha = NEWTON_RELAXATION_FACTOR;
					} else {
						alpha = Math.min(NEWTON_RELAXATION_FACTOR, alpha * 1.15);
					}
				}
			} else {
				noImprovement += 1;
				if (!relaxing) {
					if (
						noImprovement >= NEWTON_NON_CONTRACTING_LIMIT &&
						iteration >= NEWTON_RELAXATION_EARLIEST_ITERATION
					) {
						relaxing = true;
						noImprovement = 0;
					}
				} else {
					if (noImprovement >= NEWTON_NON_CONTRACTING_LIMIT) {
						alpha = Math.max(0.2, alpha * 0.7);
						noImprovement = 0;
					}
				}
			}
			// Track how many iterations hit a limiter (for cap-hit diagnostics).
			// Gated: see `limiterTrace`.
			if (this.limiterTrace) {
				this.limitedIterationCount += this.limitedIterate ? 1 : 0;
				this.limitedIterationPerSample.push(this.limitedIterate ? 1 : 0);
			}
			const convergedNow =
				withinTolerance(next, current) && !this.limitedIterate;

			const swapFull = current;
			current = next;
			next = swapFull;
			const swapY = yCurrentArr;
			yCurrentArr = yNextArr;
			yNextArr = swapY;

			if (convergedNow) {
				converged = true;
				break;
			}
		}
		{
			const census = this.blockNewtonCensus.get(block.id);
			if (census === undefined) {
				this.blockNewtonCensus.set(block.id, {
					samples: 1,
					exhausted: converged ? 0 : 1,
					peakIterations: used,
				});
			} else {
				census.samples += 1;
				if (!converged) census.exhausted += 1;
				if (used > census.peakIterations) census.peakIterations = used;
			}
		}
		if (predictorPass) {
			this.recordNewtonSolution(block.id, current, converged, used);
		}
		return { solution: current, converged, used, worstNode, worstDelta };
	}

	/**
	 * Solve every block at DC and start the reactive elements from that answer.
	 *
	 * **Why this exists.** A run that starts from zero state starts with every capacitor
	 * at 0 V, which is a *short*, and a short across a bias network accidentally supplies
	 * a bias path the circuit does not have. So a stage that cannot hold an operating
	 * point still has real gain for the first fraction of a second, and then cuts off as
	 * the capacitors charge. Measured on named pedals: `ibanez-ts808` renders a gain of
	 * 0.748 cold, 0.206 after half a second, and 0.004 after two -- three different
	 * answers about one pedal, only the last of which is the pedal.
	 *
	 * At DC a capacitor is an open circuit and an inductor is a short, which is the only
	 * difference between this solve and a sample. The result is written back as the state
	 * a settled circuit would have reached: a capacitor holding its DC voltage and
	 * carrying no current, an inductor with no voltage across it and carrying the DC
	 * current the solve found.
	 *
	 * **What this does not do:** make a badly biased circuit sound right. If a packet has
	 * no DC path to a base, the operating point says so immediately instead of after two
	 * seconds of charging. That is the point -- it turns a wait into an answer -- but a
	 * recovered pedal is not among the things it promises.
	 *
	 * A block that fails to converge here keeps zero state, which is exactly the old
	 * behaviour, and is counted so the failure is never silent.
	 */
	private solveOperatingPoint(): void {
		const dt = 1 / (this.sampleRate as number);
		for (const block of this.program.blocks) {
			if (block.kind !== "mna") {
				continue;
			}
			const state = this.capacitorState.get(block.id) as number[];
			const size = block.nodeCount + block.auxCount;
			// The program's `.nodeset`, and the reason it is ROM data rather than a console
			// convention: a circuit with more than one DC solution has its answer *chosen* by
			// where the solve starts, and `fill(0)` chooses the symmetric one. A cross-coupled
			// pair started from zero returns the unstable midpoint between its two latched
			// states -- self-consistent, converged, and a state no physical pedal holds.
			//
			// These are hints, not forced voltages: Newton still solves the circuit from here.
			const start = new Array<number>(size).fill(0);
			for (const seed of block.operatingPointSeeds) {
				if (seed.node > 0 && seed.node < size) {
					start[seed.node] = seed.volts;
				}
			}
			const solved = this.solveOperatingPointForBlock(block, dt, state, start);
			if (solved === null) {
				this.operatingPointFailures += 1;
				continue;
			}
			const solution = solved;
			for (const stamp of block.stamps) {
				if (stamp.kind === "dc-source") {
					// The aux unknown is this supply's branch current; sign is irrelevant to
					// "how much", so compare magnitudes.
					this.operatingPointSupplyAmps = Math.max(
						this.operatingPointSupplyAmps,
						Math.abs(solution[block.nodeCount + stamp.sourceIndex] ?? 0),
					);
					continue;
				}
				if (stamp.kind === "capacitor") {
					// Holding its DC voltage and carrying no current. With this state the
					// companion source is exactly G*V, so the element contributes no
					// current at the operating point -- an open circuit, which is what a
					// capacitor is at DC.
					state[stamp.stateIndex] =
						(solution[stamp.a] ?? 0) - (solution[stamp.b] ?? 0);
					state[stamp.stateIndex + 1] = 0;
					continue;
				}
				if (stamp.kind === "inductor") {
					// The dual: no voltage across it, carrying whatever current the DC
					// short passed. Read from the solved voltages rather than tracked
					// separately, because the short's conductance is what defined it.
					state[stamp.stateIndex] = 0;
					state[stamp.stateIndex + 1] =
						((solution[stamp.a] ?? 0) - (solution[stamp.b] ?? 0)) /
						DC_INDUCTOR_SHORT_OHMS;
				}
			}
			// A relaxation oscillator's DC solve lands on the unstable midpoint between
			// its two latched states -- self-consistent, converged, and a state no
			// physical pedal holds. A small deterministic perturbation on each reactive
			// element's voltage breaks the symmetry and lets the transient walk to one
			// of the two stable states. The magnitude is small enough (0.1% of a 1 V
			// swing) to be invisible in steady-state for circuits that are not
			// self-oscillating.
			for (let si = 0; si < state.length; si += 2) {
				state[si] += 5e-6 * ((si >> 1) + 1);
			}
			// A copy, for the same reason `processBlock`'s equivalent `set` copies: `solution`
			// here is `solveOperatingPointForBlock`'s returned answer, itself one of `iterate`'s
			// two per-block ping-pong scratch buffers. Storing the live reference would leave
			// this operating point vulnerable to being overwritten by the first sample's Newton
			// iterations before a later held sample ever gets to read it back out.
			this.nodeVoltages.set(block.id, solution.slice());
			// Seed the op-amp pole's raw state from the solved OUTPUT, so the transient
			// starts exactly where the operating point is instead of walking there across
			// the pole's ~16 ms time constant. The raw state is the compensation-node
			// voltage the tanh output maps from, so the consistent seed is its inverse
			// map of the solved output -- not the full-gain product of the solved
			// differential, which Newton only knows to millivolts while the raw needs
			// microvolts: gain×diff seeds every linear stage as railed (tanh(±large)),
			// and a weak DC loop cannot walk that back. Clamped at ±tanh(8), which is
			// exactly the ±8-halfSwing bound, so saturated stages seed identically.
			const opampBlockIndex = this.blockIndexById.get(block.id) ?? 0;
			for (const stamp of block.stamps) {
				if (stamp.kind !== "ideal-opamp") {
					continue;
				}
				if (stamp.railHigh === null || stamp.railLow === null) {
					continue;
				}
				const key = packHistoryKey3(
					opampBlockIndex,
					stamp.plus,
					stamp.minus,
					stamp.output,
				);
				const halfSwing = opAmpHalfSwing(stamp.railHigh, stamp.railLow);
				const centre = (stamp.railHigh + stamp.railLow) / 2;
				const unit = Math.max(
					-Math.tanh(8),
					Math.min(
						Math.tanh(8),
						((solution[stamp.output] ?? centre) - centre) / halfSwing,
					),
				);
				this.opampRawState.set(key, halfSwing * Math.atanh(unit));
			}
		}
		// Seed each macro's DC estimate from the solved operating point at its audioIn tap,
		// so the static DC bias does not inject a spurious transient into the delay line buffer.
		//
		// **Restored deliberately, and deliberately without two things that were briefly added
		// beside it.** A change that also seeded `macroOutputVolts` from the tap and made the
		// per-sample output `state.dcEstimate + (s0 + frac * (s1 - s0))` broke 7 compiler tests
		// and 1 runtime test; the revert that followed removed this seeding too, which is
		// separate work and is not what was failing. The three are independent:
		//
		//   - seeding `dcEstimate` (here) avoids a startup transient and breaks nothing;
		//   - restoring DC to the output every sample contradicts what the tests pin, because
		//     `state.buffer` deliberately stores AC only -- see the coupling-capacitor comment
		//     in the kernel -- so the output is the delayed AC and carries no DC by design;
		//   - the failures were not thresholds needing relaxation. `macro-audio-source` stamps
		//     this value as a source into the downstream block, so adding DC to it injects a
		//     bias into a node that previously received none. That is a corpus-wide operating
		//     point change and it needs a render census, not a test edit.
		//
		// If the DC-coupled-downstream case is real, the bias belongs at the output stage that
		// sets it, not on the input's own `dcEstimate` tracked through a 1 s filter.
		for (const block of this.program.blocks) {
			if (block.kind !== "composed") {
				continue;
			}
			if (block.audioIn !== null) {
				const tap =
					this.nodeVoltages.get(block.audioIn.block)?.[block.audioIn.node] ?? 0;
				{
					// Delay-line compositions only: a reverb composition owns no DC fields,
					// so it seeds nothing. Lines mark delay-line behavior; filter-only
					// compositions have none.
					const dc = this.composedDcState.get(block.id);
					// "Is this a delay-line composition?" -- a reverb composition owns no DC
					// fields and seeds nothing. Asked across every position, because the block
					// is one or the other whichever program is selected.
					const ownsDelayLines = block.positions.some(
						(candidate) => Object.keys(candidate.lines).length > 0,
					);
					if (dc !== undefined && ownsDelayLines) {
						dc.dcEstimate = tap;
						dc.dcOperatingPoint = tap;
					}
				}
				// Delay lines start filled with the settled input minus the
				// operating point the macro source adds back: at the operating
				// point the line has held its input forever, and pushes store
				// AC (input terms enter stripped, above), so the settled line
				// content is the AC rest, not the raw tap. Filling raw tap
				// here would double-count DC through the first repeat exactly
				// as an unstripped push would. Same tap, same site as the
				// seeding above -- one site, not a second mechanism -- and
				// lines only, so filter-only compositions are untouched.
				const fillValue =
					tap - (this.composedDcState.get(block.id)?.dcOperatingPoint ?? 0);
				for (const [positionIndex, program] of block.positions.entries()) {
					if (!program.ops.some((op) => op.op.startsWith("delay-tap"))) {
						continue;
					}
					const lines = this.composedLineState.get(
						composedStateKey(block.id, positionIndex),
					);
					if (lines === undefined) {
						continue;
					}
					for (const line of lines.values()) {
						line.buffer.fill(fillValue);
					}
				}
			}
		}
	}

	/**
	 * One block's operating point, with **gmin stepping** as a fallback.
	 *
	 * SPICE's first continuation method, and the reason ngspice solves decks this runtime
	 * refuses. A circuit that will not converge at `gmin = 1e-12` is often easy at
	 * `1e-2`, because a hundred-ohm conductance from every node to ground swamps the
	 * nonlinearities and leaves something close to a resistor network. Solve that, use its
	 * answer to seed a solve at a tenth the conductance, and walk down: each problem is a
	 * small deformation of the one already solved, so Newton starts inside the basin.
	 *
	 * `null` when even the final pass at the true `gmin` fails. **A raised gmin is not an
	 * answer** -- it is a different circuit, with leakage the packet does not contain -- so
	 * the walk is only ever a source of initial guesses, and the value returned is always
	 * from a pass at `GMIN_SIEMENS`.
	 *
	 * The direct attempt comes first and short-circuits, so nothing that already converges pays
	 * for either continuation. Before the corpus's declared transistor types were read, all 52
	 * compiled packets solved on that direct pass and neither method was ever reached;
	 * `boss-bd-2-blues-driver` is the first packet measured to need one, and it needs the
	 * *second* -- gmin stepping fails on it and source stepping solves it, which is why both
	 * exist rather than only the first.
	 */
	private solveOperatingPointForBlock(
		block: Extract<Block, { kind: "mna" }>,
		dt: number,
		state: number[],
		start: readonly number[],
	): number[] | null {
		const size = block.nodeCount + block.auxCount;
		const direct = this.iterate(block, 0, dt, state, [...start], true);
		if (direct.converged && direct.solution.every(Number.isFinite)) {
			return direct.solution;
		}
		return (
			this.solveByGminStepping(block, dt, state, size) ??
			this.solveBySourceStepping(block, dt, state, size)
		);
	}

	/**
	 * Continuation on the *devices*: walk down from a conductance that makes the circuit nearly
	 * linear, each step seeding the next.
	 *
	 * That sequencing is the whole mechanism -- the chain of problems is continuous even though
	 * any single jump would not converge on its own.
	 */
	private solveByGminStepping(
		block: Extract<Block, { kind: "mna" }>,
		dt: number,
		state: number[],
		size: number,
	): number[] | null {
		this.clearLimiterHistories();
		let guess = new Array<number>(size).fill(0);
		for (
			let gmin = GMIN_STEPPING_START_SIEMENS;
			gmin > GMIN_SIEMENS;
			gmin /= GMIN_STEPPING_RATIO
		) {
			const pass = this.iterate(block, 0, dt, state, [...guess], true, gmin);
			if (!pass.solution.every(Number.isFinite)) {
				return null;
			}
			// An unconverged intermediate pass is still the best guess available for the next,
			// gentler one, which is why this does not bail here.
			guess = pass.solution;
		}
		const settled = this.iterate(block, 0, dt, state, [...guess], true);
		return settled.converged && settled.solution.every(Number.isFinite)
			? settled.solution
			: null;
	}

	/**
	 * Continuation on the *excitation*: power the circuit up from zero in linear steps.
	 *
	 * SPICE's second method, tried when gmin stepping has already failed, because the two fail on
	 * different circuits. Gmin stepping swamps a nonlinearity with leakage, which works when the
	 * difficulty is a device's curvature; it does nothing about a circuit whose difficulty is
	 * *which* of several states the supplies put it in. With every supply at zero every junction
	 * is unambiguously off -- a state Newton reaches trivially -- and each step up is a small
	 * perturbation of an answer already in hand.
	 *
	 * An unconverged intermediate step still seeds the next, as in the gmin walk. The value
	 * returned is always from a final pass at full supply and the true `gmin`, so a partially
	 * powered circuit is only ever a source of initial guesses and never an answer.
	 *
	 * One inconsistency worth naming: an `ideal-opamp` carries its rails on the stamp, resolved
	 * from the supply set at compile time, so its clipping levels do not ramp with the supplies.
	 * That makes the intermediate steps physically incoherent for an op-amp circuit and does not
	 * affect the result, which is taken at full supply.
	 */
	private solveBySourceStepping(
		block: Extract<Block, { kind: "mna" }>,
		dt: number,
		state: number[],
		size: number,
	): number[] | null {
		this.clearLimiterHistories();
		let guess = new Array<number>(size).fill(0);
		let scale = 0;
		let stepSize = 0.1;
		let failures = 0;
		let stepSnapshot = this.snapshotLimiterHistories();

		while (scale < 1.0) {
			const nextScale = Math.min(1.0, scale + stepSize);
			const pass = this.iterate(
				block,
				0,
				dt,
				state,
				[...guess],
				true,
				GMIN_SIEMENS,
				nextScale,
			);

			if (pass.converged && pass.solution.every(Number.isFinite)) {
				// Step succeeded! Advance scale and increase step size slightly
				scale = nextScale;
				guess = pass.solution;
				stepSize = Math.min(0.2, stepSize * 1.5);
				failures = 0;
				stepSnapshot = this.snapshotLimiterHistories();
			} else {
				// Step failed! Backtrack: restore limiter history and cut step size in half
				this.restoreLimiterHistories(stepSnapshot);
				stepSize /= 2;
				failures += 1;
				if (stepSize < SOURCE_STEPPING_MIN_STEP_SIZE || failures > SOURCE_STEPPING_MAX_FAILURES) {
					return null;
				}
			}
		}

		return guess;
	}

	private clearLimiterHistories(): void {
		this.diodeHistory.clear();
		this.bjtHistory.clear();
		this.fetHistory.clear();
		this.opampHistory.clear();
		this.triodeHistory.clear();
	}

	/**
	 * The Newton start `newtonStartHistory` selects for this block, or `null` to start from
	 * the caller's previous solution (order 0, or a chain too short for the chosen order).
	 * The returned array is the block's reused scratch: read it before the next solve.
	 */
	private predictedNewtonStart(blockId: string, size: number): number[] | null {
		const history = this.newtonStartHistory.get(blockId);
		if (history === undefined || history.order === 0) {
			return null;
		}
		if (history.candidate.length !== size) {
			history.candidate = new Array<number>(size).fill(0);
		}
		return extrapolateNewtonStart(history, history.order, size, history.candidate)
			? history.candidate
			: null;
	}

	/**
	 * Record a finished standard-pass solve: on convergence, score the three candidate
	 * starts the history could have produced against the solution just reached (one fused
	 * pass, no allocation) and keep the best order for the next solve, then rotate the
	 * solution into the history ring; on failure, break the chain.
	 */
	private recordNewtonSolution(
		blockId: string,
		solution: readonly number[],
		converged: boolean,
		used: number,
	): void {
		let history = this.newtonStartHistory.get(blockId);
		if (history === undefined) {
			history = { x1: null, x2: null, x3: null, chain: 0, order: 0, candidate: [] };
			this.newtonStartHistory.set(blockId, history);
		}
		if (!converged) {
			history.chain = 0;
			history.order = 0;
			return;
		}
		const size = solution.length;
		const { x1, x2, x3 } = history;
		const has1 = history.chain >= 1 && x1 !== null && x1.length === size;
		const has2 = has1 && history.chain >= 2 && x2 !== null && x2.length === size;
		const has3 = has2 && history.chain >= 3 && x3 !== null && x3.length === size;
		let error0 = has1 ? 0 : Number.POSITIVE_INFINITY;
		let error1 = has2 ? 0 : Number.POSITIVE_INFINITY;
		let error2 = has3 ? 0 : Number.POSITIVE_INFINITY;
		if (has1) {
			for (let index = 0; index < size; index += 1) {
				const s = solution[index] as number;
				const magnitude = Math.abs(s);
				const v1 = (x1 as number[])[index] as number;
				const ratio0 =
					Math.abs(v1 - s) /
					(NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(v1), magnitude) +
						NEWTON_VOLTAGE_TOLERANCE);
				if (ratio0 > error0) error0 = ratio0;
				if (!has2) continue;
				const v2 = (x2 as number[])[index] as number;
				const guess1 = 2 * v1 - v2;
				const ratio1 =
					Math.abs(guess1 - s) /
					(NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(guess1), magnitude) +
						NEWTON_VOLTAGE_TOLERANCE);
				if (ratio1 > error1) error1 = ratio1;
				if (!has3) continue;
				const guess2 = 3 * v1 - 3 * v2 + ((x3 as number[])[index] as number);
				const ratio2 =
					Math.abs(guess2 - s) /
					(NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(guess2), magnitude) +
						NEWTON_VOLTAGE_TOLERANCE);
				if (ratio2 > error2) error2 = ratio2;
			}
		}
		// Strictly better only: a tie keeps the lower order, so a flat signal (where every
		// order predicts the same point) stays on the previous-solution start.
		let best: 0 | 1 | 2 = 0;
		let bestError = error0;
		if (error1 < bestError) {
			best = 1;
			bestError = error1;
		}
		if (error2 < bestError) {
			best = 2;
		}
		// Smooth-regime gate: extrapolate only after a solve that took at most two
		// iterations (one step and one check -- the floor). A solve that needed more was
		// hunting across a knee, and there a start that is closer in tolerance units is not
		// a cheaper start: measured without this gate, `analog-man-prince-of-tone` cost
		// +50 % iterations at x1 and `boss-hm-2` +39 % (peak 33 -> 63) with every
		// extrapolation scoring better than the previous solution; with it, -4 % and 0 %,
		// and every os4 gain is kept (2026-10-09 report, §3/§12).
		if (used > 2) {
			best = 0;
		}
		history.order = best;
		// Rotate the ring without allocating: the oldest buffer receives the new solution.
		const oldest = history.x3;
		history.x3 = history.x2;
		history.x2 = history.x1;
		history.x1 =
			oldest !== null && oldest.length === size ? oldest : new Array<number>(size).fill(0);
		for (let index = 0; index < size; index += 1) {
			history.x1[index] = solution[index] as number;
		}
		history.chain += 1;
	}

	private snapshotLimiterHistories() {
		return {
			diode: new Map(this.diodeHistory),
			bjt: new Map(this.bjtHistory),
			fet: new Map(this.fetHistory),
			opamp: new Map(this.opampHistory),
			triode: new Map(this.triodeHistory),
		};
	}

	private restoreLimiterHistories(snapshot: ReturnType<typeof this.snapshotLimiterHistories>) {
		this.diodeHistory.clear();
		for (const [k, v] of snapshot.diode) this.diodeHistory.set(k, v);
		this.bjtHistory.clear();
		for (const [k, v] of snapshot.bjt) this.bjtHistory.set(k, v);
		this.fetHistory.clear();
		for (const [k, v] of snapshot.fet) this.fetHistory.set(k, v);
		this.opampHistory.clear();
		for (const [k, v] of snapshot.opamp) this.opampHistory.set(k, v);
		this.triodeHistory.clear();
		for (const [k, v] of snapshot.triode) this.triodeHistory.set(k, v);
	}

	/** Advance reactive memory. Trapezoidal, so it carries both across and through. */
	/**
	 * Allocate one tank's springs. Called on first use rather than in `prepare()` so the buffer
	 * sizes come from the host's actual rate, which is the same reason the macro ring buffer is
	 * sized there: a delay is a time, and only the host knows how many samples that is.
	 */
	private springTankState(
		block: Extract<Block, { kind: "mna" }>,
		stamp: Extract<Stamp, { kind: "spring-reverb" }>,
		sampleRate: number,
	): SpringTankState {
		const key = springKey(block.id, stamp.sourceIndex);
		const existing = this.springState.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const lines = SPRING_TRANSIT_RATIOS.map((ratio) => {
			const samples = Math.max(
				1,
				Math.round(stamp.delaySeconds * ratio * sampleRate),
			);
			// -60 dB after `decaySeconds`, expressed per round trip: the loop runs
			// `decaySeconds / transit` times in that window, so each pass keeps
			// `10 ** (-3 * transit / decaySeconds)`.
			const transit = samples / sampleRate;
			const feedback =
				stamp.decaySeconds > 0
					? 10 ** ((-3 * transit) / stamp.decaySeconds)
					: 0;
			return {
				buffer: new Float64Array(samples),
				writeIndex: 0,
				feedback,
				allpassX: new Float64Array(stamp.dispersionStages),
				allpassY: new Float64Array(stamp.dispersionStages),
			};
		});
		const state: SpringTankState = {
			lines,
			// The impedance step-up the tank's two rated impedances imply -- the same
			// `sqrt(Zout / Zin)` the ideal-transformer model applied before this operator
			// existed. Kept deliberately: it means adding the springs changes *what* the tank
			// does without silently changing the level it does it at, and it avoids inventing
			// a transduction constant no packet states. Mechanical loss is carried by the
			// spring feedback, where it belongs, not folded into this number.
			transduction: Math.sqrt(
				Math.max(stamp.outputOhms, MIN_STAMP_OHMS) /
					Math.max(stamp.inputOhms, MIN_STAMP_OHMS),
			),
			driveX1: 0,
			driveY1: 0,
		};
		this.springState.set(key, state);
		return state;
	}

	/**
	 * One sample of tank motion: drive in, springs run, pickup out.
	 *
	 * Each spring is a delay line with its dispersion chain **inside** the feedback loop, which
	 * is what makes successive reflections progressively more smeared instead of identically
	 * filtered echoes. Stability is structural rather than tuned: an allpass has unity magnitude
	 * at every frequency, so the loop gain is exactly `feedback`, which is below 1 for any
	 * positive decay time.
	 */
	private advanceSpringReverb(
		block: Extract<Block, { kind: "mna" }>,
		stamp: Extract<Stamp, { kind: "spring-reverb" }>,
		solution: readonly number[],
		sampleRate: number,
	): void {
		const state = this.springTankState(block, stamp, sampleRate);
		const rawDrive =
			(solution[stamp.inputPlus] ?? 0) - (solution[stamp.inputMinus] ?? 0);
		// 1-pole high-pass DC blocker (fc ≈ 5 Hz):
		// A physical spring reverb drive transducer is AC-coupled by its audio transformer
		// and magnetic coil, and spring mechanics cannot transmit steady DC displacement.
		// Without DC blocking, any DC plate-to-supply voltage across the reverb send transformer
		// enters the delay loop, where high feedback integrates it into thousands of volts.
		const r = Math.exp((-2 * Math.PI * 5) / sampleRate);
		const drive = rawDrive - state.driveX1 + r * state.driveY1;
		state.driveX1 = rawDrive;
		state.driveY1 = drive;

		let sum = 0;
		for (const line of state.lines) {
			const read = line.buffer[line.writeIndex] ?? 0;
			let dispersed = read;
			for (let stage = 0; stage < line.allpassX.length; stage += 1) {
				// y[n] = a*x[n] + x[n-1] - a*y[n-1]
				const x = dispersed;
				const y =
					SPRING_DISPERSION_COEFFICIENT * x +
					(line.allpassX[stage] ?? 0) -
					SPRING_DISPERSION_COEFFICIENT * (line.allpassY[stage] ?? 0);
				line.allpassX[stage] = x;
				line.allpassY[stage] = y;
				dispersed = y;
			}
			sum += dispersed;
			line.buffer[line.writeIndex] = drive + line.feedback * dispersed;
			line.writeIndex = (line.writeIndex + 1) % line.buffer.length;
		}
		this.springOutputVolts.set(
			springKey(block.id, stamp.sourceIndex),
			(state.transduction * sum) / state.lines.length,
		);
	}

	private advanceReactiveState(
		block: Extract<Block, { kind: "mna" }>,
		state: number[],
		solution: readonly number[],
		dt: number,
	): void {
		for (const stamp of block.stamps) {
			if (stamp.kind === "spring-reverb") {
				// No `?? 48000` here on purpose: a tank's delay is a time, so a missing rate
				// would silently become a one-sample delay -- a wrong answer that still runs.
				if (this.sampleRate === null) {
					throw new RuntimeError(
						"spring-reverb needs the host sample rate; prepare() has not run",
					);
				}
				this.advanceSpringReverb(block, stamp, solution, this.sampleRate);
				continue;
			}
			if (stamp.kind === "inductor") {
				const across = (solution[stamp.a] ?? 0) - (solution[stamp.b] ?? 0);
				const conductance = dt / (2 * stamp.henries);
				const previousAcross = state[stamp.stateIndex] ?? 0;
				const previousCurrent = state[stamp.stateIndex + 1] ?? 0;
				state[stamp.stateIndex] = across;
				state[stamp.stateIndex + 1] =
					previousCurrent + conductance * (across + previousAcross);
				continue;
			}
			if (stamp.kind !== "capacitor") {
				continue;
			}
			const across = (solution[stamp.a] ?? 0) - (solution[stamp.b] ?? 0);
			const conductance = (2 * stamp.farads) / dt;
			const previousAcross = state[stamp.stateIndex] ?? 0;
			const previousCurrent = state[stamp.stateIndex + 1] ?? 0;
			state[stamp.stateIndex] = across;
			state[stamp.stateIndex + 1] =
				conductance * (across - previousAcross) - previousCurrent;
		}
	}

	/**
	 * One per-sample step of the op-amp dominant pole's raw state, advanced from the solved
	 * differential exactly as `advanceReactiveState` advances the capacitor state -- once, after
	 * the solve, on every sample whether it converged or not, because the pole's clock runs
	 * either way. Unrailed op-amps are virtual shorts with no pole state, so they are skipped.
	 */
	private advanceOpAmpRawState(
		block: Extract<Block, { kind: "mna" }>,
		solution: readonly number[],
		dt: number,
	): void {
		const blockIndex = this.blockIndexById.get(block.id) ?? 0;
		for (const stamp of block.stamps) {
			if (stamp.kind !== "ideal-opamp") {
				continue;
			}
			if (stamp.railHigh === null || stamp.railLow === null) {
				continue;
			}
			const key = packHistoryKey3(blockIndex, stamp.plus, stamp.minus, stamp.output);
			const alpha = opAmpPoleAlpha(
				stamp.openLoopGain,
				OPAMP_GAIN_BANDWIDTH_HZ,
				dt,
				this.sampleRate as number,
			);
			// **Bounded at ±8 halfSwings (shipped 2026-09-14, reverted once 2026-08-21).**
			// The bound is anti-windup: a real op-amp's compensation node cannot exceed its
			// supply, and at ±8 halfSwings `tanh` is `0.99999977` -- indistinguishable from
			// the rail -- so the output in every operating regime the deck's TABLE
			// (spanning `±4 halfSwing`) can represent is unchanged.  Measured 2026-08-21:
			// 41 ngspice agrees against 40 (shipped) when matched with the deck emitter's
			// B-source clamp, fixed `boss-od-1`'s gain ratio from `1.2e+9` to `1.021`, and
			// killed 18 signal-independent dead rows.
			//
			// The bound must live on both sides or neither: runtime-only measured 36/10 and
			// deck-only 36/11, both worse than the matched 41/6.  The deck snippet is the
			// B-source in `docs/troubleshootings/pole-state-makes-a-saturated-opamp-row-signal-independent.md`.
			// The iteration-budget blocker on `ibanez-pql` (32.2% unconverged in 2026-08-21)
			// no longer reproduces (0% unconverged as of 2026-09-14).
			const differential = (solution[stamp.plus] ?? 0) - (solution[stamp.minus] ?? 0);
			const previousRaw = this.opampRawState.get(key) ?? 0;
			const halfSwing = opAmpHalfSwing(stamp.railHigh, stamp.railLow);
			this.opampRawState.set(
				key,
				boundOpAmpRaw(
					alpha * stamp.openLoopGain * differential + (1 - alpha) * previousRaw,
					halfSwing,
				),
			);
		}
	}

	private applyStamp(
		stamp: Stamp,
		matrix: number[][],
		rhs: number[],
		block: Extract<Block, { kind: "mna" }>,
		dt: number,
		state: number[],
		solution: readonly number[],
		input: number,
		dc: boolean,
		sourceScale: number,
		/** This block's small integer id -- see `packHistoryKey2`/`3` and `bjtHistory`'s comment. */
		blockIndex: number,
	): void {
		switch (stamp.kind) {
			case "conductance":
				stampConductance(matrix, stamp.a, stamp.b, stamp.siemens);
				break;
			case "controlled-conductance": {
				const control = this.controlsById.get(stamp.control);
				const position = this.positions.get(stamp.control) ?? 0.5;
				const fraction = taperFraction(control?.taper ?? stamp.taper, position);
				// `fraction` is how far the wiper sits from the grounded end, so the
				// element BELOW the wiper carries that share and the element above
				// carries the rest. Getting this backwards inverts every knob in the
				// pedal while still looking like a working control.
				const share = stamp.side === "lower" ? fraction : 1 - fraction;
				// Declared end resistance, spent so the two halves still sum to the track:
				// the wiper travels between the two residuals rather than end to end, so
				// `residual + share * (total - 2 * residual)` on each side adds back to
				// `total` exactly. 0 is an ideal pot and leaves the arithmetic unchanged.
				//
				// The 1 milliohm floor below is unrelated and stays: it is a numerical
				// guard, because a zero-resistance element is a short the matrix cannot
				// express. It is not a physical residual and must not be read as one.
				const residual = stamp.residualOhms;
				const swept =
					residual > 0
						? residual + share * (stamp.totalOhms - 2 * residual)
						: stamp.totalOhms * share;
				const ohms = Math.max(swept, 1e-3);
				stampConductance(matrix, stamp.a, stamp.b, 1 / ohms);
				break;
			}
			case "controlled-resistance": {
				const control = this.controlsById.get(stamp.control);
				const position = this.positions.get(stamp.control) ?? 0.5;
				const fraction = taperFraction(control?.taper ?? stamp.taper, position);
				// One element sweeping min..max, where a pot's half sweeps a share of a
				// fixed total. Floored for the same reason: a zero-resistance element is
				// a short the matrix cannot express.
				const ohms = Math.max(
					stamp.minOhms + fraction * (stamp.maxOhms - stamp.minOhms),
					1e-3,
				);
				stampConductance(matrix, stamp.a, stamp.b, 1 / ohms);
				break;
			}
			case "selector": {
				// The control's 0..1 travel is divided evenly among the throws, so the
				// same position selects the same throw on every pole of the switch.
				const position = this.positions.get(stamp.control) ?? 0;
				const selected = Math.min(
					stamp.throwCount - 1,
					Math.max(0, Math.floor(position * stamp.throwCount)),
				);
				const ohms =
					selected === stamp.throwIndex ? stamp.onOhms : stamp.offOhms;
				stampConductance(matrix, stamp.common, stamp.throwNode, 1 / ohms);
				break;
			}
			case "switch": {
				// A switch is a two-state control: below half travel it is open. The
				// position is still 0..1, so a footswitch and a knob use one mechanism.
				const position = this.positions.get(stamp.control) ?? 0;
				const ohms = position >= 0.5 ? stamp.onOhms : stamp.offOhms;
				stampConductance(matrix, stamp.a, stamp.b, 1 / ohms);
				break;
			}
			case "capacitor": {
				// Open circuit at DC. Stamping nothing is the whole of it: a capacitor
				// passes no steady current, and it is the *absence* of this element that
				// makes the operating point differ from the first transient sample.
				if (dc) {
					break;
				}
				// Trapezoidal companion: G = 2C/dt, with a current source carrying the
				// previous step. This is the only place dt is used, and dt came from
				// prepare(), never from a constant.
				const conductance = (2 * stamp.farads) / dt;
				const previousAcross = state[stamp.stateIndex] ?? 0;
				const previousCurrent = state[stamp.stateIndex + 1] ?? 0;
				const source = conductance * previousAcross + previousCurrent;
				stampConductance(matrix, stamp.a, stamp.b, conductance);
				rhs[stamp.a] = (rhs[stamp.a] ?? 0) + source;
				rhs[stamp.b] = (rhs[stamp.b] ?? 0) - source;
				break;
			}
			case "inductor": {
				// A short at DC, and a resistive one rather than an infinite conductance.
				// The exact DC limit of dt/2L is unbounded, and a matrix mixing 1e11 S
				// against gmin's 1e-12 S has a condition number double precision cannot
				// carry -- so the short is expressed at the same magnitude the compiler
				// already uses for a closed switch, where the solve stays well behaved.
				// **A winding with a declared DC resistance IS that resistance at DC**, which is
				// both physically right and better conditioned than the fudge below: the copper
				// resistance of a choke or an output-transformer primary is exactly what sets the
				// operating point of the rail it feeds.
				const windingOhms = stamp.seriesResistanceOhms;
				if (dc) {
					stampConductance(
						matrix,
						stamp.a,
						stamp.b,
						windingOhms !== undefined && windingOhms > 0
							? 1 / windingOhms
							: 1 / DC_INDUCTOR_SHORT_OHMS,
					);
					break;
				}
				// Trapezoidal companion, the dual of the capacitor: G = dt/2L with a
				// current source carrying the previous step. dt comes from prepare().
				//
				// **With a series resistance the branch is R + sL, not sL**, and the companion
				// changes rather than gaining a second element -- putting a resistor in series
				// would need an internal node this lowering does not create. Solving
				// `v = R*i + L*di/dt` trapezoidally for `i_n`, with `k = dt/2L`:
				//
				//     i_n * (1 + R*k) = i_{n-1} * (1 - R*k) + k * (v_n + v_{n-1})
				//
				// so the equivalent conductance is `k / (1 + R*k)` and the history source scales
				// by the same denominator. At `R = 0` both collapse to the lossless form above,
				// so a packet that declares nothing is bit-identical to today.
				const k = dt / (2 * stamp.henries);
				const damping =
					windingOhms !== undefined && windingOhms > 0 ? 1 + windingOhms * k : 1;
				const conductance = k / damping;
				const previousAcross = state[stamp.stateIndex] ?? 0;
				const previousCurrent = state[stamp.stateIndex + 1] ?? 0;
				const source =
					(previousCurrent * (damping === 1 ? 1 : 2 - damping) + k * previousAcross) /
					damping;
				stampConductance(matrix, stamp.a, stamp.b, conductance);
				rhs[stamp.a] = (rhs[stamp.a] ?? 0) - source;
				rhs[stamp.b] = (rhs[stamp.b] ?? 0) + source;
				break;
			}
			case "diode": {
				// SPICE's junction limiting + physical series resistance via Lambert-W split.
				//
				// A real diode has bulk/contact series resistance Rs (e.g. 0.05 Ohm for power rectifiers
				// like 1N4007, 0.5-1.0 Ohm for signal diodes like 1N4148).
				// Without Rs, conducting at reservoir-charging currents (amperes) causes the pure
				// exponential law's conductance to reach millions of siemens, swinging a decade per
				// 60 mV and causing Newton iterate bifurcation / numerical non-convergence.
				//
				// With Rs, the implicit junction equation V = Vd + I*Rs has the exact closed-form solution:
				//   I + Is = (scale / Rs) * W0( (Is * Rs / scale) * exp( (Is * Rs / scale) + V / scale ) )
				//   dI/dV  = W0 / (Rs * (1 + W0))
				// which solves the internal junction voltage without adding any extra matrix unknowns.
				const diodeKey = packHistoryKey2(
					blockIndex,
					stamp.anode,
					stamp.cathode,
				);
				const scale = stamp.emissionCoefficient * stamp.thermalVoltage;
				const raw =
					(solution[stamp.anode] ?? 0) - (solution[stamp.cathode] ?? 0);
				const rs = stamp.seriesResistance ?? 0.05;
				const across = limitJunction(
					raw,
					this.diodeHistory.get(diodeKey) ?? 0,
					scale,
					stamp.saturationCurrent,
					rs,
				);
				if (across !== raw) {
					this.limitedIterate = true;
					this.limitedBy = `diode a=${stamp.anode} k=${stamp.cathode}`;
				}
				this.diodeHistory.set(diodeKey, across);
				let forwardCurrent = 0;
				let forwardConductance = 0;
				if (rs > 1e-6) {
					const x = (stamp.saturationCurrent * rs) / scale;
					const logZ = Math.log(x) + x + across / scale;
					const w = lambertW0FromLogZ(logZ);
					forwardCurrent = (scale / rs) * w - stamp.saturationCurrent;
					forwardConductance = w / (rs * (1 + w));
				} else {
					const exponential = Math.exp(
						Math.min(across / scale, JUNCTION_EXPONENT_LIMIT),
					);
					forwardCurrent = stamp.saturationCurrent * (exponential - 1);
					forwardConductance = (stamp.saturationCurrent * exponential) / scale;
				}

				let breakdownCurrent = 0;
				let breakdownConductance = 0;
				if (stamp.breakdownVolts > 0) {
					const beyond = -(across + stamp.breakdownVolts);
					if (rs > 1e-6) {
						// The same law as the branch below, I = Itest * exp((beyond - I*Rs) / scale),
						// solved in closed form: I*Rs/scale = W0((Itest*Rs/scale) * exp(beyond/scale)).
						// It passes Itest at BV and decays to leakage below it. An `exp - 1` form
						// here asymptoted to +Itest into the cathode below breakdown, a current no
						// zener carries, and pinned light-loaded rails near BV past their supply.
						const zx = (ZENER_TEST_CURRENT_AMPS * rs) / scale;
						const zw = lambertW0FromLogZ(Math.log(zx) + beyond / scale);
						breakdownCurrent = -(scale / rs) * zw;
						breakdownConductance = zw / (rs * (1 + zw));
					} else {
						const reverse = Math.exp(
							Math.min(beyond / scale, JUNCTION_EXPONENT_LIMIT),
						);
						breakdownCurrent = -ZENER_TEST_CURRENT_AMPS * reverse;
						breakdownConductance = (ZENER_TEST_CURRENT_AMPS * reverse) / scale;
					}
				}

				const current = forwardCurrent + breakdownCurrent;
				const rawG = forwardConductance + breakdownConductance;
				const equivalent = current - rawG * across;
				const conductance = rawG + 1e-12;
				stampConductance(matrix, stamp.anode, stamp.cathode, conductance);
				rhs[stamp.anode] = (rhs[stamp.anode] ?? 0) - equivalent;
				rhs[stamp.cathode] = (rhs[stamp.cathode] ?? 0) + equivalent;
				break;
			}
			case "optocoupler": {
				const across =
					(solution[stamp.ledAnode] ?? 0) - (solution[stamp.ledCathode] ?? 0);
				// The emitter's junction, from this repository's own cited LED entry rather than
				// from round numbers. `web/assets/registry/component-diode-chips.json` carries
				// `LED-RED`, whose aliases include `VTL5C2 (LED emitter side of the CdS
				// optocoupler)`, citing `emissionCoefficient` typ 2 and `forwardVoltageAt1mA`
				// typ 1.8 V. Those two fix the pair: `n*Vt = 2 * 25.852 mV` and the saturation
				// current that puts 1 mA at 1.8 V.
				//
				// It used to be `0.05` and `1e-12`, which is an ideality of 1.934 -- very nearly
				// the cited 2 -- against a saturation current six orders too large, so the knee
				// sat at 1.036 V where the cited part's own minimum is 1.65 V. The whole 0.1 mA
				// to 20 mA range then spanned 265 mV, which is why the LDR traversal used to
				// happen inside an 80 mV window.
				const scale = OPTO_LED_EMISSION_VOLTS;
				const exponential = Math.exp(
					Math.min(across / scale, JUNCTION_EXPONENT_LIMIT),
				);
				const ledCurrent = OPTO_LED_SATURATION_AMPS * (exponential - 1);
				// The trailing `1e-12` is a conductance floor, not a saturation current: it keeps
				// a dark LED's row from going singular. It is deliberately not the constant above.
				const ledConductance = Math.max(
					(OPTO_LED_SATURATION_AMPS * exponential) / scale,
					1e-12,
				);
				const ledEquivalent = ledCurrent - ledConductance * across;

				stampConductance(matrix, stamp.ledAnode, stamp.ledCathode, ledConductance);
				rhs[stamp.ledAnode] = (rhs[stamp.ledAnode] ?? 0) - ledEquivalent;
				rhs[stamp.ledCathode] = (rhs[stamp.ledCathode] ?? 0) + ledEquivalent;

				// LDR resistance from input LED current, by one of two laws.
				//
				// **The default is the generic exponential**, `ldrMinOhms + (ldrMaxOhms-ldrMinOhms)
				// * exp(-alpha*amps)` with a module-wide `alpha = 1000` -- every part that shares
				// the generic catalog bucket (PC817, MOC3021, VTL5C1, VTL3C3, VTL5C3, VTL5C4,
				// NSL50461, the source-labeled `OPTO` vactrol) still gets exactly this, bit-identical,
				// because none of them carries a cited current-resistance curve to fit against.
				//
				// **A part with one gets the power law instead.** `runoffgroove-tremulus-lune`'s
				// VTL5C2 is the first: the packet's own `SelectedLaneLedCurrentToResistanceLaw`
				// property cites datasheet anchors (R@1mA=5.5k, R@10mA=800, R@40mA=200), and those
				// three points are linear in log-log space (slopes -0.837 and -1.000 between
				// consecutive pairs) -- a power law, not an exponential-in-linear-current, which is
				// why the generic law put a genuinely-lit LED 56.7% of the way to its dark ceiling.
				// `ohms = coefficient * amps^exponent`, least-squares fit to those three anchors
				// (part-catalog.ts's VTL5C2 entry carries the fit and its residuals), clamped to
				// `[ldrMinOhms, ldrMaxOhms]` so a dark or saturated LED still floors/ceils sanely --
				// `Math.pow` of a zero or negative current under a negative exponent returns
				// `Infinity`, not `NaN`, so the ceiling clamp is what stops it, not a branch on zero.
				const alpha = 1000.0; // Coupling sensitivity A^-1, generic-bucket parts only
				let rLdr: number;
				if (
					stamp.ldrPowerLawCoefficientOhms !== undefined &&
					stamp.ldrPowerLawExponent !== undefined
				) {
					const powerLawCurrent = Math.max(ledCurrent, 0);
					const raw =
						stamp.ldrPowerLawCoefficientOhms *
						Math.pow(powerLawCurrent, stamp.ldrPowerLawExponent);
					rLdr = Math.min(Math.max(raw, stamp.ldrMinOhms), stamp.ldrMaxOhms);
				} else {
					rLdr =
						stamp.ldrMinOhms +
						(stamp.ldrMaxOhms - stamp.ldrMinOhms) * Math.exp(-alpha * ledCurrent);
				}
				const gLdr = Math.max(1 / rLdr, 1e-12);

				stampConductance(matrix, stamp.ldrA, stamp.ldrB, gLdr);
				break;
			}
			case "logic-divider": {
				const stateIdx = stamp.stateIndex;

				// **A flip-flop toggles once per committed sample, not once per Newton
				// iteration.** `applyStamp` runs on every iterate, and without this guard the
				// edge was detected against the *previous iteration's* clock voltage rather
				// than the previous sample's -- so a single sample could toggle Q several
				// times, or none, depending on the path Newton took to the same answer, and
				// the divider's output became a function of solver convergence. Same guard
				// `bbd` and `clock-driver` use.
				const dividerKey = `${block.id}_ff_${stamp.stateIndex}`;
				if (
					this.elapsedSamples !==
					(this.lastShiftedSample.get(dividerKey) ?? -1)
				) {
					this.lastShiftedSample.set(dividerKey, this.elapsedSamples);

					const vClkPrev = state[stateIdx + 1] ?? 0.0;

					// Read current clock voltage (relative to gnd)
					const vClk =
						(solution[stamp.clockNode] ?? 0.0) - (solution[stamp.gndNode] ?? 0.0);

					// Detect rising edge of clock crossing the digital logic threshold (2.0V)
					if (vClkPrev < stamp.thresholdVolts && vClk >= stamp.thresholdVolts) {
						state[stateIdx] = 1.0 - (state[stateIdx] ?? 0.0); // Toggle Q
					}

					// Update state variables without any memory allocation overhead
					state[stateIdx + 1] = vClk;
				}

				const Q = state[stateIdx] ?? 0.0;

				// Stamp output Q relative to gnd as a DC voltage source of value Q * highVolts
				const row = block.nodeCount + stamp.sourceIndex;
				(matrix[row] as number[])[stamp.qNode] += 1;
				(matrix[stamp.qNode] as number[])[row] += 1;
				(matrix[row] as number[])[stamp.gndNode] -= 1;
				(matrix[stamp.gndNode] as number[])[row] -= 1;
				(matrix[row] as number[])[row] -= 1.0; // 1.0 Ohm output impedance for numeric stability
				rhs[row] = Q * stamp.highVolts;
				break;
			}
			case "analog-switch": {
				const vA = solution[stamp.a] ?? 0.0;
				const vB = solution[stamp.b] ?? 0.0;
				const vCtrl = solution[stamp.control] ?? 0.0;

				const across = vA - vB;
				const vDiff = vCtrl - stamp.thresholdVolts;

				// Smooth sigmoid conductance transition
				const alpha = 10.0; // Transition sharpness
				const sigmoid = 1.0 / (1.0 + Math.exp(Math.max(-80, Math.min(-alpha * vDiff, 80))));

				const gOn = 1.0 / stamp.onOhms;
				const gOff = 1.0 / stamp.offOhms;
				const g = gOff + (gOn - gOff) * sigmoid;

				// Sigmoid derivative with respect to vCtrl
				const dSigmoid = alpha * sigmoid * (1.0 - sigmoid);
				const dg_dvCtrl = (gOn - gOff) * dSigmoid;

				// Coupling derivative term
				const coupling = dg_dvCtrl * across;
				const residual = coupling * vCtrl;

				// Stamp Jacobian matrix G
				stampConductance(matrix, stamp.a, stamp.b, g);

				if (stamp.a !== 0) {
					(matrix[stamp.a] as number[])[stamp.control] += coupling;
					rhs[stamp.a] = (rhs[stamp.a] ?? 0) + residual;
				}
				if (stamp.b !== 0) {
					(matrix[stamp.b] as number[])[stamp.control] -= coupling;
					rhs[stamp.b] = (rhs[stamp.b] ?? 0) - residual;
				}
				break;
			}
			case "dc-source": {
				// V(positive) - V(negative) - sourceOhms * i = volts. Ground rows are dropped
				// by the solve, so a rail returning to node 0 reduces to the single-ended form.
				//
				// **Series impedance needs no extra node.** `i` is already an unknown -- the
				// auxiliary row *is* the branch current -- so a `-R` term on that row's own
				// diagonal makes the terminal voltage droop by `R * i` under load. At
				// `sourceOhms = 0` the term vanishes and this is bit-for-bit the ideal stamp,
				// which is why adding it changes nothing until a supply declares an impedance.
				//
				// The sign follows the current convention: `i` is current *into* the positive
				// terminal from the circuit, so a supply delivering power has `i < 0` and
				// `V(positive) - V(negative) = volts + R * i` falls below `volts`. Sag, not gain.
				const row = block.nodeCount + stamp.sourceIndex;
				(matrix[row] as number[])[stamp.positive] += 1;
				(matrix[stamp.positive] as number[])[row] += 1;
				(matrix[row] as number[])[stamp.negative] -= 1;
				(matrix[stamp.negative] as number[])[row] -= 1;
				(matrix[row] as number[])[row] -= stamp.sourceOhms;
				// Scaled by the source-stepping ramp, which is 1 for every sample and for every
				// operating-point pass except that continuation's own.
				rhs[row] = stamp.volts * sourceScale;
				break;
			}
			case "ac-source": {
				// The same row as `dc-source`, with a moving right-hand side:
				//
				//   V(positive) - V(negative) - sourceOhms * i = amplitude * sin(2*pi*f*t)
				//
				// Identical structure on purpose. A sine EMF is not a different kind of element
				// from a battery -- it is the same branch with a time-varying value -- so the
				// series impedance, the sign convention and the branch-current unknown are all
				// inherited rather than re-derived, and a supply that sags under load sags the
				// same way here.
				//
				// **At DC the EMF is its value at `t = 0`, which is zero.** That is not a
				// convenience: ngspice's initial transient solution for `SIN(0 a f)` reports 0 V
				// at every node of a fixture measured here, so a rectifier's reservoir starts
				// discharged on both sides and the startup transient is the same circuit powering
				// on. Using the RMS value or the amplitude instead would seed a rail the circuit
				// has not charged yet and would show up as a parity disagreement in the first
				// cycles.
				const row = block.nodeCount + stamp.sourceIndex;
				(matrix[row] as number[])[stamp.positive] += 1;
				(matrix[stamp.positive] as number[])[row] += 1;
				(matrix[row] as number[])[stamp.negative] -= 1;
				(matrix[stamp.negative] as number[])[row] -= 1;
				(matrix[row] as number[])[row] -= stamp.sourceOhms;
				const emf = dc
					? 0
					: stamp.amplitudeVolts *
						Math.sin(2 * Math.PI * stamp.frequencyHz * this.timeSeconds);
				rhs[row] = emf * sourceScale;
				break;
			}
			case "bjt": {
				// Ebers-Moll, transport form, linearised about the previous iterate.
				// PNP is handled by flipping the junction voltages rather than by a
				// second code path, so there is one model with one sign convention.
				const sign = stamp.polarity === "npn" ? 1 : -1;
				const vt = stamp.thermalVoltage;
				const is = stamp.saturationCurrent;
				const bjtKey = packHistoryKey3(
					blockIndex,
					stamp.base,
					stamp.collector,
					stamp.emitter,
				);
				const previous = this.bjtHistory.get(bjtKey) ?? { vbe: 0, vbc: 0 };
				const rawVbe =
					sign * ((solution[stamp.base] ?? 0) - (solution[stamp.emitter] ?? 0));
				const rawVbc =
					sign *
					((solution[stamp.base] ?? 0) - (solution[stamp.collector] ?? 0));
				const vbe = limitJunction(rawVbe, previous.vbe, vt, is);
				const vbc = limitJunction(rawVbc, previous.vbc, vt, is);
				if (vbe !== rawVbe || vbc !== rawVbc) {
					this.limitedIterate = true;
					this.limitedBy = `bjt b=${stamp.base} c=${stamp.collector} e=${stamp.emitter}`;
				}
				this.bjtHistory.set(bjtKey, { vbe, vbc });

				const expBe = Math.exp(Math.min(vbe / vt, 60));
				const expBc = Math.exp(Math.min(vbc / vt, 60));
				const ift = is * (expBe - 1);
				const irt = is * (expBc - 1);

				// Excess collector-base leakage, as a second junction in parallel with the
				// ideal one and with the same exponential.
				//
				// Ebers-Moll's reverse current is already a leakage -- `-is` under reverse
				// bias, so 1 nA at the germanium saturation currents these packets declare --
				// and a real germanium part leaks 100 to 1000 times that. It is the same shape,
				// so it needs no new mechanism: a larger prefactor on `expBc - 1`, which is 0
				// at zero bias and saturates at `-leak` under reverse bias, exactly as a
				// junction does. That matters because germanium bias *depends* on it: the
				// leakage flows out through the base bias resistor and sets the operating
				// point, which is why these pedals drift with temperature.
				//
				// It touches the base and collector only. Collector-base leakage is measured
				// with the emitter open, so the emitter's row is untouched, and KCL still
				// closes because the two contributions are equal and opposite.
				const leak = stamp.leakageAmps;
				const ileak = leak * (expBc - 1);
				const gleak = (leak / vt) * expBc;

				const ic = ift - irt * (1 + 1 / stamp.reverseBeta) - ileak;
				const ib = ift / stamp.forwardBeta + irt / stamp.reverseBeta + ileak;

				const gif = (is / vt) * expBe;
				const gir = (is / vt) * expBc;
				const gm = gif;
				const gmu = -gir * (1 + 1 / stamp.reverseBeta) - gleak;
				const gpi = gif / stamp.forwardBeta;
				const gx = gir / stamp.reverseBeta + gleak;

				const b = stamp.base;
				const c = stamp.collector;
				const e = stamp.emitter;

				// dIb/dV and dIc/dV, with Vbe = Vb - Ve and Vbc = Vb - Vc.
				const addJacobian = (
					row: number,
					dVb: number,
					dVc: number,
					dVe: number,
				) => {
					(matrix[row] as number[])[b] += dVb;
					(matrix[row] as number[])[c] += dVc;
					(matrix[row] as number[])[e] += dVe;
				};
				addJacobian(b, gpi + gx, -gx, -gpi);
				addJacobian(c, gm + gmu, -gmu, -gm);
				addJacobian(e, -(gpi + gx + gm + gmu), gx + gmu, gpi + gm);

				// Equivalent sources: I0 - J . V0, in the model's own polarity.
				const ibEq = ib - (gpi * vbe + gx * vbc);
				const icEq = ic - (gm * vbe + gmu * vbc);
				rhs[b] = (rhs[b] ?? 0) - sign * ibEq;
				rhs[c] = (rhs[c] ?? 0) - sign * icEq;
				rhs[e] = (rhs[e] ?? 0) + sign * (ibEq + icEq);
				break;
			}
			case "triode": {
				// Koren's triode:
				//
				//   E1 = (Vpk/kp) * ln(1 + exp(kp * (1/mu + Vgk/sqrt(kvb + Vpk^2))))
				//   Ip = (2/kg1) * E1^ex     for E1 > 0, and 0 below cutoff
				//
				// Same shape as the FET below -- a transconductance device whose current
				// depends on two voltages referenced to a third terminal -- so it is stamped
				// the same way, with plate/grid/cathode where that has drain/gate/source.
				//
				// **Two nonlinearities, not one**, following
				// `compact-mna-dynamic-triode-cell`: the plate-current law and grid
				// conduction. That experiment's conclusion is that the tube feel a memoryless
				// transfer misses is "missing source-owned state", and the dynamic cell departs
				// from the memoryless transfer *as soon as grid current starts* — grid current
				// plus the coupling capacitor are what produce the loud-then-quiet pluck
				// recovery (`-1.47 dB` at 25 ms, still visible at 500 ms). A plate law alone
				// gets a static operating point right and reproduces no touch response, so
				// leaving grid current out would have been a half-measure.
				//
				// Below conduction the grid draws nothing and its node relies on `gmin` for a
				// path to ground, exactly as a FET gate and an op-amp input do.
				const cathodeVolts = solution[stamp.cathode] ?? 0;
				const rawVgk = (solution[stamp.grid] ?? 0) - cathodeVolts;
				const rawVpk = (solution[stamp.plate] ?? 0) - cathodeVolts;
				const triodeKey = packHistoryKey3(
					blockIndex,
					stamp.grid,
					stamp.cathode,
					stamp.plate,
				);
				// Limited like a junction is: the exponential inside `E1` overshoots on the
				// first Newton step exactly as a diode's does, and a plate at hundreds of
				// volts makes the overshoot enormous. Damped toward the previous iterate
				// rather than clamped, so the operating point is still solved exactly.
				const history = this.triodeHistory.get(triodeKey) ?? { vgk: 0, vpk: 0 };
				const conducting =
					rawVpk > 0 && rawVgk > TRIODE_GRID_CUTOFF_THRESHOLD_VOLTS;
				const vgk = dc
					? rawVgk
					: limitTriodeGridStep(rawVgk, history.vgk);
				const vpk = dc
					? rawVpk
					: conducting
						? limitTriodeStep(
								rawVpk,
								Math.max(history.vpk, 0),
								TRIODE_PLATE_STEP_VOLTS,
							)
						: rawVpk;
				if (vgk !== rawVgk || vpk !== rawVpk) {
					this.limitedIterate = true;
					this.limitedBy = `triode g=${stamp.grid} k=${stamp.cathode} p=${stamp.plate}`;
				}
				this.triodeHistory.set(triodeKey, { vgk, vpk });
				const denominator = Math.sqrt(stamp.kvb + vpk * vpk);
				const inner =
					stamp.kp *
					(1 / stamp.mu +
						(vgk + stamp.contactPotentialVolts) / denominator);
				const softened =
					inner > 40
						? inner
						: (inner < -40
							? Math.exp(inner)
							: Math.log1p(Math.exp(inner)));
				const vpkEff =
					vpk > 20
						? vpk
						: (vpk < -20
							? Math.exp(vpk)
							: Math.log1p(Math.exp(vpk)));
				const vpkSigmoid =
					vpk > 20
						? 1
						: (vpk < -20
							? Math.exp(vpk)
							: 1 / (1 + Math.exp(-vpk)));
				const e1 = (vpkEff / stamp.kp) * softened;

				let plateCurrent = 0;
				let gm = 0;
				let gp = 0;
				if (e1 > 0) {
					plateCurrent = (2 / stamp.kg1) * e1 ** stamp.ex;
					// dIp/dE1, then E1's own partials. `sigmoid` is d(softened)/d(inner).
					const dIdE1 = (2 / stamp.kg1) * stamp.ex * e1 ** (stamp.ex - 1);
					const sigmoid =
						inner > 40
							? 1
							: (inner < -40
								? Math.exp(inner)
								: 1 / (1 + Math.exp(-inner)));
					const dInnerDVgk = stamp.kp / denominator;
					const dInnerDVpk =
						-stamp.kp *
						(vgk + stamp.contactPotentialVolts) *
						vpk *
						denominator ** -3;
					const dE1DVgk = (vpkEff / stamp.kp) * sigmoid * dInnerDVgk;
					const dE1DVpk =
						(vpkSigmoid * softened) / stamp.kp +
						(vpkEff / stamp.kp) * sigmoid * dInnerDVpk;
					gm = dIdE1 * dE1DVgk;
					gp = dIdE1 * dE1DVpk;
				}
				// Cut off, or reverse: a tiny conductance so the plate row is never empty.
				gp += 1e-12;

				// Grid conduction, as a softplus rather than a diode exponential:
				//
				//   Ig  = Is * log1p(exp((Vgk - onset)/scale))
				//   dIg = (Is/scale) * sigmoid((Vgk - onset)/scale)
				//
				// `log1p(exp(x))` tends to `x` for large `x`, so the current grows **linearly**
				// once conducting rather than exponentially. That is why the experiment this
				// comes from reports zero Newton failures across a 40x velocity ladder at 2.1
				// to 2.8 iterations per sample, where a junction exponential would need
				// limiting. Smooth and differentiable everywhere, so it needs no limiter of its
				// own beyond the grid step already applied above.
				let gridCurrent = 0;
				let gg = 0;
				const over = vgk - stamp.gridOnsetVolts;
				// The skip has to happen where the softplus has actually underflowed, not
				// merely where it is small. At `-3 * scale` the sigmoid is still `0.047`, so
				// cutting off there dropped `gg` from `7.9e-6 S` to exactly zero in one step,
				// costing this law the continuity the comment above relies on to justify
				// having no limiter of its own. `-40 * scale` mirrors the upper
				// `Math.min(40, ...)` clamp and lands where `exp` is `4e-18`, so the step
				// down to zero is invisible in double precision.
				if (over > -40 * stamp.gridScaleVolts) {
					const x = over / stamp.gridScaleVolts;
					const softened =
						x > 40
							? x
							: (x < -40
								? Math.exp(x)
								: Math.log1p(Math.exp(x)));
					gridCurrent = stamp.gridSaturationCurrent * softened;
					const sigmoid =
						x > 40
							? 1
							: (x < -40
								? Math.exp(x)
								: 1 / (1 + Math.exp(-x)));
					gg = (stamp.gridSaturationCurrent / stamp.gridScaleVolts) * sigmoid;
				}

				const p = stamp.plate;
				const k = stamp.cathode;
				const g = stamp.grid;
				// Plate current depends on Vgk and Vpk, both referenced to the cathode, so this
				// is the FET's stamping with plate/grid/cathode for drain/gate/source.
				(matrix[p] as number[])[g] += gm;
				(matrix[p] as number[])[p] += gp;
				(matrix[p] as number[])[k] -= gm + gp;
				(matrix[k] as number[])[g] -= gm;
				(matrix[k] as number[])[p] -= gp;
				(matrix[k] as number[])[k] += gm + gp;
				const equivalent = plateCurrent - (gm * vgk + gp * vpk);
				rhs[p] = (rhs[p] ?? 0) - equivalent;
				rhs[k] = (rhs[k] ?? 0) + equivalent;

				// Grid current is a plain two-terminal nonlinearity between grid and cathode.
				// Both currents leave their own electrode and arrive at the cathode, which is
				// the sign convention the source experiment reconstructs its nodes with.
				(matrix[g] as number[])[g] += gg;
				(matrix[g] as number[])[k] -= gg;
				(matrix[k] as number[])[g] -= gg;
				(matrix[k] as number[])[k] += gg;
				const gridEquivalent = gridCurrent - gg * vgk;
				rhs[g] = (rhs[g] ?? 0) - gridEquivalent;
				rhs[k] = (rhs[k] ?? 0) + gridEquivalent;
				break;
			}
			case "pentode": {
				// Koren again, **screen-referenced**, which is the whole difference from the
				// triode above:
				//
				//   E1 = (Vsk/kp) * ln(1 + exp(kp * (1/mu + Vgk/sqrt(kvb + Vsk^2))))
				//   Ip = (2/kg1) * E1^ex * tanh(Vpk / knee)
				//
				// `Vsk` where the triode has `Vpk`. The screen sets the cathode current and the
				// plate only gates it, which is why a pentode's plate curves are flat and a
				// triode's are not — and why a pentode needs three partials rather than two.
				//
				// **The screen draws a share of the conduction, never a constant.** A fixed Ig2
				// cannot be supplied through a high-impedance feed (245 V through 4.7 M is 52 uA at
				// most), so it drove the screen to -2575 V and the solver from 3 to 1024 Newton
				// iterations with 100 % held samples. Instead the screen current is `screenShare`
				// of the plate current -- the 5:1 plate:screen split at the datasheet point (Ig2
				// 0.6 mA / Ia 3.0 mA, i.e. the screen's 1/6 share of the total cathode current) --
				// stamped as a screen<->cathode source below. Self-consistent and degrading
				// gracefully: as the screen sags, conduction falls, the share falls, the feed drop
				// falls, and the loop settles instead of diverging. `0`/absent reproduces the
				// original simplification where the screen draws no current and a screen resistor
				// drops nothing.
				const cathodeVolts = solution[stamp.cathode] ?? 0;
				const rawVgk = (solution[stamp.grid] ?? 0) - cathodeVolts;
				const rawVsk = (solution[stamp.screen] ?? 0) - cathodeVolts;
				const rawVpk = (solution[stamp.plate] ?? 0) - cathodeVolts;
				// Same key shape as the triode case (grid, cathode, plate -- not screen), so a
				// triode and pentode sharing those three node numbers in one block still collide
				// the way the old string key made them. See `bjtHistory`'s comment.
				const pentodeKey = packHistoryKey3(
					blockIndex,
					stamp.grid,
					stamp.cathode,
					stamp.plate,
				);
				const history = this.triodeHistory.get(pentodeKey) ?? {
					vgk: 0,
					vpk: 0,
				};
				const conducting =
					rawVpk > 0 && rawVgk > TRIODE_GRID_CUTOFF_THRESHOLD_VOLTS;
				const vgk = dc
					? rawVgk
					: limitTriodeGridStep(rawVgk, history.vgk);
				const vpk = dc
					? rawVpk
					: rawVpk > 0
						? limitTriodeStep(
								rawVpk,
								Math.max(history.vpk, 0),
								TRIODE_PLATE_STEP_VOLTS,
							)
						: rawVpk;
				const vsk = dc
					? rawVsk
					: conducting
						? limitTriodeStep(
								rawVsk,
								Math.max(history.vsk ?? rawVsk, 0),
								TRIODE_PLATE_STEP_VOLTS,
							)
						: rawVsk;
				if (vgk !== rawVgk || vpk !== rawVpk || vsk !== rawVsk) {
					this.limitedIterate = true;
					this.limitedBy = `pentode g=${stamp.grid} k=${stamp.cathode} p=${stamp.plate}`;
				}
				this.triodeHistory.set(pentodeKey, { vgk, vpk, vsk });

				const vpkEff = Math.max(vpk, 0);
				const vskEff = Math.max(vsk, 0);
				const denominator = Math.sqrt(stamp.kvb + vskEff * vskEff);
				const inner =
					stamp.kp *
					(1 / stamp.mu +
						(vgk + stamp.contactPotentialVolts) / denominator);
				const softened =
					inner > 40
						? inner
						: (inner < -40
							? Math.exp(inner)
							: Math.log1p(Math.exp(inner)));
				const e1 = (vskEff / stamp.kp) * softened;
				// **Koren's pentode gate, `atan(Vpk/kvb)` -- not `tanh` against a separate knee.**
				// This was worth 26-34% of plate current on every catalogued power tube. `tanh`
				// saturates at 1.0 by roughly 150 V, while `atan` reaches 1.34-1.52 at 250 V and
				// keeps climbing, and the published coefficients were fitted against `atan` -- so
				// `kg1` already had that factor inside it and the old gate threw it away. Five
				// tubes moved from 26-34% low at their own datasheet point to within 1.5% for four
				// of them, each by a correction equal to `atan(Va/kvb)` for its *own* `kvb`.
				const gate = Math.atan(vpkEff / stamp.kvb);

				let plateCurrent = 0;
				let gm = 0;
				let gs = 0;
				let gp = 0;
				if (e1 > 0 && vpkEff > 0) {
					const cathodeCurrent = (2 / stamp.kg1) * e1 ** stamp.ex;
					plateCurrent = cathodeCurrent * gate;
					const dIdE1 = (2 / stamp.kg1) * stamp.ex * e1 ** (stamp.ex - 1);
					const sigmoid =
						inner > 40
							? 1
							: (inner < -40
								? Math.exp(inner)
								: 1 / (1 + Math.exp(-inner)));
					// `inner` depends on Vsk through the square root, so the screen gets both
					// the explicit `Vsk/kp` factor and that implicit term.
					const dE1DVgk = (vskEff / stamp.kp) * sigmoid * (stamp.kp / denominator);
					// `Vct` shifts the numerator this term differentiates, so it travels here too.
					const dInnerDVsk =
						-stamp.kp *
						(vgk + stamp.contactPotentialVolts) *
						vskEff *
						denominator ** -3;
					const dE1DVsk =
						softened / stamp.kp + (vskEff / stamp.kp) * sigmoid * dInnerDVsk;
					gm = dIdE1 * dE1DVgk * gate;
					gs = dIdE1 * dE1DVsk * gate;
					// d/dVpk atan(Vpk/kvb) = kvb / (kvb^2 + Vpk^2). Unlike the old gate's
					// derivative this never reaches zero, so a conducting pentode now has a
					// **finite plate resistance** instead of the 1e12 ohms a saturated `tanh`
					// produced. Both more physical and better conditioned -- `vox-ac30-top-boost`
					// went from 6.9 to 5.6 steady Newton iterations per sample. The floor below is
					// now only for the cut-off case, where the device carries no plate dependence.
					gp =
						(cathodeCurrent * stamp.kvb) /
						(stamp.kvb * stamp.kvb + vpkEff * vpkEff);
				}
				gp += 1e-12;

				let gridCurrent = 0;
				let gg = 0;
				const pentodeOver = vgk - stamp.gridOnsetVolts;
				// Same cutoff continuity as the triode path above.
				if (pentodeOver > -40 * stamp.gridScaleVolts) {
					const x = pentodeOver / stamp.gridScaleVolts;
					const softened =
						x > 40
							? x
							: (x < -40
								? Math.exp(x)
								: Math.log1p(Math.exp(x)));
					gridCurrent = stamp.gridSaturationCurrent * softened;
					const sigmoid =
						x > 40
							? 1
							: (x < -40
								? Math.exp(x)
								: 1 / (1 + Math.exp(-x)));
					gg = (stamp.gridSaturationCurrent / stamp.gridScaleVolts) * sigmoid;
				}

				const pp = stamp.plate;
				const kk = stamp.cathode;
				const gg1 = stamp.grid;
				const ss = stamp.screen;
				(matrix[pp] as number[])[gg1] += gm;
				(matrix[pp] as number[])[ss] += gs;
				(matrix[pp] as number[])[pp] += gp;
				(matrix[pp] as number[])[kk] -= gm + gs + gp;
				(matrix[kk] as number[])[gg1] -= gm;
				(matrix[kk] as number[])[ss] -= gs;
				(matrix[kk] as number[])[pp] -= gp;
				(matrix[kk] as number[])[kk] += gm + gs + gp;
				const pentodeEquivalent =
					plateCurrent - (gm * vgk + gs * vsk + gp * vpk);
				rhs[pp] = (rhs[pp] ?? 0) - pentodeEquivalent;
				rhs[kk] = (rhs[kk] ?? 0) + pentodeEquivalent;
				// Screen<->cathode source: a share of the plate current, not a constant. Its
				// linearization is `screenShare` times the plate source's (gm, gs, gp), because the
				// screen current is `screenShare * plateCurrent` and each of vgk/vsk/vpk shifts by
				// the same node voltage. `0`/absent is a no-op, so a law without a screen figure
				// behaves exactly as before.
				if (stamp.screenShare > 0) {
					const screenCurrent = plateCurrent * stamp.screenShare;
					const screenEquivalent =
						screenCurrent -
						stamp.screenShare * (gm * vgk + gs * vsk + gp * vpk);
					rhs[ss] = (rhs[ss] ?? 0) - screenEquivalent;
					rhs[kk] = (rhs[kk] ?? 0) + screenEquivalent;
					(matrix[ss] as number[])[gg1] += stamp.screenShare * gm;
					(matrix[ss] as number[])[ss] += stamp.screenShare * gs;
					(matrix[ss] as number[])[pp] += stamp.screenShare * gp;
					(matrix[ss] as number[])[kk] -= stamp.screenShare * (gm + gs + gp);
					(matrix[kk] as number[])[gg1] -= stamp.screenShare * gm;
					(matrix[kk] as number[])[ss] -= stamp.screenShare * gs;
					(matrix[kk] as number[])[pp] -= stamp.screenShare * gp;
					(matrix[kk] as number[])[kk] += stamp.screenShare * (gm + gs + gp);
				}

				(matrix[gg1] as number[])[gg1] += gg;
				(matrix[gg1] as number[])[kk] -= gg;
				(matrix[kk] as number[])[gg1] -= gg;
				(matrix[kk] as number[])[kk] += gg;
				const pentodeGridEquivalent = gridCurrent - gg * vgk;
				rhs[gg1] = (rhs[gg1] ?? 0) - pentodeGridEquivalent;
				rhs[kk] = (rhs[kk] ?? 0) + pentodeGridEquivalent;
				break;
			}
			case "fet": {
				// Shichman-Hodges. A p-channel device is the same equations with every
				// voltage negated, so there is one model rather than a mirrored copy.
				const sign = stamp.channel === "n" ? 1 : -1;
				const fetKey = packHistoryKey3(
					blockIndex,
					stamp.gate,
					stamp.drain,
					stamp.source,
				);
				const rawVgs =
					sign * ((solution[stamp.gate] ?? 0) - (solution[stamp.source] ?? 0));
				const rawVds =
					sign * ((solution[stamp.drain] ?? 0) - (solution[stamp.source] ?? 0));
				// Limited in the device's own polarity, so a p-channel device is damped by
				// the same code rather than by a mirrored copy of it.
				const history = this.fetHistory.get(fetKey) ?? {
					vgs: stamp.thresholdVolts,
					vds: 0,
				};
				const vgs = limitFetGate(rawVgs, history.vgs, stamp.thresholdVolts);
				// The drain limiter damps overshoot **in conduction**, which is the only
				// place the quadratic can overshoot. Below cutoff, and in reverse, the law
				// below contributes `gds = 1e-12` and no current whatever the drain sits at,
				// so there is nothing to damp there -- and clamping anyway deadlocks the
				// solve outright.
				//
				// The deadlock, because it is not obvious: `limitFetDrain`'s lower branch is
				// `Math.max(next, -0.5)`. Once `history.vds` has reached `-0.5` and the true
				// drain is below it, the clamp returns `-0.5` again, and again. The iterate
				// is then **stationary and flagged limited at the same time**, and the
				// convergence rule bars a limited iterate by construction -- so the sample
				// can never converge no matter how many iterations it is given.
				// `boss-ge-7` held **95988 of 96000 samples** on exactly this, reporting
				// `delta=1.175e-16 limited=true by fet g=39 d=19 s=38 drain`: a converged
				// answer, refused. ngspice solves the same circuit to `9.410e-2` RMS.
				const conducting = vgs - stamp.thresholdVolts > 0 && rawVds >= 0;
				const vds = conducting ? limitFetDrain(rawVds, history.vds) : rawVds;
				if (vgs !== rawVgs || vds !== rawVds) {
					this.limitedIterate = true;
					this.limitedBy = `fet g=${stamp.gate} d=${stamp.drain} s=${stamp.source}${vgs !== rawVgs ? " gate" : ""}${vds !== rawVds ? " drain" : ""}`;
				}
				this.fetHistory.set(fetKey, { vgs, vds });
				const beta = stamp.transconductance;
				const lambda = stamp.channelLengthModulation;

				// **A channel conducts both ways, and treating reverse as cutoff was wrong.**
				//
				// This used to read `if (overdrive <= 0 || vds < 0) { gds = 1e-12 }` -- a FET
				// with its drain below its source was fully off. A real MOSFET or JFET channel
				// is symmetric: with the gate on, current flows source-to-drain just as
				// happily, which is exactly why a JFET works as an analogue switch. ngspice's
				// MOS level 1 models it by swapping the two terminals.
				//
				// The cost of getting it wrong is not subtle, because an audio signal spends
				// half its cycle there. On `boss-hm-2`, three of four FETs sit at negative
				// `vds` with positive overdrive for **900, 1503 and 1831 of 2400 samples**,
				// and all three are in the signal path -- so the runtime opened them while
				// ngspice passed signal, which is the corpus's last parity disagreement
				// (`corr=0.5448 gain=0.238`, ours 10x quiet) after window, timestep, op-amp
				// knee, self-oscillation and the diode clamp were each ruled out.
				//
				// The swap: with source and drain exchanged the gate is referenced to the
				// other terminal, so the forward law is evaluated at `(vgs - vds, -vds)` and
				// its current negated. By the chain rule that gives `gm' = -gm` and
				// `gds' = gm + gds`, both read at the swapped point.
				const forward = (
					gateSource: number,
					drainSource: number,
				): { current: number; gm: number; gds: number } => {
					const driveRaw = gateSource - stamp.thresholdVolts;
					// Subthreshold conduction (JFETs; `subthresholdVolts` is 0 for
					// MOSFETs, which keep the legacy hard cutoff bit-identically).
					// Effective drive via softplus, S·ln(1+e^{drive/S}): the identity
					// far above threshold, an exponential foot below it, smooth
					// everywhere so no Newton kink at the knee. A hard wall here makes
					// every threshold crossing violent: a knee-biased JFET pumps
					// audio-rate distortion alongside any sweep it produces
					// (mxr-phase-90 measured: sweep only with grit, P9). Guarded like
					// the gate junction's softplus below. The stamp
					// comes from program JSON, which may predate the field.
					const subVolts = stamp.subthresholdVolts ?? 0;
					let drive = driveRaw;
					if (subVolts > 0) {
						const x = driveRaw / subVolts;
						drive =
							x > 40
								? driveRaw
								: x < -40
									? subVolts * Math.exp(x)
									: subVolts * Math.log1p(Math.exp(x));
					} else if (driveRaw <= 0) {
						// Genuinely cut off. A tiny conductance keeps the row non-singular.
						return { current: 0, gm: 0, gds: 1e-12 };
					}
					if (drainSource < drive) {
						// Triode.
						return {
							current:
								beta *
								drainSource *
								(2 * drive - drainSource) *
								(1 + lambda * drainSource),
							gm: 2 * beta * drainSource * (1 + lambda * drainSource),
							gds:
								2 * beta * (drive - drainSource) * (1 + lambda * drainSource) +
								beta * drainSource * (2 * drive - drainSource) * lambda,
						};
					}
					// Saturation.
					return {
						current: beta * drive * drive * (1 + lambda * drainSource),
						gm: 2 * beta * drive * (1 + lambda * drainSource),
						gds: beta * drive * drive * lambda + 1e-12,
					};
				};

				let drainCurrent = 0;
				let gm = 0;
				let gds = 0;
				if (vds >= 0) {
					const f = forward(vgs, vds);
					drainCurrent = f.current;
					gm = f.gm;
					gds = f.gds;
				} else {
					const f = forward(vgs - vds, -vds);
					drainCurrent = -f.current;
					gm = -f.gm;
					gds = f.gm + f.gds;
				}

				const d = stamp.drain;
				const sNode = stamp.source;
				const g = stamp.gate;
				// Id depends on Vgs and Vds, both referenced to the source node.
				(matrix[d] as number[])[g] += gm;
				(matrix[d] as number[])[d] += gds;
				(matrix[d] as number[])[sNode] -= gm + gds;
				(matrix[sNode] as number[])[g] -= gm;
				(matrix[sNode] as number[])[d] -= gds;
				(matrix[sNode] as number[])[sNode] += gm + gds;
				const equivalent = drainCurrent - (gm * vgs + gds * vds);
				rhs[d] = (rhs[d] ?? 0) - sign * equivalent;
				rhs[sNode] = (rhs[sNode] ?? 0) + sign * equivalent;

				// The gate-source junction. **A MOSFET's insulated gate has
				// `gateSaturationCurrent === 0` and this block contributes nothing**, which is
				// exactly what this law did for every FET before -- so the six CMOS-logic FETs
				// the inverter and gate lowerings emit are unchanged by construction.
				//
				// A JFET's gate is a PN junction, and its absence let the solve park at a
				// forward-biased `Vgs` no physical part can hold: `boss-cs-2`'s `Q2` at
				// `+0.350 V` and `boss-ds-2`'s `Q15` at `+0.596 V`, both drawing zero gate
				// current. The junction clamps instead, which turns a non-physical operating
				// point into a readable one.
				//
				// Softplus rather than an exponential, following the triode's grid for the same
				// reason it does: the current grows *linearly* once conducting, so it is smooth
				// and differentiable everywhere and needs no limiter of its own beyond the gate
				// step `limitFetGate` already applied to `vgs` above.
				//
				// `vgs` is channel-signed, so one law covers n and p. The junction conductance
				// with respect to the *unsigned* gate-source difference is `ggate` either way
				// (`sign` cancels in `d(sign*f(sign*u))/du`), while the companion current keeps
				// the `sign` the drain terms use.
				if (stamp.gateSaturationCurrent > 0) {
					// **TWO JUNCTIONS, NOT ONE.** A JFET's gate is a PN junction to BOTH ends of
					// the channel, and this law had only the gate-source one. Measured at
					// `boss-sd-1`'s operating point, ngspice reports `ig = 8.4224e-4 A` total gate
					// current of which **`igd = 6.7375e-4 A` -- 80% -- flows through the
					// gate-DRAIN junction**, so the missing term carried most of the current
					// rather than a correction to it.
					//
					// It is the same junction with the same parameters, evaluated at `vgd`, which
					// the channel-signed frame already spells as `vgs - vds` above. A MOSFET's
					// `gateSaturationCurrent === 0` skips both, so the six CMOS-logic FETs the
					// inverter and gate lowerings emit are unchanged by construction, exactly as
					// when only one junction existed.
					const junction = (
						across: number,
					): { current: number; conductance: number } => {
						const over = across - stamp.gateOnsetVolts;
						// Same `-40 * scale` cutoff as the grid: far enough out that the step down
						// to exactly zero is invisible in double precision, rather than somewhere
						// the sigmoid is still finite and the continuity is lost.
						if (over <= -40 * stamp.gateScaleVolts) {
							return { current: 0, conductance: 0 };
						}
						const x = over / stamp.gateScaleVolts;
						const softened =
							x > 40 ? x : x < -40 ? Math.exp(x) : Math.log1p(Math.exp(x));
						const sigmoid =
							x > 40 ? 1 : x < -40 ? Math.exp(x) : 1 / (1 + Math.exp(-x));
						return {
							current: stamp.gateSaturationCurrent * softened,
							conductance:
								(stamp.gateSaturationCurrent / stamp.gateScaleVolts) * sigmoid,
						};
					};
					const stampJunction = (
						other: number,
						across: number,
					): void => {
						const { current, conductance } = junction(across);
						(matrix[g] as number[])[g] += conductance;
						(matrix[g] as number[])[other] -= conductance;
						(matrix[other] as number[])[g] -= conductance;
						(matrix[other] as number[])[other] += conductance;
						const equivalentGate = current - conductance * across;
						rhs[g] = (rhs[g] ?? 0) - sign * equivalentGate;
						rhs[other] = (rhs[other] ?? 0) + sign * equivalentGate;
					};
					stampJunction(sNode, vgs);
					stampJunction(d, vgs - vds);
				}
				break;
			}
			case "tube-diode": {
				// Child-Langmuir space charge, linearised about the previous iterate:
				//
				//   Ia = K * Vak^n      for Vak > 0, and 0 below it
				//   g  = n * K * Vak^(n-1)
				//
				// Stamped like the junction diode above -- a two-terminal nonlinear conductance
				// plus an equivalent source -- and with **no limiter**, which is the electrical
				// difference rather than an omission. A junction's current is exponential in its
				// voltage, so an undamped Newton step overshoots by orders of magnitude and
				// `limitJunction` exists to damp it. A 3/2 power law's derivative grows only as
				// `sqrt(Vak)`: at 100 V of forward bias this element's conductance is 5.3 mS, which
				// is an ordinary resistor. Nothing to damp, so nothing damps it -- and no limiter
				// means no chance of a limited iterate satisfying the convergence test.
				//
				// Reverse conduction is zero rather than small. A real rectifier passes nothing
				// until it arcs, and the peak inverse voltage where that happens is not in the
				// source, so modelling it would be inventing a rating.
				const across =
					(solution[stamp.plate] ?? 0) - (solution[stamp.cathode] ?? 0);
				const forward = Math.max(across, 0);
				const current = stamp.perveance * forward ** stamp.exponent;
				// The floor keeps the plate's row non-empty at and below cutoff, where the true
				// derivative is zero -- the same reason the triode's `gp` carries one.
				const conductance = Math.max(
					stamp.perveance * stamp.exponent * forward ** (stamp.exponent - 1),
					1e-12,
				);
				const equivalent = current - conductance * across;
				stampConductance(matrix, stamp.plate, stamp.cathode, conductance);
				rhs[stamp.plate] = (rhs[stamp.plate] ?? 0) - equivalent;
				rhs[stamp.cathode] = (rhs[stamp.cathode] ?? 0) + equivalent;
				break;
			}
			case "transformer": {
				// One auxiliary unknown carries the primary current. The constraint row
				// states V_primary = ratio * V_secondary; the column injects the primary
				// current and its scaled negative on the secondary, which is exactly
				// what conserves power: V_p * I_p + V_s * I_s = 0.
				const row = block.nodeCount + stamp.sourceIndex;
				const n = stamp.turnsRatio;
				(matrix[row] as number[])[stamp.primaryPlus] += 1;
				(matrix[row] as number[])[stamp.primaryMinus] -= 1;
				(matrix[row] as number[])[stamp.secondaryPlus] -= n;
				(matrix[row] as number[])[stamp.secondaryMinus] += n;
				(matrix[stamp.primaryPlus] as number[])[row] += 1;
				(matrix[stamp.primaryMinus] as number[])[row] -= 1;
				(matrix[stamp.secondaryPlus] as number[])[row] -= n;
				(matrix[stamp.secondaryMinus] as number[])[row] += n;
				// **Copper loss, if the windings declared any.** The constraint becomes
				// `V_p - n*V_s - I_p * (R_p + n^2 * R_s) = 0`, which is one entry on the
				// auxiliary's own diagonal -- the same series-impedance shape `input-source`
				// uses below. At 0 it is bit-for-bit the ideal stamp, which is every corpus
				// packet today. Copper only: core loss and leakage inductance are still absent.
				if (stamp.seriesResistanceOhms !== undefined && stamp.seriesResistanceOhms > 0) {
					(matrix[row] as number[])[row] -= stamp.seriesResistanceOhms;
				}
				rhs[row] = 0;
				break;
			}
			case "input-source": {
				// V(node) - sourceOhms * i = input -- `dc-source`'s series-impedance shape,
				// applied to the input jack. The impedance is the CONSOLE's (whatever drives
				// the jack: a pickup, a buffer, a stiff test source), set per `prepare()`,
				// never carried by the program. At 0 this is bit-for-bit the ideal stamp.
				const row = block.nodeCount + stamp.sourceIndex;
				(matrix[row] as number[])[stamp.node] = 1;
				(matrix[stamp.node] as number[])[row] = 1;
				(matrix[row] as number[])[row] = -this.inputSourceOhms;
				rhs[row] = input;
				break;
			}
			case "ideal-opamp": {
				const row = block.nodeCount + stamp.sourceIndex;
				(matrix[stamp.output] as number[])[row] += 1;
				if (stamp.railHigh === null || stamp.railLow === null) {
					// No supply declared, so no rail exists to clip against: the classic
					// virtual short, v(+) == v(-), and the region stays linear.
					(matrix[row] as number[])[stamp.plus] += 1;
					(matrix[row] as number[])[stamp.minus] -= 1;
					rhs[row] = 0;
					break;
				}
				// Finite gain into a smooth saturation, rather than a hard switch between
				// "virtual short" and "pinned to the rail". A hard switch chatters: the
				// output overshoots, gets pinned, releases, overshoots again, and Newton
				// never converges. tanh is differentiable everywhere, so it converges --
				// and it is the more faithful model, since a real op-amp has finite gain
				// and a soft approach to its rails.
				const centre = (stamp.railHigh + stamp.railLow) / 2;
				const halfSwing = opAmpHalfSwing(stamp.railHigh, stamp.railLow);
				// `tanh` made the saturation differentiable, which is necessary and is not
				// sufficient: at a gain of 1e5 the linear region is tens of microvolts
				// wide, so an undamped Newton step launches the iterate from one rail to
				// the other and back forever. Two separate things fix that, and conflating
				// them is what made an earlier attempt report convergence it had not
				// reached.
				//
				// **Saturation is the model.** Past a few multiples of the linear width
				// `tanh` is the rail to within a rounding error, so the differential is
				// bounded to that band and evaluated there. This is not a convergence
				// device: it is what a real op-amp does, the bounded point is the answer,
				// and it converges like any other operating point. It also removes the
				// reason the solve was slow -- in saturation the true differential is
				// *volts* (feedback is broken, so the summing node floats to the divider's
				// value), which a step limiter sized to the linear region can only reach a
				// few tens of microvolts at a time. That was 1565 iterations for one
				// sample, and it is why the cap looked like a limit cycle.
				//
				// **The step limiter is the convergence device**, and only inside the
				// band, where the gain is enormous and an undamped step is what oscillates.
				// While it is active the iterate is short of the solution by construction,
				// so it bars convergence -- without that bar `tanh`'s flatness means a
				// clamped step moves the output by less than the tolerance and every
				// clamped iteration reads as converged.
				const opampKey = packHistoryKey3(
					blockIndex,
					stamp.plus,
					stamp.minus,
					stamp.output,
				);
				// The dominant pole. At the operating point (`dc`) it is transparent and the gain
				// is the full DC gain; in the transient a single sample sees `alpha` times that
				// gain and the raw state carries the rest. `effectiveGain` maps this sample's
				// differential to its raw output, and it is what sizes the linear region the
				// saturation band and step limiter are stated in.
				const alpha = dc
					? 1
					: opAmpPoleAlpha(
							stamp.openLoopGain,
							OPAMP_GAIN_BANDWIDTH_HZ,
							dt,
							this.sampleRate as number,
						);
				const effectiveGain = alpha * stamp.openLoopGain;
				const linearWidth = halfSwing / effectiveGain;
				const previous = this.opampHistory.get(opampKey);
				const previousDifferential = previous?.differential ?? 0;
				const rawDifferential =
					(solution[stamp.plus] ?? 0) - (solution[stamp.minus] ?? 0);
				const band = OPAMP_DIFFERENTIAL_BAND * linearWidth;
				const bounded = clamp(rawDifferential, -band, band);
				const step = bounded - previousDifferential;
				const maxStep = OPAMP_MAX_DIFFERENTIAL_STEP * linearWidth;
				const reversing =
					previous !== undefined &&
					previous.step !== 0 &&
					step !== 0 &&
					Math.sign(step) !== Math.sign(previous.step);
				// A step cap that shrinks while the iterate straddles the solution, and
				// recovers while it marches toward one.
				//
				// `maxStep` is **four linear widths**, so a fixed march cannot land inside
				// the linear region -- it steps over it. That is survivable when feedback
				// travels through outside components, and it is not when the loop closes
				// inside one unknown.
				//
				// Measured on `boss-bd-2-blues-driver`, whose `IC1A` is a unity-gain bias
				// buffer: the source declares output and inverting input as one node, the
				// linear region is `3.99e-5` wide, and the march is `1.6e-4`. The iterate
				// crossed from `+band` to `-band` and back forever, always in saturation
				// where `tanh` is flat and the Jacobian carries no information. The solve
				// sat on the right answer (node 43 at `7.0607` against ngspice's `7.0605`)
				// for 1024 iterations without being allowed to say so, `solveOperatingPoint`
				// discarded it, and the sample loop walked from zero state to `1.2155`.
				//
				// Halving on reversal makes the cap fall geometrically until it is smaller
				// than the linear region, so the iterate lands *inside* it, the raw
				// differential collapses, and the limiter releases because the step really
				// is small. Doubling back toward `maxStep` on a same-signed step keeps a
				// genuine excursion as fast as it was. The floor stops the cap reaching
				// zero and freezing the iterate short of the answer.
				//
				// The bar in `iterate` is untouched: a limited iterate still cannot satisfy
				// the tolerance. This only changes where an oscillating one goes next.
				const previousCap = previous?.cap ?? maxStep;
				const cap = reversing
					? Math.max(previousCap / 2, linearWidth / 64)
					: Math.min(maxStep, previousCap * 1.2);
				const limited = Math.abs(step) > cap;
				if (limited) {
					this.limitedIterate = true;
					this.limitedBy = `opamp +=${stamp.plus} -=${stamp.minus} out=${stamp.output}`;
					this.limitedOpamp = {
						key: opampKey,
						output: stamp.output,
						centre,
						railHigh: stamp.railHigh,
						railLow: stamp.railLow,
						band,
						maxStep,
						folded: cap <= linearWidth / 8,
					};
				}
				const differential = limited
					? previousDifferential + Math.sign(step) * cap
					: bounded;
				this.opampHistory.set(opampKey, { differential, step, cap });
				// The raw open-loop output. At DC it is the full-gain product of the differential;
				// in the transient it is the backward-Euler step of the pole, so this sample's gain
				// is `alpha` times the DC gain and the raw state carries the previous sample's part.
				const rawPrevious = this.opampRawState.get(opampKey) ?? 0;
				const raw = boundOpAmpRaw(
					dc
						? stamp.openLoopGain * differential
						: alpha * stamp.openLoopGain * differential + (1 - alpha) * rawPrevious,
					halfSwing,
				);
				const scaled = raw / halfSwing;
				const shape = Math.tanh(scaled);
				const output = centre + halfSwing * shape;
				// The value uses the true `raw`; the **derivative** is evaluated at a bounded
				// argument. `1 - shape * shape` underflows to exactly 0 past about
				// `|scaled| = 19` -- `tanh` has rounded to 1 by then -- and a row with a zero
				// coefficient carries no information about its own input, so Newton has
				// nothing to follow and a saturated stage becomes a signal-independent rail
				// source. Measured 2026-08-21: 18 of the 24 corpus packets holding a pinned
				// op-amp had at least one stamp in that state and six packets' verdicts moved
				// when the pole landed.
				//
				// **Only the Jacobian is bounded, and that is why this is safe.** At
				// convergence `Vdiff == differential`, so the row reads `Vout = output` and the
				// fixed point does not depend on `slope` at all: bounding it changes which path
				// Newton takes, not where it lands. The *state* is bounded too, now (2026-09-14)
				// -- a value bound, not a Jacobian one, so the fixed point is unchanged there as
				// well; the raw can never leave ±8 halfSwings. The two are the same move made in
				// the same file on the same row, and the deck emitter's B-source matches (see the
				// advance's comment and `docs/troubleshootings/...saturated-opamp-row...md`).
				const derivativeShape = Math.tanh(
					clamp(scaled, -OPAMP_SATURATION_BAND, OPAMP_SATURATION_BAND),
				);
				const slope = effectiveGain * (1 - derivativeShape * derivativeShape);
				// Linearised: Vout - slope * Vdiff = Vout0 - slope * Vdiff0.
				(matrix[row] as number[])[stamp.output] += 1;
				(matrix[row] as number[])[stamp.plus] -= slope;
				(matrix[row] as number[])[stamp.minus] += slope;
				rhs[row] = output - slope * differential;
				break;
			}
			case "vccs": {
				const gm = stamp.transconductance;
				if (stamp.outP !== 0) {
					if (stamp.inP !== 0) (matrix[stamp.outP] as number[])[stamp.inP] += gm;
					if (stamp.inN !== 0) (matrix[stamp.outP] as number[])[stamp.inN] -= gm;
					if (stamp.biasVolts !== undefined && stamp.biasVolts !== 0) {
						rhs[stamp.outP] = (rhs[stamp.outP] ?? 0) + gm * stamp.biasVolts;
					}
				}
				if (stamp.outN !== 0) {
					if (stamp.inP !== 0) (matrix[stamp.outN] as number[])[stamp.inP] -= gm;
					if (stamp.inN !== 0) (matrix[stamp.outN] as number[])[stamp.inN] += gm;
					if (stamp.biasVolts !== undefined && stamp.biasVolts !== 0) {
						rhs[stamp.outN] = (rhs[stamp.outN] ?? 0) - gm * stamp.biasVolts;
					}
				}
				break;
			}
			case "ota": {
				const vPlus = solution[stamp.plus] ?? 0.0;
				const vMinus = solution[stamp.minus] ?? 0.0;
				const vBias = solution[stamp.bias] ?? 0.0;
				const vVee = solution[stamp.vee] ?? 0.0;

				const vDiff = vPlus - vMinus;
				const vBiasAcross = vBias - vVee;

				// Calculate physical bias current flowing through Vbe diode junction to Vee
				const is = stamp.saturationCurrent;
				const vt = stamp.thermalVoltage;
				// Deliberately NOT the solver's `JUNCTION_EXPONENT_LIMIT`, which is 60 and one-sided.
				// This is a symmetric +/-80 clamp on the OTA's bias-diode exponential, which needs a
				// floor as well as a ceiling because `expBias` also divides into `gBias` below.
				// Renamed so the two constants cannot be mistaken for the same number.
				const OTA_BIAS_EXPONENT_LIMIT = 80;
				const expBias = Math.exp(
					Math.max(
						-OTA_BIAS_EXPONENT_LIMIT,
						Math.min(vBiasAcross / vt, OTA_BIAS_EXPONENT_LIMIT),
					),
				);
				const iAbc = is * (expBias - 1.0);

				// Dynamic bias diode conductance
				const gBias = (is / vt) * expBias;

				// Stamp bias diode conductance into MNA matrix
				stampConductance(matrix, stamp.bias, stamp.vee, gBias);

				// Load bias diode companion current into RHS vector
				const iAbcResidual = iAbc - gBias * vBiasAcross;
				if (stamp.bias !== 0) {
					rhs[stamp.bias] = (rhs[stamp.bias] ?? 0) - iAbcResidual;
				}
				if (stamp.vee !== 0) {
					rhs[stamp.vee] = (rhs[stamp.vee] ?? 0) + iAbcResidual;
				}

				// If bias current is flowing, compute dynamic transconductance and hyperbolic tangent clipping
				if (iAbc > 0) {
					const tanhVal = Math.tanh(vDiff / (2.0 * vt));
					const sechVal = 1.0 / Math.cosh(vDiff / (2.0 * vt));
					const sech2 = sechVal * sechVal;

					const iOut = 2.0 * iAbc * tanhVal;

					// Partial derivatives
					const gDiff = (iAbc / vt) * sech2;
					const gBiasCtrl = 2.0 * gBias * tanhVal;

				// Stamp non-linear transconductance derivatives (current entering output node is -iOut)
					if (stamp.output !== 0) {
						if (stamp.plus !== 0) {
							(matrix[stamp.output] as number[])[stamp.plus] -= gDiff;
						}
						if (stamp.minus !== 0) {
							(matrix[stamp.output] as number[])[stamp.minus] += gDiff;
						}
						if (stamp.bias !== 0) {
							(matrix[stamp.output] as number[])[stamp.bias] -= gBiasCtrl;
						}
						if (stamp.vee !== 0) {
							(matrix[stamp.output] as number[])[stamp.vee] += gBiasCtrl;
						}

						// Load companion current into RHS vector
						const iOutResidual = iOut - gDiff * vDiff - gBiasCtrl * vBiasAcross;
						rhs[stamp.output] = (rhs[stamp.output] ?? 0) + iOutResidual;
					}
				}
				break;
			}
			case "compandor": {
				// NE570/571 channel: the full-wave averaging rectifier (datasheet Figure 9)
				// and the linearized two-quadrant gain cell (Figure 12). The five internal
				// resistors, the 1.8 V reference and the output op-amp are separate stamps
				// the lowering emits, so nothing here has to know what application circuit
				// the packet built -- an expander and a compressor differ only in wiring.
				const stateIdx = stamp.stateIndex;
				const vref = solution[stamp.vref] ?? 0.0;

				// Both quantities the cell needs are read once per committed sample and held
				// across this sample's Newton loop, so the loop solves one circuit instead
				// of walking across a circuit that moves under it. `advanceReactiveState`
				// gives the reactive elements this for free; a stamp that reads the solution
				// has to ask for it. The one-sample lag is nothing against a detector whose
				// time constant is milliseconds.
				const envelopeKey = `${block.id}_env_${stateIdx}`;
				if (
					this.elapsedSamples !==
					(this.lastShiftedSample.get(envelopeKey) ?? -1)
				) {
					this.lastShiftedSample.set(envelopeKey, this.elapsedSamples);
					// Figure 9: the rectifier op-amp's output current, `VIN/R1`, mirrored
					// into a unipolar current. Full-wave, hence the absolute value.
					state[stateIdx] =
						Math.abs((solution[stamp.rectIn] ?? 0.0) - vref) / stamp.r1;

					// Figure 9's note, `IG = 2 * VIN(avg) / R1`: the averaged current is
					// what R5 has turned back into a voltage on the CRECT node, so dividing
					// that node by R5 recovers it. Clamped at zero because the mirror is
					// unipolar -- a negative CRECT voltage is not a negative gain, and
					// letting it through would invert the audio at low envelope levels.
					const iG = Math.max(0.0, (2.0 * (solution[stamp.rectCap] ?? 0.0)) / stamp.r5);

					// Figure 12: `IOUT = IIN * IG/I1` with `IIN = VIN/R2`. As a
					// transconductance from G_CELL_IN to the op-amp summing node that is
					// `gCell = (1/R2) * (IG/I1)` -- siemens, as a matrix entry must be.
					//
					// This is the expander sense: gain *rises* with the envelope. The
					// datasheet is explicit that a compressor is this same cell placed in
					// the op-amp's feedback loop, so the compressing direction belongs to
					// the packet's wiring, not here. The previous model used
					// `(iBias * rInt)/vEnv` -- 2.8 **volts** over volts, a dimensionless
					// number stamped where siemens belong, ~80,000x too large at the
					// nominal operating point and inverted in direction on top of that.
					state[stateIdx + 1] = iG / stamp.iBias / stamp.r2;
				}

				// Inject the rectified current into the CRECT node. The averaging is done by
				// R5 and the packet's own external capacitor on that node, both ordinary
				// stamps -- so the detector time constant is `R5 * CRECT` taken from the
				// circuit. The previous model integrated a private envelope against a
				// hard-coded 50 ms and never read this node at all, leaving CRECT inert.
				rhs[stamp.rectCap] = (rhs[stamp.rectCap] ?? 0) + (state[stateIdx] ?? 0.0);

				const gCell = state[stateIdx + 1] ?? 0.0;

				// The cell draws its input across R2 from G_CELL_IN to VREF and delivers the
				// scaled current into the summing node, so the transconductance is
				// referenced to VREF rather than to ground.
				//
				// **The sign delivers current INTO the summing node**, which is the one thing
				// about this operator the expander could never settle. Figure 6 drives the cell
				// from the *input*, so the cell is outside the op amp's loop: flip this sign and
				// the expander's output inverts while its magnitude is untouched, and nothing
				// notices -- `ne570ExpanderGainAt` is a magnitude, the stated 3.0 V quiescent
				// comes from R3/R4 with the cell carrying no DC at all, and `measureGain` reads
				// half peak-to-peak. Measured, not argued: with this sign reversed, all 354
				// compiler tests and all 100 runtime tests still passed.
				//
				// Figure 7 is what makes it observable, because there the cell sits *inside* the
				// loop, driven from the output. KCL at the summing node then puts the cell's
				// conductance alongside the feedback leg's: `A_out * (1/Rfb +/- gCell)`. With the
				// current delivered inward the two add, gain falls as level rises, and the stage
				// compresses. Drawn outward they subtract, and the stage has a pole at
				// `gCell = 1/Rfb` -- which is not a soft failure. `ne570Compressor` sat just past
				// that pole at every drive level, reporting a gain of 21x falling to 3x, and
				// swinging 118 V to 279 V out of a part running on 9 V.
				//
				// `ne570CompressorOutputAt` is the external check that holds the direction: it is
				// the closed form of that same KCL, built from the datasheet's own R1, R2 and IB,
				// and it predicts 0.4965 where the fixture measures 0.49682. The wrong sign misses
				// it by a factor of fourteen, so this is pinned by arithmetic rather than by a
				// monotonicity that both signs happen to satisfy.
				(matrix[stamp.sumNode] as number[])[stamp.cellIn] -= gCell;
				(matrix[stamp.sumNode] as number[])[stamp.vref] += gCell;
				break;
			}
			case "clock-driver": {
				const vVdd = solution[stamp.vdd] ?? 5.0; // Defaults to +5V positive rail
				const vOx1 = solution[stamp.ox1] ?? 2.5; // Defaults to LFO center

				const stateIdx = stamp.stateIndex;
				let theta = state[stateIdx] ?? 0.0;

				// Map control voltage at ox1 dynamically to frequency (f = defaultFrequency * (vOx1 / 2.5))
				const fScale = vOx1 > 0 ? vOx1 / 2.5 : 1.0;
				const f = Math.max(1000, Math.min(500000, stamp.defaultFrequency * fScale));

				// Track committed oscillator steps once-per-sample to avoid iterative phase drift
				const lastShiftedKey = block.id + "_clk_" + stamp.sourceIndex;
				const lastShifted = this.lastShiftedSample.get(lastShiftedKey) ?? -1;
				if (this.elapsedSamples !== lastShifted) {
					this.lastShiftedSample.set(lastShiftedKey, this.elapsedSamples);
					theta = (theta + dt * f) % 1.0;
					state[stateIdx] = theta;
				}

				// **The phases swing between the part's two supply pins, not between VDD and
				// circuit ground.** The MN3101/MN3102 run on a single negative supply, so a +9 V
				// pedal ties the GND pin to the positive rail and VDD to circuit ground. Swinging
				// against literal ground is right only when the GND pin happens to sit there, and
				// pins every output at zero when it does not -- `boss-ch-1` and `boss-dm-3` were
				// both silent for that reason, both correctly transcribed.
				//
				// When `gnd` *is* the ground row this is bit-identical to the version it replaces,
				// which is what makes it safe for the five packets whose clocks already ran.
				const activePin = (source: number, row: number): void => {
					if (source !== 0) {
						(matrix[row] as number[])[source] -= 1.0;
					}
				};

				// CP1 rests at GND and is driven to VDD for the first half of the cycle.
				const row1 = block.nodeCount + stamp.sourceIndex;
				(matrix[row1] as number[])[stamp.cp1] += 1;
				(matrix[stamp.cp1] as number[])[row1] += 1;
				activePin(theta < 0.5 ? stamp.vdd : stamp.gnd, row1);
				(matrix[row1] as number[])[row1] -= 1.0;
				rhs[row1] = 0.0;

				// CP2 is its complement, so exactly one phase is at VDD at any time.
				const row2 = block.nodeCount + stamp.sourceIndex + 1;
				(matrix[row2] as number[])[stamp.cp2] += 1;
				(matrix[stamp.cp2] as number[])[row2] += 1;
				activePin(theta >= 0.5 ? stamp.vdd : stamp.gnd, row2);
				(matrix[row2] as number[])[row2] -= 1.0;
				rhs[row2] = 0.0;

				// VGG sits 14/15 of the way from the GND pin toward VDD, which is
				// `(1/15) * gnd + (14/15) * vdd` and reduces to the old `(14/15) * vdd` when the
				// GND pin is at circuit ground.
				const row3 = block.nodeCount + stamp.sourceIndex + 2;
				(matrix[row3] as number[])[stamp.vgg] += 1;
				(matrix[stamp.vgg] as number[])[row3] += 1;
				if (stamp.vdd !== 0) {
					(matrix[row3] as number[])[stamp.vdd] -= 14.0 / 15.0;
				}
				if (stamp.gnd !== 0) {
					(matrix[row3] as number[])[stamp.gnd] -= 1.0 / 15.0;
				}
				(matrix[row3] as number[])[row3] -= 1.0;
				rhs[row3] = 0.0;
				break;
			}
			case "comparator": {
				const vPlus = solution[stamp.plus] ?? 0.0;
				const vMinus = solution[stamp.minus] ?? 0.0;
				const vOutput = solution[stamp.output] ?? 0.0;
				const vVee = solution[stamp.vee] ?? 0.0;

				const vDiff = vPlus - vMinus;
				const k = stamp.sensitivity;

				// Sigmoid open-collector conductance: g(vDiff) = gOn / (1 + e^(k*vDiff)) + gOff
				// Safe exponential to prevent overflow
				const expArg = k * vDiff;
				const sigmoidVal = expArg > 80 ? 0.0 : (expArg < -80 ? 1.0 : 1.0 / (1.0 + Math.exp(expArg)));

				const gOn = 1.0 / stamp.pullDownOhms;
				const gOff = 1.0 / stamp.floatOhms;
				const gCell = gOn * sigmoidVal + gOff;

				// The value term: an ordinary conductance between output and vee at this
				// iterate's `gCell`. Linear in `v(output) - v(vee)` at fixed `gCell`, so it
				// needs no companion current of its own.
				stampConductance(matrix, stamp.output, stamp.vee, gCell);

				// The control term, `dI/dvDiff`. Differentiating `1/(1 + exp(k*vDiff))` gives
				// `-k*sigma*(1 - sigma)`, so **the slope is negative**: raising `v(+)` shrinks
				// the pull-down conductance and lets the output rise. That minus sign was
				// missing, and with the companion current below it inverted the whole response
				// while leaving the operating point right -- see
				// docs/troubleshootings/the-comparator-stamp-responds-backwards.md.
				const dSigmoid = -k * sigmoidVal * (1.0 - sigmoidVal);
				const gControl = gOn * dSigmoid * (vOutput - vVee);

				// `I ~= gCell*(vOut - vVee) + gControl*(v(+) - v(-)) - gControl*vDiff`, so the
				// matrix carries `gControl` on the input columns and the constant cancels it at
				// this iterate. The current leaves `output` and enters `vee`, so both rows get
				// the terms -- omitting the `vee` row created current from nowhere whenever
				// `vee` was not ground.
				if (stamp.output !== 0) {
					if (stamp.plus !== 0) {
						(matrix[stamp.output] as number[])[stamp.plus] += gControl;
					}
					if (stamp.minus !== 0) {
						(matrix[stamp.output] as number[])[stamp.minus] -= gControl;
					}
				}
				if (stamp.vee !== 0) {
					if (stamp.plus !== 0) {
						(matrix[stamp.vee] as number[])[stamp.plus] -= gControl;
					}
					if (stamp.minus !== 0) {
						(matrix[stamp.vee] as number[])[stamp.minus] += gControl;
					}
				}

				// The companion current, in the same convention the OTA's bias diode uses:
				// `rhs[node] -= (constant current leaving node)`.
				const controlResidual = -gControl * vDiff;
				if (stamp.output !== 0) {
					rhs[stamp.output] = (rhs[stamp.output] ?? 0) - controlResidual;
				}
				if (stamp.vee !== 0) {
					rhs[stamp.vee] = (rhs[stamp.vee] ?? 0) + controlResidual;
				}
				break;
			}
			case "linear-vca": {
				// Linear-control VCA gain cell (M5207L01): the output current is
				// the input current times the control voltage over vrefVolts,
				// floored at minGain. Evaluated per Newton iterate with analytic
				// derivatives (no state, unlike the compandor's held envelope:
				// this law is piecewise-linear, so there is nothing to hold).
				// The control input is voltage-sense ONLY: no conductance is
				// stamped on it, so a high-impedance depth network drives it
				// without sagging. Control is referenced to the minus input
				// (the part's COM in single-supply use).
				//
				// Sign convention is the file's leaving-positive KCL (see the
				// diode: matrix carries d(leaving)/dV, rhs carries
				// -(I0 - dI*V0)): the stamp's physical current ENTERS the
				// output node, so every term below is negated once.
				const vPlus = solution[stamp.plus] ?? 0.0;
				const vMinus = solution[stamp.minus] ?? 0.0;
				const vControl = solution[stamp.control] ?? 0.0;
				const vref =
					stamp.vrefVolts > 0 ? stamp.vrefVolts : 1;
				const vIn = vPlus - vMinus;
				const iIn = vIn * stamp.inputSiemens;
				const vc = vControl - vMinus;
				const overFloor = vc / vref > stamp.minGain;
				const gain = overFloor ? vc / vref : stamp.minGain;
				const dGain = overFloor ? 1 / vref : 0;
				// The datasheet's 0 dB condition (note 1, p.5-86): unity gain
				// holds when Vc = Vref AND Ro = 2*Ri. With Vout = Iout*Ro and
				// Iin = Vin/Ri, that forces the cell's current ratio to 1/2
				// at Vc = Vref -- so the output current is halved once here,
				// and the derivatives with it. Without the half, a render at
				// Vc = 1 measures exactly twice the datasheet gain.
				const iOut = (iIn * gain) / 2;
				const gIn = (gain * stamp.inputSiemens) / 2;
				const gCtrl = (iIn * dGain) / 2;
				// Leaving-positive: the output current leaves toward the load
				// as -iOut, so d(leaving)/dVplus is -gIn, and likewise down
				// the row; the companion is -(I0 - dI*V0) like the diode's.
				const leaving = -iOut;
				const equivalent =
					leaving -
					(-gIn * vPlus +
						(gIn + gCtrl) * vMinus +
						-gCtrl * vControl);
				if (stamp.output !== 0) {
					if (stamp.plus !== 0) {
						(matrix[stamp.output] as number[])[stamp.plus] += -gIn;
					}
					if (stamp.minus !== 0) {
						(matrix[stamp.output] as number[])[stamp.minus] +=
							gIn + gCtrl;
					}
					if (stamp.control !== 0) {
						(matrix[stamp.output] as number[])[stamp.control] += -gCtrl;
					}
					rhs[stamp.output] =
						(rhs[stamp.output] ?? 0) - equivalent;
				}
				break;
			}
			case "spring-reverb": {
				// Two ports, both ordinary stamps; everything mechanical lives in the state
				// advanced once per sample by `advanceSpringReverb`.
				//
				// Input: the drive coil is a load on the reverb driver, and its rated impedance
				// is what the driver actually sees. Without it the driver stage runs unloaded
				// and its gain is wrong whether or not anything reverberates.
				const conductance = 1 / Math.max(stamp.inputOhms, MIN_STAMP_OHMS);
				(matrix[stamp.inputPlus] as number[])[stamp.inputPlus] += conductance;
				(matrix[stamp.inputMinus] as number[])[stamp.inputMinus] += conductance;
				(matrix[stamp.inputPlus] as number[])[stamp.inputMinus] -= conductance;
				(matrix[stamp.inputMinus] as number[])[stamp.inputPlus] -= conductance;
				// Output: the pickup as a Thevenin source at its rated impedance, exactly the
				// `dc-source` shape -- the `-R` term on the branch row's own diagonal -- with the
				// value coming from this tank's state rather than a constant.
				const row = block.nodeCount + stamp.sourceIndex;
				(matrix[row] as number[])[stamp.outputPlus] += 1;
				(matrix[stamp.outputPlus] as number[])[row] += 1;
				(matrix[row] as number[])[stamp.outputMinus] -= 1;
				(matrix[stamp.outputMinus] as number[])[row] -= 1;
				(matrix[row] as number[])[row] -= stamp.outputOhms;
				rhs[row] =
					(this.springOutputVolts.get(springKey(block.id, stamp.sourceIndex)) ??
						0) * sourceScale;
				break;
			}
			case "macro-audio-source": {
				// The `coupled` port's load side, same shape as `dc-source`'s single-ended form
				// (`input-source`) plus a series impedance (`dc-source`'s own `sourceOhms`
				// term): value AND admittance, never a bare sample. The only difference from
				// `dc-source` is where the value comes from -- a named macro's own write-back,
				// resolved here rather than carried on the stamp, because it changes every
				// sample and a stamp is not the place for that.
				const row = block.nodeCount + stamp.sourceIndex;
				// The stamp kind keeps its name because it is a declared `OperatorKind` and
				// renaming it would be a program-format change for nothing; since board-p3
				// row 7 only a composition ever publishes through it.
				// Affine DC-transfer coefficients, set below when `dc`; the transient
				// path leaves them at zero and reads the write-back maps instead.
				let gain = 0;
				let offset = 0;
				if (dc) {
					// **The operating-point solve iterates the core with the MNA, in the
					// matrix, not beside it.** A lagged source update (recomputing the
					// value from the last iterate) leaves the DC loop outside the
					// Jacobian: Newton slams the surrounding amplifiers on the first
					// step and parks them at rails, because nothing in the linear
					// system pulls back. Stamping the transfer's affine form instead
					// (`V(node) = G·V(tap) + O`, from two evaluations of the ops)
					// closes the loop inside the Newton system, exactly like any
					// other feedback the matrix already sees. Same-block taps read
					// the iterate being built (`solution`); cross-block taps read
					// the last solved state, one Newton step of lag in both cases
					// and an exact fixed point either way. Null transfer (no lines,
					// DC-blocked, or an op outside the DC vocabulary) stamps the
					// pre-existing 0, exactly as before.
					// No extra `sourceScale`: both evaluations derive from the live
					// tap, which already carries the continuation's scaling.
					const bi = this.blockIndexById.get(stamp.macroId);
					const composed =
						bi === undefined ? undefined : this.program.blocks[bi];
					if (composed !== undefined && composed.kind === "composed") {
						const port = composed.audioIn;
						const tapNode =
							port === null || port.block !== block.id ? null : port.node;
						const crossTap =
							port === null || port.block === block.id
								? null
								: (this.nodeVoltages.get(port.block)?.[port.node] ?? 0);
						const at = (t: number): number | null => {
							if (tapNode !== null) {
								return this.composedDcTransfer(
									composed,
									t,
									(id, node) =>
										id === block.id
											? (solution[node] ?? 0)
											: (this.nodeVoltages.get(id)?.[node] ?? 0),
								);
							}
							return this.composedDcTransfer(
								composed,
								crossTap ?? 0,
								(id, node) => this.nodeVoltages.get(id)?.[node] ?? 0,
							);
						};
						// The transfer is affine in the tap: every op in the DC
						// vocabulary (tap passthrough, DC block, mix gains) is.
						const zero = at(0);
						const one = at(1);
						if (zero !== null && one !== null) {
							gain = one - zero;
							offset = zero;
						}
						if (tapNode !== null) {
							(matrix[row] as number[])[tapNode] -= gain;
						} else if (crossTap !== null) {
							offset += gain * crossTap;
							gain = 0;
						}
					}
				}
				(matrix[row] as number[])[stamp.node] += 1;
				(matrix[stamp.node] as number[])[row] += 1;
				(matrix[row] as number[])[row] -= stamp.sourceOhms;
				if (dc) {
					rhs[row] = offset;
					break;
				}
				const dcBias =
					this.composedDcState.get(stamp.macroId)?.dcOperatingPoint ?? 0;
				rhs[row] =
					((this.macroOutputVolts.get(stamp.macroId) ?? 0) + dcBias) *
					sourceScale;
				break;
			}
			default:
				// The cartridge lockout, in the one place it can be enforced today.
				//
				// This was `break`, so a program carrying an operator this executor does
				// not implement had the operator **silently dropped**: measured by adding a
				// `triode` stamp to a real program, which emit accepted, decode accepted,
				// and the runtime executed to output byte-identical to the program without
				// it, telemetry all zeroes. A ROM naming an instruction the console lacks
				// must not play a quieter, wrong version of itself.
				//
				// The `never` binding makes a stamp kind added to the union a compile error
				// here as well as in `lower.ts`, and the throw covers the case the type
				// system cannot see: a serialized program from another producer, or a
				// future one, reaching an executor that predates its operator set.
				throw new RuntimeError(
					`program uses operator "${(stamp as { kind: string }).kind}", which this runtime does not implement`,
				);
		}
	}
}

// --- packed history keys -----------------------------------------------------

/**
 * The base a block index and node indices are packed against to build a single safe-integer
 * history key -- see `bjtHistory`'s comment for why this exists instead of a stamp reference or
 * a string. `8192` gives comfortable headroom over any block this runtime has seen (the largest,
 * `boss-hm-2`'s `analog:0`, has `nodeCount + auxCount = 83`): a 3-node key
 * (`packHistoryKey3`, which also folds in the block index) tops out around
 * `(blockIndex + 1) * 8192^3 ≈ (blockIndex + 1) * 5.5e11`, comfortably under
 * `Number.MAX_SAFE_INTEGER` (`~9.007e15`) for any realistic block count.
 */
const HISTORY_KEY_BASE = 8192;

/** A history key for a two-terminal device (`diode`, `tube-diode`), scoped to one block. */
function packHistoryKey2(blockIndex: number, a: number, b: number): number {
	return (blockIndex * HISTORY_KEY_BASE + a) * HISTORY_KEY_BASE + b;
}

/**
 * A history key for a three-terminal device (`bjt`, `fet`, `ideal-opamp`, `triode`/`pentode`),
 * scoped to one block.
 */
function packHistoryKey3(
	blockIndex: number,
	a: number,
	b: number,
	c: number,
): number {
	return (
		((blockIndex * HISTORY_KEY_BASE + a) * HISTORY_KEY_BASE + b) *
			HISTORY_KEY_BASE +
		c
	);
}

// --- small dense linear algebra ----------------------------------------------

function zeros(size: number): number[][] {
	return Array.from({ length: size }, () => new Array<number>(size).fill(0));
}

/**
 * The optocoupler emitter's junction, cited from `component-diode-chips.json`'s `LED-RED`
 * entry: `emissionCoefficient` typ 2 and `forwardVoltageAt1mA` typ 1.8 V. Kept identical in
 * `cpp/Engine.cpp` and in `scripts/lib/source-to-spice.ts`, which the parity gate compares.
 */
const OPTO_LED_EMISSION_VOLTS = 2 * 0.025_852;
const OPTO_LED_SATURATION_AMPS = 7.6e-19;

function stampConductance(
	matrix: number[][],
	a: number,
	b: number,
	siemens: number,
): void {
	(matrix[a] as number[])[a] += siemens;
	(matrix[b] as number[])[b] += siemens;
	(matrix[a] as number[])[b] -= siemens;
	(matrix[b] as number[])[a] -= siemens;
}

/**
 * Gaussian elimination with partial pivoting. Sizes here are small.
 *
 * Eliminates directly on the caller's `matrix`/`rhs` rather than defensive copies of them.
 * Safe because `iterate` is the only caller and does not read either buffer again after this
 * call within the same iteration -- the next iteration zeroes both in place before re-stamping
 * (see `iterationScratch`'s comment).
 *
 * Writes the answer into the caller's `out` rather than allocating and returning a fresh
 * array. Safe for the same reason zeroing `matrix`/`rhs` in place is: `iterate` passes one of
 * its two ping-pong buffers as `out`, always the one that is NOT this iteration's `current`
 * (the iterate the stamps above were just evaluated against) -- so writing here can never
 * clobber a value this same call still needs to read. `out[row]` is assigned exactly once for
 * every `row` from `size - 1` down to `0` before the function returns, and the back-substitution
 * loop only ever reads `out[column]` for `column > row`, i.e. an entry this same downward pass
 * already wrote -- so `out`'s incoming contents (last iteration's answer, still live in the
 * OTHER ping-pong buffer) are never read, only overwritten.
 */
function solve(matrix: number[][], rhs: number[], out: number[]): void {
	const size = rhs.length;
	const rowOrder = Array.from({ length: size }, (_, index) => index);
	const b = rhs;

	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (
				Math.abs((matrix[rowOrder[row] as number] as number[])[column] ?? 0) >
				Math.abs((matrix[rowOrder[pivot] as number] as number[])[column] ?? 0)
			) {
				pivot = row;
			}
		}
		if (
			Math.abs(
				(matrix[rowOrder[pivot] as number] as number[])[column] ?? 0,
			) < 1e-18
		) {
			continue;
		}
		if (pivot !== column) {
			const p = rowOrder[column] as number;
			rowOrder[column] = rowOrder[pivot] as number;
			rowOrder[pivot] = p;
			const value = b[column] as number;
			b[column] = b[pivot] as number;
			b[pivot] = value;
		}
		const pivotRow = rowOrder[column] as number;
		const pivotValue = (matrix[pivotRow] as number[])[column] as number;
		for (let row = column + 1; row < size; row += 1) {
			const currentRow = rowOrder[row] as number;
			const factor =
				((matrix[currentRow] as number[])[column] as number) / pivotValue;
			if (factor === 0) {
				continue;
			}
			for (let inner = column; inner < size; inner += 1) {
				(matrix[currentRow] as number[])[inner] -=
					factor * ((matrix[pivotRow] as number[])[inner] as number);
			}
			b[row] = (b[row] as number) - factor * (b[column] as number);
		}
	}

	for (let row = size - 1; row >= 0; row -= 1) {
		const currentRow = rowOrder[row] as number;
		const diagonal = (matrix[currentRow] as number[])[row] as number;
		if (Math.abs(diagonal) < 1e-18) {
			out[row] = 0;
			continue;
		}
		let sum = b[row] as number;
		for (let column = row + 1; column < size; column += 1) {
			sum -=
				((matrix[currentRow] as number[])[column] as number) *
				(out[column] as number);
		}
		out[row] = sum / diagonal;
	}
}

// --- static sparse elimination schedule ---------------------------------------
//
// `solve` above is dense Gaussian elimination on the whole system, and `--cpu-prof` measured
// it at 24-73% of render self-time, rising steeply with block size (73% on `ibanez-ts808`).
// The matrices are 4-17% dense and their fill-in under a good ordering is a handful of
// entries, so the elimination's *shape* -- which multiply-add happens against which entry, in
// which order -- is a static property of the block that can be worked out once in `prepare()`
// and then replayed per solve as a flat opcode stream, skipping every structural zero.
//
// This is an execution strategy, not circuit semantics, so it lives in the runtime and
// changes nothing about the program contract: no operator format, no artifact regeneration,
// no catalogue rebuild. The runtime already holds the block's stamps, which is all the
// pattern needs.

/** The opcode stream's per-instruction width, in `Int32Array` slots. */
const SCHEDULE_OP_WIDTH = 4;

/**
 * Pivot guard floor: a pivot below this absolute value sends the solve back
 * to the dense path.
 *
 * This is deliberately ABSOLUTE, not relative, and that is a measured
 * position rather than a default. A relative guard (`|pivot| < tau *
 * max|gathered|`) was implemented and reverted 2026-10-08: at tau 1e-12 it
 * dropped healthy `boss-ce-5` to dense outright; at 1e-14 it gratuitously
 * re-pivoted `boss-ch-1`; at 1e-16 it abandoned `boss-dd-3b` and
 * `mxr-blue-box`, dropped `boss-tw-1` (losing its 0.8x budget fix) and
 * `mxr-dyna-comp`'s rescue, regressed `boss-nf-1` audio 1000x (7.0e-11 to
 * 7.7e-05), and put 528k fallback solves onto `moogerfooger-mf-102` for no
 * audio change. The census behind it: healthy `ce-5`/`ch-1`/carbon-copy
 * bottom out at 1.0-2.5e-15 while fatal `aw-2` sits at 7.7e-15 -- magnitude
 * alone cannot separate a healthy late-order gmin pivot from a fatal one,
 * only a replay against dense can, which is the settle gate's job, not this
 * one's. So this floor catches exactly what it can judge -- collapse -- and
 * the re-pivot-once below handles the shape that collapse takes mid-run.
 * See `docs/spikes/2026-10-08-numeric-pivoting.md`.
 *
 * Exported for the unit tests alongside the replay: the trip formula is
 * load-bearing and the corpus never trips it, so only a synthetic matrix
 * pins it.
 */
export const SCHEDULE_PIVOT_FLOOR = 1e-18;

/**
 * How far the sparse replay's answer for the assembled operating-point matrix
 * may disagree with the dense solve's before the shipped order is dropped.
 *
 * This is a comparison, not a pivot theory: per-pivot ratios do not separate
 * healthy blocks from broken ones (healthy `boss-ce-5` carries 18 pivots below
 * `1e-3 * columnMax` and matches dense to `1e-10`; broken `boss-aw-2` carries
 * 14), because a tiny pivot is harmless late in the order and fatal early.
 * Replaying both solves on the same matrix asks the only question that
 * matters -- do they agree -- and the pivot ratios stay on as diagnostics for
 * the phase-2 numeric re-ordering work. The corpus check that holds this value
 * is `bun scripts/report-solver-plan.ts`: every block outside the row-6 set
 * must validate clean.
 */
const SCHEDULE_VALIDATION_TOL = 1e-3;

/**
 * Audio-agreement bar for adopting a value-aware order over a shipped order
 * that already validates.
 *
 * The shipped order replays the operating-point matrix within
 * `SCHEDULE_VALIDATION_TOL`; the refinement below replaces it only when the
 * numeric candidate reaches the corpus acceptance bar (sparse vs dense at
 * most 1e-9 relative) an order of magnitude more cleanly, without meaningful
 * fill cost. Measured 2026-10-08: `boss-sd-1` crosses (operating-point replay
 * 1.8e-9 to 4.2e-13, audio 6.9e-8 to 6.5e-12); `boss-hm-2`, `boss-ch-1`,
 * `boss-od-3` tie and keep shipped; `marshall-jcm800` and `boss-tw-1` cannot
 * cross at any tau and keep shipped. See
 * `docs/spikes/2026-10-08-numeric-pivoting.md`.
 */
const SCHEDULE_REFINEMENT_BAR = 1e-9;
/**
 * How much cleaner the candidate's operating-point replay must be than the
 * shipped order's before the refinement above fires. Ties (the common case --
 * both orders replay a healthy matrix to the same rounding) keep shipped, so
 * adoption never churns a schedule for noise. 10x sits in the measured
 * canyon: ties are within ~1x, real wins are 1000x or more.
 */
const SCHEDULE_REFINEMENT_RATIO = 10;
/**
 * Fill-growth ceiling for a refinement adoption, in slots and in ops. A
 * better replay that costs a third more elimination (`boss-mt-2`: +34% ops
 * for no audio gain; `mxr-phase-90`: +30% ops for an audio *regression*)
 * fails the cost criterion it was meant to serve, so the rule refuses it and
 * keeps shipped. Measured adopters sit far below: `boss-sd-1` +6.5% ops.
 */
const SCHEDULE_REFINEMENT_MAX_COST_GROWTH = 1.1;

// A **residual check on the schedule's answer was implemented, measured and removed.** The
// reasoning that motivated it was that a static order might produce a bad answer where a
// pivoting one does not, and that the answer should therefore be verified rather than trusted.
// Measured against the shipped dense solve on real corpus matrices across a control sweep, that
// premise is false: the schedule's scaled residual is at the dense solve's own level -- 1e-16
// to 1e-37 -- on every packet, including the handful where the two answers differ by far more
// than rounding. Those disagreements are the **conditioning** of the matrix, not an error in
// either solve, so a residual check has nothing to separate; set tight enough to fire at all it
// rejected 61% of solves, and it cost 15-25% of render time. See the changelog.

/**
 * How much cheaper the schedule must be, in multiply-adds against the dense elimination's
 * `(n^3 - n)/3`, before a block is put on it. See `planSparseSchedule` for why this is a ratio
 * rather than a size.
 */
const SCHEDULE_MINIMUM_SAVING = 4;

/**
 * How many consecutive pivot-guard trips make a block give its schedule up for good.
 *
 * A block that trips occasionally is one with a degenerate sample here and there, and the
 * fallback is exactly the right answer for it -- measured, `boss-bd-2` trips 9 times in 34,896
 * solves and is 13x faster overall. A block that trips on *every* solve is a different animal:
 * `ibanez-pql`, the one packet the deadline report already calls a wrong formulation, trips
 * 100% and so pays for the schedule and then the dense solve, which measured **5.6% slower**
 * than not having tried. That was the only regression in the corpus, and this removes it.
 *
 * Consecutive rather than a rate, because a rate needs a window and a window needs a decision
 * about what to do before it fills. 64 in a row is not an unlucky operating point.
 */
const SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT = 64;

/**
 * Whether a validating shipped order should be replaced by the numeric
 * candidate: the refinement half of `settlePivotOrders`, extracted pure so
 * both consoles and the unit tests share the exact predicate.
 *
 * Adopt only when the shipped order is above the audio-agreement bar while
 * the candidate reaches it, by an order of magnitude, without meaningful
 * fill cost. The shipped-side floor matters as much as the candidate-side
 * bar: without it, bar-clean ties with a 1000x replay gap (`trainwreck`,
 * `fender-5e3`, `vox-ac15`) churn schedules -- and lose their generated
 * kernels on the C++ console -- for zero audio gain, and `hiwatt-dr103`
 * adopts on one console but not the other from libm-level matrix noise.
 * Every input is an operating-point-replay disagreement or a slot/op count
 * -- no audio renders, no per-packet gates.
 */
export function shouldRefinePivotOrder(input: {
	readonly shippedDisagreement: number;
	readonly candidateDisagreement: number;
	readonly shippedOps: number;
	readonly shippedSlots: number;
	readonly candidateOps: number;
	readonly candidateSlots: number;
}): boolean {
	// Total on purpose: settle only calls this when the shipped order
	// validates (finite, within tolerance), but a refused replay reads as
	// Infinity and must never refine -- that case belongs to the rescue
	// branch, with its looser bar, or to the drop.
	if (
		!Number.isFinite(input.shippedDisagreement) ||
		!Number.isFinite(input.candidateDisagreement)
	) {
		return false;
	}
	return (
		input.shippedDisagreement > SCHEDULE_REFINEMENT_BAR &&
		input.candidateDisagreement <= SCHEDULE_REFINEMENT_BAR &&
		input.candidateDisagreement <
			input.shippedDisagreement / SCHEDULE_REFINEMENT_RATIO &&
		input.candidateOps <=
			SCHEDULE_REFINEMENT_MAX_COST_GROWTH * input.shippedOps &&
		input.candidateSlots <=
			SCHEDULE_REFINEMENT_MAX_COST_GROWTH * input.shippedSlots
	);
}

/**
 * Replay a schedule against one stamped matrix.
 *
 * Returns `false` without finishing when a pivot has collapsed below
 * `SCHEDULE_PIVOT_FLOOR`, which is the caller's signal to run the dense solve
 * for this iteration instead. Nothing the caller still needs is destroyed on
 * the way: `matrix` is only read (the gather copies out of it), `rhs` is
 * copied into the schedule's own buffer, and `out` is a scratch buffer the
 * dense fallback overwrites in full.
 *
 * Exported for the unit tests: the trip formula is load-bearing and the
 * corpus never trips it, so only a synthetic matrix pins the boundary.
 */
export function runSparseSchedule(
	schedule: SparseSchedule,
	matrix: number[][],
	rhs: readonly number[],
	values: Float64Array,
	scratchRhs: Float64Array,
	factors: Float64Array,
	out: number[],
): boolean {
	const { ops, gatherRow, gatherColumn, slots, size } = schedule;
	for (let index = 0; index < slots; index += 1) {
		values[index] = (matrix[gatherRow[index] as number] as number[])[
			gatherColumn[index] as number
		] as number;
	}
	for (let index = 0; index < size; index += 1) {
		scratchRhs[index] = rhs[index] as number;
	}
	let accumulator = 0;
	for (let at = 0; at < ops.length; at += SCHEDULE_OP_WIDTH) {
		const op = ops[at] as number;
		const a = ops[at + 1] as number;
		const b = ops[at + 2] as number;
		// Ordered by how often each opcode runs, not by opcode number: the fill-in update is
		// the overwhelming majority of the stream.
		if (op === 1) {
			values[a] =
				(values[a] as number) -
				(factors[b] as number) * (values[ops[at + 3] as number] as number);
		} else if (op === 0) {
			factors[a] =
				(values[b] as number) / (values[ops[at + 3] as number] as number);
		} else if (op === 2) {
			scratchRhs[a] =
				(scratchRhs[a] as number) -
				(factors[b] as number) * (scratchRhs[ops[at + 3] as number] as number);
		} else if (op === 4) {
			accumulator -= (values[a] as number) * (out[b] as number);
		} else if (op === 3) {
			accumulator = scratchRhs[a] as number;
		} else if (op === 5) {
			out[a] = accumulator / (values[b] as number);
		} else if (Math.abs(values[a] as number) < SCHEDULE_PIVOT_FLOOR) {
			return false;
		}
	}
	return true;
}

/**
 * LU-decompose `matrix` in place, with partial pivoting, so a right-hand side that arrives
 * *later* -- not known at factorisation time -- can be solved against it without repeating
 * the elimination (`solveLU`).
 *
 * Build-order step 6's whole saving, in its final form: `M_lin[L][L]` is the same matrix for
 * every sample the control positions do not change, so this pays the `O(n^3)` elimination
 * once per control-generation instead of once per sample -- see `iterateEliminated`'s
 * `cachedGeneration` check, and `setControl`'s comment on why invalidation is global.
 *
 * **Pivoting is never reused across two different matrices.** The pivot order this settles
 * on is valid only for the exact matrix it was computed from; a control move produces a
 * genuinely different matrix, and `iterateEliminated` always calls this fresh (with fresh
 * pivoting) whenever `cachedGeneration` disagrees with `controlGeneration`. So there is no
 * "pivot order good at one control position, poor at another" risk to reason about: the
 * *only* time a stored pivot order is reused is across samples where the matrix, not merely
 * its right-hand side, is bit-for-bit identical to the one it was chosen for.
 *
 * Same pivoting rule as `solve` (largest-magnitude candidate in the remaining column) and
 * the same near-singular convention (a pivot below `1e-18` is left alone rather than
 * divided by, matching `solve`'s own `continue`) -- a sibling, not a replacement, kept that
 * way so the reference path this function's caller is diffed against never depends on it.
 *
 * Returns the permutation actually applied: `permutation[i]` is which row of the *original*
 * matrix ended up at position `i`, for `solveLU` to apply the same reordering to a future
 * right-hand side before forward substitution.
 */
function factorLU(matrix: number[][]): {
	readonly permutation: readonly number[];
} {
	const size = matrix.length;
	const a = matrix;
	const permutation = Array.from({ length: size }, (_, index) => index);

	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (
				Math.abs((a[row] as number[])[column] ?? 0) >
				Math.abs((a[pivot] as number[])[column] ?? 0)
			) {
				pivot = row;
			}
		}
		if (pivot !== column) {
			const rowA = a[column] as number[];
			a[column] = a[pivot] as number[];
			a[pivot] = rowA;
			const p = permutation[column] as number;
			permutation[column] = permutation[pivot] as number;
			permutation[pivot] = p;
		}
		const pivotValue = (a[column] as number[])[column] as number;
		if (Math.abs(pivotValue) < 1e-18) {
			continue;
		}
		for (let row = column + 1; row < size; row += 1) {
			const factor = ((a[row] as number[])[column] as number) / pivotValue;
			// Doolittle form: the multiplier replaces the entry it would have zeroed,
			// which is exactly `L`'s strictly-lower-triangular part -- `solveLU`'s forward
			// substitution reads it back from here.
			(a[row] as number[])[column] = factor;
			if (factor === 0) {
				continue;
			}
			for (let inner = column + 1; inner < size; inner += 1) {
				(a[row] as number[])[inner] -=
					factor * ((a[column] as number[])[inner] as number);
			}
		}
	}
	return { permutation };
}

/**
 * Solve `A @ x = rhs` given `A`'s factorisation from `factorLU` and the permutation it
 * recorded, for a right-hand side that was not available when `A` was factorised.
 *
 * `out` may safely be a different array from `rhs` or the same one aliased through a
 * caller's own buffer reuse -- forward substitution reads `rhs` once per row into `out`
 * before touching it further, and back substitution's read of `out[column]` for
 * `column > row` is always a value back substitution itself already finalised on an earlier
 * (higher-index) pass, never the forward-substitution value it is about to overwrite at
 * `row`.
 */
function solveLU(
	factored: readonly (readonly number[])[],
	permutation: readonly number[],
	rhs: readonly number[],
	out: number[],
): void {
	const size = factored.length;
	for (let i = 0; i < size; i += 1) {
		out[i] = rhs[permutation[i] as number] as number;
	}
	// Forward substitution: L is unit lower triangular, its multipliers stored below the
	// diagonal by `factorLU`.
	for (let i = 0; i < size; i += 1) {
		let sum = out[i] as number;
		const row = factored[i] as readonly number[];
		for (let column = 0; column < i; column += 1) {
			sum -= (row[column] as number) * (out[column] as number);
		}
		out[i] = sum;
	}
	// Back substitution: U is upper triangular, stored at and above the diagonal.
	for (let i = size - 1; i >= 0; i -= 1) {
		let sum = out[i] as number;
		const row = factored[i] as readonly number[];
		for (let column = i + 1; column < size; column += 1) {
			sum -= (row[column] as number) * (out[column] as number);
		}
		const diagonal = row[i] as number;
		out[i] = Math.abs(diagonal) < 1e-18 ? 0 : sum / diagonal;
	}
}

/**
 * Build-order step 6, vertical slice: which rows a stamp's own nonlinear law writes into.
 *
 * `null` means this stamp kind is unconditionally linear -- it contributes only to the
 * matrix that stays constant for the whole sample, never re-evaluated per Newton
 * iteration. A row here is where the *equivalent-current* term lands (the row `iterate`'s
 * `applyStamp` writes `rhs[...]` for), not every row a law merely *reads*: an ideal op-amp
 * reads `plus`/`minus` but injects current only at `output` and its own auxiliary row,
 * because an ideal input draws none -- so `plus`/`minus` are eliminated into the linear
 * part exactly like any other node, and its own law only needs the two rows it actually
 * drives. Getting a read row wrong here costs nothing (the linear elimination still
 * carries it correctly through `Z`); getting a *write* row wrong would silently drop a
 * current and is what the exactness gate below exists to catch.

/**
 * Whether every unknown moved less than its own tolerance.
 *
 * Per unknown, not on the largest delta in the vector: a node at 9 V and a node at 1 mV
 * do not deserve the same absolute allowance, and judging the whole system by its largest
 * entry is what makes a big circuit harder to converge than a small one for no physical
 * reason.
 */
/**
 * The relative KCL residual of `x` against the system stamped at `x`.
 *
 * **Free, because the caller has already stamped it.** For companion-form MNA `A(x)*x - b(x)` IS
 * the residual: a diode's companion is `I = Geq*V + Ieq` with `Ieq = I(x) - Geq*x`, so evaluating
 * the row at `V = x` recovers the true device current and the row sum is that node's KCL error.
 * No re-stamping, and therefore no limiter-history side effects -- which is what makes it usable
 * inside the Newton loop rather than beside it.
 *
 * **Must be called BEFORE the solve.** `solve` factorises `matrix` in place and uses `rhs` as
 * working storage, so anything read afterwards is post-elimination rather than the stamped system.
 *
 * Walks `pairs` (the schedule's pattern plus fill) when the block has one, because every nonzero
 * of rows 1..n-1 is inside it by construction -- 545 entries instead of 12,544 on a 112-unknown
 * block. Falls back to the dense walk when it does not.
 *
 * Relative per row, so it is comparable across packets, scales and operating points. Row 0 is the
 * ground pin and is skipped.
 */
function relativeResidual(
	matrix: readonly (readonly number[])[],
	rhs: readonly number[],
	x: readonly number[],
	pairs: Int32Array | null,
	size: number,
): number {
	const acc = new Float64Array(size);
	const scale = new Float64Array(size);
	if (pairs === null) {
		for (let row = 1; row < size; row += 1) {
			const rowRef = matrix[row] as readonly number[];
			for (let col = 0; col < size; col += 1) {
				const term = (rowRef[col] as number) * (x[col] as number);
				acc[row] += term;
				scale[row] += Math.abs(term);
			}
		}
	} else {
		for (let index = 0; index < pairs.length; index += 2) {
			const row = pairs[index] as number;
			if (row === 0) continue;
			const col = pairs[index + 1] as number;
			const term = ((matrix[row] as readonly number[])[col] as number) * (x[col] as number);
			acc[row] += term;
			scale[row] += Math.abs(term);
		}
	}
	let worst = 0;
	for (let row = 1; row < size; row += 1) {
		const b = rhs[row] as number;
		const rel =
			Math.abs((acc[row] as number) - b) /
			((scale[row] as number) + Math.abs(b) + 1e-30);
		if (rel > worst) worst = rel;
	}
	return Number.isFinite(worst) ? worst : Number.POSITIVE_INFINITY;
}

/**
 * Order-`order` extrapolation of a block's converged-solution history (see
 * `newtonStartHistory`) written into `out`: the previous solution, the linear
 * `2*x1 - x2`, or the quadratic `3*x1 - 3*x2 + x3`. Returns `false`, writing nothing, when
 * the chain is shorter than the order needs.
 */
function extrapolateNewtonStart(
	history: {
		readonly x1: number[] | null;
		readonly x2: number[] | null;
		readonly x3: number[] | null;
		readonly chain: number;
	},
	order: 0 | 1 | 2,
	size: number,
	out: number[],
): boolean {
	const { x1, x2, x3, chain } = history;
	if (order === 0) {
		if (chain < 1 || x1 === null) return false;
		for (let index = 0; index < size; index += 1) out[index] = x1[index] as number;
		return true;
	}
	if (order === 1) {
		if (chain < 2 || x1 === null || x2 === null) return false;
		for (let index = 0; index < size; index += 1) {
			out[index] = 2 * (x1[index] as number) - (x2[index] as number);
		}
		return true;
	}
	if (chain < 3 || x1 === null || x2 === null || x3 === null) return false;
	for (let index = 0; index < size; index += 1) {
		out[index] =
			3 * (x1[index] as number) - 3 * (x2[index] as number) + (x3[index] as number);
	}
	return true;
}

function withinTolerance(
	next: readonly number[],
	previous: readonly number[],
): boolean {
	for (let index = 0; index < next.length; index += 1) {
		const a = next[index] ?? 0;
		const b = previous[index] ?? 0;
		const allowance =
			NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b)) +
			NEWTON_VOLTAGE_TOLERANCE;
		if (Math.abs(a - b) > allowance) {
			return false;
		}
	}
	return true;
}

/**
 * Which unknown is **furthest outside its own allowance**, so a failure names the node that
 * is actually blocking convergence.
 *
 * Not the largest absolute delta, which is what this used to report and is a different
 * unknown whenever a circuit spans several decades of voltage. `withinTolerance` judges each
 * unknown against `reltol * |v| + vntol`, so in a tube amp a 300 V plate moving 0.2 V is
 * *inside* its 0.3 V allowance while a millivolt grid moving 2 mV is far outside its own --
 * and the old rule reported the plate. Every amp non-convergence investigated through this
 * telemetry was therefore pointed at a node that had already converged, which is why
 * `tube-plate-step-limiter-deadlocks-a-converged-solve.md`'s "What It Left" could not find a
 * cause: the evidence named the wrong node.
 *
 * Ratio, not difference, so the answer is comparable across unknowns: > 1 is a real
 * violation, and the largest ratio is the one to fix first.
 */
function worstDifferenceIndex(
	a: readonly number[],
	b: readonly number[],
): number {
	let index = -1;
	let worst = -1;
	for (let position = 0; position < a.length; position += 1) {
		const x = a[position] ?? 0;
		const y = b[position] ?? 0;
		const allowance =
			NEWTON_RELATIVE_TOLERANCE * Math.max(Math.abs(x), Math.abs(y)) +
			NEWTON_VOLTAGE_TOLERANCE;
		const ratio = Math.abs(x - y) / allowance;
		if (ratio > worst) {
			worst = ratio;
			index = position;
		}
	}
	return index;
}

function maxAbsDifference(a: readonly number[], b: readonly number[]): number {
	let largest = 0;
	for (let index = 0; index < a.length; index += 1) {
		largest = Math.max(largest, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
	}
	return largest;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

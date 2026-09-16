// When has a rendered circuit stopped moving?
//
// **This exists because the answer was assumed in every measurement that needed it, and the
// assumption was wrong by up to 62 dB.** `report-worklet-scoreboard.ts` rendered a fixed 0.5 s
// after a 0.1 s warm-up; measured settle times across the amp corpus run 1.5 s to 16 s, so every
// amp row was read mid-transient. `vox-ac15-top-boost` reported -15.3 dBFS, among the healthiest
// in the corpus, against -77.1 dBFS settled. `marshall-jcm800` moves 54 dB. A `fender-5e3`
// "self-oscillation" finding was raised and retracted the same day from a 0.4 s window.
//
// **And fixing it in one script is not enough, which is the reason this is here rather than
// there.** Within hours of the scoreboard fix landing, a throwaway node-probe rendered 10 s and
// measured the next second on an amp that settles at 9 s, and reported rail drift as 250 V of
// signal. A settling rule that lives inside one instrument is a rule every other instrument has
// to rediscover. This is the same move as `dacScaleFactor()` in `./chain-scale.ts`: the rule the
// product applies gets one home, and everything that needs it reads that one.
//
// **A modulation effect never settles by this criterion, and that is not a defect.** A phaser,
// tremolo or chorus sweeps its output amplitude by design, so "the level holds still" is a
// condition it cannot meet. `mxr-phase-45` reads 8.0e-2 V — around -41 dBFS, plainly audible —
// and this reports it UNSETTLED forever. A caller sweeping a corpus must read UNSETTLED as
// "no level could be taken", never as "no level exists": check the amplitude before concluding
// anything, because an unsettled row at 1e-9 and one at 8e-2 are opposite findings.
//
// **What "settled" means here, stated so a caller does not over-read it: the OUTPUT LEVEL stopped
// moving.** It does not mean the circuit reached its operating point. A packet whose output is
// flat at zero satisfies this immediately while its supply is still charging, so a settled verdict
// at or near zero is *unclassified*, not *silent* — `isFlatAtZero` is provided to say so, and
// callers reporting audibility must split on it. Closing that gap properly means watching a supply
// rail as well, which needs a rail the caller can name.

import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "./reference-runtime";

export type SettleOptions = {
	/** Length of each measurement window, seconds. */
	readonly windowSeconds: number;
	/** Consecutive window pairs that must agree before the level is called settled. */
	readonly consecutive: number;
	/** How close two consecutive windows must be, in dB. */
	readonly stableDb: number;
	/** Render lengths to try in turn; the last is the giving-up point. */
	readonly ladderSeconds: readonly number[];
};

/**
 * Defaults measured against the corpus rather than chosen: 0.5 s resolves a 1.5 s settle without
 * splitting hairs, and 0.25 dB is below the run-to-run spread.
 *
 * **The top rung is deliberately above anything the corpus reaches, and that is the point.** It was
 * 16 s, justified as "covers `marshall-jcm800`, the slowest row found (settles at 16.0 s)" — which
 * is not a bound, it is a coincidence. A ladder whose maximum equals the population maximum cannot
 * tell *settled at the last rung* from *never settled*: both produce the same row, and jcm800's
 * gain of 0.00 — the packet called the one real remaining amp defect all afternoon — was read at
 * exactly that edge every time.
 *
 * Re-measured on a 64 s ladder, jcm800 settles at **10 s** and holds flat to five digits out to
 * 64 s, so the diagnosis survives and the 16.0 s figure was an artifact of the two settling
 * criteria this module used to have (see `windowLevel`). The rung is raised anyway: the reason to
 * have headroom is not that anything needed it, it is that without it a maximum reading is
 * ambiguous. Same argument as a screen needing a *no valid measurement* state distinct from a
 * negative result. It costs nothing for a packet that settles earlier.
 */
export const SETTLE_DEFAULTS: SettleOptions = {
	windowSeconds: 0.5,
	consecutive: 2,
	stableDb: 0.25,
	ladderSeconds: [2, 4, 8, 16, 32],
};

/** A level below this is numerical noise, not a measurement. */
export const FLAT_AT_ZERO_RMS = 1e-6;

/** `true` when a settled verdict cannot distinguish a dead circuit from one still coming up. */
export function isFlatAtZero(rms: number): boolean {
	return rms < FLAT_AT_ZERO_RMS;
}

export type Settled = {
	/** rms of the window the level settled in. */
	readonly rms: number;
	/** Seconds into the render at which it settled. */
	readonly seconds: number;
};

/**
 * The first window at which the level holds still, or `null` if it never does.
 *
 * Pure, so an instrument that renders its own audio — in a browser page, through the WASM console,
 * or anywhere else this module cannot reach — can still share the policy by handing over its
 * window levels.
 */
export function findSettled(
	windowRms: readonly number[],
	options: SettleOptions = SETTLE_DEFAULTS,
): Settled | null {
	let stable = 0;
	for (let i = 1; i < windowRms.length; i += 1) {
		const previous = 20 * Math.log10(Math.max(windowRms[i - 1] ?? 0, 1e-12));
		const current = 20 * Math.log10(Math.max(windowRms[i] ?? 0, 1e-12));
		stable = Math.abs(current - previous) < options.stableDb ? stable + 1 : 0;
		if (stable >= options.consecutive) {
			return {
				rms: windowRms[i] ?? 0,
				seconds: (i + 1) * options.windowSeconds,
			};
		}
	}
	return null;
}

/**
 * The level of one window: rms **about the mean**, so a DC pedestal is not counted as audio.
 *
 * **This exists because the module had two settling criteria and they disagreed.** `measureSettled`
 * centred each window; the settling loops inside `measureInputAttributable` and
 * `measureSettledSignal` squared the raw samples. Same program, same stimulus, same ladder, and on
 * `marshall-jcm800` the first settles the idle render at 10 s while the second never settles it at
 * all -- because that packet's DC offset is still drifting long after its AC has arrived. That
 * disagreement was read as "jcm800 settles at 16.0 s, at the very top of the ladder", which made a
 * packet look like it was measured at the edge of the instrument's range when it had in fact
 * arrived at 10 s and held flat to five digits out to 64 s.
 *
 * A shared policy module with two spellings of its own policy is the defect it was created to
 * remove, so there is one now.
 */
function windowLevel(output: ArrayLike<number>, perWindow: number): number {
	let sum = 0;
	for (let i = 0; i < perWindow; i += 1) sum += output[i] ?? 0;
	const dc = sum / perWindow;
	let square = 0;
	for (let i = 0; i < perWindow; i += 1) square += ((output[i] ?? 0) - dc) ** 2;
	return Math.sqrt(square / perWindow);
}

/**
 * A driven level and the part of it attributable to the input, **from one shared window**.
 *
 * Returned as a pair on purpose. `measureSettledSignal` used to return the attributable rms
 * alone, which left a caller wanting an attributable *fraction* to fetch the total from
 * `measureSettled` — a separate call that settles on its **own** window. Every such pairing is
 * one careless line from the differencing defect this module already documents, and it happened:
 * `marshall-jcm800` was measured at **106.2% attributable**, a signal larger than its own total,
 * hours after the same two-window error had been found and fixed at a different call site.
 *
 * The fix lived in a call site rather than in the shape of the measurement, so it did not
 * transfer to the next instrument someone reached for. Handing back both numbers from the same
 * window makes the wrong version unreachable rather than merely discouraged.
 */
export type AttributedMeasurement = SettledMeasurement & {
	/** Total driven rms about its mean, over the **same** window the signal came from. */
	readonly total: number;
	/** `signal / total`, clamped to [0, 1]; `null` when the total is zero. */
	readonly attributable: number | null;
};

export type SettledMeasurement = {
	/** `null` when the render never settled: no level rather than a wrong one. */
	readonly rms: number | null;
	readonly peak: number;
	readonly settleSeconds: number | null;
	readonly renderedSeconds: number;
	/** `true` when the settled level is indistinguishable from numerical noise. */
	readonly flatAtZero: boolean;
};

/**
 * Render a program until its output level stops moving, and report that level.
 *
 * The runtime is stateful across `process()` calls, so this walks forward through one continuous
 * render rather than restarting per rung — which both costs less and is the only honest way to
 * measure a circuit that is still charging.
 *
 * `sampleAt` is the stimulus, in volts, as a function of absolute sample index; passing the same
 * function every instrument uses is what makes two measurements comparable.
 */
export function measureSettled(
	program: Program,
	sampleRate: number,
	sampleAt: (index: number) => number,
	options: SettleOptions = SETTLE_DEFAULTS,
): SettledMeasurement {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(sampleRate);
	const perWindow = Math.round(options.windowSeconds * sampleRate);
	const maxWindows = Math.ceil(
		(options.ladderSeconds[options.ladderSeconds.length - 1] ?? 16) /
			options.windowSeconds,
	);
	const windows: number[] = [];
	let index = 0;
	let peak = 0;
	for (let w = 0; w < maxWindows; w += 1) {
		const input = new Float64Array(perWindow);
		for (let i = 0; i < perWindow; i += 1) input[i] = sampleAt(index + i);
		index += perWindow;
		const output = runtime.process(input);
		let sum = 0;
		for (let i = 0; i < perWindow; i += 1) sum += output[i] ?? 0;
		const dc = sum / perWindow;
		let square = 0;
		let windowPeak = 0;
		for (let i = 0; i < perWindow; i += 1) {
			const centred = (output[i] ?? 0) - dc;
			square += centred * centred;
			if (Math.abs(centred) > windowPeak) windowPeak = Math.abs(centred);
		}
		windows.push(Math.sqrt(square / perWindow));
		peak = windowPeak;
		const settled = findSettled(windows, options);
		if (settled !== null) {
			return {
				rms: settled.rms,
				peak,
				settleSeconds: settled.seconds,
				renderedSeconds: (w + 1) * options.windowSeconds,
				flatAtZero: isFlatAtZero(settled.rms),
			};
		}
	}
	return {
		rms: null,
		peak,
		settleSeconds: null,
		renderedSeconds: maxWindows * options.windowSeconds,
		flatAtZero: false,
	};
}

/** One node's response to the input, separated from whatever it does without one. */
export type InputAttributableNode = {
	readonly blockId: string;
	readonly node: number;
	/** Amplitude present with the stimulus but not without it. */
	readonly signalVolts: number;
	readonly loudVolts: number;
	readonly silentVolts: number;
};

/**
 * Per-node AC attributable to the input: render twice, once driven and once silent, and
 * difference the two.
 *
 * **A plain per-node amplitude list is unreadable on anything with a mains supply.**
 * `mesa-boogie-dual-rectifier` carries 495 V of rail ripple, which occupies the top of any such
 * list and buries a preamp running at 132 V — the signal was invisible until the two renders were
 * differenced, and then the fault (power-tube grids sitting on the fixed bias rail with no drive
 * node at all) fell out in one reading. Pedals have supply ripple too, so this is not an
 * amp-only tool.
 *
 * Both renders settle first, via the same policy as everything else here, because differencing
 * two unsettled renders subtracts one transient from another.
 */
export function measureInputAttributable(
	program: Program,
	sampleRate: number,
	sampleAt: (index: number) => number,
	options: SettleOptions = SETTLE_DEFAULTS,
): readonly InputAttributableNode[] {
	const sweep = (drive: number): Map<string, number[]> => {
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(sampleRate);
		const perWindow = Math.round(options.windowSeconds * sampleRate);
		const maxWindows = Math.ceil(
			(options.ladderSeconds[options.ladderSeconds.length - 1] ?? 16) /
				options.windowSeconds,
		);
		const windows: number[] = [];
		let index = 0;
		for (let w = 0; w < maxWindows; w += 1) {
			const input = new Float64Array(perWindow);
			for (let i = 0; i < perWindow; i += 1)
				input[i] = drive * sampleAt(index + i);
			index += perWindow;
			const output = runtime.process(input);
			windows.push(windowLevel(output, perWindow));
			if (findSettled(windows, options) !== null) break;
		}
		// One further window, sampled per node, now that the level has stopped moving.
		const lo = new Map<string, number[]>();
		const hi = new Map<string, number[]>();
		const single = new Float64Array(1);
		for (let i = 0; i < perWindow; i += 1) {
			single[0] = drive * sampleAt(index + i);
			runtime.process(single);
			for (const snapshot of runtime.nodeVoltageSnapshot()) {
				let low = lo.get(snapshot.blockId);
				let high = hi.get(snapshot.blockId);
				if (low === undefined || high === undefined) {
					low = new Array(snapshot.nodeCount).fill(Number.POSITIVE_INFINITY);
					high = new Array(snapshot.nodeCount).fill(Number.NEGATIVE_INFINITY);
					lo.set(snapshot.blockId, low);
					hi.set(snapshot.blockId, high);
				}
				for (let k = 0; k < snapshot.nodeCount; k += 1) {
					const value = snapshot.voltages[k] ?? 0;
					if (value < low[k]!) low[k] = value;
					if (value > high[k]!) high[k] = value;
				}
			}
		}
		const amplitude = new Map<string, number[]>();
		for (const [blockId, low] of lo) {
			const high = hi.get(blockId) ?? [];
			amplitude.set(
				blockId,
				low.map((value, k) => ((high[k] ?? 0) - value) / 2),
			);
		}
		return amplitude;
	};
	const loud = sweep(1);
	const silent = sweep(0);
	const rows: InputAttributableNode[] = [];
	for (const [blockId, amps] of loud) {
		const quiet = silent.get(blockId) ?? [];
		for (let node = 0; node < amps.length; node += 1) {
			const loudVolts = amps[node] ?? 0;
			const silentVolts = quiet[node] ?? 0;
			rows.push({
				blockId,
				node,
				signalVolts: loudVolts - silentVolts,
				loudVolts,
				silentVolts,
			});
		}
	}
	return rows.sort((a, b) => b.signalVolts - a.signalVolts);
}

/**
 * The settled output level **attributable to the input**: render driven, render silent, subtract,
 * and measure the remainder.
 *
 * **Plain output rms is a ceiling, not a level, on anything with a mains supply.** Ripple adds to
 * the measurement, so `rms >= signal`, and by an amount that differs per packet. Every amp gain
 * figure taken before this existed is an upper bound: a corpus "healthy band" of 19-190 was a band
 * of ceilings, and the bimodal gap that appeared to validate the threshold was a gap between
 * ceilings rather than between signals.
 *
 * The direction of the bias is the point, and it is the opposite of the one that broke the phase
 * screen. Ripple is common-mode, so it drove *correlation* toward +1 and manufactured defects that
 * were not there; it is additive, so it drives *magnitude* upward and hides defects that are. Same
 * contaminant, opposite direction, because one statistic summed a phase relationship and the other
 * a magnitude — which is what determines which way a statistic lies, not merely how much.
 */
/** One drive's behaviour over a window shared with every other drive in the same call. */
export type SharedWindowMeasurement = {
	/** rms about the mean, in volts: the audio, with any DC pedestal removed. */
	readonly rms: number;
	/** The pedestal itself, which is a different finding from the audio. */
	readonly dc: number;
	readonly peak: number;
};

/**
 * Render each drive of one program to the **shared window**, keeping what it renders.
 *
 * **This exists because the two functions below rendered every drive twice.** Each made one pass
 * per drive to find its settle point and a second pass per drive to capture the window -- and both
 * passes feed the runtime an identical input, so the second recomputes exactly what the first
 * already produced. `boss-ch-1` never settles and cost **2441 s** of one corpus run, more than any
 * other packet, and half of that was the recomputation.
 *
 * **The first attempt at this was wrong, and the timing control is what said so.** It advanced
 * every drive in lockstep and stopped only when *all* of them had settled -- which means one drive
 * that never settles drags every other drive through the whole ladder. On `boss-sp-1-spectrum`
 * that was **2.9x slower** than the version it replaced, reproducibly, on an idle machine. A drive
 * that has settled must **stop**, not keep pace with the slowest one.
 *
 * So each drive advances on its own and stops at its own settle point, every window it renders is
 * kept, and once the shared window is known each drive is advanced from where it stopped to that
 * window. Per drive the render is `skip + 1` windows, which is the minimum possible: every drive
 * has to reach the shared window, and none of it is rendered twice.
 *
 * **Exactness is the argument.** The runtime is deterministic and the input is identical, so the
 * window handed back is the window the second pass would have produced, sample for sample.
 *
 * `settleAt[d]` is the window index **after** drive `d` settled, or -1 if it never did -- the
 * convention the two-pass version used, so each caller keeps its own rule for a drive that never
 * settles.
 */
/**
 * Which settle criterion produced a measurement.
 *
 * **Recorded per row, not just per run.** With a fallback, two packets in the same run can be
 * measured by different criteria — and a future diff that compares a `fine` row against a `coarse`
 * row would read the criterion change as *movement*. That is the instrument-digest problem at a
 * finer grain, and **the digest gate cannot see it**, because both criteria live in the same
 * unchanged file. One field closes the hole before it exists.
 */
export type SettleCriterion = "fine" | "coarse" | "unsettled";

/**
 * How many fine windows make a coarse one.
 *
 * **The coarse pass is derived from the fine pass's retained windows and renders nothing.** The
 * detector already runs on windowed rms (`windowLevel`), so the only defect on a modulated packet
 * is that a 0.5 s window is *shorter than the modulation* and its rms still wobbles. A coarse
 * window is just eight consecutive fine ones, and the dedup already keeps every window it renders —
 * so the fallback costs **no extra render**, which is what makes it a fallback rather than a
 * trade.
 *
 * **A blanket coarse window was measured and refused.** On four packets that settle today it
 * reproduced every published digit of every rms — the statistic is sound — but `consecutive: 2`
 * at 4 s means a packet settling at 4.5 s cannot be declared settled before 16 s, and
 * `marshall-jtm45` nearly quadrupled. That is the best members paying for the worst, which is the
 * same shape as a shared stopping condition and is refused for the same reason.
 *
 * **So: the coarse pass may SUPPLY a settle point, never REPLACE one.** It runs only where the
 * fine pass found none, so it can only add measurements and never change existing ones — which is
 * also why the settling-packet control set stays valid across this change.
 */
const COARSE_FACTOR = 8;

function renderToSharedWindow(
	program: Program,
	sampleRate: number,
	sampleAt: (index: number) => number,
	drives: readonly number[],
	options: SettleOptions,
): {
	readonly settleAt: readonly number[];
	/** Samples of the shared window, per drive. */
	readonly windows: readonly Float64Array[];
	readonly skip: number;
	readonly settled: boolean;
	/** Which criterion produced this result. Recorded per row: see the note on `COARSE_FACTOR`. */
	readonly criterion: SettleCriterion;
} {
	const perWindow = Math.round(options.windowSeconds * sampleRate);
	const maxWindows = Math.ceil(
		(options.ladderSeconds[options.ladderSeconds.length - 1] ?? 16) /
			options.windowSeconds,
	);
	const inputFor = (drive: number, w: number): Float64Array => {
		const input = new Float64Array(perWindow);
		for (let i = 0; i < perWindow; i += 1)
			input[i] = drive * sampleAt(w * perWindow + i);
		return input;
	};
	const runtimes = drives.map(() => {
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(sampleRate);
		return runtime;
	});
	// Every window each drive renders, so reaching the shared window later never re-renders.
	const rendered: Float64Array[][] = drives.map(() => []);
	const settleAt: number[] = drives.map(() => -1);
	// Kept per drive rather than per loop: the coarse fallback re-tests these same levels.
	const levels: number[][] = drives.map(() => []);
	for (const [d, drive] of drives.entries()) {
		for (let w = 0; w < maxWindows; w += 1) {
			const output = runtimes[d]!.process(inputFor(drive, w));
			rendered[d]!.push(Float64Array.from(output));
			levels[d]!.push(windowLevel(output, perWindow));
			if (findSettled(levels[d]!, options) !== null) {
				settleAt[d] = w + 1;
				break;
			}
		}
	}
	let latest = Math.max(...settleAt);
	let criterion: SettleCriterion = latest >= 0 ? "fine" : "unsettled";
	let coarseGroup = -1;
	if (latest < 0) {
		// Nothing settled on the fine window. Re-test the SAME rendered data at coarse granularity:
		// group the per-window levels in eights and ask the same detector. A modulated output whose
		// 0.5 s rms wobbles is stationary in 4 s rms once the window covers the modulation.
		const coarseAt = drives.map((_unused, d) => {
			const fine = levels[d] ?? [];
			const coarse: number[] = [];
			for (let g = 0; (g + 1) * COARSE_FACTOR <= fine.length; g += 1) {
				let power = 0;
				for (let i = 0; i < COARSE_FACTOR; i += 1) {
					const v = fine[g * COARSE_FACTOR + i] ?? 0;
					power += v * v;
				}
				coarse.push(Math.sqrt(power / COARSE_FACTOR));
				if (findSettled(coarse, options) !== null) return g + 1;
			}
			return -1;
		});
		const latestCoarse = Math.max(...coarseAt);
		if (latestCoarse >= 0) {
			coarseGroup = latestCoarse;
			// The shared window is the last fine window of the settled coarse group, so the samples
			// handed back are ones already rendered.
			latest = Math.min(
				latestCoarse * COARSE_FACTOR + COARSE_FACTOR - 1,
				maxWindows - 1,
			);
			criterion = "coarse";
		}
	}
	const settled = latest >= 0;
	const skip = settled ? latest : maxWindows - 1;
	void coarseGroup;
	const windows = drives.map((drive, d) => {
		// Advance this drive from where it stopped to the shared window. A drive that already
		// passed it -- one that never settled while another did -- simply has it in hand.
		for (let w = rendered[d]!.length; w <= skip; w += 1) {
			rendered[d]!.push(
				Float64Array.from(runtimes[d]!.process(inputFor(drive, w))),
			);
		}
		return rendered[d]![skip] as Float64Array;
	});
	return { settleAt, windows, skip, settled, criterion };
}

/**
 * Measure several drive levels over ONE window, after every one of them has settled.
 *
 * **Two drives measured at their own settle points are not two views of one state.** Mains ripple
 * has a phase tied to absolute time, so comparing or subtracting windows captured at different
 * offsets does not cancel it and can double it — measured directly on 2026-09-09, where letting a
 * driven and a silent render each stop at its own settle time reported `fender-twin-reverb` with
 * more signal than total output and `hiwatt-dr103`, then believed to be a working amp, with a
 * signal of exactly zero.
 *
 * `measureSettledSignal` is the two-drive difference case of this. This exists because callers
 * needing three or more levels — quiet, loud and silent, which is what a liveness screen compares —
 * were otherwise reimplementing the settle-then-capture policy themselves, and **a shared policy
 * module only helps if the callers can get what they need from it.** Every instrument that
 * hardcoded its own render window instead was wrong by up to 42 dB on the amp corpus.
 *
 * The window is the latest settle point across the drives, so every render is steady across it. A
 * drive that never settles does not veto the others: it contributes nothing to the choice of
 * window and is reported over the same one, which is a level taken late rather than no level.
 */
export function measureSharedWindow(
	program: Program,
	sampleRate: number,
	sampleAt: (index: number) => number,
	drives: readonly number[],
	options: SettleOptions = SETTLE_DEFAULTS,
): {
	/** `null` when no drive settled at all; the measurements are then taken at the ladder's end. */
	readonly settleSeconds: number | null;
	readonly measurements: readonly SharedWindowMeasurement[];
	/** Which criterion produced this row. Record it beside the verdict. */
	readonly criterion: SettleCriterion;
} {
	const perWindow = Math.round(options.windowSeconds * sampleRate);
	const rendered = renderToSharedWindow(
		program,
		sampleRate,
		sampleAt,
		drives,
		options,
	);
	const skip = rendered.skip;
	const settled = rendered.settled;

	const measurements = rendered.windows.map((output) => {
		let sum = 0;
		for (let i = 0; i < perWindow; i += 1) sum += output[i] ?? 0;
		const dc = sum / perWindow;
		let square = 0;
		let peak = 0;
		for (let i = 0; i < perWindow; i += 1) {
			const centred = (output[i] ?? 0) - dc;
			square += centred * centred;
			if (Math.abs(centred) > peak) peak = Math.abs(centred);
		}
		return { rms: Math.sqrt(square / perWindow), dc, peak };
	});

	return {
		settleSeconds: settled ? skip * options.windowSeconds : null,
		criterion: rendered.criterion,
		measurements,
	};
}

export function measureSettledSignal(
	program: Program,
	sampleRate: number,
	sampleAt: (index: number) => number,
	options: SettleOptions = SETTLE_DEFAULTS,
): AttributedMeasurement {
	// **Both renders must be sampled over the SAME absolute sample range**, which is why this
	// settles first and captures second rather than capturing at each render's own settle point.
	// Mains ripple has a phase tied to absolute time, so differencing two windows taken at
	// different offsets does not cancel it — it can double it. Measured directly: letting the
	// driven and silent renders each stop at their own settle time reported `fender-twin-reverb`
	// with more signal than total output (-51% ripple share) and `hiwatt-dr103`, a working amp at
	// gain 89, with a signal of exactly 0.00.
	const rendered = renderToSharedWindow(
		program,
		sampleRate,
		sampleAt,
		[1, 0],
		options,
	);
	const drivenWindows = rendered.settleAt[0] ?? -1;
	if (drivenWindows < 0) {
		// Never settled: no level rather than a wrong one, and no attribution either -- a
		// fraction computed from a level that does not exist is the shape this type exists to
		// prevent.
		return {
			rms: null,
			peak: 0,
			total: 0,
			attributable: null,
			settleSeconds: null,
			renderedSeconds: 0,
			flatAtZero: false,
		};
	}
	// The later of the two settle points, so both circuits are steady over the captured window --
	// and both windows come out of the SAME render, so they cannot drift apart.
	const skip = rendered.skip;
	const perWindow = Math.round(options.windowSeconds * sampleRate);
	const driven = rendered.windows[0]!;
	const silent = rendered.windows[1]!;
	let sum = 0;
	for (let i = 0; i < perWindow; i += 1)
		sum += (driven[i] ?? 0) - (silent[i] ?? 0);
	const dc = sum / perWindow;
	let square = 0;
	let peak = 0;
	for (let i = 0; i < perWindow; i += 1) {
		const centred = (driven[i] ?? 0) - (silent[i] ?? 0) - dc;
		square += centred * centred;
		if (Math.abs(centred) > peak) peak = Math.abs(centred);
	}
	const rms = Math.sqrt(square / perWindow);
	// The total, from the SAME captured window as the signal -- see `AttributedMeasurement`.
	let drivenSum = 0;
	for (let i = 0; i < perWindow; i += 1) drivenSum += driven[i] ?? 0;
	const drivenDc = drivenSum / perWindow;
	let drivenSquare = 0;
	for (let i = 0; i < perWindow; i += 1) {
		const centred = (driven[i] ?? 0) - drivenDc;
		drivenSquare += centred * centred;
	}
	const total = Math.sqrt(drivenSquare / perWindow);
	return {
		rms,
		peak,
		total,
		attributable: total === 0 ? null : Math.min(1, rms / total),
		settleSeconds: skip * options.windowSeconds,
		renderedSeconds: (skip + 1) * options.windowSeconds,
		flatAtZero: isFlatAtZero(rms),
	};
}

/**
 * Known-answer controls for the measurement primitives here.
 *
 * **Every measurement function should have an input whose answer is known independently of the
 * measurement.** Today both broken instruments were in the position of never having been pointed
 * at one: broadband plate correlation was never checked against a circuit whose phase relationship
 * was known, and `measureSettledSignal` shipped with an alignment defect that a single identity
 * assertion would have caught before it produced a table with more signal than total output.
 *
 * The identity here is the cheapest control that exists: **difference a render against itself and
 * the answer must be exactly zero.** Any misalignment, window mismatch, or off-by-one in the sample
 * range breaks it immediately and loudly.
 */
export function settleSelfCheck(
	program: Program,
	sampleRate: number,
	sampleAt: (index: number) => number,
	options: SettleOptions = SETTLE_DEFAULTS,
): { readonly name: string; readonly ok: boolean; readonly detail: string }[] {
	const results: { name: string; ok: boolean; detail: string }[] = [];

	// Identity: the same render differenced against itself is zero, exactly.
	const perWindow = Math.round(options.windowSeconds * sampleRate);
	const render = (drive: number, skip: number): Float64Array => {
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(sampleRate);
		for (let w = 0; w < skip; w += 1) {
			const input = new Float64Array(perWindow);
			for (let i = 0; i < perWindow; i += 1)
				input[i] = drive * sampleAt(w * perWindow + i);
			runtime.process(input);
		}
		const tail = new Float64Array(perWindow);
		for (let i = 0; i < perWindow; i += 1)
			tail[i] = drive * sampleAt(skip * perWindow + i);
		return Float64Array.from(runtime.process(tail));
	};
	const a = render(1, 4);
	const b = render(1, 4);
	let worst = 0;
	for (let i = 0; i < perWindow; i += 1)
		worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
	results.push({
		name: "identity: render minus itself is exactly zero",
		ok: worst === 0,
		detail: `worst absolute difference ${worst.toExponential(3)} V`,
	});

	// **"signal <= ceiling" was asserted here as a law and it is not one.** It fired on
	// `dumble-overdrive-special` -- signal 6.933e-1 against a ceiling of 6.655e-1 -- and the
	// measurement was right while the assertion was wrong. The law is the conservation identity:
	//
	//     rms(driven)^2 = rms(signal)^2 + rms(idle)^2 + 2 * cov(signal, idle)
	//
	// `signal <= ceiling` follows from it **only when cov >= 0**, and nothing guarantees that sign.
	// On dumble cov is -3.827e-2: the idle content is anti-correlated with the response to the
	// stimulus, so removing it leaves more than was there in total. So the identity is what gets
	// asserted, with a tolerance, and the inequality is not asserted at all. An anti-correlated
	// idle passes; a window mismatch fails.
	//
	// **cov must be measured, not derived.** Solving the identity for cov and then checking the
	// identity is circular -- over any two arrays it is just the expansion of a variance and cannot
	// fail. cov is therefore taken from the samples of a shared-window capture, while the three
	// terms come from the three public functions, each settling on its own. The check is then a
	// real one: it asks whether those three functions are describing the same window. The alignment
	// defect fixed earlier today -- driven and silent settled independently, so a time-phased ripple
	// subtracted at the wrong offset -- is exactly what breaks it.
	//
	// **A control that cries wolf costs what a control that misses costs, and both directions
	// belong in the rule.** Fourteen of today's defects were controls that missed. This was nearly
	// the first of the other kind, and it would have blocked valid work rather than passing invalid
	// work.
	const ceiling = measureSettled(program, sampleRate, sampleAt, options);
	const signal = measureSettledSignal(program, sampleRate, sampleAt, options);
	if (ceiling.rms !== null && signal.rms !== null) {
		const idle = measureSettled(program, sampleRate, () => 0, options);
		const idleRms = idle.rms ?? 0;
		// cov from the samples, over one window both renders share.
		const skip = Math.max(
			4,
			Math.round((signal.settleSeconds ?? 0) / options.windowSeconds),
		);
		const drivenTail = render(1, skip);
		const silentTail = render(0, skip);
		let meanSignal = 0;
		let meanIdle = 0;
		for (let i = 0; i < perWindow; i += 1) {
			meanSignal += (drivenTail[i] ?? 0) - (silentTail[i] ?? 0);
			meanIdle += silentTail[i] ?? 0;
		}
		meanSignal /= perWindow;
		meanIdle /= perWindow;
		let covariance = 0;
		for (let i = 0; i < perWindow; i += 1) {
			covariance +=
				((drivenTail[i] ?? 0) - (silentTail[i] ?? 0) - meanSignal) *
				((silentTail[i] ?? 0) - meanIdle);
		}
		covariance /= perWindow;
		const residual =
			ceiling.rms ** 2 - (signal.rms ** 2 + idleRms ** 2 + 2 * covariance);
		const relative =
			ceiling.rms === 0 ? 0 : Math.abs(residual) / ceiling.rms ** 2;
		// 10% of the driven power. Calibrated rather than chosen: legitimate window-to-window drift
		// between two independently-settled measurements is a few percent (`fender-twin-reverb`
		// reads 4.1242 settled independently against 4.2108 in the shared window, 2.1%), while the
		// alignment defect this is aimed at produced errors around 50% -- a ripple term doubled
		// instead of cancelled, reported as a -51.2% ripple share.
		//
		// **What this proves and what it cannot.** Measured by injecting a deliberate offset
		// between the driven and silent captures: on `fender-twin-reverb` one window of slip takes
		// the residual from 0.29% to **208%**, so the check does fail for the reason claimed, on
		// the very amp the original alignment defect was found on. On `marshall-1959-super-lead-
		// plexi` every offset stays at 0.07%, and on `dumble-overdrive-special` at 0.27-0.59%.
		//
		// So it is **only sensitive where the idle is both large and time-phased.** The plexi's
		// idle is 1.374e-4 V against a 7.18 V signal -- five decades down, so sliding it changes
		// nothing measurable -- and dumble's idle is broadband rather than periodic, so an offset
		// does not decorrelate it. A pass on a quiet-idle circuit says the arithmetic is consistent,
		// not that the windows are aligned. Run it on a hum-heavy amp to exercise the alignment
		// claim.
		results.push({
			name: "driven power = signal + idle + 2cov, with cov measured from the samples",
			ok: relative <= 0.1,
			detail:
				`driven ${ceiling.rms.toExponential(3)}, signal ${signal.rms.toExponential(3)}, ` +
				`idle ${idleRms.toExponential(3)}, cov ${covariance.toExponential(3)}; ` +
				`residual ${(relative * 100).toFixed(2)}% of driven power`,
		});
	}

	// **The coarse fallback must be proven able to fire, and able NOT to.** An unfired fallback is
	// an untested path, and this session already shipped one gate that was broken exactly where
	// nothing had ever run it -- the instrument digest, which died at module scope because
	// `fileURLToPath` was never imported and no invocation had reached the line.
	//
	// The construction is the SIGNAL, not a packet: this program passes its input through, so a
	// stimulus whose amplitude is modulated at 0.5 Hz has a 2 s period -- **longer than one fine
	// window (0.5 s) and shorter than one coarse window (8 x 0.5 = 4 s)**. Its windowed rms
	// therefore wobbles at fine granularity and is stationary at coarse. That inequality IS the
	// fallback's specification, and it had not been written down anywhere until this control.
	const hz = 440;
	const modulated = (index: number): number =>
		Math.sin((2 * Math.PI * hz * index) / sampleRate) *
		(1 + 0.9 * Math.sin((2 * Math.PI * 0.5 * index) / sampleRate));
	const plain = (index: number): number =>
		Math.sin((2 * Math.PI * hz * index) / sampleRate);
	const fires = measureSharedWindow(
		program,
		sampleRate,
		modulated,
		[1],
		options,
	);
	results.push({
		name: "coarse fallback fires on a 2 s modulation",
		ok: fires.criterion === "coarse",
		detail: `criterion=${fires.criterion} settle=${String(fires.settleSeconds)} -- a period longer than one fine window and shorter than one coarse window must be rejected finely and accepted coarsely`,
	});
	const doesNotFire = measureSharedWindow(
		program,
		sampleRate,
		plain,
		[1],
		options,
	);
	results.push({
		name: "coarse fallback does NOT fire on a steady tone",
		ok: doesNotFire.criterion === "fine",
		detail: `criterion=${doesNotFire.criterion} settle=${String(doesNotFire.settleSeconds)} -- the mirror case: a fallback that always fires is not a fallback`,
	});

	return results;
}

/**
 * The result of rendering something until it holds still, in the three-outcome shape every screen
 * in this repo needs: a value, a refusal, or a diverged solve. Never a number it could not stand
 * behind.
 *
 * It is a discriminated union rather than a nullable number **so the refusal cannot be read as a
 * measurement by accident**: `.rms` does not exist until `status` has been narrowed, which is the
 * compiler enforcing what a convention could only ask for.
 */
export type SettledRender =
	| {
			readonly status: "settled";
			/** Seconds into the render at which the level stopped moving. */
			readonly seconds: number;
			/** rms about the mean of the settled window -- the same policy `findSettled` used. */
			readonly rms: number;
			readonly peak: number;
			readonly dc: number;
			/** The settled window's samples, so spectral work happens on settled audio. */
			readonly tail: Float64Array;
	  }
	| {
			readonly status: "unsettled";
			/** How long it rendered before giving up: the ladder's last rung. */
			readonly triedSeconds: number;
			/** Window levels, so a caller can see whether it was drifting or oscillating. */
			readonly windows: readonly number[];
	  }
	| { readonly status: "nonfinite"; readonly atSample: number };

/** What to render. Everything is optional; the bare call renders silence. */
export type SettledRenderOptions = {
	readonly sampleRate?: number;
	/** Test tone frequency. Omit or set 0 for an idle render. */
	readonly hz?: number;
	/** Test tone amplitude. */
	readonly drive?: number;
	/**
	 * A stimulus in volts as a function of absolute sample index, for anything `hz`/`drive`
	 * cannot express -- a multi-tone probe, a sweep, a recorded input. Takes precedence over
	 * `hz`/`drive`. Same shape `measureSettled` already takes, so the two stay comparable.
	 */
	readonly sampleAt?: (index: number) => number;
	/**
	 * Control positions to set before rendering, as `[id, position]` pairs.
	 *
	 * Here because the commonest reason to render twice is to move one knob, and a helper that
	 * cannot do that sends the caller back to `new ReferenceRuntime` -- which is the path this
	 * exists to displace. A control question is a settling question like any other:
	 * `boss-bd-2-blues-driver`'s LEVEL was called dead off a 50 ms render.
	 */
	readonly controls?: readonly (readonly [string, number])[];
	readonly settle?: SettleOptions;
};

/**
 * **Render until settled, or refuse.** The shortest path to a level in this repo -- shorter than
 * `new ReferenceRuntime(p); r.prepare(sr); r.process(new Float64Array(n))`, which is the three
 * lines it exists to displace.
 *
 * **Why it is shaped to be the easy path rather than the correct-but-optional one.** Four ad-hoc
 * probes on 2026-09-10 rendered a fixed window shorter than the packet's settle time and produced
 * four false findings -- an amp "with no B+", an "unstable" packet that was damping 43 dB, an idle
 * "instability" of 7.7 V that settles to 1.7e-5, and a gain of 0.000 on an amp that makes 234.
 * Every one was written by someone who knew about `settle.ts` and reached for
 * `ReferenceRuntime` anyway, because it was two fewer decisions. A helper that has to be
 * remembered gets bypassed; `bg_start` was bypassed three times through three different doors on
 * the same day. So this is deliberately the least typing available: one call, no window to choose,
 * and choosing your own is strictly more work than not.
 *
 * The settle policy is `findSettled` and the level is `windowLevel` -- the module's single
 * spelling of each, not a second copy.
 */
/** `sampleAt` if given, else a tone from `hz`/`drive`, else `null` for silence. */
function resolveStimulus(
	options: SettledRenderOptions,
): ((index: number) => number) | null {
	if (options.sampleAt !== undefined) return options.sampleAt;
	const hz = options.hz ?? 0;
	const drive = options.drive ?? 0;
	if (hz === 0 || drive === 0) return null;
	const sampleRate = options.sampleRate ?? 48_000;
	return (index) => drive * Math.sin((2 * Math.PI * hz * index) / sampleRate);
}

export function settledRender(
	program: Program,
	options: SettledRenderOptions = {},
): SettledRender {
	const sampleRate = options.sampleRate ?? 48_000;
	const settle = options.settle ?? SETTLE_DEFAULTS;
	const stimulus = resolveStimulus(options);
	const perWindow = Math.max(1, Math.round(settle.windowSeconds * sampleRate));
	const maxSeconds =
		settle.ladderSeconds[settle.ladderSeconds.length - 1] ?? 32;
	const maxWindows = Math.ceil(maxSeconds / settle.windowSeconds);
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(sampleRate);
	for (const [id, position] of options.controls ?? [])
		runtime.setControl(id, position);
	const levels: number[] = [];
	let index = 0;
	for (let w = 0; w < maxWindows; w += 1) {
		const input = new Float64Array(perWindow);
		if (stimulus !== null) {
			for (let i = 0; i < perWindow; i += 1) input[i] = stimulus(index + i);
		}
		index += perWindow;
		const output = runtime.process(input);
		for (let i = 0; i < perWindow; i += 1) {
			if (!Number.isFinite(output[i] as number)) {
				return { status: "nonfinite", atSample: index - perWindow + i };
			}
		}
		levels.push(windowLevel(output, perWindow));
		const found = findSettled(levels, settle);
		if (found !== null) {
			let sum = 0;
			for (let i = 0; i < perWindow; i += 1) sum += output[i] ?? 0;
			const dc = sum / perWindow;
			let peak = 0;
			for (let i = 0; i < perWindow; i += 1) {
				const centred = Math.abs((output[i] ?? 0) - dc);
				if (centred > peak) peak = centred;
			}
			return {
				status: "settled",
				seconds: found.seconds,
				rms: found.rms,
				peak,
				dc,
				tail: Float64Array.from(output),
			};
		}
	}
	return { status: "unsettled", triedSeconds: maxSeconds, windows: levels };
}

/** Thrown by `settledLevel` rather than returning a level it could not settle. */
export class SettleRefusal extends Error {}

/**
 * `settledRender`'s level as a bare number, throwing rather than returning one it cannot stand
 * behind. The one-line form for a scratch probe: `const rms = settledLevel(program)`.
 *
 * Throwing is the point. A scratch script that ignores a return code still reports a number; one
 * that throws stops, which is the loud failure the three-outcome rule asks for.
 */
export function settledLevel(
	program: Program,
	options: SettledRenderOptions = {},
): number {
	const result = settledRender(program, options);
	if (result.status === "settled") return result.rms;
	throw new SettleRefusal(
		result.status === "nonfinite"
			? `render went non-finite at sample ${result.atSample}`
			: `never settled in ${result.triedSeconds}s; last windows ${result.windows
					.slice(-4)
					.map((v) => v.toExponential(2))
					.join(", ")}`,
	);
}

/**
 * Settle a program once, then measure it at each control setting in turn **on the same runtime**.
 *
 * **Why this and not a settle-point cache.** The obvious saving is to remember each packet's
 * settle time and skip the search, but measurement says the search is not the cost: a windowed
 * `settledRender` runs within **3%** of a single `process()` call of the same duration, because
 * `findSettled` already stops the moment the level holds. What costs is *rendering to settle at
 * all*, and a fresh runtime pays the full start-up transient every time — charging supplies over
 * ten seconds to move one knob.
 *
 * Continuing on a runtime that has already settled pays it once:
 *
 * | packet | initial settle | re-settle after a knob move |
 * | --- | --- | --- |
 * | `marshall-jcm800` | 10 s, 15.9 s wall | 1.5 s, 2.36 s — **6.7x cheaper** |
 * | `hiwatt-dr103` | 9 s, 23.0 s wall | 1.5 s, 3.84 s — **6.0x cheaper** |
 * | `orange-rockerverb` | 1.5 s | 1.5 s — 1.0x, already at the floor |
 *
 * The floor is `consecutive` stable windows, currently 1.5 s, so a packet that settles that fast
 * gains nothing and loses nothing. The gain is concentrated where the expense is.
 *
 * **The cost of the trick, stated rather than hidden: this is order-dependent by construction.**
 * A circuit with memory — a latch, a sag-dependent bias, an envelope with a long tail — can land
 * somewhere different depending on which setting preceded it, where independent renders cannot.
 * That is also *more* physical than restarting, since a real pedal is never power-cycled between
 * knob positions. `sweepIsOrderIndependent` checks it directly by sweeping forwards and backwards,
 * and a caller measuring a latching circuit should use `settledRender` per point instead.
 */
export function settledSweep(
	program: Program,
	points: readonly (readonly (readonly [string, number])[])[],
	options: SettledRenderOptions = {},
): readonly SettledRender[] {
	const sampleRate = options.sampleRate ?? 48_000;
	const settle = options.settle ?? SETTLE_DEFAULTS;
	const stimulus = resolveStimulus(options);
	const perWindow = Math.max(1, Math.round(settle.windowSeconds * sampleRate));
	const maxWindows = Math.ceil(
		(settle.ladderSeconds[settle.ladderSeconds.length - 1] ?? 32) /
			settle.windowSeconds,
	);
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(sampleRate);
	for (const [id, position] of options.controls ?? [])
		runtime.setControl(id, position);
	let index = 0;

	/** Render windows on the shared runtime until the level holds, or the ladder runs out. */
	const settleHere = (): SettledRender => {
		const levels: number[] = [];
		for (let w = 0; w < maxWindows; w += 1) {
			const input = new Float64Array(perWindow);
			if (stimulus !== null) {
				for (let i = 0; i < perWindow; i += 1) input[i] = stimulus(index + i);
			}
			index += perWindow;
			const output = runtime.process(input);
			for (let i = 0; i < perWindow; i += 1) {
				if (!Number.isFinite(output[i] as number)) {
					return { status: "nonfinite", atSample: index - perWindow + i };
				}
			}
			levels.push(windowLevel(output, perWindow));
			const found = findSettled(levels, settle);
			if (found !== null) {
				let sum = 0;
				for (let i = 0; i < perWindow; i += 1) sum += output[i] ?? 0;
				const dc = sum / perWindow;
				let peak = 0;
				for (let i = 0; i < perWindow; i += 1) {
					const centred = Math.abs((output[i] ?? 0) - dc);
					if (centred > peak) peak = centred;
				}
				return {
					status: "settled",
					seconds: found.seconds,
					rms: found.rms,
					peak,
					dc,
					tail: Float64Array.from(output),
				};
			}
		}
		return {
			status: "unsettled",
			triedSeconds: settle.ladderSeconds[settle.ladderSeconds.length - 1] ?? 32,
			windows: levels,
		};
	};

	// Pay the start-up transient once, before any point is measured.
	settleHere();
	return points.map((point) => {
		// **Reset to defaults first, or points leak into each other.** Sharing one runtime shares
		// its control state as well as its circuit state, so a point that sets only the knob it
		// cares about inherits every knob the previous point moved. Each point is therefore a
		// complete assignment: declared defaults, then this call's base `controls`, then the
		// point. The circuit state is what is being reused; the panel is not.
		for (const control of program.controls ?? []) {
			try {
				runtime.setControl(control.id, control.defaultPosition);
			} catch {
				// A control the runtime does not know is not a reason to fail the sweep.
			}
		}
		for (const [id, position] of options.controls ?? [])
			runtime.setControl(id, position);
		for (const [id, position] of point) runtime.setControl(id, position);
		return settleHere();
	});
}

/**
 * Does sharing a runtime change the answer? Compare a sweep against independent renders.
 *
 * **This replaces an order check, which was the wrong question.** `sweepIsOrderIndependent` asked
 * whether sweeping forwards and backwards agreed, and on `boss-lm-2` — a limiter — it answered
 * **true** while the sweep was wrong by **84 dB**:
 *
 * ```
 * swept:       1.067e-6  1.057e-6  1.067e-6  1.058e-6
 * independent: 1.821e-2  1.056e-6  1.821e-2  1.056e-6
 * ```
 *
 * The hazard is not the *sequence* of points, it is sharing state at all. `settledSweep` settles
 * once before the first point, and for an envelope circuit that initial settle drives the
 * compressor into gain reduction that no later point recovers from — so every point is poisoned
 * *equally*, forwards and backwards alike, and an order check sees perfect agreement.
 *
 * The only sound validation is against the thing the sweep is an optimisation of. Circuits at risk
 * are the ones carrying state across a control change: compressors, limiters, noise gates,
 * envelope filters, slow LFOs, anything with a long-tailed bias.
 */
export function sweepMatchesIndependent(
	program: Program,
	points: readonly (readonly (readonly [string, number])[])[],
	options: SettledRenderOptions = {},
	toleranceDb = 0.5,
): boolean {
	const swept = settledSweep(program, points, options);
	return points.every((point, i) => {
		const alone = settledRender(program, {
			...options,
			controls: [...(options.controls ?? []), ...point],
		});
		const a = swept[i];
		if (a?.status !== "settled" || alone.status !== "settled") {
			return a?.status === alone.status;
		}
		const ratio = Math.max(a.rms, 1e-30) / Math.max(alone.rms, 1e-30);
		return Math.abs(20 * Math.log10(ratio)) <= toleranceDb;
	});
}

/**
 * **Sweep where it is safe, and fall back where it is not.**
 *
 * Verifies one point against an independent render — the cheapest check that can catch a shared
 * state hazard — and re-measures the whole packet independently when they disagree. A packet that
 * carries no state across a control change pays one extra render; one that does gets the right
 * answer instead of a fast wrong one.
 *
 * The verified point is the **first**, because that is the one immediately after the shared
 * initial settle and therefore the most exposed to it.
 */
export function settledSweepVerified(
	program: Program,
	points: readonly (readonly (readonly [string, number])[])[],
	options: SettledRenderOptions = {},
	toleranceDb = 0.5,
): { readonly results: readonly SettledRender[]; readonly shared: boolean } {
	const swept = settledSweep(program, points, options);
	const first = points[0];
	if (first === undefined) return { results: swept, shared: true };
	const alone = settledRender(program, {
		...options,
		controls: [...(options.controls ?? []), ...first],
	});
	const a = swept[0];
	const agrees =
		a?.status === "settled" && alone.status === "settled"
			? Math.abs(
					20 * Math.log10(Math.max(a.rms, 1e-30) / Math.max(alone.rms, 1e-30)),
				) <= toleranceDb
			: a?.status === alone.status;
	if (agrees) return { results: swept, shared: true };
	return {
		results: points.map((point) =>
			settledRender(program, {
				...options,
				controls: [...(options.controls ?? []), ...point],
			}),
		),
		shared: false,
	};
}

/**
 * Does this program give the same swept answers backwards as forwards?
 *
 * `settledSweep`'s saving comes from not restarting, which makes it order-dependent for any
 * circuit carrying state across a control change. This is the check: sweep the points, sweep them
 * reversed, and compare the levels. `false` means the packet needs independent renders.
 */
export function sweepIsOrderIndependent(
	program: Program,
	points: readonly (readonly (readonly [string, number])[])[],
	options: SettledRenderOptions = {},
	tolerance = 1e-9,
): boolean {
	const forward = settledSweep(program, points, options);
	const backward = [
		...settledSweep(program, [...points].reverse(), options),
	].reverse();
	return forward.every((a, i) => {
		const b = backward[i];
		if (a.status !== "settled" || b === undefined || b.status !== "settled") {
			return a.status === b?.status;
		}
		return Math.abs(a.rms - b.rms) <= tolerance * Math.max(Math.abs(a.rms), 1);
	});
}

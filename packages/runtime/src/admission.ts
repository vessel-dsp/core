// Real-time admission: can a compiled program -- or a whole chain of them -- be shown to fit
// inside a host's CPU budget before it is allowed to run?
//
// **It takes a chain, not a program, and that is the load-bearing change.** The console runs
// an ordered list of Programs (see `./chain.ts`), every slot solving every sample, so the
// costs add. Gating each slot separately against the whole budget is the permissive failure:
// three pedals each measured at 0.9x of the sample period each pass alone and together need
// 2.7x, and the host finds out as clicks. One verdict over the whole list is the only shape
// that can refuse that, which is why there is no single-program entry point left -- a caller
// with one program passes a one-element list and gets an identical answer.
//
// The gap this closes: `Program.requiredOperators` (S1b) refuses a program a runtime
// cannot *execute at all*, by name, at `prepare()`. Nothing stopped a program a runtime
// *can* execute but cannot execute in time -- a packet at 350x real time loaded exactly
// as willingly as one at 0.15x, and the difference only showed up later as held samples
// and audible clicks, after a host had already committed to playing it. This is the same
// refusal shape -- fail closed, name what is missing -- applied to cost instead of
// capability.
//
// **The central tension this design has to hold, not paper over.** Real-time cost is not
// a property of the program alone: it is program x machine x sample rate x block size. A
// `.vdsp` that is playable on a laptop is not playable on an ESP32, so a portable artifact
// cannot honestly carry "playable: true" -- there is no fact of that shape a compiler
// could know. What it *can* carry is the rate-independent, machine-independent half:
// `Program.costPredictors` (`../compiler/types.ts`), computed once from circuit structure
// alone -- unknown counts, state size, block count, which blocks may iterate. The
// machine-dependent half -- how many nanoseconds one dense solve of a given size costs on
// THIS host's hardware and engine, and how much of the sample period this host is willing
// to spend -- can only come from the host, which is why it is a `prepare()` argument and
// never a default this module invents.
//
// **What this deliberately does not attempt.** It does not predict how many Newton
// iterations a sample will actually need -- that is a signal- and control-position-
// dependent number with no static derivation (`scripts/report-newton-deadline.ts` measures
// it empirically for exactly this reason: "iteration counts are rate-independent and are
// the right input to a CPU-budget decision, where wall-clock from the stamp interpreter is
// not" -- true, but the counts themselves still come from running a signal through, not
// from reading the circuit), and fabricating a bound here would be worse than omitting one.
//
// **It charges a BUDGETED iteration allowance, which is a policy number, and NOT the
// solver's cap.** Those were the same number until 2026-09-09 and it was a conflation:
// the cap is a *correctness* bound -- how long the solver may keep trying before the
// answer it has is the answer it returns -- and the admission charge is a *cost* policy.
// Tying them means any change to one silently rewrites the other, and it did: raising the
// cap from 64 to 1024 so that `moogerfooger-mf-102` (183 iterations once, then 2.1 per
// sample) and `mxr-blue-box` (356) could converge made every nonlinear block look 16x more
// expensive here, and chains that admit today would have been refused. Neither side was
// wrong; no single value satisfied both, which is the signature of a conflation rather than
// a mis-tuned constant.
//
// **The overrun policy, which is what makes a typical-cost charge honest.** A sample that
// needs more than the budgeted allowance is a *spike*, and a spike is not an inadmissible
// chain -- `report-newton-deadline.ts`'s own triage says so: `peak == mean` is a fixed cost
// to budget and ship; `peak >> mean` is "a bounded solver plus a held sample covers it, and
// the cost is a rare tiny error rather than a dropout"; only `mean at the cap` is not a
// real-time circuit. A rare held sample beats refusing to load, which is what a real-time
// audio system actually does. So the charge bounds the sustained case and the cap bounds
// the excursion, and the two no longer move together.
//
// Convergence and cost remain different questions: a held, unconverged sample still burns
// CPU, so `telemetry().nonConvergedSamples` (and now `stalledSamples`) remain the *quality*
// numbers while this stays the *cost* one.
//
// Fail-closed, in the sense that matters here: admission runs only when a host opts in by
// supplying a budget (there is no honest default for a per-machine nanosecond figure), but
// once supplied, a program that cannot be shown to fit is refused, naming the block and
// the numbers that did not fit -- never accepted and left to glitch. A caller that
// supplies no budget has explicitly chosen not to gate, the same way a caller that never
// reads `telemetry()` has chosen not to look at convergence: a skipped input is a skip,
// not a pass.

import type { Program } from "@vessel-dsp/compiler";

/**
 * The sustained allowance a host gets when it does not state one: the value the solver's cap
 * supplied while the two were the same number, so separating them changes no verdict.
 */
const DEFAULT_BUDGETED_ITERATIONS = 64;

/**
 * What only a host can know, and what this repository has no honest default for.
 *
 * A laptop and an ESP32 differ here by orders of magnitude, and the *runtime
 * implementation* is part of "machine" too -- this dense reference interpreter is
 * measured at up to ~12x slower than the sparse plan it exists to be the reference for
 * (`thoughts/shared/plans/2026-08-12-runtime-modules.md`, S3), so a constant baked in here
 * would describe neither a real machine nor the shipped engine.
 */
export type RealtimeBudget = {
	/**
	 * This host's own measured cost, in nanoseconds, of one dense solve of a system with
	 * `unknownCount` unknowns, on the hardware and engine that will actually run the
	 * program. Called once per solved block per iteration it is charged for: a linear
	 * block is charged one call (it solves once per sample), a nonlinear block is charged
	 * `budgetedIterationsPerSample` calls -- the sustained allowance, not the solver's cap.
	 */
	readonly nsPerSolve: (unknownCount: number) => number;
	/**
	 * This host's own measured cost, in nanoseconds, of one per-sample step of the named DSP
	 * model -- a bucket brigade's ring-buffer read and write, say. Called once per executed
	 * `macro` block per sample (a macro does not iterate; it has no Newton loop to cap).
	 *
	 * **Required, not optional, because optional is how the hole got there.** A macro block
	 * contributes nothing to `CostPredictors.solvedBlocks`, so before this existed a macro's
	 * per-sample work was costed at exactly zero and a program of nothing but macro blocks was
	 * admitted unconditionally. An optional field would restore that: every existing caller
	 * would keep omitting it and keep getting the old silent zero. A host that plays no macro
	 * program never sees this called and can write `() => 0` honestly; a host that does play
	 * one has to have measured something.
	 *
	 * Return a non-finite or negative figure and the program is **refused by model name**,
	 * rather than costed at zero -- the same fail-closed shape `requiredModels` already has at
	 * `prepare()`. "The host has no price for this algorithm" is a refusal, not a free block.
	 */
	readonly nsPerMacroSample: (modelId: string) => number;
	/**
	 * Newton iterations per sample this host budgets for a nonlinear block: the **sustained
	 * allowance**, not the solver's cap.
	 *
	 * Host policy, which is why it lives here beside `cpuBudgetFraction` rather than being a
	 * constant this module invents — and separate from `maxNewtonIterations`, which is a
	 * correctness bound. See the header for why they were one number and could not stay so.
	 *
	 * Defaults to 64, the value the cap supplied when the two were the same, so a host that
	 * does not set it sees no change in verdict. The corpus median is ~2.5 iterations per
	 * sample and the worst sustained figure ~9.7, so 64 is very conservative; lowering it is
	 * a host's choice about how much spike headroom to keep.
	 */
	readonly budgetedIterationsPerSample?: number;
	/**
	 * Fraction of one sample period (`1e9 / sampleRate` ns) this host is willing to spend
	 * on this chain, leaving headroom for whatever else its audio thread does. Defaults
	 * to 1.0 -- the whole sample period, which is optimistic for any host running more
	 * than one program at once.
	 */
	readonly cpuBudgetFraction?: number;
};

/** A verdict rather than a thrown error, so the caller decides how to fail. */
export type AdmissionVerdict =
	| { readonly fits: true }
	| { readonly fits: false; readonly reason: string };

/**
 * One costed unit of per-sample work: a solved MNA block, or one macro block's DSP step.
 *
 * Both shapes carry `slot` because a chain's refusal has to be actionable -- "block
 * `analog:0` is too expensive" names the same block in all seven of the corpus's playable
 * packets, and tells a host nothing about which pedal to take off the board.
 */
type CostedUnit = {
	readonly slot: number;
	readonly blockId: string;
	/** What it is, for the refusal sentence. */
	readonly description: string;
	readonly worstCaseNs: number;
};

/** Worst-case per-sample cost of every unit in one slot's program. */
function costUnits(
	program: Program,
	slot: number,
	budgetedIterationsPerSample: number,
	budget: RealtimeBudget,
): { units: readonly CostedUnit[]; unpriced: readonly string[] } {
	const units: CostedUnit[] = [];
	for (const block of program.costPredictors.solvedBlocks) {
		// A linear block solves once per sample; a nonlinear one is charged the sustained
		// allowance rather than the solver's cap. See the header: the cap is a correctness
		// bound and an excursion past the allowance is a spike the overrun policy covers,
		// not a chain to refuse.
		const iterations = block.linear ? 1 : budgetedIterationsPerSample;
		units.push({
			slot,
			blockId: block.blockId,
			description: `${block.unknownCount} unknowns, ${
				block.linear
					? "linear"
					: `nonlinear, budgeted=${budgetedIterationsPerSample} it/sample`
			}`,
			worstCaseNs: iterations * budget.nsPerSolve(block.unknownCount),
		});
	}
	const unpriced: string[] = [];
	for (const block of program.costPredictors.macroBlocks) {
		const ns = budget.nsPerMacroSample(block.modelId);
		// A host with no measured figure for this algorithm is refused by name, never costed
		// at zero -- see `RealtimeBudget.nsPerMacroSample`. Zero itself is accepted: a host is
		// allowed to say an algorithm is free on its hardware, and that is a claim it made.
		if (!Number.isFinite(ns) || ns < 0) {
			unpriced.push(block.modelId);
			continue;
		}
		units.push({
			slot,
			blockId: block.blockId,
			description: `DSP model "${block.modelId}", 1 step/sample`,
			worstCaseNs: ns,
		});
	}
	return { units, unpriced };
}

/**
 * Whether `chain` -- an ordered list of Programs, each solved every sample -- can be shown to
 * fit inside `budget` at `sampleRate`, given a sustained allowance of
 * `budgetedIterationsPerSample` Newton iterations for each nonlinear block.
 *
 * **The allowance is a policy, not the solver's cap** -- see the header. A sample that needs
 * more is a spike the overrun policy covers (a bounded solver and a held sample), which is
 * why raising the cap so a legitimate 183-iteration transient can converge no longer makes
 * every chain 16x more expensive to admit.
 *
 * Still fail-closed on everything it can price: a macro block is charged the host's own
 * per-step figure, an unpriced model is refused by name, and costs add across slots.
 *
 * **Costs add across slots and nothing here discounts them.** There is no shared work between
 * two slots -- each holds its own program, its own state and its own solver scratch -- so the
 * sum is the honest model, not a conservative one.
 */
export function admissionVerdict(
	chain: readonly Program[],
	sampleRate: number,
	budget: RealtimeBudget,
): AdmissionVerdict {
	const budgetedIterationsPerSample =
		budget.budgetedIterationsPerSample ?? DEFAULT_BUDGETED_ITERATIONS;
	if (
		!Number.isFinite(budgetedIterationsPerSample) ||
		budgetedIterationsPerSample < 1
	) {
		return {
			fits: false,
			reason: `budgetedIterationsPerSample must be a finite number of at least 1, got ${budgetedIterationsPerSample}`,
		};
	}
	const fraction = budget.cpuBudgetFraction ?? 1;
	if (!(fraction > 0) || fraction > 1) {
		return {
			fits: false,
			reason: `cpuBudgetFraction must be in (0, 1], got ${fraction}`,
		};
	}
	const nsAvailable = (1e9 / sampleRate) * fraction;
	const costed: CostedUnit[] = [];
	const unpriced: { slot: number; modelId: string }[] = [];
	for (const [slot, program] of chain.entries()) {
		const result = costUnits(program, slot, budgetedIterationsPerSample, budget);
		costed.push(...result.units);
		for (const modelId of result.unpriced) {
			unpriced.push({ slot, modelId });
		}
	}
	// Before the arithmetic: a chain carrying an algorithm the budget cannot price has no
	// worst case to compare, and summing the rest would produce a number that reads like a
	// measurement of the whole chain while omitting a slot.
	if (unpriced.length > 0) {
		const named = unpriced
			.map(({ slot, modelId }) => `slot ${slot} "${modelId}"`)
			.join(", ");
		return {
			fits: false,
			reason:
				`chain cannot be shown to fit: the budget declares no usable per-sample cost ` +
				`for ${unpriced.length === 1 ? "DSP model" : "DSP models"} ${named}`,
		};
	}
	const worstCaseNs = costed.reduce((sum, unit) => sum + unit.worstCaseNs, 0);
	if (worstCaseNs <= nsAvailable) {
		return { fits: true };
	}
	const worst = [...costed].sort((a, b) => b.worstCaseNs - a.worstCaseNs)[0];
	const worstDescription =
		worst === undefined
			? "no costed block"
			: `slot ${worst.slot} block "${worst.blockId}" (${worst.description}) alone ` +
				`costing ${worst.worstCaseNs.toFixed(0)} ns/sample`;
	return {
		fits: false,
		reason:
			`chain of ${chain.length} program(s) cannot be shown to fit inside ` +
			`${nsAvailable.toFixed(0)} ns/sample at ${sampleRate} Hz ` +
			`(cpuBudgetFraction=${fraction}): worst case is ${worstCaseNs.toFixed(0)} ` +
			`ns/sample across ${costed.length} costed block(s), worst offender ` +
			`${worstDescription}`,
	};
}

/**
 * The same worst-case sum the gate compares, returned as a number.
 *
 * Exists so a measurement harness can ask what admission *predicted* and hold it against a
 * stopwatch, rather than parsing it back out of a refusal sentence -- and so the two can only
 * ever disagree because the model is wrong, never because they were computed differently.
 * `null` when a declared model has no price, which is the same condition the gate refuses on.
 */
export function predictedWorstCaseNs(
	chain: readonly Program[],
	budget: RealtimeBudget,
): number | null {
	const budgetedIterationsPerSample =
		budget.budgetedIterationsPerSample ?? DEFAULT_BUDGETED_ITERATIONS;
	let total = 0;
	for (const [slot, program] of chain.entries()) {
		const { units, unpriced } = costUnits(
			program,
			slot,
			budgetedIterationsPerSample,
			budget,
		);
		if (unpriced.length > 0) {
			return null;
		}
		for (const unit of units) {
			total += unit.worstCaseNs;
		}
	}
	return total;
}

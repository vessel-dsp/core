// Contract for real-time admission (`../admission.ts`) and its wiring into `prepare()`.
//
// Same discipline as the cartridge lockout's own test file: compile real fixtures rather
// than hand-build programs, assert on the number and the name rather than the sentence
// around them, and pair every refusal with a negative control so a gate that always
// threw -- or never did -- could not pass silently.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import {
	diodeClipper,
	resistorDivider,
} from "../compiler/fixtures/circuits";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime, RuntimeError } from "@vessel-dsp/runtime";

function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

// Both fixtures compile to one 4-unknown block (nodeCount 3 + auxCount 1): `diodeClipper`
// nonlinear, `resistorDivider` linear. A flat per-unknown cost is enough to separate them,
// because the gate's iteration multiplier (1 versus the cap) is what actually varies.
const nsPerUnknown = (perUnknown: number) => (unknownCount: number) =>
	unknownCount * perUnknown;

describe("real-time admission", () => {
	it("opts out entirely when no budget is supplied -- a skip, not a pass", () => {
		// The negative control this whole file leans on: without this test, a gate that
		// always threw would pass every refusal test below for the wrong reason.
		const runtime = new ReferenceRuntime(programFor(diodeClipper));
		expect(() => runtime.prepare(48_000)).not.toThrow();
	});

	it("admits a program whose worst case fits comfortably", () => {
		// 64 iterations (the shipped cap) x 4 unknowns x 10 ns/unknown = 2,560 ns/sample,
		// well inside the 20,833 ns/sample a 48 kHz rate allows.
		const runtime = new ReferenceRuntime(programFor(diodeClipper));
		expect(() =>
			runtime.prepare(48_000, {
				realtimeBudget: { nsPerSolve: nsPerUnknown(10), nsPerMacroSample: () => 0 },
			}),
		).not.toThrow();
	});

	it("refuses a program whose worst case exceeds the budget, naming the block and the numbers", () => {
		// 64 x 4 x 500 = 128,000 ns/sample against a 20,833 ns/sample budget -- unambiguous.
		const runtime = new ReferenceRuntime(programFor(diodeClipper));
		expect(() =>
			runtime.prepare(48_000, {
				realtimeBudget: { nsPerSolve: nsPerUnknown(500), nsPerMacroSample: () => 0 },
			}),
		).toThrow(RuntimeError);
		expect(() =>
			runtime.prepare(48_000, {
				realtimeBudget: { nsPerSolve: nsPerUnknown(500), nsPerMacroSample: () => 0 },
			}),
		).toThrow(/analog:0/);
	});

	it("negative control: the identical arithmetic admits a linear circuit under the same budget", () => {
		// Proves the refusal above is about the numbers -- iterations x unknowns x nsPerSolve --
		// and not about `diodeClipper` specifically. Same unknown count, same nsPerSolve, only
		// `linear` differs: 1 x 4 x 500 = 2,000 ns/sample fits easily.
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		expect(() =>
			runtime.prepare(48_000, {
				realtimeBudget: { nsPerSolve: nsPerUnknown(500), nsPerMacroSample: () => 0 },
			}),
		).not.toThrow();
	});

	it("is sensitive to the iteration allowance a host chooses, not a fixed constant", () => {
		// Same program, same nsPerSolve; only the budgeted allowance moves. The contract is
		// that the gate reads the host's number rather than assuming its own default.
		//
		// **The allowance is no longer the solver's cap**, and that separation is the point:
		// the cap is a correctness bound (how long the solver may try) and this is a cost
		// policy (what the host budgets per sample). While they were one number, raising the
		// cap so a 183-iteration transient could converge silently made every nonlinear block
		// 16x more expensive to admit.
		const program = programFor(diodeClipper);
		const lenient = new ReferenceRuntime(program);
		expect(() =>
			lenient.prepare(48_000, {
				realtimeBudget: {
					nsPerSolve: nsPerUnknown(80),
					nsPerMacroSample: () => 0,
					budgetedIterationsPerSample: 4,
				},
			}),
		).not.toThrow();
		const strict = new ReferenceRuntime(program);
		expect(() =>
			strict.prepare(48_000, {
				realtimeBudget: {
					nsPerSolve: nsPerUnknown(80),
					nsPerMacroSample: () => 0,
					budgetedIterationsPerSample: 100,
				},
			}),
		).toThrow(RuntimeError);
	});

	it("the solver's cap does NOT move the verdict, which is the separation itself", () => {
		// The negative control for the change above: a 16x cap difference with the allowance
		// held fixed must not change admission at all. Before 2026-09-09 this test could not
		// have passed -- the cap WAS the charge.
		const program = programFor(diodeClipper);
		const budget = {
			nsPerSolve: nsPerUnknown(80),
			nsPerMacroSample: () => 0,
			budgetedIterationsPerSample: 4,
		};
		for (const maxNewtonIterations of [64, 1024]) {
			const runtime = new ReferenceRuntime(program);
			expect(() =>
				runtime.prepare(48_000, { maxNewtonIterations, realtimeBudget: budget }),
			).not.toThrow();
		}
	});

	it("is sensitive to sample rate: a higher rate leaves less time per sample", () => {
		// 20 x 4 x 80 = 6,400 ns/sample. 48 kHz allows 20,833 ns/sample (fits); 384 kHz
		// allows 2,604 ns/sample (does not) -- same program, same cap, only the rate moves.
		const program = programFor(diodeClipper);
		const budget = { nsPerSolve: nsPerUnknown(80), nsPerMacroSample: () => 0 };
		const slow = new ReferenceRuntime(program);
		expect(() =>
			slow.prepare(48_000, { maxNewtonIterations: 20, realtimeBudget: budget }),
		).not.toThrow();
		const fast = new ReferenceRuntime(program);
		expect(() =>
			fast.prepare(384_000, {
				maxNewtonIterations: 20,
				realtimeBudget: budget,
			}),
		).toThrow(RuntimeError);
	});

	it("cpuBudgetFraction narrows the time available, independent of nsPerSolve", () => {
		const program = programFor(diodeClipper);
		const budget = { nsPerSolve: nsPerUnknown(10), nsPerMacroSample: () => 0 };
		const wholePeriod = new ReferenceRuntime(program);
		expect(() =>
			wholePeriod.prepare(48_000, {
				realtimeBudget: { ...budget, cpuBudgetFraction: 1 },
			}),
		).not.toThrow();
		const tenthOfPeriod = new ReferenceRuntime(program);
		expect(() =>
			tenthOfPeriod.prepare(48_000, {
				realtimeBudget: { ...budget, cpuBudgetFraction: 0.1 },
			}),
		).toThrow(RuntimeError);
	});

	it("refuses an out-of-range cpuBudgetFraction rather than silently clamping it", () => {
		const runtime = new ReferenceRuntime(programFor(resistorDivider));
		expect(() =>
			runtime.prepare(48_000, {
				realtimeBudget: {
					nsPerSolve: nsPerUnknown(1),
					nsPerMacroSample: () => 0,
					cpuBudgetFraction: 0,
				},
			}),
		).toThrow(/cpuBudgetFraction/);
		expect(() =>
			runtime.prepare(48_000, {
				realtimeBudget: {
					nsPerSolve: nsPerUnknown(1),
					nsPerMacroSample: () => 0,
					cpuBudgetFraction: 1.5,
				},
			}),
		).toThrow(/cpuBudgetFraction/);
	});

	it("refuses before any state is reset, leaving the instance exactly as unprepared", () => {
		// Same discipline as the cartridge lockout: a refusal at prepare() must not leave a
		// runtime half-initialised that then throws a different, confusing error on `process`.
		const runtime = new ReferenceRuntime(programFor(diodeClipper));
		expect(() =>
			runtime.prepare(48_000, {
				realtimeBudget: { nsPerSolve: nsPerUnknown(500), nsPerMacroSample: () => 0 },
			}),
		).toThrow(RuntimeError);
		expect(() => runtime.process(new Float64Array(8))).toThrow(RuntimeError);
	});
});

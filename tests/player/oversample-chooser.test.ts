// Pure decision tests for the per-device oversample chooser:
// measured costs in, factor and reason out. No pedal identity enters --
// the inputs are costs and typed program facts only, so the fixtures are
// synthetic costs and minimal programs, never a pedal.

import { describe, expect, test } from "bun:test";
import type { Program } from "@vessel-dsp/compiler";
import {
	chooseOversampleFactor,
	oversampleExclusion,
	redecideOversampleOnRebuild,
	validateOversampleOverride,
	OVERSAMPLE_HEADROOM_FRACTION,
} from "@vessel-dsp/player/engine/oversample-chooser";

function cost(factor: number, p99Ms: number, meanMs = p99Ms * 0.8): { factor: number; ok: true; p99Ms: number; meanMs: number; maxMs: number; blocks: number } {
	return { factor, ok: true, p99Ms, meanMs, maxMs: p99Ms * 1.1, blocks: 64 };
}

describe("chooseOversampleFactor", () => {
	test("picks 4x when it fits, naming the numbers", () => {
		const decision = chooseOversampleFactor({
			costs: [cost(4, 0.85), cost(2, 0.4)],
			quantumMs: 2.667,
		});
		// Expected: the highest fitting candidate wins (accuracy first)
		expect(decision.factor).toBe(4);
		// Expected: the reason carries the measured p99 and the quantum
		expect(decision.reason).toContain("4x");
		expect(decision.reason).toContain("0.85 ms");
		expect(decision.reason).toContain("2.67 ms");
		expect(decision.excluded).toBe(false);
	});

	test("steps 4x -> 2x when only 2x fits", () => {
		const decision = chooseOversampleFactor({
			costs: [cost(4, 2.1), cost(2, 0.9)],
			quantumMs: 2.667,
		});
		// Expected: 4x over the 1.33 ms budget steps down to a fitting 2x
		expect(decision.factor).toBe(2);
		expect(decision.reason).toContain("2x");
		expect(decision.reason).toContain("4x");
	});

	test("steps 4x -> 2x -> 1x when nothing higher fits", () => {
		const decision = chooseOversampleFactor({
			costs: [cost(4, 2.1), cost(2, 1.9)],
			quantumMs: 2.667,
		});
		// Expected: fail closed to today's behaviour, naming both misses
		expect(decision.factor).toBe(1);
		expect(decision.reason).toContain("fail closed to 1x");
		expect(decision.reason).toContain("4x");
		expect(decision.reason).toContain("2x");
	});

	test("a failed factor measurement steps down instead of failing the load", () => {
		const decision = chooseOversampleFactor({
			costs: [
				{ factor: 4, ok: false as const, note: "measurement threw" },
				cost(2, 0.9),
			],
			quantumMs: 2.667,
		});
		// Expected: the throwing factor is skipped, the fitting one picked
		expect(decision.factor).toBe(2);
		expect(decision.reason).toContain("4x not priced");
	});

	test("a non-finite p99 with ok:true is treated as unpriced", () => {
		const decision = chooseOversampleFactor({
			costs: [{ factor: 4, ok: true, p99Ms: Number.NaN, meanMs: 0.5, blocks: 64 }, cost(2, 0.9)],
			quantumMs: 2.667,
		});
		// Expected: NaN is not a measurement; 2x wins
		expect(decision.factor).toBe(2);
	});

	test("an unmeasured factor reads as not tried, not as failed", () => {
		const decision = chooseOversampleFactor({
			costs: [cost(4, 0.85)],
			quantumMs: 2.667,
		});
		expect(decision.factor).toBe(4);
		expect(decision.reason).toContain("2x not tried");
	});

	test("the boundary is inclusive: p99 exactly at budget fits", () => {
		const quantumMs = 2.667;
		const budget = quantumMs * OVERSAMPLE_HEADROOM_FRACTION;
		const decision = chooseOversampleFactor({ costs: [cost(4, budget)], quantumMs });
		// Expected: <= budget fits
		expect(decision.factor).toBe(4);
	});

	test("the headroom fraction is the documented 50% by default", () => {
		expect(OVERSAMPLE_HEADROOM_FRACTION).toBe(0.5);
	});

	test("rate-dependent programs hold at 1x", () => {
		const decision = chooseOversampleFactor({
			costs: [cost(4, 0.2), cost(2, 0.1)],
			quantumMs: 2.667,
			exclusion: { excluded: true, reason: "program needs pitch-tracker, which counts solver samples" },
		});
		// Expected: exclusion wins over fitting costs
		expect(decision.factor).toBe(1);
		expect(decision.excluded).toBe(true);
		expect(decision.reason).toContain("held at 1x");
	});

	test("an explicit override wins over costs and exclusion", () => {
		const decision = chooseOversampleFactor({
			costs: [cost(4, 9.9)],
			quantumMs: 2.667,
			exclusion: { excluded: true, reason: "program needs pitch-shift" },
			override: 2,
		});
		// Expected: benchmarking is what the override is for
		expect(decision.factor).toBe(2);
		expect(decision.excluded).toBe(false);
		expect(decision.reason).toContain("explicit override 2x");
	});

	test("an invalid override is ignored with a note, and the path measures on", () => {
		for (const bad of [0, -1, 1.5, Number.NaN]) {
			const decision = chooseOversampleFactor({
				costs: [cost(4, 0.85), cost(2, 0.4)],
				quantumMs: 2.667,
				override: bad,
			});
			// Expected: a misconfiguration measures on rather than failing or silently changing
			expect(decision.factor).toBe(4);
			expect(decision.reason).toContain("ignoring invalid oversample override");
		}
	});

	test("the same costs give the same decision: no packet identity enters", () => {
		const first = chooseOversampleFactor({ costs: [cost(4, 2.1), cost(2, 0.9)], quantumMs: 2.667 });
		const second = chooseOversampleFactor({ costs: [cost(4, 2.1), cost(2, 0.9)], quantumMs: 2.667 });
		expect(first).toEqual(second);
	});
});

describe("oversampleExclusion", () => {
	function bareProgram(extra: { requiredModels?: string[]; blocks?: unknown } = {}): Program {
		return {
			formatVersion: 6,
			blocks: [],
			controls: [],
			requiredOperators: ["capacitor", "ideal-opamp", "diode"],
			requiredModels: [],
			...extra,
		} as unknown as Program;
	}

	test("a plain circuit program is not excluded", () => {
		const exclusion = oversampleExclusion(bareProgram());
		expect(exclusion.excluded).toBe(false);
	});

	test("a registry pitch-shift model is excluded by its typed model fact", () => {
		const exclusion = oversampleExclusion(bareProgram({ requiredModels: ["pitch-shift"] }));
		expect(exclusion.excluded).toBe(true);
		expect(exclusion.reason).toContain("pitch-shift");
	});

	test("a declared composed pitch-tracker op is excluded by its typed op fact", () => {
		const program = bareProgram({
			blocks: [
				{
					kind: "composed",
					id: "octave",
					modelId: "custom-octave",
					modelSource: "declared",
					positions: [{ id: "p0", out: 0, lines: {}, ops: [{ op: "pitch-tracker", input: { kind: "input" }, out: 0 }] }],
				},
			],
		});
		const exclusion = oversampleExclusion(program);
		expect(exclusion.excluded).toBe(true);
		expect(exclusion.reason).toContain("pitch-tracker");
	});

	test("a declared composed delay line is not excluded", () => {
		const program = bareProgram({
			blocks: [
				{
					kind: "composed",
					id: "echo",
					modelId: "custom-echo",
					modelSource: "declared",
					positions: [{ id: "p0", out: 0, lines: {}, ops: [{ op: "delay-tap", line: "d", length: { mode: "capacity" }, out: 0 }] }],
				},
			],
		});
		// Delays size from seconds x rate: correct at any solver rate
		expect(oversampleExclusion(program).excluded).toBe(false);
	});

	test("no program inspects to excluded", () => {
		expect(oversampleExclusion(null).excluded).toBe(false);
		expect(oversampleExclusion(undefined).excluded).toBe(false);
	});
});

describe("validateOversampleOverride", () => {
	test("absent override passes through", () => {
		expect(validateOversampleOverride(undefined)).toEqual({ factor: null, note: null });
	});

	test("finite integers >= 1 are honoured", () => {
		expect(validateOversampleOverride(1)).toEqual({ factor: 1, note: null });
		expect(validateOversampleOverride(4).factor).toBe(4);
	});

	test("anything else is ignored with a note", () => {
		for (const bad of [0, -2, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			const validated = validateOversampleOverride(bad);
			expect(validated.factor).toBeNull();
			expect(validated.note).toContain("ignoring invalid oversample override");
		}
	});
});

describe("redecideOversampleOnRebuild", () => {
	const costs = [cost(4, 0.9, 0.7), cost(2, 0.4, 0.3)];

	test("keeps the factor when the extras still fit", () => {
		const decided = redecideOversampleOnRebuild({
			costs: [cost(4, 0.5, 0.4), cost(2, 0.3, 0.2)],
			currentFactor: 4,
			// 0.4 ms mean is 3125 ns/sample; 3125 + 1000 fits in 5208
			extrasNsPerSample: 1000,
			budgetNsPerSample: 5208,
		});
		expect(decided.factor).toBe(4);
		expect(decided.reason).toContain("kept 4x");
	});

	test("steps 4x -> 2x when the extras only fit lower", () => {
		const decided = redecideOversampleOnRebuild({
			costs: [cost(4, 0.5, 0.4), cost(2, 0.3, 0.2)],
			currentFactor: 4,
			// 3125 + 3000 over, 1562 + 3000 inside
			extrasNsPerSample: 3000,
			budgetNsPerSample: 5208,
		});
		expect(decided.factor).toBe(2);
	});

	test("steps to 1x when no measured factor fits", () => {
		const decided = redecideOversampleOnRebuild({
			costs,
			currentFactor: 4,
			extrasNsPerSample: 5000,
			budgetNsPerSample: 5208,
		});
		// Expected: today's path takes over; the worklet gate decides at 1x
		expect(decided.factor).toBe(1);
	});

	test("never steps to an unmeasured factor", () => {
		const decided = redecideOversampleOnRebuild({
			// 2x was not tried when 4x fit at start
			costs: [cost(4, 0.5, 0.4)],
			currentFactor: 4,
			extrasNsPerSample: 3000,
			budgetNsPerSample: 5208,
		});
		// Expected: straight to 1x rather than assuming an unpriced 2x
		expect(decided.factor).toBe(1);
	});

	test("at 1x it stays 1x", () => {
		const decided = redecideOversampleOnRebuild({
			costs,
			currentFactor: 1,
			extrasNsPerSample: 0,
			budgetNsPerSample: 5208,
		});
		expect(decided.factor).toBe(1);
	});
});

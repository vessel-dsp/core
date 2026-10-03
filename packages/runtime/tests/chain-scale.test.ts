// Contract for the chain's level-scaling multiply (../chain-scale.ts) -- see the
// signal-chain plan (thoughts/shared/plans/2026-08-21-signal-chain-and-amp-output-stage.md)
// §3.1: `x_normalized(slot n+1) = y_normalized(slot n) * (fullScale(out n) / fullScale(in n+1))`,
// unity at a boundary where either side is `null`.
//
// `chainScaleAdvisories` needs only `Program.ports.{input,output}.fullScaleVolts`, so its
// fixtures are typed stubs rather than compiled programs -- the same discipline
// `partition.test.ts` uses for a `Partitioning` it does not need to construct in full.

import { describe, expect, it } from "bun:test";
import {
	chainScaleAdvisories,
	chainScaleFactor,
	outputConversionFullScale,
} from "../src/chain-scale";
import type { Program } from "@vessel-dsp/compiler";

function stubProgram(
	inputFullScaleVolts: number | null,
	outputFullScaleVolts: number | null,
	outputReferenceVolts: number | null = null,
	stageCoverage?: Program["stageCoverage"],
	inputReferenceVolts: number | null = null,
): Program {
	return {
		portFullScaleVolts: {
			input: inputFullScaleVolts,
			output: outputFullScaleVolts,
		},
		portReferenceVolts: {
			input: inputReferenceVolts,
			output: outputReferenceVolts,
		},
		stageCoverage,
	} as unknown as Program;
}

describe("chainScaleFactor", () => {
	it("is unity when either side is null", () => {
		expect(chainScaleFactor(null, 2)).toBe(1);
		expect(chainScaleFactor(2, null)).toBe(1);
		expect(chainScaleFactor(null, null)).toBe(1);
	});

	it("is the ratio of the two declared full scales when both are given", () => {
		expect(chainScaleFactor(2, 9)).toBeCloseTo(2 / 9, 10);
		expect(chainScaleFactor(9, 2)).toBe(4.5);
		expect(chainScaleFactor(5, 5)).toBe(1);
	});
});

describe("outputConversionFullScale", () => {
	it("prefers the port's declared 0 dBFS reference when it is positive", () => {
		const program = stubProgram(9, 165.46298679765212, 1);
		expect(outputConversionFullScale(program)).toBe(1);
	});

	it("falls back to the derived ceiling when no reference is declared", () => {
		expect(outputConversionFullScale(stubProgram(9, 165.46))).toBe(165.46);
		expect(outputConversionFullScale(stubProgram(9, null))).toBeNull();
	});

	it("ignores a non-positive declared reference as unphysical", () => {
		expect(outputConversionFullScale(stubProgram(9, 9, 0))).toBe(9);
		expect(outputConversionFullScale(stubProgram(9, 9, -1))).toBe(9);
	});

	it("does not upscale a small ceiling behind a large declared reference", () => {
		expect(outputConversionFullScale(stubProgram(9, 9, 20))).toBe(20);
	});

	it("falls back to the derived ceiling for speaker-electrical programs", () => {
		expect(
			outputConversionFullScale(stubProgram(9, 466.7, null, "speaker-electrical")),
		).toBe(466.7);
	});

	it("falls back to 1.0 V instrument convention for instrument programs without references", () => {
		// A 9 V pedal without declared V0dBFS must not divide by 9 V supply rail
		expect(
			outputConversionFullScale(stubProgram(null, 9, null, "instrument")),
		).toBe(1.0);
	});

	it("falls back to input reference for instrument programs with declared input reference", () => {
		expect(
			outputConversionFullScale(
				stubProgram(null, 9, null, "instrument", 0.1),
			),
		).toBe(0.1);
	});

	it("accepts a SlotContract and preserves speaker-electrical ceiling vs instrument fallback", () => {
		expect(
			outputConversionFullScale({
				produces: "speaker-electrical",
				portFullScaleVolts: { input: 1.0, output: 50.0 },
			}),
		).toBe(50.0);

		expect(
			outputConversionFullScale({
				produces: "instrument",
				portFullScaleVolts: { input: null, output: 9.0 },
			}),
		).toBe(1.0);

		expect(
			outputConversionFullScale({
				produces: "instrument",
				portFullScaleVolts: { input: null, output: 9.0 },
				portReferenceVolts: { input: 0.1, output: null },
			}),
		).toBe(0.1);
	});
});

describe("chainScaleAdvisories", () => {
	it("is empty for a one-element chain, which has no boundary", () => {
		expect(chainScaleAdvisories([stubProgram(9, 9)])).toEqual([]);
	});

	it("is empty when every boundary has both sides declared", () => {
		expect(
			chainScaleAdvisories([stubProgram(9, 2), stubProgram(2, 350)]),
		).toEqual([]);
	});

	it("names the boundary when the upstream slot's output is null", () => {
		const advisories = chainScaleAdvisories([
			stubProgram(9, null),
			stubProgram(2, 350),
		]);
		expect(advisories).toHaveLength(1);
		expect(advisories[0]?.slot).toBe(0);
	});

	it("names the boundary when the downstream slot's input is null", () => {
		const advisories = chainScaleAdvisories([
			stubProgram(9, 2),
			stubProgram(null, 350),
		]);
		expect(advisories).toHaveLength(1);
		expect(advisories[0]?.slot).toBe(0);
	});

	it("names every boundary in a longer chain independently", () => {
		const advisories = chainScaleAdvisories([
			stubProgram(9, null), // boundary 0: this slot's output is null
			stubProgram(null, null), // boundary 1: this slot's output is null too
			stubProgram(2, 350),
		]);
		expect(advisories.map((a) => a.slot)).toEqual([0, 1]);
	});
});

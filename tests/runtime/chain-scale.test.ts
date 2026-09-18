// Contract for the chain level-scaling and DAC output scale rules (packages/runtime/src/chain-scale.ts)
//
// A stompbox (stageCoverage === "instrument") without an explicit output reference must NOT
// be divided by its 9 V DC supply rail clipping ceiling (which would attenuate output by -29.5 dBFS).
// It falls back to declared input reference or the 1.0 V instrument convention.

import { describe, expect, it } from "bun:test";
import {
	chainScaleAdvisories,
	chainScaleFactor,
	outputConversionFullScale,
} from "@vessel-dsp/runtime";
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
	it("prefers the port declared 0 dBFS output reference when it is positive", () => {
		const program = stubProgram(9, 165.46, 1);
		expect(outputConversionFullScale(program)).toBe(1);
	});

	it("falls back to the derived ceiling when no reference is declared and no stage coverage is specified", () => {
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

	it("falls back to input reference for generic programs without output reference", () => {
		expect(
			outputConversionFullScale(
				stubProgram(null, 9, null, "preamp", 0.5),
			),
		).toBe(0.5);
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

	it("names the boundary when the upstream slot output is null", () => {
		const advisories = chainScaleAdvisories([
			stubProgram(9, null),
			stubProgram(2, 350),
		]);
		expect(advisories).toHaveLength(1);
		expect(advisories[0]?.slot).toBe(0);
	});

	it("names the boundary when the downstream slot input is null", () => {
		const advisories = chainScaleAdvisories([
			stubProgram(9, 2),
			stubProgram(null, 350),
		]);
		expect(advisories).toHaveLength(1);
		expect(advisories[0]?.slot).toBe(0);
	});

	it("names every boundary in a longer chain independently", () => {
		const advisories = chainScaleAdvisories([
			stubProgram(9, null),
			stubProgram(null, null),
			stubProgram(2, 350),
		]);
		expect(advisories.map((a) => a.slot)).toEqual([0, 1]);
	});
});

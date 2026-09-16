// The taper curve, which the runtime owns because decision 2 says the program carries
// which taper a control is and the thing running the program decides what that means.

import { describe, expect, it } from "bun:test";
import { taperFraction } from "@vessel-dsp/runtime";

describe("taperFraction", () => {
	it("is the identity for a linear taper", () => {
		expect(taperFraction("linear", 0)).toBe(0);
		expect(taperFraction("linear", 0.25)).toBeCloseTo(0.25, 12);
		expect(taperFraction("linear", 1)).toBe(1);
	});

	it("puts roughly a tenth of the track at half rotation for an audio taper", () => {
		expect(taperFraction("logarithmic", 0.5)).toBeCloseTo(0.1, 6);
		expect(taperFraction("logarithmic", 0)).toBeCloseTo(0, 12);
		expect(taperFraction("logarithmic", 1)).toBeCloseTo(1, 12);
	});

	it("is monotonic and clamped outside 0..1", () => {
		expect(taperFraction("linear", -1)).toBe(0);
		expect(taperFraction("linear", 5)).toBe(1);
		expect(taperFraction("reverse-logarithmic", 0)).toBeCloseTo(0, 12);
		expect(taperFraction("reverse-logarithmic", 1)).toBeCloseTo(1, 12);
	});

	it("reverses a linear track without bending it", () => {
		// A reverse-linear pot is linear travelling the other way, so half rotation is
		// still half the track. Reverse-logarithmic puts a tenth there, which is what
		// this taper was collapsing into before it had a kind of its own.
		expect(taperFraction("reverse-linear", 0)).toBe(1);
		expect(taperFraction("reverse-linear", 0.5)).toBeCloseTo(0.5, 12);
		expect(taperFraction("reverse-linear", 1)).toBe(0);
		expect(taperFraction("reverse-logarithmic", 0.5)).toBeCloseTo(0.9, 6);
	});
});

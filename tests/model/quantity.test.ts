import { describe, expect, test } from "bun:test";
import { parseQuantity } from "../../packages/core/src/model/quantity";

describe("parseQuantity", () => {
	test("returns null for empty input", () => {
		expect(parseQuantity("")).toBeNull();
		expect(parseQuantity("   ")).toBeNull();
	});

	test("returns null for non-numeric input", () => {
		expect(parseQuantity("abc")).toBeNull();
		expect(parseQuantity("R10")).toBeNull();
	});

	test("parses unitless numbers", () => {
		expect(parseQuantity("10")).toEqual({ raw: "10", value: 10, unit: "" });
		expect(parseQuantity("3.14")).toEqual({
			raw: "3.14",
			value: 3.14,
			unit: "",
		});
		expect(parseQuantity("-5")).toEqual({ raw: "-5", value: -5, unit: "" });
		expect(parseQuantity(".5")).toEqual({ raw: ".5", value: 0.5, unit: "" });
	});

	test("parses SI prefixes without explicit units", () => {
		expect(parseQuantity("10k")?.value).toBe(10000);
		expect(parseQuantity("2.2M")?.value).toBeCloseTo(2.2e6);
		expect(parseQuantity("4.7n")?.value).toBeCloseTo(4.7e-9);
		expect(parseQuantity("100p")?.value).toBeCloseTo(100e-12);
		expect(parseQuantity("1G")?.value).toBe(1e9);
	});

	test("parses electronics shorthand with suffix decimal marker", () => {
		expect(parseQuantity("1k5")).toEqual({ raw: "1k5", value: 1500, unit: "" });
		expect(parseQuantity("4u7F")).toEqual({
			raw: "4u7F",
			value: 4.7e-6,
			unit: "F",
		});
		expect(parseQuantity("2R2")).toEqual({ raw: "2R2", value: 2.2, unit: "Ω" });
	});

	test("parses capacitance values", () => {
		const c = parseQuantity("4.7uF");
		expect(c).not.toBeNull();
		expect(c?.value).toBeCloseTo(4.7e-6);
		expect(c?.unit).toBe("F");
	});

	test("parses microfarad with µ symbol", () => {
		expect(parseQuantity("100µF")?.value).toBeCloseTo(100e-6);
		expect(parseQuantity("100µF")?.unit).toBe("F");
	});

	test("parses resistance with omega", () => {
		const r = parseQuantity("1MΩ");
		expect(r?.value).toBeCloseTo(1e6);
		expect(r?.unit).toBe("Ω");
	});

	test("accepts ohm word as unit", () => {
		expect(parseQuantity("1kohm")?.value).toBeCloseTo(1000);
		expect(parseQuantity("1kohm")?.unit).toBe("Ω");
	});

	test("parses inductance", () => {
		expect(parseQuantity("100uH")?.value).toBeCloseTo(100e-6);
		expect(parseQuantity("100uH")?.unit).toBe("H");
	});

	test("parses voltage", () => {
		expect(parseQuantity("-12V")).toEqual({
			raw: "-12V",
			value: -12,
			unit: "V",
		});
		expect(parseQuantity("9V")).toEqual({ raw: "9V", value: 9, unit: "V" });
	});

	test("parses frequency", () => {
		expect(parseQuantity("440Hz")?.value).toBe(440);
		expect(parseQuantity("20kHz")?.value).toBe(20000);
		expect(parseQuantity("20kHz")?.unit).toBe("Hz");
	});

	test("preserves the original raw input", () => {
		expect(parseQuantity("  4.7uF  ")?.raw).toBe("4.7uF");
	});

	test("parses scientific notation", () => {
		expect(parseQuantity("1.5e-3V")?.value).toBeCloseTo(1.5e-3);
		expect(parseQuantity("1.5e-3V")?.unit).toBe("V");
	});

	test("strips internal whitespace", () => {
		expect(parseQuantity("100 uF")?.value).toBeCloseTo(100e-6);
	});

	test("preserves unrecognized unit text", () => {
		const q = parseQuantity("100zz");
		expect(q?.value).toBe(100);
		expect(q?.unit).toBe("zz");
	});

	test("accepts U+2126 OHM SIGN and canonicalizes to U+03A9", () => {
		// LiveSPICE writes "10 kΩ" with U+2126 OHM SIGN, not U+03A9 GREEK OMEGA.
		// Use explicit \u escapes here so both codepoints are unambiguous in source.
		const ohmSign = parseQuantity("10 k\u2126");
		expect(ohmSign?.value).toBeCloseTo(10000);
		expect(ohmSign?.unit).toBe("\u03A9");

		const greek = parseQuantity("10 k\u03A9");
		expect(greek?.value).toBeCloseTo(10000);
		expect(greek?.unit).toBe("\u03A9");

		expect(parseQuantity("1M\u2126")?.value).toBeCloseTo(1e6);
	});

	test("accepts U+03BC GREEK SMALL MU as micro prefix", () => {
		// LiveSPICE writes "1 μF" with U+03BC, not U+00B5.
		const greekMu = parseQuantity("1 μF");
		expect(greekMu?.value).toBeCloseTo(1e-6);
		expect(greekMu?.unit).toBe("F");

		const microSign = parseQuantity("1 µF");
		expect(microSign?.value).toBeCloseTo(1e-6);
		expect(microSign?.unit).toBe("F");
	});

	test('parses SPICE "Meg" multiplier as 1e6', () => {
		// SPICE uses "Meg" to distinguish from milli "m". Case-insensitive.
		expect(parseQuantity("1Meg")?.value).toBeCloseTo(1e6);
		expect(parseQuantity("1Meg")?.unit).toBe("");
		expect(parseQuantity("1MEG")?.value).toBeCloseTo(1e6);
		expect(parseQuantity("1meg")?.value).toBeCloseTo(1e6);
		expect(parseQuantity("2.2Meg")?.value).toBeCloseTo(2.2e6);
	});

	test('parses SPICE "Meg" with trailing unit', () => {
		const r = parseQuantity("1MegOhm");
		expect(r?.value).toBeCloseTo(1e6);
		expect(r?.unit).toBe("Ω");

		const f = parseQuantity("10megHz");
		expect(f?.value).toBeCloseTo(10e6);
		expect(f?.unit).toBe("Hz");
	});
});

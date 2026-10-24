// Table-law unit tests: `ldrTableResistanceOhms` against the P873-G35-380
// geometric-mean table (currents in A, resistances in ohms).
//
// Table (provisional hobbyist measurement, electro-music.org topic 27276):
//   0.03 mA -> 60.1k, 0.1 mA -> 11.5k, 0.3 mA -> 4.03k,
//   1 mA -> 1.88k, 10 mA -> 740, 20 mA -> 640.
// Clamps [100, 1e7] are the P873 catalog entry's.

import { describe, expect, it } from "bun:test";
import { ldrTableResistanceOhms } from "../src/reference-runtime";

const CURRENTS = [3e-5, 1e-4, 3e-4, 1e-3, 1e-2, 2e-2];
const OHMS = [60100, 11500, 4030, 1880, 740, 640];
const MIN = 100;
const MAX = 1e7;

describe("ldrTableResistanceOhms", () => {
	it("returns the exact table values at the points", () => {
		for (let i = 0; i < CURRENTS.length; i++) {
			expect(
				ldrTableResistanceOhms(CURRENTS, OHMS, CURRENTS[i] as number, MIN, MAX),
			).toBeCloseTo(OHMS[i] as number, 6);
		}
	});

	it("interpolates linearly in log-log space at a midpoint", () => {
		// Geometric midpoint of the 0.1 mA / 0.3 mA segment: geometric mean of
		// the resistances, not the arithmetic mean.
		const midI = Math.sqrt(1e-4 * 3e-4); // 1.7320508e-4 A
		const got = ldrTableResistanceOhms(CURRENTS, OHMS, midI, MIN, MAX);
		expect(got).toBeCloseTo(6807.7162103, 4);
	});

	it("fails if the interpolation were linear in current", () => {
		// The arithmetic-mean mutant: (11500 + 4030) / 2 = 7765, 14% above the
		// log-log answer 6807.72. A linear implementation fails the midpoint test
		// above; this test pins the gap so the failure is diagnosed, not silent.
		const midI = Math.sqrt(1e-4 * 3e-4);
		const got = ldrTableResistanceOhms(CURRENTS, OHMS, midI, MIN, MAX);
		const linear = ((11500 + 4030) / 2);
		expect(Math.abs(got - linear) / got).toBeGreaterThan(0.05);
		expect(got).not.toBeCloseTo(linear, 2);
	});

	it("extrapolates below the first point on the end segment's slope", () => {
		// 0.01 mA on the 0.03-0.1 mA segment's log-log slope (-1.3735).
		const got = ldrTableResistanceOhms(CURRENTS, OHMS, 1e-5, MIN, MAX);
		expect(got).toBeCloseTo(271770.9023, 0);
	});

	it("extrapolates above the last point on the end segment's slope", () => {
		// 50 mA on the 10-20 mA segment's log-log slope (-0.2095).
		const got = ldrTableResistanceOhms(CURRENTS, OHMS, 5e-2, MIN, MAX);
		expect(got).toBeCloseTo(528.2385594, 4);
	});

	it("clamps the extrapolated value to [minOhms, maxOhms]", () => {
		// 0.01 mA extrapolates to ~271771 ohms: a max of 100k clamps it.
		expect(ldrTableResistanceOhms(CURRENTS, OHMS, 1e-5, MIN, 100000)).toBe(
			100000,
		);
		// 50 mA extrapolates to ~528 ohms: a min of 600 clamps it.
		expect(ldrTableResistanceOhms(CURRENTS, OHMS, 5e-2, 600, MAX)).toBe(600);
		// Far outside both ends with the catalog clamps.
		expect(ldrTableResistanceOhms(CURRENTS, OHMS, 1e-9, MIN, MAX)).toBe(MAX);
	});

	it("takes ldrMaxOhms for a current at or below zero", () => {
		expect(ldrTableResistanceOhms(CURRENTS, OHMS, 0, MIN, MAX)).toBe(MAX);
		expect(ldrTableResistanceOhms(CURRENTS, OHMS, -1e-3, MIN, MAX)).toBe(MAX);
	});
});

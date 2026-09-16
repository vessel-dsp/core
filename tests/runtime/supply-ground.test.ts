// Contract for the mixed-supply-ground check (`../supply-ground.ts`).
//
// Same discipline as the admission test beside it: compile real fixtures rather than
// hand-build programs, so the compiler's own derivation of `Program.supplyReference` is
// exercised by the same test, and pair every conflict with a negative control -- a check that
// always fired would otherwise pass every positive case here for the wrong reason.
//
// The fixtures are one railed amplifier and two sign-flipped derivations of it. No packet
// names: the rule is about supply signs, and a corpus row is not what makes it true.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import {
	railedAmplifier,
	resistorDivider,
} from "../compiler/fixtures/circuits";
import type { Program } from "@vessel-dsp/compiler";
import { supplyGroundConflicts } from "@vessel-dsp/runtime";

function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

// `railedAmplifier` declares `+9` and `-9`, so it is dual-rail as written. Flipping one sign
// gives a supply of a single polarity in each direction.
const bothPositive = railedAmplifier.replace('Voltage: "-9"', 'Voltage: "9"');
const bothNegative = railedAmplifier.replace('Voltage: "9"', 'Voltage: "-9"');

describe("supply reference", () => {
	it("is derived from the supply signs, not defaulted", () => {
		expect(programFor(bothPositive).supplyReference).toBe("negative-ground");
		expect(programFor(bothNegative).supplyReference).toBe("positive-ground");
		expect(programFor(railedAmplifier).supplyReference).toBe("dual-rail");
		expect(programFor(resistorDivider).supplyReference).toBe("unpowered");
	});
});

describe("mixed supply grounds in a chain", () => {
	it("reports one conflict when a positive-ground slot meets a positive rail", () => {
		const conflicts = supplyGroundConflicts([
			programFor(bothNegative),
			programFor(bothPositive),
		]);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.slots).toEqual([0, 1]);
	});

	it("reports a dual-rail slot as a conflict too -- it still carries a positive rail", () => {
		// The subtle case: a charge-pump pedal has a negative rail of its own, which does not
		// make it safe to share a supply with a positive-ground one.
		expect(
			supplyGroundConflicts([
				programFor(bothNegative),
				programFor(railedAmplifier),
			]),
		).toHaveLength(1);
	});

	it("stays quiet when every powered slot agrees", () => {
		// Two negative controls in one: a check that always fired would fail both.
		expect(
			supplyGroundConflicts([
				programFor(bothPositive),
				programFor(bothPositive),
			]),
		).toEqual([]);
		expect(
			supplyGroundConflicts([
				programFor(bothNegative),
				programFor(bothNegative),
			]),
		).toEqual([]);
	});

	it("stays quiet for an unpowered slot, which has no terminal to disagree about", () => {
		expect(
			supplyGroundConflicts([
				programFor(bothNegative),
				programFor(resistorDivider),
			]),
		).toEqual([]);
	});

	it("names every involved slot, so a host can point at them", () => {
		const conflicts = supplyGroundConflicts([
			programFor(bothNegative),
			programFor(bothPositive),
			programFor(bothNegative),
		]);
		expect(conflicts[0]?.slots).toEqual([0, 1, 2]);
	});
});

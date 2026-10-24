// Compiler side of the optocoupler table law: validation, lowering, and the
// guarantee that the generic and power-law paths stay bit-identical.

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import {
	invalidLdrTableReason,
	ldrTableFieldsOf,
} from "../src/device-laws";
import { packagedOptocouplerVtl5c2 } from "../src/fixtures/circuits";
import type { PartRegistry } from "../src/registry";
import type { Stamp } from "../src/types";

const CURRENTS = [3e-5, 1e-4, 3e-4, 1e-3, 1e-2, 2e-2];
const OHMS = [60100, 11500, 4030, 1880, 740, 640];

function tableRegistry(law: Record<string, unknown>): PartRegistry {
	return {
		entries: [
			{
				partIds: ["VTL5C2"],
				declaredTypes: [],
				terminalRoleGroups: [
					["ledanode", "anode", "led_anode", "pin1"],
					["ledcathode", "cathode", "led_cathode", "pin2"],
					["ldra", "a", "ldr_a", "pin3"],
					["ldrb", "b", "ldr_b", "pin4"],
				],
				model: {
					kind: "sections",
					sections: [
						{
							law: {
								kind: "optocoupler",
								ledThresholdVolts: 1.6,
								ledTransconductance: 0.001,
								ldrMinOhms: 100,
								ldrMaxOhms: 1000000,
								...law,
							},
							terminals: [0, 1, 2, 3],
						},
					],
					pinout: ["led_anode", "led_cathode", "ldr_a", "ldr_b"],
				},
			},
		],
	};
}

function optoStampsOf(source: string, registry: PartRegistry): Stamp[] {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program.blocks.flatMap((block) =>
		block.kind === "mna" ? block.stamps : [],
	);
}

describe("invalidLdrTableReason", () => {
	it("accepts a well-formed table and absence", () => {
		expect(invalidLdrTableReason(CURRENTS, OHMS)).toBeNull();
		expect(invalidLdrTableReason(undefined, undefined)).toBeNull();
	});

	it("refuses one-sided, mismatched, short, unordered and non-positive tables", () => {
		expect(invalidLdrTableReason(CURRENTS, undefined)).not.toBeNull();
		expect(invalidLdrTableReason(undefined, OHMS)).not.toBeNull();
		expect(invalidLdrTableReason([1e-3], [1000])).not.toBeNull();
		expect(
			invalidLdrTableReason([1e-3, 1e-3], [1000, 500]),
		).not.toBeNull();
		expect(
			invalidLdrTableReason([1e-3, 1e-4], [1000, 500]),
		).not.toBeNull();
		expect(invalidLdrTableReason([0, 1e-3], [1000, 500])).not.toBeNull();
		expect(invalidLdrTableReason([1e-4, 1e-3], [1000, 0])).not.toBeNull();
		expect(
			invalidLdrTableReason([1e-4, 1e-3], [1000, 500, 200]),
		).not.toBeNull();
		expect(
			invalidLdrTableReason("nope", OHMS),
		).not.toBeNull();
	});
});

describe("ldrTableFieldsOf", () => {
	it("returns {} when absent and copies when present", () => {
		expect(ldrTableFieldsOf({})).toEqual({});
		const got = ldrTableFieldsOf({
			ldrTableCurrentAmps: CURRENTS,
			ldrTableOhms: OHMS,
		});
		expect(got.ldrTableCurrentAmps).toEqual(CURRENTS);
		expect(got.ldrTableOhms).toEqual(OHMS);
		// A copy, not an alias of the caller's arrays.
		expect(got.ldrTableCurrentAmps).not.toBe(CURRENTS);
	});

	it("throws on a present-but-invalid table", () => {
		expect(() =>
			ldrTableFieldsOf({
				ldrTableCurrentAmps: [1e-3, 1e-4],
				ldrTableOhms: [1000, 500],
			}),
		).toThrow();
	});
});

describe("optocoupler table lowering", () => {
	it("stamps the table through to the program", () => {
		const stamps = optoStampsOf(
			packagedOptocouplerVtl5c2,
			tableRegistry({
				ldrTableCurrentAmps: CURRENTS,
				ldrTableOhms: OHMS,
			}),
		);
		const opto = stamps.filter((stamp) => stamp.kind === "optocoupler");
		expect(opto.length).toBe(1);
		const stamp = opto[0] as Extract<Stamp, { kind: "optocoupler" }>;
		expect(stamp.ldrTableCurrentAmps).toEqual(CURRENTS);
		expect(stamp.ldrTableOhms).toEqual(OHMS);
		expect(stamp.ldrPowerLawCoefficientOhms).toBeUndefined();
	});

	it("keeps both arms when an entry carries table and power law", () => {
		const stamps = optoStampsOf(
			packagedOptocouplerVtl5c2,
			tableRegistry({
				ldrTableCurrentAmps: CURRENTS,
				ldrTableOhms: OHMS,
				ldrPowerLawCoefficientOhms: 11.9861,
				ldrPowerLawExponent: -0.892233,
			}),
		);
		const stamp = stamps.find(
			(stamp) => stamp.kind === "optocoupler",
		) as Extract<Stamp, { kind: "optocoupler" }>;
		expect(stamp.ldrTableCurrentAmps).toEqual(CURRENTS);
		expect(stamp.ldrPowerLawCoefficientOhms).toBe(11.9861);
	});

	it("refuses a malformed table at lowering", () => {
		const result = compile(packagedOptocouplerVtl5c2, {
			registry: tableRegistry({
				ldrTableCurrentAmps: [1e-3, 1e-4],
				ldrTableOhms: [1000, 500],
			}),
		});
		expect(result.status).toBe("unsupported");
	});

	it("leaves the generic path bit-identical (no table, no power law)", () => {
		const stamps = optoStampsOf(
			packagedOptocouplerVtl5c2,
			tableRegistry({}),
		);
		const stamp = stamps.find(
			(stamp) => stamp.kind === "optocoupler",
		) as Extract<Stamp, { kind: "optocoupler" }>;
		expect(stamp.ldrTableCurrentAmps).toBeUndefined();
		expect(stamp.ldrTableOhms).toBeUndefined();
		expect(stamp.ldrPowerLawCoefficientOhms).toBeUndefined();
		expect(stamp.ldrPowerLawExponent).toBeUndefined();
	});

	it("leaves the power-law path bit-identical (no table arms)", () => {
		const stamps = optoStampsOf(
			packagedOptocouplerVtl5c2,
			tableRegistry({
				ldrPowerLawCoefficientOhms: 11.9861,
				ldrPowerLawExponent: -0.892233,
			}),
		);
		const stamp = stamps.find(
			(stamp) => stamp.kind === "optocoupler",
		) as Extract<Stamp, { kind: "optocoupler" }>;
		expect(stamp.ldrTableCurrentAmps).toBeUndefined();
		expect(stamp.ldrTableOhms).toBeUndefined();
		expect(stamp.ldrPowerLawCoefficientOhms).toBe(11.9861);
		expect(stamp.ldrPowerLawExponent).toBe(-0.892233);
	});
});

// Stage 2 contract: the evidence ladder, and the refusals.

import { describe, expect, it } from "bun:test";
import { identify, requiresIdentification } from "@vessel-dsp/compiler";
import { readNetlist } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import type { Device } from "@vessel-dsp/compiler";
import {
	chipPinoutExact,
	chipPinoutSuperset,
	knownChip,
	resistorDivider,
	unknownChip,
} from "./fixtures/circuits";
import { fixtureRegistry } from "./fixtures/registry";

function deviceOfKind(source: string, kind: string): Device {
	const netlist = readNetlist(source);
	const device = netlist.devices.find((candidate) => candidate.kind === kind);
	if (device === undefined) {
		throw new Error(`fixture has no ${kind}`);
	}
	return device;
}

describe("requiresIdentification", () => {
	it("is false for anything whose law follows from its kind", () => {
		// The point of the design: passives never enter the identification path at all.
		expect(
			requiresIdentification(deviceOfKind(resistorDivider, "resistor")),
		).toBe(false);
	});

	it("is true for an integrated circuit", () => {
		expect(requiresIdentification(deviceOfKind(unknownChip, "ic"))).toBe(true);
	});
});

describe("identify", () => {
	it("resolves an exact part id", () => {
		const identity = identify(deviceOfKind(knownChip, "ic"), fixtureRegistry);
		expect(identity?.evidence).toBe("exact-part");
	});

	it("returns null for an unregistered part, which is a correct answer", () => {
		expect(
			identify(deviceOfKind(unknownChip, "ic"), fixtureRegistry),
		).toBeNull();
	});

	it("returns null for every chip against an empty registry", () => {
		// This is the arbitrary-schematic configuration, not a degenerate case.
		expect(identify(deviceOfKind(knownChip, "ic"), emptyRegistry)).toBeNull();
	});

	it("carries no confidence score, so a ranked guess has no consumer", () => {
		const identity = identify(deviceOfKind(knownChip, "ic"), fixtureRegistry);
		expect(Object.keys(identity ?? {}).sort()).toEqual(["evidence", "partId"]);
	});

	it("does not identify from a name, however suggestive", () => {
		// The fixture's component is literally named MN3007 and described as a bucket
		// brigade delay memory. Neither is evidence.
		const device = deviceOfKind(unknownChip, "ic");
		expect(identify(device, fixtureRegistry)).toBeNull();
	});

	it("matches a pinout only when every declared role is covered by a group", () => {
		// Two roles, both in the fixture's groups: the pinout rung admits it.
		const identity = identify(deviceOfKind(chipPinoutExact, "ic"), fixtureRegistry);
		expect(identity?.evidence).toBe("pinout");
	});

	it("refuses a pinout superset rather than stamp a wrong part", () => {
		// The same two roles plus `reset`, which no group covers. Presence alone would
		// satisfy both groups and return a pinout identity; the exact test must not.
		expect(
			identify(deviceOfKind(chipPinoutSuperset, "ic"), fixtureRegistry),
		).toBeNull();
	});
});

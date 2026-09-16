import { describe, expect, test } from "bun:test";
import { findLatchSeeds } from "@vessel-dsp/compiler";
import type { Device, DeviceKind, Netlist, NodeId } from "@vessel-dsp/compiler";

// Built as netlist literals rather than `.vdsp` fixtures: `findLatchSeeds` is a pure
// function over the stage-1 netlist, so this exercises the rule itself instead of the
// document reader, and each requirement gets a case that isolates it.
//
// These assert the rule's shape, never a packet. The one that matters most is
// `railLinked`: "rails are not routes" has been got wrong three times across this
// pipeline's detectors, and without it a shared supply links every collector to every
// base — measured, a census lacking it reported one corpus packet as having 12
// cross-coupled pairs among four transistors.

function device(
	id: string,
	kind: DeviceKind,
	nodes: readonly number[],
	roles: readonly (string | null)[],
): Device {
	return {
		id,
		kind,
		nodes: nodes as readonly NodeId[],
		parameters: {},
		control: null,
		identity: { partNumber: null, declaredType: null, terminalRoles: roles, declaredTerminalRoles: [], declaredWindings: null },
	};
}

const bjt = (id: string, collector: number, base: number, emitter: number) =>
	device(id, "bjt", [collector, base, emitter], [
		"collector",
		"base",
		"emitter",
	]);

const resistor = (id: string, a: number, b: number) =>
	device(id, "resistor", [a, b], ["a", "b"]);

function netlist(devices: readonly Device[]): Netlist {
	const nodes = [...new Set(devices.flatMap((d) => d.nodes))].sort(
		(a, b) => a - b,
	);
	return {
		nodes,
		devices,
		controls: [],
		ports: { input: 1, output: 2 },
		portImpedanceOhms: { input: null, output: null },
		portDeclaredFullScaleVolts: { input: null, output: null },
	};
}

/** Two transistors, emitters shared, each collector to the other's base. */
const crossCoupled = [
	bjt("QA", 10, 11, 0),
	bjt("QB", 20, 21, 0),
	resistor("Rcross1", 10, 21),
	resistor("Rcross2", 20, 11),
];

describe("findLatchSeeds", () => {
	test("seeds one base of a cross-coupled pair", () => {
		const seeds = findLatchSeeds(netlist(crossCoupled));
		expect(seeds).toHaveLength(1);
		// A base, never a collector: a collector seed provides no differential base drive
		// and leaves the solve on the symmetry axis, so it would silently do nothing.
		expect([11, 21]).toContain(seeds[0]?.node);
		expect(seeds[0]?.volts).toBeGreaterThan(0);
	});

	test("is deterministic across device ordering", () => {
		const forward = findLatchSeeds(netlist(crossCoupled));
		const reversed = findLatchSeeds(netlist([...crossCoupled].reverse()));
		expect(reversed).toEqual(forward);
	});

	test("does not route a cross-couple through a rail", () => {
		// Both "cross-coupling" resistors now reach a base via the supply node instead of
		// from the opposite collector. That is the shape a shared rail creates, and it is
		// not feedback.
		const railLinked = [
			bjt("QA", 10, 11, 0),
			bjt("QB", 20, 21, 0),
			device("V1", "voltage-source", [30, 0], ["positive", "negative"]),
			resistor("Rsupply1", 30, 21),
			resistor("Rsupply2", 30, 11),
		];
		expect(findLatchSeeds(netlist(railLinked))).toEqual([]);
	});

	test("requires a shared emitter", () => {
		const splitEmitters = [
			bjt("QA", 10, 11, 40),
			bjt("QB", 20, 21, 41),
			resistor("Rcross1", 10, 21),
			resistor("Rcross2", 20, 11),
		];
		expect(findLatchSeeds(netlist(splitEmitters))).toEqual([]);
	});

	test("requires the cross-couple in both directions", () => {
		const oneWay = [
			bjt("QA", 10, 11, 0),
			bjt("QB", 20, 21, 0),
			resistor("Rcross1", 10, 21),
		];
		expect(findLatchSeeds(netlist(oneWay))).toEqual([]);
	});

	test("declines an ambiguous transistor rather than tie-breaking", () => {
		// `QA` cross-couples with both `QB` and `QC`. Choosing between them would settle the
		// circuit's state by node numbering, so nothing is seeded.
		const ambiguous = [
			bjt("QA", 10, 11, 0),
			bjt("QB", 20, 21, 0),
			bjt("QC", 30, 31, 0),
			resistor("Rab1", 10, 21),
			resistor("Rab2", 20, 11),
			resistor("Rac1", 10, 31),
			resistor("Rac2", 30, 11),
		];
		expect(findLatchSeeds(netlist(ambiguous))).toEqual([]);
	});

	test("finds nothing in a circuit with no transistors", () => {
		expect(findLatchSeeds(netlist([resistor("R1", 1, 2)]))).toEqual([]);
	});

	// The engaged-side derivation, isolated from the rail-set problem that stops it firing on
	// the corpus. Here the supply *is* a voltage source's own terminal, so the rail set is
	// correct and both floods are bounded — which is the condition the rule needs and the one
	// the real packets do not currently meet.
	//
	// Built so the engaged side is the **higher** base id, because the fallback picks the lower
	// one: if the derivation silently stopped working, this test would still pass against the
	// fallback otherwise.
	test("seeds the side whose switch path reaches a control", () => {
		const switched = [
			bjt("QA", 10, 21, 0),
			bjt("QB", 20, 11, 0),
			resistor("Rcross1", 10, 11),
			resistor("Rcross2", 20, 21),
			device("V1", "voltage-source", [30, 0], ["positive", "negative"]),
			resistor("RloadA", 30, 10),
			resistor("RloadB", 30, 20),
			// Each collector drives one switch's gate.
			resistor("RgateA", 10, 12),
			resistor("RgateB", 20, 22),
			device("SWA", "jfet", [13, 12, 14], ["drain", "gate", "source"]),
			device("SWB", "jfet", [23, 22, 24], ["drain", "gate", "source"]),
			// Only `SWA`'s channel reaches a knob, so its side is the effect path.
			{
				...device("VR1", "potentiometer", [13, 40, 41], [
					"lug1",
					"wiper",
					"lug3",
				]),
				control: "Tone",
			},
			resistor("Rdry", 23, 50),
		];
		const seeds = findLatchSeeds(netlist(switched));
		expect(seeds).toHaveLength(1);
		expect(seeds[0]?.node).toBe(21);
	});

	test("declines when both sides gate the same switches", () => {
		const shared = [
			bjt("QA", 10, 21, 0),
			bjt("QB", 20, 11, 0),
			resistor("Rcross1", 10, 11),
			resistor("Rcross2", 20, 21),
			device("V1", "voltage-source", [30, 0], ["positive", "negative"]),
			// One gate node fed from both collectors: the sides are indistinguishable, so the
			// derivation refuses and the fallback's lower base id is used instead.
			resistor("RgateA", 10, 12),
			resistor("RgateB", 20, 12),
			device("SWA", "jfet", [13, 12, 14], ["drain", "gate", "source"]),
			{
				...device("VR1", "potentiometer", [13, 40, 41], [
					"lug1",
					"wiper",
					"lug3",
				]),
				control: "Tone",
			},
		];
		expect(findLatchSeeds(netlist(shared))[0]?.node).toBe(11);
	});
});

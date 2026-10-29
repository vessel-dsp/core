import { describe, expect, test } from "bun:test";
import { compile } from "../src/compile";
import {
	flipFlopEngagedPolarity,
	flipFlopLedDisagrees,
	flipFlopLedSeed,
} from "../src/fixtures/circuits";
import {
	findBistableLatches,
	findLatchLedDisagreements,
	findLatchSeeds,
} from "../src/latch-seed";
import { readNetlist } from "../src/netlist";
import type { Device, DeviceKind, EffectStatusLed, Netlist, NodeId } from "../src/types";

// Built as netlist literals rather than `.vdsp` fixtures: `findLatchSeeds` is a pure
// function over the stage-1 netlist, so this exercises the rule itself instead of the
// document reader, and each requirement gets a case that isolates it.
//
// These assert the rule's shape, never a packet. The one that matters most is
// `railLinked`: "rails are not routes" has been got wrong three times across this
// pipeline's detectors, and without it a shared supply links every collector to every
// base — measured, a census lacking it reported one corpus packet as having 12
// cross-coupled pairs among four transistors.
//
// Polarity, measured 2026-10-23 (`boss-sd-1` at bypass control 1 rendered dry at
// −0.73 dB with the effect FET off): the member whose collector gates the effect FET
// is OFF when engaged, so the seeded/steered side is the *other* member, named
// `onWhenEngaged`. Every polarity assertion below would fail against the pre-fix
// assignment, which seeded and steered the gating member itself.

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
		identity: { partNumber: null, declaredType: null, terminalRoles: roles, declaredTerminalRoles: [], terminalPinNumbers: roles.map(() => null), declaredWindings: null },
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

function netlist(
	devices: readonly Device[],
	controls: Netlist["controls"] = [],
	effectStatusLeds: readonly EffectStatusLed[] = [],
): Netlist {
	const nodes = [...new Set(devices.flatMap((d) => d.nodes))].sort(
		(a, b) => a - b,
	);
	return {
		nodes,
		devices,
		controls,
		ports: { input: 1, output: 2 },
		bypass: { declared: "none" },
		portImpedanceOhms: { input: null, output: null },
		portDeclaredFullScaleVolts: { input: null, output: null },
		convergenceOptIn: false,
		effectStatusLeds,
	};
}

const led = (id: string, anode: number, cathode: number): EffectStatusLed => ({
	id,
	anode: anode as NodeId,
	cathode: cathode as NodeId,
});

/** Two transistors, emitters shared, each collector to the other's base. */
const crossCoupled = [
	bjt("QA", 10, 11, 0),
	bjt("QB", 20, 21, 0),
	resistor("Rcross1", 10, 21),
	resistor("Rcross2", 20, 11),
];

describe("findBistableLatches", () => {
	test("finds cross-coupled pair and attributes control with role bypass", () => {
		const controls = [
			{
				id: "SW_BYPASS",
				taper: "linear" as const,
				defaultPosition: 1,
				positions: 2,
				role: "bypass",
				label: "Bypass",
			},
		];
		const latches = findBistableLatches(netlist(crossCoupled, controls));
		expect(latches).toHaveLength(1);
		expect(latches[0]?.controlId).toBe("SW_BYPASS");
		expect(latches[0]?.emitter).toBe(0);
		expect([11, 21]).toContain(latches[0]?.onWhenEngagedBase);
		expect([11, 21]).toContain(latches[0]?.offWhenEngagedBase);
		expect(latches[0]?.onWhenEngagedBase).not.toBe(latches[0]?.offWhenEngagedBase);
		// No switch gated either way, so nothing derives the side: the fallback keeps
		// the lower base id exactly as the pre-fix code seeded it.
		expect(latches[0]?.onWhenEngagedBase).toBe(11);
		expect(latches[0]?.sideProvenance).toBe("fallback");
	});

	test("associates control from switch device when role is not declared", () => {
		const withSwitch = [
			...crossCoupled,
			{ ...device("SW1", "switch", [50, 0], ["a", "b"]), control: "SW1" },
		];
		const latches = findBistableLatches(netlist(withSwitch));
		expect(latches).toHaveLength(1);
		expect(latches[0]?.controlId).toBe("SW1");
	});
});

describe("findLatchSeeds", () => {
	test("seeds one base of a cross-coupled pair", () => {
		const seeds = findLatchSeeds(netlist(crossCoupled));
		expect(seeds).toHaveLength(1);
		// A base, never a collector: a collector seed provides no differential base drive
		// and leaves the solve on the symmetry axis, so it would silently do nothing.
		expect(seeds[0]?.node).toBe(11);
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
	// Built so the gating side is `QA` (base 21): the seeded side must therefore be `QB`
	// (base 11), the *other* member. Seeding `QA` is exactly the pre-fix defect, and this
	// assertion fails against it.
	test("seeds the side whose switch path does not carry the effect", () => {
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
			// Only `SWA`'s channel reaches a knob, so its side is the effect path, and
			// `QA` — the member gating it — is OFF when engaged.
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
		const latches = findBistableLatches(netlist(switched));
		expect(latches).toHaveLength(1);
		expect(latches[0]?.sideProvenance).toBe("connectivity");
		expect(latches[0]?.offWhenEngagedTransistorId).toBe("QA");
		expect(latches[0]?.onWhenEngagedTransistorId).toBe("QB");
		const seeds = findLatchSeeds(netlist(switched));
		expect(seeds).toHaveLength(1);
		expect(seeds[0]?.node).toBe(11);
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
		const latches = findBistableLatches(netlist(shared));
		expect(latches).toHaveLength(1);
		expect(latches[0]?.sideProvenance).toBe("fallback");
		expect(findLatchSeeds(netlist(shared))[0]?.node).toBe(11);
	});
});

describe("effect-status LED evidence", () => {
	// The `crossCoupled` pair gates no switch, so connectivity refuses and the LED is
	// the only evidence. The fallback would seed base 11 (`QA`); every case below
	// moves the seed or the provenance away from that, or asserts why it may not.
	test("seeds the member whose collector carries the LED cathode", () => {
		const latches = findBistableLatches(netlist(crossCoupled, [], [led("LED1", 30, 20)]));
		expect(latches).toHaveLength(1);
		expect(latches[0]?.sideProvenance).toBe("effect-status-led");
		expect(latches[0]?.onWhenEngagedTransistorId).toBe("QB");
		expect(findLatchSeeds(netlist(crossCoupled, [], [led("LED1", 30, 20)]))[0]?.node).toBe(21);
	});

	test("seeds through the one resistor between cathode and collector", () => {
		const devices = [...crossCoupled, resistor("R_LED", 31, 20)];
		const latches = findBistableLatches(netlist(devices, [], [led("LED1", 30, 31)]));
		expect(latches[0]?.sideProvenance).toBe("effect-status-led");
		expect(latches[0]?.onWhenEngagedTransistorId).toBe("QB");
	});

	test("an anode directly on a collector selects the other member", () => {
		// Lit when that collector is HIGH, so the member ON when engaged is the other one.
		const latches = findBistableLatches(netlist(crossCoupled, [], [led("LED1", 20, 30)]));
		expect(latches[0]?.sideProvenance).toBe("effect-status-led");
		expect(latches[0]?.onWhenEngagedTransistorId).toBe("QA");
	});

	test("conflicting LEDs are no evidence", () => {
		const latches = findBistableLatches(
			netlist(crossCoupled, [], [led("LEDA", 30, 10), led("LEDB", 30, 20)]),
		);
		expect(latches[0]?.sideProvenance).toBe("fallback");
		expect(findLatchSeeds(netlist(crossCoupled, [], [led("LEDA", 30, 10), led("LEDB", 30, 20)]))[0]?.node).toBe(11);
	});

	test("an anode a resistor away is not evidence", () => {
		// That is the shape a shared supply node makes with the collector loads, not a
		// steering branch: the anode here sits a resistor from `QA`'s collector and the
		// cathode touches nothing, so the side must stay the fallback's.
		const devices = [...crossCoupled, resistor("R_SUP", 31, 10)];
		const latches = findBistableLatches(netlist(devices, [], [led("LED1", 31, 30)]));
		expect(latches[0]?.sideProvenance).toBe("fallback");
	});

	test("connectivity wins over a conflicting LED and names both", () => {
		const switched = [
			bjt("QA", 10, 21, 0),
			bjt("QB", 20, 11, 0),
			resistor("Rcross1", 10, 11),
			resistor("Rcross2", 20, 21),
			device("V1", "voltage-source", [30, 0], ["positive", "negative"]),
			resistor("RloadA", 30, 10),
			resistor("RloadB", 30, 20),
			resistor("RgateA", 10, 12),
			resistor("RgateB", 20, 22),
			device("SWA", "jfet", [13, 12, 14], ["drain", "gate", "source"]),
			device("SWB", "jfet", [23, 22, 24], ["drain", "gate", "source"]),
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
		// Connectivity holds `QB` (the LED's cathode sits on `QA`, the gating member).
		const withLed = netlist(switched, [], [led("LED1", 30, 10)]);
		const latches = findBistableLatches(withLed);
		expect(latches[0]?.sideProvenance).toBe("connectivity");
		expect(latches[0]?.onWhenEngagedTransistorId).toBe("QB");
		expect(findLatchLedDisagreements(withLed)).toEqual([
			{
				onWhenEngagedTransistorId: "QB",
				ledOnTransistorId: "QA",
				ledId: "LED1",
				ledPolarity: "cathode-direct",
			},
		]);
	});

	test("an agreeing LED raises no disagreement", () => {
		const switched = [
			bjt("QA", 10, 21, 0),
			bjt("QB", 20, 11, 0),
			resistor("Rcross1", 10, 11),
			resistor("Rcross2", 20, 21),
			device("V1", "voltage-source", [30, 0], ["positive", "negative"]),
			resistor("RloadA", 30, 10),
			resistor("RloadB", 30, 20),
			resistor("RgateA", 10, 12),
			resistor("RgateB", 20, 22),
			device("SWA", "jfet", [13, 12, 14], ["drain", "gate", "source"]),
			device("SWB", "jfet", [23, 22, 24], ["drain", "gate", "source"]),
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
		const withLed = netlist(switched, [], [led("LED1", 30, 20)]);
		expect(findBistableLatches(withLed)[0]?.sideProvenance).toBe("connectivity");
		expect(findLatchLedDisagreements(withLed)).toEqual([]);
	});
});

describe("engaged polarity end to end", () => {
	// The synthetic fixture with a derived latch, compiled: at control >= 0.5 the
	// holding a collector low forces that transistor ON through the cross-coupling,
	// which holds the effect-gating member OFF, its collector HIGH, the effect FET's
	// gate high, and the effect FET ON. The pre-fix stamps held the gating collector
	// low instead and rendered bypass at engaged control, so asserting which collector
	// each stamp pulls is the mutation-sensitive half of this test: swapping the two
	// stamp members fails it.
	test("engaged control pulls the on-when-engaged collector low", () => {
		const result = compile(flipFlopEngagedPolarity);
		if (result.status !== "ok") {
			throw new Error(`polarity fixture did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const latches = findBistableLatches(readNetlist(flipFlopEngagedPolarity));
		expect(latches).toHaveLength(1);
		const latch = latches[0]!;
		expect(latch.sideProvenance).toBe("connectivity");
		expect(latch.offWhenEngagedTransistorId).toBe("Q_FF1");
		expect(latch.onWhenEngagedTransistorId).toBe("Q_FF2");

		// The seed starts the non-gating member conducting.
		const seeds = findLatchSeeds(readNetlist(flipFlopEngagedPolarity));
		expect(seeds.map((seed) => seed.node)).toEqual([latch.onWhenEngagedBase]);

		// The steering stamps, mapped back from block rows to source nodes: exactly
		// two switch stamps on the latch control, and the one conducting at engaged
		// (onOhms 100 at position >= 0.5) pulls the on-when-engaged collector.
		const steering: { readonly node: number; readonly onOhms: number; readonly offOhms: number }[] = [];
		for (const block of result.program.blocks) {
			if (block.kind !== "mna") continue;
			for (const stamp of block.stamps) {
				if (stamp.kind !== "switch" || stamp.control !== latch.controlId) continue;
				const node = (row: number): number => {
					const resolved = block.nodeIds[row];
					if (resolved === undefined) throw new Error(`row ${row} unmapped`);
					return resolved;
				};
				// One end is always the shared emitter; the steered end is the other.
				const steered = node(stamp.a) === latch.emitter ? node(stamp.b) : node(stamp.a);
				steering.push({ node: steered, onOhms: stamp.onOhms, offOhms: stamp.offOhms });
			}
		}
		expect(steering).toHaveLength(2);
		const engaged = steering.find((stamp) => stamp.onOhms === 100);
		const bypassed = steering.find((stamp) => stamp.offOhms === 100);
		expect(engaged?.node).toBe(latch.onWhenEngagedCollector);
		expect(bypassed?.node).toBe(latch.offWhenEngagedCollector);
	});

	test("an effect-status LED resolves a fallback latch through the document", () => {
		// `flipFlopLedSeed` gates no control-bound path, so connectivity refuses; the
		// CHECK LED's cathode sits directly on `Q_FF2`'s collector, which the reader
		// resolves from the typed `effect-status` / `led` panel record by exact id.
		const result = compile(flipFlopLedSeed);
		if (result.status !== "ok") {
			throw new Error(`LED seed fixture did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const latches = findBistableLatches(readNetlist(flipFlopLedSeed));
		expect(latches).toHaveLength(1);
		expect(latches[0]?.sideProvenance).toBe("effect-status-led");
		expect(latches[0]?.onWhenEngagedTransistorId).toBe("Q_FF2");
		expect(findLatchSeeds(readNetlist(flipFlopLedSeed)).map((seed) => seed.node)).toEqual([24]);
		expect(
			(result.warnings ?? []).map((warning) => warning.code),
		).not.toContain("latch-engaged-disagrees");
	});

	test("a conflicting LED keeps connectivity and warns through the document", () => {
		const result = compile(flipFlopLedDisagrees);
		if (result.status !== "ok") {
			throw new Error(`LED disagree fixture did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const latches = findBistableLatches(readNetlist(flipFlopLedDisagrees));
		expect(latches).toHaveLength(1);
		expect(latches[0]?.sideProvenance).toBe("connectivity");
		expect(latches[0]?.onWhenEngagedTransistorId).toBe("Q_FF2");
		const diagnostics = (result.warnings ?? []).filter(
			(warning) => warning.code === "latch-engaged-disagrees",
		);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.detail).toContain("Q_FF2");
		expect(diagnostics[0]?.detail).toContain("Q_FF1");
		expect(diagnostics[0]?.detail).toContain("D_LED");
	});
});

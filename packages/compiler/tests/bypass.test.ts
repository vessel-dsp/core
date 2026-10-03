import { describe, expect, it } from "bun:test";
import { deriveBypass } from "../src/bypass";
import { compile } from "../src/compile";
import {
	bufferedMechanicalDpdt,
	bypassSwitchIndicatorOnly,
	flipFlopBypassJfetGates,
	flipFlopBypassLatched,
	hardwireSpdt,
	resistorDivider,
	trueBypassDpdt,
} from "../src/fixtures/circuits";
import { findBistableLatches } from "../src/latch-seed";
import { readNetlist } from "../src/netlist";
import type { Device, DeviceKind, Netlist, NodeId, ProgramBypassKind } from "../src/types";

function device(
	id: string,
	kind: DeviceKind,
	nodes: readonly number[],
	roles: readonly (string | null)[],
	control: string | null = null,
): Device {
	return {
		id,
		kind,
		nodes: nodes as readonly NodeId[],
		parameters: {},
		control,
		identity: {
			partNumber: null,
			declaredType: null,
			terminalRoles: roles,
			declaredTerminalRoles: [],
			declaredWindings: null,
		},
	};
}

function netlist(
	devices: readonly Device[],
	bypass: Netlist["bypass"] = { declared: "none" },
	ports: { input: number; output: number } = { input: 1, output: 2 },
): Netlist {
	const nodes = [...new Set(devices.flatMap((d) => d.nodes))].sort(
		(a, b) => a - b,
	);
	return {
		nodes,
		devices,
		controls: [],
		ports,
		bypass,
		portImpedanceOhms: { input: null, output: null },
		portDeclaredFullScaleVolts: { input: null, output: null },
		convergenceOptIn: false,
	};
}

describe("deriveBypass", () => {
	it("derives declared: none when audio.bypass is none", () => {
		const nl = netlist([
			device("IN", "jack", [1, 0], ["tip", "sleeve"]),
			device("OUT", "jack", [2, 0], ["tip", "sleeve"]),
			device("R1", "resistor", [1, 2], ["a", "b"]),
		], { declared: "none" });

		const bp = deriveBypass(nl);
		expect(bp).toEqual({ declared: "none" });
		expect("kind" in bp).toBe(false);
	});

	it("derives buffered when a bistable latch is detected, ignoring adversarial prose", () => {
		// Adversarial prose: id claims mechanical 3PDT true-bypass
		const sw = device("MECHANICAL_3PDT_TRUE_BYPASS", "switch", [10, 0], ["common", "throw"], "Bypass");
		const qa = device("QA", "bjt", [11, 12, 0], ["collector", "base", "emitter"]);
		const qb = device("QB", "bjt", [13, 14, 0], ["collector", "base", "emitter"]);
		const rca = device("RCA", "resistor", [99, 11], ["a", "b"]);
		const rcb = device("RCB", "resistor", [99, 13], ["a", "b"]);
		const rcrossA = device("RCROSS_A", "resistor", [11, 14], ["a", "b"]);
		const rcrossB = device("RCROSS_B", "resistor", [13, 12], ["a", "b"]);
		const rcore = device("R_CORE", "resistor", [1, 2], ["a", "b"]);

		const nl = netlist(
			[sw, qa, qb, rca, rcb, rcrossA, rcrossB, rcore],
			{
				declared: "switch",
				switch: "MECHANICAL_3PDT_TRUE_BYPASS",
				engagedPosition: 0,
			},
		);

		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("buffered");
			expect(bp.control).toBe("Bypass");
		}
	});

	it("derives true-bypass when switch isolates both input and output paths", () => {
		// DPDT true bypass: pole A switches input (node 1 to effect in node 10 vs bypass wire node 20)
		// pole B switches output (node 2 to effect out node 11 vs bypass wire node 20)
		// Adversarial prose: id says BUFFERED_BYPASS
		const swA = device("BUFFERED_BYPASS_A", "switch", [1, 10, 20], ["common", "throw", "throw"], "Bypass");
		const swB = device("BUFFERED_BYPASS_B", "switch", [2, 11, 20], ["common", "throw", "throw"], "Bypass");
		const rCore = device("R_EFFECT", "resistor", [10, 11], ["a", "b"]);

		const nl = netlist(
			[swA, swB, rCore],
			{
				declared: "switch",
				switch: "BUFFERED_BYPASS_A",
				engagedPosition: 0,
			},
		);

		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("true-bypass");
			expect(bp.control).toBe("Bypass");
		}
	});

	it("derives hardwire when switch switches output while input remains permanently tied to effect core", () => {
		// Input jack (node 1) is permanently connected to effect core (node 1 to node 10)
		// Node 10 has effect core components (diode clipper to ground)
		// Switch only selects output jack (node 2) between effect out (node 10) and input (node 1)
		// Adversarial prose: id says TRUE_BYPASS
		const sw = device("TRUE_BYPASS_SPDT", "switch", [2, 10, 1], ["common", "throw", "throw"], "Bypass");
		const rCore = device("R_EFFECT", "resistor", [1, 10], ["a", "b"]);
		const dClip = device("D_CLIP", "diode", [10, 0], ["anode", "cathode"]);

		const nl = netlist(
			[sw, rCore, dClip],
			{
				declared: "switch",
				switch: "TRUE_BYPASS_SPDT",
				engagedPosition: 0,
			},
		);

		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("hardwire");
			expect(bp.control).toBe("Bypass");
		}
	});

	it("resolves ganged poles and walks series passives to reach audio ports", () => {
		// S1A is on node 18 (reached from input node 1 through 1k resistor R_IN)
		// S1B is on node 2 (output port)
		// Declared switch is S1A; ganged pole S1B is found by base identifier S1
		const rIn = device("R_IN", "resistor", [1, 18], ["a", "b"]);
		const s1A = device("S1A", "switch", [18, 10], ["common", "throw"], "S1");
		const s1B = device("S1B", "switch", [2, 11], ["common", "throw"], "S1");
		const rEffect = device("R_EFFECT", "resistor", [10, 11], ["a", "b"]);

		const nl = netlist([rIn, s1A, s1B, rEffect], {
			declared: "switch",
			switch: "S1A",
			engagedPosition: 0,
		});

		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("true-bypass");
		}
	});

	it("derives not-in-audio-path when switch does not touch audio ports and circuit lacks active switching", () => {
		// Switch only connects auxiliary LED indicator node 25 to ground node 0
		// No bistable latches and no electronic switching gates
		const sw = device("SW_LED", "switch", [25, 0], ["common", "throw"], "Bypass");
		const led = device("LED", "diode", [25, 99], ["cathode", "anode"]);
		const rCore = device("R_CORE", "resistor", [1, 2], ["a", "b"]);

		const nl = netlist([sw, led, rCore], {
			declared: "switch",
			switch: "SW_LED",
			engagedPosition: 0,
		});

		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("not-in-audio-path");
		}
	});

	it("derives buffered-mechanical when a port reaches the switch only through an active stage", () => {
		// Input jack (1) -> coupling cap -> BJT emitter follower (base 3, collector 9 rail, emitter 4)
		// -> DPDT pole A common (4): throw 10 effect-in / throw 20 bypass wire; pole B common (2) out
		// jack: throw 11 effect-out / throw 20. No latch, no JFET, one BJT: no electronic switching.
		// The bypass wire carries the buffer's output, so the bypass is buffered by the circuit.
		const cIn = device("C_IN", "capacitor", [1, 3], ["a", "b"]);
		const rBias = device("R_BIAS", "resistor", [9, 3], ["a", "b"]);
		const q = device("Q_BUF", "bjt", [9, 3, 4], ["collector", "base", "emitter"]);
		const rE = device("R_E", "resistor", [4, 0], ["a", "b"]);
		const rail = device("V1", "voltage-source", [9, 0], ["positive", "negative"]);
		const swA = device("SW1_A", "switch", [4, 10, 20], ["common", "throw", "throw"], "Bypass");
		const swB = device("SW1_B", "switch", [2, 11, 20], ["common", "throw", "throw"], "Bypass");
		const rCore = device("R_EFFECT", "resistor", [10, 11], ["a", "b"]);
		const nl = netlist([cIn, rBias, q, rE, rail, swA, swB, rCore], {
			declared: "switch",
			switch: "SW1_A",
			engagedPosition: 0,
		});
		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("buffered-mechanical");
			expect(bp.control).toBe("Bypass");
		}
	});

	it("keeps hardwire for the same switch when the input reaches it through passives only", () => {
		// Negative control for the rule above: remove the buffer, tie the input straight to the
		// pole through the coupling cap, and the walk reaches the jack without an active hop.
		const cIn = device("C_IN", "capacitor", [1, 4], ["a", "b"]);
		const rLoad = device("R_LOAD", "resistor", [1, 0], ["a", "b"]);
		const sw = device("SW1", "switch", [2, 11, 4], ["common", "throw", "throw"], "Bypass");
		const rCore = device("R_EFFECT", "resistor", [4, 11], ["a", "b"]);
		const dClip = device("D_CLIP", "diode", [11, 0], ["anode", "cathode"]);
		const nl = netlist([cIn, rLoad, sw, rCore, dClip], {
			declared: "switch",
			switch: "SW1",
			engagedPosition: 0,
		});
		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("hardwire");
		}
	});

	it("walks a series coupling capacitor to a port, so a pole behind an output cap is in the path", () => {
		// Before the capacitor hop this read as not-in-audio-path: the output pole (11) reached the
		// output jack (2) only through C_OUT. Input side is passive and unisolated -> hardwire.
		const sw = device("SW1", "switch", [11, 10, 1], ["common", "throw", "throw"], "Bypass");
		const cOut = device("C_OUT", "capacitor", [11, 2], ["a", "b"]);
		const rCore = device("R_EFFECT", "resistor", [1, 10], ["a", "b"]);
		const dClip = device("D_CLIP", "diode", [10, 0], ["anode", "cathode"]);
		const nl = netlist([sw, cOut, rCore, dClip], {
			declared: "switch",
			switch: "SW1",
			engagedPosition: 0,
		});
		const bp = deriveBypass(nl);
		expect(bp.declared).toBe("switch");
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("hardwire");
		}
	});

	it("still derives not-in-audio-path when no port is reachable even through stages", () => {
		// The LED contact with a buffer elsewhere in the circuit: the stage does not connect the
		// pole to a port, so allowing active hops changes nothing.
		const sw = device("SW_LED", "switch", [25, 0], ["common", "throw"], "Bypass");
		const led = device("LED", "diode", [25, 99], ["cathode", "anode"]);
		const q = device("Q_BUF", "bjt", [9, 1, 2], ["collector", "base", "emitter"]);
		const rail = device("V1", "voltage-source", [9, 0], ["positive", "negative"]);
		const nl = netlist([sw, led, q, rail], {
			declared: "switch",
			switch: "SW_LED",
			engagedPosition: 0,
		});
		const bp = deriveBypass(nl);
		if (bp.declared === "switch") {
			expect(bp.kind).toBe("not-in-audio-path");
		}
	});

	describe("end to end from source: one fixture per derivation rule", () => {
		const cases: readonly (readonly [string, string, ProgramBypassKind])[] = [
			["trueBypassDpdt", trueBypassDpdt, "true-bypass"],
			["hardwireSpdt", hardwireSpdt, "hardwire"],
			["bufferedMechanicalDpdt", bufferedMechanicalDpdt, "buffered-mechanical"],
			["flipFlopBypassLatched", flipFlopBypassLatched, "buffered"],
			["flipFlopBypassJfetGates", flipFlopBypassJfetGates, "buffered"],
			["bypassSwitchIndicatorOnly", bypassSwitchIndicatorOnly, "not-in-audio-path"],
		];
		for (const [name, source, kind] of cases) {
			it(`${name} compiles and derives ${kind} with the declared control`, () => {
				const res = compile(source);
				if (res.status !== "ok") throw new Error(`${name} did not compile: ${JSON.stringify(res.reasons)}`);
				expect(res.program.bypass.declared).toBe("switch");
				if (res.program.bypass.declared === "switch") {
					expect(res.program.bypass.kind).toBe(kind);
					expect(res.program.bypass.control).toBe("Bypass");
				}
			});
		}

		it("the two flip-flop fixtures reach buffered by different rules", () => {
			// The latched one is found by the bistable detector; the gated one is not, so its
			// verdict rests on the JFET-plus-BJTs heuristic. If the heuristic is ever replaced,
			// the second fixture is the one that must move.
			expect(findBistableLatches(readNetlist(flipFlopBypassLatched)).length).toBe(1);
			expect(findBistableLatches(readNetlist(flipFlopBypassJfetGates)).length).toBe(0);
		});
	});

	it("end-to-end compile preserves declared: none without synthetic kind", () => {
		const res = compile(resistorDivider);
		expect(res.status).toBe("ok");
		if (res.status === "ok") {
			expect(res.program.bypass).toEqual({ declared: "none" });
			expect("kind" in res.program.bypass).toBe(false);
		}
	});
});

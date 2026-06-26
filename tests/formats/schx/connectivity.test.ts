import { describe, expect, test } from "bun:test";
import { parseSchx } from "../../../packages/core/src/formats/schx/parser";
import {
	getPinNode,
	resolveConnectivity,
	type Connectivity,
} from "../../../packages/core/src/model/connectivity";
import type { CircuitDocument } from "../../../packages/core/src/model/types";

async function loadFixture(name: string): Promise<CircuitDocument> {
	const url = new URL(`../../fixtures/schx/${name}.schx`, import.meta.url);
	return parseSchx(await Bun.file(url).text());
}

function expectPinsShareNode(
	connectivity: Connectivity,
	pins: ReadonlyArray<[componentId: string, terminalName: string]>,
): number {
	const nodes = pins.map(([id, name]) =>
		getPinNode(connectivity, { componentId: id, terminalName: name }),
	);
	expect(nodes[0]).toBeDefined();
	for (let i = 1; i < nodes.length; i += 1) {
		expect(nodes[i]).toBe(nodes[0]!);
	}
	return nodes[0]!;
}

function expectPinsDisjoint(
	connectivity: Connectivity,
	pins: ReadonlyArray<[componentId: string, terminalName: string]>,
): void {
	const seen = new Set<number>();
	for (const [id, name] of pins) {
		const node = getPinNode(connectivity, {
			componentId: id,
			terminalName: name,
		});
		expect(node).toBeDefined();
		expect(seen.has(node!)).toBe(false);
		seen.add(node!);
	}
}

describe("passive-divider electrical connectivity", () => {
	test("forms exactly three nodes: input, midpoint, ground", async () => {
		const doc = await loadFixture("passive-divider");
		const connectivity = resolveConnectivity(doc);
		expect(connectivity.nodeCount).toBe(3);
		expect(connectivity.groundNodeId).toBe(0);
	});

	test("input rail joins V1.a with R1.b", async () => {
		const doc = await loadFixture("passive-divider");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["V1", "a"],
			["R1", "b"],
		]);
	});

	test("midpoint T-junction joins R1.a, R2.a, O1.a", async () => {
		const doc = await loadFixture("passive-divider");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["R1", "a"],
			["R2", "a"],
			["O1", "a"],
		]);
	});

	test("ground rail joins V1.b, R2.b, O1.b, GND1.t at node 0", async () => {
		const doc = await loadFixture("passive-divider");
		const c = resolveConnectivity(doc);
		const node = expectPinsShareNode(c, [
			["V1", "b"],
			["R2", "b"],
			["O1", "b"],
			["GND1", "t"],
		]);
		expect(node).toBe(0);
	});

	test("the three nodes are pairwise disjoint", async () => {
		const doc = await loadFixture("passive-divider");
		const c = resolveConnectivity(doc);
		expectPinsDisjoint(c, [
			["V1", "a"],
			["R1", "a"],
			["V1", "b"],
		]);
	});
});

describe("passive-lowpass electrical connectivity", () => {
	test("forms three nodes: input, output (R/C midpoint), ground", async () => {
		const doc = await loadFixture("passive-lowpass");
		const c = resolveConnectivity(doc);
		expect(c.nodeCount).toBe(3);
		expect(c.groundNodeId).toBe(0);
	});

	test("ground node groups V1.b, C1.b, GND1.t, and O1.b together", async () => {
		const doc = await loadFixture("passive-lowpass");
		const c = resolveConnectivity(doc);
		const node = expectPinsShareNode(c, [
			["V1", "b"],
			["C1", "b"],
			["GND1", "t"],
			["O1", "b"],
		]);
		expect(node).toBe(0);
	});

	test("RC midpoint joins R1.a, C1.a, O1.a", async () => {
		const doc = await loadFixture("passive-lowpass");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["R1", "a"],
			["C1", "a"],
			["O1", "a"],
		]);
	});
});

describe("lpb-1-style-boost electrical connectivity", () => {
	test("parses with at least 6 distinct nodes", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		expect(c.nodeCount).toBeGreaterThanOrEqual(6);
		expect(c.groundNodeId).toBe(0);
	});

	test("BJT collector, RC.b, and COUT.b share a node (collector load junction)", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["Q1", "collector"],
			["RC", "b"],
			["COUT", "b"],
		]);
	});

	test("BJT base, RB1.b, RB2.a, and CIN.a share a node (input bias junction)", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["Q1", "base"],
			["RB1", "b"],
			["RB2", "a"],
			["CIN", "a"],
		]);
	});

	test("emitter node joins Q1.emitter with RE.a and CE.a (after the catalog fix)", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["Q1", "emitter"],
			["RE", "a"],
			["CE", "a"],
		]);
	});

	test("COUT couples node 4 (collector) → node 7 (output) → Level.a", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["COUT", "a"],
			["Level", "a"],
		]);
	});

	test("Level.wiper drives the speaker via node 8", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["Level", "wiper"],
			["S1", "a"],
		]);
	});

	test("VCC rail joins VCC.t, RC.a, RB1.a", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["VCC", "t"],
			["RC", "a"],
			["RB1", "a"],
		]);
	});

	test("ground rail groups V1.b, GND1.t, RE.b, CE.b, RB2.b, Level.b, S1.b at node 0", async () => {
		const doc = await loadFixture("lpb-1-style-boost");
		const c = resolveConnectivity(doc);
		const node = expectPinsShareNode(c, [
			["V1", "b"],
			["GND1", "t"],
			["RE", "b"],
			["CE", "b"],
			["RB2", "b"],
			["Level", "b"],
			["S1", "b"],
		]);
		expect(node).toBe(0);
	});
});

describe("fulltone-ocd source-faithful connectivity", () => {
	test("clipping cell keeps the M1 shunt plus M2-to-germanium-diode series branch", async () => {
		const doc = await loadFixture("fulltone-ocd");
		const c = resolveConnectivity(doc);

		const clipNode = expectPinsShareNode(c, [
			["R9", "b"],
			["R6", "a"],
			["C1", "b"],
			["M1", "source"],
			["M1", "gate"],
			["M1", "body"],
			["D1", "cathode"],
			["D2", "cathode"],
		]);

		expectPinsShareNode(c, [
			["VREF", "t"],
			["C1", "a"],
			["M1", "drain"],
			["M2", "drain"],
			["M2", "gate"],
			["D1", "anode"],
		]);

		const mosfetDiodeNode = expectPinsShareNode(c, [
			["M2", "source"],
			["M2", "body"],
			["D2", "anode"],
		]);
		expect(mosfetDiodeNode).not.toBe(clipNode);
	});

	test("HP/LP switch parallels R12 across the always-present R10 path", async () => {
		const doc = await loadFixture("fulltone-ocd");
		const c = resolveConnectivity(doc);
		const switchComponent = doc.components.find(
			(component) => component.id === "HP_LP",
		);

		expect(switchComponent?.sourceTypeName).toContain("Circuit.SPDT");
		expect(switchComponent?.terminals.map((terminal) => terminal.name)).toEqual(
			["common", "throw0", "throw1"],
		);

		const toneInput = expectPinsShareNode(c, [
			["C11", "b"],
			["R10", "a"],
			["R12", "a"],
		]);
		const toneOutput = expectPinsShareNode(c, [
			["R10", "b"],
			["HP_LP", "common"],
			["C7", "a"],
			["VOLUME", "a"],
		]);

		expectPinsShareNode(c, [
			["R12", "b"],
			["HP_LP", "throw0"],
		]);
		const unusedThrow = getPinNode(c, {
			componentId: "HP_LP",
			terminalName: "throw1",
		});
		expect(unusedThrow).toBeDefined();
		expect(unusedThrow).not.toBe(toneInput);
		expect(unusedThrow).not.toBe(toneOutput);
		expect(toneInput).not.toBe(toneOutput);
	});

	test("tone and volume controls follow the source output attenuator wiring", async () => {
		const doc = await loadFixture("fulltone-ocd");
		const c = resolveConnectivity(doc);

		expectPinsShareNode(c, [
			["C7", "b"],
			["TONE", "a"],
		]);
		const toneGround = expectPinsShareNode(c, [
			["TONE", "wiper"],
			["TONE", "b"],
			["GND_TONE", "t"],
		]);
		expect(toneGround).toBe(0);

		expectPinsShareNode(c, [
			["VOLUME", "wiper"],
			["OUT", "a"],
		]);
		const outputGround = expectPinsShareNode(c, [
			["VOLUME", "b"],
			["OUT", "b"],
			["GND_VOLUME", "t"],
		]);
		expect(outputGround).toBe(0);
	});
});

describe("tc-electronic-dark-matter source-faithful connectivity", () => {
	test("input and first MC33178 stage are biased from Vref", async () => {
		const doc = await loadFixture("tc-electronic-dark-matter");
		const c = resolveConnectivity(doc);

		expectPinsShareNode(c, [
			["IN", "a"],
			["C1", "a"],
		]);
		const inputGround = expectPinsShareNode(c, [
			["IN", "b"],
			["R1", "b"],
			["GND_IN", "t"],
		]);
		expect(inputGround).toBe(0);
		expectPinsShareNode(c, [
			["C1", "b"],
			["R1", "a"],
			["R2", "a"],
		]);
		expectPinsShareNode(c, [
			["VREF", "t"],
			["R5", "a"],
			["R11", "a"],
			["R18", "a"],
		]);
	});

	test("power section buffers the 10k/10k divider into Vref through IC2B", async () => {
		const doc = await loadFixture("tc-electronic-dark-matter");
		const c = resolveConnectivity(doc);

		expectPinsShareNode(c, [
			["D9", "cathode"],
			["VPOWER", "t"],
			["C23", "a"],
			["C36", "a"],
			["R31", "a"],
		]);
		expectPinsShareNode(c, [
			["R31", "b"],
			["R32", "a"],
			["C24", "a"],
			["IC2B", "vin+"],
		]);
		expectPinsShareNode(c, [
			["IC2B", "vin-"],
			["IC2B", "vout"],
			["VREF", "t"],
			["R5", "a"],
			["R11", "a"],
			["R18", "a"],
		]);
		const powerGround = expectPinsShareNode(c, [
			["PWR", "-"],
			["C23", "b"],
			["C36", "b"],
			["R32", "b"],
			["C24", "b"],
			["GND_PWR", "t"],
		]);
		expect(powerGround).toBe(0);
	});

	test("gain stage drives a four-diode LL4148 clipping bridge", async () => {
		const doc = await loadFixture("tc-electronic-dark-matter");
		const c = resolveConnectivity(doc);

		const clipInput = expectPinsShareNode(c, [
			["GAIN", "wiper"],
			["IC3A", "vin-"],
			["D1", "anode"],
			["D3", "cathode"],
		]);
		const clipOutput = expectPinsShareNode(c, [
			["IC3A", "vout"],
			["D2", "cathode"],
			["D4", "anode"],
			["C11", "a"],
			["R16", "a"],
		]);
		expectPinsShareNode(c, [
			["D1", "cathode"],
			["D2", "anode"],
		]);
		expectPinsShareNode(c, [
			["D3", "anode"],
			["D4", "cathode"],
		]);
		expect(clipInput).not.toBe(clipOutput);
	});

	test("level handoff feeds active bass/treble network and output buffer", async () => {
		const doc = await loadFixture("tc-electronic-dark-matter");
		const c = resolveConnectivity(doc);

		expectPinsShareNode(c, [
			["LEVEL", "wiper"],
			["C13", "a"],
		]);
		expectPinsShareNode(c, [
			["BASS", "wiper"],
			["R23", "a"],
			["C20", "a"],
		]);
		expectPinsShareNode(c, [
			["TREBLE", "wiper"],
			["IC4B", "vin+"],
		]);
		expectPinsShareNode(c, [
			["IC4B", "vout"],
			["C21", "a"],
		]);
		expectPinsShareNode(c, [
			["C21", "b"],
			["R25", "a"],
			["R26", "a"],
		]);
		expectPinsShareNode(c, [
			["R26", "b"],
			["OUT", "a"],
		]);
		const outputGround = expectPinsShareNode(c, [
			["OUT", "b"],
			["R25", "b"],
			["GND_OUT", "t"],
		]);
		expect(outputGround).toBe(0);
	});
});

describe("spdt-bypass-pedal electrical connectivity", () => {
	test("+9V rail joins BAT1.+, VCC.t, RLED.a, RB1.a, RC.a", async () => {
		const doc = await loadFixture("spdt-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["BAT1", "+"],
			["VCC", "t"],
			["RLED", "a"],
			["RB1", "a"],
			["RC", "a"],
		]);
	});

	test("bypass tap shares the input signal between CIN.a and the SPDT bypass throw (SW1.throw1)", async () => {
		const doc = await loadFixture("spdt-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["IN", "a"],
			["CIN", "a"],
			["SW1", "throw1"],
		]);
	});

	test("SPDT effect throw (SW1.throw0) is fed by COUT.b", async () => {
		const doc = await loadFixture("spdt-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["COUT", "b"],
			["SW1", "throw0"],
		]);
	});

	test("SPDT common terminal drives OUT.a", async () => {
		const doc = await loadFixture("spdt-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["SW1", "common"],
			["OUT", "a"],
		]);
	});

	test("LED indicator is always wired between +9V and ground via RLED + LED1", async () => {
		const doc = await loadFixture("spdt-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["RLED", "b"],
			["LED1", "anode"],
		]);
		const cathodeNode = expectPinsShareNode(c, [
			["LED1", "cathode"],
			["GND_LED", "t"],
		]);
		expect(cathodeNode).toBe(0);
	});
});

describe("3pdt-true-bypass-pedal electrical connectivity", () => {
	test("input pole receives IN.a; effect throw routes to CIN.a", async () => {
		const doc = await loadFixture("3pdt-true-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["IN", "a"],
			["SW1", "p1"],
		]);
		expectPinsShareNode(c, [
			["SW1", "t1a"],
			["CIN", "a"],
		]);
	});

	test("output pole drives OUT.a; effect throw is fed by COUT.b", async () => {
		const doc = await loadFixture("3pdt-true-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["SW1", "p2"],
			["OUT", "a"],
		]);
		expectPinsShareNode(c, [
			["SW1", "t2a"],
			["COUT", "b"],
		]);
	});

	test("bypass bridge ties SW1.t1b and SW1.t2b on a single node", async () => {
		const doc = await loadFixture("3pdt-true-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["SW1", "t1b"],
			["SW1", "t2b"],
		]);
	});

	test("LED-pole grounds the LED only via the switch: LED1.cathode → SW1.t3a, SW1.p3 → GND bus", async () => {
		const doc = await loadFixture("3pdt-true-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["LED1", "cathode"],
			["SW1", "t3a"],
		]);
		const poleNode = expectPinsShareNode(c, [
			["SW1", "p3"],
			["GND_OUT", "t"],
		]);
		expect(poleNode).toBe(0);
	});

	test("SW1.t3b stays floating (not on the ground node)", async () => {
		const doc = await loadFixture("3pdt-true-bypass-pedal");
		const c = resolveConnectivity(doc);
		const floatingNode = getPinNode(c, {
			componentId: "SW1",
			terminalName: "t3b",
		});
		expect(floatingNode).toBeDefined();
		expect(floatingNode).not.toBe(0);
	});

	test("+9V rail joins BAT1.+, VCC.t, RLED.a, RB1.a, RC.a", async () => {
		const doc = await loadFixture("3pdt-true-bypass-pedal");
		const c = resolveConnectivity(doc);
		expectPinsShareNode(c, [
			["BAT1", "+"],
			["VCC", "t"],
			["RLED", "a"],
			["RB1", "a"],
			["RC", "a"],
		]);
	});
});

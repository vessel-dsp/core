// An op-amp powered from a node a zener clamps to ground: the node's voltage is the zener's, so the op-amp's
// rails are too, and an op-amp whose supply terminal sits on a node nothing states a voltage for is named
// (`opamp-supply-undeclared`) instead of silently swinging the whole circuit supply. No corpus packet is
// asserted for membership: the circuit is built here, the part fictional (`FIXTURE-ZENER-*`), so the
// contract is tested against a registry the test owns, with a control in both directions.

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import { emptyRegistry } from "../src/registry";
import type { PartRegistry } from "../src/registry";
import type { Program, Stamp } from "../src/types";

const FIXTURE_VZ = 6.2;

const registry: PartRegistry = {
	entries: [
		{
			partIds: ["FIXTURE-ZENER-6V2"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "law",
				law: {
					kind: "diode",
					saturationCurrent: 1e-9,
					emissionCoefficient: 1.75,
					thermalVoltage: 0.025852,
					breakdownVolts: FIXTURE_VZ,
					seriesResistance: 2,
				},
			},
		},
	],
};

type Options = {
	/** The raw supply, volts. */
	readonly rawVolts?: number;
	/** The first diode's `BreakdownVoltage` property, or absent. */
	readonly breakdown?: string;
	/** The first diode's `PartNumber`, or absent. */
	readonly partNumber?: string;
	/** Put the diode's cathode on ground and its anode on the supply node instead. */
	readonly reversed?: boolean;
	/** A second zener on the supply node, with this `BreakdownVoltage`. */
	readonly secondBreakdown?: string;
	/** A voltage source the document itself places on the supply node, volts. */
	readonly declaredVolts?: number;
};

const SUPPLY_NODE = 20;

const resistor = (id: string, a: number, b: number, ohms: number) => `  - id: ${id}
    kind: resistor
    name: ${id}
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: ${a}
        position:
          x: 0
          y: -20
      - name: b
        node: ${b}
        position:
          x: 0
          y: 20
    properties:
      Resistance: "${ohms}"
`;

const diode = (id: string, anode: number, cathode: number, properties: readonly string[]) => `  - id: ${id}
    kind: diode
    name: ${id}
    sourceTypeName: Circuit.Diode
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        role: anode
        node: ${anode}
        position:
          x: 0
          y: -20
      - name: cathode
        role: cathode
        node: ${cathode}
        position:
          x: 0
          y: 20
    properties:
${properties.join("\n")}
`;

const source = (volts: number, id: string, plus: number) => `  - id: ${id}
    kind: voltage-source
    name: ${id}
    sourceTypeName: Circuit.VoltageSource
    origin:
      x: 0
      y: -200
    rotation: 0
    flipped: false
    terminals:
      - name: plus
        role: positive
        node: ${plus}
        position:
          x: 0
          y: -200
      - name: minus
        role: negative
        node: 0
        position:
          x: 0
          y: -180
    properties:
      Voltage: "${volts}"
`;

/** A unity-gain follower whose positive supply terminal is on `SUPPLY_NODE`, fed from the raw supply through 1k. */
function stage(options: Options = {}): string {
	const first = [
		...(options.partNumber === undefined ? [] : [`      PartNumber: ${JSON.stringify(options.partNumber)}`]),
		...(options.breakdown === undefined ? [] : [`      BreakdownVoltage: ${JSON.stringify(options.breakdown)}`]),
		'      Description: "The clamp."',
	];
	const anode = options.reversed === true ? SUPPLY_NODE : 0;
	const cathode = options.reversed === true ? 0 : SUPPLY_NODE;
	return `schema: circuit-interchange/v3
metadata:
  name: "Zener-fed follower"
  description: "A unity follower on a zener-clamped supply node."
  partNumber: ""
source:
  format: vdsp
  filename: fixture.vdsp
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
    properties:
      Description: "Stage input."
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
    properties:
      Description: "Stage output."
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: 100
    properties:
      Description: "Ground."
${resistor("R1", 9, SUPPLY_NODE, 1000)}${diode("D1", anode, cathode, first)}${
		options.secondBreakdown === undefined
			? ""
			: diode("D2", 0, SUPPLY_NODE, [`      BreakdownVoltage: ${JSON.stringify(options.secondBreakdown)}`])
	}${options.declaredVolts === undefined ? "" : source(options.declaredVolts, "V3", SUPPLY_NODE)}  - id: U1
    kind: opamp
    name: U1
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 60
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: noninverting
        role: nonInverting
        node: 1
        position:
          x: 40
          y: 10
      - name: inverting
        role: inverting
        node: 2
        position:
          x: 40
          y: -10
      - name: output
        role: output
        node: 2
        position:
          x: 80
          y: 0
      - name: vcc
        role: vcc
        node: ${SUPPLY_NODE}
        position:
          x: 60
          y: -30
      - name: vee
        role: vee
        node: 0
        position:
          x: 60
          y: 30
    properties:
      Description: "Unity follower."
${source(options.rawVolts ?? 9, "V1", 9)}wires: []
`;
}

function opampStamps(program: Program): Array<Extract<Stamp, { kind: "ideal-opamp" }>> {
	return program.blocks.flatMap((block) =>
		block.kind === "mna"
			? block.stamps.filter((s): s is Extract<Stamp, { kind: "ideal-opamp" }> => s.kind === "ideal-opamp")
			: [],
	);
}

function build(text: string, reg: PartRegistry = emptyRegistry) {
	const result = compile(text, { registry: reg });
	if (result.status !== "ok") throw new Error(`stage did not compile: ${result.status}`);
	const stamps = opampStamps(result.program);
	expect(stamps).toHaveLength(1);
	const named = result.warnings.filter((w) => w.code === "opamp-supply-undeclared");
	return {
		railLow: stamps[0]?.railLow ?? null,
		railHigh: stamps[0]?.railHigh ?? null,
		named,
	};
}

describe("a node a zener clamps to ground is that zener's voltage for the op-amp powered from it", () => {
	it("gives the op-amp the zener's typed breakdown as its positive rail, and names nothing", () => {
		const { railLow, railHigh, named } = build(stage({ breakdown: "5.1" }));
		expect([railLow, railHigh]).toEqual([0, 5.1]);
		expect(named).toEqual([]);
	});

	it("reads the breakdown from the registry entry of the exact part when the document states none", () => {
		const { railLow, railHigh, named } = build(stage({ partNumber: "FIXTURE-ZENER-6V2" }), registry);
		expect([railLow, railHigh]).toEqual([0, FIXTURE_VZ]);
		expect(named).toEqual([]);
	});

	it("lets a document's own typed breakdown win over the registry's", () => {
		const { railHigh } = build(stage({ partNumber: "FIXTURE-ZENER-6V2", breakdown: "5.1" }), registry);
		expect(railHigh).toBe(5.1);
	});
});

describe("the derivation is typed evidence only, and every control that breaks it leaves the old behaviour", () => {
	it("control: with no zener the supply terminal states nothing, the op-amp keeps the circuit-wide supply, and it is named", () => {
		const { railLow, railHigh, named } = build(stage());
		expect([railLow, railHigh]).toEqual([0, 9]);
		expect(named).toHaveLength(1);
		expect(named[0]?.items).toEqual([{ device: "U1", side: "high", node: SUPPLY_NODE }]);
		expect(named[0]?.devices).toEqual(["U1"]);
	});

	it("keeps the document's last word: a voltage the document places on the node is not overridden by the zener", () => {
		const { railHigh, named } = build(stage({ breakdown: "5.1", declaredVolts: 7 }));
		expect(railHigh).toBe(7);
		expect(named).toEqual([]);
	});

	it("derives nothing from a zener whose anode is not on the 0 V reference", () => {
		const { railHigh, named } = build(stage({ breakdown: "5.1", reversed: true }));
		expect(railHigh).toBe(9);
		expect(named).toHaveLength(1);
	});

	it("derives nothing when two zeners sit on one node: which one rules is not answered", () => {
		const { railHigh, named } = build(stage({ breakdown: "5.1", secondBreakdown: "6.8" }));
		expect(railHigh).toBe(9);
		expect(named).toHaveLength(1);
	});

	it("derives nothing when no declared voltage exceeds the breakdown, so the clamp never conducts", () => {
		const { railHigh, named } = build(stage({ breakdown: "5.1", rawVolts: 4 }));
		expect(railHigh).toBe(4);
		expect(named).toHaveLength(1);
	});

	it("derives nothing from a diode that states no breakdown", () => {
		const { railHigh, named } = build(stage({ breakdown: undefined }));
		expect(railHigh).toBe(9);
		expect(named).toHaveLength(1);
	});
});

import { describe, expect, it } from "bun:test";
import { attachDeviceLaws } from "../src/device-laws";
import { readNetlist } from "../src/netlist";
import type { PartRegistry } from "../src/registry";

/**
 * A registered part may carry a node inside its package: a bias-resistor built-in transistor's
 * base, behind its series resistor. A section terminal index past the part's own pins names that
 * node, and it must be fresh -- reachable by no pin of the document -- and shared by every section
 * that names it.
 */

const source = `schema: circuit-interchange/v2
metadata:
  name: "BRT shell"
  description: "One digital transistor."
  partNumber: ""
source:
  format: interchange
  filename: brt.vdsp
components:
  - id: JIN
    kind: jack
    name: JIN
    sourceTypeName: Circuit.Input
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: signal
        node: 2
        position:
          x: 0
          y: 0
  - id: JOUT
    kind: jack
    name: JOUT
    sourceTypeName: Circuit.Output
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        role: signal
        node: 1
        position:
          x: 0
          y: 0
  - id: Q1
    kind: bjt
    name: Q1
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "TEST-BRT"
    terminals:
      - name: collector
        role: collector
        node: 1
        position:
          x: 0
          y: 0
      - name: base
        role: base
        node: 2
        position:
          x: 0
          y: 0
      - name: emitter
        role: emitter
        node: 0
        position:
          x: 0
          y: 0
wires: []
`;

const registry: PartRegistry = {
	entries: [
		{
			partIds: ["TEST-BRT"],
			declaredTypes: [],
			terminalRoleGroups: [["base"], ["collector"], ["emitter"]],
			model: {
				kind: "sections",
				pinout: ["base", "collector", "emitter"],
				sections: [
					{
						law: {
							kind: "bjt",
							polarity: "npn",
							saturationCurrent: 1e-14,
							forwardBeta: 100,
							reverseBeta: 1,
							thermalVoltage: 0.025852,
							leakageAmps: 0,
						},
						terminals: [3, 1, 2],
					},
					{ law: { kind: "conductance", siemens: 1e-4 }, terminals: [0, 3] },
					{ law: { kind: "conductance", siemens: 1 / 47000 }, terminals: [3, 2] },
				],
			},
		},
	],
};

describe("a registered part with a node inside its package", () => {
	it("expands around one fresh node every section shares", () => {
		const lawed = attachDeviceLaws(readNetlist(source), registry);
		const sections = lawed.netlist.devices.filter((device) => device.id.startsWith("Q1#"));
		expect(sections.map((device) => device.id)).toEqual(["Q1#0", "Q1#1", "Q1#2"]);
		const [transistor, series, shunt] = sections;
		const internal = transistor!.nodes[0]!;
		expect([1, 2, 0]).not.toContain(internal);
		expect(series!.nodes).toEqual([2, internal]);
		expect(shunt!.nodes).toEqual([internal, 0]);
		expect(transistor!.nodes.slice(1)).toEqual([1, 0]);
		expect(lawed.netlist.nodes).toContain(internal);
	});

	it("leaves a BJT with no sections entry on its class law", () => {
		const lawed = attachDeviceLaws(readNetlist(source.replace("TEST-BRT", "2SC1815")), registry);
		expect(lawed.netlist.devices.filter((device) => device.id.startsWith("Q1")).map((device) => device.id)).toEqual(["Q1"]);
	});
});

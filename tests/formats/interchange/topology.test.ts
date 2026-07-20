import { describe, expect, test } from "bun:test";
import {
	getPinNode,
	parseInterchangeYamlWithTopology,
	parseVdspCircuitDocumentWithTopology,
} from "../../../packages/core/src";

const declaredSource = `schema: circuit-interchange/v2
metadata:
  name: Declared topology
  description: ""
  partNumber: ""
source:
  format: interchange
components:
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        position:
          x: 0
          y: 0
      - name: b
        position:
          x: 20
          y: 0
    properties:
      Resistance: 10k
  - id: GND
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 20
      y: 20
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        position:
          x: 20
          y: 0
    properties: {}
nodes:
  - id: 0
    role: ground
    members:
      - componentId: R1
        terminalName: b
      - componentId: GND
        terminalName: terminal
  - id: 7
    role: signal
    members:
      - { componentId: R1, terminalName: a }
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;

describe("parseInterchangeYamlWithTopology", () => {
	test("returns declared connectivity and node roles without changing CircuitDocument", () => {
		const parsed = parseInterchangeYamlWithTopology(declaredSource);
		expect(parsed.connectivitySource).toBe("declared");
		expect(parsed.document.components).toHaveLength(2);
		expect(parsed.nodeRoles.get(0)).toBe("ground");
		expect(parsed.nodeRoles.get(7)).toBe("signal");
		expect(
			getPinNode(parsed.connectivity, {
				componentId: "R1",
				terminalName: "a",
			}),
		).toBe(7);
		expect(parsed.connectivity.groundNodeId).toBe(0);
	});

	test("is exposed through the VDSP convenience API", () => {
		expect(
			parseVdspCircuitDocumentWithTopology(declaredSource).connectivitySource,
		).toBe("declared");
	});

	test("prefers terminal-owned node declarations when node members are absent", () => {
		const terminalOwned = declaredSource
			.replace("      - name: a\n", "      - name: a\n        node: 7\n")
			.replace("      - name: b\n", "      - name: b\n        node: 0\n")
			.replace(
				"      - name: terminal\n",
				"      - name: terminal\n        node: 0\n",
			)
			.replace(/nodes:\n[\s\S]*?wires: \[\]/, "nodes: []\nwires: []");
		const parsed = parseInterchangeYamlWithTopology(terminalOwned);
		expect(parsed.connectivitySource).toBe("declared");
		expect(
			getPinNode(parsed.connectivity, {
				componentId: "R1",
				terminalName: "a",
			}),
		).toBe(7);
		expect(parsed.connectivity.groundNodeId).toBe(0);
	});

	test("rejects duplicate declared pin ownership", () => {
		const duplicate = declaredSource.replace(
			"      - { componentId: R1, terminalName: a }",
			"      - { componentId: R1, terminalName: b }",
		);
		expect(() => parseInterchangeYamlWithTopology(duplicate)).toThrow(
			"already belongs to node 0",
		);
	});

	test("falls back to geometric connectivity when declared nodes are absent", () => {
		const parsed = parseInterchangeYamlWithTopology(
			declaredSource.replace(
				/nodes:\n[\s\S]*?wires: \[\]/,
				"nodes: []\nwires: []",
			),
		);
		expect(parsed.connectivitySource).toBe("geometric");
		expect(parsed.connectivity.groundNodeId).toBe(0);
		expect(parsed.nodeRoles.get(0)).toBe("ground");
	});
});

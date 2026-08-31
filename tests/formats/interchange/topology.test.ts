import { describe, expect, test } from "bun:test";
import {
	INTERCHANGE_CONTRACT_VERSION,
	getPinNode,
	parseInterchangeYamlWithTopology,
	parseVdspCircuitDocumentWithTopology,
	serializeInterchangeYaml,
	serializeVdspCircuitDocument,
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

	test("merges inline terminal nodes with node-ledger members", () => {
		const mixed = declaredSource
			.replace("      - name: a\n", "      - name: a\n        node: 7\n")
			.replace(
				`  - id: 7
    role: signal
    members:
      - { componentId: R1, terminalName: a }
`,
				`  - id: 7
    role: signal
`,
			);
		const parsed = parseInterchangeYamlWithTopology(mixed);
		expect(parsed.connectivitySource).toBe("declared");
		expect(
			getPinNode(parsed.connectivity, { componentId: "R1", terminalName: "a" }),
		).toBe(7);
		expect(
			getPinNode(parsed.connectivity, { componentId: "R1", terminalName: "b" }),
		).toBe(0);
		expect(
			getPinNode(parsed.connectivity, {
				componentId: "GND",
				terminalName: "terminal",
			}),
		).toBe(0);
		expect(parsed.connectivity.nodeMembers.get(0)).toHaveLength(2);
		expect(parsed.connectivity.nodeMembers.get(7)).toHaveLength(1);
		expect(parsed.connectivity.groundNodeId).toBe(0);
	});

	test("accepts redundant agreement between inline nodes and the ledger", () => {
		const agreeing = declaredSource
			.replace("      - name: a\n", "      - name: a\n        node: 7\n")
			.replace("      - name: b\n", "      - name: b\n        node: 0\n")
			.replace(
				"      - name: terminal\n",
				"      - name: terminal\n        node: 0\n",
			);
		const parsed = parseInterchangeYamlWithTopology(agreeing);
		expect(parsed.connectivitySource).toBe("declared");
		expect(parsed.connectivity.nodeMembers.get(0)).toHaveLength(2);
		expect(parsed.connectivity.nodeMembers.get(7)).toHaveLength(1);
		expect(parsed.connectivity.nodeCount).toBe(2);
	});

	test("rejects conflict between an inline terminal node and the ledger", () => {
		const conflicting = declaredSource.replace(
			"      - name: a\n",
			"      - name: a\n        node: 0\n",
		);
		expect(() => parseInterchangeYamlWithTopology(conflicting)).toThrow(
			"already belongs to node 0",
		);
	});

	test("keeps declared pin grouping when serialized output is parsed again", () => {
		// The serializer writes both an inline `node` per terminal and a `nodes`
		// ledger, so its own output is a mixed packet.
		const parsed = parseInterchangeYamlWithTopology(declaredSource);
		const reparsed = parseInterchangeYamlWithTopology(
			serializeInterchangeYaml(parsed.document),
		);
		expect(reparsed.connectivitySource).toBe("declared");
		const groundNode = getPinNode(reparsed.connectivity, {
			componentId: "GND",
			terminalName: "terminal",
		});
		expect(groundNode).toBeDefined();
		expect(
			getPinNode(reparsed.connectivity, {
				componentId: "R1",
				terminalName: "b",
			}),
		).toBe(groundNode);
		expect(
			getPinNode(reparsed.connectivity, {
				componentId: "R1",
				terminalName: "a",
			}),
		).not.toBe(groundNode);
		expect(reparsed.connectivity.groundNodeId).toBe(groundNode ?? null);
	});

	test("preserves declared node ids and role tokens when re-serialized with topology", () => {
		const supplySource = declaredSource.replace(
			"  - id: 7\n    role: signal\n",
			"  - id: 7\n    role: supply\n",
		);
		const parsed = parseInterchangeYamlWithTopology(supplySource);
		expect(parsed.nodeRoles.get(7)).toBe("supply");

		const yaml = serializeInterchangeYaml(parsed.document, {
			connectivity: parsed.connectivity,
			nodeRoles: parsed.nodeRoles,
		});
		const reparsed = parseInterchangeYamlWithTopology(yaml);
		expect(reparsed.connectivitySource).toBe("declared");
		expect(
			getPinNode(reparsed.connectivity, {
				componentId: "R1",
				terminalName: "a",
			}),
		).toBe(7);
		expect(reparsed.nodeRoles.get(7)).toBe("supply");
		expect(reparsed.nodeRoles.get(0)).toBe("ground");
		expect(reparsed.connectivity.groundNodeId).toBe(0);
	});

	test("renumbers declared node ids when topology is not passed back in", () => {
		// Geometric resolution is the documented fallback, not a bug: without the
		// declared connectivity the serializer has only terminal positions to go on.
		const parsed = parseInterchangeYamlWithTopology(declaredSource);
		const reparsed = parseInterchangeYamlWithTopology(
			serializeInterchangeYaml(parsed.document),
		);
		expect(
			getPinNode(reparsed.connectivity, {
				componentId: "R1",
				terminalName: "a",
			}),
		).not.toBe(7);
	});

	test("round-trips declared topology through the .vdsp convenience API", () => {
		const parsed = parseVdspCircuitDocumentWithTopology(declaredSource);
		const reparsed = parseVdspCircuitDocumentWithTopology(
			serializeVdspCircuitDocument(parsed.document, {
				connectivity: parsed.connectivity,
				nodeRoles: parsed.nodeRoles,
			}),
		);
		expect(
			getPinNode(reparsed.connectivity, {
				componentId: "R1",
				terminalName: "a",
			}),
		).toBe(7);
		expect(reparsed.connectivity.groundNodeId).toBe(0);
	});

	test("exposes a parse-contract version consumers can gate on", () => {
		expect(INTERCHANGE_CONTRACT_VERSION).toBe(1);
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

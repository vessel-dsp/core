import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	classifyPotentiometerTerminalRole,
	parseCircuitDocumentFile,
	parseInterchangeYaml,
	resolveDocumentPotentiometerTerminalRoles,
	resolvePotentiometerTerminalRoles,
} from "../../packages/core/src";
import type { Component } from "../../packages/core/src";

function pot(id: string, terminalNames: readonly string[]): Component {
	return {
		id,
		kind: "potentiometer",
		name: id,
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: terminalNames.map((name, index) => ({
			name,
			position: { x: index * 10, y: 0 },
		})),
		properties: {},
		sourceTypeName: "Circuit.Potentiometer",
	};
}

describe("classifyPotentiometerTerminalRole", () => {
	test("accepts canonical rotation tokens", () => {
		expect(classifyPotentiometerTerminalRole("cw")).toEqual({
			status: "canonical",
			role: "cw",
		});
		expect(classifyPotentiometerTerminalRole("CCW")).toEqual({
			status: "canonical",
			role: "ccw",
		});
		expect(classifyPotentiometerTerminalRole("wiper")).toEqual({
			status: "canonical",
			role: "wiper",
		});
	});

	test("normalizes lug numbers and spelling variants", () => {
		expect(classifyPotentiometerTerminalRole("1")).toEqual({
			status: "alias",
			role: "ccw",
		});
		expect(classifyPotentiometerTerminalRole("lug 2")).toEqual({
			status: "alias",
			role: "wiper",
		});
		expect(classifyPotentiometerTerminalRole("Pin_3")).toEqual({
			status: "alias",
			role: "cw",
		});
		expect(classifyPotentiometerTerminalRole("counter-clockwise")).toEqual({
			status: "alias",
			role: "ccw",
		});
		expect(classifyPotentiometerTerminalRole("slider")).toEqual({
			status: "alias",
			role: "wiper",
		});
	});

	test("refuses tokens that name an end without its rotation", () => {
		expect(classifyPotentiometerTerminalRole("a")).toEqual({
			status: "ambiguous",
		});
		expect(classifyPotentiometerTerminalRole("b")).toEqual({
			status: "ambiguous",
		});
		expect(classifyPotentiometerTerminalRole("left")).toEqual({
			status: "ambiguous",
		});
	});

	test("reports anything else as unrecognized", () => {
		expect(classifyPotentiometerTerminalRole("banana")).toEqual({
			status: "unrecognized",
		});
	});
});

describe("resolvePotentiometerTerminalRoles", () => {
	test("resolves lug numbers to a complete assignment with no diagnostics", () => {
		const resolved = resolvePotentiometerTerminalRoles(pot("VR1", ["1", "2", "3"]));
		expect(resolved).not.toBeNull();
		expect(resolved?.complete).toBe(true);
		expect(resolved?.diagnostics).toEqual([]);
		expect(resolved?.terminals.get("ccw")).toBe("1");
		expect(resolved?.terminals.get("wiper")).toBe("2");
		expect(resolved?.terminals.get("cw")).toBe("3");
	});

	test("keeps the raw token as the key so nothing is rewritten", () => {
		const resolved = resolvePotentiometerTerminalRoles(
			pot("VR1", ["Counter-Clockwise", "Slider", "CW"]),
		);
		expect([...(resolved?.roles ?? [])]).toEqual([
			["Counter-Clockwise", "ccw"],
			["Slider", "wiper"],
			["CW", "cw"],
		]);
	});

	test("refuses to complete an assignment from positional end names", () => {
		const resolved = resolvePotentiometerTerminalRoles(
			pot("VR1", ["a", "wiper", "b"]),
		);
		expect(resolved?.complete).toBe(false);
		expect(resolved?.terminals.get("wiper")).toBe("wiper");
		expect(resolved?.terminals.has("cw")).toBe(false);
		expect(resolved?.terminals.has("ccw")).toBe(false);
		expect(resolved?.diagnostics.map((d) => d.code)).toEqual([
			"potentiometer-terminal-role-ambiguous",
			"potentiometer-terminal-role-ambiguous",
		]);
	});

	test("drops duplicate claims rather than ordering them arbitrarily", () => {
		const resolved = resolvePotentiometerTerminalRoles(
			pot("VR1", ["cw", "3", "wiper"]),
		);
		expect(resolved?.complete).toBe(false);
		expect(resolved?.terminals.has("cw")).toBe(false);
		expect(resolved?.roles.has("cw")).toBe(false);
		expect(resolved?.roles.has("3")).toBe(false);
		expect(resolved?.diagnostics.map((d) => d.code)).toContain(
			"potentiometer-terminal-role-duplicate",
		);
	});

	test("returns null for components with no rotational ends", () => {
		expect(
			resolvePotentiometerTerminalRoles({
				...pot("R1", ["a", "b"]),
				kind: "resistor",
			}),
		).toBeNull();
	});
});

describe("vdsp intake", () => {
	const source = `schema: circuit-interchange/v2
metadata:
  name: Pot roles
  description: ""
  partNumber: ""
source:
  format: interchange
components:
  - id: VR1
    kind: potentiometer
    name: VR1
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: TERMINAL_A
        position:
          x: 0
          y: 0
      - name: wiper
        position:
          x: 10
          y: 0
      - name: TERMINAL_B
        position:
          x: 20
          y: 0
    properties: {}
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;

	test("warns about under-specified pot ends without rewriting them", () => {
		const document = parseInterchangeYaml(
			source
				.replace("TERMINAL_A", "a")
				.replace("TERMINAL_B", "b"),
		);
		const codes = document.warnings.map((warning) => warning.code);
		expect(codes.filter((c) => c === "potentiometer-terminal-role-ambiguous"))
			.toHaveLength(2);
		expect(document.components[0]?.terminals.map((t) => t.name)).toEqual([
			"a",
			"wiper",
			"b",
		]);
	});

	test("stays silent when lug numbers carry the answer", () => {
		const document = parseInterchangeYaml(
			source.replace("TERMINAL_A", '"1"').replace("TERMINAL_B", '"3"'),
		);
		expect(
			document.warnings.filter((warning) =>
				warning.code.startsWith("potentiometer-terminal-role"),
			),
		).toEqual([]);
	});
});

describe("fixture corpus", () => {
	const fixture = "vdsp-v3-mechanical-board-realization.vdsp";

	test("resolves the .vdsp lug-numbered pots completely", () => {
		const document = parseCircuitDocumentFile(
			readFileSync(`tests/fixtures/interchange/${fixture}`, "utf8"),
			{ filename: fixture },
		);
		const resolved = resolveDocumentPotentiometerTerminalRoles(document);
		expect(resolved.length).toBeGreaterThan(0);
		for (const resolution of resolved) {
			expect(resolution.complete).toBe(true);
			expect(resolution.diagnostics).toEqual([]);
		}
	});
});

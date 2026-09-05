import { describe, expect, it } from "bun:test";
import {
	isLegalTerminalRole,
	terminalRolesFor,
} from "../../packages/core/src/model/device-terminal-roles";
import {
	componentDevices,
	deviceTerminalRoles,
	parseVdspCircuitDocument,
	serializeVdspCircuitDocument,
	validateComponentDevices,
} from "../../packages/core/src";

/** A hex inverter package declaring two of its six gates as devices. */
const document = (kind: string): string =>
	`schema: circuit-interchange/v3
metadata:
  name: Inverter Kind
components:
  - id: U1
    kind: ${kind}
    name: U1
    sourceTypeName: Circuit.IC
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    devices:
      - id: G1
        kind: inverter
        terminals:
          - in1
          - out1
          - vdd
          - vss
      - id: G2
        kind: inverter
        terminals:
          - in2
          - out2
          - vdd
          - vss
    terminals:
      - name: in1
        role: input
        node: 1
        position:
          x: -10
          y: 0
      - name: out1
        role: output
        node: 2
        position:
          x: 10
          y: 0
      - name: in2
        role: input
        node: 3
        position:
          x: -10
          y: 10
      - name: out2
        role: output
        node: 4
        position:
          x: 10
          y: 10
      - name: vdd
        role: supplyPositive
        node: 5
        position:
          x: 0
          y: -10
      - name: vss
        role: supplyNegative
        node: 0
        position:
          x: 0
          y: 20
`;

describe("the inverter component kind", () => {
	it("carries input, output and the supply pair", () => {
		const roles = terminalRolesFor("inverter");
		expect(roles).toContain("input");
		expect(roles).toContain("output");
		expect(roles).toContain("supplyPositive");
		expect(roles).toContain("supplyNegative");
	});

	it("admits `input` as a legal role, which no kind could carry before", () => {
		expect(isLegalTerminalRole("inverter", "input")).toBe(true);
	});

	// **Negative control.** A role list that accepts anything proves nothing, so this asserts a
	// role the kind must *not* carry: a gate has no differential pair, and naming one leg
	// `inverting` would say it does.
	it("refuses a differential-pair role, because a gate has no pair", () => {
		expect(isLegalTerminalRole("inverter", "inverting")).toBe(false);
		expect(isLegalTerminalRole("inverter", "nonInverting")).toBe(false);
	});

	// **Negative control.** `input` must be legal *because the kind lists it*, not because the
	// role vocabulary grew a value every kind accepts.
	it("does not leak `input` into a kind that has no such pin", () => {
		expect(isLegalTerminalRole("resistor", "input")).toBe(false);
		expect(isLegalTerminalRole("opamp", "input")).toBe(false);
	});

	it("parses, and survives a serialize/parse round trip", () => {
		const parsed = parseVdspCircuitDocument(document("ic"));
		const again = parseVdspCircuitDocument(
			serializeVdspCircuitDocument(parsed),
		);
		const component = again.components[0];
		expect(component?.terminals.map((t) => t.role)).toEqual([
			"input",
			"output",
			"input",
			"output",
			"supplyPositive",
			"supplyNegative",
		]);
	});

	it("splits a package into gates, each with an unambiguous input", () => {
		const component = parseVdspCircuitDocument(document("ic")).components[0];
		if (component === undefined) throw new Error("no component");
		expect(validateComponentDevices(component)).toEqual([]);
		const devices = componentDevices(component);
		expect(devices.map((d) => d.id)).toEqual(["G1", "G2"]);
		// The whole point: two `input` roles across the package, one inside each gate.
		for (const device of devices) {
			const roles = [...deviceTerminalRoles(component, device).values()];
			expect(roles.filter((r) => r === "input")).toHaveLength(1);
			expect(roles.filter((r) => r === "output")).toHaveLength(1);
		}
	});

	it("is accepted as a component kind in its own right", () => {
		const parsed = parseVdspCircuitDocument(document("inverter"));
		expect(parsed.components[0]?.kind).toBe("inverter");
	});
});

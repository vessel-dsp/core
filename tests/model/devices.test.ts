import { describe, expect, it } from "bun:test";
import {
	componentDevices,
	deviceTerminalRoles,
	validateComponentDevices,
} from "../../packages/core/src/model/devices";
import type { Component } from "../../packages/core/src/model/types";

const at = { x: 0, y: 0 };
const component = (over: Partial<Component>): Component => ({
	id: "U1",
	kind: "opamp",
	name: "U1",
	origin: at,
	rotation: 0,
	flipped: false,
	terminals: [],
	properties: {},
	sourceTypeName: null,
	...over,
});

const term = (name: string, role?: string) => ({
	name,
	position: at,
	...(role === undefined ? {} : { role }),
});

describe("component devices", () => {
	it("treats a component with no device list as exactly one device", () => {
		// The default, and the shape of nearly every component. A caller never branches on
		// whether the list was written down.
		const r = component({
			id: "R1",
			kind: "resistor",
			terminals: [term("a", "end"), term("b", "end")],
		});
		expect(componentDevices(r)).toEqual([
			{ id: "R1", kind: "resistor", terminals: ["a", "b"] },
		]);
	});

	it("resolves each declared device, defaulting kind to the component's", () => {
		const v = component({
			id: "V3",
			kind: "tube-diode",
			terminals: [term("plate_a", "plate"), term("plate_b", "plate"), term("cathode", "cathode")],
			devices: [
				{ id: "A", terminals: ["plate_a", "cathode"] },
				{ id: "B", terminals: ["plate_b", "cathode"] },
			],
		});
		expect(componentDevices(v)).toEqual([
			{ id: "A", kind: "tube-diode", terminals: ["plate_a", "cathode"] },
			{ id: "B", kind: "tube-diode", terminals: ["plate_b", "cathode"] },
		]);
	});

	it("lets one package hold devices of different kinds", () => {
		// An optocoupler is why `kind` is declarable per device.
		const pc = component({
			id: "PC1",
			kind: "optocoupler",
			terminals: [term("anode", "anode"), term("cathode", "cathode"), term("ldr_a", "end"), term("ldr_b", "end")],
			devices: [
				{ id: "LED", kind: "led", terminals: ["anode", "cathode"] },
				{ id: "LDR", kind: "variable-resistor", terminals: ["ldr_a", "ldr_b"] },
			],
		});
		expect(componentDevices(pc).map((d) => d.kind)).toEqual(["led", "variable-resistor"]);
	});

	it("resolves the dual op-amp that roles alone cannot split", () => {
		// The `boss-dm-3` defect: two of every signal role across the package, and nothing in the
		// roles saying which output belongs with which input pair. Inside a device it is
		// unambiguous, which is the whole point of the construct.
		const ic = component({
			id: "IC1",
			terminals: [
				term("out_a", "output"),
				term("in_a_neg", "inverting"),
				term("in_a_pos", "nonInverting"),
				term("v_neg", "supplyNegative"),
				term("in_b_pos", "nonInverting"),
				term("in_b_neg", "inverting"),
				term("out_b", "output"),
				term("v_pos", "supplyPositive"),
			],
			devices: [
				{ id: "A", terminals: ["out_a", "in_a_neg", "in_a_pos", "v_pos", "v_neg"] },
				{ id: "B", terminals: ["out_b", "in_b_neg", "in_b_pos", "v_pos", "v_neg"] },
			],
		});
		const [a, b] = componentDevices(ic);
		const rolesA = deviceTerminalRoles(ic, a!);
		const rolesB = deviceTerminalRoles(ic, b!);
		// Exactly one of each signal role per device.
		for (const roles of [rolesA, rolesB]) {
			const counts = [...roles.values()].filter((r) => r === "output").length;
			expect(counts).toBe(1);
			expect([...roles.values()].filter((r) => r === "inverting").length).toBe(1);
			expect([...roles.values()].filter((r) => r === "nonInverting").length).toBe(1);
		}
		expect(rolesA.get("out_a")).toBe("output");
		expect(rolesB.get("out_b")).toBe("output");
		// The supplies are shared: a terminal may belong to several devices.
		expect(rolesA.get("v_pos")).toBe("supplyPositive");
		expect(rolesB.get("v_pos")).toBe("supplyPositive");
	});

	it("errors on a device naming a terminal the component does not declare", () => {
		const issues = validateComponentDevices(
			component({
				terminals: [term("out", "output")],
				devices: [{ id: "A", terminals: ["out", "ghost"] }],
			}),
		);
		expect(issues.map((i) => [i.code, i.severity])).toContainEqual([
			"component-device-terminal-unknown",
			"error",
		]);
	});

	it("errors on a duplicate device id, an empty device, and a repeated terminal", () => {
		const issues = validateComponentDevices(
			component({
				terminals: [term("out", "output")],
				devices: [
					{ id: "A", terminals: ["out", "out"] },
					{ id: "A", terminals: [] },
				],
			}),
		);
		const codes = issues.map((i) => i.code);
		expect(codes).toContain("component-device-terminal-repeated");
		expect(codes).toContain("component-device-id-duplicate");
		expect(codes).toContain("component-device-empty");
		expect(issues.every((i) => i.severity === "error")).toBe(true);
	});

	it("errors when a device's kind cannot carry a terminal's role", () => {
		// The package may legally carry the role while a device of another kind cannot.
		const issues = validateComponentDevices(
			component({
				id: "PC1",
				kind: "optocoupler",
				terminals: [term("anode", "anode"), term("w", "wiper")],
				devices: [{ id: "LED", kind: "led", terminals: ["anode", "w"] }],
			}),
		);
		expect(issues.map((i) => i.code)).toContain("component-device-role-illegal");
	});

	it("warns, not errors, on a terminal belonging to no device", () => {
		// Decorative or omitted, and the document cannot say which.
		const issues = validateComponentDevices(
			component({
				terminals: [term("out", "output"), term("shield", "pin")],
				devices: [{ id: "A", terminals: ["out"] }],
			}),
		);
		expect(issues.map((i) => [i.code, i.severity])).toEqual([
			["component-device-terminal-orphaned", "warning"],
		]);
	});

	it("says nothing about a component that declares no devices", () => {
		// The default shape cannot be malformed, so it is never reported.
		expect(
			validateComponentDevices(
				component({ terminals: [term("a", "end"), term("b", "end")] }),
			),
		).toEqual([]);
	});
});

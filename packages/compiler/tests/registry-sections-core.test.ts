import { describe, expect, it } from "bun:test";
import { attachDeviceLaws } from "../src/device-laws";
import { readNetlist } from "../src/netlist";
import type { PartRegistry } from "../src/registry";

/**
 * A `sections-core` entry pairs lumped MNA sections with one sampled core in a
 * single part (first case: a delay chip's internal filter op-amps around its
 * ADC/RAM/DAC). The contract, against a synthetic part so no corpus packet is
 * asserted: sections expand to ordinary `#index` devices exactly as the
 * `sections` arm does, the core resolves as the existing macro against the
 * whole device, and either half failing refuses by name rather than dropping.
 */

const source = `schema: circuit-interchange/v2
metadata:
  name: "Sections-core shell"
  description: "One synthetic mixed part."
  partNumber: ""
source:
  format: interchange
  filename: sc.vdsp
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
  - id: U1
    kind: ic
    name: U1
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "TEST-SC48"
      DelayMs: "3"
    terminals:
      - name: a
        role: porta
        node: 1
        position:
          x: 0
          y: 0
      - name: b
        role: portb
        node: 2
        position:
          x: 0
          y: 0
      - name: c
        role: portc
        node: 3
        position:
          x: 0
          y: 0
      - name: d
        role: portd
        node: 0
        position:
          x: 0
          y: 0
wires: []
`;

const coreMacro = {
	modelId: "digital-delay-line",
	parameters: {},
	ports: {
		audioIn: ["b"],
		audioOut: ["c"],
		parameter: [],
	},
	audioPortImpedanceOhms: { input: 1000000000, output: 100 },
	parameterReferenceVolts: null,
};

const registry: PartRegistry = {
	entries: [
		{
			partIds: ["TEST-SC48"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections-core",
				pinout: ["a", "b", "c", "d"],
				sections: [
					{
						law: {
							kind: "ideal-opamp",
							railHigh: null,
							railLow: null,
							openLoopGain: 100000,
						},
						terminals: [4, 0, 1],
					},
					{
						law: { kind: "voltage-source", volts: 2.5, sourceOhms: 0 },
						terminals: [4, 3],
					},
				],
				core: coreMacro,
			},
		},
	],
};

describe("a sections-core entry", () => {
	it("expands sections as devices and resolves the core as the macro", () => {
		const lawed = attachDeviceLaws(readNetlist(source), registry);
		const ids = lawed.netlist.devices.map((device) => device.id);
		expect(ids).toContain("U1#0");
		expect(ids).toContain("U1#1");
		expect(ids).toContain("U1");
		const amp = lawed.netlist.devices.find((device) => device.id === "U1#0");
		const ref = lawed.netlist.devices.find((device) => device.id === "U1#1");
		const internal = amp!.nodes[0]!;
		// Fresh package node, shared by both sections naming it.
		expect([0, 1, 2, 3]).not.toContain(internal);
		expect(amp!.nodes.slice(1)).toEqual([1, 2]);
		expect(ref!.nodes).toEqual([internal, 0]);
		expect(lawed.netlist.nodes).toContain(internal);
		const core = lawed.resolutions.find(
			(resolution) => resolution.device === "U1",
		);
		expect(core?.outcome).toBe("macro");
		if (core?.outcome !== "macro") return;
		expect(core.macro.modelId).toBe("digital-delay-line");
		expect(core.macro.parameters.delaySeconds).toBeCloseTo(0.003, 9);
		// Ports land on the named boundary nodes: in at b (node 2), out at c (node 3).
		expect(core.macro.portTerminals).toEqual([1, 2]);
	});

	it("does not expand when the package arity disagrees with the pinout", () => {
		// The pinout names four positions; a three-terminal document cannot
		// place them, so the entry must not match at all -- no sections, no
		// core -- rather than expanding a misaligned package.
		const trio = source.replace(
			`      - name: d
        role: portd
        node: 0
        position:
          x: 0
          y: 0
`,
			"",
		);
		const lawed = attachDeviceLaws(readNetlist(trio), registry);
		expect(lawed.netlist.devices.map((device) => device.id)).toEqual([
			"JIN",
			"JOUT",
			"U1",
		]);
	});

	it("refuses naming audio out when the core port is unlocatable", () => {
		const bad: PartRegistry = {
			entries: [
				{
					...registry.entries[0]!,
					model: {
						kind: "sections-core",
						pinout: ["a", "b", "c", "d"],
						sections: [],
						core: {
							...coreMacro,
							ports: {
								audioIn: ["b"],
								audioOut: ["no-such-port"],
								parameter: [],
							},
						},
					},
				},
			],
		};
		const lawed = attachDeviceLaws(readNetlist(source), bad);
		const refused = lawed.resolutions.find(
			(resolution) =>
				resolution.outcome === "unsupported" && resolution.device === "U1",
		);
		expect(refused?.outcome).toBe("unsupported");
		if (refused?.outcome !== "unsupported") return;
		expect(refused.reason).toContain("audio out");
	});
});

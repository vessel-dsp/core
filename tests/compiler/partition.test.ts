// Stage 4 contract: regions by solver, and the dependency graph.

import { describe, expect, it } from "bun:test";
import { attachDeviceLaws } from "@vessel-dsp/compiler";
import { readNetlist } from "@vessel-dsp/compiler";
import { PartitionError, partition } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import type { LawedNetlist } from "@vessel-dsp/compiler";
import {
	diodeClipper,
	hybridDelayPedal,
	knownChip,
	potDivider,
	rcLowPass,
	resistiveChip,
	resistorDivider,
} from "./fixtures/circuits";
import { fixtureRegistry, resistiveChipRegistry } from "./fixtures/registry";

function lawed(source: string, registry = emptyRegistry): LawedNetlist {
	return attachDeviceLaws(readNetlist(source), registry);
}

describe("partition", () => {
	it("puts a purely resistive circuit in one linear region", () => {
		const regions = partition(lawed(resistorDivider)).regions;
		expect(regions).toHaveLength(1);
		expect(regions[0]?.kind).toBe("linear");
	});

	it("keeps a capacitive circuit linear", () => {
		// Capacitors add state, not nonlinearity.
		expect(partition(lawed(rcLowPass)).regions[0]?.kind).toBe("linear");
	});

	it("marks a region containing a diode nonlinear", () => {
		const regions = partition(lawed(diodeClipper)).regions;
		expect(regions.some((region) => region.kind === "nonlinear")).toBe(true);
	});

	it("gives a macro model its own region", () => {
		const regions = partition(lawed(knownChip, fixtureRegistry)).regions;
		const macro = regions.find((region) => region.kind === "macro");
		expect(macro?.macro?.modelId).toBe("bucket-brigade-delay-line");
	});

	it("leaves a chip the registry lawed lumped in an ordinary region", () => {
		// The same chip in the same document: a macro region when the registry supplies a
		// macro, and no region of its own at all when the registry supplies a lumped law.
		// Opacity is a property of what the registry knows, not of the device -- so a
		// registry choice, not a device kind, decides whether a boundary exists.
		const regions = partition(
			lawed(resistiveChip, resistiveChipRegistry),
		).regions;
		expect(regions.some((region) => region.kind === "macro")).toBe(false);
		expect(regions).toHaveLength(1);
		expect(regions[0]?.kind).toBe("linear");
	});

	it("records dependencies as a graph, not a flat list", () => {
		// A macro model's parameters can come from an analog region it shares a node
		// with -- a BBD's delay time is set by its clock network.
		const partitioning = partition(lawed(knownChip, fixtureRegistry));
		expect(partitioning.dependencies).toBeDefined();
		for (const region of partitioning.regions) {
			expect(Array.isArray(partitioning.dependencies[region.id])).toBe(true);
		}
	});

	it("depends a macro region on every analog region it shares a node with", () => {
		// The test above passes while every dependency list is permanently empty, which
		// is what the corpus produced: no packet with a macro compiles under an empty
		// registry, so the graph was computed and never once non-empty. This fixture is
		// the first case that fills it -- an input shell, an output shell and a clock
		// network, each sharing exactly one node with the delay memory.
		const partitioning = partition(lawed(hybridDelayPedal, fixtureRegistry));
		const macro = partitioning.regions.find(
			(region) => region.kind === "macro",
		);
		const analog = partitioning.regions
			.filter((region) => region.kind !== "macro")
			.map((region) => region.id);

		expect(macro).toBeDefined();
		expect(analog.length).toBeGreaterThan(1);
		const dependencies = partitioning.dependencies[macro?.id ?? ""] ?? [];
		expect([...dependencies].sort()).toEqual([...analog].sort());
	});

	it("assigns a control to exactly one region", () => {
		// Because taper is evaluated at runtime, a control spanning two regions would
		// make one knob move re-evaluate both in lockstep.
		const partitioning = partition(lawed(potDivider));
		const owners = partitioning.regions.filter((region) =>
			region.controls.includes("Level"),
		);
		expect(owners).toHaveLength(1);
	});

	it("refuses a control that straddles regions", () => {
		// Two galvanically disjoint resistors -- nodes 1-2 and nodes 3-4, sharing only
		// ground -- both bound to one control. That is two regions claiming one knob,
		// which would force both to re-evaluate coefficients in lockstep.
		const straddling: LawedNetlist = {
			netlist: {
				nodes: [0, 1, 2, 3, 4],
				devices: [
					{
						id: "R1",
						kind: "resistor",
						nodes: [1, 2],
						parameters: { ohms: 1000 },
						control: "Shared",
						identity: {
							partNumber: null,
							declaredType: null,
							terminalRoles: [],
			declaredTerminalRoles: [],
			declaredWindings: null,
						},
					},
					{
						id: "R2",
						kind: "resistor",
						nodes: [3, 4],
						parameters: { ohms: 1000 },
						control: "Shared",
						identity: {
							partNumber: null,
							declaredType: null,
							terminalRoles: [],
			declaredTerminalRoles: [],
			declaredWindings: null,
						},
					},
				],
				controls: [{ id: "Shared", taper: "linear", defaultPosition: 0.5 }],
				ports: { input: 1, output: 4 },
				portImpedanceOhms: { input: null, output: null },
		portDeclaredFullScaleVolts: { input: null, output: null },
			},
			resolutions: [
				{
					outcome: "law",
					device: "R1",
					law: { kind: "conductance", siemens: 1e-3 },
				},
				{
					outcome: "law",
					device: "R2",
					law: { kind: "conductance", siemens: 1e-3 },
				},
			],
		};
		expect(() => partition(straddling)).toThrow(PartitionError);
	});
});

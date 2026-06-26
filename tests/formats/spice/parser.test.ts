import { describe, expect, test } from "bun:test";
import { parseSpiceNetlist } from "../../../packages/core/src/formats/spice/parser";
import { resolveConnectivity } from "../../../packages/core/src/model/connectivity";
import { toNetlistView } from "../../../packages/core/src/model/netlist";
import type { Component } from "../../../packages/core/src/model/types";

function nonGround(components: readonly Component[]): readonly Component[] {
	return components.filter((c) => c.kind !== "ground");
}

describe("parseSpiceNetlist", () => {
	test("returns an empty document for empty input", () => {
		const doc = parseSpiceNetlist("");
		expect(doc.components).toEqual([]);
		expect(doc.wires).toEqual([]);
		expect(doc.directives).toEqual([]);
	});

	test("skips comment lines starting with *", () => {
		const doc = parseSpiceNetlist(`* a comment\n* another\n.END`);
		expect(doc.components).toEqual([]);
	});

	test("captures .TITLE into metadata.name", () => {
		const doc = parseSpiceNetlist(`.TITLE My Pedal\nR1 1 0 10k\n.END`);
		expect(doc.metadata.name).toBe("My Pedal");
		expect(nonGround(doc.components)).toHaveLength(1);
	});

	test("parses RLC elements with values", () => {
		const doc = parseSpiceNetlist(`R1 1 2 10k\nC1 2 0 4.7u\nL1 1 0 100m\n.END`);
		const elements = nonGround(doc.components);
		expect(elements.map((c) => c.kind)).toEqual([
			"resistor",
			"capacitor",
			"inductor",
		]);
		expect(elements[0]?.properties.R).toMatchObject({ value: 10000 });
		expect(elements[1]?.properties.C).toMatchObject({ value: 4.7e-6 });
		expect(elements[2]?.properties.L).toMatchObject({ value: 0.1 });
	});

	test("parses voltage and current sources", () => {
		const doc = parseSpiceNetlist(`V1 1 0 9\nI1 2 0 1m\n.END`);
		const elements = nonGround(doc.components);
		expect(elements.map((c) => c.kind)).toEqual([
			"voltage-source",
			"current-source",
		]);
		expect(elements[0]?.properties.V).toMatchObject({ value: 9 });
		expect(elements[1]?.properties.I).toMatchObject({ value: 1e-3 });
	});

	test("parses diode with model name", () => {
		const doc = parseSpiceNetlist(`D1 1 2 1N4148\n.END`);
		const d = doc.components[0]!;
		expect(d.kind).toBe("diode");
		expect(d.properties.model).toBe("1N4148");
	});

	test("parses 3-node BJT with model", () => {
		const doc = parseSpiceNetlist(`Q1 3 2 0 2N3904\n.END`);
		const q = doc.components[0]!;
		expect(q.kind).toBe("bjt");
		expect(q.properties.model).toBe("2N3904");
		expect(q.terminals).toHaveLength(3);
	});

	test("parses 4-node BJT with substrate", () => {
		const doc = parseSpiceNetlist(`Q1 3 2 0 0 2N3904\n.END`);
		const q = doc.components[0]!;
		expect(q.kind).toBe("bjt");
		expect(q.properties.model).toBe("2N3904");
	});

	test("parses JFET with model", () => {
		const doc = parseSpiceNetlist(`J1 3 2 0 J201\n.END`);
		expect(doc.components[0]?.kind).toBe("jfet");
		expect(doc.components[0]?.properties.model).toBe("J201");
	});

	test("parses MOSFET with model", () => {
		const doc = parseSpiceNetlist(`M1 3 2 0 0 IRF540\n.END`);
		expect(doc.components[0]?.kind).toBe("mosfet");
		expect(doc.components[0]?.properties.model).toBe("IRF540");
	});

	test("preserves .MODEL directive verbatim", () => {
		const src = `R1 1 0 10k\n.MODEL 2N3904 NPN (IS=1e-14 BF=200)\n.END`;
		const doc = parseSpiceNetlist(src);
		expect(doc.directives).toContain(".MODEL 2N3904 NPN (IS=1e-14 BF=200)");
	});

	test("preserves .SUBCKT ... .ENDS block as a single multi-line directive", () => {
		const src = `.SUBCKT BUFFER 1 2\nR1 1 2 1k\n.ENDS\n.END`;
		const doc = parseSpiceNetlist(src);
		expect(
			doc.directives.some((d) => d.includes(".SUBCKT") && d.includes(".ENDS")),
		).toBe(true);
	});

	test("handles + continuation lines", () => {
		const src = `R1 1 2 10k\n.MODEL 2N3904 NPN (IS=1e-14\n+ BF=200 BR=1)\n.END`;
		const doc = parseSpiceNetlist(src);
		expect(doc.directives[0]).toContain("IS=1e-14 BF=200 BR=1");
	});

	test("strips inline ; comments", () => {
		const doc = parseSpiceNetlist(`R1 1 0 10k ; bias resistor\n.END`);
		const elements = nonGround(doc.components);
		expect(elements).toHaveLength(1);
		expect(elements[0]?.properties.R).toMatchObject({ value: 10000 });
	});

	test("node 0 becomes the connectivity ground (node 0)", () => {
		const doc = parseSpiceNetlist(`R1 1 0 10k\nC1 1 0 4.7u\n.END`);
		const connectivity = resolveConnectivity(doc);
		expect(connectivity.groundNodeId).toBe(0);
		expect(connectivity.nodeCount).toBeGreaterThanOrEqual(2);
	});

	test("common nodes between components are connected via synthesized wires", () => {
		const doc = parseSpiceNetlist(`R1 1 2 10k\nC1 2 0 4.7u\n.END`);
		const connectivity = resolveConnectivity(doc);
		// R1 has 2 terminals, C1 has 2 terminals, GND auto-added has 1 → 5 pins, 3 nodes (1, 2, 0)
		expect(connectivity.nodeCount).toBe(3);
	});

	test("netlist projection round-trips through parse", () => {
		const doc = parseSpiceNetlist(`R1 1 0 10k\nC1 1 0 4.7u\nV1 1 0 9\n.END`);
		const view = toNetlistView(doc);
		const letters = view.components.map((c) => c.spiceLetter).sort();
		expect(letters).toEqual(["C", "R", "V"]);
	});

	test("emits warning on subcircuit instance (X)", () => {
		const doc = parseSpiceNetlist(`X1 1 2 BUFFER\n.END`);
		expect(doc.warnings.some((w) => w.code === "subcircuit-instance")).toBe(
			true,
		);
	});
});

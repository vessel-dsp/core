import { describe, expect, test } from "bun:test";
import { toNetlistView } from "../../packages/core/src/model/netlist";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type ComponentKind,
	type Point,
	type PropertyValue,
	type Wire,
} from "../../packages/core/src/model/types";

function makeComponent(
	id: string,
	kind: ComponentKind,
	terminals: ReadonlyArray<[name: string, x: number, y: number]>,
	properties: Record<string, PropertyValue> = {},
	sourceTypeName: string | null = null,
): Component {
	return {
		id,
		kind,
		name: id,
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: terminals.map(([name, x, y]) => ({ name, position: { x, y } })),
		properties,
		sourceTypeName,
	};
}

function makeWire(id: string, a: Point, b: Point): Wire {
	return { id, endpoints: [a, b] };
}

function withParts(
	components: readonly Component[],
	wires: readonly Wire[] = [],
): CircuitDocument {
	return { ...EMPTY_DOCUMENT, components, wires };
}

describe("toNetlistView", () => {
	test("empty document yields no components, no nodes, no warnings", () => {
		const view = toNetlistView(EMPTY_DOCUMENT);
		expect(view.components).toEqual([]);
		expect(view.nodeCount).toBe(0);
		expect(view.groundNodeId).toBeNull();
		expect(view.warnings).toEqual([]);
		expect(view.directives).toEqual([]);
	});

	test("single resistor emits one row with R, value, and two nodes", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 10],
					["b", 0, -10],
				],
				{ R: "10k" },
			),
		]);
		const view = toNetlistView(doc);
		expect(view.components).toHaveLength(1);
		const entry = view.components[0]!;
		expect(entry.spiceLetter).toBe("R");
		expect(entry.value?.value).toBe(10000);
		expect(entry.nodes).toHaveLength(2);
		expect(entry.nodes[0]).not.toBe(entry.nodes[1]);
	});

	test("RC voltage divider with explicit ground anchors node 0", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 20],
					["b", 0, 0],
				],
				{ R: "10k" },
			),
			makeComponent(
				"C1",
				"capacitor",
				[
					["a", 0, 0],
					["b", 0, -20],
				],
				{ C: "4.7uF" },
			),
			makeComponent("GND", "ground", [["t", 0, -20]]),
		]);
		const view = toNetlistView(doc);
		expect(view.components.map((c) => c.id)).toEqual(["R1", "C1"]);
		expect(view.groundNodeId).toBe(0);
		const c1 = view.components.find((c) => c.id === "C1")!;
		expect(c1.spiceLetter).toBe("C");
		expect(c1.value?.value).toBeCloseTo(4.7e-6);
		expect(c1.nodes).toContain(0);
	});

	test("view-only components are skipped silently", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 0, 10],
				],
				{ R: "1k" },
			),
			makeComponent("LBL", "label", [["t", 5, 5]]),
			makeComponent("NW", "named-wire", [["t", 10, 10]]),
			makeComponent("PORT", "port", [["t", 15, 15]]),
		]);
		const view = toNetlistView(doc);
		expect(view.components.map((c) => c.id)).toEqual(["R1"]);
		expect(view.warnings).toEqual([]);
	});

	test("unsupported kind emits a warning and is skipped", () => {
		const doc = withParts([
			makeComponent(
				"U?",
				"unsupported",
				[["t", 0, 0]],
				{},
				"Circuit.Components.MysteryChip",
			),
		]);
		const view = toNetlistView(doc);
		expect(view.components).toHaveLength(0);
		expect(
			view.warnings.some((w) => w.includes("U?") && w.includes("MysteryChip")),
		).toBe(true);
	});

	test("BJT terminals are reordered to SPICE convention [collector, base, emitter]", () => {
		const doc = withParts([
			makeComponent(
				"Q1",
				"bjt",
				[
					["base", 0, 0],
					["emitter", 5, 0],
					["collector", 10, 0],
				],
				{ model: "2N3904" },
			),
		]);
		const view = toNetlistView(doc);
		const q = view.components[0]!;
		expect(q.spiceLetter).toBe("Q");
		expect(q.model).toBe("2N3904");
		expect(q.nodes).toHaveLength(3);
		// collector at (10,0), base at (0,0), emitter at (5,0)
		// declaration order would put base first; SPICE order puts collector first
		const declarationFirst = q.nodes[0];
		const expectedSpiceFirst = 2; // collector pin -> third unique node id assigned
		// Don't rely on absolute ids; check the right nodes are in the right slots:
		expect(q.nodes[0]).toBe(expectedSpiceFirst);
		expect(declarationFirst).toBeDefined();
	});

	test("diode model name is preserved and nodes ordered anode/cathode", () => {
		const doc = withParts([
			makeComponent(
				"D1",
				"diode",
				[
					["cathode", 0, 0],
					["anode", 0, 10],
				],
				{ Model: "1N4148" },
			),
		]);
		const view = toNetlistView(doc);
		const d = view.components[0]!;
		expect(d.spiceLetter).toBe("D");
		expect(d.model).toBe("1N4148");
		// anode at y=10, cathode at y=0 — anode should be first in SPICE order
		// anode's pin gets node id 1 (first encountered) or 0 (cathode encountered first by declaration)
		// The exact ids depend on iteration order, but the relative order in `nodes` must reflect [anode, cathode]
		// anode terminal position (0,10) was registered AFTER cathode (0,0), so anode = node 1, cathode = node 0
		expect(d.nodes[0]).toBe(1);
		expect(d.nodes[1]).toBe(0);
	});

	test("LED emits diode-style SPICE row with model preserved", () => {
		const doc = withParts([
			makeComponent(
				"LED1",
				"led",
				[
					["cathode", 0, 0],
					["anode", 0, 10],
				],
				{ model: "LED_RED" },
			),
		]);
		const view = toNetlistView(doc);
		const led = view.components[0]!;
		expect(led.kind).toBe("led");
		expect(led.spiceLetter).toBe("D");
		expect(led.model).toBe("LED_RED");
		expect(led.nodes).toEqual([1, 0]);
	});

	test("op-amp lands as a subckt placeholder with spiceLetter=null", () => {
		// The null spiceLetter is the load-bearing signal: downstream SPICE serializers skip
		// these rows (they need a subckt definition). No per-component warning is emitted —
		// a well-formed circuit with an op-amp shouldn't read as a problem.
		const doc = withParts([
			makeComponent(
				"U1",
				"opamp",
				[
					["vin+", 0, 10],
					["vin-", 0, -10],
					["vout", 30, 0],
					["vcc", 15, 20],
					["vee", 15, -20],
				],
				{ model: "TL072" },
			),
		]);
		const view = toNetlistView(doc);
		const op = view.components[0]!;
		expect(op.spiceLetter).toBeNull();
		expect(op.kind).toBe("opamp");
		expect(op.model).toBe("TL072");
		expect(op.nodes).toHaveLength(5);
		expect(view.warnings.some((w) => w.includes("subcircuit"))).toBe(false);
	});

	test("subcircuit placeholders with unknown pin geometry do not emit terminal-order warnings", () => {
		const doc = withParts([
			makeComponent("U1", "opamp", [], { model: "LM308" }, "ltspice:lm308"),
		]);
		const view = toNetlistView(doc);

		const op = view.components[0]!;
		expect(op.spiceLetter).toBeNull();
		expect(op.nodes).toEqual([]);
		expect(view.warnings).toEqual([]);
	});

	test("component with unconventional terminal names falls back to declaration order with a warning", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["top", 0, 10],
					["bottom", 0, -10],
				],
				{ R: "1k" },
			),
		]);
		const view = toNetlistView(doc);
		expect(view.components[0]?.nodes).toHaveLength(2);
		expect(
			view.warnings.some(
				(w) => w.includes("R1") && w.includes("declaration order"),
			),
		).toBe(true);
	});

	test("missing required value emits a warning", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 0, 10],
				],
				{},
			),
		]);
		const view = toNetlistView(doc);
		expect(view.components[0]?.value).toBeNull();
		expect(
			view.warnings.some(
				(w) => w.includes("R1") && w.includes("missing required value"),
			),
		).toBe(true);
	});

	test("ParsedQuantity value is passed through without re-parsing", () => {
		const doc = withParts([
			makeComponent(
				"C1",
				"capacitor",
				[
					["a", 0, 0],
					["b", 0, 10],
				],
				{ C: { raw: "47nF", value: 47e-9, unit: "F" } },
			),
		]);
		const view = toNetlistView(doc);
		expect(view.components[0]?.value).toEqual({
			raw: "47nF",
			value: 47e-9,
			unit: "F",
		});
	});

	test("extras carry non-value, non-model properties through", () => {
		const doc = withParts([
			makeComponent(
				"Q1",
				"bjt",
				[
					["collector", 10, 0],
					["base", 0, 0],
					["emitter", 5, -10],
				],
				{ model: "2N3904", tolerance: "5%", package: "TO-92" },
			),
		]);
		const view = toNetlistView(doc);
		const q = view.components[0]!;
		expect(q.extras).toEqual({ tolerance: "5%", package: "TO-92" });
		expect(q.model).toBe("2N3904");
	});

	test("jacks and ground are skipped but their nodes are reflected in connectivity", () => {
		const doc = withParts([
			makeComponent("IN", "jack", [["t", 0, 0]]),
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 0, 10],
				],
				{ R: "1k" },
			),
			makeComponent("GND", "ground", [["t", 0, 10]]),
		]);
		const view = toNetlistView(doc);
		expect(view.components.map((c) => c.id)).toEqual(["R1"]);
		expect(view.groundNodeId).toBe(0);
		// R1's terminal at (0,10) shares the ground node; terminal at (0,0) shares the jack node
		const r1 = view.components[0]!;
		expect(r1.nodes).toContain(0);
		expect(r1.nodes).toHaveLength(2);
	});

	test("rail emits [terminal_node, ground] with no missing-terminal warning", () => {
		// Rails have a single terminal "t" — the other side is implicitly ground.
		const doc = withParts([
			makeComponent("VCC", "rail", [["t", 0, 0]], { V: "9V" }),
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 0, 10],
				],
				{ R: "1k" },
			),
			makeComponent("GND", "ground", [["t", 0, 10]]),
		]);
		const view = toNetlistView(doc);
		const vcc = view.components.find((c) => c.id === "VCC")!;
		expect(vcc.spiceLetter).toBe("V");
		expect(vcc.nodes).toHaveLength(2);
		// Second node is ground.
		expect(view.groundNodeId).not.toBeNull();
		expect(vcc.nodes[1]).toBe(view.groundNodeId!);
		// First node is whatever VCC.t connects to.
		expect(vcc.nodes[0]).not.toBe(view.groundNodeId);

		const missingPlusMinus = view.warnings.find(
			(w) => w.includes("VCC") && w.includes("[+, -]"),
		);
		expect(missingPlusMinus).toBeUndefined();
	});

	test("rail in a document without a ground emits a warning instead of inventing a node", () => {
		const doc = withParts([
			makeComponent("VCC", "rail", [["t", 0, 0]], { V: "9V" }),
		]);
		const view = toNetlistView(doc);
		expect(view.groundNodeId).toBeNull();
		const warn = view.warnings.find(
			(w) => w.includes("VCC") && w.toLowerCase().includes("ground"),
		);
		expect(warn).toBeDefined();
	});

	test("reuses a precomputed Connectivity when provided", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 0, 10],
				],
				{ R: "1k" },
			),
		]);
		const fake = {
			pinToNode: new Map<string, number>([
				["R1:a", 7],
				["R1:b", 9],
			]),
			nodeMembers: new Map(),
			groundNodeId: null,
			nodeCount: 2,
		};
		const view = toNetlistView(doc, fake);
		expect(view.components[0]?.nodes).toEqual([7, 9]);
	});
});

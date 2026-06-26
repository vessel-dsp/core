import { describe, expect, test } from "bun:test";
import { parseLtspiceAsc } from "../../../packages/core/src/formats/ltspice/parser";
import { isParsedQuantity } from "../../../packages/core/src/model/properties";
import {
	getPinNode,
	resolveConnectivity,
} from "../../../packages/core/src/model/connectivity";
import { toNetlistView } from "../../../packages/core/src/model/netlist";
import type { CircuitDocument } from "../../../packages/core/src/model/types";
import { validateDocument } from "../../../packages/core/src/model/validation";

const SIMPLE_RC_URL = new URL(
	"../../fixtures/asc/simple-rc.asc",
	import.meta.url,
);

async function loadSimpleRc(): Promise<string> {
	return Bun.file(SIMPLE_RC_URL).text();
}

function findComponent(
	doc: CircuitDocument,
	id: string,
): CircuitDocument["components"][number] {
	const component = doc.components.find((candidate) => candidate.id === id);
	if (component === undefined) {
		throw new Error(`missing component ${id}`);
	}
	return component;
}

describe("parseLtspiceAsc", () => {
	test("keeps visible wires for fixture pin, port, and ground connections", async () => {
		const doc = parseLtspiceAsc(await loadSimpleRc());
		const wirePoints = doc.wires.map(
			(wire) =>
				`${wire.endpoints[0].x},${wire.endpoints[0].y} ${wire.endpoints[1].x},${wire.endpoints[1].y}`,
		);

		// Source WIRE coords scaled by LTSPICE_COORD_SCALE (0.5). The fixture's
		// resistor pins now sit at (16, 16) and (16, 96) per LTspice's real
		// res.asy convention, so wires meet the pins at those LTspice coords.
		expect(wirePoints).toContain("8,-16 8,8");
		expect(wirePoints).toContain("8,48 72,48");
		expect(wirePoints).toContain("72,48 88,48");
		expect(wirePoints).toContain("72,80 72,96");
	});

	test("parses common LTspice ASC elements into the normalized model", async () => {
		const doc = parseLtspiceAsc(await loadSimpleRc());

		const r1 = findComponent(doc, "R1");
		const c1 = findComponent(doc, "C1");
		const input = findComponent(doc, "IN");
		const output = findComponent(doc, "OUT");
		const ground = findComponent(doc, "GND");
		const label = doc.components.find(
			(component) => component.kind === "label",
		);

		expect(doc.rawAttributes).toEqual({
			format: "ltspice-asc",
			version: "4",
			sheet: "1 880 680",
		});
		expect(r1.kind).toBe("resistor");
		expect(r1.sourceTypeName).toBe("ltspice:res");
		expect(r1.properties.R).toMatchObject({ value: 10000, unit: "" });
		expect(r1.properties.Value).toBe("10k");
		expect(c1.kind).toBe("capacitor");
		const cValue = c1.properties.C;
		if (!isParsedQuantity(cValue)) {
			throw new Error("C1 should expose a parsed capacitance property");
		}
		expect(cValue.value).toBeCloseTo(47e-9);
		expect(cValue.unit).toBe("");
		expect(input.kind).toBe("jack");
		expect(input.sourceTypeName).toBe("ltspice:InputJack");
		// LTspice coords scaled by LTSPICE_COORD_SCALE (0.5). IOPIN 16 -32 → (8, -16).
		expect(input.terminals).toEqual([
			{ name: "tip", position: { x: 8, y: -16 } },
		]);
		expect(input.properties.polarity).toBe("In");
		expect(input.properties.connector).toBe('1/4" TS jack');
		expect(output.kind).toBe("jack");
		expect(output.sourceTypeName).toBe("ltspice:OutputJack");
		// Source coord IOPIN 176 96 → (88, 48) after 0.5 scaling.
		expect(output.terminals).toEqual([
			{ name: "tip", position: { x: 88, y: 48 } },
		]);
		expect(output.properties.polarity).toBe("Out");
		expect(output.properties.connector).toBe('1/4" TS jack');
		expect(ground.kind).toBe("ground");
		expect(label?.properties.Text).toBe("RC low-pass fixture");
		expect(doc.directives).toEqual([".tran 100m"]);
		expect(doc.warnings).toEqual([]);
	});

	test("resolves connectivity through wires, flags, ports, and ground", async () => {
		const doc = parseLtspiceAsc(await loadSimpleRc());
		const connectivity = resolveConnectivity(doc);

		const inputNode = getPinNode(connectivity, {
			componentId: "IN",
			terminalName: "tip",
		});
		const rInputNode = getPinNode(connectivity, {
			componentId: "R1",
			terminalName: "a",
		});
		const outputNode = getPinNode(connectivity, {
			componentId: "OUT",
			terminalName: "tip",
		});
		const rOutputNode = getPinNode(connectivity, {
			componentId: "R1",
			terminalName: "b",
		});
		const cOutputNode = getPinNode(connectivity, {
			componentId: "C1",
			terminalName: "a",
		});
		const cGroundNode = getPinNode(connectivity, {
			componentId: "C1",
			terminalName: "b",
		});
		const groundNode = getPinNode(connectivity, {
			componentId: "GND",
			terminalName: "t",
		});

		expect(inputNode).toBe(rInputNode);
		expect(outputNode).toBe(rOutputNode);
		expect(outputNode).toBe(cOutputNode);
		expect(cGroundNode).toBe(groundNode);
		if (connectivity.groundNodeId === null) {
			throw new Error("expected LTspice FLAG 0 to resolve as ground");
		}
		expect(groundNode).toBe(connectivity.groundNodeId);
	});

	test("keeps unknown LTspice symbols visible with a parser warning", () => {
		const doc = parseLtspiceAsc(`Version 4
SHEET 1 100 100
SYMBOL mystery 0 0 R0
SYMATTR InstName X1
`);

		expect(doc.components).toHaveLength(1);
		expect(doc.components[0]?.id).toBe("X1");
		expect(doc.components[0]?.kind).toBe("unsupported");
		expect(doc.components[0]?.sourceTypeName).toBe("ltspice:mystery");
		expect(doc.warnings).toEqual([
			{
				code: "unknown-ltspice-symbol",
				message: 'X1: unsupported LTspice symbol "mystery"',
				componentId: "X1",
			},
		]);
	});

	test("maps LTspice led symbols to LED components", () => {
		const doc = parseLtspiceAsc(`Version 4
SHEET 1 100 100
SYMBOL led 0 0 R0
SYMATTR InstName DLED
SYMATTR Value LED_RED
`);

		const led = findComponent(doc, "DLED");
		expect(led.kind).toBe("led");
		expect(led.sourceTypeName).toBe("ltspice:led");
		expect(led.properties.model).toBe("LED_RED");
		expect(led.terminals.map((terminal) => terminal.name)).toEqual([
			"anode",
			"cathode",
		]);
	});

	test("maps schottky symbol to diode kind (catalog Gap 4)", () => {
		const doc = parseLtspiceAsc(`Version 4
SHEET 1 100 100
SYMBOL schottky 0 0 R0
SYMATTR InstName D1
SYMATTR Value 1N5817
`);
		const d = findComponent(doc, "D1");
		expect(d.kind).toBe("diode");
		expect(d.sourceTypeName).toBe("ltspice:schottky");
		expect(d.properties.model).toBe("1N5817");
		expect(d.terminals.map((t) => t.name)).toEqual(["anode", "cathode"]);
	});

	test("Opamps\\<Model> symbols resolve to opamp kind with model from path (catalog Gap 2)", () => {
		// LTspice opamps live under Opamps\... or OpAmps/... — the model name is the basename.
		// We don't know terminal geometry without the .asy file, so terminals are empty for now.
		const doc = parseLtspiceAsc(`Version 4
SHEET 1 100 100
SYMBOL Opamps\\\\LM308 0 0 R0
SYMATTR InstName U1
`);
		const op = findComponent(doc, "U1");
		expect(op.kind).toBe("opamp");
		expect(op.sourceTypeName).toBe("ltspice:lm308");
		expect(op.properties.model).toBe("LM308");
	});

	test("opamp path-prefix fallback is case- and separator-tolerant", () => {
		// OpAmps/ (forward slash, mixed case) is what some LTspice exports emit.
		const doc = parseLtspiceAsc(`Version 4
SHEET 1 100 100
SYMBOL OpAmps/AD820 0 0 R0
SYMATTR InstName U2
`);
		const op = findComponent(doc, "U2");
		expect(op.kind).toBe("opamp");
		expect(op.properties.model).toBe("AD820");
	});

	test("treats LTspice parameter and source expressions as valid raw values", () => {
		const doc = parseLtspiceAsc(`Version 4
SHEET 1 100 100
SYMBOL res 0 0 R0
SYMATTR InstName RGAIN
SYMATTR Value {10k - Rgain + 1}
SYMBOL voltage 80 0 R0
SYMATTR InstName V1
SYMATTR Value AC 1
`);

		const issues = validateDocument(doc);
		const netlist = toNetlistView(doc);

		expect(
			issues.filter((issue) => issue.code === "value-unparseable"),
		).toEqual([]);
		expect(
			netlist.warnings.filter((message) =>
				message.includes("missing required value property"),
			),
		).toEqual([]);
	});

	test("decodes Windows-1252 µ when given raw bytes (encoding Gap 1)", () => {
		// LTspice writes "100µF" with the single-byte Windows-1252 µ (0xB5).
		// Passing it as Uint8Array should fall back to Windows-1252 decoding.
		const header = new TextEncoder().encode(
			"Version 4\r\nSHEET 1 100 100\r\nSYMBOL cap 0 0 R0\r\nSYMATTR InstName C1\r\nSYMATTR Value 100",
		);
		const tail = new TextEncoder().encode("F\r\n");
		const bytes = new Uint8Array(header.length + 1 + tail.length);
		bytes.set(header, 0);
		bytes[header.length] = 0xb5; // lone Windows-1252 µ
		bytes.set(tail, header.length + 1);

		const doc = parseLtspiceAsc(bytes);
		const c = findComponent(doc, "C1");
		expect(c.kind).toBe("capacitor");
		// The C property should parse as 100 µF = 1e-4 F.
		const cValue = c.properties.C;
		expect(isParsedQuantity(cValue) ? cValue.value : null).toBeCloseTo(1e-4);
	});
});

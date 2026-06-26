import { describe, expect, test } from "bun:test";
import { parseLtspiceAsc } from "../../../packages/core/src/formats/ltspice/parser";
import { serializeLtspiceAsc } from "../../../packages/core/src/formats/ltspice/serializer";
import {
	resolveConnectivity,
	getPinNode,
} from "../../../packages/core/src/model/connectivity";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
} from "../../../packages/core/src/model/types";

const SIMPLE_ASC_URL = new URL(
	"../../fixtures/asc/simple-rc.asc",
	import.meta.url,
);

describe("serializeLtspiceAsc", () => {
	test("emits a parseable LTspice schematic with symbols, flags, I/O pins, wires, and directives", async () => {
		const original = parseLtspiceAsc(await Bun.file(SIMPLE_ASC_URL).text());
		const asc = serializeLtspiceAsc(original);

		expect(asc).toContain("Version 4");
		expect(asc).toContain("SHEET 1 880 680");
		expect(asc).toContain("SYMBOL res");
		expect(asc).toContain("SYMATTR InstName R1");
		expect(asc).toContain("SYMBOL cap");
		expect(asc).toContain("FLAG");
		expect(asc).toContain("IOPIN");
		expect(asc).toContain("TEXT");
		expect(asc).toContain("!.tran 100m");

		const rebuilt = parseLtspiceAsc(asc);
		const connectivity = resolveConnectivity(rebuilt);

		expect(
			rebuilt.components.some(
				(component) => component.id === "R1" && component.kind === "resistor",
			),
		).toBe(true);
		expect(
			rebuilt.components.some(
				(component) => component.id === "C1" && component.kind === "capacitor",
			),
		).toBe(true);
		expect(
			rebuilt.components.some(
				(component) => component.id === "IN" && component.kind === "jack",
			),
		).toBe(true);
		expect(
			getPinNode(connectivity, { componentId: "C1", terminalName: "b" }),
		).toBe(getPinNode(connectivity, { componentId: "GND", terminalName: "t" }));
	});

	test("source/reference export includes source-only R/C parts and metadata SYMATTRs", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "R_SCREEN",
					kind: "resistor",
					name: "R_SCREEN",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: -10, y: 0 } },
						{ name: "b", position: { x: 10, y: 0 } },
					],
					properties: {
						R: "470 ohm",
						SourceOnly: "true",
						RuntimeOwnership: "source-reference",
						SourceBoundaryRole: "power-tube-screen-grid",
					},
					sourceTypeName: "Circuit.Resistor",
				},
				{
					id: "C_MAIN_A",
					kind: "capacitor",
					name: "C_MAIN_A",
					origin: { x: 40, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: 30, y: 0 } },
						{ name: "b", position: { x: 50, y: 0 } },
					],
					properties: {
						C: "16uF",
						SourceOnly: "true",
						RuntimeOwnership: "source-reference",
						CanCapGroupId: "C_MAIN",
						CanCapSection: "A",
					},
					sourceTypeName: "Circuit.Capacitor",
				},
			],
		};

		const asc = serializeLtspiceAsc(doc);

		expect(asc).toContain("SYMBOL res");
		expect(asc).toContain("SYMATTR InstName R_SCREEN");
		expect(asc).toContain("SYMATTR Value 470 ohm");
		expect(asc).toContain("SYMATTR SourceOnly true");
		expect(asc).toContain("SYMATTR RuntimeOwnership source-reference");
		expect(asc).toContain("SYMATTR SourceBoundaryRole power-tube-screen-grid");
		expect(asc).toContain("SYMBOL cap");
		expect(asc).toContain("SYMATTR InstName C_MAIN_A");
		expect(asc).toContain("SYMATTR CanCapGroupId C_MAIN");
		expect(asc).toContain("SYMATTR CanCapSection A");
	});
});

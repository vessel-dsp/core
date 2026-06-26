import { describe, expect, test } from "bun:test";
import { parseSchx } from "../../../packages/core/src/formats/schx/parser";
import { serializeSchx } from "../../../packages/core/src/formats/schx/serializer";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type Wire,
} from "../../../packages/core/src/model/types";

describe("serializeSchx", () => {
	test("emits a well-formed XML header and Schematic root", () => {
		const xml = serializeSchx(EMPTY_DOCUMENT);
		expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
		expect(xml).toContain("<Schematic");
		expect(xml.endsWith("</Schematic>\n")).toBe(true);
	});

	test("preserves Name / Description / PartNumber attributes", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			metadata: {
				name: "My Pedal",
				description: "A pedal",
				partNumber: "P-001",
			},
		};
		const xml = serializeSchx(doc);
		expect(xml).toContain('Name="My Pedal"');
		expect(xml).toContain('Description="A pedal"');
		expect(xml).toContain('PartNumber="P-001"');
	});

	test("emits a resistor element with Type Circuit.Resistor", () => {
		const component: Component = {
			id: "R1",
			kind: "resistor",
			name: "R1",
			origin: { x: 50, y: 75 },
			rotation: 1,
			flipped: false,
			terminals: [],
			properties: { Resistance: { raw: "10kΩ", value: 10000, unit: "Ω" } },
			sourceTypeName:
				"Circuit.Resistor, Circuit, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
		};
		const doc: CircuitDocument = { ...EMPTY_DOCUMENT, components: [component] };
		const xml = serializeSchx(doc);
		expect(xml).toContain('_Type="Circuit.Resistor');
		expect(xml).toContain('Position="50,75"');
		expect(xml).toContain('Rotation="1"');
		expect(xml).toContain('Flip="false"');
		expect(xml).toContain('Resistance="10kΩ"');
		expect(xml).toContain('Name="R1"');
	});

	test("emits a wire element with A and B attributes", () => {
		const wire: Wire = {
			id: "w1",
			endpoints: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			],
		};
		const doc: CircuitDocument = { ...EMPTY_DOCUMENT, wires: [wire] };
		const xml = serializeSchx(doc);
		expect(xml).toContain('A="0,0"');
		expect(xml).toContain('B="100,0"');
		expect(xml).toContain("Circuit.Wire");
	});

	test("escapes XML special characters in attribute values", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			metadata: { name: "A & B", description: "<bad>", partNumber: '"quoted"' },
		};
		const xml = serializeSchx(doc);
		expect(xml).toContain('Name="A &amp; B"');
		expect(xml).toContain('Description="&lt;bad&gt;"');
		expect(xml).toContain('PartNumber="&quot;quoted&quot;"');
	});

	test("emits constructed LEDs as LiveSPICE diodes with Type=LED", () => {
		const component: Component = {
			id: "LED1",
			kind: "led",
			name: "LED1",
			origin: { x: 20, y: 40 },
			rotation: 0,
			flipped: false,
			terminals: [],
			properties: { model: "LED_RED" },
			sourceTypeName: null,
		};
		const xml = serializeSchx({ ...EMPTY_DOCUMENT, components: [component] });
		expect(xml).toContain('_Type="Circuit.Diode');
		expect(xml).toContain('Type="LED"');

		const reparsed = parseSchx(xml);
		expect(reparsed.components[0]?.kind).toBe("led");
	});

	test("emits constructed opaque ICs as generic Circuit.IC when no source type is present", () => {
		const component: Component = {
			id: "U1",
			kind: "ic",
			name: "U1",
			origin: { x: 20, y: 40 },
			rotation: 0,
			flipped: false,
			terminals: [],
			properties: { PartNumber: "opaque block" },
			sourceTypeName: null,
		};
		const xml = serializeSchx({ ...EMPTY_DOCUMENT, components: [component] });

		expect(xml).toContain('_Type="Circuit.IC,');
		expect(xml).not.toContain("MicroBlockOverdriveStage");
	});

	test("preserves lowercase metadata on non-runtime components", () => {
		const component: Component = {
			id: "U1",
			kind: "ic",
			name: "U1",
			origin: { x: 20, y: 40 },
			rotation: 0,
			flipped: false,
			terminals: [],
			properties: {
				PartNumber: "opaque block",
				level: "inspection-only",
			},
			sourceTypeName: null,
		};

		const xml = serializeSchx({ ...EMPTY_DOCUMENT, components: [component] });

		expect(xml).toContain('level="inspection-only"');
	});

	test("output is reparseable into an equivalent document", () => {
		const original: CircuitDocument = {
			metadata: { name: "Roundtrip", description: "", partNumber: "" },
			components: [
				{
					id: "R1",
					kind: "resistor",
					name: "R1",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [],
					properties: { Resistance: { raw: "4.7kΩ", value: 4700, unit: "Ω" } },
					sourceTypeName:
						"Circuit.Resistor, Circuit, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
				},
			],
			wires: [
				{
					id: "w1",
					endpoints: [
						{ x: 0, y: 0 },
						{ x: 30, y: 0 },
					],
				},
			],
			directives: [],
			warnings: [],
			rawAttributes: { Name: "Roundtrip", Description: "", PartNumber: "" },
		};
		const xml = serializeSchx(original);
		const reparsed = parseSchx(xml);
		expect(reparsed.components).toHaveLength(1);
		expect(reparsed.wires).toHaveLength(1);
		expect(reparsed.components[0]?.kind).toBe("resistor");
		expect(reparsed.components[0]?.properties.Resistance).toMatchObject({
			value: 4700,
			unit: "Ω",
		});
	});
});

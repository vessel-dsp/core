import { describe, expect, test } from "bun:test";
import {
	computeDocumentBounds,
	viewBoxString,
} from "../../packages/core/src/preview/bounds";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
} from "../../packages/core/src/model/types";

describe("computeDocumentBounds", () => {
	test("returns a sensible fallback for an empty document", () => {
		const b = computeDocumentBounds(EMPTY_DOCUMENT);
		expect(b.width).toBeGreaterThan(0);
		expect(b.height).toBeGreaterThan(0);
		expect(b.minX).toBeLessThan(b.maxX);
		expect(b.minY).toBeLessThan(b.maxY);
	});

	test("expands to include all component terminals plus padding", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "R1",
					kind: "resistor",
					name: "R1",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: 0, y: 20 } },
						{ name: "b", position: { x: 0, y: -20 } },
					],
					properties: {},
					sourceTypeName: null,
				},
			],
		};
		const b = computeDocumentBounds(doc, 10);
		expect(b.minX).toBeLessThanOrEqual(-10);
		expect(b.maxX).toBeGreaterThanOrEqual(10);
		expect(b.minY).toBeLessThanOrEqual(-30);
		expect(b.maxY).toBeGreaterThanOrEqual(30);
	});

	test("expands to include wire endpoints", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			wires: [
				{
					id: "w1",
					endpoints: [
						{ x: -50, y: 100 },
						{ x: 200, y: -75 },
					],
				},
			],
		};
		const b = computeDocumentBounds(doc, 5);
		expect(b.minX).toBeLessThanOrEqual(-55);
		expect(b.maxX).toBeGreaterThanOrEqual(205);
		expect(b.minY).toBeLessThanOrEqual(-80);
		expect(b.maxY).toBeGreaterThanOrEqual(105);
	});

	test("expands to include wrapped note label textboxes", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "NOTE1",
					kind: "label",
					name: "NOTE1",
					origin: { x: 40, y: 60 },
					rotation: 0,
					flipped: false,
					terminals: [],
					properties: {
						Text: "NOTE: Use the following commands to switch between time and frequency domain simulations.\nGAIN SIM:\n.step param Rgain list 1k 2k 5k 10k 20k 50k 100k",
					},
					sourceTypeName: "ltspice:TEXT",
				},
			],
		};

		const b = computeDocumentBounds(doc, 10);
		expect(b.maxX).toBeGreaterThanOrEqual(356);
		expect(b.maxY).toBeGreaterThanOrEqual(138);
	});

	test("viewBoxString formats minX minY width height", () => {
		const s = viewBoxString({
			minX: -10,
			minY: -20,
			maxX: 30,
			maxY: 40,
			width: 40,
			height: 60,
		});
		expect(s).toBe("-10 -20 40 60");
	});
});

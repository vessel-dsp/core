import { describe, expect, test } from "bun:test";
import { tidyDocumentLayout } from "../../packages/core/src/editor/layout";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type Point,
} from "../../packages/core/src/model/types";

const DISPLAY_HALF = 20;

function component(id: string, origin: Point): Component {
	return {
		id,
		kind: "resistor",
		name: id,
		origin,
		rotation: 0,
		flipped: false,
		terminals: [
			{ name: "a", position: { x: origin.x, y: origin.y - 20 } },
			{ name: "b", position: { x: origin.x, y: origin.y + 20 } },
		],
		properties: {},
		sourceTypeName: null,
	};
}

function boxesOverlap(a: Component, b: Component, margin: number): boolean {
	return !(
		a.origin.x + DISPLAY_HALF + margin <= b.origin.x - DISPLAY_HALF - margin ||
		b.origin.x + DISPLAY_HALF + margin <= a.origin.x - DISPLAY_HALF - margin ||
		a.origin.y + DISPLAY_HALF + margin <= b.origin.y - DISPLAY_HALF - margin ||
		b.origin.y + DISPLAY_HALF + margin <= a.origin.y - DISPLAY_HALF - margin
	);
}

describe("tidyDocumentLayout", () => {
	test("moves overlapping components onto free display cells", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				component("R1", { x: 0, y: 0 }),
				component("R2", { x: 10, y: 0 }),
				component("R3", { x: 20, y: 0 }),
			],
		};

		const next = tidyDocumentLayout(doc, { spacing: 64, margin: 4 });

		expect(next).not.toBe(doc);
		expect(next.components[0]?.origin).toEqual({ x: 0, y: 0 });
		for (let i = 0; i < next.components.length; i += 1) {
			for (let j = i + 1; j < next.components.length; j += 1) {
				expect(boxesOverlap(next.components[i]!, next.components[j]!, 4)).toBe(
					false,
				);
			}
		}
	});

	test("keeps already separated layouts unchanged", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				component("R1", { x: 0, y: 0 }),
				component("R2", { x: 100, y: 0 }),
			],
		};

		expect(tidyDocumentLayout(doc, { spacing: 64, margin: 4 })).toBe(doc);
	});

	test("moves wire endpoints attached to shifted terminals", () => {
		const r1 = component("R1", { x: 0, y: 0 });
		const r2 = component("R2", { x: 10, y: 0 });
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [r1, r2],
			wires: [
				{
					id: "w1",
					endpoints: [r2.terminals[0]!.position, { x: 120, y: -20 }],
				},
			],
		};

		const next = tidyDocumentLayout(doc, { spacing: 64, margin: 4 });
		const moved = next.components.find((c) => c.id === "R2");

		expect(moved).toBeDefined();
		expect(moved?.origin).not.toEqual(r2.origin);
		expect(next.wires[0]?.endpoints[0]).toEqual(moved?.terminals[0]?.position);
		expect(next.wires[0]?.endpoints[1]).toEqual({ x: 120, y: -20 });
	});

	test("does not move an overlapped component onto a later stationary component", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				component("R1", { x: 0, y: 0 }),
				component("R2", { x: 10, y: 0 }),
				component("R3", { x: 74, y: 0 }),
			],
		};

		const next = tidyDocumentLayout(doc, { spacing: 64, margin: 4 });

		expect(next.components.find((c) => c.id === "R3")?.origin).toEqual({
			x: 74,
			y: 0,
		});
		for (let i = 0; i < next.components.length; i += 1) {
			for (let j = i + 1; j < next.components.length; j += 1) {
				expect(boxesOverlap(next.components[i]!, next.components[j]!, 4)).toBe(
					false,
				);
			}
		}
	});
});

import { describe, expect, test } from "bun:test";
import { buildRenderableWires } from "../../packages/core/src/preview/renderable-wires";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Point,
	type Wire,
} from "../../packages/core/src/model/types";

function makeWire(id: string, a: Point, b: Point): Wire {
	return { id, endpoints: [a, b] };
}

describe("buildRenderableWires", () => {
	test("splits a wire trunk at a component terminal that lands on the wire body", () => {
		const document: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "R2",
					kind: "resistor",
					name: "R2",
					origin: { x: -100, y: 20 },
					rotation: 0,
					flipped: false,
					terminals: [{ name: "a", position: { x: -100, y: 0 } }],
					properties: {},
					sourceTypeName: null,
				},
			],
			wires: [makeWire("main", { x: -130, y: 0 }, { x: 0, y: 0 })],
		};

		expect(buildRenderableWires(document)).toEqual([
			makeWire("main-1", { x: -130, y: 0 }, { x: -100, y: 0 }),
			makeWire("main-2", { x: -100, y: 0 }, { x: 0, y: 0 }),
		]);
	});

	test("splits a wire trunk at another wire endpoint so a T-junction is renderable without parser mutation", () => {
		const document: CircuitDocument = {
			...EMPTY_DOCUMENT,
			wires: [
				makeWire("main", { x: -130, y: 0 }, { x: 0, y: 0 }),
				makeWire("branch", { x: -100, y: 0 }, { x: -100, y: 30 }),
			],
		};

		expect(buildRenderableWires(document)).toEqual([
			makeWire("main-1", { x: -130, y: 0 }, { x: -100, y: 0 }),
			makeWire("main-2", { x: -100, y: 0 }, { x: 0, y: 0 }),
			makeWire("branch", { x: -100, y: 0 }, { x: -100, y: 30 }),
		]);
	});
});

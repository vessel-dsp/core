import { describe, expect, test } from "bun:test";
import { findJunctions } from "../../packages/core/src/preview/junctions";
import type { Point, Wire } from "../../packages/core/src/model/types";

function makeWire(id: string, a: Point, b: Point): Wire {
	return { id, endpoints: [a, b] };
}

describe("findJunctions", () => {
	test("no junctions for two collinear endpoint-shared wires", () => {
		const wires = [
			makeWire("w1", { x: 0, y: 0 }, { x: 10, y: 0 }),
			makeWire("w2", { x: 10, y: 0 }, { x: 20, y: 0 }),
		];
		expect(findJunctions(wires, [])).toEqual([]);
	});

	test("no junctions for an L-corner where two wires share an endpoint", () => {
		const wires = [
			makeWire("w1", { x: 0, y: 0 }, { x: 10, y: 0 }),
			makeWire("w2", { x: 10, y: 0 }, { x: 10, y: 20 }),
		];
		expect(findJunctions(wires, [])).toEqual([]);
	});

	test("flags a T-junction where a wire endpoint sits on another wire mid-segment", () => {
		const wires = [
			makeWire("main", { x: -130, y: 0 }, { x: 0, y: 0 }),
			makeWire("branch", { x: -100, y: 0 }, { x: -100, y: 30 }),
		];
		const junctions = findJunctions(wires, []);
		expect(junctions).toHaveLength(1);
		expect(junctions[0]).toEqual({ x: -100, y: 0 });
	});

	test("flags a Y-junction where 3+ wires share an endpoint", () => {
		const wires = [
			makeWire("w1", { x: 0, y: 0 }, { x: 10, y: 0 }),
			makeWire("w2", { x: 0, y: 0 }, { x: 0, y: 10 }),
			makeWire("w3", { x: 0, y: 0 }, { x: -10, y: 0 }),
		];
		const junctions = findJunctions(wires, []);
		expect(junctions).toHaveLength(1);
		expect(junctions[0]).toEqual({ x: 0, y: 0 });
	});

	test("flags a branch junction even when it coincides with a terminal position", () => {
		const wires = [
			makeWire("main", { x: -130, y: 0 }, { x: 0, y: 0 }),
			makeWire("branch", { x: -100, y: 0 }, { x: -100, y: 30 }),
		];
		const junctions = findJunctions(wires, [{ x: -100, y: 0 }]);
		expect(junctions).toEqual([{ x: -100, y: 0 }]);
	});

	test("flags a terminal that lands directly on another wire mid-segment", () => {
		const wires = [makeWire("main", { x: -130, y: 0 }, { x: 0, y: 0 })];
		const junctions = findJunctions(wires, [{ x: -100, y: 0 }]);
		expect(junctions).toEqual([{ x: -100, y: 0 }]);
	});

	test("ignores endpoint hits exactly at segment endpoints", () => {
		const wires = [
			makeWire("w1", { x: 0, y: 0 }, { x: 20, y: 0 }),
			makeWire("w2", { x: 0, y: 0 }, { x: 0, y: 10 }),
		];
		// Two wires sharing endpoint (0,0) — this is an L-corner, not a T-junction.
		expect(findJunctions(wires, [])).toEqual([]);
	});
});

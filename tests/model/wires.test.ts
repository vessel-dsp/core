import { describe, expect, test } from "bun:test";
import { splitWiresAtJunctions } from "../../packages/core/src/model/wires";
import type { Point, Wire } from "../../packages/core/src/model/types";

function makeWire(id: string, a: Point, b: Point): Wire {
	return { id, endpoints: [a, b] };
}

describe("splitWiresAtJunctions", () => {
	test("leaves wires alone when there are no T-junctions", () => {
		const wires = [
			makeWire("w1", { x: 0, y: 0 }, { x: 10, y: 0 }),
			makeWire("w2", { x: 10, y: 0 }, { x: 10, y: 10 }),
		];
		const result = splitWiresAtJunctions(wires);
		expect(result).toHaveLength(2);
		expect(result[0]?.endpoints).toEqual(wires[0]!.endpoints);
		expect(result[1]?.endpoints).toEqual(wires[1]!.endpoints);
	});

	test("splits a long horizontal wire when another wire ends on its middle", () => {
		const wires = [
			makeWire("main", { x: -130, y: 0 }, { x: 0, y: 0 }),
			makeWire("branch", { x: -100, y: 0 }, { x: -100, y: 30 }),
		];
		const result = splitWiresAtJunctions(wires);
		expect(result).toHaveLength(3);
		const segments = result.filter((w) => w.id.startsWith("main"));
		expect(segments).toHaveLength(2);
		expect(segments[0]?.endpoints).toEqual([
			{ x: -130, y: 0 },
			{ x: -100, y: 0 },
		]);
		expect(segments[1]?.endpoints).toEqual([
			{ x: -100, y: 0 },
			{ x: 0, y: 0 },
		]);
	});

	test("splits a wire at multiple T-junctions in order along the segment", () => {
		const wires = [
			makeWire("rail", { x: -200, y: 100 }, { x: 0, y: 100 }),
			makeWire("a", { x: -150, y: 100 }, { x: -150, y: 130 }),
			makeWire("b", { x: -100, y: 100 }, { x: -100, y: 80 }),
		];
		const result = splitWiresAtJunctions(wires);
		const railSegments = result.filter((w) => w.id.startsWith("rail"));
		expect(railSegments).toHaveLength(3);
		expect(railSegments[0]?.endpoints).toEqual([
			{ x: -200, y: 100 },
			{ x: -150, y: 100 },
		]);
		expect(railSegments[1]?.endpoints).toEqual([
			{ x: -150, y: 100 },
			{ x: -100, y: 100 },
		]);
		expect(railSegments[2]?.endpoints).toEqual([
			{ x: -100, y: 100 },
			{ x: 0, y: 100 },
		]);
	});

	test("does not split when the touch is at an existing endpoint", () => {
		const wires = [
			makeWire("w1", { x: 0, y: 0 }, { x: 100, y: 0 }),
			makeWire("w2", { x: 100, y: 0 }, { x: 100, y: 100 }),
		];
		const result = splitWiresAtJunctions(wires);
		expect(result).toHaveLength(2);
	});
});

import { describe, expect, test } from "bun:test";
import {
	collectPorts,
	findNearestPort,
	findNearestWireBodyHit,
	type Port,
} from "../../packages/core/src/preview/ports";
import type { Component, Wire } from "../../packages/core/src/model/types";

function makeComponent(
	id: string,
	terminals: Array<[name: string, x: number, y: number]>,
): Component {
	return {
		id,
		kind: "resistor",
		name: id,
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: terminals.map(([name, x, y]) => ({ name, position: { x, y } })),
		properties: {},
		sourceTypeName: null,
	};
}

describe("collectPorts", () => {
	test("flattens every terminal into a Port entry", () => {
		const components = [
			makeComponent("R1", [
				["a", 0, 0],
				["b", 100, 0],
			]),
			makeComponent("C1", [
				["a", 0, 50],
				["b", 0, 100],
			]),
		];
		const ports = collectPorts(components);
		expect(ports).toHaveLength(4);
		expect(ports[0]).toEqual({
			componentId: "R1",
			terminalName: "a",
			position: { x: 0, y: 0 },
		});
		expect(ports[3]).toEqual({
			componentId: "C1",
			terminalName: "b",
			position: { x: 0, y: 100 },
		});
	});

	test("returns an empty array when there are no components", () => {
		expect(collectPorts([])).toEqual([]);
	});
});

describe("findNearestPort", () => {
	const ports: Port[] = [
		{ componentId: "R1", terminalName: "a", position: { x: 0, y: 0 } },
		{ componentId: "R1", terminalName: "b", position: { x: 100, y: 0 } },
		{ componentId: "C1", terminalName: "a", position: { x: 50, y: 30 } },
	];

	test("returns the closest port within the radius", () => {
		const result = findNearestPort(ports, { x: 5, y: 2 }, 12);
		expect(result?.componentId).toBe("R1");
		expect(result?.terminalName).toBe("a");
	});

	test("returns null when no port is within the radius", () => {
		const result = findNearestPort(ports, { x: 500, y: 500 }, 12);
		expect(result).toBeNull();
	});

	test("excludes the named port (for not snapping back to the wire-create start)", () => {
		// With R1.a excluded, the nearest port to (1,0) within radius 200 is C1.a
		// at (50,30) — distance ~58, vs R1.b at (100,0) distance 99.
		const result = findNearestPort(ports, { x: 1, y: 0 }, 200, {
			componentId: "R1",
			terminalName: "a",
		});
		expect(result?.componentId).toBe("C1");
	});

	test("excluded port still produces null when no other port is in range", () => {
		const result = findNearestPort(ports, { x: 1, y: 0 }, 12, {
			componentId: "R1",
			terminalName: "a",
		});
		expect(result).toBeNull();
	});

	test("uses Euclidean distance, picking the geometrically nearest port", () => {
		// (40, 25) is closer to C1.a (50,30) than to R1.a (0,0) — distance ~11 vs ~47.
		const result = findNearestPort(ports, { x: 40, y: 25 }, 20);
		expect(result?.componentId).toBe("C1");
	});

	test("ties go to whichever port is iterated first (deterministic)", () => {
		const tied: Port[] = [
			{ componentId: "R1", terminalName: "a", position: { x: 10, y: 0 } },
			{ componentId: "R2", terminalName: "a", position: { x: -10, y: 0 } },
		];
		const result = findNearestPort(tied, { x: 0, y: 0 }, 50);
		expect(result?.componentId).toBe("R1");
	});
});

describe("findNearestWireBodyHit", () => {
	const wires: Wire[] = [
		{
			id: "w_h",
			endpoints: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			],
		}, // horizontal
		{
			id: "w_v",
			endpoints: [
				{ x: 0, y: 50 },
				{ x: 0, y: 150 },
			],
		}, // vertical, far below
	];

	test("projects the cursor onto the closest wire's segment", () => {
		// Click at (40, 8) — just above the horizontal trunk. Projection onto
		// w_h is (40, 0); distance is 8, under the default radius.
		const hit = findNearestWireBodyHit(wires, { x: 40, y: 8 }, 12);
		expect(hit).not.toBeNull();
		expect(hit!.wireId).toBe("w_h");
		expect(hit!.position).toEqual({ x: 40, y: 0 });
	});

	test("returns null when the cursor is farther than the radius from every wire", () => {
		const hit = findNearestWireBodyHit(wires, { x: 500, y: 500 }, 12);
		expect(hit).toBeNull();
	});

	test("honors excludeWireId so the source wire of a drag is skipped", () => {
		const hit = findNearestWireBodyHit(wires, { x: 40, y: 8 }, 12, "w_h");
		// w_h is excluded; w_v is far away → null.
		expect(hit).toBeNull();
	});

	test("clamps the projection to the segment endpoints (no off-end snaps)", () => {
		// Click past the right end of w_h. Projection clamps to (100, 0); the
		// distance from (140, 5) to (100, 0) is ~40, way outside the radius.
		const hit = findNearestWireBodyHit(wires, { x: 140, y: 5 }, 12);
		expect(hit).toBeNull();
	});

	test("picks the wire whose body is closest, not just the first one", () => {
		// (5, 60) is inside w_v\'s y-range [50, 150] but also far below w_h.
		// Projection onto w_v is (0, 60); distance ~5. Projection onto w_h is
		// (5, 0); distance 60. w_v wins.
		const hit = findNearestWireBodyHit(wires, { x: 5, y: 60 }, 12);
		expect(hit!.wireId).toBe("w_v");
		expect(hit!.position).toEqual({ x: 0, y: 60 });
	});
});

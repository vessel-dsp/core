import { describe, expect, test } from "bun:test";
import { findSnap } from "../../packages/core/src/preview/snap";
import type { Component, Wire } from "../../packages/core/src/model/types";

function makeComponent(
	id: string,
	originX: number,
	originY: number,
	terminals: ReadonlyArray<[name: string, x: number, y: number]>,
): Component {
	return {
		id,
		kind: "resistor",
		name: id,
		origin: { x: originX, y: originY },
		rotation: 0,
		flipped: false,
		terminals: terminals.map(([name, x, y]) => ({ name, position: { x, y } })),
		properties: {},
		sourceTypeName: null,
	};
}

describe("findSnap", () => {
	test("returns the candidate origin unchanged when no other terminals are within range", () => {
		const dragged = makeComponent("R1", 0, 0, [
			["a", 0, -20],
			["b", 0, 20],
		]);
		const other = makeComponent("R2", 200, 0, [
			["a", 200, -20],
			["b", 200, 20],
		]);
		const result = findSnap(dragged, { x: 50, y: 50 }, [other]);
		expect(result.origin).toEqual({ x: 50, y: 50 });
		expect(result.snappedTo).toBeNull();
	});

	test("snaps to a nearby terminal when within radius", () => {
		const dragged = makeComponent("R1", 0, 0, [
			["a", 0, -20],
			["b", 0, 20],
		]);
		const other = makeComponent("R2", 50, 0, [["t", 50, 0]]);
		// Dragging R1 toward origin (50, 22): R1.b world becomes (50, 42), not close enough.
		// Dragging toward (50, 18): R1.b becomes (50, 38), still ~38 from R2.t.
		// Drag toward (50, 5): R1.b becomes (50, 25), 25 from R2.t — outside default radius 12.
		// Drag toward (50, -10): R1.b becomes (50, 10), 10 from R2.t at (50,0) → snap.
		const result = findSnap(dragged, { x: 50, y: -10 }, [other]);
		expect(result.snappedTo).toEqual({ x: 50, y: 0 });
		// After snap, R1.b should land exactly at (50, 0): origin = R1.b - local = (50, 0) - (0, 20) = (50, -20)
		expect(result.origin).toEqual({ x: 50, y: -20 });
	});

	test("picks the closest terminal among multiple candidates", () => {
		const dragged = makeComponent("R1", 0, 0, [["a", 0, 0]]);
		const farTerminal = makeComponent("R2", 100, 0, [["t", 100, 0]]);
		const nearTerminal = makeComponent("R3", 5, 3, [["t", 5, 3]]);
		const result = findSnap(dragged, { x: 8, y: 4 }, [
			farTerminal,
			nearTerminal,
		]);
		expect(result.snappedTo).toEqual({ x: 5, y: 3 });
	});

	test("skips the dragged component itself", () => {
		const dragged = makeComponent("R1", 0, 0, [
			["a", 0, -20],
			["b", 0, 20],
		]);
		const result = findSnap(dragged, { x: 0, y: 0 }, [dragged]);
		expect(result.snappedTo).toBeNull();
	});

	test("respects a custom snap radius", () => {
		const dragged = makeComponent("R1", 0, 0, [["a", 0, 0]]);
		const other = makeComponent("R2", 50, 0, [["t", 50, 0]]);
		// Drag toward (45, 0): dragged.a lands at (45, 0), distance 5 from (50,0).
		const tight = findSnap(dragged, { x: 45, y: 0 }, [other], 2);
		expect(tight.snappedTo).toBeNull();
		const loose = findSnap(dragged, { x: 45, y: 0 }, [other], 10);
		expect(loose.snappedTo).toEqual({ x: 50, y: 0 });
	});

	test("snaps a dragged terminal onto the middle of a nearby wire segment", () => {
		const dragged = makeComponent("R2", 0, 100, [["a", 0, 100]]);
		const mainWire: Wire = {
			id: "main",
			endpoints: [
				{ x: -130, y: 0 },
				{ x: 0, y: 0 },
			],
		};
		const result = findSnap(dragged, { x: -100, y: 7 }, [], 12, [mainWire]);
		expect(result.snappedTo).toEqual({ x: -100, y: 0 });
		expect(result.origin).toEqual({ x: -100, y: 0 });
	});

	test("does not snap to a wire already attached to the dragged component", () => {
		const dragged = makeComponent("R2", 0, 0, [["a", 0, 0]]);
		const attachedWire: Wire = {
			id: "attached",
			endpoints: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			],
		};
		const result = findSnap(dragged, { x: 40, y: 5 }, [], 12, [attachedWire]);
		expect(result.snappedTo).toBeNull();
	});
});

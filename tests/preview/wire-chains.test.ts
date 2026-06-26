import { describe, expect, test } from "bun:test";
import {
	findChainCorners,
	findWireChain,
} from "../../packages/core/src/preview/wire-chains";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type Wire,
} from "../../packages/core/src/model/types";

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

function makeWire(
	id: string,
	a: { x: number; y: number },
	b: { x: number; y: number },
): Wire {
	return { id, endpoints: [a, b] };
}

describe("findWireChain", () => {
	test("unknown wire id returns an empty chain", () => {
		expect(findWireChain("nope", EMPTY_DOCUMENT)).toEqual([]);
	});

	test("a single wire with terminal-anchored endpoints is its own chain", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [
					["a", 0, 0],
					["b", 100, 0],
				]),
			],
			wires: [makeWire("w1", { x: 0, y: 0 }, { x: 100, y: 0 })],
		};
		expect(findWireChain("w1", doc)).toEqual(["w1"]);
	});

	test("L-shape authored as two wires forms a single chain", () => {
		// R1.a (0,0) → (50,0) → (50,50) → R2.a (50,50). The corner at (50,0)
		// is shared by exactly two wires and has no terminal/T-junction → chain.
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 50, 50]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 50, y: 50 }),
			],
		};
		expect([...findWireChain("w1", doc)].sort()).toEqual(["w1", "w2"]);
		expect([...findWireChain("w2", doc)].sort()).toEqual(["w1", "w2"]);
	});

	test("chain extends transitively through multiple corners", () => {
		// Five-segment staircase: R1.a → (10,0) → (10,10) → (20,10) → (20,20) → R2.a.
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 20, 20]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 10, y: 0 }),
				makeWire("w2", { x: 10, y: 0 }, { x: 10, y: 10 }),
				makeWire("w3", { x: 10, y: 10 }, { x: 20, y: 10 }),
				makeWire("w4", { x: 20, y: 10 }, { x: 20, y: 20 }),
			],
		};
		expect([...findWireChain("w3", doc)].sort()).toEqual([
			"w1",
			"w2",
			"w3",
			"w4",
		]);
	});

	test("chain stops at a terminal-anchored endpoint mid-route", () => {
		// (0,0)→(50,0)→(50,50) but a terminal sits exactly at (50,0). The
		// chain must stop because that endpoint is anchored.
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 50, 0]]),
				makeComponent("R3", [["a", 50, 50]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 50, y: 50 }),
			],
		};
		expect(findWireChain("w1", doc)).toEqual(["w1"]);
		expect(findWireChain("w2", doc)).toEqual(["w2"]);
	});

	test("chain stops at a branch point (three wires sharing an endpoint)", () => {
		// Three wires fan out from (50,0). Even though no terminal is there,
		// the degree is 3, so it isn\'t a chain corner.
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 100, 0]]),
				makeComponent("R3", [["a", 50, 100]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 100, y: 0 }),
				makeWire("w3", { x: 50, y: 0 }, { x: 50, y: 100 }),
			],
		};
		expect(findWireChain("w1", doc)).toEqual(["w1"]);
		expect(findWireChain("w2", doc)).toEqual(["w2"]);
		expect(findWireChain("w3", doc)).toEqual(["w3"]);
	});

	test("chain stops at a T-junction (endpoint lies on a third wire's body)", () => {
		// w1 and w2 share (50, 0), but w3 has body crossing (50, 0). That makes
		// (50,0) a T-junction, so w1 and w2 should not be in the same chain.
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 50, 50]]),
				makeComponent("R3", [
					["a", 30, 0],
					["b", 70, 0],
				]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 50, y: 50 }),
				makeWire("w3_trunk", { x: 30, y: 0 }, { x: 70, y: 0 }),
			],
		};
		// (50, 0) is shared by w1 and w2, but lies on w3_trunk\'s body. Chain breaks.
		expect(findWireChain("w1", doc)).toEqual(["w1"]);
		expect(findWireChain("w2", doc)).toEqual(["w2"]);
	});
});

describe("findChainCorners", () => {
	test("empty doc has no corners", () => {
		expect(findChainCorners(EMPTY_DOCUMENT)).toEqual([]);
	});

	test("exposes the single corner of an L-shape", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 50, 50]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 50, y: 50 }),
			],
		};
		expect(findChainCorners(doc)).toEqual([{ x: 50, y: 0 }]);
	});

	test("exposes every interior corner of a staircase, but no terminals", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 20, 20]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 10, y: 0 }),
				makeWire("w2", { x: 10, y: 0 }, { x: 10, y: 10 }),
				makeWire("w3", { x: 10, y: 10 }, { x: 20, y: 10 }),
				makeWire("w4", { x: 20, y: 10 }, { x: 20, y: 20 }),
			],
		};
		const corners = findChainCorners(doc);
		expect(corners.map((p) => `${p.x},${p.y}`).sort()).toEqual([
			"10,0",
			"10,10",
			"20,10",
		]);
	});

	test("skips branch points and terminals", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 100, 0]]),
				makeComponent("R3", [["a", 50, 100]]),
				makeComponent("GND", [["t", 50, 0]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 100, y: 0 }),
				makeWire("w3", { x: 50, y: 0 }, { x: 50, y: 100 }),
			],
		};
		// (50, 0) is degree-3 AND a terminal — definitely not a corner.
		expect(findChainCorners(doc)).toEqual([]);
	});
});

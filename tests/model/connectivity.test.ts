import { describe, expect, test } from "bun:test";
import {
	getPinNode,
	pinKey,
	resolveConnectivity,
} from "../../packages/core/src/model/connectivity";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type ComponentKind,
	type Point,
	type Wire,
} from "../../packages/core/src/model/types";

function makeComponent(
	id: string,
	kind: ComponentKind,
	terminals: ReadonlyArray<[name: string, x: number, y: number]>,
): Component {
	return {
		id,
		kind,
		name: id,
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: terminals.map(([name, x, y]) => ({ name, position: { x, y } })),
		properties: {},
		sourceTypeName: null,
	};
}

function makeWire(id: string, a: Point, b: Point): Wire {
	return { id, endpoints: [a, b] };
}

function withParts(
	components: readonly Component[],
	wires: readonly Wire[] = [],
): CircuitDocument {
	return { ...EMPTY_DOCUMENT, components, wires };
}

describe("resolveConnectivity", () => {
	test("empty document has no nodes and no ground", () => {
		const result = resolveConnectivity(EMPTY_DOCUMENT);
		expect(result.nodeCount).toBe(0);
		expect(result.groundNodeId).toBeNull();
		expect(result.pinToNode.size).toBe(0);
	});

	test("single 2-terminal R with no wires yields 2 distinct nodes", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", [
				["a", 0, 10],
				["b", 0, -10],
			]),
		]);
		const result = resolveConnectivity(doc);
		expect(result.nodeCount).toBe(2);
		const a = getPinNode(result, { componentId: "R1", terminalName: "a" });
		const b = getPinNode(result, { componentId: "R1", terminalName: "b" });
		expect(a).not.toBeUndefined();
		expect(b).not.toBeUndefined();
		expect(a).not.toBe(b);
	});

	test("two resistors joined by a single wire share one node", () => {
		const doc = withParts(
			[
				makeComponent("R1", "resistor", [
					["a", 0, 10],
					["b", 0, 0],
				]),
				makeComponent("R2", "resistor", [
					["a", 20, 0],
					["b", 20, -10],
				]),
			],
			[makeWire("w1", { x: 0, y: 0 }, { x: 20, y: 0 })],
		);
		const result = resolveConnectivity(doc);
		expect(result.nodeCount).toBe(3);
		const r1b = getPinNode(result, { componentId: "R1", terminalName: "b" });
		const r2a = getPinNode(result, { componentId: "R2", terminalName: "a" });
		expect(r1b).toBe(r2a);
	});

	test("explicit ground component anchors node 0", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", [
				["a", 0, 20],
				["b", 0, 0],
			]),
			makeComponent("C1", "capacitor", [
				["a", 0, 0],
				["b", 0, -20],
			]),
			makeComponent("GND", "ground", [["t", 0, -20]]),
		]);
		const result = resolveConnectivity(doc);
		expect(result.groundNodeId).toBe(0);
		expect(getPinNode(result, { componentId: "C1", terminalName: "b" })).toBe(
			0,
		);
		expect(getPinNode(result, { componentId: "GND", terminalName: "t" })).toBe(
			0,
		);
		expect(result.nodeCount).toBe(3);
	});

	test("multiple ground components unify to a single node 0", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", [
				["a", 0, 0],
				["b", 0, 10],
			]),
			makeComponent("GND1", "ground", [["t", 0, 0]]),
			makeComponent("R2", "resistor", [
				["a", 10, 0],
				["b", 10, 10],
			]),
			makeComponent("GND2", "ground", [["t", 10, 0]]),
		]);
		const result = resolveConnectivity(doc);
		expect(getPinNode(result, { componentId: "R1", terminalName: "a" })).toBe(
			0,
		);
		expect(getPinNode(result, { componentId: "R2", terminalName: "a" })).toBe(
			0,
		);
		expect(getPinNode(result, { componentId: "GND1", terminalName: "t" })).toBe(
			0,
		);
		expect(getPinNode(result, { componentId: "GND2", terminalName: "t" })).toBe(
			0,
		);
		expect(result.nodeCount).toBe(3);
	});

	test("wire chain merges three components into one node", () => {
		const doc = withParts(
			[
				makeComponent("R1", "resistor", [
					["a", 0, 0],
					["b", 0, 10],
				]),
				makeComponent("R2", "resistor", [
					["a", 10, 0],
					["b", 10, 10],
				]),
				makeComponent("R3", "resistor", [
					["a", 20, 0],
					["b", 20, 10],
				]),
			],
			[
				makeWire("w1", { x: 0, y: 0 }, { x: 10, y: 0 }),
				makeWire("w2", { x: 10, y: 0 }, { x: 20, y: 0 }),
			],
		);
		const result = resolveConnectivity(doc);
		const shared = getPinNode(result, { componentId: "R1", terminalName: "a" });
		expect(shared).toBeDefined();
		expect(getPinNode(result, { componentId: "R2", terminalName: "a" })).toBe(
			shared!,
		);
		expect(getPinNode(result, { componentId: "R3", terminalName: "a" })).toBe(
			shared!,
		);
		expect(result.nodeCount).toBe(4);
	});

	test("coincident terminals without a wire still share a node", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", [
				["a", 5, 5],
				["b", 5, 15],
			]),
			makeComponent("R2", "resistor", [
				["a", 5, 5],
				["b", 5, -5],
			]),
		]);
		const result = resolveConnectivity(doc);
		const r1a = getPinNode(result, { componentId: "R1", terminalName: "a" });
		const r2a = getPinNode(result, { componentId: "R2", terminalName: "a" });
		expect(r1a).toBe(r2a);
		expect(result.nodeCount).toBe(3);
	});

	test("multi-terminal opamp with partial wiring assigns distinct nodes per pin", () => {
		const doc = withParts(
			[
				makeComponent("U1", "opamp", [
					["vin+", 0, 10],
					["vin-", 0, -10],
					["vout", 30, 0],
					["vcc", 15, 20],
					["vee", 15, -20],
				]),
				makeComponent("R1", "resistor", [
					["a", 0, 10],
					["b", -20, 10],
				]),
			],
			[],
		);
		const result = resolveConnectivity(doc);
		const r1a = getPinNode(result, { componentId: "R1", terminalName: "a" });
		const vinPlus = getPinNode(result, {
			componentId: "U1",
			terminalName: "vin+",
		});
		expect(r1a).toBe(vinPlus);
		expect(result.nodeCount).toBe(6);
	});

	test("pinKey is stable for serialization", () => {
		expect(pinKey({ componentId: "R1", terminalName: "a" })).toBe("R1:a");
	});

	test("T-junction: a wire endpoint that lies on another wire mid-segment unifies their nodes", () => {
		const doc = withParts(
			[
				makeComponent("R1", "resistor", [
					["a", -130, 0],
					["b", -170, 0],
				]),
				makeComponent("R2", "resistor", [
					["a", -100, 30],
					["b", -100, 70],
				]),
				makeComponent("O1", "jack", [
					["a", 0, 30],
					["b", 0, 70],
				]),
			],
			[
				makeWire("main", { x: -130, y: 0 }, { x: 0, y: 0 }),
				makeWire("branch", { x: -100, y: 0 }, { x: -100, y: 30 }),
				makeWire("o1-up", { x: 0, y: 0 }, { x: 0, y: 30 }),
			],
		);
		const result = resolveConnectivity(doc);
		const r1a = getPinNode(result, { componentId: "R1", terminalName: "a" });
		const r2a = getPinNode(result, { componentId: "R2", terminalName: "a" });
		const o1a = getPinNode(result, { componentId: "O1", terminalName: "a" });
		expect(r1a).toBe(r2a);
		expect(r1a).toBe(o1a);
	});
});

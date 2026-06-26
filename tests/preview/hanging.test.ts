import { describe, expect, test } from "bun:test";
import { findHangingEndpoints } from "../../packages/core/src/preview/hanging";
import { parseSchx } from "../../packages/core/src/formats/schx/parser";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type Wire,
} from "../../packages/core/src/model/types";

async function loadFixture(name: string): Promise<CircuitDocument> {
	const url = new URL(`../fixtures/schx/${name}.schx`, import.meta.url);
	return parseSchx(await Bun.file(url).text());
}

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

describe("findHangingEndpoints", () => {
	test("empty document has no hanging endpoints", () => {
		expect(findHangingEndpoints(EMPTY_DOCUMENT)).toEqual([]);
	});

	test("wire whose endpoints both land on terminals is not hanging", () => {
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
		expect(findHangingEndpoints(doc)).toEqual([]);
	});

	test("wire with a single hanging endpoint flags only that endpoint", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [makeComponent("R1", [["a", 0, 0]])],
			wires: [makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 })],
		};
		const hanging = findHangingEndpoints(doc);
		expect(hanging).toHaveLength(1);
		expect(hanging[0]!).toEqual({
			wireId: "w1",
			point: { x: 50, y: 0 },
			endpointIndex: 1,
		});
	});

	test("endpoints shared between two wires are not hanging", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 100, 100]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 100, y: 100 }),
			],
		};
		expect(findHangingEndpoints(doc)).toEqual([]);
	});

	test("endpoint sitting on another wire's body (T-junction) is not hanging", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 100, 0]]),
				makeComponent("R3", [["a", 50, 50]]),
			],
			wires: [
				makeWire("w_main", { x: 0, y: 0 }, { x: 100, y: 0 }),
				makeWire("w_tap", { x: 50, y: 0 }, { x: 50, y: 50 }),
			],
		};
		expect(findHangingEndpoints(doc)).toEqual([]);
	});

	test("three wires meeting at a shared point are all considered connected", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("R1", [["a", 0, 0]]),
				makeComponent("R2", [["a", 100, 0]]),
				makeComponent("R3", [["a", 50, 50]]),
			],
			wires: [
				makeWire("w1", { x: 0, y: 0 }, { x: 50, y: 0 }),
				makeWire("w2", { x: 50, y: 0 }, { x: 100, y: 0 }),
				makeWire("w3", { x: 50, y: 0 }, { x: 50, y: 50 }),
			],
		};
		expect(findHangingEndpoints(doc)).toEqual([]);
	});

	test("curated SPDT bypass fixture has no hanging endpoints", async () => {
		const doc = await loadFixture("spdt-bypass-pedal");
		expect(findHangingEndpoints(doc)).toEqual([]);
	});

	test("curated 3PDT true-bypass fixture has no hanging endpoints", async () => {
		const doc = await loadFixture("3pdt-true-bypass-pedal");
		expect(findHangingEndpoints(doc)).toEqual([]);
	});
});

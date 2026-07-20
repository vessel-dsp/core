import { describe, expect, it } from "bun:test";
import { type Connectivity, type PinRef, pinKey } from "./connectivity";
import {
	validatePreferredValues,
	validateRcCornerHeuristic,
	validateTracePlausibility,
	validateTraceStructure,
} from "./trace-plausibility";
import type { CircuitDocument, Component } from "./types";

function comp(id: string, kind: string, props: Record<string, unknown>, terms: string[]): Component {
	return {
		id, kind, name: id,
		origin: { x: 0, y: 0 }, rotation: 0, flipped: false,
		terminals: terms.map((name) => ({ name, position: { x: 0, y: 0 } })),
		properties: props,
	} as unknown as Component;
}
function doc(components: Component[]): CircuitDocument {
	return { components, wires: [] } as unknown as CircuitDocument;
}
function conn(nodes: Record<number, PinRef[]>, groundNodeId: number | null): Connectivity {
	const nodeMembers = new Map<number, PinRef[]>();
	const pinToNode = new Map<string, number>();
	for (const [nidStr, members] of Object.entries(nodes)) {
		const nid = Number(nidStr);
		nodeMembers.set(nid, members);
		for (const m of members) pinToNode.set(pinKey(m), nid);
	}
	return { pinToNode, nodeMembers, groundNodeId, nodeCount: nodeMembers.size };
}
const R = (id: string, ohms: string) => comp(id, "resistor", { Resistance: ohms }, ["a", "b"]);
const C = (id: string, farads: string) => comp(id, "capacitor", { Capacitance: farads }, ["a", "b"]);
const V = (id: string) => comp(id, "voltage-source", {}, ["pos", "neg"]);
const pin = (componentId: string, terminalName: string): PinRef => ({ componentId, terminalName });

const dividerNets = (r2ohms: string) => ({
	d: doc([V("VCC"), R("R1", "22000"), R("R2", r2ohms)]),
	c: conn(
		{
			0: [pin("VCC", "neg"), pin("R2", "b")],
			1: [pin("VCC", "pos"), pin("R1", "a")],
			2: [pin("R1", "b"), pin("R2", "a")],
		},
		0,
	),
});

describe("validateTraceStructure (default, coverage-gated)", () => {
	it("flags a bias-divider magnitude slip on complete connectivity", () => {
		const { d, c } = dividerNets("22000000");
		const issues = validateTracePlausibility(d, { connectivity: c });
		expect(issues.some((i) => i.code === "trace-divider-asymmetry")).toBe(true);
		expect(issues.some((i) => i.code === "trace-connectivity-incomplete")).toBe(false);
	});

	it("does NOT flag a symmetric divider", () => {
		const { d, c } = dividerNets("22000");
		expect(
			validateTracePlausibility(d, { connectivity: c }).some((i) => i.code === "trace-divider-asymmetry"),
		).toBe(false);
	});

	it("flags a floating passive when the gate is disabled", () => {
		const d = doc([R("R1", "10000")]);
		const c = conn({ 5: [pin("R1", "a")], 0: [pin("R1", "b")] }, 0);
		const issues = validateTraceStructure(d, { connectivity: c, requiredCompleteness: 0 });
		expect(issues.some((i) => i.code === "trace-floating-node")).toBe(true);
	});

	it("FAILS CLOSED on incomplete connectivity: emits incomplete note, no floating spam", () => {
		const d = doc([R("R1", "10000")]);
		const c = conn({ 5: [pin("R1", "a")], 0: [pin("R1", "b")] }, 0); // both singletons -> 0% complete
		const issues = validateTraceStructure(d, { connectivity: c }); // default 0.9 gate
		expect(issues.some((i) => i.code === "trace-connectivity-incomplete")).toBe(true);
		expect(issues.some((i) => i.code === "trace-floating-node")).toBe(false);
	});
});

describe("validatePreferredValues (opt-in, connectivity-independent)", () => {
	it("does NOT flag a standard 10pF cap (E24 normalization regression for the 1e-11 bug)", () => {
		expect(validatePreferredValues(doc([C("C1", "10pF")])).length).toBe(0);
	});
	it("flags a genuinely non-E24 value", () => {
		expect(
			validatePreferredValues(doc([R("R1", "14000")])).some((i) => i.code === "trace-nonstandard-value"),
		).toBe(true);
	});
	it("is OFF by default in validateTracePlausibility", () => {
		const { d, c } = dividerNets("22000");
		const issues = validateTracePlausibility(d, { connectivity: c }); // no includePreferredValue
		expect(issues.some((i) => i.code === "trace-nonstandard-value")).toBe(false);
	});
});

describe("validateRcCornerHeuristic (opt-in, rough)", () => {
	it("flags an out-of-band RC when explicitly run", () => {
		const d = doc([C("CIN", "100u"), R("RL", "10000")]);
		const c = conn({ 3: [pin("CIN", "b"), pin("RL", "a")], 4: [pin("CIN", "a")], 0: [pin("RL", "b")] }, 0);
		expect(
			validateRcCornerHeuristic(d, { connectivity: c }).some((i) => i.code === "trace-rc-corner"),
		).toBe(true);
	});
	it("is OFF by default in validateTracePlausibility", () => {
		const d = doc([C("CIN", "100u"), R("RL", "10000")]);
		const c = conn({ 3: [pin("CIN", "b"), pin("RL", "a")], 4: [pin("CIN", "a")], 0: [pin("RL", "b")] }, 0);
		expect(
			validateTracePlausibility(d, { connectivity: c }).some((i) => i.code === "trace-rc-corner"),
		).toBe(false);
	});
});

// Mandatory regression for the audio-admission pass (not yet implemented). The
// static linter provably cannot catch this in-band value slip (1n and 1u both
// give an in-band RC corner); a dynamic audio-admission pass MUST reject it.
it.todo("audio admission rejects the fulltone-ocd 1n->1u clipper-cap mutation", () => {
	// Pending: implement the bounded audio-admission pass (simulation-backed),
	// then assert it rejects the 1n->1u clip-cap mutation the static linter cannot catch.
});

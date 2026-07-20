import { describe, expect, it } from "bun:test";
import { type Connectivity, type PinRef, pinKey } from "./connectivity";
import {
	validateAudioTopologyWarnings,
	validatePreferredValues,
	validateRcCornerHeuristic,
	validateTracePlausibility,
	validateTraceStructure,
} from "./trace-plausibility";
import type { CircuitDocument, Component } from "./types";

function comp(
	id: string,
	kind: string,
	props: Record<string, unknown>,
	terms: string[],
): Component {
	return {
		id,
		kind,
		name: id,
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: terms.map((name) => ({ name, position: { x: 0, y: 0 } })),
		properties: props,
	} as unknown as Component;
}
function doc(components: Component[]): CircuitDocument {
	return { components, wires: [] } as unknown as CircuitDocument;
}
function conn(
	nodes: Record<number, PinRef[]>,
	groundNodeId: number | null,
): Connectivity {
	const nodeMembers = new Map<number, PinRef[]>();
	const pinToNode = new Map<string, number>();
	for (const [nidStr, members] of Object.entries(nodes)) {
		const nid = Number(nidStr);
		nodeMembers.set(nid, members);
		for (const m of members) pinToNode.set(pinKey(m), nid);
	}
	return { pinToNode, nodeMembers, groundNodeId, nodeCount: nodeMembers.size };
}
const R = (id: string, ohms: string) =>
	comp(id, "resistor", { Resistance: ohms }, ["a", "b"]);
const C = (id: string, farads: string) =>
	comp(id, "capacitor", { Capacitance: farads }, ["a", "b"]);
const V = (id: string) => comp(id, "voltage-source", {}, ["pos", "neg"]);
const pin = (componentId: string, terminalName: string): PinRef => ({
	componentId,
	terminalName,
});

function ocdTopology(capacitance: string) {
	const d = doc([
		comp("GND", "ground", {}, ["terminal"]),
		comp("IN", "jack", { Role: "input" }, ["tip", "sleeve"]),
		comp("OUT", "jack", { Role: "output" }, ["tip", "sleeve"]),
		R("R_CLIP_IN", "10k"),
		C("C_CLIP_BIAS", capacitance),
		R("R_BIAS_TOP", "10k"),
		R("R_BIAS_BOTTOM", "10k"),
		C("C_BIAS", "47uF"),
		comp("V9", "rail", {}, ["terminal"]),
		comp("LEVEL", "potentiometer", { Resistance: "100k" }, [
			"top",
			"wiper",
			"bottom",
		]),
	]);
	const c = conn(
		{
			0: [
				pin("GND", "terminal"),
				pin("IN", "sleeve"),
				pin("OUT", "sleeve"),
				pin("R_BIAS_BOTTOM", "b"),
				pin("C_BIAS", "b"),
				pin("LEVEL", "bottom"),
			],
			1: [pin("IN", "tip"), pin("R_CLIP_IN", "a")],
			2: [pin("R_CLIP_IN", "b"), pin("C_CLIP_BIAS", "a"), pin("LEVEL", "top")],
			3: [
				pin("C_CLIP_BIAS", "b"),
				pin("R_BIAS_TOP", "b"),
				pin("R_BIAS_BOTTOM", "a"),
				pin("C_BIAS", "a"),
			],
			4: [pin("R_BIAS_TOP", "a"), pin("V9", "terminal")],
			5: [pin("LEVEL", "wiper"), pin("OUT", "tip")],
		},
		0,
	);
	return {
		d,
		options: {
			connectivity: c,
			nodeRoles: new Map([
				[0, "ground"],
				[1, "signal"],
				[2, "signal"],
				[3, "bias"],
				[4, "power"],
				[5, "output"],
			]),
		},
	};
}

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
		expect(issues.some((i) => i.code === "trace-connectivity-incomplete")).toBe(
			false,
		);
	});

	it("does NOT flag a symmetric divider", () => {
		const { d, c } = dividerNets("22000");
		expect(
			validateTracePlausibility(d, { connectivity: c }).some(
				(i) => i.code === "trace-divider-asymmetry",
			),
		).toBe(false);
	});

	it("flags a floating passive when the gate is disabled", () => {
		const d = doc([R("R1", "10000")]);
		const c = conn({ 5: [pin("R1", "a")], 0: [pin("R1", "b")] }, 0);
		const issues = validateTraceStructure(d, {
			connectivity: c,
			requiredCompleteness: 0,
		});
		expect(issues.some((i) => i.code === "trace-floating-node")).toBe(true);
	});

	it("FAILS CLOSED on incomplete connectivity: emits incomplete note, no floating spam", () => {
		const d = doc([R("R1", "10000")]);
		const c = conn({ 5: [pin("R1", "a")], 0: [pin("R1", "b")] }, 0); // both singletons -> 0% complete
		const issues = validateTraceStructure(d, { connectivity: c }); // default 0.9 gate
		expect(issues.some((i) => i.code === "trace-connectivity-incomplete")).toBe(
			true,
		);
		expect(issues.some((i) => i.code === "trace-floating-node")).toBe(false);
	});
});

describe("validatePreferredValues (opt-in, connectivity-independent)", () => {
	it("does NOT flag a standard 10pF cap (E24 normalization regression for the 1e-11 bug)", () => {
		expect(validatePreferredValues(doc([C("C1", "10pF")])).length).toBe(0);
	});
	it("flags a genuinely non-E24 value", () => {
		expect(
			validatePreferredValues(doc([R("R1", "14000")])).some(
				(i) => i.code === "trace-nonstandard-value",
			),
		).toBe(true);
	});
	it("is OFF by default in validateTracePlausibility", () => {
		const { d, c } = dividerNets("22000");
		const issues = validateTracePlausibility(d, { connectivity: c }); // no includePreferredValue
		expect(issues.some((i) => i.code === "trace-nonstandard-value")).toBe(
			false,
		);
	});
});

describe("validateRcCornerHeuristic (opt-in, rough)", () => {
	it("flags an out-of-band RC when explicitly run", () => {
		const d = doc([C("CIN", "100u"), R("RL", "10000")]);
		const c = conn(
			{
				3: [pin("CIN", "b"), pin("RL", "a")],
				4: [pin("CIN", "a")],
				0: [pin("RL", "b")],
			},
			0,
		);
		expect(
			validateRcCornerHeuristic(d, { connectivity: c }).some(
				(i) => i.code === "trace-rc-corner",
			),
		).toBe(true);
	});
	it("is OFF by default in validateTracePlausibility", () => {
		const d = doc([C("CIN", "100u"), R("RL", "10000")]);
		const c = conn(
			{
				3: [pin("CIN", "b"), pin("RL", "a")],
				4: [pin("CIN", "a")],
				0: [pin("RL", "b")],
			},
			0,
		);
		expect(
			validateTracePlausibility(d, { connectivity: c }).some(
				(i) => i.code === "trace-rc-corner",
			),
		).toBe(false);
	});
});

describe("validateAudioTopologyWarnings (opt-in, advisory)", () => {
	it("keeps the clean OCD shunt quiet and warns on the 1nF -> 1uF mutation", () => {
		const clean = ocdTopology("1nF");
		const mutated = ocdTopology("1uF");
		expect(
			validateAudioTopologyWarnings(clean.d, clean.options).some(
				(issue) => issue.code === "trace-audio-shunt-extreme",
			),
		).toBe(false);
		const issue = validateAudioTopologyWarnings(
			mutated.d,
			mutated.options,
		).find((item) => item.code === "trace-audio-shunt-extreme");
		expect(issue?.componentId).toBe("C_CLIP_BIAS");
		expect(issue?.message).toContain("R_CLIP_IN and C_CLIP_BIAS");
		expect(issue?.message).toContain("-36.0 dB at 1 kHz");
	});

	it("does not run the OCD warning in the aggregate default", () => {
		const mutated = ocdTopology("1uF");
		expect(
			validateTracePlausibility(mutated.d, mutated.options).some(
				(issue) => issue.code === "trace-audio-shunt-extreme",
			),
		).toBe(false);
		expect(
			validateTracePlausibility(mutated.d, {
				...mutated.options,
				includeAudioTopology: true,
			}).some((issue) => issue.code === "trace-audio-shunt-extreme"),
		).toBe(true);
	});

	it("runs locally complete audio checks when unrelated document pins are incomplete", () => {
		const mutated = ocdTopology("1uF");
		const d = doc([
			...mutated.d.components,
			comp("UNRESOLVED_IC", "ic", {}, ["p1", "p2", "p3", "p4"]),
		]);
		const issues = validateTracePlausibility(d, {
			...mutated.options,
			includeAudioTopology: true,
		});
		expect(
			issues.some((issue) => issue.code === "trace-connectivity-incomplete"),
		).toBe(true);
		expect(
			issues.some((issue) => issue.code === "trace-audio-shunt-extreme"),
		).toBe(true);
	});

	it("warns on an extreme resistor directly across the audio input", () => {
		const d = doc([
			comp("GND", "ground", {}, ["terminal"]),
			comp("IN", "jack", { Role: "input" }, ["tip", "sleeve"]),
			comp("OUT", "jack", { Role: "output" }, ["tip", "sleeve"]),
			R("R_INPUT", "68"),
			R("R_PATH", "10k"),
		]);
		const c = conn(
			{
				0: [
					pin("GND", "terminal"),
					pin("IN", "sleeve"),
					pin("OUT", "sleeve"),
					pin("R_INPUT", "b"),
				],
				1: [pin("IN", "tip"), pin("R_INPUT", "a"), pin("R_PATH", "a")],
				2: [pin("R_PATH", "b"), pin("OUT", "tip")],
			},
			0,
		);
		expect(
			validateAudioTopologyWarnings(d, { connectivity: c }).some(
				(issue) => issue.code === "trace-input-loading-extreme",
			),
		).toBe(true);
	});

	it("warns only when an explicit audio buffer lacks passive feedback", () => {
		const makeCase = (includeFeedback: boolean) => {
			const components = [
				comp("GND", "ground", {}, ["terminal"]),
				comp("IN", "jack", { Role: "input" }, ["tip", "sleeve"]),
				comp("OUT", "jack", { Role: "output" }, ["tip", "sleeve"]),
				comp("U1", "opamp", { Role: "input-buffer" }, [
					"positive",
					"negative",
					"out",
				]),
				R("R_RETURN", "10k"),
				...(includeFeedback ? [R("R_FEEDBACK", "100k")] : []),
			];
			return {
				d: doc(components),
				c: conn(
					{
						0: [
							pin("GND", "terminal"),
							pin("IN", "sleeve"),
							pin("OUT", "sleeve"),
							pin("R_RETURN", "b"),
						],
						1: [pin("IN", "tip"), pin("U1", "positive")],
						2: [
							pin("U1", "negative"),
							pin("R_RETURN", "a"),
							...(includeFeedback ? [pin("R_FEEDBACK", "b")] : []),
						],
						3: [
							pin("U1", "out"),
							pin("OUT", "tip"),
							...(includeFeedback ? [pin("R_FEEDBACK", "a")] : []),
						],
					},
					0,
				),
			};
		};
		const open = makeCase(false);
		const closed = makeCase(true);
		expect(
			validateAudioTopologyWarnings(open.d, { connectivity: open.c }).some(
				(issue) => issue.code === "trace-opamp-feedback-open",
			),
		).toBe(true);
		expect(
			validateAudioTopologyWarnings(closed.d, { connectivity: closed.c }).some(
				(issue) => issue.code === "trace-opamp-feedback-open",
			),
		).toBe(false);
	});

	it("does not treat a disconnected LFO reference as an audio shunt", () => {
		const base = ocdTopology("1nF");
		const d = doc([
			...base.d.components,
			R("R_LFO_TOP", "15k"),
			R("R_LFO_BOTTOM", "3.3k"),
			C("C_LFO", "1uF"),
		]);
		const baseConn = base.options.connectivity;
		const c = conn(
			{
				...Object.fromEntries(baseConn.nodeMembers),
				6: [pin("R_LFO_TOP", "b"), pin("R_LFO_BOTTOM", "a"), pin("C_LFO", "a")],
				0: [
					...(baseConn.nodeMembers.get(0) ?? []),
					pin("R_LFO_BOTTOM", "b"),
					pin("C_LFO", "b"),
				],
				4: [...(baseConn.nodeMembers.get(4) ?? []), pin("R_LFO_TOP", "a")],
			},
			0,
		);
		const issues = validateAudioTopologyWarnings(d, {
			connectivity: c,
			nodeRoles: new Map([...base.options.nodeRoles, [6, "bias"]]),
		});
		expect(issues.some((issue) => issue.componentId === "C_LFO")).toBe(false);
	});
});

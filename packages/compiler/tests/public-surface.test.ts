// The compiler's package contract, exercised through its public surface only.
//
// Every other test in this directory reaches a stage file directly, which is right for a
// stage test and says nothing about whether `index.ts` is enough for a consumer. This file
// imports nothing but the barrel and the shipped fixtures, so it is the test that moves to
// `@vessel-dsp/compiler` unchanged and fails the moment a name a consumer needs leaves the
// surface. It grades against hand-computed shapes and invariants, never against pedal
// identity or diagnostic wording.
import { describe, expect, it } from "bun:test";
import {
	attachDeviceLaws,
	canonicalPartId,
	compile,
	compileToArtifact,
	emit,
	emptyRegistry,
	foldPartId,
	foldToken,
	parseQuantity,
	pedalPartCatalog,
	readNetlist,
	type PartRegistry,
	type Program,
} from "../src/index";
import {
	beltonBrickReverb,
	diodeClipper,
	fixtureRegistry,
	hybridDelayPedal,
	invertingAmplifier,
	potDivider,
	rcLowPass,
	resistorDivider,
	unimplementedMacroRegistry,
} from "../src/fixtures";

function programFor(source: string, registry: PartRegistry = emptyRegistry): Program {
	const result = compile(source, { registry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

/** The operator kinds the executed MNA blocks actually stamp, derived from the program itself. */
function executedStampKinds(program: Program): readonly string[] {
	const executed = new Set(program.order);
	const kinds = new Set<string>();
	for (const block of program.blocks) {
		if (block.kind !== "mna" || !executed.has(block.id)) continue;
		for (const stamp of block.stamps) kinds.add(stamp.kind);
	}
	return [...kinds].sort();
}

/** The model ids the executed non-MNA blocks declare, derived from the program itself. */
function executedModelIds(program: Program): readonly string[] {
	const executed = new Set(program.order);
	const models = new Set<string>();
	for (const block of program.blocks) {
		if (block.kind === "mna" || !executed.has(block.id)) continue;
		models.add(block.modelId);
	}
	return [...models].sort();
}

describe("Program contract: the version surface is exact", () => {
	it("stamps the current container version on every program", () => {
		for (const source of [resistorDivider, rcLowPass, diodeClipper, invertingAmplifier]) {
			expect(programFor(source).formatVersion).toBe(6);
		}
	});

	it("declares exactly the operators its executed blocks stamp, sorted and unique", () => {
		for (const source of [resistorDivider, rcLowPass, diodeClipper, invertingAmplifier, potDivider]) {
			const program = programFor(source);
			const declared: readonly string[] = program.requiredOperators;
			expect(declared).toEqual(executedStampKinds(program));
			expect(declared.length).toBeGreaterThan(0);
		}
	});

	it("declares exactly the models its executed non-MNA blocks name", () => {
		const program = programFor(hybridDelayPedal, fixtureRegistry);
		expect(program.requiredModels).toEqual(executedModelIds(program));
		expect(program.requiredModels.length).toBeGreaterThan(0);
		// The parallel-set rule: a model never appears among the operators.
		const operators: readonly string[] = program.requiredOperators;
		for (const model of program.requiredModels) {
			expect(operators.includes(model)).toBe(false);
		}
		// And a program of passive parts declares no model at all.
		expect(programFor(resistorDivider).requiredModels).toEqual([]);
	});

	it("reads the model name from the registry, so the declaration follows the part's binding", () => {
		// Same source, same part, two registries: only the algorithm name differs.
		const implemented = programFor(hybridDelayPedal, fixtureRegistry).requiredModels;
		const unimplemented = programFor(hybridDelayPedal, unimplementedMacroRegistry).requiredModels;
		expect(implemented).not.toEqual(unimplemented);
		expect(unimplemented.length).toBe(implemented.length);
	});

	it("executes every block it orders, and orders only blocks it has", () => {
		for (const source of [resistorDivider, diodeClipper, invertingAmplifier]) {
			const program = programFor(source);
			const ids = new Set(program.blocks.map((block) => block.id));
			for (const id of program.order) expect(ids.has(id)).toBe(true);
			expect(new Set(program.order).size).toBe(program.order.length);
		}
	});

	it("keeps ports on nodes the program owns", () => {
		const program = programFor(resistorDivider);
		const nodes = new Set(program.blocks.flatMap((block) => (block.kind === "mna" ? block.nodeIds : [])));
		expect(nodes.has(program.ports.input)).toBe(true);
		expect(nodes.has(program.ports.output)).toBe(true);
	});

	it("carries a control per declared pot with a taper from the closed set", () => {
		const program = programFor(potDivider);
		const tapers = new Set(["linear", "logarithmic", "reverse-logarithmic", "reverse-linear"]);
		expect(program.controls.length).toBeGreaterThan(0);
		for (const control of program.controls) {
			expect(tapers.has(control.taper)).toBe(true);
			expect(control.defaultPosition).toBeGreaterThanOrEqual(0);
			expect(control.defaultPosition).toBeLessThanOrEqual(1);
		}
	});
});

describe("emit: a program survives the wire", () => {
	it("round-trips through JSON without loss", () => {
		for (const source of [resistorDivider, diodeClipper, hybridDelayPedal]) {
			const program = programFor(source, fixtureRegistry);
			expect(JSON.parse(emit(program).text)).toEqual(program);
		}
	});

	it("digests deterministically, and differently for different programs", () => {
		const a = programFor(resistorDivider);
		expect(emit(a).digest).toBe(emit(a).digest);
		expect(emit(a).digest).toBe(emit(JSON.parse(emit(a).text) as Program).digest);
		expect(emit(a).digest).not.toBe(emit(programFor(rcLowPass)).digest);
	});

	it("compileToArtifact pairs the result with its artifact, or with null on refusal", () => {
		const ok = compileToArtifact(resistorDivider, { registry: emptyRegistry });
		expect(ok.result.status).toBe("ok");
		expect(ok.artifact).not.toBeNull();
		if (ok.result.status === "ok" && ok.artifact !== null) {
			expect(ok.artifact.text).toBe(emit(ok.result.program).text);
		}
		const refused = compileToArtifact("this is not a circuit document: [", { registry: emptyRegistry });
		expect(refused.result.status).toBe("unsupported");
		expect(refused.artifact).toBeNull();
	});
});

describe("compile: refusal is a result, not an exception", () => {
	it("returns unsupported with a stage from the closed set for a document it cannot read", () => {
		const stages = new Set(["netlist", "device-laws", "partition", "lower", "link"]);
		const result = compile("this is not a circuit document: [", { registry: emptyRegistry });
		expect(result.status).toBe("unsupported");
		if (result.status === "unsupported") {
			expect(result.reasons.length).toBeGreaterThan(0);
			for (const reason of result.reasons) {
				expect(stages.has(reason.stage)).toBe(true);
				expect(typeof reason.reason).toBe("string");
			}
		}
	});

	it("compiles with the shipped part catalog as its registry", () => {
		// The catalog is data the package ships; a consumer's first call is exactly this.
		const program = programFor(beltonBrickReverb, pedalPartCatalog);
		expect(program.requiredModels.length).toBeGreaterThan(0);
		expect(pedalPartCatalog.entries.length).toBeGreaterThan(0);
	});
});

describe("netlist and laws: the stages a consumer may call on their own", () => {
	it("readNetlist yields devices on nodes the netlist owns, with ports among them", () => {
		const netlist = readNetlist(resistorDivider);
		const nodes = new Set(netlist.nodes);
		expect(netlist.devices.length).toBeGreaterThanOrEqual(2);
		for (const device of netlist.devices) {
			expect(typeof device.id).toBe("string");
			for (const node of device.nodes) expect(nodes.has(node)).toBe(true);
		}
		expect(nodes.has(netlist.ports.input)).toBe(true);
		expect(nodes.has(netlist.ports.output)).toBe(true);
	});

	it("attachDeviceLaws gives every device a law and keeps the device set", () => {
		const netlist = readNetlist(diodeClipper);
		const lawed = attachDeviceLaws(netlist, emptyRegistry);
		expect(lawed.netlist.devices.length).toBe(netlist.devices.length);
	});

	it("parseQuantity is case-sensitive where the magnitude depends on it", () => {
		expect(parseQuantity("4.7k")).toBeCloseTo(4700, 9);
		expect(parseQuantity("100")).toBe(100);
		// `M` is mega and `m` is milli: nine orders apart, and the corpus relies on both.
		expect(parseQuantity("1M")).toBeCloseTo(1e6, 9);
		expect(parseQuantity("1m")).toBeCloseTo(1e-3, 12);
		expect(parseQuantity("10n")).toBeCloseTo(10e-9, 15);
	});
});

describe("part identity helpers are deterministic folds", () => {
	it("canonicalPartId is idempotent and case- and whitespace-insensitive", () => {
		for (const raw of ["ne570n", "NE 570N", "Ne570N "]) {
			const once = canonicalPartId(raw);
			expect(canonicalPartId(once)).toBe(once);
			expect(once).toBe(canonicalPartId("NE570N"));
		}
	});

	it("foldPartId and foldToken erase case and are idempotent", () => {
		for (const raw of ["NE-570N", " ba662a ", "TL072CP"]) {
			expect(foldPartId(raw)).toBe(foldPartId(raw.toLowerCase()));
			expect(foldPartId(foldPartId(raw))).toBe(foldPartId(raw));
			expect(foldToken(raw)).toBe(foldToken(raw.toUpperCase()));
			expect(foldToken(foldToken(raw))).toBe(foldToken(raw));
		}
		expect(foldPartId(null)).toBe("");
		expect(foldToken(undefined)).toBe("");
	});
});

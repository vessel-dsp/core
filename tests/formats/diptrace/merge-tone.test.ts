import { describe, expect, test } from "bun:test";
import { convertDipTrace } from "../../../packages/core/src/formats/diptrace/convert";
import { dualOpampModel, quadOpampModel, toYaml } from "./merge-fixtures";
import { compile, pedalPartCatalog } from "../../../packages/compiler/src/index";
import { ReferenceRuntime } from "../../../packages/runtime/src/index";

function codesOf(result: ReturnType<typeof convertDipTrace>): string[] {
	return result.diagnostics.map((diagnostic) => diagnostic.code);
}

// Canonical kind:opamp twins of the synthetics above: the same nets with the
// supplies on dedicated undeclared nodes, so the tone equality below isolates
// the importer's pad-to-net mapping from the supply fallback both sides take.
function twinTerminal(name: string, node: number, role?: string): string {
	return (
		`      - name: "${name}"` +
		(role === undefined ? "" : `\n        role: ${role}`) +
		`\n        node: ${node}\n        position:\n          x: 0\n          y: 0`
	);
}

function twinComponent(
	id: string,
	kind: string,
	sourceTypeName: string,
	terms: ReadonlyArray<{ readonly name: string; readonly node: number; readonly role?: string }>,
	properties: string,
): string {
	return (
		`  - id: ${id}\n    kind: ${kind}\n    name: ${id}\n    sourceTypeName: ${sourceTypeName}\n` +
		`    origin:\n      x: 0\n      y: 0\n    rotation: 0\n    flipped: false\n    terminals:\n` +
		`${terms.map((term) => twinTerminal(term.name, term.node, term.role)).join("\n")}\n    properties:\n${properties}`
	);
}

function twinOpampSection(
	id: string,
	nonInverting: number,
	inverting: number,
	out: number,
	part: string,
): string {
	return twinComponent(
		id,
		"opamp",
		"Circuit.OpAmp",
		[
			{ name: "vin+", node: nonInverting, role: "nonInverting" },
			{ name: "vin-", node: inverting, role: "inverting" },
			{ name: "vout", node: out, role: "output" },
			{ name: "v+", node: 60, role: "supplyPositive" },
			{ name: "v-", node: 61, role: "supplyNegative" },
		],
		`      PartNumber: ${part}`,
	);
}

function twinDocument(
	extra: string,
	options: { outNode?: number; rfRaw?: string; rfValue?: number; loadNode?: number } = {},
): string {
	const outNode = options.outNode ?? 4;
	const rfRaw = options.rfRaw ?? "100k";
	const rfValue = options.rfValue ?? 100000;
	const loadNode = options.loadNode ?? 4;
	return `schema: circuit-interchange/v4
audio:
  input: IN
  output: OUT
  bypass: none
metadata:
  name: "Synthetic twin"
  description: "Canonical kind:opamp twin of a synthetic DipTrace package."
  partNumber: ""
source:
  format: vdsp
components:
${twinComponent("IN", "jack", "Circuit.Input", [{ name: "tip", node: 1 }], "      Value: JACK")}
${twinComponent("OUT", "jack", "Circuit.Output", [{ name: "tip", node: outNode }], "      Value: JACK")}
${twinComponent("GND1", "ground", "Circuit.Ground", [{ name: "gnd", node: 0 }], "      Value: GND")}
${twinComponent("Rg", "resistor", "Circuit.Resistor", [{ name: "a", node: 2 }, { name: "b", node: 0 }], '      Resistance:\n        raw: "10k"\n        value: 10000\n        unit: ""')}
${twinComponent("Rf", "resistor", "Circuit.Resistor", [{ name: "a", node: 3 }, { name: "b", node: 2 }], `      Resistance:\n        raw: "${rfRaw}"\n        value: ${rfValue}\n        unit: ""`)}
${twinComponent("Rload", "resistor", "Circuit.Resistor", [{ name: "a", node: loadNode }, { name: "b", node: 0 }], '      Resistance:\n        raw: "100k"\n        value: 100000\n        unit: ""')}
${extra}`;
}

function dualTwin(part: string): string {
	return twinDocument(
		`${twinOpampSection("ICA", 1, 2, 3, part)}\n${twinOpampSection("ICB", 3, 4, 4, part)}`,
	);
}

function quadTwin(): string {
	return twinDocument(
		`${twinOpampSection("A", 1, 2, 3, "TL074")}\n${twinOpampSection("B", 3, 4, 4, "TL074")}\n${twinOpampSection("C", 4, 5, 5, "TL074")}\n${twinOpampSection("D", 5, 6, 6, "TL074")}`,
		{ outNode: 6, rfRaw: "10k", rfValue: 10000, loadNode: 6 },
	);
}

function compileMergedOk(source: string): {
	program: unknown;
	warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
} {
	const result = compile(source, { registry: pedalPartCatalog }) as unknown as {
		status: string;
		program: unknown;
		warnings?: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
		reasons?: unknown;
	};
	if (result.status !== "ok") {
		throw new Error(
			`synthetic did not compile: ${result.status} ${JSON.stringify(result.reasons).slice(0, 300)}`,
		);
	}
	return { program: result.program, warnings: result.warnings ?? [] };
}

function droppedChips(
	warnings: ReadonlyArray<{ code?: unknown; reason?: unknown; device?: unknown }>,
): Array<{ code?: unknown; reason?: unknown; device?: unknown }> {
	return warnings.filter((warning) => warning.code === "ic-not-executed");
}

// 1 kHz, 0.5 V sine, last 100 ms of 1 s at 48 kHz: the round-4 control
// instrument. Gain 11 needs both stages: a dropped B leaves OUT undriven
// (gain ~0) and a dropped A leaves the follower at gain 1.
function renderTone(program: unknown): { gain: number; phase: number } {
	const runtime = new ReferenceRuntime(program as never);
	runtime.prepare(48000);
	const count = 48000;
	const frequency = 1000;
	const input = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		input[index] = 0.5 * Math.sin((2 * Math.PI * frequency * index) / 48000);
	}
	const output = runtime.process(input) as Float64Array;
	const start = count - 4800;
	const window = count - start;
	let sine = 0;
	let cosine = 0;
	for (let index = start; index < count; index++) {
		const s = Math.sin((2 * Math.PI * frequency * index) / 48000);
		const c = Math.cos((2 * Math.PI * frequency * index) / 48000);
		sine += (output[index] ?? 0) * s;
		cosine += (output[index] ?? 0) * c;
	}
	const gain = Math.hypot((2 * sine) / window, (2 * cosine) / window) / 0.5;
	const phase = (Math.atan2((2 * cosine) / window, (2 * sine) / window) * 180) / Math.PI;
	return { gain, phase };
}

describe("diptrace IC package merge execution", () => {
	test("a dual TL072 merges into one numbered ic and executes both op-amps", () => {
		const converted = convertDipTrace(dualOpampModel({}), { name: "synthetic-dual" });
		expect(converted.refusal).toBeNull();
		const merged = converted.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.kind).toBe("ic");
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1", "2", "3", "4", "5", "6", "7", "8",
		]);
		expect(merged?.terminals.some((terminal) => terminal.role !== undefined)).toBe(false);
		expect(
			(converted.document?.components ?? []).some(
				(component) => component.id === "IC1A" || component.id === "IC1B",
			),
		).toBe(false);
		expect(codesOf(converted)).toContain("multipart-sections-merged");
		const { program, warnings } = compileMergedOk(toYaml(converted.document));
		expect(droppedChips(warnings)).toEqual([]);
		const tone = renderTone(program);
		const twin = compileMergedOk(dualTwin("TL072"));
		const reference = renderTone(twin.program);
		expect(Math.abs(tone.gain - reference.gain)).toBeLessThan(1e-6);
		expect(Math.abs(tone.phase - reference.phase)).toBeLessThan(1e-6);
		// Round-4 reference numbers, within the entry-parameter tolerance.
		expect(Math.abs(tone.gain - 10.9952)).toBeLessThan(0.01);
		expect(Math.abs(tone.phase - -0.25)).toBeLessThan(0.5);
	});
	test("a dual JRC4558D merges and matches the same canonical reference", () => {
		const converted = convertDipTrace(
			dualOpampModel({ values: ["JRC4558D", "JRC4558D"] }),
			{ name: "synthetic-dual-jrc" },
		);
		expect(converted.refusal).toBeNull();
		const merged = converted.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.kind).toBe("ic");
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1", "2", "3", "4", "5", "6", "7", "8",
		]);
		const { program, warnings } = compileMergedOk(toYaml(converted.document));
		expect(droppedChips(warnings)).toEqual([]);
		const tone = renderTone(program);
		const twin = compileMergedOk(dualTwin("JRC4558D"));
		const reference = renderTone(twin.program);
		expect(Math.abs(tone.gain - reference.gain)).toBeLessThan(1e-6);
		expect(Math.abs(tone.phase - reference.phase)).toBeLessThan(1e-6);
		expect(Math.abs(tone.gain - 10.9952)).toBeLessThan(0.01);
		expect(Math.abs(tone.phase - -0.25)).toBeLessThan(0.5);
	});
	test("a quad TL074 merges into one 14-terminal ic and executes", () => {
		const converted = convertDipTrace(quadOpampModel(), { name: "synthetic-quad" });
		expect(converted.refusal).toBeNull();
		const merged = converted.document?.components.find(
			(component) => component.id === "IC1",
		);
		expect(merged?.kind).toBe("ic");
		expect(merged?.terminals.map((terminal) => terminal.name)).toEqual([
			"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14",
		]);
		const { program, warnings } = compileMergedOk(toYaml(converted.document));
		expect(droppedChips(warnings)).toEqual([]);
		const tone = renderTone(program);
		const twin = compileMergedOk(quadTwin());
		const reference = renderTone(twin.program);
		expect(Math.abs(tone.gain - reference.gain)).toBeLessThan(1e-6);
		expect(Math.abs(tone.phase - reference.phase)).toBeLessThan(1e-6);
		expect(Math.abs(tone.gain - 2)).toBeLessThan(0.01);
		expect(Math.abs(tone.phase)).toBeLessThan(0.5);
	});
	test("a renamed pad on the merged package breaks the tone match", () => {
		const converted = convertDipTrace(dualOpampModel({}), { name: "synthetic-dual" });
		const document = converted.document;
		if (document === null) {
			throw new Error("synthetic conversion was refused");
		}
		const mutated = {
			...document,
			components: document.components.map((component) =>
				component.id === "IC1"
					? {
							...component,
							terminals: component.terminals.map((terminal) =>
								terminal.name === "1" ? { ...terminal, name: "9" } : terminal,
							),
						}
					: component,
			),
		};
		const yaml = toYaml(mutated);
		const result = compile(yaml, { registry: pedalPartCatalog }) as unknown as {
			status: string;
			program: unknown;
			warnings?: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
			reasons?: Array<{ reason?: unknown }>;
		};
		const dropped = droppedChips(result.warnings ?? []);
		expect(dropped.length).toBe(1);
		expect(dropped[0]?.reason).toBe("registry-arity-mismatch");
		if (result.status === "ok") {
			const tone = renderTone(result.program);
			expect(Math.abs(tone.gain - 11)).toBeGreaterThan(1);
		}
	});
	test("a merged package whose pads are not the table's set refuses by name", () => {
		const converted = convertDipTrace(dualOpampModel({ padsB: ["9", "6", "7", "8"] }), {
			name: "synthetic-swapped",
		});
		expect(converted.refusal).toBeNull();
		expect(codesOf(converted)).toContain("multipart-sections-merged");
		const yaml = toYaml(converted.document);
		const result = compile(yaml, { registry: pedalPartCatalog }) as unknown as {
			status: string;
			program: unknown;
			warnings?: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
		};
		// Pin numbers are absolute: the set is not the table's, so the
		// package refuses by name instead of miswiring silently.
		expect(result.status).toBe("ok");
		const dropped = droppedChips(result.warnings ?? []);
		expect(dropped.length).toBe(1);
		expect(dropped[0]?.reason).toBe("registry-arity-mismatch");
	});
});

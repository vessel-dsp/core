// Package-pin binding: numbered-pin whole packages bind to the registry pinout by pin
// number, not by declaration order.
//
// Covers the pin-binding row: an 8-terminal numbered `ic` TL072 and a 4558-family one
// compile, their op-amps EXECUTE, and the rendered tone equals the same circuit written
// as canonical `kind: opamp` sections. Controls in both directions: swapped pin numbers
// bind correctly (numbers are absolute), duplicated pins refuse by name, a uPC4558-style
// document binds correctly (the entry its pad-sorted order would miswire), and a mutant
// entry with one stamped pin number moved fails the tone match.

import { describe, expect, it } from "bun:test";
import { compile } from "../src/compile";
import { pedalPartCatalog } from "../src/part-catalog";
import {
	packagePinBinding,
	registryEntryFor,
	validatePackagePinNumbers,
} from "../src/registry";
import { ReferenceRuntime } from "../../runtime/src/reference-runtime";
import type { Program } from "../src/types";

type Term = { name: string; node: number };

function terminal(t: Term): string {
	return `      - name: "${t.name}"\n        node: ${t.node}\n        position:\n          x: 0\n          y: 0`;
}

function component(
	id: string,
	kind: string,
	sourceTypeName: string,
	terms: Term[],
	partLine: string,
): string {
	return `  - id: ${id}
    kind: ${kind}
    name: ${id}
    sourceTypeName: ${sourceTypeName}
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
${terms.map(terminal).join("\n")}
    properties:
      ${partLine}`;
}

const jack = (id: string, type: string, node: number) =>
	component(id, "jack", type, [{ name: "tip", node }], "Value: JACK");

const ground = () =>
	component("GND1", "ground", "Circuit.Ground", [{ name: "gnd", node: 0 }], "Value: GND");

const rail = () =>
	component(
		"VCC",
		"rail",
		"Circuit.Rail",
		[{ name: "vcc", node: 5 }],
		"Voltage:\n        raw: 9 V\n        value: 9\n        unit: V",
	);

const veeRail = () =>
	component(
		"VEE",
		"rail",
		"Circuit.Rail",
		[{ name: "vee", node: 6 }],
		'Voltage:\n        raw: "-9 V"\n        value: -9\n        unit: V',
	);

const resistor = (id: string, na: number, nb: number, raw: string, value: number) =>
	component(
		id,
		"resistor",
		"Circuit.Resistor",
		[
			{ name: "a", node: na },
			{ name: "b", node: nb },
		],
		`Resistance:\n        raw: "${raw}"\n        value: ${value}\n        unit: ""`,
	);

function opampSection(
  id: string,
  inn: number,
  inw: number,
  out: number,
  part: string,
  aol?: number,
  sp = 5,
  sn = 6,
): string {
	return `  - id: ${id}
    kind: opamp
    name: ${id}
    sourceTypeName: Circuit.OpAmp
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: "vin+"
        role: nonInverting
        node: ${inn}
        position:
          x: -10
          y: 10
      - name: "vin-"
        role: inverting
        node: ${inw}
        position:
          x: -10
          y: -10
      - name: "vout"
        role: output
        node: ${out}
        position:
          x: 10
          y: 0
      - name: "v+"
        role: supplyPositive
        node: ${sp}
        position:
          x: 0
          y: 20
      - name: "v-"
        role: supplyNegative
        node: ${sn}
        position:
          x: 0
          y: -20
    properties:
      PartNumber: ${part}${aol === undefined ? "" : `\n      Aol: "${aol}"`}`;
}

// Merged 8-terminal numbered ic: terminal names are package pin numbers, nodes ride along.
function mergedIc(part: string, names: readonly string[], nodes: readonly number[]): string {
	return component(
		"IC1",
		"ic",
		"Circuit.IC",
		names.map((name, i) => ({ name, node: nodes[i] as number })),
		`PartNumber: ${part}`,
	);
}

function doc(extra: string): string {
	return `schema: circuit-interchange/v4
audio:
  input: IN
  output: OUT
  bypass: none
metadata:
  name: "Synthetic dual opamp"
  description: "Section A gain-of-11 non-inverting amp into section B follower."
  partNumber: ""
source:
  format: vdsp
components:
${jack("IN", "Circuit.Input", 1)}
${jack("OUT", "Circuit.Output", 4)}
${ground()}
${rail()}
${veeRail()}
${resistor("Rg", 2, 0, "10k", 10000)}
${resistor("Rf", 3, 2, "100k", 100000)}
${resistor("Rload", 4, 0, "100k", 100000)}
${extra}`;
}

// Section A: +IN=1, -IN=2, OUT=3. Section B: +IN=3, -IN=4, OUT=4.
// Pads 1..8 -> nodes. Package order: 1 OUT_A, 2 IN-_A, 3 IN+_A, 4 V-, 5 IN+_B, 6 IN-_B, 7 OUT_B, 8 V+.
const PAD_NODES = [3, 2, 1, 0, 3, 4, 4, 5];
const PIN_NAMES = ["1", "2", "3", "4", "5", "6", "7", "8"];

const canonicalDoc = (part: string) =>
	doc(`${opampSection("ICA", 1, 2, 3, part)}\n${opampSection("ICB", 3, 4, 4, part)}`);

const mergedDoc = (part: string) => doc(mergedIc(part, PIN_NAMES, PAD_NODES));

function compileOk(source: string, registry = pedalPartCatalog): {
	program: Program;
	warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
} {
	const result = compile(source, { registry }) as unknown as {
		status: string;
		program: Program;
		warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
		reasons?: unknown;
	};
	if (result.status !== "ok") {
		throw new Error(
			`fixture did not compile: ${result.status} ${JSON.stringify(result.reasons).slice(0, 300)}`,
		);
	}
	return { program: result.program, warnings: result.warnings ?? [] };
}

function droppedChips(
	warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>,
): Array<{ code?: unknown; reason?: unknown; device?: unknown }> {
	return warnings.filter((w) => w.code === "ic-not-executed");
}

function tone(program: Program): { gain: number; phase: number } {
	const runtime = new ReferenceRuntime(program as never);
	(runtime as unknown as { prepare: (r: number) => void }).prepare(48000);
	const n = 48000;
	const freq = 1000;
	const input = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		input[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / 48000);
	}
	const output = (runtime as unknown as { process: (i: Float64Array) => Float64Array }).process(
		input,
	);
	const start = n - 4800;
	const m = n - start;
	let ys = 0;
	let yc = 0;
	for (let i = start; i < n; i++) {
		const s = Math.sin((2 * Math.PI * freq * i) / 48000);
		const c = Math.cos((2 * Math.PI * freq * i) / 48000);
		ys += (output[i] ?? 0) * s;
		yc += (output[i] ?? 0) * c;
	}
	const gain = Math.hypot((2 * ys) / m, (2 * yc) / m) / 0.5;
	const phase = (Math.atan2((2 * yc) / m, (2 * ys) / m) * 180) / Math.PI;
	return { gain, phase };
}

describe("package-pin binding: numbered whole packages execute", () => {
	for (const part of ["JRC4558D", "TL072", "uPC4558C"]) {
		it(`${part}: merged 8-terminal numbered ic matches canonical sections`, () => {
			const canonical = compileOk(canonicalDoc(part));
			const merged = compileOk(mergedDoc(part));
			expect(droppedChips(canonical.warnings)).toEqual([]);
			expect(droppedChips(merged.warnings)).toEqual([]);
			const tCanonical = tone(canonical.program);
			const tMerged = tone(merged.program);
			expect(Math.abs(tMerged.gain - tCanonical.gain)).toBeLessThan(1e-6);
			expect(Math.abs(tMerged.phase - tCanonical.phase)).toBeLessThan(1e-6);
		});
	}

	it("canonical JRC4558D tone anchors the round-4 reference numbers", () => {
		const { program } = compileOk(canonicalDoc("JRC4558D"));
		const { gain, phase } = tone(program);
		expect(Math.abs(gain - 10.9952)).toBeLessThan(0.05);
		expect(Math.abs(phase - -0.25)).toBeLessThan(0.5);
	});

	it("swapped declaration order (pins 1 and 7) still binds correctly", () => {
		// Pins are absolute: the same nodes under permuted names must render the same circuit.
		const names = ["7", "2", "3", "4", "5", "6", "1", "8"];
		const nodes = [4, 2, 1, 0, 3, 4, 3, 5];
		const swapped = compileOk(doc(mergedIc("TL072", names, nodes)));
		const reference = compileOk(canonicalDoc("TL072"));
		expect(droppedChips(swapped.warnings)).toEqual([]);
		const tSwapped = tone(swapped.program);
		const tReference = tone(reference.program);
		expect(Math.abs(tSwapped.gain - tReference.gain)).toBeLessThan(1e-6);
		expect(Math.abs(tSwapped.phase - tReference.phase)).toBeLessThan(1e-6);
	});

	it("duplicated pin numbers refuse by name instead of guessing", () => {
		// The duplicate rides the same node: the document is valid vdsp (shared nets are
		// legal), but the numbering is not the entry's table, so it refuses by name.
		const names = ["1", "1", "3", "4", "5", "6", "7", "8"];
		const nodes = [3, 3, 1, 0, 3, 4, 4, 5];
		const result = compile(doc(mergedIc("TL072", names, nodes)), {
			registry: pedalPartCatalog,
		}) as unknown as {
			status: string;
			warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
		};
		expect(result.status).toBe("ok");
		const dropped = droppedChips(result.warnings);
		expect(dropped.length).toBe(1);
		expect(dropped[0]?.reason).toBe("registry-arity-mismatch");
	});

	it("duplicated pin numbers on different nets refuse at the format boundary", () => {
		// Core's own connectivity contract refuses one pin name on two nodes before the
		// compiler ever sees it: the silent-miswire case cannot be constructed.
		const names = ["1", "1", "3", "4", "5", "6", "7", "8"];
		const result = compile(doc(mergedIc("TL072", names, PAD_NODES)), {
			registry: pedalPartCatalog,
		}) as unknown as {
			status: string;
			reasons: Array<{ stage?: unknown; reason?: unknown }>;
		};
		expect(result.status).toBe("unsupported");
	});

	it("a mutant pin table (one stamped number moved) fails the tone match", () => {
		const entry = registryEntryFor(
			pedalPartCatalog,
			{ partId: "TL072", evidence: "exact-part" },
			8,
		);
		const model = entry?.model;
		if (model?.kind !== "sections") {
			throw new Error("TL072 entry is not a sections entry");
		}
		if (model.packagePinNumbers === undefined) {
			throw new Error("TL072 entry carries no package pin table");
		}
		const mutantNumbers = [...model.packagePinNumbers.numbers];
		// Swap a signal pin with a supply pin (OUT_A on pin 1 with VEE on pin 4): the
		// table drives the binding, so the stamped circuit must move, loudly.
		[mutantNumbers[3], mutantNumbers[6]] = [
			mutantNumbers[6] as string,
			mutantNumbers[3] as string,
		];
		const tableSource = model.packagePinNumbers.source;
		const mutant = {
			entries: pedalPartCatalog.entries.map((candidate) =>
				candidate === entry
					? {
							...candidate,
							model: {
								...model,
								packagePinNumbers: {
									numbers: mutantNumbers,
									source: tableSource,
								},
							},
						}
					: candidate,
			),
		};
		const reference = compileOk(canonicalDoc("TL072"));
		const mutated = compileOk(mergedDoc("TL072"), mutant);
		expect(droppedChips(mutated.warnings)).toEqual([]);
		const tMutant = tone(mutated.program);
		const tReference = tone(reference.program);
		// The table drives the binding: moving one stamped pin must move the circuit.
		expect(Math.abs(tMutant.gain - tReference.gain)).toBeGreaterThan(0.5);
	});

	it("TL022 null-pinout entry binds numbered packages without the unverified warning", () => {
		const { warnings } = compileOk(mergedDoc("TL022CP"));
		expect(droppedChips(warnings)).toEqual([]);
		expect(warnings.filter((w) => w.code === "unverified-pinout-binding")).toEqual([]);
	});
});

const lm386Doc = (names: readonly string[]) =>
		`schema: circuit-interchange/v3
metadata:
  name: "LM386 numbered control"
  description: "Minimal gain-20 application."
  partNumber: ""
source:
  format: vdsp
  filename: lm386-control.vdsp
components:
${component("JIN", "jack", "Circuit.Input", [{ name: "tip", node: 3 }], "Value: JACK")}
${component("JOUT", "jack", "Circuit.Output", [{ name: "tip", node: 2 }], "Value: JACK")}
${component("GND1", "ground", "Circuit.Ground", [{ name: "terminal", node: 0 }], "Value: GND")}
${component("VSUP", "voltage-source", "Circuit.VoltageSource", [{ name: "plus", node: 9 }, { name: "minus", node: 0 }], `Voltage: "9"
`)}
${component("U1", "power-amp", "Circuit.IC", names.map((tname, index) => ({ name: tname, node: [5, 0, 3, 0, 4, 9, 7, 6][index] as number })), `PartNumber: "LM386"
`)}
${component("CBYP", "capacitor", "Circuit.Capacitor", [{ name: "a", node: 7 }, { name: "b", node: 0 }], `Capacitance: "10u"
`)}
${component("COUT", "capacitor", "Circuit.Capacitor", [{ name: "a", node: 4 }, { name: "b", node: 2 }], `Capacitance: "250u"
`)}
${component("RL", "resistor", "Circuit.Resistor", [{ name: "a", node: 2 }, { name: "b", node: 0 }], `Resistance: "8"
`)}
wires: []
`;

describe("package-pin binding: LM386 power-amp entry", () => {
	it("8-terminal numbered LM386 executes", () => {
		const { warnings } = compileOk(lm386Doc(["1", "2", "3", "4", "5", "6", "7", "8"]));
		expect(droppedChips(warnings)).toEqual([]);
	});

	it("7-terminal LM386 without pin 7 refuses by name (tolerance proposed, not built)", () => {
		const result = compile(lm386Doc(["1", "2", "3", "4", "5", "6", "8"]), {
			registry: pedalPartCatalog,
		}) as unknown as {
			status: string;
			warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
		};
		expect(result.status).toBe("ok");
		const dropped = droppedChips(result.warnings);
		expect(dropped.length).toBe(1);
		expect(dropped[0]?.reason).toBe("registry-arity-mismatch");
	});
});

describe("package-pin binding: table validation", () => {
	const entryFor = (numbers: readonly string[], source = "maker sheet, table 1") =>
		({
			partIds: ["FIXTURE-PINS"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "sections",
				pinout: ["a", "b", "c"],
				packagePinNumbers: { numbers: [...numbers], source },
				sections: [],
			},
		}) as never;

	it("accepts a whole-digit bijection", () => {
		expect(() => validatePackagePinNumbers([entryFor(["1", "2", "3"])])).not.toThrow();
	});

	it("throws on duplicates, non-digits, length mismatch, and blank source", () => {
		expect(() => validatePackagePinNumbers([entryFor(["1", "1", "3"])])).toThrow();
		expect(() => validatePackagePinNumbers([entryFor(["1", "2", "x"])])).toThrow();
		expect(() => validatePackagePinNumbers([entryFor(["1", "2"])])).toThrow();
		expect(() => validatePackagePinNumbers([entryFor(["1", "2", "3"], "  ")])).toThrow();
	});

	it("packagePinBinding maps pinout positions to device terminals", () => {
		const entry = registryEntryFor(
			pedalPartCatalog,
			{ partId: "uPC4558C", evidence: "exact-part" },
			8,
		);
		if (entry?.model.kind !== "sections") throw new Error("uPC4558C entry missing");
		const bound = packagePinBinding(entry.model, {
			partNumber: "uPC4558C",
			declaredType: null,
			terminalRoles: [null, null, null, null, null, null, null, null],
			declaredTerminalRoles: [null, null, null, null, null, null, null, null],
			terminalPinNumbers: ["1", "2", "3", "4", "5", "6", "7", "8"],
			declaredWindings: null,
		});
		// Signal-grouped entry: section B lives on package pins 5,6,7, not positions 3,4,5.
		expect(bound).toEqual([0, 1, 2, 6, 5, 4, 7, 3]);
	});
});

describe("package-pin binding: every stated table executes (row 22)", () => {
	// Table-driven over the catalog: every sections entry stating packagePinNumbers builds
	// its numbered package from the table's own numbers and EXECUTES. Where every section is
	// an ideal-opamp law, the numbered package renders the same tone as the canonical
	// kind:opamp twin carrying the entry's own open-loop gains (the twin takes the class
	// default otherwise, so each section's Aol rides along explicitly to isolate the mapping).
	type TableCase = {
		label: string;
		part: string;
		numbers: string[];
		aols: number[];
		terminals: number[][];
		pinCount: number;
	};

	const duals: TableCase[] = [];
	const quads: TableCase[] = [];
	const others: { label: string; numbers: string[] }[] = [];
	type SingleCase = {
		label: string;
		part: string;
		numbers: string[];
		packagePins: string[];
		aol: number;
	};
	const singles: SingleCase[] = [];
	for (const entry of pedalPartCatalog.entries) {
		const model = entry.model;
		if (model.kind !== "sections") continue;
		const stated = model.packagePinNumbers;
		if (stated === undefined) continue;
		const part = entry.partIds[0];
		if (part === undefined) continue;
		if (stated.packagePins !== undefined) {
			if (
				model.sections.length !== 1 ||
				model.pinout.length !== 3 ||
				stated.numbers.length !== 3 ||
				!model.sections.every((section) => section.law.kind === "ideal-opamp")
			) {
				throw new Error(`new subset-table shape needs its own control: ${part}`);
			}
			const only = model.sections[0];
			singles.push({
				label: part,
				part,
				numbers: [...stated.numbers],
				packagePins: [...stated.packagePins],
				aol:
					only !== undefined && only.law.kind === "ideal-opamp"
						? only.law.openLoopGain
						: 100000,
			});
			continue;
		}
		if (!model.sections.every((section) => section.law.kind === "ideal-opamp")) {
			others.push({ label: part, numbers: [...stated.numbers] });
			continue;
		}
		const table: TableCase = {
			label: part,
			part,
			numbers: [...stated.numbers],
			aols: model.sections.map((section) =>
				section.law.kind === "ideal-opamp" ? section.law.openLoopGain : 100000,
			),
			terminals: model.sections.map((section) => [...section.terminals]),
			pinCount: model.pinout.length,
		};
		if (table.pinCount === 8 && table.terminals.length === 2) duals.push(table);
		else if (table.pinCount === 14 && table.terminals.length === 4) quads.push(table);
		else others.push({ label: part, numbers: [...stated.numbers] });
	}

	for (const table of duals) {
		it(`${table.label}: numbered package from its own table executes and matches the twin`, () => {
			const atNode: Record<string, number> = {};
			PIN_NAMES.forEach((pin, i) => {
				atNode[pin] = PAD_NODES[i] as number;
			});
			// Quote the part id: a bare number-portion id (4580) would otherwise parse
			// as a YAML number rather than a part-number string.
			const qpart = `"${table.part}"`;
			const nodes = table.numbers.map((pin) => atNode[pin] as number);
			const merged = compileOk(doc(mergedIc(qpart, table.numbers, nodes)));
			const twin = compileOk(
				doc(
					`${opampSection("ICA", 1, 2, 3, qpart, table.aols[0])}\n${opampSection("ICB", 3, 4, 4, qpart, table.aols[1])}`,
				),
			);
			expect(droppedChips(merged.warnings)).toEqual([]);
			expect(droppedChips(twin.warnings)).toEqual([]);
			const tMerged = tone(merged.program);
			const tTwin = tone(twin.program);
			expect(Math.abs(tMerged.gain - tTwin.gain)).toBeLessThan(1e-6);
			expect(Math.abs(tMerged.phase - tTwin.phase)).toBeLessThan(1e-6);
		});

		it(`${table.label}: duplicated pin on one node refuses instead of executing`, () => {
			const names = [...table.numbers];
			names[1] = names[0] as string;
			const atNode: Record<string, number> = {};
			PIN_NAMES.forEach((pin, i) => {
				atNode[pin] = PAD_NODES[i] as number;
			});
			const nodes = names.map((pin) => atNode[pin] as number);
			const result = compile(doc(mergedIc(`"${table.part}"`, names, nodes)), {
				registry: pedalPartCatalog,
			}) as unknown as {
				status: string;
				warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
			};
			expect(result.status).toBe("ok");
			expect(droppedChips(result.warnings).length).toBe(1);
		});
	}

	function followerDoc(extra: string, outNode: number): string {
		return `schema: circuit-interchange/v4
audio:
  input: IN
  output: OUT
  bypass: none
metadata:
  name: "Synthetic quad followers"
  description: "Each section a follower chained into the next."
  partNumber: ""
source:
  format: vdsp
components:
${jack("IN", "Circuit.Input", 1)}
${jack("OUT", "Circuit.Output", outNode)}
${ground()}
${rail()}
${veeRail()}
${resistor("Rload", outNode, 0, "100k", 100000)}
${extra}`;
	}

	for (const table of quads) {
		// Nodes per pinout position from the entry's own section terminal indices: each
		// section [noninv, inv, out] becomes a follower link in a chain from IN; positions
		// no section names take dedicated undeclared supply nodes on both sides alike.
		const chain = [1, 10, 11, 12, 13];
		const outNode = 13;
		const referenced = new Set(table.terminals.flat());
		const nodeAtPos: number[] = [];
		table.terminals.forEach((terms, i) => {
			nodeAtPos[terms[0] as number] = chain[i] as number;
			nodeAtPos[terms[1] as number] = chain[i + 1] as number;
			nodeAtPos[terms[2] as number] = chain[i + 1] as number;
		});
		let supply = 20;
		table.numbers.forEach((_, pos) => {
			if (!referenced.has(pos)) {
				nodeAtPos[pos] = supply;
				supply += 1;
			}
		});
		const supplyNodes = table.numbers
			.map((_, pos) => pos)
			.filter((pos) => !referenced.has(pos))
			.map((pos) => nodeAtPos[pos] as number);

		it(`${table.label}: numbered package from its own table executes and matches the twin`, () => {
			const nodes = table.numbers.map((_, pos) => nodeAtPos[pos] as number);
			const qpart = `"${table.part}"`;
			const merged = compileOk(
				followerDoc(
					component(
						"IC1",
						"ic",
						"Circuit.IC",
						table.numbers.map((name, pos) => ({ name, node: nodes[pos] as number })),
						`PartNumber: ${qpart}`,
					),
					outNode,
				),
			);
			const twin = compileOk(
				followerDoc(
					table.terminals
						.map((_, i) =>
							opampSection(
								`IC${i}`,
								chain[i] as number,
								chain[i + 1] as number,
								chain[i + 1] as number,
								qpart,
								table.aols[i],
								supplyNodes[0] as number,
								supplyNodes[1] as number,
							),
						)
						.join("\n"),
					outNode,
				),
			);
			expect(droppedChips(merged.warnings)).toEqual([]);
			expect(droppedChips(twin.warnings)).toEqual([]);
			const tMerged = tone(merged.program);
			const tTwin = tone(twin.program);
			expect(Math.abs(tMerged.gain - tTwin.gain)).toBeLessThan(1e-6);
			expect(Math.abs(tMerged.phase - tTwin.phase)).toBeLessThan(1e-6);
		});

		it(`${table.label}: duplicated pin on one node refuses instead of executing`, () => {
			const names = [...table.numbers];
			names[1] = names[0] as string;
			const byName: Record<string, number> = {};
			table.numbers.forEach((pin, pos) => {
				byName[pin] = nodeAtPos[pos] as number;
			});
			const nodes = names.map((pin) => byName[pin] as number);
			const result = compile(
				followerDoc(
					component(
						"IC1",
						"ic",
						"Circuit.IC",
						names.map((name, i) => ({ name, node: nodes[i] as number })),
						`PartNumber: "${table.part}"`,
					),
					outNode,
				),
				{ registry: pedalPartCatalog },
			) as unknown as {
				status: string;
				warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
			};
			expect(result.status).toBe("ok");
			expect(droppedChips(result.warnings).length).toBe(1);
		});
	}

	function singleDoc(extra: string, outNode: number): string {
		return `schema: circuit-interchange/v4
audio:
  input: IN
  output: OUT
  bypass: none
metadata:
  name: "Synthetic single opamp"
  description: "One section wired gain-of-11 non-inverting."
  partNumber: ""
source:
  format: vdsp
components:
${jack("IN", "Circuit.Input", 1)}
${jack("OUT", "Circuit.Output", outNode)}
${ground()}
${rail()}
${veeRail()}
${resistor("Rg", 2, 0, "10k", 10000)}
${resistor("Rf", 3, 2, "100k", 100000)}
${resistor("Rload", outNode, 0, "100k", 100000)}
${extra}`;
	}

	// Subset tables: a sections entry stating packagePins (the full physical package
	// beside the signal-pin numbers) binds any fully numbered package that is a subset
	// of the package containing every signal pin. The corpus singles declare 5 pads
	// [2,3,4,6,7] or 7 pads [1,2,3,4,6,7,8]; the full 1-8 package binds too. Aux pads
	// ride dedicated quiet nodes; supplies are the circuit's, exactly as for role-named
	// documents today (rails come from the circuit, not the table).
	const SINGLE_SIGNAL_NODES: Record<string, number> = { "2": 2, "3": 1, "6": 3 };
	const singleNodes = (names: readonly string[]): number[] =>
		names.map((name, i) => SINGLE_SIGNAL_NODES[name] ?? 20 + i);
	const SINGLE_SHAPES: Record<string, string[]> = {
		"5-pad": ["2", "3", "4", "6", "7"],
		"7-pad": ["1", "2", "3", "4", "6", "7", "8"],
		full: ["1", "2", "3", "4", "5", "6", "7", "8"],
	};

	for (const table of singles) {
		for (const [shape, names] of Object.entries(SINGLE_SHAPES)) {
			it(`${table.label} ${shape}: numbered subset from its own table executes and matches the twin`, () => {
				const nodes = singleNodes(names);
				const merged = compileOk(singleDoc(mergedIc(table.part, names, nodes), 3));
				const twin = compileOk(
					singleDoc(opampSection("IC", 1, 2, 3, table.part, table.aol), 3),
				);
				expect(droppedChips(merged.warnings)).toEqual([]);
				expect(droppedChips(twin.warnings)).toEqual([]);
				const tMerged = tone(merged.program);
				const tTwin = tone(twin.program);
				expect(Math.abs(tMerged.gain - tTwin.gain)).toBeLessThan(1e-6);
				expect(Math.abs(tMerged.phase - tTwin.phase)).toBeLessThan(1e-6);
			});
		}

		it(`${table.label}: pad outside the stated package refuses by name`, () => {
			const names = ["2", "3", "4", "6", "9"];
			const result = compile(singleDoc(mergedIc(table.part, names, singleNodes(names)), 3), {
				registry: pedalPartCatalog,
			}) as unknown as {
				status: string;
				warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
			};
			expect(result.status).toBe("ok");
			const dropped = droppedChips(result.warnings);
			expect(dropped.length).toBe(1);
			expect(dropped[0]?.reason).toBe("registry-arity-mismatch");
		});

		it(`${table.label}: missing signal pad refuses by name`, () => {
			const names = ["1", "2", "3", "4", "5"];
			const result = compile(singleDoc(mergedIc(table.part, names, singleNodes(names)), 3), {
				registry: pedalPartCatalog,
			}) as unknown as {
				status: string;
				warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
			};
			expect(result.status).toBe("ok");
			const dropped = droppedChips(result.warnings);
			expect(dropped.length).toBe(1);
			expect(dropped[0]?.reason).toBe("registry-arity-mismatch");
		});

		it(`${table.label}: swapped signal pads bind by pad number, not by declaration role`, () => {
			// Pads 2 and 6 trade nodes: pad "2" takes the OUT net, pad "6" the feedback
			// net. The document's own pad statement binds, so the result equals the twin
			// with those roles swapped (a ~unity follower into the output jack), not the
			// original gain-of-11 twin.
			const names = ["2", "3", "4", "6", "7"];
			const swapped = compileOk(singleDoc(mergedIc(table.part, names, [3, 1, 20, 2, 21]), 3));
			const twinSwapped = compileOk(
				singleDoc(opampSection("IC", 1, 3, 2, table.part, table.aol), 3),
			);
			const twinOrig = compileOk(
				singleDoc(opampSection("IC", 1, 2, 3, table.part, table.aol), 3),
			);
			expect(droppedChips(swapped.warnings)).toEqual([]);
			const tSwapped = tone(swapped.program);
			const tTwinSwapped = tone(twinSwapped.program);
			const tTwinOrig = tone(twinOrig.program);
			expect(Math.abs(tSwapped.gain - tTwinSwapped.gain)).toBeLessThan(1e-6);
			expect(Math.abs(tSwapped.phase - tTwinSwapped.phase)).toBeLessThan(1e-6);
			expect(Math.abs(tSwapped.gain - tTwinOrig.gain)).toBeGreaterThan(0.5);
		});

		it(`${table.label}: mutant signal number refuses instead of executing`, () => {
			const entry = pedalPartCatalog.entries.find(
				(candidate) =>
					candidate.partIds[0] === table.label &&
					candidate.model.kind === "sections" &&
					candidate.model.packagePinNumbers?.packagePins !== undefined,
			);
			if (
				entry?.model.kind !== "sections" ||
				entry.model.packagePinNumbers?.packagePins === undefined
			) {
				throw new Error(`${table.label} subset entry missing`);
			}
			// Move one signal pin off the 5-pad shape (3 -> 1): the table drives the
			// binding, so the numbered subset no longer contains it and refuses.
			const mutantNumbers = [...entry.model.packagePinNumbers.numbers];
			mutantNumbers[0] = "1";
			const tableSource = entry.model.packagePinNumbers.source;
			const tablePackage = [...(entry.model.packagePinNumbers.packagePins as readonly string[])];
			const mutant = {
				entries: pedalPartCatalog.entries.map((candidate) =>
					candidate === entry
						? {
								...candidate,
								model: {
									...entry.model,
									packagePinNumbers: {
										numbers: mutantNumbers,
										packagePins: tablePackage,
										source: tableSource,
									},
								},
							}
						: candidate,
				),
			};
			const names = ["2", "3", "4", "6", "7"];
			const result = compile(singleDoc(mergedIc(table.part, names, singleNodes(names)), 3), {
				registry: mutant,
			}) as unknown as {
				status: string;
				warnings: Array<{ code?: unknown; reason?: unknown; device?: unknown }>;
			};
			expect(result.status).toBe("ok");
			const dropped = droppedChips(result.warnings);
			expect(dropped.length).toBe(1);
			expect(dropped[0]?.reason).toBe("registry-arity-mismatch");
		});
	}

	// Non-opamp tables: today only the LM386 power-amp builder. Its numbered package
	// executes in the minimal gain-20 application from its own numbers.
	for (const table of others) {
		it(`${table.label}: numbered package from its own table executes`, () => {
			if (table.numbers.length !== 8)
				throw new Error(`new table shape needs its own control: ${table.label}`);
			const { warnings } = compileOk(lm386Doc(table.numbers));
			expect(droppedChips(warnings)).toEqual([]);
		});
	}
});

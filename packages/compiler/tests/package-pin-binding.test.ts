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

function opampSection(id: string, inn: number, inw: number, out: number, part: string): string {
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
        node: 5
        position:
          x: 0
          y: 20
      - name: "v-"
        role: supplyNegative
        node: 6
        position:
          x: 0
          y: -20
    properties:
      PartNumber: ${part}`;
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

describe("package-pin binding: LM386 power-amp entry", () => {
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

/**
 * Cross-package taper-convention pinning (core importer <-> compiler).
 *
 * The importer's `taperConvention: "alps"` table mirrors what the compiler
 * already executes for the letters A/B/C. This test pins the two together
 * using worktree source for both packages (relative imports: bare
 * `@vessel-dsp/*` specifiers resolve to the published install cache here,
 * which predates the importer): for each letter, a divider compiled with
 * `Taper: <letter>` must equal the same divider compiled with the law name
 * the importer writes, and the three laws must be pairwise different.
 * Swapping the importer's table entry for A to `linear` in a scratch run
 * breaks the A-identity below (shown once, then restored).
 */
import { describe, expect, test } from "bun:test";
import {
	convertDipTrace,
} from "../packages/core/src/formats/diptrace/convert";
import { parseDipTraceSchematic } from "../packages/core/src/formats/diptrace/parser";
import type { CircuitDocument } from "../packages/core/src/model/types";
import {
	compile,
	pedalPartCatalog,
} from "../packages/compiler/src/index";
import { ReferenceRuntime } from "../packages/runtime/src/index";

const MANUFACTURER_FIXTURE_URL = new URL(
	"fixtures/diptrace/manufacturer.dchxml",
	import.meta.url,
);

const LETTER_TO_LAW = {
	A: "log",
	B: "linear",
	C: "reverse-log",
} as const;

function divider(taperProperty: string): string {
	return `schema: circuit-interchange/v4
audio:
  input: IN
  output: OUT
  bypass: none
metadata:
  name: "Taper divider"
  description: "100k pot, wiper at half travel, 10M load to ground."
  partNumber: ""
source:
  format: vdsp
components:
  - id: IN
    kind: jack
    name: IN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
  - id: OUT
    kind: jack
    name: OUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
  - id: GND1
    kind: ground
    name: GND1
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
  - id: P1
    kind: potentiometer
    name: P1
    sourceTypeName: Circuit.Potentiometer
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: ccw
        role: ccw
        node: 1
        position:
          x: -10
          y: 10
      - name: wiper
        role: wiper
        node: 2
        position:
          x: 0
          y: 0
      - name: cw
        role: cw
        node: 0
        position:
          x: -10
          y: -10
    properties:
      Resistance:
        raw: "100k"
        value: 100000
        unit: ""
      Wipe: "0.5"
${taperProperty}  - id: RLOAD
    kind: resistor
    name: RLOAD
    sourceTypeName: Circuit.Resistor
    origin:
      x: 100
      y: -50
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 100
          y: -50
      - name: b
        node: 0
        position:
          x: 100
          y: -100
    properties:
      Resistance:
        raw: "10M"
        value: 10000000
        unit: ""
`;
}

function compileDivider(taperProperty: string): {
	taper: string;
	dc: number;
} {
	const result = compile(divider(taperProperty), {
		registry: pedalPartCatalog,
	});
	if (result.status !== "ok") {
		throw new Error(
			`divider did not compile: ${JSON.stringify(result.reasons).slice(0, 200)}`,
		);
	}
	const program = (
		result as unknown as {
			program: {
				controls: { id: string; taper: string }[];
			};
		}
	).program;
	if (program.controls.length !== 1) {
		throw new Error(
			`expected one control, saw ${program.controls.length}`,
		);
	}
	const taper = program.controls[0]?.taper ?? "?";
	const runtime = new ReferenceRuntime(
		(result as unknown as { program: never }).program,
	);
	runtime.prepare(48000);
	const input = new Float64Array(4800).fill(1.0);
	const output = runtime.process(input) as Float64Array;
	return { taper, dc: output[output.length - 1] ?? NaN };
}

async function importerTaperFor(refDes: string): Promise<string | undefined> {
	const model = parseDipTraceSchematic(
		await Bun.file(MANUFACTURER_FIXTURE_URL).text(),
	);
	const converted = convertDipTrace(model, { taperConvention: "alps" });
	const component = converted.document?.components.find(
		(component: CircuitDocument["components"][number]) =>
			component.id === refDes,
	);
	const value = component?.properties.Taper;
	return typeof value === "string" ? value : undefined;
}

describe("taper convention core <-> compiler", () => {
	test("importer law names compile exactly like the compiler letters", async () => {
		// P1 carries Manufacturer A500k: the importer writes Taper: log.
		expect(await importerTaperFor("P1")).toBe("log");
		const letter = compileDivider('      Taper: A\n');
		const law = compileDivider('      Taper: log\n');
		expect(law.taper).toBe("logarithmic");
		expect(letter.taper).toBe(law.taper);
		expect(Math.abs(letter.dc - law.dc)).toBeLessThan(1e-9);
	});

	test("the three laws are pairwise different", () => {
		const log = compileDivider('      Taper: log\n');
		const linear = compileDivider('      Taper: linear\n');
		const reverseLog = compileDivider('      Taper: reverse-log\n');
		expect(new Set([log.taper, linear.taper, reverseLog.taper]).size).toBe(3);
		expect(Math.abs(log.dc - linear.dc)).toBeGreaterThan(0.05);
		expect(Math.abs(reverseLog.dc - linear.dc)).toBeGreaterThan(0.05);
		expect(Math.abs(log.dc - reverseLog.dc)).toBeGreaterThan(0.05);
	});

	test("letter/law identity holds for B and C", async () => {
		// P6 reads B50k from Name, P22 reads C50k from Manufacturer.
		const model = parseDipTraceSchematic(
			await Bun.file(MANUFACTURER_FIXTURE_URL).text(),
		);
		const converted = convertDipTrace(model, { taperConvention: "alps" });
		const byId = new Map(
			(converted.document?.components ?? []).map((component) => [
				component.id,
				component,
			]),
		);
		expect(byId.get("P6")?.properties.Taper).toBe("linear");
		expect(byId.get("P22")?.properties.Taper).toBe("reverse-log");
		for (const [letter, law] of [
			["B", "linear"],
			["C", "reverse-log"],
		] as const) {
			const fromLetter = compileDivider(`      Taper: ${letter}\n`);
			const fromLaw = compileDivider(`      Taper: ${LETTER_TO_LAW[letter]}\n`);
			expect(fromLetter.taper).toBe(fromLaw.taper);
			expect(Math.abs(fromLetter.dc - fromLaw.dc)).toBeLessThan(1e-9);
		}
	});
});

describe("taper law reaches the MNA", () => {
	test("divider at half travel: linear halves, log/anti-log mirror", () => {
		const linear = compileDivider('      Taper: linear\n');
		const log = compileDivider('      Taper: log\n');
		const reverseLog = compileDivider('      Taper: reverse-log\n');
		// 10M load on a 100k track: linear reads just under half the source.
		expect(Math.abs(linear.dc - 0.5)).toBeLessThan(0.005);
		expect(Math.abs(log.dc - linear.dc)).toBeGreaterThan(0.05);
		expect(Math.abs(reverseLog.dc - linear.dc)).toBeGreaterThan(0.05);
		// Mirror images across half travel sum to the 1 V source.
		expect(Math.abs(log.dc + reverseLog.dc - 1.0)).toBeLessThan(0.005);
	});
});

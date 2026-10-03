import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import type { PartEntry, PartRegistry } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";

/**
 * A declared program between an ADC and a DAC plays at the DAC's full scale over the ADC's.
 *
 * Synthetic parts on purpose: the rule is about two catalog numbers and the node the circuit
 * shares with each converter, so the control is a registry whose ratio is known in advance.
 */

const comp = (id: string, kind: string, extra: string, terminals: [string, string, number][], typeName = "null") => `  - id: ${id}
    kind: ${kind}
    name: ${id}
    sourceTypeName: ${typeName}
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
${extra}    terminals:
${terminals.map(([n, r, node]) => `      - name: ${n}
        role: ${r}
        node: ${node}
        position:
          x: 0
          y: 0`).join("\n")}
`;

const chip = (id: string, part: string, node: number) =>
	comp(id, "ic", `    properties:\n      PartNumber: "${part}"\n`, [["a", "pin", node]]);

const source = (converters: string) => `schema: circuit-interchange/v2
metadata:
  name: "Converter shell"
  description: "A unity program between two converters."
  partNumber: ""
source:
  format: interchange
  filename: converters.vdsp
components:
${comp("JIN", "jack", "", [["tip", "signal", 1]], "Circuit.Input")}${comp("JOUT", "jack", "", [["tip", "signal", 4]], "Circuit.Output")}${comp("R1", "resistor", "    properties:\n      Resistance: \"10k\"\n", [["a", "end", 1], ["b", "end", 2]])}${comp("R2", "resistor", "    properties:\n      Resistance: \"10k\"\n", [["a", "end", 3], ["b", "end", 4]])}${converters}  - id: U1
    kind: ic
    name: U1
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    properties:
      PartNumber: "TC25SC080AU-104"
    terminals:
      - name: input
        role: input
        node: 2
        position:
          x: 0
          y: 0
      - name: output
        role: output
        node: 3
        position:
          x: 0
          y: 0
    program:
      positions:
        - id: thru
          label: "THRU"
          ops:
            - op: mix
              terms:
                - source:
                    kind: input
                  gain: 1
              out: 0
          lines: {}
wires: []
`;

const converter = (
	part: string,
	direction: "adc" | "dac",
	fullScaleVoltsPeakToPeak: number | null,
): PartEntry => ({
	partIds: [part],
	declaredTypes: [],
	terminalRoleGroups: [],
	model: { kind: "law", law: { kind: "open" } },
	converter: { direction, fullScaleVoltsPeakToPeak, basis: "test" },
});

const registry = (adc: number | null, dac: number | null): PartRegistry => ({
	entries: [converter("TEST-ADC", "adc", adc), converter("TEST-DAC", "dac", dac)],
});

const wired = chip("ADC", "TEST-ADC", 2) + chip("DAC", "TEST-DAC", 3);

function level(text: string, parts: PartRegistry): number {
	const result = compile(text, { registry: parts });
	if (result.status !== "ok") throw new Error(JSON.stringify(result.reasons));
	const runtime = new ReferenceRuntime(result.program);
	const rate = 48000;
	runtime.prepare(rate);
	const n = rate / 5;
	const input = new Float64Array(n);
	for (let i = 0; i < n; i++) input[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate);
	const output = runtime.process(input);
	let re = 0;
	let im = 0;
	for (let i = n / 2; i < n; i++) {
		re += output[i]! * Math.cos((2 * Math.PI * 1000 * i) / rate);
		im += output[i]! * Math.sin((2 * Math.PI * 1000 * i) / rate);
	}
	return Math.hypot(re, im);
}

const warningsOf = (text: string, parts: PartRegistry) => {
	const result = compile(text, { registry: parts });
	if (result.status !== "ok") throw new Error(JSON.stringify(result.reasons));
	return result.warnings.filter((w) => w.code === "converter-scale-not-modelled");
};

describe("converter full scale sets a declared program's level", () => {
	it("plays at dac / adc when both converters are wired and cited", () => {
		const equal = level(source(wired), registry(2, 2));
		expect(level(source(wired), registry(4, 2)) / equal).toBeCloseTo(0.5, 6);
		expect(warningsOf(source(wired), registry(4, 2))).toHaveLength(0);
	});

	it("stays unity and names the gap when a full scale is not cited", () => {
		const equal = level(source(wired), registry(2, 2));
		expect(level(source(wired), registry(null, 2)) / equal).toBeCloseTo(1, 6);
		expect(warningsOf(source(wired), registry(null, 2))).toHaveLength(1);
	});

	it("names a converter the document has but does not wire to the program", () => {
		const unwired = chip("ADC", "TEST-ADC", 9) + chip("DAC", "TEST-DAC", 3);
		expect(warningsOf(source(unwired), registry(4, 2))).toHaveLength(1);
	});

	it("raises nothing for a document with no converters", () => {
		expect(warningsOf(source(""), registry(4, 2))).toHaveLength(0);
	});
});

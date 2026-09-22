import { describe, expect, test } from "bun:test";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
} from "../../../packages/core/src";

/**
 * A reprogrammable chip's behaviour is not determined by its part number, so the format has to
 * carry which program **this instance** is running. Measured on the corpus this serves:
 * `TC25SC080AU-104` is a delay in `boss-dd-5`, a reverb in `boss-rv-3` and a pitch shifter in
 * `boss-hr-2`, and a catalog entry holds one model per part.
 *
 * The declaration must survive the format for the same reason `devices` and `windings` must: a
 * consumer that has to reconstruct it from prose or a sibling file is the defect it removes.
 */
const source = `schema: circuit-interchange/v2
metadata:
  name: "Programmed shell"
  description: "A reprogrammable DSP shell carrying a two-position delay program."
  partNumber: ""
source:
  format: interchange
  filename: component-program-round-trip.vdsp
components:
  - id: U1
    kind: ic
    name: U1
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in
        role: pin
        node: 0
        position:
          x: 0
          y: 0
      - name: out
        role: pin
        node: 1
        position:
          x: 10
          y: 0
    program:
      selector: "MODE"
      positions:
        - id: delay-1
          label: "DELAY 1"
          ops:
            - op: filter-dcblock
              input:
                kind: input
              out: 0
            - op: delay-tap-fractional
              line: dl
              length:
                mode: parameter
              out: 1
          lines:
            dl:
              delaySeconds:
                control: "D.TIME"
                min: 0.001
                max: 0.05
                source: "Service notes, MODE table"
        - id: delay-2
          label: "DELAY 2"
          ops:
            - op: delay-tap-fractional
              line: dl
              length:
                mode: parameter
              out: 0
          lines:
            dl:
              delaySeconds:
                min: 0.05
                max: 0.2
    properties: {}
wires: []
`;

describe("a component's program survives the format", () => {
	test("parses the selector, positions, ops and cited parameters", () => {
		const document = parseInterchangeYaml(source);
		const component = document.components[0];
		expect(component?.id).toBe("U1");
		const program = component?.program;
		expect(program).toBeDefined();
		if (program === undefined) return;

		expect(program.selector).toBe("MODE");
		expect(program.positions.map((position) => position.id)).toEqual([
			"delay-1",
			"delay-2",
		]);

		const first = program.positions[0];
		expect(first?.label).toBe("DELAY 1");
		// The op list is carried verbatim, including arguments this format has no opinion about:
		// the vocabulary belongs to the runtime that executes it.
		expect(first?.ops.map((op) => op.op)).toEqual([
			"filter-dcblock",
			"delay-tap-fractional",
		]);
		expect(first?.ops[1]?.line).toBe("dl");
		expect(first?.ops[1]?.length).toEqual({ mode: "parameter" });

		const delaySeconds = first?.lines?.dl?.delaySeconds;
		expect(delaySeconds?.control).toBe("D.TIME");
		expect(delaySeconds?.min).toBe(0.001);
		expect(delaySeconds?.max).toBe(0.05);
		expect(delaySeconds?.source).toBe("Service notes, MODE table");
	});

	test("an uncited parameter stays uncited, because that is a statement", () => {
		// Omitting `source` says the parameter is not evidenced and the program makes no claim on
		// that axis. If the format invented a citation here, an undocumented mode would become
		// indistinguishable from a documented one.
		const document = parseInterchangeYaml(source);
		const second = document.components[0]?.program?.positions[1];
		expect(second?.lines?.dl?.delaySeconds?.source).toBeUndefined();
		expect(second?.lines?.dl?.delaySeconds?.min).toBe(0.05);
	});

	test("round-trips through the serializer unchanged", () => {
		const once = parseInterchangeYaml(source);
		const twice = parseInterchangeYaml(serializeInterchangeYaml(once));
		expect(twice.components[0]?.program).toEqual(once.components[0]?.program);
	});

	test("a component with no program keeps none, rather than gaining an empty one", () => {
		const withoutProgram = source.replace(
			/    program:\n(?:.*\n)*?    properties: \{\}\n/,
			"    properties: {}\n",
		);
		const document = parseInterchangeYaml(withoutProgram);
		expect(document.components[0]?.program).toBeUndefined();
	});

	test("refuses several positions with no selector naming the control", () => {
		// The negative control. Two positions and nothing saying which control chooses between
		// them is a declaration that cannot be executed, and silently taking the first would be
		// the guess this format exists to prevent.
		const ambiguous = source.replace('      selector: "MODE"\n', "");
		expect(() => parseInterchangeYaml(ambiguous)).toThrow(/selector/);
	});

	test("refuses an op with no name and a position with no ops", () => {
		const namelessOp = source.replace("            - op: filter-dcblock\n", "            - out: 9\n");
		expect(() => parseInterchangeYaml(namelessOp)).toThrow();

		const noOps = source.replace(
			/          ops:\n(?:.*\n)*?          lines:\n/,
			"          ops: []\n          lines:\n",
		);
		expect(() => parseInterchangeYaml(noOps)).toThrow(/at least one op/);
	});
});

import { describe, expect, test } from "bun:test";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
	validateDocument,
} from "../../../packages/core/src";

/**
 * `devices` and `windings` both say what a schematic symbol contains: N devices in one package,
 * or N coupled coils in one magnetic. Both must survive the format, because a consumer that has
 * to reconstruct them from terminal spellings is the defect they exist to remove.
 */
const source = `schema: circuit-interchange/v2
metadata:
  name: "Package and magnetic"
  description: "A dual op-amp package and a tapped power transformer."
  partNumber: ""
source:
  format: interchange
  filename: device-winding-round-trip.vdsp
components:
  - id: IC1
    kind: opamp
    name: IC1
    sourceTypeName: null
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: in_a_plus
        role: nonInvertingInput
        node: 0
        position:
          x: 0
          y: 0
      - name: out_a
        role: output
        node: 1
        position:
          x: 10
          y: 0
      - name: in_b_plus
        role: nonInvertingInput
        node: 2
        position:
          x: 0
          y: 10
      - name: out_b
        role: output
        node: 3
        position:
          x: 10
          y: 10
      - name: gnd
        role: negativeSupply
        node: 4
        position:
          x: 5
          y: 20
    devices:
      - id: IC1_A
        kind: opamp
        terminals:
          - in_a_plus
          - out_a
          - gnd
      - id: IC1_B
        kind: opamp
        terminals:
          - in_b_plus
          - out_b
          - gnd
    properties:
      PartNumber: TL072
  - id: T1
    kind: transformer
    name: T1
    sourceTypeName: null
    origin:
      x: 100
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: primary_a
        role: winding
        node: 5
        position:
          x: 100
          y: 0
      - name: primary_b
        role: winding
        node: 6
        position:
          x: 100
          y: 20
      - name: hv_a
        role: winding
        node: 7
        position:
          x: 120
          y: 0
      - name: hv_center_tap
        role: windingCenterTap
        node: 8
        position:
          x: 120
          y: 10
      - name: hv_b
        role: winding
        node: 9
        position:
          x: 120
          y: 20
    windings:
      - role: primary
        terminals:
          - primary_a
          - primary_b
        impedances:
          - across:
              - primary_a
              - primary_b
            impedance:
              raw: "3.4 kO plate-to-plate"
              value: 3400
              unit: O
      - id: hv
        role: hv
        terminals:
          - hv_a
          - hv_center_tap
          - hv_b
        voltage:
          raw: "290-0-290 VAC source-visible"
          value: 290
          unit: V
    properties: {}
nodes:
  - id: 0
    role: signal
    members:
      - componentId: IC1
        terminalName: in_a_plus
  - id: 1
    role: signal
    members:
      - componentId: IC1
        terminalName: out_a
  - id: 2
    role: signal
    members:
      - componentId: IC1
        terminalName: in_b_plus
  - id: 3
    role: signal
    members:
      - componentId: IC1
        terminalName: out_b
  - id: 4
    role: signal
    members:
      - componentId: IC1
        terminalName: gnd
  - id: 5
    role: signal
    members:
      - componentId: T1
        terminalName: primary_a
  - id: 6
    role: signal
    members:
      - componentId: T1
        terminalName: primary_b
  - id: 7
    role: signal
    members:
      - componentId: T1
        terminalName: hv_a
  - id: 8
    role: signal
    members:
      - componentId: T1
        terminalName: hv_center_tap
  - id: 9
    role: signal
    members:
      - componentId: T1
        terminalName: hv_b
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;

describe("devices and windings round-trip", () => {
	test("survive parse and re-serialize byte for byte", () => {
		const document = parseInterchangeYaml(source);
		expect(document.warnings).toEqual([]);

		const ic1 = document.components.find((c) => c.id === "IC1");
		expect(ic1?.devices?.map((d) => d.id)).toEqual(["IC1_A", "IC1_B"]);
		// The shared supply pin belongs to both sections, which is the whole point of a package.
		expect(ic1?.devices?.every((d) => d.terminals.includes("gnd"))).toBe(true);

		const t1 = document.components.find((c) => c.id === "T1");
		expect(t1?.windings?.map((w) => w.role)).toEqual(["primary", "hv"]);
		// An unnamed winding stays unnamed rather than gaining an invented id.
		expect(t1?.windings?.[0]?.id).toBeUndefined();
		expect(t1?.windings?.[1]?.terminals).toEqual([
			"hv_a",
			"hv_center_tap",
			"hv_b",
		]);
		// A coil's own rated voltage, and a rating that names the pair it is measured across.
		expect(t1?.windings?.[1]?.voltage?.value).toBe(290);
		expect(t1?.windings?.[0]?.impedances?.[0]?.across).toEqual([
			"primary_a",
			"primary_b",
		]);
		expect(t1?.windings?.[0]?.impedances?.[0]?.impedance.value).toBe(3400);
		expect(t1?.windings?.[0]?.voltage).toBeUndefined();
		expect(t1?.windings?.[1]?.impedances).toBeUndefined();

		expect(serializeInterchangeYaml(document)).toBe(source);
	});

	test("validate without issues, and both constructs are optional", () => {
		const issues = validateDocument(parseInterchangeYaml(source));
		expect(
			issues.filter(
				(issue) =>
					issue.code.startsWith("winding-") || issue.code.startsWith("device-"),
			),
		).toEqual([]);

		// Dropping both declarations leaves a valid document that serializes without the keys.
		// The strip matches any depth below the key, because a winding's ratings nest four levels
		// under it -- an indent-listing regex made this assertion vacuous once already.
		const stripped = source.replace(
			/\n    (?:devices|windings):\n(?: {6,}.*\n)+/g,
			"\n",
		);
		expect(stripped).not.toContain("across:");
		expect(stripped).not.toContain("impedance:");
		expect(stripped).not.toContain("- role:");
		const bare = parseInterchangeYaml(stripped);
		expect(bare.warnings).toEqual([]);
		expect(bare.components.every((c) => c.devices === undefined)).toBe(true);
		expect(bare.components.every((c) => c.windings === undefined)).toBe(true);
		const yaml = serializeInterchangeYaml(bare);
		expect(yaml).not.toContain("devices:");
		expect(yaml).not.toContain("windings:");
	});
});

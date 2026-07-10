import { describe, expect, test } from "bun:test";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
	validateDocument,
} from "../../../packages/core/src";

const CHARGE_PUMP_FIXTURE_URL = new URL(
	"../../fixtures/interchange/charge-pump-derived-rails-valid.vdsp",
	import.meta.url,
);

describe("power converter identity", () => {
	test("accepts a source-visible charge pump component with charge-pump-derived rails", async () => {
		const yaml = await Bun.file(CHARGE_PUMP_FIXTURE_URL).text();
		const doc = parseInterchangeYaml(yaml);

		const converter = doc.components.find((c) => c.id === "U_CP");
		expect(converter?.kind).toBe("power-converter");
		expect(converter?.properties.ConverterKind).toBe("charge-pump");

		expect(doc.power).toMatchObject({
			coverage: "explicit-topology",
			domains: [
				{
					id: "klon-charge-pump-domain",
					groundPolarity: "bipolar",
					rails: [
						{ railComponentId: "RAIL_MAIN", role: "main-supply" },
						{
							railComponentId: "RAIL_PLUS2",
							role: "charge-pump-output",
							derivation: "doubler",
							converterComponentId: "U_CP",
							nominalVoltage: { raw: "18V", value: 18, unit: "V" },
						},
						{
							railComponentId: "RAIL_MINUS",
							role: "negative-supply",
							derivation: "inverter",
							converterComponentId: "U_CP",
							nominalVoltage: { raw: "-9V", value: -9, unit: "V" },
						},
					],
				},
			],
		});

		expect(validateDocument(doc)).toEqual([]);
	});

	test("round-trips the charge-pump converter component and rail derivations", async () => {
		const yaml = await Bun.file(CHARGE_PUMP_FIXTURE_URL).text();
		const doc = parseInterchangeYaml(yaml);

		const serialized = serializeInterchangeYaml(doc);
		const reparsed = parseInterchangeYaml(serialized);

		expect(reparsed.power).toEqual(doc.power);
		expect(reparsed.components.find((c) => c.id === "U_CP")).toEqual(
			doc.components.find((c) => c.id === "U_CP"),
		);

		const reserialized = serializeInterchangeYaml(reparsed);
		expect(reserialized).toEqual(serialized);
	});

	test("rejects a charge-pump-derived rail without a converter component", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Missing Converter
  description: ""
  partNumber: ""
source: {}
components:
  - id: RAIL_A
    kind: rail
    name: RAIL_A
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 0
          y: 0
    properties:
      V:
        raw: "18V"
        value: 18
        unit: V
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds: []
      groundPolarity: bipolar
      rails:
        - railComponentId: RAIL_A
          role: charge-pump-output
          derivation: doubler
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-rail-converter-required");
	});

	test("rejects a converterComponentId that points at a non-converter component", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Wrong Component Kind
  description: ""
  partNumber: ""
source: {}
components:
  - id: RAIL_A
    kind: rail
    name: RAIL_A
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 0
          y: 0
    properties:
      V:
        raw: "18V"
        value: 18
        unit: V
  - id: R1
    kind: resistor
    name: R1
    origin:
      x: 20
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        position:
          x: 20
          y: 0
      - name: b
        position:
          x: 20
          y: 10
    properties:
      R:
        raw: "10k"
        value: 10000
        unit: "Ω"
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds: []
      groundPolarity: bipolar
      rails:
        - railComponentId: RAIL_A
          role: charge-pump-output
          derivation: doubler
          converterComponentId: R1
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-rail-converter-invalid-kind");
	});

	test("rejects a regulated-output role paired with a direct derivation", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Contradictory Derivation
  description: ""
  partNumber: ""
source: {}
components:
  - id: RAIL_A
    kind: rail
    name: RAIL_A
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 0
          y: 0
    properties:
      V:
        raw: "5V"
        value: 5
        unit: V
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds: []
      groundPolarity: bipolar
      rails:
        - railComponentId: RAIL_A
          role: regulated-output
          derivation: direct
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-rail-role-derivation-mismatch");
	});

	test("rejects two rails claiming the same role on the same converter", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Duplicate Converter Role
  description: ""
  partNumber: ""
source: {}
components:
  - id: RAIL_A
    kind: rail
    name: RAIL_A
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 0
          y: 0
    properties:
      V:
        raw: "18V"
        value: 18
        unit: V
  - id: RAIL_B
    kind: rail
    name: RAIL_B
    origin:
      x: 20
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 20
          y: 0
    properties:
      V:
        raw: "18V"
        value: 18
        unit: V
  - id: U_CP
    kind: power-converter
    name: U_CP
    origin:
      x: 40
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 40
          y: 0
    properties:
      ConverterKind: charge-pump
      PartNumber: MAX1044
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds: []
      groundPolarity: bipolar
      rails:
        - railComponentId: RAIL_A
          role: charge-pump-output
          derivation: doubler
          converterComponentId: U_CP
        - railComponentId: RAIL_B
          role: charge-pump-output
          derivation: doubler
          converterComponentId: U_CP
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-rail-duplicate-converter-role");
	});

	test("warns when a power-converter component has no PartNumber", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Missing Part Number
  description: ""
  partNumber: ""
source: {}
components:
  - id: U_CP
    kind: power-converter
    name: U_CP
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 0
          y: 0
    properties:
      ConverterKind: charge-pump
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-converter-missing-part-number");
	});

	test("warns when a charge-pump-derived rail has no nominalVoltage", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Missing Nominal Voltage
  description: ""
  partNumber: ""
source: {}
components:
  - id: RAIL_A
    kind: rail
    name: RAIL_A
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 0
          y: 0
    properties:
      V:
        raw: "18V"
        value: 18
        unit: V
  - id: U_CP
    kind: power-converter
    name: U_CP
    origin:
      x: 20
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: t
        position:
          x: 20
          y: 0
    properties:
      ConverterKind: charge-pump
      PartNumber: MAX1044
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds: []
      groundPolarity: bipolar
      rails:
        - railComponentId: RAIL_A
          role: charge-pump-output
          derivation: doubler
          converterComponentId: U_CP
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-rail-missing-nominal-voltage");
	});
});

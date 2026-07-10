import { describe, expect, test } from "bun:test";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
	validateDocument,
} from "../../../packages/core/src";

const POWER_TOPOLOGY_FIXTURE_URL = new URL(
	"../../fixtures/interchange/voltage-divider-power-topology.vdsp",
	import.meta.url,
);

describe("circuit-interchange power topology", () => {
	test("parses the power block without dropping domain or rail fields", async () => {
		const yaml = await Bun.file(POWER_TOPOLOGY_FIXTURE_URL).text();
		const doc = parseInterchangeYaml(yaml);

		expect(doc.power).toMatchObject({
			schema: "circuit-power/v1",
			coverage: "explicit-topology",
			domains: [
				{
					id: "main",
					sourceComponentIds: ["BATT1"],
					ratedVoltage: { raw: "9V", value: 9, unit: "V" },
					groundPolarity: "negative-ground",
					rails: [
						{
							railComponentId: "RAIL_MAIN",
							role: "main-supply",
							derivation: "direct",
						},
						{
							railComponentId: "RAIL_BIAS",
							role: "bias-reference",
							derivation: "divider",
							parentRailComponentId: "RAIL_MAIN",
						},
					],
				},
			],
		});

		const powerIssues = validateDocument(doc).filter((issue) =>
			issue.code.startsWith("power-"),
		);
		expect(powerIssues).toEqual([]);
	});

	test("round-trips the power block through serialize and re-parse", async () => {
		const yaml = await Bun.file(POWER_TOPOLOGY_FIXTURE_URL).text();
		const doc = parseInterchangeYaml(yaml);

		const serialized = serializeInterchangeYaml(doc);
		const reparsed = parseInterchangeYaml(serialized);

		expect(reparsed.power).toEqual(doc.power);
		expect(serialized).toContain("schema: circuit-interchange/v3");
	});

	test("rejects a power block on a v2 document", () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Power on v2
  description: ""
  partNumber: ""
source: {}
components: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: not-applicable
  domains: []
`;
		expect(() => parseInterchangeYaml(yaml)).toThrow(
			"power: requires schema circuit-interchange/v3",
		);
	});

	test("rejects an unknown power enum value", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Power Bad Enum
  description: ""
  partNumber: ""
source: {}
components: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: not-a-real-coverage
  domains: []
`;
		expect(() => parseInterchangeYaml(yaml)).toThrow(
			"power.coverage: expected explicit-topology, declared-rails, external-unspecified, or not-applicable",
		);
	});

	test("flags unresolved source and rail component references", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Power Validation
  description: ""
  partNumber: ""
source: {}
components: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: main
      sourceComponentIds:
        - MISSING_SOURCE
      groundPolarity: negative-ground
      rails:
        - railComponentId: MISSING_RAIL
          role: main-supply
          derivation: direct
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-source-unresolved");
		expect(codes).toContain("power-rail-unresolved");
	});

	test("flags a parentRailComponentId cycle", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Power Cycle
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
        raw: "9V"
        value: 9
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
        raw: "4.5V"
        value: 4.5
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
      groundPolarity: negative-ground
      rails:
        - railComponentId: RAIL_A
          role: main-supply
          derivation: direct
          parentRailComponentId: RAIL_B
        - railComponentId: RAIL_B
          role: bias-reference
          derivation: divider
          parentRailComponentId: RAIL_A
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-rail-parent-cycle");
	});

	test("flags a coverage and domains mismatch", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Power Coverage Mismatch
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
        raw: "9V"
        value: 9
        unit: V
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: not-applicable
  domains:
    - id: main
      sourceComponentIds: []
      groundPolarity: negative-ground
      rails:
        - railComponentId: RAIL_A
          role: main-supply
          derivation: direct
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-coverage-domains-mismatch");
	});

	test("flags duplicate rail ownership across domains", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Power Duplicate Ownership
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
        raw: "9V"
        value: 9
        unit: V
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: explicit-topology
  domains:
    - id: domain-a
      sourceComponentIds: []
      groundPolarity: negative-ground
      rails:
        - railComponentId: RAIL_A
          role: main-supply
          derivation: direct
    - id: domain-b
      sourceComponentIds: []
      groundPolarity: positive-ground
      rails:
        - railComponentId: RAIL_A
          role: main-supply
          derivation: direct
`;
		const doc = parseInterchangeYaml(yaml);
		const codes = validateDocument(doc).map((issue) => issue.code);
		expect(codes).toContain("power-rail-duplicate-ownership");
	});
});

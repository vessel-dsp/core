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
					sourceKind: "external-dc",
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
							nominalVoltage: { raw: "4.5V", value: 4.5, unit: "V" },
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

// --- supply-rail ownership (single-owner) rule --------------------------------
// Anonymous fixtures exercising the power-model-driven ownership matrix. These
// are deliberately connectivity-free (wires: []) to prove the verdict never
// depends on drawing connectivity or on component voltage properties.

function componentYaml(id: string, kind: string, propsBlock?: string): string {
	return [
		`  - id: ${id}`,
		`    kind: ${kind}`,
		`    name: ${id}`,
		"    origin:",
		"      x: 0",
		"      y: 0",
		"    rotation: 0",
		"    flipped: false",
		"    terminals:",
		"      - name: t",
		"        position:",
		"          x: 0",
		"          y: 0",
		propsBlock ? `    properties:\n${propsBlock}` : "    properties: {}",
	].join("\n");
}

const voltageProps = (raw: string, value: number): string =>
	`      V:\n        raw: "${raw}"\n        value: ${value}\n        unit: V`;
const converterProps =
	"      ConverterKind: charge-pump\n      PartNumber: MAX1044";

function railYaml(binding: {
	id: string;
	role: string;
	derivation: string;
	converterComponentId?: string;
	parentRailComponentId?: string;
	nominalVoltage?: readonly [string, number];
}): string {
	const lines = [
		`        - railComponentId: ${binding.id}`,
		`          role: ${binding.role}`,
		`          derivation: ${binding.derivation}`,
	];
	if (binding.converterComponentId) {
		lines.push(
			`          converterComponentId: ${binding.converterComponentId}`,
		);
	}
	if (binding.parentRailComponentId) {
		lines.push(
			`          parentRailComponentId: ${binding.parentRailComponentId}`,
		);
	}
	if (binding.nominalVoltage) {
		const [raw, value] = binding.nominalVoltage;
		lines.push(
			"          nominalVoltage:",
			`            raw: "${raw}"`,
			`            value: ${value}`,
			"            unit: V",
		);
	}
	return lines.join("\n");
}

function powerDoc(spec: {
	components: readonly string[];
	sourceComponentIds: readonly string[];
	sourceKind?: string;
	powerSourceKind?: string;
	rails?: readonly string[];
	coverage?: string;
}): string {
	const sources = spec.sourceComponentIds.length
		? `\n${spec.sourceComponentIds.map((id) => `        - ${id}`).join("\n")}`
		: " []";
	const rails = spec.rails?.length ? `\n${spec.rails.join("\n")}` : " []";
	const sourceKindLine = spec.sourceKind
		? `      sourceKind: ${spec.sourceKind}\n`
		: "";
	const powerSourceKindLine = spec.powerSourceKind
		? `      powerSourceKind: ${spec.powerSourceKind}\n`
		: "";
	return `schema: circuit-interchange/v3
metadata:
  name: Ownership Case
  description: ""
  partNumber: ""
source: {}
components:
${spec.components.join("\n")}
wires: []
directives: []
diagnostics: []
rawAttributes: {}
power:
  schema: circuit-power/v1
  coverage: ${spec.coverage ?? "explicit-topology"}
  domains:
    - id: main
      sourceComponentIds:${sources}
${sourceKindLine}${powerSourceKindLine}      groundPolarity: negative-ground
      rails:${rails}
`;
}

const codesOf = (yaml: string): string[] =>
	validateDocument(parseInterchangeYaml(yaml)).map((issue) => issue.code);

describe("circuit-interchange supply-rail ownership", () => {
	test("mains-ac with a bound kind: rail is a fixed-owner conflict, even without a voltage", () => {
		const yaml = powerDoc({
			components: [
				componentYaml("PT", "transformer"),
				componentYaml("BPLUS", "rail"), // no V property on purpose
			],
			sourceComponentIds: ["PT"],
			sourceKind: "mains-ac",
			rails: [
				railYaml({ id: "BPLUS", role: "main-supply", derivation: "direct" }),
			],
		});
		expect(codesOf(yaml)).toContain("power-rail-fixed-owner-conflict");
	});

	test("the same mains domain bound to a kind: port is valid", () => {
		const yaml = powerDoc({
			components: [
				componentYaml("PT", "transformer"),
				componentYaml("BPLUS", "port"),
			],
			sourceComponentIds: ["PT"],
			sourceKind: "mains-ac",
			rails: [
				railYaml({ id: "BPLUS", role: "main-supply", derivation: "direct" }),
			],
		});
		const codes = codesOf(yaml);
		expect(codes).not.toContain("power-rail-fixed-owner-conflict");
		expect(codes).not.toContain("power-domain-source-owner-unresolved");
	});

	test("transformer-inferred domain (no declared sourceKind) still flags a bound rail with wires: []", () => {
		const yaml = powerDoc({
			components: [
				componentYaml("PT", "transformer"),
				componentYaml("BPLUS", "rail", voltageProps("340V", 340)),
			],
			sourceComponentIds: ["PT"],
			rails: [
				railYaml({ id: "BPLUS", role: "main-supply", derivation: "direct" }),
			],
		});
		expect(codesOf(yaml)).toContain("power-rail-fixed-owner-conflict");
	});

	test("external-dc with a direct source rail is valid", () => {
		const yaml = powerDoc({
			components: [componentYaml("DC_IN", "rail", voltageProps("9V", 9))],
			sourceComponentIds: ["DC_IN"],
			sourceKind: "external-dc",
			rails: [
				railYaml({ id: "DC_IN", role: "main-supply", derivation: "direct" }),
			],
		});
		expect(codesOf(yaml)).toEqual([]);
	});

	test("external-dc with a converter-derived rail is a conflict; a port with nominalVoltage is valid", () => {
		const asRail = powerDoc({
			components: [
				componentYaml("DC_IN", "rail", voltageProps("9V", 9)),
				componentYaml("U_CP", "power-converter", converterProps),
				componentYaml("VNEG", "rail", voltageProps("-9V", -9)),
			],
			sourceComponentIds: ["DC_IN"],
			sourceKind: "external-dc",
			rails: [
				railYaml({ id: "DC_IN", role: "main-supply", derivation: "direct" }),
				railYaml({
					id: "VNEG",
					role: "negative-supply",
					derivation: "inverter",
					converterComponentId: "U_CP",
					nominalVoltage: ["-9V", -9],
				}),
			],
		});
		expect(codesOf(asRail)).toContain("power-rail-fixed-owner-conflict");

		const asPort = powerDoc({
			components: [
				componentYaml("DC_IN", "rail", voltageProps("9V", 9)),
				componentYaml("U_CP", "power-converter", converterProps),
				componentYaml("VNEG", "port"),
			],
			sourceComponentIds: ["DC_IN"],
			sourceKind: "external-dc",
			rails: [
				railYaml({ id: "DC_IN", role: "main-supply", derivation: "direct" }),
				railYaml({
					id: "VNEG",
					role: "negative-supply",
					derivation: "inverter",
					converterComponentId: "U_CP",
					nominalVoltage: ["-9V", -9],
				}),
			],
		});
		expect(codesOf(asPort)).not.toContain("power-rail-fixed-owner-conflict");
	});

	test("a divider/bias output is a conflict as a rail and valid as a reference port", () => {
		const asRail = powerDoc({
			components: [
				componentYaml("DC_IN", "rail", voltageProps("9V", 9)),
				componentYaml("VBIAS", "rail", voltageProps("4.5V", 4.5)),
			],
			sourceComponentIds: ["DC_IN"],
			sourceKind: "external-dc",
			rails: [
				railYaml({ id: "DC_IN", role: "main-supply", derivation: "direct" }),
				railYaml({
					id: "VBIAS",
					role: "bias-reference",
					derivation: "divider",
					parentRailComponentId: "DC_IN",
				}),
			],
		});
		expect(codesOf(asRail)).toContain("power-rail-fixed-owner-conflict");

		const asPort = powerDoc({
			components: [
				componentYaml("DC_IN", "rail", voltageProps("9V", 9)),
				componentYaml("VBIAS", "port"),
			],
			sourceComponentIds: ["DC_IN"],
			sourceKind: "external-dc",
			rails: [
				railYaml({ id: "DC_IN", role: "main-supply", derivation: "direct" }),
				railYaml({
					id: "VBIAS",
					role: "bias-reference",
					derivation: "divider",
					parentRailComponentId: "DC_IN",
					nominalVoltage: ["4.5V", 4.5],
				}),
			],
		});
		expect(codesOf(asPort)).not.toContain("power-rail-fixed-owner-conflict");
	});

	test("external-dc with a physical battery makes any fixed rail a duplicate owner", () => {
		const yaml = powerDoc({
			components: [
				componentYaml("BATT", "battery", voltageProps("9V", 9)),
				componentYaml("RAIL_9V", "rail", voltageProps("9V", 9)),
			],
			sourceComponentIds: ["BATT"],
			sourceKind: "external-dc",
			rails: [
				railYaml({ id: "RAIL_9V", role: "main-supply", derivation: "direct" }),
			],
		});
		expect(codesOf(yaml)).toContain("power-rail-fixed-owner-conflict");
	});

	test("an unresolvable source kind produces power-domain-source-kind-unresolved and skips rail checks", () => {
		const yaml = powerDoc({
			components: [componentYaml("BPLUS", "rail", voltageProps("9V", 9))],
			sourceComponentIds: [],
			rails: [
				railYaml({ id: "BPLUS", role: "main-supply", derivation: "direct" }),
			],
		});
		const codes = codesOf(yaml);
		expect(codes).toContain("power-domain-source-kind-unresolved");
		expect(codes).not.toContain("power-rail-fixed-owner-conflict");
	});

	test("a rail only in sourceComponentIds (no binding) is not accepted as the external owner", () => {
		const yaml = powerDoc({
			components: [componentYaml("RAIL_9V", "rail", voltageProps("9V", 9))],
			sourceComponentIds: ["RAIL_9V"],
			sourceKind: "external-dc",
		});
		expect(codesOf(yaml)).toContain("power-domain-source-owner-unresolved");
	});

	test("explicit external-dc with only broad non-source members is ownerless", () => {
		const yaml = powerDoc({
			components: [
				componentYaml(
					"R1",
					"resistor",
					'      R:\n        raw: "10k"\n        value: 10000\n        unit: "Ω"',
				),
			],
			sourceComponentIds: ["R1"],
			sourceKind: "external-dc",
		});
		expect(codesOf(yaml)).toContain("power-domain-source-owner-unresolved");
	});

	test("explicit mains-ac without a referenced transformer is ownerless", () => {
		const yaml = powerDoc({
			components: [componentYaml("BPLUS", "port")],
			sourceComponentIds: [],
			sourceKind: "mains-ac",
			rails: [
				railYaml({ id: "BPLUS", role: "main-supply", derivation: "direct" }),
			],
		});
		expect(codesOf(yaml)).toContain("power-domain-source-owner-unresolved");
	});

	test("explicit external-dc contradicted by a transformer is a source-kind conflict", () => {
		const yaml = powerDoc({
			components: [componentYaml("PT", "transformer")],
			sourceComponentIds: ["PT"],
			sourceKind: "external-dc",
		});
		expect(codesOf(yaml)).toContain("power-domain-source-kind-conflict");
	});

	test("the provisional powerSourceKind alias alone parses to canonical sourceKind", () => {
		const yaml = powerDoc({
			components: [componentYaml("PT", "transformer")],
			sourceComponentIds: ["PT"],
			powerSourceKind: "mains-ac",
		});
		const domain = parseInterchangeYaml(yaml).power?.domains[0];
		expect(domain?.sourceKind).toBe("mains-ac");
		expect(domain?.powerSourceKind).toBeUndefined();
	});

	test("canonical sourceKind and a disagreeing provisional alias are rejected at parse", () => {
		const yaml = powerDoc({
			components: [componentYaml("PT", "transformer")],
			sourceComponentIds: ["PT"],
			sourceKind: "external-dc",
			powerSourceKind: "mains-ac",
		});
		expect(() => parseInterchangeYaml(yaml)).toThrow(
			'sourceKind "external-dc" conflicts with powerSourceKind "mains-ac"',
		);
	});
});

import { describe, expect, test } from "bun:test";
import {
	EMPTY_DOCUMENT,
	parseCircuitDocument,
	parseInterchangeYaml,
	serializeInterchangeYaml,
	type CircuitDocument,
} from "../../../packages/core/src";

const source = `<?xml version="1.0" encoding="utf-8"?>
<Schematic Name="Test filter">
  <Element Type="Circuit.Symbol, Circuit" Position="0,0" Rotation="0" Flip="false">
    <Component _Type="Circuit.Resistor, Circuit" Name="R1" Resistance="10 kΩ" />
  </Element>
  <Element Type="Circuit.Symbol, Circuit" Position="0,80" Rotation="0" Flip="false">
    <Component _Type="Circuit.Ground, Circuit" Name="GND" />
  </Element>
  <Element Type="Circuit.Wire, Circuit" A="0,20" B="0,80" />
</Schematic>`;

const V3_MECHANICAL_BOARD_URL = new URL(
	"../../fixtures/interchange/vdsp-v3-mechanical-board-realization.vdsp",
	import.meta.url,
);

describe("serializeInterchangeYaml", () => {
	test("emits a versioned LLM-friendly YAML interchange view with explicit nodes", () => {
		const doc = parseCircuitDocument(source, { filename: "test-filter.schx" });
		const yaml = serializeInterchangeYaml(doc, {
			filename: "test-filter.schx",
			sourceFormat: "schx",
		});

		expect(yaml).toContain("schema: circuit-interchange/v2");
		expect(yaml).toContain("format: schx");
		expect(yaml).toContain("filename: test-filter.schx");
		expect(yaml).toContain("components:");
		expect(yaml).toContain("id: R1");
		expect(yaml).toContain("kind: resistor");
		expect(yaml).toContain("node: 0");
		expect(yaml).toContain('raw: "10 kΩ"');
		expect(yaml).toContain("value: 10000");
		expect(yaml).toContain('unit: "Ω"');
		expect(yaml).toContain("nodes:");
		expect(yaml).toContain("role: ground");
		expect(yaml).toContain("members:");
		expect(yaml).toContain("componentId: GND");
	});

	test("emits circuit-interchange/v3 when physical build metadata is present and preserves v3 blocks", async () => {
		const sourceYaml = await Bun.file(V3_MECHANICAL_BOARD_URL).text();
		const doc = parseInterchangeYaml(sourceYaml);
		const yaml = serializeInterchangeYaml(doc);
		const parsedAgain = parseInterchangeYaml(yaml);

		expect(yaml).toContain("schema: circuit-interchange/v3");
		expect(yaml).toContain("build:");
		expect(yaml).toContain("mechanical:");
		expect(yaml).toContain("bom:");
		expect(yaml).toContain("partProfiles:");
		expect(yaml).toContain("footprints:");
		expect(yaml).toContain("offBoardWiring:");
		expect(yaml).toContain("boards:");
		expect(yaml).toContain("kind: selector");
		expect(yaml).toContain("kind: footswitch");
		expect(yaml).toContain("physical:");
		expect(parsedAgain.build).toEqual(doc.build);
		expect(parsedAgain.mechanical).toEqual(doc.mechanical);
		expect(parsedAgain.bom).toEqual(doc.bom);
		expect(parsedAgain.partProfiles).toEqual(doc.partProfiles);
		expect(parsedAgain.footprints).toEqual(doc.footprints);
		expect(parsedAgain.offBoardWiring).toEqual(doc.offBoardWiring);
		expect(parsedAgain.boards).toEqual(doc.boards);
		expect(parsedAgain.panel).toEqual(doc.panel);
	});

	test("serializes external control interface metadata with binding details", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			metadata: {
				name: "DD-3 control interface",
				description: "External trigger/reset controls.",
				partNumber: "",
			},
			controlInterfaces: [
				{
					id: "trigger-input",
					name: "TRIGGER external",
					role: "trigger",
					controlRole: "sampler-trigger",
					interface: "external-control-input",
					connector: "1/4-inch-mono-ts",
					assignmentHint: "momentary-or-latching",
					polarity: "normally-open",
					binding: {
						sourceComponentId: "U1",
						controlId: "U1:sampler-trigger",
						controlName: "TRIGGER",
						property: "SamplerTriggerControl",
					},
					description: "External sampler record/play trigger input.",
				},
			],
		};

		const yaml = serializeInterchangeYaml(doc);

		expect(yaml).toContain("controlInterfaces:");
		expect(yaml).toContain("id: trigger-input");
		expect(yaml).toContain("role: trigger");
		expect(yaml).toContain("controlRole: sampler-trigger");
		expect(yaml).toContain("interface: external-control-input");
		expect(yaml).toContain('connector: "1/4-inch-mono-ts"');
		expect(yaml).toContain("assignmentHint: momentary-or-latching");
		expect(yaml).toContain("polarity: normally-open");
		expect(yaml).toContain("sourceComponentId: U1");
		expect(yaml).toContain('controlId: "U1:sampler-trigger"');
		expect(yaml).toContain("controlName: TRIGGER");
		expect(yaml).toContain("property: SamplerTriggerControl");
	});

	test("round-trips concentric mount/surface physical bindings through .vdsp v3", () => {
		const pot = (id: string): CircuitDocument["components"][number] => ({
			id,
			kind: "potentiometer",
			name: id,
			origin: { x: 0, y: 0 },
			rotation: 0,
			flipped: false,
			terminals: [],
			properties: { Resistance: "250k" },
			sourceTypeName: "Circuit.Potentiometer, Circuit",
		});
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [pot("BASS"), pot("TREBLE")],
			panel: {
				faces: [
					{
						id: "top",
						layout: {
							kind: "stompbox-grid",
							rows: 1,
							columns: 1,
							indexing: "one-based",
						},
						elements: [
							{
								bind: { componentId: "BASS", controlId: "BASS" },
								kind: "knob",
								grid: { row: 1, column: 1 },
								physical: {
									partProfileId: "pot-concentric-2",
									mountId: "m-tone",
									surface: "lower",
									centerMm: { x: 30, y: 28 },
								},
							},
							{
								bind: { componentId: "TREBLE", controlId: "TREBLE" },
								kind: "knob",
								grid: { row: 1, column: 1 },
								physical: {
									partProfileId: "pot-concentric-2",
									mountId: "m-tone",
									surface: "upper",
									centerMm: { x: 30, y: 28 },
								},
							},
						],
					},
				],
			},
		};

		const yaml = serializeInterchangeYaml(doc);
		expect(yaml).toContain("mountId: m-tone");
		expect(yaml).toContain("surface: lower");
		expect(yaml).toContain("surface: upper");

		const reparsed = parseInterchangeYaml(yaml);
		expect(reparsed.panel).toEqual(doc.panel);
	});

	test("serializes standalone control accessory device metadata and outputs", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			metadata: {
				name: "Boss FS-5U Foot Switch",
				description: "Momentary external footswitch accessory.",
				partNumber: "FS-5U",
			},
			device: {
				id: "boss-fs-5u",
				version: 1,
				kind: "control-accessory",
				family: "external-footswitch",
				model: "boss-fs-5u",
				audioProcessing: false,
			},
			controlOutputs: [
				{
					id: "output",
					name: "Output",
					role: "external-control",
					connector: "1/4-inch-mono-ts",
					switchMode: "momentary",
					polarity: "normally-open",
					inactiveValue: 0,
					activeValue: 1,
					componentId: "J1",
					description: "Mono TS contact-closure output.",
				},
			],
		};

		const yaml = serializeInterchangeYaml(doc);

		expect(yaml).toContain("device:");
		expect(yaml).toContain("id: boss-fs-5u");
		expect(yaml).toContain("version: 1");
		expect(yaml).toContain("kind: control-accessory");
		expect(yaml).toContain("audioProcessing: false");
		expect(yaml).toContain("controlOutputs:");
		expect(yaml).toContain("switchMode: momentary");
		expect(yaml).toContain("polarity: normally-open");
		expect(yaml).toContain("inactiveValue: 0");
		expect(yaml).toContain("activeValue: 1");
		expect(yaml).toContain("componentId: J1");
	});

	test("serializes panel placement with faces, elements, and explicit bindings", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			metadata: {
				name: "DD-3 panel",
				description: "Named panel faces.",
				partNumber: "",
			},
			panel: {
				faces: [
					{
						id: "right-side",
						label: "Right side",
						layout: {
							kind: "stompbox-grid",
							rows: 2,
							columns: 1,
							indexing: "one-based",
							rowOrder: "top-to-bottom",
						},
						elements: [
							{
								bind: {
									componentId: "U1",
									controlId: "U1:direct-out",
									controlName: "Direct Out",
									property: "DirectOutputJack",
								},
								kind: "jack",
								label: "Direct Out",
								grid: { row: 2, column: 1 },
							},
						],
					},
				],
			},
		};

		const yaml = serializeInterchangeYaml(doc);

		expect(yaml).toContain("panel:");
		expect(yaml).toContain("faces:");
		expect(yaml).toContain("id: right-side");
		expect(yaml).toContain("elements:");
		expect(yaml).toContain("bind:");
		expect(yaml).toContain("componentId: U1");
		expect(yaml).toContain('controlId: "U1:direct-out"');
		expect(yaml).toContain('controlName: "Direct Out"');
		expect(yaml).toContain("property: DirectOutputJack");
		expect(yaml).toContain("kind: jack");
		expect(yaml).not.toContain("controls:");
		expect(yaml).not.toContain("controlKind:");
	});

	test("serializes structured runtime descriptor properties as nested Source data", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			metadata: {
				name: "Explicit delay descriptor",
				description: "Profile-free reusable runtime descriptor.",
				partNumber: "",
			},
			components: [
				{
					id: "U1",
					kind: "ic",
					name: "U1",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "input", position: { x: 0, y: -20 } },
						{ name: "output", position: { x: 0, y: 20 } },
					],
					properties: {
						RuntimeDescriptor: "true",
						DescriptorType: "microblock-delay-chip",
						mechanism: {
							memoryType: "bbd",
							stageCount: 3207,
							artifactSeed: 17,
							clockNoiseRms: 0.001,
							supplySensitive: true,
							dryBlendPolicy: "dry-unity",
						},
						minDelayMs: 12.5,
						maxDelayMs: 800,
					},
					sourceTypeName: "Circuit.MicroBlockDelayChip",
				},
			],
		};

		const yaml = serializeInterchangeYaml(doc);

		expect(yaml).toContain("DescriptorType: microblock-delay-chip");
		expect(yaml).toContain("mechanism:");
		expect(yaml).toContain("memoryType: bbd");
		expect(yaml).toContain("stageCount: 3207");
		expect(yaml).toContain("supplySensitive: true");
		expect(yaml).toContain("dryBlendPolicy: dry-unity");
		expect(yaml).toContain("minDelayMs: 12.5");
		expect(yaml).not.toContain("Profile:");
	});
});

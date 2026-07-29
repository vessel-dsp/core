import { describe, expect, test } from "bun:test";
import {
	detectCircuitFormat,
	parseCircuitDocument,
	detectCircuitDocumentFileFormat,
	isVdspFilename,
	vdspFilenameFromName,
	parseCircuitDocumentFile,
	parseVdspCircuitDocument,
	serializeCircuitDocumentFile,
	serializeVdspCircuitDocument,
	convertCircuitDocumentFile,
	convertCircuitDocumentFileWithReport,
	validateVdspCircuitDocumentSchema,
	vdspFileExtension,
} from "../../packages/core/src/formats/document";
import { EMPTY_DOCUMENT } from "../../packages/core/src/model/types";

const SIMPLE_ASC_URL = new URL(
	"../fixtures/asc/simple-rc.asc",
	import.meta.url,
);
const V3_MECHANICAL_BOARD_URL = new URL(
	"../fixtures/interchange/vdsp-v3-mechanical-board-realization.vdsp",
	import.meta.url,
);

describe("circuit format dispatch", () => {
	test("detects supported file extensions", () => {
		expect(detectCircuitFormat("gain-stage.schx")).toBe("schx");
		expect(detectCircuitFormat("gain-stage.cir")).toBe("spice");
		expect(detectCircuitFormat("gain-stage.net")).toBe("spice");
		expect(detectCircuitFormat("gain-stage.spice")).toBe("spice");
		expect(detectCircuitFormat("gain-stage.ASC")).toBe("ltspice-asc");
		expect(detectCircuitFormat("README.md")).toBeNull();
	});

	test("parses an LTspice .asc file by extension", async () => {
		const source = await Bun.file(SIMPLE_ASC_URL).text();
		const doc = parseCircuitDocument(source, { filename: "simple-rc.asc" });

		expect(doc.rawAttributes.format).toBe("ltspice-asc");
		expect(
			doc.components.some(
				(component) => component.id === "R1" && component.kind === "resistor",
			),
		).toBe(true);
	});

	test("throws on unsupported file extensions", () => {
		expect(() => parseCircuitDocument("", { filename: "notes.txt" })).toThrow(
			/unsupported circuit format/i,
		);
	});
});

describe("vdsp file format", () => {
	test("detects .vdsp extension", () => {
		expect(vdspFileExtension).toBe(".vdsp");
	});

	test("isVdspFilename identifies .vdsp files", () => {
		expect(isVdspFilename("preset.vdsp")).toBe(true);
		expect(isVdspFilename("PRESET.VDSP")).toBe(true);
		expect(isVdspFilename("  preset.vdsp  ")).toBe(true);
		expect(isVdspFilename("preset.yaml")).toBe(false);
		expect(isVdspFilename("preset.schx")).toBe(false);
	});

	test("vdspFilenameFromName slugifies names", () => {
		expect(vdspFilenameFromName("Keeley Compressor Plus")).toBe(
			"keeley-compressor-plus.vdsp",
		);
		expect(vdspFilenameFromName("Boss DS-1")).toBe("boss-ds-1.vdsp");
		expect(vdspFilenameFromName("Custom  Pedal")).toBe("custom-pedal.vdsp");
		expect(vdspFilenameFromName("Café")).toBe("cafe.vdsp");
		expect(vdspFilenameFromName("---___")).toBe("untitled-preset.vdsp");
		expect(vdspFilenameFromName("")).toBe("untitled-preset.vdsp");
	});

	test("detectCircuitDocumentFileFormat detects all formats", () => {
		expect(detectCircuitDocumentFileFormat("preset.vdsp")).toBe("vdsp");
		expect(detectCircuitDocumentFileFormat("circuit.yaml")).toBe("yaml");
		expect(detectCircuitDocumentFileFormat("circuit.yml")).toBe("yaml");
		expect(detectCircuitDocumentFileFormat("circuit.schx")).toBe("schx");
		expect(detectCircuitDocumentFileFormat("circuit.asc")).toBe("ltspice-asc");
		expect(detectCircuitDocumentFileFormat("circuit.circuit.json")).toBe(
			"circuit-json",
		);
		expect(detectCircuitDocumentFileFormat("circuit.cir")).toBe("spice");
		expect(detectCircuitDocumentFileFormat("circuit.net")).toBe("spice");
		expect(detectCircuitDocumentFileFormat("typo.vsdp")).toBeNull();
		expect(detectCircuitDocumentFileFormat("typo.asr")).toBeNull();
		expect(detectCircuitDocumentFileFormat("README.md")).toBeNull();
	});

	test("parseCircuitDocumentFile parses .vdsp via interchange YAML", async () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Test Circuit
  description: ""
  partNumber: ""
source:
  format: interchange
  filename: test.vdsp
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;
		const doc = parseCircuitDocumentFile(yaml, { filename: "test.vdsp" });
		expect(doc.metadata.name).toBe("Test Circuit");
		expect(doc.components).toHaveLength(0);
	});

	test("parseCircuitDocumentFile parses v3 .vdsp physical build metadata", async () => {
		const yaml = await Bun.file(V3_MECHANICAL_BOARD_URL).text();
		const doc = parseCircuitDocumentFile(yaml, {
			filename: "mechanical-build.vdsp",
		});

		expect(doc.build?.selectedBoardId).toBe("main-vero");
		expect(doc.boards?.map((board) => board.id)).toEqual([
			"main-vero",
			"perfboard-alt",
			"breadboard-pattern-proto",
			"fabricated-pcb",
		]);
	});

	test("serializes and parses Circuit JSON document files", () => {
		const json = serializeCircuitDocumentFile(EMPTY_DOCUMENT, {
			format: "circuit-json",
			filename: "empty.circuit.json",
		});
		const parsed = parseCircuitDocumentFile(json, {
			filename: "empty.circuit.json",
		});

		expect(JSON.parse(json)).toEqual([]);
		expect(parsed.source?.format).toBe("circuit-json");
		expect(parsed.components).toEqual([]);
	});

	test("converts between file formats through CircuitDocument", () => {
		const yaml = serializeVdspCircuitDocument({
			...EMPTY_DOCUMENT,
			metadata: { name: "Convertible", description: "", partNumber: "" },
		});

		const circuitJson = convertCircuitDocumentFile(yaml, {
			inputFilename: "convertible.vdsp",
			outputFormat: "circuit-json",
			outputFilename: "convertible.circuit.json",
		});
		const backToVdsp = convertCircuitDocumentFile(circuitJson, {
			inputFilename: "convertible.circuit.json",
			outputFormat: "vdsp",
			outputFilename: "convertible-roundtrip.vdsp",
		});

		expect(JSON.parse(circuitJson)).toContainEqual({
			type: "source_project_metadata",
			name: "Convertible",
			software_used_string: "@vessel-dsp/core",
		});
		expect(
			parseCircuitDocumentFile(backToVdsp, {
				filename: "convertible-roundtrip.vdsp",
			}).metadata.name,
		).toBe("Convertible");
	});

	test("convertCircuitDocumentFile errors by default when v3-only data would be dropped", async () => {
		const yaml = await Bun.file(V3_MECHANICAL_BOARD_URL).text();

		expect(() =>
			convertCircuitDocumentFile(yaml, {
				inputFilename: "mechanical-build.vdsp",
				outputFormat: "circuit-json",
				outputFilename: "mechanical-build.circuit.json",
			}),
		).toThrow(/would drop v3-only fields/i);
	});

	test("convertCircuitDocumentFileWithReport can explicitly drop v3-only data with diagnostics", async () => {
		const yaml = await Bun.file(V3_MECHANICAL_BOARD_URL).text();

		const report = convertCircuitDocumentFileWithReport(yaml, {
			inputFilename: "mechanical-build.vdsp",
			outputFormat: "circuit-json",
			outputFilename: "mechanical-build.circuit.json",
			lossPolicy: "drop-with-diagnostics",
		});

		expect(Array.isArray(JSON.parse(report.output))).toBe(true);
		expect(report.droppedFields).toEqual([
			"mechanical",
			"build",
			"bom",
			"partProfiles",
			"footprints",
			"offBoardWiring",
			"panel.faces[].geometry",
			"panel.faces[].elements[].id",
			"panel.faces[].elements[].physical",
			"boards",
		]);
		expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			"v3-data-dropped",
		);
	});

	test("conversion reports v3-only simulation profile data loss", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Simulation Profiles
  description: ""
  partNumber: ""
source:
  format: interchange
simulationProfiles:
  schema: simulation-profile-catalog/v1
  units: SI
  profiles:
    - profileSchema: speaker-load-model/v1
      kind: speaker-load-model
      id: driver-linear-load
      targetProfileIds:
        - driver
      domain: electromechanical
      representation: thiele-small
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
`;

		const report = convertCircuitDocumentFileWithReport(yaml, {
			inputFilename: "simulation-profiles.vdsp",
			outputFormat: "circuit-json",
			outputFilename: "simulation-profiles.circuit.json",
			lossPolicy: "drop-with-diagnostics",
		});

		expect(report.droppedFields).toEqual(["simulationProfiles"]);
		expect(report.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "v3-data-dropped",
				field: "simulationProfiles",
			}),
		);
	});

	test("parseVdspCircuitDocument parses .vdsp source directly", () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Direct VDSP
  description: ""
  partNumber: ""
source:
  format: interchange
  filename: direct.vdsp
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

		const doc = parseVdspCircuitDocument(yaml);

		expect(doc.metadata.name).toBe("Direct VDSP");
		expect(doc.source?.filename).toBe("direct.vdsp");
	});

	test("validateVdspCircuitDocumentSchema returns a parsed document for valid .vdsp", () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Valid Schema
  description: ""
  partNumber: ""
source: {}
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(true);
		if (!result.valid) {
			throw new Error(result.errors[0]?.message ?? "expected valid .vdsp");
		}
		expect(result.document.metadata.name).toBe("Valid Schema");
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	test("validateVdspCircuitDocumentSchema warns about source/runtime boundary metadata", () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Boundary Metadata
  description: ""
  partNumber: ""
source: {}
components:
  - id: U1
    kind: ic
    name: U1
    sourceTypeName: Circuit.MicroBlockDelayChip
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals: []
    properties:
      SourceOnly: "true"
      InterfaceOnly: "true"
      SourceBoundaryNote: runtime boundary marker
      FirmwareStatus: firmware-dump-unavailable
      FirmwareExternalStop: external firmware unavailable
      BehaviorRole:
        kind: firmware-dsp-core
        firmwareRef:
          status: unknown-proprietary
          behaviorOwner: firmware-proxy
      RuntimeDescriptor: "true"
      DescriptorType: microblock-delay-chip
      mechanism:
        memoryType: bbd
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes:
  RuntimeContainerClaimBoundary: stored runtime receipt`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(true);
		if (!result.valid) {
			throw new Error(result.errors[0]?.message ?? "expected valid .vdsp");
		}
		expect(result.errors).toEqual([]);
		expect(
			result.warnings.map((warning) => ({
				componentId: warning.componentId,
				property: warning.property,
				severity: warning.severity,
			})),
		).toEqual([
			{
				componentId: undefined,
				property: "RuntimeContainerClaimBoundary",
				severity: "warning",
			},
			{ componentId: "U1", property: "SourceOnly", severity: "warning" },
			{ componentId: "U1", property: "InterfaceOnly", severity: "warning" },
			{
				componentId: "U1",
				property: "SourceBoundaryNote",
				severity: "warning",
			},
			{ componentId: "U1", property: "FirmwareStatus", severity: "warning" },
			{
				componentId: "U1",
				property: "FirmwareExternalStop",
				severity: "warning",
			},
			{ componentId: "U1", property: "BehaviorRole", severity: "warning" },
			{ componentId: "U1", property: "RuntimeDescriptor", severity: "warning" },
			{ componentId: "U1", property: "DescriptorType", severity: "warning" },
			{ componentId: "U1", property: "mechanism", severity: "warning" },
		]);

		const parseOnlyResult = validateVdspCircuitDocumentSchema(yaml, {
			sourceRuntimeBoundaryWarnings: false,
		});
		expect(parseOnlyResult.valid).toBe(true);
		if (!parseOnlyResult.valid) {
			throw new Error(
				parseOnlyResult.errors[0]?.message ?? "expected valid .vdsp",
			);
		}
		expect(parseOnlyResult.warnings).toEqual([]);
	});

	test("validateVdspCircuitDocumentSchema rejects v1 without migration", () => {
		const yaml = `schema: circuit-interchange/v1
metadata:
  name: Old Schema
  description: ""
  partNumber: ""
source: {}
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(false);
		if (result.valid) {
			throw new Error("expected v1 .vdsp to be rejected");
		}
		expect(result.errors).toEqual([
			{
				code: "vdsp-schema-invalid",
				message: "unsupported interchange schema: circuit-interchange/v1",
			},
		]);
	});

	test("validateVdspCircuitDocumentSchema reports schema errors without throwing", () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Bad Panel
  description: ""
  partNumber: ""
source: {}
panel:
  layout:
    kind: stompbox-grid
    rows: 1
    columns: 1
    indexing: one-based
  controls:
    - componentId: LEVEL
      controlKind: knob
      grid:
        row: 0
        column: 1
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(false);
		if (result.valid) {
			throw new Error("expected invalid .vdsp");
		}
		expect(result.errors).toEqual([
			{
				code: "vdsp-schema-invalid",
				message:
					"panel.controls[0].grid.row: expected one-based row coordinate within 1..1",
				path: "panel.controls[0].grid.row",
			},
		]);
	});

	test("validateVdspCircuitDocumentSchema reports control accessory schema errors without throwing", () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Bad Accessory
  description: ""
  partNumber: ""
source: {}
device:
  id: bad-accessory
  version: 1
  kind: control-accessory
controlOutputs:
  - id: output
    name: Output
    role: external-control
    connector: "1/4-inch-mono-ts"
    switchMode: push-push
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(false);
		if (result.valid) {
			throw new Error("expected invalid .vdsp");
		}
		expect(result.errors).toEqual([
			{
				code: "vdsp-schema-invalid",
				message: "controlOutputs[0].switchMode: expected momentary or latching",
				path: "controlOutputs[0].switchMode",
			},
		]);
	});

	test("validateVdspCircuitDocumentSchema reports a duplicate top-level power block as duplicate-key", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Duplicate Power Key
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
power:
  schema: circuit-power/v1
  coverage: not-applicable
  domains: []
`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(false);
		if (result.valid) {
			throw new Error("expected invalid .vdsp");
		}
		expect(result.errors).toEqual([
			{
				code: "duplicate-key",
				message: 'duplicate mapping key "power"',
				path: "power",
			},
		]);
	});

	test("validateVdspCircuitDocumentSchema reports a duplicate top-level rawAttributes block as duplicate-key", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Duplicate RawAttributes Key
  description: ""
  partNumber: ""
source: {}
components: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}
rawAttributes: {}
`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(false);
		if (result.valid) {
			throw new Error("expected invalid .vdsp");
		}
		expect(result.errors).toEqual([
			{
				code: "duplicate-key",
				message: 'duplicate mapping key "rawAttributes"',
				path: "rawAttributes",
			},
		]);
	});

	test("validateVdspCircuitDocumentSchema reports a duplicate nested key inside power.domains as duplicate-key", () => {
		const yaml = `schema: circuit-interchange/v3
metadata:
  name: Duplicate Nested Key
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
      sourceComponentIds: []
      groundPolarity: negative-ground
      groundPolarity: positive-ground
      rails: []
`;

		const result = validateVdspCircuitDocumentSchema(yaml);

		expect(result.valid).toBe(false);
		if (result.valid) {
			throw new Error("expected invalid .vdsp");
		}
		expect(result.errors).toEqual([
			{
				code: "duplicate-key",
				message: 'duplicate mapping key "groundPolarity"',
				path: "groundPolarity",
			},
		]);
	});

	test("parseCircuitDocumentFile parses .yaml via interchange YAML", async () => {
		const yaml = `schema: circuit-interchange/v2
metadata:
  name: Test Circuit
  description: ""
  partNumber: ""
source: {}
components: []
nodes: []
wires: []
directives: []
diagnostics: []
rawAttributes: {}`;
		const doc = parseCircuitDocumentFile(yaml, { filename: "test.yaml" });
		expect(doc.metadata.name).toBe("Test Circuit");
	});

	test("parseCircuitDocumentFile delegates to parseCircuitDocument for legacy formats", async () => {
		const source = await Bun.file(SIMPLE_ASC_URL).text();
		const doc = parseCircuitDocumentFile(source, { filename: "simple-rc.asc" });

		expect(doc.rawAttributes.format).toBe("ltspice-asc");
		expect(
			doc.components.some(
				(component) => component.id === "R1" && component.kind === "resistor",
			),
		).toBe(true);
	});

	test("serializeVdspCircuitDocument sets source.format to interchange", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			metadata: { ...EMPTY_DOCUMENT.metadata, name: "Test Preset" },
		};
		const yaml = serializeVdspCircuitDocument(doc, { filename: "test.vdsp" });
		expect(yaml).toContain("source:");
		expect(yaml).toContain("format: interchange");
		expect(yaml).toContain("filename: test.vdsp");
	});

	test("serializeVdspCircuitDocument normalizes filename to .vdsp", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			metadata: { ...EMPTY_DOCUMENT.metadata, name: "My Preset" },
		};
		const yaml1 = serializeVdspCircuitDocument(doc, {
			filename: "my-preset.yaml",
		});
		expect(yaml1).toContain("filename: my-preset.vdsp");

		const yaml2 = serializeVdspCircuitDocument(doc, { filename: "my-preset" });
		expect(yaml2).toContain("filename: my-preset.vdsp");
	});

	test("serializeVdspCircuitDocument uses name for missing filename", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			metadata: { ...EMPTY_DOCUMENT.metadata, name: "Boss DS-1" },
		};
		const yaml = serializeVdspCircuitDocument(doc);
		expect(yaml).toContain("filename: boss-ds-1.vdsp");
	});

	test("serializeVdspCircuitDocument preserves parsed source provenance when present", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			metadata: { ...EMPTY_DOCUMENT.metadata, name: "Boss DM-3" },
			source: {
				format: "schx",
				filename: "schematics/livespice/boss-dm-3.schx",
				version: "sha256:0123456789abcdef",
				url: "https://example.test/BOSS-DM3_Schematic.pdf",
			},
		};

		const yaml = serializeVdspCircuitDocument(doc);

		expect(yaml).toContain("format: schx");
		expect(yaml).toContain("filename: schematics/livespice/boss-dm-3.schx");
		expect(yaml).toContain('version: "sha256:0123456789abcdef"');
		expect(yaml).toContain(
			'url: "https://example.test/BOSS-DM3_Schematic.pdf"',
		);
	});

	test("serializeVdspCircuitDocument accepts explicit source provenance", () => {
		const doc = {
			...EMPTY_DOCUMENT,
			metadata: { ...EMPTY_DOCUMENT.metadata, name: "Boss DM-3" },
		};

		const yaml = serializeVdspCircuitDocument(doc, {
			source: {
				format: "pdf",
				filename: "BOSS-DM3_Schematic.pdf",
				url: "https://example.test/BOSS-DM3_Schematic.pdf",
			},
		});

		expect(yaml).toContain("format: pdf");
		expect(yaml).toContain("filename: BOSS-DM3_Schematic.pdf");
		expect(yaml).toContain(
			'url: "https://example.test/BOSS-DM3_Schematic.pdf"',
		);
	});
});

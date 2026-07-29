import { describe, expect, test } from "bun:test";
import { parseInterchangeYaml } from "../../packages/core/src/formats/interchange/parser";
import {
	type CircuitDocument,
	type Component,
	type ComponentKind,
	EMPTY_DOCUMENT,
	type PanelElementPhysicalPlacement,
	type Point,
	type PropertyValue,
	type Wire,
} from "../../packages/core/src/model/types";
import {
	CONTROL_ROLE_VALUES,
	createSourceRuntimeBoundaryRule,
	getRulesForKind,
	hasErrors,
	validateComponent,
	validateDocument,
	validateSourceRuntimeBoundary,
} from "../../packages/core/src/model/validation";

const V3_MECHANICAL_BOARD_URL = new URL(
	"../fixtures/interchange/vdsp-v3-mechanical-board-realization.vdsp",
	import.meta.url,
);

function makeComponent(
	id: string,
	kind: ComponentKind,
	properties: Record<string, PropertyValue> = {},
	sourceTypeName: string | null = null,
): Component {
	return {
		id,
		kind,
		name: id,
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: [
			{ name: "a", position: { x: 0, y: 0 } },
			{ name: "b", position: { x: 0, y: 10 } },
		],
		properties,
		sourceTypeName,
	};
}

function makeWire(id: string, a: Point, b: Point): Wire {
	return { id, endpoints: [a, b] };
}

function withParts(
	components: readonly Component[],
	wires: readonly Wire[] = [],
): CircuitDocument {
	return { ...EMPTY_DOCUMENT, components, wires };
}

function concentricMountDoc(
	members: ReadonlyArray<{
		id: string;
		physical: PanelElementPhysicalPlacement;
	}>,
): CircuitDocument {
	return {
		...EMPTY_DOCUMENT,
		components: members.map((member) =>
			makeComponent(
				member.id,
				"potentiometer",
				{ R: "250k" },
				"Circuit.Potentiometer, Circuit",
			),
		),
		panel: {
			faces: [
				{
					id: "top",
					layout: {
						kind: "stompbox-grid",
						rows: 1,
						columns: members.length,
						indexing: "one-based",
					},
					elements: members.map((member, index) => ({
						bind: { componentId: member.id, controlId: member.id },
						kind: "knob" as const,
						grid: { row: 1, column: index + 1 },
						physical: member.physical,
					})),
				},
			],
		},
	};
}

describe("validateDocument", () => {
	test("empty document has no issues", () => {
		expect(validateDocument(EMPTY_DOCUMENT)).toEqual([]);
	});

	test("accepts complete v3 selected build output with single-terminal edge nets", async () => {
		const source = await Bun.file(V3_MECHANICAL_BOARD_URL).text();
		const doc = parseInterchangeYaml(source);

		const issues = validateDocument(doc);

		expect(issues).toEqual([]);
	});

	test("reports complete v3 selected build output with an unrouted multi-member board net", async () => {
		const source = await Bun.file(V3_MECHANICAL_BOARD_URL).text();
		const doc = parseInterchangeYaml(source);
		const boards = doc.boards?.map((board) => {
			if (board.id !== "main-vero") {
				return board;
			}
			return {
				...board,
				routes: board.routes.filter(
					(route) => route.id !== "route-ground-strip",
				),
			};
		});
		if (boards === undefined) {
			throw new Error("expected v3 fixture boards");
		}

		const issues = validateDocument({ ...doc, boards });

		expect(issues).toContainEqual(
			expect.objectContaining({
				code: "board-net-unrouted",
				severity: "error",
				componentId: "main-vero",
				property: "GND",
			}),
		);
	});

	test("reports fabricated PCB zones nested under a net route", async () => {
		const source = await Bun.file(V3_MECHANICAL_BOARD_URL).text();
		const doc = parseInterchangeYaml(source);
		const boards = doc.boards?.map((board) => {
			if (board.id !== "fabricated-pcb") {
				return board;
			}
			const firstRoute = board.routes[0];
			if (firstRoute === undefined) {
				throw new Error("expected fabricated PCB route");
			}
			if (board.zones === undefined) {
				throw new Error("expected fabricated PCB zones");
			}
			return {
				...board,
				routes: [
					{
						...firstRoute,
						zones: board.zones,
					},
				],
			};
		});
		if (boards === undefined) {
			throw new Error("expected v3 fixture boards");
		}

		const issues = validateDocument({ ...doc, boards });

		expect(issues).toContainEqual(
			expect.objectContaining({
				code: "board-route-feature-invalid",
				severity: "error",
				componentId: "fabricated-pcb",
				property: "route-n001-pcb",
			}),
		);
	});

	test("valid resistor with R=10k passes", () => {
		const doc = withParts([makeComponent("R1", "resistor", { R: "10k" })]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("valid resistor accepts ParsedQuantity directly", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", {
				R: { raw: "10kΩ", value: 10000, unit: "Ω" },
			}),
		]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("resistor missing R emits value-required error", () => {
		const doc = withParts([makeComponent("R1", "resistor", {})]);
		const issues = validateDocument(doc);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.code).toBe("value-required");
		expect(issues[0]?.severity).toBe("error");
		expect(issues[0]?.componentId).toBe("R1");
		expect(issues[0]?.property).toBe("R");
	});

	test("resistor with R=0 emits value-out-of-range", () => {
		const doc = withParts([makeComponent("R1", "resistor", { R: "0" })]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "value-out-of-range")).toBe(true);
	});

	test("resistor with negative R emits value-out-of-range", () => {
		const doc = withParts([makeComponent("R1", "resistor", { R: "-100" })]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "value-out-of-range")).toBe(true);
	});

	test("resistor with R=2.2G emits value-out-of-range (above max)", () => {
		const doc = withParts([makeComponent("R1", "resistor", { R: "2.2G" })]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "value-out-of-range")).toBe(true);
	});

	test("aliases are accepted (Resistance instead of R)", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", { Resistance: "10k" }),
		]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("resistor accepts freeform material metadata when resistance is valid", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", {
				Resistance: "10k",
				Material: "carbon-film",
			}),
		]);

		expect(validateDocument(doc)).toEqual([]);
	});

	test("capacitor with mismatched unit emits unit-mismatch warning, not error", () => {
		const doc = withParts([makeComponent("C1", "capacitor", { C: "1V" })]);
		const issues = validateDocument(doc);
		const mismatch = issues.find((i) => i.code === "unit-mismatch");
		expect(mismatch).toBeDefined();
		expect(mismatch?.severity).toBe("warning");
	});

	test("unitless quantity does not trigger unit-mismatch (lenient)", () => {
		const doc = withParts([makeComponent("R1", "resistor", { R: "10k" })]);
		const issues = validateDocument(doc);
		expect(issues.find((i) => i.code === "unit-mismatch")).toBeUndefined();
	});

	test("diode without model emits model-required error", () => {
		const doc = withParts([makeComponent("D1", "diode")]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(true);
	});

	test('diode with model="1N4148" passes', () => {
		const doc = withParts([makeComponent("D1", "diode", { model: "1N4148" })]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("LED without model emits model-required error", () => {
		const doc = withParts([makeComponent("LED1", "led")]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(true);
	});

	test('LED with model="LED_RED" passes', () => {
		const doc = withParts([makeComponent("LED1", "led", { model: "LED_RED" })]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("bjt with Model alias passes", () => {
		const doc = withParts([makeComponent("Q1", "bjt", { Model: "2N3904" })]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("opamp without model emits model-required", () => {
		const doc = withParts([makeComponent("U1", "opamp")]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(true);
	});

	test("Circuit.IdealOpAmp is treated as ideal — no model required", () => {
		// LiveSPICE's IdealOpAmp has no model and no parameters; it's a math abstraction.
		const doc = withParts([
			makeComponent(
				"U1",
				"opamp",
				{},
				"Circuit.IdealOpAmp, Circuit, Version=1.0.0.0",
			),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(false);
	});

	test("runtime descriptor ICs do not require a model name", () => {
		const doc = withParts([
			makeComponent(
				"U1",
				"ic",
				{ RuntimeDescriptor: "true" },
				"Circuit.MicroBlockDelayChip",
			),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(false);
	});

	test("runtime descriptor empty control names emit warnings", () => {
		const doc = withParts([
			makeComponent(
				"U1",
				"ic",
				{ RuntimeDescriptor: "true", TimeControl: "   " },
				"Circuit.MicroBlockDelayChip",
			),
		]);

		const issues = validateDocument(doc);
		const issue = issues.find((i) => i.code === "descriptor-control-empty");

		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("warning");
		expect(issue?.componentId).toBe("U1");
		expect(issue?.property).toBe("TimeControl");
	});

	test("runtime descriptor mode label count mismatch emits warning", () => {
		const doc = withParts([
			makeComponent(
				"U1",
				"ic",
				{
					RuntimeDescriptor: "true",
					ModeControl: "MODE",
					ModeStepCount: "3",
					ModeLabels: "A,B",
				},
				"Circuit.MicroBlockDelayChip",
			),
		]);

		const issues = validateDocument(doc);
		const issue = issues.find(
			(i) => i.code === "descriptor-mode-label-mismatch",
		);

		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("warning");
		expect(issue?.componentId).toBe("U1");
		expect(issue?.property).toBe("ModeLabels");
	});

	test("firmware-required ICs warn when source firmware identity metadata is incomplete", () => {
		const doc = withParts([
			makeComponent(
				"U1",
				"ic",
				{
					Chip: "M37470M2-326SP",
					ChipClass: "microcomputer",
					FirmwareRequired: true,
				},
				"Circuit.Microcontroller",
			),
		]);

		const issues = validateDocument(doc);

		expect(issues).toContainEqual({
			code: "firmware-id-missing",
			severity: "warning",
			message:
				"U1: FirmwareRequired is true but FirmwareId is missing or empty",
			componentId: "U1",
			property: "FirmwareId",
		});
		expect(
			issues.filter((issue) => issue.code.startsWith("runtime-match-key")),
		).toEqual([]);
	});

	test("source/runtime boundary validation reports runtime selector properties", () => {
		const doc = {
			...withParts([
				makeComponent(
					"U1",
					"ic",
					{
						Chip: "M37470M2-326SP",
						FirmwareId: "boss-hr-2-m37470m2-326sp-control-firmware-v1",
						FirmwareRequired: true,
						SourceOnly: "true",
						InterfaceOnly: "true",
						SourceBoundaryNote: "runtime boundary marker",
						FirmwareStatus: "firmware-dump-unavailable",
						FirmwareExternalStop: "external firmware unavailable",
						RuntimeMatchKey: "chip=M37470M2-326SP",
						RuntimeOwnership: "source-reference",
						BehaviorRole: {
							kind: "firmware-dsp-core",
							firmwareRef: {
								status: "unknown-proprietary",
								behaviorOwner: "firmware-proxy",
							},
						},
					},
					"Circuit.Microcontroller",
				),
				makeComponent(
					"U2",
					"ic",
					{
						RuntimeDescriptor: "true",
						DescriptorType: "microblock-delay-chip",
						descriptor: { saturationMode: "runtime-soft-clip" },
						mechanism: { memoryType: "bbd" },
						AmpLaneRouteId: "champ-bright",
						ConsumerAdmissionBoundary: "runtime owner",
						CircuitGraphCompilerParityReportRefV1: "phase2",
						PrimitivePinMap: "runtime pin shell",
						DirectOutputRuntimeBoundary: "dry runtime branch",
					},
					"Circuit.MicroBlockDelayChip",
				),
			]),
			rawAttributes: {
				RuntimeContainerClaimBoundary: "stored runtime receipt",
				CircuitGraphCompilerLiveCertificateV1: "{}",
				exact_source_admission_status: "ready",
			},
		};

		const issues = validateSourceRuntimeBoundary(doc);

		expect(
			issues.map((issue) => ({
				componentId: issue.componentId,
				property: issue.property,
				severity: issue.severity,
			})),
		).toEqual([
			{
				componentId: undefined,
				property: "RuntimeContainerClaimBoundary",
				severity: "warning",
			},
			{
				componentId: undefined,
				property: "CircuitGraphCompilerLiveCertificateV1",
				severity: "warning",
			},
			{
				componentId: undefined,
				property: "exact_source_admission_status",
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
			{ componentId: "U1", property: "RuntimeMatchKey", severity: "warning" },
			{ componentId: "U1", property: "RuntimeOwnership", severity: "warning" },
			{ componentId: "U1", property: "BehaviorRole", severity: "warning" },
			{ componentId: "U2", property: "RuntimeDescriptor", severity: "warning" },
			{ componentId: "U2", property: "DescriptorType", severity: "warning" },
			{ componentId: "U2", property: "descriptor", severity: "warning" },
			{ componentId: "U2", property: "mechanism", severity: "warning" },
			{ componentId: "U2", property: "AmpLaneRouteId", severity: "warning" },
			{
				componentId: "U2",
				property: "ConsumerAdmissionBoundary",
				severity: "warning",
			},
			{
				componentId: "U2",
				property: "CircuitGraphCompilerParityReportRefV1",
				severity: "warning",
			},
			{ componentId: "U2", property: "PrimitivePinMap", severity: "warning" },
			{
				componentId: "U2",
				property: "DirectOutputRuntimeBoundary",
				severity: "warning",
			},
		]);
	});

	test("source/runtime boundary validation can run as a custom document rule", () => {
		const doc = withParts([
			makeComponent("U1", "ic", {
				PartNumber: "PT2399",
				RuntimeDescriptor: "true",
			}),
		]);

		const issue = validateDocument(doc, {
			rules: [createSourceRuntimeBoundaryRule({ severity: "warning" })],
		}).find(
			(candidate) => candidate.code === "source-runtime-boundary-property",
		);

		expect(issue).toMatchObject({
			severity: "warning",
			componentId: "U1",
			property: "RuntimeDescriptor",
		});
	});

	test("firmware identity metadata warns when chip identity is missing", () => {
		const doc = withParts([
			makeComponent(
				"U1",
				"ic",
				{
					FirmwareId: "boss-hr-2-m37470m2-326sp-control-firmware-v1",
					FirmwareRequired: true,
				},
				"Circuit.Microcontroller",
			),
		]);

		const issue = validateDocument(doc).find(
			(candidate) => candidate.code === "firmware-chip-missing",
		);

		expect(issue).toEqual({
			code: "firmware-chip-missing",
			severity: "warning",
			message: "U1: FirmwareId is present but Chip is missing or empty",
			componentId: "U1",
			property: "Chip",
		});
	});

	test("complete firmware-bound microcomputer metadata does not emit firmware warnings", () => {
		const doc = withParts([
			makeComponent(
				"U1",
				"ic",
				{
					Chip: "M37470M2-326SP",
					ChipClass: "microcomputer",
					FirmwareId: "boss-hr-2-m37470m2-326sp-control-firmware-v1",
					FirmwareRequired: true,
				},
				"Circuit.Microcontroller",
			),
		]);

		const issues = validateDocument(doc);

		expect(
			issues.filter((issue) => issue.code.startsWith("firmware-")),
		).toEqual([]);
		expect(
			issues.filter((issue) => issue.code.startsWith("runtime-match-key")),
		).toEqual([]);
	});

	test("opamp with inline small-signal parameters does not require a model name", () => {
		// LiveSPICE's Circuit.OpAmp carries the model inline as Rin/Rout/Aol/GBP.
		const doc = withParts([
			makeComponent("U1", "opamp", {
				Rin: "40 MΩ",
				Rout: "50 Ω",
				Aol: "300 k",
				GBP: "1 MHz",
			}),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(false);
	});

	test("pentode with inline Koren parameters does not require a model name", () => {
		// Fender 5e3's pentodes carry Mu/Kp/Kvb/Ex inline with no PartNumber.
		const doc = withParts([
			makeComponent("V1", "pentode", {
				Mu: "10.7",
				Kp: "41.16",
				Kvb: "12.7",
				Ex: "1.5",
			}),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(false);
	});

	test("triode with neither model nor inline parameters still emits model-required", () => {
		const doc = withParts([makeComponent("V1", "triode")]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "model-required")).toBe(true);
	});

	test("duplicate component IDs emit duplicate-id error", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", { R: "10k" }),
			makeComponent("R1", "resistor", { R: "20k" }),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "duplicate-id")).toBe(true);
	});

	test("unsupported kind emits unsupported-component warning", () => {
		const doc = withParts([
			makeComponent("U?", "unsupported", {}, "Circuit.Components.MysteryChip"),
		]);
		const issues = validateDocument(doc);
		const issue = issues.find((i) => i.code === "unsupported-component");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("warning");
		expect(issue?.message).toContain("MysteryChip");
	});

	test("degenerate wire emits warning", () => {
		const doc = withParts([], [makeWire("w1", { x: 5, y: 5 }, { x: 5, y: 5 })]);
		const issues = validateDocument(doc);
		const issue = issues.find((i) => i.code === "degenerate-wire");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("warning");
		expect(issue?.wireId).toBe("w1");
	});

	test("view-only kinds (label, named-wire, port) have no rules and emit no issues", () => {
		const doc = withParts([
			makeComponent("L1", "label"),
			makeComponent("NW1", "named-wire"),
			makeComponent("P1", "port"),
			makeComponent("G1", "ground"),
			makeComponent("J1", "jack"),
		]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("jack semantic metadata with unknown role or interface emits warnings", () => {
		const doc = withParts([
			makeComponent(
				"J1",
				"jack",
				{ Role: "sidechain", Interface: "banana" },
				"Circuit.Input",
			),
		]);

		const issues = validateDocument(doc);

		expect(issues.find((i) => i.code === "invalid-jack-role")).toEqual({
			code: "invalid-jack-role",
			severity: "warning",
			message: 'J1: jack Role "sidechain" is not a recognized panel role',
			componentId: "J1",
			property: "Role",
		});
		expect(issues.find((i) => i.code === "invalid-jack-interface")).toEqual({
			code: "invalid-jack-interface",
			severity: "warning",
			message:
				'J1: jack Interface "banana" is not a recognized panel interface',
			componentId: "J1",
			property: "Interface",
		});
	});

	test("jack audio role metadata accepts explicit subtype slugs", () => {
		const doc = withParts([
			makeComponent(
				"J_GUITAR",
				"jack",
				{
					Role: "input",
					Interface: "audio",
					AudioRole: "guitar-input",
				},
				"Circuit.Input",
			),
			makeComponent(
				"J_BASS",
				"jack",
				{
					Role: "input",
					Interface: "audio",
					AudioRole: "bass-input",
				},
				"Circuit.Input",
			),
			makeComponent(
				"J_OUT_A",
				"jack",
				{
					Role: "output",
					Interface: "audio",
					AudioRole: "output-a-mono",
				},
				"Circuit.Speaker",
			),
			makeComponent(
				"J_OUT_B",
				"jack",
				{
					Role: "output",
					Interface: "audio",
					AudioRole: "stereo-output-b",
				},
				"Circuit.Speaker",
			),
			makeComponent(
				"J_SIDECHAIN",
				"jack",
				{
					Role: "input",
					Interface: "audio",
					AudioRole: "host-defined-sidechain",
				},
				"Circuit.Input",
			),
		]);

		expect(validateDocument(doc)).toEqual([]);
	});

	test("jack audio role metadata warns for display text instead of source subtype slugs", () => {
		const doc = withParts([
			makeComponent(
				"J_OUT_A",
				"jack",
				{
					Role: "output",
					Interface: "audio",
					AudioRole: "Output A (Mono)",
				},
				"Circuit.Speaker",
			),
		]);

		expect(
			validateDocument(doc).find((i) => i.code === "invalid-jack-audio-role"),
		).toEqual({
			code: "invalid-jack-audio-role",
			severity: "warning",
			message:
				'J_OUT_A: jack AudioRole "Output A (Mono)" must be a lower-kebab source subtype slug',
			componentId: "J_OUT_A",
			property: "AudioRole",
		});
	});

	test("direct-output jack role metadata is recognized", () => {
		const doc = withParts([
			makeComponent(
				"J_DIRECT",
				"jack",
				{ Role: "direct-out", Interface: "dry-output" },
				"Circuit.Speaker",
			),
		]);

		expect(validateDocument(doc)).toEqual([]);
	});

	test("panel placement with missing component binding emits warning", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
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
								bind: { componentId: "MISSING" },
								kind: "knob",
								grid: { row: 1, column: 1 },
							},
						],
					},
				],
			},
		};

		const issues = validateDocument(doc);
		const issue = issues.find((i) => i.code === "panel-binding-unresolved");

		expect(issue).toEqual({
			code: "panel-binding-unresolved",
			severity: "warning",
			message:
				'Panel element on face "top" references missing component "MISSING"',
			componentId: "MISSING",
		});
	});

	test("panel placement with missing runtime control id emits warning", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent(
					"U1",
					"ic",
					{
						RuntimeDescriptor: "true",
						TimeControl: "D.TIME",
					},
					"Circuit.MicroBlockDelayChip",
				),
			],
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
								bind: { componentId: "U1", controlId: "U1:missing" },
								kind: "knob",
								grid: { row: 1, column: 1 },
							},
						],
					},
				],
			},
		};

		const issues = validateDocument(doc);
		const issue = issues.find((i) => i.code === "panel-control-unresolved");

		expect(issue).toEqual({
			code: "panel-control-unresolved",
			severity: "warning",
			message:
				'Panel element on face "top" references missing control "U1:missing" on component "U1"',
			componentId: "U1",
			property: "U1:missing",
		});
	});

	test("panel placement kind mismatch emits warning", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("J1", "jack", { Role: "input" }, "Circuit.Input"),
			],
			panel: {
				faces: [
					{
						id: "right-side",
						layout: {
							kind: "stompbox-grid",
							rows: 1,
							columns: 1,
							indexing: "one-based",
						},
						elements: [
							{
								bind: { componentId: "J1" },
								kind: "knob",
								grid: { row: 1, column: 1 },
							},
						],
					},
				],
			},
		};

		const issues = validateDocument(doc);
		const issue = issues.find((i) => i.code === "panel-kind-mismatch");

		expect(issue).toEqual({
			code: "panel-kind-mismatch",
			severity: "warning",
			message:
				'Panel element on face "right-side" binds component "J1" as knob but resolved kind is jack',
			componentId: "J1",
		});
	});

	test("panel placement overlapping cells emit warning", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("J1", "jack", { Role: "input" }, "Circuit.Input"),
				makeComponent("J2", "jack", { Role: "output" }, "Circuit.Speaker"),
			],
			panel: {
				faces: [
					{
						id: "top",
						layout: {
							kind: "stompbox-grid",
							rows: 2,
							columns: 2,
							indexing: "one-based",
						},
						elements: [
							{
								bind: { componentId: "J1" },
								kind: "jack",
								grid: { row: 1, column: 1, columnSpan: 2 },
							},
							{
								bind: { componentId: "J2" },
								kind: "jack",
								grid: { row: 1, column: 2 },
							},
						],
					},
				],
			},
		};

		const issues = validateDocument(doc);
		const issue = issues.find((i) => i.code === "panel-cell-collision");

		expect(issue).toEqual({
			code: "panel-cell-collision",
			severity: "warning",
			message: 'Panel face "top" has overlapping elements at row 1, column 2',
			componentId: "J2",
		});
	});

	test("valid concentric mount group emits no mount-binding issues", () => {
		const doc = concentricMountDoc([
			{
				id: "BASS",
				physical: {
					partProfileId: "pot-concentric-3",
					mountId: "m-tone",
					surface: "lower",
					centerMm: { x: 30, y: 28 },
				},
			},
			{
				id: "MID",
				physical: {
					partProfileId: "pot-concentric-3",
					mountId: "m-tone",
					surface: "middle",
					centerMm: { x: 30, y: 28 },
				},
			},
			{
				id: "TREBLE",
				physical: {
					partProfileId: "pot-concentric-3",
					mountId: "m-tone",
					surface: "upper",
					centerMm: { x: 30, y: 28 },
				},
			},
		]);
		const issues = validateDocument(doc);
		expect(
			issues.filter(
				(i) =>
					i.code === "panel-mount-orphan" ||
					i.code === "panel-mount-inconsistent",
			),
		).toEqual([]);
	});

	test("surface without a mountId is an orphan binding", () => {
		const doc = concentricMountDoc([
			{ id: "BASS", physical: { partProfileId: "pot-x", surface: "lower" } },
		]);
		const issue = validateDocument(doc).find(
			(i) => i.code === "panel-mount-orphan",
		);
		expect(issue?.severity).toBe("warning");
		expect(issue?.componentId).toBe("BASS");
	});

	test("mountId without a surface is an orphan binding", () => {
		const doc = concentricMountDoc([
			{
				id: "BASS",
				physical: {
					partProfileId: "pot-x",
					mountId: "m",
					centerMm: { x: 0, y: 0 },
				},
			},
			{
				id: "MID",
				physical: {
					partProfileId: "pot-x",
					mountId: "m",
					surface: "upper",
					centerMm: { x: 0, y: 0 },
				},
			},
		]);
		expect(
			validateDocument(doc).some((i) => i.code === "panel-mount-orphan"),
		).toBe(true);
	});

	test("mountId without a partProfileId is an orphan binding", () => {
		const doc = concentricMountDoc([
			{
				id: "BASS",
				physical: { mountId: "m", surface: "lower", centerMm: { x: 0, y: 0 } },
			},
			{
				id: "MID",
				physical: { mountId: "m", surface: "upper", centerMm: { x: 0, y: 0 } },
			},
		]);
		expect(
			validateDocument(doc).some((i) => i.code === "panel-mount-orphan"),
		).toBe(true);
	});

	test("duplicate surface within a mount group is inconsistent", () => {
		const doc = concentricMountDoc([
			{
				id: "BASS",
				physical: {
					partProfileId: "pot-x",
					mountId: "m",
					surface: "lower",
					centerMm: { x: 0, y: 0 },
				},
			},
			{
				id: "MID",
				physical: {
					partProfileId: "pot-x",
					mountId: "m",
					surface: "lower",
					centerMm: { x: 0, y: 0 },
				},
			},
		]);
		expect(
			validateDocument(doc).some((i) => i.code === "panel-mount-inconsistent"),
		).toBe(true);
	});

	test("mismatched partProfileId within a mount group is inconsistent", () => {
		const doc = concentricMountDoc([
			{
				id: "BASS",
				physical: {
					partProfileId: "pot-x",
					mountId: "m",
					surface: "lower",
					centerMm: { x: 0, y: 0 },
				},
			},
			{
				id: "MID",
				physical: {
					partProfileId: "pot-y",
					mountId: "m",
					surface: "upper",
					centerMm: { x: 0, y: 0 },
				},
			},
		]);
		expect(
			validateDocument(doc).some((i) => i.code === "panel-mount-inconsistent"),
		).toBe(true);
	});

	test("mismatched centerMm within a mount group is inconsistent", () => {
		const doc = concentricMountDoc([
			{
				id: "BASS",
				physical: {
					partProfileId: "pot-x",
					mountId: "m",
					surface: "lower",
					centerMm: { x: 0, y: 0 },
				},
			},
			{
				id: "MID",
				physical: {
					partProfileId: "pot-x",
					mountId: "m",
					surface: "upper",
					centerMm: { x: 5, y: 0 },
				},
			},
		]);
		expect(
			validateDocument(doc).some((i) => i.code === "panel-mount-inconsistent"),
		).toBe(true);
	});

	test("device interface metadata validates duplicate ids and unresolved references", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			controlGroups: [
				{
					id: "channel-1-panel",
					name: "Channel 1",
					role: "channel-section",
					contextIds: ["missing-display-context"],
					members: [
						{
							controlId: "missing-member-control",
							order: 1,
							appliesWhen: {
								anyOf: ["missing-member-context"],
							},
						},
						{
							controlId: "gain",
							order: 1,
						},
					],
				},
			],
			controlContexts: [
				{
					id: "channel-1",
					name: "Channel 1",
					role: "channel",
				},
			],
			deviceInterface: {
				controls: [
					{
						id: "gain",
						label: "Gain",
						kind: "knob",
						role: "gain",
						groupId: "missing-group",
						audioBinding: {
							kind: "control",
							controlName: " ",
						},
						binding: {
							componentId: "MISSING",
							externalInterfaceId: "missing-external-interface",
						},
						appliesWhen: {
							allOf: ["missing-context"],
						},
					},
					{
						id: "gain",
						label: "Gain duplicate",
						kind: "knob",
						role: "gain",
					},
				],
			},
			panel: {
				faces: [
					{
						id: "front",
						layout: {
							kind: "stompbox-grid",
							rows: 1,
							columns: 1,
							indexing: "one-based",
						},
						elements: [
							{
								bind: { componentId: "MISSING" },
								kind: "knob",
								interfaceControlId: "missing-interface-control",
								grid: { row: 1, column: 1 },
							},
						],
					},
				],
			},
		};

		const issues = validateDocument(doc);

		expect(
			issues.find((i) => i.code === "duplicate-device-interface-control-id"),
		).toMatchObject({
			severity: "error",
			componentId: "gain",
		});
		expect(
			issues.find((i) => i.code === "device-interface-group-unresolved"),
		).toMatchObject({
			severity: "warning",
			componentId: "gain",
			property: "groupId",
		});
		expect(
			issues.find((i) => i.code === "device-interface-context-unresolved"),
		).toMatchObject({
			severity: "warning",
			componentId: "gain",
			property: "appliesWhen.allOf",
		});
		expect(
			issues.find((i) => i.code === "device-interface-audio-binding-invalid"),
		).toMatchObject({
			severity: "error",
			componentId: "gain",
			property: "audioBinding.controlName",
		});
		expect(
			issues.find(
				(i) =>
					i.code === "device-interface-binding-unresolved" &&
					i.property === "binding.componentId",
			),
		).toMatchObject({
			severity: "warning",
			componentId: "gain",
			property: "binding.componentId",
		});
		expect(
			issues.find(
				(i) =>
					i.code === "device-interface-binding-unresolved" &&
					i.property === "binding.externalInterfaceId",
			),
		).toMatchObject({
			severity: "warning",
			componentId: "gain",
			property: "binding.externalInterfaceId",
		});
		expect(
			issues.find((i) => i.code === "control-group-context-unresolved"),
		).toMatchObject({
			severity: "warning",
			componentId: "channel-1-panel",
			property: "contextIds",
		});
		expect(
			issues.find(
				(i) =>
					i.code === "control-group-member-unresolved" &&
					i.property === "members.controlId",
			),
		).toMatchObject({
			severity: "warning",
			componentId: "channel-1-panel",
			property: "members.controlId",
		});
		expect(
			issues.find(
				(i) =>
					i.code === "control-group-member-context-unresolved" &&
					i.property === "members.appliesWhen.anyOf",
			),
		).toMatchObject({
			severity: "warning",
			componentId: "channel-1-panel",
			property: "members.appliesWhen.anyOf",
		});
		expect(
			issues.find(
				(i) =>
					i.code === "control-group-member-order-duplicate" &&
					i.property === "members.order",
			),
		).toMatchObject({
			severity: "warning",
			componentId: "channel-1-panel",
			property: "members.order",
		});
		expect(
			issues.find((i) => i.code === "panel-interface-control-unresolved"),
		).toMatchObject({
			severity: "warning",
			componentId: "missing-interface-control",
			property: "interfaceControlId",
		});
	});

	test("ordered control group members distinguish physical controls with the same semantic role", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			controlGroups: [
				{
					id: "shared-panel",
					name: "Shared panel",
					role: "source-panel",
					members: [
						{ controlId: "normal-volume", order: 1 },
						{ controlId: "bright-volume", order: 2 },
					],
				},
			],
			deviceInterface: {
				controls: [
					{
						id: "normal-volume",
						label: "Normal Volume",
						kind: "knob",
						role: "input-level",
					},
					{
						id: "bright-volume",
						label: "Bright Volume",
						kind: "knob",
						role: "input-level",
					},
				],
			},
		};

		expect(
			validateDocument(doc).find(
				(issue) => issue.code === "device-interface-duplicate-role",
			),
		).toBeUndefined();
	});

	test("known ControlRole values validate on source components and control interfaces", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("VOICE_A", "label", { ControlRole: "harmony-voice-a" }),
			],
			controlInterfaces: [
				{
					id: "tap",
					name: "Tap",
					role: "tempo-tap",
					controlRole: "tempo-tap",
				},
			],
		};

		expect(validateDocument(doc)).toEqual([]);
		expect(CONTROL_ROLE_VALUES).toContain("harmony-key");
	});

	test("unknown ControlRole values warn for source-only documents", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("KEY", "label", { ControlRole: "not-a-runtime-role" }),
			],
			controlInterfaces: [
				{
					id: "external",
					name: "External",
					role: "external-control",
					controlRole: "mystery-role",
				},
			],
		};

		const issues = validateDocument(doc);

		expect(issues).toContainEqual({
			code: "invalid-control-role",
			severity: "warning",
			message:
				'KEY: ControlRole "not-a-runtime-role" is not a recognized semantic control role',
			componentId: "KEY",
			property: "ControlRole",
		});
		expect(issues).toContainEqual({
			code: "invalid-control-role",
			severity: "warning",
			message:
				'Control interface "external" controlRole "mystery-role" is not a recognized semantic control role',
			componentId: "external",
			property: "controlRole",
		});
	});

	test("unknown ControlRole values error when playback is claimed", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("KEY", "label", { ControlRole: "not-a-runtime-role" }),
			],
		};

		expect(validateDocument(doc, { playbackClaim: true })).toContainEqual(
			expect.objectContaining({
				code: "invalid-control-role",
				severity: "error",
				componentId: "KEY",
				property: "ControlRole",
			}),
		);
	});

	test("device interface role tokens stay separate from semantic ControlRole values", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			deviceInterface: {
				controls: [
					{
						id: "voice-a",
						label: "VOICE A",
						kind: "knob",
						role: "harmony.voiceA",
					},
				],
			},
		};

		const issues = validateDocument(doc);

		expect(issues).toContainEqual(
			expect.objectContaining({
				code: "invalid-device-interface-token",
				severity: "warning",
				componentId: "voice-a",
				property: "role",
			}),
		);
		expect(issues.some((issue) => issue.code === "invalid-control-role")).toBe(
			false,
		);
	});

	test("custom validation rules can report lowering-specific ControlRole mismatches", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("KEY", "label", {
					Label: "KEY",
					ControlRole: "harmony-voice-a",
				}),
			],
		};

		const issues = validateDocument(doc, {
			rules: [
				(document) =>
					document.components.flatMap((component) =>
						component.properties.Label === "KEY" &&
						component.properties.ControlRole === "harmony-voice-a"
							? [
									{
										code: "audio-engine/control-role-label-mismatch",
										severity: "warning",
										message:
											'KEY: visible label "KEY" does not match ControlRole "harmony-voice-a"',
										componentId: component.id,
										property: "ControlRole",
									} as const,
								]
							: [],
					),
			],
		});

		expect(issues).toContainEqual(
			expect.objectContaining({
				code: "audio-engine/control-role-label-mismatch",
				severity: "warning",
				componentId: "KEY",
				property: "ControlRole",
			}),
		);
	});

	test("custom validation rules can report duplicate required semantic roles", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("KEY_A", "label", { ControlRole: "harmony-key" }),
				makeComponent("KEY_B", "label", { ControlRole: "harmony-key" }),
			],
		};

		const issues = validateDocument(doc, {
			rules: [
				(document) => {
					const owners = document.components.filter(
						(component) => component.properties.ControlRole === "harmony-key",
					);
					const duplicate = owners[1];
					return duplicate === undefined
						? []
						: [
								{
									code: "audio-engine/duplicate-control-role",
									severity: "error",
									message:
										'Controls "KEY_A" and "KEY_B" both claim required ControlRole "harmony-key"',
									componentId: duplicate.id,
									property: "ControlRole",
								} as const,
							];
				},
			],
		});

		expect(issues).toContainEqual({
			code: "audio-engine/duplicate-control-role",
			severity: "error",
			message:
				'Controls "KEY_A" and "KEY_B" both claim required ControlRole "harmony-key"',
			componentId: "KEY_B",
			property: "ControlRole",
		});
	});

	test("view-only interface controls waive electrical requirements but still validate present values", () => {
		const doc = withParts([
			makeComponent("BRIGHT", "potentiometer", { InterfaceOnly: true }),
			makeComponent("BROKEN", "potentiometer", {
				InterfaceOnly: "true",
				R: "not-a-number",
			}),
		]);

		const issues = validateDocument(doc);

		expect(
			issues.find(
				(i) => i.componentId === "BRIGHT" && i.code === "value-required",
			),
		).toBeUndefined();
		expect(
			issues.find(
				(i) => i.componentId === "BROKEN" && i.code === "value-unparseable",
			),
		).toBeDefined();
	});

	test("potentiometer requires R but taper is optional", () => {
		const doc = withParts([
			makeComponent("VR1", "potentiometer", { R: "500k" }),
		]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("potentiometer missing R emits error", () => {
		const doc = withParts([
			makeComponent("VR1", "potentiometer", { taper: "log" }),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "value-required")).toBe(true);
	});

	test("voltage-source accepts negative values (no min)", () => {
		const doc = withParts([
			makeComponent("V1", "voltage-source", { V: "-12V" }),
		]);
		expect(validateDocument(doc)).toEqual([]);
	});

	test("accepts BehaviorRole.firmwareRef on firmware-owning behavior roles", () => {
		const doc = withParts([
			makeComponent("MCU1", "ic", {
				model: "MCU",
				BehaviorRole: {
					kind: "firmware-dsp-core",
					firmwareRef: {
						id: "fw-mcu1",
						status: "source-bounded-approximation",
						version: "1.0",
						hash: "sha256:deadbeef",
						artifactType: "internal-rom",
						sourceVisibility: "visible-chip-marking",
						behaviorOwner: "firmware-proxy",
						memoryComponentId: "MEM1",
						mcuComponentId: "MCU1",
						notes: "visible MCU marking only",
					},
				},
			}),
			makeComponent("MEM1", "ic", { PartNumber: "external SRAM" }),
		]);

		expect(validateDocument(doc)).toEqual([]);
	});

	test("rejects BehaviorRole.firmwareRef on non-firmware behavior roles", () => {
		const doc = withParts([
			makeComponent("U1", "ic", {
				model: "U1",
				BehaviorRole: {
					kind: "chip-primitive",
					firmwareRef: {
						status: "unknown-proprietary",
					},
				},
			}),
		]);

		expect(validateDocument(doc).map((issue) => issue.code)).toContain(
			"behavior-role-firmware-ref-kind-mismatch",
		);
	});

	test("validates BehaviorRole.firmwareRef enum fields and owner status consistency", () => {
		const doc = withParts([
			makeComponent("MCU1", "ic", {
				model: "MCU",
				BehaviorRole: {
					kind: "firmware-dsp-core",
					firmwareRef: {
						status: "dumped",
						artifactType: "rom-image",
						sourceVisibility: "hidden",
						behaviorOwner: "recovered-firmware",
					},
				},
			}),
		]);

		expect(validateDocument(doc).map((issue) => issue.code)).toEqual([
			"behavior-role-firmware-ref-artifact-type-invalid",
			"behavior-role-firmware-ref-source-visibility-invalid",
			"behavior-role-firmware-ref-owner-status-mismatch",
			"behavior-role-firmware-ref-owner-status-mismatch",
		]);
	});

	test("validates BehaviorRole.firmwareRef MCU and memory component links", () => {
		const doc = withParts([
			makeComponent("MCU1", "ic", {
				model: "MCU",
				BehaviorRole: {
					kind: "firmware-dsp-core",
					firmwareRef: {
						status: "unknown-proprietary",
						memoryComponentId: "MISSING_MEM",
						mcuComponentId: "MISSING_MCU",
					},
				},
			}),
		]);

		expect(validateDocument(doc).map((issue) => issue.code)).toEqual([
			"behavior-role-firmware-ref-memory-component-unresolved",
			"behavior-role-firmware-ref-mcu-component-unresolved",
		]);
	});

	test("validates BehaviorRole.firmwareRef scalar string fields and rejects artifactType none", () => {
		const doc = withParts([
			makeComponent("MCU1", "ic", {
				model: "MCU",
				BehaviorRole: {
					kind: "firmware-dsp-core",
					firmwareRef: {
						id: ["fw-mcu1"],
						status: "unknown-proprietary",
						version: { major: 1 },
						hash: ["sha256:deadbeef"],
						artifactType: "none",
						notes: { text: "not scalar" },
					},
				},
			}),
		]);

		expect(validateDocument(doc).map((issue) => issue.code)).toEqual([
			"behavior-role-firmware-ref-string-invalid",
			"behavior-role-firmware-ref-string-invalid",
			"behavior-role-firmware-ref-string-invalid",
			"behavior-role-firmware-ref-string-invalid",
			"behavior-role-firmware-ref-artifact-type-invalid",
		]);
	});

	test("accepts display metadata and panel placement binding", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("MCU1", "ic", { PartNumber: "ATmega" }),
				makeComponent("LCD1", "display", {
					DisplayKind: "HD44780",
					Bus: "parallel",
					CharacterGrid: "16x2",
					DriverComponentId: "MCU1",
					DefaultText: ["READY", "TAP TEMPO"],
				}),
			],
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
								bind: { componentId: "LCD1", controlId: "LCD1" },
								kind: "display",
								grid: { row: 1, column: 1 },
							},
						],
					},
				],
			},
		};

		expect(validateDocument(doc)).toEqual([]);
	});

	test("validates malformed display metadata", () => {
		const doc = withParts([
			makeComponent("OLED1", "display", {
				DisplayKind: "crt",
				Bus: "lvds",
				CharacterGrid: "two-lines",
				Rows: 0,
				Columns: 2.5,
				DriverComponentId: "MISSING_MCU",
				DefaultText: "READY",
			}),
		]);

		expect(validateDocument(doc).map((issue) => issue.code)).toEqual([
			"display-kind-invalid",
			"display-bus-invalid",
			"display-grid-invalid",
			"display-grid-invalid",
			"display-grid-invalid",
			"display-driver-unresolved",
			"display-default-text-invalid",
		]);
	});

	test("value-unparseable emits error for garbage values", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", { R: "not-a-number" }),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "value-unparseable")).toBe(true);
	});

	test("InterfaceOnly on a wired active-device kind warns instead of silently waiving", () => {
		const doc = withParts([
			makeComponent("BYPASS_LED", "led", { InterfaceOnly: true }),
		]);
		const issues = validateDocument(doc);
		expect(
			issues.find((i) => i.code === "interface-only-active-device"),
		).toMatchObject({
			severity: "warning",
			componentId: "BYPASS_LED",
		});
		// Still waived for model-required, per the existing waiver path.
		expect(issues.find((i) => i.code === "model-required")).toBeUndefined();
	});

	test("InterfaceOnly on a non-active-device kind (e.g. potentiometer) does not warn", () => {
		const doc = withParts([
			makeComponent("CHECK_LED_STUB", "potentiometer", {
				InterfaceOnly: true,
			}),
		]);
		const issues = validateDocument(doc);
		expect(
			issues.find((i) => i.code === "interface-only-active-device"),
		).toBeUndefined();
	});

	test("InterfaceOnly on an active-device kind with no terminals does not warn", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					...makeComponent("CHECK_LED", "led", { InterfaceOnly: true }),
					terminals: [],
				},
			],
			wires: [],
		};
		const issues = validateDocument(doc);
		expect(
			issues.find((i) => i.code === "interface-only-active-device"),
		).toBeUndefined();
	});

	test("legacy Support: view-only property warns as invalid current schema vocabulary", () => {
		const doc = withParts([
			makeComponent("D1", "diode", { Support: "view-only", model: "1N4148" }),
		]);
		const issues = validateDocument(doc);
		expect(
			issues.find((i) => i.code === "schema-invalid-legacy-support-view-only"),
		).toMatchObject({
			severity: "warning",
			componentId: "D1",
			property: "Support",
		});
		expect(
			issues.find((i) => i.code === "interface-only-active-device"),
		).toBeUndefined();
	});

	test("legacy Support: view-only does not waive current schema requirements", () => {
		const doc = withParts([
			makeComponent("D1", "diode", { Support: "view-only" }),
		]);
		const issues = validateDocument(doc);
		expect(issues.map((i) => i.code)).toContain(
			"schema-invalid-legacy-support-view-only",
		);
		expect(issues.map((i) => i.code)).toContain("model-required");
	});

	test("Support values other than view-only are not flagged as legacy", () => {
		const doc = withParts([
			makeComponent("D1", "diode", { Support: "full", model: "1N4148" }),
		]);
		const issues = validateDocument(doc);
		expect(
			issues.find((i) => i.code === "schema-invalid-legacy-support-view-only"),
		).toBeUndefined();
	});
});

describe("validateComponent", () => {
	test("returns empty for kinds with no rules", () => {
		const c = makeComponent("L1", "label");
		expect(validateComponent(c)).toEqual([]);
	});

	test("accepts explicit rules override", () => {
		const c = makeComponent("R1", "resistor", { foo: "10k" });
		const issues = validateComponent(c, [
			{ kind: "quantity", name: "foo", required: true, unit: "Ω" },
		]);
		expect(issues).toEqual([]);
	});
});

describe("getRulesForKind", () => {
	test("returns rules for resistor", () => {
		const rules = getRulesForKind("resistor");
		expect(rules).toHaveLength(1);
		expect(rules[0]?.name).toBe("R");
		expect(rules[0]?.required).toBe(true);
	});

	test("returns empty for label", () => {
		expect(getRulesForKind("label")).toEqual([]);
	});
});

describe("hasErrors", () => {
	test("true when any issue has error severity", () => {
		expect(
			hasErrors([
				{ code: "duplicate-id", severity: "error", message: "x" },
				{ code: "unit-mismatch", severity: "warning", message: "y" },
			]),
		).toBe(true);
	});

	test("false when only warnings", () => {
		expect(
			hasErrors([{ code: "unit-mismatch", severity: "warning", message: "y" }]),
		).toBe(false);
	});

	test("false for empty list", () => {
		expect(hasErrors([])).toBe(false);
	});
});

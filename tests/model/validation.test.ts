import { describe, expect, test } from "bun:test";
import { parseInterchangeYaml } from "../../packages/core/src/formats/interchange/parser";
import {
	getRulesForKind,
	hasErrors,
	validateComponent,
	validateDocument,
} from "../../packages/core/src/model/validation";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type ComponentKind,
	type PanelElementPhysicalPlacement,
	type Point,
	type PropertyValue,
	type Wire,
} from "../../packages/core/src/model/types";

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

	test("value-unparseable emits error for garbage values", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", { R: "not-a-number" }),
		]);
		const issues = validateDocument(doc);
		expect(issues.some((i) => i.code === "value-unparseable")).toBe(true);
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

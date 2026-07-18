import { describe, expect, test } from "bun:test";
import {
	extractDeviceInterface,
	extractPanel,
} from "../../packages/core/src/panel";
import {
	convertCircuitDocumentFile,
	parseCircuitDocumentFile,
} from "../../packages/core/src/formats/document";
import { parseSchx } from "../../packages/core/src/formats/schx/parser";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type ComponentKind,
	type PropertyValue,
} from "../../packages/core/src/model/types";

async function loadFixture(name: string): Promise<string> {
	return Bun.file(
		new URL(`../fixtures/schx/${name}.schx`, import.meta.url),
	).text();
}

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
		terminals: [],
		properties,
		sourceTypeName,
	};
}

describe("extractPanel", () => {
	test("extracts a knob with taper/default-position from the LPB-1 boost", async () => {
		const doc = parseSchx(await loadFixture("lpb-1-style-boost"));
		const panel = extractPanel(doc);

		expect(panel.knobs).toHaveLength(1);
		const level = panel.knobs[0]!;
		expect(level.id).toBe("Level");
		expect(level.name).toBe("Level");
		expect(level.taper).toBe("log");
		expect(level.defaultPosition).toBeCloseTo(0.8);
		expect(level.gangGroup).toBe("Level");
		expect(level.resistance?.value).toBe(100_000);
	});

	test("extracts Pro Co Rat controls from generated VDSP", async () => {
		const source = await Bun.file(
			new URL(
				"../fixtures/schx/livespice-examples/Pro Co Rat.schx",
				import.meta.url,
			),
		).text();
		const vdsp = convertCircuitDocumentFile(source, {
			inputFilename: "Pro Co Rat.schx",
			outputFormat: "vdsp",
			outputFilename: "Pro Co Rat.vdsp",
		});
		const doc = parseCircuitDocumentFile(vdsp, { filename: "Pro Co Rat.vdsp" });

		const panel = extractPanel(doc);

		expect(panel.knobs.map((knob) => knob.id)).toEqual([
			"Distortion",
			"Tone",
			"Volume",
		]);
		expect(panel.knobs.map((knob) => knob.taper)).toEqual([
			"log",
			"log",
			"log",
		]);
		expect(panel.knobs.map((knob) => knob.defaultPosition)).toEqual([
			0.5, 0.5, 0.5,
		]);
		expect(
			panel.jacks.map((jack) => ({ id: jack.id, role: jack.role })),
		).toEqual([
			{ id: "V1", role: "input" },
			{ id: "S1", role: "output" },
		]);
	});

	test("extracts a 3PDT footswitch with 3 poles, 2 positions", async () => {
		const doc = parseSchx(await loadFixture("3pdt-true-bypass-pedal"));
		const panel = extractPanel(doc);

		expect(panel.switches).toHaveLength(1);
		const footswitch = panel.switches[0]!;
		expect(footswitch.id).toBe("SW1");
		expect(footswitch.switchKind).toBe("3pdt");
		expect(footswitch.poles).toBe(3);
		expect(footswitch.positions).toBe(2);
		expect(footswitch.partNumber).toBe("3PDT footswitch");
	});

	test("extracts an SPDT footswitch as 1 pole / 2 positions", async () => {
		const doc = parseSchx(await loadFixture("spdt-bypass-pedal"));
		const panel = extractPanel(doc);

		expect(panel.switches).toHaveLength(1);
		const sw = panel.switches[0]!;
		expect(sw.switchKind).toBe("spdt");
		expect(sw.poles).toBe(1);
		expect(sw.positions).toBe(2);
	});

	test("extracts an LED indicator and infers the colour from part number", async () => {
		const doc = parseSchx(await loadFixture("spdt-bypass-pedal"));
		const panel = extractPanel(doc);

		expect(panel.leds).toHaveLength(1);
		const led = panel.leds[0]!;
		expect(led.id).toBe("LED1");
		expect(led.color).toBe("red");
		expect(led.partNumber).toBe("3mm red");
	});

	test("extracts display metadata and infers a display device-interface control", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("MCU1", "ic", { PartNumber: "ATmega" }),
				makeComponent("OLED1", "display", {
					DisplayKind: "SSD1306 OLED",
					Bus: "I2C",
					Columns: 128,
					Rows: 64,
					DriverComponentId: "MCU1",
					PartNumber: "SSD1306 128x64",
					Description: "Status display",
					DefaultText: ["BYPASS", "ON"],
				}),
			],
		};

		const panel = extractPanel(doc);
		expect(panel.displays).toEqual([
			{
				id: "OLED1",
				name: "OLED1",
				displayKind: "oled",
				bus: "i2c",
				grid: { rows: 64, columns: 128 },
				driverComponentId: "MCU1",
				sourceComponentId: "OLED1",
				partNumber: "SSD1306 128x64",
				description: "Status display",
				defaultText: ["BYPASS", "ON"],
			},
		]);

		const deviceInterface = extractDeviceInterface(doc);
		expect(deviceInterface.controls).toContainEqual(
			expect.objectContaining({
				id: "OLED1",
				kind: "display",
				role: "indicator",
				binding: {
					componentId: "OLED1",
					controlId: "OLED1",
					controlName: "OLED1",
				},
				provenance: "source-inferred",
			}),
		);
	});

	test("classifies Input and Speaker jacks by role", async () => {
		const doc = parseSchx(await loadFixture("spdt-bypass-pedal"));
		const panel = extractPanel(doc);

		expect(panel.jacks.map((j) => j.role).sort()).toEqual(["input", "output"]);
		const input = panel.jacks.find((j) => j.role === "input")!;
		expect(input.id).toBe("IN");
		const output = panel.jacks.find((j) => j.role === "output")!;
		expect(output.id).toBe("OUT");
		expect(output.impedance?.value).toBe(10_000);
	});

	test("prefers semantic jack metadata over source type fallback", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent("J_OUT", "jack", { Role: "output" }, "Circuit.Input"),
				makeComponent(
					"J_EXPR",
					"jack",
					{ Interface: "expression" },
					"Circuit.Input",
				),
				makeComponent(
					"J_TAP",
					"jack",
					{ ControlRole: "tempo-tap", Interface: "tap-tempo" },
					"Circuit.Input",
				),
				makeComponent(
					"J_DIRECT",
					"jack",
					{ Role: "direct-out", Interface: "dry-output" },
					"Circuit.Speaker",
				),
			],
		};

		const panel = extractPanel(doc);
		const output = panel.jacks.find((jack) => jack.id === "J_OUT")!;
		const expression = panel.jacks.find((jack) => jack.id === "J_EXPR")!;
		const tap = panel.jacks.find((jack) => jack.id === "J_TAP")!;
		const direct = panel.jacks.find((jack) => jack.id === "J_DIRECT")!;

		expect(output.role).toBe("output");
		expect(expression.role).toBe("expression");
		expect(expression.interface).toBe("expression");
		expect(tap.role).toBe("tempo-tap");
		expect(tap.controlRole).toBe("tempo-tap");
		expect(tap.interface).toBe("tap-tempo");
		expect(direct.role).toBe("direct-output");
		expect(direct.interface).toBe("dry-output");
	});

	test("extracts explicit audio jack subtypes without promoting labels to roles", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent(
					"J_GUITAR",
					"jack",
					{
						Role: "input",
						Interface: "audio",
						AudioRole: "guitar-input",
						JackLabel: "Guitar In",
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
						Label: "Bass In",
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
						JackLabel: "Output A (Mono)",
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
						JackLabel: "Output B",
					},
					"Circuit.Speaker",
				),
				makeComponent(
					"J_GENERIC",
					"jack",
					{
						Role: "input",
						Interface: "audio-input",
						JackLabel: "Guitar In",
					},
					"Circuit.Input",
				),
			],
		};

		const panel = extractPanel(doc);

		expect(
			panel.jacks.map((jack) => ({
				id: jack.id,
				name: jack.name,
				role: jack.role,
				audioRole: jack.audioRole,
				interface: jack.interface,
			})),
		).toEqual([
			{
				id: "J_GUITAR",
				name: "Guitar In",
				role: "input",
				audioRole: "guitar-input",
				interface: "audio",
			},
			{
				id: "J_BASS",
				name: "Bass In",
				role: "input",
				audioRole: "bass-input",
				interface: "audio",
			},
			{
				id: "J_OUT_A",
				name: "Output A (Mono)",
				role: "output",
				audioRole: "output-a-mono",
				interface: "audio",
			},
			{
				id: "J_OUT_B",
				name: "Output B",
				role: "output",
				audioRole: "stereo-output-b",
				interface: "audio",
			},
			{
				id: "J_GENERIC",
				name: "Guitar In",
				role: "input",
				audioRole: undefined,
				interface: "audio-input",
			},
		]);
	});

	test("Big Muff tone stack exposes a single TONE knob with Linear taper", async () => {
		const doc = parseSchx(await loadFixture("big-muff-tone-stack"));
		const panel = extractPanel(doc);

		expect(panel.knobs).toHaveLength(1);
		expect(panel.knobs[0]?.id).toBe("TONE");
		expect(panel.knobs[0]?.taper).toBe("linear");
	});

	test("PT2399 fixture exposes three knobs (TIME/REPEATS/MIX) with named groups", async () => {
		const doc = parseSchx(await loadFixture("pt2399-delay"));
		const panel = extractPanel(doc);

		const labels = panel.knobs.map((k) => k.id).sort();
		expect(labels).toEqual(["MIX", "REPEATS", "TIME"]);
		const mix = panel.knobs.find((k) => k.id === "MIX")!;
		expect(mix.taper).toBe("log");
		const time = panel.knobs.find((k) => k.id === "TIME")!;
		expect(time.taper).toBe("linear");
	});

	test("extracts Boss GE-7 style slider controls from potentiometer metadata", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "BAND_800",
					kind: "potentiometer",
					name: "800Hz",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: 0, y: -20 } },
						{ name: "wiper", position: { x: 20, y: 0 } },
						{ name: "b", position: { x: 0, y: 20 } },
					],
					properties: {
						Wipe: "0.5",
						ControlStyle: "Slider",
						Orientation: "Vertical",
						RangeMin: "-15",
						RangeMax: "15",
						Unit: "dB",
						Center: "0",
						Group: "GE-7",
						Description: "Graphic EQ band fader.",
					},
					sourceTypeName: "Circuit.Potentiometer, Circuit",
				},
			],
		};

		const panel = extractPanel(doc);
		const sliders = panel.sliders ?? [];
		const slider = sliders[0]!;

		expect(panel.knobs).toEqual([]);
		expect(sliders).toHaveLength(1);
		expect(slider.id).toBe("BAND_800");
		expect(slider.name).toBe("800Hz");
		expect(slider.defaultPosition).toBe(0.5);
		expect(slider.orientation).toBe("vertical");
		expect(slider.gangGroup).toBe("GE-7");
		expect(slider.range).toEqual({ min: -15, max: 15, unit: "dB", center: 0 });
	});

	test("extracts DigiTech Drop style stepped knob detents from labels", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "DROP",
					kind: "potentiometer",
					name: "Drop",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: 0, y: -20 } },
						{ name: "wiper", position: { x: 20, y: 0 } },
						{ name: "b", position: { x: 0, y: 20 } },
					],
					properties: {
						Wipe: "0.24",
						Sweep: "Stepped",
						StepLabels: "1, 2, 3, 4, 5, 6, 7, OCT, OCT+DRY",
						Description: "Drop-tune selector with fixed semitone detents.",
					},
					sourceTypeName: "Circuit.Potentiometer, Circuit",
				},
			],
		};

		const panel = extractPanel(doc);
		const drop = panel.knobs[0]!;

		expect(drop.controlMode).toBe("stepped");
		expect(drop.defaultPosition).toBeCloseTo(0.25);
		expect(drop.steps).toHaveLength(9);
		expect(drop.steps?.[0]).toEqual({ index: 0, position: 0, label: "1" });
		expect(drop.steps?.[2]).toEqual({ index: 2, position: 0.25, label: "3" });
		expect(drop.steps?.[8]).toEqual({
			index: 8,
			position: 1,
			label: "OCT+DRY",
		});
	});

	test("extracts unlabeled stepped knobs from numeric detent metadata", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				{
					id: "MODE",
					kind: "potentiometer",
					name: "Mode",
					origin: { x: 0, y: 0 },
					rotation: 0,
					flipped: false,
					terminals: [
						{ name: "a", position: { x: 0, y: -20 } },
						{ name: "wiper", position: { x: 20, y: 0 } },
						{ name: "b", position: { x: 0, y: 20 } },
					],
					properties: {
						Wipe: "0.6",
						Detents: "4",
					},
					sourceTypeName: "Circuit.Potentiometer, Circuit",
				},
			],
		};

		const mode = extractPanel(doc).knobs[0]!;

		expect(mode.controlMode).toBe("stepped");
		expect(mode.steps).toEqual([
			{ index: 0, position: 0 },
			{ index: 1, position: 0.333333333333 },
			{ index: 2, position: 0.666666666667 },
			{ index: 3, position: 1 },
		]);
		expect(mode.defaultPosition).toBeCloseTo(0.666666666667);
	});

	test("extracts runtime descriptor controls and tempo tap as an external jack", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent(
					"U1",
					"ic",
					{
						RuntimeDescriptor: "true",
						TimeControl: "D.TIME",
						TimeControlWipe: "0.45",
						TimeControlSweep: "Logarithmic",
						FeedbackControl: "F.BACK",
						FeedbackControlWipe: { raw: "0.38", value: 0.38, unit: "" },
						FeedbackControlSweep: "Linear",
						MixControl: "E.LEVEL",
						MixControlWipe: { raw: "0.45", value: 0.45, unit: "" },
						MixControlSweep: "Linear",
						ModeControl: "MODE",
						ModeControlWipe: "2",
						ModeLabels: "DELAY 1,DELAY 2,HOLD,REVERSE",
						TempoTapControl: "Tempo In",
						DirectOutputJack: "Direct Out",
						DirectOutputSignal: "dry-buffered",
						DirectOutputRuntimeBoundary:
							"Physical dry Direct Out jack below Input.",
					},
					"Circuit.MicroBlockDelayChip",
				),
			],
		};

		const panel = extractPanel(doc);
		const time = panel.knobs.find((knob) => knob.id === "U1:time")!;
		const feedback = panel.knobs.find((knob) => knob.id === "U1:feedback")!;
		const mix = panel.knobs.find((knob) => knob.id === "U1:mix")!;
		const mode = panel.knobs.find((knob) => knob.id === "U1:mode")!;
		const tap = panel.jacks.find((jack) => jack.id === "U1:tempo-tap")!;
		const direct = panel.jacks.find((jack) => jack.id === "U1:direct-out")!;

		expect(time.name).toBe("D.TIME");
		expect(time.taper).toBe("log");
		expect(time.defaultPosition).toBeCloseTo(0.45);
		expect(feedback.name).toBe("F.BACK");
		expect(feedback.defaultPosition).toBeCloseTo(0.38);
		expect(mix.name).toBe("E.LEVEL");
		expect(mix.defaultPosition).toBeCloseTo(0.45);
		expect(mode.name).toBe("MODE");
		expect(mode.controlMode).toBe("stepped");
		expect(mode.defaultPosition).toBeCloseTo(0.666666666667);
		expect(mode.steps).toEqual([
			{ index: 0, position: 0, label: "DELAY 1" },
			{ index: 1, position: 0.333333333333, label: "DELAY 2" },
			{ index: 2, position: 0.666666666667, label: "HOLD" },
			{ index: 3, position: 1, label: "REVERSE" },
		]);
		expect(tap.name).toBe("Tempo In");
		expect(tap.role).toBe("tempo-tap");
		expect(tap.controlRole).toBe("tempo-tap");
		expect(tap.interface).toBe("tap-tempo");
		expect(tap.sourceComponentId).toBe("U1");
		expect(tap.assignmentHint).toBe("momentary");
		expect(direct).toMatchObject({
			name: "Direct Out",
			role: "direct-output",
			sourceComponentId: "U1",
			controlRole: "direct-output",
			interface: "audio-output",
			sourceTypeName: "Circuit.MicroBlockDelayChip",
			binding: {
				sourceComponentId: "U1",
				controlId: "U1:direct-out",
				controlName: "Direct Out",
				property: "DirectOutputJack",
			},
			description: "Physical dry Direct Out jack below Input.",
		});
		expect(panel.switches).toEqual([]);
	});

	test("extracts DD-3 style external trigger and reset controls from interface metadata", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent(
					"U1",
					"ic",
					{
						RuntimeDescriptor: "true",
						SamplerTriggerControl: "TRIGGER",
						ResetControl: "RESET",
					},
					"Circuit.MicroBlockDelayChip",
				),
			],
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
				},
				{
					id: "reset-input",
					name: "RESET external",
					role: "reset",
					controlRole: "reset",
					interface: "external-control-input",
					connector: "1/4-inch-mono-ts",
					assignmentHint: "momentary-or-latching",
					polarity: "normally-open",
					binding: {
						sourceComponentId: "U1",
						controlId: "U1:reset",
						controlName: "RESET",
						property: "ResetControl",
					},
				},
			],
		};

		const panel = extractPanel(doc);
		const trigger = panel.jacks.find((jack) => jack.id === "trigger-input")!;
		const reset = panel.jacks.find((jack) => jack.id === "reset-input")!;

		expect(panel.switches).toEqual([]);
		expect(trigger).toMatchObject({
			name: "TRIGGER external",
			role: "external-control",
			controlRole: "sampler-trigger",
			interface: "external-control-input",
			connector: "1/4-inch-mono-ts",
			assignmentHint: "momentary-or-latching",
			polarity: "normally-open",
			sourceComponentId: "U1",
			binding: {
				controlId: "U1:sampler-trigger",
				controlName: "TRIGGER",
				property: "SamplerTriggerControl",
			},
		});
		expect(reset).toMatchObject({
			name: "RESET external",
			role: "external-control",
			controlRole: "reset",
			interface: "external-control-input",
			binding: {
				controlId: "U1:reset",
				controlName: "RESET",
				property: "ResetControl",
			},
		});
	});

	test("empty document produces an empty panel", () => {
		const panel = extractPanel({
			metadata: { name: "", description: "", partNumber: "" },
			components: [],
			wires: [],
			directives: [],
			warnings: [],
			rawAttributes: {},
		});

		expect(panel.knobs).toEqual([]);
		expect(panel.switches).toEqual([]);
		expect(panel.leds).toEqual([]);
		expect(panel.jacks).toEqual([]);
	});

	test("exposes authored stompbox grid placement metadata", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			panel: {
				faces: [
					{
						id: "top",
						layout: {
							kind: "stompbox-grid",
							rows: 2,
							columns: 3,
							indexing: "one-based",
						},
						elements: [
							{
								bind: { componentId: "DRIVE" },
								kind: "knob",
								grid: { row: 1, column: 1 },
								label: "Drive",
							},
						],
					},
				],
			},
		};

		const panel = extractPanel(doc);

		expect(panel.placement).toEqual(doc.panel);
	});

	test("extracts declared device interface metadata with inferred bindings kept separate", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			controlGroups: [
				{
					id: "delay-panel",
					name: "Delay controls",
					role: "tone-stack",
				},
			],
			controlContexts: [
				{
					id: "mode-delay",
					name: "Delay",
					role: "mode",
				},
			],
			deviceInterface: {
				controls: [
					{
						id: "U1:time",
						label: "Delay Time",
						kind: "knob",
						role: "time",
						groupId: "delay-panel",
						appliesWhen: { allOf: ["mode-delay"] },
					},
					{
						id: "custom-bright",
						label: "Bright",
						kind: "switch",
						role: "bright",
					},
				],
			},
			components: [
				makeComponent(
					"U1",
					"ic",
					{
						RuntimeDescriptor: "true",
						TimeControl: "D.TIME",
						TimeControlWipe: "0.45",
						TimeControlSweep: "Linear",
					},
					"Circuit.MicroBlockDelayChip",
				),
			],
		};

		const iface = extractDeviceInterface(doc);
		const time = iface.controls.find((control) => control.id === "U1:time")!;
		const bright = iface.controls.find(
			(control) => control.id === "custom-bright",
		)!;

		expect(iface.groups).toEqual(doc.controlGroups ?? []);
		expect(iface.contexts).toEqual(doc.controlContexts ?? []);
		expect(time.provenance).toBe("vdsp-declared");
		expect(time.label).toBe("Delay Time");
		expect(time.binding).toBeUndefined();
		expect(time.inferredBinding).toEqual({
			componentId: "U1",
			controlId: "U1:time",
			controlName: "D.TIME",
			property: "TimeControl",
		});
		expect(bright.provenance).toBe("vdsp-declared");
		expect(bright.inferredBinding).toBeUndefined();
		expect(iface.diagnostics).toEqual([]);
	});

	test("extracts group membership separately from physical controls", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			controlContexts: [
				{ id: "normal", name: "Normal", role: "channel" },
				{ id: "bright", name: "Bright", role: "channel" },
			],
			controlGroups: [
				{
					id: "normal-panel",
					name: "Normal panel",
					role: "channel-section",
					contextIds: ["normal"],
					members: [
						{
							controlId: "volume",
							order: 1,
							appliesWhen: { anyOf: ["normal"] },
						},
						{ controlId: "tone", order: 2, appliesWhen: { anyOf: ["normal"] } },
					],
				},
				{
					id: "bright-panel",
					name: "Bright panel",
					role: "channel-section",
					contextIds: ["bright"],
					members: [
						{
							controlId: "volume",
							order: 1,
							appliesWhen: { anyOf: ["bright"] },
						},
						{ controlId: "tone", order: 2, appliesWhen: { anyOf: ["bright"] } },
					],
				},
			],
			deviceInterface: {
				controls: [
					{ id: "volume", label: "Volume", kind: "knob", role: "volume" },
					{ id: "tone", label: "Tone", kind: "knob", role: "tone" },
				],
			},
		};

		const iface = extractDeviceInterface(doc);

		expect(iface.controls.map((control) => control.id)).toEqual([
			"volume",
			"tone",
		]);
		expect(
			iface.groupMemberships.map((membership) => ({
				groupId: membership.group.id,
				controlId: membership.control.id,
				order: membership.order,
				appliesWhen: membership.appliesWhen,
			})),
		).toEqual([
			{
				groupId: "normal-panel",
				controlId: "volume",
				order: 1,
				appliesWhen: { anyOf: ["normal"] },
			},
			{
				groupId: "normal-panel",
				controlId: "tone",
				order: 2,
				appliesWhen: { anyOf: ["normal"] },
			},
			{
				groupId: "bright-panel",
				controlId: "volume",
				order: 1,
				appliesWhen: { anyOf: ["bright"] },
			},
			{
				groupId: "bright-panel",
				controlId: "tone",
				order: 2,
				appliesWhen: { anyOf: ["bright"] },
			},
		]);
	});

	test("extracts inferred controls when no declared device interface exists", () => {
		const doc: CircuitDocument = {
			...EMPTY_DOCUMENT,
			components: [
				makeComponent(
					"LEVEL",
					"potentiometer",
					{
						R: "100k",
						Wipe: "0.75",
					},
					"Circuit.Potentiometer",
				),
				makeComponent(
					"U1",
					"ic",
					{
						RuntimeDescriptor: "true",
						TempoTapControl: "Tempo In",
					},
					"Circuit.MicroBlockDelayChip",
				),
			],
			controlInterfaces: [
				{
					id: "trigger-input",
					name: "TRIGGER external",
					role: "trigger",
					binding: {
						sourceComponentId: "U1",
						controlId: "U1:sampler-trigger",
						controlName: "TRIGGER",
						property: "SamplerTriggerControl",
					},
				},
			],
		};

		const iface = extractDeviceInterface(doc);

		expect(
			iface.controls.map((control) => ({
				id: control.id,
				label: control.label,
				kind: control.kind,
				provenance: control.provenance,
			})),
		).toEqual([
			{
				id: "LEVEL",
				label: "LEVEL",
				kind: "knob",
				provenance: "source-inferred",
			},
			{
				id: "U1:tempo-tap",
				label: "Tempo In",
				kind: "jack",
				provenance: "runtime-descriptor-inferred",
			},
			{
				id: "trigger-input",
				label: "TRIGGER external",
				kind: "jack",
				provenance: "control-interface-declared",
			},
		]);
	});
});

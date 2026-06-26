import { describe, expect, test } from "bun:test";
import { serializeCircuitJsonDocument } from "../../../packages/core/src/formats/circuit-json/serializer";
import {
	EMPTY_DOCUMENT,
	type CircuitDocument,
	type Component,
	type ComponentKind,
	type Point,
	type PropertyValue,
	type Wire,
} from "../../../packages/core/src/model/types";

type CircuitJsonRecord = Readonly<Record<string, unknown>>;

function makeComponent(
	id: string,
	kind: ComponentKind,
	terminals: ReadonlyArray<[name: string, x: number, y: number]>,
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
		terminals: terminals.map(([name, x, y]) => ({ name, position: { x, y } })),
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

function recordsOfType(
	elements: readonly CircuitJsonRecord[],
	type: string,
): readonly CircuitJsonRecord[] {
	return elements.filter((element) => element.type === type);
}

describe("serializeCircuitJsonDocument", () => {
	test("exports a simple RC low-pass as source components, ports, nets, and traces", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 20, 0],
				],
				{ R: "10k" },
			),
			makeComponent(
				"C1",
				"capacitor",
				[
					["a", 20, 0],
					["b", 20, -20],
				],
				{ C: "100nF" },
			),
			makeComponent("GND", "ground", [["t", 20, -20]]),
		]);

		const circuitJson = serializeCircuitJsonDocument(doc, {
			target: "tscircuit",
		});

		expect(circuitJson.warnings).toEqual([]);

		expect(recordsOfType(circuitJson.elements, "source_net")).toEqual([
			{
				type: "source_net",
				source_net_id: "source_net:0",
				name: "GND",
				member_source_group_ids: [],
				is_ground: true,
				is_analog_signal: true,
			},
			{
				type: "source_net",
				source_net_id: "source_net:1",
				name: "N1",
				member_source_group_ids: [],
				is_analog_signal: true,
			},
			{
				type: "source_net",
				source_net_id: "source_net:2",
				name: "N2",
				member_source_group_ids: [],
				is_analog_signal: true,
			},
		]);

		expect(recordsOfType(circuitJson.elements, "source_component")).toEqual([
			{
				type: "source_component",
				ftype: "simple_resistor",
				source_component_id: "source_component:R1",
				name: "R1",
				display_name: "R1",
				resistance: 10000,
				display_resistance: "10k",
				display_value: "10k",
			},
			{
				type: "source_component",
				ftype: "simple_capacitor",
				source_component_id: "source_component:C1",
				name: "C1",
				display_name: "C1",
				capacitance: 1e-7,
				display_capacitance: "100nF",
				display_value: "100nF",
			},
			{
				type: "source_component",
				ftype: "simple_ground",
				source_component_id: "source_component:GND",
				name: "GND",
				display_name: "GND",
			},
		]);

		expect(recordsOfType(circuitJson.elements, "source_port")).toEqual([
			{
				type: "source_port",
				source_port_id: "source_port:R1:a",
				source_component_id: "source_component:R1",
				name: "a",
				port_hints: ["a"],
			},
			{
				type: "source_port",
				source_port_id: "source_port:R1:b",
				source_component_id: "source_component:R1",
				name: "b",
				port_hints: ["b"],
			},
			{
				type: "source_port",
				source_port_id: "source_port:C1:a",
				source_component_id: "source_component:C1",
				name: "a",
				port_hints: ["a"],
			},
			{
				type: "source_port",
				source_port_id: "source_port:C1:b",
				source_component_id: "source_component:C1",
				name: "b",
				port_hints: ["b"],
			},
			{
				type: "source_port",
				source_port_id: "source_port:GND:t",
				source_component_id: "source_component:GND",
				name: "t",
				port_hints: ["t"],
				provides_ground: true,
			},
		]);

		expect(recordsOfType(circuitJson.elements, "source_trace")).toEqual([
			{
				type: "source_trace",
				source_trace_id: "source_trace:0",
				connected_source_port_ids: ["source_port:C1:b", "source_port:GND:t"],
				connected_source_net_ids: ["source_net:0"],
				display_name: "GND",
			},
			{
				type: "source_trace",
				source_trace_id: "source_trace:1",
				connected_source_port_ids: ["source_port:R1:a"],
				connected_source_net_ids: ["source_net:1"],
				display_name: "N1",
			},
			{
				type: "source_trace",
				source_trace_id: "source_trace:2",
				connected_source_port_ids: ["source_port:R1:b", "source_port:C1:a"],
				connected_source_net_ids: ["source_net:2"],
				display_name: "N2",
			},
		]);
	});

	test("marks rail nodes as power and anchors their generated trace to the resolved net", () => {
		const doc = withParts([
			makeComponent("VCC", "rail", [["t", 0, 0]], { V: "9V" }),
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 20, 0],
				],
				{ R: "1k" },
			),
			makeComponent("GND", "ground", [["t", 20, 0]]),
		]);

		const circuitJson = serializeCircuitJsonDocument(doc);
		const nets = recordsOfType(circuitJson.elements, "source_net");
		const powerNet = nets.find((net) => net.name === "VCC");

		expect(powerNet).toEqual({
			type: "source_net",
			source_net_id: "source_net:1",
			name: "VCC",
			member_source_group_ids: [],
			is_power: true,
			is_positive_voltage_source: true,
			is_analog_signal: true,
		});
		expect(recordsOfType(circuitJson.elements, "source_port")).toContainEqual({
			type: "source_port",
			source_port_id: "source_port:VCC:t",
			source_component_id: "source_component:VCC",
			name: "t",
			port_hints: ["t"],
			provides_power: true,
			provides_voltage: 9,
		});
		expect(recordsOfType(circuitJson.elements, "source_trace")).toContainEqual({
			type: "source_trace",
			source_trace_id: "source_trace:1",
			connected_source_port_ids: ["source_port:VCC:t", "source_port:R1:a"],
			connected_source_net_ids: ["source_net:1"],
			display_name: "VCC",
		});
	});

	test("skips unsupported components with explicit diagnostics", () => {
		const doc = withParts([
			makeComponent(
				"R1",
				"resistor",
				[
					["a", 0, 0],
					["b", 20, 0],
				],
				{ R: "1k" },
			),
			makeComponent(
				"U?",
				"unsupported",
				[["t", 20, 0]],
				{},
				"Circuit.Components.MysteryChip",
			),
		]);

		const circuitJson = serializeCircuitJsonDocument(doc);

		expect(
			recordsOfType(circuitJson.elements, "source_component").map(
				(component) => component.source_component_id,
			),
		).toEqual(["source_component:R1"]);
		expect(circuitJson.warnings).toEqual([
			"U? (unsupported): unsupported source type Circuit.Components.MysteryChip skipped from Circuit JSON export",
		]);
		expect(recordsOfType(circuitJson.elements, "source_trace")).toEqual([
			{
				type: "source_trace",
				source_trace_id: "source_trace:0",
				connected_source_port_ids: ["source_port:R1:a"],
				connected_source_net_ids: ["source_net:0"],
				display_name: "N0",
			},
			{
				type: "source_trace",
				source_trace_id: "source_trace:1",
				connected_source_port_ids: ["source_port:R1:b"],
				connected_source_net_ids: ["source_net:1"],
				display_name: "N1",
			},
		]);
	});

	test("missing required quantities fall back to generic source-component metadata with a warning", () => {
		const doc = withParts([
			makeComponent("R1", "resistor", [
				["a", 0, 0],
				["b", 20, 0],
			]),
		]);

		const circuitJson = serializeCircuitJsonDocument(doc);

		expect(recordsOfType(circuitJson.elements, "source_component")).toEqual([
			{
				type: "source_component",
				ftype: "simple_chip",
				source_component_id: "source_component:R1",
				name: "R1",
				display_name: "R1",
			},
		]);
		expect(circuitJson.warnings).toEqual([
			"R1 (resistor): missing resistance; emitted opaque simple_chip source component metadata only",
		]);
	});

	test("exports JFET source components and ports with an explicit lossy mapping warning", () => {
		const doc = withParts([
			makeComponent(
				"Q1",
				"jfet",
				[
					["drain", 0, -20],
					["gate", -20, 0],
					["source", 0, 20],
				],
				{ PartNumber: "2N5457" },
				"Circuit.NjfJfet",
			),
		]);

		const circuitJson = serializeCircuitJsonDocument(doc);

		expect(recordsOfType(circuitJson.elements, "source_component")).toEqual([
			{
				type: "source_component",
				ftype: "simple_mosfet",
				source_component_id: "source_component:Q1",
				name: "Q1",
				display_name: "Q1",
				channel_type: "n",
				mosfet_mode: "depletion",
				manufacturer_part_number: "2N5457",
			},
		]);
		expect(
			recordsOfType(circuitJson.elements, "source_port").map(
				(port) => port.name,
			),
		).toEqual(["drain", "gate", "source"]);
		expect(circuitJson.warnings).toEqual([
			"Q1 (jfet): Circuit JSON has no simple_jfet ftype; emitted simple_mosfet depletion-mode source metadata",
		]);
	});

	test("exports source-only metadata sidecars and can-cap source groups", () => {
		const doc = withParts([
			makeComponent(
				"C_MAIN_A",
				"capacitor",
				[
					["a", 0, 0],
					["b", 0, 20],
				],
				{
					C: "16uF",
					SourceOnly: "true",
					RuntimeOwnership: "source-reference",
					CanCapGroupId: "C_MAIN",
					CanCapSection: "A",
					SourceBoundaryRole: "reservoir-filter-section",
					RailLabel: "B+1",
					SourcePartRef: "C1A",
				},
			),
			makeComponent(
				"R_SCREEN",
				"resistor",
				[
					["a", 20, 0],
					["b", 40, 0],
				],
				{
					R: "470 ohm",
					SourceOnly: "true",
					RuntimeOwnership: "source-reference",
					SourceBoundaryRole: "power-tube-screen-grid",
				},
			),
		]);

		const circuitJson = serializeCircuitJsonDocument(doc);

		expect(recordsOfType(circuitJson.elements, "source_group")).toEqual([
			{
				type: "source_group",
				source_group_id: "source_group:vessel-dsp-can-cap:C_MAIN",
				show_as_schematic_box: true,
				name: "C_MAIN",
			},
		]);
		expect(
			recordsOfType(circuitJson.elements, "source_component"),
		).toContainEqual({
			type: "source_component",
			ftype: "simple_capacitor",
			source_component_id: "source_component:C_MAIN_A",
			source_group_id: "source_group:vessel-dsp-can-cap:C_MAIN",
			name: "C_MAIN_A",
			display_name: "C_MAIN_A",
			capacitance: 0.000016,
			display_capacitance: "16uF",
			display_value: "16uF",
		});
		expect(
			recordsOfType(circuitJson.elements, "source_component"),
		).toContainEqual({
			type: "source_component",
			ftype: "simple_resistor",
			source_component_id: "source_component:R_SCREEN",
			name: "R_SCREEN",
			display_name: "R_SCREEN",
			resistance: 470,
			display_resistance: "470 ohm",
			display_value: "470 ohm",
		});
		expect(
			recordsOfType(circuitJson.elements, "source_property_ignored_warning"),
		).toEqual([
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:C_MAIN_A:SourceOnly",
				source_component_id: "source_component:C_MAIN_A",
				property_name: "SourceOnly",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"SourceOnly","value":"true"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:C_MAIN_A:RuntimeOwnership",
				source_component_id: "source_component:C_MAIN_A",
				property_name: "RuntimeOwnership",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"RuntimeOwnership","value":"source-reference"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:C_MAIN_A:CanCapSection",
				source_component_id: "source_component:C_MAIN_A",
				property_name: "CanCapSection",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"CanCapSection","value":"A"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:C_MAIN_A:SourceBoundaryRole",
				source_component_id: "source_component:C_MAIN_A",
				property_name: "SourceBoundaryRole",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"SourceBoundaryRole","value":"reservoir-filter-section"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:C_MAIN_A:RailLabel",
				source_component_id: "source_component:C_MAIN_A",
				property_name: "RailLabel",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"RailLabel","value":"B+1"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:C_MAIN_A:SourcePartRef",
				source_component_id: "source_component:C_MAIN_A",
				property_name: "SourcePartRef",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"SourcePartRef","value":"C1A"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:R_SCREEN:SourceOnly",
				source_component_id: "source_component:R_SCREEN",
				property_name: "SourceOnly",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"SourceOnly","value":"true"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:R_SCREEN:RuntimeOwnership",
				source_component_id: "source_component:R_SCREEN",
				property_name: "RuntimeOwnership",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"RuntimeOwnership","value":"source-reference"}',
			},
			{
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id:
					"vessel_dsp_property:source_component:R_SCREEN:SourceBoundaryRole",
				source_component_id: "source_component:R_SCREEN",
				property_name: "SourceBoundaryRole",
				error_type: "source_property_ignored_warning",
				message:
					'vessel-dsp-property-json:{"property":"SourceBoundaryRole","value":"power-tube-screen-grid"}',
			},
		]);
		expect(circuitJson.warnings).toEqual([]);
	});

	test("wire-only nodes become nets with traces but warn when no exported ports reference them", () => {
		const doc = withParts(
			[],
			[makeWire("w1", { x: 0, y: 0 }, { x: 20, y: 0 })],
		);

		const circuitJson = serializeCircuitJsonDocument(doc);

		expect(circuitJson.elements).toEqual([]);
		expect(circuitJson.warnings).toEqual([]);
	});
});

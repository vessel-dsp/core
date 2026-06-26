import {
	any_circuit_element,
	type AnyCircuitElement,
	type AnyCircuitElementInput,
	type CircuitJson as OfficialCircuitJson,
} from "circuit-json";
import {
	getPinNode,
	resolveConnectivity,
	type Connectivity,
	type NodeId,
} from "../../model/connectivity";
import {
	propertyQuantityValue,
	propertyStringValue,
} from "../../model/properties";
import { parseQuantity } from "../../model/quantity";
import type {
	CircuitDocument,
	Component,
	ComponentKind,
	ParsedQuantity,
	Point,
	PropertyValue,
	Rotation,
	Terminal,
	Warning,
	Wire,
} from "../../model/types";

export type CircuitJsonExportTarget = "tscircuit";

export type CircuitJsonExportOptions = Readonly<{
	target?: CircuitJsonExportTarget;
}>;

export type CircuitJsonSourceNet = Readonly<{
	type: "source_net";
	source_net_id: string;
	name: string;
	member_source_group_ids: string[];
	is_power?: boolean;
	is_ground?: boolean;
	is_digital_signal?: boolean;
	is_analog_signal?: boolean;
	is_positive_voltage_source?: boolean;
}>;

export type CircuitJsonSourceComponent = Readonly<{
	type: "source_component";
	source_component_id: string;
	name: string;
	source_group_id?: string;
	ftype?: string;
	display_name?: string;
	display_value?: string;
	resistance?: number;
	display_resistance?: string;
	capacitance?: number;
	display_capacitance?: string;
	inductance?: number;
	display_inductance?: string;
	voltage?: number;
	current?: number;
	wave_shape?: "dc" | "sine" | "square" | "triangle" | "sawtooth" | "sinewave";
	transistor_type?: "npn" | "pnp";
	channel_type?: "n" | "p";
	mosfet_mode?: "enhancement" | "depletion";
	max_resistance?: number;
	display_max_resistance?: string;
	manufacturer_part_number?: string;
}>;

export type CircuitJsonSourcePort = Readonly<{
	type: "source_port";
	source_port_id: string;
	source_component_id: string;
	name: string;
	port_hints: string[];
	provides_ground?: boolean;
	requires_ground?: boolean;
	provides_power?: boolean;
	requires_power?: boolean;
	provides_voltage?: number;
}>;

export type CircuitJsonSourceTrace = Readonly<{
	type: "source_trace";
	source_trace_id: string;
	connected_source_port_ids: string[];
	connected_source_net_ids: string[];
	display_name?: string;
}>;

export type CircuitJsonSourceGroup = Readonly<{
	type: "source_group";
	source_group_id: string;
	show_as_schematic_box?: boolean;
	name?: string;
}>;

export type CircuitJsonSourcePropertyIgnoredWarning = Readonly<{
	type: "source_property_ignored_warning";
	source_property_ignored_warning_id: string;
	source_component_id: string;
	property_name: string;
	error_type: "source_property_ignored_warning";
	message: string;
}>;

export type CircuitJsonElement = AnyCircuitElement;

export type CircuitJson = OfficialCircuitJson;
export type { AnyCircuitElement, AnyCircuitElementInput };

export type CircuitJsonExport = Readonly<{
	elements: CircuitJson;
	warnings: readonly string[];
}>;

export type CircuitJsonSchemaValidationIssue = Readonly<{
	code: "circuit-json-schema-invalid";
	message: string;
	path?: string;
}>;

export type CircuitJsonSchemaValidationResult =
	| Readonly<{
			valid: true;
			elements: CircuitJson;
			errors: readonly [];
	  }>
	| Readonly<{
			valid: false;
			errors: readonly CircuitJsonSchemaValidationIssue[];
	  }>;

export type ParseCircuitJsonDocumentOptions = Readonly<{
	filename?: string;
}>;

type JsonRecord = Readonly<Record<string, unknown>>;

type SourceComponentRecord = Readonly<{
	sourceComponentId: string;
	componentId: string;
	name: string;
	ftype: string | null;
	sourceGroupId: string | null;
	record: JsonRecord;
}>;

type SourcePortRecord = Readonly<{
	sourcePortId: string;
	componentSourceId: string;
	terminalName: string;
	record: JsonRecord;
}>;

type SchematicComponentRecord = Readonly<{
	sourceComponentId: string;
	center: Point;
}>;

type SchematicPortRecord = Readonly<{
	sourcePortId: string;
	center: Point;
}>;

type SourceGroupRecord = Readonly<{
	sourceGroupId: string;
	name: string | null;
}>;

type SourcePropertySidecar = Readonly<{
	sourceComponentId: string;
	propertyName: string;
	value: PropertyValue;
}>;

type MutableComponentBuild = {
	readonly sourceComponent: SourceComponentRecord;
	readonly ports: readonly SourcePortRecord[];
	readonly origin: Point;
	readonly terminals: readonly Terminal[];
};

type QuantityLookup = Readonly<{
	value: ParsedQuantity;
}>;

type QuantityKey =
	| "resistance"
	| "capacitance"
	| "inductance"
	| "voltage"
	| "current";
type CircuitJsonSchematicPortDirection = "up" | "down" | "left" | "right";

const VALUE_PROPERTY_NAMES: Readonly<Record<QuantityKey, readonly string[]>> = {
	resistance: ["R", "Resistance", "resistance", "value", "Value"],
	capacitance: ["C", "Capacitance", "capacitance", "value", "Value"],
	inductance: ["L", "Inductance", "inductance", "value", "Value"],
	voltage: ["V", "Voltage", "voltage", "value", "Value"],
	current: ["I", "Current", "current", "value", "Value"],
};

const MODEL_PROPERTY_NAMES: readonly string[] = [
	"manufacturerPartNumber",
	"ManufacturerPartNumber",
	"manufacturer_part_number",
	"partNumber",
	"PartNumber",
	"model",
	"Model",
	"modelName",
	"ModelName",
];

const DIRECT_EXPORT_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
	"resistor",
	"variable-resistor",
	"capacitor",
	"inductor",
	"diode",
	"led",
	"bjt",
	"jfet",
	"mosfet",
	"opamp",
	"potentiometer",
	"switch",
	"voltage-source",
	"current-source",
	"battery",
	"ground",
	"rail",
	"jack",
	"port",
	"ic",
]);

const SOURCE_ONLY_NET_NAME_KINDS: ReadonlySet<ComponentKind> =
	new Set<ComponentKind>(["label", "named-wire"]);

const VESSEL_CAN_CAP_SOURCE_GROUP_PREFIX = "source_group:vessel-dsp-can-cap:";
const VESSEL_DSP_PROPERTY_JSON_PREFIX = "vessel-dsp-property-json:";
const VESSEL_DSP_PROPERTY_SIDECAR_ID_PREFIX = "vessel_dsp_property:";

const TSCIRCUIT_SCHEMATIC_COORD_SCALE = 0.02;
const DEFAULT_SCHEMATIC_COMPONENT_SIZE = { width: 1.2, height: 0.8 };

export function serializeCircuitJsonDocument(
	doc: CircuitDocument,
	_options: CircuitJsonExportOptions = {},
): CircuitJsonExport {
	const connectivity = resolveConnectivity(doc);
	const warnings: string[] = [];
	const exportedComponentIds = new Set<string>();
	const sourcePortIdsByNode = new Map<NodeId, string[]>();
	const names = netNames(doc, connectivity);
	const powerNodes = railNodeIds(doc, connectivity);

	const nets = sourceNetElements(connectivity, names, powerNodes);
	const groups = sourceGroupElements(doc);
	const components: CircuitJsonSourceComponent[] = [];
	const ports: CircuitJsonSourcePort[] = [];

	for (const component of doc.components) {
		const sourceComponent = sourceComponentElement(component, warnings);
		if (sourceComponent === null) {
			continue;
		}
		exportedComponentIds.add(component.id);
		components.push(sourceComponent);

		for (const terminal of component.terminals) {
			const nodeId = getPinNode(connectivity, {
				componentId: component.id,
				terminalName: terminal.name,
			});
			const sourcePort = sourcePortElement(component, terminal.name);
			ports.push(sourcePort);
			if (nodeId !== undefined) {
				appendSourcePort(
					sourcePortIdsByNode,
					nodeId,
					sourcePort.source_port_id,
				);
			}
		}
	}

	const traces = sourceTraceElements(
		connectivity,
		names,
		sourcePortIdsByNode,
		warnings,
	);
	warnings.push(...sourceOnlyWarnings(doc, exportedComponentIds));

	const sidecars = sourcePropertySidecarElements(doc, exportedComponentIds);
	const sourceElements = [
		...sourceProjectMetadataElements(doc),
		...nets,
		...groups,
		...components,
		...ports,
		...traces,
		...sidecars,
	];
	return {
		elements: normalizeCircuitJsonElements([
			...sourceElements,
			...schematicElements(doc, traces),
		]),
		warnings,
	};
}

export function validateCircuitJsonDocument(
	source: unknown,
): CircuitJsonSchemaValidationResult {
	if (!Array.isArray(source)) {
		return {
			valid: false,
			errors: [
				{
					code: "circuit-json-schema-invalid",
					message: "Circuit JSON document must be an array of elements",
				},
			],
		};
	}

	const elements: AnyCircuitElement[] = [];
	const errors: CircuitJsonSchemaValidationIssue[] = [];
	for (const [index, element] of source.entries()) {
		const shallowIssue = shallowSchemaIssue(element);
		if (shallowIssue !== null) {
			errors.push({
				code: "circuit-json-schema-invalid",
				message: shallowIssue,
				path: `[${index}]`,
			});
			continue;
		}
		const result = any_circuit_element.safeParse(element);
		if (result.success) {
			elements.push(result.data);
			continue;
		}
		errors.push({
			code: "circuit-json-schema-invalid",
			message: summarizeSchemaIssues(result.error.issues),
			path: `[${index}]`,
		});
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}
	return { valid: true, elements, errors: [] };
}

export function parseCircuitJsonDocument(
	source: unknown,
	options: ParseCircuitJsonDocumentOptions = {},
): CircuitDocument {
	const result = validateCircuitJsonDocument(source);
	if (!result.valid) {
		throw new Error(
			result.errors
				.map((error) => `${error.path ?? "<root>"}: ${error.message}`)
				.join("; "),
		);
	}

	const sourceComponents = new Map<string, SourceComponentRecord>();
	const sourcePorts = new Map<string, SourcePortRecord>();
	const sourceGroups = new Map<string, SourceGroupRecord>();
	const sourcePropertySidecars = new Map<string, SourcePropertySidecar[]>();
	const schematicComponents = new Map<string, SchematicComponentRecord>();
	const schematicPorts = new Map<string, SchematicPortRecord>();
	const sourceTraces: JsonRecord[] = [];
	const sourceNets = new Map<string, JsonRecord>();
	const warnings: Warning[] = [];
	const directives: string[] = [];
	let metadataName: string | null = null;

	for (const element of result.elements) {
		const record = checkedRecord(element);
		const type = stringField(record, "type");
		switch (type) {
			case "source_component": {
				const sourceComponentId = requiredStringField(
					record,
					"source_component_id",
				);
				sourceComponents.set(sourceComponentId, {
					sourceComponentId,
					componentId:
						stripKnownPrefix(sourceComponentId, "source_component:") ??
						sanitizeId(stringField(record, "name") ?? sourceComponentId),
					name:
						stringField(record, "name") ??
						stripKnownPrefix(sourceComponentId, "source_component:") ??
						sourceComponentId,
					ftype: stringField(record, "ftype"),
					sourceGroupId: stringField(record, "source_group_id"),
					record,
				});
				break;
			}
			case "source_group": {
				const sourceGroupId = requiredStringField(record, "source_group_id");
				sourceGroups.set(sourceGroupId, {
					sourceGroupId,
					name: stringField(record, "name"),
				});
				break;
			}
			case "source_property_ignored_warning": {
				const sidecar = vesselDspPropertySidecar(record);
				if (sidecar === null) {
					warnings.push({
						code: "circuit-json-source-property-ignored",
						message: `Circuit JSON source property "${stringField(record, "property_name") ?? ""}" was ignored`,
					});
					break;
				}
				const existing = sourcePropertySidecars.get(sidecar.sourceComponentId);
				if (existing === undefined) {
					sourcePropertySidecars.set(sidecar.sourceComponentId, [sidecar]);
				} else {
					existing.push(sidecar);
				}
				break;
			}
			case "source_port": {
				const sourcePortId = requiredStringField(record, "source_port_id");
				const componentSourceId = requiredStringField(
					record,
					"source_component_id",
				);
				sourcePorts.set(sourcePortId, {
					sourcePortId,
					componentSourceId,
					terminalName:
						stringField(record, "name") ??
						terminalNameFromSourcePortId(sourcePortId),
					record,
				});
				break;
			}
			case "source_trace":
				sourceTraces.push(record);
				break;
			case "source_net": {
				sourceNets.set(requiredStringField(record, "source_net_id"), record);
				break;
			}
			case "source_project_metadata":
				metadataName = stringField(record, "name");
				break;
			case "schematic_component": {
				const sourceComponentId = stringField(record, "source_component_id");
				const center = pointField(record, "center");
				if (sourceComponentId !== null && center !== null) {
					schematicComponents.set(sourceComponentId, {
						sourceComponentId,
						center,
					});
				}
				break;
			}
			case "schematic_port": {
				const sourcePortId = requiredStringField(record, "source_port_id");
				const center = pointField(record, "center");
				if (center !== null) {
					schematicPorts.set(sourcePortId, { sourcePortId, center });
				}
				break;
			}
			case "schematic_text": {
				const text = stringField(record, "text");
				if (text?.startsWith("!") === true) {
					directives.push(text.slice(1).trim());
				}
				break;
			}
			default:
				if (type !== null && !type.startsWith("schematic_")) {
					warnings.push({
						code: "circuit-json-element-unsupported",
						message: `Circuit JSON element type "${type}" is not represented in CircuitDocument`,
					});
				}
				break;
		}
	}

	const portsByComponent = groupPortsByComponent(sourcePorts);
	const hasSchematicGeometry =
		schematicComponents.size > 0 || schematicPorts.size > 0;
	if (!hasSchematicGeometry && sourceComponents.size > 0) {
		warnings.push({
			code: "circuit-json-layout-synthesized",
			message:
				"Circuit JSON source elements did not include schematic geometry; generated deterministic component and terminal positions",
		});
	}

	const componentBuilds = Array.from(sourceComponents.values()).map(
		(sourceComponent, index) => {
			const ports =
				portsByComponent.get(sourceComponent.sourceComponentId) ?? [];
			const sidecars =
				sourcePropertySidecars.get(sourceComponent.sourceComponentId) ?? [];
			return buildComponentFromCircuitJson(
				sourceComponent,
				ports,
				schematicComponents,
				schematicPorts,
				sourceGroups,
				sidecars,
				index,
			);
		},
	);
	const components = componentBuilds.map((build) => build.component);
	const terminalPositions = terminalPositionMap(componentBuilds);
	const wires = wireElementsFromSourceTraces(sourceTraces, terminalPositions);
	const netWarnings = warningsForUnconnectedNets(sourceNets, sourceTraces);

	return {
		metadata: {
			name:
				metadataName ??
				filenameWithoutCircuitJsonExtension(
					options.filename ?? "Circuit JSON Import",
				),
			description: "",
			partNumber: "",
		},
		source: {
			format: "circuit-json",
			...(options.filename !== undefined ? { filename: options.filename } : {}),
		},
		components,
		wires,
		directives,
		warnings: [...warnings, ...netWarnings],
		rawAttributes: { format: "circuit-json" },
	};
}

function sourceProjectMetadataElements(
	doc: CircuitDocument,
): AnyCircuitElement[] {
	if (doc.metadata.name.trim().length === 0) {
		return [];
	}
	return [
		{
			type: "source_project_metadata",
			name: doc.metadata.name,
			software_used_string: "@vessel-dsp/core",
		},
	];
}

function sourceNetElements(
	connectivity: Connectivity,
	names: ReadonlyMap<NodeId, string>,
	powerNodes: ReadonlySet<NodeId>,
): readonly CircuitJsonSourceNet[] {
	const elements: CircuitJsonSourceNet[] = [];

	for (let nodeId = 0; nodeId < connectivity.nodeCount; nodeId += 1) {
		const isGround = connectivity.groundNodeId === nodeId;
		const isPower = powerNodes.has(nodeId);
		const name = names.get(nodeId) ?? (isGround ? "GND" : `N${nodeId}`);
		elements.push({
			type: "source_net",
			source_net_id: sourceNetId(nodeId),
			name,
			member_source_group_ids: [],
			...(isGround ? { is_ground: true } : {}),
			...(isPower ? { is_power: true, is_positive_voltage_source: true } : {}),
			is_analog_signal: true,
		});
	}

	return elements;
}

function sourceGroupElements(
	doc: CircuitDocument,
): readonly CircuitJsonSourceGroup[] {
	const byGroupId = new Map<string, CircuitJsonSourceGroup>();

	for (const component of doc.components) {
		const groupId = canCapGroupProperty(component);
		if (groupId === null || byGroupId.has(groupId)) {
			continue;
		}
		const packageName = firstStringProperty(component, [
			"CanCapPackageName",
			"PackageName",
		]);
		byGroupId.set(groupId, {
			type: "source_group",
			source_group_id: canCapSourceGroupId(groupId),
			show_as_schematic_box: true,
			name: packageName ?? groupId,
		});
	}

	return Array.from(byGroupId.values());
}

function sourceComponentElement(
	component: Component,
	warnings: string[],
): CircuitJsonSourceComponent | null {
	if (component.kind === "unsupported") {
		warnings.push(
			`${component.id} (unsupported): unsupported source type ${component.sourceTypeName ?? "unknown"} skipped from Circuit JSON export`,
		);
		return null;
	}
	if (SOURCE_ONLY_NET_NAME_KINDS.has(component.kind)) {
		return null;
	}
	if (!DIRECT_EXPORT_KINDS.has(component.kind)) {
		warnings.push(
			`${component.id} (${component.kind}): no Circuit JSON source-component mapping; skipped`,
		);
		return null;
	}

	const base = sourceComponentBase(component);
	const manufacturerPartNumber = firstStringProperty(
		component,
		MODEL_PROPERTY_NAMES,
	);

	switch (component.kind) {
		case "resistor":
		case "variable-resistor": {
			const resistance = quantity(component, "resistance");
			if (resistance === null) {
				return missingQuantityComponent(
					component,
					"resistance",
					warnings,
					manufacturerPartNumber,
				);
			}
			return {
				...base,
				ftype: "simple_resistor",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
				resistance: resistance.value.value,
				display_resistance: resistance.value.raw,
				display_value: resistance.value.raw,
			};
		}
		case "capacitor": {
			const capacitance = quantity(component, "capacitance");
			if (capacitance === null) {
				return missingQuantityComponent(
					component,
					"capacitance",
					warnings,
					manufacturerPartNumber,
				);
			}
			return {
				...base,
				ftype: "simple_capacitor",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
				capacitance: capacitance.value.value,
				display_capacitance: capacitance.value.raw,
				display_value: capacitance.value.raw,
			};
		}
		case "inductor": {
			const inductance = quantity(component, "inductance");
			if (inductance === null) {
				return missingQuantityComponent(
					component,
					"inductance",
					warnings,
					manufacturerPartNumber,
				);
			}
			return {
				...base,
				ftype: "simple_inductor",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
				inductance: inductance.value.value,
				display_inductance: inductance.value.raw,
				display_value: inductance.value.raw,
			};
		}
		case "diode":
			return {
				...base,
				ftype: "simple_diode",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
			};
		case "led":
			return {
				...base,
				ftype: "simple_led",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
			};
		case "bjt":
			return {
				...base,
				ftype: "simple_transistor",
				transistor_type: inferTransistorType(component),
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
			};
		case "jfet":
			warnings.push(
				`${component.id} (jfet): Circuit JSON has no simple_jfet ftype; emitted simple_mosfet depletion-mode source metadata`,
			);
			return {
				...base,
				ftype: "simple_mosfet",
				channel_type: inferJfetChannel(component),
				mosfet_mode: "depletion",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
			};
		case "mosfet":
			return {
				...base,
				ftype: "simple_mosfet",
				channel_type: inferMosfetChannel(component),
				mosfet_mode: inferMosfetMode(component),
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
			};
		case "opamp":
			return {
				...base,
				ftype: "simple_op_amp",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
			};
		case "potentiometer": {
			const resistance = quantity(component, "resistance");
			if (resistance === null) {
				return missingQuantityComponent(
					component,
					"resistance",
					warnings,
					manufacturerPartNumber,
				);
			}
			return {
				...base,
				ftype: "simple_potentiometer",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
				max_resistance: resistance.value.value,
				display_max_resistance: resistance.value.raw,
				display_value: resistance.value.raw,
			};
		}
		case "switch":
			return { ...base, ftype: "simple_switch" };
		case "voltage-source":
		case "battery": {
			const voltage = quantity(component, "voltage");
			if (voltage === null) {
				return missingQuantityComponent(component, "voltage", warnings, null);
			}
			return {
				...base,
				ftype: "simple_voltage_source",
				voltage: voltage.value.value,
				display_value: voltage.value.raw,
			};
		}
		case "rail": {
			const voltage = quantity(component, "voltage");
			if (voltage === null) {
				return missingQuantityComponent(component, "voltage", warnings, null);
			}
			return {
				...base,
				ftype: "simple_power_source",
				voltage: voltage.value.value,
				display_value: voltage.value.raw,
			};
		}
		case "current-source": {
			const current = quantity(component, "current");
			if (current === null) {
				return missingQuantityComponent(component, "current", warnings, null);
			}
			return {
				...base,
				ftype: "simple_current_source",
				wave_shape: "dc",
				current: current.value.value,
				display_value: current.value.raw,
			};
		}
		case "ground":
			return { ...base, ftype: "simple_ground" };
		case "jack":
			return { ...base, ftype: "simple_connector" };
		case "port":
			return { ...base, ftype: "simple_test_point" };
		case "ic":
			return {
				...base,
				ftype: "simple_chip",
				...(manufacturerPartNumber !== null
					? { manufacturer_part_number: manufacturerPartNumber }
					: {}),
			};
		case "ota":
		case "triode":
		case "pentode":
		case "tube-diode":
		case "transformer":
		case "optocoupler":
		case "bbd":
		case "delay-ic":
		case "power-amp":
		case "regulator":
		case "analog-switch":
		case "flipflop":
		case "label":
		case "named-wire":
			warnings.push(
				`${component.id} (${component.kind}): no Circuit JSON source-component mapping; skipped`,
			);
			return null;
	}
}

function sourceComponentBase(component: Component): CircuitJsonSourceComponent {
	const groupId = canCapGroupProperty(component);
	return {
		type: "source_component",
		source_component_id: sourceComponentId(component.id),
		name: component.name,
		display_name: component.name,
		...(groupId === null
			? {}
			: { source_group_id: canCapSourceGroupId(groupId) }),
	};
}

function canCapGroupProperty(component: Component): string | null {
	if (component.kind !== "capacitor") {
		return null;
	}
	const value = propertyStringValue(component.properties.CanCapGroupId);
	return value === null || value.trim().length === 0 ? null : value.trim();
}

function canCapSourceGroupId(groupId: string): string {
	return `${VESSEL_CAN_CAP_SOURCE_GROUP_PREFIX}${groupId}`;
}

function canCapGroupIdFromSourceGroupId(sourceGroupId: string): string | null {
	return stripKnownPrefix(sourceGroupId, VESSEL_CAN_CAP_SOURCE_GROUP_PREFIX);
}

function sourcePropertySidecarElements(
	doc: CircuitDocument,
	exportedComponentIds: ReadonlySet<string>,
): readonly CircuitJsonSourcePropertyIgnoredWarning[] {
	const sidecars: CircuitJsonSourcePropertyIgnoredWarning[] = [];
	for (const component of doc.components) {
		if (!exportedComponentIds.has(component.id)) {
			continue;
		}
		const consumed = circuitJsonConsumedPropertyKeys(component);
		for (const [propertyName, value] of Object.entries(component.properties)) {
			if (consumed.has(propertyName)) {
				continue;
			}
			const sourceComponentIdValue = sourceComponentId(component.id);
			sidecars.push({
				type: "source_property_ignored_warning",
				source_property_ignored_warning_id: `${VESSEL_DSP_PROPERTY_SIDECAR_ID_PREFIX}${sourceComponentIdValue}:${propertyName}`,
				source_component_id: sourceComponentIdValue,
				property_name: propertyName,
				error_type: "source_property_ignored_warning",
				message: `${VESSEL_DSP_PROPERTY_JSON_PREFIX}${stableJsonStringify({
					property: propertyName,
					value,
				})}`,
			});
		}
	}
	return sidecars;
}

function circuitJsonConsumedPropertyKeys(
	component: Component,
): ReadonlySet<string> {
	const consumed = new Set<string>();
	const quantityKey = quantityKeyForComponent(component.kind);
	if (quantityKey !== null) {
		for (const name of VALUE_PROPERTY_NAMES[quantityKey]) {
			consumed.add(name);
		}
	}
	for (const name of MODEL_PROPERTY_NAMES) {
		consumed.add(name);
	}
	consumed.add("ftype");
	if (canCapGroupProperty(component) !== null) {
		consumed.add("CanCapGroupId");
		consumed.add("CanCapPackageName");
		consumed.add("PackageName");
	}
	return consumed;
}

function quantityKeyForComponent(kind: ComponentKind): QuantityKey | null {
	switch (kind) {
		case "resistor":
		case "variable-resistor":
		case "potentiometer":
			return "resistance";
		case "capacitor":
			return "capacitance";
		case "inductor":
			return "inductance";
		case "voltage-source":
		case "battery":
		case "rail":
			return "voltage";
		case "current-source":
			return "current";
		default:
			return null;
	}
}

function sourcePortElement(
	component: Component,
	terminalName: string,
): CircuitJsonSourcePort {
	const voltage =
		component.kind === "rail" ? quantity(component, "voltage") : null;
	return {
		type: "source_port",
		source_port_id: sourcePortId(component.id, terminalName),
		source_component_id: sourceComponentId(component.id),
		name: terminalName,
		port_hints: [terminalName],
		...(component.kind === "ground" ? { provides_ground: true } : {}),
		...(component.kind === "rail" ? { provides_power: true } : {}),
		...(voltage !== null ? { provides_voltage: voltage.value.value } : {}),
	};
}

function sourceTraceElements(
	connectivity: Connectivity,
	names: ReadonlyMap<NodeId, string>,
	sourcePortIdsByNode: ReadonlyMap<NodeId, readonly string[]>,
	warnings: string[],
): readonly CircuitJsonSourceTrace[] {
	const traces: CircuitJsonSourceTrace[] = [];

	for (let nodeId = 0; nodeId < connectivity.nodeCount; nodeId += 1) {
		const sourcePortIds = sourcePortIdsByNode.get(nodeId) ?? [];
		if (sourcePortIds.length === 0) {
			warnings.push(
				`${sourceNetId(nodeId)}: no exported source ports reference this resolved node`,
			);
			continue;
		}
		traces.push({
			type: "source_trace",
			source_trace_id: sourceTraceId(nodeId),
			connected_source_port_ids: [...sourcePortIds],
			connected_source_net_ids: [sourceNetId(nodeId)],
			display_name:
				names.get(nodeId) ??
				(connectivity.groundNodeId === nodeId ? "GND" : `N${nodeId}`),
		});
	}

	return traces;
}

function schematicElements(
	doc: CircuitDocument,
	sourceTraces: readonly CircuitJsonSourceTrace[],
): AnyCircuitElement[] {
	const elements: AnyCircuitElement[] = [];
	const schematicPortBySourcePortId = new Map<string, string>();

	for (const component of doc.components) {
		if (SOURCE_ONLY_NET_NAME_KINDS.has(component.kind)) {
			continue;
		}
		const schematicComponentId = `schematic_component:${component.id}`;
		elements.push({
			type: "schematic_component",
			schematic_component_id: schematicComponentId,
			source_component_id: sourceComponentId(component.id),
			center: toTscircuitSchematicPoint(component.origin),
			size: schematicComponentSize(component),
			symbol_name: schematicSymbolName(component),
			...(schematicDisplayValue(component) === undefined
				? {}
				: { symbol_display_value: schematicDisplayValue(component) }),
			is_box_with_pins: true,
		});
		for (const [terminalIndex, terminal] of component.terminals.entries()) {
			const sourcePortIdValue = sourcePortId(component.id, terminal.name);
			const schematicPortId = `schematic_port:${component.id}:${terminal.name}`;
			schematicPortBySourcePortId.set(sourcePortIdValue, schematicPortId);
			elements.push({
				type: "schematic_port",
				schematic_port_id: schematicPortId,
				source_port_id: sourcePortIdValue,
				schematic_component_id: schematicComponentId,
				center: toTscircuitSchematicPoint(terminal.position),
				is_connected: true,
				display_pin_label: terminal.name,
				facing_direction: schematicPortFacingDirection(
					component.origin,
					terminal.position,
				),
				distance_from_component_edge: 0.4,
				pin_number: terminalIndex + 1,
			});
		}
	}

	for (const trace of sourceTraces) {
		const sourcePortIds = trace.connected_source_port_ids;
		if (sourcePortIds.length < 2) {
			continue;
		}
		const first = sourcePortIds[0];
		if (first === undefined) {
			continue;
		}
		const edges = sourcePortIds.slice(1).map((sourcePortIdValue) => ({
			from: sourcePortPosition(doc, first),
			to: sourcePortPosition(doc, sourcePortIdValue),
			from_schematic_port_id: schematicPortBySourcePortId.get(first),
			to_schematic_port_id: schematicPortBySourcePortId.get(sourcePortIdValue),
		}));
		elements.push({
			type: "schematic_trace",
			schematic_trace_id: `schematic_${trace.source_trace_id}`,
			source_trace_id: trace.source_trace_id,
			junctions: [],
			edges,
		});
	}

	for (const [index, directive] of doc.directives.entries()) {
		elements.push({
			type: "schematic_text",
			schematic_text_id: `schematic_text:directive:${index + 1}`,
			text: `!${directive}`,
			font_size: 0.6,
			position: toTscircuitSchematicPoint({ x: 0, y: 40 + index * 12 }),
			rotation: 0,
			color: "#000000",
			anchor: "left",
		});
	}

	return elements;
}

function normalizeCircuitJsonElements(
	elements: readonly unknown[],
): CircuitJson {
	const result = validateCircuitJsonDocument(elements);
	if (!result.valid) {
		throw new Error(
			`generated invalid Circuit JSON: ${result.errors.map((error) => `${error.path ?? "<root>"}: ${error.message}`).join("; ")}`,
		);
	}
	return result.elements;
}

function schematicSymbolName(component: Component): string {
	switch (component.kind) {
		case "resistor":
		case "variable-resistor":
			return "boxresistor_right";
		case "capacitor":
			return isPolarizedCapacitor(component)
				? "capacitor_polarized_right"
				: "capacitor_right";
		case "inductor":
			return "inductor_right";
		case "diode":
			return diodeSymbolName(component);
		case "led":
			return "led_right";
		case "bjt":
			return inferTransistorType(component) === "pnp"
				? "pnp_bipolar_transistor_right"
				: "npn_bipolar_transistor_right";
		case "jfet":
			return inferJfetChannel(component) === "p"
				? "pjfet_transistor_horz"
				: "njfet_transistor_horz";
		case "mosfet":
			return mosfetSymbolName(component);
		case "opamp":
			return "opamp_no_power_right";
		case "potentiometer":
			return "potentiometer2_right";
		case "switch":
			return "spst_switch_right";
		case "ground":
			return "ground_down";
		case "rail":
			return "vcc_down";
		case "voltage-source":
		case "battery":
			return "battery_vert";
		case "current-source":
			return "current_source_right";
		case "port":
			return "testpoint_right";
		case "jack":
		case "ic":
		case "ota":
		case "triode":
		case "pentode":
		case "tube-diode":
		case "transformer":
		case "optocoupler":
		case "bbd":
		case "delay-ic":
		case "power-amp":
		case "regulator":
		case "analog-switch":
		case "flipflop":
		case "unsupported":
		case "label":
		case "named-wire":
			return "testpoint_right";
	}
}

function schematicComponentSize(component: Component): {
	readonly width: number;
	readonly height: number;
} {
	switch (component.kind) {
		case "resistor":
		case "variable-resistor":
			return { width: 1.1, height: 0.39 };
		case "capacitor":
			return { width: 1.1, height: 0.84 };
		case "inductor":
			return { width: 1.16, height: 0.46 };
		case "diode":
			return { width: 1.04, height: 0.54 };
		case "led":
			return { width: 1.13, height: 0.65 };
		case "bjt":
			return {
				width: 1.1,
				height: inferTransistorType(component) === "pnp" ? 0.83 : 0.95,
			};
		case "opamp":
			return { width: 1, height: 0.72 };
		case "potentiometer":
			return { width: 1.18, height: 0.58 };
		case "ground":
		case "rail":
		case "port":
		case "jack":
			return { width: 0.8, height: 0.6 };
		default:
			return DEFAULT_SCHEMATIC_COMPONENT_SIZE;
	}
}

function schematicDisplayValue(component: Component): string | undefined {
	const value =
		quantity(component, "resistance") ??
		quantity(component, "capacitance") ??
		quantity(component, "inductance") ??
		quantity(component, "voltage") ??
		quantity(component, "current");
	return value?.value.raw;
}

function schematicPortFacingDirection(
	origin: Point,
	terminalPosition: Point,
): CircuitJsonSchematicPortDirection {
	const dx = terminalPosition.x - origin.x;
	const dy = terminalPosition.y - origin.y;
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx < 0 ? "left" : "right";
	}
	return dy < 0 ? "up" : "down";
}

function isPolarizedCapacitor(component: Component): boolean {
	const text = searchablePropertyText(component);
	return text.includes("electrolytic") || text.includes("polar");
}

function diodeSymbolName(component: Component): string {
	const text = searchablePropertyText(component);
	if (text.includes("zener")) {
		return "zener_diode_horz";
	}
	if (text.includes("schottky")) {
		return "schottky_diode_right";
	}
	return "diode_right";
}

function mosfetSymbolName(component: Component): string {
	const channel = inferMosfetChannel(component);
	const mode = inferMosfetMode(component);
	if (channel === "p") {
		return mode === "depletion"
			? "p_channel_d_mosfet_transistor_horz"
			: "p_channel_e_mosfet_transistor_horz";
	}
	return mode === "depletion"
		? "n_channel_d_mosfet_transistor_horz"
		: "n_channel_e_mosfet_transistor_horz";
}

function netNames(
	doc: CircuitDocument,
	connectivity: Connectivity,
): ReadonlyMap<NodeId, string> {
	const names = new Map<NodeId, string>();
	for (const component of doc.components) {
		if (component.terminals.length === 0) {
			continue;
		}
		if (
			component.kind !== "rail" &&
			component.kind !== "named-wire" &&
			component.kind !== "label"
		) {
			continue;
		}
		const terminal = component.terminals[0];
		if (terminal === undefined) {
			continue;
		}
		const nodeId = getPinNode(connectivity, {
			componentId: component.id,
			terminalName: terminal.name,
		});
		if (nodeId !== undefined && !names.has(nodeId)) {
			names.set(nodeId, component.name);
		}
	}
	if (connectivity.groundNodeId !== null) {
		names.set(connectivity.groundNodeId, "GND");
	}
	return names;
}

function railNodeIds(
	doc: CircuitDocument,
	connectivity: Connectivity,
): ReadonlySet<NodeId> {
	const ids = new Set<NodeId>();
	for (const component of doc.components) {
		if (component.kind !== "rail") {
			continue;
		}
		for (const terminal of component.terminals) {
			const nodeId = getPinNode(connectivity, {
				componentId: component.id,
				terminalName: terminal.name,
			});
			if (nodeId !== undefined) {
				ids.add(nodeId);
			}
		}
	}
	return ids;
}

function sourceOnlyWarnings(
	doc: CircuitDocument,
	exportedComponentIds: ReadonlySet<string>,
): readonly string[] {
	const warnings: string[] = [];
	for (const component of doc.components) {
		if (exportedComponentIds.has(component.id)) {
			continue;
		}
		if (SOURCE_ONLY_NET_NAME_KINDS.has(component.kind)) {
			warnings.push(
				`${component.id} (${component.kind}): used for net naming only; no Circuit JSON source component emitted`,
			);
		}
	}
	return warnings;
}

function appendSourcePort(
	map: Map<NodeId, string[]>,
	nodeId: NodeId,
	sourcePortIdValue: string,
): void {
	const existing = map.get(nodeId);
	if (existing === undefined) {
		map.set(nodeId, [sourcePortIdValue]);
		return;
	}
	existing.push(sourcePortIdValue);
}

function quantity(
	component: Component,
	key: QuantityKey,
): QuantityLookup | null {
	const names = VALUE_PROPERTY_NAMES[key];
	for (const name of names) {
		const value = component.properties[name];
		const parsed = propertyQuantity(value);
		if (parsed !== null) {
			return { value: parsed };
		}
	}
	return null;
}

function propertyQuantity(
	value: PropertyValue | undefined,
): ParsedQuantity | null {
	return propertyQuantityValue(value);
}

function missingQuantityComponent(
	component: Component,
	quantityName: string,
	warnings: string[],
	manufacturerPartNumber: string | null,
): CircuitJsonSourceComponent {
	warnings.push(
		`${component.id} (${component.kind}): missing ${quantityName}; emitted opaque simple_chip source component metadata only`,
	);
	return {
		...sourceComponentBase(component),
		ftype: "simple_chip",
		...(manufacturerPartNumber !== null
			? { manufacturer_part_number: manufacturerPartNumber }
			: {}),
	};
}

function firstStringProperty(
	component: Component,
	names: readonly string[],
): string | null {
	for (const name of names) {
		const value = component.properties[name];
		const text = propertyStringValue(value);
		if (text !== null && text.trim().length > 0) {
			return text;
		}
	}
	return null;
}

function inferTransistorType(component: Component): "npn" | "pnp" {
	const searchable = searchablePropertyText(component);
	return searchable.includes("pnp") ? "pnp" : "npn";
}

function inferMosfetChannel(component: Component): "n" | "p" {
	const searchable = searchablePropertyText(component);
	return searchable.includes("pmos") ||
		searchable.includes("p-channel") ||
		searchable.includes("p channel")
		? "p"
		: "n";
}

function inferJfetChannel(component: Component): "n" | "p" {
	const searchable = searchablePropertyText(component);
	return searchable.includes("pjf") ||
		searchable.includes("p-channel") ||
		searchable.includes("p channel")
		? "p"
		: "n";
}

function inferMosfetMode(component: Component): "enhancement" | "depletion" {
	const searchable = searchablePropertyText(component);
	return searchable.includes("depletion") ? "depletion" : "enhancement";
}

function searchablePropertyText(component: Component): string {
	const values: string[] = [component.name, component.sourceTypeName ?? ""];
	for (const value of Object.values(component.properties)) {
		const text = propertyStringValue(value);
		if (text !== null) {
			values.push(text);
		}
	}
	return values.join(" ").toLowerCase();
}

function sourceComponentId(componentId: string): string {
	return `source_component:${componentId}`;
}

function sourcePortId(componentId: string, terminalName: string): string {
	return `source_port:${componentId}:${terminalName}`;
}

function sourceNetId(nodeId: NodeId): string {
	return `source_net:${nodeId}`;
}

function sourceTraceId(nodeId: NodeId): string {
	return `source_trace:${nodeId}`;
}

function sourcePortPosition(
	doc: CircuitDocument,
	sourcePortIdValue: string,
): Point {
	const parsed = parseSourcePortId(sourcePortIdValue);
	if (parsed === null) {
		return { x: 0, y: 0 };
	}
	const component = doc.components.find(
		(candidate) => candidate.id === parsed.componentId,
	);
	const terminal = component?.terminals.find(
		(candidate) => candidate.name === parsed.terminalName,
	);
	return toTscircuitSchematicPoint(
		terminal?.position ?? component?.origin ?? { x: 0, y: 0 },
	);
}

function toTscircuitSchematicPoint(point: Point): Point {
	return {
		x: roundTscircuitSchematicCoordinate(
			point.x * TSCIRCUIT_SCHEMATIC_COORD_SCALE,
		),
		y: roundTscircuitSchematicCoordinate(
			point.y * TSCIRCUIT_SCHEMATIC_COORD_SCALE,
		),
	};
}

function roundTscircuitSchematicCoordinate(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function parseSourcePortId(
	sourcePortIdValue: string,
): Readonly<{ componentId: string; terminalName: string }> | null {
	const prefix = "source_port:";
	if (!sourcePortIdValue.startsWith(prefix)) {
		return null;
	}
	const rest = sourcePortIdValue.slice(prefix.length);
	const separator = rest.lastIndexOf(":");
	if (separator < 0) {
		return null;
	}
	return {
		componentId: rest.slice(0, separator),
		terminalName: rest.slice(separator + 1),
	};
}

function summarizeSchemaIssues(
	issues: readonly {
		readonly path: readonly (string | number)[];
		readonly message: string;
	}[],
): string {
	return issues
		.slice(0, 3)
		.map((issue) => {
			const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
			return `${path}: ${issue.message}`;
		})
		.join("; ");
}

function shallowSchemaIssue(value: unknown): string | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return "Circuit JSON element must be an object";
	}
	const record = Object.fromEntries(Object.entries(value));
	const type = record.type;
	if (
		type === "source_component" &&
		typeof record.source_component_id !== "string"
	) {
		return "source_component_id: Expected string";
	}
	return null;
}

function checkedRecord(value: unknown): JsonRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected Circuit JSON element object");
	}
	return Object.fromEntries(Object.entries(value));
}

function vesselDspPropertySidecar(
	record: JsonRecord,
): SourcePropertySidecar | null {
	const sourceComponentIdValue = stringField(record, "source_component_id");
	const propertyName = stringField(record, "property_name");
	const message = stringField(record, "message");
	if (
		sourceComponentIdValue === null ||
		propertyName === null ||
		message === null
	) {
		return null;
	}
	if (!message.startsWith(VESSEL_DSP_PROPERTY_JSON_PREFIX)) {
		return null;
	}

	const payload = parseJsonRecord(
		message.slice(VESSEL_DSP_PROPERTY_JSON_PREFIX.length),
	);
	if (payload === null || payload.property !== propertyName) {
		return null;
	}
	const value = payload.value;
	if (!isPropertyValue(value)) {
		return null;
	}
	return {
		sourceComponentId: sourceComponentIdValue,
		propertyName,
		value,
	};
}

function parseJsonRecord(source: string): JsonRecord | null {
	try {
		const parsed: unknown = JSON.parse(source);
		return isJsonRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function stringField(record: JsonRecord, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function requiredStringField(record: JsonRecord, key: string): string {
	const value = stringField(record, key);
	if (value === null) {
		throw new Error(`Circuit JSON element is missing string field ${key}`);
	}
	return value;
}

function numericField(record: JsonRecord, key: string): number | null {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pointField(record: JsonRecord, key: string): Point | null {
	const value = record[key];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const pointRecord = checkedRecord(value);
	const x = pointRecord.x;
	const y = pointRecord.y;
	return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function stringArrayField(record: JsonRecord, key: string): readonly string[] {
	const value = record[key];
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function stripKnownPrefix(value: string, prefix: string): string | null {
	return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function sanitizeId(value: string): string {
	const sanitized = value.replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "");
	return sanitized.length > 0 ? sanitized : "component";
}

function stableJsonStringify(value: unknown): string {
	return JSON.stringify(stableJsonValue(value)) ?? "null";
}

function stableJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableJsonValue);
	}
	if (!isJsonRecord(value)) {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		out[key] = stableJsonValue(value[key]);
	}
	return out;
}

function isPropertyValue(value: unknown): value is PropertyValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.every(isPropertyValue);
	}
	if (!isJsonRecord(value)) {
		return false;
	}
	return Object.values(value).every(isPropertyValue);
}

function isJsonRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function terminalNameFromSourcePortId(sourcePortIdValue: string): string {
	const parsed = parseSourcePortId(sourcePortIdValue);
	return parsed?.terminalName ?? sanitizeId(sourcePortIdValue);
}

function groupPortsByComponent(
	sourcePorts: ReadonlyMap<string, SourcePortRecord>,
): ReadonlyMap<string, readonly SourcePortRecord[]> {
	const map = new Map<string, SourcePortRecord[]>();
	for (const port of sourcePorts.values()) {
		const existing = map.get(port.componentSourceId);
		if (existing === undefined) {
			map.set(port.componentSourceId, [port]);
			continue;
		}
		existing.push(port);
	}
	return map;
}

function buildComponentFromCircuitJson(
	sourceComponent: SourceComponentRecord,
	ports: readonly SourcePortRecord[],
	schematicComponents: ReadonlyMap<string, SchematicComponentRecord>,
	schematicPorts: ReadonlyMap<string, SchematicPortRecord>,
	sourceGroups: ReadonlyMap<string, SourceGroupRecord>,
	sidecars: readonly SourcePropertySidecar[],
	index: number,
): MutableComponentBuild & { readonly component: Component } {
	const origin =
		schematicComponents.get(sourceComponent.sourceComponentId)?.center ??
		synthesizedOrigin(index);
	const terminals = ports.map((port, portIndex) => ({
		name: port.terminalName,
		position:
			schematicPorts.get(port.sourcePortId)?.center ??
			synthesizedTerminalPosition(origin, ports.length, portIndex),
	}));
	const sidecarProperties = propertiesFromSidecars(sidecars);
	const groupedProperties = canCapPropertiesFromSourceGroup(
		sourceComponent,
		sourceGroups,
		sidecarProperties,
	);
	const component: Component = {
		id: sourceComponent.componentId,
		kind: kindFromCircuitJsonFtype(sourceComponent.ftype),
		name: sourceComponent.name,
		origin,
		rotation: 0,
		flipped: false,
		terminals,
		properties: {
			...propertiesFromCircuitJsonComponent(sourceComponent.record),
			...sidecarProperties,
			...groupedProperties,
		},
		sourceTypeName:
			sourceComponent.ftype === null
				? "circuit-json:source_component"
				: `circuit-json:${sourceComponent.ftype}`,
	};
	return { sourceComponent, ports, origin, terminals, component };
}

function propertiesFromSidecars(
	sidecars: readonly SourcePropertySidecar[],
): Readonly<Record<string, PropertyValue>> {
	const properties: Record<string, PropertyValue> = {};
	for (const sidecar of sidecars) {
		properties[sidecar.propertyName] = sidecar.value;
	}
	return properties;
}

function canCapPropertiesFromSourceGroup(
	sourceComponent: SourceComponentRecord,
	sourceGroups: ReadonlyMap<string, SourceGroupRecord>,
	sidecarProperties: Readonly<Record<string, PropertyValue>>,
): Readonly<Record<string, PropertyValue>> {
	const sourceGroupId = sourceComponent.sourceGroupId;
	if (sourceGroupId === null) {
		return {};
	}
	if (kindFromCircuitJsonFtype(sourceComponent.ftype) !== "capacitor") {
		return {};
	}

	const discriminatorGroupId = canCapGroupIdFromSourceGroupId(sourceGroupId);
	const hasCanCapSection = sidecarProperties.CanCapSection !== undefined;
	if (discriminatorGroupId === null && !hasCanCapSection) {
		return {};
	}

	const group = sourceGroups.get(sourceGroupId);
	const fallbackGroupId =
		stripKnownPrefix(sourceGroupId, "source_group:") ?? sourceGroupId;
	const canCapGroupId = discriminatorGroupId ?? fallbackGroupId;
	return {
		CanCapGroupId: canCapGroupId,
		...(group?.name === null || group?.name === undefined
			? {}
			: { CanCapPackageName: group.name }),
	};
}

function synthesizedOrigin(index: number): Point {
	const column = index % 4;
	const row = Math.floor(index / 4);
	return { x: column * 80, y: row * 60 };
}

function synthesizedTerminalPosition(
	origin: Point,
	terminalCount: number,
	index: number,
): Point {
	if (terminalCount <= 1) {
		return origin;
	}
	if (terminalCount === 2) {
		return index === 0
			? { x: origin.x - 20, y: origin.y }
			: { x: origin.x + 20, y: origin.y };
	}
	const step = terminalCount === 1 ? 0 : 40 / (terminalCount - 1);
	return { x: origin.x - 20, y: origin.y - 20 + step * index };
}

function kindFromCircuitJsonFtype(ftype: string | null): ComponentKind {
	switch (ftype) {
		case "simple_resistor":
			return "resistor";
		case "simple_capacitor":
			return "capacitor";
		case "simple_inductor":
			return "inductor";
		case "simple_diode":
			return "diode";
		case "simple_led":
			return "led";
		case "simple_transistor":
			return "bjt";
		case "simple_mosfet":
			return "mosfet";
		case "simple_op_amp":
			return "opamp";
		case "simple_potentiometer":
			return "potentiometer";
		case "simple_switch":
		case "simple_push_button":
			return "switch";
		case "simple_voltage_source":
			return "voltage-source";
		case "simple_current_source":
			return "current-source";
		case "simple_battery":
			return "battery";
		case "simple_ground":
			return "ground";
		case "simple_power_source":
			return "rail";
		case "simple_connector":
			return "jack";
		case "simple_test_point":
			return "port";
		case "simple_chip":
			return "ic";
		default:
			return "unsupported";
	}
}

function propertiesFromCircuitJsonComponent(
	record: JsonRecord,
): Readonly<Record<string, PropertyValue>> {
	const properties: Record<string, PropertyValue> = {};
	const ftype = stringField(record, "ftype");
	const displayValue = stringField(record, "display_value");
	if (displayValue !== null) {
		properties.Value = displayValue;
	}
	const manufacturerPartNumber = stringField(
		record,
		"manufacturer_part_number",
	);
	if (manufacturerPartNumber !== null) {
		properties.manufacturerPartNumber = manufacturerPartNumber;
	}
	addQuantityProperty(
		properties,
		"R",
		record,
		"display_resistance",
		"resistance",
	);
	addQuantityProperty(
		properties,
		"C",
		record,
		"display_capacitance",
		"capacitance",
	);
	addQuantityProperty(
		properties,
		"L",
		record,
		"display_inductance",
		"inductance",
	);
	addQuantityProperty(properties, "V", record, null, "voltage");
	addQuantityProperty(properties, "I", record, null, "current");
	addQuantityProperty(
		properties,
		"Resistance",
		record,
		"display_max_resistance",
		"max_resistance",
	);
	if (ftype !== null) {
		properties.ftype = ftype;
	}
	return properties;
}

function addQuantityProperty(
	properties: Record<string, PropertyValue>,
	propertyName: string,
	record: JsonRecord,
	displayKey: string | null,
	numericKey: string,
): void {
	const display = displayKey === null ? null : stringField(record, displayKey);
	if (display !== null) {
		properties[propertyName] = parseQuantity(display) ?? display;
		return;
	}
	const numeric = numericField(record, numericKey);
	if (numeric !== null) {
		properties[propertyName] = numeric;
	}
}

function terminalPositionMap(
	builds: readonly (MutableComponentBuild & {
		readonly component: Component;
	})[],
): ReadonlyMap<string, Point> {
	const map = new Map<string, Point>();
	for (const build of builds) {
		for (const port of build.ports) {
			const terminal = build.component.terminals.find(
				(candidate) => candidate.name === port.terminalName,
			);
			if (terminal !== undefined) {
				map.set(port.sourcePortId, terminal.position);
			}
		}
	}
	return map;
}

function wireElementsFromSourceTraces(
	sourceTraces: readonly JsonRecord[],
	terminalPositions: ReadonlyMap<string, Point>,
): readonly Wire[] {
	const wires: Wire[] = [];
	for (const trace of sourceTraces) {
		const ports = stringArrayField(trace, "connected_source_port_ids");
		if (ports.length < 2) {
			continue;
		}
		const firstPort = ports[0];
		const firstPosition =
			firstPort === undefined ? undefined : terminalPositions.get(firstPort);
		if (firstPosition === undefined) {
			continue;
		}
		for (const port of ports.slice(1)) {
			const position = terminalPositions.get(port);
			if (position === undefined) {
				continue;
			}
			wires.push({
				id: `wire-${wires.length + 1}`,
				endpoints: [firstPosition, position],
			});
		}
	}
	return wires;
}

function warningsForUnconnectedNets(
	sourceNets: ReadonlyMap<string, JsonRecord>,
	sourceTraces: readonly JsonRecord[],
): readonly Warning[] {
	const referencedNetIds = new Set<string>();
	for (const trace of sourceTraces) {
		for (const netId of stringArrayField(trace, "connected_source_net_ids")) {
			referencedNetIds.add(netId);
		}
	}
	const warnings: Warning[] = [];
	for (const [netId, net] of sourceNets) {
		if (!referencedNetIds.has(netId)) {
			warnings.push({
				code: "circuit-json-net-unconnected",
				message: `${stringField(net, "name") ?? netId}: Circuit JSON source net is not referenced by a source trace`,
			});
		}
	}
	return warnings;
}

function filenameWithoutCircuitJsonExtension(filename: string): string {
	return filename
		.replace(/\.circuit\.json$/i, "")
		.replace(/\.json$/i, "")
		.replace(/[-_]+/g, " ")
		.trim();
}

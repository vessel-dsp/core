import {
	getPinNode,
	resolveConnectivity,
	type Connectivity,
} from "../../model/connectivity";
import { isParsedQuantity, isPropertyObject } from "../../model/properties";
import type {
	CircuitDocument,
	CircuitDocumentDevice,
	DocumentAppearance,
	Component,
	ControlApplicabilityPredicate,
	ControlContext,
	ControlGroup,
	ControlGroupMember,
	DeviceInterface,
	DeviceInterfaceBinding,
	DeviceInterfaceControl,
	ControlInterface,
	ControlInterfaceBinding,
	ControlOutput,
	DocumentSource,
	PanelElementBinding,
	PanelElementPhysicalPlacement,
	PanelElementPlacement,
	PanelFace,
	PanelFaceGeometry,
	PanelGridLayout,
	PanelGridPosition,
	PanelPlacementMetadata,
	Point,
	PropertyValue,
	Terminal,
	VdspBuildDataObject,
	VdspBuildDataScalar,
	VdspBuildDataValue,
	Warning,
	Wire,
} from "../../model/types";

export type InterchangeSourceFormat = string;

export type SerializeInterchangeYamlOptions = Readonly<{
	filename?: string;
	source?: DocumentSource | null;
	sourceFormat?: InterchangeSourceFormat | null;
}>;

type YamlScalar = string | number | boolean | null;
type YamlValue =
	| YamlScalar
	| readonly YamlValue[]
	| { readonly [key: string]: YamlValue };
type MutableYamlObject = Record<string, YamlValue>;

export function serializeInterchangeYaml(
	doc: CircuitDocument,
	options: SerializeInterchangeYamlOptions = {},
): string {
	const connectivity = resolveConnectivity(doc);
	const schema = hasV3OnlyFields(doc)
		? "circuit-interchange/v3"
		: "circuit-interchange/v2";
	const root: MutableYamlObject = {
		schema,
		metadata: {
			name: doc.metadata.name,
			description: doc.metadata.description,
			partNumber: doc.metadata.partNumber,
		},
		source: sourceBlock(doc.source, options),
	};
	if (doc.device !== undefined) {
		root.device = deviceBlock(doc.device);
	}
	if (doc.appearance !== undefined) {
		root.appearance = appearanceBlock(doc.appearance);
	}
	if (doc.controlGroups !== undefined) {
		root.controlGroups = doc.controlGroups.map(controlGroupBlock);
	}
	if (doc.controlContexts !== undefined) {
		root.controlContexts = doc.controlContexts.map(controlContextBlock);
	}
	if (doc.mechanical !== undefined) {
		root.mechanical = buildDataObjectBlock(doc.mechanical);
	}
	if (doc.build !== undefined) {
		root.build = buildDataObjectBlock(doc.build);
	}
	if (doc.bom !== undefined) {
		root.bom = buildDataObjectBlock(doc.bom);
	}
	if (doc.partProfiles !== undefined) {
		root.partProfiles = buildDataObjectBlock(doc.partProfiles);
	}
	if (doc.footprints !== undefined) {
		root.footprints = buildDataObjectBlock(doc.footprints);
	}
	if (doc.deviceInterface !== undefined) {
		root.deviceInterface = deviceInterfaceBlock(doc.deviceInterface);
	}
	if (doc.panel !== undefined) {
		root.panel = panelBlock(doc.panel);
	}
	if (doc.controlInterfaces !== undefined) {
		root.controlInterfaces = doc.controlInterfaces.map(controlInterfaceBlock);
	}
	if (doc.controlOutputs !== undefined) {
		root.controlOutputs = doc.controlOutputs.map(controlOutputBlock);
	}
	if (doc.offBoardWiring !== undefined) {
		root.offBoardWiring = buildDataObjectBlock(doc.offBoardWiring);
	}
	Object.assign(root, {
		components: doc.components.map((component) =>
			componentBlock(component, connectivity),
		),
		nodes: nodeBlocks(connectivity),
		wires: doc.wires.map(wireBlock),
		directives: doc.directives,
		diagnostics: doc.warnings.map(warningBlock),
		rawAttributes: doc.rawAttributes,
	});
	if (doc.boards !== undefined) {
		root.boards = doc.boards.map(buildDataObjectBlock);
	}

	return `${emitYaml(root, 0)}\n`;
}

function hasV3OnlyFields(doc: CircuitDocument): boolean {
	return (
		doc.mechanical !== undefined ||
		doc.appearance !== undefined ||
		doc.build !== undefined ||
		doc.bom !== undefined ||
		doc.partProfiles !== undefined ||
		doc.footprints !== undefined ||
		doc.offBoardWiring !== undefined ||
		doc.boards !== undefined ||
		hasV3PanelFields(doc.panel)
	);
}

function hasV3PanelFields(panel: PanelPlacementMetadata | undefined): boolean {
	return (
		panel?.faces.some(
			(face) =>
				face.geometry !== undefined ||
				face.elements.some(
					(element) =>
						element.id !== undefined ||
						element.physical !== undefined ||
						element.kind === "selector" ||
						element.kind === "footswitch",
				),
		) ?? false
	);
}

function appearanceBlock(appearance: DocumentAppearance): MutableYamlObject {
	return buildDataObjectBlock(appearance);
}

function deviceBlock(device: CircuitDocumentDevice): MutableYamlObject {
	const out: MutableYamlObject = {
		kind: device.kind,
	};
	if (device.id !== undefined) {
		out.id = device.id;
	}
	if (device.version !== undefined) {
		out.version = device.version;
	}
	if (device.family !== undefined) {
		out.family = device.family;
	}
	if (device.model !== undefined) {
		out.model = device.model;
	}
	if (device.audioProcessing !== undefined) {
		out.audioProcessing = device.audioProcessing;
	}
	return out;
}

function controlGroupBlock(group: ControlGroup): MutableYamlObject {
	const out: MutableYamlObject = {
		id: group.id,
		name: group.name,
		role: group.role,
	};
	if (group.contextIds !== undefined) {
		out.contextIds = group.contextIds;
	}
	if (group.members !== undefined) {
		out.members = group.members.map(controlGroupMemberBlock);
	}
	if (group.description !== undefined) {
		out.description = group.description;
	}
	return out;
}

function controlGroupMemberBlock(
	member: ControlGroupMember,
): MutableYamlObject {
	const out: MutableYamlObject = {
		controlId: member.controlId,
	};
	if (member.order !== undefined) {
		out.order = member.order;
	}
	if (member.appliesWhen !== undefined) {
		out.appliesWhen = controlApplicabilityPredicateBlock(member.appliesWhen);
	}
	if (member.description !== undefined) {
		out.description = member.description;
	}
	return out;
}

function controlContextBlock(context: ControlContext): MutableYamlObject {
	const out: MutableYamlObject = {
		id: context.id,
		name: context.name,
		role: context.role,
	};
	if (context.description !== undefined) {
		out.description = context.description;
	}
	return out;
}

function deviceInterfaceBlock(
	deviceInterface: DeviceInterface,
): MutableYamlObject {
	return {
		controls: deviceInterface.controls.map(deviceInterfaceControlBlock),
	};
}

function deviceInterfaceControlBlock(
	control: DeviceInterfaceControl,
): MutableYamlObject {
	const out: MutableYamlObject = {
		id: control.id,
		label: control.label,
		kind: control.kind,
		role: control.role,
	};
	if (control.groupId !== undefined) {
		out.groupId = control.groupId;
	}
	if (control.order !== undefined) {
		out.order = control.order;
	}
	if (control.audioBinding !== undefined) {
		out.audioBinding = deviceInterfaceAudioBindingBlock(control.audioBinding);
	}
	if (control.binding !== undefined) {
		out.binding = deviceInterfaceBindingBlock(control.binding);
	}
	if (control.appliesWhen !== undefined) {
		out.appliesWhen = controlApplicabilityPredicateBlock(control.appliesWhen);
	}
	if (control.description !== undefined) {
		out.description = control.description;
	}
	return out;
}

function deviceInterfaceAudioBindingBlock(
	binding: NonNullable<DeviceInterfaceControl["audioBinding"]>,
): MutableYamlObject {
	return {
		kind: binding.kind,
		controlName: binding.controlName,
	};
}

function deviceInterfaceBindingBlock(
	binding: DeviceInterfaceBinding,
): MutableYamlObject {
	const out: MutableYamlObject = {
		componentId: binding.componentId,
	};
	if (binding.controlId !== undefined) {
		out.controlId = binding.controlId;
	}
	if (binding.controlName !== undefined) {
		out.controlName = binding.controlName;
	}
	if (binding.property !== undefined) {
		out.property = binding.property;
	}
	if (binding.externalInterfaceId !== undefined) {
		out.externalInterfaceId = binding.externalInterfaceId;
	}
	return out;
}

function controlApplicabilityPredicateBlock(
	predicate: ControlApplicabilityPredicate,
): MutableYamlObject {
	const out: MutableYamlObject = {};
	if (predicate.allOf !== undefined) {
		out.allOf = predicate.allOf;
	}
	if (predicate.anyOf !== undefined) {
		out.anyOf = predicate.anyOf;
	}
	return out;
}

function controlInterfaceBlock(
	controlInterface: ControlInterface,
): MutableYamlObject {
	const out: MutableYamlObject = {
		id: controlInterface.id,
		name: controlInterface.name,
		role: controlInterface.role,
	};
	if (controlInterface.componentId !== undefined) {
		out.componentId = controlInterface.componentId;
	}
	if (controlInterface.controlRole !== undefined) {
		out.controlRole = controlInterface.controlRole;
	}
	if (controlInterface.interface !== undefined) {
		out.interface = controlInterface.interface;
	}
	if (controlInterface.connector !== undefined) {
		out.connector = controlInterface.connector;
	}
	if (controlInterface.assignmentHint !== undefined) {
		out.assignmentHint = controlInterface.assignmentHint;
	}
	if (controlInterface.polarity !== undefined) {
		out.polarity = controlInterface.polarity;
	}
	if (controlInterface.binding !== undefined) {
		out.binding = controlInterfaceBindingBlock(controlInterface.binding);
	}
	if (controlInterface.description !== undefined) {
		out.description = controlInterface.description;
	}
	return out;
}

function controlOutputBlock(controlOutput: ControlOutput): MutableYamlObject {
	const out: MutableYamlObject = {
		id: controlOutput.id,
		name: controlOutput.name,
		role: controlOutput.role,
	};
	if (controlOutput.connector !== undefined) {
		out.connector = controlOutput.connector;
	}
	if (controlOutput.switchMode !== undefined) {
		out.switchMode = controlOutput.switchMode;
	}
	if (controlOutput.polarity !== undefined) {
		out.polarity = controlOutput.polarity;
	}
	if (controlOutput.inactiveValue !== undefined) {
		out.inactiveValue = controlOutput.inactiveValue;
	}
	if (controlOutput.activeValue !== undefined) {
		out.activeValue = controlOutput.activeValue;
	}
	if (controlOutput.componentId !== undefined) {
		out.componentId = controlOutput.componentId;
	}
	if (controlOutput.description !== undefined) {
		out.description = controlOutput.description;
	}
	return out;
}

function controlInterfaceBindingBlock(
	binding: ControlInterfaceBinding,
): MutableYamlObject {
	const out: MutableYamlObject = {};
	if (binding.sourceComponentId !== undefined) {
		out.sourceComponentId = binding.sourceComponentId;
	}
	if (binding.controlId !== undefined) {
		out.controlId = binding.controlId;
	}
	if (binding.controlName !== undefined) {
		out.controlName = binding.controlName;
	}
	if (binding.property !== undefined) {
		out.property = binding.property;
	}
	return out;
}

function sourceBlock(
	documentSource: DocumentSource | undefined,
	options: SerializeInterchangeYamlOptions,
): MutableYamlObject {
	const source: MutableYamlObject = {};
	for (const [key, value] of Object.entries(documentSource ?? {})) {
		source[key] = value;
	}
	for (const [key, value] of Object.entries(options.source ?? {})) {
		source[key] = value;
	}
	if (options.sourceFormat !== undefined && options.sourceFormat !== null) {
		source.format = options.sourceFormat;
	}
	if (options.sourceFormat === null) {
		delete source.format;
	}
	if (options.filename !== undefined && options.filename.length > 0) {
		source.filename = options.filename;
	}
	return source;
}

function panelBlock(panel: PanelPlacementMetadata): MutableYamlObject {
	return {
		faces: panel.faces.map(panelFaceBlock),
	};
}

function panelFaceBlock(face: PanelFace): MutableYamlObject {
	const out: MutableYamlObject = {
		id: face.id,
	};
	if (face.label !== undefined) {
		out.label = face.label;
	}
	out.layout = panelLayoutBlock(face.layout);
	if (face.geometry !== undefined) {
		out.geometry = panelFaceGeometryBlock(face.geometry);
	}
	out.elements = face.elements.map(panelElementBlock);
	return out;
}

function panelLayoutBlock(layout: PanelGridLayout): MutableYamlObject {
	const out: MutableYamlObject = {
		kind: layout.kind,
		rows: layout.rows,
		columns: layout.columns,
		indexing: layout.indexing,
	};
	if (layout.rowOrder !== undefined) {
		out.rowOrder = layout.rowOrder;
	}
	if (layout.columnOrder !== undefined) {
		out.columnOrder = layout.columnOrder;
	}
	return out;
}

function panelElementBlock(element: PanelElementPlacement): MutableYamlObject {
	const out: MutableYamlObject = {
		bind: panelElementBindingBlock(element.bind),
		kind: element.kind,
		grid: panelGridPositionBlock(element.grid),
	};
	if (element.id !== undefined) {
		out.id = element.id;
	}
	if (element.label !== undefined) {
		out.label = element.label;
	}
	if (element.interfaceControlId !== undefined) {
		out.interfaceControlId = element.interfaceControlId;
	}
	if (element.physical !== undefined) {
		out.physical = panelElementPhysicalBlock(element.physical);
	}
	return out;
}

function panelFaceGeometryBlock(
	geometry: PanelFaceGeometry,
): MutableYamlObject {
	return buildDataObjectBlock(geometry);
}

function panelElementPhysicalBlock(
	physical: PanelElementPhysicalPlacement,
): MutableYamlObject {
	return buildDataObjectBlock(physical);
}

function panelElementBindingBlock(
	binding: PanelElementBinding,
): MutableYamlObject {
	const out: MutableYamlObject = {
		componentId: binding.componentId,
	};
	if (binding.controlId !== undefined) {
		out.controlId = binding.controlId;
	}
	if (binding.controlName !== undefined) {
		out.controlName = binding.controlName;
	}
	if (binding.property !== undefined) {
		out.property = binding.property;
	}
	return out;
}

function panelGridPositionBlock(grid: PanelGridPosition): MutableYamlObject {
	const out: MutableYamlObject = {
		row: grid.row,
		column: grid.column,
	};
	if (grid.rowSpan !== undefined) {
		out.rowSpan = grid.rowSpan;
	}
	if (grid.columnSpan !== undefined) {
		out.columnSpan = grid.columnSpan;
	}
	return out;
}

function componentBlock(
	component: Component,
	connectivity: Connectivity,
): MutableYamlObject {
	return {
		id: component.id,
		kind: component.kind,
		name: component.name,
		sourceTypeName: component.sourceTypeName,
		origin: pointBlock(component.origin),
		rotation: component.rotation,
		flipped: component.flipped,
		terminals: component.terminals.map((terminal) =>
			terminalBlock(component, terminal, connectivity),
		),
		properties: propertiesBlock(component.properties),
	};
}

function terminalBlock(
	component: Component,
	terminal: Terminal,
	connectivity: Connectivity,
): MutableYamlObject {
	return {
		name: terminal.name,
		node:
			getPinNode(connectivity, {
				componentId: component.id,
				terminalName: terminal.name,
			}) ?? null,
		position: pointBlock(terminal.position),
	};
}

function propertiesBlock(
	properties: Readonly<Record<string, PropertyValue>>,
): MutableYamlObject {
	const out: MutableYamlObject = {};
	for (const [key, value] of Object.entries(properties)) {
		out[key] = propertyValueBlock(value);
	}
	return out;
}

function propertyValueBlock(value: PropertyValue): YamlValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(propertyValueBlock);
	}
	if (isPropertyObject(value)) {
		return propertiesBlock(value);
	}
	if (!isParsedQuantity(value)) {
		return null;
	}
	return {
		raw: value.raw,
		value: value.value,
		unit: value.unit,
	};
}

function nodeBlocks(connectivity: Connectivity): readonly MutableYamlObject[] {
	return Array.from(connectivity.nodeMembers.entries())
		.sort(([a], [b]) => a - b)
		.map(([id, members]) => ({
			id,
			role: id === connectivity.groundNodeId ? "ground" : "signal",
			members: members.map((member) => ({
				componentId: member.componentId,
				terminalName: member.terminalName,
			})),
		}));
}

function wireBlock(wire: Wire): MutableYamlObject {
	return {
		id: wire.id,
		points: wire.endpoints.map(pointBlock),
	};
}

function warningBlock(warning: Warning): MutableYamlObject {
	const out: MutableYamlObject = {
		code: warning.code,
		message: warning.message,
	};
	if (warning.componentId !== undefined) {
		out.componentId = warning.componentId;
	}
	if (warning.wireId !== undefined) {
		out.wireId = warning.wireId;
	}
	return out;
}

function pointBlock(point: Point): MutableYamlObject {
	return {
		x: point.x,
		y: point.y,
	};
}

function buildDataObjectBlock(value: VdspBuildDataObject): MutableYamlObject {
	const out: MutableYamlObject = {};
	for (const [key, child] of Object.entries(value)) {
		if (child !== undefined) {
			out[key] = buildDataValueBlock(child);
		}
	}
	return out;
}

function buildDataValueBlock(value: VdspBuildDataValue): YamlValue {
	if (isBuildDataScalar(value)) {
		return value;
	}
	if (isBuildDataArray(value)) {
		return value.map(buildDataValueBlock);
	}
	return buildDataObjectBlock(value);
}

function emitYaml(value: YamlValue, indent: number): string {
	if (isScalar(value)) {
		return `${spaces(indent)}${formatScalar(value)}`;
	}
	if (isYamlArray(value)) {
		return emitArray(value, indent);
	}
	return emitObject(value, indent);
}

function emitObject(
	value: { readonly [key: string]: YamlValue },
	indent: number,
): string {
	const entries = Object.entries(value);
	if (entries.length === 0) {
		return `${spaces(indent)}{}`;
	}

	const lines: string[] = [];
	for (const [key, child] of entries) {
		if (isScalar(child)) {
			lines.push(`${spaces(indent)}${formatKey(key)}: ${formatScalar(child)}`);
			continue;
		}
		if (isYamlArray(child)) {
			if (child.length === 0) {
				lines.push(`${spaces(indent)}${formatKey(key)}: []`);
			} else {
				lines.push(`${spaces(indent)}${formatKey(key)}:`);
				lines.push(emitArray(child, indent + 2));
			}
			continue;
		}
		const nestedEntries = Object.entries(child);
		if (nestedEntries.length === 0) {
			lines.push(`${spaces(indent)}${formatKey(key)}: {}`);
		} else {
			lines.push(`${spaces(indent)}${formatKey(key)}:`);
			lines.push(emitObject(child, indent + 2));
		}
	}
	return lines.join("\n");
}

function emitArray(value: readonly YamlValue[], indent: number): string {
	if (value.length === 0) {
		return `${spaces(indent)}[]`;
	}

	const lines: string[] = [];
	for (const item of value) {
		if (isScalar(item)) {
			lines.push(`${spaces(indent)}- ${formatScalar(item)}`);
			continue;
		}
		if (isYamlArray(item)) {
			lines.push(`${spaces(indent)}-`);
			lines.push(emitArray(item, indent + 2));
			continue;
		}
		const rendered = emitObject(item, indent + 2).split("\n");
		const first = rendered[0];
		if (first === undefined) {
			lines.push(`${spaces(indent)}- {}`);
			continue;
		}
		lines.push(`${spaces(indent)}- ${first.trimStart()}`);
		for (const line of rendered.slice(1)) {
			lines.push(line);
		}
	}
	return lines.join("\n");
}

function isScalar(value: YamlValue): value is YamlScalar {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function isYamlArray(value: YamlValue): value is readonly YamlValue[] {
	return Array.isArray(value);
}

function isBuildDataScalar(
	value: VdspBuildDataValue,
): value is VdspBuildDataScalar {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function isBuildDataArray(
	value: VdspBuildDataValue,
): value is readonly VdspBuildDataValue[] {
	return Array.isArray(value);
}

function formatKey(key: string): string {
	return isPlainScalar(key) ? key : JSON.stringify(key);
}

function formatScalar(value: YamlScalar): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (
		isPlainScalar(value) &&
		!isReservedScalar(value) &&
		!looksLikeNumber(value)
	) {
		return value;
	}
	return JSON.stringify(value);
}

function isPlainScalar(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_./\-]*$/.test(value);
}

function isReservedScalar(value: string): boolean {
	const lower = value.toLowerCase();
	return lower === "null" || lower === "true" || lower === "false";
}

function looksLikeNumber(value: string): boolean {
	// Quote values that look like bare numbers (would be parsed as numbers by YAML)
	// This includes scientific notation like "1e-12", "1.0e-7"
	// But NOT version strings like "v1" or "1.0" that are meant to be strings
	return /^-?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

function spaces(count: number): string {
	return " ".repeat(count);
}

import {
	type Connectivity,
	type NodeId,
	type PinRef,
	pinKey,
	resolveConnectivity,
} from "../../model/connectivity";
import { isParsedQuantity } from "../../model/properties";
import { resolvePotentiometerTerminalRoles } from "../../model/terminal-roles";
import { classifySourceTypeName } from "./source-type-names";
import type {
	BoardApplicability,
	BoardEdgeTerminal,
	BoardFamily,
	BoardFootprint,
	BoardFootprintCatalog,
	BoardFootprintPlacement,
	BoardKind,
	BoardNet,
	BoardNetlist,
	BoardNetMember,
	BoardPlacedPad,
	BoardRealization,
	BoardRoute,
	BoardSourceCircuitHash,
	BoardSubtype,
	BuildBom,
	BuildBomItem,
	BuildBomRef,
	BuildCompleteness,
	BuildIntent,
	BuildPartProfile,
	BuildPartProfileCatalog,
	BuildScope,
	CircuitDocument,
	CircuitDocumentDevice,
	CircuitDocumentDeviceKind,
	CircuitPower,
	CircuitPowerCoverage,
	CircuitPowerDomain,
	CircuitPowerGroundPolarity,
	CircuitPowerRailBinding,
	CircuitPowerRailDerivation,
	CircuitPowerRailRole,
	CircuitPowerSourceKind,
	Component,
	ComponentKind,
	ComponentTerminalRef,
	ControlApplicabilityPredicate,
	ControlContext,
	ControlGroup,
	ControlGroupMember,
	ControlInterface,
	ControlInterfaceAssignmentHint,
	ControlInterfaceConnector,
	ControlInterfacePolarity,
	ControlInterfaceRole,
	ControlOutput,
	ControlOutputSwitchMode,
	DeviceInterface,
	DeviceInterfaceAudioBinding,
	DeviceInterfaceBinding,
	DeviceInterfaceControlKind,
	DocumentAppearance,
	DocumentSource,
	MechanicalBuildMetadata,
	OffBoardWiringConnection,
	OffBoardWiringCoverage,
	OffBoardWiringEndpoint,
	OffBoardWiringHarness,
	OffBoardWiringHarnessStatus,
	OffBoardWiringPlan,
	PanelColumnOrder,
	PanelControlKind,
	PanelElementBinding,
	PanelElementPhysicalPlacement,
	PanelFaceGeometry,
	PanelGridIndexing,
	PanelGridLayout,
	PanelGridPosition,
	PanelPlacementMetadata,
	PanelRowOrder,
	ParsedQuantity,
	Point,
	ProfileResponseRef,
	PropertyValue,
	Rotation,
	SimulationProfile,
	SimulationProfileCatalog,
	Terminal,
	VdspBuildDataObject,
	VdspBuildDataValue,
	Warning,
	Wire,
} from "../../model/types";

type YamlScalar = string | number | boolean | null;
type YamlValue = YamlScalar | readonly YamlValue[] | YamlObject;
type YamlObject = { [key: string]: YamlValue };

type YamlLine = Readonly<{
	indent: number;
	text: string;
	lineNumber: number;
}>;

type Cursor = {
	index: number;
};

type ParsedPair = Readonly<{
	key: string;
	rest: string;
}>;

const INTERCHANGE_SCHEMA_V2 = "circuit-interchange/v2";
const INTERCHANGE_SCHEMA_V3 = "circuit-interchange/v3";
const V3_ONLY_TOP_LEVEL_FIELDS = [
	"mechanical",
	"appearance",
	"build",
	"bom",
	"partProfiles",
	"simulationProfiles",
	"footprints",
	"offBoardWiring",
	"boards",
	"power",
] as const;

export type InterchangeTopologyParseResult = Readonly<{
	document: CircuitDocument;
	connectivity: Connectivity;
	nodeRoles: ReadonlyMap<NodeId, string>;
	connectivitySource: "declared" | "geometric";
}>;

export function parseInterchangeYaml(source: string): CircuitDocument {
	const value = parseYamlSubset(source);
	const root = expectObject(value, "root");
	const schema = expectString(root.schema, "schema");
	if (schema !== INTERCHANGE_SCHEMA_V2 && schema !== INTERCHANGE_SCHEMA_V3) {
		throw new Error(`unsupported interchange schema: ${schema}`);
	}
	const isV3 = schema === INTERCHANGE_SCHEMA_V3;
	if (!isV3) {
		rejectV3OnlyTopLevelFields(root);
	}

	const panel = parsePanel(root.panel, isV3);
	const appearance = isV3 ? parseAppearance(root.appearance) : undefined;
	const controlInterfaces = parseControlInterfaces(root.controlInterfaces);
	const device = parseDevice(root.device);
	const controlOutputs = parseControlOutputs(root.controlOutputs);
	const controlGroups = parseControlGroups(root.controlGroups);
	const controlContexts = parseControlContexts(root.controlContexts);
	const deviceInterface = parseDeviceInterface(root.deviceInterface);
	// Collected while parsing components, then merged with the document's own
	// `diagnostics` block. Built before the literal below so the result does not
	// depend on object-key evaluation order.
	const componentWarnings: Warning[] = [];
	const components = parseComponents(root.components, componentWarnings);
	const mechanical = isV3 ? parseMechanical(root.mechanical) : undefined;
	const build = isV3 ? parseBuild(root.build) : undefined;
	const bom = isV3 ? parseBom(root.bom) : undefined;
	const partProfiles = isV3 ? parsePartProfiles(root.partProfiles) : undefined;
	const simulationProfiles = isV3
		? parseSimulationProfiles(root.simulationProfiles)
		: undefined;
	const footprints = isV3 ? parseFootprints(root.footprints) : undefined;
	const offBoardWiring = isV3
		? parseOffBoardWiring(root.offBoardWiring)
		: undefined;
	const boards = isV3 ? parseBoards(root.boards) : undefined;
	const power = isV3 ? parsePower(root.power) : undefined;

	return {
		metadata: parseMetadata(root.metadata),
		source: parseSource(root.source),
		...(device === undefined ? {} : { device }),
		...(appearance === undefined ? {} : { appearance }),
		...(controlGroups === undefined ? {} : { controlGroups }),
		...(controlContexts === undefined ? {} : { controlContexts }),
		...(mechanical === undefined ? {} : { mechanical }),
		...(build === undefined ? {} : { build }),
		...(bom === undefined ? {} : { bom }),
		...(partProfiles === undefined ? {} : { partProfiles }),
		...(simulationProfiles === undefined ? {} : { simulationProfiles }),
		...(footprints === undefined ? {} : { footprints }),
		...(offBoardWiring === undefined ? {} : { offBoardWiring }),
		...(boards === undefined ? {} : { boards }),
		...(power === undefined ? {} : { power }),
		...(deviceInterface === undefined ? {} : { deviceInterface }),
		...(panel === undefined ? {} : { panel }),
		...(controlInterfaces === undefined ? {} : { controlInterfaces }),
		...(controlOutputs === undefined ? {} : { controlOutputs }),
		components,
		wires: parseWires(root.wires),
		directives: parseStringArray(root.directives, "directives"),
		warnings: [...parseWarnings(root.diagnostics), ...componentWarnings],
		rawAttributes: parseStringRecord(root.rawAttributes, "rawAttributes"),
	};
}

/** Parse a document together with source-declared node membership and roles. */
export function parseInterchangeYamlWithTopology(
	source: string,
): InterchangeTopologyParseResult {
	const document = parseInterchangeYaml(source);
	const root = expectObject(parseYamlSubset(source), "root");
	const declared = parseDeclaredTopology(root, document);
	if (declared)
		return { document, ...declared, connectivitySource: "declared" };
	const connectivity = resolveConnectivity(document);
	return {
		document,
		connectivity,
		nodeRoles: new Map(
			[...connectivity.nodeMembers.keys()].map((nodeId) => [
				nodeId,
				nodeId === connectivity.groundNodeId ? "ground" : "signal",
			]),
		),
		connectivitySource: "geometric",
	};
}

type ParsedDeclaredTopology = Readonly<{
	connectivity: Connectivity;
	nodeRoles: ReadonlyMap<NodeId, string>;
}>;

function parseDeclaredTopology(
	root: YamlObject,
	document: CircuitDocument,
): ParsedDeclaredTopology | null {
	const rawComponents = optionalArray(root.components, "components");
	const rawNodes = optionalArray(root.nodes, "nodes");
	const nodeKeys = new Set<string>();
	let declaredTerminalCount = 0;
	for (const [componentIndex, rawComponent] of rawComponents.entries()) {
		const component = expectObject(
			rawComponent,
			`components[${componentIndex}]`,
		);
		for (const [terminalIndex, rawTerminal] of optionalArray(
			component.terminals,
			`components[${componentIndex}].terminals`,
		).entries()) {
			const terminal = expectObject(
				rawTerminal,
				`components[${componentIndex}].terminals[${terminalIndex}]`,
			);
			const key = declaredNodeKey(terminal.node);
			if (key === null) continue;
			nodeKeys.add(key);
			declaredTerminalCount += 1;
		}
	}
	for (const [index, rawNode] of rawNodes.entries()) {
		const node = expectObject(rawNode, `nodes[${index}]`);
		const key = declaredNodeKey(node.id);
		if (key !== null) nodeKeys.add(key);
	}
	if (declaredTerminalCount === 0 && rawNodes.length === 0) return null;

	const nodeIds = declaredNodeIds(nodeKeys);
	const pinToNode = new Map<string, NodeId>();
	const nodeMembers = new Map<NodeId, PinRef[]>(
		[...nodeIds.values()].map((nodeId) => [nodeId, []]),
	);
	const nodeRoles = new Map<NodeId, string>();
	for (const [index, rawNode] of rawNodes.entries()) {
		const node = expectObject(rawNode, `nodes[${index}]`);
		const key = declaredNodeKey(node.id);
		const nodeId = key === null ? undefined : nodeIds.get(key);
		if (nodeId === undefined) continue;
		if (typeof node.role === "string" && node.role.trim()) {
			nodeRoles.set(nodeId, node.role.trim());
		}
	}

	// Inline terminal `node` keys and the `nodes` ledger are complementary
	// declarations of the same connectivity, and serialized documents carry both.
	// Read both so a mixed packet cannot silently drop ledger-only members;
	// `addDeclaredPin` refuses only where the two disagree.
	if (declaredTerminalCount > 0) {
		for (const [componentIndex, rawComponent] of rawComponents.entries()) {
			const component = expectObject(
				rawComponent,
				`components[${componentIndex}]`,
			);
			const componentId = expectString(
				component.id,
				`components[${componentIndex}].id`,
			);
			for (const [terminalIndex, rawTerminal] of optionalArray(
				component.terminals,
				`components[${componentIndex}].terminals`,
			).entries()) {
				const path = `components[${componentIndex}].terminals[${terminalIndex}]`;
				const terminal = expectObject(rawTerminal, path);
				const key = declaredNodeKey(terminal.node);
				const nodeId = key === null ? undefined : nodeIds.get(key);
				if (nodeId === undefined) continue;
				addDeclaredPin(
					pinToNode,
					nodeMembers,
					nodeId,
					{
						componentId,
						terminalName: expectString(terminal.name, `${path}.name`),
					},
					path,
				);
			}
		}
	}
	if (rawNodes.length > 0) {
		parseDeclaredNodeMembers(
			rawNodes,
			document,
			nodeIds,
			pinToNode,
			nodeMembers,
		);
	}

	let groundNodeId: NodeId | null = null;
	for (const [nodeId, role] of nodeRoles) {
		if (role.toLowerCase() === "ground") {
			groundNodeId = nodeId;
			break;
		}
	}
	if (groundNodeId === null) {
		for (const component of document.components) {
			if (component.kind !== "ground") continue;
			const terminal = component.terminals[0];
			if (!terminal) continue;
			const nodeId = pinToNode.get(
				pinKey({ componentId: component.id, terminalName: terminal.name }),
			);
			if (nodeId !== undefined) {
				groundNodeId = nodeId;
				break;
			}
		}
	}
	for (const nodeId of nodeMembers.keys()) {
		if (!nodeRoles.has(nodeId)) {
			nodeRoles.set(nodeId, nodeId === groundNodeId ? "ground" : "signal");
		}
	}
	return {
		connectivity: {
			pinToNode,
			nodeMembers,
			groundNodeId,
			nodeCount: nodeMembers.size,
		},
		nodeRoles,
	};
}

function declaredNodeKey(value: YamlValue | undefined): string | null {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
		return String(value);
	}
	if (typeof value === "string" && value.trim()) return value.trim();
	return null;
}

function declaredNodeIds(
	keys: ReadonlySet<string>,
): ReadonlyMap<string, NodeId> {
	const out = new Map<string, NodeId>();
	const used = new Set<NodeId>();
	for (const key of keys) {
		if (!/^\d+$/.test(key)) continue;
		const nodeId = Number(key);
		if (!Number.isSafeInteger(nodeId)) continue;
		out.set(key, nodeId);
		used.add(nodeId);
	}
	let nextId = 0;
	for (const key of keys) {
		if (out.has(key)) continue;
		while (used.has(nextId)) nextId += 1;
		out.set(key, nextId);
		used.add(nextId);
	}
	return out;
}

function addDeclaredPin(
	pinToNode: Map<string, NodeId>,
	nodeMembers: Map<NodeId, PinRef[]>,
	nodeId: NodeId,
	pin: PinRef,
	path: string,
): void {
	const key = pinKey(pin);
	const previousNode = pinToNode.get(key);
	// Agreement between the inline and ledger declarations is redundant, not
	// ambiguous: record the pin once. Disagreement is unresolvable, so refuse.
	if (previousNode === nodeId) return;
	if (previousNode !== undefined) {
		throw new Error(
			`${path}: pin "${pin.componentId}.${pin.terminalName}" already belongs to node ${previousNode}`,
		);
	}
	pinToNode.set(key, nodeId);
	const members = nodeMembers.get(nodeId);
	if (!members) throw new Error(`${path}: unknown declared node ${nodeId}`);
	members.push(pin);
}

function parseDeclaredNodeMembers(
	rawNodes: readonly YamlValue[],
	document: CircuitDocument,
	nodeIds: ReadonlyMap<string, NodeId>,
	pinToNode: Map<string, NodeId>,
	nodeMembers: Map<NodeId, PinRef[]>,
): void {
	const componentTerminals = new Map(
		document.components.map((component) => [
			component.id,
			new Set(component.terminals.map((terminal) => terminal.name)),
		]),
	);
	const seenNodeKeys = new Set<string>();
	for (const [index, rawNode] of rawNodes.entries()) {
		const path = `nodes[${index}]`;
		const node = expectObject(rawNode, path);
		const key = declaredNodeKey(node.id);
		if (key === null) throw new Error(`${path}.id: expected node identifier`);
		if (seenNodeKeys.has(key))
			throw new Error(`${path}.id: duplicate node id ${key}`);
		seenNodeKeys.add(key);
		const nodeId = nodeIds.get(key);
		if (nodeId === undefined)
			throw new Error(`${path}.id: unknown node identifier`);
		for (const [memberIndex, rawMember] of optionalArray(
			node.members,
			`${path}.members`,
		).entries()) {
			const memberPath = `${path}.members[${memberIndex}]`;
			const member = declaredNodeMemberObject(rawMember, memberPath);
			const componentId = expectString(
				member.componentId,
				`${memberPath}.componentId`,
			);
			const terminalName = expectString(
				member.terminalName,
				`${memberPath}.terminalName`,
			);
			const terminals = componentTerminals.get(componentId);
			if (!terminals) {
				throw new Error(
					`${memberPath}.componentId: unknown component "${componentId}"`,
				);
			}
			if (!terminals.has(terminalName)) {
				throw new Error(
					`${memberPath}.terminalName: unknown terminal "${componentId}.${terminalName}"`,
				);
			}
			addDeclaredPin(
				pinToNode,
				nodeMembers,
				nodeId,
				{ componentId, terminalName },
				memberPath,
			);
		}
	}
}

function declaredNodeMemberObject(value: YamlValue, path: string): YamlObject {
	if (isYamlObject(value) && value.componentId !== undefined) return value;
	let flowText: string | null = typeof value === "string" ? value : null;
	if (isYamlObject(value)) {
		const entries = Object.entries(value);
		const first = entries[0];
		if (entries.length === 1 && first?.[0].trimStart().startsWith("{")) {
			flowText = `${first[0]}: ${scalarText(first[1], path)}`;
		}
	}
	if (!flowText?.trim().startsWith("{") || !flowText.trim().endsWith("}")) {
		return expectObject(value, path);
	}
	const body = flowText.trim().slice(1, -1);
	const out: YamlObject = {};
	for (const field of splitFlowFields(body, path)) {
		const colon = field.indexOf(":");
		if (colon <= 0) throw new Error(`${path}: invalid flow mapping member`);
		const key = field.slice(0, colon).trim();
		const rawValue = field.slice(colon + 1).trim();
		if (!key || !rawValue)
			throw new Error(`${path}: invalid flow mapping member`);
		let parsedValue: string;
		if (rawValue.startsWith('"')) {
			try {
				const parsed: unknown = JSON.parse(rawValue);
				if (typeof parsed !== "string") throw new Error();
				parsedValue = parsed;
			} catch {
				throw new Error(`${path}: invalid quoted flow mapping value`);
			}
		} else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
			parsedValue = rawValue.slice(1, -1).replace(/''/g, "'");
		} else {
			parsedValue = rawValue;
		}
		assignUniqueKey(out, key, parsedValue);
	}
	return out;
}

function splitFlowFields(value: string, path: string): readonly string[] {
	const fields: string[] = [];
	let start = 0;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quote === '"' && char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = quote === null ? char : quote === char ? null : quote;
			continue;
		}
		if (char === "," && quote === null) {
			fields.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}
	if (quote !== null)
		throw new Error(`${path}: unterminated quoted flow mapping`);
	fields.push(value.slice(start).trim());
	return fields.filter(Boolean);
}

function rejectV3OnlyTopLevelFields(root: YamlObject): void {
	for (const field of V3_ONLY_TOP_LEVEL_FIELDS) {
		if (root[field] !== undefined) {
			throw new Error(`${field}: requires schema ${INTERCHANGE_SCHEMA_V3}`);
		}
	}
}

function parseAppearance(
	value: YamlValue | undefined,
): DocumentAppearance | undefined {
	if (value === undefined) {
		return undefined;
	}
	const rawAppearance = expectObject(value, "appearance");
	const appearance = parseBuildDataObject(rawAppearance, "appearance");
	const kind = expectString(rawAppearance.kind, "appearance.kind");
	switch (kind) {
		case "stompbox":
			if (appearance.amp !== undefined) {
				throw new Error(
					"appearance.amp: cannot be present when appearance.kind is stompbox",
				);
			}
			return { ...appearance, kind };
		case "amp":
			if (appearance.stompbox !== undefined) {
				throw new Error(
					"appearance.stompbox: cannot be present when appearance.kind is amp",
				);
			}
			return { ...appearance, kind };
		default:
			throw new Error("appearance.kind: expected stompbox or amp");
	}
}

function parseMechanical(
	value: YamlValue | undefined,
): MechanicalBuildMetadata | undefined {
	if (value === undefined) {
		return undefined;
	}
	const mechanical = expectObject(value, "mechanical");
	return {
		...parseBuildDataObject(mechanical, "mechanical"),
		...(mechanical.schema === undefined
			? {}
			: { schema: expectString(mechanical.schema, "mechanical.schema") }),
		...(mechanical.units === undefined
			? {}
			: { units: expectString(mechanical.units, "mechanical.units") }),
	};
}

function parseBuild(value: YamlValue | undefined): BuildScope | undefined {
	if (value === undefined) {
		return undefined;
	}
	const build = expectObject(value, "build");
	return {
		...parseBuildDataObject(build, "build"),
		schema: parseLiteralString(build.schema, "build.schema", "build-scope/v1"),
		...(build.intent === undefined
			? {}
			: { intent: parseBuildIntent(build.intent, "build.intent") }),
		...(build.completeness === undefined
			? {}
			: {
					completeness: parseBuildCompleteness(
						build.completeness,
						"build.completeness",
					),
				}),
		...(build.selectedBoardId === undefined
			? {}
			: {
					selectedBoardId: expectString(
						build.selectedBoardId,
						"build.selectedBoardId",
					),
				}),
		...(build.selectedOffBoardWiringHarnessIds === undefined
			? {}
			: {
					selectedOffBoardWiringHarnessIds:
						parseOptionalStringArray(
							build.selectedOffBoardWiringHarnessIds,
							"build.selectedOffBoardWiringHarnessIds",
						) ?? [],
				}),
		...(build.alternateBoardIds === undefined
			? {}
			: {
					alternateBoardIds:
						parseOptionalStringArray(
							build.alternateBoardIds,
							"build.alternateBoardIds",
						) ?? [],
				}),
		...(build.bomScope === undefined
			? {}
			: { bomScope: expectString(build.bomScope, "build.bomScope") }),
	};
}

function parseBuildIntent(
	value: YamlValue | undefined,
	path: string,
): BuildIntent {
	const intent = expectString(value, path);
	if (intent === "diy-build-artifact" || intent === "schema-review-sample") {
		return intent;
	}
	throw new Error(
		`${path}: expected diy-build-artifact or schema-review-sample`,
	);
}

function parseBuildCompleteness(
	value: YamlValue | undefined,
	path: string,
): BuildCompleteness {
	const completeness = expectString(value, path);
	if (
		completeness === "complete-selected-build" ||
		completeness === "partial-offboard-wiring"
	) {
		return completeness;
	}
	throw new Error(
		`${path}: expected complete-selected-build or partial-offboard-wiring`,
	);
}

function parseBom(value: YamlValue | undefined): BuildBom | undefined {
	if (value === undefined) {
		return undefined;
	}
	const bom = expectObject(value, "bom");
	return {
		...parseBuildDataObject(bom, "bom"),
		schema: parseLiteralString(bom.schema, "bom.schema", "build-bom/v1"),
		items: optionalArray(bom.items, "bom.items").map(parseBomItem),
	};
}

function parseBomItem(value: YamlValue, index: number): BuildBomItem {
	const path = `bom.items[${index}]`;
	const item = expectObject(value, path);
	return {
		...parseBuildDataObject(item, path),
		id: expectString(item.id, `${path}.id`),
		refs: optionalArray(item.refs, `${path}.refs`).map((ref, refIndex) =>
			parseBomRef(ref, `${path}.refs[${refIndex}]`),
		),
		quantity: expectNumber(item.quantity, `${path}.quantity`),
		...(item.value === undefined
			? {}
			: { value: expectString(item.value, `${path}.value`) }),
		...(item.partProfileId === undefined
			? {}
			: {
					partProfileId: expectString(
						item.partProfileId,
						`${path}.partProfileId`,
					),
				}),
		...(item.category === undefined
			? {}
			: { category: expectString(item.category, `${path}.category`) }),
		...(item.sku === undefined
			? {}
			: { sku: expectString(item.sku, `${path}.sku`) }),
	};
}

function parseBomRef(value: YamlValue, path: string): BuildBomRef {
	const ref = expectObject(value, path);
	const kind = expectString(ref.kind, `${path}.kind`);
	switch (kind) {
		case "component":
		case "device-interface-control":
		case "panel-element":
		case "board":
		case "freeform-build-item":
			return {
				...parseBuildDataObject(ref, path),
				kind,
				...(ref.componentId === undefined
					? {}
					: {
							componentId: expectString(ref.componentId, `${path}.componentId`),
						}),
				...(ref.controlId === undefined
					? {}
					: { controlId: expectString(ref.controlId, `${path}.controlId`) }),
				...(ref.panelElementId === undefined
					? {}
					: {
							panelElementId: expectString(
								ref.panelElementId,
								`${path}.panelElementId`,
							),
						}),
				...(ref.boardId === undefined
					? {}
					: { boardId: expectString(ref.boardId, `${path}.boardId`) }),
				...(ref.label === undefined
					? {}
					: { label: expectString(ref.label, `${path}.label`) }),
			};
		default:
			throw new Error(
				`${path}.kind: expected component, device-interface-control, panel-element, board, or freeform-build-item`,
			);
	}
}

function parsePartProfiles(
	value: YamlValue | undefined,
): BuildPartProfileCatalog | undefined {
	if (value === undefined) {
		return undefined;
	}
	const catalog = expectObject(value, "partProfiles");
	return {
		...parseBuildDataObject(catalog, "partProfiles"),
		schema: parseLiteralString(
			catalog.schema,
			"partProfiles.schema",
			"part-profile-catalog/v1",
		),
		...(catalog.resolution === undefined
			? {}
			: {
					resolution: expectString(
						catalog.resolution,
						"partProfiles.resolution",
					),
				}),
		...(catalog.units === undefined
			? {}
			: { units: expectString(catalog.units, "partProfiles.units") }),
		profiles: optionalArray(catalog.profiles, "partProfiles.profiles").map(
			(profile, index) => parsePartProfile(profile, index),
		),
	};
}

function parsePartProfile(value: YamlValue, index: number): BuildPartProfile {
	const path = `partProfiles.profiles[${index}]`;
	const profile = expectObject(value, path);
	return {
		...parseBuildDataObject(profile, path),
		id: expectString(profile.id, `${path}.id`),
		...(profile.profileSchema === undefined
			? {}
			: {
					profileSchema: expectString(
						profile.profileSchema,
						`${path}.profileSchema`,
					),
				}),
		...(profile.kind === undefined
			? {}
			: { kind: expectString(profile.kind, `${path}.kind`) }),
	};
}

function parseSimulationProfiles(
	value: YamlValue | undefined,
): SimulationProfileCatalog | undefined {
	if (value === undefined) {
		return undefined;
	}
	const catalog = expectObject(value, "simulationProfiles");
	return {
		...parseBuildDataObject(catalog, "simulationProfiles"),
		schema: parseLiteralString(
			catalog.schema,
			"simulationProfiles.schema",
			"simulation-profile-catalog/v1",
		),
		...(catalog.resolution === undefined
			? {}
			: {
					resolution: expectString(
						catalog.resolution,
						"simulationProfiles.resolution",
					),
				}),
		...(catalog.units === undefined
			? {}
			: {
					units: parseSimulationProfileUnits(
						catalog.units,
						"simulationProfiles.units",
					),
				}),
		profiles: optionalArray(
			catalog.profiles,
			"simulationProfiles.profiles",
		).map((profile, index) => parseSimulationProfile(profile, index)),
	};
}

function parseSimulationProfile(
	value: YamlValue,
	index: number,
): SimulationProfile {
	const path = `simulationProfiles.profiles[${index}]`;
	const profile = expectObject(value, path);
	return {
		...parseBuildDataObject(profile, path),
		profileSchema: expectString(profile.profileSchema, `${path}.profileSchema`),
		kind: expectString(profile.kind, `${path}.kind`),
		id: expectString(profile.id, `${path}.id`),
		targetProfileIds: optionalArray(
			profile.targetProfileIds,
			`${path}.targetProfileIds`,
		).map((id, targetIndex) =>
			expectString(id, `${path}.targetProfileIds[${targetIndex}]`),
		),
		domain: expectString(profile.domain, `${path}.domain`),
		representation: expectString(
			profile.representation,
			`${path}.representation`,
		),
		...(profile.operatingRegime === undefined
			? {}
			: {
					operatingRegime: expectString(
						profile.operatingRegime,
						`${path}.operatingRegime`,
					),
				}),
		...(profile.coupling === undefined
			? {}
			: { coupling: expectString(profile.coupling, `${path}.coupling`) }),
		...(profile.parameters === undefined
			? {}
			: {
					parameters: parseBuildDataObject(
						profile.parameters,
						`${path}.parameters`,
					),
				}),
		...(profile.dataRef === undefined
			? {}
			: { dataRef: expectString(profile.dataRef, `${path}.dataRef`) }),
		...(profile.assetRefs === undefined
			? {}
			: {
					assetRefs: optionalArray(profile.assetRefs, `${path}.assetRefs`).map(
						(assetRef, assetIndex) =>
							parseProfileResponseRef(
								assetRef,
								`${path}.assetRefs[${assetIndex}]`,
							),
					),
				}),
	};
}

function parseProfileResponseRef(
	value: YamlValue,
	path: string,
): ProfileResponseRef {
	const ref = expectObject(value, path);
	return {
		...parseBuildDataObject(ref, path),
		id: expectString(ref.id, `${path}.id`),
		kind: expectString(ref.kind, `${path}.kind`),
		assetRef: expectString(ref.assetRef, `${path}.assetRef`),
		...(ref.mimeType === undefined
			? {}
			: { mimeType: expectString(ref.mimeType, `${path}.mimeType`) }),
		...(ref.sha256 === undefined
			? {}
			: { sha256: expectString(ref.sha256, `${path}.sha256`) }),
	};
}

function parseSimulationProfileUnits(
	value: YamlValue | undefined,
	path: string,
): string {
	const units = expectString(value, path);
	if (units === "SI") {
		return units;
	}
	throw new Error(`${path}: expected SI`);
}

function parseFootprints(
	value: YamlValue | undefined,
): BoardFootprintCatalog | undefined {
	if (value === undefined) {
		return undefined;
	}
	const catalog = expectObject(value, "footprints");
	return {
		...parseBuildDataObject(catalog, "footprints"),
		schema: parseLiteralString(
			catalog.schema,
			"footprints.schema",
			"board-footprint-catalog/v1",
		),
		...(catalog.resolution === undefined
			? {}
			: {
					resolution: expectString(catalog.resolution, "footprints.resolution"),
				}),
		...(catalog.units === undefined
			? {}
			: { units: expectString(catalog.units, "footprints.units") }),
		footprints: optionalArray(catalog.footprints, "footprints.footprints").map(
			(footprint, index) => parseFootprint(footprint, index),
		),
	};
}

function parseFootprint(value: YamlValue, index: number): BoardFootprint {
	const path = `footprints.footprints[${index}]`;
	const footprint = expectObject(value, path);
	return {
		...parseBuildDataObject(footprint, path),
		id: expectString(footprint.id, `${path}.id`),
		...(footprint.boardApplicability === undefined
			? {}
			: {
					boardApplicability: parseBoardApplicability(
						footprint.boardApplicability,
						`${path}.boardApplicability`,
					),
				}),
	};
}

function parseBoardApplicability(
	value: YamlValue,
	path: string,
): BoardApplicability {
	const applicability = expectObject(value, path);
	return {
		...parseBuildDataObject(applicability, path),
		family: parseBoardFamily(applicability.family, `${path}.family`),
		kind: parseBoardKind(applicability.kind, `${path}.kind`),
		...(applicability.subtype === undefined
			? {}
			: {
					subtype: parseBoardSubtype(applicability.subtype, `${path}.subtype`),
				}),
	};
}

function parseOffBoardWiring(
	value: YamlValue | undefined,
): OffBoardWiringPlan | undefined {
	if (value === undefined) {
		return undefined;
	}
	const plan = expectObject(value, "offBoardWiring");
	return {
		...parseBuildDataObject(plan, "offBoardWiring"),
		schema: parseLiteralString(
			plan.schema,
			"offBoardWiring.schema",
			"offboard-wiring/v1",
		),
		...(plan.source === undefined
			? {}
			: { source: expectString(plan.source, "offBoardWiring.source") }),
		...(plan.coverage === undefined
			? {}
			: {
					coverage: parseOffBoardWiringCoverage(
						plan.coverage,
						"offBoardWiring.coverage",
					),
				}),
		harnesses: optionalArray(plan.harnesses, "offBoardWiring.harnesses").map(
			parseOffBoardWiringHarness,
		),
	};
}

function parseOffBoardWiringCoverage(
	value: YamlValue | undefined,
	path: string,
): OffBoardWiringCoverage {
	const coverage = expectString(value, path);
	if (
		coverage === "selected-build-complete" ||
		coverage === "representative-selected-build-endpoints"
	) {
		return coverage;
	}
	throw new Error(
		`${path}: expected selected-build-complete or representative-selected-build-endpoints`,
	);
}

function parseOffBoardWiringHarness(
	value: YamlValue,
	index: number,
): OffBoardWiringHarness {
	const path = `offBoardWiring.harnesses[${index}]`;
	const harness = expectObject(value, path);
	return {
		...parseBuildDataObject(harness, path),
		id: expectString(harness.id, `${path}.id`),
		...(harness.status === undefined
			? {}
			: {
					status: parseOffBoardWiringHarnessStatus(
						harness.status,
						`${path}.status`,
					),
				}),
		...(harness.notes === undefined
			? {}
			: { notes: expectString(harness.notes, `${path}.notes`) }),
		endpoints: optionalArray(harness.endpoints, `${path}.endpoints`).map(
			(endpoint, endpointIndex) =>
				parseOffBoardWiringEndpoint(
					endpoint,
					`${path}.endpoints[${endpointIndex}]`,
				),
		),
		connections: optionalArray(harness.connections, `${path}.connections`).map(
			(connection, connectionIndex) =>
				parseOffBoardWiringConnection(
					connection,
					`${path}.connections[${connectionIndex}]`,
				),
		),
	};
}

function parseOffBoardWiringHarnessStatus(
	value: YamlValue | undefined,
	path: string,
): OffBoardWiringHarnessStatus {
	const status = expectString(value, path);
	if (status === "complete" || status === "partial" || status === "candidate") {
		return status;
	}
	throw new Error(`${path}: expected complete, partial, or candidate`);
}

function parseOffBoardWiringEndpoint(
	value: YamlValue,
	path: string,
): OffBoardWiringEndpoint {
	const endpoint = expectObject(value, path);
	const kind = expectString(endpoint.kind, `${path}.kind`);
	switch (kind) {
		case "panel-component-terminal":
		case "board-terminal":
		case "power-terminal":
		case "footswitch-terminal":
		case "free-wire-label":
			return {
				...parseBuildDataObject(endpoint, path),
				id: expectString(endpoint.id, `${path}.id`),
				kind,
				...(endpoint.componentId === undefined
					? {}
					: {
							componentId: expectString(
								endpoint.componentId,
								`${path}.componentId`,
							),
						}),
				...(endpoint.terminalName === undefined
					? {}
					: {
							terminalName: expectString(
								endpoint.terminalName,
								`${path}.terminalName`,
							),
						}),
				...(endpoint.panelElementId === undefined
					? {}
					: {
							panelElementId: expectString(
								endpoint.panelElementId,
								`${path}.panelElementId`,
							),
						}),
				...(endpoint.boardId === undefined
					? {}
					: { boardId: expectString(endpoint.boardId, `${path}.boardId`) }),
				...(endpoint.terminalId === undefined
					? {}
					: {
							terminalId: expectString(
								endpoint.terminalId,
								`${path}.terminalId`,
							),
						}),
				...(endpoint.label === undefined
					? {}
					: { label: expectString(endpoint.label, `${path}.label`) }),
			};
		default:
			throw new Error(
				`${path}.kind: expected a supported off-board wiring endpoint kind`,
			);
	}
}

function parseOffBoardWiringConnection(
	value: YamlValue,
	path: string,
): OffBoardWiringConnection {
	const connection = expectObject(value, path);
	return {
		...parseBuildDataObject(connection, path),
		id: expectString(connection.id, `${path}.id`),
		fromEndpointId: expectString(
			connection.fromEndpointId,
			`${path}.fromEndpointId`,
		),
		toEndpointId: expectString(connection.toEndpointId, `${path}.toEndpointId`),
		...(connection.signalRef === undefined
			? {}
			: {
					signalRef: parseBuildDataObject(
						connection.signalRef,
						`${path}.signalRef`,
					),
				}),
		...(connection.wire === undefined
			? {}
			: { wire: parseBuildDataObject(connection.wire, `${path}.wire`) }),
	};
}

function parseBoards(
	value: YamlValue | undefined,
): readonly BoardRealization[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return optionalArray(value, "boards").map(parseBoard);
}

function parsePower(value: YamlValue | undefined): CircuitPower | undefined {
	if (value === undefined) {
		return undefined;
	}
	const power = expectObject(value, "power");
	return {
		...parseBuildDataObject(power, "power"),
		schema: parseLiteralString(
			power.schema,
			"power.schema",
			"circuit-power/v1",
		),
		coverage: parseCircuitPowerCoverage(power.coverage, "power.coverage"),
		domains: optionalArray(power.domains, "power.domains").map(
			(domain, index) => parsePowerDomain(domain, `power.domains[${index}]`),
		),
	};
}

function parsePowerDomain(value: YamlValue, path: string): CircuitPowerDomain {
	const domain = expectObject(value, path);
	// sourceKind and the provisional powerSourceKind alias are normalized into the
	// typed field below; drop both from the build-data passthrough so the parser is
	// the single normalization boundary and only canonical sourceKind round-trips.
	const buildData: Record<string, VdspBuildDataValue | undefined> = {
		...parseBuildDataObject(domain, path),
	};
	delete buildData.sourceKind;
	delete buildData.powerSourceKind;
	const sourceKind = parsePowerSourceKind(
		domain.sourceKind,
		domain.powerSourceKind,
		path,
	);
	return {
		...buildData,
		id: expectString(domain.id, `${path}.id`),
		sourceComponentIds: optionalArray(
			domain.sourceComponentIds,
			`${path}.sourceComponentIds`,
		).map((id, index) =>
			expectString(id, `${path}.sourceComponentIds[${index}]`),
		),
		...(domain.ratedVoltage === undefined
			? {}
			: {
					ratedVoltage: parseQuantity(
						domain.ratedVoltage,
						`${path}.ratedVoltage`,
					),
				}),
		groundPolarity: parseCircuitPowerGroundPolarity(
			domain.groundPolarity,
			`${path}.groundPolarity`,
		),
		...(sourceKind === undefined ? {} : { sourceKind }),
		rails: optionalArray(domain.rails, `${path}.rails`).map((rail, index) =>
			parsePowerRailBinding(rail, `${path}.rails[${index}]`),
		),
	};
}

// Resolves the canonical `sourceKind` and the provisional `powerSourceKind`
// build-data alias into one typed value: canonical wins, a same-valued alias is
// accepted, and disagreeing keys are rejected.
function parsePowerSourceKind(
	canonical: YamlValue | undefined,
	legacy: YamlValue | undefined,
	path: string,
): CircuitPowerSourceKind | undefined {
	const canonicalKind =
		canonical === undefined
			? undefined
			: coercePowerSourceKind(canonical, `${path}.sourceKind`);
	const legacyKind =
		legacy === undefined
			? undefined
			: coercePowerSourceKind(legacy, `${path}.powerSourceKind`);
	if (
		canonicalKind !== undefined &&
		legacyKind !== undefined &&
		canonicalKind !== legacyKind
	) {
		throw new Error(
			`${path}: sourceKind "${canonicalKind}" conflicts with powerSourceKind "${legacyKind}"`,
		);
	}
	return canonicalKind ?? legacyKind;
}

function coercePowerSourceKind(
	value: YamlValue,
	path: string,
): CircuitPowerSourceKind {
	const kind = expectString(value, path);
	switch (kind) {
		case "mains-ac":
		case "external-dc":
			return kind;
		default:
			throw new Error(`${path}: expected mains-ac or external-dc`);
	}
}

function parsePowerRailBinding(
	value: YamlValue,
	path: string,
): CircuitPowerRailBinding {
	const rail = expectObject(value, path);
	return {
		...parseBuildDataObject(rail, path),
		railComponentId: expectString(
			rail.railComponentId,
			`${path}.railComponentId`,
		),
		role: parseCircuitPowerRailRole(rail.role, `${path}.role`),
		derivation: parseCircuitPowerRailDerivation(
			rail.derivation,
			`${path}.derivation`,
		),
		...(rail.parentRailComponentId === undefined
			? {}
			: {
					parentRailComponentId: expectString(
						rail.parentRailComponentId,
						`${path}.parentRailComponentId`,
					),
				}),
		...(rail.converterComponentId === undefined
			? {}
			: {
					converterComponentId: expectString(
						rail.converterComponentId,
						`${path}.converterComponentId`,
					),
				}),
		...(rail.nominalVoltage === undefined
			? {}
			: {
					nominalVoltage: parseQuantity(
						rail.nominalVoltage,
						`${path}.nominalVoltage`,
					),
				}),
	};
}

function parseCircuitPowerCoverage(
	value: YamlValue | undefined,
	path: string,
): CircuitPowerCoverage {
	const coverage = expectString(value, path);
	switch (coverage) {
		case "explicit-topology":
		case "declared-rails":
		case "external-unspecified":
		case "not-applicable":
			return coverage;
		default:
			throw new Error(
				`${path}: expected explicit-topology, declared-rails, external-unspecified, or not-applicable`,
			);
	}
}

function parseCircuitPowerGroundPolarity(
	value: YamlValue | undefined,
	path: string,
): CircuitPowerGroundPolarity {
	const polarity = expectString(value, path);
	switch (polarity) {
		case "negative-ground":
		case "positive-ground":
		case "bipolar":
			return polarity;
		default:
			throw new Error(
				`${path}: expected negative-ground, positive-ground, or bipolar`,
			);
	}
}

function parseCircuitPowerRailRole(
	value: YamlValue | undefined,
	path: string,
): CircuitPowerRailRole {
	const role = expectString(value, path);
	switch (role) {
		case "main-supply":
		case "bias-reference":
		case "regulated-output":
		case "charge-pump-output":
		case "negative-supply":
			return role;
		default:
			throw new Error(
				`${path}: expected main-supply, bias-reference, regulated-output, charge-pump-output, or negative-supply`,
			);
	}
}

function parseCircuitPowerRailDerivation(
	value: YamlValue | undefined,
	path: string,
): CircuitPowerRailDerivation {
	const derivation = expectString(value, path);
	switch (derivation) {
		case "direct":
		case "divider":
		case "regulator":
		case "inverter":
		case "doubler":
		case "isolated":
		case "unspecified":
			return derivation;
		default:
			throw new Error(
				`${path}: expected direct, divider, regulator, inverter, doubler, isolated, or unspecified`,
			);
	}
}

function parseQuantity(value: YamlValue, path: string): ParsedQuantity {
	const quantity = expectObject(value, path);
	return {
		raw: expectString(quantity.raw, `${path}.raw`),
		value: expectNumber(quantity.value, `${path}.value`),
		unit: expectString(quantity.unit, `${path}.unit`),
	};
}

function parseBoard(value: YamlValue, index: number): BoardRealization {
	const path = `boards[${index}]`;
	const board = expectObject(value, path);
	const sourceCircuit =
		board.sourceCircuit === undefined
			? undefined
			: parseBoardSourceCircuit(board.sourceCircuit, `${path}.sourceCircuit`);
	return {
		...parseBuildDataObject(board, path),
		id: expectString(board.id, `${path}.id`),
		schema: parseLiteralString(
			board.schema,
			`${path}.schema`,
			"circuit-board/v1",
		),
		family: parseBoardFamily(board.family, `${path}.family`),
		kind: parseBoardKind(board.kind, `${path}.kind`),
		...(board.subtype === undefined
			? {}
			: { subtype: parseBoardSubtype(board.subtype, `${path}.subtype`) }),
		...(board.source === undefined
			? {}
			: { source: expectString(board.source, `${path}.source`) }),
		...(board.units === undefined
			? {}
			: { units: expectString(board.units, `${path}.units`) }),
		...(board.locked === undefined
			? {}
			: { locked: expectBoolean(board.locked, `${path}.locked`) }),
		...(sourceCircuit === undefined ? {} : { sourceCircuit }),
		edgeTerminals: optionalArray(
			board.edgeTerminals,
			`${path}.edgeTerminals`,
		).map((terminal, terminalIndex) =>
			parseBoardEdgeTerminal(
				terminal,
				`${path}.edgeTerminals[${terminalIndex}]`,
			),
		),
		footprintPlacements: optionalArray(
			board.footprintPlacements,
			`${path}.footprintPlacements`,
		).map((placement, placementIndex) =>
			parseBoardFootprintPlacement(
				placement,
				`${path}.footprintPlacements[${placementIndex}]`,
			),
		),
		...(board.netlist === undefined
			? {}
			: { netlist: parseBoardNetlist(board.netlist, `${path}.netlist`) }),
		routes: optionalArray(board.routes, `${path}.routes`).map(
			(route, routeIndex) =>
				parseBoardRoute(route, `${path}.routes[${routeIndex}]`),
		),
		...(board.zones === undefined
			? {}
			: { zones: parseBuildDataObjectArray(board.zones, `${path}.zones`) }),
		...(board.drills === undefined
			? {}
			: { drills: parseBuildDataObjectArray(board.drills, `${path}.drills`) }),
		...(board.review === undefined
			? {}
			: { review: parseBuildDataObject(board.review, `${path}.review`) }),
	};
}

function parseBoardSourceCircuit(
	value: YamlValue,
	path: string,
): BoardSourceCircuitHash {
	const sourceCircuit = expectObject(value, path);
	const hash = expectString(sourceCircuit.hash, `${path}.hash`);
	if (!/^sha256:[0-9a-f]{64}$/.test(hash)) {
		throw new Error(
			`${path}.hash: expected sha256:<64 lowercase hex characters>`,
		);
	}
	return {
		...parseBuildDataObject(sourceCircuit, path),
		schema: parseLiteralString(
			sourceCircuit.schema,
			`${path}.schema`,
			"canonical-circuit-facts-hash/v1",
		),
		hashAlgorithm: parseLiteralString(
			sourceCircuit.hashAlgorithm,
			`${path}.hashAlgorithm`,
			"sha256",
		),
		hash,
	};
}

function parseBoardEdgeTerminal(
	value: YamlValue,
	path: string,
): BoardEdgeTerminal {
	const terminal = expectObject(value, path);
	return {
		...parseBuildDataObject(terminal, path),
		id: expectString(terminal.id, `${path}.id`),
		...(terminal.role === undefined
			? {}
			: { role: expectString(terminal.role, `${path}.role`) }),
		...(terminal.terminalRef === undefined
			? {}
			: {
					terminalRef: parseComponentTerminalRef(
						terminal.terminalRef,
						`${path}.terminalRef`,
					),
				}),
		...(terminal.hole === undefined
			? {}
			: { hole: parseBoardHole(terminal.hole, `${path}.hole`) }),
	};
}

function parseBoardFootprintPlacement(
	value: YamlValue,
	path: string,
): BoardFootprintPlacement {
	const placement = expectObject(value, path);
	return {
		...parseBuildDataObject(placement, path),
		componentId: expectString(placement.componentId, `${path}.componentId`),
		footprintId: expectString(placement.footprintId, `${path}.footprintId`),
		...(placement.atGrid === undefined
			? {}
			: { atGrid: parseBoardHole(placement.atGrid, `${path}.atGrid`) }),
		...(placement.atMm === undefined
			? {}
			: { atMm: parsePoint(placement.atMm, `${path}.atMm`) }),
		...(placement.rotationDeg === undefined
			? {}
			: {
					rotationDeg: expectNumber(
						placement.rotationDeg,
						`${path}.rotationDeg`,
					),
				}),
		pads: optionalArray(placement.pads, `${path}.pads`).map((pad, padIndex) =>
			parseBoardPlacedPad(pad, `${path}.pads[${padIndex}]`),
		),
	};
}

function parseBoardPlacedPad(value: YamlValue, path: string): BoardPlacedPad {
	const pad = expectObject(value, path);
	return {
		...parseBuildDataObject(pad, path),
		padId: expectString(pad.padId, `${path}.padId`),
		...(pad.terminalName === undefined
			? {}
			: {
					terminalName: expectString(pad.terminalName, `${path}.terminalName`),
				}),
		...(pad.hole === undefined
			? {}
			: { hole: parseBoardHole(pad.hole, `${path}.hole`) }),
		...(pad.positionMm === undefined
			? {}
			: { positionMm: parsePoint(pad.positionMm, `${path}.positionMm`) }),
	};
}

function parseBoardNetlist(value: YamlValue, path: string): BoardNetlist {
	const netlist = expectObject(value, path);
	return {
		...parseBuildDataObject(netlist, path),
		...(netlist.source === undefined
			? {}
			: { source: expectString(netlist.source, `${path}.source`) }),
		nets: optionalArray(netlist.nets, `${path}.nets`).map((net, netIndex) =>
			parseBoardNet(net, `${path}.nets[${netIndex}]`),
		),
	};
}

function parseBoardNet(value: YamlValue, path: string): BoardNet {
	const net = expectObject(value, path);
	return {
		...parseBuildDataObject(net, path),
		id: expectString(net.id, `${path}.id`),
		...(net.name === undefined
			? {}
			: { name: expectString(net.name, `${path}.name`) }),
		members: optionalArray(net.members, `${path}.members`).map(
			(member, memberIndex) =>
				parseBoardNetMember(member, `${path}.members[${memberIndex}]`),
		),
	};
}

function parseBoardNetMember(value: YamlValue, path: string): BoardNetMember {
	const member = expectObject(value, path);
	return {
		...parseBuildDataObject(member, path),
		componentId: expectString(member.componentId, `${path}.componentId`),
		terminalName: expectString(member.terminalName, `${path}.terminalName`),
		...(member.padId === undefined
			? {}
			: { padId: expectString(member.padId, `${path}.padId`) }),
		...(member.terminalId === undefined
			? {}
			: { terminalId: expectString(member.terminalId, `${path}.terminalId`) }),
	};
}

function parseBoardRoute(value: YamlValue, path: string): BoardRoute {
	const route = expectObject(value, path);
	return {
		...parseBuildDataObject(route, path),
		id: expectString(route.id, `${path}.id`),
		...(route.netRef === undefined
			? {}
			: { netRef: parseBuildDataObject(route.netRef, `${path}.netRef`) }),
		...(route.locked === undefined
			? {}
			: { locked: expectBoolean(route.locked, `${path}.locked`) }),
		...(route.conductors === undefined
			? {}
			: {
					conductors: parseBuildDataObjectArray(
						route.conductors,
						`${path}.conductors`,
					),
				}),
		...(route.copper === undefined
			? {}
			: { copper: parseBuildDataObjectArray(route.copper, `${path}.copper`) }),
		...(route.vias === undefined
			? {}
			: { vias: parseBuildDataObjectArray(route.vias, `${path}.vias`) }),
		...(route.zones === undefined
			? {}
			: { zones: parseBuildDataObjectArray(route.zones, `${path}.zones`) }),
		...(route.drills === undefined
			? {}
			: { drills: parseBuildDataObjectArray(route.drills, `${path}.drills`) }),
	};
}

function parseComponentTerminalRef(
	value: YamlValue,
	path: string,
): ComponentTerminalRef {
	const ref = expectObject(value, path);
	return {
		...parseBuildDataObject(ref, path),
		componentId: expectString(ref.componentId, `${path}.componentId`),
		terminalName: expectString(ref.terminalName, `${path}.terminalName`),
	};
}

function parseBoardHole(value: YamlValue, path: string) {
	const hole = expectObject(value, path);
	return {
		...parseBuildDataObject(hole, path),
		row: expectPositiveInteger(hole.row, `${path}.row`),
		column: expectPositiveInteger(hole.column, `${path}.column`),
	};
}

function parseBoardFamily(
	value: YamlValue | undefined,
	path: string,
): BoardFamily {
	const family = expectString(value, path);
	if (family === "prototype-board" || family === "fabricated-board") {
		return family;
	}
	throw new Error(`${path}: expected prototype-board or fabricated-board`);
}

function parseBoardKind(value: YamlValue | undefined, path: string): BoardKind {
	const kind = expectString(value, path);
	switch (kind) {
		case "stripboard":
		case "perfboard":
		case "breadboard-pattern":
		case "pcb":
			return kind;
		default:
			throw new Error(
				`${path}: expected stripboard, perfboard, breadboard-pattern, or pcb`,
			);
	}
}

function parseBoardSubtype(
	value: YamlValue | undefined,
	path: string,
): BoardSubtype {
	const subtype = expectString(value, path);
	switch (subtype) {
		case "veroboard":
		case "isolated-pad":
		case "solderable-half-breadboard":
		case "single-sided-through-hole":
		case "two-layer-through-hole":
			return subtype;
		default:
			throw new Error(`${path}: expected a supported board subtype`);
	}
}

function parseLiteralString<T extends string>(
	value: YamlValue | undefined,
	path: string,
	expected: T,
): T {
	const actual = expectString(value, path);
	if (actual === expected) {
		return expected;
	}
	throw new Error(`${path}: expected ${expected}`);
}

function parseBuildDataObjectArray(
	value: YamlValue | undefined,
	path: string,
): readonly VdspBuildDataObject[] {
	return optionalArray(value, path).map((item, index) =>
		parseBuildDataObject(item, `${path}[${index}]`),
	);
}

function parseBuildDataObject(
	value: YamlValue | undefined,
	path: string,
): VdspBuildDataObject {
	const object = expectObject(value, path);
	const out: Record<string, VdspBuildDataValue | undefined> = {};
	for (const [key, child] of Object.entries(object)) {
		out[key] = parseBuildDataValue(child, `${path}.${key}`);
	}
	return out;
}

function parseBuildDataValue(
	value: YamlValue,
	path: string,
): VdspBuildDataValue {
	if (isScalar(value)) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item, index) =>
			parseBuildDataValue(item, `${path}[${index}]`),
		);
	}
	if (isYamlObject(value)) {
		return parseBuildDataObject(value, path);
	}
	throw new Error(`${path}: expected v3 build data value`);
}

function parseControlGroups(
	value: YamlValue | undefined,
): readonly ControlGroup[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return optionalArray(value, "controlGroups").map((item, index) => {
		const path = `controlGroups[${index}]`;
		const group = expectObject(item, path);
		const contextIds = parseOptionalStringArray(
			group.contextIds,
			`${path}.contextIds`,
		);
		const members = parseControlGroupMembers(group.members, `${path}.members`);
		const description = parseOptionalString(
			group.description,
			`${path}.description`,
		);
		return {
			id: expectString(group.id, `${path}.id`),
			name: expectString(group.name, `${path}.name`),
			role: expectString(group.role, `${path}.role`),
			...(contextIds === undefined ? {} : { contextIds }),
			...(description === undefined ? {} : { description }),
			...(members === undefined ? {} : { members }),
		};
	});
}

function parseControlGroupMembers(
	value: YamlValue | undefined,
	path: string,
): readonly ControlGroupMember[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return optionalArray(value, path).map((item, index) => {
		const memberPath = `${path}[${index}]`;
		const member = expectObject(item, memberPath);
		const order = parseOptionalNumber(member.order, `${memberPath}.order`);
		const appliesWhen = parseOptionalApplicabilityPredicate(
			member.appliesWhen,
			`${memberPath}.appliesWhen`,
		);
		const description = parseOptionalString(
			member.description,
			`${memberPath}.description`,
		);
		return {
			controlId: expectString(member.controlId, `${memberPath}.controlId`),
			...(order === undefined ? {} : { order }),
			...(appliesWhen === undefined ? {} : { appliesWhen }),
			...(description === undefined ? {} : { description }),
		};
	});
}

function parseControlContexts(
	value: YamlValue | undefined,
): readonly ControlContext[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return optionalArray(value, "controlContexts").map((item, index) => {
		const path = `controlContexts[${index}]`;
		const context = expectObject(item, path);
		const description = parseOptionalString(
			context.description,
			`${path}.description`,
		);
		return {
			id: expectString(context.id, `${path}.id`),
			name: expectString(context.name, `${path}.name`),
			role: expectString(context.role, `${path}.role`),
			...(description === undefined ? {} : { description }),
		};
	});
}

function parseDeviceInterface(
	value: YamlValue | undefined,
): DeviceInterface | undefined {
	if (value === undefined) {
		return undefined;
	}
	const deviceInterface = expectObject(value, "deviceInterface");
	return {
		controls: optionalArray(
			deviceInterface.controls,
			"deviceInterface.controls",
		).map((item, index) => {
			const path = `deviceInterface.controls[${index}]`;
			const control = expectObject(item, path);
			const groupId = parseOptionalString(control.groupId, `${path}.groupId`);
			const order = parseOptionalNumber(control.order, `${path}.order`);
			const audioBinding = parseOptionalDeviceInterfaceAudioBinding(
				control.audioBinding,
				`${path}.audioBinding`,
			);
			const binding = parseOptionalDeviceInterfaceBinding(
				control.binding,
				`${path}.binding`,
			);
			const appliesWhen = parseOptionalApplicabilityPredicate(
				control.appliesWhen,
				`${path}.appliesWhen`,
			);
			const description = parseOptionalString(
				control.description,
				`${path}.description`,
			);
			return {
				id: expectString(control.id, `${path}.id`),
				label: expectString(control.label, `${path}.label`),
				kind: parseDeviceInterfaceControlKind(control.kind, `${path}.kind`),
				role: expectString(control.role, `${path}.role`),
				...(groupId === undefined ? {} : { groupId }),
				...(order === undefined ? {} : { order }),
				...(audioBinding === undefined ? {} : { audioBinding }),
				...(binding === undefined ? {} : { binding }),
				...(appliesWhen === undefined ? {} : { appliesWhen }),
				...(description === undefined ? {} : { description }),
			};
		}),
	};
}

function parseDeviceInterfaceControlKind(
	value: YamlValue | undefined,
	path: string,
): DeviceInterfaceControlKind {
	const kind = expectString(value, path);
	switch (kind) {
		case "knob":
		case "slider":
		case "switch":
		case "selector":
		case "footswitch":
		case "led":
		case "display":
		case "jack":
			return kind;
		default:
			throw new Error(
				`${path}: expected knob, slider, switch, selector, footswitch, led, display, or jack`,
			);
	}
}

function parseOptionalDeviceInterfaceAudioBinding(
	value: YamlValue | undefined,
	path: string,
): DeviceInterfaceAudioBinding | undefined {
	if (value === undefined) {
		return undefined;
	}
	const binding = expectObject(value, path);
	const kind = expectString(binding.kind, `${path}.kind`);
	if (kind !== "control") {
		throw new Error(`${path}.kind: unsupported audio binding kind "${kind}"`);
	}
	return {
		kind,
		controlName: expectString(binding.controlName, `${path}.controlName`),
	};
}

function parseOptionalDeviceInterfaceBinding(
	value: YamlValue | undefined,
	path: string,
): DeviceInterfaceBinding | undefined {
	if (value === undefined) {
		return undefined;
	}
	const binding = expectObject(value, path);
	const controlId = parseOptionalString(binding.controlId, `${path}.controlId`);
	const controlName = parseOptionalString(
		binding.controlName,
		`${path}.controlName`,
	);
	const property = parseOptionalString(binding.property, `${path}.property`);
	const externalInterfaceId = parseOptionalString(
		binding.externalInterfaceId,
		`${path}.externalInterfaceId`,
	);
	return {
		componentId: expectString(binding.componentId, `${path}.componentId`),
		...(controlId === undefined ? {} : { controlId }),
		...(controlName === undefined ? {} : { controlName }),
		...(property === undefined ? {} : { property }),
		...(externalInterfaceId === undefined ? {} : { externalInterfaceId }),
	};
}

function parseOptionalApplicabilityPredicate(
	value: YamlValue | undefined,
	path: string,
): ControlApplicabilityPredicate | undefined {
	if (value === undefined) {
		return undefined;
	}
	const predicate = expectObject(value, path);
	const allOf = parseOptionalStringArray(predicate.allOf, `${path}.allOf`);
	const anyOf = parseOptionalStringArray(predicate.anyOf, `${path}.anyOf`);
	return {
		...(allOf === undefined ? {} : { allOf }),
		...(anyOf === undefined ? {} : { anyOf }),
	};
}

function parseDevice(
	value: YamlValue | undefined,
): CircuitDocumentDevice | undefined {
	if (value === undefined) {
		return undefined;
	}
	const device = expectObject(value, "device");
	const id = parseOptionalString(device.id, "device.id");
	const version = parseOptionalPositiveInteger(
		device.version,
		"device.version",
	);
	const family = parseOptionalString(device.family, "device.family");
	const model = parseOptionalString(device.model, "device.model");
	const audioProcessing = parseOptionalBoolean(
		device.audioProcessing,
		"device.audioProcessing",
	);
	return {
		...(id === undefined ? {} : { id }),
		...(version === undefined ? {} : { version }),
		kind: parseCircuitDocumentDeviceKind(device.kind, "device.kind"),
		...(family === undefined ? {} : { family }),
		...(model === undefined ? {} : { model }),
		...(audioProcessing === undefined ? {} : { audioProcessing }),
	};
}

function parseCircuitDocumentDeviceKind(
	value: YamlValue | undefined,
	path: string,
): CircuitDocumentDeviceKind {
	const kind = expectString(value, path);
	switch (kind) {
		case "audio-pedal":
		case "control-accessory":
		case "utility":
		case "unknown":
			return kind;
		default:
			throw new Error(
				`${path}: expected audio-pedal, control-accessory, utility, or unknown`,
			);
	}
}

function parseControlOutputs(
	value: YamlValue | undefined,
): readonly ControlOutput[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return optionalArray(value, "controlOutputs").map((item, index) => {
		const path = `controlOutputs[${index}]`;
		const controlOutput = expectObject(item, path);
		const connector = parseOptionalControlInterfaceConnector(
			controlOutput.connector,
			`${path}.connector`,
		);
		const switchMode = parseOptionalControlOutputSwitchMode(
			controlOutput.switchMode,
			`${path}.switchMode`,
		);
		const polarity = parseOptionalControlInterfacePolarity(
			controlOutput.polarity,
			`${path}.polarity`,
		);
		const inactiveValue = parseOptionalNumber(
			controlOutput.inactiveValue,
			`${path}.inactiveValue`,
		);
		const activeValue = parseOptionalNumber(
			controlOutput.activeValue,
			`${path}.activeValue`,
		);
		const componentId = parseOptionalString(
			controlOutput.componentId,
			`${path}.componentId`,
		);
		const description = parseOptionalString(
			controlOutput.description,
			`${path}.description`,
		);
		return {
			id: expectString(controlOutput.id, `${path}.id`),
			name: expectString(controlOutput.name, `${path}.name`),
			role: parseControlInterfaceRole(controlOutput.role, `${path}.role`),
			...(connector === undefined ? {} : { connector }),
			...(switchMode === undefined ? {} : { switchMode }),
			...(polarity === undefined ? {} : { polarity }),
			...(inactiveValue === undefined ? {} : { inactiveValue }),
			...(activeValue === undefined ? {} : { activeValue }),
			...(componentId === undefined ? {} : { componentId }),
			...(description === undefined ? {} : { description }),
		};
	});
}

function parseOptionalControlOutputSwitchMode(
	value: YamlValue | undefined,
	path: string,
): ControlOutputSwitchMode | undefined {
	if (value === undefined) {
		return undefined;
	}
	const switchMode = expectString(value, path);
	switch (switchMode) {
		case "momentary":
		case "latching":
			return switchMode;
		default:
			throw new Error(`${path}: expected momentary or latching`);
	}
}

function parseControlInterfaces(
	value: YamlValue | undefined,
): readonly ControlInterface[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return optionalArray(value, "controlInterfaces").map((item, index) => {
		const path = `controlInterfaces[${index}]`;
		const controlInterface = expectObject(item, path);
		const componentId = parseOptionalString(
			controlInterface.componentId,
			`${path}.componentId`,
		);
		const controlRole = parseOptionalString(
			controlInterface.controlRole,
			`${path}.controlRole`,
		);
		const interfaceName = parseOptionalString(
			controlInterface.interface,
			`${path}.interface`,
		);
		const connector = parseOptionalControlInterfaceConnector(
			controlInterface.connector,
			`${path}.connector`,
		);
		const assignmentHint = parseOptionalControlInterfaceAssignmentHint(
			controlInterface.assignmentHint,
			`${path}.assignmentHint`,
		);
		const polarity = parseOptionalControlInterfacePolarity(
			controlInterface.polarity,
			`${path}.polarity`,
		);
		const binding = parseOptionalControlInterfaceBinding(
			controlInterface.binding,
			`${path}.binding`,
		);
		const description = parseOptionalString(
			controlInterface.description,
			`${path}.description`,
		);
		return {
			id: expectString(controlInterface.id, `${path}.id`),
			name: expectString(controlInterface.name, `${path}.name`),
			role: parseControlInterfaceRole(controlInterface.role, `${path}.role`),
			...(componentId === undefined ? {} : { componentId }),
			...(controlRole === undefined ? {} : { controlRole }),
			...(interfaceName === undefined ? {} : { interface: interfaceName }),
			...(connector === undefined ? {} : { connector }),
			...(assignmentHint === undefined ? {} : { assignmentHint }),
			...(polarity === undefined ? {} : { polarity }),
			...(binding === undefined ? {} : { binding }),
			...(description === undefined ? {} : { description }),
		};
	});
}

function parseOptionalControlInterfaceBinding(
	value: YamlValue | undefined,
	path: string,
): ControlInterface["binding"] | undefined {
	if (value === undefined) {
		return undefined;
	}
	const binding = expectObject(value, path);
	const sourceComponentId = parseOptionalString(
		binding.sourceComponentId,
		`${path}.sourceComponentId`,
	);
	const controlId = parseOptionalString(binding.controlId, `${path}.controlId`);
	const controlName = parseOptionalString(
		binding.controlName,
		`${path}.controlName`,
	);
	const property = parseOptionalString(binding.property, `${path}.property`);
	return {
		...(sourceComponentId === undefined ? {} : { sourceComponentId }),
		...(controlId === undefined ? {} : { controlId }),
		...(controlName === undefined ? {} : { controlName }),
		...(property === undefined ? {} : { property }),
	};
}

function parseControlInterfaceRole(
	value: YamlValue | undefined,
	path: string,
): ControlInterfaceRole {
	const role = expectString(value, path);
	switch (role) {
		case "external-control":
		case "tempo-tap":
		case "trigger":
		case "reset":
		case "sampler-trigger":
		case "expression":
		case "unknown":
			return role;
		default:
			throw new Error(
				`${path}: expected external-control, tempo-tap, trigger, reset, sampler-trigger, expression, or unknown`,
			);
	}
}

function parseOptionalControlInterfaceConnector(
	value: YamlValue | undefined,
	path: string,
): ControlInterfaceConnector | undefined {
	if (value === undefined) {
		return undefined;
	}
	const connector = expectString(value, path);
	switch (connector) {
		case "1/4-inch-mono-ts":
		case "1/4-inch-trs":
		case "3.5mm-mono-ts":
		case "3.5mm-trs":
		case "proprietary":
		case "unknown":
			return connector;
		default:
			throw new Error(`${path}: expected a supported connector kind`);
	}
}

function parseOptionalControlInterfaceAssignmentHint(
	value: YamlValue | undefined,
	path: string,
): ControlInterfaceAssignmentHint | undefined {
	if (value === undefined) {
		return undefined;
	}
	const hint = expectString(value, path);
	switch (hint) {
		case "momentary":
		case "latching":
		case "momentary-or-latching":
		case "continuous":
			return hint;
		default:
			throw new Error(
				`${path}: expected momentary, latching, momentary-or-latching, or continuous`,
			);
	}
}

function parseOptionalControlInterfacePolarity(
	value: YamlValue | undefined,
	path: string,
): ControlInterfacePolarity | undefined {
	if (value === undefined) {
		return undefined;
	}
	const polarity = expectString(value, path);
	switch (polarity) {
		case "normally-open":
		case "normally-closed":
		case "expression":
		case "unknown":
			return polarity;
		default:
			throw new Error(
				`${path}: expected normally-open, normally-closed, expression, or unknown`,
			);
	}
}

function parseYamlSubset(source: string): YamlValue {
	const lines = tokenize(source);
	if (lines.length === 0) {
		throw new Error("interchange YAML is empty");
	}
	const cursor: Cursor = { index: 0 };
	const first = lines[0];
	if (first === undefined) {
		throw new Error("interchange YAML is empty");
	}
	const value = parseBlock(lines, cursor, first.indent);
	if (cursor.index < lines.length) {
		const line = lines[cursor.index];
		throw new Error(
			`line ${line?.lineNumber ?? cursor.index + 1}: unexpected trailing content`,
		);
	}
	return value;
}

function tokenize(source: string): readonly YamlLine[] {
	const lines: YamlLine[] = [];
	const rawLines = source.replace(/^﻿/, "").split(/\r?\n/);
	rawLines.forEach((rawLine, index) => {
		if (rawLine.trim().length === 0) {
			return;
		}
		const indentText = rawLine.match(/^\s*/)?.[0] ?? "";
		if (indentText.includes("\t")) {
			throw new Error(
				`line ${index + 1}: tabs are not supported in interchange YAML`,
			);
		}
		lines.push({
			indent: indentText.length,
			text: rawLine.slice(indentText.length),
			lineNumber: index + 1,
		});
	});
	return lines;
}

function parseBlock(
	lines: readonly YamlLine[],
	cursor: Cursor,
	indent: number,
): YamlValue {
	const line = lines[cursor.index];
	if (line === undefined) {
		return {};
	}
	if (line.indent !== indent) {
		throw new Error(
			`line ${line.lineNumber}: expected indentation ${indent}, got ${line.indent}`,
		);
	}
	if (line.text === "-" || line.text.startsWith("- ")) {
		return parseArray(lines, cursor, indent);
	}
	return parseObject(lines, cursor, indent);
}

function assignUniqueKey(out: YamlObject, key: string, value: YamlValue): void {
	if (Object.hasOwn(out, key)) {
		throw new Error(`duplicate mapping key "${key}"`);
	}
	out[key] = value;
}

function parseObject(
	lines: readonly YamlLine[],
	cursor: Cursor,
	indent: number,
): YamlObject {
	const out: YamlObject = {};
	while (cursor.index < lines.length) {
		const line = lines[cursor.index];
		if (line === undefined || line.indent < indent) {
			break;
		}
		if (line.indent > indent) {
			throw new Error(
				`line ${line.lineNumber}: unexpected indentation ${line.indent}`,
			);
		}
		if (line.text === "-" || line.text.startsWith("- ")) {
			break;
		}

		const pair = parsePair(line.text, line.lineNumber);
		cursor.index += 1;
		assignUniqueKey(
			out,
			pair.key,
			pair.rest.length > 0
				? parseInlineValue(pair.rest, line.lineNumber)
				: parseNestedValue(lines, cursor, indent, line.lineNumber),
		);
	}
	return out;
}

function parseArray(
	lines: readonly YamlLine[],
	cursor: Cursor,
	indent: number,
): readonly YamlValue[] {
	const out: YamlValue[] = [];
	while (cursor.index < lines.length) {
		const line = lines[cursor.index];
		if (line === undefined || line.indent < indent) {
			break;
		}
		if (line.indent > indent) {
			throw new Error(
				`line ${line.lineNumber}: unexpected indentation ${line.indent}`,
			);
		}
		if (line.text !== "-" && !line.text.startsWith("- ")) {
			break;
		}

		const rest = line.text === "-" ? "" : line.text.slice(2);
		cursor.index += 1;
		if (rest.length === 0) {
			out.push(parseNestedValue(lines, cursor, indent, line.lineNumber));
		} else if (looksLikePair(rest)) {
			out.push(
				parseObjectItem(rest, lines, cursor, indent + 2, line.lineNumber),
			);
		} else {
			out.push(parseInlineValue(rest, line.lineNumber));
		}
	}
	return out;
}

function parseObjectItem(
	firstPairText: string,
	lines: readonly YamlLine[],
	cursor: Cursor,
	indent: number,
	lineNumber: number,
): YamlObject {
	const out: YamlObject = {};
	const firstPair = parsePair(firstPairText, lineNumber);
	assignUniqueKey(
		out,
		firstPair.key,
		firstPair.rest.length > 0
			? parseInlineValue(firstPair.rest, lineNumber)
			: parseNestedValue(lines, cursor, indent, lineNumber),
	);

	while (cursor.index < lines.length) {
		const line = lines[cursor.index];
		if (line === undefined || line.indent < indent) {
			break;
		}
		if (line.indent > indent) {
			throw new Error(
				`line ${line.lineNumber}: unexpected indentation ${line.indent}`,
			);
		}
		if (line.text === "-" || line.text.startsWith("- ")) {
			break;
		}

		const pair = parsePair(line.text, line.lineNumber);
		cursor.index += 1;
		assignUniqueKey(
			out,
			pair.key,
			pair.rest.length > 0
				? parseInlineValue(pair.rest, line.lineNumber)
				: parseNestedValue(lines, cursor, indent, line.lineNumber),
		);
	}

	return out;
}

function parseNestedValue(
	lines: readonly YamlLine[],
	cursor: Cursor,
	parentIndent: number,
	lineNumber: number,
): YamlValue {
	const next = lines[cursor.index];
	if (next === undefined || next.indent <= parentIndent) {
		return {};
	}
	if (next.indent !== parentIndent + 2) {
		throw new Error(
			`line ${next.lineNumber}: expected indentation ${parentIndent + 2} after line ${lineNumber}`,
		);
	}
	return parseBlock(lines, cursor, next.indent);
}

function parsePair(text: string, lineNumber: number): ParsedPair {
	const colonIndex = findPairColon(text);
	if (colonIndex <= 0) {
		throw new Error(`line ${lineNumber}: expected key/value pair`);
	}
	const keyText = text.slice(0, colonIndex);
	const restText = text.slice(colonIndex + 1);
	return {
		key: parseKey(keyText, lineNumber),
		rest: restText.startsWith(" ") ? restText.slice(1) : restText,
	};
}

function looksLikePair(text: string): boolean {
	return findPairColon(text) > 0;
}

function findPairColon(text: string): number {
	if (text.startsWith('"')) {
		const end = findJsonStringEnd(text);
		return end >= 0 && text[end + 1] === ":" ? end + 1 : -1;
	}
	return text.indexOf(":");
}

function findJsonStringEnd(text: string): number {
	let escaped = false;
	for (let index = 1; index < text.length; index += 1) {
		const char = text[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			return index;
		}
	}
	return -1;
}

function parseKey(text: string, lineNumber: number): string {
	if (!text.startsWith('"')) {
		return text;
	}
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed === "string") {
			return parsed;
		}
	} catch {
		// Fall through to the consistent parser error below.
	}
	throw new Error(`line ${lineNumber}: invalid quoted key`);
}

function parseInlineValue(text: string, lineNumber: number): YamlValue {
	if (text === "[]") {
		return [];
	}
	if (text === "{}") {
		return {};
	}
	if (text === "null") {
		return null;
	}
	if (text === "true") {
		return true;
	}
	if (text === "false") {
		return false;
	}
	if (text.startsWith('"')) {
		try {
			const parsed = JSON.parse(text);
			if (typeof parsed === "string") {
				return parsed;
			}
		} catch {
			// Fall through to the consistent parser error below.
		}
		throw new Error(`line ${lineNumber}: invalid quoted scalar`);
	}
	if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
		return Number(text);
	}
	return text;
}

function parseMetadata(
	value: YamlValue | undefined,
): CircuitDocument["metadata"] {
	const metadata = optionalObject(value, "metadata");
	return {
		name: scalarText(metadata.name),
		description: scalarText(metadata.description),
		partNumber: scalarText(metadata.partNumber),
	};
}

function parseSource(value: YamlValue | undefined): DocumentSource {
	return parseStringRecord(value, "source");
}

function parsePanel(
	value: YamlValue | undefined,
	allowV3PhysicalFields: boolean,
): PanelPlacementMetadata | undefined {
	if (value === undefined) {
		return undefined;
	}
	const panel = expectObject(value, "panel");

	if (panel.faces !== undefined) {
		return {
			faces: optionalArray(panel.faces, "panel.faces").map((item, index) =>
				parsePanelFace(item, index, allowV3PhysicalFields),
			),
		};
	}

	if (panel.layout === undefined) {
		return undefined;
	}

	const layout = parsePanelLayout(panel.layout, "panel.layout");
	const elementsValue = panel.controls ?? panel.elements;
	const elementsPath =
		panel.controls === undefined ? "panel.elements" : "panel.controls";
	return {
		faces: [
			{
				id: "top",
				layout,
				elements: parsePanelElements(
					elementsValue,
					layout,
					elementsPath,
					allowV3PhysicalFields,
				),
			},
		],
	};
}

function parsePanelFace(
	value: YamlValue,
	index: number,
	allowV3PhysicalFields: boolean,
): PanelPlacementMetadata["faces"][number] {
	const path = `panel.faces[${index}]`;
	const face = expectObject(value, path);
	const label = parseOptionalString(face.label, `${path}.label`);
	const layout = parsePanelLayout(face.layout, `${path}.layout`);
	if (!allowV3PhysicalFields && face.geometry !== undefined) {
		throw new Error(
			`${path}.geometry: requires schema ${INTERCHANGE_SCHEMA_V3}`,
		);
	}
	const geometry = allowV3PhysicalFields
		? parseOptionalPanelFaceGeometry(face.geometry, `${path}.geometry`)
		: undefined;
	return {
		id: expectString(face.id, `${path}.id`),
		...(label === undefined ? {} : { label }),
		layout,
		...(geometry === undefined ? {} : { geometry }),
		elements: parsePanelElements(
			face.elements,
			layout,
			`${path}.elements`,
			allowV3PhysicalFields,
		),
	};
}

function parsePanelLayout(
	value: YamlValue | undefined,
	path: string,
): PanelGridLayout {
	const layout = expectObject(value, path);
	const rowOrder = parseOptionalPanelRowOrder(
		layout.rowOrder,
		`${path}.rowOrder`,
	);
	const columnOrder = parseOptionalPanelColumnOrder(
		layout.columnOrder,
		`${path}.columnOrder`,
	);
	return {
		kind: parsePanelLayoutKind(layout.kind, `${path}.kind`),
		rows: expectPositiveInteger(layout.rows, `${path}.rows`),
		columns: expectPositiveInteger(layout.columns, `${path}.columns`),
		indexing: parsePanelGridIndexing(layout.indexing, `${path}.indexing`),
		...(rowOrder === undefined ? {} : { rowOrder }),
		...(columnOrder === undefined ? {} : { columnOrder }),
	};
}

function parsePanelElements(
	value: YamlValue | undefined,
	layout: PanelGridLayout,
	path: string,
	allowV3PhysicalFields: boolean,
): PanelPlacementMetadata["faces"][number]["elements"] {
	return optionalArray(value, path).map((item, index) => {
		const elementPath = `${path}[${index}]`;
		const element = expectObject(item, elementPath);
		const label = parseOptionalString(element.label, `${elementPath}.label`);
		const interfaceControlId = parseOptionalString(
			element.interfaceControlId,
			`${elementPath}.interfaceControlId`,
		);
		if (!allowV3PhysicalFields && element.id !== undefined) {
			throw new Error(
				`${elementPath}.id: requires schema ${INTERCHANGE_SCHEMA_V3}`,
			);
		}
		if (!allowV3PhysicalFields && element.physical !== undefined) {
			throw new Error(
				`${elementPath}.physical: requires schema ${INTERCHANGE_SCHEMA_V3}`,
			);
		}
		const id = allowV3PhysicalFields
			? parseOptionalString(element.id, `${elementPath}.id`)
			: undefined;
		const physical = allowV3PhysicalFields
			? parseOptionalPanelElementPhysical(
					element.physical,
					`${elementPath}.physical`,
				)
			: undefined;
		return {
			...(id === undefined ? {} : { id }),
			bind: parsePanelElementBinding(element, elementPath),
			kind: parsePanelControlKind(
				element.kind ?? element.controlKind,
				element.kind === undefined && element.controlKind !== undefined
					? `${elementPath}.controlKind`
					: `${elementPath}.kind`,
			),
			grid: parsePanelGridPosition(element.grid, `${elementPath}.grid`, layout),
			...(label === undefined ? {} : { label }),
			...(interfaceControlId === undefined ? {} : { interfaceControlId }),
			...(physical === undefined ? {} : { physical }),
		};
	});
}

function parseOptionalPanelFaceGeometry(
	value: YamlValue | undefined,
	path: string,
): PanelFaceGeometry | undefined {
	if (value === undefined) {
		return undefined;
	}
	const geometry = expectObject(value, path);
	return {
		...parseBuildDataObject(geometry, path),
		...(geometry.units === undefined
			? {}
			: { units: expectString(geometry.units, `${path}.units`) }),
		...(geometry.surface === undefined
			? {}
			: { surface: expectString(geometry.surface, `${path}.surface`) }),
		...(geometry.usableRectMm === undefined
			? {}
			: {
					usableRectMm: parseMillimeterRect(
						geometry.usableRectMm,
						`${path}.usableRectMm`,
					),
				}),
	};
}

function parseOptionalPanelElementPhysical(
	value: YamlValue | undefined,
	path: string,
): PanelElementPhysicalPlacement | undefined {
	if (value === undefined) {
		return undefined;
	}
	const physical = expectObject(value, path);
	return {
		...parseBuildDataObject(physical, path),
		...(physical.units === undefined
			? {}
			: { units: expectString(physical.units, `${path}.units`) }),
		...(physical.centerMm === undefined
			? {}
			: { centerMm: parsePoint(physical.centerMm, `${path}.centerMm`) }),
		...(physical.drillDiameterMm === undefined
			? {}
			: {
					drillDiameterMm: expectNumber(
						physical.drillDiameterMm,
						`${path}.drillDiameterMm`,
					),
				}),
		...(physical.partProfileId === undefined
			? {}
			: {
					partProfileId: expectString(
						physical.partProfileId,
						`${path}.partProfileId`,
					),
				}),
		...(physical.locked === undefined
			? {}
			: { locked: expectBoolean(physical.locked, `${path}.locked`) }),
		...(physical.mountId === undefined
			? {}
			: { mountId: expectString(physical.mountId, `${path}.mountId`) }),
		...(physical.surface === undefined
			? {}
			: { surface: expectString(physical.surface, `${path}.surface`) }),
	};
}

function parseMillimeterRect(value: YamlValue | undefined, path: string) {
	const rect = expectObject(value, path);
	return {
		x: expectNumber(rect.x, `${path}.x`),
		y: expectNumber(rect.y, `${path}.y`),
		width: expectNumber(rect.width, `${path}.width`),
		height: expectNumber(rect.height, `${path}.height`),
	};
}

function parsePanelElementBinding(
	element: YamlObject,
	path: string,
): PanelElementBinding {
	if (element.bind !== undefined) {
		const bind = expectObject(element.bind, `${path}.bind`);
		const controlId = parseOptionalString(
			bind.controlId,
			`${path}.bind.controlId`,
		);
		const controlName = parseOptionalString(
			bind.controlName,
			`${path}.bind.controlName`,
		);
		const property = parseOptionalString(
			bind.property,
			`${path}.bind.property`,
		);
		return {
			componentId: expectString(bind.componentId, `${path}.bind.componentId`),
			...(controlId === undefined ? {} : { controlId }),
			...(controlName === undefined ? {} : { controlName }),
			...(property === undefined ? {} : { property }),
		};
	}

	return {
		componentId: expectString(element.componentId, `${path}.componentId`),
	};
}

function parsePanelGridPosition(
	value: YamlValue | undefined,
	path: string,
	layout: PanelGridLayout,
): PanelGridPosition {
	const grid = expectObject(value, path);
	const rowSpan = parseOptionalPositiveInteger(grid.rowSpan, `${path}.rowSpan`);
	const columnSpan = parseOptionalPositiveInteger(
		grid.columnSpan,
		`${path}.columnSpan`,
	);
	const row = expectNonNegativeInteger(grid.row, `${path}.row`);
	const column = expectNonNegativeInteger(grid.column, `${path}.column`);
	validateGridAxis(
		row,
		rowSpan ?? 1,
		layout.rows,
		layout.indexing,
		`${path}.row`,
		"row",
	);
	validateGridAxis(
		column,
		columnSpan ?? 1,
		layout.columns,
		layout.indexing,
		`${path}.column`,
		"column",
	);
	return {
		row,
		column,
		...(rowSpan === undefined ? {} : { rowSpan }),
		...(columnSpan === undefined ? {} : { columnSpan }),
	};
}

function validateGridAxis(
	value: number,
	span: number,
	size: number,
	indexing: PanelGridIndexing,
	path: string,
	axisName: "row" | "column",
): void {
	const min = indexing === "one-based" ? 1 : 0;
	const occupiedEnd =
		indexing === "one-based" ? value + span - 1 : value + span;
	if (value < min || occupiedEnd > size) {
		const maxLabel = indexing === "one-based" ? String(size) : String(size - 1);
		throw new Error(
			`${path}: expected ${indexing} ${axisName} coordinate within ${min}..${maxLabel}`,
		);
	}
}

function parsePanelLayoutKind(
	value: YamlValue | undefined,
	path: string,
): "stompbox-grid" {
	const kind = expectString(value, path);
	if (kind === "stompbox-grid") {
		return kind;
	}
	throw new Error(`${path}: expected stompbox-grid`);
}

function parsePanelGridIndexing(
	value: YamlValue | undefined,
	path: string,
): PanelGridIndexing {
	const indexing = expectString(value, path);
	if (indexing === "one-based" || indexing === "zero-based") {
		return indexing;
	}
	throw new Error(`${path}: expected one-based or zero-based`);
}

function parseOptionalPanelRowOrder(
	value: YamlValue | undefined,
	path: string,
): PanelRowOrder | undefined {
	if (value === undefined) {
		return undefined;
	}
	const order = expectString(value, path);
	if (order === "top-to-bottom" || order === "bottom-to-top") {
		return order;
	}
	throw new Error(`${path}: expected top-to-bottom or bottom-to-top`);
}

function parseOptionalPanelColumnOrder(
	value: YamlValue | undefined,
	path: string,
): PanelColumnOrder | undefined {
	if (value === undefined) {
		return undefined;
	}
	const order = expectString(value, path);
	if (order === "left-to-right" || order === "right-to-left") {
		return order;
	}
	throw new Error(`${path}: expected left-to-right or right-to-left`);
}

function parsePanelControlKind(
	value: YamlValue | undefined,
	path: string,
): PanelControlKind {
	const kind = expectString(value, path);
	switch (kind) {
		case "knob":
		case "slider":
		case "switch":
		case "selector":
		case "footswitch":
		case "led":
		case "display":
		case "jack":
			return kind;
		default:
			throw new Error(
				`${path}: expected knob, slider, switch, selector, footswitch, led, display, or jack`,
			);
	}
}

function parseComponents(
	value: YamlValue | undefined,
	warnings: Warning[],
): readonly Component[] {
	return optionalArray(value, "components").map((item, index) => {
		const path = `components[${index}]`;
		const component = expectObject(item, path);
		const id = expectString(component.id, `${path}.id`);
		const sourceTypeName = parseNullableString(
			component.sourceTypeName,
			`${path}.sourceTypeName`,
		);
		collectSourceTypeNameWarnings(id, sourceTypeName, warnings);
		const parsed: Component = {
			id,
			kind: parseComponentKind(component.kind, `${path}.kind`),
			name: expectString(component.name, `${path}.name`),
			origin: parsePoint(component.origin, `${path}.origin`),
			rotation: parseRotation(component.rotation, `${path}.rotation`),
			flipped: expectBoolean(component.flipped, `${path}.flipped`),
			terminals: parseTerminals(component.terminals, `${path}.terminals`),
			properties: parseProperties(component.properties, `${path}.properties`),
			sourceTypeName,
		};
		collectTerminalRoleWarnings(parsed, warnings);
		return parsed;
	});
}

/**
 * Report a `sourceTypeName` outside the supported vocabulary.
 *
 * The value is never rewritten. Every consumer matches this field exactly, so an
 * unrecognised spelling is a component that silently fails to resolve, and until now
 * nothing said so -- the field is typed `string | null` and parsed straight through.
 * Warning rather than throwing keeps existing documents readable while making the
 * drift visible; the survey behind the vocabulary found 107 distinct values in one
 * corpus for roughly 40 concepts.
 */
/**
 * Report potentiometer terminal names that carry no sweep direction.
 *
 * Lug numbers and spelling variants resolve silently -- the common cases should cost
 * an author nothing. Only an under-specified or unrecognised token is reported, and
 * the name is never rewritten, so a document that means `ccw` but says `a` stays
 * readable while the gap becomes visible.
 */
function collectTerminalRoleWarnings(
	component: Component,
	warnings: Warning[],
): void {
	const resolution = resolvePotentiometerTerminalRoles(component);
	if (resolution === null) return;
	warnings.push(...resolution.diagnostics);
}

function collectSourceTypeNameWarnings(
	componentId: string,
	sourceTypeName: string | null,
	warnings: Warning[],
): void {
	const verdict = classifySourceTypeName(sourceTypeName);
	if (verdict === null || verdict.status === "supported") {
		return;
	}
	if (verdict.status === "alias") {
		warnings.push({
			code: "source-type-name-alias",
			message: `sourceTypeName "${sourceTypeName}" is a non-canonical spelling; use "${verdict.canonical}".`,
			componentId,
		});
		return;
	}
	if (verdict.status === "modelling-intent") {
		warnings.push({
			code: "source-type-name-not-a-device-class",
			message: `sourceTypeName "${sourceTypeName}" records what a consumer does with this component, not what it is, so it cannot identify a device. State the device class; let the boundary that owns a region declare what it encloses.`,
			componentId,
		});
		return;
	}
	warnings.push({
		code: "source-type-name-unsupported",
		message: `sourceTypeName "${sourceTypeName}" is not a supported source type.`,
		componentId,
	});
}

function parseTerminals(
	value: YamlValue | undefined,
	path: string,
): readonly Terminal[] {
	return optionalArray(value, path).map((item, index) => {
		const terminalPath = `${path}[${index}]`;
		const terminal = expectObject(item, terminalPath);
		return {
			name: expectString(terminal.name, `${terminalPath}.name`),
			position: parsePoint(terminal.position, `${terminalPath}.position`),
		};
	});
}

function parseProperties(
	value: YamlValue | undefined,
	path: string,
): Readonly<Record<string, PropertyValue>> {
	const properties = optionalObject(value, path);
	const out: Record<string, PropertyValue> = {};
	for (const [key, child] of Object.entries(properties)) {
		out[key] = parsePropertyValue(child, `${path}.${key}`);
	}
	return out;
}

function parsePropertyValue(value: YamlValue, path: string): PropertyValue {
	if (isParsedQuantityValue(value)) {
		return {
			raw: expectString(value.raw, `${path}.raw`),
			value: expectNumber(value.value, `${path}.value`),
			unit: expectString(value.unit, `${path}.unit`),
		};
	}
	if (Array.isArray(value)) {
		return value.map((item, index) =>
			parsePropertyValue(item, `${path}[${index}]`),
		);
	}
	if (isYamlObject(value)) {
		const out: Record<string, PropertyValue> = {};
		for (const [key, child] of Object.entries(value)) {
			out[key] = parsePropertyValue(child, `${path}.${key}`);
		}
		return out;
	}
	if (isScalar(value)) {
		return value;
	}
	throw new Error(`${path}: expected scalar property value or parsed quantity`);
}

function isParsedQuantityValue(value: YamlValue): value is ParsedQuantity {
	return isParsedQuantity(value);
}

function parseWires(value: YamlValue | undefined): readonly Wire[] {
	return optionalArray(value, "wires").map((item, index) => {
		const path = `wires[${index}]`;
		const wire = expectObject(item, path);
		const points = expectArray(wire.points, `${path}.points`);
		if (points.length !== 2) {
			throw new Error(`${path}.points: expected exactly two points`);
		}
		const first = parsePoint(points[0], `${path}.points[0]`);
		const second = parsePoint(points[1], `${path}.points[1]`);
		return {
			id: expectString(wire.id, `${path}.id`),
			endpoints: [first, second],
		};
	});
}

function parseWarnings(value: YamlValue | undefined): readonly Warning[] {
	return optionalArray(value, "diagnostics").map((item, index) => {
		const path = `diagnostics[${index}]`;
		const warning = expectObject(item, path);
		const out: Warning = {
			code: expectString(warning.code, `${path}.code`),
			message: expectString(warning.message, `${path}.message`),
			...(warning.componentId === undefined
				? {}
				: {
						componentId: expectString(
							warning.componentId,
							`${path}.componentId`,
						),
					}),
			...(warning.wireId === undefined
				? {}
				: { wireId: expectString(warning.wireId, `${path}.wireId`) }),
		};
		return out;
	});
}

function parseStringArray(
	value: YamlValue | undefined,
	path: string,
): readonly string[] {
	return optionalArray(value, path).map((item, index) =>
		scalarText(item, `${path}[${index}]`),
	);
}

function parseStringRecord(
	value: YamlValue | undefined,
	path: string,
): Readonly<Record<string, string>> {
	const record = optionalObject(value, path);
	const out: Record<string, string> = {};
	for (const [key, child] of Object.entries(record)) {
		out[key] = scalarText(child, `${path}.${key}`);
	}
	return out;
}

function parsePoint(value: YamlValue | undefined, path: string): Point {
	const point = expectObject(value, path);
	return {
		x: expectNumber(point.x, `${path}.x`),
		y: expectNumber(point.y, `${path}.y`),
	};
}

function parseRotation(value: YamlValue | undefined, path: string): Rotation {
	const rotation = expectNumber(value, path);
	if (rotation === 0 || rotation === 1 || rotation === 2 || rotation === 3) {
		return rotation;
	}
	throw new Error(`${path}: expected rotation 0, 1, 2, or 3`);
}

function parseNullableString(
	value: YamlValue | undefined,
	path: string,
): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	return expectString(value, path);
}

function parseComponentKind(
	value: YamlValue | undefined,
	path: string,
): ComponentKind {
	const kind = expectString(value, path);
	switch (kind) {
		case "resistor":
		case "capacitor":
		case "inductor":
		case "diode":
		case "led":
		case "display":
		case "bjt":
		case "jfet":
		case "mosfet":
		case "opamp":
		case "ota":
		case "triode":
		case "pentode":
		case "tube-diode":
		case "transformer":
		case "potentiometer":
		case "variable-resistor":
		case "switch":
		case "optocoupler":
		case "voltage-source":
		case "current-source":
		case "battery":
		case "ground":
		case "rail":
		case "jack":
		case "bbd":
		case "delay-ic":
		case "power-amp":
		case "regulator":
		case "power-converter":
		case "analog-switch":
		case "flipflop":
		case "ic":
		case "label":
		case "named-wire":
		case "port":
		case "unsupported":
			return kind;
		default:
			throw new Error(`${path}: unsupported component kind "${kind}"`);
	}
}

function optionalObject(
	value: YamlValue | undefined,
	path: string,
): YamlObject {
	if (value === undefined) {
		return {};
	}
	return expectObject(value, path);
}

function optionalArray(
	value: YamlValue | undefined,
	path: string,
): readonly YamlValue[] {
	if (value === undefined) {
		return [];
	}
	return expectArray(value, path);
}

function expectObject(value: YamlValue | undefined, path: string): YamlObject {
	if (isYamlObject(value)) {
		return value;
	}
	throw new Error(`${path}: expected object`);
}

function expectArray(
	value: YamlValue | undefined,
	path: string,
): readonly YamlValue[] {
	if (Array.isArray(value)) {
		return value;
	}
	throw new Error(`${path}: expected array`);
}

function expectString(value: YamlValue | undefined, path: string): string {
	if (typeof value === "string") {
		return value;
	}
	throw new Error(`${path}: expected string`);
}

function expectNumber(value: YamlValue | undefined, path: string): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	throw new Error(`${path}: expected number`);
}

function expectPositiveInteger(
	value: YamlValue | undefined,
	path: string,
): number {
	const number = expectNumber(value, path);
	if (Number.isInteger(number) && number > 0) {
		return number;
	}
	throw new Error(`${path}: expected positive integer`);
}

function expectNonNegativeInteger(
	value: YamlValue | undefined,
	path: string,
): number {
	const number = expectNumber(value, path);
	if (Number.isInteger(number) && number >= 0) {
		return number;
	}
	throw new Error(`${path}: expected non-negative integer`);
}

function parseOptionalPositiveInteger(
	value: YamlValue | undefined,
	path: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	return expectPositiveInteger(value, path);
}

function parseOptionalNumber(
	value: YamlValue | undefined,
	path: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	return expectNumber(value, path);
}

function parseOptionalString(
	value: YamlValue | undefined,
	path: string,
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return expectString(value, path);
}

function parseOptionalStringArray(
	value: YamlValue | undefined,
	path: string,
): readonly string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return expectArray(value, path).map((item, index) =>
		expectString(item, `${path}[${index}]`),
	);
}

function parseOptionalBoolean(
	value: YamlValue | undefined,
	path: string,
): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	return expectBoolean(value, path);
}

function expectBoolean(value: YamlValue | undefined, path: string): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	throw new Error(`${path}: expected boolean`);
}

function scalarText(value: YamlValue | undefined, path = "value"): string {
	if (value === undefined || value === null) {
		return "";
	}
	if (isScalar(value)) {
		return String(value);
	}
	throw new Error(`${path}: expected scalar`);
}

function isScalar(value: YamlValue): value is YamlScalar {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function isYamlObject(value: YamlValue | undefined): value is YamlObject {
	return (
		value !== undefined &&
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value)
	);
}

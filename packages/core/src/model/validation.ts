import { propertyQuantityValue, propertyStringValue } from "./properties";
import { extractPanel } from "../panel/extract";
import type {
	BoardNet,
	BoardRealization,
	BoardRoute,
	BuildBomRef,
	CircuitDocument,
	Component,
	ComponentKind,
	ControlGroup,
	ControlGroupMember,
	DeviceInterfaceBinding,
	DeviceInterfaceControl,
	OffBoardSignalRef,
	OffBoardWiringEndpoint,
	PanelControlKind,
	PanelElementPhysicalPlacement,
	PanelElementPlacement,
	PanelFace,
	ParsedQuantity,
	PropertyValue,
	VdspBuildDataObject,
} from "./types";

export type ValidationSeverity = "error" | "warning";

export type ValidationCode =
	| "value-required"
	| "model-required"
	| "value-unparseable"
	| "value-out-of-range"
	| "unit-mismatch"
	| "unsupported-component"
	| "invalid-jack-role"
	| "invalid-jack-interface"
	| "invalid-jack-audio-role"
	| "descriptor-control-empty"
	| "descriptor-mode-label-mismatch"
	| "duplicate-device-interface-control-id"
	| "invalid-device-interface-token"
	| "control-group-context-unresolved"
	| "control-group-member-unresolved"
	| "control-group-member-context-unresolved"
	| "control-group-member-order-duplicate"
	| "device-interface-group-unresolved"
	| "device-interface-context-unresolved"
	| "device-interface-audio-binding-invalid"
	| "device-interface-binding-unresolved"
	| "device-interface-duplicate-role"
	| "panel-interface-control-unresolved"
	| "panel-binding-unresolved"
	| "panel-control-unresolved"
	| "panel-kind-mismatch"
	| "panel-cell-collision"
	| "panel-mount-orphan"
	| "panel-mount-inconsistent"
	| "build-board-unresolved"
	| "build-harness-unresolved"
	| "bom-ref-unresolved"
	| "offboard-endpoint-unresolved"
	| "offboard-signal-unresolved"
	| "board-source-hash-invalid"
	| "board-terminal-unresolved"
	| "board-route-feature-invalid"
	| "board-net-unrouted"
	| "duplicate-id"
	| "degenerate-wire";

export type ValidationIssue = Readonly<{
	code: ValidationCode;
	severity: ValidationSeverity;
	message: string;
	componentId?: string;
	property?: string;
	wireId?: string;
}>;

export type QuantityRule = Readonly<{
	kind: "quantity";
	name: string;
	required: boolean;
	aliases?: readonly string[];
	unit?: string;
	min?: number;
	max?: number;
}>;

export type StringRule = Readonly<{
	kind: "string";
	name: string;
	required: boolean;
	aliases?: readonly string[];
}>;

export type PropertyRule = QuantityRule | StringRule;

const MODEL_ALIASES = ["Model", "Type", "partNumber", "PartNumber"] as const;

// Short source-type names (last dotted segment) that represent an "ideal" component variant —
// no model name is required because the component is a mathematical abstraction.
const IDEAL_SOURCE_TYPES: ReadonlySet<string> = new Set(["IdealOpAmp"]);

// Per-kind property names that, if present, satisfy the "needs a model" requirement.
// LiveSPICE stores tube Koren parameters and opamp small-signal parameters inline; when those
// are present, the parameters ARE the model definition and no separate model name is needed.
const INLINE_MODEL_PARAMETERS: Partial<
	Record<ComponentKind, readonly string[]>
> = {
	opamp: ["Rin", "Rout", "Aol", "GBP", "SupplyVoltage"],
	triode: ["Mu", "K", "Kp", "Kvb", "Ex", "Kg"],
	pentode: ["Mu", "K", "Kp", "Kvb", "Ex", "Kg", "Kg1", "Kg2"],
};

const RUNTIME_DESCRIPTOR_CONTROL_PROPERTIES = [
	"TimeControl",
	"FeedbackControl",
	"MixControl",
	"LevelControl",
	"ToneControl",
	"ModRateControl",
	"ModDepthControl",
	"ModeControl",
	"TempoTapControl",
	"TapTempoControl",
	"TempoControl",
	"DirectOutputJack",
	"DirectOutJack",
	"DirectOutputControl",
	"DirectOutControl",
] as const;

type ResolvedPanelElement = Readonly<{
	id: string;
	componentId: string;
	kind: PanelControlKind;
}>;

const KIND_RULES: Partial<Record<ComponentKind, readonly PropertyRule[]>> = {
	resistor: [
		{
			kind: "quantity",
			name: "R",
			required: true,
			unit: "Ω",
			min: 1e-9,
			max: 1e9,
			aliases: ["Resistance", "resistance", "r"],
		},
	],
	"variable-resistor": [
		{
			kind: "quantity",
			name: "R",
			required: true,
			unit: "Ω",
			min: 1e-9,
			max: 1e9,
			aliases: ["Resistance", "resistance", "r"],
		},
	],
	potentiometer: [
		{
			kind: "quantity",
			name: "R",
			required: true,
			unit: "Ω",
			min: 1e-9,
			max: 1e9,
			aliases: ["Resistance", "totalResistance"],
		},
		{ kind: "string", name: "taper", required: false, aliases: ["Taper"] },
	],
	capacitor: [
		{
			kind: "quantity",
			name: "C",
			required: true,
			unit: "F",
			min: 1e-15,
			max: 1,
			aliases: ["Capacitance", "capacitance", "c"],
		},
	],
	inductor: [
		{
			kind: "quantity",
			name: "L",
			required: true,
			unit: "H",
			min: 1e-12,
			max: 100,
			aliases: ["Inductance", "inductance", "l"],
		},
	],
	"voltage-source": [
		{
			kind: "quantity",
			name: "V",
			required: true,
			unit: "V",
			aliases: ["Voltage", "voltage", "v"],
		},
	],
	"current-source": [
		{
			kind: "quantity",
			name: "I",
			required: true,
			unit: "A",
			aliases: ["Current", "current", "i"],
		},
	],
	battery: [
		{
			kind: "quantity",
			name: "V",
			required: true,
			unit: "V",
			aliases: ["Voltage", "voltage", "v"],
		},
	],
	rail: [
		{
			kind: "quantity",
			name: "V",
			required: true,
			unit: "V",
			aliases: ["Voltage", "voltage", "v"],
		},
	],
	diode: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	led: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	bjt: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	jfet: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	mosfet: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	opamp: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	triode: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	pentode: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	"tube-diode": [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	optocoupler: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	transformer: [
		{
			kind: "string",
			name: "model",
			required: false,
			aliases: [...MODEL_ALIASES],
		},
	],
	ota: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	bbd: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	"delay-ic": [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	"power-amp": [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	regulator: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	"analog-switch": [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	flipflop: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
	ic: [
		{
			kind: "string",
			name: "model",
			required: true,
			aliases: [...MODEL_ALIASES],
		},
	],
};

export function getRulesForKind(kind: ComponentKind): readonly PropertyRule[] {
	return KIND_RULES[kind] ?? [];
}

export function validateComponent(
	component: Component,
	rules: readonly PropertyRule[] = getRulesForKind(component.kind),
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const rule of rules) {
		const value = findProperty(component, rule);

		if (value === undefined) {
			if (rule.required && !isRequirementWaived(component, rule)) {
				issues.push(missingPropertyIssue(component, rule));
			}
			continue;
		}

		if (rule.kind === "string") {
			if (typeof value !== "string" || value.trim().length === 0) {
				if (rule.required && !isRequirementWaived(component, rule)) {
					issues.push(missingPropertyIssue(component, rule));
				}
			}
			continue;
		}

		const quantity = coerceQuantity(value);
		if (quantity === null) {
			if (typeof value === "string" && isRawQuantityExpression(value)) {
				continue;
			}
			issues.push({
				code: "value-unparseable",
				severity: "error",
				message: `${component.id}: property "${rule.name}" could not be parsed as a quantity`,
				componentId: component.id,
				property: rule.name,
			});
			continue;
		}

		if (
			rule.unit !== undefined &&
			rule.unit.length > 0 &&
			quantity.unit.length > 0 &&
			quantity.unit !== rule.unit
		) {
			issues.push({
				code: "unit-mismatch",
				severity: "warning",
				message: `${component.id}: property "${rule.name}" has unit "${quantity.unit}" but expected "${rule.unit}"`,
				componentId: component.id,
				property: rule.name,
			});
		}

		if (rule.min !== undefined && quantity.value < rule.min) {
			issues.push({
				code: "value-out-of-range",
				severity: "error",
				message: `${component.id}: property "${rule.name}" value ${quantity.value} is below minimum ${rule.min}`,
				componentId: component.id,
				property: rule.name,
			});
		}
		if (rule.max !== undefined && quantity.value > rule.max) {
			issues.push({
				code: "value-out-of-range",
				severity: "error",
				message: `${component.id}: property "${rule.name}" value ${quantity.value} is above maximum ${rule.max}`,
				componentId: component.id,
				property: rule.name,
			});
		}
	}

	return issues;
}

export function validateDocument(
	doc: CircuitDocument,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const seen = new Set<string>();

	for (const component of doc.components) {
		if (seen.has(component.id)) {
			issues.push({
				code: "duplicate-id",
				severity: "error",
				message: `Duplicate component id "${component.id}"`,
				componentId: component.id,
			});
		}
		seen.add(component.id);

		if (component.kind === "unsupported") {
			issues.push({
				code: "unsupported-component",
				severity: "warning",
				message: `${component.id}: unsupported source type ${component.sourceTypeName ?? "unknown"}`,
				componentId: component.id,
			});
			continue;
		}

		for (const issue of validateComponent(component)) {
			issues.push(issue);
		}

		for (const issue of validateSemanticMetadata(component)) {
			issues.push(issue);
		}
	}

	for (const wire of doc.wires) {
		const [a, b] = wire.endpoints;
		if (a.x === b.x && a.y === b.y) {
			issues.push({
				code: "degenerate-wire",
				severity: "warning",
				message: `Wire "${wire.id}" has identical endpoints`,
				wireId: wire.id,
			});
		}
	}

	for (const issue of validateDeviceInterface(doc, seen)) {
		issues.push(issue);
	}

	for (const issue of validatePanel(
		doc,
		seen,
		new Set(doc.deviceInterface?.controls.map((control) => control.id) ?? []),
	)) {
		issues.push(issue);
	}

	for (const issue of validateMountGroups(doc)) {
		issues.push(issue);
	}

	for (const issue of validateV3BuildMetadata(doc, seen)) {
		issues.push(issue);
	}

	return issues;
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}

function isRequirementWaived(
	component: Component,
	rule: PropertyRule,
): boolean {
	if (isInterfaceOnlyComponent(component)) {
		return true;
	}

	// Only the "model" string requirement has a waiver path today.
	if (rule.kind !== "string" || rule.name !== "model") {
		return false;
	}
	if (
		component.kind === "ic" &&
		component.properties.RuntimeDescriptor === "true"
	) {
		return true;
	}
	const shortType = shortSourceType(component.sourceTypeName);
	if (shortType !== null && IDEAL_SOURCE_TYPES.has(shortType)) {
		return true;
	}
	const inline = INLINE_MODEL_PARAMETERS[component.kind] ?? [];
	return inline.some((name) => component.properties[name] !== undefined);
}

function isInterfaceOnlyComponent(component: Component): boolean {
	const interfaceOnly = component.properties.InterfaceOnly;
	if (interfaceOnly === true) {
		return true;
	}
	if (
		typeof interfaceOnly === "string" &&
		normalizeToken(interfaceOnly) === "true"
	) {
		return true;
	}
	const support = component.properties.Support;
	return typeof support === "string" && normalizeToken(support) === "view-only";
}

function validateSemanticMetadata(
	component: Component,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (component.kind === "jack") {
		issues.push(...validateJackSemanticMetadata(component));
	}

	if (
		component.kind === "ic" &&
		component.properties.RuntimeDescriptor === "true"
	) {
		issues.push(...validateRuntimeDescriptorMetadata(component));
	}

	return issues;
}

function validateJackSemanticMetadata(
	component: Component,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const property of ["Role", "ControlRole"] as const) {
		const value = propertyString(component, property);
		if (
			value !== null &&
			value.trim().length > 0 &&
			!isRecognizedJackRole(value)
		) {
			issues.push({
				code: "invalid-jack-role",
				severity: "warning",
				message: `${component.id}: jack ${property} "${value}" is not a recognized panel role`,
				componentId: component.id,
				property,
			});
		}
	}

	const interfaceName = propertyString(component, "Interface");
	if (
		interfaceName !== null &&
		interfaceName.trim().length > 0 &&
		!isRecognizedJackInterface(interfaceName)
	) {
		issues.push({
			code: "invalid-jack-interface",
			severity: "warning",
			message: `${component.id}: jack Interface "${interfaceName}" is not a recognized panel interface`,
			componentId: component.id,
			property: "Interface",
		});
	}

	const audioRole = propertyString(component, "AudioRole");
	if (audioRole !== null && !isValidJackAudioRole(audioRole)) {
		issues.push({
			code: "invalid-jack-audio-role",
			severity: "warning",
			message: `${component.id}: jack AudioRole "${audioRole}" must be a lower-kebab source subtype slug`,
			componentId: component.id,
			property: "AudioRole",
		});
	}

	return issues;
}

function validateRuntimeDescriptorMetadata(
	component: Component,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const property of RUNTIME_DESCRIPTOR_CONTROL_PROPERTIES) {
		const value = propertyString(component, property);
		if (value !== null && value.trim().length === 0) {
			issues.push({
				code: "descriptor-control-empty",
				severity: "warning",
				message: `${component.id}: runtime descriptor property "${property}" must not be empty`,
				componentId: component.id,
				property,
			});
		}
	}

	const labels = parseStringList(
		propertyStringAny(component, ["ModeLabels", "ModeOptions"]),
	);
	const stepCount = parsePositiveInteger(
		propertyStringAny(component, ["ModeStepCount", "ModeSteps", "ModeCount"]),
	);
	if (
		labels.length > 0 &&
		stepCount !== undefined &&
		labels.length !== stepCount
	) {
		issues.push({
			code: "descriptor-mode-label-mismatch",
			severity: "warning",
			message: `${component.id}: ModeLabels has ${labels.length} labels but ModeStepCount is ${stepCount}`,
			componentId: component.id,
			property: "ModeLabels",
		});
	}

	return issues;
}

function shortSourceType(sourceTypeName: string | null): string | null {
	if (sourceTypeName === null) {
		return null;
	}
	const head = sourceTypeName.split(",")[0]?.trim() ?? "";
	if (head.length === 0) {
		return null;
	}
	const lastDot = head.lastIndexOf(".");
	return lastDot >= 0 ? head.slice(lastDot + 1) : head;
}

function findProperty(
	component: Component,
	rule: PropertyRule,
): PropertyValue | undefined {
	const candidates = [rule.name, ...(rule.aliases ?? [])];
	for (const name of candidates) {
		const value = component.properties[name];
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

function propertyString(component: Component, name: string): string | null {
	return propertyStringValue(component.properties[name]);
}

function propertyStringAny(
	component: Component,
	names: readonly string[],
): string | null {
	for (const name of names) {
		const value = propertyString(component, name);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function coerceQuantity(value: PropertyValue): ParsedQuantity | null {
	return propertyQuantityValue(value);
}

function isRawQuantityExpression(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return false;
	}
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return true;
	}
	return (
		/^(AC|DC)\b/i.test(trimmed) ||
		/^(SINE|PULSE|PWL|EXP|SFFM|AM|WAVEFILE)\s*\(/i.test(trimmed)
	);
}

function isRecognizedJackRole(value: string): boolean {
	const normalized = normalizeToken(value);
	return [
		"input",
		"audio-input",
		"in",
		"direct-output",
		"direct-out",
		"dry-output",
		"dry-out",
		"output",
		"audio-output",
		"out",
		"send",
		"return",
		"expression",
		"exp",
		"expression-pedal",
		"tempo-tap",
		"tap-tempo",
		"tempo-in",
		"tap",
		"tempo",
		"external-control",
		"external-control-input",
		"control-input",
		"remote",
		"footswitch",
		"trigger",
		"reset",
	].includes(normalized);
}

function isRecognizedJackInterface(value: string): boolean {
	const normalized = normalizeToken(value);
	return (
		isRecognizedJackRole(value) ||
		[
			"audio",
			"audio-port",
			"control",
			"control-port",
			"power",
			"power-port",
			"dc-power",
			"dc-power-input",
			"tap-tempo-input",
		].includes(normalized)
	);
}

function isValidJackAudioRole(value: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function parseStringList(value: string | null): readonly string[] {
	if (value === null) {
		return [];
	}
	return value
		.split(/[,;|]/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

function parsePositiveInteger(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}
	const trimmed = value.trim();
	if (!/^\d+(?:\.0+)?$/.test(trimmed)) {
		return undefined;
	}
	const count = Number(trimmed);
	return Number.isInteger(count) && count > 0 ? count : undefined;
}

function normalizeToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-");
}

function validateDeviceInterface(
	doc: CircuitDocument,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const groupIds = new Set(doc.controlGroups?.map((group) => group.id) ?? []);
	const contextIds = new Set(
		doc.controlContexts?.map((context) => context.id) ?? [],
	);
	const declaredControlIds = new Set(
		doc.deviceInterface?.controls.map((control) => control.id) ?? [],
	);
	const semanticControlIds = new Set<string>();
	const externalInterfaceIds = new Set(
		doc.controlInterfaces?.map((controlInterface) => controlInterface.id) ?? [],
	);
	const componentsById = new Map(
		doc.components.map((component) => [component.id, component]),
	);
	const resolvedPanelElements = resolvePanelElements(doc);

	for (const group of doc.controlGroups ?? []) {
		issues.push(...validateOpenToken(group.role, group.id, "role"));
		for (const contextId of group.contextIds ?? []) {
			if (!contextIds.has(contextId)) {
				issues.push({
					code: "control-group-context-unresolved",
					severity: "warning",
					message: `Control group "${group.id}" references missing context "${contextId}"`,
					componentId: group.id,
					property: "contextIds",
				});
			}
		}
		issues.push(
			...validateControlGroupMembers(group, declaredControlIds, contextIds),
		);
	}

	for (const context of doc.controlContexts ?? []) {
		issues.push(...validateOpenToken(context.role, context.id, "role"));
	}

	for (const control of doc.deviceInterface?.controls ?? []) {
		if (semanticControlIds.has(control.id)) {
			issues.push({
				code: "duplicate-device-interface-control-id",
				severity: "error",
				message: `Duplicate device interface control id "${control.id}"`,
				componentId: control.id,
			});
		}
		semanticControlIds.add(control.id);

		issues.push(...validateOpenToken(control.role, control.id, "role"));

		if (control.groupId !== undefined && !groupIds.has(control.groupId)) {
			issues.push({
				code: "device-interface-group-unresolved",
				severity: "warning",
				message: `Device interface control "${control.id}" references missing group "${control.groupId}"`,
				componentId: control.id,
				property: "groupId",
			});
		}

		issues.push(...validateApplicability(control, contextIds));
		issues.push(...validateDeviceInterfaceAudioBinding(control));

		if (control.binding !== undefined) {
			issues.push(
				...validateDeviceInterfaceBinding(
					control,
					control.binding,
					componentIds,
					externalInterfaceIds,
					componentsById,
					resolvedPanelElements,
				),
			);
		}
	}

	issues.push(
		...validateDuplicateDeviceInterfaceRoles(
			doc.deviceInterface?.controls ?? [],
			doc.controlGroups ?? [],
		),
	);

	return issues;
}

function validateControlGroupMembers(
	group: ControlGroup,
	controlIds: ReadonlySet<string>,
	contextIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const orderOwners = new Map<number, string>();

	for (const member of group.members ?? []) {
		if (!controlIds.has(member.controlId)) {
			issues.push({
				code: "control-group-member-unresolved",
				severity: "warning",
				message: `Control group "${group.id}" references missing member control "${member.controlId}"`,
				componentId: group.id,
				property: "members.controlId",
			});
		}

		if (member.order !== undefined) {
			const existingControlId = orderOwners.get(member.order);
			if (existingControlId !== undefined) {
				issues.push({
					code: "control-group-member-order-duplicate",
					severity: "warning",
					message: `Control group "${group.id}" assigns order ${member.order} to both "${existingControlId}" and "${member.controlId}"`,
					componentId: group.id,
					property: "members.order",
				});
			}
			orderOwners.set(member.order, member.controlId);
		}

		issues.push(
			...validateControlGroupMemberApplicability(group.id, member, contextIds),
		);
	}

	return issues;
}

function validateControlGroupMemberApplicability(
	groupId: string,
	member: ControlGroupMember,
	contextIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (member.appliesWhen === undefined) {
		return issues;
	}

	issues.push(
		...validateGroupMemberContextList(
			groupId,
			member,
			"members.appliesWhen.allOf",
			member.appliesWhen.allOf,
			contextIds,
		),
	);
	issues.push(
		...validateGroupMemberContextList(
			groupId,
			member,
			"members.appliesWhen.anyOf",
			member.appliesWhen.anyOf,
			contextIds,
		),
	);

	if (
		member.appliesWhen.allOf !== undefined &&
		member.appliesWhen.allOf.length === 0 &&
		member.appliesWhen.anyOf === undefined
	) {
		issues.push(
			emptyGroupMemberApplicabilityIssue(
				groupId,
				member.controlId,
				"members.appliesWhen.allOf",
			),
		);
	}
	if (
		member.appliesWhen.anyOf !== undefined &&
		member.appliesWhen.anyOf.length === 0 &&
		member.appliesWhen.allOf === undefined
	) {
		issues.push(
			emptyGroupMemberApplicabilityIssue(
				groupId,
				member.controlId,
				"members.appliesWhen.anyOf",
			),
		);
	}

	return issues;
}

function validateGroupMemberContextList(
	groupId: string,
	member: ControlGroupMember,
	property: string,
	values: readonly string[] | undefined,
	contextIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	if (values === undefined) {
		return [];
	}

	const issues: ValidationIssue[] = [];
	const seen = new Set<string>();
	if (values.length === 0) {
		issues.push(
			emptyGroupMemberApplicabilityIssue(groupId, member.controlId, property),
		);
	}

	for (const contextId of values) {
		if (seen.has(contextId)) {
			issues.push({
				code: "control-group-member-context-unresolved",
				severity: "warning",
				message: `Control group "${groupId}" member "${member.controlId}" repeats context "${contextId}" in ${property}`,
				componentId: groupId,
				property,
			});
		}
		seen.add(contextId);

		if (!contextIds.has(contextId)) {
			issues.push({
				code: "control-group-member-context-unresolved",
				severity: "warning",
				message: `Control group "${groupId}" member "${member.controlId}" references missing context "${contextId}"`,
				componentId: groupId,
				property,
			});
		}
	}

	return issues;
}

function emptyGroupMemberApplicabilityIssue(
	groupId: string,
	controlId: string,
	property: string,
): ValidationIssue {
	return {
		code: "control-group-member-context-unresolved",
		severity: "warning",
		message: `Control group "${groupId}" member "${controlId}" has empty ${property}; omit the predicate instead`,
		componentId: groupId,
		property,
	};
}

function validateOpenToken(
	value: string,
	componentId: string,
	property: string,
): readonly ValidationIssue[] {
	if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) {
		return [];
	}
	return [
		{
			code: "invalid-device-interface-token",
			severity: "warning",
			message: `${componentId}: ${property} "${value}" must be a lower-kebab token`,
			componentId,
			property,
		},
	];
}

function validateApplicability(
	control: DeviceInterfaceControl,
	contextIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (control.appliesWhen === undefined) {
		return issues;
	}

	issues.push(
		...validateContextList(
			control.id,
			"appliesWhen.allOf",
			control.appliesWhen.allOf,
			contextIds,
		),
	);
	issues.push(
		...validateContextList(
			control.id,
			"appliesWhen.anyOf",
			control.appliesWhen.anyOf,
			contextIds,
		),
	);

	if (
		control.appliesWhen.allOf !== undefined &&
		control.appliesWhen.allOf.length === 0 &&
		control.appliesWhen.anyOf === undefined
	) {
		issues.push(emptyApplicabilityIssue(control.id, "appliesWhen.allOf"));
	}
	if (
		control.appliesWhen.anyOf !== undefined &&
		control.appliesWhen.anyOf.length === 0 &&
		control.appliesWhen.allOf === undefined
	) {
		issues.push(emptyApplicabilityIssue(control.id, "appliesWhen.anyOf"));
	}

	return issues;
}

function validateContextList(
	controlId: string,
	property: string,
	values: readonly string[] | undefined,
	contextIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	if (values === undefined) {
		return [];
	}

	const issues: ValidationIssue[] = [];
	const seen = new Set<string>();
	if (values.length === 0) {
		issues.push(emptyApplicabilityIssue(controlId, property));
	}

	for (const contextId of values) {
		if (seen.has(contextId)) {
			issues.push({
				code: "device-interface-context-unresolved",
				severity: "warning",
				message: `Device interface control "${controlId}" repeats context "${contextId}" in ${property}`,
				componentId: controlId,
				property,
			});
		}
		seen.add(contextId);

		if (!contextIds.has(contextId)) {
			issues.push({
				code: "device-interface-context-unresolved",
				severity: "warning",
				message: `Device interface control "${controlId}" references missing context "${contextId}"`,
				componentId: controlId,
				property,
			});
		}
	}

	return issues;
}

function emptyApplicabilityIssue(
	controlId: string,
	property: string,
): ValidationIssue {
	return {
		code: "device-interface-context-unresolved",
		severity: "warning",
		message: `Device interface control "${controlId}" has empty ${property}; omit the predicate instead`,
		componentId: controlId,
		property,
	};
}

function validateDeviceInterfaceAudioBinding(
	control: DeviceInterfaceControl,
): readonly ValidationIssue[] {
	if (control.audioBinding === undefined) {
		return [];
	}
	if (control.audioBinding.kind !== "control") {
		return [{
			code: "device-interface-audio-binding-invalid",
			severity: "error",
			message: `Device interface control "${control.id}" has unsupported audio binding kind "${control.audioBinding.kind}"`,
			componentId: control.id,
			property: "audioBinding.kind",
		}];
	}
	if (control.audioBinding.controlName.trim().length === 0) {
		return [{
			code: "device-interface-audio-binding-invalid",
			severity: "error",
			message: `Device interface control "${control.id}" has an empty audio binding controlName`,
			componentId: control.id,
			property: "audioBinding.controlName",
		}];
	}
	return [];
}

function validateDeviceInterfaceBinding(
	control: DeviceInterfaceControl,
	binding: DeviceInterfaceBinding,
	componentIds: ReadonlySet<string>,
	externalInterfaceIds: ReadonlySet<string>,
	componentsById: ReadonlyMap<string, Component>,
	resolvedPanelElements: readonly ResolvedPanelElement[],
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (
		binding.externalInterfaceId !== undefined &&
		!externalInterfaceIds.has(binding.externalInterfaceId)
	) {
		issues.push({
			code: "device-interface-binding-unresolved",
			severity: "warning",
			message: `Device interface control "${control.id}" references missing external interface "${binding.externalInterfaceId}"`,
			componentId: control.id,
			property: "binding.externalInterfaceId",
		});
	}

	if (!componentIds.has(binding.componentId)) {
		issues.push({
			code: "device-interface-binding-unresolved",
			severity: "warning",
			message: `Device interface control "${control.id}" references missing component "${binding.componentId}"`,
			componentId: control.id,
			property: "binding.componentId",
		});
		return issues;
	}

	if (
		binding.controlId !== undefined &&
		!resolvedPanelElements.some(
			(resolved) =>
				resolved.componentId === binding.componentId &&
				resolved.id === binding.controlId,
		)
	) {
		issues.push({
			code: "device-interface-binding-unresolved",
			severity: "warning",
			message: `Device interface control "${control.id}" references missing control "${binding.controlId}"`,
			componentId: control.id,
			property: "binding.controlId",
		});
	}

	const component = componentsById.get(binding.componentId);
	if (
		binding.property !== undefined &&
		component?.properties[binding.property] === undefined
	) {
		issues.push({
			code: "device-interface-binding-unresolved",
			severity: "warning",
			message: `Device interface control "${control.id}" references missing property "${binding.property}"`,
			componentId: control.id,
			property: "binding.property",
		});
	}

	return issues;
}

function validateDuplicateDeviceInterfaceRoles(
	controls: readonly DeviceInterfaceControl[],
	groups: readonly ControlGroup[],
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const layoutsByControlId = deviceInterfaceRoleLayoutsByControlId(groups);
	const seen = new Map<
		string,
		{ control: DeviceInterfaceControl; order?: number }
	>();
	for (const control of controls) {
		const layouts = layoutsByControlId.get(control.id) ?? [
			{ groupId: control.groupId ?? "", order: control.order },
		];
		for (const layout of layouts) {
			const key = `${layout.groupId}:${control.role}`;
			const existing = seen.get(key);
			if (
				existing !== undefined &&
				existing.order === undefined &&
				layout.order === undefined
			) {
				if (
					deviceInterfaceBindingSignature(existing.control.binding) ===
					deviceInterfaceBindingSignature(control.binding)
				) {
					issues.push({
						code: "device-interface-duplicate-role",
						severity: "warning",
						message: `Device interface controls "${existing.control.id}" and "${control.id}" share role "${control.role}" without order or distinct binding`,
						componentId: control.id,
						property: "role",
					});
				}
			}
			seen.set(key, {
				control,
				...(layout.order === undefined ? {} : { order: layout.order }),
			});
		}
	}
	return issues;
}

function deviceInterfaceRoleLayoutsByControlId(
	groups: readonly ControlGroup[],
): ReadonlyMap<string, readonly { groupId: string; order?: number }[]> {
	const layoutsByControlId = new Map<
		string,
		{ groupId: string; order?: number }[]
	>();
	for (const group of groups) {
		for (const member of group.members ?? []) {
			const layouts = layoutsByControlId.get(member.controlId) ?? [];
			layouts.push({
				groupId: group.id,
				...(member.order === undefined ? {} : { order: member.order }),
			});
			layoutsByControlId.set(member.controlId, layouts);
		}
	}
	return layoutsByControlId;
}

function deviceInterfaceBindingSignature(
	binding: DeviceInterfaceBinding | undefined,
): string {
	if (binding === undefined) {
		return "";
	}
	return [
		binding.componentId,
		binding.controlId ?? "",
		binding.controlName ?? "",
		binding.property ?? "",
		binding.externalInterfaceId ?? "",
	].join(":");
}

/**
 * Structural (catalog-free) validation of multi-surface part mounts, where
 * several placement elements share one physical part in one hole (e.g. a
 * concentric pot). Catches orphan bindings and inconsistent mount groups.
 * Surface-existence and completeness against the part catalog are validated
 * downstream in the stompbox build layer, which owns the part profiles.
 */
function validateMountGroups(doc: CircuitDocument): readonly ValidationIssue[] {
	if (doc.panel === undefined) {
		return [];
	}
	const issues: ValidationIssue[] = [];
	const groups = new Map<
		string,
		Array<{ componentId: string; physical: PanelElementPhysicalPlacement }>
	>();

	for (const face of doc.panel.faces) {
		for (const element of face.elements) {
			const physical = element.physical;
			if (physical === undefined) {
				continue;
			}
			const componentId = element.bind.componentId;
			if (physical.mountId === undefined) {
				if (physical.surface !== undefined) {
					issues.push({
						code: "panel-mount-orphan",
						severity: "warning",
						message: `Panel element for "${componentId}" sets physical.surface "${physical.surface}" without a mountId`,
						componentId,
					});
				}
				continue;
			}
			if (physical.surface === undefined) {
				issues.push({
					code: "panel-mount-orphan",
					severity: "warning",
					message: `Panel element for "${componentId}" joins mount "${physical.mountId}" without a surface`,
					componentId,
				});
			}
			if (physical.partProfileId === undefined) {
				issues.push({
					code: "panel-mount-orphan",
					severity: "warning",
					message: `Panel element for "${componentId}" joins mount "${physical.mountId}" without a partProfileId`,
					componentId,
				});
			}
			const members = groups.get(physical.mountId) ?? [];
			members.push({ componentId, physical });
			groups.set(physical.mountId, members);
		}
	}

	for (const [mountId, members] of groups) {
		const anchorId = members[0]?.componentId;
		const surfaces = new Set<string>();
		const partIds = new Set<string>();
		const centers = new Set<string>();
		for (const member of members) {
			const { surface, partProfileId, centerMm } = member.physical;
			if (surface !== undefined) {
				if (surfaces.has(surface)) {
					issues.push({
						code: "panel-mount-inconsistent",
						severity: "warning",
						message: `Mount "${mountId}" has duplicate surface "${surface}"`,
						componentId: member.componentId,
					});
				}
				surfaces.add(surface);
			}
			if (partProfileId !== undefined) {
				partIds.add(partProfileId);
			}
			if (centerMm !== undefined) {
				centers.add(`${centerMm.x},${centerMm.y}`);
			}
		}
		if (partIds.size > 1) {
			issues.push({
				code: "panel-mount-inconsistent",
				severity: "warning",
				message: `Mount "${mountId}" mixes part profiles: ${[...partIds].join(", ")}`,
				...(anchorId === undefined ? {} : { componentId: anchorId }),
			});
		}
		if (centers.size > 1) {
			issues.push({
				code: "panel-mount-inconsistent",
				severity: "warning",
				message: `Mount "${mountId}" members are not at one shared centerMm`,
				...(anchorId === undefined ? {} : { componentId: anchorId }),
			});
		}
	}

	return issues;
}

function validatePanel(
	doc: CircuitDocument,
	componentIds: ReadonlySet<string>,
	semanticControlIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	if (doc.panel === undefined) {
		return [];
	}

	const issues: ValidationIssue[] = [];
	const resolvedElements = resolvePanelElements(doc);

	for (const face of doc.panel.faces) {
		for (const element of face.elements) {
			const componentId = element.bind.componentId;
			if (
				element.interfaceControlId !== undefined &&
				!semanticControlIds.has(element.interfaceControlId)
			) {
				issues.push({
					code: "panel-interface-control-unresolved",
					severity: "warning",
					message: `Panel element on face "${face.id}" references missing interface control "${element.interfaceControlId}"`,
					componentId: element.interfaceControlId,
					property: "interfaceControlId",
				});
			}
			if (!componentIds.has(componentId)) {
				issues.push({
					code: "panel-binding-unresolved",
					severity: "warning",
					message: `Panel element on face "${face.id}" references missing component "${componentId}"`,
					componentId,
				});
				continue;
			}

			const resolved = resolvePanelElement(resolvedElements, element);
			if (element.bind.controlId !== undefined && resolved === undefined) {
				issues.push({
					code: "panel-control-unresolved",
					severity: "warning",
					message: `Panel element on face "${face.id}" references missing control "${element.bind.controlId}" on component "${componentId}"`,
					componentId,
					property: element.bind.controlId,
				});
				continue;
			}

			if (
				resolved !== undefined &&
				!panelKindsCompatible(element.kind, resolved.kind)
			) {
				issues.push({
					code: "panel-kind-mismatch",
					severity: "warning",
					message: `Panel element on face "${face.id}" binds component "${componentId}" as ${element.kind} but resolved kind is ${resolved.kind}`,
					componentId,
				});
			}
		}

		for (const issue of validatePanelCellCollisions(face)) {
			issues.push(issue);
		}
	}

	return issues;
}

function panelKindsCompatible(
	declared: PanelControlKind,
	resolved: PanelControlKind,
): boolean {
	if (declared === resolved) {
		return true;
	}
	return (
		resolved === "switch" &&
		(declared === "selector" || declared === "footswitch")
	);
}

function resolvePanelElements(
	doc: CircuitDocument,
): readonly ResolvedPanelElement[] {
	const panel = extractPanel(doc);
	const resolved: ResolvedPanelElement[] = [];

	for (const knob of panel.knobs) {
		resolved.push({
			id: knob.id,
			componentId: componentIdFromPanelElementId(knob.id),
			kind:
				knob.id.endsWith(":mode") && knob.controlMode === "stepped"
					? "switch"
					: "knob",
		});
	}
	for (const slider of panel.sliders ?? []) {
		resolved.push({
			id: slider.id,
			componentId: componentIdFromPanelElementId(slider.id),
			kind: "slider",
		});
	}
	for (const switchControl of panel.switches) {
		resolved.push({
			id: switchControl.id,
			componentId: componentIdFromPanelElementId(switchControl.id),
			kind: "switch",
		});
	}
	for (const led of panel.leds) {
		resolved.push({
			id: led.id,
			componentId: componentIdFromPanelElementId(led.id),
			kind: "led",
		});
	}
	for (const jack of panel.jacks) {
		resolved.push({
			id: jack.id,
			componentId:
				jack.sourceComponentId ?? componentIdFromPanelElementId(jack.id),
			kind: "jack",
		});
	}

	return resolved;
}

function resolvePanelElement(
	resolvedElements: readonly ResolvedPanelElement[],
	element: PanelElementPlacement,
): ResolvedPanelElement | undefined {
	if (element.bind.controlId !== undefined) {
		return resolvedElements.find(
			(resolved) =>
				resolved.componentId === element.bind.componentId &&
				resolved.id === element.bind.controlId,
		);
	}

	return resolvedElements.find(
		(resolved) =>
			resolved.componentId === element.bind.componentId &&
			resolved.id === element.bind.componentId,
	);
}

function componentIdFromPanelElementId(id: string): string {
	const separator = id.indexOf(":");
	return separator <= 0 ? id : id.slice(0, separator);
}

function validatePanelCellCollisions(
	face: PanelFace,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const occupied = new Map<string, PanelElementPlacement>();

	for (const element of face.elements) {
		const rowSpan = element.grid.rowSpan ?? 1;
		const columnSpan = element.grid.columnSpan ?? 1;
		for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
			for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
				const row = element.grid.row + rowOffset;
				const column = element.grid.column + columnOffset;
				const key = `${row}:${column}`;
				if (occupied.has(key)) {
					issues.push({
						code: "panel-cell-collision",
						severity: "warning",
						message: `Panel face "${face.id}" has overlapping elements at row ${row}, column ${column}`,
						componentId: element.bind.componentId,
					});
					continue;
				}
				occupied.set(key, element);
			}
		}
	}

	return issues;
}

function validateV3BuildMetadata(
	doc: CircuitDocument,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	if (!hasV3BuildMetadata(doc)) {
		return [];
	}

	const issues: ValidationIssue[] = [];
	const boards = doc.boards ?? [];
	const boardsById = new Map(boards.map((board) => [board.id, board]));
	const componentsById = new Map(
		doc.components.map((component) => [component.id, component]),
	);
	const panelElementIds = collectPanelElementIds(doc);
	const controlIds = new Set(
		doc.deviceInterface?.controls.map((control) => control.id) ?? [],
	);
	const boardNetsByBoardId = new Map(
		boards.map((board) => [
			board.id,
			new Set(board.netlist?.nets.map((net) => net.id) ?? []),
		]),
	);
	const boardTerminalsByBoardId = new Map(
		boards.map((board) => [
			board.id,
			new Set(board.edgeTerminals.map((terminal) => terminal.id)),
		]),
	);

	const selectedBoardId = doc.build?.selectedBoardId;
	if (selectedBoardId !== undefined && !boardsById.has(selectedBoardId)) {
		issues.push(
			unresolvedIssue(
				"build-board-unresolved",
				"error",
				`Build selectedBoardId references missing board "${selectedBoardId}"`,
				selectedBoardId,
				"selectedBoardId",
			),
		);
	}

	for (const boardId of doc.build?.alternateBoardIds ?? []) {
		if (!boardsById.has(boardId)) {
			issues.push(
				unresolvedIssue(
					"build-board-unresolved",
					"warning",
					`Build alternateBoardIds references missing board "${boardId}"`,
					boardId,
					"alternateBoardIds",
				),
			);
		}
	}

	const preferredBoardId = dataString(
		doc.mechanical?.internalBoard,
		"preferredBoardId",
	);
	if (preferredBoardId !== undefined && !boardsById.has(preferredBoardId)) {
		issues.push(
			unresolvedIssue(
				"build-board-unresolved",
				"warning",
				`Mechanical internalBoard.preferredBoardId references missing board "${preferredBoardId}"`,
				preferredBoardId,
				"mechanical.internalBoard.preferredBoardId",
			),
		);
	}

	const harnessesById = new Map(
		doc.offBoardWiring?.harnesses.map((harness) => [harness.id, harness]) ?? [],
	);
	for (const harnessId of doc.build?.selectedOffBoardWiringHarnessIds ?? []) {
		if (!harnessesById.has(harnessId)) {
			issues.push(
				unresolvedIssue(
					"build-harness-unresolved",
					"error",
					`Build selectedOffBoardWiringHarnessIds references missing harness "${harnessId}"`,
					harnessId,
					"selectedOffBoardWiringHarnessIds",
				),
			);
		}
	}

	for (const item of doc.bom?.items ?? []) {
		for (const ref of item.refs) {
			const issue = validateBomRef(
				ref,
				componentIds,
				controlIds,
				panelElementIds,
				boardsById,
				item.id,
			);
			if (issue !== undefined) {
				issues.push(issue);
			}
		}
	}

	for (const board of boards) {
		issues.push(
			...validateBoardRealization(board, componentsById, boardNetsByBoardId),
		);
	}

	if (doc.offBoardWiring !== undefined) {
		issues.push(
			...validateOffBoardWiring(
				doc,
				componentsById,
				panelElementIds,
				boardTerminalsByBoardId,
				boardNetsByBoardId,
			),
		);
	}

	if (
		doc.build?.completeness === "complete-selected-build" &&
		selectedBoardId !== undefined
	) {
		const selectedBoard = boardsById.get(selectedBoardId);
		if (selectedBoard !== undefined) {
			issues.push(...validateCompleteSelectedBoardRoutes(selectedBoard));
		}
	}

	return issues;
}

function hasV3BuildMetadata(doc: CircuitDocument): boolean {
	return (
		doc.mechanical !== undefined ||
		doc.build !== undefined ||
		doc.bom !== undefined ||
		doc.partProfiles !== undefined ||
		doc.footprints !== undefined ||
		doc.offBoardWiring !== undefined ||
		doc.boards !== undefined ||
		doc.panel?.faces.some(
			(face) =>
				face.geometry !== undefined ||
				face.elements.some(
					(element) =>
						element.id !== undefined || element.physical !== undefined,
				),
		) === true
	);
}

function validateBomRef(
	ref: BuildBomRef,
	componentIds: ReadonlySet<string>,
	controlIds: ReadonlySet<string>,
	panelElementIds: ReadonlySet<string>,
	boardsById: ReadonlyMap<string, BoardRealization>,
	itemId: string,
): ValidationIssue | undefined {
	if (
		ref.kind === "component" &&
		(ref.componentId === undefined || !componentIds.has(ref.componentId))
	) {
		return unresolvedIssue(
			"bom-ref-unresolved",
			"warning",
			`BOM item "${itemId}" references missing component "${ref.componentId ?? ""}"`,
			itemId,
			"refs.componentId",
		);
	}
	if (
		ref.kind === "device-interface-control" &&
		(ref.controlId === undefined || !controlIds.has(ref.controlId))
	) {
		return unresolvedIssue(
			"bom-ref-unresolved",
			"warning",
			`BOM item "${itemId}" references missing device interface control "${ref.controlId ?? ""}"`,
			itemId,
			"refs.controlId",
		);
	}
	if (
		ref.kind === "panel-element" &&
		(ref.panelElementId === undefined ||
			!panelElementIds.has(ref.panelElementId))
	) {
		return unresolvedIssue(
			"bom-ref-unresolved",
			"warning",
			`BOM item "${itemId}" references missing panel element "${ref.panelElementId ?? ""}"`,
			itemId,
			"refs.panelElementId",
		);
	}
	if (
		ref.kind === "board" &&
		(ref.boardId === undefined || !boardsById.has(ref.boardId))
	) {
		return unresolvedIssue(
			"bom-ref-unresolved",
			"warning",
			`BOM item "${itemId}" references missing board "${ref.boardId ?? ""}"`,
			itemId,
			"refs.boardId",
		);
	}
	return undefined;
}

function validateBoardRealization(
	board: BoardRealization,
	componentsById: ReadonlyMap<string, Component>,
	boardNetsByBoardId: ReadonlyMap<string, ReadonlySet<string>>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (
		board.sourceCircuit !== undefined &&
		!isDigestShapedSourceHash(board.sourceCircuit.hash)
	) {
		issues.push({
			code: "board-source-hash-invalid",
			severity: "error",
			message: `Board "${board.id}" sourceCircuit.hash must be sha256:<64 hex chars>`,
			componentId: board.id,
			property: "sourceCircuit.hash",
		});
	}

	for (const terminal of board.edgeTerminals) {
		if (
			terminal.terminalRef !== undefined &&
			!componentTerminalExists(componentsById, terminal.terminalRef)
		) {
			issues.push(
				unresolvedIssue(
					"board-terminal-unresolved",
					"warning",
					`Board "${board.id}" edge terminal "${terminal.id}" references missing component terminal`,
					board.id,
					terminal.id,
				),
			);
		}
	}

	for (const placement of board.footprintPlacements) {
		if (!componentsById.has(placement.componentId)) {
			issues.push(
				unresolvedIssue(
					"board-terminal-unresolved",
					"warning",
					`Board "${board.id}" places missing component "${placement.componentId}"`,
					board.id,
					placement.componentId,
				),
			);
			continue;
		}
		for (const pad of placement.pads) {
			if (
				pad.terminalName !== undefined &&
				!componentHasTerminal(
					componentsById,
					placement.componentId,
					pad.terminalName,
				)
			) {
				issues.push(
					unresolvedIssue(
						"board-terminal-unresolved",
						"warning",
						`Board "${board.id}" pad "${pad.padId}" references missing terminal "${pad.terminalName}"`,
						board.id,
						pad.padId,
					),
				);
			}
		}
	}

	for (const net of board.netlist?.nets ?? []) {
		for (const member of net.members) {
			if (!componentTerminalExists(componentsById, member)) {
				issues.push(
					unresolvedIssue(
						"board-terminal-unresolved",
						"warning",
						`Board "${board.id}" net "${net.id}" references missing component terminal`,
						board.id,
						net.id,
					),
				);
			}
		}
	}

	for (const route of board.routes) {
		if (route.zones !== undefined || route.drills !== undefined) {
			issues.push({
				code: "board-route-feature-invalid",
				severity: "error",
				message: `Board "${board.id}" route "${route.id}" contains board-level zones or drills`,
				componentId: board.id,
				property: route.id,
			});
		}
		if (
			isBoardNetlistRef(route.netRef) &&
			!boardNetRefExists(route.netRef, board.id, boardNetsByBoardId)
		) {
			issues.push(
				unresolvedIssue(
					"offboard-signal-unresolved",
					"warning",
					`Board "${board.id}" route "${route.id}" references missing board net "${route.netRef.netId}"`,
					board.id,
					route.id,
				),
			);
		}
	}

	return issues;
}

function validateOffBoardWiring(
	doc: CircuitDocument,
	componentsById: ReadonlyMap<string, Component>,
	panelElementIds: ReadonlySet<string>,
	boardTerminalsByBoardId: ReadonlyMap<string, ReadonlySet<string>>,
	boardNetsByBoardId: ReadonlyMap<string, ReadonlySet<string>>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const endpointIds = new Set<string>();

	for (const harness of doc.offBoardWiring?.harnesses ?? []) {
		const localEndpointIds = new Set<string>();
		for (const endpoint of harness.endpoints) {
			endpointIds.add(endpoint.id);
			localEndpointIds.add(endpoint.id);
			const issue = validateOffBoardEndpoint(
				endpoint,
				componentsById,
				panelElementIds,
				boardTerminalsByBoardId,
			);
			if (issue !== undefined) {
				issues.push(issue);
			}
		}

		for (const connection of harness.connections) {
			if (!localEndpointIds.has(connection.fromEndpointId)) {
				issues.push(
					unresolvedIssue(
						"offboard-endpoint-unresolved",
						"error",
						`Harness "${harness.id}" connection "${connection.id}" references missing endpoint "${connection.fromEndpointId}"`,
						harness.id,
						connection.id,
					),
				);
			}
			if (!localEndpointIds.has(connection.toEndpointId)) {
				issues.push(
					unresolvedIssue(
						"offboard-endpoint-unresolved",
						"error",
						`Harness "${harness.id}" connection "${connection.id}" references missing endpoint "${connection.toEndpointId}"`,
						harness.id,
						connection.id,
					),
				);
			}
			if (connection.signalRef !== undefined) {
				const issue = validateOffBoardSignalRef(
					connection.signalRef,
					componentsById,
					boardNetsByBoardId,
					harness.id,
				);
				if (issue !== undefined) {
					issues.push(issue);
				}
			}
		}
	}

	for (const harnessId of doc.build?.selectedOffBoardWiringHarnessIds ?? []) {
		const harness = doc.offBoardWiring?.harnesses.find(
			(candidate) => candidate.id === harnessId,
		);
		if (harness === undefined) {
			continue;
		}
		for (const connection of harness.connections) {
			if (
				!endpointIds.has(connection.fromEndpointId) ||
				!endpointIds.has(connection.toEndpointId)
			) {
				issues.push(
					unresolvedIssue(
						"offboard-endpoint-unresolved",
						"error",
						`Selected harness "${harnessId}" contains an unresolved connection endpoint`,
						harnessId,
						connection.id,
					),
				);
			}
		}
	}

	return issues;
}

function validateOffBoardEndpoint(
	endpoint: OffBoardWiringEndpoint,
	componentsById: ReadonlyMap<string, Component>,
	panelElementIds: ReadonlySet<string>,
	boardTerminalsByBoardId: ReadonlyMap<string, ReadonlySet<string>>,
): ValidationIssue | undefined {
	if (endpoint.kind === "board-terminal") {
		const terminalIds =
			endpoint.boardId === undefined
				? undefined
				: boardTerminalsByBoardId.get(endpoint.boardId);
		if (
			terminalIds === undefined ||
			endpoint.terminalId === undefined ||
			!terminalIds.has(endpoint.terminalId)
		) {
			return unresolvedIssue(
				"offboard-endpoint-unresolved",
				"error",
				`Off-board endpoint "${endpoint.id}" references missing board terminal`,
				endpoint.id,
				"terminalId",
			);
		}
		return undefined;
	}

	if (
		endpoint.kind === "panel-component-terminal" ||
		endpoint.kind === "power-terminal" ||
		endpoint.kind === "footswitch-terminal"
	) {
		if (
			endpoint.componentId === undefined ||
			endpoint.terminalName === undefined ||
			!componentHasTerminal(
				componentsById,
				endpoint.componentId,
				endpoint.terminalName,
			)
		) {
			return unresolvedIssue(
				"offboard-endpoint-unresolved",
				"error",
				`Off-board endpoint "${endpoint.id}" references missing component terminal`,
				endpoint.id,
				"componentId",
			);
		}
		if (
			endpoint.panelElementId !== undefined &&
			endpoint.kind !== "power-terminal" &&
			!panelElementIds.has(endpoint.panelElementId)
		) {
			return unresolvedIssue(
				"offboard-endpoint-unresolved",
				"warning",
				`Off-board endpoint "${endpoint.id}" references missing panel element "${endpoint.panelElementId}"`,
				endpoint.id,
				"panelElementId",
			);
		}
	}

	return undefined;
}

function validateOffBoardSignalRef(
	signalRef: OffBoardSignalRef,
	componentsById: ReadonlyMap<string, Component>,
	boardNetsByBoardId: ReadonlyMap<string, ReadonlySet<string>>,
	harnessId: string,
): ValidationIssue | undefined {
	if (isBoardNetlistRef(signalRef)) {
		if (!boardNetRefExists(signalRef, signalRef.boardId, boardNetsByBoardId)) {
			return unresolvedIssue(
				"offboard-signal-unresolved",
				"error",
				`Harness "${harnessId}" references missing board net "${signalRef.netId}"`,
				harnessId,
				"signalRef",
			);
		}
		return undefined;
	}

	const member = dataObject(signalRef, "member");
	const componentId = dataString(member, "componentId");
	const terminalName = dataString(member, "terminalName");
	if (
		dataString(signalRef, "source") === "canonical-circuit" &&
		componentId !== undefined &&
		terminalName !== undefined
	) {
		if (!componentHasTerminal(componentsById, componentId, terminalName)) {
			return unresolvedIssue(
				"offboard-signal-unresolved",
				"error",
				`Harness "${harnessId}" references missing canonical component terminal`,
				harnessId,
				"signalRef",
			);
		}
	}

	return undefined;
}

function validateCompleteSelectedBoardRoutes(
	board: BoardRealization,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const routedNetIds = new Set(
		board.routes
			.filter((route) => isRouteForBoardNet(route, board.id))
			.map((route) => dataString(route.netRef, "netId"))
			.filter((netId): netId is string => netId !== undefined),
	);

	for (const net of board.netlist?.nets ?? []) {
		if (isSingleTerminalEdgeNet(net)) {
			continue;
		}
		if (!routedNetIds.has(net.id)) {
			issues.push({
				code: "board-net-unrouted",
				severity: "error",
				message: `Selected board "${board.id}" net "${net.id}" has multiple members but no route`,
				componentId: board.id,
				property: net.id,
			});
		}
	}

	return issues;
}

function isSingleTerminalEdgeNet(net: BoardNet): boolean {
	return net.members.length <= 1;
}

function isRouteForBoardNet(route: BoardRoute, boardId: string): boolean {
	if (!isBoardNetlistRef(route.netRef)) {
		return false;
	}
	return route.netRef.boardId === undefined || route.netRef.boardId === boardId;
}

function isBoardNetlistRef(
	value: VdspBuildDataObject | undefined,
): value is VdspBuildDataObject & {
	source: "board-netlist";
	boardId?: string;
	netId: string;
} {
	return (
		dataString(value, "source") === "board-netlist" &&
		dataString(value, "netId") !== undefined
	);
}

function boardNetRefExists(
	ref: VdspBuildDataObject & { netId: string; boardId?: string },
	fallbackBoardId: string | undefined,
	boardNetsByBoardId: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
	const boardId = ref.boardId ?? fallbackBoardId;
	if (boardId === undefined) {
		return Array.from(boardNetsByBoardId.values()).some((netIds) =>
			netIds.has(ref.netId),
		);
	}
	return boardNetsByBoardId.get(boardId)?.has(ref.netId) === true;
}

function collectPanelElementIds(doc: CircuitDocument): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const face of doc.panel?.faces ?? []) {
		for (const element of face.elements) {
			if (element.id !== undefined) {
				ids.add(element.id);
			}
			ids.add(element.bind.componentId);
			if (element.bind.controlId !== undefined) {
				ids.add(element.bind.controlId);
			}
		}
	}
	return ids;
}

function componentTerminalExists(
	componentsById: ReadonlyMap<string, Component>,
	ref: Readonly<{ componentId: string; terminalName: string }>,
): boolean {
	return componentHasTerminal(
		componentsById,
		ref.componentId,
		ref.terminalName,
	);
}

function componentHasTerminal(
	componentsById: ReadonlyMap<string, Component>,
	componentId: string,
	terminalName: string,
): boolean {
	return (
		componentsById
			.get(componentId)
			?.terminals.some((terminal) => terminal.name === terminalName) === true
	);
}

function isDigestShapedSourceHash(hash: string): boolean {
	return /^sha256:[0-9a-f]{64}$/i.test(hash);
}

function dataString(
	object: VdspBuildDataObject | undefined,
	key: string,
): string | undefined {
	const value = object?.[key];
	return typeof value === "string" ? value : undefined;
}

function dataObject(
	object: VdspBuildDataObject | undefined,
	key: string,
): VdspBuildDataObject | undefined {
	const value = object?.[key];
	return isBuildDataObject(value) ? value : undefined;
}

function isBuildDataObject(value: unknown): value is VdspBuildDataObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unresolvedIssue(
	code: ValidationCode,
	severity: ValidationSeverity,
	message: string,
	componentId: string,
	property: string,
): ValidationIssue {
	return {
		code,
		severity,
		message,
		componentId,
		property,
	};
}

function missingPropertyIssue(
	component: Component,
	rule: PropertyRule,
): ValidationIssue {
	return {
		code: rule.kind === "string" ? "model-required" : "value-required",
		severity: "error",
		message: `${component.id} (${component.kind}): missing required property "${rule.name}"`,
		componentId: component.id,
		property: rule.name,
	};
}

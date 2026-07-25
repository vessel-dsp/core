import { extractPanel } from "../panel/extract";
import {
	isPropertyObject,
	propertyNumericValue,
	propertyQuantityValue,
	propertyStringValue,
} from "./properties";
import type {
	BoardNet,
	BoardRealization,
	BoardRoute,
	BuildBomRef,
	BuildPartProfile,
	CircuitDocument,
	CircuitPowerDomain,
	CircuitPowerRailBinding,
	CircuitPowerSourceKind,
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
	SimulationProfile,
	VdspBuildDataObject,
} from "./types";

export type ValidationSeverity = "error" | "warning";

export type ValidationCode =
	| "value-required"
	| "model-required"
	| "interface-only-active-device"
	| "schema-invalid-legacy-support-view-only"
	| "value-unparseable"
	| "value-out-of-range"
	| "unit-mismatch"
	| "unsupported-component"
	| "invalid-jack-role"
	| "invalid-jack-interface"
	| "invalid-jack-audio-role"
	| "display-kind-invalid"
	| "display-bus-invalid"
	| "display-grid-invalid"
	| "display-driver-unresolved"
	| "display-default-text-invalid"
	| "descriptor-control-empty"
	| "descriptor-mode-label-mismatch"
	| "firmware-id-missing"
	| "runtime-match-key-missing"
	| "runtime-match-key-incomplete"
	| "firmware-chip-missing"
	| "source-runtime-boundary-property"
	| "behavior-role-invalid"
	| "behavior-role-kind-invalid"
	| "behavior-role-firmware-ref-kind-mismatch"
	| "behavior-role-firmware-ref-invalid"
	| "behavior-role-firmware-ref-status-invalid"
	| "behavior-role-firmware-ref-string-invalid"
	| "behavior-role-firmware-ref-artifact-type-invalid"
	| "behavior-role-firmware-ref-source-visibility-invalid"
	| "behavior-role-firmware-ref-behavior-owner-invalid"
	| "behavior-role-firmware-ref-owner-status-mismatch"
	| "behavior-role-firmware-ref-memory-component-unresolved"
	| "behavior-role-firmware-ref-mcu-component-unresolved"
	| "invalid-control-role"
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
	| "appearance-invalid"
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
	| "part-profile-duplicate-id"
	| "part-profile-reference-unresolved"
	| "part-profile-quantity-invalid"
	| "simulation-profile-duplicate-id"
	| "simulation-profile-reference-unresolved"
	| "offboard-endpoint-unresolved"
	| "offboard-signal-unresolved"
	| "board-source-hash-invalid"
	| "board-terminal-unresolved"
	| "board-route-feature-invalid"
	| "board-net-unrouted"
	| "power-source-unresolved"
	| "power-rail-unresolved"
	| "power-rail-parent-unresolved"
	| "power-rail-parent-cycle"
	| "power-domain-duplicate-id"
	| "power-rail-duplicate-ownership"
	| "power-coverage-domains-mismatch"
	| "power-rail-converter-required"
	| "power-rail-converter-invalid-kind"
	| "power-rail-role-derivation-mismatch"
	| "power-rail-duplicate-converter-role"
	| "power-converter-missing-part-number"
	| "power-rail-missing-nominal-voltage"
	| "power-domain-source-kind-conflict"
	| "power-domain-source-kind-unresolved"
	| "power-domain-source-owner-unresolved"
	| "power-rail-fixed-owner-conflict"
	| "duplicate-id"
	| "degenerate-wire"
	| "trace-connectivity-incomplete"
	| "trace-floating-node"
	| "trace-shorted-part"
	| "trace-divider-asymmetry"
	| "trace-rc-corner"
	| "trace-nonstandard-value"
	| "trace-audio-role-ambiguous"
	| "trace-audio-shunt-extreme"
	| "trace-input-loading-extreme"
	| "trace-opamp-feedback-open";

export type ValidationIssue = Readonly<{
	code: ValidationCode | (string & {});
	severity: ValidationSeverity;
	message: string;
	componentId?: string;
	property?: string;
	wireId?: string;
}>;

export const CONTROL_ROLE_VALUES = [
	"direct-output",
	"expression",
	"harmony-effect-level",
	"harmony-key",
	"harmony-voice-a",
	"harmony-voice-b",
	"reset",
	"sampler-trigger",
	"tempo-tap",
	"trigger",
] as const;

export type ControlRole = (typeof CONTROL_ROLE_VALUES)[number];

export type ValidateDocumentOptions = Readonly<{
	/**
	 * Set when the caller is validating a document that explicitly claims
	 * playback/lowering support. Source-only documents should leave this false.
	 */
	playbackClaim?: boolean;
	rules?: readonly DocumentValidationRule[];
}>;

export type DocumentValidationRule = (
	doc: CircuitDocument,
	context: DocumentValidationContext,
) => readonly ValidationIssue[];

export type DocumentValidationContext = Readonly<{
	playbackClaim: boolean;
	controlRoles: ReadonlySet<ControlRole>;
}>;

export type ValidateSourceRuntimeBoundaryOptions = Readonly<{
	severity?: ValidationSeverity;
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

const CONTROL_ROLES: ReadonlySet<string> = new Set(CONTROL_ROLE_VALUES);

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

const BEHAVIOR_ROLE_KINDS = [
	"chip-primitive",
	"firmware-dsp-core",
	"behavior-profile",
	"measured-blackbox",
] as const;

const FIRMWARE_BEHAVIOR_ROLE_KIND = "firmware-dsp-core";

const FIRMWARE_REF_STATUSES = [
	"recovered",
	"source-bounded-approximation",
	"measured-approximation",
	"unknown-proprietary",
	"dumped",
	"verified",
] as const;

const FIRMWARE_REF_ARTIFACT_TYPES = [
	"hex",
	"bin",
	"mask-rom",
	"internal-rom",
	"external-rom",
] as const;

const FIRMWARE_REF_SOURCE_VISIBILITIES = [
	"not-visible",
	"visible-chip-marking",
	"dump-available",
	"source-available",
] as const;

const FIRMWARE_REF_BEHAVIOR_OWNERS = [
	"firmware-proxy",
	"recovered-firmware",
	"measured-blackbox",
] as const;

const SOURCE_RUNTIME_BOUNDARY_EXACT_PROPERTIES = new Set([
	"AmpRuntimeGraphManifest",
	"BehaviorOwner",
	"CircuitGraphCompilerLiveCertificateV1",
	"CircuitGraphCompilerParityReportRefV1",
	"CompilerCertificate",
	"CompilerManifest",
	"ConsumerAdmissionBoundary",
	"DescriptorType",
	"Mechanism",
	"Primitive",
	"PrimitiveBoundary",
	"PrimitiveClass",
	"PrimitiveKind",
	"PrimitivePinMap",
	"RuntimeMatchKey",
	"SimulateCapacitances",
	"SimulationStatus",
	"SourceInputRuntimeBoundary",
	"SourceMnaTopology",
	"SourceOutputRuntimeBoundary",
	"SourcePartOwnership",
	"SourceProfileKey",
	"SyntheticForPlayability",
].map(normalizeSourceRuntimeBoundaryToken));

const SOURCE_RUNTIME_BOUNDARY_PROPERTY_PREFIXES = [
	"AmpLane",
	"AmpPreamp",
	"AmpRuntime",
	"Descriptor",
	"ExactSourceAdmission",
	"Primitive",
	"Runtime",
].map(normalizeSourceRuntimeBoundaryToken);

const SOURCE_RUNTIME_BOUNDARY_NESTED_PROPERTIES = new Set([
	"BehaviorRole.firmwareRef.behaviorOwner",
].map(normalizeSourceRuntimeBoundaryPath));

const DISPLAY_KINDS = [
	"lcd-character",
	"lcd-graphic",
	"oled",
	"seven-segment",
	"led-matrix",
	"custom",
	"unknown",
] as const;

const DISPLAY_BUS_KINDS = [
	"i2c",
	"spi",
	"parallel",
	"gpio",
	"serial",
	"module-internal",
	"unknown",
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
	"power-converter": [
		{
			kind: "string",
			name: "ConverterKind",
			required: true,
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
	options: ValidateDocumentOptions = {},
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const seen = new Set<string>();
	const playbackClaim = options.playbackClaim === true;

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

		for (const issue of validateInterfaceOnlyUsage(component)) {
			issues.push(issue);
		}

		for (const issue of validateLegacySupportViewOnlySchema(component)) {
			issues.push(issue);
		}

		for (const issue of validateSemanticMetadata(component)) {
			issues.push(issue);
		}

		for (const issue of validateComponentControlRole(
			component,
			playbackClaim,
		)) {
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

	for (const issue of validateControlInterfaces(doc, playbackClaim)) {
		issues.push(issue);
	}

	for (const issue of validateAppearance(doc)) {
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

	for (const issue of validateCircuitPower(doc, seen)) {
		issues.push(issue);
	}

	for (const issue of validatePowerConverterComponents(doc)) {
		issues.push(issue);
	}

	for (const issue of validateDisplayComponents(doc, seen)) {
		issues.push(issue);
	}

	for (const issue of validateBehaviorRoles(doc, seen)) {
		issues.push(issue);
	}

	const context: DocumentValidationContext = {
		playbackClaim,
		controlRoles: CONTROL_ROLES as ReadonlySet<ControlRole>,
	};
	for (const rule of options.rules ?? []) {
		issues.push(...rule(doc, context));
	}

	return issues;
}

function validateAppearance(doc: CircuitDocument): readonly ValidationIssue[] {
	const appearance = doc.appearance as
		| (VdspBuildDataObject & { readonly kind?: unknown })
		| undefined;
	if (appearance === undefined) {
		return [];
	}
	if (appearance.kind !== "stompbox" && appearance.kind !== "amp") {
		return [
			{
				code: "appearance-invalid",
				severity: "error",
				message: "appearance.kind must be stompbox or amp",
				property: "appearance.kind",
			},
		];
	}
	if (appearance.kind === "stompbox" && appearance.amp !== undefined) {
		return [
			{
				code: "appearance-invalid",
				severity: "error",
				message:
					"appearance.amp cannot be present when appearance.kind is stompbox",
				property: "appearance.amp",
			},
		];
	}
	if (appearance.kind === "amp" && appearance.stompbox !== undefined) {
		return [
			{
				code: "appearance-invalid",
				severity: "error",
				message:
					"appearance.stompbox cannot be present when appearance.kind is amp",
				property: "appearance.stompbox",
			},
		];
	}
	return [];
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
	return (
		typeof interfaceOnly === "string" &&
		normalizeToken(interfaceOnly) === "true"
	);
}

// `Support: "view-only"` is legacy schema vocabulary, not a current source
// property. Current validation only reports the schema problem; playable/support
// status is derived later by a host runtime/compiler from the source graph.
function validateLegacySupportViewOnlySchema(
	component: Component,
): readonly ValidationIssue[] {
	const support = component.properties.Support;
	const isLegacyViewOnly =
		typeof support === "string" && normalizeToken(support) === "view-only";
	if (!isLegacyViewOnly) {
		return [];
	}
	return [
		{
			code: "schema-invalid-legacy-support-view-only",
			severity: "warning",
			message: `${component.id}: property "Support: view-only" is legacy schema vocabulary and is not valid in the current runtime-agnostic source schema. Use a legacy validator for legacy documents; otherwise remove this property. Playable/support status is derived downstream by the host runtime/compiler.`,
			componentId: component.id,
			property: "Support",
		},
	];
}

// Kinds whose whole purpose is representing a real active electrical device
// (they all require a "model"/"Type" identity). InterfaceOnly should never
// stand in for "real device, unspecified part" on these kinds -- only for a
// genuinely absent branch (no real terminals wired, e.g. an unpopulated/DNP
// position or a panel/UI reference stub).
const ACTIVE_DEVICE_MODEL_KINDS = new Set<ComponentKind>([
	"diode",
	"led",
	"bjt",
	"jfet",
	"mosfet",
	"opamp",
	"triode",
	"pentode",
	"tube-diode",
	"optocoupler",
	"ota",
	"bbd",
	"delay-ic",
	"power-amp",
	"regulator",
	"analog-switch",
	"flipflop",
	"ic",
]);

function validateInterfaceOnlyUsage(
	component: Component,
): readonly ValidationIssue[] {
	if (!isInterfaceOnlyComponent(component)) {
		return [];
	}
	if (!ACTIVE_DEVICE_MODEL_KINDS.has(component.kind)) {
		return [];
	}
	if (component.terminals.length < 2) {
		return [];
	}
	return [
		{
			code: "interface-only-active-device",
			severity: "warning",
			message: `${component.id}: marked InterfaceOnly but declares ${component.terminals.length} terminals on an active-device kind ("${component.kind}") -- InterfaceOnly is for components with no real electrical branch (an unpopulated/DNP position, or a panel/UI reference stub with no wired terminals), not for a real, wired device whose exact part is simply unconfirmed. Use a generic "model"/"Type" value plus an honest source-gap disclosure (e.g. PartNumberDisclosure) instead of an InterfaceOnly waiver.`,
			componentId: component.id,
			property: "InterfaceOnly",
		},
	];
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

	if (component.kind === "ic") {
		issues.push(...validateFirmwareMetadata(component));
	}

	return issues;
}

function validateBehaviorRoles(
	doc: CircuitDocument,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const component of doc.components) {
		issues.push(...validateBehaviorRole(component, componentIds));
	}
	return issues;
}

function validateDisplayComponents(
	doc: CircuitDocument,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const component of doc.components) {
		if (component.kind !== "display") {
			continue;
		}
		issues.push(...validateDisplayMetadata(component, componentIds));
	}
	return issues;
}

function validateDisplayMetadata(
	component: Component,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const displayKind = propertyString(component, "DisplayKind");
	if (
		displayKind !== null &&
		displayKind.trim().length > 0 &&
		!isOneOf(normalizeDisplayKindToken(displayKind), DISPLAY_KINDS)
	) {
		issues.push({
			code: "display-kind-invalid",
			severity: "error",
			message: `${component.id}: DisplayKind "${displayKind}" is not supported`,
			componentId: component.id,
			property: "DisplayKind",
		});
	}

	const bus = propertyString(component, "Bus");
	if (
		bus !== null &&
		bus.trim().length > 0 &&
		!isOneOf(normalizeDisplayBusToken(bus), DISPLAY_BUS_KINDS)
	) {
		issues.push({
			code: "display-bus-invalid",
			severity: "error",
			message: `${component.id}: Bus "${bus}" is not supported for display metadata`,
			componentId: component.id,
			property: "Bus",
		});
	}

	const gridIssues = validateDisplayGridMetadata(component);
	issues.push(...gridIssues);

	const driverComponentId = propertyString(component, "DriverComponentId");
	if (
		driverComponentId !== null &&
		driverComponentId.trim().length > 0 &&
		!componentIds.has(driverComponentId.trim())
	) {
		issues.push({
			code: "display-driver-unresolved",
			severity: "error",
			message: `${component.id}: DriverComponentId "${driverComponentId}" does not resolve to a component`,
			componentId: component.id,
			property: "DriverComponentId",
		});
	}

	const defaultText = component.properties.DefaultText;
	if (defaultText !== undefined) {
		if (
			!Array.isArray(defaultText) ||
			defaultText.some((line) => propertyStringValue(line) === null)
		) {
			issues.push({
				code: "display-default-text-invalid",
				severity: "error",
				message: `${component.id}: DefaultText must be an array of scalar string values`,
				componentId: component.id,
				property: "DefaultText",
			});
		}
	}

	return issues;
}

function validateDisplayGridMetadata(
	component: Component,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const characterGrid = propertyString(component, "CharacterGrid");
	if (characterGrid !== null && characterGrid.trim().length > 0) {
		const match = characterGrid.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
		if (match === null) {
			issues.push(displayGridIssue(component, "CharacterGrid"));
		} else {
			const columns = Number.parseInt(match[1]!, 10);
			const rows = Number.parseInt(match[2]!, 10);
			if (columns <= 0 || rows <= 0) {
				issues.push(displayGridIssue(component, "CharacterGrid"));
			}
		}
	}

	for (const property of ["Rows", "Columns"] as const) {
		const raw = component.properties[property];
		if (raw === undefined) {
			continue;
		}
		const value = propertyNumericValue(raw);
		if (value === undefined || !Number.isInteger(value) || value <= 0) {
			issues.push(displayGridIssue(component, property));
		}
	}

	return issues;
}

function displayGridIssue(
	component: Component,
	property: "CharacterGrid" | "Rows" | "Columns",
): ValidationIssue {
	return {
		code: "display-grid-invalid",
		severity: "error",
		message: `${component.id}: ${property} must describe positive integer display dimensions`,
		componentId: component.id,
		property,
	};
}

function validateBehaviorRole(
	component: Component,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const rawRole = component.properties.BehaviorRole;
	if (rawRole === undefined) {
		return [];
	}
	if (!isPropertyObject(rawRole)) {
		return [
			{
				code: "behavior-role-invalid",
				severity: "error",
				message: `${component.id}: BehaviorRole must be an object with kind and optional firmwareRef`,
				componentId: component.id,
				property: "BehaviorRole",
			},
		];
	}

	const issues: ValidationIssue[] = [];
	const roleRecord = rawRole as Readonly<Record<string, PropertyValue>>;
	const kind = propertyStringValue(roleRecord["kind"])?.trim() ?? "";
	if (!isOneOf(kind, BEHAVIOR_ROLE_KINDS)) {
		issues.push({
			code: "behavior-role-kind-invalid",
			severity: "error",
			message: `${component.id}: BehaviorRole.kind "${kind || "<empty>"}" is not a supported behavior role kind`,
			componentId: component.id,
			property: "BehaviorRole.kind",
		});
	}

	const rawFirmwareRef = roleRecord["firmwareRef"];
	if (rawFirmwareRef === undefined) {
		return issues;
	}
	if (
		isOneOf(kind, BEHAVIOR_ROLE_KINDS) &&
		kind !== FIRMWARE_BEHAVIOR_ROLE_KIND
	) {
		issues.push({
			code: "behavior-role-firmware-ref-kind-mismatch",
			severity: "error",
			message: `${component.id}: BehaviorRole.firmwareRef is only valid for firmware-owning behavior kinds`,
			componentId: component.id,
			property: "BehaviorRole.firmwareRef",
		});
	}
	issues.push(
		...validateBehaviorFirmwareRef(component.id, rawFirmwareRef, componentIds),
	);
	return issues;
}

export function validateSourceRuntimeBoundary(
	doc: CircuitDocument,
	options: ValidateSourceRuntimeBoundaryOptions = {},
): readonly ValidationIssue[] {
	const severity = options.severity ?? "error";
	const issues: ValidationIssue[] = [];
	collectSourceRuntimeBoundaryIssues(
		doc.rawAttributes,
		"",
		severity,
		issues,
		{
			subject: "document",
			rootRuntimeDescriptor: false,
		},
	);
	for (const component of doc.components) {
		collectSourceRuntimeBoundaryIssues(
			component.properties,
			"",
			severity,
			issues,
			{
				componentId: component.id,
				subject: component.id,
				rootRuntimeDescriptor:
					component.properties.RuntimeDescriptor === "true",
			},
		);
	}
	return issues;
}

export function createSourceRuntimeBoundaryRule(
	options: ValidateSourceRuntimeBoundaryOptions = {},
): DocumentValidationRule {
	return (doc) => validateSourceRuntimeBoundary(doc, options);
}

function validateBehaviorFirmwareRef(
	componentId: string,
	rawFirmwareRef: PropertyValue,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	if (!isPropertyObject(rawFirmwareRef)) {
		return [
			{
				code: "behavior-role-firmware-ref-invalid",
				severity: "error",
				message: `${componentId}: BehaviorRole.firmwareRef must be an object with status and optional firmware metadata fields`,
				componentId,
				property: "BehaviorRole.firmwareRef",
			},
		];
	}

	const firmwareRef = rawFirmwareRef as Readonly<Record<string, PropertyValue>>;
	const issues: ValidationIssue[] = [];
	for (const key of [
		"id",
		"version",
		"hash",
		"notes",
		"memoryComponentId",
		"mcuComponentId",
	] as const) {
		if (
			firmwareRef[key] !== undefined &&
			typeof propertyStringValue(firmwareRef[key]) !== "string"
		) {
			issues.push({
				code: "behavior-role-firmware-ref-string-invalid",
				severity: "error",
				message: `${componentId}: BehaviorRole.firmwareRef.${key} must be a scalar string value`,
				componentId,
				property: `BehaviorRole.firmwareRef.${key}`,
			});
		}
	}
	const status = propertyStringValue(firmwareRef["status"])?.trim() ?? "";
	if (!isOneOf(status, FIRMWARE_REF_STATUSES)) {
		issues.push({
			code: "behavior-role-firmware-ref-status-invalid",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.status "${status || "<empty>"}" is not a supported firmware status`,
			componentId,
			property: "BehaviorRole.firmwareRef.status",
		});
	}

	const artifactType = optionalBehaviorRoleText(firmwareRef, "artifactType");
	if (
		artifactType !== undefined &&
		!isOneOf(artifactType, FIRMWARE_REF_ARTIFACT_TYPES)
	) {
		issues.push({
			code: "behavior-role-firmware-ref-artifact-type-invalid",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.artifactType "${artifactType}" is not supported`,
			componentId,
			property: "BehaviorRole.firmwareRef.artifactType",
		});
	}

	const sourceVisibility = optionalBehaviorRoleText(
		firmwareRef,
		"sourceVisibility",
	);
	if (
		sourceVisibility !== undefined &&
		!isOneOf(sourceVisibility, FIRMWARE_REF_SOURCE_VISIBILITIES)
	) {
		issues.push({
			code: "behavior-role-firmware-ref-source-visibility-invalid",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.sourceVisibility "${sourceVisibility}" is not supported`,
			componentId,
			property: "BehaviorRole.firmwareRef.sourceVisibility",
		});
	}

	const behaviorOwner = optionalBehaviorRoleText(firmwareRef, "behaviorOwner");
	if (
		behaviorOwner !== undefined &&
		!isOneOf(behaviorOwner, FIRMWARE_REF_BEHAVIOR_OWNERS)
	) {
		issues.push({
			code: "behavior-role-firmware-ref-behavior-owner-invalid",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.behaviorOwner "${behaviorOwner}" is not supported`,
			componentId,
			property: "BehaviorRole.firmwareRef.behaviorOwner",
		});
	}

	if (behaviorOwner !== undefined && behaviorOwner !== "firmware-proxy") {
		issues.push({
			code: "behavior-role-firmware-ref-owner-status-mismatch",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.behaviorOwner must be firmware-proxy while BehaviorRole.kind=firmware-dsp-core`,
			componentId,
			property: "BehaviorRole.firmwareRef.behaviorOwner",
		});
	}

	if (
		behaviorOwner === "recovered-firmware" &&
		status !== "recovered" &&
		status !== "verified"
	) {
		issues.push({
			code: "behavior-role-firmware-ref-owner-status-mismatch",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.behaviorOwner=recovered-firmware requires status recovered or verified`,
			componentId,
			property: "BehaviorRole.firmwareRef.behaviorOwner",
		});
	}

	const memoryComponentId = optionalBehaviorRoleText(
		firmwareRef,
		"memoryComponentId",
	);
	if (memoryComponentId !== undefined && !componentIds.has(memoryComponentId)) {
		issues.push({
			code: "behavior-role-firmware-ref-memory-component-unresolved",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.memoryComponentId "${memoryComponentId}" does not resolve to a component`,
			componentId,
			property: "BehaviorRole.firmwareRef.memoryComponentId",
		});
	}

	const mcuComponentId = optionalBehaviorRoleText(
		firmwareRef,
		"mcuComponentId",
	);
	if (mcuComponentId !== undefined && !componentIds.has(mcuComponentId)) {
		issues.push({
			code: "behavior-role-firmware-ref-mcu-component-unresolved",
			severity: "error",
			message: `${componentId}: BehaviorRole.firmwareRef.mcuComponentId "${mcuComponentId}" does not resolve to a component`,
			componentId,
			property: "BehaviorRole.firmwareRef.mcuComponentId",
		});
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

function validateComponentControlRole(
	component: Component,
	playbackClaim: boolean,
): readonly ValidationIssue[] {
	const value = propertyString(component, "ControlRole");
	if (value === null || value.trim().length === 0) {
		return [];
	}
	if (isKnownControlRole(value)) {
		return [];
	}
	return [
		{
			code: "invalid-control-role",
			severity: controlRoleSeverity(playbackClaim),
			message: `${component.id}: ControlRole "${value}" is not a recognized semantic control role`,
			componentId: component.id,
			property: "ControlRole",
		},
	];
}

function validateControlInterfaces(
	doc: CircuitDocument,
	playbackClaim: boolean,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const controlInterface of doc.controlInterfaces ?? []) {
		const value = controlInterface.controlRole;
		if (
			value === undefined ||
			value.trim().length === 0 ||
			isKnownControlRole(value)
		) {
			continue;
		}
		issues.push({
			code: "invalid-control-role",
			severity: controlRoleSeverity(playbackClaim),
			message: `Control interface "${controlInterface.id}" controlRole "${value}" is not a recognized semantic control role`,
			componentId: controlInterface.id,
			property: "controlRole",
		});
	}
	return issues;
}

function isKnownControlRole(value: string): value is ControlRole {
	return CONTROL_ROLES.has(value);
}

function controlRoleSeverity(playbackClaim: boolean): ValidationSeverity {
	return playbackClaim ? "error" : "warning";
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

function validateFirmwareMetadata(
	component: Component,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const firmwareRequired = propertyBoolean(component, "FirmwareRequired");
	const firmwareId = propertyString(component, "FirmwareId")?.trim() ?? "";
	const chip = propertyString(component, "Chip")?.trim() ?? "";

	if (firmwareRequired && firmwareId.length === 0) {
		issues.push({
			code: "firmware-id-missing",
			severity: "warning",
			message: `${component.id}: FirmwareRequired is true but FirmwareId is missing or empty`,
			componentId: component.id,
			property: "FirmwareId",
		});
	}

	if (firmwareId.length > 0 && chip.length === 0) {
		issues.push({
			code: "firmware-chip-missing",
			severity: "warning",
			message: `${component.id}: FirmwareId is present but Chip is missing or empty`,
			componentId: component.id,
			property: "Chip",
		});
	}

	return issues;
}

type SourceRuntimeBoundaryIssueTarget = Readonly<{
	componentId?: string;
	subject: string;
	rootRuntimeDescriptor: boolean;
}>;

function collectSourceRuntimeBoundaryIssues(
	properties: Readonly<Record<string, PropertyValue>>,
	pathPrefix: string,
	severity: ValidationSeverity,
	issues: ValidationIssue[],
	target: SourceRuntimeBoundaryIssueTarget,
): void {
	for (const [key, value] of Object.entries(properties)) {
		const propertyPath = pathPrefix.length > 0 ? `${pathPrefix}.${key}` : key;
		if (isSourceRuntimeBoundaryProperty(target, key, propertyPath)) {
			issues.push({
				code: "source-runtime-boundary-property",
				severity,
				message: `${target.subject}: property "${propertyPath}" is runtime/admission/proxy metadata and should not be canonical .vdsp source authority`,
				...(target.componentId === undefined
					? {}
					: { componentId: target.componentId }),
				property: propertyPath,
			});
		}

		if (isPropertyObject(value)) {
			collectSourceRuntimeBoundaryIssues(
				value,
				propertyPath,
				severity,
				issues,
				target,
			);
			continue;
		}
		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				if (isPropertyObject(item)) {
					collectSourceRuntimeBoundaryIssues(
						item,
						`${propertyPath}[${index}]`,
						severity,
						issues,
						target,
					);
				}
			});
		}
	}
}

function isSourceRuntimeBoundaryProperty(
	target: SourceRuntimeBoundaryIssueTarget,
	key: string,
	path: string,
): boolean {
	const normalizedKey = normalizeSourceRuntimeBoundaryToken(key);
	const normalizedPath = normalizeSourceRuntimeBoundaryPath(path);
	return (
		SOURCE_RUNTIME_BOUNDARY_EXACT_PROPERTIES.has(normalizedKey) ||
		SOURCE_RUNTIME_BOUNDARY_NESTED_PROPERTIES.has(normalizedPath) ||
		(normalizedKey === "mechanism" && target.rootRuntimeDescriptor) ||
		SOURCE_RUNTIME_BOUNDARY_PROPERTY_PREFIXES.some((prefix) =>
			normalizedKey.startsWith(prefix),
		) ||
		normalizedPath.includes("runtimeboundary")
	);
}

function normalizeSourceRuntimeBoundaryPath(path: string): string {
	return normalizeSourceRuntimeBoundaryToken(path.replace(/\[\d+\]/gu, ""));
}

function normalizeSourceRuntimeBoundaryToken(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
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

function propertyBoolean(component: Component, name: string): boolean {
	const value = component.properties[name];
	if (value === true) {
		return true;
	}
	return typeof value === "string" && normalizeToken(value) === "true";
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

function optionalBehaviorRoleText(
	record: Readonly<Record<string, PropertyValue>>,
	key: string,
): string | undefined {
	if (record[key] === undefined) {
		return undefined;
	}
	const text = propertyStringValue(record[key])?.trim() ?? "";
	return text.length > 0 ? text : "";
}

function normalizeDisplayKindToken(value: string): string {
	const normalized = normalizeToken(value);
	if (
		["lcd-character", "character-lcd", "char-lcd", "hd44780"].includes(
			normalized,
		)
	) {
		return "lcd-character";
	}
	if (["lcd-graphic", "graphic-lcd", "glcd"].includes(normalized)) {
		return "lcd-graphic";
	}
	if (normalized.includes("oled") || normalized.includes("ssd1306")) {
		return "oled";
	}
	if (["seven-segment", "7-segment", "7seg"].includes(normalized)) {
		return "seven-segment";
	}
	if (["led-matrix", "matrix-led", "dot-matrix"].includes(normalized)) {
		return "led-matrix";
	}
	return normalized;
}

function normalizeDisplayBusToken(value: string): string {
	const normalized = normalizeToken(value);
	if (normalized === "iic") return "i2c";
	if (normalized === "8080") return "parallel";
	if (normalized === "uart" || normalized === "rs232") return "serial";
	if (normalized === "internal") return "module-internal";
	return normalized;
}

function isOneOf<const T extends readonly string[]>(
	value: string,
	values: T,
): value is T[number] {
	return values.includes(value);
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
		return [
			{
				code: "device-interface-audio-binding-invalid",
				severity: "error",
				message: `Device interface control "${control.id}" has unsupported audio binding kind "${control.audioBinding.kind}"`,
				componentId: control.id,
				property: "audioBinding.kind",
			},
		];
	}
	if (control.audioBinding.controlName.trim().length === 0) {
		return [
			{
				code: "device-interface-audio-binding-invalid",
				severity: "error",
				message: `Device interface control "${control.id}" has an empty audio binding controlName`,
				componentId: control.id,
				property: "audioBinding.controlName",
			},
		];
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
	for (const display of panel.displays ?? []) {
		resolved.push({
			id: display.id,
			componentId:
				display.sourceComponentId ?? componentIdFromPanelElementId(display.id),
			kind: "display",
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

	issues.push(...validateProfileCatalogs(doc));

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

function validateProfileCatalogs(
	doc: CircuitDocument,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const partProfiles = doc.partProfiles?.profiles ?? [];
	const partProfileIds = new Set<string>();

	for (const profile of partProfiles) {
		if (partProfileIds.has(profile.id)) {
			issues.push({
				code: "part-profile-duplicate-id",
				severity: "error",
				message: `Duplicate part profile id "${profile.id}"`,
				componentId: profile.id,
			});
		}
		partProfileIds.add(profile.id);
		issues.push(...validateKnownPhysicalProfile(profile));
	}

	for (const profile of partProfiles) {
		if (profile.profileSchema !== "cabinet-enclosure-profile/v1") {
			continue;
		}
		for (const loadout of dataObjectArray(profile, "loadout")) {
			const driverProfileId = dataString(loadout, "driverProfileId");
			if (
				driverProfileId !== undefined &&
				!partProfileIds.has(driverProfileId)
			) {
				issues.push(
					unresolvedIssue(
						"part-profile-reference-unresolved",
						"error",
						`Cabinet profile "${profile.id}" references missing driver profile "${driverProfileId}"`,
						profile.id,
						"loadout.driverProfileId",
					),
				);
			}
		}
	}

	const simulationProfileIds = new Set<string>();
	for (const profile of doc.simulationProfiles?.profiles ?? []) {
		if (simulationProfileIds.has(profile.id)) {
			issues.push({
				code: "simulation-profile-duplicate-id",
				severity: "error",
				message: `Duplicate simulation profile id "${profile.id}"`,
				componentId: profile.id,
			});
		}
		simulationProfileIds.add(profile.id);
		issues.push(...validateSimulationProfile(profile, partProfileIds));
	}

	return issues;
}

function validateKnownPhysicalProfile(
	profile: BuildPartProfile,
): readonly ValidationIssue[] {
	switch (profile.profileSchema) {
		case "speaker-driver-profile/v1":
			return validatePositiveDataNumbers(profile, profile.id, [
				["smallSignal", "nominalImpedanceOhms"],
				["smallSignal", "reOhms"],
				["smallSignal", "leHenries"],
				["smallSignal", "fsHz"],
				["smallSignal", "qms"],
				["smallSignal", "qes"],
				["smallSignal", "qts"],
				["smallSignal", "vasM3"],
				["smallSignal", "mmsKg"],
				["smallSignal", "cmsMetersPerNewton"],
				["smallSignal", "rmsKgPerSecond"],
				["smallSignal", "blTeslaMeters"],
				["geometry", "radiatingAreaM2"],
				["geometry", "xmaxM"],
			]);
		case "cabinet-enclosure-profile/v1":
			return [
				...validatePositiveDataNumbers(profile, profile.id, [
					["enclosure", "netVolumeM3"],
					["enclosure", "lossQ"],
				]),
				...validateCabinetNestedQuantities(profile),
			];
		case "microphone-transducer-profile/v1":
			return validatePositiveDataNumbers(profile, profile.id, [
				["electrical", "nominalImpedanceOhms"],
			]);
		default:
			return [];
	}
}

function validateCabinetNestedQuantities(
	profile: BuildPartProfile,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const enclosure = dataObject(profile, "enclosure");
	const dimensions = dataObject(enclosure, "dimensionsM");
	for (const key of ["width", "height", "depth"]) {
		const value = dataNumber(dimensions, key);
		if (value !== undefined && value <= 0) {
			issues.push(
				invalidProfileQuantity(profile.id, `enclosure.dimensionsM.${key}`),
			);
		}
	}
	for (const [index, port] of dataObjectArray(enclosure, "ports").entries()) {
		for (const key of ["areaM2", "lengthM", "tuningHz"]) {
			const value = dataNumber(port, key);
			if (value !== undefined && value <= 0) {
				issues.push(
					invalidProfileQuantity(
						profile.id,
						`enclosure.ports[${index}].${key}`,
					),
				);
			}
		}
	}
	for (const [index, loadout] of dataObjectArray(
		profile,
		"loadout",
	).entries()) {
		const count = dataNumber(loadout, "count");
		if (count !== undefined && (!Number.isInteger(count) || count <= 0)) {
			issues.push(
				invalidProfileQuantity(profile.id, `loadout[${index}].count`),
			);
		}
	}
	return issues;
}

function validateSimulationProfile(
	profile: SimulationProfile,
	partProfileIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const targetProfileId of profile.targetProfileIds) {
		if (!partProfileIds.has(targetProfileId)) {
			issues.push(
				unresolvedIssue(
					"simulation-profile-reference-unresolved",
					"error",
					`Simulation profile "${profile.id}" references missing target profile "${targetProfileId}"`,
					profile.id,
					"targetProfileIds",
				),
			);
		}
	}
	return issues;
}

function validatePositiveDataNumbers(
	profile: BuildPartProfile,
	profileId: string,
	paths: readonly (readonly [string, string])[],
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const [objectKey, valueKey] of paths) {
		const value = dataNumber(dataObject(profile, objectKey), valueKey);
		if (value !== undefined && value <= 0) {
			issues.push(
				invalidProfileQuantity(profileId, `${objectKey}.${valueKey}`),
			);
		}
	}
	return issues;
}

function invalidProfileQuantity(
	profileId: string,
	property: string,
): ValidationIssue {
	return {
		code: "part-profile-quantity-invalid",
		severity: "error",
		message: `Part profile "${profileId}" has invalid non-positive quantity "${property}"`,
		componentId: profileId,
		property,
	};
}

function validateCircuitPower(
	doc: CircuitDocument,
	componentIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
	const power = doc.power;
	if (power === undefined) {
		return [];
	}

	const issues: ValidationIssue[] = [];
	const domainIds = new Set<string>();
	const railOwners = new Map<string, string>();
	const converterRoleOwners = new Map<string, string>();
	const componentsById = new Map(
		doc.components.map((component) => [component.id, component] as const),
	);

	const expectsDomains =
		power.coverage === "explicit-topology" ||
		power.coverage === "declared-rails";
	if (!expectsDomains && power.domains.length > 0) {
		issues.push({
			code: "power-coverage-domains-mismatch",
			severity: "error",
			message: `power.coverage "${power.coverage}" must not declare domains, found ${power.domains.length}`,
		});
	} else if (expectsDomains && power.domains.length === 0) {
		issues.push({
			code: "power-coverage-domains-mismatch",
			severity: "warning",
			message: `power.coverage "${power.coverage}" expects at least one domain`,
		});
	}

	for (const domain of power.domains) {
		if (domainIds.has(domain.id)) {
			issues.push({
				code: "power-domain-duplicate-id",
				severity: "error",
				message: `Duplicate power domain id "${domain.id}"`,
			});
		}
		domainIds.add(domain.id);

		for (const sourceComponentId of domain.sourceComponentIds) {
			if (!componentIds.has(sourceComponentId)) {
				issues.push(
					unresolvedIssue(
						"power-source-unresolved",
						"error",
						`Power domain "${domain.id}" sourceComponentIds references missing component "${sourceComponentId}"`,
						sourceComponentId,
						"sourceComponentIds",
					),
				);
			}
		}

		const railsById = new Map(
			domain.rails.map((rail) => [rail.railComponentId, rail] as const),
		);

		for (const rail of domain.rails) {
			if (!componentIds.has(rail.railComponentId)) {
				issues.push(
					unresolvedIssue(
						"power-rail-unresolved",
						"error",
						`Power domain "${domain.id}" rail references missing component "${rail.railComponentId}"`,
						rail.railComponentId,
						"railComponentId",
					),
				);
			}

			const existingOwner = railOwners.get(rail.railComponentId);
			if (existingOwner !== undefined && existingOwner !== domain.id) {
				issues.push(
					unresolvedIssue(
						"power-rail-duplicate-ownership",
						"error",
						`Rail component "${rail.railComponentId}" is claimed by both power domains "${existingOwner}" and "${domain.id}"`,
						rail.railComponentId,
						"railComponentId",
					),
				);
			}
			railOwners.set(rail.railComponentId, domain.id);

			if (
				rail.parentRailComponentId !== undefined &&
				!railsById.has(rail.parentRailComponentId)
			) {
				issues.push(
					unresolvedIssue(
						"power-rail-parent-unresolved",
						"error",
						`Rail "${rail.railComponentId}" parentRailComponentId references a rail not declared in domain "${domain.id}"`,
						rail.parentRailComponentId,
						"parentRailComponentId",
					),
				);
			}

			const isChargePumpDerivation =
				rail.derivation === "doubler" || rail.derivation === "inverter";

			if (rail.converterComponentId === undefined) {
				if (isChargePumpDerivation) {
					issues.push({
						code: "power-rail-converter-required",
						severity: "error",
						message: `Rail "${rail.railComponentId}" derivation "${rail.derivation}" requires converterComponentId`,
						componentId: rail.railComponentId,
					});
				}
			} else {
				const converterComponent = componentsById.get(
					rail.converterComponentId,
				);
				if (converterComponent === undefined) {
					issues.push(
						unresolvedIssue(
							"power-rail-unresolved",
							"error",
							`Rail "${rail.railComponentId}" converterComponentId references missing component "${rail.converterComponentId}"`,
							rail.converterComponentId,
							"converterComponentId",
						),
					);
				} else if (converterComponent.kind !== "power-converter") {
					issues.push({
						code: "power-rail-converter-invalid-kind",
						severity: "error",
						message: `Rail "${rail.railComponentId}" converterComponentId "${rail.converterComponentId}" references a "${converterComponent.kind}" component, not a power-converter`,
						componentId: rail.converterComponentId,
					});
				}

				const converterRoleKey = `${rail.converterComponentId}::${rail.role}`;
				const existingConverterRoleOwner =
					converterRoleOwners.get(converterRoleKey);
				if (
					existingConverterRoleOwner !== undefined &&
					existingConverterRoleOwner !== rail.railComponentId
				) {
					issues.push({
						code: "power-rail-duplicate-converter-role",
						severity: "error",
						message: `Converter "${rail.converterComponentId}" already has a rail with role "${rail.role}" (rail "${existingConverterRoleOwner}"); rail "${rail.railComponentId}" duplicates it`,
						componentId: rail.railComponentId,
					});
				}
				converterRoleOwners.set(converterRoleKey, rail.railComponentId);
			}

			if (rail.role === "main-supply" && rail.derivation !== "direct") {
				issues.push({
					code: "power-rail-role-derivation-mismatch",
					severity: "error",
					message: `Rail "${rail.railComponentId}" role "main-supply" is incompatible with derivation "${rail.derivation}"`,
					componentId: rail.railComponentId,
				});
			}
			if (rail.role === "regulated-output" && rail.derivation !== "regulator") {
				issues.push({
					code: "power-rail-role-derivation-mismatch",
					severity: "error",
					message: `Rail "${rail.railComponentId}" role "regulated-output" is incompatible with derivation "${rail.derivation}"`,
					componentId: rail.railComponentId,
				});
			}
			if (rail.role === "charge-pump-output" && !isChargePumpDerivation) {
				issues.push({
					code: "power-rail-role-derivation-mismatch",
					severity: "error",
					message: `Rail "${rail.railComponentId}" role "charge-pump-output" is incompatible with derivation "${rail.derivation}"`,
					componentId: rail.railComponentId,
				});
			}

			if (isChargePumpDerivation && rail.nominalVoltage === undefined) {
				issues.push({
					code: "power-rail-missing-nominal-voltage",
					severity: "warning",
					message: `Rail "${rail.railComponentId}" derivation "${rail.derivation}" has no nominalVoltage`,
					componentId: rail.railComponentId,
				});
			}
		}

		const reportedCycleMembers = new Set<string>();
		for (const rail of domain.rails) {
			if (reportedCycleMembers.has(rail.railComponentId)) {
				continue;
			}
			const cycle = findPowerRailParentCycle(rail.railComponentId, railsById);
			if (cycle !== undefined) {
				for (const member of cycle) {
					reportedCycleMembers.add(member);
				}
				issues.push({
					code: "power-rail-parent-cycle",
					severity: "error",
					message: `Power domain "${domain.id}" has a parentRailComponentId cycle: ${cycle.join(" -> ")}`,
					componentId: rail.railComponentId,
				});
			}
		}

		for (const issue of validateDomainSupplyOwnership(domain, componentsById)) {
			issues.push(issue);
		}
	}

	return issues;
}

// Kinds that can own an external-DC boundary (a ready-made DC input).
const EXTERNAL_DC_SOURCE_KINDS: ReadonlySet<ComponentKind> =
	new Set<ComponentKind>(["rail", "battery", "voltage-source"]);

// Resolves the domain's declared source kind. The interchange parser already
// normalizes the provisional `powerSourceKind` alias into `sourceKind`, but the
// alias is still honored here for documents built without that parser.
function resolveDeclaredSourceKind(
	domain: CircuitPowerDomain,
): CircuitPowerSourceKind | undefined {
	if (domain.sourceKind !== undefined) {
		return domain.sourceKind;
	}
	const legacy = domain.powerSourceKind;
	if (legacy === "mains-ac" || legacy === "external-dc") {
		return legacy;
	}
	return undefined;
}

function quoteIds(ids: readonly string[]): string {
	return ids.map((id) => `"${id}"`).join(", ");
}

/**
 * One-owner supply rule. A modeled voltage must have a single owner: a mains PSU
 * (transformer) owns what it produces, a battery/adapter owns a direct DC input,
 * and a converter/regulator/divider owns its produced output. A `kind: rail` that
 * asserts an ideal source on top of an already-owned voltage is a fixed-owner
 * conflict. This is purely power-model driven — it never reads wires, node
 * identity, connectivity completeness, or component voltage properties, so it
 * produces the same verdict for `wires: []` and a fully connected drawing.
 */
function validateDomainSupplyOwnership(
	domain: CircuitPowerDomain,
	componentsById: ReadonlyMap<string, Component>,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	// Only resolved source components participate; missing references are already
	// reported by power-source-unresolved and stay authoritative there.
	const sources = domain.sourceComponentIds
		.map((id) => componentsById.get(id))
		.filter((component): component is Component => component !== undefined);
	const transformerIds = sources
		.filter((component) => component.kind === "transformer")
		.map((component) => component.id);
	const dcSourceIds = sources
		.filter((component) => EXTERNAL_DC_SOURCE_KINDS.has(component.kind))
		.map((component) => component.id);
	const batteryIds = sources
		.filter(
			(component) =>
				component.kind === "battery" || component.kind === "voltage-source",
		)
		.map((component) => component.id);

	const declared = resolveDeclaredSourceKind(domain);

	// A declared external-DC boundary contradicted by transformer evidence is a
	// conflict; do not silently override the declaration with inference.
	if (declared === "external-dc" && transformerIds.length > 0) {
		issues.push({
			code: "power-domain-source-kind-conflict",
			severity: "error",
			message: `Power domain "${domain.id}" declares sourceKind "external-dc" but references transformer ${quoteIds(transformerIds)}; a transformer indicates a mains/AC-derived supply. Reconcile the declared source kind with the actual boundary.`,
		});
		return issues;
	}

	// Resolve the boundary kind: declaration first, then unambiguous inference from
	// source components only (never rails[], node identity, or device class).
	let kind: CircuitPowerSourceKind | undefined = declared;
	if (kind === undefined) {
		if (transformerIds.length > 0) {
			kind = "mains-ac";
		} else if (dcSourceIds.length > 0) {
			kind = "external-dc";
		}
	}
	if (kind === undefined) {
		issues.push({
			code: "power-domain-source-kind-unresolved",
			severity: "error",
			message: `Power domain "${domain.id}" has no resolvable source kind: declare sourceKind ("mains-ac" or "external-dc") or reference an unambiguous source component. Ownership cannot be inferred and rails are not checked.`,
		});
		return issues;
	}

	const railsById = new Map(
		domain.rails.map((rail) => [rail.railComponentId, rail] as const),
	);
	const referencedIds = new Set<string>([
		...domain.sourceComponentIds,
		...domain.rails.map((rail) => rail.railComponentId),
	]);

	// A single direct kind: rail may own an external-DC boundary — but only when no
	// physical battery/voltage-source is present (that component would own it) and
	// the rail is both a declared source (sourceComponentIds) and bound direct with
	// no converter.
	const directOwnerRailIds = new Set<string>();
	if (kind === "external-dc" && batteryIds.length === 0) {
		for (const id of referencedIds) {
			if (componentsById.get(id)?.kind !== "rail") continue;
			const binding = railsById.get(id);
			if (
				domain.sourceComponentIds.includes(id) &&
				binding !== undefined &&
				binding.derivation === "direct" &&
				binding.converterComponentId === undefined
			) {
				directOwnerRailIds.add(id);
			}
		}
	}

	// Boundary-owner completeness: a resolved kind still needs a real owner. A
	// declared sourceKind string must not make an ownerless domain look valid.
	const hasOwner =
		kind === "mains-ac"
			? transformerIds.length > 0
			: batteryIds.length > 0 || directOwnerRailIds.size > 0;
	if (!hasOwner) {
		issues.push({
			code: "power-domain-source-owner-unresolved",
			severity: "error",
			message:
				kind === "mains-ac"
					? `Power domain "${domain.id}" resolves to mains-ac but references no transformer to own the wall boundary; a resistor, capacitor, diode, jack, IC, or regulator in sourceComponentIds does not own it.`
					: `Power domain "${domain.id}" resolves to external-dc but has no eligible boundary owner: reference a battery/voltage-source, or a direct kind: rail listed in sourceComponentIds and bound with derivation "direct" (no converter).`,
		});
		return issues;
	}

	// Flag each referenced kind: rail that duplicates an already-owned voltage.
	for (const id of referencedIds) {
		if (componentsById.get(id)?.kind !== "rail") continue;
		if (directOwnerRailIds.has(id)) continue;
		issues.push({
			code: "power-rail-fixed-owner-conflict",
			severity: "error",
			message: fixedOwnerConflictMessage(
				domain,
				kind,
				id,
				railsById.get(id),
				batteryIds,
				transformerIds,
			),
			componentId: id,
		});
	}

	return issues;
}

function fixedOwnerConflictMessage(
	domain: CircuitPowerDomain,
	kind: CircuitPowerSourceKind,
	railId: string,
	binding: CircuitPowerRailBinding | undefined,
	batteryIds: readonly string[],
	transformerIds: readonly string[],
): string {
	let owner: string;
	if (kind === "mains-ac") {
		owner = `the mains PSU (transformer ${quoteIds(transformerIds)}) produces this voltage`;
	} else if (batteryIds.length > 0) {
		owner = `the external source ${quoteIds(batteryIds)} already owns the DC boundary`;
	} else if (binding?.converterComponentId !== undefined) {
		owner = `converter "${binding.converterComponentId}" produces this output`;
	} else if (binding !== undefined && binding.derivation !== "direct") {
		owner = `the "${binding.derivation}"-derived chain produces this output`;
	} else if (!domain.sourceComponentIds.includes(railId)) {
		owner = `it is bound as a rail but is not a declared source in sourceComponentIds`;
	} else {
		owner = `it appears only as sourceComponentIds membership without a direct rails[] binding`;
	}
	return `Rail component "${railId}" is a fixed source (kind: rail) in power domain "${domain.id}", but ${owner}. Represent the produced/derived node as kind: port (a named net) with its rails[] binding instead of a second ideal source; keep any expected value in rails[].nominalVoltage.`;
}

function findPowerRailParentCycle(
	start: string,
	railsById: ReadonlyMap<string, CircuitPowerRailBinding>,
): readonly string[] | undefined {
	const path: string[] = [];
	const onPath = new Set<string>();
	let current: string | undefined = start;
	while (current !== undefined) {
		if (onPath.has(current)) {
			return path.slice(path.indexOf(current));
		}
		path.push(current);
		onPath.add(current);
		current = railsById.get(current)?.parentRailComponentId;
	}
	return undefined;
}

function validatePowerConverterComponents(
	doc: CircuitDocument,
): readonly ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const component of doc.components) {
		if (component.kind !== "power-converter") {
			continue;
		}
		const hasPartNumber = MODEL_ALIASES.some(
			(alias) => propertyStringValue(component.properties[alias]) !== null,
		);
		if (!hasPartNumber) {
			issues.push({
				code: "power-converter-missing-part-number",
				severity: "warning",
				message: `Component "${component.id}" is a power-converter with no PartNumber`,
				componentId: component.id,
			});
		}
	}
	return issues;
}

function hasV3BuildMetadata(doc: CircuitDocument): boolean {
	return (
		doc.appearance !== undefined ||
		doc.mechanical !== undefined ||
		doc.build !== undefined ||
		doc.bom !== undefined ||
		doc.partProfiles !== undefined ||
		doc.simulationProfiles !== undefined ||
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

function dataNumber(
	object: VdspBuildDataObject | undefined,
	key: string,
): number | undefined {
	const value = object?.[key];
	return typeof value === "number" ? value : undefined;
}

function dataObject(
	object: VdspBuildDataObject | undefined,
	key: string,
): VdspBuildDataObject | undefined {
	const value = object?.[key];
	return isBuildDataObject(value) ? value : undefined;
}

function dataObjectArray(
	object: VdspBuildDataObject | undefined,
	key: string,
): readonly VdspBuildDataObject[] {
	const value = object?.[key];
	return Array.isArray(value) ? value.filter(isBuildDataObject) : [];
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

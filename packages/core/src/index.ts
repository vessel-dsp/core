export const VERSION = "0.6.39";

export type {
	CreateComponentArgs,
	DocumentCommand,
	EditorCommand,
	EditorState,
	TidyLayoutOptions,
} from "./editor";
export {
	applyDocumentCommand,
	applyEditorCommand,
	buildComponent,
	canRedo,
	canUndo,
	createEditorState,
	resetEditorState,
	tidyDocumentLayout,
} from "./editor";
export type {
	AnyCircuitElement,
	AnyCircuitElementInput,
	CircuitJson,
	CircuitJsonElement,
	CircuitJsonExport,
	CircuitJsonExportOptions,
	CircuitJsonExportTarget,
	CircuitJsonSchemaValidationIssue,
	CircuitJsonSchemaValidationResult,
	CircuitJsonSourceComponent,
	CircuitJsonSourceNet,
	CircuitJsonSourcePort,
	CircuitJsonSourceTrace,
	ParseCircuitJsonDocumentOptions,
} from "./formats/circuit-json/serializer";
export {
	parseCircuitJsonDocument,
	serializeCircuitJsonDocument,
	validateCircuitJsonDocument,
} from "./formats/circuit-json/serializer";
export type {
	CircuitDocumentConversionDiagnostic,
	CircuitDocumentConversionLossPolicy,
	CircuitDocumentFileConversionReport,
	CircuitDocumentFileFormat,
	CircuitFormat,
	ConvertCircuitDocumentFileOptions,
	ConvertCircuitDocumentFileWithReportOptions,
	ParseCircuitDocumentFileOptions,
	ParseCircuitDocumentOptions,
	SerializeCircuitDocumentFileOptions,
	SerializeVdspCircuitDocumentOptions,
	ValidateVdspCircuitDocumentSchemaOptions,
	VdspSchemaValidationIssue,
	VdspSchemaValidationResult,
} from "./formats/document";
export {
	convertCircuitDocumentFile,
	convertCircuitDocumentFileWithReport,
	detectCircuitDocumentFileFormat,
	detectCircuitFormat,
	isVdspFilename,
	parseCircuitDocument,
	parseCircuitDocumentFile,
	parseVdspCircuitDocument,
	parseVdspCircuitDocumentWithTopology,
	serializeCircuitDocumentFile,
	serializeVdspCircuitDocument,
	validateVdspCircuitDocumentSchema,
	vdspFileExtension,
	vdspFilenameFromName,
} from "./formats/document";
export { INTERCHANGE_CONTRACT_VERSION } from "./formats/interchange/contract";
export {
	AMBIGUOUS_POTENTIOMETER_END_TOKENS,
	POTENTIOMETER_TERMINAL_ROLE_ALIASES,
	POTENTIOMETER_TERMINAL_ROLES,
	classifyPotentiometerTerminalRole,
	resolveDocumentPotentiometerTerminalRoles,
	resolvePotentiometerTerminalRoles,
} from "./model/terminal-roles";
export type {
	PotentiometerTerminalRole,
	PotentiometerTerminalRoleResolution,
	PotentiometerTerminalRoleVerdict,
} from "./model/terminal-roles";
export {
	DEVICE_POLARITIES,
	POLARITIES_BY_KIND,
	POLARITY_PROPERTY_KEY,
	SUPERSEDED_POLARITY_PROPERTY_KEYS,
	classifyPolarity,
	collectPolarityIssues,
} from "./model/polarity";
export type { DevicePolarity, PolarityIssue, PolarityVerdict } from "./model/polarity";
export {
	POTENTIOMETER_TAPERS,
	SUPERSEDED_TAPER_PROPERTY_KEYS,
	TAPER_PROPERTY_KEY,
	classifyTaper,
	collectTaperIssues,
} from "./model/taper";
export type { PotentiometerTaper, TaperIssue, TaperVerdict } from "./model/taper";
export {
	WINDING_ROLES,
	validateComponentWindings,
	windingEndsAndTaps,
	windingImpedanceAcross,
	windingOfTerminal,
} from "./model/windings";
export type { WindingIssue } from "./model/windings";
export {
	componentDevices,
	deviceTerminalRoles,
	validateComponentDevices,
} from "./model/devices";
export type { DeviceValidationIssue, ResolvedComponentDevice } from "./model/devices";
export {
	AMBIGUOUS_DEVICE_TERMINAL_TOKENS,
	DEVICE_TERMINAL_ROLES,
	TERMINAL_ROLES_BY_KIND,
	collectTerminalRoleWarnings,
	isLegalTerminalRole,
	terminalRolesFor,
	SUFFIXABLE_DEVICE_TERMINAL_ROLES,
	classifyDeviceTerminalRole,
	isRoledDeviceKind,
	resolveComponentTerminalRoles,
} from "./model/device-terminal-roles";
export type {
	DeviceTerminalRole,
	DeviceTerminalRoleVerdict,
	RoledDeviceKind,
	TerminalRole,
} from "./model/device-terminal-roles";
export type { InterchangeTopologyParseResult } from "./formats/interchange/parser";
export {
	parseInterchangeYaml,
	parseInterchangeYamlWithTopology,
} from "./formats/interchange/parser";
export type {
	InterchangeSourceFormat,
	SerializeInterchangeYamlOptions,
} from "./formats/interchange/serializer";
export { serializeInterchangeYaml } from "./formats/interchange/serializer";
export { parseLtspiceAsc } from "./formats/ltspice/parser";
export type { SerializeLtspiceAscOptions } from "./formats/ltspice/serializer";
export { serializeLtspiceAsc } from "./formats/ltspice/serializer";
export { parseSchx } from "./formats/schx/parser";
export { serializeSchx } from "./formats/schx/serializer";
export { parseSpiceNetlist } from "./formats/spice/parser";
export { serializeSpiceNetlist } from "./formats/spice/serializer";
export type { Connectivity, NodeId, PinRef } from "./model/connectivity";
export { getPinNode, pinKey, resolveConnectivity } from "./model/connectivity";
export type {
	NetlistComponent,
	NetlistView,
	SpiceLetter,
} from "./model/netlist";
export {
	getSpiceLetter,
	getSpiceNodeOrder,
	kindForSpiceLetter,
	toNetlistView,
} from "./model/netlist";
export {
	isParsedQuantity,
	isPropertyObject,
	propertyBooleanValue,
	propertyNumericValue,
	propertyQuantityValue,
	propertyStringValue,
	propertyValueForSourceAttribute,
} from "./model/properties";
export { parseQuantity } from "./model/quantity";
export type { TracePlausibilityOptions } from "./model/trace-plausibility";
export {
	traceConnectivityCompleteness,
	validateAudioTopologyWarnings,
	validatePreferredValues,
	validateRcCornerHeuristic,
	validateTracePlausibility,
	validateTraceStructure,
} from "./model/trace-plausibility";
export type {
	BoardApplicability,
	BoardEdgeTerminal,
	BoardFamily,
	BoardFootprint,
	BoardFootprintCatalog,
	BoardFootprintPlacement,
	BoardHole,
	BoardKind,
	BoardNet,
	BoardNetlist,
	BoardNetMember,
	BoardNetRef,
	BoardPlacedPad,
	BoardRealization,
	BoardReview,
	BoardRoute,
	BoardSourceCircuitHash,
	BoardSubtype,
	BuildBom,
	BuildBomItem,
	BuildBomRef,
	BuildBomRefKind,
	BuildCompleteness,
	BuildIntent,
	BuildPartProfile,
	BuildPartProfileCatalog,
	BuildScope,
	CabinetDimensionsM,
	CabinetDriverLoadout,
	CabinetEnclosure,
	CabinetEnclosureProfile,
	CabinetEnclosureType,
	CabinetPort,
	CanonicalCircuitNetRef,
	CircuitDocument,
	CircuitDocumentBehaviorFirmwareArtifactType,
	CircuitDocumentBehaviorFirmwareOwner,
	CircuitDocumentBehaviorFirmwareRef,
	CircuitDocumentBehaviorFirmwareSourceVisibility,
	CircuitDocumentBehaviorFirmwareStatus,
	CircuitDocumentBehaviorRole,
	CircuitDocumentBehaviorRoleKind,
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
	ComponentDevice,
	ComponentWinding,
	WindingImpedance,
	ComponentKind,
	ComponentTerminalRef,
	ControlApplicabilityPredicate,
	ControlContext,
	ControlGroup,
	ControlGroupMember,
	ControlInterface,
	ControlInterfaceAssignmentHint,
	ControlInterfaceBinding,
	ControlInterfaceConnector,
	ControlInterfacePolarity,
	ControlInterfaceRole,
	ControlOutput,
	ControlOutputSwitchMode,
	DeviceInterface,
	DeviceInterfaceAudioBinding,
	DeviceInterfaceBinding,
	DeviceInterfaceControl,
	DeviceInterfaceControlKind,
	DocumentAmpAppearance,
	DocumentAppearance,
	DocumentAppearanceLabel,
	DocumentAppearanceMaterial,
	DocumentMetadata,
	DocumentSource,
	DocumentStompboxAppearance,
	KnownPhysicalProfile,
	MechanicalBuildMetadata,
	MicrophoneAcousticCoupling,
	MicrophoneElectrical,
	MicrophoneTransducer,
	MicrophoneTransducerPrinciple,
	MicrophoneTransducerProfile,
	MillimeterRect,
	OffBoardSignalRef,
	OffBoardWireAttributes,
	OffBoardWiringConnection,
	OffBoardWiringCoverage,
	OffBoardWiringEndpoint,
	OffBoardWiringEndpointKind,
	OffBoardWiringHarness,
	OffBoardWiringHarnessStatus,
	OffBoardWiringPlan,
	PanelColumnOrder,
	PanelControlKind,
	PanelControlPlacement,
	PanelElementBinding,
	PanelElementPhysicalPlacement,
	PanelElementPlacement,
	PanelFace,
	PanelFaceGeometry,
	PanelGridIndexing,
	PanelGridLayout,
	PanelGridPosition,
	PanelPlacementMetadata,
	PanelRowOrder,
	ParsedQuantity,
	PhysicalProfileBase,
	PhysicalProfileIdentity,
	Point,
	ProfileResponseRef,
	PropertyObject,
	PropertyValue,
	Rotation,
	SimulationProfile,
	SimulationProfileCatalog,
	SpeakerDriverGeometry,
	SpeakerDriverProfile,
	SpeakerDriverSmallSignal,
	Terminal,
	VdspBuildDataObject,
	VdspBuildDataScalar,
	VdspBuildDataValue,
	Warning,
	WindingRole,
	Wire,
} from "./model/types";
export { EMPTY_DOCUMENT } from "./model/types";
export type {
	ControlRole,
	DocumentValidationContext,
	DocumentValidationRule,
	PropertyRule,
	QuantityRule,
	StringRule,
	ValidateDocumentOptions,
	ValidateSourceRuntimeBoundaryOptions,
	ValidationCode,
	ValidationIssue,
	ValidationSeverity,
} from "./model/validation";
export {
	CONTROL_ROLE_VALUES,
	createSourceRuntimeBoundaryRule,
	getRulesForKind,
	hasErrors,
	validateComponent,
	validateDocument,
	validateSourceRuntimeBoundary,
} from "./model/validation";
export type {
	ControlState,
	ControlValue,
	DeviceInterfaceProvenance,
	DisplayBusKind,
	DisplayGrid,
	DisplayIndicator,
	DisplayKind,
	ExternalControlAssignmentHint,
	ExtractedControlGroupMembership,
	ExtractedDeviceInterface,
	ExtractedDeviceInterfaceControl,
	JackAudioRole,
	JackPort,
	JackRole,
	Knob,
	KnobControlMode,
	KnobStep,
	KnobTaper,
	KnobValue,
	LedIndicator,
	LedValue,
	MovePanelElementOptions,
	Panel,
	PanelMessage,
	SliderControl,
	SliderOrientation,
	SliderRange,
	SliderValue,
	SwitchControl,
	SwitchKind,
	SwitchValue,
} from "./panel";
export {
	applyControlMessage,
	defaultControlState,
	extractDeviceInterface,
	extractPanel,
	isKnob,
	isKnobPositionOnStep,
	isLed,
	isSlider,
	isSwitch,
	knobStepSize,
	movePanelElement,
	nearestKnobStep,
	PANEL_PROTOCOL_VERSION,
	snapKnobPosition,
	validateMessage,
} from "./panel";
export type { Bounds } from "./preview/bounds";
export { computeDocumentBounds, viewBoxString } from "./preview/bounds";
export { computeComponentBox } from "./preview/box-layout";
export { colorForKind } from "./preview/colors";
export type { HangingEndpoint } from "./preview/hanging";
export { findHangingEndpoints } from "./preview/hanging";
export { findJunctions } from "./preview/junctions";
export {
	computeLabelTextBoxLayout,
	shouldRenderLabelTextBox,
} from "./preview/label-layout";
export type { Port, WireBodyHit } from "./preview/ports";
export {
	collectPorts,
	findNearestPort,
	findNearestWireBodyHit,
} from "./preview/ports";
export { buildRenderableWires } from "./preview/renderable-wires";
export { orthogonalPath, pointsToSvg } from "./preview/routing";
export { findSnap } from "./preview/snap";
export type { SymbolDef } from "./preview/symbols";
export { COMPONENT_KINDS, symbolFor } from "./preview/symbols";
export { findChainCorners, findWireChain } from "./preview/wire-chains";
export type {
	AmpAppearanceProfile,
	AmpControlKind,
	AmpControlPanelProfile,
	AmpControlProfile,
	AmpDimensions,
	AmpProfile,
	AmpProfileValidation,
	CabinetAppearanceProfile,
	CabinetDimensions,
	CabinetProfile,
	CabinetProfileValidation,
	ProfileValidationResult,
} from "./profiles";
export {
	ampAppearanceProfileSchema,
	ampControlKindSchema,
	ampControlPanelProfileSchema,
	ampControlProfileSchema,
	ampProfileSchema,
	cabinetAppearanceProfileSchema,
	cabinetProfileSchema,
	profileDimensionsSchema,
	validateAmpProfile,
	validateCabinetProfile,
} from "./profiles";

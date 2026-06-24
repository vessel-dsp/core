export const VERSION = '0.6.4';

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
    CanonicalCircuitNetRef,
    CircuitDocument,
    CircuitDocumentDevice,
    CircuitDocumentDeviceKind,
    Component,
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
    DeviceInterfaceBinding,
    DeviceInterfaceControl,
    DeviceInterfaceControlKind,
    DocumentMetadata,
    DocumentSource,
    MechanicalBuildMetadata,
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
    Point,
    PropertyObject,
    PropertyValue,
    Rotation,
    Terminal,
    VdspBuildDataObject,
    VdspBuildDataScalar,
    VdspBuildDataValue,
    Warning,
    Wire,
} from './model/types';
export { EMPTY_DOCUMENT } from './model/types';
export {
    isParsedQuantity,
    isPropertyObject,
    propertyBooleanValue,
    propertyNumericValue,
    propertyQuantityValue,
    propertyStringValue,
    propertyValueForSourceAttribute,
} from './model/properties';

export { parseQuantity } from './model/quantity';

export type { Connectivity, NodeId, PinRef } from './model/connectivity';
export { getPinNode, pinKey, resolveConnectivity } from './model/connectivity';

export type { NetlistComponent, NetlistView, SpiceLetter } from './model/netlist';
export { getSpiceLetter, getSpiceNodeOrder, kindForSpiceLetter, toNetlistView } from './model/netlist';

export type {
    PropertyRule,
    QuantityRule,
    StringRule,
    ValidationCode,
    ValidationIssue,
    ValidationSeverity,
} from './model/validation';
export { getRulesForKind, hasErrors, validateComponent, validateDocument } from './model/validation';

export { parseSchx } from './formats/schx/parser';
export { serializeSchx } from './formats/schx/serializer';
export { parseSpiceNetlist } from './formats/spice/parser';
export { serializeSpiceNetlist } from './formats/spice/serializer';
export type { InterchangeSourceFormat, SerializeInterchangeYamlOptions } from './formats/interchange/serializer';
export { parseInterchangeYaml } from './formats/interchange/parser';
export { serializeInterchangeYaml } from './formats/interchange/serializer';
export type {
    CircuitFormat,
    CircuitDocumentFileFormat,
    ParseCircuitDocumentOptions,
    ParseCircuitDocumentFileOptions,
    SerializeCircuitDocumentFileOptions,
    SerializeVdspCircuitDocumentOptions,
    ConvertCircuitDocumentFileOptions,
    ConvertCircuitDocumentFileWithReportOptions,
    CircuitDocumentConversionDiagnostic,
    CircuitDocumentConversionLossPolicy,
    CircuitDocumentFileConversionReport,
    VdspSchemaValidationIssue,
    VdspSchemaValidationResult,
} from './formats/document';
export {
    detectCircuitFormat,
    parseCircuitDocument,
    vdspFileExtension,
    isVdspFilename,
    detectCircuitDocumentFileFormat,
    vdspFilenameFromName,
    parseVdspCircuitDocument,
    validateVdspCircuitDocumentSchema,
    parseCircuitDocumentFile,
    serializeCircuitDocumentFile,
    convertCircuitDocumentFile,
    convertCircuitDocumentFileWithReport,
    serializeVdspCircuitDocument,
} from './formats/document';
export { parseLtspiceAsc } from './formats/ltspice/parser';
export type { SerializeLtspiceAscOptions } from './formats/ltspice/serializer';
export { serializeLtspiceAsc } from './formats/ltspice/serializer';

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
    ParseCircuitJsonDocumentOptions,
    CircuitJsonSourceComponent,
    CircuitJsonSourceNet,
    CircuitJsonSourcePort,
    CircuitJsonSourceTrace,
} from './formats/circuit-json/serializer';
export {
    parseCircuitJsonDocument,
    serializeCircuitJsonDocument,
    validateCircuitJsonDocument,
} from './formats/circuit-json/serializer';

export type { CreateComponentArgs, DocumentCommand, EditorCommand, EditorState } from './editor';
export {
    applyDocumentCommand,
    applyEditorCommand,
    buildComponent,
    canRedo,
    canUndo,
    createEditorState,
    resetEditorState,
    tidyDocumentLayout,
} from './editor';
export type { TidyLayoutOptions } from './editor';

export type { Bounds } from './preview/bounds';
export { computeComponentBox } from './preview/box-layout';
export { computeDocumentBounds, viewBoxString } from './preview/bounds';
export { colorForKind } from './preview/colors';
export type { SymbolDef } from './preview/symbols';
export { symbolFor, COMPONENT_KINDS } from './preview/symbols';
export type { HangingEndpoint } from './preview/hanging';
export { findHangingEndpoints } from './preview/hanging';
export { findJunctions } from './preview/junctions';
export { computeLabelTextBoxLayout, shouldRenderLabelTextBox } from './preview/label-layout';
export type { Port, WireBodyHit } from './preview/ports';
export { collectPorts, findNearestPort, findNearestWireBodyHit } from './preview/ports';
export { buildRenderableWires } from './preview/renderable-wires';
export { orthogonalPath, pointsToSvg } from './preview/routing';
export { findSnap } from './preview/snap';
export { findChainCorners, findWireChain } from './preview/wire-chains';

export type {
    ControlState,
    ControlValue,
    DeviceInterfaceProvenance,
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
    Panel,
    PanelMessage,
    SliderControl,
    SliderOrientation,
    SliderRange,
    SliderValue,
    SwitchControl,
    SwitchKind,
    SwitchValue,
    MovePanelElementOptions,
} from './panel';
export {
    applyControlMessage,
    defaultControlState,
    extractDeviceInterface,
    extractPanel,
    isKnobPositionOnStep,
    isKnob,
    isLed,
    isSlider,
    isSwitch,
    knobStepSize,
    movePanelElement,
    nearestKnobStep,
    PANEL_PROTOCOL_VERSION,
    snapKnobPosition,
    validateMessage,
} from './panel';

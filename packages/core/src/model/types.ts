export type Point = Readonly<{ x: number; y: number }>;

export type Rotation = 0 | 1 | 2 | 3;

export type ParsedQuantity = Readonly<{
	raw: string;
	value: number;
	unit: string;
}>;

export type ComponentKind =
	| "resistor"
	| "capacitor"
	| "inductor"
	| "diode"
	| "led"
	| "bjt"
	| "jfet"
	| "mosfet"
	| "opamp"
	| "ota"
	| "triode"
	| "pentode"
	| "tube-diode"
	| "transformer"
	| "potentiometer"
	| "variable-resistor"
	| "switch"
	| "optocoupler"
	| "voltage-source"
	| "current-source"
	| "battery"
	| "ground"
	| "rail"
	| "jack"
	| "bbd"
	| "delay-ic"
	| "power-amp"
	| "regulator"
	| "analog-switch"
	| "flipflop"
	| "ic"
	| "label"
	| "named-wire"
	| "port"
	| "unsupported";

export type Terminal = Readonly<{
	name: string;
	position: Point;
}>;

export type PropertyObject = Readonly<{
	readonly [key: string]: PropertyValue;
}>;

export type PropertyValue =
	| ParsedQuantity
	| string
	| number
	| boolean
	| null
	| readonly PropertyValue[]
	| PropertyObject;

export type Component = Readonly<{
	id: string;
	kind: ComponentKind;
	name: string;
	origin: Point;
	rotation: Rotation;
	flipped: boolean;
	terminals: readonly Terminal[];
	properties: Readonly<Record<string, PropertyValue>>;
	sourceTypeName: string | null;
}>;

export type Wire = Readonly<{
	id: string;
	endpoints: readonly [Point, Point];
}>;

export type DocumentMetadata = Readonly<{
	name: string;
	description: string;
	partNumber: string;
}>;

/**
 * Portable source metadata carried by the document itself.
 *
 * Keep artifact-private provenance ledgers, packet-local paths, source hashes,
 * and source-trace evidence in the consuming project's catalog or packet docs.
 */
export type DocumentSource = Readonly<Record<string, string>>;

export type DocumentAppearanceMaterial = VdspBuildDataObject &
	Readonly<{
		color?: string;
		strokeColor?: string;
		offColor?: string;
		pressedColor?: string;
		emissive?: boolean;
		intensity?: number;
		metallicFactor?: number;
		roughnessFactor?: number;
		opacity?: number;
	}>;

export type DocumentAppearanceLabel = VdspBuildDataObject &
	Readonly<{
		text?: string;
		color?: string;
		fontFamily?: string;
		fontSizeMm?: number;
	}>;

export type DocumentStompboxAppearance = VdspBuildDataObject &
	Readonly<{
		kind: "stompbox";
		enclosure?: DocumentAppearanceMaterial;
		template?: DocumentAppearanceMaterial;
		defaults?: VdspBuildDataObject;
		controls?: Readonly<Record<string, VdspBuildDataObject>>;
		parts?: Readonly<Record<string, DocumentAppearanceMaterial>>;
		labels?: Readonly<Record<string, DocumentAppearanceLabel>>;
	}>;

export type DocumentAmpAppearance = VdspBuildDataObject &
	Readonly<{
		kind: "amp";
		enclosureColor?: string;
		appearance?: VdspBuildDataObject;
	}>;

export type DocumentAppearance =
	| DocumentStompboxAppearance
	| DocumentAmpAppearance;

export type ControlInterfaceRole =
	| "external-control"
	| "tempo-tap"
	| "trigger"
	| "reset"
	| "sampler-trigger"
	| "expression"
	| "unknown";

export type ControlInterfaceConnector =
	| "1/4-inch-mono-ts"
	| "1/4-inch-trs"
	| "3.5mm-mono-ts"
	| "3.5mm-trs"
	| "proprietary"
	| "unknown";

export type ControlInterfaceAssignmentHint =
	| "momentary"
	| "latching"
	| "momentary-or-latching"
	| "continuous";

export type ControlInterfacePolarity =
	| "normally-open"
	| "normally-closed"
	| "expression"
	| "unknown";

export type ControlInterfaceBinding = Readonly<{
	sourceComponentId?: string;
	controlId?: string;
	controlName?: string;
	property?: string;
}>;

export type ControlInterface = Readonly<{
	id: string;
	name: string;
	role: ControlInterfaceRole;
	componentId?: string;
	controlRole?: string;
	interface?: string;
	connector?: ControlInterfaceConnector;
	assignmentHint?: ControlInterfaceAssignmentHint;
	polarity?: ControlInterfacePolarity;
	binding?: ControlInterfaceBinding;
	description?: string;
}>;

export type CircuitDocumentDeviceKind =
	| "audio-pedal"
	| "control-accessory"
	| "utility"
	| "unknown";

export type CircuitDocumentDevice = Readonly<{
	id?: string;
	version?: number;
	kind: CircuitDocumentDeviceKind;
	family?: string;
	model?: string;
	audioProcessing?: boolean;
}>;

export type ControlOutputSwitchMode = "momentary" | "latching";

export type ControlOutput = Readonly<{
	id: string;
	name: string;
	role: ControlInterfaceRole;
	connector?: ControlInterfaceConnector;
	switchMode?: ControlOutputSwitchMode;
	polarity?: ControlInterfacePolarity;
	inactiveValue?: number;
	activeValue?: number;
	componentId?: string;
	description?: string;
}>;

export type ControlContext = Readonly<{
	id: string;
	name: string;
	role: string;
	description?: string;
}>;

export type ControlApplicabilityPredicate = Readonly<{
	allOf?: readonly string[];
	anyOf?: readonly string[];
}>;

export type ControlGroupMember = Readonly<{
	controlId: string;
	order?: number;
	appliesWhen?: ControlApplicabilityPredicate;
	description?: string;
}>;

export type ControlGroup = Readonly<{
	id: string;
	name: string;
	role: string;
	contextIds?: readonly string[];
	description?: string;
	members?: readonly ControlGroupMember[];
}>;

export type DeviceInterfaceControlKind =
	| "knob"
	| "slider"
	| "switch"
	| "selector"
	| "footswitch"
	| "led"
	| "jack";

export type DeviceInterfaceBinding = Readonly<{
	componentId: string;
	controlId?: string;
	controlName?: string;
	property?: string;
	externalInterfaceId?: string;
}>;

export type DeviceInterfaceAudioBinding = Readonly<{
	kind: "control";
	controlName: string;
}>;

export type DeviceInterfaceControl = Readonly<{
	id: string;
	label: string;
	kind: DeviceInterfaceControlKind;
	role: string;
	groupId?: string;
	order?: number;
	audioBinding?: DeviceInterfaceAudioBinding;
	binding?: DeviceInterfaceBinding;
	appliesWhen?: ControlApplicabilityPredicate;
	description?: string;
}>;

export type DeviceInterface = Readonly<{
	controls: readonly DeviceInterfaceControl[];
}>;

export type PanelGridIndexing = "one-based" | "zero-based";

export type PanelRowOrder = "top-to-bottom" | "bottom-to-top";

export type PanelColumnOrder = "left-to-right" | "right-to-left";

export type PanelGridLayout = Readonly<{
	kind: "stompbox-grid";
	rows: number;
	columns: number;
	indexing: PanelGridIndexing;
	rowOrder?: PanelRowOrder;
	columnOrder?: PanelColumnOrder;
}>;

export type PanelControlKind =
	| "knob"
	| "slider"
	| "switch"
	| "selector"
	| "footswitch"
	| "led"
	| "jack";

export type PanelGridPosition = Readonly<{
	row: number;
	column: number;
	rowSpan?: number;
	columnSpan?: number;
}>;

export type PanelElementBinding = Readonly<{
	componentId: string;
	controlId?: string;
	controlName?: string;
	property?: string;
}>;

export type PanelElementPlacement = Readonly<{
	id?: string;
	bind: PanelElementBinding;
	kind: PanelControlKind;
	grid: PanelGridPosition;
	label?: string;
	interfaceControlId?: string;
	physical?: PanelElementPhysicalPlacement;
}>;

/** @deprecated Use PanelElementPlacement. */
export type PanelControlPlacement = PanelElementPlacement;

export type PanelFace = Readonly<{
	id: string;
	label?: string;
	layout: PanelGridLayout;
	geometry?: PanelFaceGeometry;
	elements: readonly PanelElementPlacement[];
}>;

export type PanelPlacementMetadata = Readonly<{
	faces: readonly PanelFace[];
}>;

export type VdspBuildDataScalar = string | number | boolean | null;

export type VdspBuildDataValue =
	| VdspBuildDataScalar
	| readonly VdspBuildDataValue[]
	| VdspBuildDataObject;

export type VdspBuildDataObject = Readonly<{
	readonly [key: string]: VdspBuildDataValue | undefined;
}>;

export type MillimeterRect = Readonly<{
	x: number;
	y: number;
	width: number;
	height: number;
}>;

export type PanelFaceGeometry = VdspBuildDataObject &
	Readonly<{
		units?: string;
		surface?: string;
		usableRectMm?: MillimeterRect;
	}>;

export type PanelElementPhysicalPlacement = VdspBuildDataObject &
	Readonly<{
		units?: string;
		centerMm?: Point;
		drillDiameterMm?: number;
		partProfileId?: string;
		locked?: boolean;
		/**
		 * Groups peer placement elements that share one physical part occupying a
		 * single mounting hole — e.g. the stacked sections of a concentric pot.
		 * Every element in a mount group references the same `partProfileId` and
		 * `centerMm`; each names a distinct `surface` of that part.
		 */
		mountId?: string;
		/**
		 * Which surface of a multi-surface part this element occupies (e.g. a
		 * concentric pot's stacked dial id such as `lower`/`upper`, declared by the
		 * part profile). Only meaningful together with `mountId`.
		 */
		surface?: string;
	}>;

export type BuildIntent = "diy-build-artifact" | "schema-review-sample";

export type BuildCompleteness =
	| "complete-selected-build"
	| "partial-offboard-wiring";

export type BuildScope = VdspBuildDataObject &
	Readonly<{
		schema: "build-scope/v1";
		intent?: BuildIntent;
		completeness?: BuildCompleteness;
		selectedBoardId?: string;
		selectedOffBoardWiringHarnessIds?: readonly string[];
		alternateBoardIds?: readonly string[];
		bomScope?: string;
	}>;

export type MechanicalBuildMetadata = VdspBuildDataObject &
	Readonly<{
		schema?: string;
		units?: string;
		coordinateSystem?: VdspBuildDataObject;
		enclosure?: VdspBuildDataObject &
			Readonly<{
				profileId?: string;
				label?: string;
				outerSizeMm?: VdspBuildDataObject;
				wallThicknessMm?: number;
			}>;
		internalBoard?: VdspBuildDataObject &
			Readonly<{
				preferredBoardId?: string;
				usableRectMm?: MillimeterRect;
				keepoutRectsMm?: readonly VdspBuildDataObject[];
			}>;
	}>;

export type BuildBomRefKind =
	| "component"
	| "device-interface-control"
	| "panel-element"
	| "board"
	| "freeform-build-item";

export type BuildBomRef = VdspBuildDataObject &
	Readonly<{
		kind: BuildBomRefKind;
		componentId?: string;
		controlId?: string;
		panelElementId?: string;
		boardId?: string;
		label?: string;
	}>;

export type BuildBomItem = VdspBuildDataObject &
	Readonly<{
		id: string;
		refs: readonly BuildBomRef[];
		quantity: number;
		value?: string;
		partProfileId?: string;
		category?: string;
		sku?: string;
	}>;

export type BuildBom = VdspBuildDataObject &
	Readonly<{
		schema: "build-bom/v1";
		items: readonly BuildBomItem[];
	}>;

export type BuildPartProfile = VdspBuildDataObject &
	Readonly<{
		id: string;
		kind?: string;
	}>;

export type BuildPartProfileCatalog = VdspBuildDataObject &
	Readonly<{
		schema: "part-profile-catalog/v1";
		resolution?: string;
		units?: string;
		profiles: readonly BuildPartProfile[];
	}>;

export type BoardFootprint = VdspBuildDataObject &
	Readonly<{
		id: string;
		boardApplicability?: BoardApplicability;
	}>;

export type BoardFootprintCatalog = VdspBuildDataObject &
	Readonly<{
		schema: "board-footprint-catalog/v1";
		resolution?: string;
		units?: string;
		footprints: readonly BoardFootprint[];
	}>;

export type OffBoardWiringCoverage =
	| "selected-build-complete"
	| "representative-selected-build-endpoints";

export type OffBoardWiringHarnessStatus = "complete" | "partial" | "candidate";

export type OffBoardWiringEndpointKind =
	| "panel-component-terminal"
	| "board-terminal"
	| "power-terminal"
	| "footswitch-terminal"
	| "free-wire-label";

export type OffBoardWiringEndpoint = VdspBuildDataObject &
	Readonly<{
		id: string;
		kind: OffBoardWiringEndpointKind;
		componentId?: string;
		terminalName?: string;
		panelElementId?: string;
		boardId?: string;
		terminalId?: string;
		label?: string;
	}>;

export type BoardNetRef = VdspBuildDataObject &
	Readonly<{
		source: "board-netlist";
		boardId?: string;
		netId: string;
	}>;

export type CanonicalCircuitNetRef = VdspBuildDataObject &
	Readonly<{
		source: "canonical-circuit";
		member?: ComponentTerminalRef;
	}>;

export type OffBoardSignalRef =
	| BoardNetRef
	| CanonicalCircuitNetRef
	| VdspBuildDataObject;

export type OffBoardWireAttributes = VdspBuildDataObject &
	Readonly<{
		color?: string;
		gaugeAwg?: number;
		reviewedLengthMm?: number;
		groupId?: string;
	}>;

export type OffBoardWiringConnection = VdspBuildDataObject &
	Readonly<{
		id: string;
		fromEndpointId: string;
		toEndpointId: string;
		signalRef?: OffBoardSignalRef;
		wire?: OffBoardWireAttributes;
	}>;

export type OffBoardWiringHarness = VdspBuildDataObject &
	Readonly<{
		id: string;
		status?: OffBoardWiringHarnessStatus;
		notes?: string;
		endpoints: readonly OffBoardWiringEndpoint[];
		connections: readonly OffBoardWiringConnection[];
	}>;

export type OffBoardWiringPlan = VdspBuildDataObject &
	Readonly<{
		schema: "offboard-wiring/v1";
		source?: string;
		coverage?: OffBoardWiringCoverage;
		harnesses: readonly OffBoardWiringHarness[];
	}>;

export type BoardFamily = "prototype-board" | "fabricated-board";

export type BoardKind =
	| "stripboard"
	| "perfboard"
	| "breadboard-pattern"
	| "pcb";

export type BoardSubtype =
	| "veroboard"
	| "isolated-pad"
	| "solderable-half-breadboard"
	| "single-sided-through-hole"
	| "two-layer-through-hole";

export type BoardApplicability = VdspBuildDataObject &
	Readonly<{
		family: BoardFamily;
		kind: BoardKind;
		subtype?: BoardSubtype;
	}>;

export type ComponentTerminalRef = VdspBuildDataObject &
	Readonly<{
		componentId: string;
		terminalName: string;
	}>;

export type BoardSourceCircuitHash = VdspBuildDataObject &
	Readonly<{
		schema: "canonical-circuit-facts-hash/v1";
		hashAlgorithm: "sha256";
		hash: string;
	}>;

export type BoardHole = VdspBuildDataObject &
	Readonly<{
		row: number;
		column: number;
	}>;

export type BoardEdgeTerminal = VdspBuildDataObject &
	Readonly<{
		id: string;
		role?: string;
		terminalRef?: ComponentTerminalRef;
		hole?: BoardHole;
	}>;

export type BoardPlacedPad = VdspBuildDataObject &
	Readonly<{
		padId: string;
		terminalName?: string;
		hole?: BoardHole;
		positionMm?: Point;
	}>;

export type BoardFootprintPlacement = VdspBuildDataObject &
	Readonly<{
		componentId: string;
		footprintId: string;
		atGrid?: BoardHole;
		atMm?: Point;
		rotationDeg?: number;
		pads: readonly BoardPlacedPad[];
	}>;

export type BoardNetMember = VdspBuildDataObject &
	Readonly<{
		componentId: string;
		terminalName: string;
		padId?: string;
		terminalId?: string;
	}>;

export type BoardNet = VdspBuildDataObject &
	Readonly<{
		id: string;
		name?: string;
		members: readonly BoardNetMember[];
	}>;

export type BoardNetlist = VdspBuildDataObject &
	Readonly<{
		source?: string;
		nets: readonly BoardNet[];
	}>;

export type BoardRoute = VdspBuildDataObject &
	Readonly<{
		id: string;
		netRef?: BoardNetRef | CanonicalCircuitNetRef | VdspBuildDataObject;
		locked?: boolean;
		conductors?: readonly VdspBuildDataObject[];
		copper?: readonly VdspBuildDataObject[];
		vias?: readonly VdspBuildDataObject[];
		zones?: readonly VdspBuildDataObject[];
		drills?: readonly VdspBuildDataObject[];
	}>;

export type BoardReview = VdspBuildDataObject &
	Readonly<{
		status?: "buildable" | "candidate" | "stale" | string;
		reviewedBy?: string;
		reviewedAt?: string;
		notes?: string;
	}>;

export type BoardRealization = VdspBuildDataObject &
	Readonly<{
		id: string;
		schema: "circuit-board/v1";
		family: BoardFamily;
		kind: BoardKind;
		subtype?: BoardSubtype;
		source?: string;
		units?: string;
		locked?: boolean;
		sourceCircuit?: BoardSourceCircuitHash;
		edgeTerminals: readonly BoardEdgeTerminal[];
		footprintPlacements: readonly BoardFootprintPlacement[];
		netlist?: BoardNetlist;
		routes: readonly BoardRoute[];
		zones?: readonly VdspBuildDataObject[];
		drills?: readonly VdspBuildDataObject[];
		review?: BoardReview;
	}>;

export type Warning = Readonly<{
	code: string;
	message: string;
	componentId?: string;
	wireId?: string;
}>;

/**
 * Normalized source-visible circuit document.
 *
 * Hosts can render this graph as an inspectable schematic and lower it into
 * their own simulator/runtime. Runtime lowering may replace source-visible
 * sections with compact MNA, reusable kernels, or macro DSP, but the document
 * should preserve the user-facing schematic/control semantics needed to audit
 * that mapping.
 */
export type CircuitDocument = Readonly<{
	metadata: DocumentMetadata;
	source?: DocumentSource;
	device?: CircuitDocumentDevice;
	appearance?: DocumentAppearance;
	controlGroups?: readonly ControlGroup[];
	controlContexts?: readonly ControlContext[];
	mechanical?: MechanicalBuildMetadata;
	build?: BuildScope;
	bom?: BuildBom;
	partProfiles?: BuildPartProfileCatalog;
	footprints?: BoardFootprintCatalog;
	offBoardWiring?: OffBoardWiringPlan;
	boards?: readonly BoardRealization[];
	deviceInterface?: DeviceInterface;
	panel?: PanelPlacementMetadata;
	controlInterfaces?: readonly ControlInterface[];
	controlOutputs?: readonly ControlOutput[];
	components: readonly Component[];
	wires: readonly Wire[];
	directives: readonly string[];
	warnings: readonly Warning[];
	rawAttributes: Readonly<Record<string, string>>;
}>;

export const EMPTY_DOCUMENT: CircuitDocument = {
	metadata: { name: "", description: "", partNumber: "" },
	source: {},
	components: [],
	wires: [],
	directives: [],
	warnings: [],
	rawAttributes: {},
};

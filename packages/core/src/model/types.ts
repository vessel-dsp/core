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
	| "display"
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
	| "fuse"
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
	| "power-converter"
	| "analog-switch"
	| "flipflop"
	| "ic"
	| "label"
	| "named-wire"
	| "port"
	| "unsupported";

export type Terminal = Readonly<{
	/**
	 * The pin's identity. Referenced as `<componentId>.<name>` by the `nodes` ledger, so it must
	 * be unique within its component -- which is why it cannot also be the role: a dual rectifier
	 * has two plates and can only name one of them `plate`.
	 *
	 * Free text on purpose. It is what the source printed, and nothing infers behaviour from it.
	 */
	name: string;
	/**
	 * Which electrode this is. See `TERMINAL_ROLES_BY_KIND` for the roles each component kind may
	 * declare.
	 *
	 * Optional in the *type* only so that documents written before 0.6.28 still parse; the format
	 * requires it, and a terminal without one is reported by `collectTerminalRoleWarnings`. Treat
	 * `undefined` as "this document predates the field", never as "this terminal has no role".
	 *
	 * A role may repeat within a component -- a resistor's two ends are both `end`, a dual
	 * rectifier's two plates both `plate`. The unique `name` is what distinguishes them, and a
	 * device that groups several terminals refers to them by name. There is deliberately no index
	 * field: it labelled a terminal without saying which device inside the package it belonged to,
	 * which is the part a name-referencing device list states directly.
	 */
	role?: string;
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

export type CircuitDocumentBehaviorFirmwareStatus =
	| "recovered"
	| "source-bounded-approximation"
	| "measured-approximation"
	| "unknown-proprietary"
	| "dumped"
	| "verified";

export type CircuitDocumentBehaviorFirmwareArtifactType =
	| "hex"
	| "bin"
	| "mask-rom"
	| "internal-rom"
	| "external-rom";

export type CircuitDocumentBehaviorFirmwareSourceVisibility =
	| "not-visible"
	| "visible-chip-marking"
	| "dump-available"
	| "source-available";

export type CircuitDocumentBehaviorFirmwareOwner =
	| "firmware-proxy"
	| "recovered-firmware"
	| "measured-blackbox";

export type CircuitDocumentBehaviorFirmwareRef = Readonly<{
	id?: string;
	status: CircuitDocumentBehaviorFirmwareStatus;
	version?: string;
	hash?: string;
	artifactType?: CircuitDocumentBehaviorFirmwareArtifactType;
	sourceVisibility?: CircuitDocumentBehaviorFirmwareSourceVisibility;
	behaviorOwner?: CircuitDocumentBehaviorFirmwareOwner;
	memoryComponentId?: string;
	mcuComponentId?: string;
	notes?: string;
}>;

export type CircuitDocumentBehaviorRoleKind =
	| "chip-primitive"
	| "firmware-dsp-core"
	| "behavior-profile"
	| "measured-blackbox";

export type CircuitDocumentBehaviorRole = Readonly<{
	kind: CircuitDocumentBehaviorRoleKind;
	firmwareRef?: CircuitDocumentBehaviorFirmwareRef;
}>;

/**
 * One device inside a component's package.
 *
 * A component models a schematic **symbol**, which may hold several devices: a dual rectifier is
 * two diodes on one cathode, a dual op-amp two amplifiers on one supply pair, an optocoupler an
 * LED beside a photoresistor. Consumers need the devices, and before this construct each one
 * reconstructed the split by parsing terminal names.
 *
 * See `docs/device-construct-design.md` for the survey this is built from and for the two cases
 * that are *not* uses of it: transformer windings and switch poles both group the terminals of a
 * single device, which is the opposite claim.
 */
export type ComponentDevice = Readonly<{
	/** Unique within its component. Addressable as `<componentId>.<deviceId>`. */
	id: string;
	/**
	 * This device's law. Omitted means the component's own `kind`, which is the common case; an
	 * optocoupler is why it can differ, holding an `led` and a `variable-resistor`.
	 */
	kind?: ComponentKind;
	/**
	 * The component terminals this device uses, by `name`.
	 *
	 * By name rather than index or position: a name is already unique within its component -- the
	 * `nodes` ledger addresses pins as `<componentId>.<name>` and core refuses duplicates -- so a
	 * name is a sufficient reference, and stating membership here is what an index could not do.
	 *
	 * A terminal may appear in several devices. The shared cathode of a dual rectifier and the
	 * shared supplies of a dual op-amp are the ordinary case, not an exception.
	 *
	 * Order carries no meaning. A device binds by the `role` its terminals declare, and the
	 * ambiguity a role could not resolve existed only across the whole package.
	 */
	terminals: readonly string[];
}>;

/**
 * What a winding is for.
 *
 * Taken from the groups a consumer's spelling table produces, plus the two an electromechanical
 * transducer needs. `drive`/`pickup` are a spring reverb tank: its coils are a driver and a
 * pickup, and which is which decides whether the recovery amp's signal goes into the springs or
 * comes out of them -- not a distinction `primary`/`secondary` can carry, because neither coil
 * transforms the other's voltage.
 *
 * A role may repeat on one transformer. `orange-rockerverb`'s power transformer carries two
 * filament windings, a 3.15-0-3.15 V pair for the power tubes and a 6.3 V pair for the preamp;
 * a record keyed on a role, or on a terminal spelling, has nowhere to put the second. Windings
 * are distinguished by their terminals, or by an optional `id`.
 *
 * There is deliberately no `shield` role. A shield is a grounded foil between windings, not a
 * coil, and `role: shield` on the terminal says all of it.
 */
export type WindingRole =
	| "primary"
	| "secondary"
	| "hv"
	| "filament"
	| "rectifier-heater"
	| "bias"
	| "low-voltage"
	| "auxiliary"
	| "drive"
	| "pickup";

/**
 * One coil of a transformer.
 *
 * See `model/windings.ts` for the survey this is built from and for why it is the sibling of
 * `ComponentDevice` rather than a use of it.
 */
export type ComponentWinding = Readonly<{
	/** Optional, for reference and diagnostics. Unique within its component when given. */
	id?: string;
	role: WindingRole;
	/**
	 * The component terminals forming this coil, **in order along it**, by `name`.
	 *
	 * Order is the only thing that places a tap: `[hv_a, hv_center_tap, hv_b]` says the centre tap
	 * sits between the ends, and `[secondary_common, secondary_4, secondary_8, secondary_16]` says
	 * those impedance taps ascend from the common end. Which entries are ends and which are taps
	 * comes from each terminal's own `role` (`winding` or `windingTap`), so this list does not
	 * repeat it.
	 *
	 * A role may repeat across windings -- `orange-rockerverb`'s power transformer carries two
	 * `filament` coils -- so windings are distinguished by their terminals, or by `id` where a
	 * document gives one.
	 */
	terminals: readonly string[];
	/**
	 * This coil's rated AC voltage, **across the pair a stamp uses**: per half where the coil
	 * declares a `windingCenterTap`, end to end otherwise.
	 *
	 * That is how a transformer is printed. Nobody rates a 330-0-330 V winding "660 V", and
	 * `fender-5e3-deluxe-tweed`'s own `Derivation` property says its 330 "is the per-half voltage
	 * of the stated center-tapped 330-0-330 winding". The centre tap being declared is what makes
	 * the convention unambiguous rather than a guess.
	 *
	 * It belongs here and not in component properties because a property keyed on a winding class
	 * holds one value per class. `orange-rockerverb` states 3.15 V for its power-tube heater coil
	 * and 6 V for its preamp heater coil, and had to invent `PowerTubeFilamentSecondary` and
	 * `PreampHeaterSecondary` to say so -- the quantity-side twin of the `secondaryalt3` problem
	 * `windings` already deleted.
	 */
	voltage?: ParsedQuantity;
	/**
	 * Rated impedances, each stating the terminal pair it is measured across.
	 *
	 * **The pair is explicit because transformers are not rated by one convention.** A primary is
	 * printed plate-to-plate -- end to end, across its centre tap -- while a speaker secondary is
	 * printed from its common to each tap. `orange-gro100`'s output transformer states four
	 * ratings on one coil (100 V line, 15 Ω, 7.5 Ω, 3.75 Ω) and `orange-rockerverb`'s states two
	 * that are simultaneously loaded. A single number per winding cannot hold that, and a
	 * convention about which pair a bare number means would be wrong for one of the two shapes.
	 *
	 * A consumer needs no separate turns ratio: between any two rated pairs on one core the turns
	 * ratio is the square root of the impedance ratio.
	 */
	impedances?: readonly WindingImpedance[];
}>;

/** One rated impedance of a coil, and the terminal pair it is rated across. */
export type WindingImpedance = Readonly<{
	/** Exactly two terminal names of the winding this belongs to. */
	across: readonly [string, string];
	impedance: ParsedQuantity;
}>;

export type Component = Readonly<{
	id: string;
	/** What this package primarily is, and the default `kind` of every device inside it. */
	kind: ComponentKind;
	name: string;
	origin: Point;
	rotation: Rotation;
	flipped: boolean;
	terminals: readonly Terminal[];
	/**
	 * The devices this package contains.
	 *
	 * Omitted means exactly one device, of the component's `kind`, using all its terminals --
	 * which is what nearly every component is, and why declaring it is not required. Use
	 * `componentDevices()` to read either shape uniformly.
	 */
	devices?: readonly ComponentDevice[];
	/**
	 * The coils this transformer's terminals form.
	 *
	 * The sibling of `devices`, and deliberately not a use of it: a package holding several
	 * devices is one claim, while a transformer is *one* device whose coils are magnetically
	 * coupled -- calling each winding a device would say they are independent. See
	 * `model/windings.ts` for what terminal names were carrying before this existed.
	 *
	 * Omitted means the document does not state its winding grouping, which is every document
	 * written before this construct.
	 */
	windings?: readonly ComponentWinding[];
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
	| "display"
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
	| "display"
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

export type CircuitPowerCoverage =
	| "explicit-topology"
	| "declared-rails"
	| "external-unspecified"
	| "not-applicable";

// Distinct from ControlInterfacePolarity (footswitch/jack polarity); this is supply grounding.
export type CircuitPowerGroundPolarity =
	| "negative-ground"
	| "positive-ground"
	| "bipolar";

export type CircuitPowerRailRole =
	| "main-supply"
	| "bias-reference"
	| "regulated-output"
	| "charge-pump-output"
	| "negative-supply";

// Where the domain's power boundary enters the graph. `mains-ac` = a wall socket
// feeding an in-graph PSU (transformer/rectifier/filter). `external-dc` = a
// battery or DC adapter arriving ready-made. Distinct from CircuitPowerCoverage
// (how much topology is modeled) and from a rail's role/derivation.
export type CircuitPowerSourceKind = "mains-ac" | "external-dc";

export type CircuitPowerRailDerivation =
	| "direct"
	| "divider"
	| "regulator"
	| "inverter"
	| "doubler"
	| "isolated"
	| "unspecified";

export type CircuitPowerRailBinding = VdspBuildDataObject &
	Readonly<{
		railComponentId: string;
		role: CircuitPowerRailRole;
		derivation: CircuitPowerRailDerivation;
		parentRailComponentId?: string;
		converterComponentId?: string;
		nominalVoltage?: ParsedQuantity;
	}>;

export type CircuitPowerDomain = VdspBuildDataObject &
	Readonly<{
		id: string;
		sourceComponentIds: readonly string[];
		ratedVoltage?: ParsedQuantity;
		groundPolarity: CircuitPowerGroundPolarity;
		// Optional in circuit-power/v1 (additive). When absent, ownership is
		// inferred from source components. New/rewritten documents should emit it.
		sourceKind?: CircuitPowerSourceKind;
		rails: readonly CircuitPowerRailBinding[];
	}>;

export type CircuitPower = VdspBuildDataObject &
	Readonly<{
		schema: "circuit-power/v1";
		coverage: CircuitPowerCoverage;
		domains: readonly CircuitPowerDomain[];
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
		profileSchema?: string;
	}>;

export type ProfileResponseRef = VdspBuildDataObject &
	Readonly<{
		id: string;
		kind: string;
		assetRef: string;
		mimeType?: string;
		sha256?: string;
	}>;

export type PhysicalProfileIdentity = VdspBuildDataObject &
	Readonly<{
		manufacturer?: string;
		model?: string;
		revision?: string;
	}>;

export type PhysicalProfileBase = BuildPartProfile &
	Readonly<{
		profileSchema: string;
		kind: string;
		displayName?: string;
		identity?: PhysicalProfileIdentity;
		responseRefs?: readonly ProfileResponseRef[];
		extensions?: Readonly<Record<string, VdspBuildDataObject>>;
	}>;

export type SpeakerDriverSmallSignal = VdspBuildDataObject &
	Readonly<{
		nominalImpedanceOhms?: number;
		reOhms?: number;
		leHenries?: number;
		fsHz?: number;
		qms?: number;
		qes?: number;
		qts?: number;
		vasM3?: number;
		mmsKg?: number;
		cmsMetersPerNewton?: number;
		rmsKgPerSecond?: number;
		blTeslaMeters?: number;
	}>;

export type SpeakerDriverGeometry = VdspBuildDataObject &
	Readonly<{
		radiatingAreaM2?: number;
		xmaxM?: number;
	}>;

export type SpeakerDriverProfile = PhysicalProfileBase &
	Readonly<{
		profileSchema: "speaker-driver-profile/v1";
		kind: "speaker-driver";
		smallSignal?: SpeakerDriverSmallSignal;
		geometry?: SpeakerDriverGeometry;
	}>;

export type CabinetEnclosureType =
	| "closed-back"
	| "open-back"
	| "ported"
	| "infinite-baffle"
	| "transmission-line"
	| "unknown";

export type CabinetDimensionsM = VdspBuildDataObject &
	Readonly<{
		width?: number;
		height?: number;
		depth?: number;
	}>;

export type CabinetPort = VdspBuildDataObject &
	Readonly<{
		areaM2?: number;
		lengthM?: number;
		tuningHz?: number;
	}>;

export type CabinetEnclosure = VdspBuildDataObject &
	Readonly<{
		type: CabinetEnclosureType;
		netVolumeM3?: number;
		dimensionsM?: CabinetDimensionsM;
		lossQ?: number;
		ports?: readonly CabinetPort[];
	}>;

export type CabinetDriverLoadout = VdspBuildDataObject &
	Readonly<{
		driverProfileId: string;
		count: number;
		wiring?: string;
	}>;

export type CabinetEnclosureProfile = PhysicalProfileBase &
	Readonly<{
		profileSchema: "cabinet-enclosure-profile/v1";
		kind: "cabinet-enclosure";
		enclosure?: CabinetEnclosure;
		loadout?: readonly CabinetDriverLoadout[];
	}>;

export type MicrophoneTransducerPrinciple =
	| "dynamic"
	| "ribbon"
	| "condenser"
	| "electret-condenser"
	| "measurement"
	| "unknown";

export type MicrophoneAcousticCoupling =
	| "pressure"
	| "pressure-gradient"
	| "mixed"
	| "unknown";

export type MicrophoneTransducer = VdspBuildDataObject &
	Readonly<{
		principle?: MicrophoneTransducerPrinciple;
		acousticCoupling?: MicrophoneAcousticCoupling;
		polarPattern?: string;
	}>;

export type MicrophoneElectrical = VdspBuildDataObject &
	Readonly<{
		nominalImpedanceOhms?: number;
		sensitivityDbVPerPa?: number;
	}>;

export type MicrophoneTransducerProfile = PhysicalProfileBase &
	Readonly<{
		profileSchema: "microphone-transducer-profile/v1";
		kind: "microphone-transducer";
		transducer?: MicrophoneTransducer;
		electrical?: MicrophoneElectrical;
	}>;

export type KnownPhysicalProfile =
	| SpeakerDriverProfile
	| CabinetEnclosureProfile
	| MicrophoneTransducerProfile;

export type BuildPartProfileCatalog = VdspBuildDataObject &
	Readonly<{
		schema: "part-profile-catalog/v1";
		resolution?: string;
		units?: string;
		profiles: readonly (KnownPhysicalProfile | BuildPartProfile)[];
	}>;

export type SimulationProfile = VdspBuildDataObject &
	Readonly<{
		profileSchema: string;
		kind: string;
		id: string;
		targetProfileIds: readonly string[];
		domain: string;
		representation: string;
		operatingRegime?: string;
		coupling?: string;
		parameters?: VdspBuildDataObject;
		dataRef?: string;
		assetRefs?: readonly ProfileResponseRef[];
		extensions?: Readonly<Record<string, VdspBuildDataObject>>;
	}>;

export type SimulationProfileCatalog = VdspBuildDataObject &
	Readonly<{
		schema: "simulation-profile-catalog/v1";
		resolution?: string;
		units?: string;
		profiles: readonly SimulationProfile[];
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
	simulationProfiles?: SimulationProfileCatalog;
	footprints?: BoardFootprintCatalog;
	offBoardWiring?: OffBoardWiringPlan;
	boards?: readonly BoardRealization[];
	power?: CircuitPower;
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

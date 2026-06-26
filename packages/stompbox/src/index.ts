import {
	type CircuitDocument,
	type ControlState,
	type ControlValue,
	defaultControlState,
	extractPanel,
	type JackPort,
	type Knob,
	type LedIndicator,
	type Panel,
	type PanelControlKind,
	type PanelElementPlacement,
	type PanelFace,
	type Point,
	parseCircuitDocumentFile,
	type SliderControl,
	type SwitchControl,
} from "@vessel-dsp/core";

export type StompboxUnits = "mm";
export type StompboxPlacementProvenance = "vdsp-declared" | "auto-generated";
export type StompboxPartProvenance = "vdsp-declared" | "defaulted";
export type StompboxFaceId =
	| "top"
	| "bottom"
	| "left"
	| "right"
	| "back"
	| (string & {});
export type StompboxTemplateMode = "preview" | "print";
export type StompboxStyleProfileId = string & {};
export type StompboxKnobGridStrategy = "large-merged-row" | "compact-led-row";
export type StompboxSideHardwareStrategy =
	| "side-power-five-slot"
	| "back-power-paired-side-jacks";
export type StompboxAudioJackLabelStrategy = "edge-rotated" | "inline";
export type StompboxFootswitchStrategy = "lower-row" | "bottom-merged-row";

export type StompboxStyleProfile = Readonly<{
	id: StompboxStyleProfileId;
	label: string;
	supportedKnobCounts: readonly number[];
	defaultPartIds?: Partial<StompboxDefaultPartProfileIds>;
	layout?: Readonly<{
		knobGrid?: StompboxKnobGridStrategy;
		sideHardware?: StompboxSideHardwareStrategy;
		audioJackLabels?: StompboxAudioJackLabelStrategy;
		footswitch?: StompboxFootswitchStrategy;
		statusLedLabel?: string;
	}>;
}>;

export type StompboxStyleProfileFilter = Readonly<{
	knobCount: number;
}>;

export function getAvailableStompboxStyleProfiles(
	profiles: readonly StompboxStyleProfile[],
	filter: StompboxStyleProfileFilter,
): readonly StompboxStyleProfile[] {
	return profiles.filter((profile) =>
		profile.supportedKnobCounts.includes(filter.knobCount),
	);
}

export type StompboxPoint2 = Readonly<{
	x: number;
	y: number;
}>;

export type StompboxPoint3 = Readonly<{
	x: number;
	y: number;
	z: number;
}>;

export type StompboxRotationDeg = Readonly<{
	x: number;
	y: number;
	z: number;
}>;

export type StompboxSize2 = Readonly<{
	widthMm: number;
	heightMm: number;
}>;

export type StompboxDecalGridPlacement = Readonly<{
	kind: "grid";
	columns: number;
	rows: number;
	column: number;
	row: number;
}>;

export type StompboxDecalPlacement = StompboxDecalGridPlacement;

export type StompboxDecalInputCommon = Readonly<{
	id: string;
	face?: StompboxFaceId;
	centerMm?: StompboxPoint2;
	placement?: StompboxDecalPlacement;
	sizeMm?: StompboxSize2;
	rotationDeg?: number;
}>;

export type StompboxTextDecalInput = StompboxDecalInputCommon &
	Readonly<{
		kind: "text";
		text: string;
		color?: string;
		fontFamily?: string;
		fontSizeMm?: number;
	}>;

export type StompboxSvgDecalInput = StompboxDecalInputCommon &
	Readonly<{
		kind: "svg";
		svg: string;
		color?: string;
	}>;

export type StompboxImageDecalInput = StompboxDecalInputCommon &
	Readonly<{
		kind: "image";
		href: string;
		mimeType?: string;
		color?: string;
	}>;

export type StompboxDecalInput =
	| StompboxTextDecalInput
	| StompboxSvgDecalInput
	| StompboxImageDecalInput;

export type StompboxAssetRefs = Readonly<{
	glbRelativePath: string;
	stepRelativePath: string;
}>;

export type ResolvedStompboxAssetPaths = Readonly<{
	glb: string;
	step: string;
}>;

export type StompboxDrillHoleMarker = "ring-with-center-dot" | "center-dot";

export type StompboxDrillHoleProfile = Readonly<{
	id: string;
	label: string;
	diameterMm: number;
	fractionInches: string;
	marker: StompboxDrillHoleMarker;
}>;

export const STOMPBOX_DRILL_HOLE_PROFILE_CATALOG: Readonly<
	Record<string, StompboxDrillHoleProfile>
> = {
	"dc-jack-3pdt-1-2": {
		id: "dc-jack-3pdt-1-2",
		label: "DC Jack / 3PDT",
		diameterMm: 12.7,
		fractionInches: '1/2"',
		marker: "ring-with-center-dot",
	},
	"audio-jack-24mm-pot-3-8": {
		id: "audio-jack-24mm-pot-3-8",
		label: "Audio Jacks / 24mm Pots",
		diameterMm: 9.525,
		fractionInches: '3/8"',
		marker: "ring-with-center-dot",
	},
	"metal-5mm-led-bezel-5-16": {
		id: "metal-5mm-led-bezel-5-16",
		label: "Metal 5mm LED Bezel",
		diameterMm: 7.9375,
		fractionInches: '5/16"',
		marker: "ring-with-center-dot",
	},
	"sixteen-mm-pot-9-32": {
		id: "sixteen-mm-pot-9-32",
		label: "16mm Pots",
		diameterMm: 7.14375,
		fractionInches: '9/32"',
		marker: "ring-with-center-dot",
	},
	"mini-toggle-switch-1-4": {
		id: "mini-toggle-switch-1-4",
		label: "Mini Toggle Switch",
		diameterMm: 6.35,
		fractionInches: '1/4"',
		marker: "ring-with-center-dot",
	},
	"five-mm-led-13-64": {
		id: "five-mm-led-13-64",
		label: "5mm LED",
		diameterMm: 5.159375,
		fractionInches: '13/64"',
		marker: "ring-with-center-dot",
	},
	"three-mm-led-1-8": {
		id: "three-mm-led-1-8",
		label: "3mm LED",
		diameterMm: 3.175,
		fractionInches: '1/8"',
		marker: "ring-with-center-dot",
	},
	"pilot-hole-1-16": {
		id: "pilot-hole-1-16",
		label: "Pilot Hole",
		diameterMm: 1.5875,
		fractionInches: '1/16"',
		marker: "center-dot",
	},
};

export type StompboxAssetResolveOptions = Readonly<{
	basePath?: string;
	baseUrl?: string;
}>;

export type StompboxAssetFileReader = (path: string) => Uint8Array;

export type StompboxAssetFileOptions = Readonly<{
	readAssetFile?: StompboxAssetFileReader;
}>;

export type StompboxGlbStateTargetSelector = Readonly<{
	nodeName?: string;
	nodeNameIncludes?: string;
	meshName?: string;
	meshNameIncludes?: string;
	materialName?: string;
	materialNameIncludes?: string;
	extras?: Readonly<Record<string, string | number | boolean>>;
}>;

export type StompboxGlbStateTargetRef = Readonly<{
	selector: StompboxGlbStateTargetSelector;
}>;

export type StompboxFootswitchTravelAxis = "x" | "y" | "z";

export type StompboxPartStateTargets = Readonly<{
	led?: Readonly<{
		lens: StompboxGlbStateTargetRef;
	}>;
	footswitch?: Readonly<{
		actuator: StompboxGlbStateTargetRef;
		travelMm?: number;
		travelAxis?: StompboxFootswitchTravelAxis;
	}>;
}>;

export type StompboxGlbStateTargetRole = "led.lens" | "footswitch.actuator";

export type StompboxResolvedGlbStateTarget = Readonly<{
	role: StompboxGlbStateTargetRole;
	selector: StompboxGlbStateTargetSelector;
	nodeName: string;
	meshName?: string;
	materialName?: string;
	travelMm?: number;
	travelAxis?: StompboxFootswitchTravelAxis;
}>;

export type StompboxResolvedPartStateTargets = Readonly<{
	led?: Readonly<{
		lens: StompboxResolvedGlbStateTarget;
	}>;
	footswitch?: Readonly<{
		actuator: StompboxResolvedGlbStateTarget;
	}>;
}>;

export type StompboxGlbAssetValidation = Readonly<{
	schema: "stompbox-glb-asset-validation/v1";
	partProfileId: string;
	assetPath?: string;
	valid: boolean;
	targets: Readonly<
		Partial<Record<StompboxGlbStateTargetRole, StompboxResolvedGlbStateTarget>>
	>;
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxHardwareProfileAssetValidation = Readonly<{
	schema: "stompbox-hardware-profile-asset-validation/v1";
	valid: boolean;
	assets: Readonly<Record<string, StompboxGlbAssetValidation>>;
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxGlbAssetValidationOptions = Readonly<{
	assetPath?: string;
}>;

export type StompboxHardwareProfileAssetValidationOptions =
	StompboxAssetResolveOptions &
		Readonly<{
			partIds?: readonly string[];
		}>;

export type StompboxPartGeometry =
	| Readonly<{
			kind: "knob";
			diameterMm: number;
			depthMm: number;
			shaftDiameterMm: number;
	  }>
	| Readonly<{
			kind: "led";
			lensDiameterMm: number;
			bodyHeightMm: number;
			flangeDiameterMm: number;
	  }>
	| Readonly<{
			kind: "led-bezel";
			outerDiameterMm: number;
			innerDiameterMm: number;
			depthMm: number;
	  }>
	| Readonly<{
			kind: "footswitch";
			buttonDiameterMm: number;
			nutOuterDiameterMm: number;
			ringHeightMm: number;
			buttonHeightMm: number;
			pressedTravelMm: number;
	  }>
	| Readonly<{
			kind: "ring";
			outerDiameterMm: number;
			innerDiameterMm: number;
			depthMm: number;
	  }>;

/**
 * One stacked dial of a multi-surface part (e.g. a concentric pot). The
 * ordered `surfaces` array runs bottom (on the panel) to top; each dial's
 * `geometry` and `stackOffsetMm` (height above the base) describe how it nests.
 * A placement element's `physical.surface` references one of these `id`s.
 */
export type StompboxPartSurface = Readonly<{
	id: string;
	geometry: StompboxPartGeometry;
	stackOffsetMm: number;
}>;

export type StompboxPartProfile = Readonly<{
	id: string;
	label: string;
	family: "knob" | "led" | "footswitch" | "audio-jack" | "dc-jack";
	level: "exterior";
	status: "generated-stub";
	panelHoleDrillMm: number;
	drillHoleProfileId?: string;
	geometry: StompboxPartGeometry;
	surfaces?: readonly StompboxPartSurface[];
	assets: StompboxAssetRefs;
	assetScale?: number;
	stateTargets?: StompboxPartStateTargets;
}>;

export type StompboxPartProfileCatalog = Readonly<
	Record<string, StompboxPartProfile>
>;

export type StompboxEnclosureProfile = Readonly<{
	variantId: string;
	label: string;
	dimensionsMm: Readonly<{
		widthMm: number;
		lengthMm: number;
		depthMm: number;
	}>;
	topFace: Readonly<{
		usableRectMm: Readonly<{
			x: number;
			y: number;
			width: number;
			height: number;
		}>;
	}>;
	assets: StompboxAssetRefs;
}>;

export type StompboxEnclosureProfileCatalog = Readonly<
	Record<string, StompboxEnclosureProfile>
>;

export type StompboxDefaultPartProfileIds = Readonly<{
	knob: string;
	largeKnob: string;
	smallKnob: string;
	led: string;
	footswitch: string;
	audioJack: string;
	dcJack: string;
}>;

export type StompboxHardwareProfile = Readonly<{
	id: string;
	label: string;
	partProfiles: StompboxPartProfileCatalog;
	enclosureProfiles: StompboxEnclosureProfileCatalog;
	defaultEnclosureId: string;
	defaultPartIds: StompboxDefaultPartProfileIds;
}>;

export type StompboxHardwareProfileOptions = Readonly<{
	hardwareProfile?: StompboxHardwareProfile;
}>;

export type StompboxDiagnosticCode =
	| "placement-auto-generated"
	| "unsupported-control"
	| "unknown-part-profile"
	| "unknown-part-surface"
	| "concentric-mount-incomplete"
	| "placement-collision"
	| "placement-clearance"
	| "placement-out-of-bounds"
	| "invalid-glb-asset"
	| "missing-state-target-contract"
	| "missing-state-target"
	| "ambiguous-state-target";

export type StompboxDiagnostic = Readonly<{
	code: StompboxDiagnosticCode;
	message: string;
	controlId?: string;
	partId?: string;
	placementId?: string;
	face?: StompboxFaceId;
	assetPath?: string;
	targetRole?: StompboxGlbStateTargetRole;
}>;

/**
 * An additional stacked dial sharing a concentric part's single hole, above
 * the hole's base (lower) dial. One per upper surface, in stack order.
 */
export type StompboxConcentricDial = Readonly<{
	surface: string;
	partGeometry: StompboxPartGeometry;
	stackOffsetMm: number;
	controlId?: string;
	componentId?: string;
	label?: string;
}>;

export type StompboxDrillHole = Readonly<{
	id: string;
	face: StompboxFaceId;
	centerMm: StompboxPoint2;
	drillDiameterMm: number;
	drillHoleProfileId?: string;
	partId: string;
	partLabel: string;
	partFamily: StompboxPartProfile["family"];
	partGeometry: StompboxPartGeometry;
	partProvenance?: StompboxPartProvenance;
	assetScale?: number;
	controlId?: string;
	componentId?: string;
	label?: string;
	provenance: StompboxPlacementProvenance;
	locked?: boolean;
	assets: StompboxAssetRefs;
	stateTargets?: StompboxPartStateTargets;
	/** Upper dials of a concentric mount; empty/absent for a plain part. */
	concentricDials?: readonly StompboxConcentricDial[];
}>;

export type StompboxDrillLayout = Readonly<{
	schema: "stompbox-drill-layout/v1";
	units: StompboxUnits;
	enclosure: StompboxEnclosureProfile;
	holes: readonly StompboxDrillHole[];
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxPreviewMaterial = Readonly<{
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

export type StompboxLabelAppearance = Readonly<{
	text?: string;
	color?: string;
	fontFamily?: string;
	fontSizeMm?: number;
}>;

export type StompboxAppearance = Readonly<{
	enclosure?: StompboxPreviewMaterial;
	template?: StompboxPreviewMaterial &
		Readonly<{
			guideColor?: string;
			foldColor?: string;
			holeStrokeColor?: string;
			holeFillColor?: string;
			centerDotColor?: string;
		}>;
	defaults?: Readonly<{
		led?: StompboxPreviewMaterial;
		label?: StompboxLabelAppearance;
		footswitch?: StompboxPreviewMaterial;
		audioJack?: StompboxPreviewMaterial;
		dcJack?: StompboxPreviewMaterial;
	}>;
	controls?: Readonly<
		Record<
			string,
			Readonly<{
				led?: StompboxPreviewMaterial;
				label?: StompboxLabelAppearance;
				footswitch?: StompboxPreviewMaterial;
				audioJack?: StompboxPreviewMaterial;
				dcJack?: StompboxPreviewMaterial;
			}>
		>
	>;
	parts?: Readonly<Record<string, StompboxPreviewMaterial>>;
	labels?: Readonly<Record<string, StompboxLabelAppearance>>;
}>;

export type StompboxAppearancePatchTarget = Readonly<{
	targetId: string;
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

export type StompboxPartAppearancePatchTarget = StompboxAppearancePatchTarget &
	Readonly<{
		partId: string;
		controlId?: string;
		family: StompboxPartProfile["family"];
	}>;

export type StompboxDecalAppearancePatchTarget = Readonly<{
	targetId: string;
	decalId: string;
	kind: StompboxPreviewDecal["kind"];
	face: StompboxFaceId;
	text?: string;
	color?: string;
	fontFamily?: string;
	fontSizeMm?: number;
}>;

export type StompboxResolvedAppearance = Readonly<{
	schema: "stompbox-appearance-patch/v1";
	units: StompboxUnits;
	enclosure?: StompboxAppearancePatchTarget;
	parts: Readonly<Record<string, StompboxPartAppearancePatchTarget>>;
	decals: Readonly<Record<string, StompboxDecalAppearancePatchTarget>>;
}>;

export type StompboxPreviewPart = Readonly<{
	id: string;
	partId: string;
	family: StompboxPartProfile["family"];
	geometry: StompboxPartGeometry;
	partProvenance?: StompboxPartProvenance;
	assetScale?: number;
	controlId?: string;
	face: StompboxFaceId;
	provenance: StompboxPlacementProvenance;
	assets: ResolvedStompboxAssetPaths;
	stateTargets?: StompboxPartStateTargets;
	transform: Readonly<{
		translationMm: StompboxPoint3;
		rotationDeg: StompboxRotationDeg;
	}>;
	material?: StompboxPreviewMaterial;
}>;

export type StompboxPreviewDecalCommon = Readonly<{
	id: string;
	face: StompboxFaceId;
	centerMm: StompboxPoint2;
	placement?: StompboxDecalPlacement;
	sizeMm: StompboxSize2;
	rotationDeg: number;
}>;

export type StompboxPreviewTextDecal = StompboxPreviewDecalCommon &
	Readonly<{
		kind: "text";
		text: string;
		color: string;
		fontFamily: string;
		fontSizeMm: number;
	}>;

export type StompboxPreviewSvgDecal = StompboxPreviewDecalCommon &
	Readonly<{
		kind: "svg";
		svg: string;
		color?: string;
	}>;

export type StompboxPreviewImageDecal = StompboxPreviewDecalCommon &
	Readonly<{
		kind: "image";
		href: string;
		mimeType?: string;
		color?: string;
	}>;

export type StompboxPreviewDecal =
	| StompboxPreviewTextDecal
	| StompboxPreviewSvgDecal
	| StompboxPreviewImageDecal;

export type StompboxPreviewEnclosure = Omit<
	StompboxEnclosureProfile,
	"assets"
> &
	Readonly<{
		assets: ResolvedStompboxAssetPaths;
		material?: StompboxPreviewMaterial;
	}>;

export type StompboxPreview = Readonly<{
	schema: "stompbox-preview/v1";
	units: StompboxUnits;
	enclosure: StompboxPreviewEnclosure;
	parts: readonly StompboxPreviewPart[];
	decals: readonly StompboxPreviewDecal[];
	drillLayout: StompboxDrillLayout;
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxRuntimeControlKind = "knob" | "switch";

export type StompboxCompiledControlLike = Readonly<{
	id: string;
	sourceComponentId?: string;
	name: string;
	kind: "potentiometer" | "variableResistor" | "switch";
	value: number;
	defaultBehavior?: "noon" | "source";
	min: number;
	max: number;
	step: number;
	unit?: string;
	sweep?: string;
	options?: readonly string[];
	targets?: readonly unknown[];
}>;

export type StompboxSourcePanelControl = Readonly<{
	id: string;
	label: string;
	kind: StompboxRuntimeControlKind;
	value: number;
	sourceComponentId?: string;
	panelElementId?: string;
	sweep?: string;
	options?: readonly string[];
	description?: string;
}>;

export type StompboxRuntimeControlDescriptor = Readonly<{
	id: string;
	label: string;
	kind: StompboxRuntimeControlKind;
	source: "compiled" | "source-panel";
	value: number;
	min: number;
	max: number;
	step: number;
	normalizedValue: ControlValue;
	sourceComponentId?: string;
	panelElementId?: string;
	runtimeControlId?: string;
	controlKind?: StompboxCompiledControlLike["kind"];
	unit?: string;
	sweep?: string;
	options?: readonly string[];
	description?: string;
	targetCount?: number;
}>;

export type StompboxRuntimeControlRoute = Readonly<{
	publicControlId: string;
	runtimeControlId?: string;
	sourceComponentId?: string;
	kind: StompboxRuntimeControlKind;
	source: "compiled" | "source-panel";
	min: number;
	max: number;
	step: number;
}>;

export type StompboxControlSurface = Readonly<{
	schema: "stompbox-control-surface/v1";
	pedalId: string;
	label?: string;
	panel: Panel;
	controls: readonly StompboxRuntimeControlDescriptor[];
	routes: Readonly<Record<string, StompboxRuntimeControlRoute>>;
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxPedalState = Readonly<{
	schema: "stompbox-pedal-state/v1";
	pedalId: string;
	revision: number;
	enabled: boolean;
	controls: ControlState;
}>;

export type StompboxPedalStateCommand =
	| Readonly<{ type: "set-enabled"; enabled: boolean }>
	| Readonly<{
			type: "set-control-value";
			controlId: string;
			value: ControlValue;
	  }>
	| Readonly<{ type: "noop" }>
	| Readonly<{ type: "error"; reason: string; controlId?: string }>;

export type StompboxRuntimeCommand =
	| Readonly<{
			kind: "set-control-value";
			pedalId: string;
			controlId: string;
			publicControlId: string;
			rawValue: number;
	  }>
	| Readonly<{ kind: "set-enabled"; pedalId: string; enabled: boolean }>
	| Readonly<{ kind: "noop" }>
	| Readonly<{ kind: "error"; reason: string; controlId?: string }>;

export type StompboxPedalStateChange = Readonly<{
	previous: StompboxPedalState;
	current: StompboxPedalState;
	changedControlIds: readonly string[];
	enabledChanged: boolean;
	command: StompboxPedalStateCommand;
}>;

export type StompboxPedalStateListener = (
	event: StompboxPedalStateChange,
) => void;
export type StompboxControlStateListener = (
	value: ControlValue | undefined,
	event: StompboxPedalStateChange,
) => void;
export type StompboxPreviewStatePatchListener = (
	patch: StompboxPreviewStatePatch,
	event: StompboxPedalStateChange,
) => void;
export type StompboxUnsubscribe = () => void;

export type StompboxPedalStateStore = Readonly<{
	getSnapshot(): StompboxPedalState;
	dispatch(command: StompboxPedalStateCommand): StompboxPedalState;
	setEnabled(enabled: boolean): StompboxPedalState;
	setControlValue(controlId: string, value: ControlValue): StompboxPedalState;
	turnKnob(controlId: string, position: number): StompboxPedalState;
	pressFootswitch(
		partIdOrControlId: string,
		pressed: boolean,
	): StompboxPedalState;
	subscribe(listener: StompboxPedalStateListener): StompboxUnsubscribe;
	subscribeControl(
		controlId: string,
		listener: StompboxControlStateListener,
	): StompboxUnsubscribe;
	subscribePreviewPatch(
		listener: StompboxPreviewStatePatchListener,
	): StompboxUnsubscribe;
}>;

export type StompboxPreviewStatePatchTarget = Readonly<{
	targetId: string;
	previewPartId: string;
	partId: string;
	family: StompboxPartProfile["family"];
	controlId?: string;
	value?: ControlValue;
	stateTarget?: StompboxResolvedGlbStateTarget;
	transform?: StompboxPreviewPart["transform"];
	material?: StompboxPreviewMaterial;
}>;

export type StompboxPreviewStatePatch = Readonly<{
	schema: "stompbox-preview-state-patch/v1";
	units: StompboxUnits;
	pedalId: string;
	revision: number;
	parts: Readonly<Record<string, StompboxPreviewStatePatchTarget>>;
}>;

export type StompboxPreviewSvgViewId =
	| "top"
	| "bottom"
	| "left"
	| "right"
	| "back";

export type StompboxPreviewSvgViews = Readonly<{
	schema: "stompbox-preview-svg-views/v1";
	units: StompboxUnits;
	preview: StompboxPreview;
	views: Readonly<Record<StompboxPreviewSvgViewId, string>>;
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxPreviewGlb = Readonly<{
	schema: "stompbox-preview-glb/v1";
	mimeType: "model/gltf-binary";
	bytes: Uint8Array;
	preview: StompboxPreview;
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxPreviewSvgGrainOptions = Readonly<{
	baseFrequency?: number;
	numOctaves?: number;
	opacity?: number;
}>;

export type StompboxDrillTemplateHole = StompboxDrillHole &
	Readonly<{
		templateCenterMm: StompboxPoint2;
	}>;

export type StompboxDrillTemplateScaleMark = Readonly<{
	id: string;
	label: string;
	lengthMm: number;
	startMm: StompboxPoint2;
	endMm: StompboxPoint2;
}>;

export type StompboxDrillTemplatePage = Readonly<{
	paper: "A4";
	orientation: "portrait";
	widthMm: number;
	heightMm: number;
	marginMm: number;
}>;

export type StompboxDrillTemplate = Readonly<{
	schema: "stompbox-drill-template/v1";
	mode: StompboxTemplateMode;
	units: StompboxUnits;
	scale: 1;
	detailLevel: "preview" | "fabrication-detail";
	canvasMm: Readonly<{
		widthMm: number;
		heightMm: number;
	}>;
	page: StompboxDrillTemplatePage | undefined;
	enclosure: StompboxEnclosureProfile;
	holes: readonly StompboxDrillTemplateHole[];
	decals: readonly StompboxPreviewDecal[];
	appearance?: StompboxAppearance;
	scaleMarks: readonly StompboxDrillTemplateScaleMark[];
	holeTable: readonly StompboxDrillHole[];
	diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxLayoutOptions = StompboxHardwareProfileOptions &
	Readonly<{
		enclosureId?: string;
		includePowerJack?: boolean;
		minPartClearanceMm?: number;
		styleProfile?: StompboxStyleProfile;
	}>;

export type StompboxFromVdspOptions = StompboxLayoutOptions &
	Readonly<{
		filename?: string;
	}>;

export type StompboxDecalOptions = Readonly<{
	decals?: readonly StompboxDecalInput[];
}>;

export type StompboxAppearanceOptions = Readonly<{
	appearance?: StompboxAppearance;
}>;

export type StompboxPreviewOptions = StompboxLayoutOptions &
	StompboxAssetResolveOptions &
	StompboxAssetFileOptions &
	StompboxDecalOptions &
	StompboxAppearanceOptions &
	Readonly<{
		state?: ControlState;
		pedalState?: StompboxPedalState;
	}>;

export type StompboxPreviewFromVdspOptions = StompboxPreviewOptions &
	Readonly<{
		filename?: string;
	}>;

export type StompboxDrillTemplateOptions = StompboxLayoutOptions &
	StompboxDecalOptions &
	StompboxAppearanceOptions &
	Readonly<{
		mode: StompboxTemplateMode;
	}>;

export type StompboxDrillTemplateFromVdspOptions =
	StompboxDrillTemplateOptions &
		Readonly<{
			filename?: string;
		}>;

export type StompboxPreviewSvgViewsOptions = StompboxPreviewOptions &
	Readonly<{
		grain?: boolean | StompboxPreviewSvgGrainOptions;
	}>;

export type StompboxPreviewSvgViewsFromVdspOptions =
	StompboxPreviewSvgViewsOptions &
		Readonly<{
			filename?: string;
		}>;

export type StompboxPreviewGlbOptions = StompboxPreviewOptions;

export type StompboxPreviewGlbFromVdspOptions = StompboxPreviewGlbOptions &
	Readonly<{
		filename?: string;
	}>;

type ControlVisualMetadata = Readonly<{
	id: string;
	kind: "knob" | "led" | "switch" | "jack" | "slider";
	label: string;
	defaultPosition?: number;
	color?: string;
	jackRole?: JackPort["role"];
	switchKind?: SwitchControl["switchKind"];
	partNumber?: string;
}>;

type PlacementCandidate = Readonly<{
	id: string;
	kind: PanelControlKind;
	face: StompboxFaceId;
	centerMm: StompboxPoint2;
	partId: string;
	partProvenance?: StompboxPartProvenance;
	componentId?: string;
	controlId?: string;
	label?: string;
	drillDiameterMm?: number;
	locked?: boolean;
	provenance: StompboxPlacementProvenance;
	mountId?: string;
	surface?: string;
	concentricDials?: readonly StompboxConcentricDial[];
}>;

type AutoKnobPlacement = Readonly<{
	partId: string;
	centerMm: StompboxPoint2;
}>;

type AutoKnobGrid = Readonly<{
	placements: readonly AutoKnobPlacement[];
}>;

type StompboxPlacementGrid = Readonly<{
	edgeMarginMm: number;
	widthMm: number;
	lengthMm: number;
	usableWidthMm: number;
	usableLengthMm: number;
	rowCount: number;
	rowPitchMm: number;
}>;

type ResolvedStompboxPlacementStyle = Readonly<{
	defaultPartIds: StompboxDefaultPartProfileIds;
	knobGrid: StompboxKnobGridStrategy;
	sideHardware: StompboxSideHardwareStrategy;
	audioJackLabels: StompboxAudioJackLabelStrategy;
	footswitch: StompboxFootswitchStrategy;
	statusLedLabel?: string;
}>;

type ResolvedStompboxPreviewSvgGrain = Readonly<{
	baseFrequency: number;
	numOctaves: number;
	opacity: number;
}>;

const STOMPBOX_GRID_MIN_CELL_MM = 12;
const STOMPBOX_GRID_EDGE_MARGIN_MM = 1;
const STOMPBOX_GRID_TARGET_ROW_PITCH_MM = 20;
const STOMPBOX_EDGE_ROTATED_SIDE_LABEL_GAP_MM = 4;
const STOMPBOX_LARGE_KNOB_DIAMETER_MM = 20;
const STOMPBOX_SMALL_KNOB_DIAMETER_MM = 14.5;
const STOMPBOX_LARGE_KNOB_MIN_PITCH_MM = 25;
const STOMPBOX_HOLE_BACKING_OUTSET_MM = 0.12;
const STOMPBOX_DC_JACK_HOLE_BACKING_INSET_MM = 0.7;
const STOMPBOX_DECAL_OUTSET_MM = 0.2;
const STOMPBOX_1590B_MIN_WIDTH_MM = 55;
const STOMPBOX_PREVIEW_SVG_GRAIN_BASE_FREQUENCY = 0.4;
const STOMPBOX_PREVIEW_SVG_GRAIN_NUM_OCTAVES = 10;
const STOMPBOX_PREVIEW_SVG_GRAIN_OPACITY = 0.15;

export function resolveStompboxAssetPaths(
	assets: StompboxAssetRefs,
	options: StompboxAssetResolveOptions = {},
): ResolvedStompboxAssetPaths {
	const base = options.baseUrl ?? options.basePath;
	if (base === undefined || base.length === 0) {
		return {
			glb: assets.glbRelativePath,
			step: assets.stepRelativePath,
		};
	}
	return {
		glb: joinAssetBase(base, assets.glbRelativePath),
		step: joinAssetBase(base, assets.stepRelativePath),
	};
}

export function validateStompboxGlbAsset(
	bytes: Uint8Array,
	partProfile: StompboxPartProfile,
	options: StompboxGlbAssetValidationOptions = {},
): StompboxGlbAssetValidation {
	const assetPath = options.assetPath ?? partProfile.assets.glbRelativePath;
	let parsed: ParsedGlb;
	try {
		parsed = parseGlbBytes(bytes, assetPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostic: StompboxDiagnostic = {
			code: "invalid-glb-asset",
			message: `Invalid GLB asset for stompbox part "${partProfile.id}": ${message}`,
			partId: partProfile.id,
			assetPath,
		};
		return {
			schema: "stompbox-glb-asset-validation/v1",
			partProfileId: partProfile.id,
			assetPath,
			valid: false,
			targets: {},
			diagnostics: [diagnostic],
		};
	}

	const targets: Partial<
		Record<StompboxGlbStateTargetRole, StompboxResolvedGlbStateTarget>
	> = {};
	const diagnostics: StompboxDiagnostic[] = [];
	const candidates = glbStateTargetCandidates(parsed.json);
	for (const required of requiredStateTargetsForPartProfile(partProfile)) {
		const target = required.target;
		if (target === undefined) {
			diagnostics.push({
				code: "missing-state-target-contract",
				message: `Stompbox part "${partProfile.id}" requires live-state GLB target "${required.role}"`,
				partId: partProfile.id,
				assetPath,
				targetRole: required.role,
			});
			continue;
		}
		const matches = candidates.filter((candidate) =>
			stateTargetCandidateMatches(candidate, target.selector),
		);
		if (matches.length === 0) {
			diagnostics.push({
				code: "missing-state-target",
				message: `GLB asset for stompbox part "${partProfile.id}" does not contain target "${required.role}"`,
				partId: partProfile.id,
				assetPath,
				targetRole: required.role,
			});
			continue;
		}
		if (matches.length > 1) {
			diagnostics.push({
				code: "ambiguous-state-target",
				message: `GLB asset for stompbox part "${partProfile.id}" matched ${matches.length} nodes for target "${required.role}"`,
				partId: partProfile.id,
				assetPath,
				targetRole: required.role,
			});
			continue;
		}
		const match = matches[0];
		if (match === undefined) {
			continue;
		}
		targets[required.role] = {
			role: required.role,
			selector: target.selector,
			nodeName: match.nodeName,
			...(match.meshName === undefined ? {} : { meshName: match.meshName }),
			...(match.materialName === undefined
				? {}
				: { materialName: match.materialName }),
			...(required.motion === undefined ? {} : required.motion),
		};
	}

	return {
		schema: "stompbox-glb-asset-validation/v1",
		partProfileId: partProfile.id,
		assetPath,
		valid: diagnostics.length === 0,
		targets,
		diagnostics,
	};
}

export function validateStompboxHardwareProfileAssets(
	hardwareProfile: StompboxHardwareProfile,
	options: StompboxHardwareProfileAssetValidationOptions &
		StompboxAssetFileOptions = {},
): StompboxHardwareProfileAssetValidation {
	const readAssetFile = requireStompboxAssetFileReader(options);
	const partIds =
		options.partIds ?? defaultLiveStatePartProfileIds(hardwareProfile);
	const assets: Record<string, StompboxGlbAssetValidation> = {};
	const diagnostics: StompboxDiagnostic[] = [];
	for (const partId of uniqueStrings(partIds)) {
		const partProfile = hardwareProfile.partProfiles[partId];
		if (partProfile === undefined) {
			const diagnostic: StompboxDiagnostic = {
				code: "unknown-part-profile",
				message: `Unknown stompbox part profile "${partId}"`,
				partId,
			};
			diagnostics.push(diagnostic);
			continue;
		}
		const assetPath = resolveStompboxAssetPaths(
			partProfile.assets,
			options,
		).glb;
		const validation = validateStompboxGlbAssetFromPath(
			assetPath,
			partProfile,
			readAssetFile,
		);
		assets[partId] = validation;
		diagnostics.push(...validation.diagnostics);
	}
	return {
		schema: "stompbox-hardware-profile-asset-validation/v1",
		valid: diagnostics.length === 0,
		assets,
		diagnostics,
	};
}

export function validateStompboxGlbAssetFromPath(
	path: string,
	partProfile: StompboxPartProfile,
	readAssetFile: StompboxAssetFileReader,
): StompboxGlbAssetValidation {
	try {
		return validateStompboxGlbAsset(readAssetFile(path), partProfile, {
			assetPath: path,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const diagnostic: StompboxDiagnostic = {
			code: "invalid-glb-asset",
			message: `Invalid GLB asset for stompbox part "${partProfile.id}": ${message}`,
			partId: partProfile.id,
			assetPath: path,
		};
		return {
			schema: "stompbox-glb-asset-validation/v1",
			partProfileId: partProfile.id,
			assetPath: path,
			valid: false,
			targets: {},
			diagnostics: [diagnostic],
		};
	}
}

export function createStompboxSourcePanelControls(
	document: CircuitDocument,
): readonly StompboxSourcePanelControl[] {
	const componentsById = new Map(
		document.components.map((component) => [component.id, component]),
	);
	const controls: StompboxSourcePanelControl[] = [];
	for (const face of document.panel?.faces ?? []) {
		for (const element of face.elements) {
			if (
				element.kind !== "knob" &&
				element.kind !== "switch" &&
				element.kind !== "footswitch"
			) {
				continue;
			}
			const sourceControlId = controlIdForPanelElement(element);
			const sourceComponentId = element.bind.componentId;
			const component =
				sourceComponentId === undefined
					? undefined
					: componentsById.get(sourceComponentId);
			const label =
				nonEmptyText(element.label) ??
				nonEmptyText(component?.name) ??
				nonEmptyText(sourceControlId) ??
				nonEmptyText(sourceComponentId) ??
				nonEmptyText(element.id) ??
				"Control";
			const kind = element.kind === "knob" ? "knob" : "switch";
			const sweep = sourcePanelControlPropertyText(component, "Sweep");
			const options = sourcePanelControlOptions(component);
			const description = sourcePanelControlPropertyText(
				component,
				"Description",
			);
			controls.push({
				id:
					sourceControlId ??
					element.id ??
					`${face.id}-${element.grid.row}-${element.grid.column}`,
				label,
				kind,
				value: sourcePanelControlDefaultValue(kind, component),
				...(sourceComponentId === undefined ? {} : { sourceComponentId }),
				...(element.id === undefined ? {} : { panelElementId: element.id }),
				...(sweep === undefined ? {} : { sweep }),
				...(options === undefined ? {} : { options }),
				...(description === undefined ? {} : { description }),
			});
		}
	}
	return controls;
}

export function createStompboxControlSurface(
	document: CircuitDocument,
	options: Readonly<{
		pedalId: string;
		label?: string;
		compiledControls?: readonly StompboxCompiledControlLike[];
	}>,
): StompboxControlSurface {
	const diagnostics: StompboxDiagnostic[] = [];
	const basePanel = extractPanel(document);
	const panelControls = createStompboxSourcePanelControls(document);
	const sourceControls =
		panelControls.length === 0
			? sourceControlsFromExtractedPanel(basePanel)
			: panelControls;
	const unmatchedCompiled = [...(options.compiledControls ?? [])];
	const descriptors: StompboxRuntimeControlDescriptor[] = [];

	for (const sourceControl of sourceControls) {
		const compiledIndex = findMatchingCompiledControlIndex(
			sourceControl,
			unmatchedCompiled,
			diagnostics,
		);
		const compiled =
			compiledIndex < 0
				? undefined
				: unmatchedCompiled.splice(compiledIndex, 1)[0];
		descriptors.push(runtimeControlDescriptor(sourceControl, compiled));
	}

	descriptors.push(
		...unmatchedCompiled.map((control) =>
			runtimeControlDescriptor(undefined, control),
		),
	);

	const panel = panelFromRuntimeControls(basePanel, descriptors);
	const routes = Object.fromEntries(
		descriptors.map((descriptor) => [
			descriptor.id,
			runtimeRouteForDescriptor(descriptor),
		]),
	);

	return {
		schema: "stompbox-control-surface/v1",
		pedalId: options.pedalId,
		...(options.label === undefined ? {} : { label: options.label }),
		panel,
		controls: descriptors,
		routes,
		diagnostics,
	};
}

export function createStompboxPanelFromControlSurface(
	surface: StompboxControlSurface,
): Panel {
	return surface.panel;
}

export function createDefaultStompboxPedalState(
	document: CircuitDocument,
	options: Readonly<{
		pedalId: string;
		enabled?: boolean;
		compiledControls?: readonly StompboxCompiledControlLike[];
	}>,
): StompboxPedalState {
	const surface = createStompboxControlSurface(document, {
		pedalId: options.pedalId,
		...(options.compiledControls === undefined
			? {}
			: { compiledControls: options.compiledControls }),
	});
	return createStompboxPedalStateFromControlSurface(surface, {
		...(options.enabled === undefined ? {} : { enabled: options.enabled }),
	});
}

export function createDefaultStompboxPedalStateFromVdsp(
	source: string,
	options: Readonly<{
		pedalId: string;
		filename?: string;
		enabled?: boolean;
		compiledControls?: readonly StompboxCompiledControlLike[];
	}>,
): StompboxPedalState {
	const document = parseCircuitDocumentFile(source, {
		filename: options.filename ?? "stompbox.vdsp",
	});
	return createDefaultStompboxPedalState(document, options);
}

export function createStompboxPedalStateFromControlSurface(
	surface: StompboxControlSurface,
	options: Readonly<{ enabled?: boolean }> = {},
): StompboxPedalState {
	return {
		schema: "stompbox-pedal-state/v1",
		pedalId: surface.pedalId,
		revision: 0,
		enabled: options.enabled ?? false,
		controls: defaultControlState(surface.panel),
	};
}

export function normalizeStompboxControlValue(
	descriptor: StompboxRuntimeControlDescriptor,
	rawValue: number,
): ControlValue {
	if (descriptor.kind === "switch") {
		return {
			kind: "switch",
			position: switchPositionForRawValue(rawValue, descriptor),
		};
	}
	return {
		kind: "knob",
		position: normalizeRawPosition(rawValue, descriptor.min, descriptor.max),
	};
}

export function denormalizeStompboxControlValue(
	descriptor: StompboxRuntimeControlDescriptor,
	value: ControlValue,
): number {
	if (descriptor.kind === "switch" && value.kind === "switch") {
		return descriptor.min + value.position * Math.max(1, descriptor.step);
	}
	if (descriptor.kind === "knob" && value.kind === "knob") {
		return (
			descriptor.min +
			clamp01(value.position) * (descriptor.max - descriptor.min)
		);
	}
	return descriptor.value;
}

export function createStompboxRuntimeCommand(
	surface: StompboxControlSurface,
	command: StompboxPedalStateCommand,
): StompboxRuntimeCommand {
	if (command.type === "noop") {
		return { kind: "noop" };
	}
	if (command.type === "error") {
		return {
			kind: "error",
			reason: command.reason,
			...(command.controlId === undefined
				? {}
				: { controlId: command.controlId }),
		};
	}
	if (command.type === "set-enabled") {
		return {
			kind: "set-enabled",
			pedalId: surface.pedalId,
			enabled: command.enabled,
		};
	}
	const descriptor = surface.controls.find(
		(control) => control.id === command.controlId,
	);
	if (descriptor === undefined) {
		return {
			kind: "error",
			reason: `unknown control id "${command.controlId}"`,
			controlId: command.controlId,
		};
	}
	if (descriptor.runtimeControlId === undefined) {
		return { kind: "noop" };
	}
	return {
		kind: "set-control-value",
		pedalId: surface.pedalId,
		controlId: descriptor.runtimeControlId,
		publicControlId: descriptor.id,
		rawValue: denormalizeStompboxControlValue(descriptor, command.value),
	};
}

export function setStompboxPedalEnabled(
	state: StompboxPedalState,
	enabled: boolean,
): StompboxPedalState {
	return applyStompboxPedalStateCommand(state, {
		type: "set-enabled",
		enabled,
	});
}

export function setStompboxControlValue(
	state: StompboxPedalState,
	controlId: string,
	value: ControlValue,
): StompboxPedalState {
	return applyStompboxPedalStateCommand(state, {
		type: "set-control-value",
		controlId,
		value,
	});
}

export function applyStompboxPedalStateCommand(
	state: StompboxPedalState,
	command: StompboxPedalStateCommand,
): StompboxPedalState {
	if (command.type === "noop" || command.type === "error") {
		return state;
	}
	if (command.type === "set-enabled") {
		if (state.enabled === command.enabled) {
			return state;
		}
		return {
			...state,
			enabled: command.enabled,
			revision: state.revision + 1,
		};
	}
	const current = state.controls[command.controlId];
	if (sameControlValue(current, command.value)) {
		return state;
	}
	return {
		...state,
		revision: state.revision + 1,
		controls: {
			...state.controls,
			[command.controlId]: normalizedControlValue(command.value),
		},
	};
}

export function createStompboxKnobTurnCommand(
	surface: StompboxControlSurface,
	input: Readonly<{ controlId: string; position: number }>,
): StompboxPedalStateCommand {
	const descriptor = surface.controls.find(
		(control) => control.id === input.controlId,
	);
	if (descriptor === undefined) {
		return {
			type: "error",
			reason: `unknown control id "${input.controlId}"`,
			controlId: input.controlId,
		};
	}
	if (descriptor.kind !== "knob") {
		return {
			type: "error",
			reason: `control "${input.controlId}" is not a knob`,
			controlId: input.controlId,
		};
	}
	return {
		type: "set-control-value",
		controlId: input.controlId,
		value: { kind: "knob", position: clamp01(input.position) },
	};
}

export function createStompboxFootswitchPressCommand(
	surface: StompboxControlSurface,
	input: Readonly<{ controlId?: string; partId?: string; pressed: boolean }>,
): StompboxPedalStateCommand {
	if (
		input.partId === "switch-bypass" ||
		input.controlId === "stompbox:enabled"
	) {
		return { type: "set-enabled", enabled: input.pressed };
	}
	const controlId = input.controlId ?? controlIdFromSwitchPartId(input.partId);
	if (controlId === undefined) {
		return {
			type: "error",
			reason: "footswitch press requires a controlId or partId",
		};
	}
	const descriptor = surface.controls.find(
		(control) => control.id === controlId,
	);
	if (descriptor === undefined) {
		return {
			type: "error",
			reason: `unknown control id "${controlId}"`,
			controlId,
		};
	}
	if (descriptor.kind !== "switch") {
		return {
			type: "error",
			reason: `control "${controlId}" is not a switch`,
			controlId,
		};
	}
	return {
		type: "set-control-value",
		controlId,
		value: { kind: "switch", position: input.pressed ? 1 : 0 },
	};
}

export function applyStompboxPreviewInteraction(
	state: StompboxPedalState,
	command: StompboxPedalStateCommand,
): StompboxPedalState {
	return applyStompboxPedalStateCommand(state, command);
}

export function createStompboxPedalStateStore(
	initialState: StompboxPedalState,
	options: Readonly<{ preview?: StompboxPreview }> = {},
): StompboxPedalStateStore {
	let state = initialState;
	const listeners = new Set<StompboxPedalStateListener>();
	const controlListeners = new Map<string, Set<StompboxControlStateListener>>();
	const patchListeners = new Set<StompboxPreviewStatePatchListener>();

	const notify = (
		previous: StompboxPedalState,
		current: StompboxPedalState,
		command: StompboxPedalStateCommand,
	): void => {
		const changedControlIds = changedControlIdsForState(previous, current);
		const event: StompboxPedalStateChange = {
			previous,
			current,
			changedControlIds,
			enabledChanged: previous.enabled !== current.enabled,
			command,
		};
		for (const listener of listeners) {
			listener(event);
		}
		for (const controlId of changedControlIds) {
			for (const listener of controlListeners.get(controlId) ?? []) {
				listener(current.controls[controlId], event);
			}
		}
		if (options.preview !== undefined && patchListeners.size > 0) {
			const patch = createStompboxPreviewStatePatch(
				options.preview,
				current,
				previous,
			);
			if (Object.keys(patch.parts).length > 0) {
				for (const listener of patchListeners) {
					listener(patch, event);
				}
			}
		}
	};

	const dispatch = (command: StompboxPedalStateCommand): StompboxPedalState => {
		const previous = state;
		const current = applyStompboxPedalStateCommand(previous, command);
		if (current !== previous) {
			state = current;
			notify(previous, current, command);
		}
		return state;
	};

	return {
		getSnapshot: () => state,
		dispatch,
		setEnabled: (enabled) => dispatch({ type: "set-enabled", enabled }),
		setControlValue: (controlId, value) =>
			dispatch({ type: "set-control-value", controlId, value }),
		turnKnob: (controlId, position) =>
			dispatch({
				type: "set-control-value",
				controlId,
				value: { kind: "knob", position: clamp01(position) },
			}),
		pressFootswitch: (partIdOrControlId, pressed) =>
			dispatch(
				partIdOrControlId === "switch-bypass"
					? { type: "set-enabled", enabled: pressed }
					: {
							type: "set-control-value",
							controlId:
								controlIdFromSwitchPartId(partIdOrControlId) ??
								partIdOrControlId,
							value: { kind: "switch", position: pressed ? 1 : 0 },
						},
			),
		subscribe: (listener) => subscribeSet(listeners, listener),
		subscribeControl: (controlId, listener) => {
			const listenersForControl =
				controlListeners.get(controlId) ??
				new Set<StompboxControlStateListener>();
			controlListeners.set(controlId, listenersForControl);
			return subscribeSet(listenersForControl, listener);
		},
		subscribePreviewPatch: (listener) => subscribeSet(patchListeners, listener),
	};
}

export function createStompboxDrillLayoutFromVdsp(
	source: string,
	options: StompboxFromVdspOptions = {},
): StompboxDrillLayout {
	const document = parseCircuitDocumentFile(source, {
		filename: options.filename ?? "stompbox.vdsp",
	});
	return createStompboxDrillLayout(document, options);
}

export function createStompboxDrillLayout(
	document: CircuitDocument,
	options: StompboxLayoutOptions = {},
): StompboxDrillLayout {
	const hardwareProfile = requireStompboxHardwareProfile(options);
	const enclosure = enclosureProfile(options.enclosureId, hardwareProfile);
	const placementStyle = resolveStompboxPlacementStyle(
		options.styleProfile,
		hardwareProfile,
	);
	const panel = extractPanel(document);
	const controlMetadata = controlMetadataById(panel);
	const diagnostics: StompboxDiagnostic[] = [];
	const declared = declaredPhysicalPlacements(
		document.panel?.faces ?? [],
		controlMetadata,
		hardwareProfile,
		hardwareProfile.defaultPartIds,
		diagnostics,
	);
	const gridDeclared = gridPhysicalPlacements(
		document.panel?.faces ?? [],
		controlMetadata,
		enclosure,
		hardwareProfile,
		hardwareProfile.defaultPartIds,
		diagnostics,
	);
	const panelDeclared = [...declared, ...gridDeclared];
	const declaredControlIds = new Set(
		panelDeclared.flatMap((candidate) =>
			candidate.controlId === undefined ? [] : [candidate.controlId],
		),
	);
	const auto = autoPlacementCandidates(
		panel,
		enclosure,
		panelDeclared,
		declaredControlIds,
		options,
		hardwareProfile,
		placementStyle,
		diagnostics,
	);
	const holes = collapseConcentricMounts(
		[...panelDeclared, ...auto],
		hardwareProfile,
		diagnostics,
	).flatMap((candidate) =>
		drillHoleForCandidate(candidate, hardwareProfile, diagnostics),
	);
	diagnostics.push(
		...validateHolePlacements(holes, enclosure, options.minPartClearanceMm),
	);

	return {
		schema: "stompbox-drill-layout/v1",
		units: "mm",
		enclosure,
		holes,
		diagnostics,
	};
}

export function createStompboxPreviewFromVdsp(
	source: string,
	options: StompboxPreviewFromVdspOptions = {},
): StompboxPreview {
	const document = parseCircuitDocumentFile(source, {
		filename: options.filename ?? "stompbox.vdsp",
	});
	return createStompboxPreview(document, options);
}

export function createStompboxPreview(
	document: CircuitDocument,
	options: StompboxPreviewOptions = {},
): StompboxPreview {
	const hardwareProfile = requireStompboxHardwareProfile(options);
	const placementStyle = resolveStompboxPlacementStyle(
		options.styleProfile,
		hardwareProfile,
	);
	const drillLayout = createStompboxDrillLayout(document, options);
	const panel = extractPanel(document);
	const controlMetadata = controlMetadataById(panel);
	const resolveOptions = assetResolveOptions(options);
	const runtimeState = options.pedalState?.controls ?? options.state;
	const enabled = options.pedalState?.enabled;
	const parts = drillLayout.holes.flatMap((hole) => {
		const base = previewPartForHole(
			hole,
			drillLayout.enclosure,
			controlMetadata.get(hole.controlId ?? ""),
			runtimeState,
			resolveOptions,
			options.appearance,
			enabled,
		);
		const dials = hole.concentricDials ?? [];
		if (dials.length === 0) {
			return [base];
		}
		const stacked = dials.map((dial) => {
			const dialPart = previewPartForHole(
				concentricDialHole(hole, dial),
				drillLayout.enclosure,
				controlMetadata.get(dial.controlId ?? ""),
				runtimeState,
				resolveOptions,
				options.appearance,
				enabled,
			);
			return {
				...dialPart,
				transform: {
					...dialPart.transform,
					translationMm: {
						...dialPart.transform.translationMm,
						z: dialPart.transform.translationMm.z + dial.stackOffsetMm,
					},
				},
			};
		});
		return [base, ...stacked];
	});
	const decals = [
		...normalizeDecals(options.decals, drillLayout.enclosure),
		...controlLabelDecals(drillLayout, placementStyle, options.appearance),
	];
	const enclosureMaterial = materialWithValues(options.appearance?.enclosure);

	return {
		schema: "stompbox-preview/v1",
		units: "mm",
		enclosure: {
			variantId: drillLayout.enclosure.variantId,
			label: drillLayout.enclosure.label,
			dimensionsMm: drillLayout.enclosure.dimensionsMm,
			topFace: drillLayout.enclosure.topFace,
			assets: resolveStompboxAssetPaths(
				drillLayout.enclosure.assets,
				resolveOptions,
			),
			...(enclosureMaterial === undefined
				? {}
				: { material: enclosureMaterial }),
		},
		parts,
		decals,
		drillLayout,
		diagnostics: drillLayout.diagnostics,
	};
}

export function createStompboxPreviewStatePatch(
	preview: StompboxPreview,
	state: StompboxPedalState,
	previousState?: StompboxPedalState,
): StompboxPreviewStatePatch {
	const parts = Object.fromEntries(
		preview.parts.flatMap((part) => {
			const currentValue = previewStateValueForPart(part, state);
			const previousValue =
				previousState === undefined
					? undefined
					: previewStateValueForPart(part, previousState);
			if (
				currentValue === undefined ||
				sameControlValue(currentValue, previousValue)
			) {
				return [];
			}
			const target = previewStatePatchTarget(part, currentValue, previousValue);
			return [[target.targetId, target] as const];
		}),
	);
	return {
		schema: "stompbox-preview-state-patch/v1",
		units: "mm",
		pedalId: state.pedalId,
		revision: state.revision,
		parts,
	};
}

export function applyStompboxPreviewStatePatch(
	preview: StompboxPreview,
	patch: StompboxPreviewStatePatch,
): StompboxPreview {
	const parts = preview.parts.map((part) => {
		const target = patch.parts[`part-${part.id}`];
		if (target === undefined) {
			return part;
		}
		return {
			...part,
			...(target.transform === undefined
				? {}
				: { transform: target.transform }),
			...(target.material === undefined ? {} : { material: target.material }),
		};
	});
	return {
		...preview,
		parts,
	};
}

export function resolveStompboxAppearance(
	preview: StompboxPreview,
	appearance?: StompboxAppearance,
): StompboxResolvedAppearance {
	return createStompboxAppearancePatch(preview, appearance);
}

export function createStompboxAppearancePatch(
	preview: StompboxPreview,
	appearance?: StompboxAppearance,
): StompboxResolvedAppearance {
	const enclosureMaterial = mergeMaterials(
		preview.enclosure.material,
		appearance?.enclosure,
	);
	const parts = Object.fromEntries(
		preview.parts.flatMap((part) => {
			const material = mergeMaterials(
				part.material,
				previewPartAppearanceFor(part, appearance),
			);
			if (material === undefined) {
				return [];
			}
			const target: StompboxPartAppearancePatchTarget = {
				targetId: `part-${part.id}`,
				partId: part.partId,
				...(part.controlId === undefined ? {} : { controlId: part.controlId }),
				family: part.family,
				...material,
			};
			return [[target.targetId, target] as const];
		}),
	);
	const decals = Object.fromEntries(
		preview.decals.flatMap((decal) => {
			const labelAppearance = decalAppearanceFor(decal, appearance);
			const textDecal =
				decal.kind === "text"
					? {
							text: labelAppearance?.text ?? decal.text,
							color: labelAppearance?.color ?? decal.color,
							fontFamily: labelAppearance?.fontFamily ?? decal.fontFamily,
							fontSizeMm: labelAppearance?.fontSizeMm ?? decal.fontSizeMm,
						}
					: {};
			const target: StompboxDecalAppearancePatchTarget = {
				targetId: `decal-${decal.id}`,
				decalId: decal.id,
				kind: decal.kind,
				face: decal.face,
				...textDecal,
			};
			return [[target.targetId, target] as const];
		}),
	);
	return {
		schema: "stompbox-appearance-patch/v1",
		units: preview.units,
		...(enclosureMaterial === undefined
			? {}
			: {
					enclosure: {
						targetId: `enclosure-${preview.enclosure.variantId}`,
						...enclosureMaterial,
					},
				}),
		parts,
		decals,
	};
}

export function createStompboxDrillTemplateFromVdsp(
	source: string,
	options: StompboxDrillTemplateFromVdspOptions,
): StompboxDrillTemplate {
	const layout = createStompboxDrillLayoutFromVdsp(source, options);
	return createStompboxDrillTemplate(layout, options);
}

export function createStompboxDrillTemplate(
	layout: StompboxDrillLayout,
	options: StompboxDrillTemplateOptions,
): StompboxDrillTemplate {
	const previewCanvas = unfoldedDrillTemplateSize(layout.enclosure);
	const decals = normalizeDecals(options.decals, layout.enclosure);
	if (options.mode === "print") {
		const page: StompboxDrillTemplatePage = {
			paper: "A4",
			orientation: "portrait",
			widthMm: 210,
			heightMm: 297,
			marginMm: 12,
		};
		return {
			schema: "stompbox-drill-template/v1",
			mode: "print",
			units: "mm",
			scale: 1,
			detailLevel: "fabrication-detail",
			canvasMm: { widthMm: page.widthMm, heightMm: page.heightMm },
			page,
			enclosure: layout.enclosure,
			holes: layout.holes.map((hole) =>
				templateHole(hole, layout.enclosure, {
					widthMm: page.widthMm,
					heightMm: page.heightMm,
				}),
			),
			scaleMarks: [
				{
					id: "scale-10mm",
					label: "10 mm",
					lengthMm: 10,
					startMm: { x: 12, y: 285 },
					endMm: { x: 22, y: 285 },
				},
				{
					id: "scale-50mm",
					label: "50 mm",
					lengthMm: 50,
					startMm: { x: 12, y: 278 },
					endMm: { x: 62, y: 278 },
				},
			],
			decals,
			...(options.appearance === undefined
				? {}
				: { appearance: options.appearance }),
			holeTable: layout.holes,
			diagnostics: layout.diagnostics,
		};
	}

	return {
		schema: "stompbox-drill-template/v1",
		mode: "preview",
		units: "mm",
		scale: 1,
		detailLevel: "preview",
		canvasMm: previewCanvas,
		page: undefined,
		enclosure: layout.enclosure,
		holes: layout.holes.map((hole) =>
			templateHole(hole, layout.enclosure, previewCanvas),
		),
		decals,
		...(options.appearance === undefined
			? {}
			: { appearance: options.appearance }),
		scaleMarks: [],
		holeTable: [],
		diagnostics: layout.diagnostics,
	};
}

export function createStompboxDrillTemplateSvgFromVdsp(
	source: string,
	options: StompboxDrillTemplateFromVdspOptions,
): string {
	const layout = createStompboxDrillLayoutFromVdsp(source, options);
	return createStompboxDrillTemplateSvg(layout, options);
}

export function createStompboxDrillTemplateSvg(
	layout: StompboxDrillLayout,
	options: StompboxDrillTemplateOptions,
): string {
	return drillTemplateSvg(createStompboxDrillTemplate(layout, options));
}

export function createStompboxPreviewSvgViewsFromVdsp(
	source: string,
	options: StompboxPreviewSvgViewsFromVdspOptions = {},
): StompboxPreviewSvgViews {
	const document = parseCircuitDocumentFile(source, {
		filename: options.filename ?? "stompbox.vdsp",
	});
	return createStompboxPreviewSvgViews(document, options);
}

export function createStompboxPreviewSvgViews(
	document: CircuitDocument,
	options: StompboxPreviewSvgViewsOptions = {},
): StompboxPreviewSvgViews {
	const preview = createStompboxPreview(document, options);
	const grain = resolvePreviewSvgGrain(options.grain);
	return {
		schema: "stompbox-preview-svg-views/v1",
		units: "mm",
		preview,
		views: {
			top: previewViewSvg(preview, "top", grain),
			bottom: previewViewSvg(preview, "bottom", grain),
			left: previewViewSvg(preview, "left", grain),
			right: previewViewSvg(preview, "right", grain),
			back: previewViewSvg(preview, "back", grain),
		},
		diagnostics: preview.diagnostics,
	};
}

export function createStompboxPreviewGlbFromVdsp(
	source: string,
	options: StompboxPreviewGlbFromVdspOptions = {},
): StompboxPreviewGlb {
	const document = parseCircuitDocumentFile(source, {
		filename: options.filename ?? "stompbox.vdsp",
	});
	return createStompboxPreviewGlb(document, options);
}

export function createStompboxPreviewGlb(
	document: CircuitDocument,
	options: StompboxPreviewGlbOptions = {},
): StompboxPreviewGlb {
	const preview = createStompboxPreview(document, options);
	const hardwareProfile = requireStompboxHardwareProfile(options);
	const assetValidation =
		options.basePath === undefined
			? undefined
			: validateStompboxHardwareProfileAssets(hardwareProfile, {
					basePath: options.basePath,
					...(options.readAssetFile === undefined
						? {}
						: { readAssetFile: options.readAssetFile }),
					partIds: liveStatePartProfileIdsForPreview(preview),
				});
	const diagnostics = [
		...preview.diagnostics,
		...(assetValidation?.diagnostics ?? []),
	];
	return {
		schema: "stompbox-preview-glb/v1",
		mimeType: "model/gltf-binary",
		bytes: previewGlb(preview, options, assetValidation),
		preview,
		diagnostics,
	};
}

function resolvePreviewSvgGrain(
	grain: boolean | StompboxPreviewSvgGrainOptions | undefined,
): ResolvedStompboxPreviewSvgGrain | undefined {
	if (grain !== true && (grain === undefined || grain === false)) {
		return undefined;
	}
	const options = grain === true ? {} : grain;
	return {
		baseFrequency: positiveNumberOrDefault(
			options.baseFrequency,
			STOMPBOX_PREVIEW_SVG_GRAIN_BASE_FREQUENCY,
		),
		numOctaves: positiveIntegerOrDefault(
			options.numOctaves,
			STOMPBOX_PREVIEW_SVG_GRAIN_NUM_OCTAVES,
		),
		opacity: unitIntervalOrDefault(
			options.opacity,
			STOMPBOX_PREVIEW_SVG_GRAIN_OPACITY,
		),
	};
}

function positiveNumberOrDefault(
	value: number | undefined,
	fallback: number,
): number {
	return value === undefined || !Number.isFinite(value) || value <= 0
		? fallback
		: value;
}

function positiveIntegerOrDefault(
	value: number | undefined,
	fallback: number,
): number {
	return Math.max(1, Math.round(positiveNumberOrDefault(value, fallback)));
}

function unitIntervalOrDefault(
	value: number | undefined,
	fallback: number,
): number {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.min(1, value));
}

export function knobRotationDegForPosition(position: number): number {
	return 135 - clamp01(position) * 270;
}

function nonEmptyText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function sourcePanelControlDefaultValue(
	kind: StompboxRuntimeControlKind,
	component: CircuitDocument["components"][number] | undefined,
): number {
	if (kind === "switch") {
		const rawPosition = sourcePanelControlPropertyText(component, "Position");
		const parsedPosition =
			rawPosition === undefined ? Number.NaN : Number.parseFloat(rawPosition);
		return Number.isFinite(parsedPosition) ? parsedPosition : 0;
	}
	const rawWipe = sourcePanelControlPropertyText(component, "Wipe");
	const parsedWipe =
		rawWipe === undefined ? Number.NaN : Number.parseFloat(rawWipe);
	return Number.isFinite(parsedWipe) ? clamp01(parsedWipe) : 0.5;
}

function sourcePanelControlPropertyText(
	component: CircuitDocument["components"][number] | undefined,
	key: string,
): string | undefined {
	const value = component?.properties[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (typeof value === "object") {
		if ("raw" in value && value.raw !== undefined && value.raw !== null) {
			return String(value.raw);
		}
		if ("value" in value && value.value !== undefined && value.value !== null) {
			return String(value.value);
		}
	}
	return undefined;
}

function sourcePanelControlOptions(
	component: CircuitDocument["components"][number] | undefined,
): readonly string[] | undefined {
	const raw =
		sourcePanelControlPropertyText(component, "ControlOptions") ??
		sourcePanelControlPropertyText(component, "StepLabels") ??
		sourcePanelControlPropertyText(component, "Options");
	const options =
		raw
			?.split(",")
			.map((option) => option.trim())
			.filter((option) => option.length > 0) ?? [];
	return options.length === 0 ? undefined : options;
}

function sourceControlsFromExtractedPanel(
	panel: Panel,
): readonly StompboxSourcePanelControl[] {
	return [
		...panel.knobs.map(
			(knob): StompboxSourcePanelControl => ({
				id: knob.id,
				label: knob.name,
				kind: "knob",
				value: knob.defaultPosition,
				sourceComponentId: knob.id,
				...(knob.description === undefined
					? {}
					: { description: knob.description }),
			}),
		),
		...panel.switches.map(
			(switchControl): StompboxSourcePanelControl => ({
				id: switchControl.id,
				label: switchControl.name,
				kind: "switch",
				value: switchControl.defaultPosition,
				sourceComponentId: switchControl.id,
				...(switchControl.description === undefined
					? {}
					: { description: switchControl.description }),
			}),
		),
	];
}

function findMatchingCompiledControlIndex(
	sourceControl: StompboxSourcePanelControl,
	compiledControls: readonly StompboxCompiledControlLike[],
	diagnostics: StompboxDiagnostic[],
): number {
	if (sourceControl.sourceComponentId !== undefined) {
		const byComponent = compiledControls.findIndex(
			(control) =>
				control.sourceComponentId === sourceControl.sourceComponentId,
		);
		if (byComponent >= 0) {
			return byComponent;
		}
	}

	const normalizedLabel = normalizeRuntimeControlName(sourceControl.label);
	const labelMatches = compiledControls
		.map((control, index) => ({ control, index }))
		.filter(
			({ control }) =>
				normalizeRuntimeControlName(control.name) === normalizedLabel,
		);
	if (labelMatches.length > 1) {
		diagnostics.push({
			code: "unsupported-control",
			message: `Ambiguous compiled control match for source panel control "${sourceControl.label}"`,
			controlId: sourceControl.id,
		});
		return -1;
	}
	return labelMatches[0]?.index ?? -1;
}

function runtimeControlDescriptor(
	sourceControl: StompboxSourcePanelControl | undefined,
	compiledControl: StompboxCompiledControlLike | undefined,
): StompboxRuntimeControlDescriptor {
	const kind: StompboxRuntimeControlKind =
		compiledControl === undefined
			? (sourceControl?.kind ?? "knob")
			: compiledControl.kind === "switch"
				? "switch"
				: "knob";
	const min =
		compiledControl?.min ?? (sourceControl?.kind === "switch" ? 0 : 0);
	const optionCount =
		sourceControl?.options?.length ?? compiledControl?.options?.length ?? 0;
	const max =
		compiledControl?.max ??
		(kind === "switch" || optionCount > 0 ? Math.max(1, optionCount - 1) : 1);
	const step =
		compiledControl?.step ?? (kind === "switch" || optionCount > 0 ? 1 : 0.01);
	const rawValue =
		compiledControl === undefined
			? (sourceControl?.value ?? min)
			: effectiveCompiledControlValue(compiledControl);
	const id =
		sourceControl?.id ??
		compiledControl?.sourceComponentId ??
		publicRuntimeControlId(
			compiledControl?.id ?? compiledControl?.name ?? "control",
		);
	const label = sourceControl?.label ?? compiledControl?.name ?? id;
	const normalizedValue =
		kind === "switch"
			? {
					kind: "switch" as const,
					position: switchPositionForRawValue(rawValue, { min, max, step }),
				}
			: {
					kind: "knob" as const,
					position: normalizeRawPosition(rawValue, min, max),
				};
	const sourceComponentId =
		sourceControl?.sourceComponentId ?? compiledControl?.sourceComponentId;
	const sweep = sourceControl?.sweep ?? compiledControl?.sweep;
	const options = sourceControl?.options ?? compiledControl?.options;
	return {
		id,
		label,
		kind,
		source: compiledControl === undefined ? "source-panel" : "compiled",
		value: rawValue,
		min,
		max,
		step,
		normalizedValue,
		...(sourceComponentId === undefined ? {} : { sourceComponentId }),
		...(sourceControl?.panelElementId === undefined
			? {}
			: { panelElementId: sourceControl.panelElementId }),
		...(compiledControl?.id === undefined
			? {}
			: { runtimeControlId: compiledControl.id }),
		...(compiledControl?.kind === undefined
			? {}
			: { controlKind: compiledControl.kind }),
		...(compiledControl?.unit === undefined
			? {}
			: { unit: compiledControl.unit }),
		...(sweep === undefined ? {} : { sweep }),
		...(options === undefined ? {} : { options }),
		...(sourceControl?.description === undefined
			? {}
			: { description: sourceControl.description }),
		...(compiledControl?.targets === undefined
			? {}
			: { targetCount: compiledControl.targets.length }),
	};
}

function effectiveCompiledControlValue(
	control: StompboxCompiledControlLike,
): number {
	if (
		control.kind === "switch" ||
		control.options !== undefined ||
		control.defaultBehavior === "source"
	) {
		return control.value;
	}
	return control.min + (control.max - control.min) / 2;
}

function runtimeRouteForDescriptor(
	descriptor: StompboxRuntimeControlDescriptor,
): StompboxRuntimeControlRoute {
	return {
		publicControlId: descriptor.id,
		...(descriptor.runtimeControlId === undefined
			? {}
			: { runtimeControlId: descriptor.runtimeControlId }),
		...(descriptor.sourceComponentId === undefined
			? {}
			: { sourceComponentId: descriptor.sourceComponentId }),
		kind: descriptor.kind,
		source: descriptor.source,
		min: descriptor.min,
		max: descriptor.max,
		step: descriptor.step,
	};
}

function panelFromRuntimeControls(
	basePanel: Panel,
	controls: readonly StompboxRuntimeControlDescriptor[],
): Panel {
	return {
		...(basePanel.placement === undefined
			? {}
			: { placement: basePanel.placement }),
		knobs: controls
			.filter((control) => control.kind === "knob")
			.map(
				(control): Knob => ({
					id: control.id,
					name: control.label,
					taper: taperFromSweep(control.sweep),
					defaultPosition:
						control.normalizedValue.kind === "knob"
							? control.normalizedValue.position
							: 0.5,
					...(control.description === undefined
						? {}
						: { description: control.description }),
				}),
			),
		...(basePanel.sliders === undefined ? {} : { sliders: basePanel.sliders }),
		switches: controls
			.filter((control) => control.kind === "switch")
			.map(
				(control): SwitchControl => ({
					id: control.id,
					name: control.label,
					switchKind: "spst",
					poles: 1,
					positions: Math.max(
						2,
						Math.round(
							(control.max - control.min) / Math.max(1, control.step),
						) + 1,
					),
					defaultPosition:
						control.normalizedValue.kind === "switch"
							? control.normalizedValue.position
							: 0,
					...(control.description === undefined
						? {}
						: { description: control.description }),
				}),
			),
		leds: basePanel.leds,
		jacks: basePanel.jacks,
	};
}

function taperFromSweep(sweep: string | undefined): Knob["taper"] {
	const lower = sweep?.toLowerCase();
	if (lower === undefined) {
		return "unknown";
	}
	if (lower.includes("rev") && lower.includes("log")) {
		return "reverse-log";
	}
	if (lower.includes("log") || lower.includes("audio")) {
		return "log";
	}
	if (lower.includes("lin")) {
		return "linear";
	}
	return "unknown";
}

function normalizeRuntimeControlName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function publicRuntimeControlId(value: string): string {
	return value.startsWith("control-") ? value.slice("control-".length) : value;
}

function normalizeRawPosition(value: number, min: number, max: number): number {
	const span = max - min;
	if (!Number.isFinite(span) || span <= 0) {
		return 0;
	}
	return clamp01((value - min) / span);
}

function switchPositionForRawValue(
	value: number,
	range: Readonly<{ min: number; max: number; step: number }>,
): number {
	const step = Math.max(1, range.step);
	const positions = Math.max(2, Math.round((range.max - range.min) / step) + 1);
	return Math.max(
		0,
		Math.min(positions - 1, Math.round((value - range.min) / step)),
	);
}

function normalizedControlValue(value: ControlValue): ControlValue {
	if (value.kind === "knob" || value.kind === "slider") {
		return { ...value, position: clamp01(value.position) };
	}
	if (value.kind === "switch") {
		return {
			kind: "switch",
			position: Math.max(0, Math.round(value.position)),
		};
	}
	return {
		kind: "led",
		on: value.on,
		...(value.intensity === undefined
			? {}
			: { intensity: clamp01(value.intensity) }),
	};
}

function sameControlValue(
	first: ControlValue | undefined,
	second: ControlValue | undefined,
): boolean {
	if (first === undefined || second === undefined) {
		return first === second;
	}
	if (first.kind !== second.kind) {
		return false;
	}
	if (first.kind === "knob" && second.kind === "knob") {
		return first.position === second.position;
	}
	if (first.kind === "slider" && second.kind === "slider") {
		return first.position === second.position;
	}
	if (first.kind === "switch" && second.kind === "switch") {
		return first.position === second.position;
	}
	if (first.kind === "led" && second.kind === "led") {
		return (
			first.on === second.on &&
			(first.intensity ?? 0) === (second.intensity ?? 0)
		);
	}
	return false;
}

function controlIdFromSwitchPartId(
	partId: string | undefined,
): string | undefined {
	return partId?.startsWith("switch-") === true
		? partId.slice("switch-".length)
		: undefined;
}

function subscribeSet<T>(listeners: Set<T>, listener: T): StompboxUnsubscribe {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function changedControlIdsForState(
	previous: StompboxPedalState,
	current: StompboxPedalState,
): readonly string[] {
	const ids = new Set([
		...Object.keys(previous.controls),
		...Object.keys(current.controls),
	]);
	return [...ids].filter(
		(id) => !sameControlValue(previous.controls[id], current.controls[id]),
	);
}

function stateValueForHole(
	hole: StompboxDrillHole,
	state: ControlState | undefined,
	enabled: boolean | undefined,
): ControlValue | undefined {
	if (hole.controlId !== undefined) {
		return state?.[hole.controlId];
	}
	if (enabled === undefined) {
		return undefined;
	}
	if (hole.id === "led-status") {
		return { kind: "led", on: enabled };
	}
	if (hole.id === "switch-bypass") {
		return { kind: "switch", position: enabled ? 1 : 0 };
	}
	return undefined;
}

function previewStateValueForPart(
	part: StompboxPreviewPart,
	state: StompboxPedalState,
): ControlValue | undefined {
	if (part.controlId !== undefined) {
		return state.controls[part.controlId];
	}
	if (part.id === "led-status") {
		return { kind: "led", on: state.enabled };
	}
	if (part.id === "switch-bypass") {
		return { kind: "switch", position: state.enabled ? 1 : 0 };
	}
	return undefined;
}

function previewStatePatchTarget(
	part: StompboxPreviewPart,
	value: ControlValue,
	previousValue: ControlValue | undefined,
): StompboxPreviewStatePatchTarget {
	const stateTarget = previewStateTargetForPart(part, value);
	const transform = previewStateTransformForPart(
		part,
		value,
		previousValue,
		stateTarget,
	);
	const material = previewStateMaterialForPart(part, value);
	return {
		targetId: `part-${part.id}`,
		previewPartId: part.id,
		partId: part.partId,
		family: part.family,
		...(part.controlId === undefined ? {} : { controlId: part.controlId }),
		value,
		...(stateTarget === undefined ? {} : { stateTarget }),
		...(transform === undefined ? {} : { transform }),
		...(material === undefined ? {} : { material }),
	};
}

function previewStateTransformForPart(
	part: StompboxPreviewPart,
	value: ControlValue,
	previousValue: ControlValue | undefined,
	stateTarget: StompboxResolvedGlbStateTarget | undefined,
): StompboxPreviewPart["transform"] | undefined {
	if (part.geometry.kind === "knob" && value.kind === "knob") {
		return {
			...part.transform,
			rotationDeg: {
				...part.transform.rotationDeg,
				z: knobRotationDegForPosition(value.position),
			},
		};
	}
	if (
		part.geometry.kind === "footswitch" &&
		value.kind === "switch" &&
		stateTarget === undefined
	) {
		const previousOffset =
			previousValue?.kind === "switch" && previousValue.position > 0
				? -part.geometry.pressedTravelMm
				: 0;
		const baseZ = part.transform.translationMm.z - previousOffset;
		const nextOffset = value.position > 0 ? -part.geometry.pressedTravelMm : 0;
		return {
			...part.transform,
			translationMm: {
				...part.transform.translationMm,
				z: roundMillimeters(baseZ + nextOffset),
			},
		};
	}
	return undefined;
}

function previewStateMaterialForPart(
	part: StompboxPreviewPart,
	value: ControlValue,
): StompboxPreviewMaterial | undefined {
	if (part.family !== "led" || value.kind !== "led") {
		return undefined;
	}
	if (!value.on) {
		return {
			...(part.material ?? {}),
			emissive: false,
			intensity: 0,
		};
	}
	return {
		...(part.material ?? {}),
		emissive: true,
		intensity: value.intensity ?? 1,
	};
}

function previewStateTargetForPart(
	part: StompboxPreviewPart,
	value: ControlValue,
): StompboxResolvedGlbStateTarget | undefined {
	if (part.family === "led" && value.kind === "led") {
		return resolvedStateTargetForPart(
			part.id,
			"led.lens",
			part.stateTargets?.led?.lens,
		);
	}
	if (part.geometry.kind === "footswitch" && value.kind === "switch") {
		return resolvedStateTargetForPart(
			part.id,
			"footswitch.actuator",
			part.stateTargets?.footswitch?.actuator,
			{
				travelAxis: part.stateTargets?.footswitch?.travelAxis ?? "z",
				travelMm:
					part.stateTargets?.footswitch?.travelMm ??
					part.geometry.pressedTravelMm,
			},
		);
	}
	return undefined;
}

function resolvedStateTargetForPart(
	previewPartId: string,
	role: StompboxGlbStateTargetRole,
	target: StompboxGlbStateTargetRef | undefined,
	motion?: Readonly<{
		travelAxis: StompboxFootswitchTravelAxis;
		travelMm: number;
	}>,
): StompboxResolvedGlbStateTarget | undefined {
	if (target?.selector.nodeName === undefined) {
		return undefined;
	}
	return {
		role,
		selector: target.selector,
		nodeName: `${previewPartId}/${target.selector.nodeName}`,
		...(target.selector.meshName === undefined
			? {}
			: { meshName: `${previewPartId}/${target.selector.meshName}` }),
		...(target.selector.materialName === undefined
			? {}
			: { materialName: `${previewPartId}/${target.selector.materialName}` }),
		...(motion === undefined ? {} : motion),
	};
}

type RequiredGlbStateTarget = Readonly<{
	role: StompboxGlbStateTargetRole;
	target: StompboxGlbStateTargetRef | undefined;
	motion?: Readonly<{
		travelAxis: StompboxFootswitchTravelAxis;
		travelMm: number;
	}>;
}>;

type GlbStateTargetCandidate = Readonly<{
	nodeName: string;
	meshName?: string;
	materialName?: string;
	materialNames: readonly string[];
	extras?: JsonObject;
}>;

function requiredStateTargetsForPartProfile(
	partProfile: StompboxPartProfile,
): readonly RequiredGlbStateTarget[] {
	if (
		partProfile.family === "led" &&
		(partProfile.geometry.kind === "led" ||
			partProfile.geometry.kind === "led-bezel")
	) {
		return [
			{
				role: "led.lens",
				target: partProfile.stateTargets?.led?.lens,
			},
		];
	}
	if (
		partProfile.family === "footswitch" &&
		partProfile.geometry.kind === "footswitch"
	) {
		return [
			{
				role: "footswitch.actuator",
				target: partProfile.stateTargets?.footswitch?.actuator,
				motion: {
					travelAxis: partProfile.stateTargets?.footswitch?.travelAxis ?? "z",
					travelMm:
						partProfile.stateTargets?.footswitch?.travelMm ??
						partProfile.geometry.pressedTravelMm,
				},
			},
		];
	}
	return [];
}

function defaultLiveStatePartProfileIds(
	hardwareProfile: StompboxHardwareProfile,
): readonly string[] {
	return uniqueStrings([
		hardwareProfile.defaultPartIds.led,
		hardwareProfile.defaultPartIds.footswitch,
	]);
}

function liveStatePartProfileIdsForPreview(
	preview: StompboxPreview,
): readonly string[] {
	return uniqueStrings(
		preview.parts.flatMap((part) =>
			part.family === "led" || part.family === "footswitch"
				? [part.partId]
				: [],
		),
	);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

function glbStateTargetCandidates(
	json: JsonObject,
): readonly GlbStateTargetCandidate[] {
	const nodes = jsonObjectArray(json, "nodes");
	const meshes = jsonObjectArray(json, "meshes");
	const materials = jsonObjectArray(json, "materials");
	return nodes.flatMap((node) => {
		const nodeName = typeof node.name === "string" ? node.name : undefined;
		if (nodeName === undefined) {
			return [];
		}
		const mesh = typeof node.mesh === "number" ? meshes[node.mesh] : undefined;
		const meshName = typeof mesh?.name === "string" ? mesh.name : undefined;
		const materialNames =
			mesh === undefined ? [] : materialNamesForMesh(mesh, materials);
		const materialName = materialNames[0];
		const extras = jsonObjectValue(node.extras);
		return [
			{
				nodeName,
				...(meshName === undefined ? {} : { meshName }),
				...(materialName === undefined ? {} : { materialName }),
				materialNames,
				...(extras === undefined ? {} : { extras }),
			},
		];
	});
}

function materialNamesForMesh(
	mesh: JsonObject,
	materials: readonly JsonObject[],
): readonly string[] {
	const names: string[] = [];
	for (const primitive of jsonObjectArray(mesh, "primitives")) {
		if (typeof primitive.material !== "number") {
			continue;
		}
		const materialName = materials[primitive.material]?.name;
		if (typeof materialName === "string") {
			names.push(materialName);
		}
	}
	return uniqueStrings(names);
}

function stateTargetCandidateMatches(
	candidate: GlbStateTargetCandidate,
	selector: StompboxGlbStateTargetSelector,
): boolean {
	return (
		stringSelectorMatches(
			candidate.nodeName,
			selector.nodeName,
			selector.nodeNameIncludes,
		) &&
		stringSelectorMatches(
			candidate.meshName,
			selector.meshName,
			selector.meshNameIncludes,
		) &&
		materialSelectorMatches(
			candidate.materialNames,
			selector.materialName,
			selector.materialNameIncludes,
		) &&
		extrasSelectorMatches(candidate.extras, selector.extras)
	);
}

function stringSelectorMatches(
	value: string | undefined,
	exact: string | undefined,
	includes: string | undefined,
): boolean {
	if (exact !== undefined && value !== exact) {
		return false;
	}
	if (includes !== undefined && value?.includes(includes) !== true) {
		return false;
	}
	return true;
}

function materialSelectorMatches(
	values: readonly string[],
	exact: string | undefined,
	includes: string | undefined,
): boolean {
	if (exact !== undefined && !values.includes(exact)) {
		return false;
	}
	if (
		includes !== undefined &&
		!values.some((value) => value.includes(includes))
	) {
		return false;
	}
	return true;
}

function extrasSelectorMatches(
	extras: JsonObject | undefined,
	expected: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
	if (expected === undefined) {
		return true;
	}
	if (extras === undefined) {
		return false;
	}
	return Object.entries(expected).every(
		([key, value]) => extras[key] === value,
	);
}

function requireStompboxHardwareProfile(
	options: StompboxHardwareProfileOptions,
): StompboxHardwareProfile {
	if (options.hardwareProfile === undefined) {
		throw new Error(
			"stompbox hardware profile is required; pass options.hardwareProfile from the calling application",
		);
	}
	return options.hardwareProfile;
}

function requireStompboxAssetFileReader(
	options: StompboxAssetFileOptions,
): StompboxAssetFileReader {
	if (options.readAssetFile === undefined) {
		throw new Error(
			"stompbox GLB asset file access requires options.readAssetFile or the @vessel-dsp/stompbox/node export",
		);
	}
	return options.readAssetFile;
}

function resolveStompboxPlacementStyle(
	profile: StompboxStyleProfile | undefined,
	hardwareProfile: StompboxHardwareProfile,
): ResolvedStompboxPlacementStyle {
	return {
		defaultPartIds: {
			...hardwareProfile.defaultPartIds,
			...(profile?.defaultPartIds ?? {}),
		},
		knobGrid: profile?.layout?.knobGrid ?? "large-merged-row",
		sideHardware: profile?.layout?.sideHardware ?? "side-power-five-slot",
		audioJackLabels: profile?.layout?.audioJackLabels ?? "edge-rotated",
		footswitch: profile?.layout?.footswitch ?? "lower-row",
		...(profile?.layout?.statusLedLabel === undefined
			? {}
			: { statusLedLabel: profile.layout.statusLedLabel }),
	};
}

function enclosureProfile(
	enclosureId: string | undefined,
	hardwareProfile: StompboxHardwareProfile,
): StompboxEnclosureProfile {
	const id = enclosureId ?? hardwareProfile.defaultEnclosureId;
	const profile = hardwareProfile.enclosureProfiles[id];
	if (profile === undefined) {
		throw new Error(`unsupported stompbox enclosure: ${id}`);
	}
	return profile;
}

function controlMetadataById(
	panel: Panel,
): ReadonlyMap<string, ControlVisualMetadata> {
	const metadata = new Map<string, ControlVisualMetadata>();
	for (const knob of panel.knobs) {
		metadata.set(knob.id, knobMetadata(knob));
	}
	for (const slider of panel.sliders ?? []) {
		metadata.set(slider.id, sliderMetadata(slider));
	}
	for (const switchControl of panel.switches) {
		metadata.set(switchControl.id, switchMetadata(switchControl));
	}
	for (const led of panel.leds) {
		metadata.set(led.id, ledMetadata(led));
	}
	for (const jack of panel.jacks) {
		metadata.set(jack.id, jackMetadata(jack));
	}
	return metadata;
}

function knobMetadata(knob: Knob): ControlVisualMetadata {
	return {
		id: knob.id,
		kind: "knob",
		label: knob.name,
		defaultPosition: knob.defaultPosition,
	};
}

function sliderMetadata(slider: SliderControl): ControlVisualMetadata {
	return {
		id: slider.id,
		kind: "slider",
		label: slider.name,
		defaultPosition: slider.defaultPosition,
	};
}

function switchMetadata(switchControl: SwitchControl): ControlVisualMetadata {
	return {
		id: switchControl.id,
		kind: "switch",
		label: switchControl.name,
		defaultPosition: switchControl.defaultPosition,
		switchKind: switchControl.switchKind,
		...(switchControl.partNumber === undefined
			? {}
			: { partNumber: switchControl.partNumber }),
	};
}

function ledMetadata(led: LedIndicator): ControlVisualMetadata {
	return {
		id: led.id,
		kind: "led",
		label: led.name,
		...(led.color === undefined ? {} : { color: led.color }),
	};
}

function jackMetadata(jack: JackPort): ControlVisualMetadata {
	return {
		id: jack.id,
		kind: "jack",
		label: jack.name,
		jackRole: jack.role,
	};
}

function declaredPhysicalPlacements(
	faces: readonly PanelFace[],
	controls: ReadonlyMap<string, ControlVisualMetadata>,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
	diagnostics: StompboxDiagnostic[],
): readonly PlacementCandidate[] {
	const candidates: PlacementCandidate[] = [];
	for (const face of faces) {
		for (const element of face.elements) {
			if (element.physical?.centerMm === undefined) {
				continue;
			}
			const controlId = controlIdForPanelElement(element);
			const metadata = controls.get(controlId);
			const requestedPartId =
				element.physical.partProfileId ??
				defaultPartIdForPanelKind(element.kind, metadata, defaultPartIds);
			const partResolution = knownPartIdOrDefault(
				requestedPartId,
				element.kind,
				metadata,
				hardwareProfile,
				defaultPartIds,
				diagnostics,
				controlId,
				element.id,
			);
			if (partResolution === undefined) {
				diagnostics.push({
					code: "unsupported-control",
					message: `Unsupported declared panel element kind "${element.kind}"`,
					controlId,
					...(element.id === undefined ? {} : { placementId: element.id }),
					face: face.id,
				});
				continue;
			}
			const label = element.label ?? metadata?.label;
			candidates.push({
				id: element.id ?? placementIdForKind(element.kind, controlId),
				kind: element.kind,
				face: face.id,
				centerMm: pointFromCorePoint(element.physical.centerMm),
				partId: partResolution.partId,
				...(partResolution.partProvenance === undefined
					? {}
					: { partProvenance: partResolution.partProvenance }),
				componentId: element.bind.componentId,
				controlId,
				...(label === undefined ? {} : { label }),
				...(element.physical.drillDiameterMm === undefined
					? {}
					: { drillDiameterMm: element.physical.drillDiameterMm }),
				...(element.physical.locked === undefined
					? {}
					: { locked: element.physical.locked }),
				...(element.physical.mountId === undefined
					? {}
					: { mountId: element.physical.mountId }),
				...(element.physical.surface === undefined
					? {}
					: { surface: element.physical.surface }),
				provenance:
					partResolution.partProvenance === "defaulted"
						? "auto-generated"
						: "vdsp-declared",
			});
		}
	}
	return candidates;
}

function gridPhysicalPlacements(
	faces: readonly PanelFace[],
	controls: ReadonlyMap<string, ControlVisualMetadata>,
	enclosure: StompboxEnclosureProfile,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
	diagnostics: StompboxDiagnostic[],
): readonly PlacementCandidate[] {
	const candidates: PlacementCandidate[] = [];
	for (const face of faces) {
		for (const element of face.elements) {
			if (element.physical?.centerMm !== undefined) {
				continue;
			}
			const controlId = controlIdForPanelElement(element);
			const metadata = controls.get(controlId);
			const requestedPartId =
				element.physical?.partProfileId ??
				defaultPartIdForPanelKind(element.kind, metadata, defaultPartIds);
			const partResolution = knownPartIdOrDefault(
				requestedPartId,
				element.kind,
				metadata,
				hardwareProfile,
				defaultPartIds,
				diagnostics,
				controlId,
				element.id,
			);
			if (partResolution === undefined) {
				diagnostics.push({
					code: "unsupported-control",
					message: `Unsupported panel grid element kind "${element.kind}"`,
					controlId,
					...(element.id === undefined ? {} : { placementId: element.id }),
					face: face.id,
				});
				continue;
			}
			const label = element.label ?? metadata?.label;
			candidates.push(
				autoCandidate(
					{
						id: element.id ?? placementIdForKind(element.kind, controlId),
						kind: element.kind,
						face: face.id,
						centerMm: panelGridCenterMm(face, element, enclosure),
						partId: partResolution.partId,
						...(partResolution.partProvenance === undefined
							? {}
							: { partProvenance: partResolution.partProvenance }),
						componentId: element.bind.componentId,
						controlId,
						...(label === undefined ? {} : { label }),
						...(element.physical?.drillDiameterMm === undefined
							? {}
							: { drillDiameterMm: element.physical.drillDiameterMm }),
						...(element.physical?.locked === undefined
							? {}
							: { locked: element.physical.locked }),
						...(element.physical?.mountId === undefined
							? {}
							: { mountId: element.physical.mountId }),
						...(element.physical?.surface === undefined
							? {}
							: { surface: element.physical.surface }),
					},
					diagnostics,
				),
			);
		}
	}
	return candidates;
}

function autoPlacementCandidates(
	panel: Panel,
	enclosure: StompboxEnclosureProfile,
	declared: readonly PlacementCandidate[],
	declaredControlIds: ReadonlySet<string>,
	options: StompboxLayoutOptions,
	hardwareProfile: StompboxHardwareProfile,
	placementStyle: ResolvedStompboxPlacementStyle,
	diagnostics: StompboxDiagnostic[],
): readonly PlacementCandidate[] {
	const candidates: PlacementCandidate[] = [];
	const knobs = panel.knobs.filter((knob) => !declaredControlIds.has(knob.id));
	const grid = placementGrid(enclosure);
	const usesTopEdgeLed =
		placementStyle.knobGrid === "compact-led-row" &&
		(knobs.length === 2 || knobs.length === 3 || knobs.length === 4);
	const knobGrid = autoKnobGrid(
		knobs.length,
		grid,
		placementStyle,
		hardwareProfile,
	);
	knobs.forEach((knob, index) => {
		const placement = knobGrid.placements[index];
		if (placement === undefined) {
			return;
		}
		candidates.push(
			autoCandidate(
				{
					id: `knob-${knob.id}`,
					kind: "knob",
					centerMm: placement.centerMm,
					partId: placement.partId,
					componentId: knob.id,
					controlId: knob.id,
					label: knob.name,
				},
				diagnostics,
			),
		);
	});

	const leds = panel.leds.filter((led) => !declaredControlIds.has(led.id));
	const ledY = usesTopEdgeLed
		? topEdgeLedY(grid, hardwareProfile, placementStyle.defaultPartIds)
		: lowerTopLedY(knobs.length, grid);
	const ledPositions = distributedTopRowPositions(leds.length, ledY, 16);
	leds.forEach((led, index) => {
		const position = ledPositions[index];
		if (position === undefined) {
			return;
		}
		candidates.push(
			autoCandidate(
				{
					id: `led-${led.id}`,
					kind: "led",
					centerMm: position,
					partId: placementStyle.defaultPartIds.led,
					componentId: led.id,
					controlId: led.id,
					label: led.name,
				},
				diagnostics,
			),
		);
	});

	if (!hasStatusLed(panel, declared)) {
		candidates.push(
			autoCandidate(
				{
					id: "led-status",
					kind: "led",
					centerMm: { x: 0, y: ledY },
					partId: placementStyle.defaultPartIds.led,
					label: "Status",
				},
				diagnostics,
			),
		);
	}

	const switches = panel.switches.filter(
		(switchControl) => !declaredControlIds.has(switchControl.id),
	);
	const footswitchY = footswitchGridY(knobs.length, grid, placementStyle);
	switches.forEach((switchControl, index) => {
		if (!isSupportedFootswitch(switchControl)) {
			diagnostics.push({
				code: "unsupported-control",
				message: `Switch "${switchControl.id}" is not a supported stompbox footswitch`,
				controlId: switchControl.id,
			});
			return;
		}
		candidates.push(
			autoCandidate(
				{
					id: `switch-${switchControl.id}`,
					kind: "footswitch",
					centerMm: { x: index * 18, y: footswitchY },
					partId: placementStyle.defaultPartIds.footswitch,
					componentId: switchControl.id,
					controlId: switchControl.id,
				},
				diagnostics,
			),
		);
	});

	if (!hasBypassFootswitch(panel, declared)) {
		candidates.push(
			autoCandidate(
				{
					id: "switch-bypass",
					kind: "footswitch",
					centerMm: { x: 0, y: footswitchY },
					partId: placementStyle.defaultPartIds.footswitch,
				},
				diagnostics,
			),
		);
	}

	for (const slider of panel.sliders ?? []) {
		if (!declaredControlIds.has(slider.id)) {
			diagnostics.push({
				code: "unsupported-control",
				message: `Slider "${slider.id}" has no v1 stompbox stub part`,
				controlId: slider.id,
			});
		}
	}

	const jackCountsByFace = new Map<StompboxFaceId, number>();
	for (const jack of panel.jacks) {
		if (declaredControlIds.has(jack.id)) {
			continue;
		}
		const face = faceForJack(jack);
		if (face === undefined) {
			diagnostics.push({
				code: "unsupported-control",
				message: `Jack "${jack.id}" has unsupported role "${jack.role}"`,
				controlId: jack.id,
			});
			continue;
		}
		const faceIndex = jackCountsByFace.get(face) ?? 0;
		jackCountsByFace.set(face, faceIndex + 1);
		candidates.push(
			autoCandidate(
				{
					id: `jack-${jack.id}`,
					kind: "jack",
					face,
					centerMm: centerForJackFace(
						face,
						enclosure,
						grid,
						placementStyle,
						faceIndex,
					),
					partId: placementStyle.defaultPartIds.audioJack,
					componentId: jack.sourceComponentId ?? jack.id,
					controlId: jack.id,
					label: jack.name,
				},
				diagnostics,
			),
		);
	}

	if (!hasInputJack(panel, declared)) {
		candidates.push(
			autoCandidate(
				{
					id: "jack-input",
					kind: "jack",
					face: "right",
					centerMm: centerForJackFace(
						"right",
						enclosure,
						grid,
						placementStyle,
						jackCountsByFace.get("right") ?? 0,
					),
					partId: placementStyle.defaultPartIds.audioJack,
					label: "Input",
				},
				diagnostics,
			),
		);
		jackCountsByFace.set("right", (jackCountsByFace.get("right") ?? 0) + 1);
	}

	if (!hasOutputJack(panel, declared)) {
		candidates.push(
			autoCandidate(
				{
					id: "jack-output",
					kind: "jack",
					face: "left",
					centerMm: centerForJackFace(
						"left",
						enclosure,
						grid,
						placementStyle,
						jackCountsByFace.get("left") ?? 0,
					),
					partId: placementStyle.defaultPartIds.audioJack,
					label: "Output",
				},
				diagnostics,
			),
		);
		jackCountsByFace.set("left", (jackCountsByFace.get("left") ?? 0) + 1);
	}

	if (
		options.includePowerJack !== false &&
		!hasPowerJack(declared, candidates, placementStyle.defaultPartIds)
	) {
		const powerFace = powerJackFace(placementStyle);
		candidates.push(
			autoCandidate(
				{
					id: "power-9v",
					kind: "jack",
					face: powerFace,
					centerMm: centerForPowerJackFace(
						powerFace,
						enclosure,
						grid,
						placementStyle,
						hardwareProfile,
					),
					partId: placementStyle.defaultPartIds.dcJack,
					label: "9V DC",
				},
				diagnostics,
			),
		);
	}

	return candidates;
}

function autoCandidate(
	candidate: Omit<PlacementCandidate, "face" | "provenance"> &
		Readonly<{ face?: StompboxFaceId }>,
	diagnostics: StompboxDiagnostic[],
): PlacementCandidate {
	diagnostics.push({
		code: "placement-auto-generated",
		message: `Auto-generated stompbox placement for "${candidate.id}"`,
		...(candidate.controlId === undefined
			? {}
			: { controlId: candidate.controlId }),
		placementId: candidate.id,
		face: candidate.face ?? "top",
	});
	return {
		...candidate,
		face: candidate.face ?? "top",
		provenance: "auto-generated",
	};
}

/**
 * Collapses placement candidates that share a `mountId` onto a multi-surface
 * part into a single base candidate carrying the upper dials as
 * `concentricDials`. One mount becomes one drill hole with N stacked dials,
 * ordered by the part profile's `surfaces`. Candidates without a `mountId`, or
 * whose part declares no `surfaces`, pass through unchanged (one hole each).
 */
function collapseConcentricMounts(
	candidates: readonly PlacementCandidate[],
	hardwareProfile: StompboxHardwareProfile,
	diagnostics: StompboxDiagnostic[],
): readonly PlacementCandidate[] {
	const result: PlacementCandidate[] = [];
	const groups = new Map<string, PlacementCandidate[]>();
	for (const candidate of candidates) {
		if (candidate.mountId === undefined) {
			result.push(candidate);
			continue;
		}
		const members = groups.get(candidate.mountId) ?? [];
		members.push(candidate);
		groups.set(candidate.mountId, members);
	}

	for (const [mountId, members] of groups) {
		const part = hardwareProfile.partProfiles[members[0]?.partId ?? ""];
		const surfaces = part?.surfaces;
		if (part === undefined || surfaces === undefined || surfaces.length === 0) {
			// Not a multi-surface part: keep each member as its own hole.
			result.push(...members);
			continue;
		}

		const memberBySurface = new Map<string, PlacementCandidate>();
		for (const member of members) {
			if (member.surface === undefined) {
				result.push(member);
				continue;
			}
			if (!surfaces.some((surface) => surface.id === member.surface)) {
				diagnostics.push({
					code: "unknown-part-surface",
					message: `Mount "${mountId}" references surface "${member.surface}" not declared by part "${part.id}"`,
					...(member.controlId === undefined
						? {}
						: { controlId: member.controlId }),
					placementId: member.id,
					face: member.face,
				});
				result.push(member);
				continue;
			}
			memberBySurface.set(member.surface, member);
		}

		const missing = surfaces.filter(
			(surface) => !memberBySurface.has(surface.id),
		);
		if (missing.length > 0) {
			diagnostics.push({
				code: "concentric-mount-incomplete",
				message: `Concentric mount "${mountId}" (part "${part.id}") is missing surface(s): ${missing.map((surface) => surface.id).join(", ")}`,
				placementId: members[0]?.id ?? mountId,
				face: members[0]?.face ?? "top",
			});
		}

		const ordered: Array<{
			surface: StompboxPartSurface;
			member: PlacementCandidate;
		}> = [];
		for (const surface of surfaces) {
			const member = memberBySurface.get(surface.id);
			if (member !== undefined) {
				ordered.push({ surface, member });
			}
		}
		const base = ordered[0];
		if (base === undefined) {
			continue;
		}
		const upperDials: StompboxConcentricDial[] = ordered
			.slice(1)
			.map(({ surface, member }) => ({
				surface: surface.id,
				partGeometry: surface.geometry,
				stackOffsetMm: surface.stackOffsetMm,
				...(member.controlId === undefined
					? {}
					: { controlId: member.controlId }),
				...(member.componentId === undefined
					? {}
					: { componentId: member.componentId }),
				...(member.label === undefined ? {} : { label: member.label }),
			}));
		result.push({ ...base.member, concentricDials: upperDials });
	}

	return result;
}

function drillHoleForCandidate(
	candidate: PlacementCandidate,
	hardwareProfile: StompboxHardwareProfile,
	diagnostics: StompboxDiagnostic[],
): readonly StompboxDrillHole[] {
	const part = hardwareProfile.partProfiles[candidate.partId];
	if (part === undefined) {
		diagnostics.push({
			code: "unknown-part-profile",
			message: `Unknown stompbox part profile "${candidate.partId}"`,
			...(candidate.controlId === undefined
				? {}
				: { controlId: candidate.controlId }),
			placementId: candidate.id,
			face: candidate.face,
		});
		return [];
	}
	return [
		{
			id: candidate.id,
			face: candidate.face,
			centerMm: candidate.centerMm,
			drillDiameterMm: candidate.drillDiameterMm ?? part.panelHoleDrillMm,
			...(part.drillHoleProfileId === undefined
				? {}
				: { drillHoleProfileId: part.drillHoleProfileId }),
			partId: part.id,
			partLabel: part.label,
			partFamily: part.family,
			partGeometry: part.geometry,
			...(candidate.partProvenance === undefined
				? {}
				: { partProvenance: candidate.partProvenance }),
			...(part.assetScale === undefined ? {} : { assetScale: part.assetScale }),
			...(candidate.controlId === undefined
				? {}
				: { controlId: candidate.controlId }),
			...(candidate.componentId === undefined
				? {}
				: { componentId: candidate.componentId }),
			...(candidate.label === undefined ? {} : { label: candidate.label }),
			provenance: candidate.provenance,
			...(candidate.locked === undefined ? {} : { locked: candidate.locked }),
			assets: part.assets,
			...(part.stateTargets === undefined
				? {}
				: { stateTargets: part.stateTargets }),
			...(candidate.concentricDials === undefined ||
			candidate.concentricDials.length === 0
				? {}
				: { concentricDials: candidate.concentricDials }),
		},
	];
}

function validateHolePlacements(
	holes: readonly StompboxDrillHole[],
	enclosure: StompboxEnclosureProfile,
	minPartClearanceMm = 0,
): readonly StompboxDiagnostic[] {
	const diagnostics: StompboxDiagnostic[] = [];
	const requiredClearanceMm = Math.max(0, minPartClearanceMm);
	for (const hole of holes) {
		if (isOutOfBounds(hole, enclosure)) {
			diagnostics.push({
				code: "placement-out-of-bounds",
				message: `Hole "${hole.id}" is outside the ${hole.face} face bounds`,
				...(hole.controlId === undefined ? {} : { controlId: hole.controlId }),
				placementId: hole.id,
				face: hole.face,
			});
		}
	}
	for (let i = 0; i < holes.length; i += 1) {
		const first = holes[i];
		if (first === undefined) {
			continue;
		}
		for (let j = i + 1; j < holes.length; j += 1) {
			const second = holes[j];
			if (second === undefined || first.face !== second.face) {
				continue;
			}
			const distance = Math.hypot(
				first.centerMm.x - second.centerMm.x,
				first.centerMm.y - second.centerMm.y,
			);
			const requiredDistance =
				placementCollisionRadiusMm(first) + placementCollisionRadiusMm(second);
			const clearanceMm = distance - requiredDistance;
			if (clearanceMm < 0) {
				diagnostics.push({
					code: "placement-collision",
					message: `Placements "${first.id}" and "${second.id}" overlap on ${first.face}`,
					placementId: first.id,
					face: first.face,
				});
				continue;
			}
			if (clearanceMm < requiredClearanceMm) {
				diagnostics.push({
					code: "placement-clearance",
					message: `Placements "${first.id}" and "${second.id}" have ${formatMm(clearanceMm)} mm clearance on ${first.face}, below required ${formatMm(requiredClearanceMm)} mm`,
					placementId: first.id,
					face: first.face,
				});
			}
		}
	}
	return diagnostics;
}

function formatMm(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function placementCollisionRadiusMm(hole: StompboxDrillHole): number {
	if (
		(hole.face === "left" || hole.face === "right") &&
		hole.partFamily === "audio-jack"
	) {
		return hole.drillDiameterMm / 2;
	}
	return (
		(partGeometryVisibleDiameterMm(hole.partGeometry) ?? hole.drillDiameterMm) /
		2
	);
}

function partGeometryVisibleDiameterMm(
	geometry: StompboxPartGeometry,
): number | undefined {
	if (geometry.kind === "knob") {
		return geometry.diameterMm;
	}
	if (geometry.kind === "footswitch") {
		return geometry.nutOuterDiameterMm;
	}
	if (geometry.kind === "led") {
		return geometry.flangeDiameterMm;
	}
	if (geometry.kind === "led-bezel" || geometry.kind === "ring") {
		return geometry.outerDiameterMm;
	}
	return undefined;
}

function partProfileVisibleDiameterMm(
	hardwareProfile: StompboxHardwareProfile,
	partId: string,
): number | undefined {
	const geometry = hardwareProfile.partProfiles[partId]?.geometry;
	return geometry === undefined
		? undefined
		: partGeometryVisibleDiameterMm(geometry);
}

function defaultPartVisibleDiameterMm(
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
	key: keyof StompboxDefaultPartProfileIds,
	fallbackMm: number,
): number {
	return (
		partProfileVisibleDiameterMm(hardwareProfile, defaultPartIds[key]) ??
		fallbackMm
	);
}

function isOutOfBounds(
	hole: StompboxDrillHole,
	enclosure: StompboxEnclosureProfile,
): boolean {
	const radius = placementCollisionRadiusMm(hole);
	if (hole.face === "top") {
		return (
			Math.abs(hole.centerMm.x) + radius > enclosure.dimensionsMm.widthMm / 2 ||
			Math.abs(hole.centerMm.y) + radius > enclosure.dimensionsMm.lengthMm / 2
		);
	}
	if (hole.face === "left" || hole.face === "right") {
		return (
			Math.abs(hole.centerMm.y) + radius > enclosure.dimensionsMm.lengthMm / 2
		);
	}
	if (hole.face === "back") {
		return (
			Math.abs(hole.centerMm.x) + radius > enclosure.dimensionsMm.widthMm / 2 ||
			Math.abs(hole.centerMm.y) + radius > enclosure.dimensionsMm.depthMm / 2
		);
	}
	return false;
}

/**
 * Builds a synthetic drill hole for one upper dial of a concentric mount so it
 * can be rendered as its own preview part. It reuses the base hole's position
 * but carries the dial's geometry and control; the caller applies the dial's
 * `stackOffsetMm` to lift it above the base dial.
 */
function concentricDialHole(
	hole: StompboxDrillHole,
	dial: StompboxConcentricDial,
): StompboxDrillHole {
	return {
		id: `${hole.id}-${dial.surface}`,
		face: hole.face,
		centerMm: hole.centerMm,
		drillDiameterMm: hole.drillDiameterMm,
		...(hole.drillHoleProfileId === undefined
			? {}
			: { drillHoleProfileId: hole.drillHoleProfileId }),
		partId: hole.partId,
		partLabel: hole.partLabel,
		partFamily: hole.partFamily,
		partGeometry: dial.partGeometry,
		...(hole.partProvenance === undefined
			? {}
			: { partProvenance: hole.partProvenance }),
		...(hole.assetScale === undefined ? {} : { assetScale: hole.assetScale }),
		...(dial.controlId === undefined ? {} : { controlId: dial.controlId }),
		...(dial.componentId === undefined
			? {}
			: { componentId: dial.componentId }),
		...(dial.label === undefined ? {} : { label: dial.label }),
		provenance: hole.provenance,
		...(hole.locked === undefined ? {} : { locked: hole.locked }),
		assets: hole.assets,
		...(hole.stateTargets === undefined
			? {}
			: { stateTargets: hole.stateTargets }),
	};
}

function previewPartForHole(
	hole: StompboxDrillHole,
	enclosure: StompboxEnclosureProfile,
	metadata: ControlVisualMetadata | undefined,
	state: ControlState | undefined,
	assetOptions: StompboxAssetResolveOptions,
	appearance: StompboxAppearance | undefined,
	enabled: boolean | undefined,
): StompboxPreviewPart {
	const rotation = baseRotationForFace(hole.face);
	const stateValue = stateValueForHole(hole, state, enabled);
	const knobPosition =
		stateValue?.kind === "knob"
			? stateValue.position
			: metadata?.defaultPosition;
	const zOffset = pressedOffsetMm(hole.partGeometry, stateValue);
	const material = materialForPart(hole, metadata, stateValue, appearance);
	const transform = {
		translationMm: {
			...translationForFace(hole.face, hole.centerMm, enclosure),
			z: translationForFace(hole.face, hole.centerMm, enclosure).z + zOffset,
		},
		rotationDeg: {
			...rotation,
			z:
				hole.partGeometry.kind === "knob"
					? knobRotationDegForPosition(knobPosition ?? 0.5)
					: rotation.z,
		},
	};
	return {
		id: hole.id,
		partId: hole.partId,
		family: hole.partFamily,
		geometry: hole.partGeometry,
		...(hole.partProvenance === undefined
			? {}
			: { partProvenance: hole.partProvenance }),
		...(hole.assetScale === undefined ? {} : { assetScale: hole.assetScale }),
		...(hole.controlId === undefined ? {} : { controlId: hole.controlId }),
		face: hole.face,
		provenance: hole.provenance,
		assets: resolveStompboxAssetPaths(hole.assets, assetOptions),
		...(hole.stateTargets === undefined
			? {}
			: { stateTargets: hole.stateTargets }),
		transform,
		...(material === undefined ? {} : { material }),
	};
}

function normalizeDecals(
	decals: readonly StompboxDecalInput[] | undefined,
	enclosure: StompboxEnclosureProfile,
): readonly StompboxPreviewDecal[] {
	return decals?.map((decal) => normalizeDecal(decal, enclosure)) ?? [];
}

function controlLabelDecals(
	layout: StompboxDrillLayout,
	placementStyle: ResolvedStompboxPlacementStyle,
	appearance: StompboxAppearance | undefined,
): readonly StompboxPreviewDecal[] {
	return layout.holes.flatMap((hole) => {
		const label = controlLabelDecal(
			hole,
			layout.enclosure,
			placementStyle,
			appearance,
		);
		return label === undefined ? [] : [label];
	});
}

function controlLabelDecal(
	hole: StompboxDrillHole,
	enclosure: StompboxEnclosureProfile,
	placementStyle: ResolvedStompboxPlacementStyle,
	appearance: StompboxAppearance | undefined,
): StompboxPreviewDecal | undefined {
	if (hole.partFamily === "footswitch") {
		return undefined;
	}
	const labelId = `label-${decalIdSegment(hole.id)}`;
	const labelAppearance = labelAppearanceFor(
		labelId,
		hole.controlId,
		appearance,
	);
	const text = labelAppearance?.text ?? controlLabelText(hole, placementStyle);
	if (text.length === 0) {
		return undefined;
	}
	const fontSizeMm =
		labelAppearance?.fontSizeMm ?? controlLabelFontSizeMm(hole.partFamily);
	const sizeMm = controlLabelSizeMm(text, fontSizeMm);
	const placement = controlLabelPlacement(
		hole,
		enclosure,
		placementStyle,
		sizeMm,
	);
	return {
		id: labelId,
		kind: "text",
		text,
		face: placement.face,
		centerMm: placement.centerMm,
		sizeMm,
		rotationDeg: placement.rotationDeg,
		color: labelAppearance?.color ?? "#111827",
		fontFamily: labelAppearance?.fontFamily ?? "Arial,sans-serif",
		fontSizeMm,
	};
}

function controlLabelPlacement(
	hole: StompboxDrillHole,
	enclosure: StompboxEnclosureProfile,
	placementStyle: ResolvedStompboxPlacementStyle,
	sizeMm: StompboxSize2,
): Readonly<{
	face: StompboxFaceId;
	centerMm: StompboxPoint2;
	rotationDeg: number;
}> {
	if (
		hole.partFamily === "audio-jack" &&
		(hole.face === "left" || hole.face === "right")
	) {
		const edgeSign = hole.face === "right" ? 1 : -1;
		const insetMm =
			placementStyle.audioJackLabels === "inline"
				? 10
				: STOMPBOX_EDGE_ROTATED_SIDE_LABEL_GAP_MM + sizeMm.heightMm / 2;
		const labelBoundsMm =
			placementStyle.audioJackLabels === "inline"
				? sizeMm
				: { widthMm: sizeMm.heightMm, heightMm: sizeMm.widthMm };
		return {
			face: "top",
			centerMm: clampTopLabelCenter(
				{
					x: edgeSign * (enclosure.dimensionsMm.widthMm / 2 - insetMm),
					y: hole.centerMm.y,
				},
				enclosure,
				labelBoundsMm,
			),
			rotationDeg:
				placementStyle.audioJackLabels === "inline"
					? 0
					: hole.face === "right"
						? 90
						: -90,
		};
	}

	const visibleRadiusMm =
		(partGeometryVisibleDiameterMm(hole.partGeometry) ?? hole.drillDiameterMm) /
		2;
	const gapMm = hole.partFamily === "led" ? 3 : 4;
	const labelY =
		hole.partFamily === "led"
			? hole.centerMm.y + visibleRadiusMm + gapMm
			: hole.centerMm.y - visibleRadiusMm - gapMm;
	return {
		face: hole.face,
		centerMm:
			hole.face === "top"
				? clampTopLabelCenter(
						{ x: hole.centerMm.x, y: labelY },
						enclosure,
						sizeMm,
					)
				: { x: hole.centerMm.x, y: labelY },
		rotationDeg: 0,
	};
}

function controlLabelFontSizeMm(family: StompboxPartProfile["family"]): number {
	if (family === "knob") {
		return 3.2;
	}
	if (family === "audio-jack") {
		return 3;
	}
	return 2.6;
}

function controlLabelSizeMm(text: string, fontSizeMm: number): StompboxSize2 {
	return {
		widthMm: roundMillimeters(Math.max(8, text.length * fontSizeMm * 0.72)),
		heightMm: roundMillimeters(fontSizeMm + 1.6),
	};
}

function controlLabelText(
	hole: StompboxDrillHole,
	placementStyle: ResolvedStompboxPlacementStyle,
): string {
	const text = formatControlLabel(hole.label ?? hole.controlId ?? hole.id);
	if (
		hole.partFamily === "led" &&
		placementStyle.statusLedLabel !== undefined &&
		text === "STATUS"
	) {
		return placementStyle.statusLedLabel;
	}
	if (hole.partFamily !== "audio-jack") {
		return text;
	}
	if (text === "IN") {
		return "INPUT";
	}
	if (text === "OUT") {
		return "OUTPUT";
	}
	if (/\bINPUT\b/.test(text) || /\bOUTPUT\b/.test(text)) {
		return text;
	}
	if (hole.face === "right") {
		return "INPUT";
	}
	if (hole.face === "left") {
		return "OUTPUT";
	}
	return text;
}

function clampTopLabelCenter(
	centerMm: StompboxPoint2,
	enclosure: StompboxEnclosureProfile,
	sizeMm: StompboxSize2,
): StompboxPoint2 {
	const marginMm = 1;
	const halfWidth = sizeMm.widthMm / 2;
	const halfHeight = sizeMm.heightMm / 2;
	return {
		x: roundMillimeters(
			clamp(
				centerMm.x,
				-enclosure.dimensionsMm.widthMm / 2 + marginMm + halfWidth,
				enclosure.dimensionsMm.widthMm / 2 - marginMm - halfWidth,
			),
		),
		y: roundMillimeters(
			clamp(
				centerMm.y,
				-enclosure.dimensionsMm.lengthMm / 2 + marginMm + halfHeight,
				enclosure.dimensionsMm.lengthMm / 2 - marginMm - halfHeight,
			),
		),
	};
}

function formatControlLabel(value: string): string {
	return value.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ").toUpperCase();
}

function decalIdSegment(value: string): string {
	return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-") || "control";
}

function normalizeDecal(
	decal: StompboxDecalInput,
	enclosure: StompboxEnclosureProfile,
): StompboxPreviewDecal {
	const face = decal.face ?? "top";
	const sizeMm = decal.sizeMm ?? defaultDecalSize(decal.kind);
	const faceSize = decalFaceSize(face, enclosure);
	const placement =
		decal.placement === undefined
			? undefined
			: normalizeDecalPlacement(decal.placement, faceSize);
	const common = {
		id: decal.id,
		face,
		centerMm: decalCenterMm(decal.centerMm, placement, face, enclosure),
		...(placement === undefined ? {} : { placement }),
		sizeMm,
		rotationDeg: decal.rotationDeg ?? 0,
	};
	if (decal.kind === "text") {
		return {
			...common,
			kind: "text",
			text: decal.text,
			color: decal.color ?? "#111827",
			fontFamily: decal.fontFamily ?? "Arial,sans-serif",
			fontSizeMm: roundMillimeters(decal.fontSizeMm ?? sizeMm.heightMm * 0.65),
		};
	}
	if (decal.kind === "image") {
		return {
			...common,
			kind: "image",
			href: decal.href,
			...(decal.mimeType === undefined ? {} : { mimeType: decal.mimeType }),
			...(decal.color === undefined ? {} : { color: decal.color }),
		};
	}
	return {
		...common,
		kind: "svg",
		svg: decal.svg,
		...(decal.color === undefined ? {} : { color: decal.color }),
	};
}

function defaultDecalSize(kind: StompboxDecalInput["kind"]): StompboxSize2 {
	if (kind === "text") {
		return { widthMm: 36, heightMm: 8 };
	}
	return { widthMm: 24, heightMm: 16 };
}

function normalizeDecalPlacement(
	placement: StompboxDecalPlacement,
	faceSize: StompboxSize2,
): StompboxDecalPlacement {
	if (placement.kind === "grid") {
		const columns = gridAxisCellCount(placement.columns, faceSize.widthMm);
		const rows = gridAxisCellCount(placement.rows, faceSize.heightMm);
		return {
			kind: "grid",
			columns,
			rows,
			column: clampGridInteger(placement.column, columns),
			row: clampGridInteger(placement.row, rows),
		};
	}
	return placement;
}

function positiveGridInteger(value: number): number {
	return Math.max(1, Math.trunc(Number.isFinite(value) ? value : 1));
}

function clampGridInteger(value: number, max: number): number {
	return Math.min(Math.max(positiveGridInteger(value), 1), Math.max(1, max));
}

function decalCenterMm(
	centerMm: StompboxPoint2 | undefined,
	placement: StompboxDecalPlacement | undefined,
	face: StompboxFaceId,
	enclosure: StompboxEnclosureProfile,
): StompboxPoint2 {
	if (placement?.kind === "grid") {
		return decalGridCenterMm(placement, decalFaceSize(face, enclosure));
	}
	return centerMm ?? { x: 0, y: 0 };
}

function decalGridCenterMm(
	placement: StompboxDecalGridPlacement,
	faceSize: StompboxSize2,
): StompboxPoint2 {
	const columns = gridAxisCellCount(placement.columns, faceSize.widthMm);
	const rows = gridAxisCellCount(placement.rows, faceSize.heightMm);
	const column = clampGridInteger(placement.column, columns);
	const row = clampGridInteger(placement.row, rows);
	return {
		x: roundMillimeters(
			-faceSize.widthMm / 2 + faceSize.widthMm * ((column - 0.5) / columns),
		),
		y: roundMillimeters(
			faceSize.heightMm / 2 - faceSize.heightMm * ((row - 0.5) / rows),
		),
	};
}

function decalFaceSize(
	face: StompboxFaceId,
	enclosure: StompboxEnclosureProfile,
): StompboxSize2 {
	const { widthMm, lengthMm, depthMm } = enclosure.dimensionsMm;
	if (face === "left" || face === "right") {
		return { widthMm: depthMm, heightMm: lengthMm };
	}
	if (face === "back" || face === "bottom") {
		return { widthMm, heightMm: depthMm };
	}
	return { widthMm, heightMm: lengthMm };
}

function panelGridCenterMm(
	face: PanelFace,
	element: PanelElementPlacement,
	enclosure: StompboxEnclosureProfile,
): StompboxPoint2 {
	const rect = panelGridRectMm(face, enclosure);
	const columns = gridAxisCellCount(face.layout.columns, rect.widthMm);
	const rows = gridAxisCellCount(face.layout.rows, rect.heightMm);
	const column = panelGridAxisCenterIndex(
		element.grid.column,
		element.grid.columnSpan,
		columns,
		face.layout.indexing,
		face.layout.columnOrder === "right-to-left",
	);
	const row = panelGridAxisCenterIndex(
		element.grid.row,
		element.grid.rowSpan,
		rows,
		face.layout.indexing,
		face.layout.rowOrder === "bottom-to-top",
	);
	const local = {
		x: roundMillimeters(rect.x + rect.widthMm * ((column - 0.5) / columns)),
		y: roundMillimeters(rect.y + rect.heightMm * (1 - (row - 0.5) / rows)),
	};
	if (face.id === "right") {
		return { x: enclosure.dimensionsMm.widthMm / 2, y: local.y };
	}
	if (face.id === "left") {
		return { x: -enclosure.dimensionsMm.widthMm / 2, y: local.y };
	}
	return local;
}

function panelGridRectMm(
	face: PanelFace,
	enclosure: StompboxEnclosureProfile,
): Readonly<{
	x: number;
	y: number;
	widthMm: number;
	heightMm: number;
}> {
	const rect = face.geometry?.usableRectMm;
	if (
		rect !== undefined &&
		(face.geometry?.units === undefined || face.geometry.units === "mm") &&
		Number.isFinite(rect.x) &&
		Number.isFinite(rect.y) &&
		Number.isFinite(rect.width) &&
		Number.isFinite(rect.height) &&
		rect.width > 0 &&
		rect.height > 0
	) {
		return {
			x: rect.x,
			y: rect.y,
			widthMm: rect.width,
			heightMm: rect.height,
		};
	}
	const size = decalFaceSize(face.id, enclosure);
	return {
		x: -size.widthMm / 2,
		y: -size.heightMm / 2,
		widthMm: size.widthMm,
		heightMm: size.heightMm,
	};
}

function panelGridAxisCenterIndex(
	value: number,
	span: number | undefined,
	count: number,
	indexing: PanelFace["layout"]["indexing"],
	reverse: boolean,
): number {
	const start = clampGridInteger(
		indexing === "zero-based" ? value + 1 : value,
		count,
	);
	const end = clampGridInteger(
		start + positiveGridInteger(span ?? 1) - 1,
		count,
	);
	const center = (start + end) / 2;
	return reverse ? count - center + 1 : center;
}

function gridAxisCellCount(requested: number, sizeMm: number): number {
	const maximum = Math.max(
		1,
		Math.floor(Math.max(0, sizeMm) / STOMPBOX_GRID_MIN_CELL_MM),
	);
	return Math.min(positiveGridInteger(requested), maximum);
}

function materialForPart(
	hole: StompboxDrillHole,
	metadata: ControlVisualMetadata | undefined,
	stateValue: ControlState[string] | undefined,
	appearance: StompboxAppearance | undefined,
): StompboxPreviewMaterial | undefined {
	const appearanceMaterial = partAppearanceFor(hole, appearance);
	if (hole.partFamily !== "led") {
		return appearanceMaterial;
	}
	const color = appearanceMaterial?.color ?? metadata?.color ?? "red";
	if (stateValue?.kind === "led" && stateValue.on) {
		return materialWithValues({
			...appearanceMaterial,
			color,
			emissive: true,
			intensity: stateValue.intensity ?? 1,
		});
	}
	return materialWithValues({
		...appearanceMaterial,
		color,
		emissive: false,
		intensity: 0,
	});
}

function partAppearanceFor(
	hole: StompboxDrillHole,
	appearance: StompboxAppearance | undefined,
): StompboxPreviewMaterial | undefined {
	if (appearance === undefined || hole.partFamily === "knob") {
		return undefined;
	}
	const key = partAppearanceKey(hole.partFamily);
	if (key === undefined) {
		return undefined;
	}
	const controlAppearance =
		hole.controlId === undefined
			? undefined
			: appearance.controls?.[hole.controlId]?.[key];
	return mergeMaterials(
		appearance.defaults?.[key],
		controlAppearance,
		appearance.parts?.[hole.id],
		appearance.parts?.[`part-${hole.id}`],
	);
}

function previewPartAppearanceFor(
	part: StompboxPreviewPart,
	appearance: StompboxAppearance | undefined,
): StompboxPreviewMaterial | undefined {
	if (appearance === undefined || part.family === "knob") {
		return undefined;
	}
	const key = partAppearanceKey(part.family);
	if (key === undefined) {
		return undefined;
	}
	const controlAppearance =
		part.controlId === undefined
			? undefined
			: appearance.controls?.[part.controlId]?.[key];
	return mergeMaterials(
		appearance.defaults?.[key],
		controlAppearance,
		appearance.parts?.[part.id],
		appearance.parts?.[`part-${part.id}`],
	);
}

function partAppearanceKey(
	family: StompboxPartProfile["family"],
): "led" | "footswitch" | "audioJack" | "dcJack" | undefined {
	if (family === "knob") {
		return undefined;
	}
	if (family === "audio-jack") {
		return "audioJack";
	}
	if (family === "dc-jack") {
		return "dcJack";
	}
	return family;
}

function labelAppearanceFor(
	labelId: string,
	controlId: string | undefined,
	appearance: StompboxAppearance | undefined,
): StompboxLabelAppearance | undefined {
	if (appearance === undefined) {
		return undefined;
	}
	const controlAppearance =
		controlId === undefined
			? undefined
			: appearance.controls?.[controlId]?.label;
	return mergeLabelAppearances(
		appearance.defaults?.label,
		controlAppearance,
		appearance.labels?.[labelId],
		appearance.labels?.[`decal-${labelId}`],
	);
}

function decalAppearanceFor(
	decal: StompboxPreviewDecal,
	appearance: StompboxAppearance | undefined,
): StompboxLabelAppearance | undefined {
	if (appearance === undefined || decal.kind !== "text") {
		return undefined;
	}
	return mergeLabelAppearances(
		appearance.defaults?.label,
		appearance.labels?.[decal.id],
		appearance.labels?.[`decal-${decal.id}`],
	);
}

function mergeMaterials(
	...materials: readonly (StompboxPreviewMaterial | undefined)[]
): StompboxPreviewMaterial | undefined {
	const merged: Record<string, string | number | boolean> = {};
	for (const material of materials) {
		if (material === undefined) {
			continue;
		}
		for (const [key, value] of Object.entries(material)) {
			if (value !== undefined) {
				merged[key] = value;
			}
		}
	}
	return Object.keys(merged).length === 0 ? undefined : merged;
}

function materialWithValues(
	material: StompboxPreviewMaterial | undefined,
): StompboxPreviewMaterial | undefined {
	return mergeMaterials(material);
}

function mergeLabelAppearances(
	...appearances: readonly (StompboxLabelAppearance | undefined)[]
): StompboxLabelAppearance | undefined {
	const merged: Record<string, string | number> = {};
	for (const appearance of appearances) {
		if (appearance === undefined) {
			continue;
		}
		for (const [key, value] of Object.entries(appearance)) {
			if (value !== undefined) {
				merged[key] = value;
			}
		}
	}
	return Object.keys(merged).length === 0 ? undefined : merged;
}

function pressedOffsetMm(
	geometry: StompboxPartGeometry,
	stateValue: ControlState[string] | undefined,
): number {
	if (
		geometry.kind !== "footswitch" ||
		stateValue?.kind !== "switch" ||
		stateValue.position <= 0
	) {
		return 0;
	}
	return -geometry.pressedTravelMm;
}

function translationForFace(
	face: StompboxFaceId,
	centerMm: StompboxPoint2,
	enclosure: Readonly<{
		dimensionsMm: StompboxEnclosureProfile["dimensionsMm"];
	}>,
): StompboxPoint3 {
	if (face === "top") {
		return {
			x: centerMm.x,
			y: centerMm.y,
			z: enclosure.dimensionsMm.depthMm / 2,
		};
	}
	if (face === "back") {
		return {
			x: centerMm.x,
			y: enclosure.dimensionsMm.lengthMm / 2,
			z: centerMm.y,
		};
	}
	return { x: centerMm.x, y: centerMm.y, z: 0 };
}

function baseRotationForFace(face: StompboxFaceId): StompboxRotationDeg {
	if (face === "right") {
		return { x: 0, y: 90, z: 0 };
	}
	if (face === "left") {
		return { x: 0, y: -90, z: 0 };
	}
	if (face === "back") {
		return { x: -90, y: 0, z: 0 };
	}
	if (face === "bottom") {
		return { x: 90, y: 0, z: 0 };
	}
	return { x: 0, y: 0, z: 0 };
}

type SvgAttributeValue = string | number | boolean | undefined;

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };
type MutableJsonObject = { [key: string]: JsonValue };

type GltfSourceAsset = Readonly<{
	id: string;
	kind: "enclosure" | "part";
	glb: string;
	step: string;
}>;

type GltfAssemblySource = Readonly<{
	id: string;
	kind: "enclosure" | "part";
	displayGlb: string;
	displayStep: string;
	localGlbPath: string;
	readAssetFile: StompboxAssetFileReader;
	material?: StompboxPreviewMaterial;
	materialTargets?: readonly GltfMaterialTarget[];
	stateTargets?: StompboxResolvedPartStateTargets;
	transform: Readonly<{
		translation: readonly number[];
		rotation: readonly number[];
		scale?: readonly number[];
	}>;
	extras: JsonObject;
}>;

type GltfMaterialTarget = Readonly<{
	meshNameIncludes: string;
	material: StompboxPreviewMaterial;
}>;

type GltfDocument = Readonly<{
	asset: Readonly<{
		version: "2.0";
		generator: "@vessel-dsp/stompbox";
		extras: Readonly<{
			schema: "stompbox-preview-glb/v1";
			units: StompboxUnits;
			sourceAssets: readonly GltfSourceAsset[];
			decals: readonly JsonObject[];
			appearance: JsonObject;
		}>;
	}>;
	scene: 0;
	scenes: readonly Readonly<{
		name: string;
		nodes: readonly number[];
	}>[];
	nodes: readonly JsonObject[];
	meshes: readonly JsonObject[];
	materials: readonly JsonObject[];
	buffers: readonly Readonly<{ byteLength: number }>[];
	bufferViews: readonly JsonObject[];
	accessors: readonly JsonObject[];
}>;

type ParsedGlb = Readonly<{
	json: JsonObject;
	binary: Uint8Array;
	bufferByteLength: number;
}>;

type DrillTemplatePanelId = "top" | "left" | "right" | "back" | "bottom";

type DrillTemplatePanel = Readonly<{
	id: DrillTemplatePanelId;
	x: number;
	y: number;
	width: number;
	height: number;
}>;

type DrillTemplateOutsideLayout = Readonly<{
	widthMm: number;
	heightMm: number;
	panels: Readonly<Record<DrillTemplatePanelId, DrillTemplatePanel>>;
}>;

type GltfMergeState = {
	readonly sourceAssets: GltfSourceAsset[];
	readonly nodes: MutableJsonObject[];
	readonly meshes: MutableJsonObject[];
	readonly materials: MutableJsonObject[];
	readonly bufferViews: MutableJsonObject[];
	readonly accessors: MutableJsonObject[];
	readonly binaryParts: Uint8Array[];
	binaryByteLength: number;
};

function drillTemplateSvg(template: StompboxDrillTemplate): string {
	const titleId = `stompbox-drill-${template.mode}-title`;
	const descId = `stompbox-drill-${template.mode}-desc`;
	const title = `Stompbox drill template ${template.mode}`;
	const viewBox = `0 0 ${svgNumber(template.canvasMm.widthMm)} ${svgNumber(template.canvasMm.heightMm)}`;
	const attrs = svgAttributes([
		["xmlns", "http://www.w3.org/2000/svg"],
		["role", "img"],
		["aria-labelledby", `${titleId} ${descId}`],
		["width", `${svgNumber(template.canvasMm.widthMm)}mm`],
		["height", `${svgNumber(template.canvasMm.heightMm)}mm`],
		["viewBox", viewBox],
		["data-template-mode", template.mode],
		["data-units", template.units],
		["data-scale", template.scale],
	]);
	const description =
		template.mode === "print"
			? "A4 1:1 stompbox drill template with scale marks."
			: "Lightweight stompbox drill template for UI preview.";
	return [
		`<svg ${attrs}>`,
		`<title id="${escapeAttribute(titleId)}">${escapeText(title)}</title>`,
		`<desc id="${escapeAttribute(descId)}">${escapeText(description)}</desc>`,
		drillTemplateStyleSvg(template),
		drillTemplateHeaderSvg(template),
		drillTemplateEnclosureSvg(template),
		drillTemplateDecalsSvg(template),
		drillTemplateScaleMarksSvg(template),
		drillTemplateHoleTableSvg(template),
		"</svg>",
	].join("");
}

function drillTemplateStyleSvg(template: StompboxDrillTemplate): string {
	const mode = template.mode;
	const stroke =
		template.appearance?.enclosure?.strokeColor ??
		(mode === "print" ? "#111827" : "#334155");
	const enclosureFill = template.appearance?.enclosure?.color ?? "#f8fafc";
	const sideFill = template.appearance?.template?.offColor ?? "#e2e8f0";
	const foldColor = template.appearance?.template?.foldColor ?? stroke;
	const guideColor = template.appearance?.template?.guideColor ?? "#64748b";
	const holeStroke = template.appearance?.template?.holeStrokeColor ?? stroke;
	const holeFill = template.appearance?.template?.holeFillColor ?? "none";
	const centerDot = template.appearance?.template?.centerDotColor ?? stroke;
	const labelColor = template.appearance?.defaults?.label?.color ?? "#111827";
	return [
		"<defs>",
		"<style>",
		`.enclosure{fill:${enclosureFill};stroke:${stroke};stroke-width:.35;}`,
		`.side-panel{fill:${sideFill};fill-opacity:.55;stroke:${stroke};stroke-width:.3;}`,
		`.fold-fill{fill:#0f172a;fill-opacity:${mode === "print" ? ".04" : ".08"};stroke:none;}`,
		`.fold-line{stroke:${foldColor};stroke-width:.18;stroke-dasharray:1.5 1.5;}`,
		`.guide-line{stroke:${guideColor};stroke-width:.14;stroke-dasharray:1.2 1.2;opacity:.55;}`,
		`.hole{fill:${holeFill};stroke:${holeStroke};stroke-width:.35;}`,
		`.drill-hole-center-dot{fill:${centerDot};stroke:none;}`,
		`.decal-outline{fill:none;stroke:${stroke};stroke-width:.25;stroke-dasharray:2 1;}`,
		`.label{fill:${labelColor};font-family:Arial,sans-serif;font-size:2.6px;}`,
		".muted{fill:#475569;font-family:Arial,sans-serif;font-size:2.3px;}",
		"</style>",
		"</defs>",
	].join("");
}

function drillTemplateHeaderSvg(template: StompboxDrillTemplate): string {
	if (template.mode !== "print") {
		return "";
	}
	return "";
}

function drillTemplateEnclosureSvg(template: StompboxDrillTemplate): string {
	const layout = outsideDrillTemplateLayout(
		template.enclosure,
		template.canvasMm,
	);
	const { top, left, right, back, bottom } = layout.panels;
	const topCenterX = top.x + top.width / 2;
	const topCenterY = top.y + top.height / 2;
	return [
		`<g ${svgAttributes([
			["data-enclosure-id", template.enclosure.variantId],
			["data-template-view", "outside-unfolded"],
		])}>`,
		drillTemplatePanelSvg(back, "panel side-panel", template.appearance),
		drillTemplatePanelSvg(left, "panel side-panel", template.appearance),
		drillTemplatePanelSvg(right, "panel side-panel", template.appearance),
		drillTemplatePanelSvg(bottom, "panel side-panel", template.appearance),
		drillTemplatePanelSvg(
			top,
			"panel top-panel enclosure",
			template.appearance,
		),
		drillTemplateFoldFillSvg(back),
		drillTemplateFoldFillSvg(left),
		drillTemplateFoldFillSvg(right),
		drillTemplateFoldFillSvg(bottom),
		drillTemplateLineSvg(
			"fold-line",
			[
				["data-fold-line", "left"],
				["x1", top.x],
				["y1", top.y],
				["x2", top.x],
				["y2", top.y + top.height],
			],
			template.appearance,
		),
		drillTemplateLineSvg(
			"fold-line",
			[
				["data-fold-line", "right"],
				["x1", top.x + top.width],
				["y1", top.y],
				["x2", top.x + top.width],
				["y2", top.y + top.height],
			],
			template.appearance,
		),
		drillTemplateLineSvg(
			"fold-line",
			[
				["data-fold-line", "back"],
				["x1", top.x],
				["y1", top.y],
				["x2", top.x + top.width],
				["y2", top.y],
			],
			template.appearance,
		),
		drillTemplateLineSvg(
			"fold-line",
			[
				["data-fold-line", "bottom"],
				["x1", top.x],
				["y1", top.y + top.height],
				["x2", top.x + top.width],
				["y2", top.y + top.height],
			],
			template.appearance,
		),
		drillTemplateLineSvg(
			"guide-line",
			[
				["data-template-guide", "vertical-centerline"],
				["x1", topCenterX],
				["y1", layout.panels.back.y],
				["x2", topCenterX],
				["y2", layout.panels.bottom.y + layout.panels.bottom.height],
			],
			template.appearance,
		),
		drillTemplateLineSvg(
			"guide-line",
			[
				["data-template-guide", "horizontal-centerline"],
				["x1", layout.panels.left.x],
				["y1", topCenterY],
				["x2", layout.panels.right.x + layout.panels.right.width],
				["y2", topCenterY],
			],
			template.appearance,
		),
		...template.holes.map((hole) =>
			drillTemplateHoleSvg(hole, template.mode, template.appearance),
		),
		"</g>",
	].join("");
}

function drillTemplatePanelSvg(
	panel: DrillTemplatePanel,
	className: string,
	appearance: StompboxAppearance | undefined,
): string {
	const isTop = panel.id === "top";
	return `<rect ${svgAttributes([
		["class", className],
		["data-face-panel", panel.id],
		["x", svgNumber(panel.x)],
		["y", svgNumber(panel.y)],
		["width", svgNumber(panel.width)],
		["height", svgNumber(panel.height)],
		["rx", isTop ? 2.5 : 0],
		[
			"fill",
			isTop ? appearance?.enclosure?.color : appearance?.template?.offColor,
		],
		["stroke", appearance?.enclosure?.strokeColor],
	])}/>`;
}

function drillTemplateFoldFillSvg(panel: DrillTemplatePanel): string {
	const inset = Math.min(panel.width, panel.height) > 12 ? 4 : 2;
	return `<rect ${svgAttributes([
		["class", "fold-fill"],
		["data-face-panel-fill", panel.id],
		["x", svgNumber(panel.x + inset)],
		["y", svgNumber(panel.y + inset)],
		["width", svgNumber(Math.max(panel.width - inset * 2, 0))],
		["height", svgNumber(Math.max(panel.height - inset * 2, 0))],
	])}/>`;
}

function drillTemplateLineSvg(
	className: string,
	attributes: readonly (readonly [string, SvgAttributeValue])[],
	appearance?: StompboxAppearance,
): string {
	const stroke =
		className === "guide-line"
			? appearance?.template?.guideColor
			: className === "fold-line"
				? appearance?.template?.foldColor
				: undefined;
	const normalized = attributes.map(
		([name, value]) =>
			[name, typeof value === "number" ? svgNumber(value) : value] as const,
	);
	return `<line ${svgAttributes([
		["class", className],
		["stroke", stroke],
		...normalized,
	])}/>`;
}

function drillTemplateHoleSvg(
	hole: StompboxDrillTemplateHole,
	mode: StompboxTemplateMode,
	appearance: StompboxAppearance | undefined,
): string {
	const radius = hole.drillDiameterMm / 2;
	const visibleDiameter = partGeometryVisibleDiameterMm(hole.partGeometry);
	const profile = drillHoleProfileForHole(hole);
	const labelId = `label-${decalIdSegment(hole.id)}`;
	const labelAppearance = labelAppearanceFor(
		labelId,
		hole.controlId,
		appearance,
	);
	const label = labelAppearance?.text ?? drillTemplateHoleLabel(hole);
	const labelY = drillTemplateHoleLabelY(hole, radius);
	const labelAttrs = svgAttributes([
		["class", "label"],
		["x", svgNumber(hole.templateCenterMm.x)],
		["y", svgNumber(labelY)],
		["text-anchor", "middle"],
		["fill", labelAppearance?.color],
		["font-family", labelAppearance?.fontFamily],
		[
			"font-size",
			labelAppearance?.fontSizeMm === undefined
				? undefined
				: svgNumber(labelAppearance.fontSizeMm),
		],
	]);
	return [
		`<g ${svgAttributes([
			["data-hole-id", hole.id],
			["data-part-profile-id", hole.partId],
			["data-face", hole.face],
			["data-template-face", hole.face],
			["data-provenance", hole.provenance],
			["data-drill-diameter-mm", svgNumber(hole.drillDiameterMm)],
			["data-drill-radius-mm", svgNumber(radius)],
			[
				"data-part-visible-diameter-mm",
				visibleDiameter === undefined ? undefined : svgNumber(visibleDiameter),
			],
			["data-drill-hole-profile-id", profile?.id],
			["data-drill-hole-profile-label", profile?.label],
			[
				"data-drill-hole-profile-diameter-mm",
				profile === undefined ? undefined : svgNumber(profile.diameterMm),
			],
			["data-drill-hole-profile-fraction-inches", profile?.fractionInches],
		])}>`,
		drillTemplateHoleMarkerSvg(hole, radius, profile, appearance),
		label === undefined
			? ""
			: `<text ${labelAttrs}>${escapeText(label)}</text>`,
		"</g>",
	].join("");
}

function drillTemplateHoleLabelY(
	hole: StompboxDrillTemplateHole,
	radius: number,
): number {
	if (hole.partFamily === "dc-jack") {
		return hole.templateCenterMm.y + radius + 3.5;
	}
	return hole.templateCenterMm.y - radius - 1.8;
}

function drillTemplateHoleLabel(
	hole: StompboxDrillTemplateHole,
): string | undefined {
	if (hole.partFamily === "footswitch") {
		return undefined;
	}
	return hole.label ?? hole.controlId ?? hole.id;
}

function drillTemplateHoleMarkerSvg(
	hole: StompboxDrillTemplateHole,
	radius: number,
	profile: StompboxDrillHoleProfile | undefined,
	appearance: StompboxAppearance | undefined,
): string {
	const dotRadius = drillTemplateCenterDotRadius(radius);
	const centerDot = `<circle ${svgAttributes([
		["class", "drill-hole-center-dot"],
		["cx", svgNumber(hole.templateCenterMm.x)],
		["cy", svgNumber(hole.templateCenterMm.y)],
		["r", svgNumber(dotRadius)],
		["fill", appearance?.template?.centerDotColor],
	])}/>`;
	if (profile?.marker === "center-dot") {
		return centerDot;
	}
	return [
		`<circle ${svgAttributes([
			["class", "hole drill-hole-profile-outer"],
			["cx", svgNumber(hole.templateCenterMm.x)],
			["cy", svgNumber(hole.templateCenterMm.y)],
			["r", svgNumber(radius)],
			["fill", appearance?.template?.holeFillColor],
			["stroke", appearance?.template?.holeStrokeColor],
		])}/>`,
		centerDot,
	].join("");
}

function drillTemplateCenterDotRadius(radius: number): number {
	return Math.min(1.5, Math.max(0.55, radius * 0.25));
}

function drillHoleProfileForHole(
	hole: StompboxDrillHole,
): StompboxDrillHoleProfile | undefined {
	if (hole.drillHoleProfileId !== undefined) {
		return STOMPBOX_DRILL_HOLE_PROFILE_CATALOG[hole.drillHoleProfileId];
	}
	return Object.values(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG).find(
		(profile) => Math.abs(profile.diameterMm - hole.drillDiameterMm) < 0.001,
	);
}

function drillTemplateDecalsSvg(template: StompboxDrillTemplate): string {
	if (template.decals.length === 0) {
		return "";
	}
	const layout = outsideDrillTemplateLayout(
		template.enclosure,
		template.canvasMm,
	);
	return [
		'<g data-decal-outlines="true">',
		...template.decals.map((decal) =>
			drillTemplateDecalOutlineSvg(decal, layout, template.enclosure),
		),
		"</g>",
	].join("");
}

function drillTemplateDecalOutlineSvg(
	decal: StompboxPreviewDecal,
	layout: DrillTemplateOutsideLayout,
	enclosure: StompboxEnclosureProfile,
): string {
	const center = drillTemplateCenterForDecal(
		decal.face,
		decal.centerMm,
		layout,
		enclosure,
	);
	return [
		`<g ${svgAttributes([
			["data-decal-outline", true],
			["data-decal-id", decal.id],
			["data-decal-kind", decal.kind],
			["data-face", decal.face],
			[
				"transform",
				`translate(${svgNumber(center.x)} ${svgNumber(center.y)}) rotate(${svgNumber(decal.rotationDeg)})`,
			],
		])}>`,
		`<rect class="decal-outline" x="${svgNumber(-decal.sizeMm.widthMm / 2)}" y="${svgNumber(-decal.sizeMm.heightMm / 2)}" width="${svgNumber(decal.sizeMm.widthMm)}" height="${svgNumber(decal.sizeMm.heightMm)}" rx=".8"/>`,
		"</g>",
	].join("");
}

function drillTemplateScaleMarksSvg(template: StompboxDrillTemplate): string {
	if (template.scaleMarks.length === 0) {
		return "";
	}
	return [
		'<g data-scale-marks="true">',
		...template.scaleMarks.map((mark) =>
			[
				`<g ${svgAttributes([
					["data-scale-mark-id", mark.id],
					["data-scale-mark-mm", mark.lengthMm],
				])}>`,
				`<line x1="${svgNumber(mark.startMm.x)}" y1="${svgNumber(mark.startMm.y)}" x2="${svgNumber(mark.endMm.x)}" y2="${svgNumber(mark.endMm.y)}" stroke="#111827" stroke-width=".35"/>`,
				`<line x1="${svgNumber(mark.startMm.x)}" y1="${svgNumber(mark.startMm.y - 1.5)}" x2="${svgNumber(mark.startMm.x)}" y2="${svgNumber(mark.startMm.y + 1.5)}" stroke="#111827" stroke-width=".35"/>`,
				`<line x1="${svgNumber(mark.endMm.x)}" y1="${svgNumber(mark.endMm.y - 1.5)}" x2="${svgNumber(mark.endMm.x)}" y2="${svgNumber(mark.endMm.y + 1.5)}" stroke="#111827" stroke-width=".35"/>`,
				"</g>",
			].join(""),
		),
		"</g>",
	].join("");
}

function drillTemplateHoleTableSvg(template: StompboxDrillTemplate): string {
	if (template.holeTable.length === 0) {
		return "";
	}
	return "";
}

function previewViewSvg(
	preview: StompboxPreview,
	view: StompboxPreviewSvgViewId,
	grain: ResolvedStompboxPreviewSvgGrain | undefined,
): string {
	const canvas = previewViewCanvas(preview, view);
	const titleId = `stompbox-preview-${view}-title`;
	const descId = `stompbox-preview-${view}-desc`;
	const attrs = svgAttributes([
		["xmlns", "http://www.w3.org/2000/svg"],
		["role", "img"],
		["aria-labelledby", `${titleId} ${descId}`],
		["width", `${svgNumber(canvas.widthMm)}mm`],
		["height", `${svgNumber(canvas.heightMm)}mm`],
		[
			"viewBox",
			`0 0 ${svgNumber(canvas.widthMm)} ${svgNumber(canvas.heightMm)}`,
		],
		["data-view", view],
		["data-units", preview.units],
	]);
	const parts = preview.parts
		.filter((part) => partVisibleInView(part, view))
		.map((part) => previewPartSvg(preview, part, view, canvas))
		.join("");
	const decals = preview.decals
		.filter((decal) => decalVisibleInView(decal, view))
		.map((decal) => previewDecalSvg(decal, canvas))
		.join("");
	return [
		`<svg ${attrs}>`,
		`<title id="${escapeAttribute(titleId)}">Stompbox preview ${escapeText(view)} view</title>`,
		`<desc id="${escapeAttribute(descId)}">Orthographic ${escapeText(view)} SVG preview for the stompbox assembly.</desc>`,
		previewViewDefsSvg(view, canvas, grain),
		previewFrameSvg(preview, view, canvas),
		decals,
		parts,
		previewSvgGrainOverlay(view, canvas, grain),
		"</svg>",
	].join("");
}

function previewViewDefsSvg(
	view: StompboxPreviewSvgViewId,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
	grain: ResolvedStompboxPreviewSvgGrain | undefined,
): string {
	return [
		"<defs>",
		"<style>.case{fill:#f8fafc;stroke:#334155;stroke-width:.35}.decal-bounds{fill:none;stroke:#475569;stroke-width:.18;stroke-dasharray:1.5 1}.grain-overlay{mix-blend-mode:soft-light}</style>",
		previewSvgGrainFilter(view, grain),
		previewSvgGrainClipPath(view, canvas, grain),
		"</defs>",
	].join("");
}

function previewSvgGrainFilter(
	view: StompboxPreviewSvgViewId,
	grain: ResolvedStompboxPreviewSvgGrain | undefined,
): string {
	if (grain === undefined) {
		return "";
	}
	return [
		`<filter id="${escapeAttribute(previewSvgGrainFilterId(view))}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`,
		`<feTurbulence type="fractalNoise" baseFrequency="${svgNumber(grain.baseFrequency)}" numOctaves="${svgNumber(grain.numOctaves)}" stitchTiles="stitch" result="turbulence"/>`,
		'<feComposite operator="in" in="turbulence" in2="SourceAlpha" result="composite"/>',
		'<feColorMatrix in="composite" type="luminanceToAlpha" />',
		'<feBlend in="SourceGraphic" in2="composite" mode="screen" />',
		"</filter>",
	].join("");
}

function previewSvgGrainOverlay(
	view: StompboxPreviewSvgViewId,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
	grain: ResolvedStompboxPreviewSvgGrain | undefined,
): string {
	if (grain === undefined) {
		return "";
	}
	return `<rect class="grain-overlay" data-grain-overlay="true" x="0" y="0" width="${svgNumber(canvas.widthMm)}" height="${svgNumber(canvas.heightMm)}" fill="#808080" filter="url(#${escapeAttribute(previewSvgGrainFilterId(view))})" clip-path="url(#${escapeAttribute(previewSvgGrainClipPathId(view))})" pointer-events="none"${grain.opacity === 1 ? "" : ` opacity="${svgNumber(grain.opacity)}"`}/>`;
}

function previewSvgGrainFilterId(view: StompboxPreviewSvgViewId): string {
	return `stompbox-preview-${view}-noise-filter`;
}

function previewSvgGrainClipPath(
	view: StompboxPreviewSvgViewId,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
	grain: ResolvedStompboxPreviewSvgGrain | undefined,
): string {
	if (grain === undefined) {
		return "";
	}
	return `<clipPath id="${escapeAttribute(previewSvgGrainClipPathId(view))}"><rect x="0" y="0" width="${svgNumber(canvas.widthMm)}" height="${svgNumber(canvas.heightMm)}" rx="2.5"/></clipPath>`;
}

function previewSvgGrainClipPathId(view: StompboxPreviewSvgViewId): string {
	return `stompbox-preview-${view}-grain-clip`;
}

function previewViewCanvas(
	preview: StompboxPreview,
	view: StompboxPreviewSvgViewId,
): Readonly<{ widthMm: number; heightMm: number }> {
	if (view === "left" || view === "right") {
		return {
			widthMm: preview.enclosure.dimensionsMm.depthMm,
			heightMm: preview.enclosure.dimensionsMm.lengthMm,
		};
	}
	if (view === "back" || view === "bottom") {
		return {
			widthMm: preview.enclosure.dimensionsMm.widthMm,
			heightMm: preview.enclosure.dimensionsMm.depthMm,
		};
	}
	return {
		widthMm: preview.enclosure.dimensionsMm.widthMm,
		heightMm: preview.enclosure.dimensionsMm.lengthMm,
	};
}

function previewFrameSvg(
	preview: StompboxPreview,
	view: StompboxPreviewSvgViewId,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
): string {
	const enclosureFill = preview.enclosure.material?.color ?? "#f8fafc";
	const enclosureStroke = preview.enclosure.material?.strokeColor ?? "#334155";
	return [
		`<g data-enclosure-id="${escapeAttribute(preview.enclosure.variantId)}" data-enclosure-view="${escapeAttribute(view)}">`,
		`<rect class="case" x="0" y="0" width="${svgNumber(canvas.widthMm)}" height="${svgNumber(canvas.heightMm)}" rx="2.5" fill="${escapeAttribute(enclosureFill)}" stroke="${escapeAttribute(enclosureStroke)}"/>`,
		view === "bottom"
			? `<rect x="4" y="4" width="${svgNumber(canvas.widthMm - 8)}" height="${svgNumber(canvas.heightMm - 8)}" rx="2" fill="none" stroke="#94a3b8" stroke-width=".25" data-enclosure-bottom="true"/>`
			: "",
		"</g>",
	].join("");
}

function previewPartSvg(
	preview: StompboxPreview,
	part: StompboxPreviewPart,
	view: StompboxPreviewSvgViewId,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
): string {
	const point = previewPointForPart(preview, part, view, canvas);
	const attrs = svgAttributes([
		["data-part-id", part.id],
		["data-part-profile-id", part.partId],
		["data-part-family", part.family],
		["data-control-id", part.controlId],
		["data-face", part.face],
		["data-provenance", part.provenance],
		[
			"data-knob-rotation-deg",
			part.geometry.kind === "knob" ? part.transform.rotationDeg.z : undefined,
		],
		[
			"data-led-emissive",
			part.family === "led" ? part.material?.emissive === true : undefined,
		],
		[
			"data-footswitch-pressed",
			part.geometry.kind === "footswitch"
				? part.transform.translationMm.z <
					preview.enclosure.dimensionsMm.depthMm / 2
				: undefined,
		],
	]);
	return [`<g ${attrs}>`, previewPartShapeSvg(part, point), "</g>"].join("");
}

function previewDecalSvg(
	decal: StompboxPreviewDecal,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
): string {
	const point = previewPointForDecal(decal, canvas);
	const bounds = decal.id.startsWith("label-")
		? ""
		: `<rect class="decal-bounds" x="${svgNumber(-decal.sizeMm.widthMm / 2)}" y="${svgNumber(-decal.sizeMm.heightMm / 2)}" width="${svgNumber(decal.sizeMm.widthMm)}" height="${svgNumber(decal.sizeMm.heightMm)}" rx=".8"/>`;
	return [
		`<g ${svgAttributes([
			["data-decal-id", decal.id],
			["data-decal-kind", decal.kind],
			["data-face", decal.face],
			[
				"transform",
				`translate(${svgNumber(point.x)} ${svgNumber(point.y)}) rotate(${svgNumber(decal.rotationDeg)})`,
			],
		])}>`,
		bounds,
		previewDecalContentSvg(decal),
		"</g>",
	].join("");
}

function previewDecalContentSvg(decal: StompboxPreviewDecal): string {
	if (decal.kind === "text") {
		return `<text class="label-text" x="0" y="0" text-anchor="middle" dominant-baseline="middle" font-family="${escapeAttribute(decal.fontFamily)}" font-size="${svgNumber(decal.fontSizeMm)}" fill="${escapeAttribute(decal.color)}">${escapeText(decal.text)}</text>`;
	}
	const href =
		decal.kind === "svg"
			? svgDataUri(colorizedSvg(decal.svg, decal.color))
			: decal.href;
	return `<image href="${escapeAttribute(href)}" x="${svgNumber(-decal.sizeMm.widthMm / 2)}" y="${svgNumber(-decal.sizeMm.heightMm / 2)}" width="${svgNumber(decal.sizeMm.widthMm)}" height="${svgNumber(decal.sizeMm.heightMm)}" preserveAspectRatio="xMidYMid meet"/>`;
}

function previewPartShapeSvg(
	part: StompboxPreviewPart,
	point: StompboxPoint2,
): string {
	const geometry = part.geometry;
	if (geometry.kind === "knob") {
		const radius = geometry.diameterMm / 2;
		const fill = part.material?.color ?? "#334155";
		const stroke = part.material?.strokeColor ?? "#eb7223";
		const indicator = "#f8fafc";
		const svgIndicatorRotationDeg = -part.transform.rotationDeg.z;
		return [
			`<circle class="knob-body" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius)}" fill="${escapeAttribute(fill)}" stroke="${escapeAttribute(stroke)}" stroke-width=".35"/>`,
			`<line class="knob-indicator" x1="${svgNumber(point.x)}" y1="${svgNumber(point.y)}" x2="${svgNumber(point.x)}" y2="${svgNumber(point.y - radius + 2)}" stroke="${escapeAttribute(indicator)}" stroke-width=".8" stroke-linecap="round" transform="rotate(${svgNumber(svgIndicatorRotationDeg)} ${svgNumber(point.x)} ${svgNumber(point.y)})"/>`,
		].join("");
	}
	if (geometry.kind === "led") {
		const radius = geometry.flangeDiameterMm / 2;
		const fill =
			part.material?.emissive === true
				? (part.material.color ?? "#ef4444")
				: (part.material?.offColor ?? "#fee2e2");
		const stroke = part.material?.strokeColor ?? "#7f1d1d";
		const opacity = part.material?.emissive === true ? "1" : ".45";
		return `<circle class="led-lens" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius)}" fill="${escapeAttribute(fill)}" fill-opacity="${opacity}" stroke="${escapeAttribute(stroke)}" stroke-width=".3"/>`;
	}
	if (geometry.kind === "led-bezel") {
		const lensFill =
			part.material?.emissive === true
				? (part.material.color ?? "#ef4444")
				: (part.material?.offColor ?? "#fee2e2");
		const lensStroke = part.material?.strokeColor ?? "#7f1d1d";
		const opacity = part.material?.emissive === true ? "1" : ".45";
		return [
			`<circle class="led-bezel-ring" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.outerDiameterMm / 2)}" fill="#d1d5db" stroke="#64748b" stroke-width=".35"/>`,
			`<circle class="led-lens" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.innerDiameterMm / 2)}" fill="${escapeAttribute(lensFill)}" fill-opacity="${opacity}" stroke="${escapeAttribute(lensStroke)}" stroke-width=".25"/>`,
		].join("");
	}
	if (geometry.kind === "footswitch") {
		const pressed = part.transform.translationMm.z < 15.5;
		const nutFill = part.material?.color ?? "#d1d5db";
		const buttonFill = pressed
			? (part.material?.pressedColor ?? "#64748b")
			: (part.material?.offColor ?? "#94a3b8");
		const stroke = part.material?.strokeColor ?? "#374151";
		return [
			`<circle class="footswitch-nut" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.nutOuterDiameterMm / 2)}" fill="${escapeAttribute(nutFill)}" stroke="${escapeAttribute(stroke)}" stroke-width=".35"/>`,
			`<circle class="footswitch-button" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y + (pressed ? 0.6 : 0))}" r="${svgNumber(geometry.buttonDiameterMm / 2)}" fill="${escapeAttribute(buttonFill)}" stroke="#1f2937" stroke-width=".25"/>`,
		].join("");
	}
	const stroke = part.material?.strokeColor ?? "#334155";
	const innerStroke = part.material?.color ?? "#94a3b8";
	return [
		`<circle class="ring-outer" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.outerDiameterMm / 2)}" fill="none" stroke="${escapeAttribute(stroke)}" stroke-width=".45"/>`,
		`<circle class="ring-inner" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.innerDiameterMm / 2)}" fill="none" stroke="${escapeAttribute(innerStroke)}" stroke-width=".3"/>`,
	].join("");
}

function previewPointForPart(
	preview: StompboxPreview,
	part: StompboxPreviewPart,
	view: StompboxPreviewSvgViewId,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
): StompboxPoint2 {
	if (view === "left" || view === "right") {
		return {
			x: canvas.widthMm / 2,
			y: canvas.heightMm / 2 - part.transform.translationMm.y,
		};
	}
	if (view === "back") {
		return {
			x:
				preview.enclosure.dimensionsMm.widthMm / 2 +
				part.transform.translationMm.x,
			y: canvas.heightMm / 2 - part.transform.translationMm.z,
		};
	}
	return {
		x:
			preview.enclosure.dimensionsMm.widthMm / 2 +
			part.transform.translationMm.x,
		y:
			preview.enclosure.dimensionsMm.lengthMm / 2 -
			part.transform.translationMm.y,
	};
}

function previewPointForDecal(
	decal: StompboxPreviewDecal,
	canvas: Readonly<{ widthMm: number; heightMm: number }>,
): StompboxPoint2 {
	const center = decalFaceLocalCenterMm(decal);
	return {
		x: canvas.widthMm / 2 + center.x,
		y: canvas.heightMm / 2 - center.y,
	};
}

function decalUsesFaceLocalCoordinates(decal: StompboxPreviewDecal): boolean {
	return decal.placement !== undefined || !decal.id.startsWith("label-");
}

function partVisibleInView(
	part: StompboxPreviewPart,
	view: StompboxPreviewSvgViewId,
): boolean {
	if (view === "top") {
		return part.face === "top";
	}
	if (view === "left") {
		return part.face === "left";
	}
	if (view === "right") {
		return part.face === "right";
	}
	if (view === "back") {
		return part.face === "back";
	}
	return part.face === "bottom";
}

function decalVisibleInView(
	decal: StompboxPreviewDecal,
	view: StompboxPreviewSvgViewId,
): boolean {
	if (view === "top") {
		return decal.face === "top";
	}
	if (view === "left") {
		return decal.face === "left";
	}
	if (view === "right") {
		return decal.face === "right";
	}
	if (view === "back") {
		return decal.face === "back";
	}
	return decal.face === "bottom";
}

function previewGlb(
	preview: StompboxPreview,
	options: StompboxPreviewGlbOptions,
	assetValidation?: StompboxHardwareProfileAssetValidation,
): Uint8Array {
	const appearance = createStompboxAppearancePatch(preview, options.appearance);
	const state: GltfMergeState = {
		sourceAssets: [],
		nodes: [
			{
				name: "stompbox-preview-root",
				children: [],
				extras: {
					schema: "stompbox-preview-glb/v1",
					units: preview.units,
					enclosureId: preview.enclosure.variantId,
					decals: preview.decals.map((decal) => previewDecalJson(decal)),
					appearance,
				},
			},
		],
		meshes: [],
		materials: [],
		bufferViews: [],
		accessors: [],
		binaryParts: [],
		binaryByteLength: 0,
	};
	const rootChildren: number[] = [];
	for (const source of gltfAssemblySources(preview, options, assetValidation)) {
		rootChildren.push(appendAssemblySource(state, source));
	}
	for (const part of preview.parts) {
		const holeBacking = appendHoleBackingDiscForPart(
			state,
			part,
			preview.drillLayout,
		);
		if (holeBacking !== undefined) {
			rootChildren.push(holeBacking);
		}
	}
	for (const decal of preview.decals) {
		rootChildren.push(appendDecalPlane(state, decal, preview.enclosure));
	}
	const rootNode = state.nodes[0];
	if (rootNode === undefined) {
		throw new Error("internal stompbox GLB assembly error: missing root node");
	}
	rootNode.children = rootChildren;

	const binary = concatUint8Arrays(state.binaryParts, state.binaryByteLength);
	const document: GltfDocument = {
		asset: {
			version: "2.0",
			generator: "@vessel-dsp/stompbox",
			extras: {
				schema: "stompbox-preview-glb/v1",
				units: preview.units,
				sourceAssets: state.sourceAssets,
				decals: preview.decals.map((decal) => previewDecalJson(decal)),
				appearance,
			},
		},
		scene: 0,
		scenes: [{ name: "Stompbox Preview", nodes: [0] }],
		nodes: state.nodes,
		meshes: state.meshes,
		materials: state.materials,
		buffers: [{ byteLength: binary.byteLength }],
		bufferViews: state.bufferViews,
		accessors: state.accessors,
	};
	return encodeGlb(document, binary);
}

function gltfAssemblySources(
	preview: StompboxPreview,
	options: StompboxPreviewGlbOptions,
	assetValidation?: StompboxHardwareProfileAssetValidation,
): readonly GltfAssemblySource[] {
	if (options.basePath === undefined) {
		throw new Error(
			"stompbox GLB assembly requires options.basePath for caller-provided asset files",
		);
	}
	const basePath = options.basePath;
	const readAssetFile = requireStompboxAssetFileReader(options);
	return [
		{
			id: preview.enclosure.variantId,
			kind: "enclosure",
			displayGlb: preview.enclosure.assets.glb,
			displayStep: preview.enclosure.assets.step,
			localGlbPath: resolveStompboxAssetPaths(
				preview.drillLayout.enclosure.assets,
				{ basePath },
			).glb,
			readAssetFile,
			...(preview.enclosure.material === undefined
				? {}
				: { material: preview.enclosure.material }),
			transform: {
				translation: [0, 0, 0],
				rotation: [0, 0, 0, 1],
			},
			extras: {
				id: preview.enclosure.variantId,
				kind: "enclosure",
				glb: preview.enclosure.assets.glb,
				step: preview.enclosure.assets.step,
				dimensionsMm: {
					widthMm: preview.enclosure.dimensionsMm.widthMm,
					lengthMm: preview.enclosure.dimensionsMm.lengthMm,
					depthMm: preview.enclosure.dimensionsMm.depthMm,
				},
				...(preview.enclosure.material === undefined
					? {}
					: { material: previewMaterialJson(preview.enclosure.material) }),
			},
		},
		...preview.parts.map((part) =>
			partAssemblySource(
				part,
				preview.drillLayout,
				basePath,
				readAssetFile,
				assetValidation?.assets[part.partId],
			),
		),
	];
}

function partAssemblySource(
	part: StompboxPreviewPart,
	layout: StompboxDrillLayout,
	basePath: string,
	readAssetFile: StompboxAssetFileReader,
	validation: StompboxGlbAssetValidation | undefined,
): GltfAssemblySource {
	const sourceAssets = sourceAssetRefsForPreviewPart(layout, part);
	const sourceMaterial =
		part.geometry.kind === "led-bezel" ? undefined : part.material;
	const transform = {
		translation: point3Array(part.transform.translationMm),
		rotation: quaternionFromEulerDeg(part.transform.rotationDeg),
		...(part.assetScale === undefined
			? {}
			: { scale: [part.assetScale, part.assetScale, part.assetScale] }),
	};
	const materialTargets = materialTargetsForPart(part);
	const stateTargets = resolvedStateTargetsForAssembly(part, validation);
	return {
		id: part.id,
		kind: "part",
		displayGlb: part.assets.glb,
		displayStep: part.assets.step,
		localGlbPath: resolveStompboxAssetPaths(sourceAssets, { basePath }).glb,
		readAssetFile,
		...(sourceMaterial === undefined ? {} : { material: sourceMaterial }),
		...(materialTargets.length === 0 ? {} : { materialTargets }),
		...(stateTargets === undefined ? {} : { stateTargets }),
		transform,
		extras: {
			id: part.id,
			kind: "part",
			partId: part.partId,
			face: part.face,
			provenance: part.provenance,
			...(part.partProvenance === undefined
				? {}
				: { partProvenance: part.partProvenance }),
			glb: part.assets.glb,
			step: part.assets.step,
			...(part.assetScale === undefined ? {} : { assetScale: part.assetScale }),
			...(part.controlId === undefined ? {} : { controlId: part.controlId }),
			...(part.material === undefined
				? {}
				: { material: previewMaterialJson(part.material) }),
			...(stateTargets === undefined
				? {}
				: { stateTargets: partStateTargetsJson(stateTargets) }),
		},
	};
}

function sourceAssetRefsForPreviewPart(
	layout: StompboxDrillLayout,
	part: StompboxPreviewPart,
): StompboxAssetRefs {
	const hole = layout.holes.find((candidate) => candidate.id === part.id);
	if (hole === undefined) {
		throw new Error(
			`missing drill-layout source assets for stompbox part: ${part.id}`,
		);
	}
	return hole.assets;
}

function materialTargetsForPart(
	part: StompboxPreviewPart,
): readonly GltfMaterialTarget[] {
	if (part.geometry.kind !== "led-bezel" || part.material === undefined) {
		return [];
	}
	const lensSelector = part.stateTargets?.led?.lens.selector;
	const meshNameIncludes =
		lensSelector?.meshNameIncludes ?? lensSelector?.meshName;
	if (meshNameIncludes === undefined) {
		return [];
	}
	return [
		{
			meshNameIncludes,
			material: part.material,
		},
	];
}

function resolvedStateTargetsForAssembly(
	part: StompboxPreviewPart,
	validation: StompboxGlbAssetValidation | undefined,
): StompboxResolvedPartStateTargets | undefined {
	const ledLens = validation?.targets["led.lens"];
	if (part.family === "led" && ledLens !== undefined) {
		return {
			led: {
				lens: prefixResolvedStateTarget(part.id, ledLens),
			},
		};
	}
	const actuator = validation?.targets["footswitch.actuator"];
	if (part.family === "footswitch" && actuator !== undefined) {
		return {
			footswitch: {
				actuator: prefixResolvedStateTarget(part.id, actuator),
			},
		};
	}
	return undefined;
}

function prefixResolvedStateTarget(
	previewPartId: string,
	target: StompboxResolvedGlbStateTarget,
): StompboxResolvedGlbStateTarget {
	return {
		...target,
		nodeName: `${previewPartId}/${target.nodeName}`,
		...(target.meshName === undefined
			? {}
			: { meshName: `${previewPartId}/${target.meshName}` }),
		...(target.materialName === undefined
			? {}
			: { materialName: `${previewPartId}/${target.materialName}` }),
	};
}

function partStateTargetsJson(
	targets: StompboxResolvedPartStateTargets,
): JsonObject {
	return cloneJsonObject(targets as unknown as JsonObject);
}

function previewMaterialJson(material: StompboxPreviewMaterial): JsonObject {
	return {
		...(material.color === undefined ? {} : { color: material.color }),
		...(material.strokeColor === undefined
			? {}
			: { strokeColor: material.strokeColor }),
		...(material.offColor === undefined ? {} : { offColor: material.offColor }),
		...(material.pressedColor === undefined
			? {}
			: { pressedColor: material.pressedColor }),
		...(material.emissive === undefined ? {} : { emissive: material.emissive }),
		...(material.intensity === undefined
			? {}
			: { intensity: material.intensity }),
		...(material.metallicFactor === undefined
			? {}
			: { metallicFactor: material.metallicFactor }),
		...(material.roughnessFactor === undefined
			? {}
			: { roughnessFactor: material.roughnessFactor }),
		...(material.opacity === undefined ? {} : { opacity: material.opacity }),
	};
}

function previewDecalJson(decal: StompboxPreviewDecal): JsonObject {
	return {
		id: decal.id,
		kind: "decal",
		decalKind: decal.kind,
		face: decal.face,
		centerMm: {
			x: decal.centerMm.x,
			y: decal.centerMm.y,
		},
		sizeMm: {
			widthMm: decal.sizeMm.widthMm,
			heightMm: decal.sizeMm.heightMm,
		},
		rotationDeg: decal.rotationDeg,
		...(decal.placement === undefined
			? {}
			: { placement: previewDecalPlacementJson(decal.placement) }),
		...previewDecalContentJson(decal),
	};
}

function previewDecalContentJson(decal: StompboxPreviewDecal): JsonObject {
	if (decal.kind === "text") {
		return {
			text: decal.text,
			color: decal.color,
			fontFamily: decal.fontFamily,
			fontSizeMm: decal.fontSizeMm,
		};
	}
	if (decal.kind === "image") {
		return {
			href: decal.href,
			...(decal.mimeType === undefined ? {} : { mimeType: decal.mimeType }),
			...(decal.color === undefined ? {} : { color: decal.color }),
		};
	}
	return {
		svg: decal.svg,
		...(decal.color === undefined ? {} : { color: decal.color }),
	};
}

function previewDecalPlacementJson(
	placement: StompboxDecalPlacement,
): JsonObject {
	if (placement.kind === "grid") {
		return {
			kind: "grid",
			columns: placement.columns,
			rows: placement.rows,
			column: placement.column,
			row: placement.row,
		};
	}
	return {};
}

function appendDecalPlane(
	state: GltfMergeState,
	decal: StompboxPreviewDecal,
	enclosure: StompboxPreviewEnclosure,
): number {
	const materialIndex = state.materials.length;
	state.materials.push({
		name: `decal-${decal.id}/material`,
		alphaMode: "BLEND",
		doubleSided: true,
		pbrMetallicRoughness: {
			baseColorFactor: [1, 1, 1, 0],
			metallicFactor: 0,
			roughnessFactor: 1,
		},
	});

	const positionAccessor = appendDecalPositionAccessor(state, decal.sizeMm);
	const indexAccessor = appendDecalIndexAccessor(state);
	const meshIndex = state.meshes.length;
	state.meshes.push({
		name: `decal-${decal.id}/plane`,
		primitives: [
			{
				attributes: { POSITION: positionAccessor },
				indices: indexAccessor,
				material: materialIndex,
				mode: 4,
			},
		],
	});

	const transform = decalTransform(decal, enclosure);
	const nodeIndex = state.nodes.length;
	state.nodes.push({
		name: `decal-${decal.id}`,
		mesh: meshIndex,
		translation: point3Array(transform.translationMm),
		rotation: quaternionFromEulerDeg(transform.rotationDeg),
		extras: previewDecalJson(decal),
	});
	return nodeIndex;
}

function appendHoleBackingDiscForPart(
	state: GltfMergeState,
	part: StompboxPreviewPart,
	layout: StompboxDrillLayout,
): number | undefined {
	if (
		part.geometry.kind !== "ring" ||
		(part.family !== "audio-jack" && part.family !== "dc-jack")
	) {
		return undefined;
	}
	const materialIndex = holeBackingMaterialIndex(state);
	const diameterMm = holeBackingDiameterMm(
		part,
		layout.holes.find((hole) => hole.id === part.id),
	);
	const meshIndex = state.meshes.length;
	state.meshes.push({
		name: `hole-backing-${part.id}/disc`,
		primitives: [
			{
				attributes: {
					POSITION: appendDiscPositionAccessor(
						state,
						diameterMm / 2,
						STOMPBOX_HOLE_BACKING_OUTSET_MM,
					),
				},
				indices: appendDiscIndexAccessor(state),
				material: materialIndex,
				mode: 4,
			},
		],
	});

	const nodeIndex = state.nodes.length;
	state.nodes.push({
		name: `hole-backing-${part.id}`,
		mesh: meshIndex,
		translation: point3Array(part.transform.translationMm),
		rotation: quaternionFromEulerDeg(part.transform.rotationDeg),
		extras: {
			kind: "hole-backing",
			partId: part.id,
			sourcePartId: part.partId,
			face: part.face,
			diameterMm,
			outsetMm: STOMPBOX_HOLE_BACKING_OUTSET_MM,
		},
	});
	return nodeIndex;
}

function holeBackingDiameterMm(
	part: StompboxPreviewPart,
	hole: StompboxDrillHole | undefined,
): number {
	if (part.geometry.kind !== "ring") {
		return 0;
	}
	if (part.family === "dc-jack") {
		const drillDiameterMm = hole?.drillDiameterMm;
		if (drillDiameterMm !== undefined) {
			return Math.max(
				part.geometry.innerDiameterMm,
				drillDiameterMm - STOMPBOX_DC_JACK_HOLE_BACKING_INSET_MM,
			);
		}
		return part.geometry.innerDiameterMm;
	}
	return part.geometry.innerDiameterMm;
}

function holeBackingMaterialIndex(state: GltfMergeState): number {
	const existingIndex = state.materials.findIndex(
		(material) => material.name === "hole-backing/material",
	);
	if (existingIndex >= 0) {
		return existingIndex;
	}
	const materialIndex = state.materials.length;
	state.materials.push({
		name: "hole-backing/material",
		doubleSided: true,
		pbrMetallicRoughness: {
			baseColorFactor: [0, 0, 0, 1],
			metallicFactor: 0,
			roughnessFactor: 1,
		},
		extras: {
			kind: "hole-backing-material",
		},
	});
	return materialIndex;
}

function appendDiscPositionAccessor(
	state: GltfMergeState,
	radiusMm: number,
	zMm: number,
): number {
	const segmentCount = 48;
	const positions = new Float32Array((segmentCount + 1) * 3);
	positions[0] = 0;
	positions[1] = 0;
	positions[2] = zMm;
	for (let index = 0; index < segmentCount; index += 1) {
		const angle = (Math.PI * 2 * index) / segmentCount;
		const offset = (index + 1) * 3;
		positions[offset] = Math.cos(angle) * radiusMm;
		positions[offset + 1] = Math.sin(angle) * radiusMm;
		positions[offset + 2] = zMm;
	}
	const bufferViewIndex = state.bufferViews.length;
	state.bufferViews.push({
		buffer: 0,
		byteOffset: appendBinaryChunk(state, typedArrayBytes(positions)),
		byteLength: positions.byteLength,
		target: 34962,
	});
	const accessorIndex = state.accessors.length;
	state.accessors.push({
		bufferView: bufferViewIndex,
		componentType: 5126,
		count: segmentCount + 1,
		type: "VEC3",
		min: [-radiusMm, -radiusMm, zMm],
		max: [radiusMm, radiusMm, zMm],
	});
	return accessorIndex;
}

function appendDiscIndexAccessor(state: GltfMergeState): number {
	const segmentCount = 48;
	const indices = new Uint16Array(segmentCount * 3);
	for (let index = 0; index < segmentCount; index += 1) {
		const offset = index * 3;
		indices[offset] = 0;
		indices[offset + 1] = index + 1;
		indices[offset + 2] = index === segmentCount - 1 ? 1 : index + 2;
	}
	const bufferViewIndex = state.bufferViews.length;
	state.bufferViews.push({
		buffer: 0,
		byteOffset: appendBinaryChunk(state, typedArrayBytes(indices)),
		byteLength: indices.byteLength,
		target: 34963,
	});
	const accessorIndex = state.accessors.length;
	state.accessors.push({
		bufferView: bufferViewIndex,
		componentType: 5123,
		count: indices.length,
		type: "SCALAR",
	});
	return accessorIndex;
}

function appendDecalPositionAccessor(
	state: GltfMergeState,
	sizeMm: StompboxSize2,
): number {
	const halfWidth = sizeMm.widthMm / 2;
	const halfHeight = sizeMm.heightMm / 2;
	const positions = new Float32Array([
		-halfWidth,
		-halfHeight,
		0,
		halfWidth,
		-halfHeight,
		0,
		halfWidth,
		halfHeight,
		0,
		-halfWidth,
		halfHeight,
		0,
	]);
	const bufferViewIndex = state.bufferViews.length;
	state.bufferViews.push({
		buffer: 0,
		byteOffset: appendBinaryChunk(state, typedArrayBytes(positions)),
		byteLength: positions.byteLength,
		target: 34962,
	});
	const accessorIndex = state.accessors.length;
	state.accessors.push({
		bufferView: bufferViewIndex,
		componentType: 5126,
		count: 4,
		type: "VEC3",
		min: [-halfWidth, -halfHeight, 0],
		max: [halfWidth, halfHeight, 0],
	});
	return accessorIndex;
}

function appendDecalIndexAccessor(state: GltfMergeState): number {
	const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
	const bufferViewIndex = state.bufferViews.length;
	state.bufferViews.push({
		buffer: 0,
		byteOffset: appendBinaryChunk(state, typedArrayBytes(indices)),
		byteLength: indices.byteLength,
		target: 34963,
	});
	const accessorIndex = state.accessors.length;
	state.accessors.push({
		bufferView: bufferViewIndex,
		componentType: 5123,
		count: 6,
		type: "SCALAR",
	});
	return accessorIndex;
}

function decalTransform(
	decal: StompboxPreviewDecal,
	enclosure: StompboxPreviewEnclosure,
): Readonly<{
	translationMm: StompboxPoint3;
	rotationDeg: StompboxRotationDeg;
}> {
	const translation = decalTranslationForFace(decal, enclosure);
	const rotation = decalBaseRotationForFace(decal.face);
	return {
		translationMm: translation,
		rotationDeg: {
			...rotation,
			z: rotation.z + decal.rotationDeg,
		},
	};
}

function decalTranslationForFace(
	decal: StompboxPreviewDecal,
	enclosure: StompboxPreviewEnclosure,
): StompboxPoint3 {
	const { widthMm, lengthMm, depthMm } = enclosure.dimensionsMm;
	const center = decalFaceLocalCenterMm(decal);
	if (decal.face === "left") {
		return {
			x: -widthMm / 2 - STOMPBOX_DECAL_OUTSET_MM,
			y: center.y,
			z: center.x,
		};
	}
	if (decal.face === "right") {
		return {
			x: widthMm / 2 + STOMPBOX_DECAL_OUTSET_MM,
			y: center.y,
			z: center.x,
		};
	}
	if (decal.face === "back") {
		return {
			x: center.x,
			y: lengthMm / 2 + STOMPBOX_DECAL_OUTSET_MM,
			z: center.y,
		};
	}
	if (decal.face === "bottom") {
		return {
			x: center.x,
			y: -lengthMm / 2 - STOMPBOX_DECAL_OUTSET_MM,
			z: center.y,
		};
	}
	return {
		x: center.x,
		y: center.y,
		z: depthMm / 2 + STOMPBOX_DECAL_OUTSET_MM,
	};
}

function decalBaseRotationForFace(face: StompboxFaceId): StompboxRotationDeg {
	if (face === "bottom") {
		return { x: 90, y: 0, z: 0 };
	}
	return baseRotationForFace(face);
}

function decalFaceLocalCenterMm(decal: StompboxPreviewDecal): StompboxPoint2 {
	if (
		(decal.face === "left" || decal.face === "right") &&
		!decalUsesFaceLocalCoordinates(decal)
	) {
		return { x: 0, y: decal.centerMm.y };
	}
	return decal.centerMm;
}

function hexColorToRgb(color: string): readonly [number, number, number] {
	const match = /^#([0-9a-f]{6})$/i.exec(color);
	if (match?.[1] === undefined) {
		return [0.067, 0.094, 0.153];
	}
	const value = match[1];
	return [
		Number.parseInt(value.slice(0, 2), 16) / 255,
		Number.parseInt(value.slice(2, 4), 16) / 255,
		Number.parseInt(value.slice(4, 6), 16) / 255,
	];
}

function typedArrayBytes(array: Float32Array | Uint16Array): Uint8Array {
	return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function appendAssemblySource(
	state: GltfMergeState,
	source: GltfAssemblySource,
): number {
	state.sourceAssets.push({
		id: source.id,
		kind: source.kind,
		glb: source.displayGlb,
		step: source.displayStep,
	});
	const wrapperIndex = state.nodes.length;
	const wrapper: MutableJsonObject = {
		name: `${source.kind === "enclosure" ? "enclosure" : "part"}-${source.id}`,
		translation: source.transform.translation,
		rotation: source.transform.rotation,
		...(source.transform.scale === undefined
			? {}
			: { scale: source.transform.scale }),
		children: [],
		extras: source.extras,
	};
	state.nodes.push(wrapper);

	const sourceScaleIndex = state.nodes.length;
	const sourceScaleNode: MutableJsonObject = {
		name: `source-${source.id}`,
		scale: [1000, 1000, 1000],
		children: [],
		extras: {
			sourceGlb: source.displayGlb,
			sourceUnits: "m",
			outputUnits: "mm",
		},
	};
	state.nodes.push(sourceScaleNode);
	wrapper.children = [sourceScaleIndex];
	sourceScaleNode.children = appendSourceGlb(state, source);
	return wrapperIndex;
}

function appendSourceGlb(
	state: GltfMergeState,
	source: GltfAssemblySource,
): readonly number[] {
	const parsed = parseGlbFile(source.localGlbPath, source.readAssetFile);
	const bufferOffset = appendBinaryChunk(
		state,
		parsed.binary.slice(0, parsed.bufferByteLength),
	);
	const sourceMaterials = jsonObjectArray(parsed.json, "materials");
	const bufferViewOffset = state.bufferViews.length;
	const accessorOffset = state.accessors.length;
	const materialOffset = state.materials.length;
	const meshOffset = state.meshes.length;
	const nodeOffset = state.nodes.length;

	for (const material of sourceMaterials) {
		state.materials.push(
			applyGltfMaterialAppearance(
				prefixNamedObject(material, `${source.id}/`),
				source.material,
			),
		);
	}
	for (const bufferView of jsonObjectArray(parsed.json, "bufferViews")) {
		state.bufferViews.push(remapBufferView(bufferView, bufferOffset));
	}
	for (const accessor of jsonObjectArray(parsed.json, "accessors")) {
		state.accessors.push(remapAccessor(accessor, bufferViewOffset));
	}
	for (const mesh of jsonObjectArray(parsed.json, "meshes")) {
		const target = materialTargetForMesh(source, mesh);
		state.meshes.push(
			remapMesh(
				mesh,
				accessorOffset,
				materialOffset,
				`${source.id}/`,
				target === undefined
					? undefined
					: (primitive) =>
							appendTargetMaterial(
								state,
								source,
								mesh,
								primitive,
								sourceMaterials,
								target,
							),
			),
		);
	}
	for (const node of jsonObjectArray(parsed.json, "nodes")) {
		state.nodes.push(remapNode(node, nodeOffset, meshOffset, `${source.id}/`));
	}
	return sourceSceneRootNodeIndexes(parsed.json).map(
		(nodeIndex) => nodeIndex + nodeOffset,
	);
}

function applyGltfMaterialAppearance(
	material: MutableJsonObject,
	appearance: StompboxPreviewMaterial | undefined,
): MutableJsonObject {
	if (appearance === undefined) {
		return material;
	}
	const pbr = {
		...(jsonObjectValue(material.pbrMetallicRoughness) ?? {}),
	} as MutableJsonObject;
	if (appearance.color !== undefined || appearance.opacity !== undefined) {
		const color = hexColorToRgb(appearance.color ?? "#0f172a");
		pbr.baseColorFactor = [...color, appearance.opacity ?? 1];
	}
	if (appearance.metallicFactor !== undefined) {
		pbr.metallicFactor = appearance.metallicFactor;
	}
	if (appearance.roughnessFactor !== undefined) {
		pbr.roughnessFactor = appearance.roughnessFactor;
	}
	if (Object.keys(pbr).length > 0) {
		material.pbrMetallicRoughness = pbr;
	}
	if (appearance.emissive === true) {
		const color = hexColorToRgb(appearance.color ?? "#ef4444");
		const intensity = appearance.intensity ?? 1;
		material.emissiveFactor = color.map((channel) => channel * intensity);
	}
	if (appearance.color !== undefined) {
		material.extras = {
			...(jsonObjectValue(material.extras) ?? {}),
			appearanceMaterial: previewMaterialJson(appearance),
			renderColorMode: "flat-color",
		};
	}
	return material;
}

function materialTargetForMesh(
	source: GltfAssemblySource,
	mesh: JsonObject,
): GltfMaterialTarget | undefined {
	const meshName = typeof mesh.name === "string" ? mesh.name : "";
	return source.materialTargets?.find((target) =>
		meshName.includes(target.meshNameIncludes),
	);
}

function appendTargetMaterial(
	state: GltfMergeState,
	source: GltfAssemblySource,
	mesh: JsonObject,
	primitive: JsonObject,
	sourceMaterials: readonly JsonObject[],
	target: GltfMaterialTarget,
): number {
	const sourceMaterial =
		typeof primitive.material === "number"
			? sourceMaterials[primitive.material]
			: undefined;
	const material = cloneJsonObject(sourceMaterial ?? {});
	const meshName = typeof mesh.name === "string" ? mesh.name : "unnamed";
	material.name = `${source.id}/${meshName}/material`;
	const materialIndex = state.materials.length;
	state.materials.push(applyGltfMaterialAppearance(material, target.material));
	return materialIndex;
}

function remapBufferView(
	bufferView: JsonObject,
	byteOffset: number,
): MutableJsonObject {
	const copy = cloneJsonObject(bufferView);
	copy.buffer = 0;
	copy.byteOffset = numberValue(copy.byteOffset) + byteOffset;
	return copy;
}

function remapAccessor(
	accessor: JsonObject,
	bufferViewOffset: number,
): MutableJsonObject {
	const copy = cloneJsonObject(accessor);
	const bufferView = numberValue(copy.bufferView);
	copy.bufferView = bufferView + bufferViewOffset;
	return copy;
}

function remapMesh(
	mesh: JsonObject,
	accessorOffset: number,
	materialOffset: number,
	namePrefix: string,
	materialForPrimitive?: (
		primitive: JsonObject,
		primitiveIndex: number,
	) => number,
): MutableJsonObject {
	const copy = prefixNamedObject(mesh, namePrefix);
	const primitives = jsonObjectArray(mesh, "primitives").map(
		(primitive, primitiveIndex) =>
			remapPrimitive(
				primitive,
				accessorOffset,
				materialOffset,
				materialForPrimitive?.(primitive, primitiveIndex),
			),
	);
	copy.primitives = primitives;
	return copy;
}

function remapPrimitive(
	primitive: JsonObject,
	accessorOffset: number,
	materialOffset: number,
	materialIndex?: number,
): MutableJsonObject {
	const copy = cloneJsonObject(primitive);
	const attributes = jsonObjectValue(primitive.attributes);
	if (attributes !== undefined) {
		copy.attributes = remapAccessorMap(attributes, accessorOffset);
	}
	const indices = numberValue(copy.indices);
	if (copy.indices !== undefined) {
		copy.indices = indices + accessorOffset;
	}
	const material = numberValue(copy.material);
	if (copy.material !== undefined) {
		copy.material = materialIndex ?? material + materialOffset;
	}
	const targets = jsonArrayValue(primitive.targets);
	if (targets !== undefined) {
		copy.targets = targets.map((target) =>
			jsonObjectValue(target) === undefined
				? target
				: remapAccessorMap(jsonObjectValue(target) ?? {}, accessorOffset),
		);
	}
	return copy;
}

function remapAccessorMap(
	map: JsonObject,
	accessorOffset: number,
): MutableJsonObject {
	const copy: MutableJsonObject = {};
	for (const [key, value] of Object.entries(map)) {
		copy[key] =
			typeof value === "number"
				? value + accessorOffset
				: cloneJsonValue(value);
	}
	return copy;
}

function remapNode(
	node: JsonObject,
	nodeOffset: number,
	meshOffset: number,
	namePrefix: string,
): MutableJsonObject {
	const copy = prefixNamedObject(node, namePrefix);
	if (copy.mesh !== undefined) {
		copy.mesh = numberValue(copy.mesh) + meshOffset;
	}
	const children = jsonArrayValue(copy.children);
	if (children !== undefined) {
		copy.children = children.flatMap((child) =>
			typeof child === "number" ? [child + nodeOffset] : [],
		);
	}
	return copy;
}

function prefixNamedObject(
	object: JsonObject,
	namePrefix: string,
): MutableJsonObject {
	const copy = cloneJsonObject(object);
	const name = typeof copy.name === "string" ? copy.name : "unnamed";
	copy.name = `${namePrefix}${name}`;
	return copy;
}

function sourceSceneRootNodeIndexes(json: JsonObject): readonly number[] {
	const sceneIndex = numberValue(json.scene);
	const scenes = jsonObjectArray(json, "scenes");
	const scene = scenes[sceneIndex] ?? scenes[0];
	if (scene === undefined) {
		return jsonObjectArray(json, "nodes").map((_node, index) => index);
	}
	const nodes = jsonArrayValue(scene.nodes);
	if (nodes === undefined) {
		return [];
	}
	return nodes.flatMap((node) => (typeof node === "number" ? [node] : []));
}

function parseGlbFile(
	path: string,
	readAssetFile: StompboxAssetFileReader,
): ParsedGlb {
	const bytes = readAssetFile(path);
	return parseGlbBytes(bytes, path);
}

function parseGlbBytes(bytes: Uint8Array, context: string): ParsedGlb {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
		throw new Error(`not a glTF 2.0 binary file: ${context}`);
	}
	let json: JsonObject | undefined;
	let binary = new Uint8Array();
	let offset = 12;
	while (offset < bytes.byteLength) {
		const chunkLength = view.getUint32(offset, true);
		const chunkType = view.getUint32(offset + 4, true);
		const chunkStart = offset + 8;
		const chunk = bytes.slice(chunkStart, chunkStart + chunkLength);
		if (chunkType === 0x4e4f534a) {
			json = parseJsonObject(new TextDecoder().decode(chunk).trim(), context);
		} else if (chunkType === 0x004e4942) {
			binary = chunk;
		}
		offset = chunkStart + chunkLength;
	}
	if (json === undefined) {
		throw new Error(`GLB file has no JSON chunk: ${context}`);
	}
	return {
		json,
		binary,
		bufferByteLength: sourceBufferByteLength(json, binary),
	};
}

function sourceBufferByteLength(json: JsonObject, binary: Uint8Array): number {
	const buffers = jsonObjectArray(json, "buffers");
	const first = buffers[0];
	const byteLength = first === undefined ? 0 : numberValue(first.byteLength);
	if (byteLength > 0) {
		return Math.min(byteLength, binary.byteLength);
	}
	return binary.byteLength;
}

function appendBinaryChunk(state: GltfMergeState, bytes: Uint8Array): number {
	const alignedOffset = align4(state.binaryByteLength);
	if (alignedOffset > state.binaryByteLength) {
		state.binaryParts.push(
			new Uint8Array(alignedOffset - state.binaryByteLength),
		);
		state.binaryByteLength = alignedOffset;
	}
	const offset = state.binaryByteLength;
	state.binaryParts.push(bytes);
	state.binaryByteLength += bytes.byteLength;
	return offset;
}

function concatUint8Arrays(
	parts: readonly Uint8Array[],
	totalLength: number,
): Uint8Array {
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function parseJsonObject(source: string, context: string): JsonObject {
	const parsed: unknown = JSON.parse(source);
	if (!isUnknownRecord(parsed)) {
		throw new Error(`GLB JSON chunk is not an object: ${context}`);
	}
	return parsed as JsonObject;
}

function jsonObjectArray(
	object: JsonObject,
	key: string,
): readonly JsonObject[] {
	const value = object[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) =>
		jsonObjectValue(item) === undefined ? [] : [jsonObjectValue(item) ?? {}],
	);
}

function jsonArrayValue(
	value: JsonValue | undefined,
): readonly JsonValue[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject | undefined {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as JsonObject;
	}
	return undefined;
}

function numberValue(value: JsonValue | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cloneJsonObject(value: JsonObject): MutableJsonObject {
	const copy: MutableJsonObject = {};
	for (const [key, child] of Object.entries(value)) {
		copy[key] = cloneJsonValue(child);
	}
	return copy;
}

function cloneJsonValue(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map((item) => cloneJsonValue(item));
	}
	if (typeof value === "object" && value !== null) {
		return cloneJsonObject(value as JsonObject);
	}
	return value;
}

function isUnknownRecord(
	value: unknown,
): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeGlb(document: GltfDocument, binary: Uint8Array): Uint8Array {
	const encoder = new TextEncoder();
	const jsonBytes = encoder.encode(JSON.stringify(document));
	const paddedJsonLength = align4(jsonBytes.byteLength);
	const paddedBinaryLength = align4(binary.byteLength);
	const bytes = new Uint8Array(
		12 + 8 + paddedJsonLength + 8 + paddedBinaryLength,
	);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, bytes.byteLength, true);
	view.setUint32(12, paddedJsonLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	bytes.set(jsonBytes, 20);
	bytes.fill(0x20, 20 + jsonBytes.byteLength, 20 + paddedJsonLength);
	const binaryHeaderOffset = 20 + paddedJsonLength;
	view.setUint32(binaryHeaderOffset, paddedBinaryLength, true);
	view.setUint32(binaryHeaderOffset + 4, 0x004e4942, true);
	bytes.set(binary, binaryHeaderOffset + 8);
	return bytes;
}

function align4(value: number): number {
	return Math.ceil(value / 4) * 4;
}

function point3Array(point: StompboxPoint3): readonly number[] {
	return [
		roundGltfNumber(point.x),
		roundGltfNumber(point.y),
		roundGltfNumber(point.z),
	];
}

function quaternionFromEulerDeg(
	rotation: StompboxRotationDeg,
): readonly number[] {
	const x = radians(rotation.x) / 2;
	const y = radians(rotation.y) / 2;
	const z = radians(rotation.z) / 2;
	const sx = Math.sin(x);
	const cx = Math.cos(x);
	const sy = Math.sin(y);
	const cy = Math.cos(y);
	const sz = Math.sin(z);
	const cz = Math.cos(z);
	return [
		roundGltfNumber(sx * cy * cz + cx * sy * sz),
		roundGltfNumber(cx * sy * cz - sx * cy * sz),
		roundGltfNumber(cx * cy * sz + sx * sy * cz),
		roundGltfNumber(cx * cy * cz - sx * sy * sz),
	];
}

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function svgAttributes(
	attributes: readonly (readonly [string, SvgAttributeValue])[],
): string {
	return attributes
		.flatMap(([name, value]) =>
			value === undefined
				? []
				: [`${name}="${escapeAttribute(String(value))}"`],
		)
		.join(" ");
}

function escapeText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
	return escapeText(value).replaceAll('"', "&quot;");
}

function svgDataUri(svg: string): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function colorizedSvg(svg: string, color: string | undefined): string {
	return color === undefined ? svg : svg.replaceAll("currentColor", color);
}

function svgNumber(value: number): string {
	const rounded = Math.round(value * 1_000_000) / 1_000_000;
	if (Object.is(rounded, -0)) {
		return "0";
	}
	return String(rounded);
}

function roundGltfNumber(value: number): number {
	const rounded = Math.round(value * 1_000_000) / 1_000_000;
	if (Object.is(rounded, -0)) {
		return 0;
	}
	return rounded;
}

function templateHole(
	hole: StompboxDrillHole,
	enclosure: StompboxEnclosureProfile,
	canvasMm: Readonly<{ widthMm: number; heightMm: number }>,
): StompboxDrillTemplateHole {
	const layout = outsideDrillTemplateLayout(enclosure, canvasMm);
	return {
		...hole,
		templateCenterMm: drillTemplateCenter(hole, layout, enclosure),
	};
}

function drillTemplateCenter(
	hole: StompboxDrillHole,
	layout: DrillTemplateOutsideLayout,
	enclosure: StompboxEnclosureProfile,
): StompboxPoint2 {
	return drillTemplateCenterForPlacement(
		hole.face,
		hole.centerMm,
		layout,
		enclosure,
	);
}

function drillTemplateCenterForPlacement(
	face: StompboxFaceId,
	centerMm: StompboxPoint2,
	layout: DrillTemplateOutsideLayout,
	enclosure: StompboxEnclosureProfile,
): StompboxPoint2 {
	const { widthMm, lengthMm, depthMm } = enclosure.dimensionsMm;
	if (face === "left") {
		const panel = layout.panels.left;
		return {
			x: panel.x + depthMm / 2,
			y: panel.y + lengthMm / 2 - centerMm.y,
		};
	}
	if (face === "right") {
		const panel = layout.panels.right;
		return {
			x: panel.x + depthMm / 2,
			y: panel.y + lengthMm / 2 - centerMm.y,
		};
	}
	if (face === "back") {
		const panel = layout.panels.back;
		return {
			x: panel.x + widthMm / 2 + centerMm.x,
			y: panel.y + depthMm / 2 - centerMm.y,
		};
	}

	const panel = layout.panels.top;
	return {
		x: panel.x + widthMm / 2 + centerMm.x,
		y: panel.y + lengthMm / 2 - centerMm.y,
	};
}

function drillTemplateCenterForDecal(
	face: StompboxFaceId,
	centerMm: StompboxPoint2,
	layout: DrillTemplateOutsideLayout,
	enclosure: StompboxEnclosureProfile,
): StompboxPoint2 {
	const { widthMm, lengthMm, depthMm } = enclosure.dimensionsMm;
	if (face === "left") {
		const panel = layout.panels.left;
		return {
			x: panel.x + depthMm / 2 + centerMm.x,
			y: panel.y + lengthMm / 2 - centerMm.y,
		};
	}
	if (face === "right") {
		const panel = layout.panels.right;
		return {
			x: panel.x + depthMm / 2 + centerMm.x,
			y: panel.y + lengthMm / 2 - centerMm.y,
		};
	}
	if (face === "back") {
		const panel = layout.panels.back;
		return {
			x: panel.x + widthMm / 2 + centerMm.x,
			y: panel.y + depthMm / 2 - centerMm.y,
		};
	}
	if (face === "bottom") {
		const panel = layout.panels.bottom;
		return {
			x: panel.x + widthMm / 2 + centerMm.x,
			y: panel.y + depthMm / 2 - centerMm.y,
		};
	}
	const panel = layout.panels.top;
	return {
		x: panel.x + widthMm / 2 + centerMm.x,
		y: panel.y + lengthMm / 2 - centerMm.y,
	};
}

function unfoldedDrillTemplateSize(
	enclosure: StompboxEnclosureProfile,
): Readonly<{ widthMm: number; heightMm: number }> {
	const { widthMm, lengthMm, depthMm } = enclosure.dimensionsMm;
	return {
		widthMm: widthMm + depthMm * 2,
		heightMm: lengthMm + depthMm * 2,
	};
}

function outsideDrillTemplateLayout(
	enclosure: StompboxEnclosureProfile,
	canvasMm: Readonly<{ widthMm: number; heightMm: number }>,
): DrillTemplateOutsideLayout {
	const { widthMm, lengthMm, depthMm } = enclosure.dimensionsMm;
	const unfolded = unfoldedDrillTemplateSize(enclosure);
	const x = canvasMm.widthMm / 2 - unfolded.widthMm / 2;
	const y = canvasMm.heightMm / 2 - unfolded.heightMm / 2;
	const top: DrillTemplatePanel = {
		id: "top",
		x: x + depthMm,
		y: y + depthMm,
		width: widthMm,
		height: lengthMm,
	};
	return {
		widthMm: unfolded.widthMm,
		heightMm: unfolded.heightMm,
		panels: {
			top,
			left: {
				id: "left",
				x,
				y: top.y,
				width: depthMm,
				height: lengthMm,
			},
			right: {
				id: "right",
				x: top.x + widthMm,
				y: top.y,
				width: depthMm,
				height: lengthMm,
			},
			back: {
				id: "back",
				x: top.x,
				y,
				width: widthMm,
				height: depthMm,
			},
			bottom: {
				id: "bottom",
				x: top.x,
				y: top.y + lengthMm,
				width: widthMm,
				height: depthMm,
			},
		},
	};
}

function placementGrid(
	enclosure: StompboxEnclosureProfile,
): StompboxPlacementGrid {
	const { widthMm, lengthMm } = enclosure.dimensionsMm;
	const rowCount = Math.max(
		1,
		Math.floor(lengthMm / STOMPBOX_GRID_TARGET_ROW_PITCH_MM),
	);
	const usableLengthMm = Math.max(
		0,
		lengthMm - STOMPBOX_GRID_EDGE_MARGIN_MM * 2,
	);
	return {
		edgeMarginMm: STOMPBOX_GRID_EDGE_MARGIN_MM,
		widthMm,
		lengthMm,
		usableWidthMm: Math.max(0, widthMm - STOMPBOX_GRID_EDGE_MARGIN_MM * 2),
		usableLengthMm,
		rowCount,
		rowPitchMm: roundMillimeters(usableLengthMm / rowCount),
	};
}

function autoKnobGrid(
	count: number,
	grid: StompboxPlacementGrid,
	placementStyle: ResolvedStompboxPlacementStyle,
	hardwareProfile: StompboxHardwareProfile,
): AutoKnobGrid {
	if (count <= 0) {
		return {
			placements: [],
		};
	}
	if (placementStyle.knobGrid === "compact-led-row") {
		return compactLedKnobGrid(count, grid, placementStyle, hardwareProfile);
	}
	return largeMergedKnobGrid(count, grid, placementStyle, hardwareProfile);
}

function compactLedKnobGrid(
	count: number,
	grid: StompboxPlacementGrid,
	placementStyle: ResolvedStompboxPlacementStyle,
	hardwareProfile: StompboxHardwareProfile,
): AutoKnobGrid {
	const largeKnobPartId = placementStyle.defaultPartIds.largeKnob;
	const smallKnobPartId = placementStyle.defaultPartIds.smallKnob;
	const largeKnobDiameterMm = defaultPartVisibleDiameterMm(
		hardwareProfile,
		placementStyle.defaultPartIds,
		"largeKnob",
		STOMPBOX_LARGE_KNOB_DIAMETER_MM,
	);
	const smallKnobDiameterMm = defaultPartVisibleDiameterMm(
		hardwareProfile,
		placementStyle.defaultPartIds,
		"smallKnob",
		STOMPBOX_SMALL_KNOB_DIAMETER_MM,
	);
	const rowOneY = gridRowCenterY(grid, 1);
	const oneRowKnobY = gridMergedRowCenterY(grid, 1, 2);
	if (count === 2) {
		const rowPart = twoColumnKnobChoice(
			grid,
			hardwareProfile,
			placementStyle.defaultPartIds,
		);
		return {
			placements: rowKnobPlacements(
				rowPart.partId,
				knobColumnCenters(grid, 2, rowPart.diameterMm),
				oneRowKnobY,
			),
		};
	}
	if (count === 3) {
		const firstRowPart = twoColumnKnobChoice(
			grid,
			hardwareProfile,
			placementStyle.defaultPartIds,
		);
		const firstRowXCenters = knobColumnCenters(
			grid,
			2,
			firstRowPart.diameterMm,
		);
		return {
			placements: [
				...rowKnobPlacements(
					firstRowPart.partId,
					firstRowXCenters,
					compactLedFirstKnobRowY(
						grid,
						firstRowPart.partId,
						firstRowXCenters,
						hardwareProfile,
						placementStyle,
					),
				),
				{
					partId: smallKnobPartId,
					centerMm: { x: 0, y: gridRowCenterY(grid, 2) },
				},
			],
		};
	}
	if (count === 4) {
		if (
			smallKnobColumnLimit(
				grid,
				hardwareProfile,
				placementStyle.defaultPartIds,
			) >= 4
		) {
			const rowDiameterMm = smallKnobDiameterMm + 0.1;
			return {
				placements: rowKnobPlacements(
					smallKnobPartId,
					knobColumnCenters(grid, 4, rowDiameterMm),
					oneRowKnobY,
				),
			};
		}
		const twoColumnCenters = knobColumnCenters(grid, 2, smallKnobDiameterMm);
		return {
			placements: [
				...rowKnobPlacements(smallKnobPartId, twoColumnCenters, rowOneY),
				...rowKnobPlacements(
					smallKnobPartId,
					twoColumnCenters,
					gridRowCenterY(grid, 2),
				),
			],
		};
	}
	throw new Error(
		`unsupported compact-led-row stompbox layout for ${count} knobs`,
	);
}

function compactLedFirstKnobRowY(
	grid: StompboxPlacementGrid,
	knobPartId: string,
	xCenters: readonly number[],
	hardwareProfile: StompboxHardwareProfile,
	placementStyle: ResolvedStompboxPlacementStyle,
): number {
	const defaultY = gridRowCenterY(grid, 1);
	const ledRadiusMm =
		(partProfileVisibleDiameterMm(
			hardwareProfile,
			placementStyle.defaultPartIds.led,
		) ?? 0) / 2;
	const knobRadiusMm =
		(partProfileVisibleDiameterMm(hardwareProfile, knobPartId) ?? 0) / 2;
	const nearestHorizontalMm = Math.min(...xCenters.map((x) => Math.abs(x)));
	const combinedRadiusMm = ledRadiusMm + knobRadiusMm;
	const requiredVerticalMm =
		Math.sqrt(
			Math.max(
				0,
				combinedRadiusMm * combinedRadiusMm -
					nearestHorizontalMm * nearestHorizontalMm,
			),
		) + 0.25;
	return roundMillimeters(
		Math.min(
			defaultY,
			topEdgeLedY(grid, hardwareProfile, placementStyle.defaultPartIds) -
				requiredVerticalMm,
		),
	);
}

function largeMergedKnobGrid(
	count: number,
	grid: StompboxPlacementGrid,
	placementStyle: ResolvedStompboxPlacementStyle,
	hardwareProfile: StompboxHardwareProfile,
): AutoKnobGrid {
	const largeKnobPartId = placementStyle.defaultPartIds.largeKnob;
	const smallKnobPartId = placementStyle.defaultPartIds.smallKnob;
	const largeKnobDiameterMm = defaultPartVisibleDiameterMm(
		hardwareProfile,
		placementStyle.defaultPartIds,
		"largeKnob",
		STOMPBOX_LARGE_KNOB_DIAMETER_MM,
	);
	const smallKnobDiameterMm = defaultPartVisibleDiameterMm(
		hardwareProfile,
		placementStyle.defaultPartIds,
		"smallKnob",
		STOMPBOX_SMALL_KNOB_DIAMETER_MM,
	);
	const rowOneY = gridRowCenterY(grid, 1);
	const rowTwoY = gridRowCenterY(grid, 2);
	const upperMergedRowY = gridMergedRowCenterY(grid, 1, 2);
	if (count === 1) {
		return {
			placements: [
				{ partId: largeKnobPartId, centerMm: { x: 0, y: upperMergedRowY } },
			],
		};
	}
	if (count === 2) {
		const rowPart = twoColumnKnobChoice(
			grid,
			hardwareProfile,
			placementStyle.defaultPartIds,
		);
		return {
			placements: rowKnobPlacements(
				rowPart.partId,
				knobColumnCenters(grid, 2, rowPart.diameterMm),
				upperMergedRowY,
			),
		};
	}
	if (count === 3) {
		return {
			placements: [
				{ partId: smallKnobPartId, centerMm: { x: 0, y: rowOneY } },
				...rowKnobPlacements(
					smallKnobPartId,
					knobColumnCenters(grid, 2, smallKnobDiameterMm),
					rowTwoY,
				),
			],
		};
	}
	if (count === 4) {
		const twoColumnCenters = knobColumnCenters(grid, 2, smallKnobDiameterMm);
		return {
			placements: [
				...rowKnobPlacements(smallKnobPartId, twoColumnCenters, rowOneY),
				...rowKnobPlacements(smallKnobPartId, twoColumnCenters, rowTwoY),
			],
		};
	}
	if (count === 5) {
		return {
			placements: [
				...rowKnobPlacements(
					smallKnobPartId,
					knobColumnCenters(grid, 2, smallKnobDiameterMm),
					rowOneY,
				),
				...rowKnobPlacements(
					smallKnobPartId,
					knobColumnCenters(grid, 3, smallKnobDiameterMm),
					rowTwoY,
				),
			],
		};
	}
	if (count === 6) {
		const threeColumnCenters = knobColumnCenters(grid, 3, smallKnobDiameterMm);
		return {
			placements: [
				...rowKnobPlacements(smallKnobPartId, threeColumnCenters, rowOneY),
				...rowKnobPlacements(smallKnobPartId, threeColumnCenters, rowTwoY),
			],
		};
	}
	const columns = Math.max(
		1,
		Math.min(
			smallKnobColumnLimit(
				grid,
				hardwareProfile,
				placementStyle.defaultPartIds,
			),
			count,
		),
	);
	const columnCenters = knobColumnCenters(grid, columns, smallKnobDiameterMm);
	return {
		placements: Array.from({ length: count }, (_unused, index) => {
			const x = columnCenters[index % columns] ?? 0;
			const row = Math.floor(index / columns);
			return {
				partId: smallKnobPartId,
				centerMm: {
					x,
					y: gridRowCenterY(grid, row + 1),
				},
			};
		}),
	};
}

function rowKnobPlacements(
	partId: string,
	xCenters: readonly number[],
	y: number,
): readonly AutoKnobPlacement[] {
	return xCenters.map((x) => ({
		partId,
		centerMm: { x, y },
	}));
}

function twoColumnKnobChoice(
	grid: StompboxPlacementGrid,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
): Readonly<{ partId: string; diameterMm: number }> {
	const choices = [
		{
			partId: defaultPartIds.largeKnob,
			diameterMm: defaultPartVisibleDiameterMm(
				hardwareProfile,
				defaultPartIds,
				"largeKnob",
				STOMPBOX_LARGE_KNOB_DIAMETER_MM,
			),
		},
		{
			partId: defaultPartIds.knob,
			diameterMm: defaultPartVisibleDiameterMm(
				hardwareProfile,
				defaultPartIds,
				"knob",
				STOMPBOX_SMALL_KNOB_DIAMETER_MM,
			),
		},
		{
			partId: defaultPartIds.smallKnob,
			diameterMm: defaultPartVisibleDiameterMm(
				hardwareProfile,
				defaultPartIds,
				"smallKnob",
				STOMPBOX_SMALL_KNOB_DIAMETER_MM,
			),
		},
	] as const;
	const fallback = choices[2];
	return (
		choices.find(
			(choice) => knobColumnLimitForDiameter(grid, choice.diameterMm) >= 2,
		) ?? fallback
	);
}

function lowerTopLedY(knobCount: number, grid: StompboxPlacementGrid): number {
	if ((knobCount === 1 || knobCount === 2) && grid.rowCount >= 3) {
		return gridRowLowerHalfCenterY(grid, 3);
	}
	return gridRowCenterY(grid, Math.min(3, grid.rowCount));
}

function topEdgeLedY(
	grid: StompboxPlacementGrid,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
): number {
	const ledRadiusMm =
		(partProfileVisibleDiameterMm(hardwareProfile, defaultPartIds.led) ??
			3.48) / 2;
	return roundMillimeters(gridTopInsetY(grid) - ledRadiusMm);
}

function footswitchGridY(
	knobCount: number,
	grid: StompboxPlacementGrid,
	placementStyle: ResolvedStompboxPlacementStyle,
): number {
	if (
		placementStyle.footswitch === "lower-row" &&
		(knobCount === 1 || knobCount === 2) &&
		grid.rowCount >= 4
	) {
		return gridRowCenterY(grid, 4);
	}
	if (placementStyle.footswitch === "bottom-merged-row" && grid.rowCount >= 5) {
		return gridMergedRowCenterY(grid, 4, 5);
	}
	return gridRowCenterY(grid, grid.rowCount);
}

function gridRowCenterY(grid: StompboxPlacementGrid, rowIndex: number): number {
	return roundMillimeters(
		grid.lengthMm / 2 - grid.edgeMarginMm - (rowIndex - 0.5) * grid.rowPitchMm,
	);
}

function gridMergedRowCenterY(
	grid: StompboxPlacementGrid,
	firstRowIndex: number,
	lastRowIndex: number,
): number {
	const rowSpan = lastRowIndex - firstRowIndex + 1;
	return roundMillimeters(
		grid.lengthMm / 2 -
			grid.edgeMarginMm -
			(firstRowIndex - 1) * grid.rowPitchMm -
			(rowSpan * grid.rowPitchMm) / 2,
	);
}

function gridRowLowerHalfCenterY(
	grid: StompboxPlacementGrid,
	rowIndex: number,
): number {
	return roundMillimeters(gridRowCenterY(grid, rowIndex) - grid.rowPitchMm / 4);
}

function gridTopInsetY(grid: StompboxPlacementGrid): number {
	return roundMillimeters(grid.lengthMm / 2 - grid.edgeMarginMm);
}

function knobColumnCenters(
	grid: StompboxPlacementGrid,
	columns: number,
	diameterMm: number,
): readonly number[] {
	if (columns <= 1) {
		return [0];
	}
	const columnWidth = grid.usableWidthMm / columns;
	const left = -grid.widthMm / 2 + grid.edgeMarginMm + columnWidth / 2;
	const cellCenters = Array.from({ length: columns }, (_unused, index) =>
		roundMillimeters(left + index * columnWidth),
	);
	const first = cellCenters[0] ?? 0;
	const last = cellCenters[cellCenters.length - 1] ?? 0;
	const requestedSpan = (columns - 1) * diameterMm;
	const cellSpan = last - first;
	if (requestedSpan > cellSpan + 0.001) {
		const expandedLeft = -requestedSpan / 2;
		return Array.from({ length: columns }, (_unused, index) =>
			roundMillimeters(expandedLeft + index * diameterMm),
		);
	}
	return cellCenters;
}

function largeKnobColumnLimit(
	grid: StompboxPlacementGrid,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
): number {
	const largeKnobDiameterMm = defaultPartVisibleDiameterMm(
		hardwareProfile,
		defaultPartIds,
		"largeKnob",
		STOMPBOX_LARGE_KNOB_DIAMETER_MM,
	);
	return knobColumnLimitForDiameter(grid, largeKnobDiameterMm);
}

function knobColumnLimitForDiameter(
	grid: StompboxPlacementGrid,
	diameterMm: number,
): number {
	return Math.max(
		1,
		Math.floor(
			grid.usableWidthMm /
				Math.max(STOMPBOX_LARGE_KNOB_MIN_PITCH_MM, diameterMm + 5),
		),
	);
}

function smallKnobColumnLimit(
	grid: StompboxPlacementGrid,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
): number {
	if (grid.widthMm >= STOMPBOX_1590B_MIN_WIDTH_MM) {
		return 4;
	}
	const smallKnobDiameterMm = defaultPartVisibleDiameterMm(
		hardwareProfile,
		defaultPartIds,
		"smallKnob",
		STOMPBOX_SMALL_KNOB_DIAMETER_MM,
	);
	return Math.max(1, Math.floor(grid.usableWidthMm / smallKnobDiameterMm));
}

function distributedTopRowPositions(
	count: number,
	y: number,
	spanMm: number,
): readonly StompboxPoint2[] {
	if (count <= 0) {
		return [];
	}
	if (count === 1) {
		return [{ x: 0, y }];
	}
	const spacing = spanMm / (count - 1);
	const left = -spanMm / 2;
	return Array.from({ length: count }, (_, index) => ({
		x: roundMillimeters(left + spacing * index),
		y,
	}));
}

function faceForJack(jack: JackPort): StompboxFaceId | undefined {
	if (jack.role === "input") {
		return "right";
	}
	if (jack.role === "output" || jack.role === "direct-output") {
		return "left";
	}
	return undefined;
}

function hasStatusLed(
	panel: Panel,
	declared: readonly PlacementCandidate[],
): boolean {
	return (
		panel.leds.length > 0 ||
		declared.some((candidate) => candidate.kind === "led")
	);
}

function hasBypassFootswitch(
	panel: Panel,
	declared: readonly PlacementCandidate[],
): boolean {
	return (
		panel.switches.some((switchControl) =>
			isSupportedFootswitch(switchControl),
		) ||
		declared.some(
			(candidate) =>
				candidate.kind === "footswitch" || candidate.kind === "switch",
		)
	);
}

function hasInputJack(
	panel: Panel,
	declared: readonly PlacementCandidate[],
): boolean {
	return (
		panel.jacks.some((jack) => jack.role === "input") ||
		declared.some(
			(candidate) => candidate.kind === "jack" && candidate.face === "right",
		)
	);
}

function hasOutputJack(
	panel: Panel,
	declared: readonly PlacementCandidate[],
): boolean {
	return (
		panel.jacks.some(
			(jack) => jack.role === "output" || jack.role === "direct-output",
		) ||
		declared.some(
			(candidate) => candidate.kind === "jack" && candidate.face === "left",
		)
	);
}

function hasPowerJack(
	declared: readonly PlacementCandidate[],
	candidates: readonly PlacementCandidate[],
	defaultPartIds: StompboxDefaultPartProfileIds,
): boolean {
	return [...declared, ...candidates].some(
		(candidate) => candidate.partId === defaultPartIds.dcJack,
	);
}

function isSupportedFootswitch(switchControl: SwitchControl): boolean {
	return (
		switchControl.switchKind === "3pdt" ||
		switchControl.partNumber?.toLowerCase().includes("3pdt") === true
	);
}

function centerForJackFace(
	face: StompboxFaceId,
	enclosure: StompboxEnclosureProfile,
	grid: StompboxPlacementGrid,
	placementStyle: ResolvedStompboxPlacementStyle,
	faceIndex = 0,
): StompboxPoint2 {
	const y =
		placementStyle.sideHardware === "back-power-paired-side-jacks"
			? pairedSideJackY(grid, faceIndex)
			: fiveSlotSideAudioJackY(grid, faceIndex);
	if (face === "right") {
		return { x: enclosure.dimensionsMm.widthMm / 2, y };
	}
	if (face === "left") {
		return { x: -enclosure.dimensionsMm.widthMm / 2, y };
	}
	if (face === "back") {
		return { x: 0, y: 0 };
	}
	return { x: 0, y: gridTopInsetY(grid) };
}

function powerJackFace(
	placementStyle: ResolvedStompboxPlacementStyle,
): StompboxFaceId {
	return placementStyle.sideHardware === "side-power-five-slot"
		? "right"
		: "back";
}

function centerForPowerJackFace(
	face: StompboxFaceId,
	enclosure: StompboxEnclosureProfile,
	grid: StompboxPlacementGrid,
	placementStyle: ResolvedStompboxPlacementStyle,
	hardwareProfile: StompboxHardwareProfile,
): StompboxPoint2 {
	if (
		placementStyle.sideHardware === "side-power-five-slot" &&
		face === "right"
	) {
		return {
			x: enclosure.dimensionsMm.widthMm / 2,
			y: fiveSlotPowerJackY(
				grid,
				hardwareProfile,
				placementStyle.defaultPartIds,
			),
		};
	}
	return centerForJackFace(face, enclosure, grid, placementStyle);
}

function pairedSideJackY(
	grid: StompboxPlacementGrid,
	faceIndex: number,
): number {
	const slotInPair = faceIndex % 2;
	const pairIndex = Math.floor(faceIndex / 2);
	const row = Math.min(3 + pairIndex, grid.rowCount);
	const rowCenterY = gridRowCenterY(grid, row);
	const rowHalfOffsetY = grid.rowPitchMm / 4;
	return roundMillimeters(
		rowCenterY + (slotInPair === 0 ? rowHalfOffsetY : -rowHalfOffsetY),
	);
}

function fiveSlotSideAudioJackY(
	grid: StompboxPlacementGrid,
	faceIndex: number,
): number {
	return roundMillimeters(
		fiveSlotCenterY(grid, 3) - (faceIndex * grid.lengthMm) / 5,
	);
}

function fiveSlotPowerJackY(
	grid: StompboxPlacementGrid,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
): number {
	const audioY = fiveSlotSideAudioJackY(grid, 0);
	const requestedCloseY = fiveSlotCenterY(grid, 4) + grid.lengthMm / 10;
	const minimumDistanceY =
		((partProfileVisibleDiameterMm(hardwareProfile, defaultPartIds.dcJack) ??
			14.1) +
			(partProfileVisibleDiameterMm(
				hardwareProfile,
				defaultPartIds.audioJack,
			) ?? 11)) /
		2;
	return roundMillimeters(Math.min(requestedCloseY, audioY - minimumDistanceY));
}

function fiveSlotCenterY(
	grid: StompboxPlacementGrid,
	slotIndex: number,
): number {
	return roundMillimeters(
		grid.lengthMm / 2 - ((slotIndex - 0.5) * grid.lengthMm) / 5,
	);
}

function controlIdForPanelElement(element: PanelElementPlacement): string {
	return (
		element.bind.controlId ??
		element.interfaceControlId ??
		element.bind.componentId
	);
}

function pointFromCorePoint(point: Point): StompboxPoint2 {
	return { x: point.x, y: point.y };
}

function defaultPartIdForPanelKind(
	kind: PanelControlKind,
	metadata: ControlVisualMetadata | undefined,
	defaultPartIds: StompboxDefaultPartProfileIds,
): string | undefined {
	switch (kind) {
		case "knob":
		case "selector":
			return defaultPartIds.knob;
		case "led":
			return defaultPartIds.led;
		case "switch":
		case "footswitch":
			return metadata?.switchKind === undefined ||
				metadata.switchKind === "3pdt"
				? defaultPartIds.footswitch
				: undefined;
		case "jack":
			return defaultPartIds.audioJack;
		case "slider":
			return undefined;
	}
}

type StompboxPartResolution = Readonly<{
	partId: string;
	partProvenance?: StompboxPartProvenance;
}>;

function knownPartIdOrDefault(
	requestedPartId: string | undefined,
	kind: PanelControlKind,
	metadata: ControlVisualMetadata | undefined,
	hardwareProfile: StompboxHardwareProfile,
	defaultPartIds: StompboxDefaultPartProfileIds,
	diagnostics: StompboxDiagnostic[],
	controlId: string,
	placementId: string | undefined,
): StompboxPartResolution | undefined {
	if (
		requestedPartId !== undefined &&
		hardwareProfile.partProfiles[requestedPartId] !== undefined
	) {
		return { partId: requestedPartId, partProvenance: "vdsp-declared" };
	}
	if (requestedPartId !== undefined) {
		diagnostics.push({
			code: "unknown-part-profile",
			message: `Unknown stompbox part profile "${requestedPartId}"`,
			controlId,
			...(placementId === undefined ? {} : { placementId }),
		});
	}
	const defaultPartId = defaultPartIdForPanelKind(kind, metadata, defaultPartIds);
	return defaultPartId === undefined
		? undefined
		: {
				partId: defaultPartId,
				...(requestedPartId === undefined
					? {}
					: { partProvenance: "defaulted" as const }),
			};
}

function placementIdForKind(kind: PanelControlKind, controlId: string): string {
	if (kind === "footswitch") {
		return `switch-${controlId}`;
	}
	return `${kind}-${controlId}`;
}

function assetResolveOptions(
	options: StompboxAssetResolveOptions,
): StompboxAssetResolveOptions {
	return {
		...(options.basePath === undefined ? {} : { basePath: options.basePath }),
		...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
	};
}

function joinAssetBase(base: string, relativePath: string): string {
	const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
	const normalizedPath = relativePath.startsWith("/")
		? relativePath.slice(1)
		: relativePath;
	return `${normalizedBase}/${normalizedPath}`;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
	if (min > max) {
		return (min + max) / 2;
	}
	return Math.max(min, Math.min(max, value));
}

function roundMillimeters(value: number): number {
	const rounded = Math.round(value * 1000) / 1000;
	return Object.is(rounded, -0) ? 0 : rounded;
}

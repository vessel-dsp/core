import {
    extractPanel,
    parseCircuitDocumentFile,
    type CircuitDocument,
    type ControlState,
    type JackPort,
    type Knob,
    type LedIndicator,
    type Panel,
    type PanelControlKind,
    type PanelElementPlacement,
    type PanelFace,
    type Point,
    type SliderControl,
    type SwitchControl,
} from '@vessel-dsp/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT = fileURLToPath(new URL('../assets/cad/parts', import.meta.url));

export type StompboxUnits = 'mm';
export type StompboxPlacementProvenance = 'vdsp-declared' | 'auto-generated';
export type StompboxFaceId = 'top' | 'left' | 'right' | 'back' | (string & {});
export type StompboxTemplateMode = 'preview' | 'print';
export type StompboxStyleProfileId = 'mxr-style' | 'boss-style';

export type StompboxStyleProfile = Readonly<{
    id: StompboxStyleProfileId;
    label: string;
    supportedKnobCounts: readonly number[];
}>;

export type StompboxStyleProfileFilter = Readonly<{
    knobCount: number;
}>;

export const DEFAULT_STOMPBOX_STYLE_PROFILE_ID: StompboxStyleProfileId = 'mxr-style';

export const STOMPBOX_STYLE_PROFILES: readonly StompboxStyleProfile[] = [
    {
        id: 'mxr-style',
        label: 'MXR style',
        supportedKnobCounts: [1, 2, 3, 4, 5, 6],
    },
    {
        id: 'boss-style',
        label: 'Boss style',
        supportedKnobCounts: [2, 3, 4],
    },
];

export function getAvailableStompboxStyleProfiles(filter: StompboxStyleProfileFilter): readonly StompboxStyleProfile[] {
    return STOMPBOX_STYLE_PROFILES.filter((profile) => profile.supportedKnobCounts.includes(filter.knobCount));
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

export type StompboxDecalInputCommon = Readonly<{
    id: string;
    face?: StompboxFaceId;
    centerMm?: StompboxPoint2;
    sizeMm?: StompboxSize2;
    rotationDeg?: number;
}>;

export type StompboxTextDecalInput = StompboxDecalInputCommon & Readonly<{
    kind: 'text';
    text: string;
    color?: string;
    fontFamily?: string;
    fontSizeMm?: number;
}>;

export type StompboxSvgDecalInput = StompboxDecalInputCommon & Readonly<{
    kind: 'svg';
    svg: string;
}>;

export type StompboxDecalInput = StompboxTextDecalInput | StompboxSvgDecalInput;

export type StompboxAssetRefs = Readonly<{
    glbRelativePath: string;
    stepRelativePath: string;
}>;

export type ResolvedStompboxAssetPaths = Readonly<{
    glb: string;
    step: string;
}>;

export type StompboxDrillHoleMarker = 'ring-with-center-dot' | 'center-dot';

export type StompboxDrillHoleProfile = Readonly<{
    id: string;
    label: string;
    diameterMm: number;
    fractionInches: string;
    marker: StompboxDrillHoleMarker;
}>;

export const STOMPBOX_DRILL_HOLE_PROFILE_CATALOG: Readonly<Record<string, StompboxDrillHoleProfile>> = {
    'dc-jack-3pdt-1-2': {
        id: 'dc-jack-3pdt-1-2',
        label: 'DC Jack / 3PDT',
        diameterMm: 12.7,
        fractionInches: '1/2"',
        marker: 'ring-with-center-dot',
    },
    'audio-jack-24mm-pot-3-8': {
        id: 'audio-jack-24mm-pot-3-8',
        label: 'Audio Jacks / 24mm Pots',
        diameterMm: 9.525,
        fractionInches: '3/8"',
        marker: 'ring-with-center-dot',
    },
    'metal-5mm-led-bezel-5-16': {
        id: 'metal-5mm-led-bezel-5-16',
        label: 'Metal 5mm LED Bezel',
        diameterMm: 7.9375,
        fractionInches: '5/16"',
        marker: 'ring-with-center-dot',
    },
    'sixteen-mm-pot-9-32': {
        id: 'sixteen-mm-pot-9-32',
        label: '16mm Pots',
        diameterMm: 7.14375,
        fractionInches: '9/32"',
        marker: 'ring-with-center-dot',
    },
    'mini-toggle-switch-1-4': {
        id: 'mini-toggle-switch-1-4',
        label: 'Mini Toggle Switch',
        diameterMm: 6.35,
        fractionInches: '1/4"',
        marker: 'ring-with-center-dot',
    },
    'five-mm-led-13-64': {
        id: 'five-mm-led-13-64',
        label: '5mm LED',
        diameterMm: 5.159375,
        fractionInches: '13/64"',
        marker: 'ring-with-center-dot',
    },
    'three-mm-led-1-8': {
        id: 'three-mm-led-1-8',
        label: '3mm LED',
        diameterMm: 3.175,
        fractionInches: '1/8"',
        marker: 'ring-with-center-dot',
    },
    'pilot-hole-1-16': {
        id: 'pilot-hole-1-16',
        label: 'Pilot Hole',
        diameterMm: 1.5875,
        fractionInches: '1/16"',
        marker: 'center-dot',
    },
};

export type StompboxAssetResolveOptions = Readonly<{
    basePath?: string;
    baseUrl?: string;
}>;

export type StompboxPartGeometry =
    | Readonly<{
        kind: 'knob';
        diameterMm: number;
        depthMm: number;
        shaftDiameterMm: number;
    }>
    | Readonly<{
        kind: 'led';
        lensDiameterMm: number;
        bodyHeightMm: number;
        flangeDiameterMm: number;
    }>
    | Readonly<{
        kind: 'led-bezel';
        outerDiameterMm: number;
        innerDiameterMm: number;
        depthMm: number;
    }>
    | Readonly<{
        kind: 'footswitch';
        buttonDiameterMm: number;
        nutOuterDiameterMm: number;
        ringHeightMm: number;
        buttonHeightMm: number;
        pressedTravelMm: number;
    }>
    | Readonly<{
        kind: 'ring';
        outerDiameterMm: number;
        innerDiameterMm: number;
        depthMm: number;
    }>;

export type StompboxPartProfile = Readonly<{
    id: string;
    label: string;
    family: 'knob' | 'led' | 'footswitch' | 'audio-jack' | 'dc-jack';
    level: 'exterior';
    status: 'generated-stub';
    panelHoleDrillMm: number;
    drillHoleProfileId?: string;
    geometry: StompboxPartGeometry;
    assets: StompboxAssetRefs;
    assetScale?: number;
}>;

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

export type StompboxDiagnosticCode =
    | 'placement-auto-generated'
    | 'unsupported-control'
    | 'unknown-part-profile'
    | 'placement-collision'
    | 'placement-clearance'
    | 'placement-out-of-bounds';

export type StompboxDiagnostic = Readonly<{
    code: StompboxDiagnosticCode;
    message: string;
    controlId?: string;
    placementId?: string;
    face?: StompboxFaceId;
}>;

export type StompboxDrillHole = Readonly<{
    id: string;
    face: StompboxFaceId;
    centerMm: StompboxPoint2;
    drillDiameterMm: number;
    drillHoleProfileId?: string;
    partId: string;
    partLabel: string;
    controlId?: string;
    componentId?: string;
    label?: string;
    provenance: StompboxPlacementProvenance;
    locked?: boolean;
    assets: StompboxAssetRefs;
}>;

export type StompboxDrillLayout = Readonly<{
    schema: 'stompbox-drill-layout/v1';
    units: StompboxUnits;
    enclosure: StompboxEnclosureProfile;
    holes: readonly StompboxDrillHole[];
    diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxPreviewMaterial = Readonly<{
    color?: string;
    strokeColor?: string;
    indicatorColor?: string;
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
    template?: StompboxPreviewMaterial & Readonly<{
        guideColor?: string;
        foldColor?: string;
        holeStrokeColor?: string;
        holeFillColor?: string;
        centerDotColor?: string;
    }>;
    defaults?: Readonly<{
        knob?: StompboxPreviewMaterial;
        led?: StompboxPreviewMaterial;
        label?: StompboxLabelAppearance;
        footswitch?: StompboxPreviewMaterial;
        audioJack?: StompboxPreviewMaterial;
        dcJack?: StompboxPreviewMaterial;
    }>;
    controls?: Readonly<Record<string, Readonly<{
        knob?: StompboxPreviewMaterial;
        led?: StompboxPreviewMaterial;
        label?: StompboxLabelAppearance;
        footswitch?: StompboxPreviewMaterial;
        audioJack?: StompboxPreviewMaterial;
        dcJack?: StompboxPreviewMaterial;
    }>>>;
    parts?: Readonly<Record<string, StompboxPreviewMaterial>>;
    labels?: Readonly<Record<string, StompboxLabelAppearance>>;
}>;

export type StompboxAppearancePatchTarget = Readonly<{
    targetId: string;
    color?: string;
    strokeColor?: string;
    indicatorColor?: string;
    offColor?: string;
    pressedColor?: string;
    emissive?: boolean;
    intensity?: number;
    metallicFactor?: number;
    roughnessFactor?: number;
    opacity?: number;
}>;

export type StompboxPartAppearancePatchTarget = StompboxAppearancePatchTarget & Readonly<{
    partId: string;
    controlId?: string;
    family: StompboxPartProfile['family'];
}>;

export type StompboxDecalAppearancePatchTarget = Readonly<{
    targetId: string;
    decalId: string;
    kind: StompboxPreviewDecal['kind'];
    face: StompboxFaceId;
    text?: string;
    color?: string;
    fontFamily?: string;
    fontSizeMm?: number;
}>;

export type StompboxResolvedAppearance = Readonly<{
    schema: 'stompbox-appearance-patch/v1';
    units: StompboxUnits;
    enclosure?: StompboxAppearancePatchTarget;
    parts: Readonly<Record<string, StompboxPartAppearancePatchTarget>>;
    decals: Readonly<Record<string, StompboxDecalAppearancePatchTarget>>;
}>;

export type StompboxPreviewPart = Readonly<{
    id: string;
    partId: string;
    controlId?: string;
    face: StompboxFaceId;
    provenance: StompboxPlacementProvenance;
    assets: ResolvedStompboxAssetPaths;
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
    sizeMm: StompboxSize2;
    rotationDeg: number;
}>;

export type StompboxPreviewTextDecal = StompboxPreviewDecalCommon & Readonly<{
    kind: 'text';
    text: string;
    color: string;
    fontFamily: string;
    fontSizeMm: number;
}>;

export type StompboxPreviewSvgDecal = StompboxPreviewDecalCommon & Readonly<{
    kind: 'svg';
    svg: string;
}>;

export type StompboxPreviewDecal = StompboxPreviewTextDecal | StompboxPreviewSvgDecal;

export type StompboxPreviewEnclosure = Omit<StompboxEnclosureProfile, 'assets'> & Readonly<{
    assets: ResolvedStompboxAssetPaths;
    material?: StompboxPreviewMaterial;
}>;

export type StompboxPreview = Readonly<{
    schema: 'stompbox-preview/v1';
    units: StompboxUnits;
    enclosure: StompboxPreviewEnclosure;
    parts: readonly StompboxPreviewPart[];
    decals: readonly StompboxPreviewDecal[];
    drillLayout: StompboxDrillLayout;
    diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxPreviewSvgViewId = 'top' | 'bottom' | 'left' | 'right';

export type StompboxPreviewSvgViews = Readonly<{
    schema: 'stompbox-preview-svg-views/v1';
    units: StompboxUnits;
    preview: StompboxPreview;
    views: Readonly<Record<StompboxPreviewSvgViewId, string>>;
    diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxPreviewGlb = Readonly<{
    schema: 'stompbox-preview-glb/v1';
    mimeType: 'model/gltf-binary';
    bytes: Uint8Array;
    preview: StompboxPreview;
    diagnostics: readonly StompboxDiagnostic[];
}>;

export type StompboxDrillTemplateHole = StompboxDrillHole & Readonly<{
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
    paper: 'A4';
    orientation: 'portrait';
    widthMm: number;
    heightMm: number;
    marginMm: number;
}>;

export type StompboxDrillTemplate = Readonly<{
    schema: 'stompbox-drill-template/v1';
    mode: StompboxTemplateMode;
    units: StompboxUnits;
    scale: 1;
    detailLevel: 'preview' | 'fabrication-detail';
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

export type StompboxLayoutOptions = Readonly<{
    enclosureId?: string;
    includePowerJack?: boolean;
    minPartClearanceMm?: number;
    styleProfile?: StompboxStyleProfileId;
}>;

export type StompboxFromVdspOptions = StompboxLayoutOptions & Readonly<{
    filename?: string;
}>;

export type StompboxDecalOptions = Readonly<{
    decals?: readonly StompboxDecalInput[];
}>;

export type StompboxAppearanceOptions = Readonly<{
    appearance?: StompboxAppearance;
}>;

export type StompboxPreviewOptions = StompboxLayoutOptions & StompboxAssetResolveOptions & StompboxDecalOptions & StompboxAppearanceOptions & Readonly<{
    state?: ControlState;
}>;

export type StompboxPreviewFromVdspOptions = StompboxPreviewOptions & Readonly<{
    filename?: string;
}>;

export type StompboxDrillTemplateOptions = StompboxLayoutOptions & StompboxDecalOptions & StompboxAppearanceOptions & Readonly<{
    mode: StompboxTemplateMode;
}>;

export type StompboxDrillTemplateFromVdspOptions = StompboxDrillTemplateOptions & Readonly<{
    filename?: string;
}>;

export type StompboxPreviewSvgViewsOptions = StompboxPreviewOptions;

export type StompboxPreviewSvgViewsFromVdspOptions = StompboxPreviewSvgViewsOptions & Readonly<{
    filename?: string;
}>;

export type StompboxPreviewGlbOptions = StompboxPreviewOptions;

export type StompboxPreviewGlbFromVdspOptions = StompboxPreviewGlbOptions & Readonly<{
    filename?: string;
}>;

type ControlVisualMetadata = Readonly<{
    id: string;
    kind: 'knob' | 'led' | 'switch' | 'jack' | 'slider';
    label: string;
    defaultPosition?: number;
    color?: string;
    jackRole?: JackPort['role'];
    switchKind?: SwitchControl['switchKind'];
    partNumber?: string;
}>;

type PlacementCandidate = Readonly<{
    id: string;
    kind: PanelControlKind;
    face: StompboxFaceId;
    centerMm: StompboxPoint2;
    partId: string;
    componentId?: string;
    controlId?: string;
    label?: string;
    drillDiameterMm?: number;
    locked?: boolean;
    provenance: StompboxPlacementProvenance;
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

type StompboxHardwarePlacementStyle = 'mxr-style' | 'boss-style';

const STOMPBOX_GRID_EDGE_MARGIN_MM = 5;
const STOMPBOX_GRID_TARGET_ROW_PITCH_MM = 20;
const STOMPBOX_LARGE_KNOB_PART_ID = 'knob-mxr-style-fluted-large';
const STOMPBOX_SMALL_KNOB_PART_ID = 'knob-davies-1510bg-14mm';
const STOMPBOX_DEFAULT_LED_PART_ID = 'led-3mm-red-kento-5408urc';
const STOMPBOX_LARGE_KNOB_DIAMETER_MM = 20;
const STOMPBOX_SMALL_KNOB_DIAMETER_MM = 14.5;
const STOMPBOX_LARGE_KNOB_MIN_PITCH_MM = 25;
const STOMPBOX_1590B_MIN_WIDTH_MM = 55;

export const STOMPBOX_PART_CATALOG: Readonly<Record<string, StompboxPartProfile>> = {
    'knob-mxr-style-fluted': {
        id: 'knob-mxr-style-fluted',
        label: 'Tayda A-1829 TYMF-B00 MXR Style Fluted Black Knob generated panel-visible CAD stub',
        family: 'knob',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 7.14375,
        drillHoleProfileId: 'sixteen-mm-pot-9-32',
        geometry: { kind: 'knob', diameterMm: 20, depthMm: 11.45, shaftDiameterMm: 6.35 },
        assets: {
            glbRelativePath: 'knob-mxr-style-fluted/.tayda-a1829-tymf-b00.step.glb',
            stepRelativePath: 'knob-mxr-style-fluted/tayda-a1829-tymf-b00.step',
        },
    },
    'knob-mxr-style-fluted-large': {
        id: 'knob-mxr-style-fluted-large',
        label: 'Tayda A-1829 TYMF-B00 20 mm MXR Style Large Fluted Black Knob generated panel-visible CAD stub',
        family: 'knob',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 7.14375,
        drillHoleProfileId: 'sixteen-mm-pot-9-32',
        geometry: { kind: 'knob', diameterMm: 20, depthMm: 11.45, shaftDiameterMm: 6.35 },
        assets: {
            glbRelativePath: 'knob-mxr-style-fluted/.tayda-a1829-tymf-b00.step.glb',
            stepRelativePath: 'knob-mxr-style-fluted/tayda-a1829-tymf-b00.step',
        },
    },
    'knob-cm42-bb': {
        id: 'knob-cm42-bb',
        label: 'Tayda A-6078 CM42 BB 19 mm Black Big Muff-Style Knob generated panel-visible CAD stub',
        family: 'knob',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 7.14375,
        drillHoleProfileId: 'sixteen-mm-pot-9-32',
        geometry: { kind: 'knob', diameterMm: 19, depthMm: 13.6, shaftDiameterMm: 6 },
        assets: {
            glbRelativePath: 'knob-cm42-bb/.tayda-a6078-cm42-bb.step.glb',
            stepRelativePath: 'knob-cm42-bb/tayda-a6078-cm42-bb.step',
        },
    },
    'knob-davies-1510bg-mini': {
        id: 'knob-davies-1510bg-mini',
        label: 'Davies 1510BG scaled mini knob generated panel-visible CAD stub',
        family: 'knob',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 7.14375,
        drillHoleProfileId: 'sixteen-mm-pot-9-32',
        geometry: { kind: 'knob', diameterMm: 12, depthMm: 8.96, shaftDiameterMm: 6.35 },
        assets: {
            glbRelativePath: 'knob-davies-instrument-series/.davies-1510bg.step.glb',
            stepRelativePath: 'knob-davies-instrument-series/davies-1510bg.step',
        },
        assetScale: 0.63,
    },
    'knob-davies-1510bg-14mm': {
        id: 'knob-davies-1510bg-14mm',
        label: 'Davies 1510BG scaled 14.5 mm knob generated panel-visible CAD stub',
        family: 'knob',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 7.14375,
        drillHoleProfileId: 'sixteen-mm-pot-9-32',
        geometry: { kind: 'knob', diameterMm: 14.5, depthMm: 10.82, shaftDiameterMm: 6.35 },
        assets: {
            glbRelativePath: 'knob-davies-instrument-series/.davies-1510bg.step.glb',
            stepRelativePath: 'knob-davies-instrument-series/davies-1510bg.step',
        },
        assetScale: 0.77,
    },
    'knob-chickenhead-lms-30mm': {
        id: 'knob-chickenhead-lms-30mm',
        label: 'Love My Switches 30 mm Chicken Head Knob generated panel-visible CAD stub',
        family: 'knob',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 9.525,
        drillHoleProfileId: 'audio-jack-24mm-pot-3-8',
        geometry: { kind: 'knob', diameterMm: 30.4, depthMm: 16.2, shaftDiameterMm: 6.4 },
        assets: {
            glbRelativePath: 'knob-chickenhead-lms-30mm/.lovemyswitches-chicken-head-30mm.step.glb',
            stepRelativePath: 'knob-chickenhead-lms-30mm/lovemyswitches-chicken-head-30mm.step',
        },
    },
    'led-5mm-red-kento-5408urc': {
        id: 'led-5mm-red-kento-5408urc',
        label: 'Kento 5408URC 5 mm Red LED generated panel-visible CAD stub',
        family: 'led',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 5.159375,
        drillHoleProfileId: 'five-mm-led-13-64',
        geometry: { kind: 'led', lensDiameterMm: 5, bodyHeightMm: 8.7, flangeDiameterMm: 5.8 },
        assets: {
            glbRelativePath: 'led-5mm-red-kento-5408urc/.kento-5408urc.step.glb',
            stepRelativePath: 'led-5mm-red-kento-5408urc/kento-5408urc.step',
        },
    },
    'led-3mm-red-kento-5408urc': {
        id: 'led-3mm-red-kento-5408urc',
        label: 'Kento 5408URC scaled 3 mm Red LED generated panel-visible CAD stub',
        family: 'led',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 3.175,
        drillHoleProfileId: 'three-mm-led-1-8',
        geometry: { kind: 'led', lensDiameterMm: 3, bodyHeightMm: 5.22, flangeDiameterMm: 3.48 },
        assets: {
            glbRelativePath: 'led-5mm-red-kento-5408urc/.kento-5408urc.step.glb',
            stepRelativePath: 'led-5mm-red-kento-5408urc/kento-5408urc.step',
        },
        assetScale: 0.6,
    },
    'led-bezel-lh5': {
        id: 'led-bezel-lh5',
        label: 'Pedal Parts and Kits BZL-5MM-P 5 mm Metal LED Bezel generated panel-visible CAD stub',
        family: 'led',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 7.9375,
        drillHoleProfileId: 'metal-5mm-led-bezel-5-16',
        geometry: { kind: 'led-bezel', outerDiameterMm: 9.2, innerDiameterMm: 5, depthMm: 5.35 },
        assets: {
            glbRelativePath: 'led-bezel-lh5/.pedal-parts-and-kits-bzl-5mm-p.step.glb',
            stepRelativePath: 'led-bezel-lh5/pedal-parts-and-kits-bzl-5mm-p.step',
        },
    },
    'switch-3pdt-pic-pbs24302': {
        id: 'switch-3pdt-pic-pbs24302',
        label: 'PIC PBS24302 3PDT Latching Stomp Footswitch generated panel-visible CAD stub',
        family: 'footswitch',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 12.7,
        drillHoleProfileId: 'dc-jack-3pdt-1-2',
        geometry: {
            kind: 'footswitch',
            buttonDiameterMm: 12,
            nutOuterDiameterMm: 18,
            ringHeightMm: 1.8,
            buttonHeightMm: 5.5,
            pressedTravelMm: 1.2,
        },
        assets: {
            glbRelativePath: 'switch-3pdt-pic-pbs24302/.pic-pbs24302.step.glb',
            stepRelativePath: 'switch-3pdt-pic-pbs24302/pic-pbs24302.step',
        },
    },
    'jack-ts-pj629han': {
        id: 'jack-ts-pj629han',
        label: 'Tayda A-6040 / PJ-629HAN-05 6.35 mm Mono Phone Jack generated exterior-ring CAD stub',
        family: 'audio-jack',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 9.525,
        drillHoleProfileId: 'audio-jack-24mm-pot-3-8',
        geometry: { kind: 'ring', outerDiameterMm: 11, innerDiameterMm: 6.43, depthMm: 1.4 },
        assets: {
            glbRelativePath: 'jack-ts-pj629han/.pj-629han-05.step.glb',
            stepRelativePath: 'jack-ts-pj629han/pj-629han-05.step',
        },
    },
    'dc-socket-dc099': {
        id: 'dc-socket-dc099',
        label: 'DC-099 2.1 x 5.5 mm Panel-Mount DC Power Jack generated exterior-ring CAD stub',
        family: 'dc-jack',
        level: 'exterior',
        status: 'generated-stub',
        panelHoleDrillMm: 12.7,
        drillHoleProfileId: 'dc-jack-3pdt-1-2',
        geometry: { kind: 'ring', outerDiameterMm: 14.1, innerDiameterMm: 8, depthMm: 1.4 },
        assets: {
            glbRelativePath: 'dc-socket-dc099/.dc099.step.glb',
            stepRelativePath: 'dc-socket-dc099/dc099.step',
        },
    },
};

export const STOMPBOX_ENCLOSURE_CATALOG: Readonly<Record<string, StompboxEnclosureProfile>> = {
    'box-1590b': {
        variantId: 'box-1590b',
        label: 'Tayda A-6619 1590B enclosure generated STEP CAD',
        dimensionsMm: { widthMm: 60.5, lengthMm: 111.5, depthMm: 31 },
        topFace: {
            usableRectMm: { x: -25.25, y: -50.75, width: 50.5, height: 101.5 },
        },
        assets: {
            glbRelativePath: 'box-1590b/.tayda-a6619.step.glb',
            stepRelativePath: 'box-1590b/tayda-a6619.step',
        },
    },
    'box-1590a': {
        variantId: 'box-1590a',
        label: 'Hammond 1590A enclosure generated STEP CAD',
        dimensionsMm: { widthMm: 39, lengthMm: 92.5, depthMm: 31 },
        topFace: {
            usableRectMm: { x: -14.5, y: -41.25, width: 29, height: 82.5 },
        },
        assets: {
            glbRelativePath: 'box-hammond-diecast-stompbox-series/.hammond-1590a.step.glb',
            stepRelativePath: 'box-hammond-diecast-stompbox-series/hammond-1590a.step',
        },
    },
};

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

export function createStompboxDrillLayoutFromVdsp(
    source: string,
    options: StompboxFromVdspOptions = {},
): StompboxDrillLayout {
    const document = parseCircuitDocumentFile(source, {
        filename: options.filename ?? 'stompbox.vdsp',
    });
    return createStompboxDrillLayout(document, options);
}

export function createStompboxDrillLayout(
    document: CircuitDocument,
    options: StompboxLayoutOptions = {},
): StompboxDrillLayout {
    const enclosure = enclosureProfile(options.enclosureId);
    const panel = extractPanel(document);
    const controlMetadata = controlMetadataById(panel);
    const diagnostics: StompboxDiagnostic[] = [];
    const declared = declaredPhysicalPlacements(document.panel?.faces ?? [], controlMetadata, diagnostics);
    const declaredControlIds = new Set(declared.flatMap((candidate) =>
        candidate.controlId === undefined ? [] : [candidate.controlId]
    ));
    const auto = autoPlacementCandidates(panel, enclosure, declared, declaredControlIds, options, diagnostics);
    const holes = [...declared, ...auto].flatMap((candidate) => drillHoleForCandidate(candidate, diagnostics));
    diagnostics.push(...validateHolePlacements(holes, enclosure, options.minPartClearanceMm));

    return {
        schema: 'stompbox-drill-layout/v1',
        units: 'mm',
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
        filename: options.filename ?? 'stompbox.vdsp',
    });
    return createStompboxPreview(document, options);
}

export function createStompboxPreview(
    document: CircuitDocument,
    options: StompboxPreviewOptions = {},
): StompboxPreview {
    const drillLayout = createStompboxDrillLayout(document, options);
    const panel = extractPanel(document);
    const controlMetadata = controlMetadataById(panel);
    const resolveOptions = assetResolveOptions(options);
    const parts = drillLayout.holes.map((hole) =>
        previewPartForHole(hole, drillLayout.enclosure, controlMetadata.get(hole.controlId ?? ''), options.state, resolveOptions, options.appearance)
    );
    const decals = [
        ...normalizeDecals(options.decals),
        ...controlLabelDecals(drillLayout, options.styleProfile ?? DEFAULT_STOMPBOX_STYLE_PROFILE_ID, options.appearance),
    ];
    const enclosureMaterial = materialWithValues(options.appearance?.enclosure);

    return {
        schema: 'stompbox-preview/v1',
        units: 'mm',
        enclosure: {
            variantId: drillLayout.enclosure.variantId,
            label: drillLayout.enclosure.label,
            dimensionsMm: drillLayout.enclosure.dimensionsMm,
            topFace: drillLayout.enclosure.topFace,
            assets: resolveStompboxAssetPaths(drillLayout.enclosure.assets, resolveOptions),
            ...(enclosureMaterial === undefined ? {} : { material: enclosureMaterial }),
        },
        parts,
        decals,
        drillLayout,
        diagnostics: drillLayout.diagnostics,
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
    const enclosureMaterial = mergeMaterials(preview.enclosure.material, appearance?.enclosure);
    const parts = Object.fromEntries(preview.parts.flatMap((part) => {
        const profile = STOMPBOX_PART_CATALOG[part.partId];
        if (profile === undefined) {
            return [];
        }
        const material = mergeMaterials(part.material, previewPartAppearanceFor(part, profile, appearance));
        if (material === undefined) {
            return [];
        }
        const target: StompboxPartAppearancePatchTarget = {
            targetId: `part-${part.id}`,
            partId: part.partId,
            ...(part.controlId === undefined ? {} : { controlId: part.controlId }),
            family: profile.family,
            ...material,
        };
        return [[target.targetId, target] as const];
    }));
    const decals = Object.fromEntries(preview.decals.flatMap((decal) => {
        const labelAppearance = decalAppearanceFor(decal, appearance);
        const textDecal = decal.kind === 'text'
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
    }));
    return {
        schema: 'stompbox-appearance-patch/v1',
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
    const decals = normalizeDecals(options.decals);
    if (options.mode === 'print') {
        const page: StompboxDrillTemplatePage = {
            paper: 'A4',
            orientation: 'portrait',
            widthMm: 210,
            heightMm: 297,
            marginMm: 12,
        };
        return {
            schema: 'stompbox-drill-template/v1',
            mode: 'print',
            units: 'mm',
            scale: 1,
            detailLevel: 'fabrication-detail',
            canvasMm: { widthMm: page.widthMm, heightMm: page.heightMm },
            page,
            enclosure: layout.enclosure,
            holes: layout.holes.map((hole) => templateHole(
                hole,
                layout.enclosure,
                { widthMm: page.widthMm, heightMm: page.heightMm },
            )),
            scaleMarks: [
                { id: 'scale-10mm', label: '10 mm', lengthMm: 10, startMm: { x: 12, y: 285 }, endMm: { x: 22, y: 285 } },
                { id: 'scale-50mm', label: '50 mm', lengthMm: 50, startMm: { x: 12, y: 278 }, endMm: { x: 62, y: 278 } },
            ],
            decals,
            ...(options.appearance === undefined ? {} : { appearance: options.appearance }),
            holeTable: layout.holes,
            diagnostics: layout.diagnostics,
        };
    }

    return {
        schema: 'stompbox-drill-template/v1',
        mode: 'preview',
        units: 'mm',
        scale: 1,
        detailLevel: 'preview',
        canvasMm: previewCanvas,
        page: undefined,
        enclosure: layout.enclosure,
        holes: layout.holes.map((hole) => templateHole(hole, layout.enclosure, previewCanvas)),
        decals,
        ...(options.appearance === undefined ? {} : { appearance: options.appearance }),
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
        filename: options.filename ?? 'stompbox.vdsp',
    });
    return createStompboxPreviewSvgViews(document, options);
}

export function createStompboxPreviewSvgViews(
    document: CircuitDocument,
    options: StompboxPreviewSvgViewsOptions = {},
): StompboxPreviewSvgViews {
    const preview = createStompboxPreview(document, options);
    return {
        schema: 'stompbox-preview-svg-views/v1',
        units: 'mm',
        preview,
        views: {
            top: previewViewSvg(preview, 'top'),
            bottom: previewViewSvg(preview, 'bottom'),
            left: previewViewSvg(preview, 'left'),
            right: previewViewSvg(preview, 'right'),
        },
        diagnostics: preview.diagnostics,
    };
}

export function createStompboxPreviewGlbFromVdsp(
    source: string,
    options: StompboxPreviewGlbFromVdspOptions = {},
): StompboxPreviewGlb {
    const document = parseCircuitDocumentFile(source, {
        filename: options.filename ?? 'stompbox.vdsp',
    });
    return createStompboxPreviewGlb(document, options);
}

export function createStompboxPreviewGlb(
    document: CircuitDocument,
    options: StompboxPreviewGlbOptions = {},
): StompboxPreviewGlb {
    const preview = createStompboxPreview(document, options);
    return {
        schema: 'stompbox-preview-glb/v1',
        mimeType: 'model/gltf-binary',
        bytes: previewGlb(preview, options),
        preview,
        diagnostics: preview.diagnostics,
    };
}

export function knobRotationDegForPosition(position: number): number {
    return -135 + clamp01(position) * 270;
}

function enclosureProfile(enclosureId: string | undefined): StompboxEnclosureProfile {
    const id = enclosureId ?? 'box-1590b';
    const profile = STOMPBOX_ENCLOSURE_CATALOG[id];
    if (profile === undefined) {
        throw new Error(`unsupported stompbox enclosure: ${id}`);
    }
    return profile;
}

function controlMetadataById(panel: Panel): ReadonlyMap<string, ControlVisualMetadata> {
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
        kind: 'knob',
        label: knob.name,
        defaultPosition: knob.defaultPosition,
    };
}

function sliderMetadata(slider: SliderControl): ControlVisualMetadata {
    return {
        id: slider.id,
        kind: 'slider',
        label: slider.name,
        defaultPosition: slider.defaultPosition,
    };
}

function switchMetadata(switchControl: SwitchControl): ControlVisualMetadata {
    return {
        id: switchControl.id,
        kind: 'switch',
        label: switchControl.name,
        defaultPosition: switchControl.defaultPosition,
        switchKind: switchControl.switchKind,
        ...(switchControl.partNumber === undefined ? {} : { partNumber: switchControl.partNumber }),
    };
}

function ledMetadata(led: LedIndicator): ControlVisualMetadata {
    return {
        id: led.id,
        kind: 'led',
        label: led.name,
        ...(led.color === undefined ? {} : { color: led.color }),
    };
}

function jackMetadata(jack: JackPort): ControlVisualMetadata {
    return {
        id: jack.id,
        kind: 'jack',
        label: jack.name,
        jackRole: jack.role,
    };
}

function declaredPhysicalPlacements(
    faces: readonly PanelFace[],
    controls: ReadonlyMap<string, ControlVisualMetadata>,
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
            const requestedPartId = element.physical.partProfileId ?? defaultPartIdForPanelKind(element.kind, metadata);
            const partId = knownPartIdOrDefault(requestedPartId, element.kind, metadata, diagnostics, controlId, element.id);
            if (partId === undefined) {
                diagnostics.push({
                    code: 'unsupported-control',
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
                partId,
                componentId: element.bind.componentId,
                controlId,
                ...(label === undefined ? {} : { label }),
                ...(element.physical.drillDiameterMm === undefined ? {} : { drillDiameterMm: element.physical.drillDiameterMm }),
                ...(element.physical.locked === undefined ? {} : { locked: element.physical.locked }),
                provenance: 'vdsp-declared',
            });
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
    diagnostics: StompboxDiagnostic[],
): readonly PlacementCandidate[] {
    const candidates: PlacementCandidate[] = [];
    const knobs = panel.knobs.filter((knob) => !declaredControlIds.has(knob.id));
    const grid = placementGrid(enclosure);
    const styleProfile = options.styleProfile ?? DEFAULT_STOMPBOX_STYLE_PROFILE_ID;
    const usesBossStyleProfile = styleProfile === 'boss-style' && (knobs.length === 2 || knobs.length === 3 || knobs.length === 4);
    const hardwareStyle: StompboxHardwarePlacementStyle = styleProfile === 'boss-style' ? 'boss-style' : 'mxr-style';
    const knobGrid = autoKnobGrid(knobs.length, grid, styleProfile);
    knobs.forEach((knob, index) => {
        const placement = knobGrid.placements[index];
        if (placement === undefined) {
            return;
        }
        candidates.push(autoCandidate({
            id: `knob-${knob.id}`,
            kind: 'knob',
            centerMm: placement.centerMm,
            partId: placement.partId,
            componentId: knob.id,
            controlId: knob.id,
            label: knob.name,
        }, diagnostics));
    });

    const leds = panel.leds.filter((led) => !declaredControlIds.has(led.id));
    const ledY = usesBossStyleProfile ? bossStyleLedY(grid) : mxrStyleLedY(knobs.length, grid);
    const ledPositions = distributedTopRowPositions(leds.length, ledY, 16);
    leds.forEach((led, index) => {
        const position = ledPositions[index];
        if (position === undefined) {
            return;
        }
        candidates.push(autoCandidate({
            id: `led-${led.id}`,
            kind: 'led',
            centerMm: position,
            partId: STOMPBOX_DEFAULT_LED_PART_ID,
            componentId: led.id,
            controlId: led.id,
            label: led.name,
        }, diagnostics));
    });

    if (!hasStatusLed(panel, declared)) {
        candidates.push(autoCandidate({
            id: 'led-status',
            kind: 'led',
            centerMm: { x: 0, y: ledY },
            partId: STOMPBOX_DEFAULT_LED_PART_ID,
            label: 'Status',
        }, diagnostics));
    }

    const switches = panel.switches.filter((switchControl) => !declaredControlIds.has(switchControl.id));
    const footswitchY = footswitchGridY(knobs.length, grid, styleProfile);
    switches.forEach((switchControl, index) => {
        if (!isSupportedFootswitch(switchControl)) {
            diagnostics.push({
                code: 'unsupported-control',
                message: `Switch "${switchControl.id}" is not a supported stompbox footswitch`,
                controlId: switchControl.id,
            });
            return;
        }
        candidates.push(autoCandidate({
            id: `switch-${switchControl.id}`,
            kind: 'footswitch',
            centerMm: { x: index * 18, y: footswitchY },
            partId: 'switch-3pdt-pic-pbs24302',
            componentId: switchControl.id,
            controlId: switchControl.id,
        }, diagnostics));
    });

    if (!hasBypassFootswitch(panel, declared)) {
        candidates.push(autoCandidate({
            id: 'switch-bypass',
            kind: 'footswitch',
            centerMm: { x: 0, y: footswitchY },
            partId: 'switch-3pdt-pic-pbs24302',
        }, diagnostics));
    }

    for (const slider of panel.sliders ?? []) {
        if (!declaredControlIds.has(slider.id)) {
            diagnostics.push({
                code: 'unsupported-control',
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
                code: 'unsupported-control',
                message: `Jack "${jack.id}" has unsupported role "${jack.role}"`,
                controlId: jack.id,
            });
            continue;
        }
        const faceIndex = jackCountsByFace.get(face) ?? 0;
        jackCountsByFace.set(face, faceIndex + 1);
        candidates.push(autoCandidate({
            id: `jack-${jack.id}`,
            kind: 'jack',
            face,
            centerMm: centerForJackFace(face, enclosure, grid, hardwareStyle, faceIndex),
            partId: 'jack-ts-pj629han',
            componentId: jack.sourceComponentId ?? jack.id,
            controlId: jack.id,
            label: jack.name,
        }, diagnostics));
    }

    if (!hasInputJack(panel, declared)) {
        candidates.push(autoCandidate({
            id: 'jack-input',
            kind: 'jack',
            face: 'right',
            centerMm: centerForJackFace('right', enclosure, grid, hardwareStyle, jackCountsByFace.get('right') ?? 0),
            partId: 'jack-ts-pj629han',
            label: 'Input',
        }, diagnostics));
        jackCountsByFace.set('right', (jackCountsByFace.get('right') ?? 0) + 1);
    }

    if (!hasOutputJack(panel, declared)) {
        candidates.push(autoCandidate({
            id: 'jack-output',
            kind: 'jack',
            face: 'left',
            centerMm: centerForJackFace('left', enclosure, grid, hardwareStyle, jackCountsByFace.get('left') ?? 0),
            partId: 'jack-ts-pj629han',
            label: 'Output',
        }, diagnostics));
        jackCountsByFace.set('left', (jackCountsByFace.get('left') ?? 0) + 1);
    }

    if (options.includePowerJack !== false && !hasPowerJack(declared, candidates)) {
        const powerFace = powerJackFace(hardwareStyle);
        candidates.push(autoCandidate({
            id: 'power-9v',
            kind: 'jack',
            face: powerFace,
            centerMm: centerForPowerJackFace(powerFace, enclosure, grid, hardwareStyle),
            partId: 'dc-socket-dc099',
            label: '9V DC',
        }, diagnostics));
    }

    return candidates;
}

function autoCandidate(
    candidate: Omit<PlacementCandidate, 'face' | 'provenance'> & Readonly<{ face?: StompboxFaceId }>,
    diagnostics: StompboxDiagnostic[],
): PlacementCandidate {
    diagnostics.push({
        code: 'placement-auto-generated',
        message: `Auto-generated stompbox placement for "${candidate.id}"`,
        ...(candidate.controlId === undefined ? {} : { controlId: candidate.controlId }),
        placementId: candidate.id,
        face: candidate.face ?? 'top',
    });
    return {
        ...candidate,
        face: candidate.face ?? 'top',
        provenance: 'auto-generated',
    };
}

function drillHoleForCandidate(
    candidate: PlacementCandidate,
    diagnostics: StompboxDiagnostic[],
): readonly StompboxDrillHole[] {
    const part = STOMPBOX_PART_CATALOG[candidate.partId];
    if (part === undefined) {
        diagnostics.push({
            code: 'unknown-part-profile',
            message: `Unknown stompbox part profile "${candidate.partId}"`,
            ...(candidate.controlId === undefined ? {} : { controlId: candidate.controlId }),
            placementId: candidate.id,
            face: candidate.face,
        });
        return [];
    }
    return [{
        id: candidate.id,
        face: candidate.face,
        centerMm: candidate.centerMm,
        drillDiameterMm: candidate.drillDiameterMm ?? part.panelHoleDrillMm,
        ...(part.drillHoleProfileId === undefined ? {} : { drillHoleProfileId: part.drillHoleProfileId }),
        partId: part.id,
        partLabel: part.label,
        ...(candidate.controlId === undefined ? {} : { controlId: candidate.controlId }),
        ...(candidate.componentId === undefined ? {} : { componentId: candidate.componentId }),
        ...(candidate.label === undefined ? {} : { label: candidate.label }),
        provenance: candidate.provenance,
        ...(candidate.locked === undefined ? {} : { locked: candidate.locked }),
        assets: part.assets,
    }];
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
                code: 'placement-out-of-bounds',
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
            const distance = Math.hypot(first.centerMm.x - second.centerMm.x, first.centerMm.y - second.centerMm.y);
            const requiredDistance = placementCollisionRadiusMm(first) + placementCollisionRadiusMm(second);
            const clearanceMm = distance - requiredDistance;
            if (clearanceMm < 0) {
                diagnostics.push({
                    code: 'placement-collision',
                    message: `Placements "${first.id}" and "${second.id}" overlap on ${first.face}`,
                    placementId: first.id,
                    face: first.face,
                });
                continue;
            }
            if (clearanceMm < requiredClearanceMm) {
                diagnostics.push({
                    code: 'placement-clearance',
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
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function placementCollisionRadiusMm(hole: StompboxDrillHole): number {
    const profile = STOMPBOX_PART_CATALOG[hole.partId];
    if ((hole.face === 'left' || hole.face === 'right') && profile?.family === 'audio-jack') {
        return hole.drillDiameterMm / 2;
    }
    return (partVisibleDiameterMm(hole.partId) ?? hole.drillDiameterMm) / 2;
}

function partVisibleDiameterMm(partId: string): number | undefined {
    const profile = STOMPBOX_PART_CATALOG[partId];
    const geometry = profile?.geometry;
    if (geometry?.kind === 'knob') {
        return geometry.diameterMm;
    }
    if (geometry?.kind === 'footswitch') {
        return geometry.nutOuterDiameterMm;
    }
    if (geometry?.kind === 'led') {
        return geometry.flangeDiameterMm;
    }
    if (geometry?.kind === 'led-bezel' || geometry?.kind === 'ring') {
        return geometry.outerDiameterMm;
    }
    return undefined;
}

function isOutOfBounds(hole: StompboxDrillHole, enclosure: StompboxEnclosureProfile): boolean {
    const radius = placementCollisionRadiusMm(hole);
    if (hole.face === 'top') {
        return Math.abs(hole.centerMm.x) + radius > enclosure.dimensionsMm.widthMm / 2
            || Math.abs(hole.centerMm.y) + radius > enclosure.dimensionsMm.lengthMm / 2;
    }
    if (hole.face === 'left' || hole.face === 'right') {
        return Math.abs(hole.centerMm.y) + radius > enclosure.dimensionsMm.lengthMm / 2;
    }
    if (hole.face === 'back') {
        return Math.abs(hole.centerMm.x) + radius > enclosure.dimensionsMm.widthMm / 2;
    }
    return false;
}

function previewPartForHole(
    hole: StompboxDrillHole,
    enclosure: StompboxEnclosureProfile,
    metadata: ControlVisualMetadata | undefined,
    state: ControlState | undefined,
    assetOptions: StompboxAssetResolveOptions,
    appearance: StompboxAppearance | undefined,
): StompboxPreviewPart {
    const part = STOMPBOX_PART_CATALOG[hole.partId];
    const rotation = baseRotationForFace(hole.face);
    const stateValue = hole.controlId === undefined ? undefined : state?.[hole.controlId];
    const knobPosition = stateValue?.kind === 'knob'
        ? stateValue.position
        : metadata?.defaultPosition;
    const zOffset = pressedOffsetMm(part, stateValue);
    const material = materialForPart(part, hole, metadata, stateValue, appearance);
    const transform = {
        translationMm: {
            ...translationForFace(hole.face, hole.centerMm, enclosure),
            z: translationForFace(hole.face, hole.centerMm, enclosure).z + zOffset,
        },
        rotationDeg: {
            ...rotation,
            z: part?.geometry.kind === 'knob' ? knobRotationDegForPosition(knobPosition ?? 0.5) : rotation.z,
        },
    };
    return {
        id: hole.id,
        partId: hole.partId,
        ...(hole.controlId === undefined ? {} : { controlId: hole.controlId }),
        face: hole.face,
        provenance: hole.provenance,
        assets: resolveStompboxAssetPaths(hole.assets, assetOptions),
        transform,
        ...(material === undefined ? {} : { material }),
    };
}

function normalizeDecals(decals: readonly StompboxDecalInput[] | undefined): readonly StompboxPreviewDecal[] {
    return decals?.map((decal) => normalizeDecal(decal)) ?? [];
}

function controlLabelDecals(
    layout: StompboxDrillLayout,
    styleProfile: StompboxStyleProfileId,
    appearance: StompboxAppearance | undefined,
): readonly StompboxPreviewDecal[] {
    const hardwareStyle: StompboxHardwarePlacementStyle = styleProfile === 'boss-style' ? 'boss-style' : 'mxr-style';
    return layout.holes.flatMap((hole) => {
        const label = controlLabelDecal(hole, layout.enclosure, hardwareStyle, appearance);
        return label === undefined ? [] : [label];
    });
}

function controlLabelDecal(
    hole: StompboxDrillHole,
    enclosure: StompboxEnclosureProfile,
    hardwareStyle: StompboxHardwarePlacementStyle,
    appearance: StompboxAppearance | undefined,
): StompboxPreviewDecal | undefined {
    const profile = STOMPBOX_PART_CATALOG[hole.partId];
    if (profile === undefined) {
        return undefined;
    }
    if (profile.family === 'footswitch') {
        return undefined;
    }
    const labelId = `label-${decalIdSegment(hole.id)}`;
    const labelAppearance = labelAppearanceFor(labelId, hole.controlId, profile, appearance);
    const text = labelAppearance?.text ?? controlLabelText(hole, profile, hardwareStyle);
    if (text.length === 0) {
        return undefined;
    }
    const fontSizeMm = labelAppearance?.fontSizeMm ?? controlLabelFontSizeMm(profile);
    const sizeMm = controlLabelSizeMm(text, fontSizeMm);
    const placement = controlLabelPlacement(hole, profile, enclosure, hardwareStyle, sizeMm);
    return {
        id: labelId,
        kind: 'text',
        text,
        face: placement.face,
        centerMm: placement.centerMm,
        sizeMm,
        rotationDeg: placement.rotationDeg,
        color: labelAppearance?.color ?? '#111827',
        fontFamily: labelAppearance?.fontFamily ?? 'Arial,sans-serif',
        fontSizeMm,
    };
}

function controlLabelPlacement(
    hole: StompboxDrillHole,
    profile: StompboxPartProfile,
    enclosure: StompboxEnclosureProfile,
    hardwareStyle: StompboxHardwarePlacementStyle,
    sizeMm: StompboxSize2,
): Readonly<{ face: StompboxFaceId; centerMm: StompboxPoint2; rotationDeg: number }> {
    if (profile.family === 'audio-jack' && (hole.face === 'left' || hole.face === 'right')) {
        const edgeSign = hole.face === 'right' ? 1 : -1;
        const insetMm = hardwareStyle === 'boss-style' ? 10 : 8;
        return {
            face: 'top',
            centerMm: clampTopLabelCenter({
                x: edgeSign * (enclosure.dimensionsMm.widthMm / 2 - insetMm),
                y: hole.centerMm.y,
            }, enclosure, sizeMm),
            rotationDeg: hardwareStyle === 'boss-style' ? 0 : -90,
        };
    }

    const visibleRadiusMm = (partVisibleDiameterMm(hole.partId) ?? hole.drillDiameterMm) / 2;
    const gapMm = profile.family === 'led' ? 3 : 4;
    const labelY = profile.family === 'led'
        ? hole.centerMm.y + visibleRadiusMm + gapMm
        : hole.centerMm.y - visibleRadiusMm - gapMm;
    return {
        face: hole.face,
        centerMm: hole.face === 'top'
            ? clampTopLabelCenter({ x: hole.centerMm.x, y: labelY }, enclosure, sizeMm)
            : { x: hole.centerMm.x, y: labelY },
        rotationDeg: 0,
    };
}

function controlLabelFontSizeMm(profile: StompboxPartProfile): number {
    if (profile.family === 'knob') {
        return 3.2;
    }
    if (profile.family === 'audio-jack') {
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
    profile: StompboxPartProfile,
    hardwareStyle: StompboxHardwarePlacementStyle,
): string {
    const text = formatControlLabel(hole.label ?? hole.controlId ?? hole.id);
    if (profile.family === 'led' && hardwareStyle === 'boss-style' && text === 'STATUS') {
        return 'CHECK';
    }
    if (profile.family !== 'audio-jack') {
        return text;
    }
    if (text === 'IN') {
        return 'INPUT';
    }
    if (text === 'OUT') {
        return 'OUTPUT';
    }
    if (/\bINPUT\b/.test(text) || /\bOUTPUT\b/.test(text)) {
        return text;
    }
    if (hole.face === 'right') {
        return 'INPUT';
    }
    if (hole.face === 'left') {
        return 'OUTPUT';
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
        x: roundMillimeters(clamp(
            centerMm.x,
            -enclosure.dimensionsMm.widthMm / 2 + marginMm + halfWidth,
            enclosure.dimensionsMm.widthMm / 2 - marginMm - halfWidth,
        )),
        y: roundMillimeters(clamp(
            centerMm.y,
            -enclosure.dimensionsMm.lengthMm / 2 + marginMm + halfHeight,
            enclosure.dimensionsMm.lengthMm / 2 - marginMm - halfHeight,
        )),
    };
}

function formatControlLabel(value: string): string {
    return value
        .trim()
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

function decalIdSegment(value: string): string {
    return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-') || 'control';
}

function normalizeDecal(decal: StompboxDecalInput): StompboxPreviewDecal {
    const sizeMm = decal.sizeMm ?? defaultDecalSize(decal.kind);
    const common = {
        id: decal.id,
        face: decal.face ?? 'top',
        centerMm: decal.centerMm ?? { x: 0, y: 0 },
        sizeMm,
        rotationDeg: decal.rotationDeg ?? 0,
    };
    if (decal.kind === 'text') {
        return {
            ...common,
            kind: 'text',
            text: decal.text,
            color: decal.color ?? '#111827',
            fontFamily: decal.fontFamily ?? 'Arial,sans-serif',
            fontSizeMm: roundMillimeters(decal.fontSizeMm ?? sizeMm.heightMm * 0.65),
        };
    }
    return {
        ...common,
        kind: 'svg',
        svg: decal.svg,
    };
}

function defaultDecalSize(kind: StompboxDecalInput['kind']): StompboxSize2 {
    if (kind === 'text') {
        return { widthMm: 36, heightMm: 8 };
    }
    return { widthMm: 24, heightMm: 16 };
}

function materialForPart(
    part: StompboxPartProfile | undefined,
    hole: StompboxDrillHole,
    metadata: ControlVisualMetadata | undefined,
    stateValue: ControlState[string] | undefined,
    appearance: StompboxAppearance | undefined,
): StompboxPreviewMaterial | undefined {
    const appearanceMaterial = partAppearanceFor(hole, part, appearance);
    if (part?.family !== 'led') {
        return appearanceMaterial;
    }
    const color = appearanceMaterial?.color ?? metadata?.color ?? 'red';
    if (stateValue?.kind === 'led' && stateValue.on) {
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
    part: StompboxPartProfile | undefined,
    appearance: StompboxAppearance | undefined,
): StompboxPreviewMaterial | undefined {
    if (part === undefined || appearance === undefined) {
        return undefined;
    }
    const key = partAppearanceKey(part);
    const controlAppearance = hole.controlId === undefined ? undefined : appearance.controls?.[hole.controlId]?.[key];
    return mergeMaterials(
        appearance.defaults?.[key],
        controlAppearance,
        appearance.parts?.[hole.id],
        appearance.parts?.[`part-${hole.id}`],
    );
}

function previewPartAppearanceFor(
    part: StompboxPreviewPart,
    profile: StompboxPartProfile,
    appearance: StompboxAppearance | undefined,
): StompboxPreviewMaterial | undefined {
    if (appearance === undefined) {
        return undefined;
    }
    const key = partAppearanceKey(profile);
    const controlAppearance = part.controlId === undefined ? undefined : appearance.controls?.[part.controlId]?.[key];
    return mergeMaterials(
        appearance.defaults?.[key],
        controlAppearance,
        appearance.parts?.[part.id],
        appearance.parts?.[`part-${part.id}`],
    );
}

function partAppearanceKey(part: StompboxPartProfile): 'knob' | 'led' | 'footswitch' | 'audioJack' | 'dcJack' {
    if (part.family === 'audio-jack') {
        return 'audioJack';
    }
    if (part.family === 'dc-jack') {
        return 'dcJack';
    }
    return part.family;
}

function labelAppearanceFor(
    labelId: string,
    controlId: string | undefined,
    profile: StompboxPartProfile,
    appearance: StompboxAppearance | undefined,
): StompboxLabelAppearance | undefined {
    if (appearance === undefined) {
        return undefined;
    }
    const controlAppearance = controlId === undefined ? undefined : appearance.controls?.[controlId]?.label;
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
    if (appearance === undefined || decal.kind !== 'text') {
        return undefined;
    }
    return mergeLabelAppearances(
        appearance.defaults?.label,
        appearance.labels?.[decal.id],
        appearance.labels?.[`decal-${decal.id}`],
    );
}

function mergeMaterials(...materials: readonly (StompboxPreviewMaterial | undefined)[]): StompboxPreviewMaterial | undefined {
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

function materialWithValues(material: StompboxPreviewMaterial | undefined): StompboxPreviewMaterial | undefined {
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
    part: StompboxPartProfile | undefined,
    stateValue: ControlState[string] | undefined,
): number {
    if (part?.geometry.kind !== 'footswitch' || stateValue?.kind !== 'switch' || stateValue.position <= 0) {
        return 0;
    }
    return -part.geometry.pressedTravelMm;
}

function translationForFace(
    face: StompboxFaceId,
    centerMm: StompboxPoint2,
    enclosure: Readonly<{ dimensionsMm: StompboxEnclosureProfile['dimensionsMm'] }>,
): StompboxPoint3 {
    if (face === 'top') {
        return { x: centerMm.x, y: centerMm.y, z: enclosure.dimensionsMm.depthMm / 2 };
    }
    return { x: centerMm.x, y: centerMm.y, z: 0 };
}

function baseRotationForFace(face: StompboxFaceId): StompboxRotationDeg {
    if (face === 'right') {
        return { x: 0, y: 90, z: 0 };
    }
    if (face === 'left') {
        return { x: 0, y: -90, z: 0 };
    }
    if (face === 'back') {
        return { x: -90, y: 0, z: 0 };
    }
    return { x: 0, y: 0, z: 0 };
}

type SvgAttributeValue = string | number | boolean | undefined;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };
type MutableJsonObject = { [key: string]: JsonValue };

type GltfSourceAsset = Readonly<{
    id: string;
    kind: 'enclosure' | 'part';
    glb: string;
    step: string;
}>;

type GltfAssemblySource = Readonly<{
    id: string;
    kind: 'enclosure' | 'part';
    displayGlb: string;
    displayStep: string;
    localGlbPath: string;
    material?: StompboxPreviewMaterial;
    transform: Readonly<{
        translation: readonly number[];
        rotation: readonly number[];
        scale?: readonly number[];
    }>;
    extras: JsonObject;
}>;

type GltfDocument = Readonly<{
    asset: Readonly<{
        version: '2.0';
        generator: '@vessel-dsp/stompbox';
        extras: Readonly<{
            schema: 'stompbox-preview-glb/v1';
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

type DrillTemplatePanelId = 'top' | 'left' | 'right' | 'back' | 'bottom';

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
        ['xmlns', 'http://www.w3.org/2000/svg'],
        ['role', 'img'],
        ['aria-labelledby', `${titleId} ${descId}`],
        ['width', `${svgNumber(template.canvasMm.widthMm)}mm`],
        ['height', `${svgNumber(template.canvasMm.heightMm)}mm`],
        ['viewBox', viewBox],
        ['data-template-mode', template.mode],
        ['data-units', template.units],
        ['data-scale', template.scale],
    ]);
    const description = template.mode === 'print'
        ? 'A4 1:1 stompbox drill template with scale marks.'
        : 'Lightweight stompbox drill template for UI preview.';
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
        '</svg>',
    ].join('');
}

function drillTemplateStyleSvg(template: StompboxDrillTemplate): string {
    const mode = template.mode;
    const stroke = template.appearance?.enclosure?.strokeColor ?? (mode === 'print' ? '#111827' : '#334155');
    const enclosureFill = template.appearance?.enclosure?.color ?? '#f8fafc';
    const sideFill = template.appearance?.template?.offColor ?? '#e2e8f0';
    const foldColor = template.appearance?.template?.foldColor ?? stroke;
    const guideColor = template.appearance?.template?.guideColor ?? '#64748b';
    const holeStroke = template.appearance?.template?.holeStrokeColor ?? stroke;
    const holeFill = template.appearance?.template?.holeFillColor ?? '#fff';
    const centerDot = template.appearance?.template?.centerDotColor ?? stroke;
    const labelColor = template.appearance?.defaults?.label?.color ?? '#111827';
    return [
        '<defs>',
        '<style>',
        `.enclosure{fill:${enclosureFill};stroke:${stroke};stroke-width:.35;}`,
        `.side-panel{fill:${sideFill};fill-opacity:.55;stroke:${stroke};stroke-width:.3;}`,
        `.fold-fill{fill:#0f172a;fill-opacity:${mode === 'print' ? '.04' : '.08'};stroke:none;}`,
        `.fold-line{stroke:${foldColor};stroke-width:.18;stroke-dasharray:1.5 1.5;}`,
        `.guide-line{stroke:${guideColor};stroke-width:.14;stroke-dasharray:1.2 1.2;opacity:.55;}`,
        `.hole{fill:${holeFill};stroke:${holeStroke};stroke-width:.35;}`,
        `.drill-hole-center-dot{fill:${centerDot};stroke:none;}`,
        `.decal-outline{fill:none;stroke:${stroke};stroke-width:.25;stroke-dasharray:2 1;}`,
        `.label{fill:${labelColor};font-family:Arial,sans-serif;font-size:2.6px;}`,
        '.muted{fill:#475569;font-family:Arial,sans-serif;font-size:2.3px;}',
        '</style>',
        '</defs>',
    ].join('');
}

function drillTemplateHeaderSvg(template: StompboxDrillTemplate): string {
    if (template.mode !== 'print') {
        return '';
    }
    return '';
}

function drillTemplateEnclosureSvg(template: StompboxDrillTemplate): string {
    const layout = outsideDrillTemplateLayout(template.enclosure, template.canvasMm);
    const { top, left, right, back, bottom } = layout.panels;
    const topCenterX = top.x + top.width / 2;
    const topCenterY = top.y + top.height / 2;
    return [
        `<g ${svgAttributes([
            ['data-enclosure-id', template.enclosure.variantId],
            ['data-template-view', 'outside-unfolded'],
        ])}>`,
        drillTemplatePanelSvg(back, 'panel side-panel', template.appearance),
        drillTemplatePanelSvg(left, 'panel side-panel', template.appearance),
        drillTemplatePanelSvg(right, 'panel side-panel', template.appearance),
        drillTemplatePanelSvg(bottom, 'panel side-panel', template.appearance),
        drillTemplatePanelSvg(top, 'panel top-panel enclosure', template.appearance),
        drillTemplateFoldFillSvg(back),
        drillTemplateFoldFillSvg(left),
        drillTemplateFoldFillSvg(right),
        drillTemplateFoldFillSvg(bottom),
        drillTemplateLineSvg('fold-line', [
            ['data-fold-line', 'left'],
            ['x1', top.x],
            ['y1', top.y],
            ['x2', top.x],
            ['y2', top.y + top.height],
        ], template.appearance),
        drillTemplateLineSvg('fold-line', [
            ['data-fold-line', 'right'],
            ['x1', top.x + top.width],
            ['y1', top.y],
            ['x2', top.x + top.width],
            ['y2', top.y + top.height],
        ], template.appearance),
        drillTemplateLineSvg('fold-line', [
            ['data-fold-line', 'back'],
            ['x1', top.x],
            ['y1', top.y],
            ['x2', top.x + top.width],
            ['y2', top.y],
        ], template.appearance),
        drillTemplateLineSvg('fold-line', [
            ['data-fold-line', 'bottom'],
            ['x1', top.x],
            ['y1', top.y + top.height],
            ['x2', top.x + top.width],
            ['y2', top.y + top.height],
        ], template.appearance),
        drillTemplateLineSvg('guide-line', [
            ['data-template-guide', 'vertical-centerline'],
            ['x1', topCenterX],
            ['y1', layout.panels.back.y],
            ['x2', topCenterX],
            ['y2', layout.panels.bottom.y + layout.panels.bottom.height],
        ], template.appearance),
        drillTemplateLineSvg('guide-line', [
            ['data-template-guide', 'horizontal-centerline'],
            ['x1', layout.panels.left.x],
            ['y1', topCenterY],
            ['x2', layout.panels.right.x + layout.panels.right.width],
            ['y2', topCenterY],
        ], template.appearance),
        ...template.holes.map((hole) => drillTemplateHoleSvg(hole, template.mode, template.appearance)),
        '</g>',
    ].join('');
}

function drillTemplatePanelSvg(
    panel: DrillTemplatePanel,
    className: string,
    appearance: StompboxAppearance | undefined,
): string {
    const isTop = panel.id === 'top';
    return `<rect ${svgAttributes([
        ['class', className],
        ['data-face-panel', panel.id],
        ['x', svgNumber(panel.x)],
        ['y', svgNumber(panel.y)],
        ['width', svgNumber(panel.width)],
        ['height', svgNumber(panel.height)],
        ['rx', isTop ? 2.5 : 0],
        ['fill', isTop ? appearance?.enclosure?.color : appearance?.template?.offColor],
        ['stroke', appearance?.enclosure?.strokeColor],
    ])}/>`;
}

function drillTemplateFoldFillSvg(panel: DrillTemplatePanel): string {
    const inset = Math.min(panel.width, panel.height) > 12 ? 4 : 2;
    return `<rect ${svgAttributes([
        ['class', 'fold-fill'],
        ['data-face-panel-fill', panel.id],
        ['x', svgNumber(panel.x + inset)],
        ['y', svgNumber(panel.y + inset)],
        ['width', svgNumber(Math.max(panel.width - inset * 2, 0))],
        ['height', svgNumber(Math.max(panel.height - inset * 2, 0))],
    ])}/>`;
}

function drillTemplateLineSvg(
    className: string,
    attributes: readonly (readonly [string, SvgAttributeValue])[],
    appearance?: StompboxAppearance,
): string {
    const stroke = className === 'guide-line'
        ? appearance?.template?.guideColor
        : className === 'fold-line'
            ? appearance?.template?.foldColor
            : undefined;
    const normalized = attributes.map(([name, value]) => [
        name,
        typeof value === 'number' ? svgNumber(value) : value,
    ] as const);
    return `<line ${svgAttributes([
        ['class', className],
        ['stroke', stroke],
        ...normalized,
    ])}/>`;
}

function drillTemplateHoleSvg(
    hole: StompboxDrillTemplateHole,
    mode: StompboxTemplateMode,
    appearance: StompboxAppearance | undefined,
): string {
    const radius = hole.drillDiameterMm / 2;
    const visibleDiameter = partVisibleDiameterMm(hole.partId);
    const profile = drillHoleProfileForHole(hole);
    const part = STOMPBOX_PART_CATALOG[hole.partId];
    const labelId = `label-${decalIdSegment(hole.id)}`;
    const labelAppearance = part === undefined
        ? undefined
        : labelAppearanceFor(labelId, hole.controlId, part, appearance);
    const label = labelAppearance?.text ?? drillTemplateHoleLabel(hole);
    const labelY = drillTemplateHoleLabelY(hole, radius, part);
    const labelAttrs = svgAttributes([
        ['class', 'label'],
        ['x', svgNumber(hole.templateCenterMm.x)],
        ['y', svgNumber(labelY)],
        ['text-anchor', 'middle'],
        ['fill', labelAppearance?.color],
        ['font-family', labelAppearance?.fontFamily],
        ['font-size', labelAppearance?.fontSizeMm === undefined ? undefined : svgNumber(labelAppearance.fontSizeMm)],
    ]);
    return [
        `<g ${svgAttributes([
            ['data-hole-id', hole.id],
            ['data-part-profile-id', hole.partId],
            ['data-face', hole.face],
            ['data-template-face', hole.face],
            ['data-provenance', hole.provenance],
            ['data-drill-diameter-mm', svgNumber(hole.drillDiameterMm)],
            ['data-drill-radius-mm', svgNumber(radius)],
            ['data-part-visible-diameter-mm', visibleDiameter === undefined ? undefined : svgNumber(visibleDiameter)],
            ['data-drill-hole-profile-id', profile?.id],
            ['data-drill-hole-profile-label', profile?.label],
            ['data-drill-hole-profile-diameter-mm', profile === undefined ? undefined : svgNumber(profile.diameterMm)],
            ['data-drill-hole-profile-fraction-inches', profile?.fractionInches],
        ])}>`,
        drillTemplateHoleMarkerSvg(hole, radius, profile, appearance),
        label === undefined
            ? ''
            : `<text ${labelAttrs}>${escapeText(label)}</text>`,
        '</g>',
    ].join('');
}

function drillTemplateHoleLabelY(
    hole: StompboxDrillTemplateHole,
    radius: number,
    part: StompboxPartProfile | undefined,
): number {
    if (part?.family === 'dc-jack') {
        return hole.templateCenterMm.y + radius + 3.5;
    }
    return hole.templateCenterMm.y - radius - 1.8;
}

function drillTemplateHoleLabel(hole: StompboxDrillTemplateHole): string | undefined {
    const part = STOMPBOX_PART_CATALOG[hole.partId];
    if (part?.family === 'footswitch') {
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
        ['class', 'drill-hole-center-dot'],
        ['cx', svgNumber(hole.templateCenterMm.x)],
        ['cy', svgNumber(hole.templateCenterMm.y)],
        ['r', svgNumber(dotRadius)],
        ['fill', appearance?.template?.centerDotColor],
    ])}/>`;
    if (profile?.marker === 'center-dot') {
        return centerDot;
    }
    return [
        `<circle ${svgAttributes([
            ['class', 'hole drill-hole-profile-outer'],
            ['cx', svgNumber(hole.templateCenterMm.x)],
            ['cy', svgNumber(hole.templateCenterMm.y)],
            ['r', svgNumber(radius)],
            ['fill', appearance?.template?.holeFillColor],
            ['stroke', appearance?.template?.holeStrokeColor],
        ])}/>`,
        centerDot,
    ].join('');
}

function drillTemplateCenterDotRadius(radius: number): number {
    return Math.min(1.5, Math.max(0.55, radius * 0.25));
}

function drillHoleProfileForHole(hole: StompboxDrillHole): StompboxDrillHoleProfile | undefined {
    if (hole.drillHoleProfileId !== undefined) {
        return STOMPBOX_DRILL_HOLE_PROFILE_CATALOG[hole.drillHoleProfileId];
    }
    return Object.values(STOMPBOX_DRILL_HOLE_PROFILE_CATALOG)
        .find((profile) => Math.abs(profile.diameterMm - hole.drillDiameterMm) < 0.001);
}

function drillTemplateDecalsSvg(template: StompboxDrillTemplate): string {
    if (template.decals.length === 0) {
        return '';
    }
    const layout = outsideDrillTemplateLayout(template.enclosure, template.canvasMm);
    return [
        '<g data-decal-outlines="true">',
        ...template.decals.map((decal) => drillTemplateDecalOutlineSvg(decal, layout, template.enclosure)),
        '</g>',
    ].join('');
}

function drillTemplateDecalOutlineSvg(
    decal: StompboxPreviewDecal,
    layout: DrillTemplateOutsideLayout,
    enclosure: StompboxEnclosureProfile,
): string {
    const center = drillTemplateCenterForPlacement(decal.face, decal.centerMm, layout, enclosure);
    return [
        `<g ${svgAttributes([
            ['data-decal-outline', true],
            ['data-decal-id', decal.id],
            ['data-decal-kind', decal.kind],
            ['data-face', decal.face],
            ['transform', `translate(${svgNumber(center.x)} ${svgNumber(center.y)}) rotate(${svgNumber(decal.rotationDeg)})`],
        ])}>`,
        `<rect class="decal-outline" x="${svgNumber(-decal.sizeMm.widthMm / 2)}" y="${svgNumber(-decal.sizeMm.heightMm / 2)}" width="${svgNumber(decal.sizeMm.widthMm)}" height="${svgNumber(decal.sizeMm.heightMm)}" rx=".8"/>`,
        '</g>',
    ].join('');
}

function drillTemplateScaleMarksSvg(template: StompboxDrillTemplate): string {
    if (template.scaleMarks.length === 0) {
        return '';
    }
    return [
        '<g data-scale-marks="true">',
        ...template.scaleMarks.map((mark) => [
            `<g ${svgAttributes([
                ['data-scale-mark-id', mark.id],
                ['data-scale-mark-mm', mark.lengthMm],
            ])}>`,
            `<line x1="${svgNumber(mark.startMm.x)}" y1="${svgNumber(mark.startMm.y)}" x2="${svgNumber(mark.endMm.x)}" y2="${svgNumber(mark.endMm.y)}" stroke="#111827" stroke-width=".35"/>`,
            `<line x1="${svgNumber(mark.startMm.x)}" y1="${svgNumber(mark.startMm.y - 1.5)}" x2="${svgNumber(mark.startMm.x)}" y2="${svgNumber(mark.startMm.y + 1.5)}" stroke="#111827" stroke-width=".35"/>`,
            `<line x1="${svgNumber(mark.endMm.x)}" y1="${svgNumber(mark.endMm.y - 1.5)}" x2="${svgNumber(mark.endMm.x)}" y2="${svgNumber(mark.endMm.y + 1.5)}" stroke="#111827" stroke-width=".35"/>`,
            '</g>',
        ].join('')),
        '</g>',
    ].join('');
}

function drillTemplateHoleTableSvg(template: StompboxDrillTemplate): string {
    if (template.holeTable.length === 0) {
        return '';
    }
    return '';
}

function previewViewSvg(preview: StompboxPreview, view: StompboxPreviewSvgViewId): string {
    const canvas = previewViewCanvas(preview, view);
    const titleId = `stompbox-preview-${view}-title`;
    const descId = `stompbox-preview-${view}-desc`;
    const attrs = svgAttributes([
        ['xmlns', 'http://www.w3.org/2000/svg'],
        ['role', 'img'],
        ['aria-labelledby', `${titleId} ${descId}`],
        ['width', `${svgNumber(canvas.widthMm)}mm`],
        ['height', `${svgNumber(canvas.heightMm)}mm`],
        ['viewBox', `0 0 ${svgNumber(canvas.widthMm)} ${svgNumber(canvas.heightMm)}`],
        ['data-view', view],
        ['data-units', preview.units],
    ]);
    const parts = preview.parts
        .filter((part) => partVisibleInView(part, view))
        .map((part) => previewPartSvg(preview, part, view, canvas))
        .join('');
    const decals = preview.decals
        .filter((decal) => decalVisibleInView(decal, view))
        .map((decal) => previewDecalSvg(preview, decal, view, canvas))
        .join('');
    return [
        `<svg ${attrs}>`,
        `<title id="${escapeAttribute(titleId)}">Stompbox preview ${escapeText(view)} view</title>`,
        `<desc id="${escapeAttribute(descId)}">Orthographic ${escapeText(view)} SVG preview for the stompbox assembly.</desc>`,
        '<defs><style>.case{fill:#f8fafc;stroke:#334155;stroke-width:.35}.decal-bounds{fill:none;stroke:#475569;stroke-width:.18;stroke-dasharray:1.5 1}</style></defs>',
        previewFrameSvg(preview, view, canvas),
        decals,
        parts,
        '</svg>',
    ].join('');
}

function previewViewCanvas(
    preview: StompboxPreview,
    view: StompboxPreviewSvgViewId,
): Readonly<{ widthMm: number; heightMm: number }> {
    if (view === 'left' || view === 'right') {
        return {
            widthMm: preview.enclosure.dimensionsMm.depthMm,
            heightMm: preview.enclosure.dimensionsMm.lengthMm,
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
    const enclosureFill = preview.enclosure.material?.color ?? '#f8fafc';
    const enclosureStroke = preview.enclosure.material?.strokeColor ?? '#334155';
    return [
        `<g data-enclosure-id="${escapeAttribute(preview.enclosure.variantId)}" data-enclosure-view="${escapeAttribute(view)}">`,
        `<rect class="case" x="0" y="0" width="${svgNumber(canvas.widthMm)}" height="${svgNumber(canvas.heightMm)}" rx="2.5" fill="${escapeAttribute(enclosureFill)}" stroke="${escapeAttribute(enclosureStroke)}"/>`,
        view === 'bottom'
            ? `<rect x="4" y="4" width="${svgNumber(canvas.widthMm - 8)}" height="${svgNumber(canvas.heightMm - 8)}" rx="2" fill="none" stroke="#94a3b8" stroke-width=".25" data-enclosure-bottom="true"/>`
            : '',
        '</g>',
    ].join('');
}

function previewPartSvg(
    preview: StompboxPreview,
    part: StompboxPreviewPart,
    view: StompboxPreviewSvgViewId,
    canvas: Readonly<{ widthMm: number; heightMm: number }>,
): string {
    const profile = STOMPBOX_PART_CATALOG[part.partId];
    if (profile === undefined) {
        return '';
    }
    const point = previewPointForPart(preview, part, view, canvas);
    const attrs = svgAttributes([
        ['data-part-id', part.id],
        ['data-part-profile-id', part.partId],
        ['data-part-family', profile.family],
        ['data-control-id', part.controlId],
        ['data-face', part.face],
        ['data-provenance', part.provenance],
        ['data-knob-rotation-deg', profile.geometry.kind === 'knob' ? part.transform.rotationDeg.z : undefined],
        ['data-led-emissive', profile.family === 'led' ? part.material?.emissive === true : undefined],
        ['data-footswitch-pressed', profile.geometry.kind === 'footswitch' ? part.transform.translationMm.z < preview.enclosure.dimensionsMm.depthMm / 2 : undefined],
    ]);
    return [
        `<g ${attrs}>`,
        previewPartShapeSvg(profile, part, point),
        '</g>',
    ].join('');
}

function previewDecalSvg(
    preview: StompboxPreview,
    decal: StompboxPreviewDecal,
    view: StompboxPreviewSvgViewId,
    canvas: Readonly<{ widthMm: number; heightMm: number }>,
): string {
    const point = previewPointForDecal(preview, decal, view, canvas);
    const bounds = decal.id.startsWith('label-')
        ? ''
        : `<rect class="decal-bounds" x="${svgNumber(-decal.sizeMm.widthMm / 2)}" y="${svgNumber(-decal.sizeMm.heightMm / 2)}" width="${svgNumber(decal.sizeMm.widthMm)}" height="${svgNumber(decal.sizeMm.heightMm)}" rx=".8"/>`;
    return [
        `<g ${svgAttributes([
            ['data-decal-id', decal.id],
            ['data-decal-kind', decal.kind],
            ['data-face', decal.face],
            ['transform', `translate(${svgNumber(point.x)} ${svgNumber(point.y)}) rotate(${svgNumber(decal.rotationDeg)})`],
        ])}>`,
        bounds,
        previewDecalContentSvg(decal),
        '</g>',
    ].join('');
}

function previewDecalContentSvg(decal: StompboxPreviewDecal): string {
    if (decal.kind === 'text') {
        return `<text class="label-text" x="0" y="0" text-anchor="middle" dominant-baseline="middle" font-family="${escapeAttribute(decal.fontFamily)}" font-size="${svgNumber(decal.fontSizeMm)}" fill="${escapeAttribute(decal.color)}">${escapeText(decal.text)}</text>`;
    }
    return `<image href="${escapeAttribute(svgDataUri(decal.svg))}" x="${svgNumber(-decal.sizeMm.widthMm / 2)}" y="${svgNumber(-decal.sizeMm.heightMm / 2)}" width="${svgNumber(decal.sizeMm.widthMm)}" height="${svgNumber(decal.sizeMm.heightMm)}" preserveAspectRatio="xMidYMid meet"/>`;
}

function previewPartShapeSvg(
    profile: StompboxPartProfile,
    part: StompboxPreviewPart,
    point: StompboxPoint2,
): string {
    const geometry = profile.geometry;
    if (geometry.kind === 'knob') {
        const radius = geometry.diameterMm / 2;
        const fill = part.material?.color ?? '#334155';
        const stroke = part.material?.strokeColor ?? '#0f172a';
        const indicator = part.material?.indicatorColor ?? '#f8fafc';
        return [
            `<circle class="knob-body" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius)}" fill="${escapeAttribute(fill)}" stroke="${escapeAttribute(stroke)}" stroke-width=".35"/>`,
            `<line class="knob-indicator" x1="${svgNumber(point.x)}" y1="${svgNumber(point.y)}" x2="${svgNumber(point.x)}" y2="${svgNumber(point.y - radius + 2)}" stroke="${escapeAttribute(indicator)}" stroke-width=".8" stroke-linecap="round" transform="rotate(${svgNumber(part.transform.rotationDeg.z)} ${svgNumber(point.x)} ${svgNumber(point.y)})"/>`,
        ].join('');
    }
    if (geometry.kind === 'led' || geometry.kind === 'led-bezel') {
        const radius = (geometry.kind === 'led' ? geometry.flangeDiameterMm : geometry.outerDiameterMm) / 2;
        const fill = part.material?.emissive === true ? (part.material.color ?? '#ef4444') : (part.material?.offColor ?? '#fee2e2');
        const stroke = part.material?.strokeColor ?? '#7f1d1d';
        const opacity = part.material?.emissive === true ? '1' : '.45';
        return `<circle class="led-lens" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(radius)}" fill="${escapeAttribute(fill)}" fill-opacity="${opacity}" stroke="${escapeAttribute(stroke)}" stroke-width=".3"/>`;
    }
    if (geometry.kind === 'footswitch') {
        const pressed = part.transform.translationMm.z < 15.5;
        const nutFill = part.material?.color ?? '#d1d5db';
        const buttonFill = pressed
            ? (part.material?.pressedColor ?? '#64748b')
            : (part.material?.offColor ?? '#94a3b8');
        const stroke = part.material?.strokeColor ?? '#374151';
        return [
            `<circle class="footswitch-nut" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.nutOuterDiameterMm / 2)}" fill="${escapeAttribute(nutFill)}" stroke="${escapeAttribute(stroke)}" stroke-width=".35"/>`,
            `<circle class="footswitch-button" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y + (pressed ? 0.6 : 0))}" r="${svgNumber(geometry.buttonDiameterMm / 2)}" fill="${escapeAttribute(buttonFill)}" stroke="#1f2937" stroke-width=".25"/>`,
        ].join('');
    }
    const stroke = part.material?.strokeColor ?? '#334155';
    const innerStroke = part.material?.color ?? '#94a3b8';
    return [
        `<circle class="ring-outer" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.outerDiameterMm / 2)}" fill="none" stroke="${escapeAttribute(stroke)}" stroke-width=".45"/>`,
        `<circle class="ring-inner" cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="${svgNumber(geometry.innerDiameterMm / 2)}" fill="none" stroke="${escapeAttribute(innerStroke)}" stroke-width=".3"/>`,
    ].join('');
}

function previewPointForPart(
    preview: StompboxPreview,
    part: StompboxPreviewPart,
    view: StompboxPreviewSvgViewId,
    canvas: Readonly<{ widthMm: number; heightMm: number }>,
): StompboxPoint2 {
    if (view === 'left' || view === 'right') {
        return {
            x: canvas.widthMm / 2,
            y: canvas.heightMm / 2 - part.transform.translationMm.y,
        };
    }
    return {
        x: preview.enclosure.dimensionsMm.widthMm / 2 + part.transform.translationMm.x,
        y: preview.enclosure.dimensionsMm.lengthMm / 2 - part.transform.translationMm.y,
    };
}

function previewPointForDecal(
    preview: StompboxPreview,
    decal: StompboxPreviewDecal,
    view: StompboxPreviewSvgViewId,
    canvas: Readonly<{ widthMm: number; heightMm: number }>,
): StompboxPoint2 {
    if (view === 'left' || view === 'right') {
        return {
            x: canvas.widthMm / 2,
            y: canvas.heightMm / 2 - decal.centerMm.y,
        };
    }
    return {
        x: preview.enclosure.dimensionsMm.widthMm / 2 + decal.centerMm.x,
        y: preview.enclosure.dimensionsMm.lengthMm / 2 - decal.centerMm.y,
    };
}

function partVisibleInView(part: StompboxPreviewPart, view: StompboxPreviewSvgViewId): boolean {
    if (view === 'top') {
        return part.face === 'top';
    }
    if (view === 'left') {
        return part.face === 'left';
    }
    if (view === 'right') {
        return part.face === 'right';
    }
    return part.face === 'bottom';
}

function decalVisibleInView(decal: StompboxPreviewDecal, view: StompboxPreviewSvgViewId): boolean {
    if (view === 'top') {
        return decal.face === 'top';
    }
    if (view === 'left') {
        return decal.face === 'left';
    }
    if (view === 'right') {
        return decal.face === 'right';
    }
    return decal.face === 'bottom';
}

function previewGlb(preview: StompboxPreview, options: StompboxPreviewGlbOptions): Uint8Array {
    const appearance = createStompboxAppearancePatch(preview, options.appearance);
    const state: GltfMergeState = {
        sourceAssets: [],
        nodes: [{
            name: 'stompbox-preview-root',
            children: [],
            extras: {
                schema: 'stompbox-preview-glb/v1',
                units: preview.units,
                enclosureId: preview.enclosure.variantId,
                decals: preview.decals.map((decal) => previewDecalJson(decal)),
                appearance,
            },
        }],
        meshes: [],
        materials: [],
        bufferViews: [],
        accessors: [],
        binaryParts: [],
        binaryByteLength: 0,
    };
    const rootChildren: number[] = [];
    for (const source of gltfAssemblySources(preview, options)) {
        rootChildren.push(appendAssemblySource(state, source));
    }
    for (const decal of preview.decals) {
        rootChildren.push(appendDecalPlane(state, decal, preview.enclosure));
    }
    const rootNode = state.nodes[0];
    if (rootNode === undefined) {
        throw new Error('internal stompbox GLB assembly error: missing root node');
    }
    rootNode.children = rootChildren;

    const binary = concatUint8Arrays(state.binaryParts, state.binaryByteLength);
    const document: GltfDocument = {
        asset: {
            version: '2.0',
            generator: '@vessel-dsp/stompbox',
            extras: {
                schema: 'stompbox-preview-glb/v1',
                units: preview.units,
                sourceAssets: state.sourceAssets,
                decals: preview.decals.map((decal) => previewDecalJson(decal)),
                appearance,
            },
        },
        scene: 0,
        scenes: [{ name: 'Stompbox Preview', nodes: [0] }],
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
): readonly GltfAssemblySource[] {
    const basePath = options.basePath ?? DEFAULT_STOMPBOX_ARTIFACT_CAD_PARTS_ROOT;
    const enclosureProfileValue = STOMPBOX_ENCLOSURE_CATALOG[preview.enclosure.variantId];
    if (enclosureProfileValue === undefined) {
        throw new Error(`unsupported stompbox enclosure: ${preview.enclosure.variantId}`);
    }
    return [
        {
            id: preview.enclosure.variantId,
            kind: 'enclosure',
            displayGlb: preview.enclosure.assets.glb,
            displayStep: preview.enclosure.assets.step,
            localGlbPath: resolveStompboxAssetPaths(enclosureProfileValue.assets, { basePath }).glb,
            ...(preview.enclosure.material === undefined ? {} : { material: preview.enclosure.material }),
            transform: {
                translation: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            },
            extras: {
                id: preview.enclosure.variantId,
                kind: 'enclosure',
                glb: preview.enclosure.assets.glb,
                step: preview.enclosure.assets.step,
                dimensionsMm: {
                    widthMm: preview.enclosure.dimensionsMm.widthMm,
                    lengthMm: preview.enclosure.dimensionsMm.lengthMm,
                    depthMm: preview.enclosure.dimensionsMm.depthMm,
                },
                ...(preview.enclosure.material === undefined ? {} : { material: previewMaterialJson(preview.enclosure.material) }),
            },
        },
        ...preview.parts.map((part) => partAssemblySource(part, basePath)),
    ];
}

function partAssemblySource(part: StompboxPreviewPart, basePath: string): GltfAssemblySource {
    const profile = STOMPBOX_PART_CATALOG[part.partId];
    if (profile === undefined) {
        throw new Error(`unknown stompbox part profile: ${part.partId}`);
    }
    return {
        id: part.id,
        kind: 'part',
        displayGlb: part.assets.glb,
        displayStep: part.assets.step,
        localGlbPath: resolveStompboxAssetPaths(profile.assets, { basePath }).glb,
        ...(part.material === undefined ? {} : { material: part.material }),
        transform: {
            translation: point3Array(part.transform.translationMm),
            rotation: quaternionFromEulerDeg(part.transform.rotationDeg),
            ...(profile.assetScale === undefined ? {} : { scale: [profile.assetScale, profile.assetScale, profile.assetScale] }),
        },
        extras: {
            id: part.id,
            kind: 'part',
            partId: part.partId,
            face: part.face,
            provenance: part.provenance,
            glb: part.assets.glb,
            step: part.assets.step,
            ...(profile.assetScale === undefined ? {} : { assetScale: profile.assetScale }),
            ...(part.controlId === undefined ? {} : { controlId: part.controlId }),
            ...(part.material === undefined ? {} : { material: previewMaterialJson(part.material) }),
        },
    };
}

function previewMaterialJson(material: StompboxPreviewMaterial): JsonObject {
    return {
        ...(material.color === undefined ? {} : { color: material.color }),
        ...(material.strokeColor === undefined ? {} : { strokeColor: material.strokeColor }),
        ...(material.indicatorColor === undefined ? {} : { indicatorColor: material.indicatorColor }),
        ...(material.offColor === undefined ? {} : { offColor: material.offColor }),
        ...(material.pressedColor === undefined ? {} : { pressedColor: material.pressedColor }),
        ...(material.emissive === undefined ? {} : { emissive: material.emissive }),
        ...(material.intensity === undefined ? {} : { intensity: material.intensity }),
        ...(material.metallicFactor === undefined ? {} : { metallicFactor: material.metallicFactor }),
        ...(material.roughnessFactor === undefined ? {} : { roughnessFactor: material.roughnessFactor }),
        ...(material.opacity === undefined ? {} : { opacity: material.opacity }),
    };
}

function previewDecalJson(decal: StompboxPreviewDecal): JsonObject {
    return {
        id: decal.id,
        kind: 'decal',
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
        ...(decal.kind === 'text'
            ? {
                text: decal.text,
                color: decal.color,
                fontFamily: decal.fontFamily,
                fontSizeMm: decal.fontSizeMm,
            }
            : { svg: decal.svg }),
    };
}

function appendDecalPlane(
    state: GltfMergeState,
    decal: StompboxPreviewDecal,
    enclosure: StompboxPreviewEnclosure,
): number {
    const materialIndex = state.materials.length;
    const color = decal.kind === 'text' ? decal.color : '#0f172a';
    state.materials.push({
        name: `decal-${decal.id}/material`,
        alphaMode: 'BLEND',
        doubleSided: true,
        pbrMetallicRoughness: {
            baseColorFactor: [...hexColorToRgb(color), 0.35],
            metallicFactor: 0,
            roughnessFactor: 1,
        },
    });

    const positionAccessor = appendDecalPositionAccessor(state, decal.sizeMm);
    const indexAccessor = appendDecalIndexAccessor(state);
    const meshIndex = state.meshes.length;
    state.meshes.push({
        name: `decal-${decal.id}/plane`,
        primitives: [{
            attributes: { POSITION: positionAccessor },
            indices: indexAccessor,
            material: materialIndex,
            mode: 4,
        }],
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

function appendDecalPositionAccessor(state: GltfMergeState, sizeMm: StompboxSize2): number {
    const halfWidth = sizeMm.widthMm / 2;
    const halfHeight = sizeMm.heightMm / 2;
    const positions = new Float32Array([
        -halfWidth, -halfHeight, 0,
        halfWidth, -halfHeight, 0,
        halfWidth, halfHeight, 0,
        -halfWidth, halfHeight, 0,
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
        type: 'VEC3',
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
        type: 'SCALAR',
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
    const translation = translationForFace(decal.face, decal.centerMm, enclosure);
    const rotation = baseRotationForFace(decal.face);
    return {
        translationMm: {
            ...translation,
            z: translation.z + 0.2,
        },
        rotationDeg: {
            ...rotation,
            z: rotation.z + decal.rotationDeg,
        },
    };
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

function appendAssemblySource(state: GltfMergeState, source: GltfAssemblySource): number {
    state.sourceAssets.push({
        id: source.id,
        kind: source.kind,
        glb: source.displayGlb,
        step: source.displayStep,
    });
    const wrapperIndex = state.nodes.length;
    const wrapper: MutableJsonObject = {
        name: `${source.kind === 'enclosure' ? 'enclosure' : 'part'}-${source.id}`,
        translation: source.transform.translation,
        rotation: source.transform.rotation,
        ...(source.transform.scale === undefined ? {} : { scale: source.transform.scale }),
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
            sourceUnits: 'm',
            outputUnits: 'mm',
        },
    };
    state.nodes.push(sourceScaleNode);
    wrapper.children = [sourceScaleIndex];
    sourceScaleNode.children = appendSourceGlb(state, source);
    return wrapperIndex;
}

function appendSourceGlb(state: GltfMergeState, source: GltfAssemblySource): readonly number[] {
    const parsed = parseGlbFile(source.localGlbPath);
    const bufferOffset = appendBinaryChunk(state, parsed.binary.slice(0, parsed.bufferByteLength));
    const bufferViewOffset = state.bufferViews.length;
    const accessorOffset = state.accessors.length;
    const materialOffset = state.materials.length;
    const meshOffset = state.meshes.length;
    const nodeOffset = state.nodes.length;

    for (const material of jsonObjectArray(parsed.json, 'materials')) {
        state.materials.push(applyGltfMaterialAppearance(
            prefixNamedObject(material, `${source.id}/`),
            source.material,
        ));
    }
    for (const bufferView of jsonObjectArray(parsed.json, 'bufferViews')) {
        state.bufferViews.push(remapBufferView(bufferView, bufferOffset));
    }
    for (const accessor of jsonObjectArray(parsed.json, 'accessors')) {
        state.accessors.push(remapAccessor(accessor, bufferViewOffset));
    }
    for (const mesh of jsonObjectArray(parsed.json, 'meshes')) {
        state.meshes.push(remapMesh(mesh, accessorOffset, materialOffset, `${source.id}/`));
    }
    for (const node of jsonObjectArray(parsed.json, 'nodes')) {
        state.nodes.push(remapNode(node, nodeOffset, meshOffset, `${source.id}/`));
    }
    return sourceSceneRootNodeIndexes(parsed.json).map((nodeIndex) => nodeIndex + nodeOffset);
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
        const color = hexColorToRgb(appearance.color ?? '#0f172a');
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
        const color = hexColorToRgb(appearance.color ?? '#ef4444');
        const intensity = appearance.intensity ?? 1;
        material.emissiveFactor = color.map((channel) => channel * intensity);
    }
    return material;
}

function remapBufferView(bufferView: JsonObject, byteOffset: number): MutableJsonObject {
    const copy = cloneJsonObject(bufferView);
    copy.buffer = 0;
    copy.byteOffset = numberValue(copy.byteOffset) + byteOffset;
    return copy;
}

function remapAccessor(accessor: JsonObject, bufferViewOffset: number): MutableJsonObject {
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
): MutableJsonObject {
    const copy = prefixNamedObject(mesh, namePrefix);
    const primitives = jsonObjectArray(mesh, 'primitives').map((primitive) =>
        remapPrimitive(primitive, accessorOffset, materialOffset)
    );
    copy.primitives = primitives;
    return copy;
}

function remapPrimitive(
    primitive: JsonObject,
    accessorOffset: number,
    materialOffset: number,
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
        copy.material = material + materialOffset;
    }
    const targets = jsonArrayValue(primitive.targets);
    if (targets !== undefined) {
        copy.targets = targets.map((target) =>
            jsonObjectValue(target) === undefined
                ? target
                : remapAccessorMap(jsonObjectValue(target) ?? {}, accessorOffset)
        );
    }
    return copy;
}

function remapAccessorMap(map: JsonObject, accessorOffset: number): MutableJsonObject {
    const copy: MutableJsonObject = {};
    for (const [key, value] of Object.entries(map)) {
        copy[key] = typeof value === 'number' ? value + accessorOffset : cloneJsonValue(value);
    }
    return copy;
}

function remapNode(node: JsonObject, nodeOffset: number, meshOffset: number, namePrefix: string): MutableJsonObject {
    const copy = prefixNamedObject(node, namePrefix);
    if (copy.mesh !== undefined) {
        copy.mesh = numberValue(copy.mesh) + meshOffset;
    }
    const children = jsonArrayValue(copy.children);
    if (children !== undefined) {
        copy.children = children.flatMap((child) => typeof child === 'number' ? [child + nodeOffset] : []);
    }
    return copy;
}

function prefixNamedObject(object: JsonObject, namePrefix: string): MutableJsonObject {
    const copy = cloneJsonObject(object);
    const name = typeof copy.name === 'string' ? copy.name : 'unnamed';
    copy.name = `${namePrefix}${name}`;
    return copy;
}

function sourceSceneRootNodeIndexes(json: JsonObject): readonly number[] {
    const sceneIndex = numberValue(json.scene);
    const scenes = jsonObjectArray(json, 'scenes');
    const scene = scenes[sceneIndex] ?? scenes[0];
    if (scene === undefined) {
        return jsonObjectArray(json, 'nodes').map((_node, index) => index);
    }
    const nodes = jsonArrayValue(scene.nodes);
    if (nodes === undefined) {
        return [];
    }
    return nodes.flatMap((node) => typeof node === 'number' ? [node] : []);
}

function parseGlbFile(path: string): ParsedGlb {
    const bytes = new Uint8Array(readFileSync(path));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
        throw new Error(`not a glTF 2.0 binary file: ${path}`);
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
            json = parseJsonObject(new TextDecoder().decode(chunk).trim(), path);
        } else if (chunkType === 0x004e4942) {
            binary = chunk;
        }
        offset = chunkStart + chunkLength;
    }
    if (json === undefined) {
        throw new Error(`GLB file has no JSON chunk: ${path}`);
    }
    return {
        json,
        binary,
        bufferByteLength: sourceBufferByteLength(json, binary),
    };
}

function sourceBufferByteLength(json: JsonObject, binary: Uint8Array): number {
    const buffers = jsonObjectArray(json, 'buffers');
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
        state.binaryParts.push(new Uint8Array(alignedOffset - state.binaryByteLength));
        state.binaryByteLength = alignedOffset;
    }
    const offset = state.binaryByteLength;
    state.binaryParts.push(bytes);
    state.binaryByteLength += bytes.byteLength;
    return offset;
}

function concatUint8Arrays(parts: readonly Uint8Array[], totalLength: number): Uint8Array {
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

function jsonObjectArray(object: JsonObject, key: string): readonly JsonObject[] {
    const value = object[key];
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => jsonObjectValue(item) === undefined ? [] : [jsonObjectValue(item) ?? {}]);
}

function jsonArrayValue(value: JsonValue | undefined): readonly JsonValue[] | undefined {
    return Array.isArray(value) ? value : undefined;
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject | undefined {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as JsonObject;
    }
    return undefined;
}

function numberValue(value: JsonValue | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
    if (typeof value === 'object' && value !== null) {
        return cloneJsonObject(value as JsonObject);
    }
    return value;
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeGlb(document: GltfDocument, binary: Uint8Array): Uint8Array {
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(JSON.stringify(document));
    const paddedJsonLength = align4(jsonBytes.byteLength);
    const paddedBinaryLength = align4(binary.byteLength);
    const bytes = new Uint8Array(12 + 8 + paddedJsonLength + 8 + paddedBinaryLength);
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

function quaternionFromEulerDeg(rotation: StompboxRotationDeg): readonly number[] {
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
    return degrees * Math.PI / 180;
}

function svgAttributes(attributes: readonly (readonly [string, SvgAttributeValue])[]): string {
    return attributes
        .flatMap(([name, value]) => value === undefined ? [] : [`${name}="${escapeAttribute(String(value))}"`])
        .join(' ');
}

function escapeText(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
    return escapeText(value)
        .replaceAll('"', '&quot;');
}

function svgDataUri(svg: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function svgNumber(value: number): string {
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    if (Object.is(rounded, -0)) {
        return '0';
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
    return drillTemplateCenterForPlacement(hole.face, hole.centerMm, layout, enclosure);
}

function drillTemplateCenterForPlacement(
    face: StompboxFaceId,
    centerMm: StompboxPoint2,
    layout: DrillTemplateOutsideLayout,
    enclosure: StompboxEnclosureProfile,
): StompboxPoint2 {
    const { widthMm, lengthMm, depthMm } = enclosure.dimensionsMm;
    if (face === 'left') {
        const panel = layout.panels.left;
        return {
            x: panel.x + depthMm / 2,
            y: panel.y + lengthMm / 2 - centerMm.y,
        };
    }
    if (face === 'right') {
        const panel = layout.panels.right;
        return {
            x: panel.x + depthMm / 2,
            y: panel.y + lengthMm / 2 - centerMm.y,
        };
    }
    if (face === 'back') {
        const panel = layout.panels.back;
        return {
            x: panel.x + widthMm / 2 + centerMm.x,
            y: panel.y + depthMm / 2,
        };
    }

    const panel = layout.panels.top;
    return {
        x: panel.x + widthMm / 2 + centerMm.x,
        y: panel.y + lengthMm / 2 - centerMm.y,
    };
}

function unfoldedDrillTemplateSize(enclosure: StompboxEnclosureProfile): Readonly<{ widthMm: number; heightMm: number }> {
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
        id: 'top',
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
                id: 'left',
                x,
                y: top.y,
                width: depthMm,
                height: lengthMm,
            },
            right: {
                id: 'right',
                x: top.x + widthMm,
                y: top.y,
                width: depthMm,
                height: lengthMm,
            },
            back: {
                id: 'back',
                x: top.x,
                y,
                width: widthMm,
                height: depthMm,
            },
            bottom: {
                id: 'bottom',
                x: top.x,
                y: top.y + lengthMm,
                width: widthMm,
                height: depthMm,
            },
        },
    };
}

function placementGrid(enclosure: StompboxEnclosureProfile): StompboxPlacementGrid {
    const { widthMm, lengthMm } = enclosure.dimensionsMm;
    const rowCount = Math.max(1, Math.floor(lengthMm / STOMPBOX_GRID_TARGET_ROW_PITCH_MM));
    const usableLengthMm = Math.max(0, lengthMm - STOMPBOX_GRID_EDGE_MARGIN_MM * 2);
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

function autoKnobGrid(count: number, grid: StompboxPlacementGrid, styleProfile: StompboxStyleProfileId): AutoKnobGrid {
    if (count <= 0) {
        return {
            placements: [],
        };
    }
    if (styleProfile === 'boss-style') {
        return bossStyleKnobGrid(count, grid);
    }
    return mxrStyleKnobGrid(count, grid);
}

function bossStyleKnobGrid(count: number, grid: StompboxPlacementGrid): AutoKnobGrid {
    const rowOneY = gridRowCenterY(grid, 1);
    const oneRowKnobY = gridMergedRowCenterY(grid, 1, 2);
    if (count === 2) {
        const useLargeKnobs = largeKnobColumnLimit(grid) >= 2;
        return {
            placements: rowKnobPlacements(
                useLargeKnobs ? STOMPBOX_LARGE_KNOB_PART_ID : STOMPBOX_SMALL_KNOB_PART_ID,
                knobColumnCenters(grid, 2, useLargeKnobs ? STOMPBOX_LARGE_KNOB_DIAMETER_MM : STOMPBOX_SMALL_KNOB_DIAMETER_MM),
                oneRowKnobY,
            ),
        };
    }
    if (count === 3) {
        const useLargeKnobs = largeKnobColumnLimit(grid) >= 2;
        return {
            placements: [
                ...rowKnobPlacements(
                    useLargeKnobs ? STOMPBOX_LARGE_KNOB_PART_ID : STOMPBOX_SMALL_KNOB_PART_ID,
                    knobColumnCenters(grid, 2, useLargeKnobs ? STOMPBOX_LARGE_KNOB_DIAMETER_MM : STOMPBOX_SMALL_KNOB_DIAMETER_MM),
                    rowOneY,
                ),
                { partId: STOMPBOX_SMALL_KNOB_PART_ID, centerMm: { x: 0, y: gridRowCenterY(grid, 2) } },
            ],
        };
    }
    if (count === 4) {
        if (smallKnobColumnLimit(grid) >= 4) {
            return {
                placements: rowKnobPlacements(
                    STOMPBOX_SMALL_KNOB_PART_ID,
                    knobColumnCenters(grid, 4, STOMPBOX_SMALL_KNOB_DIAMETER_MM),
                    oneRowKnobY,
                ),
            };
        }
        const twoColumnCenters = knobColumnCenters(grid, 2, STOMPBOX_SMALL_KNOB_DIAMETER_MM);
        return {
            placements: [
                ...rowKnobPlacements(STOMPBOX_SMALL_KNOB_PART_ID, twoColumnCenters, rowOneY),
                ...rowKnobPlacements(STOMPBOX_SMALL_KNOB_PART_ID, twoColumnCenters, gridRowCenterY(grid, 2)),
            ],
        };
    }
    throw new Error(`unsupported stompbox style profile "boss-style" for ${count} knobs`);
}

function mxrStyleKnobGrid(count: number, grid: StompboxPlacementGrid): AutoKnobGrid {
    const rowOneY = gridRowCenterY(grid, 1);
    const rowTwoY = gridRowCenterY(grid, 2);
    const upperMergedRowY = gridMergedRowCenterY(grid, 1, 2);
    if (count === 1) {
        return {
            placements: [
                { partId: STOMPBOX_LARGE_KNOB_PART_ID, centerMm: { x: 0, y: upperMergedRowY } },
            ],
        };
    }
    if (count === 2) {
        const useLargeKnobs = largeKnobColumnLimit(grid) >= 2;
        return {
            placements: rowKnobPlacements(
                useLargeKnobs ? STOMPBOX_LARGE_KNOB_PART_ID : STOMPBOX_SMALL_KNOB_PART_ID,
                knobColumnCenters(grid, 2, useLargeKnobs ? STOMPBOX_LARGE_KNOB_DIAMETER_MM : STOMPBOX_SMALL_KNOB_DIAMETER_MM),
                upperMergedRowY,
            ),
        };
    }
    if (count === 3) {
        return {
            placements: [
                { partId: STOMPBOX_SMALL_KNOB_PART_ID, centerMm: { x: 0, y: rowOneY } },
                ...rowKnobPlacements(
                    STOMPBOX_SMALL_KNOB_PART_ID,
                    knobColumnCenters(grid, 2, STOMPBOX_SMALL_KNOB_DIAMETER_MM),
                    rowTwoY,
                ),
            ],
        };
    }
    if (count === 4) {
        const twoColumnCenters = knobColumnCenters(grid, 2, STOMPBOX_SMALL_KNOB_DIAMETER_MM);
        return {
            placements: [
                ...rowKnobPlacements(STOMPBOX_SMALL_KNOB_PART_ID, twoColumnCenters, rowOneY),
                ...rowKnobPlacements(STOMPBOX_SMALL_KNOB_PART_ID, twoColumnCenters, rowTwoY),
            ],
        };
    }
    if (count === 5) {
        return {
            placements: [
                ...rowKnobPlacements(
                    STOMPBOX_SMALL_KNOB_PART_ID,
                    knobColumnCenters(grid, 2, STOMPBOX_SMALL_KNOB_DIAMETER_MM),
                    rowOneY,
                ),
                ...rowKnobPlacements(
                    STOMPBOX_SMALL_KNOB_PART_ID,
                    knobColumnCenters(grid, 3, STOMPBOX_SMALL_KNOB_DIAMETER_MM),
                    rowTwoY,
                ),
            ],
        };
    }
    if (count === 6) {
        const threeColumnCenters = knobColumnCenters(grid, 3, STOMPBOX_SMALL_KNOB_DIAMETER_MM);
        return {
            placements: [
                ...rowKnobPlacements(STOMPBOX_SMALL_KNOB_PART_ID, threeColumnCenters, rowOneY),
                ...rowKnobPlacements(STOMPBOX_SMALL_KNOB_PART_ID, threeColumnCenters, rowTwoY),
            ],
        };
    }
    const columns = Math.max(1, Math.min(smallKnobColumnLimit(grid), count));
    const columnCenters = knobColumnCenters(grid, columns, STOMPBOX_SMALL_KNOB_DIAMETER_MM);
    return {
        placements: Array.from({ length: count }, (_unused, index) => {
            const x = columnCenters[index % columns] ?? 0;
            const row = Math.floor(index / columns);
            return {
                partId: STOMPBOX_SMALL_KNOB_PART_ID,
                centerMm: {
                    x,
                    y: gridRowCenterY(grid, row + 1),
                },
            };
        }),
    };
}

function rowKnobPlacements(partId: string, xCenters: readonly number[], y: number): readonly AutoKnobPlacement[] {
    return xCenters.map((x) => ({
        partId,
        centerMm: { x, y },
    }));
}

function mxrStyleLedY(knobCount: number, grid: StompboxPlacementGrid): number {
    if ((knobCount === 1 || knobCount === 2) && grid.rowCount >= 3) {
        return gridRowLowerHalfCenterY(grid, 3);
    }
    return gridRowCenterY(grid, Math.min(3, grid.rowCount));
}

function bossStyleLedY(grid: StompboxPlacementGrid): number {
    const ledRadiusMm = (partVisibleDiameterMm(STOMPBOX_DEFAULT_LED_PART_ID) ?? 3.48) / 2;
    return roundMillimeters(gridTopInsetY(grid) - ledRadiusMm);
}

function footswitchGridY(knobCount: number, grid: StompboxPlacementGrid, styleProfile: StompboxStyleProfileId): number {
    if (styleProfile === 'mxr-style' && (knobCount === 1 || knobCount === 2) && grid.rowCount >= 4) {
        return gridRowCenterY(grid, 4);
    }
    if (styleProfile === 'boss-style' && grid.rowCount >= 5) {
        return gridMergedRowCenterY(grid, 4, 5);
    }
    return gridRowCenterY(grid, grid.rowCount);
}

function gridRowCenterY(grid: StompboxPlacementGrid, rowIndex: number): number {
    return roundMillimeters(grid.lengthMm / 2 - grid.edgeMarginMm - (rowIndex - 0.5) * grid.rowPitchMm);
}

function gridMergedRowCenterY(grid: StompboxPlacementGrid, firstRowIndex: number, lastRowIndex: number): number {
    const rowSpan = lastRowIndex - firstRowIndex + 1;
    return roundMillimeters(
        grid.lengthMm / 2
        - grid.edgeMarginMm
        - (firstRowIndex - 1) * grid.rowPitchMm
        - rowSpan * grid.rowPitchMm / 2,
    );
}

function gridRowLowerHalfCenterY(grid: StompboxPlacementGrid, rowIndex: number): number {
    return roundMillimeters(gridRowCenterY(grid, rowIndex) - grid.rowPitchMm / 4);
}

function gridTopInsetY(grid: StompboxPlacementGrid): number {
    return roundMillimeters(grid.lengthMm / 2 - grid.edgeMarginMm);
}

function knobColumnCenters(grid: StompboxPlacementGrid, columns: number, diameterMm: number): readonly number[] {
    if (columns <= 1) {
        return [0];
    }
    const columnWidth = grid.usableWidthMm / columns;
    const left = -grid.widthMm / 2 + grid.edgeMarginMm + columnWidth / 2;
    const cellCenters = Array.from({ length: columns }, (_unused, index) => roundMillimeters(left + index * columnWidth));
    const first = cellCenters[0] ?? 0;
    const last = cellCenters[cellCenters.length - 1] ?? 0;
    const requestedSpan = (columns - 1) * diameterMm;
    const cellSpan = last - first;
    if (requestedSpan > cellSpan + 0.001) {
        const expandedLeft = -requestedSpan / 2;
        return Array.from({ length: columns }, (_unused, index) => roundMillimeters(expandedLeft + index * diameterMm));
    }
    return cellCenters;
}

function largeKnobColumnLimit(grid: StompboxPlacementGrid): number {
    return Math.max(1, Math.floor(grid.usableWidthMm / STOMPBOX_LARGE_KNOB_MIN_PITCH_MM));
}

function smallKnobColumnLimit(grid: StompboxPlacementGrid): number {
    if (grid.widthMm >= STOMPBOX_1590B_MIN_WIDTH_MM) {
        return 4;
    }
    return Math.max(1, Math.floor(grid.usableWidthMm / STOMPBOX_SMALL_KNOB_DIAMETER_MM));
}

function distributedTopRowPositions(count: number, y: number, spanMm: number): readonly StompboxPoint2[] {
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
    if (jack.role === 'input') {
        return 'right';
    }
    if (jack.role === 'output' || jack.role === 'direct-output') {
        return 'left';
    }
    return undefined;
}

function hasStatusLed(panel: Panel, declared: readonly PlacementCandidate[]): boolean {
    return panel.leds.length > 0 || declared.some((candidate) => candidate.kind === 'led');
}

function hasBypassFootswitch(panel: Panel, declared: readonly PlacementCandidate[]): boolean {
    return panel.switches.some((switchControl) => isSupportedFootswitch(switchControl))
        || declared.some((candidate) => candidate.kind === 'footswitch' || candidate.kind === 'switch');
}

function hasInputJack(panel: Panel, declared: readonly PlacementCandidate[]): boolean {
    return panel.jacks.some((jack) => jack.role === 'input')
        || declared.some((candidate) => candidate.kind === 'jack' && candidate.face === 'right');
}

function hasOutputJack(panel: Panel, declared: readonly PlacementCandidate[]): boolean {
    return panel.jacks.some((jack) => jack.role === 'output' || jack.role === 'direct-output')
        || declared.some((candidate) => candidate.kind === 'jack' && candidate.face === 'left');
}

function hasPowerJack(
    declared: readonly PlacementCandidate[],
    candidates: readonly PlacementCandidate[],
): boolean {
    return [...declared, ...candidates].some((candidate) => candidate.partId === 'dc-socket-dc099');
}

function isSupportedFootswitch(switchControl: SwitchControl): boolean {
    return switchControl.switchKind === '3pdt'
        || switchControl.partNumber?.toLowerCase().includes('3pdt') === true;
}

function centerForJackFace(
    face: StompboxFaceId,
    enclosure: StompboxEnclosureProfile,
    grid: StompboxPlacementGrid,
    hardwareStyle: StompboxHardwarePlacementStyle,
    faceIndex = 0,
): StompboxPoint2 {
    const y = hardwareStyle === 'boss-style'
        ? bossStyleSideJackY(grid, faceIndex)
        : mxrStyleSideAudioJackY(grid, faceIndex);
    if (face === 'right') {
        return { x: enclosure.dimensionsMm.widthMm / 2, y };
    }
    if (face === 'left') {
        return { x: -enclosure.dimensionsMm.widthMm / 2, y };
    }
    return { x: 0, y: gridTopInsetY(grid) };
}

function powerJackFace(hardwareStyle: StompboxHardwarePlacementStyle): StompboxFaceId {
    return hardwareStyle === 'mxr-style' ? 'right' : 'back';
}

function centerForPowerJackFace(
    face: StompboxFaceId,
    enclosure: StompboxEnclosureProfile,
    grid: StompboxPlacementGrid,
    hardwareStyle: StompboxHardwarePlacementStyle,
): StompboxPoint2 {
    if (hardwareStyle === 'mxr-style' && face === 'right') {
        return { x: enclosure.dimensionsMm.widthMm / 2, y: mxrStylePowerJackY(grid) };
    }
    return centerForJackFace(face, enclosure, grid, hardwareStyle);
}

function bossStyleSideJackY(grid: StompboxPlacementGrid, faceIndex: number): number {
    const slotInPair = faceIndex % 2;
    const pairIndex = Math.floor(faceIndex / 2);
    const row = Math.min(3 + pairIndex, grid.rowCount);
    const rowCenterY = gridRowCenterY(grid, row);
    const rowHalfOffsetY = grid.rowPitchMm / 4;
    return roundMillimeters(rowCenterY + (slotInPair === 0 ? rowHalfOffsetY : -rowHalfOffsetY));
}

function mxrStyleSideAudioJackY(grid: StompboxPlacementGrid, faceIndex: number): number {
    return roundMillimeters(mxrStyleFiveSlotCenterY(grid, 3) - faceIndex * grid.lengthMm / 5);
}

function mxrStylePowerJackY(grid: StompboxPlacementGrid): number {
    const audioY = mxrStyleSideAudioJackY(grid, 0);
    const requestedCloseY = mxrStyleFiveSlotCenterY(grid, 4) + grid.lengthMm / 10;
    const minimumDistanceY = (
        (partVisibleDiameterMm('dc-socket-dc099') ?? 14.1)
        + (partVisibleDiameterMm('jack-ts-pj629han') ?? 11)
    ) / 2;
    return roundMillimeters(Math.min(requestedCloseY, audioY - minimumDistanceY));
}

function mxrStyleFiveSlotCenterY(grid: StompboxPlacementGrid, slotIndex: number): number {
    return roundMillimeters(grid.lengthMm / 2 - (slotIndex - 0.5) * grid.lengthMm / 5);
}

function controlIdForPanelElement(element: PanelElementPlacement): string {
    return element.bind.controlId ?? element.interfaceControlId ?? element.bind.componentId;
}

function pointFromCorePoint(point: Point): StompboxPoint2 {
    return { x: point.x, y: point.y };
}

function defaultPartIdForPanelKind(
    kind: PanelControlKind,
    metadata: ControlVisualMetadata | undefined,
): string | undefined {
    switch (kind) {
        case 'knob':
        case 'selector':
            return 'knob-mxr-style-fluted';
        case 'led':
            return STOMPBOX_DEFAULT_LED_PART_ID;
        case 'switch':
        case 'footswitch':
            return metadata?.switchKind === undefined || metadata.switchKind === '3pdt'
                ? 'switch-3pdt-pic-pbs24302'
                : undefined;
        case 'jack':
            return 'jack-ts-pj629han';
        case 'slider':
            return undefined;
    }
}

function knownPartIdOrDefault(
    requestedPartId: string | undefined,
    kind: PanelControlKind,
    metadata: ControlVisualMetadata | undefined,
    diagnostics: StompboxDiagnostic[],
    controlId: string,
    placementId: string | undefined,
): string | undefined {
    if (requestedPartId !== undefined && STOMPBOX_PART_CATALOG[requestedPartId] !== undefined) {
        return requestedPartId;
    }
    if (requestedPartId !== undefined) {
        diagnostics.push({
            code: 'unknown-part-profile',
            message: `Unknown stompbox part profile "${requestedPartId}"`,
            controlId,
            ...(placementId === undefined ? {} : { placementId }),
        });
    }
    return defaultPartIdForPanelKind(kind, metadata);
}

function placementIdForKind(kind: PanelControlKind, controlId: string): string {
    if (kind === 'footswitch') {
        return `switch-${controlId}`;
    }
    return `${kind}-${controlId}`;
}

function assetResolveOptions(options: StompboxAssetResolveOptions): StompboxAssetResolveOptions {
    return {
        ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    };
}

function joinAssetBase(base: string, relativePath: string): string {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
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

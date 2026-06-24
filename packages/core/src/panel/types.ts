import type {
    ControlContext,
    ControlApplicabilityPredicate,
    ControlGroup,
    ControlInterfaceAssignmentHint,
    ControlInterfaceBinding,
    ControlInterfaceConnector,
    ControlInterfacePolarity,
    DeviceInterfaceBinding,
    DeviceInterfaceControl,
    PanelPlacementMetadata,
    ParsedQuantity,
    Warning,
} from '../model/types';

// ---------- Static panel descriptor (extracted from a CircuitDocument) ----------

export type KnobTaper = 'linear' | 'log' | 'reverse-log' | 'unknown';
export type KnobControlMode = 'continuous' | 'stepped';

export type KnobStep = Readonly<{
    index: number;
    position: number;
    label?: string;
}>;

export type Knob = Readonly<{
    id: string;
    name: string;
    taper: KnobTaper;
    controlMode?: KnobControlMode;
    defaultPosition: number;
    steps?: readonly KnobStep[];
    resistance?: ParsedQuantity;
    gangGroup?: string;
    description?: string;
}>;

export type SliderOrientation = 'vertical' | 'horizontal';

export type SliderRange = Readonly<{
    min: number;
    max: number;
    unit?: string;
    center?: number;
}>;

export type SliderControl = Readonly<{
    id: string;
    name: string;
    defaultPosition: number;
    orientation: SliderOrientation;
    range?: SliderRange;
    gangGroup?: string;
    description?: string;
}>;

export type SwitchKind = 'spst' | 'spdt' | 'sp3t' | 'sp4t' | '3pdt' | 'toggle' | 'rotary' | 'unknown';

export type SwitchControl = Readonly<{
    id: string;
    name: string;
    switchKind: SwitchKind;
    poles: number;
    positions: number;
    defaultPosition: number;
    gangGroup?: string;
    partNumber?: string;
    description?: string;
}>;

export type LedIndicator = Readonly<{
    id: string;
    name: string;
    color?: string;
    partNumber?: string;
    description?: string;
}>;

export type JackRole =
    | 'input'
    | 'output'
    | 'direct-output'
    | 'send'
    | 'return'
    | 'expression'
    | 'tempo-tap'
    | 'external-control'
    | 'unknown';

export type JackAudioRole =
    | 'guitar-input'
    | 'bass-input'
    | 'main-output'
    | 'mono-output'
    | 'output-a'
    | 'output-a-mono'
    | 'output-b'
    | 'stereo-output-b'
    | 'direct-output'
    | 'dry-output'
    | 'wet-output'
    | (string & {});

export type ExternalControlAssignmentHint = ControlInterfaceAssignmentHint;

export type JackPort = Readonly<{
    id: string;
    name: string;
    role: JackRole;
    audioRole?: JackAudioRole;
    impedance?: ParsedQuantity;
    sourceTypeName?: string;
    sourceComponentId?: string;
    controlRole?: string;
    interface?: string;
    connector?: ControlInterfaceConnector;
    assignmentHint?: ExternalControlAssignmentHint;
    polarity?: ControlInterfacePolarity;
    binding?: ControlInterfaceBinding;
    description?: string;
}>;

export type Panel = Readonly<{
    placement?: PanelPlacementMetadata;
    knobs: readonly Knob[];
    sliders?: readonly SliderControl[];
    switches: readonly SwitchControl[];
    leds: readonly LedIndicator[];
    jacks: readonly JackPort[];
}>;

export type DeviceInterfaceProvenance =
    | 'vdsp-declared'
    | 'source-inferred'
    | 'runtime-descriptor-inferred'
    | 'control-interface-declared';

export type ExtractedDeviceInterfaceControl = DeviceInterfaceControl & Readonly<{
    provenance: DeviceInterfaceProvenance;
    inferredBinding?: DeviceInterfaceBinding;
}>;

export type ExtractedControlGroupMembership = Readonly<{
    group: ControlGroup;
    control: ExtractedDeviceInterfaceControl;
    order?: number;
    appliesWhen?: ControlApplicabilityPredicate;
    description?: string;
}>;

export type ExtractedDeviceInterface = Readonly<{
    groups: readonly ControlGroup[];
    contexts: readonly ControlContext[];
    controls: readonly ExtractedDeviceInterfaceControl[];
    groupMemberships: readonly ExtractedControlGroupMembership[];
    placement?: PanelPlacementMetadata;
    diagnostics: readonly Warning[];
}>;

// ---------- Runtime control state (UI ↔ DSP wire protocol) ----------

// Every control reports its value through a tagged-union ControlValue.
// The same shape is used in messages going UI → DSP (`control/set`) and DSP → UI
// (`control/changed`, e.g. LED illumination from a level detector).
export type KnobValue = Readonly<{ kind: 'knob'; position: number }>;
export type SliderValue = Readonly<{ kind: 'slider'; position: number }>;
export type SwitchValue = Readonly<{ kind: 'switch'; position: number }>;
export type LedValue = Readonly<{ kind: 'led'; on: boolean; intensity?: number }>;

export type ControlValue = KnobValue | SliderValue | SwitchValue | LedValue;

export type ControlState = Readonly<Record<string, ControlValue>>;

// ---------- Wire protocol ----------

// Message envelope — JSON serializable. Implementations can put this on top of
// any transport (postMessage, WebSocket, MIDI sysex, OSC bundle, FFI marshalling).
// The `requestId` field is optional and lets a caller correlate request/response
// when the transport doesn't already preserve ordering.

export type PanelMessage =
    | Readonly<{ type: 'panel/load'; panel: Panel; requestId?: string }>
    | Readonly<{ type: 'state/snapshot'; state: ControlState; requestId?: string }>
    | Readonly<{ type: 'state/request'; requestId?: string }>
    | Readonly<{ type: 'control/set'; controlId: string; value: ControlValue; requestId?: string }>
    | Readonly<{ type: 'control/changed'; controlId: string; value: ControlValue; requestId?: string }>
    | Readonly<{ type: 'control/error'; controlId: string; reason: string; requestId?: string }>;

export const PANEL_PROTOCOL_VERSION = 1 as const;

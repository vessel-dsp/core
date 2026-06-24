import { isParsedQuantity, propertyNumericValue, propertyStringValue } from '../model/properties';
import type {
    CircuitDocument,
    Component,
    ControlGroup,
    ControlInterface,
    DeviceInterfaceBinding,
    DeviceInterfaceControl,
    DeviceInterfaceControlKind,
    ParsedQuantity,
    PropertyValue,
    Warning,
} from '../model/types';
import type {
    DeviceInterfaceProvenance,
    ExtractedControlGroupMembership,
    ExtractedDeviceInterface,
    ExtractedDeviceInterfaceControl,
    ExternalControlAssignmentHint,
    JackAudioRole,
    JackPort,
    JackRole,
    Knob,
    KnobStep,
    KnobTaper,
    LedIndicator,
    Panel,
    SliderControl,
    SliderOrientation,
    SliderRange,
    SwitchControl,
    SwitchKind,
} from './types';
import { buildKnobSteps, snapKnobPosition } from './knobs';

type RuntimeContinuousControlSpec = Readonly<{
    key: string;
    controlProperty: string;
    wipeProperty: string;
    sweepProperty: string;
}>;

const RUNTIME_CONTINUOUS_CONTROL_SPECS: readonly RuntimeContinuousControlSpec[] = [
    { key: 'time', controlProperty: 'TimeControl', wipeProperty: 'TimeControlWipe', sweepProperty: 'TimeControlSweep' },
    { key: 'feedback', controlProperty: 'FeedbackControl', wipeProperty: 'FeedbackControlWipe', sweepProperty: 'FeedbackControlSweep' },
    { key: 'mix', controlProperty: 'MixControl', wipeProperty: 'MixControlWipe', sweepProperty: 'MixControlSweep' },
    { key: 'level', controlProperty: 'LevelControl', wipeProperty: 'LevelControlWipe', sweepProperty: 'LevelControlSweep' },
    { key: 'tone', controlProperty: 'ToneControl', wipeProperty: 'ToneControlWipe', sweepProperty: 'ToneControlSweep' },
    { key: 'mod-rate', controlProperty: 'ModRateControl', wipeProperty: 'ModRateControlWipe', sweepProperty: 'ModRateControlSweep' },
    { key: 'mod-depth', controlProperty: 'ModDepthControl', wipeProperty: 'ModDepthControlWipe', sweepProperty: 'ModDepthControlSweep' },
];

// extractPanel inspects a CircuitDocument and emits the typed Panel descriptor
// that drives the runtime control surface. It's a pure read over the existing
// schematic model — no parsing of the source format, no UI knowledge.
export function extractPanel(doc: CircuitDocument): Panel {
    const knobs: Knob[] = [];
    const sliders: SliderControl[] = [];
    const switches: SwitchControl[] = [];
    const leds: LedIndicator[] = [];
    const jacks: JackPort[] = [];

    for (const component of doc.components) {
        switch (component.kind) {
            case 'variable-resistor': {
                if (!isVariableResistorControl(component)) {
                    break;
                }
                if (isSliderControl(component)) {
                    sliders.push(toSlider(component));
                } else {
                    knobs.push(toKnob(component));
                }
                break;
            }
            case 'potentiometer': {
                if (isSliderControl(component)) {
                    sliders.push(toSlider(component));
                } else {
                    knobs.push(toKnob(component));
                }
                break;
            }
            case 'switch': {
                switches.push(toSwitch(component));
                break;
            }
            case 'led': {
                leds.push(toLed(component));
                break;
            }
            case 'jack': {
                jacks.push(toJack(component));
                break;
            }
            default:
                if (isRuntimeDescriptor(component)) {
                    knobs.push(...runtimeDescriptorKnobs(component));
                    const tempoTap = runtimeDescriptorTempoTap(component);
                    if (tempoTap !== undefined) {
                        jacks.push(tempoTap);
                    }
                    const directOut = runtimeDescriptorDirectOut(component);
                    if (directOut !== undefined) {
                        jacks.push(directOut);
                    }
                }
                break;
        }
    }
    applyControlInterfaces(doc.controlInterfaces, jacks);

    return {
        ...(doc.panel === undefined ? {} : { placement: doc.panel }),
        knobs,
        sliders,
        switches,
        leds,
        jacks,
    };
}

export function extractDeviceInterface(doc: CircuitDocument): ExtractedDeviceInterface {
    const panel = extractPanel(doc);
    const inferredControls = inferDeviceInterfaceControls(doc, panel);
    const diagnostics: Warning[] = [];
    const controls = new Map<string, ExtractedDeviceInterfaceControl>();

    for (const control of doc.deviceInterface?.controls ?? []) {
        controls.set(control.id, {
            ...control,
            provenance: 'vdsp-declared',
        });
    }

    for (const inferred of inferredControls) {
        const declared = controls.get(inferred.id);
        if (declared === undefined) {
            controls.set(inferred.id, inferred);
            continue;
        }

        if (declared.binding === undefined && inferred.binding !== undefined) {
            controls.set(declared.id, {
                ...declared,
                inferredBinding: inferred.binding,
            });
            continue;
        }

        if (
            declared.binding !== undefined
            && inferred.binding !== undefined
            && bindingSignature(declared.binding) !== bindingSignature(inferred.binding)
        ) {
            diagnostics.push({
                code: 'device-interface-inferred-binding-conflict',
                message: `Declared device interface control "${declared.id}" conflicts with inferred binding`,
                componentId: declared.id,
            });
        }
    }

    const resolvedControls = Array.from(controls.values());

    return {
        groups: doc.controlGroups ?? [],
        contexts: doc.controlContexts ?? [],
        controls: resolvedControls,
        groupMemberships: resolveControlGroupMemberships(doc.controlGroups ?? [], controls),
        ...(panel.placement === undefined ? {} : { placement: panel.placement }),
        diagnostics,
    };
}

function resolveControlGroupMemberships(
    groups: readonly ControlGroup[],
    controls: ReadonlyMap<string, ExtractedDeviceInterfaceControl>,
): readonly ExtractedControlGroupMembership[] {
    const memberships: ExtractedControlGroupMembership[] = [];
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const explicitMemberships = new Set<string>();

    for (const group of groups) {
        for (const member of group.members ?? []) {
            const control = controls.get(member.controlId);
            if (control === undefined) {
                continue;
            }
            explicitMemberships.add(`${group.id}:${control.id}`);
            memberships.push({
                group,
                control,
                ...(member.order === undefined ? {} : { order: member.order }),
                ...(member.appliesWhen === undefined ? {} : { appliesWhen: member.appliesWhen }),
                ...(member.description === undefined ? {} : { description: member.description }),
            });
        }
    }

    for (const control of controls.values()) {
        if (control.groupId === undefined) {
            continue;
        }
        const group = groupsById.get(control.groupId);
        if (group === undefined || explicitMemberships.has(`${group.id}:${control.id}`)) {
            continue;
        }
        memberships.push({
            group,
            control,
            ...(control.order === undefined ? {} : { order: control.order }),
            ...(control.appliesWhen === undefined ? {} : { appliesWhen: control.appliesWhen }),
            ...(control.description === undefined ? {} : { description: control.description }),
        });
    }

    return memberships;
}

function inferDeviceInterfaceControls(
    doc: CircuitDocument,
    panel: Panel,
): readonly ExtractedDeviceInterfaceControl[] {
    const controls: ExtractedDeviceInterfaceControl[] = [];
    const controlInterfaceIds = new Set<string>();
    for (const controlInterface of doc.controlInterfaces ?? []) {
        controlInterfaceIds.add(controlInterface.id);
        if (controlInterface.componentId !== undefined) {
            controlInterfaceIds.add(controlInterface.componentId);
        }
    }

    for (const knob of panel.knobs) {
        const componentId = componentIdFromControlId(knob.id);
        const property = runtimeControlProperty(knob.id);
        controls.push({
            id: knob.id,
            label: knob.name,
            kind: 'knob',
            role: roleFromControlId(knob.id),
            binding: {
                componentId,
                controlId: knob.id,
                controlName: knob.name,
                ...(property === undefined ? {} : { property }),
            },
            provenance: provenanceForComponentControl(doc, componentId),
        });
    }

    for (const slider of panel.sliders ?? []) {
        controls.push({
            id: slider.id,
            label: slider.name,
            kind: 'slider',
            role: roleFromControlId(slider.id),
            binding: {
                componentId: componentIdFromControlId(slider.id),
                controlId: slider.id,
                controlName: slider.name,
            },
            provenance: 'source-inferred',
        });
    }

    for (const switchControl of panel.switches) {
        controls.push({
            id: switchControl.id,
            label: switchControl.name,
            kind: 'switch',
            role: roleFromControlId(switchControl.id),
            binding: {
                componentId: componentIdFromControlId(switchControl.id),
                controlId: switchControl.id,
                controlName: switchControl.name,
            },
            provenance: provenanceForComponentControl(doc, componentIdFromControlId(switchControl.id)),
        });
    }

    for (const led of panel.leds) {
        controls.push({
            id: led.id,
            label: led.name,
            kind: 'led',
            role: 'indicator',
            binding: {
                componentId: componentIdFromControlId(led.id),
                controlId: led.id,
                controlName: led.name,
            },
            provenance: 'source-inferred',
        });
    }

    for (const jack of panel.jacks) {
        const componentId = jack.sourceComponentId ?? componentIdFromControlId(jack.id);
        const binding = deviceBindingForJack(jack, componentId);
        controls.push({
            id: jack.id,
            label: jack.name,
            kind: 'jack',
            role: jack.controlRole ?? jack.role,
            ...(binding === undefined ? {} : { binding }),
            provenance: controlInterfaceIds.has(jack.id)
                ? 'control-interface-declared'
                : provenanceForComponentControl(doc, componentId),
        });
    }

    return controls;
}

function deviceBindingForJack(jack: JackPort, componentId: string): DeviceInterfaceBinding | undefined {
    if (jack.binding !== undefined) {
        return deviceBindingFromControlInterfaceBinding(jack.binding, componentId);
    }
    if (jack.id.endsWith(':tempo-tap')) {
        return {
            componentId,
            controlId: jack.id,
            controlName: jack.name,
            property: 'TempoTapControl',
        };
    }
    if (jack.sourceComponentId !== undefined || jack.id === componentId) {
        return {
            componentId,
            controlId: jack.id,
            controlName: jack.name,
        };
    }
    return undefined;
}

function deviceBindingFromControlInterfaceBinding(
    binding: ControlInterface['binding'],
    fallbackComponentId: string,
): DeviceInterfaceBinding | undefined {
    if (binding === undefined) {
        return undefined;
    }
    const componentId = binding.sourceComponentId ?? fallbackComponentId;
    return {
        componentId,
        ...(binding.controlId === undefined ? {} : { controlId: binding.controlId }),
        ...(binding.controlName === undefined ? {} : { controlName: binding.controlName }),
        ...(binding.property === undefined ? {} : { property: binding.property }),
    };
}

function provenanceForComponentControl(doc: CircuitDocument, componentId: string): DeviceInterfaceProvenance {
    const component = doc.components.find((candidate) => candidate.id === componentId);
    return component !== undefined && isRuntimeDescriptor(component)
        ? 'runtime-descriptor-inferred'
        : 'source-inferred';
}

function componentIdFromControlId(id: string): string {
    const separator = id.indexOf(':');
    return separator <= 0 ? id : id.slice(0, separator);
}

function roleFromControlId(id: string): string {
    const separator = id.indexOf(':');
    const raw = separator >= 0 ? id.slice(separator + 1) : id;
    return normalizeToken(raw);
}

function runtimeControlProperty(id: string): string | undefined {
    const key = roleFromControlId(id);
    for (const spec of RUNTIME_CONTINUOUS_CONTROL_SPECS) {
        if (spec.key === key) {
            return spec.controlProperty;
        }
    }
    if (key === 'mode') {
        return 'ModeControl';
    }
    if (key === 'tempo-tap') {
        return 'TempoTapControl';
    }
    if (key === 'direct-out') {
        return 'DirectOutputJack';
    }
    return undefined;
}

function bindingSignature(binding: DeviceInterfaceBinding): string {
    return [
        binding.componentId,
        binding.controlId ?? '',
        binding.controlName ?? '',
        binding.property ?? '',
        binding.externalInterfaceId ?? '',
    ].join(':');
}

function applyControlInterfaces(
    controlInterfaces: readonly ControlInterface[] | undefined,
    jacks: JackPort[],
): void {
    for (const controlInterface of controlInterfaces ?? []) {
        const port = toControlInterfaceJack(controlInterface);
        const existingIndex = controlInterface.componentId === undefined
            ? -1
            : jacks.findIndex((jack) => jack.id === controlInterface.componentId);
        if (existingIndex >= 0) {
            const existing = jacks[existingIndex];
            if (existing !== undefined) {
                jacks[existingIndex] = { ...existing, ...port };
            }
        } else {
            jacks.push(port);
        }
    }
}

function toControlInterfaceJack(controlInterface: ControlInterface): JackPort {
    const sourceComponentId = controlInterface.binding?.sourceComponentId;
    const controlRole = controlInterface.controlRole ?? defaultControlRole(controlInterface);
    const interfaceName = controlInterface.interface ?? defaultInterfaceName(controlInterface);
    return {
        id: controlInterface.componentId ?? controlInterface.id,
        name: controlInterface.name,
        role: jackRoleForControlInterface(controlInterface),
        ...(sourceComponentId === undefined ? {} : { sourceComponentId }),
        ...(controlRole === undefined ? {} : { controlRole }),
        ...(interfaceName === undefined ? {} : { interface: interfaceName }),
        ...(controlInterface.connector === undefined ? {} : { connector: controlInterface.connector }),
        ...(controlInterface.assignmentHint === undefined ? {} : { assignmentHint: controlInterface.assignmentHint }),
        ...(controlInterface.polarity === undefined ? {} : { polarity: controlInterface.polarity }),
        ...(controlInterface.binding === undefined ? {} : { binding: controlInterface.binding }),
        ...(controlInterface.description === undefined ? {} : { description: controlInterface.description }),
    };
}

function jackRoleForControlInterface(controlInterface: ControlInterface): JackRole {
    switch (controlInterface.role) {
        case 'tempo-tap':
            return 'tempo-tap';
        case 'expression':
            return 'expression';
        case 'external-control':
        case 'trigger':
        case 'reset':
        case 'sampler-trigger':
            return 'external-control';
        case 'unknown':
            return 'unknown';
    }
}

function defaultControlRole(controlInterface: ControlInterface): string | undefined {
    return controlInterface.role === 'unknown' || controlInterface.role === 'external-control'
        ? undefined
        : controlInterface.role;
}

function defaultInterfaceName(controlInterface: ControlInterface): string | undefined {
    if (controlInterface.role === 'tempo-tap') {
        return 'tap-tempo';
    }
    if (controlInterface.role === 'unknown') {
        return undefined;
    }
    return 'external-control-input';
}

function toKnob(component: Component): Knob {
    const taper = resolveTaper(propertyString(component, 'Sweep') ?? propertyString(component, 'Taper'));
    const stepLabels = parseStepLabels(propertyStringAny(component, ['StepLabels', 'Steps']));
    const explicitStepCount = parseStepCount(propertyStringAny(component, ['StepCount', 'Detents', 'Positions', 'Steps']));
    const steps = buildKnobSteps(stepLabels.length >= 2 ? stepLabels.length : explicitStepCount ?? 0, stepLabels);
    const rawDefaultPosition = clamp01(parseNumeric(component.properties.Wipe) ?? 0.5);
    const defaultPosition = steps === undefined ? rawDefaultPosition : snapKnobPosition({ steps }, rawDefaultPosition);
    const resistance = quantityProperty(component, 'Resistance');
    const gangGroup = propertyString(component, 'Group') ?? undefined;
    const description = propertyString(component, 'Description') ?? undefined;
    return {
        id: component.id,
        name: component.name,
        taper,
        controlMode: steps === undefined ? 'continuous' : 'stepped',
        defaultPosition,
        ...(steps !== undefined ? { steps } : {}),
        ...(resistance !== undefined ? { resistance } : {}),
        ...(gangGroup !== undefined && gangGroup.length > 0 ? { gangGroup } : {}),
        ...(description !== undefined && description.length > 0 ? { description } : {}),
    };
}

function toSlider(component: Component): SliderControl {
    const defaultPosition = clamp01(parseNumeric(component.properties.Wipe) ?? 0.5);
    const orientation = resolveSliderOrientation(propertyStringAny(component, ['Orientation', 'SliderOrientation']));
    const range = sliderRange(component);
    const gangGroup = propertyString(component, 'Group') ?? undefined;
    const description = propertyString(component, 'Description') ?? undefined;
    return {
        id: component.id,
        name: component.name,
        defaultPosition,
        orientation,
        ...(range !== undefined ? { range } : {}),
        ...(gangGroup !== undefined && gangGroup.length > 0 ? { gangGroup } : {}),
        ...(description !== undefined && description.length > 0 ? { description } : {}),
    };
}

function toSwitch(component: Component): SwitchControl {
    const switchKind = resolveSwitchKind(component);
    const { poles, positions } = switchGeometry(switchKind);
    const defaultPosition = clampInt(parseNumeric(component.properties.Position) ?? 0, 0, positions - 1);
    const gangGroup = propertyString(component, 'Group') ?? undefined;
    const partNumber = propertyString(component, 'PartNumber') ?? undefined;
    const description = propertyString(component, 'Description') ?? undefined;
    return {
        id: component.id,
        name: component.name,
        switchKind,
        poles,
        positions,
        defaultPosition,
        ...(gangGroup !== undefined && gangGroup.length > 0 ? { gangGroup } : {}),
        ...(partNumber !== undefined && partNumber.length > 0 ? { partNumber } : {}),
        ...(description !== undefined && description.length > 0 ? { description } : {}),
    };
}

function toLed(component: Component): LedIndicator {
    const color = propertyString(component, 'Color') ?? inferLedColor(component);
    const partNumber = propertyString(component, 'PartNumber') ?? undefined;
    const description = propertyString(component, 'Description') ?? undefined;
    return {
        id: component.id,
        name: component.name,
        ...(color !== undefined ? { color } : {}),
        ...(partNumber !== undefined && partNumber.length > 0 ? { partNumber } : {}),
        ...(description !== undefined && description.length > 0 ? { description } : {}),
    };
}

function toJack(component: Component): JackPort {
    const role = resolveJackRole(component);
    const name = nonEmptyString(propertyStringAny(component, ['JackLabel', 'Label'])) ?? component.name;
    const audioRole = nonEmptyString(propertyString(component, 'AudioRole')) as JackAudioRole | undefined;
    const impedance = quantityProperty(component, 'Impedance');
    const controlRole = nonEmptyString(propertyString(component, 'ControlRole'));
    const interfaceName = nonEmptyString(propertyString(component, 'Interface'));
    const description = propertyString(component, 'Description') ?? undefined;
    const sourceTypeName = component.sourceTypeName ?? undefined;
    return {
        id: component.id,
        name,
        role,
        ...(audioRole !== undefined ? { audioRole } : {}),
        ...(impedance !== undefined ? { impedance } : {}),
        ...(sourceTypeName !== undefined ? { sourceTypeName } : {}),
        ...(controlRole !== undefined ? { controlRole } : {}),
        ...(interfaceName !== undefined ? { interface: interfaceName } : {}),
        ...(description !== undefined && description.length > 0 ? { description } : {}),
    };
}

function runtimeDescriptorKnobs(component: Component): readonly Knob[] {
    const knobs: Knob[] = [];

    for (const spec of RUNTIME_CONTINUOUS_CONTROL_SPECS) {
        const name = nonEmptyString(propertyString(component, spec.controlProperty));
        if (name === undefined) {
            continue;
        }

        knobs.push({
            id: `${component.id}:${spec.key}`,
            name,
            taper: resolveTaper(propertyString(component, spec.sweepProperty)),
            controlMode: 'continuous',
            defaultPosition: clamp01(parseNumeric(component.properties[spec.wipeProperty]) ?? 0.5),
        });
    }

    const mode = runtimeDescriptorMode(component);
    if (mode !== undefined) {
        knobs.push(mode);
    }

    return knobs;
}

function runtimeDescriptorMode(component: Component): Knob | undefined {
    const name = nonEmptyString(propertyString(component, 'ModeControl'));
    const labels = parseStepLabels(propertyStringAny(component, ['ModeLabels', 'ModeOptions']));
    const explicitStepCount = parseStepCount(propertyStringAny(component, ['ModeStepCount', 'ModeSteps', 'ModeCount']));
    const steps = buildKnobSteps(labels.length >= 2 ? labels.length : explicitStepCount ?? 0, labels);
    if (name === undefined || steps === undefined) {
        return undefined;
    }

    return {
        id: `${component.id}:mode`,
        name,
        taper: 'unknown',
        controlMode: 'stepped',
        defaultPosition: runtimeModeDefaultPosition(
            steps,
            parseNumericAny(component, ['ModeControlWipe', 'ModeDefaultIndex', 'ModeIndex']),
        ),
        steps,
    };
}

function runtimeDescriptorTempoTap(component: Component): JackPort | undefined {
    const name = nonEmptyString(propertyStringAny(component, ['TempoTapControl', 'TapTempoControl', 'TempoControl']));
    if (name === undefined) {
        return undefined;
    }

    const sourceTypeName = component.sourceTypeName ?? undefined;
    const assignmentHint: ExternalControlAssignmentHint = 'momentary';
    return {
        id: `${component.id}:tempo-tap`,
        name,
        role: 'tempo-tap',
        sourceComponentId: component.id,
        controlRole: 'tempo-tap',
        interface: 'tap-tempo',
        assignmentHint,
        ...(sourceTypeName !== undefined ? { sourceTypeName } : {}),
    };
}

function runtimeDescriptorDirectOut(component: Component): JackPort | undefined {
    const name = nonEmptyString(propertyStringAny(component, [
        'DirectOutputJack',
        'DirectOutJack',
        'DirectOutputControl',
        'DirectOutControl',
    ]));
    if (name === undefined) {
        return undefined;
    }

    const sourceTypeName = component.sourceTypeName ?? undefined;
    const description = nonEmptyString(propertyStringAny(component, [
        'DirectOutputRuntimeBoundary',
        'DirectOutputDescription',
        'DirectOutDescription',
    ]));
    const controlId = `${component.id}:direct-out`;
    return {
        id: controlId,
        name,
        role: 'direct-output',
        sourceComponentId: component.id,
        controlRole: 'direct-output',
        interface: 'audio-output',
        binding: {
            sourceComponentId: component.id,
            controlId,
            controlName: name,
            property: 'DirectOutputJack',
        },
        ...(sourceTypeName !== undefined ? { sourceTypeName } : {}),
        ...(description === undefined ? {} : { description }),
    };
}

function isSliderControl(component: Component): boolean {
    const style = propertyStringAny(component, ['ControlStyle', 'ControlType', 'PanelControl', 'UiControl', 'Style']);
    if (style === null) {
        return false;
    }
    const lower = style.toLowerCase();
    return lower.includes('slider') || lower.includes('fader');
}

function isVariableResistorControl(component: Component): boolean {
    return component.properties.Wipe !== undefined
        || component.properties.Sweep !== undefined
        || component.properties.Taper !== undefined
        || isSliderControl(component);
}

function resolveSliderOrientation(value: string | null): SliderOrientation {
    if (value?.toLowerCase().includes('horizontal')) {
        return 'horizontal';
    }
    return 'vertical';
}

function sliderRange(component: Component): SliderRange | undefined {
    const min = parseNumericAny(component, ['RangeMin', 'Min', 'Minimum']);
    const max = parseNumericAny(component, ['RangeMax', 'Max', 'Maximum']);
    if (min === undefined || max === undefined || min >= max) {
        return undefined;
    }
    const unit = propertyStringAny(component, ['Unit', 'RangeUnit']) ?? undefined;
    const center = parseNumericAny(component, ['Center', 'CenterValue', 'RangeCenter']);
    return {
        min,
        max,
        ...(unit !== undefined && unit.length > 0 ? { unit } : {}),
        ...(center !== undefined ? { center } : {}),
    };
}

function resolveTaper(value: string | null | undefined): KnobTaper {
    if (value === null || value === undefined) {
        return 'unknown';
    }
    const lower = value.toLowerCase();
    if (lower.includes('log') && lower.includes('rev')) {
        return 'reverse-log';
    }
    if (lower.includes('log') || lower.includes('audio')) {
        return 'log';
    }
    if (lower.includes('lin')) {
        return 'linear';
    }
    return 'unknown';
}

function resolveSwitchKind(component: Component): SwitchKind {
    const short = shortType(component.sourceTypeName);
    if (short === null) {
        return inferFromTerminals(component.terminals.length);
    }
    const upper = short.toUpperCase();
    if (upper === 'SPDT') return 'spdt';
    if (upper === 'SP3T') return 'sp3t';
    if (upper === 'SP4T') return 'sp4t';
    if (upper === '3PDT') return '3pdt';
    if (upper === 'TOGGLE') return 'toggle';
    if (upper === 'ROTARY') return 'rotary';
    if (upper === 'SWITCH') return 'spst';
    return inferFromTerminals(component.terminals.length);
}

function inferFromTerminals(count: number): SwitchKind {
    if (count <= 2) return 'spst';
    if (count === 3) return 'spdt';
    if (count === 9) return '3pdt';
    return 'unknown';
}

function switchGeometry(kind: SwitchKind): { poles: number; positions: number } {
    switch (kind) {
        case 'spst':
        case 'toggle':
            return { poles: 1, positions: 2 };
        case 'spdt':
            return { poles: 1, positions: 2 };
        case 'sp3t':
            return { poles: 1, positions: 3 };
        case 'sp4t':
            return { poles: 1, positions: 4 };
        case '3pdt':
            return { poles: 3, positions: 2 };
        case 'rotary':
            return { poles: 1, positions: 6 };
        case 'unknown':
            return { poles: 1, positions: 2 };
    }
}

function resolveJackRole(component: Component): JackRole {
    const semanticRole = resolveSemanticJackRole(component);
    if (semanticRole !== null) {
        return semanticRole;
    }

    const short = shortType(component.sourceTypeName);
    if (short === null) {
        return 'unknown';
    }
    const upper = short.toUpperCase();
    if (upper === 'INPUT' || upper === 'INPUTJACK') return 'input';
    if (upper === 'SPEAKER' || upper === 'OUTPUTJACK') return 'output';
    if (upper === 'SEND') return 'send';
    if (upper === 'RETURN') return 'return';
    if (upper === 'EXPRESSION' || upper === 'EXP') return 'expression';
    return 'unknown';
}

function resolveSemanticJackRole(component: Component): JackRole | null {
    const semanticProperties = ['Role', 'ControlRole', 'Interface'] as const;
    for (const name of semanticProperties) {
        const value = propertyString(component, name);
        if (value === null) {
            continue;
        }
        const role = normalizeJackRole(value);
        if (role !== null) {
            return role;
        }
    }
    return null;
}

function normalizeJackRole(value: string): JackRole | null {
    const normalized = normalizeToken(value);
    if (['input', 'audio-input', 'in'].includes(normalized)) return 'input';
    if (['direct-output', 'direct-out', 'dry-output', 'dry-out'].includes(normalized)) return 'direct-output';
    if (['output', 'audio-output', 'out'].includes(normalized)) return 'output';
    if (normalized === 'send') return 'send';
    if (normalized === 'return') return 'return';
    if (['expression', 'exp', 'expression-pedal'].includes(normalized)) return 'expression';
    if (['tempo-tap', 'tap-tempo', 'tempo-in', 'tap', 'tempo'].includes(normalized)) return 'tempo-tap';
    if (
        [
            'external-control',
            'external-control-input',
            'control-input',
            'remote',
            'footswitch',
            'trigger',
            'reset',
        ].includes(normalized)
    ) {
        return 'external-control';
    }
    return null;
}

function inferLedColor(component: Component): string | undefined {
    // Common pedal LED colors are usually red / amber / green. Try the part number.
    const part = propertyString(component, 'PartNumber')?.toLowerCase() ?? '';
    if (part.includes('red')) return 'red';
    if (part.includes('green')) return 'green';
    if (part.includes('amber')) return 'amber';
    if (part.includes('blue')) return 'blue';
    if (part.includes('yellow')) return 'yellow';
    if (part.includes('white')) return 'white';
    return undefined;
}

function shortType(sourceTypeName: string | null): string | null {
    if (sourceTypeName === null) {
        return null;
    }
    const match = sourceTypeName.match(/Circuit\.(?:Components\.)?([A-Za-z0-9_]+)/);
    if (match?.[1] !== undefined) {
        return match[1];
    }
    const ltspice = sourceTypeName.match(/^ltspice:([A-Za-z0-9_]+)/);
    return ltspice?.[1] ?? null;
}

function propertyString(component: Component, name: string): string | null {
    return propertyStringValue(component.properties[name]);
}

function nonEmptyString(value: string | null): string | undefined {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function propertyStringAny(component: Component, names: readonly string[]): string | null {
    for (const name of names) {
        const value = propertyString(component, name);
        if (value !== null) {
            return value;
        }
    }
    return null;
}

function quantityProperty(component: Component, name: string): ParsedQuantity | undefined {
    const value = component.properties[name];
    return isParsedQuantity(value) ? value : undefined;
}

function parseNumeric(value: PropertyValue | undefined): number | undefined {
    return propertyNumericValue(value);
}

function parseNumericAny(component: Component, names: readonly string[]): number | undefined {
    for (const name of names) {
        const value = parseNumeric(component.properties[name]);
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

function parseStepLabels(value: string | null): readonly string[] {
    if (value === null) {
        return [];
    }
    const parts = value
        .split(/[,;|]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    return parts.length >= 2 ? parts : [];
}

function parseStepCount(value: string | null): number | undefined {
    if (value === null) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!/^\d+(?:\.0+)?$/.test(trimmed)) {
        return undefined;
    }
    const count = Number(trimmed);
    return Number.isInteger(count) && count >= 2 ? count : undefined;
}

function runtimeModeDefaultPosition(steps: readonly KnobStep[], rawValue: number | undefined): number {
    if (steps.length === 0) {
        return 0;
    }
    if (rawValue === undefined || !Number.isFinite(rawValue)) {
        return steps[0]?.position ?? 0;
    }
    if (Number.isInteger(rawValue) || rawValue > 1) {
        const index = clampInt(rawValue, 0, steps.length - 1);
        return steps[index]?.position ?? steps[0]?.position ?? 0;
    }
    return snapKnobPosition({ steps }, clamp01(rawValue));
}

function isRuntimeDescriptor(component: Component): boolean {
    return component.kind === 'ic' && component.properties.RuntimeDescriptor === 'true';
}

function normalizeToken(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

function clampInt(v: number, lo: number, hi: number): number {
    const n = Math.trunc(v);
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}

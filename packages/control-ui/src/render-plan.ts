import type { Knob, Panel, PanelElementPlacement } from '@vessel-dsp/core';
import { findPanelControl } from './controls';
import { resolveControlAppearance } from './appearance';
import type { ControlAppearance, ControlAppearanceMap, ControlUiControlRef } from './types';

export type ControlSurfaceRenderItem = Readonly<{
    id: string;
    controlId: string;
    label: string;
    faceId?: string;
    element?: PanelElementPlacement;
    control: ControlUiControlRef;
    appearance: ControlAppearance;
}>;

export type ControlSurfaceRenderPlanOptions = Readonly<{
    appearance?: ControlAppearanceMap | undefined;
}>;

export function createControlSurfaceRenderPlan(
    panel: Panel,
    options: ControlSurfaceRenderPlanOptions = {},
): readonly ControlSurfaceRenderItem[] {
    const items: ControlSurfaceRenderItem[] = [];
    const seen = new Set<string>();
    const mounts = mountGroupsByControlId(panel);

    for (const face of panel.placement?.faces ?? []) {
        for (const element of face.elements) {
            const controlId = element.bind.controlId;
            if (controlId === undefined || seen.has(controlId)) {
                continue;
            }
            const control = mounts.get(controlId) ?? findPanelControl(panel, controlId);
            if (control === undefined) {
                continue;
            }
            const item = renderItemForControl(control, options.appearance?.[controlId], element, face.id);
            if (item !== undefined) {
                items.push(item);
                markSeen(seen, control);
            }
        }
    }

    for (const control of fallbackControls(panel)) {
        if (seen.has(control.control.id)) {
            continue;
        }
        const item = renderItemForControl(control, options.appearance?.[control.control.id]);
        if (item !== undefined) {
            items.push(item);
            markSeen(seen, control);
        }
    }

    return items;
}

function markSeen(seen: Set<string>, control: ControlUiControlRef): void {
    seen.add(control.control.id);
    if (control.kind === 'concentric-knob') {
        for (const tier of control.tiers) {
            seen.add(tier.id);
        }
    }
}

/**
 * Resolves each concentric mount declared in the placement (peer elements
 * sharing `physical.mountId`) to a single `concentric-knob` ref keyed by every
 * member control id, so any tier's placement element renders the whole stack
 * once. Dials are ordered by element declaration order within the mount.
 */
function mountGroupsByControlId(panel: Panel): ReadonlyMap<string, ControlUiControlRef> {
    const orderedIds = new Map<string, string[]>();
    for (const face of panel.placement?.faces ?? []) {
        for (const element of face.elements) {
            const mountId = element.physical?.mountId;
            const controlId = element.bind.controlId;
            if (mountId === undefined || controlId === undefined) {
                continue;
            }
            const ids = orderedIds.get(mountId) ?? [];
            ids.push(controlId);
            orderedIds.set(mountId, ids);
        }
    }

    const byControlId = new Map<string, ControlUiControlRef>();
    for (const ids of orderedIds.values()) {
        const tiers: Knob[] = [];
        for (const id of ids) {
            const control = findPanelControl(panel, id);
            if (control?.kind === 'knob') {
                tiers.push(control.control);
            }
        }
        const base = tiers[0];
        if (tiers.length < 2 || base === undefined) {
            continue;
        }
        const ref: ControlUiControlRef = { kind: 'concentric-knob', control: base, tiers };
        for (const tier of tiers) {
            byControlId.set(tier.id, ref);
        }
    }
    return byControlId;
}

function renderItemForControl(
    control: ControlUiControlRef,
    override?: ControlAppearance,
    element?: PanelElementPlacement,
    faceId?: string,
): ControlSurfaceRenderItem | undefined {
    const appearance = resolveControlAppearance(control, override);
    if (appearance === 'hidden') {
        return undefined;
    }
    return {
        id: element?.id ?? control.control.id,
        controlId: control.control.id,
        label: element?.label ?? control.control.name,
        ...(faceId === undefined ? {} : { faceId }),
        ...(element === undefined ? {} : { element }),
        control,
        appearance,
    };
}

function fallbackControls(panel: Panel): readonly ControlUiControlRef[] {
    return [
        ...panel.knobs.map((control) => ({ kind: 'knob' as const, control })),
        ...(panel.sliders ?? []).map((control) => ({ kind: 'slider' as const, control })),
        ...panel.switches.map((control) => ({ kind: 'switch' as const, control })),
        ...panel.leds.map((control) => ({ kind: 'led' as const, control })),
        ...panel.jacks.map((control) => ({ kind: 'jack' as const, control })),
    ];
}

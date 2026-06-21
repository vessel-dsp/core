import type { Panel, PanelElementPlacement } from '@vessel-dsp/core';
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

    for (const face of panel.placement?.faces ?? []) {
        for (const element of face.elements) {
            const controlId = element.bind.controlId;
            if (controlId === undefined || seen.has(controlId)) {
                continue;
            }
            const control = findPanelControl(panel, controlId);
            if (control === undefined) {
                continue;
            }
            const item = renderItemForControl(control, options.appearance?.[controlId], element, face.id);
            if (item !== undefined) {
                items.push(item);
                seen.add(controlId);
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
            seen.add(control.control.id);
        }
    }

    return items;
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
    ];
}

import type {
    ControlState,
    ControlValue,
    Knob,
    KnobValue,
    LedValue,
    Panel,
    SliderValue,
    SwitchValue,
} from '@vessel-dsp/core';
import { nearestKnobStep, snapKnobPosition } from '@vessel-dsp/core';
import type { ControlUiControlRef } from './types';
import { clampNumber, formatNumber } from './utils';

export function findPanelControl(panel: Panel, controlId: string): ControlUiControlRef | undefined {
    const knob = panel.knobs.find((control) => control.id === controlId);
    if (knob !== undefined) {
        return { kind: 'knob', control: knob };
    }

    const slider = (panel.sliders ?? []).find((control) => control.id === controlId);
    if (slider !== undefined) {
        return { kind: 'slider', control: slider };
    }

    const switchControl = panel.switches.find((control) => control.id === controlId);
    if (switchControl !== undefined) {
        return { kind: 'switch', control: switchControl };
    }

    const led = panel.leds.find((control) => control.id === controlId);
    if (led !== undefined) {
        return { kind: 'led', control: led };
    }

    return undefined;
}

export function controlValueForId(state: ControlState, controlId: string): ControlValue | undefined {
    return state[controlId];
}

export function clampControlPosition(position: number): number {
    return clampNumber(position, 0, 1);
}

export function snapControlPosition(control: ControlUiControlRef, position: number): number {
    const clamped = clampControlPosition(position);
    if (control.kind !== 'knob') {
        return clamped;
    }
    return snapKnobPosition(control.control, clamped);
}

export function normalizeSwitchPosition(position: number, positions: number): number {
    const maxPosition = Math.max(0, positions - 1);
    return Math.round(clampNumber(position, 0, maxPosition));
}

export function valuePosition(value: ControlValue | number | boolean): number {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    switch (value.kind) {
        case 'knob':
        case 'slider':
        case 'switch':
            return value.position;
        case 'led':
            return value.on ? 1 : 0;
    }
}

export function valueForControl(control: ControlUiControlRef, value: ControlValue | number | boolean): ControlValue {
    switch (control.kind) {
        case 'knob':
            return { kind: 'knob', position: snapControlPosition(control, valuePosition(value)) } satisfies KnobValue;
        case 'slider':
            return { kind: 'slider', position: clampControlPosition(valuePosition(value)) } satisfies SliderValue;
        case 'switch':
            return {
                kind: 'switch',
                position: normalizeSwitchPosition(valuePosition(value), control.control.positions),
            } satisfies SwitchValue;
        case 'led': {
            if (typeof value === 'object' && value.kind === 'led') {
                return value satisfies LedValue;
            }
            throw new Error(`LED control "${control.control.id}" is read-only in control-ui`);
        }
    }
}

export function formatControlValue(control: ControlUiControlRef, value: ControlValue | undefined): string {
    if (value === undefined) {
        return '';
    }

    switch (control.kind) {
        case 'knob':
            if (value.kind !== 'knob') {
                return '';
            }
            return formatKnobValue(control.control, value.position);
        case 'slider':
            if (value.kind !== 'slider') {
                return '';
            }
            return formatSliderValue(control.control, value.position);
        case 'switch':
            if (value.kind !== 'switch') {
                return '';
            }
            return `Position ${value.position + 1}`;
        case 'led':
            if (value.kind !== 'led') {
                return '';
            }
            return value.on ? 'On' : 'Off';
    }
}

function formatKnobValue(knob: Knob, position: number): string {
    const step = nearestKnobStep(knob.steps, position);
    if (step?.label !== undefined) {
        return step.label;
    }
    return `${Math.round(clampControlPosition(position) * 100)}%`;
}

function formatSliderValue(slider: { range?: { min: number; max: number; unit?: string } }, position: number): string {
    if (slider.range === undefined) {
        return `${Math.round(clampControlPosition(position) * 100)}%`;
    }
    const value = slider.range.min + clampControlPosition(position) * (slider.range.max - slider.range.min);
    return `${formatNumber(value)}${slider.range.unit === undefined ? '' : ` ${slider.range.unit}`}`;
}

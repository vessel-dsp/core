import { describe, expect, test } from 'bun:test';
import {
    applyControlUiMessage,
    clampControlPosition,
    controlMessageForValue,
    controlValueForId,
    createControlSurfaceRenderPlan,
    createControlUiState,
    findPanelControl,
    formatControlValue,
    resolveControlAppearance,
    snapControlPosition,
} from '@vessel-dsp/control-ui';
import { controlUiTestPanel } from './fixtures';

describe('control-ui state helpers', () => {
    test('initializes core panel state and snaps stepped knob defaults', () => {
        const state = createControlUiState(controlUiTestPanel);

        expect(state.gain).toEqual({ kind: 'knob', position: 0.25 });
        expect(state.mode).toEqual({ kind: 'knob', position: 0.5 });
        expect(state.eq).toEqual({ kind: 'slider', position: 0.5 });
        expect(state.bypass).toEqual({ kind: 'switch', position: 0 });
        expect(state.bright).toEqual({ kind: 'switch', position: 1 });
        expect(state.status).toEqual({ kind: 'led', on: false });
    });

    test('creates clamped and snapped control messages for writable controls', () => {
        expect(controlMessageForValue(controlUiTestPanel, 'gain', 1.4)).toEqual({
            type: 'control/set',
            controlId: 'gain',
            value: { kind: 'knob', position: 1 },
        });
        expect(controlMessageForValue(controlUiTestPanel, 'mode', 0.76)).toEqual({
            type: 'control/set',
            controlId: 'mode',
            value: { kind: 'knob', position: 1 },
        });
        expect(controlMessageForValue(controlUiTestPanel, 'eq', -0.25)).toEqual({
            type: 'control/set',
            controlId: 'eq',
            value: { kind: 'slider', position: 0 },
        });
        expect(controlMessageForValue(controlUiTestPanel, 'bright', 12)).toEqual({
            type: 'control/set',
            controlId: 'bright',
            value: { kind: 'switch', position: 1 },
        });
    });

    test('applies only panel-valid messages and keeps LED controls read-only from UI values', () => {
        const state = createControlUiState(controlUiTestPanel);
        const message = controlMessageForValue(controlUiTestPanel, 'gain', 0.75);
        const nextState = applyControlUiMessage(controlUiTestPanel, state, message);

        expect(controlValueForId(nextState, 'gain')).toEqual({ kind: 'knob', position: 0.75 });
        expect(() =>
            applyControlUiMessage(controlUiTestPanel, state, {
                type: 'control/set',
                controlId: 'gain',
                value: { kind: 'switch', position: 1 },
            }),
        ).toThrow('is a knob');
        expect(() => controlMessageForValue(controlUiTestPanel, 'status', true)).toThrow('read-only');

        const ledState = applyControlUiMessage(controlUiTestPanel, state, {
            type: 'control/changed',
            controlId: 'status',
            value: { kind: 'led', on: true, intensity: 0.8 },
        });
        expect(ledState.status).toEqual({ kind: 'led', on: true, intensity: 0.8 });
    });

    test('looks up controls, clamps positions, snaps stepped knobs, and formats values', () => {
        const gain = findPanelControl(controlUiTestPanel, 'gain');
        const mode = findPanelControl(controlUiTestPanel, 'mode');
        const eq = findPanelControl(controlUiTestPanel, 'eq');
        const bright = findPanelControl(controlUiTestPanel, 'bright');

        expect(gain?.kind).toBe('knob');
        expect(eq?.kind).toBe('slider');
        expect(bright?.kind).toBe('switch');
        expect(clampControlPosition(Number.POSITIVE_INFINITY)).toBe(1);
        expect(clampControlPosition(Number.NaN)).toBe(0);
        expect(mode === undefined ? undefined : snapControlPosition(mode, 0.74)).toBe(0.5);
        expect(mode === undefined ? undefined : formatControlValue(mode, { kind: 'knob', position: 0.5 })).toBe('Crunch');
        expect(eq === undefined ? undefined : formatControlValue(eq, { kind: 'slider', position: 0.75 })).toBe('6 dB');
        expect(bright === undefined ? undefined : formatControlValue(bright, { kind: 'switch', position: 1 })).toBe(
            'Position 2',
        );
    });

    test('plans render order from panel placement and resolves default appearances', () => {
        const plan = createControlSurfaceRenderPlan(controlUiTestPanel);

        expect(plan.map((item) => item.controlId)).toEqual(['bypass', 'gain', 'mode', 'eq', 'bright', 'status']);
        expect(plan.map((item) => item.label)).toEqual(['Bypass', 'Gain', 'Mode', 'EQ', 'Bright', 'Status']);
        expect(plan.map((item) => item.appearance)).toEqual([
            'footswitch',
            'knob',
            'detented-rotary-select',
            'graphic-eq-slider',
            'toggle',
            'led',
        ]);
        expect(createControlSurfaceRenderPlan(controlUiTestPanel, { appearance: { gain: 'hidden' } })).not.toContainEqual(
            expect.objectContaining({ controlId: 'gain' }),
        );
        expect(resolveControlAppearance({ kind: 'switch', control: controlUiTestPanel.switches[1] })).toBe('toggle');
    });
});

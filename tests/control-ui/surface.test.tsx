import { describe, expect, test } from 'bun:test';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import {
    ControlSurface,
    ControlUiThemeProvider,
    createControlUiState,
    useControlState,
} from '@vessel-dsp/control-ui';
import type { ControlState, PanelMessage } from '@vessel-dsp/core';
import { controlUiTestPanel } from './fixtures';

describe('ControlSurface', () => {
    test('renders a panel with appearance overrides and class hooks', () => {
        const state = createControlUiState(controlUiTestPanel);
        const renderer = create(
            <ControlSurface
                panel={controlUiTestPanel}
                state={state}
                appearance={{ gain: 'detented-rotary-select', bright: 'hidden' }}
                className="tw-grid"
                classNames={{
                    control: 'tw-control',
                    knob: 'tw-knob',
                    select: 'tw-select',
                }}
            />,
        );

        const root = renderer.root.findByProps({ 'data-vdsp-control-surface': true });
        expect(root.props.className).toContain('vdsp-control-ui-surface');
        expect(root.props.className).toContain('tw-grid');
        expect(renderer.root.findAllByProps({ 'data-vdsp-control-id': 'bright' })).toHaveLength(0);
        expect(renderer.root.findByProps({ 'data-vdsp-control-id': 'gain' }).props.className).toContain('tw-select');
        expect(renderer.root.findByProps({ 'data-vdsp-control-id': 'mode' }).props.className).toContain('tw-select');
        expect(renderer.root.findByProps({ 'data-vdsp-control-id': 'eq' }).props.className).toContain('tw-control');
    });

    test('emits messages and computes next state for user changes', () => {
        const messages: PanelMessage[] = [];
        const states: ControlState[] = [];
        const renderer = create(
            <ControlSurface
                panel={controlUiTestPanel}
                state={createControlUiState(controlUiTestPanel)}
                onMessage={(message) => messages.push(message)}
                onStateChange={(state) => states.push(state)}
            />,
        );

        const slider = renderer.root.findByProps({ 'data-vdsp-control-id': 'eq' });
        act(() => {
            slider.props.onChange({ currentTarget: { value: '75' } });
        });

        expect(messages).toEqual([
            {
                type: 'control/set',
                controlId: 'eq',
                value: { kind: 'slider', position: 0.75 },
            },
        ]);
        expect(states[0]?.eq).toEqual({ kind: 'slider', position: 0.75 });
    });

    test('does not emit messages while disabled', () => {
        const messages: PanelMessage[] = [];
        const renderer = create(
            <ControlSurface
                panel={controlUiTestPanel}
                state={createControlUiState(controlUiTestPanel)}
                disabled={true}
                onMessage={(message) => messages.push(message)}
            />,
        );

        const switchButton = renderer.root.findByProps({ 'data-vdsp-control-id': 'bypass' });
        act(() => {
            switchButton.props.onClick();
        });

        expect(messages).toEqual([]);
        expect(switchButton.props.disabled).toBe(true);
    });

    test('themes descendants through the provider and exposes the local state hook', () => {
        const messages: PanelMessage[] = [];

        function Harness() {
            const controls = useControlState(controlUiTestPanel, {
                onMessage: (message) => messages.push(message),
            });
            return (
                <ControlUiThemeProvider theme={{ controlColor: '#0f766e' }}>
                    <button type="button" onClick={() => controls.setControlValue('mode', 0.9)}>
                        set mode
                    </button>
                    <ControlSurface panel={controlUiTestPanel} state={controls.state} onMessage={controls.dispatchMessage} />
                </ControlUiThemeProvider>
            );
        }

        let renderer: ReactTestRenderer;
        act(() => {
            renderer = create(<Harness />);
        });
        const button = renderer!.root.findAllByType('button')[0];
        act(() => {
            button.props.onClick();
        });

        expect(messages[0]).toEqual({
            type: 'control/set',
            controlId: 'mode',
            value: { kind: 'knob', position: 1 },
        });
        expect(renderer!.toJSON()).toEqual(
            expect.objectContaining({
                props: expect.objectContaining({
                    style: expect.objectContaining({
                        '--vdsp-control-ui-control-color': '#0f766e',
                    }),
                }),
            }),
        );
    });
});

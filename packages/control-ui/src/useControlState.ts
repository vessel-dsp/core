import { useCallback, useMemo, useState } from 'react';
import type { ControlState, ControlValue, Panel, PanelMessage } from '@vessel-dsp/core';
import { applyControlUiMessage, controlMessageForValue, createControlUiState } from './state';

export type UseControlStateOptions = Readonly<{
    initialState?: ControlState | undefined;
    onMessage?: ((message: PanelMessage) => void) | undefined;
}>;

export type UseControlStateResult = Readonly<{
    state: ControlState;
    setState: (state: ControlState) => void;
    dispatchMessage: (message: PanelMessage) => ControlState;
    setControlValue: (controlId: string, value: ControlValue | number | boolean) => ControlState;
}>;

export function useControlState(panel: Panel, options: UseControlStateOptions = {}): UseControlStateResult {
    const defaultState = useMemo(() => options.initialState ?? createControlUiState(panel), [panel, options.initialState]);
    const [state, setState] = useState<ControlState>(defaultState);

    const dispatchMessage = useCallback(
        (message: PanelMessage) => {
            const nextState = applyControlUiMessage(panel, state, message);
            setState(nextState);
            options.onMessage?.(message);
            return nextState;
        },
        [panel, state, options],
    );

    const setControlValue = useCallback(
        (controlId: string, value: ControlValue | number | boolean) => {
            const message = controlMessageForValue(panel, controlId, value);
            return dispatchMessage(message);
        },
        [dispatchMessage, panel],
    );

    return {
        state,
        setState,
        dispatchMessage,
        setControlValue,
    };
}

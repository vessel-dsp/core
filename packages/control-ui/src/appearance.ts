import type { ControlAppearance, ControlUiControlRef } from './types';

export function resolveControlAppearance(
    control: ControlUiControlRef,
    override?: ControlAppearance,
): ControlAppearance {
    if (override !== undefined) {
        return override;
    }

    switch (control.kind) {
        case 'knob':
            return (control.control.steps?.length ?? 0) > 0 ? 'detented-rotary-select' : 'knob';
        case 'slider':
            return 'graphic-eq-slider';
        case 'switch':
            if (control.control.switchKind === '3pdt') {
                return 'footswitch';
            }
            if (
                control.control.positions === 2 &&
                (control.control.switchKind === 'spdt' ||
                    control.control.switchKind === 'spst' ||
                    control.control.switchKind === 'toggle')
            ) {
                return 'toggle';
            }
            return 'detented-rotary-select';
        case 'led':
            return 'led';
        case 'jack':
            return 'jack';
        case 'concentric-knob':
            return 'concentric-knob';
    }
}

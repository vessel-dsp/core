import type { SwitchControl } from '@vessel-dsp/core';
import type { ControlFrameClassNames } from '../types';
import { cx } from '../utils';
import { ControlFrame } from './ControlFrame';

export type SwitchSelectControlProps = Readonly<{
    control: SwitchControl;
    position: number;
    disabled?: boolean;
    label?: string;
    className?: string | undefined;
    classNames?: ControlFrameClassNames | undefined;
    onPositionChange?: ((position: number) => void) | undefined;
}>;

export function SwitchSelectControl({
    control,
    position,
    disabled = false,
    label = control.name,
    className,
    classNames,
    onPositionChange,
}: SwitchSelectControlProps) {
    return (
        <ControlFrame label={label} disabled={disabled} className={className} classNames={classNames}>
            <select
                className={cx('vdsp-control-ui-control', 'vdsp-control-ui-select', classNames?.control)}
                value={String(position)}
                aria-label={control.name}
                disabled={disabled}
                data-vdsp-control-id={control.id}
                onChange={(event) => onPositionChange?.(Number(event.currentTarget.value))}
            >
                {Array.from({ length: control.positions }, (_, index) => (
                    <option key={index} value={String(index)}>
                        Position {index + 1}
                    </option>
                ))}
            </select>
        </ControlFrame>
    );
}

import type { CSSProperties } from 'react';
import type { LedIndicator as CoreLedIndicator, LedValue } from '@vessel-dsp/core';
import type { ControlFrameClassNames } from '../types';
import { cx } from '../utils';
import { ControlFrame } from './ControlFrame';

export type LedIndicatorProps = Readonly<{
    control: CoreLedIndicator;
    value: LedValue;
    disabled?: boolean;
    label?: string;
    className?: string | undefined;
    classNames?: ControlFrameClassNames | undefined;
}>;

export function LedIndicator({
    control,
    value,
    disabled = false,
    label = control.name,
    className,
    classNames,
}: LedIndicatorProps) {
    const intensity = value.intensity ?? (value.on ? 1 : 0);

    const ledStyle = {
        '--vdsp-control-ui-led-intensity': intensity,
    } as CSSProperties & Record<'--vdsp-control-ui-led-intensity', number>;

    return (
        <ControlFrame label={label} readout={value.on ? 'On' : 'Off'} disabled={disabled} className={className} classNames={classNames}>
            <span
                className={cx('vdsp-control-ui-control', 'vdsp-control-ui-led', value.on && 'is-on', classNames?.control)}
                style={ledStyle}
                role="status"
                aria-label={`${control.name} ${value.on ? 'on' : 'off'}`}
                data-vdsp-control-id={control.id}
            />
        </ControlFrame>
    );
}

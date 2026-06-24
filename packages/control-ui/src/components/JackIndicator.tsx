import type { JackPort } from '@vessel-dsp/core';
import type { ControlFrameClassNames } from '../types';
import { cx } from '../utils';
import { ControlFrame } from './ControlFrame';

export type JackIndicatorProps = Readonly<{
    control: JackPort;
    disabled?: boolean;
    label?: string;
    className?: string | undefined;
    classNames?: ControlFrameClassNames | undefined;
}>;

/**
 * Read-only panel port. Jacks carry no settable value; they appear on the
 * control surface for orientation only and never emit control messages.
 */
export function JackIndicator({
    control,
    disabled = false,
    label = control.name,
    className,
    classNames,
}: JackIndicatorProps) {
    return (
        <ControlFrame label={label} readout={control.role} disabled={disabled} className={className} classNames={classNames}>
            <span
                className={cx('vdsp-control-ui-control', 'vdsp-control-ui-jack', classNames?.control)}
                role="img"
                aria-label={`${control.name} ${control.role} jack`}
                data-vdsp-control-id={control.id}
            />
        </ControlFrame>
    );
}

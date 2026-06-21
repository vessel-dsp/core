import type { ReactNode } from 'react';
import type { ControlFrameClassNames } from '../types';
import { cx } from '../utils';

export type ControlFrameProps = Readonly<{
    label?: ReactNode;
    readout?: ReactNode;
    disabled?: boolean;
    className?: string | undefined;
    classNames?: ControlFrameClassNames | undefined;
    children?: ReactNode;
}>;

export function ControlFrame({ label, readout, disabled = false, className, classNames, children }: ControlFrameProps) {
    return (
        <div className={cx('vdsp-control-ui-frame', disabled && 'is-disabled', classNames?.frame, className)}>
            {label === undefined ? null : (
                <span className={cx('vdsp-control-ui-label', classNames?.label)}>{label}</span>
            )}
            {children}
            {readout === undefined ? null : (
                <span className={cx('vdsp-control-ui-readout', classNames?.readout)}>{readout}</span>
            )}
        </div>
    );
}

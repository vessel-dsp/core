import type { Knob } from '@vessel-dsp/core';
import type { ControlFrameClassNames } from '../types';
import { cx } from '../utils';
import { KnobControl } from './KnobControl';

export type ConcentricKnobTier = Readonly<{
    control: Knob;
    position: number;
    label?: string;
    onPositionChange?: ((position: number) => void) | undefined;
}>;

export type ConcentricKnobProps = Readonly<{
    tiers: readonly ConcentricKnobTier[];
    disabled?: boolean;
    className?: string | undefined;
    classNames?: ControlFrameClassNames | undefined;
}>;

/**
 * A stacked concentric potentiometer with N independent dials sharing one
 * shaft. Each dial is a full {@link KnobControl} wired to its own tier control,
 * so every section emits and snaps independently. Tiers are ordered bottom to
 * top; rendered bottom (largest) first.
 */
export function ConcentricKnob({
    tiers,
    disabled = false,
    className,
    classNames,
}: ConcentricKnobProps) {
    return (
        <div
            className={cx('vdsp-control-ui-concentric', className, classNames?.control)}
            data-vdsp-concentric={true}
            data-vdsp-concentric-tiers={tiers.length}
        >
            {tiers.map((tier, index) => (
                <KnobControl
                    key={tier.control.id}
                    control={tier.control}
                    position={tier.position}
                    disabled={disabled}
                    label={tier.label ?? tier.control.name}
                    className={cx(
                        'vdsp-control-ui-concentric__tier',
                        index === 0 ? 'vdsp-control-ui-concentric__base' : 'vdsp-control-ui-concentric__stacked',
                    )}
                    classNames={classNames}
                    onPositionChange={tier.onPositionChange}
                />
            ))}
        </div>
    );
}

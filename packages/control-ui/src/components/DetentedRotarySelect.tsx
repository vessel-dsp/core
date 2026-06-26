import type { Knob } from "@vessel-dsp/core";
import { nearestKnobStep } from "@vessel-dsp/core";
import type { ControlFrameClassNames } from "../types";
import { cx } from "../utils";
import { ControlFrame } from "./ControlFrame";

export type DetentedRotarySelectProps = Readonly<{
	control: Knob;
	position: number;
	disabled?: boolean;
	label?: string;
	className?: string | undefined;
	classNames?: ControlFrameClassNames | undefined;
	onPositionChange?: ((position: number) => void) | undefined;
}>;

export function DetentedRotarySelect({
	control,
	position,
	disabled = false,
	label = control.name,
	className,
	classNames,
	onPositionChange,
}: DetentedRotarySelectProps) {
	const steps = control.steps ?? [
		{ index: 0, position: 0, label: "Position 1" },
		{ index: 1, position: 1, label: "Position 2" },
	];
	const selected = nearestKnobStep(steps, position)?.position ?? position;

	return (
		<ControlFrame
			label={label}
			disabled={disabled}
			className={className}
			classNames={classNames}
		>
			<select
				className={cx(
					"vdsp-control-ui-control",
					"vdsp-control-ui-select",
					classNames?.control,
				)}
				value={String(selected)}
				aria-label={control.name}
				disabled={disabled}
				data-vdsp-control-id={control.id}
				onChange={(event) =>
					onPositionChange?.(Number(event.currentTarget.value))
				}
			>
				{steps.map((step) => (
					<option key={step.index} value={String(step.position)}>
						{step.label ?? `Position ${step.index + 1}`}
					</option>
				))}
			</select>
		</ControlFrame>
	);
}

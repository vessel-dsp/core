import type { SwitchControl } from "@vessel-dsp/core";
import type { ControlFrameClassNames } from "../types";
import { cx } from "../utils";
import { ControlFrame } from "./ControlFrame";

export type ToggleSwitchControlProps = Readonly<{
	control: SwitchControl;
	position: number;
	disabled?: boolean;
	label?: string;
	className?: string | undefined;
	classNames?: ControlFrameClassNames | undefined;
	onPositionChange?: ((position: number) => void) | undefined;
}>;

export function ToggleSwitchControl({
	control,
	position,
	disabled = false,
	label = control.name,
	className,
	classNames,
	onPositionChange,
}: ToggleSwitchControlProps) {
	const checked = position > 0;

	function handleClick(): void {
		if (!disabled) {
			onPositionChange?.(checked ? 0 : 1);
		}
	}

	return (
		<ControlFrame
			label={label}
			readout={`Position ${position + 1}`}
			disabled={disabled}
			className={className}
			classNames={classNames}
		>
			<button
				type="button"
				className={cx(
					"vdsp-control-ui-control",
					"vdsp-control-ui-toggle",
					checked && "is-checked",
					classNames?.control,
				)}
				role="switch"
				aria-label={control.name}
				aria-checked={checked}
				disabled={disabled}
				data-vdsp-control-id={control.id}
				onClick={handleClick}
			>
				<span className="vdsp-control-ui-toggle__track">
					<span className="vdsp-control-ui-toggle__thumb" />
				</span>
			</button>
		</ControlFrame>
	);
}

import type { SwitchControl } from "@vessel-dsp/core";
import { useState } from "react";
import type { ControlFrameClassNames } from "../types";
import { cx } from "../utils";
import { ControlFrame } from "./ControlFrame";

export type FootswitchButtonProps = Readonly<{
	control?: SwitchControl;
	label?: string;
	pressed: boolean;
	disabled?: boolean;
	className?: string | undefined;
	classNames?: ControlFrameClassNames | undefined;
	onPressedChange?: ((pressed: boolean) => void) | undefined;
	onPress?: (() => void) | undefined;
	onRelease?: (() => void) | undefined;
}>;

export function FootswitchButton({
	control,
	label = control?.name ?? "Footswitch",
	pressed,
	disabled = false,
	className,
	classNames,
	onPressedChange,
	onPress,
	onRelease,
}: FootswitchButtonProps) {
	const [isPressing, setIsPressing] = useState(false);

	function handleClick(): void {
		if (!disabled) {
			onPressedChange?.(!pressed);
		}
	}

	function handlePress(): void {
		if (!disabled) {
			setIsPressing(true);
			onPress?.();
		}
	}

	function handleRelease(): void {
		if (!disabled) {
			setIsPressing(false);
			onRelease?.();
		}
	}

	return (
		<ControlFrame
			label={label}
			disabled={disabled}
			className={className}
			classNames={classNames}
		>
			<button
				type="button"
				className={cx(
					"vdsp-control-ui-control",
					"vdsp-control-ui-footswitch",
					isPressing && "is-pressing",
					classNames?.control,
				)}
				aria-label={label}
				aria-pressed={pressed}
				disabled={disabled}
				data-vdsp-control-id={control?.id}
				onClick={handleClick}
				onPointerDown={handlePress}
				onPointerUp={handleRelease}
				onPointerCancel={handleRelease}
				onKeyDown={(event) => {
					if (event.key === " " || event.key === "Enter") {
						event.preventDefault();
						handlePress();
					}
				}}
				onKeyUp={(event) => {
					if (event.key === " " || event.key === "Enter") {
						event.preventDefault();
						handleRelease();
					}
				}}
			>
				<span className="vdsp-control-ui-footswitch__cap" />
			</button>
		</ControlFrame>
	);
}

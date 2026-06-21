import type { SliderControl } from "@vessel-dsp/core";
import type { CSSProperties } from "react";
import { formatControlValue } from "../controls";
import type { ControlFrameClassNames } from "../types";
import { cx } from "../utils";
import { ControlFrame } from "./ControlFrame";

export type GraphicEqSliderProps = Readonly<{
	control: SliderControl;
	position: number;
	disabled?: boolean;
	label?: string;
	className?: string | undefined;
	classNames?: ControlFrameClassNames | undefined;
	onPositionChange?: ((position: number) => void) | undefined;
}>;

export function GraphicEqSlider({
	control,
	position,
	disabled = false,
	label = control.name,
	className,
	classNames,
	onPositionChange,
}: GraphicEqSliderProps) {
	const readout = formatControlValue(
		{ kind: "slider", control },
		{ kind: "slider", position },
	);
	const sliderPosition = Math.round(position * 100);
	const sliderStyle = {
		"--vdsp-control-ui-slider-position": `${sliderPosition}%`,
	} as CSSProperties & Record<"--vdsp-control-ui-slider-position", string>;

	return (
		<ControlFrame
			label={label}
			readout={readout}
			disabled={disabled}
			className={className}
			classNames={classNames}
		>
			<div
				className={cx(
					"vdsp-control-ui-slider-shell",
					control.orientation === "vertical" && "is-vertical",
				)}
				data-orientation={control.orientation}
			>
				<input
					className={cx(
						"vdsp-control-ui-control",
						"vdsp-control-ui-slider",
						classNames?.control,
					)}
					type="range"
					min={0}
					max={100}
					step={1}
					value={sliderPosition}
					style={sliderStyle}
					aria-label={control.name}
					disabled={disabled}
					data-vdsp-control-id={control.id}
					data-orientation={control.orientation}
					onChange={(event) =>
						onPositionChange?.(Number(event.currentTarget.value) / 100)
					}
				/>
			</div>
		</ControlFrame>
	);
}

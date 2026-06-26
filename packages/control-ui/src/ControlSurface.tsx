import type {
	ControlState,
	ControlValue,
	Panel,
	PanelMessage,
} from "@vessel-dsp/core";
import { controlValueForId } from "./controls";
import {
	createControlSurfaceRenderPlan,
	type ControlSurfaceRenderItem,
} from "./render-plan";
import { applyControlUiMessage, controlMessageForValue } from "./state";
import type {
	ControlAppearanceMap,
	ControlFrameClassNames,
	ControlSurfaceClassNames,
} from "./types";
import { cx } from "./utils";
import { ConcentricKnob } from "./components/ConcentricKnob";
import { DetentedRotarySelect } from "./components/DetentedRotarySelect";
import { FootswitchButton } from "./components/FootswitchButton";
import { GraphicEqSlider } from "./components/GraphicEqSlider";
import { JackIndicator } from "./components/JackIndicator";
import { KnobControl } from "./components/KnobControl";
import { LedIndicator } from "./components/LedIndicator";
import { SwitchSelectControl } from "./components/SwitchSelectControl";
import { ToggleSwitchControl } from "./components/ToggleSwitchControl";

export type ControlSurfaceProps = Readonly<{
	panel: Panel;
	state: ControlState;
	disabled?: boolean;
	appearance?: ControlAppearanceMap | undefined;
	className?: string | undefined;
	classNames?: ControlSurfaceClassNames | undefined;
	onMessage?: ((message: PanelMessage) => void) | undefined;
	onStateChange?:
		| ((state: ControlState, message: PanelMessage) => void)
		| undefined;
}>;

export function ControlSurface({
	panel,
	state,
	disabled = false,
	appearance,
	className,
	classNames,
	onMessage,
	onStateChange,
}: ControlSurfaceProps) {
	const plan = createControlSurfaceRenderPlan(panel, { appearance });

	function emitControlValue(
		controlId: string,
		value: ControlValue | number | boolean,
	): void {
		if (disabled) {
			return;
		}
		const message = controlMessageForValue(panel, controlId, value);
		onMessage?.(message);
		if (onStateChange !== undefined) {
			onStateChange(applyControlUiMessage(panel, state, message), message);
		}
	}

	return (
		<div
			className={cx(
				"vdsp-control-ui-surface",
				disabled && "is-disabled",
				classNames?.root,
				className,
			)}
			data-vdsp-control-surface={true}
		>
			{plan.map((item) => (
				<div
					key={item.id}
					className={cx("vdsp-control-ui-surface__item", classNames?.item)}
					data-vdsp-control-item={item.controlId}
					data-vdsp-face-id={item.faceId}
				>
					{renderControlItem(
						item,
						state,
						disabled,
						classNames,
						emitControlValue,
					)}
				</div>
			))}
		</div>
	);
}

function renderControlItem(
	item: ControlSurfaceRenderItem,
	state: ControlState,
	disabled: boolean,
	classNames: ControlSurfaceClassNames | undefined,
	emitControlValue: (
		controlId: string,
		value: ControlValue | number | boolean,
	) => void,
) {
	const value = controlValueForId(state, item.controlId);
	const frameClassNames = frameClassNamesFor(item, classNames);

	if (item.control.kind === "knob") {
		if (item.appearance === "detented-rotary-select") {
			return (
				<DetentedRotarySelect
					control={item.control.control}
					position={
						value?.kind === "knob"
							? value.position
							: item.control.control.defaultPosition
					}
					disabled={disabled}
					label={item.label}
					classNames={frameClassNames}
					onPositionChange={(position) =>
						emitControlValue(item.controlId, position)
					}
				/>
			);
		}
		return (
			<KnobControl
				control={item.control.control}
				position={
					value?.kind === "knob"
						? value.position
						: item.control.control.defaultPosition
				}
				disabled={disabled}
				label={item.label}
				classNames={frameClassNames}
				onPositionChange={(position) =>
					emitControlValue(item.controlId, position)
				}
			/>
		);
	}

	if (item.control.kind === "slider") {
		return (
			<GraphicEqSlider
				control={item.control.control}
				position={
					value?.kind === "slider"
						? value.position
						: item.control.control.defaultPosition
				}
				disabled={disabled}
				label={item.label}
				classNames={frameClassNames}
				onPositionChange={(position) =>
					emitControlValue(item.controlId, position)
				}
			/>
		);
	}

	if (item.control.kind === "switch") {
		const position =
			value?.kind === "switch"
				? value.position
				: item.control.control.defaultPosition;
		if (item.appearance === "footswitch") {
			return (
				<FootswitchButton
					control={item.control.control}
					pressed={position > 0}
					disabled={disabled}
					label={item.label}
					classNames={frameClassNames}
					onPressedChange={(pressed) =>
						emitControlValue(item.controlId, pressed ? 1 : 0)
					}
				/>
			);
		}
		if (item.appearance === "toggle") {
			return (
				<ToggleSwitchControl
					control={item.control.control}
					position={position}
					disabled={disabled}
					label={item.label}
					classNames={frameClassNames}
					onPositionChange={(nextPosition) =>
						emitControlValue(item.controlId, nextPosition)
					}
				/>
			);
		}
		return (
			<SwitchSelectControl
				control={item.control.control}
				position={position}
				disabled={disabled}
				label={item.label}
				classNames={frameClassNames}
				onPositionChange={(nextPosition) =>
					emitControlValue(item.controlId, nextPosition)
				}
			/>
		);
	}

	if (item.control.kind === "concentric-knob") {
		const tiers = item.control.tiers.map((knob) => {
			const tierValue = controlValueForId(state, knob.id);
			return {
				control: knob,
				position:
					tierValue?.kind === "knob"
						? tierValue.position
						: knob.defaultPosition,
				label: knob.name,
				onPositionChange: (position: number) =>
					emitControlValue(knob.id, position),
			};
		});
		return (
			<ConcentricKnob
				tiers={tiers}
				disabled={disabled}
				classNames={frameClassNames}
			/>
		);
	}

	if (item.control.kind === "jack") {
		return (
			<JackIndicator
				control={item.control.control}
				disabled={disabled}
				label={item.label}
				classNames={frameClassNames}
			/>
		);
	}

	return (
		<LedIndicator
			control={item.control.control}
			value={value?.kind === "led" ? value : { kind: "led", on: false }}
			disabled={disabled}
			label={item.label}
			classNames={frameClassNames}
		/>
	);
}

function frameClassNamesFor(
	item: ControlSurfaceRenderItem,
	classNames: ControlSurfaceClassNames | undefined,
): ControlFrameClassNames | undefined {
	if (classNames === undefined) {
		return undefined;
	}

	return {
		frame: classNames.frame,
		label: classNames.label,
		readout: classNames.readout,
		control: cx(classNames.control, controlSpecificClassName(item, classNames)),
	};
}

function controlSpecificClassName(
	item: ControlSurfaceRenderItem,
	classNames: ControlSurfaceClassNames,
): string | undefined {
	switch (item.appearance) {
		case "knob":
			return classNames.knob;
		case "detented-rotary-select":
			return classNames.select;
		case "concentric-knob":
			return cx(classNames.knob, classNames.concentric);
		case "footswitch":
			return classNames.footswitch;
		case "toggle":
			return classNames.toggle;
		case "graphic-eq-slider":
		case "slider":
			return classNames.slider;
		case "led":
			return classNames.led;
		case "jack":
			return classNames.jack;
		case "hidden":
			return undefined;
	}
}

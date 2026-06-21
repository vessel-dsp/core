import type {
	ControlAppearanceMap,
	ControlSurfaceClassNames,
	ControlUiTheme,
} from "../../../packages/control-ui/src/types";
import { createControlUiState } from "../../../packages/control-ui/src/state";
import type {
	ControlState,
	Panel,
	PanelMessage,
} from "../../../packages/core/src/index";

export const controlUiRenderedExamplePanel = {
	knobs: [
		{
			id: "gain",
			name: "Gain",
			taper: "linear",
			defaultPosition: 0.72,
		},
		{
			id: "mode",
			name: "Mode",
			taper: "linear",
			controlMode: "stepped",
			defaultPosition: 0.5,
			steps: [
				{ index: 0, position: 0, label: "Clean" },
				{ index: 1, position: 0.5, label: "Crunch" },
				{ index: 2, position: 1, label: "Lead" },
			],
		},
	],
	sliders: [
		{
			id: "eq",
			name: "Mid EQ",
			defaultPosition: 0.65,
			orientation: "vertical",
			range: { min: -12, max: 12, unit: "dB", center: 0 },
		},
	],
	switches: [
		{
			id: "bypass",
			name: "Bypass",
			switchKind: "3pdt",
			poles: 3,
			positions: 2,
			defaultPosition: 1,
		},
		{
			id: "bright",
			name: "Bright",
			switchKind: "spdt",
			poles: 1,
			positions: 2,
			defaultPosition: 0,
		},
	],
	leds: [{ id: "status", name: "Status", color: "amber" }],
	jacks: [],
} satisfies Panel;

export const controlUiRenderedExampleInitialState = {
	...createControlUiState(controlUiRenderedExamplePanel),
	status: { kind: "led", on: false },
} satisfies ControlState;

export function controlUiRenderedExampleStateForMessage(
	state: ControlState,
	message: PanelMessage,
): ControlState {
	if (
		message.type !== "control/set" ||
		message.controlId !== "bright" ||
		message.value.kind !== "switch"
	) {
		return state;
	}

	if (message.value.position > 0) {
		return {
			...state,
			status: { kind: "led", on: true, intensity: 0.85 },
		};
	}

	return {
		...state,
		status: { kind: "led", on: false },
	};
}

export const controlUiRenderedExampleTheme = {
	accentColor: "#f59e0b",
	backgroundColor: "#0f172a",
	borderColor: "#64748b",
	controlColor: "#111827",
	textColor: "#f8fafc",
	mutedTextColor: "#cbd5e1",
	focusRingColor: "#38bdf8",
} satisfies ControlUiTheme;

export const controlUiRenderedExampleAppearance = {
	bypass: "footswitch",
	mode: "detented-rotary-select",
} satisfies ControlAppearanceMap;

export const controlUiRenderedExampleClassNames = {
	control: "control-ui-rendered-example__control",
	footswitch: "control-ui-rendered-example__footswitch",
	select: "control-ui-rendered-example__select",
} satisfies ControlSurfaceClassNames;

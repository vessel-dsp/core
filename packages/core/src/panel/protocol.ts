import type {
	ControlState,
	ControlValue,
	KnobValue,
	LedValue,
	Panel,
	PanelMessage,
	SliderValue,
	SwitchValue,
} from "./types";
import { isKnobPositionOnStep, snapKnobPosition } from "./knobs";

// defaultControlState builds the initial control state from a Panel descriptor.
// Every knob/switch lands at its declared default; every LED starts off.
export function defaultControlState(panel: Panel): ControlState {
	const state: Record<string, ControlValue> = {};
	for (const knob of panel.knobs) {
		state[knob.id] = {
			kind: "knob",
			position: snapKnobPosition(knob, knob.defaultPosition),
		};
	}
	for (const slider of panel.sliders ?? []) {
		state[slider.id] = { kind: "slider", position: slider.defaultPosition };
	}
	for (const sw of panel.switches) {
		state[sw.id] = { kind: "switch", position: sw.defaultPosition };
	}
	for (const led of panel.leds) {
		state[led.id] = { kind: "led", on: false };
	}
	return state;
}

// applyControlMessage is a pure reducer: (state, message) → state. Callers can
// route the same message in both directions — `control/set` from UI → DSP and
// `control/changed` from DSP → UI both produce the same state update.
export function applyControlMessage(
	state: ControlState,
	message: PanelMessage,
): ControlState {
	switch (message.type) {
		case "panel/load":
			return defaultControlState(message.panel);
		case "state/snapshot":
			return message.state;
		case "state/request":
		case "control/error":
			return state;
		case "control/set":
		case "control/changed":
			return { ...state, [message.controlId]: message.value };
	}
}

// Type guards make it safe for consumers to interrogate ControlValues without
// reaching into the discriminator manually.
export function isKnob(value: ControlValue | undefined): value is KnobValue {
	return value !== undefined && value.kind === "knob";
}

export function isSlider(
	value: ControlValue | undefined,
): value is SliderValue {
	return value !== undefined && value.kind === "slider";
}

export function isSwitch(
	value: ControlValue | undefined,
): value is SwitchValue {
	return value !== undefined && value.kind === "switch";
}

export function isLed(value: ControlValue | undefined): value is LedValue {
	return value !== undefined && value.kind === "led";
}

// Validate a message against a Panel — useful when the UI receives an event
// from the DSP and needs to ensure the controlId still exists. Returns null on
// success or a short reason string on failure.
export function validateMessage(
	panel: Panel,
	message: PanelMessage,
): string | null {
	if (message.type === "control/set" || message.type === "control/changed") {
		const knob = panel.knobs.find((k) => k.id === message.controlId);
		if (knob !== undefined) {
			if (message.value.kind !== "knob") {
				return `control "${message.controlId}" is a knob but received ${message.value.kind} value`;
			}
			if (
				!Number.isFinite(message.value.position) ||
				message.value.position < 0 ||
				message.value.position > 1
			) {
				return `knob "${message.controlId}" position must be in [0,1]`;
			}
			if (!isKnobPositionOnStep(knob, message.value.position)) {
				const stepCount = knob.steps?.length ?? 0;
				return `knob "${message.controlId}" position must match one of ${stepCount} stepped positions`;
			}
			return null;
		}
		const slider = (panel.sliders ?? []).find(
			(s) => s.id === message.controlId,
		);
		if (slider !== undefined) {
			if (message.value.kind !== "slider") {
				return `control "${message.controlId}" is a slider but received ${message.value.kind} value`;
			}
			if (
				!Number.isFinite(message.value.position) ||
				message.value.position < 0 ||
				message.value.position > 1
			) {
				return `slider "${message.controlId}" position must be in [0,1]`;
			}
			return null;
		}
		const sw = panel.switches.find((s) => s.id === message.controlId);
		if (sw !== undefined) {
			if (message.value.kind !== "switch") {
				return `control "${message.controlId}" is a switch but received ${message.value.kind} value`;
			}
			if (
				!Number.isInteger(message.value.position) ||
				message.value.position < 0 ||
				message.value.position >= sw.positions
			) {
				return `switch "${message.controlId}" position must be in [0,${sw.positions - 1}]`;
			}
			return null;
		}
		const led = panel.leds.find((l) => l.id === message.controlId);
		if (led !== undefined) {
			if (message.value.kind !== "led") {
				return `control "${message.controlId}" is an LED but received ${message.value.kind} value`;
			}
			return null;
		}
		return `unknown control id "${message.controlId}"`;
	}
	return null;
}

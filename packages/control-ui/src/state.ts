import type {
	ControlState,
	ControlValue,
	Panel,
	PanelMessage,
} from "@vessel-dsp/core";
import {
	applyControlMessage,
	defaultControlState,
	validateMessage,
} from "@vessel-dsp/core";
import { findPanelControl, valueForControl } from "./controls";

export function createControlUiState(panel: Panel): ControlState {
	return defaultControlState(panel);
}

export function applyControlUiMessage(
	panel: Panel,
	state: ControlState,
	message: PanelMessage,
): ControlState {
	const validationError = validateMessage(panel, message);
	if (validationError !== null) {
		throw new Error(validationError);
	}
	return applyControlMessage(state, message);
}

export function controlMessageForValue(
	panel: Panel,
	controlId: string,
	value: ControlValue | number | boolean,
	requestId?: string,
): PanelMessage {
	const control = findPanelControl(panel, controlId);
	if (control === undefined) {
		throw new Error(`unknown control id "${controlId}"`);
	}
	if (control.kind === "led") {
		throw new Error(`LED control "${controlId}" is read-only in control-ui`);
	}
	if (control.kind === "jack") {
		throw new Error(`Jack "${controlId}" is read-only in control-ui`);
	}

	const message: PanelMessage = {
		type: "control/set",
		controlId,
		value: valueForControl(control, value),
		...(requestId === undefined ? {} : { requestId }),
	};
	const validationError = validateMessage(panel, message);
	if (validationError !== null) {
		throw new Error(validationError);
	}
	return message;
}

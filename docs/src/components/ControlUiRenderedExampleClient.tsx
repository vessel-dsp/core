import React from "react";
import {
	ControlSurface,
	ControlUiThemeProvider,
	useControlState,
} from "../../../packages/control-ui/src/index";
import {
	controlUiRenderedExampleAppearance,
	controlUiRenderedExampleClassNames,
	controlUiRenderedExampleInitialState,
	controlUiRenderedExamplePanel,
	controlUiRenderedExampleStateForMessage,
	controlUiRenderedExampleTheme,
} from "./control-ui-rendered-example-data";

export function ControlUiRenderedExampleClient() {
	const controls = useControlState(controlUiRenderedExamplePanel, {
		initialState: controlUiRenderedExampleInitialState,
	});

	function handleDemoControlMessage(
		message: Parameters<typeof controls.dispatchMessage>[0],
	): void {
		const nextState = controls.dispatchMessage(message);
		const demoState = controlUiRenderedExampleStateForMessage(nextState, message);
		if (demoState !== nextState) {
			controls.setState(demoState);
		}
	}

	return (
		<ControlUiThemeProvider
			theme={controlUiRenderedExampleTheme}
			className="control-ui-rendered-example__theme"
		>
			<ControlSurface
				panel={controlUiRenderedExamplePanel}
				state={controls.state}
				appearance={controlUiRenderedExampleAppearance}
				className="control-ui-rendered-example__surface"
				classNames={controlUiRenderedExampleClassNames}
				onMessage={handleDemoControlMessage}
			/>
		</ControlUiThemeProvider>
	);
}

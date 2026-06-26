import type {
	JackPort,
	Knob,
	LedIndicator,
	SliderControl,
	SwitchControl,
} from "@vessel-dsp/core";

export type ControlAppearance =
	| "knob"
	| "detented-rotary-select"
	| "concentric-knob"
	| "footswitch"
	| "toggle"
	| "graphic-eq-slider"
	| "slider"
	| "led"
	| "jack"
	| "hidden";

export type ControlAppearanceMap = Partial<Record<string, ControlAppearance>>;

export type ControlUiControlRef =
	| Readonly<{ kind: "knob"; control: Knob }>
	| Readonly<{ kind: "slider"; control: SliderControl }>
	| Readonly<{ kind: "switch"; control: SwitchControl }>
	| Readonly<{ kind: "led"; control: LedIndicator }>
	| Readonly<{ kind: "jack"; control: JackPort }>
	// Stacked concentric pot: `tiers` are the dials in stack order (bottom
	// first); `control` is the base dial (`tiers[0]`) for generic id/name use.
	| Readonly<{
			kind: "concentric-knob";
			control: Knob;
			tiers: readonly Knob[];
	  }>;

export type ControlUiTheme = Readonly<{
	accentColor?: string | undefined;
	backgroundColor?: string | undefined;
	borderColor?: string | undefined;
	controlColor?: string | undefined;
	textColor?: string | undefined;
	mutedTextColor?: string | undefined;
	focusRingColor?: string | undefined;
}>;

export type ControlFrameClassNames = Readonly<{
	frame?: string | undefined;
	label?: string | undefined;
	readout?: string | undefined;
	control?: string | undefined;
}>;

export type ControlSurfaceClassNames = ControlFrameClassNames &
	Readonly<{
		root?: string | undefined;
		face?: string | undefined;
		item?: string | undefined;
		knob?: string | undefined;
		footswitch?: string | undefined;
		toggle?: string | undefined;
		slider?: string | undefined;
		select?: string | undefined;
		led?: string | undefined;
		jack?: string | undefined;
		concentric?: string | undefined;
	}>;

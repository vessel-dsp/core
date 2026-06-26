import { describe, expect, test } from "bun:test";
import {
	applyControlMessage,
	defaultControlState,
	isKnob,
	isLed,
	isSlider,
	isSwitch,
	validateMessage,
} from "../../packages/core/src/panel";
import type { Panel } from "../../packages/core/src/panel";

const SAMPLE_PANEL: Panel = {
	knobs: [
		{ id: "VOLUME", name: "Volume", taper: "log", defaultPosition: 0.7 },
		{ id: "TONE", name: "Tone", taper: "linear", defaultPosition: 0.5 },
		{
			id: "DROP",
			name: "Drop",
			taper: "unknown",
			controlMode: "stepped",
			defaultPosition: 0.24,
			steps: [
				{ index: 0, position: 0, label: "1" },
				{ index: 1, position: 0.125, label: "2" },
				{ index: 2, position: 0.25, label: "3" },
				{ index: 3, position: 0.375, label: "4" },
				{ index: 4, position: 0.5, label: "5" },
				{ index: 5, position: 0.625, label: "6" },
				{ index: 6, position: 0.75, label: "7" },
				{ index: 7, position: 0.875, label: "OCT" },
				{ index: 8, position: 1, label: "OCT+DRY" },
			],
		},
	],
	sliders: [
		{
			id: "BAND_800",
			name: "800Hz",
			defaultPosition: 0.5,
			orientation: "vertical",
			range: { min: -15, max: 15, unit: "dB", center: 0 },
		},
	],
	switches: [
		{
			id: "SW1",
			name: "Bypass",
			switchKind: "3pdt",
			poles: 3,
			positions: 2,
			defaultPosition: 0,
		},
	],
	leds: [{ id: "LED1", name: "Engaged", color: "red" }],
	jacks: [
		{ id: "IN", name: "Input", role: "input" },
		{ id: "OUT", name: "Output", role: "output" },
	],
};

describe("defaultControlState", () => {
	test("initializes knobs/switches/leds with their declared defaults", () => {
		const state = defaultControlState(SAMPLE_PANEL);
		expect(state.VOLUME).toEqual({ kind: "knob", position: 0.7 });
		expect(state.TONE).toEqual({ kind: "knob", position: 0.5 });
		expect(state.DROP).toEqual({ kind: "knob", position: 0.25 });
		expect(state.BAND_800).toEqual({ kind: "slider", position: 0.5 });
		expect(state.SW1).toEqual({ kind: "switch", position: 0 });
		expect(state.LED1).toEqual({ kind: "led", on: false });
	});

	test("jacks have no runtime state (audio-only ports)", () => {
		const state = defaultControlState(SAMPLE_PANEL);
		expect(state.IN).toBeUndefined();
		expect(state.OUT).toBeUndefined();
	});
});

describe("applyControlMessage", () => {
	test("control/set updates the targeted control without touching others", () => {
		const initial = defaultControlState(SAMPLE_PANEL);
		const next = applyControlMessage(initial, {
			type: "control/set",
			controlId: "VOLUME",
			value: { kind: "knob", position: 0.42 },
		});
		expect(next.VOLUME).toEqual({ kind: "knob", position: 0.42 });
		expect(next.TONE).toEqual(initial.TONE);
		expect(next.SW1).toEqual(initial.SW1);
	});

	test("control/changed (DSP → UI) writes the same way as control/set", () => {
		const initial = defaultControlState(SAMPLE_PANEL);
		const next = applyControlMessage(initial, {
			type: "control/changed",
			controlId: "LED1",
			value: { kind: "led", on: true, intensity: 0.8 },
		});
		expect(next.LED1).toEqual({ kind: "led", on: true, intensity: 0.8 });
	});

	test("panel/load resets to default state for the new panel", () => {
		const initial = defaultControlState(SAMPLE_PANEL);
		const modified = applyControlMessage(initial, {
			type: "control/set",
			controlId: "VOLUME",
			value: { kind: "knob", position: 0 },
		});
		const reloaded = applyControlMessage(modified, {
			type: "panel/load",
			panel: SAMPLE_PANEL,
		});
		expect(reloaded).toEqual(initial);
	});

	test("state/snapshot replaces the entire state", () => {
		const initial = defaultControlState(SAMPLE_PANEL);
		const snapshot = {
			VOLUME: { kind: "knob" as const, position: 0.1 },
			TONE: { kind: "knob" as const, position: 0.9 },
			BAND_800: { kind: "slider" as const, position: 0.65 },
			SW1: { kind: "switch" as const, position: 1 },
			LED1: { kind: "led" as const, on: true },
		};
		const next = applyControlMessage(initial, {
			type: "state/snapshot",
			state: snapshot,
		});
		expect(next).toEqual(snapshot);
	});

	test("state/request and control/error are pass-through (no state change)", () => {
		const initial = defaultControlState(SAMPLE_PANEL);
		const afterRequest = applyControlMessage(initial, {
			type: "state/request",
		});
		const afterError = applyControlMessage(initial, {
			type: "control/error",
			controlId: "VOLUME",
			reason: "out of range",
		});
		expect(afterRequest).toBe(initial);
		expect(afterError).toBe(initial);
	});
});

describe("type guards", () => {
	test("isKnob / isSwitch / isLed discriminate correctly", () => {
		const knob = { kind: "knob" as const, position: 0.5 };
		const slider = { kind: "slider" as const, position: 0.5 };
		const sw = { kind: "switch" as const, position: 1 };
		const led = { kind: "led" as const, on: true };

		expect(isKnob(knob)).toBe(true);
		expect(isKnob(slider)).toBe(false);
		expect(isSlider(slider)).toBe(true);
		expect(isSlider(knob)).toBe(false);
		expect(isKnob(sw)).toBe(false);
		expect(isSwitch(sw)).toBe(true);
		expect(isSwitch(led)).toBe(false);
		expect(isLed(led)).toBe(true);
		expect(isLed(undefined)).toBe(false);
	});
});

describe("validateMessage", () => {
	test("accepts well-formed knob/switch/led updates", () => {
		expect(
			validateMessage(SAMPLE_PANEL, {
				type: "control/set",
				controlId: "VOLUME",
				value: { kind: "knob", position: 0.5 },
			}),
		).toBeNull();

		expect(
			validateMessage(SAMPLE_PANEL, {
				type: "control/set",
				controlId: "DROP",
				value: { kind: "knob", position: 0.25 },
			}),
		).toBeNull();

		expect(
			validateMessage(SAMPLE_PANEL, {
				type: "control/set",
				controlId: "BAND_800",
				value: { kind: "slider", position: 0.75 },
			}),
		).toBeNull();

		expect(
			validateMessage(SAMPLE_PANEL, {
				type: "control/set",
				controlId: "SW1",
				value: { kind: "switch", position: 1 },
			}),
		).toBeNull();

		expect(
			validateMessage(SAMPLE_PANEL, {
				type: "control/changed",
				controlId: "LED1",
				value: { kind: "led", on: true },
			}),
		).toBeNull();
	});

	test("rejects knob position outside [0,1]", () => {
		const reason = validateMessage(SAMPLE_PANEL, {
			type: "control/set",
			controlId: "VOLUME",
			value: { kind: "knob", position: 1.5 },
		});
		expect(reason).toContain("VOLUME");
		expect(reason).toContain("[0,1]");
	});

	test("rejects stepped knob positions that fall between detents", () => {
		const reason = validateMessage(SAMPLE_PANEL, {
			type: "control/set",
			controlId: "DROP",
			value: { kind: "knob", position: 0.3 },
		});

		expect(reason).toContain("DROP");
		expect(reason).toContain("stepped");
		expect(reason).toContain("9");
	});

	test("rejects slider position outside [0,1]", () => {
		const reason = validateMessage(SAMPLE_PANEL, {
			type: "control/set",
			controlId: "BAND_800",
			value: { kind: "slider", position: -0.1 },
		});

		expect(reason).toContain("BAND_800");
		expect(reason).toContain("[0,1]");
	});

	test("rejects switch position outside the declared range", () => {
		const reason = validateMessage(SAMPLE_PANEL, {
			type: "control/set",
			controlId: "SW1",
			value: { kind: "switch", position: 2 },
		});
		expect(reason).toContain("SW1");
	});

	test("rejects type/kind mismatches (sending a knob value to a switch)", () => {
		const reason = validateMessage(SAMPLE_PANEL, {
			type: "control/set",
			controlId: "SW1",
			value: { kind: "knob", position: 0.5 },
		});
		expect(reason).toContain("switch");
		expect(reason).toContain("knob");
	});

	test("rejects unknown control ids", () => {
		const reason = validateMessage(SAMPLE_PANEL, {
			type: "control/set",
			controlId: "MISSING",
			value: { kind: "knob", position: 0 },
		});
		expect(reason).toContain("unknown");
		expect(reason).toContain("MISSING");
	});
});

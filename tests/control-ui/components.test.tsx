import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import {
	ControlFrame,
	DetentedRotarySelect,
	FootswitchButton,
	GraphicEqSlider,
	KnobControl,
	LedIndicator,
	ToggleSwitchControl,
	themeToCssVariables,
} from "@vessel-dsp/control-ui";
import { controlUiTestPanel } from "./fixtures";

const CONTROL_UI_STYLES_URL = new URL(
	"../../packages/control-ui/src/styles.css",
	import.meta.url,
);

function cssRuleBody(styles: string, selector: string): string {
	const selectorStart = styles.indexOf(`${selector} {`);
	expect(selectorStart).toBeGreaterThanOrEqual(0);
	const blockStart = styles.indexOf("{", selectorStart);
	const blockEnd = styles.indexOf("}", blockStart);
	return styles.slice(blockStart + 1, blockEnd);
}

describe("control-ui React primitives", () => {
	test("renders a styled accessible knob with custom utility classes", () => {
		const html = renderToStaticMarkup(
			<KnobControl
				control={controlUiTestPanel.knobs[0]}
				position={0.25}
				className="tw-inline"
				classNames={{ control: "tw-size-16", readout: "tw-text-xs" }}
			/>,
		);

		expect(html).toContain("vdsp-control-ui-knob");
		expect(html).toContain("tw-inline");
		expect(html).toContain("tw-size-16");
		expect(html).toContain('role="slider"');
		expect(html).toContain('aria-valuenow="25"');
		expect(html).toContain("Gain");
	});

	test("renders knob progress as a non-closed 300 degree ring", () => {
		const html = renderToStaticMarkup(
			<KnobControl control={controlUiTestPanel.knobs[0]} position={0.5} />,
		);

		expect(html).toContain("--vdsp-control-ui-knob-sweep:300deg");
		expect(html).toContain("--vdsp-control-ui-knob-progress:150deg");
		expect(html).toContain("--vdsp-control-ui-knob-rotation:0deg");
		expect(html).toContain("vdsp-control-ui-knob__progress");
		expect(html).toContain("vdsp-control-ui-knob__progress-fill");
		expect(html).toContain("vdsp-control-ui-knob__indicator-line");
	});

	test("uses orange as the default primary control color and lighter labels", () => {
		const styles = readFileSync(CONTROL_UI_STYLES_URL, "utf8");
		const defaultThemeRule = cssRuleBody(
			styles,
			":where(.vdsp-control-ui-theme, .vdsp-control-ui-surface)",
		);
		const labelRule = cssRuleBody(styles, ".vdsp-control-ui-label");

		expect(defaultThemeRule).toContain(
			"--vdsp-control-ui-accent-color: #f97316;",
		);
		expect(labelRule).toContain(
			"color: color-mix(in srgb, var(--vdsp-control-ui-text-color) 72%, white);",
		);
	});

	test("advertises horizontal knob dragging through cursor styles", () => {
		const styles = readFileSync(CONTROL_UI_STYLES_URL, "utf8");

		expect(cssRuleBody(styles, ".vdsp-control-ui-knob")).toContain(
			"cursor: ew-resize;",
		);
		expect(cssRuleBody(styles, ".vdsp-control-ui-knob:active")).toContain(
			"cursor: ew-resize;",
		);
		expect(cssRuleBody(styles, ".vdsp-control-ui-knob.is-dragging")).toContain(
			"cursor: ew-resize;",
		);
		expect(
			cssRuleBody(
				styles,
				".vdsp-control-ui-is-knob-dragging,\n.vdsp-control-ui-is-knob-dragging *",
			),
		).toContain("cursor: ew-resize !important;");
	});

	test("updates knob rotation immediately during pointer drag and locks the cursor", () => {
		const positions: number[] = [];
		let pointerLocked = false;
		let pointerReleased = false;
		const documentClasses = new Set<string>();
		const documentListeners: Record<string, (event: unknown) => void> = {};
		const ownerDocument = {
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				documentListeners[type] = listener;
			},
			removeEventListener: (type: string) => {
				delete documentListeners[type];
			},
			exitPointerLock: () => {
				pointerReleased = true;
			},
			body: {
				requestPointerLock: () => {
					pointerLocked = true;
				},
			},
			documentElement: {
				classList: {
					add: (className: string) => {
						documentClasses.add(className);
					},
					remove: (className: string) => {
						documentClasses.delete(className);
					},
				},
			},
		};
		const currentTarget = {
			ownerDocument,
			requestPointerLock: undefined,
			setPointerCapture: () => {},
			releasePointerCapture: () => {},
		};
		const renderer = create(
			<KnobControl
				control={controlUiTestPanel.knobs[0]}
				position={0.25}
				onPositionChange={(position) => positions.push(position)}
			/>,
		);
		const knob = () =>
			renderer.root.findByProps({ "data-vdsp-control-id": "gain" });

		act(() => {
			knob().props.onPointerDown({
				pointerId: 7,
				clientX: 100,
				clientY: 100,
				currentTarget,
			});
		});
		expect(pointerLocked).toBe(true);
		expect(knob().props.className).toContain("is-dragging");
		expect(documentClasses.has("vdsp-control-ui-is-knob-dragging")).toBe(true);
		expect(documentListeners.pointermove).toBeDefined();
		expect(documentListeners.mousemove).toBeDefined();
		expect(documentListeners.pointerup).toBeDefined();

		act(() => {
			documentListeners.mousemove?.({
				clientX: 100,
				clientY: 20,
				movementX: 0,
				movementY: -80,
				preventDefault: () => {},
			});
		});
		expect(positions).toEqual([]);
		expect(knob().props.style["--vdsp-control-ui-knob-progress"]).toBe("75deg");
		expect(knob().props.style["--vdsp-control-ui-knob-rotation"]).toBe(
			"-75deg",
		);

		act(() => {
			documentListeners.mousemove?.({
				clientX: 180,
				clientY: 20,
				movementX: 80,
				movementY: 0,
				preventDefault: () => {},
			});
		});
		expect(positions).toEqual([0.75]);
		expect(knob().props.style["--vdsp-control-ui-knob-progress"]).toBe(
			"225deg",
		);
		expect(knob().props.style["--vdsp-control-ui-knob-rotation"]).toBe("75deg");

		act(() => {
			documentListeners.pointerup?.({ pointerId: 7 });
		});
		expect(pointerReleased).toBe(true);
		expect(knob().props.className).not.toContain("is-dragging");
		expect(knob().props.style["--vdsp-control-ui-knob-progress"]).toBe(
			"225deg",
		);
		expect(knob().props.style["--vdsp-control-ui-knob-rotation"]).toBe("75deg");
		expect(documentClasses.has("vdsp-control-ui-is-knob-dragging")).toBe(false);
		expect(documentListeners.pointermove).toBeUndefined();
		expect(documentListeners.pointerup).toBeUndefined();
	});

	test("keeps a horizontally dragged knob at the clamped value after release", () => {
		const positions: number[] = [];
		const documentClasses = new Set<string>();
		const documentListeners: Record<string, (event: unknown) => void> = {};
		const ownerDocument = {
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				documentListeners[type] = listener;
			},
			removeEventListener: (type: string) => {
				delete documentListeners[type];
			},
			exitPointerLock: () => {},
			body: {},
			documentElement: {
				classList: {
					add: (className: string) => {
						documentClasses.add(className);
					},
					remove: (className: string) => {
						documentClasses.delete(className);
					},
				},
			},
		};
		const currentTarget = {
			ownerDocument,
			setPointerCapture: () => {},
			releasePointerCapture: () => {},
		};
		const renderer = create(
			<KnobControl
				control={controlUiTestPanel.knobs[0]}
				position={0.72}
				onPositionChange={(position) => positions.push(position)}
			/>,
		);
		const knob = () =>
			renderer.root.findByProps({ "data-vdsp-control-id": "gain" });

		act(() => {
			knob().props.onPointerDown({
				pointerId: 8,
				clientX: 240,
				clientY: 100,
				currentTarget,
			});
		});
		act(() => {
			documentListeners.mousemove?.({
				clientX: 40,
				clientY: 100,
				movementX: -200,
				movementY: 0,
				preventDefault: () => {},
			});
		});
		expect(positions).toEqual([0]);
		expect(knob().props.style["--vdsp-control-ui-knob-progress"]).toBe("0deg");
		expect(knob().props.style["--vdsp-control-ui-knob-rotation"]).toBe(
			"-150deg",
		);

		act(() => {
			documentListeners.mouseup?.({});
		});
		expect(knob().props.className).not.toContain("is-dragging");
		expect(knob().props.style["--vdsp-control-ui-knob-progress"]).toBe("0deg");
		expect(knob().props.style["--vdsp-control-ui-knob-rotation"]).toBe(
			"-150deg",
		);
	});

	test("renders footswitch, toggle, slider, select, and LED semantics", () => {
		const html = renderToStaticMarkup(
			<div>
				<FootswitchButton
					control={controlUiTestPanel.switches[0]}
					pressed={true}
					className="rounded-full"
				/>
				<ToggleSwitchControl
					control={controlUiTestPanel.switches[1]}
					position={1}
					className="tw-toggle"
				/>
				<GraphicEqSlider
					control={controlUiTestPanel.sliders?.[0]}
					position={0.75}
					className="tw-slider"
				/>
				<DetentedRotarySelect
					control={controlUiTestPanel.knobs[1]}
					position={0.5}
					className="tw-select"
				/>
				<LedIndicator
					control={controlUiTestPanel.leds[0]}
					value={{ kind: "led", on: true, intensity: 0.6 }}
				/>
			</div>,
		);

		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain('role="switch"');
		expect(html).toContain('aria-checked="true"');
		expect(html).toContain('data-orientation="vertical"');
		expect(html).toContain("--vdsp-control-ui-slider-position:75%");
		expect(html).not.toContain("vdsp-control-ui-slider__center");
		expect(html).toContain('<option value="0.5" selected="">Crunch</option>');
		expect(html).toContain('aria-label="Status on"');
		expect(html).toContain("rounded-full");
		expect(html).toContain("tw-toggle");
		expect(html).toContain("tw-slider");
		expect(html).toContain("tw-select");
	});

	test("removes native slider track borders", () => {
		const styles = readFileSync(CONTROL_UI_STYLES_URL, "utf8");
		const sliderRule = cssRuleBody(styles, ".vdsp-control-ui-slider");
		const webkitTrackRule = cssRuleBody(
			styles,
			".vdsp-control-ui-slider::-webkit-slider-runnable-track",
		);
		const webkitThumbRule = cssRuleBody(
			styles,
			".vdsp-control-ui-slider::-webkit-slider-thumb",
		);

		expect(sliderRule).toContain("-webkit-appearance: none;");
		expect(sliderRule).toContain("appearance: none;");
		expect(sliderRule).toContain("background: transparent;");
		expect(webkitTrackRule).toContain("-webkit-appearance: none;");
		expect(webkitTrackRule).toContain("border: 0;");
		expect(webkitTrackRule).toContain("box-shadow: none;");
		expect(webkitThumbRule).toContain("-webkit-appearance: none;");
		expect(
			cssRuleBody(styles, ".vdsp-control-ui-slider::-moz-range-track"),
		).toContain("border: 0;");
	});

	test("styles the toggle as a flat control without shadows", () => {
		const styles = readFileSync(CONTROL_UI_STYLES_URL, "utf8");
		const toggleRule = cssRuleBody(styles, ".vdsp-control-ui-toggle");
		const checkedRule = cssRuleBody(
			styles,
			".vdsp-control-ui-toggle.is-checked",
		);
		const thumbRule = cssRuleBody(styles, ".vdsp-control-ui-toggle__thumb");

		expect(toggleRule).toContain(
			"background: var(--vdsp-control-ui-control-color);",
		);
		expect(toggleRule).toContain("box-shadow: none;");
		expect(checkedRule).toContain(
			"background: var(--vdsp-control-ui-accent-color);",
		);
		expect(thumbRule).toContain(
			"background: var(--vdsp-control-ui-background-color);",
		);
		expect(thumbRule).toContain("box-shadow: none;");
	});

	test("renders footswitch toggle state without latching the physical press visual", () => {
		const html = renderToStaticMarkup(
			<FootswitchButton
				control={controlUiTestPanel.switches[0]}
				pressed={true}
			/>,
		);

		expect(html).toContain('aria-pressed="true"');
		expect(html).not.toContain("is-pressed");
		expect(html).not.toContain("is-pressing");
	});

	test("shows footswitch press feedback only while the actuator is held", () => {
		const presses: string[] = [];
		const renderer = create(
			<FootswitchButton
				control={controlUiTestPanel.switches[0]}
				pressed={true}
				onPress={() => presses.push("press")}
				onRelease={() => presses.push("release")}
			/>,
		);
		const footswitch = () =>
			renderer.root.findByProps({ "data-vdsp-control-id": "bypass" });

		expect(footswitch().props["aria-pressed"]).toBe(true);
		expect(footswitch().props.className).not.toContain("is-pressed");
		expect(footswitch().props.className).not.toContain("is-pressing");

		act(() => {
			footswitch().props.onPointerDown();
		});
		expect(presses).toEqual(["press"]);
		expect(footswitch().props.className).toContain("is-pressing");

		act(() => {
			footswitch().props.onPointerUp();
		});
		expect(presses).toEqual(["press", "release"]);
		expect(footswitch().props.className).not.toContain("is-pressing");
	});

	test("styles the footswitch as a solid circular actuator with held border feedback", () => {
		const styles = readFileSync(CONTROL_UI_STYLES_URL, "utf8");
		const footswitchRule = cssRuleBody(styles, ".vdsp-control-ui-footswitch");
		const pressingRule = cssRuleBody(
			styles,
			".vdsp-control-ui-footswitch.is-pressing,\n.vdsp-control-ui-footswitch:active",
		);
		const capRule = cssRuleBody(styles, ".vdsp-control-ui-footswitch__cap");

		expect(footswitchRule).toContain(
			"border: 1px solid var(--vdsp-control-ui-border-color);",
		);
		expect(footswitchRule).toContain("border-radius: 50%;");
		expect(footswitchRule).toContain(
			"background: var(--vdsp-control-ui-control-color);",
		);
		expect(footswitchRule).toContain("box-shadow: none;");
		expect(pressingRule).toContain("border-width: 3px;");
		expect(capRule).toContain("display: none;");
	});

	test("styles the select dropdown with square dark pure CSS controls", () => {
		const styles = readFileSync(CONTROL_UI_STYLES_URL, "utf8");
		const selectRule = cssRuleBody(styles, ".vdsp-control-ui-select");
		const optionRule = cssRuleBody(styles, ".vdsp-control-ui-select option");

		expect(selectRule).toContain("appearance: none;");
		expect(selectRule).toContain("border-radius: 0;");
		expect(selectRule).toContain("box-shadow: none;");
		expect(selectRule).toContain(
			"background-color: var(--vdsp-control-ui-control-color);",
		);
		expect(selectRule).toContain(
			"color: var(--vdsp-control-ui-background-color);",
		);
		expect(selectRule).toContain("background-image:");
		expect(optionRule).toContain(
			"background-color: var(--vdsp-control-ui-control-color);",
		);
		expect(optionRule).toContain(
			"color: var(--vdsp-control-ui-background-color);",
		);
	});

	test("maps theme variables without replacing class hooks", () => {
		const style = themeToCssVariables({
			accentColor: "#f59e0b",
			backgroundColor: "#101820",
			textColor: "#f8fafc",
			focusRingColor: "#38bdf8",
		});
		const html = renderToStaticMarkup(
			<ControlFrame label="Output" readout="75%" className="tw-frame" />,
		);

		expect(style).toEqual({
			"--vdsp-control-ui-accent-color": "#f59e0b",
			"--vdsp-control-ui-background-color": "#101820",
			"--vdsp-control-ui-text-color": "#f8fafc",
			"--vdsp-control-ui-focus-ring-color": "#38bdf8",
		});
		expect(html).toContain("tw-frame");
	});
});

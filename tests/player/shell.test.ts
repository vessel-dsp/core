// Player shell tests: parseSourceList validation plus the controller
// state machine against a fake engine. Deterministic, no network, no
// browser APIs. Every expected value is written by hand in a comment
// before the assertion, and every behaviour has a positive case plus a
// negative control showing the check can fail for the stated reason.
// Typed errors compare reason codes as whole values, never message text.

import { afterEach, describe, expect, test } from "bun:test";
import {
	BROWSER_AUDIO_INPUT,
	PlayerController,
	PlayerError,
	parseSourceList,
	setEngineFactory,
	type InputChoiceDescriptor,
	type IrDescriptor,
	type NamDescriptor,
	type PlayerControlInfo,
	type PlayerEngine,
	type PlayerEngineEventName,
	type SourceItem,
} from "@vessel-dsp/player";

const BLOG_INPUTS: SourceItem[] = [
	{ id: "di-guitar", label: "DI Guitar", src: "/audio/di-guitar.wav" },
	{ id: "loop-a", label: "Loop A", src: "https://cdn.example.com/loops/a.wav" },
];

const NAM_LIST: SourceItem[] = [{ id: "jcm800", label: "JCM800", src: "/models/jcm800.nam" }];

const IR_LIST: SourceItem[] = [{ id: "v30", label: "Vintage 30", src: "/irs/v30.wav" }];

const FAKE_CONTROLS: readonly PlayerControlInfo[] = [
	{ id: "gain", label: "Gain", value: 0.5, min: 0, max: 1 },
	{ id: "level", label: "Level", value: 0.8, min: 0, max: 1 },
];

class FakeEngine implements PlayerEngine {
	readonly loads: Array<{ readonly vdsp: string }> = [];
	starts = 0;
	stops = 0;
	disposes = 0;
	readonly controlCalls: Array<{ readonly id: string; readonly value: number }> = [];
	readonly inputCalls: InputChoiceDescriptor[] = [];
	readonly namCalls: Array<NamDescriptor | null> = [];
	readonly irCalls: Array<IrDescriptor | null> = [];
	throwOnLoad: PlayerError | null = null;
	private readonly emitOnLoad: boolean;
	private readonly controlsToEmit: readonly PlayerControlInfo[];
	private readonly listeners = new Map<PlayerEngineEventName, Set<(payload?: unknown) => void>>();

	constructor(options?: { emitOnLoad?: boolean; controls?: readonly PlayerControlInfo[] }) {
		this.emitOnLoad = options?.emitOnLoad ?? true;
		this.controlsToEmit = options?.controls ?? FAKE_CONTROLS;
	}

	on(event: PlayerEngineEventName, listener: (payload?: unknown) => void): () => void {
		let set = this.listeners.get(event);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener);
		return () => {
			set?.delete(listener);
		};
	}

	fire(event: PlayerEngineEventName, payload?: unknown): void {
		for (const listener of [...(this.listeners.get(event) ?? [])]) {
			listener(payload);
		}
	}

	load(source: { readonly vdsp: string }): void {
		this.loads.push({ vdsp: source.vdsp });
		if (this.throwOnLoad !== null) {
			throw this.throwOnLoad;
		}
		if (this.emitOnLoad) {
			this.fire("controls", this.controlsToEmit);
			this.fire("ready");
		}
	}

	start(): void {
		this.starts += 1;
	}

	stop(): void {
		this.stops += 1;
	}

	setControl(id: string, value: number): void {
		this.controlCalls.push({ id, value });
	}

	setInput(choice: InputChoiceDescriptor): void {
		this.inputCalls.push(choice);
	}

	setNam(model: NamDescriptor | null): void {
		this.namCalls.push(model);
	}

	setIr(ir: IrDescriptor | null): void {
		this.irCalls.push(ir);
	}

	dispose(): void {
		this.disposes += 1;
	}
}

function useEngine(fake: FakeEngine): void {
	setEngineFactory(() => ({ ok: true, engine: fake }));
}

function catchSync(fn: () => void): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return null;
}

async function catchAsync(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
	} catch (error) {
		return error;
	}
	return null;
}

afterEach(() => {
	setEngineFactory(null);
});

describe("parseSourceList", () => {
	test("accepts a valid list with explicit ids", () => {
		const result = parseSourceList(
			'[{"id":"a","label":"DI Guitar","src":"/audio/di.wav"},{"id":"b","label":"Loop","src":"https://cdn.example.com/loop.wav"}]',
		);
		// Expected: the parse succeeds and yields two items
		expect("items" in result).toBe(true);
		if ("items" in result) {
			// Expected: both items keep their explicit ids, labels and srcs
			expect(result.items.length).toBe(2);
			expect(result.items[0]).toEqual({ id: "a", label: "DI Guitar", src: "/audio/di.wav" });
			expect(result.items[1]).toEqual({
				id: "b",
				label: "Loop",
				src: "https://cdn.example.com/loop.wav",
			});
		}
		// Negative control: the same shape with a missing src is refused
		const bad = parseSourceList('[{"id":"a","label":"DI Guitar"}]');
		// Expected: refusal reason missing-id-or-label-or-src, not a success
		expect("reason" in bad).toBe(true);
		if ("reason" in bad) {
			expect(bad.reason).toBe("missing-id-or-label-or-src");
		}
	});

	test("refuses text that is not JSON", () => {
		const result = parseSourceList("{oops");
		// Expected: refusal reason not-json
		expect("reason" in result).toBe(true);
		if ("reason" in result) {
			expect(result.reason).toBe("not-json");
		}
		// Negative control: valid JSON that is not an array gives not-array, not not-json
		const nearby = parseSourceList('{"id":"a"}');
		// Expected: nearby input is valid JSON so the reason differs
		expect("reason" in nearby).toBe(true);
		if ("reason" in nearby) {
			expect(nearby.reason).toBe("not-array");
		}
	});

	test("refuses JSON that is not an array", () => {
		const result = parseSourceList('{"id":"a","label":"A","src":"/a.wav"}');
		// Expected: refusal reason not-array
		expect("reason" in result).toBe(true);
		if ("reason" in result) {
			expect(result.reason).toBe("not-array");
		}
		// Negative control: null is valid JSON but still not an array
		const nearby = parseSourceList("null");
		// Expected: null also refuses, with the same not-array reason
		expect("reason" in nearby).toBe(true);
		if ("reason" in nearby) {
			expect(nearby.reason).toBe("not-array");
		}
	});

	test("refuses entries that are not objects", () => {
		const result = parseSourceList('[null]');
		// Expected: null entries are refused as item-not-object
		expect("reason" in result).toBe(true);
		if ("reason" in result) {
			expect(result.reason).toBe("item-not-object");
		}
		// Negative control: a number entry is also not an object
		const nearby = parseSourceList('[42]');
		// Expected: numbers refuse with the same item-not-object reason
		expect("reason" in nearby).toBe(true);
		if ("reason" in nearby) {
			expect(nearby.reason).toBe("item-not-object");
		}
	});

	test("refuses entries missing label or src", () => {
		const result = parseSourceList('[{"id":"a","label":"Only a label"}]');
		// Expected: refusal reason missing-id-or-label-or-src
		expect("reason" in result).toBe(true);
		if ("reason" in result) {
			expect(result.reason).toBe("missing-id-or-label-or-src");
		}
		// Negative control: an entry with an empty-string label is also missing
		const nearby = parseSourceList('[{"id":"a","label":"  ","src":"/a.wav"}]');
		// Expected: blank labels refuse with the same reason
		expect("reason" in nearby).toBe(true);
		if ("reason" in nearby) {
			expect(nearby.reason).toBe("missing-id-or-label-or-src");
		}
	});

	test("derives omitted ids from the entry index as source-<index>", () => {
		const result = parseSourceList('[{"label":"A","src":"/a.wav"},{"label":"B","src":"/b.wav"}]');
		// Expected: both entries parse with derived ids source-0 and source-1
		expect("items" in result).toBe(true);
		if ("items" in result) {
			expect(result.items.length).toBe(2);
			expect(result.items[0]?.id).toBe("source-0");
			expect(result.items[1]?.id).toBe("source-1");
		}
		// Negative control: an explicit id is preserved, not overwritten
		const nearby = parseSourceList('[{"id":"keep-me","label":"A","src":"/a.wav"}]');
		// Expected: the explicit id survives derivation
		expect("items" in nearby).toBe(true);
		if ("items" in nearby) {
			expect(nearby.items[0]?.id).toBe("keep-me");
		}
	});

	test("refuses duplicate ids including derived ones", () => {
		const result = parseSourceList(
			'[{"id":"dup","label":"A","src":"/a.wav"},{"id":"dup","label":"B","src":"/b.wav"}]',
		);
		// Expected: refusal reason duplicate-id
		expect("reason" in result).toBe(true);
		if ("reason" in result) {
			expect(result.reason).toBe("duplicate-id");
		}
		// Negative control: distinct ids parse to two items
		const nearby = parseSourceList(
			'[{"id":"one","label":"A","src":"/a.wav"},{"id":"two","label":"B","src":"/b.wav"}]',
		);
		// Expected: two items, so the duplicate check passes
		expect("items" in nearby).toBe(true);
		if ("items" in nearby) {
			expect(nearby.items.length).toBe(2);
		}
	});

	test("refuses javascript: and data: srcs", () => {
		const js = parseSourceList('[{"id":"a","label":"A","src":"javascript:alert(1)"}]');
		// Expected: javascript: URLs refuse with unsafe-src
		expect("reason" in js).toBe(true);
		if ("reason" in js) {
			expect(js.reason).toBe("unsafe-src");
		}
		const data = parseSourceList('[{"id":"a","label":"A","src":"data:audio/wav;base64,AAA"}]');
		// Expected: data: URLs refuse with unsafe-src
		expect("reason" in data).toBe(true);
		if ("reason" in data) {
			expect(data.reason).toBe("unsafe-src");
		}
		// Negative control: uppercase scheme tricks are also refused
		const sneaky = parseSourceList('[{"id":"a","label":"A","src":"JaVaScRiPt:alert(1)"}]');
		// Expected: scheme matching is case-insensitive, still unsafe-src
		expect("reason" in sneaky).toBe(true);
		if ("reason" in sneaky) {
			expect(sneaky.reason).toBe("unsafe-src");
		}
	});

	test("accepts http, https and same-origin relative srcs", () => {
		const result = parseSourceList(
			'[{"id":"a","label":"CDN","src":"https://cdn.example.com/x.nam"},{"id":"b","label":"Local","src":"/models/jcm.nam"},{"id":"c","label":"Bare","src":"audio/di.wav"}]',
		);
		// Expected: all three safe src shapes parse to three items
		expect("items" in result).toBe(true);
		if ("items" in result) {
			expect(result.items.length).toBe(3);
		}
		// Negative control: protocol-relative URLs are not same-origin relative
		const nearby = parseSourceList('[{"id":"a","label":"A","src":"//evil.example.com/x.wav"}]');
		// Expected: protocol-relative srcs refuse with unsafe-src
		expect("reason" in nearby).toBe(true);
		if ("reason" in nearby) {
			expect(nearby.reason).toBe("unsafe-src");
		}
	});

	test("treats empty text as an empty list", () => {
		const result = parseSourceList("   ");
		// Expected: whitespace-only text parses to zero items
		expect("items" in result).toBe(true);
		if ("items" in result) {
			expect(result.items.length).toBe(0);
		}
		// Negative control: an empty array literal also parses to zero items
		const nearby = parseSourceList("[]");
		// Expected: zero items as well, so emptiness is not an error
		expect("items" in nearby).toBe(true);
		if ("items" in nearby) {
			expect(nearby.items.length).toBe(0);
		}
	});
});

describe("PlayerController with a fake engine", () => {
	test("the default input reaches the engine before it loads (no silent playback)", async () => {
		// The controller's default is the first blog input. The engine only knows what it is told:
		// without the hand-over it falls back to a silent buffer while the page shows an input.
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			inputs: [{ id: "take", label: "Guitar take", src: "/audio/take.wav" }],
		});
		await controller.settled();
		// Expected: the engine was handed the blog WAV exactly once
		expect(fake.inputCalls.length).toBe(1);
		expect(fake.inputCalls[0]).toMatchObject({ kind: "wav", id: "take", src: "/audio/take.wav" });
		// Expected: a later list refresh with the same selection does not hand it over again
		controller.setInputSources([{ id: "take", label: "Guitar take", src: "/audio/take.wav" }]);
		expect(fake.inputCalls.length).toBe(1);
		controller.dispose();
	});

	test("loads once with the vdsp source and reaches ready", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await controller.settled();
		// Expected: ready after the fake reports ready
		expect(controller.state).toBe("ready");
		// Expected: exactly one engine load carrying the vdsp URL
		expect(fake.loads.length).toBe(1);
		expect(fake.loads[0]?.vdsp).toBe("https://blog.example.com/pedal.vdsp");
		// Expected: the controller counted the same single load
		expect(controller.loadCount).toBe(1);
		controller.dispose();
		// Negative control: no src means idle with no engine load
		const idleFake = new FakeEngine();
		useEngine(idleFake);
		const idle = new PlayerController({});
		await idle.settled();
		// Expected: idle state and zero engine loads without a src
		expect(idle.state).toBe("idle");
		expect(idleFake.loads.length).toBe(0);
		idle.dispose();
	});

	test("forwards control changes and reports values", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await controller.settled();
		// Expected: the fake engine controls list arrives as two controls
		expect(controller.controls.length).toBe(2);
		controller.setControl("gain", 0.25);
		// Expected: the engine receives gain 0.25 exactly once
		expect(fake.controlCalls.length).toBe(1);
		expect(fake.controlCalls[0]).toEqual({ id: "gain", value: 0.25 });
		// Expected: the controller remembers the last value 0.25
		expect(controller.getControlValue("gain")).toBe(0.25);
		controller.dispose();
		// Negative control: an unknown control is refused and never reaches the engine
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await second.settled();
		const callsBefore = fake2.controlCalls.length;
		const thrown = catchSync(() => second.setControl("bogus", 0.5));
		// Expected: a PlayerError is thrown for the unknown control
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("unknown-control");
		// Expected: the engine call count is unchanged after the refusal
		expect(fake2.controlCalls.length).toBe(callsBefore);
		second.dispose();
	});

	test("refuses non-finite control values without calling the engine", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await controller.settled();
		const thrown = catchSync(() => controller.setControl("gain", Number.NaN));
		// Expected: NaN is refused with invalid-control-value
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("invalid-control-value");
		// Expected: the engine receives zero control calls for NaN
		expect(fake.controlCalls.length).toBe(0);
		controller.dispose();
		// Negative control: a finite value for the same control is accepted
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await second.settled();
		second.setControl("gain", 0.75);
		// Expected: one engine call with gain 0.75 for the finite value
		expect(fake2.controlCalls.length).toBe(1);
		expect(fake2.controlCalls[0]).toEqual({ id: "gain", value: 0.75 });
		second.dispose();
	});

	test("forwards input, NAM and IR selections with the right descriptors", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			inputs: BLOG_INPUTS,
			nam: NAM_LIST,
			ir: IR_LIST,
		});
		await controller.settled();
		const seen: string[] = [];
		controller.on("selection", (selection) => {
			seen.push(`${selection.kind}:${selection.id ?? "none"}`);
		});
		// Expected: the engine was already handed the default (first) input when it loaded
		expect(fake.inputCalls.length).toBe(1);
		expect(fake.inputCalls[0]).toMatchObject({ kind: "wav", id: "di-guitar" });
		controller.selectInput("loop-a");
		// Expected: the engine then receives the loop-a wav descriptor
		expect(fake.inputCalls.length).toBe(2);
		expect(fake.inputCalls[1]).toEqual({
			kind: "wav",
			id: "loop-a",
			label: "Loop A",
			src: "https://cdn.example.com/loops/a.wav",
		});
		controller.selectNam("jcm800");
		// Expected: the engine receives the jcm800 NAM descriptor
		expect(fake.namCalls.length).toBe(1);
		expect(fake.namCalls[0]).toEqual({ id: "jcm800", label: "JCM800", src: "/models/jcm800.nam" });
		controller.selectNam(null);
		// Expected: clearing the NAM sends null as the second call
		expect(fake.namCalls.length).toBe(2);
		expect(fake.namCalls[1]).toBeNull();
		controller.selectIr("v30");
		// Expected: the engine receives the v30 IR descriptor
		expect(fake.irCalls.length).toBe(1);
		expect(fake.irCalls[0]).toEqual({ id: "v30", label: "Vintage 30", src: "/irs/v30.wav" });
		controller.selectIr(null);
		// Expected: clearing the IR sends null as the second call
		expect(fake.irCalls.length).toBe(2);
		expect(fake.irCalls[1]).toBeNull();
		// Expected: one selection event per change in call order
		expect(seen).toEqual([
			"input:loop-a",
			"nam:jcm800",
			"nam:none",
			"ir:v30",
			"ir:none",
		]);
		controller.dispose();
	});

	test("refuses unknown selection ids without calling the engine", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			inputs: BLOG_INPUTS,
			nam: NAM_LIST,
			ir: IR_LIST,
		});
		await controller.settled();
		let selections = 0;
		controller.on("selection", () => {
			selections += 1;
		});
		const badInput = catchSync(() => controller.selectInput("missing-input"));
		// Expected: unknown input refused with unknown-input
		expect(badInput).toBeInstanceOf(PlayerError);
		expect((badInput as PlayerError).reason).toBe("unknown-input");
		const badNam = catchSync(() => controller.selectNam("missing-nam"));
		// Expected: unknown NAM refused with unknown-nam
		expect(badNam).toBeInstanceOf(PlayerError);
		expect((badNam as PlayerError).reason).toBe("unknown-nam");
		const badIr = catchSync(() => controller.selectIr("missing-ir"));
		// Expected: unknown IR refused with unknown-ir
		expect(badIr).toBeInstanceOf(PlayerError);
		expect((badIr as PlayerError).reason).toBe("unknown-ir");
		// Expected: the refusals added no engine input call (the one call is the default hand-over)
		expect(fake.inputCalls.length).toBe(1);
		expect(fake.inputCalls[0]).toMatchObject({ id: "di-guitar" });
		expect(fake.namCalls.length).toBe(0);
		expect(fake.irCalls.length).toBe(0);
		// Expected: zero selection events after the three refusals
		expect(selections).toBe(0);
		controller.dispose();
		// Negative control: a known input id is accepted on the same controller shape
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			inputs: BLOG_INPUTS,
		});
		await second.settled();
		second.selectInput("di-guitar");
		// Expected: one engine input call for the known id
		expect(fake2.inputCalls.length).toBe(1);
		second.dispose();
	});

	test("always offers the browser-audio choice", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await controller.settled();
		const ids = controller.inputChoices.map((choice) => choice.id);
		// Expected: browser-audio is offered even with no blog inputs
		expect(ids).toEqual(["browser-audio"]);
		controller.selectInput("browser-audio");
		// Expected: the engine receives the browser descriptor with no src
		expect(fake.inputCalls.length).toBe(1);
		expect(fake.inputCalls[0]).toEqual({
			kind: "browser",
			id: "browser-audio",
			label: "Browser audio",
		});
		// Expected: the shared constant matches the offered choice
		expect(controller.selectedInput).toEqual(BROWSER_AUDIO_INPUT);
		controller.dispose();
		// Negative control: blog inputs append before browser-audio, never replacing it
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			inputs: BLOG_INPUTS,
		});
		await second.settled();
		const ids2 = second.inputChoices.map((choice) => choice.id);
		// Expected: both blog inputs plus the trailing browser-audio choice
		expect(ids2).toEqual(["di-guitar", "loop-a", "browser-audio"]);
		second.dispose();
	});

	test("applies default selections: first input, NAM off, IR off", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			inputs: BLOG_INPUTS,
			nam: NAM_LIST,
			ir: IR_LIST,
		});
		await controller.settled();
		// Expected: the first blog input is selected by default
		expect(controller.selectedInput.id).toBe("di-guitar");
		// Expected: NAM defaults to off (null)
		expect(controller.selectedNam).toBeNull();
		// Expected: IR defaults to off (null)
		expect(controller.selectedIr).toBeNull();
		controller.dispose();
		// Negative control: with no blog inputs the default is browser-audio
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await second.settled();
		// Expected: browser-audio is the default when the blog lists no inputs
		expect(second.selectedInput.id).toBe("browser-audio");
		second.dispose();
	});

	test("plays and pauses through the engine exactly once each", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await controller.settled();
		const states: string[] = [];
		controller.on("statechange", (state) => {
			states.push(state);
		});
		await controller.play();
		// Expected: playing after play with one engine start
		expect(controller.state).toBe("playing");
		expect(fake.starts).toBe(1);
		await controller.play();
		// Expected: a second play is a no-op with still one engine start
		expect(fake.starts).toBe(1);
		await controller.pause();
		// Expected: ready after pause with one engine stop
		expect(controller.state).toBe("ready");
		expect(fake.stops).toBe(1);
		await controller.pause();
		// Expected: a second pause is a no-op with still one engine stop
		expect(fake.stops).toBe(1);
		// Expected: state changes for play then pause in order
		expect(states).toEqual(["playing", "ready"]);
		controller.dispose();
	});

	test("refuses play before ready with a typed reason", async () => {
		const fake = new FakeEngine({ emitOnLoad: false });
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		// Expected: still loading because the fake never reports ready
		expect(controller.state).toBe("loading");
		const thrown = await catchAsync(() => controller.play());
		// Expected: play refused with not-ready while loading
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("not-ready");
		// Expected: the engine was asked to load but never started
		expect(fake.loads.length).toBe(1);
		expect(fake.starts).toBe(0);
		controller.dispose();
		// Negative control: the same play call succeeds once ready
		const readyFake = new FakeEngine();
		useEngine(readyFake);
		const ready = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await ready.settled();
		const noThrow = await catchAsync(() => ready.play());
		// Expected: null means no error was thrown when ready
		expect(noThrow).toBeNull();
		expect(ready.state).toBe("playing");
		ready.dispose();
	});

	test("falls back with no engine registered", async () => {
		setEngineFactory(null);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			fallbackUrl: "https://blog.example.com/render.mp3",
		});
		await controller.settled();
		// Expected: fallback state with the no-engine reason
		expect(controller.state).toBe("fallback");
		expect(controller.fallbackReason).toBe("no-engine");
		// Expected: the fallback URL is kept for the audio element
		expect(controller.fallbackUrl).toBe("https://blog.example.com/render.mp3");
		const thrown = await catchAsync(() => controller.play());
		// Expected: play refused with no-engine while in fallback
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("no-engine");
		controller.dispose();
		// Negative control: registering a factory avoids fallback for the same options
		const fake = new FakeEngine();
		useEngine(fake);
		const second = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await second.settled();
		// Expected: ready, not fallback, once an engine exists
		expect(second.state).toBe("ready");
		expect(second.fallbackReason).toBeNull();
		second.dispose();
	});

	test("falls back when the factory reports no-webassembly", async () => {
		const fake = new FakeEngine();
		setEngineFactory(() => ({ ok: false, reason: "no-webassembly" }));
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await controller.settled();
		// Expected: fallback state with the no-webassembly reason
		expect(controller.state).toBe("fallback");
		expect(controller.fallbackReason).toBe("no-webassembly");
		// Expected: the unused fake engine never loaded anything
		expect(fake.loads.length).toBe(0);
		const thrown = catchSync(() => controller.selectInput("browser-audio"));
		// Expected: selection refused with engine-unavailable and no engine call
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("engine-unavailable");
		expect(fake.inputCalls.length).toBe(0);
		controller.dispose();
		// Negative control: a working factory for the same src reaches ready
		useEngine(fake);
		const second = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await second.settled();
		// Expected: ready with one load once the factory supplies an engine
		expect(second.state).toBe("ready");
		expect(fake.loads.length).toBe(1);
		second.dispose();
	});

	test("surfaces engine load failures as typed errors", async () => {
		const fake = new FakeEngine();
		fake.throwOnLoad = new PlayerError("load-failed", "WASM refused program version 1.");
		useEngine(fake);
		const seen: string[] = [];
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		controller.on("error", (error) => {
			seen.push(error.reason);
		});
		await controller.settled();
		// Expected: error state after the load throw
		expect(controller.state).toBe("error");
		// Expected: the surfaced reason is load-failed as a whole value
		expect(controller.lastError?.reason).toBe("load-failed");
		// Expected: one error event carrying load-failed
		expect(seen).toEqual(["load-failed"]);
		controller.dispose();
		// Negative control: a mid-stream engine error event also surfaces typed
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await second.settled();
		// Expected: ready before the mid-stream error arrives
		expect(second.state).toBe("ready");
		fake2.fire("error", new PlayerError("engine-error", "Worklet underrun."));
		// Expected: error state with engine-error after the event
		expect(second.state).toBe("error");
		expect(second.lastError?.reason).toBe("engine-error");
		second.dispose();
	});

	test("dispose releases the engine and refuses later calls", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await controller.settled();
		controller.dispose();
		// Expected: the engine dispose runs exactly once
		expect(fake.disposes).toBe(1);
		controller.dispose();
		// Expected: a second dispose is a no-op with still one engine dispose
		expect(fake.disposes).toBe(1);
		const thrown = await catchAsync(() => controller.play());
		// Expected: calls after dispose refuse with disposed
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("disposed");
		// Negative control: an undisposed controller still plays fine
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({ src: "https://blog.example.com/pedal.vdsp" });
		await second.settled();
		await second.play();
		// Expected: playing with one engine start when not disposed
		expect(second.state).toBe("playing");
		expect(fake2.starts).toBe(1);
		second.dispose();
	});

	test("reloads through setSrc with a second engine load", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({ src: "https://blog.example.com/one.vdsp" });
		await controller.settled();
		// Expected: one load for the initial src
		expect(fake.loads.length).toBe(1);
		controller.setSrc("https://blog.example.com/two.vdsp");
		await controller.settled();
		// Expected: a second load carrying the new vdsp URL
		expect(fake.loads.length).toBe(2);
		expect(fake.loads[1]?.vdsp).toBe("https://blog.example.com/two.vdsp");
		// Expected: ready again after the reload
		expect(controller.state).toBe("ready");
		controller.dispose();
	});
});

describe("PlayerController setProgram", () => {
	test("a precompiled program reaches engine.load and skips the src", async () => {
		const seen: Array<{ vdsp: string; program?: unknown }> = [];
		const listeners = new Map<PlayerEngineEventName, Set<(payload?: unknown) => void>>();
		const fire = (event: PlayerEngineEventName, payload?: unknown): void => {
			for (const listener of [...(listeners.get(event) ?? [])]) {
				listener(payload);
			}
		};
		const recording: PlayerEngine = {
			load(source: { readonly vdsp: string; readonly program?: unknown }): void {
				seen.push({ vdsp: source.vdsp, program: source.program });
				fire("ready");
			},
			start(): void {},
			stop(): void {},
			setControl(_id: string, _value: number): void {},
			setInput(_choice: InputChoiceDescriptor): void {},
			setNam(_model: NamDescriptor | null): void {},
			setIr(_ir: IrDescriptor | null): void {},
			dispose(): void {},
			on(event: PlayerEngineEventName, listener: (payload?: unknown) => void): () => void {
				let set = listeners.get(event);
				if (set === undefined) {
					set = new Set();
					listeners.set(event, set);
				}
				set.add(listener);
				return () => {
					set?.delete(listener);
				};
			},
		};
		setEngineFactory(() => ({ ok: true, engine: recording }));
		const program = { formatVersion: 6, blocks: [] };
		const controller = new PlayerController({ src: null, program });
		await controller.settled();
		// Expected: one load carrying the program through
		expect(seen.length).toBe(1);
		expect(seen[0]?.program).toBe(program);
		// Expected: ready without any src
		expect(controller.state).toBe("ready");
		// A replacement program reloads with the new object
		const program2 = { formatVersion: 6, blocks: [], controls: [] };
		controller.setProgram(program2);
		await controller.settled();
		// Expected: a second load carrying the replacement
		expect(seen.length).toBe(2);
		expect(seen[1]?.program).toBe(program2);
		controller.dispose();
		// Negative control: clearing the program with no src idles
		setEngineFactory(() => ({ ok: true, engine: recording }));
		const second = new PlayerController({ src: null, program });
		await second.settled();
		second.setProgram(undefined);
		// Expected: idle with no src and no program
		expect(second.state).toBe("idle");
		second.dispose();
	});
});

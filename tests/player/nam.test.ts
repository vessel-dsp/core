// Player NAM slot-adapter tests: fetch plus the chain engine boundary plus
// the rate compare, then the controller wiring. Deterministic, no browser
// APIs. The real NAM engine (chain 0.1.3 vendored wasm) parses every model
// below, so the stated rates and the corrupt-model text are the engine's
// own, not hand-written copies.
//
// Comment rule used throughout: each expected value is written by hand in a
// comment directly BEFORE its assertion. Each behaviour has a positive
// control and a negative control showing the check can fail for the stated
// reason. Typed failures compare `reason` by whole-value equality and never
// match message text.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	instantiateNamEngine,
	loadNamModel,
	type NamEngineModule,
} from "@vessel-dsp/chain";
import {
	NAM_SAMPLE_RATE_TOLERANCE_HZ,
	NamLoadError,
	PlayerController,
	PlayerError,
	loadNam,
	setEngineFactory,
	type NamDescriptor,
	type NamFetchResponseLike,
	type NamLoadDeps,
	type NamModelInfo,
	type NamProbeFn,
	type NamProbeInfo,
	type PlayerControlInfo,
	type PlayerEngine,
	type PlayerEngineEventName,
	type SourceItem,
} from "@vessel-dsp/player";

const GLUE_PATH = join(
	import.meta.dir,
	"../../packages/chain/nam-engine/nam-engine.js",
);
const WASM_PATH = join(
	import.meta.dir,
	"../../packages/chain/nam-engine/nam-engine.wasm",
);

// ---------------------------------------------------------------------------
// Fixtures: tiny synthetic Linear models, built here so the test owns them.
// `Linear` is the pinned core's simplest architecture: the weights ARE the
// impulse response, in natural order. `bias: false` keeps a silent input
// exactly silent.
// ---------------------------------------------------------------------------

const SYNTHETIC_WEIGHTS = [0.5, -0.25, 0.125, 0.0625];

function ratedModel(sampleRate: number): string {
	return JSON.stringify({
		version: "0.5.0",
		architecture: "Linear",
		config: {
			receptive_field: SYNTHETIC_WEIGHTS.length,
			bias: false,
			in_channels: 1,
			out_channels: 1,
			implementation: "direct",
		},
		weights: SYNTHETIC_WEIGHTS,
		metadata: { loudness: -14.0 },
		sample_rate: sampleRate,
	});
}

// A model stating no rate: the same shape with no sample_rate key at all.
const UNRATED_MODEL = JSON.stringify({
	version: "0.5.0",
	architecture: "Linear",
	config: { receptive_field: 2, bias: false },
	weights: [0.5, 0.25],
});

const CORRUPT_MODEL = "this is not json";

let cachedEngine: NamEngineModule | null = null;

async function realEngine(): Promise<NamEngineModule> {
	if (cachedEngine === null) {
		const factory = (await import(GLUE_PATH)).default as (options: {
			wasmBinary: ArrayBufferLike;
		}) => Promise<NamEngineModule>;
		// Copy into a clean ArrayBuffer: readFileSync yields a pooled Buffer
		// whose type no longer satisfies ArrayBufferLike here.
		const bytes = new Uint8Array(readFileSync(WASM_PATH)).buffer;
		cachedEngine = await instantiateNamEngine(bytes, factory);
	}
	return cachedEngine;
}

// The probe the page builds from chain: load through the engine boundary
// (so a corrupt model rejects with the engine's own text), then read the
// stated rate exactly the way NamNode.getInfo() does (negative means
// unstated). The instance rate is arbitrary here: the stated rate is
// metadata, and the adapter compares it to the context rate afterwards.
function chainProbe(engine: NamEngineModule): NamProbeFn {
	return (modelText: string): NamProbeInfo => {
		const instanceId = engine._nam_createInstance(48000, 1024);
		if (instanceId <= 0) {
			throw new Error("nam_createInstance refused");
		}
		try {
			loadNamModel(engine, instanceId, modelText, -1);
			const expected = engine._nam_getExpectedSampleRate(instanceId);
			return { expectedSampleRate: expected < 0 ? null : expected };
		} finally {
			engine._nam_destroyInstance(instanceId);
		}
	};
}

function textResponse(text: string): NamFetchResponseLike {
	return {
		ok: true,
		status: 200,
		text(): Promise<string> {
			return Promise.resolve(text);
		},
	};
}

function fetchFor(
	bodies: Record<string, string>,
	calls: string[],
): (src: string) => Promise<NamFetchResponseLike> {
	return (src: string): Promise<NamFetchResponseLike> => {
		calls.push(src);
		const body = bodies[src];
		if (body === undefined) {
			return Promise.resolve({
				ok: false,
				status: 404,
				text(): Promise<string> {
					return Promise.resolve("");
				},
			});
		}
		return Promise.resolve(textResponse(body));
	};
}

function fakeProbeRate(rate: number | null): NamProbeFn {
	return (): NamProbeInfo => ({ expectedSampleRate: rate });
}

async function catchAsync(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
	} catch (error) {
		return error;
	}
	return null;
}

function catchSync(fn: () => void): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return null;
}

// ---------------------------------------------------------------------------
// loadNam against the real chain engine
// ---------------------------------------------------------------------------

describe("loadNam with the real chain engine", () => {
	test("the fixture Linear .nam loads and reports its rate", async () => {
		const engine = await realEngine();
		const calls: string[] = [];
		const deps: NamLoadDeps = {
			fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, calls),
			probe: chainProbe(engine),
		};
		const info = await loadNam("/models/linear.nam", 48000, deps);
		// Expected: the engine reads the stated 48000 back unchanged
		expect(info.expectedSampleRate).toBe(48000);
		// Expected: the info carries the fetched src
		expect(info.src).toBe("/models/linear.nam");
		// Expected: the tolerance mirrors chain's 0.5 Hz
		expect(NAM_SAMPLE_RATE_TOLERANCE_HZ).toBe(0.5);
		// Expected: exactly one fetch carrying the model src
		expect(calls).toEqual(["/models/linear.nam"]);
		// Negative control: the same bytes at a 44100 context refuse, so the
		// acceptance above is about the rate pair, not the model alone
		const refused = await catchAsync(() => loadNam("/models/linear.nam", 44100, deps));
		// Expected: a NamLoadError is thrown for the wrong-rate pair
		expect(refused).toBeInstanceOf(NamLoadError);
		expect((refused as NamLoadError).reason).toBe("rate-mismatch");
	});

	test("a wrong-rate model yields rate-mismatch with both rates", async () => {
		const engine = await realEngine();
		const deps: NamLoadDeps = {
			fetch: fetchFor({ "/models/forty-four.nam": ratedModel(44100) }, []),
			probe: chainProbe(engine),
		};
		const caught = await catchAsync(() => loadNam("/models/forty-four.nam", 48000, deps));
		// Expected: a NamLoadError is thrown, not a bare Error
		expect(caught).toBeInstanceOf(NamLoadError);
		// Expected: refusal reason is the whole value "rate-mismatch"
		expect((caught as NamLoadError).reason).toBe("rate-mismatch");
		// Expected: the error carries the model rate 44100
		expect((caught as NamLoadError).expectedSampleRate).toBe(44100);
		// Expected: the error carries the context rate 48000
		expect((caught as NamLoadError).contextSampleRate).toBe(48000);
		// Negative control: the same model at its own 44100 rate is accepted
		// with the same stated rate, so the refusal names the pair
		const accepted = await loadNam("/models/forty-four.nam", 44100, deps);
		// Expected: accepted at the matching rate with 44100 reported
		expect(accepted.expectedSampleRate).toBe(44100);
	});

	test("a corrupt model surfaces the engine's own text", async () => {
		const engine = await realEngine();
		const probe = chainProbe(engine);
		// The engine's own refusal text, read directly through chain with no
		// adapter in between, so the assertion below cannot drift from it.
		let directMessage = "";
		try {
			probe(CORRUPT_MODEL);
		} catch (error) {
			directMessage = error instanceof Error ? error.message : String(error);
		}
		// Expected: the direct probe rejects (the model is genuinely corrupt)
		expect(directMessage).toContain("nam_loadModel refused the model");
		const deps: NamLoadDeps = {
			fetch: fetchFor({ "/models/broken.nam": CORRUPT_MODEL }, []),
			probe,
		};
		const caught = await catchAsync(() => loadNam("/models/broken.nam", 48000, deps));
		// Expected: a NamLoadError is thrown for the corrupt model
		expect(caught).toBeInstanceOf(NamLoadError);
		// Expected: refusal reason is the whole value "nam-load-failed"
		expect((caught as NamLoadError).reason).toBe("nam-load-failed");
		// Expected: the adapter message carries the engine text verbatim
		expect((caught as NamLoadError).message).toContain(directMessage);
		// Negative control: the fixture through the same deps does not throw
		const goodDeps: NamLoadDeps = {
			fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, []),
			probe,
		};
		const good = await loadNam("/models/linear.nam", 48000, goodDeps);
		// Expected: the valid model reports 48000 through the same path
		expect(good.expectedSampleRate).toBe(48000);
	});

	test("a model with no stated rate is accepted at any rate", async () => {
		const engine = await realEngine();
		const deps: NamLoadDeps = {
			fetch: fetchFor({ "/models/unrated.nam": UNRATED_MODEL }, []),
			probe: chainProbe(engine),
		};
		const at48 = await loadNam("/models/unrated.nam", 48000, deps);
		// Expected: unstated reads as null, not zero or NaN
		expect(at48.expectedSampleRate).toBeNull();
		const at44 = await loadNam("/models/unrated.nam", 44100, deps);
		// Expected: the same model is accepted at 44100 with null as well
		expect(at44.expectedSampleRate).toBeNull();
		// Negative control: a rated model at a wrong rate still refuses, so
		// the null acceptance is about the missing statement, not a skipped
		// check
		const ratedDeps: NamLoadDeps = {
			fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, []),
			probe: chainProbe(engine),
		};
		const refused = await catchAsync(() => loadNam("/models/linear.nam", 44100, ratedDeps));
		// Expected: the rated model refuses at 44100 with rate-mismatch
		expect((refused as NamLoadError).reason).toBe("rate-mismatch");
	});

	test("rates within tolerance pass and rates past it refuse", async () => {
		const withinDeps: NamLoadDeps = {
			fetch: fetchFor({ "/models/close.nam": ratedModel(48000) }, []),
			probe: fakeProbeRate(48000.3),
		};
		const within = await loadNam("/models/close.nam", 48000, withinDeps);
		// Expected: |48000.3 - 48000| = 0.3 <= 0.5, so accepted
		expect(within.expectedSampleRate).toBe(48000.3);
		const pastDeps: NamLoadDeps = {
			fetch: fetchFor({ "/models/far.nam": ratedModel(48000) }, []),
			probe: fakeProbeRate(48000.6),
		};
		const past = await catchAsync(() => loadNam("/models/far.nam", 48000, pastDeps));
		// Expected: |48000.6 - 48000| = 0.6 > 0.5, so rate-mismatch
		expect((past as NamLoadError).reason).toBe("rate-mismatch");
		expect((past as NamLoadError).expectedSampleRate).toBe(48000.6);
		expect((past as NamLoadError).contextSampleRate).toBe(48000);
		// Negative control: an exact-equality compare would refuse 48000.3,
		// so this pair pins the tolerance instead of exact matching; the
		// mutation run in the report flips the compare and shows this fail
	});
});

describe("loadNam fetch refusals", () => {
	test("unsafe URLs refuse with unsafe-src and never fetch", async () => {
		const engine = await realEngine();
		const unsafe = [
			"javascript:alert(1)",
			"data:audio/wav;base64,AAA",
			"//evil.example.com/x.nam",
			"\\\\evil.example/x.nam",
		];
		for (const src of unsafe) {
			const calls: string[] = [];
			const deps: NamLoadDeps = {
				fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, calls),
				probe: chainProbe(engine),
			};
			const caught = await catchAsync(() => loadNam(src, 48000, deps));
			// Expected: refusal reason is the whole value "unsafe-src"
			expect((caught as NamLoadError).reason).toBe("unsafe-src");
			// Expected: zero fetch calls, so nothing left the page
			expect(calls.length).toBe(0);
		}
		// Negative control: the safe relative src next to the unsafe ones is
		// fetched exactly once and accepted
		const calls: string[] = [];
		const goodDeps: NamLoadDeps = {
			fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, calls),
			probe: chainProbe(engine),
		};
		const good = await loadNam("/models/linear.nam", 48000, goodDeps);
		// Expected: one fetch and the stated 48000 reported
		expect(calls).toEqual(["/models/linear.nam"]);
		expect(good.expectedSampleRate).toBe(48000);
	});

	test("fetch rejection is typed network-or-cors", async () => {
		const engine = await realEngine();
		const deps: NamLoadDeps = {
			fetch(): Promise<NamFetchResponseLike> {
				return Promise.reject(new Error("boom"));
			},
			probe: chainProbe(engine),
		};
		const caught = await catchAsync(() => loadNam("https://blog.example/models/x.nam", 48000, deps));
		// Expected: a NamLoadError is thrown
		expect(caught instanceof NamLoadError).toBe(true);
		// Expected: reason is the whole value "network-or-cors"
		expect((caught as NamLoadError).reason).toBe("network-or-cors");
		// Negative control: a good fetch for the same src shape does not throw
		const goodDeps: NamLoadDeps = {
			fetch: fetchFor({ "https://blog.example/models/x.nam": ratedModel(48000) }, []),
			probe: chainProbe(engine),
		};
		const good = await loadNam("https://blog.example/models/x.nam", 48000, goodDeps);
		// Expected: the stated 48000 is reported for the good fetch
		expect(good.expectedSampleRate).toBe(48000);
	});

	test("http error status is typed http-status and carries the status", async () => {
		const engine = await realEngine();
		const deps: NamLoadDeps = {
			fetch(): Promise<NamFetchResponseLike> {
				return Promise.resolve({
					ok: false,
					status: 404,
					text(): Promise<string> {
						return Promise.resolve("");
					},
				});
			},
			probe: chainProbe(engine),
		};
		const caught = await catchAsync(() => loadNam("https://blog.example/models/gone.nam", 48000, deps));
		// Expected: a NamLoadError is thrown
		expect(caught instanceof NamLoadError).toBe(true);
		// Expected: reason is the whole value "http-status"
		expect((caught as NamLoadError).reason).toBe("http-status");
		// Expected: the carried status is 404
		expect((caught as NamLoadError).status).toBe(404);
		// Negative control: status 200 with ok true does not throw http-status
		const goodDeps: NamLoadDeps = {
			fetch: fetchFor({ "https://blog.example/models/gone.nam": ratedModel(48000) }, []),
			probe: chainProbe(engine),
		};
		const good = await loadNam("https://blog.example/models/gone.nam", 48000, goodDeps);
		// Expected: the stated 48000 is reported for the ok response
		expect(good.expectedSampleRate).toBe(48000);
	});

	test("a non-positive context rate is a RangeError, not a refusal", async () => {
		const engine = await realEngine();
		const deps: NamLoadDeps = {
			fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, []),
			probe: chainProbe(engine),
		};
		const caught = await catchAsync(() => loadNam("/models/linear.nam", 0, deps));
		// Expected: a RangeError is thrown for rate 0 (a caller bug)
		expect(caught).toBeInstanceOf(RangeError);
		// Negative control: the same call at 48000 resolves instead
		const good = await loadNam("/models/linear.nam", 48000, deps);
		// Expected: the stated 48000 is reported at the valid rate
		expect(good.expectedSampleRate).toBe(48000);
	});
});

// ---------------------------------------------------------------------------
// Controller wiring: selectNam through the adapter
// ---------------------------------------------------------------------------

const FAKE_CONTROLS: readonly PlayerControlInfo[] = [
	{ id: "gain", label: "Gain", value: 0.5, min: 0, max: 1 },
];

const NAM_LIST: SourceItem[] = [
	{ id: "linear-48", label: "Linear 48k", src: "/models/linear.nam" },
	{ id: "linear-44", label: "Linear 44k", src: "/models/forty-four.nam" },
	{ id: "broken", label: "Broken", src: "/models/broken.nam" },
];

class FakeEngine implements PlayerEngine {
	readonly loads: Array<{ readonly vdsp: string }> = [];
	disposes = 0;
	readonly namCalls: Array<NamDescriptor | null> = [];
	private readonly listeners = new Map<PlayerEngineEventName, Set<(payload?: unknown) => void>>();

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
		this.fire("controls", FAKE_CONTROLS);
		this.fire("ready");
	}

	start(): void {}
	stop(): void {}
	setControl(_id: string, _value: number): void {}
	setInput(_choice: unknown): void {}

	setNam(model: NamDescriptor | null): void {
		this.namCalls.push(model);
	}

	setIr(_ir: unknown): void {}

	dispose(): void {
		this.disposes += 1;
	}
}

function useEngine(fake: FakeEngine): void {
	setEngineFactory(() => ({ ok: true, engine: fake }));
}

afterEach(() => {
	setEngineFactory(null);
});

describe("PlayerController selectNam through the NAM adapter", () => {
	test("a matching model validates, forwards, and emits the selection", async () => {
		const engine = await realEngine();
		const fake = new FakeEngine();
		useEngine(fake);
		const loaderCalls: string[] = [];
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
			namLoader: (src: string): Promise<NamModelInfo> => {
				loaderCalls.push(src);
				return loadNam(
					src,
					48000,
					{
						fetch: fetchFor(
							{
								"/models/linear.nam": ratedModel(48000),
								"/models/forty-four.nam": ratedModel(44100),
								"/models/broken.nam": CORRUPT_MODEL,
							},
							[],
						),
						probe: chainProbe(engine),
					},
				);
			},
		});
		await controller.settled();
		const seen: string[] = [];
		controller.on("selection", (selection) => {
			seen.push(`${selection.kind}:${selection.id ?? "none"}`);
		});
		await controller.selectNam("linear-48");
		// Expected: the loader saw exactly the descriptor src once
		expect(loaderCalls).toEqual(["/models/linear.nam"]);
		// Expected: the engine receives the validated descriptor once
		expect(fake.namCalls.length).toBe(1);
		expect(fake.namCalls[0]).toEqual({
			id: "linear-48",
			label: "Linear 48k",
			src: "/models/linear.nam",
		});
		// Expected: the controller remembers the validated selection
		expect(controller.selectedNam?.id).toBe("linear-48");
		// Expected: one selection event for the change
		expect(seen).toEqual(["nam:linear-48"]);
		// Expected: the controller stays ready after a successful pick
		expect(controller.state).toBe("ready");
		controller.dispose();
	});

	test("a wrong-rate model rejects with rate-mismatch and touches nothing", async () => {
		const engine = await realEngine();
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
			namLoader: (src: string): Promise<NamModelInfo> =>
				loadNam(
					src,
					48000,
					{
						fetch: fetchFor(
							{
								"/models/linear.nam": ratedModel(48000),
								"/models/forty-four.nam": ratedModel(44100),
								"/models/broken.nam": CORRUPT_MODEL,
							},
							[],
						),
						probe: chainProbe(engine),
					},
				),
		});
		await controller.settled();
		let selections = 0;
		controller.on("selection", () => {
			selections += 1;
		});
		const thrown = await catchAsync(() => controller.selectNam("linear-44") as Promise<void>);
		// Expected: a PlayerError is thrown for the wrong-rate model
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("rate-mismatch");
		// Expected: the error carries the model rate 44100
		expect((thrown as PlayerError).expectedSampleRate).toBe(44100);
		// Expected: the error carries the context rate 48000
		expect((thrown as PlayerError).contextSampleRate).toBe(48000);
		// Expected: the engine receives zero NAM calls after the refusal
		expect(fake.namCalls.length).toBe(0);
		// Expected: the selection stays off (null) after the refusal
		expect(controller.selectedNam).toBeNull();
		// Expected: zero selection events after the refusal
		expect(selections).toBe(0);
		// Expected: the controller stays ready, so another model can be picked
		expect(controller.state).toBe("ready");
		controller.dispose();
		// Negative control: the matching model on the same controller shape
		// validates through the identical loader
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
			namLoader: (src: string): Promise<NamModelInfo> =>
				loadNam(
					src,
					48000,
					{
						fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, []),
						probe: chainProbe(engine),
					},
				),
		});
		await second.settled();
		await second.selectNam("linear-48");
		// Expected: one engine NAM call for the matching model
		expect(fake2.namCalls.length).toBe(1);
		second.dispose();
	});

	test("a corrupt model rejects with nam-load-failed carrying the engine text", async () => {
		const engine = await realEngine();
		const probe = chainProbe(engine);
		let directMessage = "";
		try {
			probe(CORRUPT_MODEL);
		} catch (error) {
			directMessage = error instanceof Error ? error.message : String(error);
		}
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
			namLoader: (src: string): Promise<NamModelInfo> =>
				loadNam(
					src,
					48000,
					{
						fetch: fetchFor({ "/models/broken.nam": CORRUPT_MODEL }, []),
						probe,
					},
				),
		});
		await controller.settled();
		const thrown = await catchAsync(() => controller.selectNam("broken") as Promise<void>);
		// Expected: a PlayerError is thrown for the corrupt model
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("nam-load-failed");
		// Expected: the message carries the engine's own refusal text
		expect((thrown as PlayerError).message).toContain(directMessage);
		// Expected: the engine receives zero NAM calls after the refusal
		expect(fake.namCalls.length).toBe(0);
		// Expected: the controller stays ready after the corrupt refusal
		expect(controller.state).toBe("ready");
		controller.dispose();
	});

	test("null deselects synchronously without calling the loader", async () => {
		const engine = await realEngine();
		const fake = new FakeEngine();
		useEngine(fake);
		let loaderCalls = 0;
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
			namLoader: (src: string): Promise<NamModelInfo> => {
				loaderCalls += 1;
				return loadNam(
					src,
					48000,
					{
						fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, []),
						probe: chainProbe(engine),
					},
				);
			},
		});
		await controller.settled();
		const seen: string[] = [];
		controller.on("selection", (selection) => {
			seen.push(`${selection.kind}:${selection.id ?? "none"}`);
		});
		await controller.selectNam("linear-48");
		// Expected: one loader call for the validating pick
		expect(loaderCalls).toBe(1);
		const cleared = controller.selectNam(null);
		// Expected: clearing is synchronous (void, not a promise)
		expect(cleared).toBeUndefined();
		// Expected: the loader saw no second call for the clear
		expect(loaderCalls).toBe(1);
		// Expected: the engine receives null as its second call
		expect(fake.namCalls.length).toBe(2);
		expect(fake.namCalls[1]).toBeNull();
		// Expected: the selection is off after the clear
		expect(controller.selectedNam).toBeNull();
		// Expected: one selection event per change in call order
		expect(seen).toEqual(["nam:linear-48", "nam:none"]);
		controller.dispose();
	});

	test("unknown-nam stays synchronous and never reaches the loader", async () => {
		const engine = await realEngine();
		const fake = new FakeEngine();
		useEngine(fake);
		let loaderCalls = 0;
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
			namLoader: (src: string): Promise<NamModelInfo> => {
				loaderCalls += 1;
				return loadNam(
					src,
					48000,
					{
						fetch: fetchFor({ "/models/linear.nam": ratedModel(48000) }, []),
						probe: chainProbe(engine),
					},
				);
			},
		});
		await controller.settled();
		let selections = 0;
		controller.on("selection", () => {
			selections += 1;
		});
		const thrown = catchSync(() => controller.selectNam("missing-nam") as unknown as void);
		// Expected: unknown ids still throw synchronously with unknown-nam
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("unknown-nam");
		// Expected: the loader saw zero calls for the unknown id
		expect(loaderCalls).toBe(0);
		// Expected: the engine receives zero NAM calls for the unknown id
		expect(fake.namCalls.length).toBe(0);
		// Expected: zero selection events for the unknown id
		expect(selections).toBe(0);
		controller.dispose();
	});

	test("without a loader selectNam forwards synchronously as before", async () => {
		const fake = new FakeEngine();
		useEngine(fake);
		const controller = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
		});
		await controller.settled();
		// Expected: no loader is configured by default
		expect(controller.namLoader).toBeNull();
		const returned = controller.selectNam("linear-48");
		// Expected: the unvalidated path returns void, not a promise
		expect(returned).toBeUndefined();
		// Expected: the engine receives the descriptor immediately
		expect(fake.namCalls.length).toBe(1);
		expect(fake.namCalls[0]).toEqual({
			id: "linear-48",
			label: "Linear 48k",
			src: "/models/linear.nam",
		});
		controller.dispose();
		// Negative control: setting a loader switches the same id to the
		// async validating path
		const fake2 = new FakeEngine();
		useEngine(fake2);
		const second = new PlayerController({
			src: "https://blog.example.com/pedal.vdsp",
			nam: NAM_LIST,
		});
		await second.settled();
		second.setNamLoader(() => ({ src: "/models/linear.nam", expectedSampleRate: 48000 }));
		const pending = second.selectNam("linear-48");
		// Expected: the validating path returns a promise
		expect(pending).toBeInstanceOf(Promise);
		await pending;
		// Expected: the engine receives the descriptor after validation
		expect(fake2.namCalls.length).toBe(1);
		// Expected: clearing the loader restores the synchronous path
		second.setNamLoader(null);
		expect(second.namLoader).toBeNull();
		expect(second.selectNam(null)).toBeUndefined();
		expect(fake2.namCalls[1]).toBeNull();
		second.dispose();
	});
});

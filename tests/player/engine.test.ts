// Real-engine unit tests: the state machine behind the PlayerEngine seam
// with a fake AudioContext, fake worklet port, and fake fetch. Deterministic
// (no network, no browser, no wasm): every expected value is written by hand
// in a comment directly BEFORE its assertion, and every behaviour has a
// positive case plus a negative control. Typed failures compare `reason` by
// whole-value equality and never match message text.
//
// The lazy-until-gesture rule ("no AudioContext and no audio-asset fetch
// before start()") has a mutation control at the end: the test fails when
// the gated fetch moves earlier. The mutation run is recorded in the W3
// report, not re-run here.

import { ADMISSION_CPU_FRACTION } from "../../packages/player/src/engine/player-engine";
import { afterEach, describe, expect, test } from "bun:test";
import { resistorDivider } from "@vessel-dsp/compiler/fixtures/circuits";
import type { Program } from "@vessel-dsp/compiler";
import {
	PlayerError,
	setEngineFactory,
	getEngineFactory,
	type PlayerControlInfo,
	type PlayerEngineEventName,
} from "@vessel-dsp/player";
import {
	RealPlayerEngine,
	registerPlayerEngine,
	type RealPlayerEngineOptions,
} from "@vessel-dsp/player/engine";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type PostedMessage = { readonly type: string; [key: string]: unknown };

class FakePort {
	readonly posted: PostedMessage[] = [];
	onmessage: ((event: { data: PostedMessage }) => void) | null = null;

	postMessage(message: PostedMessage): void {
		this.posted.push(message);
	}

	fire(message: PostedMessage): void {
		this.onmessage?.({ data: message });
	}
}

class FakeNode {
	readonly connected: unknown[] = [];
	constructor(readonly port: FakePort) {}

	connect(destination: unknown): void {
		this.connected.push(destination);
	}
}

type FakeGainParam = {
	value: number;
	setCalls: Array<{ value: number; time: number }>;
	setValueAtTime(value: number, time: number): void;
};

type FakeGain = {
	gain: FakeGainParam;
	connect(destination: unknown): void;
};

type FakeSource = {
	startCalls: number;
	stopCalls: number;
	disconnectCalls: number;
	buffer: unknown;
	loop: boolean;
	connect(destination: unknown): void;
	start(when: number): void;
	stop(): void;
	disconnect(): void;
};

function fakeSource(): FakeSource {
	return {
		startCalls: 0,
		stopCalls: 0,
		disconnectCalls: 0,
		buffer: null,
		loop: false,
		connect(_destination: unknown): void {},
		start(_when: number): void {
			this.startCalls += 1;
		},
		stop(): void {
			this.stopCalls += 1;
		},
		disconnect(): void {
			this.disconnectCalls += 1;
		},
	};
}

class FakeContext {
	static created = 0;
	static requestedRates: Array<number | undefined> = [];

	readonly sampleRate: number;
	readonly addedModules: string[] = [];
	readonly sources: FakeSource[] = [];
	resumes = 0;
	suspends = 0;
	closes = 0;
	readonly destination = {};
	readonly currentTime = 0;
	lastGain: FakeGain | null = null;
	lastAnalyser: { fftSize: number; connected: unknown[] } | null = null;
	readonly createdBuffers: Array<{ channels: number; length: number; rate: number; data: Float32Array[] }> = [];

	constructor(options?: { readonly sampleRate?: number }) {
		FakeContext.created += 1;
		this.sampleRate = options?.sampleRate ?? 48000;
	}

	readonly audioWorklet = {
		addModule: (url: string): Promise<void> => {
			this.addedModules.push(url);
			return Promise.resolve();
		},
	};

	createGain(): FakeGain {
		const param: FakeGainParam = {
			value: 0,
			setCalls: [],
			setValueAtTime(value: number, time: number): void {
				this.value = value;
				this.setCalls.push({ value, time });
			},
		};
		const gain: FakeGain = {
			gain: param,
			connect(_destination: unknown): void {},
		};
		this.lastGain = gain;
		return gain;
	}

	createAnalyser(): { fftSize: number; connected: unknown[]; connect(destination: unknown): void } {
		const analyser = {
			fftSize: 0,
			connected: [] as unknown[],
			connect(destination: unknown): void {
				this.connected.push(destination);
			},
		};
		this.lastAnalyser = analyser;
		return analyser;
	}

	createBuffer(channels: number, length: number, rate: number): {
		getChannelData(channel: number): Float32Array;
		length: number;
	} {
		const data = [new Float32Array(Math.max(1, length))];
		this.createdBuffers.push({ channels, length, rate, data });
		return {
			getChannelData(_channel: number): Float32Array {
				return data[0] as Float32Array;
			},
			length,
		};
	}

	createBufferSource(): FakeSource {
		const source = fakeSource();
		this.sources.push(source);
		return source;
	}

	createMediaStreamSource(_stream: unknown): { connect(destination: unknown): void } {
		return { connect(_destination: unknown): void {} };
	}

	decodeAudioData(_data: ArrayBuffer): Promise<never> {
		return Promise.reject(new Error("use the injected decoder"));
	}

	resume(): Promise<void> {
		this.resumes += 1;
		return Promise.resolve();
	}

	suspend(): Promise<void> {
		this.suspends += 1;
		return Promise.resolve();
	}

	close(): Promise<void> {
		this.closes += 1;
		return Promise.resolve();
	}
}

type FakeResponse = {
	readonly ok: boolean;
	readonly status: number;
	readonly bytes: ArrayBuffer;
	readonly textBody: string;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
};

function fakeResponse(ok: boolean, body: string | ArrayBuffer, status = 200): FakeResponse {
	const bytes = typeof body === "string" ? new TextEncoder().encode(body).buffer as ArrayBuffer : body;
	return {
		ok,
		status,
		bytes,
		textBody: typeof body === "string" ? body : "",
		arrayBuffer(): Promise<ArrayBuffer> {
			return Promise.resolve(bytes);
		},
		text(): Promise<string> {
			return Promise.resolve(typeof body === "string" ? body : "");
		},
	};
}

function decodedMono(length: number, rate: number, fill: number): {
	sampleRate: number;
	length: number;
	numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
} {
	const data = new Float32Array(length).fill(fill);
	return {
		sampleRate: rate,
		length,
		numberOfChannels: 1,
		getChannelData(_channel: number): Float32Array {
			return data;
		},
	};
}

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;

function stubProgram(): Program {
	return {
		formatVersion: 6,
		blocks: [],
		controls: [{ id: "Gain", taper: "linear", defaultPosition: 0.5, label: "Gain" }],
		costPredictors: {
			solvedBlocks: [{ blockId: "b0", unknownCount: 2, linear: true }],
			macroBlocks: [],
		},
	} as unknown as Program;
}

function heavyProgram(): Program {
	return {
		formatVersion: 6,
		blocks: [],
		controls: [],
		costPredictors: {
			solvedBlocks: Array.from({ length: 40 }, (_, index) => ({
				blockId: `b${index}`,
				unknownCount: 64,
				linear: false,
			})),
			macroBlocks: [],
		},
	} as unknown as Program;
}

type Harness = {
	engine: RealPlayerEngine;
	fetchLog: string[];
	ports: FakePort[];
	nodes: FakeNode[];
	contexts: FakeContext[];
	events: Array<{ event: PlayerEngineEventName; payload?: unknown }>;
};

function makeEngine(
	bodies: Record<string, string | ArrayBuffer>,
	options?: Partial<RealPlayerEngineOptions> & { contextRate?: number; deviceOnlyRate?: number },
): Harness {
	const fetchLog: string[] = [];
	const ports: FakePort[] = [];
	const nodes: FakeNode[] = [];
	const contexts: FakeContext[] = [];
	const events: Array<{ event: PlayerEngineEventName; payload?: unknown }> = [];
	const engine = new RealPlayerEngine({
		fetch: (src: string) => {
			fetchLog.push(src);
			const body = bodies[src];
			if (body === undefined) {
				return Promise.resolve(fakeResponse(false, "", 404));
			}
			return Promise.resolve(fakeResponse(true, body));
		},
		createAudioContext: (opts) => {
			const requested = opts.sampleRate;
			FakeContext.requestedRates.push(requested);
			if (
				requested !== undefined &&
				options?.deviceOnlyRate !== undefined &&
				requested !== options.deviceOnlyRate
			) {
				throw new Error(`device refused ${String(requested)}`);
			}
			const context = new FakeContext({
				sampleRate: requested ?? options?.deviceOnlyRate ?? options?.contextRate ?? 48000,
			});
			contexts.push(context);
			return context as unknown as AudioContext;
		},
		createWorkletNode: (context, _name) => {
			const port = new FakePort();
			ports.push(port);
			const node = new FakeNode(port);
			nodes.push(node);
			void context;
			return node as unknown as AudioWorkletNode;
		},
		decodeAudioData: () => Promise.resolve(decodedMono(256, 48000, 0.1) as unknown as AudioBuffer),
		namGlueUrl: "test://nam-glue",
		...options,
	});
	for (const name of ["ready", "controls", "error", "telemetry"] as const) {
		engine.on(name, (payload?: unknown) => {
			events.push({ event: name, payload });
		});
	}
	return { engine, fetchLog, ports, nodes, contexts, events };
}

function lastPosted(ports: FakePort[], type: string): PostedMessage {
	const found = [...ports.flatMap((port) => port.posted)].filter((message) => message.type === type);
	return found[found.length - 1] as PostedMessage;
}

// Start the engine and answer its worklet load once the fake port exists.
// Firing synchronously after start() would no-op: start() is async and the
// port is created several awaits in (calibration, wasm fetch, addModule).
async function replyOnceLoaded(harness: Harness, reply: PostedMessage): Promise<void> {
	for (let waited = 0; waited < 2000 && harness.ports.length === 0; waited += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	if (harness.ports.length === 0) {
		throw new Error("the engine never created a worklet port");
	}
	harness.ports[0]?.fire(reply);
}

async function startAndReply(harness: Harness, reply: PostedMessage): Promise<void> {
	const pending = Promise.resolve(harness.engine.start());
	await replyOnceLoaded(harness, reply);
	await pending;
}

function loadedReply(
	controls: Array<{ slot: number; id: string }>,
	measuredNsPerSample: number | null = null,
): PostedMessage {
	// The worklet times the program on the shipped console and rides the
	// figure back on `loaded`; null means nothing was measured and the
	// static verdict decides (fail closed).
	return {
		type: "loaded",
		controls,
		supplyGroundConflicts: [],
		chainAdvisories: [],
		measuredNsPerSample,
		programSchedule: [],
	};
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

afterEach(() => {
	setEngineFactory(null);
	FakeContext.created = 0;
	FakeContext.requestedRates = [];
});

// ---------------------------------------------------------------------------
// Lazy until gesture
// ---------------------------------------------------------------------------

describe("lazy until gesture", () => {
	test("construction plus load creates no context and fetches no audio assets", async () => {
		const harness = makeEngine({ "/circuit.vdsp": resistorDivider }, { program: stubProgram() });
		// Expected: constructing the engine touches nothing observable
		expect(harness.fetchLog).toEqual([]);
		expect(FakeContext.created).toBe(0);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		// Expected: load resolves with zero fetches (precompiled program skips it)
		expect(harness.fetchLog).toEqual([]);
		// Expected: still zero contexts after load (ready precedes the gesture)
		expect(FakeContext.created).toBe(0);
		// Expected: ready fired exactly once from load
		expect(harness.events.filter((entry) => entry.event === "ready").length).toBe(1);
		harness.engine.dispose();
		// Negative control: start() is what creates the context and fetches,
		// so the zeros above are about load, not about a dead engine
		const running = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM, "/stim.wav": new ArrayBuffer(16) },
			{
				program: stubProgram(),
				inputs: [{ id: "stim", label: "Stim", src: "/stim.wav" }],
				dspWasmUrl: "/dsp.wasm",
				workletUrl: "/player-worklet.js",
			},
		);
		await running.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(running.engine.start());
		// Expected: the context is created at start, requesting 48000 first
		expect(FakeContext.created).toBe(1);
		expect(FakeContext.requestedRates).toEqual([48000]);
		await replyOnceLoaded(running, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		// Expected: the dsp wasm bytes were fetched at start, never before
		expect(running.fetchLog.includes("/dsp.wasm")).toBe(true);
		running.engine.dispose();
	});

	test("fetching the circuit text at load does not fetch wasm or the worklet", async () => {
		const harness = makeEngine({ "/circuit.vdsp": resistorDivider });
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		// Expected: exactly one fetch carrying the circuit URL
		expect(harness.fetchLog).toEqual(["/circuit.vdsp"]);
		// Expected: zero contexts from a text-only load
		expect(FakeContext.created).toBe(0);
		// Expected: ready fired, so the text fetch produced a usable program
		expect(harness.events.some((entry) => entry.event === "ready")).toBe(true);
		harness.engine.dispose();
	});

	test("a 44100-only device runs at the device rate after refusing 48000", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js", deviceOnlyRate: 44100 },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		// Expected: the first request names 48000 (the preferred rate)
		expect(FakeContext.requestedRates[0]).toBe(48000);
		await replyOnceLoaded(harness, loadedReply([]));
		await pending;
		// Expected: the engine kept the device-rate context (44100)
		expect(harness.engine.getContextSampleRate()).toBe(44100);
		harness.engine.dispose();
	});
});

// ---------------------------------------------------------------------------
// Load message shape through postV2WorkletMessage
// ---------------------------------------------------------------------------

describe("worklet load message", () => {
	test("start posts one load with the program slot plus wasm bytes", async () => {
		const program = stubProgram();
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program, dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		const load = lastPosted(harness.ports, "load");
		// Expected: slot 0 is the program in effect bypass mode
		const slots = load.slots as Array<{ kind: string; bypassMode?: string }>;
		expect(slots.length).toBe(1);
		expect(slots[0]).toMatchObject({ kind: "program", bypassMode: "effect" });
		// Expected: the wasm console bytes ride the load message
		expect((load.wasmConsole as { wasmBytes: ArrayBuffer }).wasmBytes.byteLength).toBe(8);
		// Expected: the worklet module URL is the configured one
		expect(harness.contexts[0]?.addedModules).toEqual(["/player-worklet.js"]);
		harness.engine.dispose();
	});

	test("controls from the loaded reply reach the controller seam", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		// Expected: the last controls event carries Gain at 0.5 in [0,1]
		const controlsEvents = harness.events.filter((entry) => entry.event === "controls");
		const last = controlsEvents[controlsEvents.length - 1]?.payload as PlayerControlInfo[];
		expect(last).toEqual([{ id: "Gain", label: "Gain", value: 0.5, min: 0, max: 1 }]);
		harness.engine.dispose();
	});

	test("a worklet refusal during start rejects with the refusal text", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, { type: "error", message: "unsupported program format version 1" });
		const thrown = await catchAsync(() => pending);
		// Expected: a PlayerError is thrown for the worklet refusal
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("load-failed");
		// Expected: the message carries the worklet text verbatim
		expect((thrown as PlayerError).message).toContain("unsupported program format version 1");
		harness.engine.dispose();
	});
});

// ---------------------------------------------------------------------------
// Control forwarding, bypass, input gain
// ---------------------------------------------------------------------------

describe("controls and extras", () => {
	test("setControl posts a 0..1 setControl for slot 0, stashed until loaded", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		// Before audio runs the value is stashed, posting nothing yet
		harness.engine.setControl("Gain", 0.25);
		expect(harness.ports.length).toBe(0);
		const pending = harness.engine.start();
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		const forwarded = harness.ports[0]?.posted.filter((message) => message.type === "setControl");
		// Expected: exactly one setControl carrying slot 0, Gain, 0.25
		expect(forwarded).toEqual([{ type: "setControl", slot: 0, id: "Gain", position: 0.25 }]);
		// A live change posts immediately with the same shape
		harness.engine.setControl("Gain", 0.75);
		expect(harness.ports[0]?.posted.filter((message) => message.type === "setControl").length).toBe(2);
		harness.engine.dispose();
		// Negative control: an unknown id throws unknown-control and posts nothing
		const second = makeEngine({}, { program: stubProgram() });
		await second.engine.load({ vdsp: "/circuit.vdsp" });
		const thrown = catchSync(() => second.engine.setControl("Nope", 0.5));
		// Expected: unknown ids throw with reason unknown-control
		expect((thrown as PlayerError).reason).toBe("unknown-control");
		second.engine.dispose();
	});

	test("setBypassMode and setInputGainDb drive the graph when audio runs", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js", inputGainDb: -6 },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		harness.engine.setBypassMode("wire");
		// Expected: the bypass post names slot 0 and wire
		expect(lastPosted(harness.ports, "setBypassMode")).toEqual({
			type: "setBypassMode",
			slot: 0,
			mode: "wire",
		});
		harness.engine.setInputGainDb(3);
		// Expected: the gain node was set to 10^(3/20)
		const setCalls = harness.contexts[0]?.lastGain?.gain.setCalls ?? [];
		expect(setCalls.length).toBe(1);
		expect(setCalls[0]?.value).toBeCloseTo(10 ** (3 / 20), 10);
		harness.engine.dispose();
	});
});

// ---------------------------------------------------------------------------
// Refusal paths
// ---------------------------------------------------------------------------

describe("refusals", () => {
	test("an uncompilable circuit refuses at load with load-failed", async () => {
		const harness = makeEngine({ "/bad.vdsp": "not a circuit" });
		const thrown = await catchAsync(() => Promise.resolve(harness.engine.load({ vdsp: "/bad.vdsp" })));
		// Expected: a PlayerError is thrown for the bad circuit
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("load-failed");
		// Expected: no context was created for a refused circuit
		expect(FakeContext.created).toBe(0);
		harness.engine.dispose();
	});

	test("non-wasm dsp bytes refuse with load-failed before touching the worklet", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": "this is a proxy error page" },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const thrown = await catchAsync(() => Promise.resolve(harness.engine.start()));
		// Expected: a PlayerError is thrown for the bogus bytes
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("load-failed");
		// Expected: the message names the binary problem
		expect((thrown as PlayerError).message).toContain("not a WebAssembly binary");
		// Expected: the worklet was never created for bogus bytes
		expect(harness.ports.length).toBe(0);
		harness.engine.dispose();
	});

	test("a heavy program refuses at start with admission-refused, never glitching", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: heavyProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		// The load IS posted before the refusal: the decisive cost can only
		// be measured inside the worklet, so the gate decides after `loaded`
		// (null measurement here, so the static verdict decides). The old
		// zero-load-posts expectation encoded the main-thread probe.
		await replyOnceLoaded(harness, loadedReply([], null));
		const thrown = await catchAsync(() => pending);
		// Expected: a PlayerError is thrown for the too-heavy program
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("admission-refused");
		// Expected: never glitching -- no input source started, the context
		// never resumed, and the failed start closed the context
		expect(harness.contexts[0]?.sources.length).toBe(0);
		expect(harness.contexts[0]?.resumes).toBe(0);
		expect(harness.contexts[0]?.closes).toBe(1);
		harness.engine.dispose();
	});

	test("a worklet measurement that fits overrules a refusing static model", async () => {
		// Pins the §7 policy: measured cost wins over the static model
		// (a heavy program: tens of us predicted against 4 us measured).
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: heavyProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		// Expected: 4000 ns fits inside the 5208 ns budget at 48 kHz, so
		// start resolves despite the static model refusing this program
		await replyOnceLoaded(harness, loadedReply([], 4000));
		await pending;
		expect(harness.contexts[0]?.resumes).toBe(1);
		harness.engine.dispose();
	});

	test("a chain that costs a third of a period is refused, headroom is policy", async () => {
		// 7800 ns is 37% of a 48 kHz period: the measured case where a heavy pedal overran in the
		// browser. The admission share is 25%, so this is refused naming the 5208 ns allowance.
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }], 7800));
		const thrown = await catchAsync(() => pending);
		expect((thrown as PlayerError).reason).toBe("admission-refused");
		expect((thrown as PlayerError).message).toContain("5208 ns/sample");
		expect(ADMISSION_CPU_FRACTION).toBe(0.25);
	});

	test("a worklet measurement over budget refuses naming the numbers", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }], 50_000));
		const thrown = await catchAsync(() => pending);
		// Expected: admission-refused for the measured overrun
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("admission-refused");
		// Expected: the message names the measured figure and the budget
		// (50000 ns measured against 5208 ns at 48 kHz)
		expect((thrown as PlayerError).message).toContain("measured 50000 ns");
		expect((thrown as PlayerError).message).toContain("5208 ns/sample");
		// Negative control: a fitting measurement on the same program plays
		const fitting = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await fitting.engine.load({ vdsp: "/circuit.vdsp" });
		const pendingFit = Promise.resolve(fitting.engine.start());
		await replyOnceLoaded(fitting, loadedReply([{ slot: 0, id: "Gain" }], 1500));
		await pendingFit;
		// Expected: the fitting start resumed the context exactly once
		expect(fitting.contexts[0]?.resumes).toBe(1);
		harness.engine.dispose();
		fitting.engine.dispose();
	});

	test("a selection rebuild reuses the start-time measurement without re-measuring", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }], 1500));
		await pending;
		const loads = (): PostedMessage[] =>
			harness.ports.flatMap((port) => port.posted).filter((message) => message.type === "load");
		// Expected: the start-time load asked the worklet to measure
		expect(loads().length).toBe(1);
		expect((loads()[0] as Record<string, unknown>).playerMeasureProgram).toBe(true);
		// A no-op selection change rebuilds the chain through the same program
		harness.engine.setNam(null);
		for (let waited = 0; waited < 2000 && loads().length < 2; waited += 1) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		// Expected: the rebuild posted a second load that skips the
		// audio-thread measurement (it would itself be a dropout)...
		expect(loads().length).toBe(2);
		expect((loads()[1] as Record<string, unknown>).playerMeasureProgram).toBe(false);
		harness.ports[0]?.fire(loadedReply([{ slot: 0, id: "Gain" }], null));
		await new Promise((resolve) => setTimeout(resolve, 10));
		// ...and the cached 1500 ns re-gated cleanly: no error event, still playing
		expect(harness.events.some((entry) => entry.event === "error")).toBe(false);
		harness.engine.dispose();
	});

	test("a wrong-rate NAM refuses at start with rate-mismatch carrying both rates", async () => {
		const harness = makeEngine(
			{
				"/lead.nam": JSON.stringify({ version: "x" }),
				"/nam-engine.wasm": MINIMAL_WASM,
				"/dsp.wasm": MINIMAL_WASM,
			},
			{
				program: stubProgram(),
				dspWasmUrl: "/dsp.wasm",
				workletUrl: "/player-worklet.js",
				namWasmUrl: "/nam-engine.wasm",
				probeNam: () => ({ expectedSampleRate: 44100 }),
			},
		);
		harness.engine.setNam({ id: "lead", label: "Lead", src: "/lead.nam" });
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const thrown = await catchAsync(() => Promise.resolve(harness.engine.start()));
		// Expected: a PlayerError is thrown for the wrong-rate NAM
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("rate-mismatch");
		// Expected: the error carries the model rate 44100
		expect((thrown as PlayerError).expectedSampleRate).toBe(44100);
		// Expected: the error carries the context rate 48000
		expect((thrown as PlayerError).contextSampleRate).toBe(48000);
		harness.engine.dispose();
		// Negative control: the same NAM at its own rate is accepted into slots
		const matching = makeEngine(
			{
				"/lead.nam": JSON.stringify({ version: "x" }),
				"/nam-engine.wasm": MINIMAL_WASM,
				"/dsp.wasm": MINIMAL_WASM,
			},
			{
				program: stubProgram(),
				dspWasmUrl: "/dsp.wasm",
				workletUrl: "/player-worklet.js",
				namWasmUrl: "/nam-engine.wasm",
				probeNam: () => ({ expectedSampleRate: 48000 }),
			},
		);
		matching.engine.setNam({ id: "lead", label: "Lead", src: "/lead.nam" });
		await matching.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(matching.engine.start());
		await replyOnceLoaded(matching, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		const slots = (lastPosted(matching.ports, "load").slots ?? []) as Array<{ kind: string }>;
		// Expected: program plus one nam slot in order
		expect(slots.map((slot) => slot.kind)).toEqual(["program", "nam"]);
		matching.engine.dispose();
	});

	test("an undecodable IR refuses at start with load-failed", async () => {
		const harness = makeEngine(
			{ "/room.wav": new ArrayBuffer(16), "/dsp.wasm": MINIMAL_WASM },
			{
				program: stubProgram(),
				dspWasmUrl: "/dsp.wasm",
				workletUrl: "/player-worklet.js",
				decodeAudioData: () =>
					Promise.resolve({ sampleRate: 0, length: 0, numberOfChannels: 0, getChannelData: () => new Float32Array(0) } as unknown as AudioBuffer),
			},
		);
		harness.engine.setIr({ id: "room", label: "Room", src: "/room.wav" });
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const thrown = await catchAsync(() => Promise.resolve(harness.engine.start()));
		// Expected: a PlayerError is thrown for the bad IR
		expect(thrown).toBeInstanceOf(PlayerError);
		expect((thrown as PlayerError).reason).toBe("load-failed");
		harness.engine.dispose();
	});
});

// ---------------------------------------------------------------------------
// Telemetry and dispose
// ---------------------------------------------------------------------------

describe("telemetry and dispose", () => {
	test("worklet telemetry passes through the opaque seam", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		harness.ports[0]?.fire({
			type: "telemetry",
			cpuLoadPercent: 3.5,
			overrunCount: 0,
			cpuPeakPercent: 9,
			cpuSessionPeakPercent: 12,
		});
		const telemetryEvents = harness.events.filter((entry) => entry.event === "telemetry");
		// Expected: one telemetry event carrying cpuLoad 3.5 and overruns 0
		expect(telemetryEvents.length).toBe(1);
		expect(telemetryEvents[0]?.payload).toEqual({ cpuLoad: 3.5, overruns: 0, cpuPeak: 9, cpuSessionPeak: 12 });
		harness.engine.dispose();
	});

	test("dispose closes the context once and poisons later calls", async () => {
		const harness = makeEngine(
			{ "/dsp.wasm": MINIMAL_WASM },
			{ program: stubProgram(), dspWasmUrl: "/dsp.wasm", workletUrl: "/player-worklet.js" },
		);
		await harness.engine.load({ vdsp: "/circuit.vdsp" });
		const pending = Promise.resolve(harness.engine.start());
		await replyOnceLoaded(harness, loadedReply([{ slot: 0, id: "Gain" }]));
		await pending;
		harness.engine.dispose();
		// Expected: the context was closed exactly once
		expect(harness.contexts[0]?.closes).toBe(1);
		harness.engine.dispose();
		// Expected: still exactly one close after a second dispose
		expect(harness.contexts[0]?.closes).toBe(1);
		const thrown = catchSync(() => harness.engine.setControl("Gain", 0.5));
		// Expected: calls after dispose throw with reason disposed
		expect((thrown as PlayerError).reason).toBe("disposed");
	});
});

// ---------------------------------------------------------------------------
// Registration and barrel isolation
// ---------------------------------------------------------------------------

describe("registration", () => {
	test("registerPlayerEngine publishes a lazy factory with capability refusals", () => {
		// Bun has WebAssembly but no AudioContext: the factory refuses the
		// second capability while staying constructible.
		registerPlayerEngine({});
		const factory = getEngineFactory();
		// Expected: a factory is registered
		expect(factory).not.toBeNull();
		const result = factory?.();
		// Expected: the refusal names the missing AudioWorklet capability
		expect(result).toEqual({ ok: false, reason: "no-audioworklet" });
		setEngineFactory(null);
		// Negative control: with a stubbed AudioContext the same call succeeds
		const globals = globalThis as Record<string, unknown>;
		const saved = globals.AudioContext;
		const savedNode = globals.AudioWorkletNode;
		globals.AudioContext = class {};
		// An AudioContext without AudioWorkletNode (a browser that predates worklets) is refused too:
		// it would otherwise reach `ready` and fail at the first play instead of using the fallback.
		registerPlayerEngine({});
		expect(getEngineFactory()?.()).toEqual({ ok: false, reason: "no-audioworklet" });
		setEngineFactory(null);
		globals.AudioWorkletNode = class {};
		try {
			let seen: unknown = null;
			registerPlayerEngine({ onEngine: (engine) => { seen = engine; } });
			const attempt = getEngineFactory()?.();
			// Expected: ok true carrying a RealPlayerEngine
			expect(attempt?.ok).toBe(true);
			expect(attempt !== undefined && attempt.ok && attempt.engine instanceof RealPlayerEngine).toBe(true);
			// Expected: the host hook received the same engine instance
			expect(attempt !== undefined && attempt.ok && seen === attempt.engine).toBe(true);
			if (attempt !== undefined && attempt.ok) {
				attempt.engine.dispose();
			}
		} finally {
			if (saved === undefined) {
				delete globals.AudioContext;
			} else {
				globals.AudioContext = saved;
			}
			if (savedNode === undefined) {
				delete globals.AudioWorkletNode;
			} else {
				globals.AudioWorkletNode = savedNode;
			}
			setEngineFactory(null);
		}
	});

	test("the main barrel stays free of the engine registration", async () => {
		const barrel = (await import("@vessel-dsp/player")) as Record<string, unknown>;
		// Expected: no engine registration surface on the main barrel
		expect("registerPlayerEngine" in barrel).toBe(false);
		expect("RealPlayerEngine" in barrel).toBe(false);
		expect("playerWorkletProcessorName" in barrel).toBe(false);
	});
});

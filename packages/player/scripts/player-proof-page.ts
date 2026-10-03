// Proof page entry, bundled by `scripts/player-proof.ts` into `/page.js`.
//
// Reads its own script URL for the leg query (`circuit`, `nam`, `ir` are
// rendered into the HTML by the proof server; only `circuit` matters here),
// registers the real engine with explicit asset overrides (the bundle's own
// `import.meta.url` would point at `/page.js`, not the package), and
// exposes the proof hooks: `__ctxCreated`, `__shellState`, `__telemetry`,
// `__capture`. Not imported by tests; not part of the package.

import { registerPlayerEngine } from "@vessel-dsp/player/engine";

// The package is marked sideEffects-free, so the element bundle is
// imported explicitly below. It is a SEPARATE bundle loaded dynamically
// after the factory exists: the element module self-registers at
// evaluation, and static HTML upgrades synchronously at define() time, so
// evaluating it before this point would bake a factory-less fallback
// controller into every static element (the README documents this order
// for blog pages too).
const win = window as unknown as Record<string, unknown>;
win.__ctxCreated = false;
win.__telemetry = [] as unknown[];
win.__shellState = null;

// Instrument AudioContext creation before anything can create one: the
// pre-click assertion reads this flag.
const OrigAudioContext = window.AudioContext;
if (OrigAudioContext !== undefined) {
	const creator = function (this: unknown, ...args: never[]): AudioContext {
		win.__ctxCreated = true;
		return new OrigAudioContext(...args);
	};
	creator.prototype = OrigAudioContext.prototype;
	win.AudioContext = creator;
}

registerPlayerEngine({
	workletUrl: "/player-worklet.js",
	dspWasmUrl: "/v2_dsp.wasm",
	namWasmUrl: "/nam-engine.wasm",
	namGlueUrl: "/nam-engine-glue.js",
	inputs: [{ id: "stim", label: "Stimulus", src: "/stim.wav" }],
	onEngine: (engine) => {
		win.__engine = engine;
		engine.on("telemetry", (telemetry?: unknown) => {
			(win.__telemetry as unknown[]).push(telemetry);
		});
	},
});

// Resolved at runtime, never by the bundler: this URL must stay a runtime
// import so the element module evaluates after the factory registration.
const elementUrl = "/element.js";
await import(elementUrl);

win.__capture = async (ms: number): Promise<{ peak: number; rms: number; samples: number[]; rate: number }> => {
	const engine = win.__engine as {
		getAnalyserNode(): AnalyserNode | null;
		getContextSampleRate(): number | null;
	} | undefined;
	const analyser = engine?.getAnalyserNode() ?? null;
	if (analyser === null) {
		throw new Error("no analyser: the engine has not started");
	}
	const frame = new Float32Array(analyser.fftSize);
	const samples: number[] = [];
	let peak = 0;
	let sum = 0;
	const telemetryLog = win.__telemetry as unknown[];
	const startIdx = telemetryLog.length;
	const end = performance.now() + ms;
	while (performance.now() < end) {
		analyser.getFloatTimeDomainData(frame);
		for (let index = 0; index < frame.length; index += 1) {
			const value = frame[index] as number;
			samples.push(value);
			const magnitude = Math.abs(value);
			if (magnitude > peak) {
				peak = magnitude;
			}
			sum += value * value;
		}
		// 100 ms spacing against a 42.7 ms window: consecutive windows
		// have gaps, never overlaps. Overlaps would duplicate samples
		// and poison the per-window comparison; gaps are harmless
		// because each window aligns independently. (Under heavy box
		// load the audio clock can lag the wall clock, which is exactly
		// what narrower spacing turned into overlapping reads.)
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return {
		peak,
		rms: Math.sqrt(sum / Math.max(1, samples.length)),
		samples,
		rate: engine?.getContextSampleRate() ?? 0,
		// Only telemetry posted during the capture window: cold-start
		// quanta (module warmup, page faults) predate it, and the
		// overrun assertion below baselines against the window start.
		telemetry: telemetryLog.slice(startIdx),
	};
};

const shellTimer = setInterval(() => {
	const state = (
		document.querySelector as unknown as (selectors: string) => { state?: string } | null
	)("#p")?.state;
	win.__shellState = state ?? null;
	if (state === "ready" || state === "error" || state === "fallback" || state === "playing") {
		clearInterval(shellTimer);
	}
}, 100);

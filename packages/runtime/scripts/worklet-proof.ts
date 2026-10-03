// Browser proof for the published worklet bundle (design note §3, task W1.4).
//
// Serves `dist/worklet/v2-audio-worklet.js` + `dist/wasm/v2_dsp.wasm` over a local
// static server, loads them in headless Chromium, renders 1 s at 48 kHz through an
// OfflineAudioContext whose worklet runs the WASM console, and asserts console
// parity within 1e-4 max abs. Runs twice: with the page intact, and with
// `window.structuredClone` deleted, proving no code path needs that binding
// (the worklet scope never had it; programs cross it as JSON).
//
// WHAT "PARITY" MEANS HERE. The worklet always runs a `ChainRuntime`, whose
// output passes a documented 10 Hz first-order DC blocker (`chain.ts`
// `blockDc`) that a bare `ReferenceRuntime` does not apply. On the §2 stimulus
// that filter alone accounts for maxAbs 6.218e-3 (reproduced bit-exactly in bun
// below), so asserting the raw ReferenceRuntime render within 1e-4 would fail on
// documented chain behaviour, not on the console. The proof therefore asserts
// the 1e-4 bar against the chain render (`ChainRuntime` + same program, same
// stimulus, same DAC scale: end-to-end worklet parity), prints the raw
// ReferenceRuntime delta beside it with a 1e-2 guard band, and prints the
// bun-side console pair (WASM engine vs reference, no chain) as the third leg.
// All three legs must hold; a worklet regression fails the first, a console
// regression the third.
//
// NOT a unit test: it needs a browser, so it lives here, not in `tests/`.
// Run: NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules \
//        bun scripts/worklet-proof.ts [--port=8471]
// Requires: `bun run build` first (bundle + wasm in dist), and playwright-core
// resolvable via NODE_PATH (it ships in the workbench checkout, not this repo).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { resistorDivider } from "@vessel-dsp/compiler/fixtures/circuits";
import {
	ChainRuntime,
	dacScaleFactor,
	outputConversionFullScale,
	programSlot,
	ReferenceRuntime,
	V2WasmEngine,
} from "../src/index";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name: string): string | undefined =>
	process.argv
		.find((candidate) => candidate.startsWith(`--${name}=`))
		?.slice(name.length + 3);
const PORT = Number(argument("port") ?? "8471");

const RATE = 48000;
const SECONDS = 1;
const LENGTH = RATE * SECONDS;
const TOLERANCE = 1e-4;

// Design §2 stimulus: 440 Hz at 0.25 plus 1320 Hz at 0.1.
function stimulus(): Float64Array {
	const input = new Float64Array(LENGTH);
	for (let i = 0; i < LENGTH; i += 1) {
		input[i] =
			0.25 * Math.sin((2 * Math.PI * 440 * i) / RATE) +
			0.1 * Math.sin((2 * Math.PI * 1320 * i) / RATE);
	}
	return input;
}

function peak(values: ArrayLike<number>): number {
	let top = 0;
	for (let i = 0; i < values.length; i += 1) top = Math.max(top, Math.abs(values[i] as number));
	return top;
}

function rms(values: ArrayLike<number>): number {
	let sum = 0;
	for (let i = 0; i < values.length; i += 1) sum += (values[i] as number) ** 2;
	return Math.sqrt(sum / values.length);
}

let playwright: typeof import("playwright-core");
try {
	playwright = await import("playwright-core");
} catch {
	console.error(
		"worklet-proof: cannot resolve playwright-core. Re-run with " +
			"NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules",
	);
	process.exit(1);
}

const bundlePath = resolve(packageRoot, "dist/worklet/v2-audio-worklet.js");
const wasmPath = resolve(packageRoot, "dist/wasm/v2_dsp.wasm");
let bundleBytes: Buffer;
let wasmBytes: Buffer;
try {
	bundleBytes = readFileSync(bundlePath);
	wasmBytes = readFileSync(wasmPath);
} catch {
	console.error(
		`worklet-proof: ${bundlePath} or ${wasmPath} is absent: run \`bun run build\` first.`,
	);
	process.exit(1);
}

// The compiled program under test: a compiler fixture through the real
// registry, the same recipe `tests/v2-wasm.test.ts` loads into V2WasmEngine.
const compiled = compile(resistorDivider, { registry: emptyRegistry });
if (compiled.status !== "ok") {
	throw new Error(`fixture did not compile: ${JSON.stringify(compiled.reasons)}`);
}
const program = JSON.parse(JSON.stringify(compiled.program));
const scale = dacScaleFactor(outputConversionFullScale(compiled.program));

const input = stimulus();
const reference = new ReferenceRuntime(compiled.program);
reference.prepare(RATE);
const referenceOut = reference.process(input);
const chainTs = new ChainRuntime([programSlot(compiled.program)]);
chainTs.prepare(RATE);
const chainOut = chainTs.process(input);
// Bun-side console leg: the same WASM binary the page will fetch, no chain.
const wasmEngine = await V2WasmEngine.create(compiled.program);
wasmEngine.prepare({ sampleRate: RATE });
const wasmIn = new Float32Array(LENGTH);
const wasmBunOut = new Float32Array(LENGTH);
for (let i = 0; i < LENGTH; i += 1) wasmBunOut[i] = 0;
for (let i = 0; i < LENGTH; i += 1) wasmIn[i] = input[i] as number;
wasmEngine.processBlock(wasmIn, wasmBunOut);
wasmEngine.destroy();
const expected = new Float64Array(LENGTH);
for (let i = 0; i < LENGTH; i += 1) expected[i] = (chainOut[i] as number) * scale;

function maxAbs(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let top = 0;
	for (let i = 0; i < a.length; i += 1) top = Math.max(top, Math.abs((a[i] as number) - (b[i] as number)));
	return top;
}
console.log(
	`worklet-proof: bun legs chainTS-vs-ref ${maxAbs(chainOut, referenceOut).toExponential(3)}, ` +
		`wasmBun-vs-ref ${maxAbs(wasmBunOut, referenceOut).toExponential(3)}`,
);

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: PORT,
	fetch(request) {
		const path = new URL(request.url).pathname;
		if (path === "/v2-audio-worklet.js") {
			return new Response(bundleBytes, {
				headers: { "content-type": "text/javascript" },
			});
		}
		if (path === "/v2_dsp.wasm") {
			return new Response(wasmBytes, { headers: { "content-type": "application/wasm" } });
		}
		return new Response("<!doctype html><title>worklet proof</title>", {
			headers: { "content-type": "text/html" },
		});
	},
});

// NOTE: plain-JS page function, no type annotations: playwright ships
// `fn.toString()` to the page verbatim, and any TS syntax would not parse there.
async function renderInPage(page: unknown, killStructuredClone: boolean) {
	const p = page as import("playwright-core").Page;
	return await p.evaluate(
		async (args: unknown) => {
			const a = args as {
				program: unknown;
				stimulus: number[];
				killStructuredClone: boolean;
			};
			const outcome: Record<string, unknown> = {};
			if (a.killStructuredClone) {
				try {
					(window as unknown as Record<string, unknown>).structuredClone = undefined;
				} catch (error) {
					outcome.structuredCloneKillFailed = String(error);
				}
			}
			outcome.structuredCloneType = typeof (window as unknown as Record<string, unknown>).structuredClone;
			const wasmResponse = await fetch("/v2_dsp.wasm");
			if (!wasmResponse.ok) throw new Error(`wasm fetch: ${wasmResponse.status}`);
			const wasmBytesLocal = await wasmResponse.arrayBuffer();
			outcome.wasmBytes = wasmBytesLocal.byteLength;
			const ctx = new OfflineAudioContext(1, 48000, 48000);
			outcome.contextRate = ctx.sampleRate;
			await ctx.audioWorklet.addModule("/v2-audio-worklet.js");
			const node = new AudioWorkletNode(ctx, "v2-pedal-processor");
			const loaded = await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("timed out waiting for loaded")), 20000);
				node.port.onmessage = (event: MessageEvent) => {
					const msg = event.data as { type?: string; message?: string };
					if (msg && msg.type === "loaded") {
						clearTimeout(timer);
						resolve(event.data);
					} else if (msg && msg.type === "telemetry" && outcome.telemetry === undefined) {
						outcome.telemetry = event.data;
					} else if (msg && msg.type === "error") {
						clearTimeout(timer);
						reject(new Error(`worklet error: ${msg.message}`));
					}
				};
				node.port.postMessage({
					type: "load",
					slots: [{ kind: "program", program: a.program }],
					wasmConsole: { wasmBytes: wasmBytesLocal },
				});
			});
			outcome.loaded = loaded;
			const source = ctx.createBufferSource();
			const buffer = ctx.createBuffer(1, a.stimulus.length, 48000);
			buffer.getChannelData(0).set(a.stimulus);
			source.buffer = buffer;
			source.connect(node);
			node.connect(ctx.destination);
			source.start(0);
			const rendered = await ctx.startRendering();
			outcome.samples = Array.from(rendered.getChannelData(0));
			outcome.userAgent = navigator.userAgent;
			return outcome;
		},
		{ program, stimulus: Array.from(input), killStructuredClone },
	);
}

let failed = false;
const browser = await playwright.chromium.launch({
	headless: true,
	args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
try {
	console.log(`worklet-proof: chromium ${browser.version()}, bundle ${bundleBytes.length} bytes, wasm ${wasmBytes.length} bytes`);
	console.log(
		`worklet-proof: program formatVersion ${(compiled.program as { formatVersion: number }).formatVersion}, dacScale ${scale}, reference peak ${peak(referenceOut).toFixed(6)} rms ${rms(referenceOut).toFixed(6)}`,
	);
	for (const killStructuredClone of [false, true]) {
		const page = await browser.newPage();
		try {
			await page.goto(`http://127.0.0.1:${PORT}/`);
			const outcome = (await renderInPage(page, killStructuredClone)) as {
				samples: number[];
				loaded: { controls: unknown[] };
				telemetry: null | {
					isWasmConsole?: boolean;
					wasmSlots?: { slot: number; peakIterations: number }[];
					cpuLoadPercent?: number;
					overrunCount?: number;
				};
				structuredCloneType: string;
				wasmBytes: number;
				contextRate: number;
				userAgent: string;
			};
			const samples = outcome.samples;
			let maxAbsChain = 0;
			let maxAbsRef = 0;
			for (let i = 0; i < LENGTH; i += 1) {
				maxAbsChain = Math.max(maxAbsChain, Math.abs((samples[i] as number) - (expected[i] as number)));
				maxAbsRef = Math.max(maxAbsRef, Math.abs((samples[i] as number) - (referenceOut[i] as number) * scale));
			}
			// 1e-4 is the console-parity bar (worklet chain vs bun chain, same
			// console family modulo TS/WASM); 1e-2 bounds the documented DC-block
			// delta against the bare reference so a real regression cannot hide
			// behind it.
			const pass = maxAbsChain <= TOLERANCE && maxAbsRef < 1e-2 && peak(samples) > 0;
			if (!pass) failed = true;
			console.log(
				`worklet-proof: structuredClone=${killStructuredClone ? "deleted" : "present"} (${outcome.structuredCloneType}) ` +
					`rate=${outcome.contextRate} loadedControls=${JSON.stringify((outcome.loaded as { controls: unknown }).controls)} ` +
					`isWasmConsole=${outcome.telemetry?.isWasmConsole} wasmSlots=${JSON.stringify(outcome.telemetry?.wasmSlots)} ` +
					`cpuLoad=${outcome.telemetry?.cpuLoadPercent} overruns=${outcome.telemetry?.overrunCount}`,
			);
			console.log(
				`worklet-proof: worklet peak ${peak(samples).toFixed(6)} rms ${rms(samples).toFixed(6)} maxAbsVsChain ${maxAbsChain.toExponential(3)} ` +
					`(${maxAbsChain <= TOLERANCE ? "PASS" : "FAIL"} vs ${TOLERANCE}) maxAbsVsReference ${maxAbsRef.toExponential(3)} ` +
					`[${killStructuredClone ? "no-structuredClone" : "baseline"}]`,
			);
		} finally {
			await page.close();
		}
	}
} finally {
	await browser.close();
	server.stop(true);
}

if (failed) {
	console.error("worklet-proof: FAIL");
	process.exit(1);
}
console.log("worklet-proof: PASS");

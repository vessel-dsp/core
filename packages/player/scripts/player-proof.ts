// Real browser proof for the player cutover (task W3).
//
// Serves the built player + runtime assets, loads a page with
// <vessel-player> in headless Chromium, clicks play (a real user gesture
// via playwright), and asserts from the page: state reaches playing,
// cpuLoad reported, 0 overruns over ~3 s of audio, non-silent output
// matching the bun-side reference render of the same circuit within a
// stated bound. Four legs: two pedal-only blog circuits, pedal + synthetic
// IR, pedal + synthetic NAM. A fifth concern rides along: before the click
// there are zero requests for *.wasm or worklet files and no AudioContext.
//
// NOT a unit test: it needs a browser, so it lives here, not in `tests/`.
// Run: NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules \
//        bun scripts/player-proof.ts [--port=8471]
// Requires: `bun run --cwd packages/player build` first (worklet bundle +
// wasm in player dist), and playwright-core resolvable via NODE_PATH.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile, pedalPartCatalog, type Program } from "@vessel-dsp/compiler";
import {
	ChainRuntime,
	dacScaleFactor,
	outputConversionFullScale,
	programSlot,
	processorSlot,
	V2WasmEngine,
	type ChainSlot,
	type ExternalProcessor,
} from "@vessel-dsp/runtime";
import {
	CabinetIrNode,
	NamNode,
	instantiateNamEngine,
	type NamEngineModule,
} from "@vessel-dsp/chain";

const playerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(playerRoot, "..", "..");
const argument = (name: string): string | undefined =>
	process.argv
		.find((candidate) => candidate.startsWith(`--${name}=`))
		?.slice(name.length + 3);
const PORT = Number(argument("port") ?? "8471");

const RATE = 48000;
const LOOP_SECONDS = 2;
const LOOP = RATE * LOOP_SECONDS;
const CAPTURE_MS = 3000;

// ---------------------------------------------------------------------------
// Stimulus, assets, references (all bun-side)
// ---------------------------------------------------------------------------

function stimulusLoop(): Float32Array {
	const input = new Float32Array(LOOP);
	for (let i = 0; i < LOOP; i += 1) {
		input[i] =
			0.25 * Math.sin((2 * Math.PI * 440 * i) / RATE) +
			0.1 * Math.sin((2 * Math.PI * 1320 * i) / RATE);
	}
	return input;
}

// The exact float32 samples the page loops: parsed back out of the served
// WAV so the oracle input is bit-identical to the decoded AudioBuffer,
// not just mathematically equal (float64 math vs float32 file content
// differ at 1e-8, which resonant circuits and clipping stages amplify).
function servedLoopSamples(): Float32Array {
	const view = new DataView(stimWav.buffer, stimWav.byteOffset + 44);
	const count = (stimWav.byteLength - 44) / 4;
	const out = new Float32Array(count);
	for (let i = 0; i < count; i += 1) out[i] = view.getFloat32(i * 4, true);
	return out;
}

function loopedInput(frames: number): Float64Array {
	const loop = servedLoopSamples();
	const out = new Float64Array(frames);
	for (let i = 0; i < frames; i += 1) out[i] = loop[i % loop.length] as number;
	return out;
}

function writeWavFloat32(samples: Float32Array, rate: number): ArrayBuffer {
	const header = new ArrayBuffer(44);
	const view = new DataView(header);
	const writeText = (offset: number, text: string): void => {
		for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
	};
	writeText(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 4, true);
	writeText(8, "WAVE");
	writeText(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 4, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 32, true);
	writeText(36, "data");
	view.setUint32(40, samples.length * 4, true);
	const body = new Uint8Array(samples.length * 4);
	new Float32Array(body.buffer).set(samples);
	const out = new Uint8Array(44 + body.length);
	out.set(new Uint8Array(header), 0);
	out.set(body, 44);
	return out.buffer;
}

function syntheticIr(): Float32Array {
	const taps = new Float32Array(512);
	let seed = 0x12345678;
	const random = (): number => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 0xffffffff - 0.5;
	};
	for (let i = 0; i < taps.length; i += 1) {
		taps[i] = Math.exp(-i / 90) * (i === 0 ? 1 : random() * 0.6);
	}
	return taps;
}

const SYNTHETIC_WEIGHTS = [0.5, -0.25, 0.125, 0.0625];

function syntheticNam(): string {
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
		sample_rate: RATE,
	});
}

function peak(values: ArrayLike<number>): number {
	let top = 0;
	for (let i = 0; i < values.length; i += 1) top = Math.max(top, Math.abs(values[i] as number));
	return top;
}

function maxAbs(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let top = 0;
	for (let i = 0; i < a.length; i += 1) top = Math.max(top, Math.abs((a[i] as number) - (b[i] as number)));
	return top;
}

function loadProgramOrThrow(name: string, text: string): Program {
	const compiled = compile(text, { registry: pedalPartCatalog });
	if (compiled.status !== "ok") {
		throw new Error(`${name} did not compile: ${JSON.stringify(compiled.reasons)}`);
	}
	return compiled.program;
}

// The worklet's WASM program slot, mirrored bun-side so the tight oracle
// (page vs same-console render) shares no code with the reference oracle
// (page vs TS ReferenceRuntime).
async function wasmProcessor(program: Program): Promise<{
	processor: ExternalProcessor;
	setControl: (id: string, position: number) => void;
	destroy(): void;
}> {
	const engine = await V2WasmEngine.create(program);
	engine.prepare({ sampleRate: RATE });
	let scratchIn = new Float32Array(0);
	let scratchOut = new Float32Array(0);
	const processor: ExternalProcessor = {
		id: "proof-wasm",
		produces: program.stageCoverage,
		expects: "instrument",
		portFullScaleVolts: program.portFullScaleVolts,
		portReferenceVolts: program.portReferenceVolts,
		portImpedanceOhms: program.portImpedanceOhms,
		prepare(rate: number): void {
			engine.prepare({ sampleRate: rate });
		},
		process(buffer: Float64Array): Float64Array {
			if (scratchIn.length !== buffer.length) {
				scratchIn = new Float32Array(buffer.length);
				scratchOut = new Float32Array(buffer.length);
			}
			for (let i = 0; i < buffer.length; i += 1) scratchIn[i] = buffer[i] ?? 0;
			engine.processBlock(scratchIn, scratchOut);
			const out = new Float64Array(buffer.length);
			for (let i = 0; i < buffer.length; i += 1) out[i] = scratchOut[i] ?? 0;
			return out;
		},
	};
	return {
		processor,
		setControl: (id: string, position: number): void => {
			engine.setControl(id, position);
		},
		destroy: () => engine.destroy(),
	};
}

let playwright: typeof import("playwright-core");
try {
	playwright = await import("playwright-core");
} catch {
	console.error(
		"player-proof: cannot resolve playwright-core. Re-run with " +
			"NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules",
	);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Files served to the page (all from this repo's builds or generated here)
// ---------------------------------------------------------------------------

const playerWorklet = readFileSync(resolve(playerRoot, "dist/worklet/player-worklet.js"));
const dspWasm = readFileSync(resolve(playerRoot, "dist/wasm/v2_dsp.wasm"));
const namWasm = readFileSync(resolve(playerRoot, "dist/wasm/nam-engine.wasm"));
const namGlue = readFileSync(resolve(playerRoot, "dist/wasm/nam-engine-glue.js"), "utf8");
const stimWav = Buffer.from(writeWavFloat32(stimulusLoop(), RATE));
const irTaps = syntheticIr();
const irWav = Buffer.from(writeWavFloat32(irTaps, RATE));
const namText = syntheticNam();

const BLOG = "/home/joseph/orca/workspaces/website/p5-blog/apps/blog/content/circuits";
const HEAVY = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp/mxr-phase-90.vdsp";
const circuitBufferText = readFileSync(resolve(BLOG, "pickup-buffer-cable-6m.vdsp"), "utf8");
const circuitFuzzText = readFileSync(resolve(BLOG, "pickup-cable-6m-fuzz.vdsp"), "utf8");
const circuitPhaseText = readFileSync(HEAVY, "utf8");

// Page entry: bundled at proof time so the page has zero bare imports.
const pageEntryPath = resolve(playerRoot, "scripts/player-proof-page.ts");
const elementEntryPath = resolve(playerRoot, "scripts/player-proof-element.ts");
const pageBundle = await Bun.build({
	entrypoints: [pageEntryPath],
	target: "browser",
	format: "esm",
	minify: false,
});
if (!pageBundle.success) {
	console.error(`player-proof: page bundle failed: ${pageBundle.logs.map(String).join("\n")}`);
	process.exit(1);
}
const pageJs = await pageBundle.outputs[0]!.text();
const elementBundle = await Bun.build({
	entrypoints: [elementEntryPath],
	target: "browser",
	format: "esm",
	minify: false,
});
if (!elementBundle.success) {
	console.error(`player-proof: element bundle failed: ${elementBundle.logs.map(String).join("\n")}`);
	process.exit(1);
}
const elementJs = await elementBundle.outputs[0]!.text();

type Leg = {
	readonly name: string;
	readonly circuit: "buffer" | "fuzz" | "phase";
	readonly nam: boolean;
	readonly ir: boolean;
	/** Control positions frozen before capture (LFO freeze for determinism). */
	readonly freezeControls?: ReadonlyArray<{ readonly id: string; readonly value: number }>;
	/**
	 * Skip the waveform comparison (cost/telemetry only). For circuits
	 * with a free-running LFO whose phase is unknowable across processes
	 * (measured: mxr-phase-90 renders differ 0.64 even bun-side with
	 * Speed parked at 0), sample-exact match is unstatable by
	 * construction; the leg still proves playback, telemetry, and cost.
	 */
	readonly skipWaveform?: boolean;
	/**
	 * Harvest-only parity leg: assert playing, non-silence, and
	 * telemetry, but report overruns without gating on them. The heavy
	 * pedal's deliverable is its measured cost next to the section 7
	 * table, not a deadline proof on a shared box.
	 */
	readonly harvestOnly?: boolean;
};

const circuitTextOf = (leg: Leg): string =>
	leg.circuit === "buffer" ? circuitBufferText : leg.circuit === "fuzz" ? circuitFuzzText : circuitPhaseText;

const requestLog: Array<{ path: string; time: number }> = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: PORT,
	fetch(request) {
		const url = new URL(request.url);
		requestLog.push({ path: url.pathname + url.search, time: Date.now() });
		const query = url.searchParams;
		if (url.pathname === "/page.js") {
			return new Response(pageJs, { headers: { "content-type": "text/javascript" } });
		}
		if (url.pathname === "/element.js") {
			return new Response(elementJs, { headers: { "content-type": "text/javascript" } });
		}
		if (url.pathname === "/player-worklet.js") {
			return new Response(playerWorklet, { headers: { "content-type": "text/javascript" } });
		}
		if (url.pathname === "/v2_dsp.wasm") {
			return new Response(dspWasm, { headers: { "content-type": "application/wasm" } });
		}
		if (url.pathname === "/nam-engine.wasm") {
			return new Response(namWasm, { headers: { "content-type": "application/wasm" } });
		}
		if (url.pathname === "/nam-engine-glue.js") {
			return new Response(namGlue, { headers: { "content-type": "text/javascript" } });
		}
		if (url.pathname === "/stim.wav") {
			return new Response(stimWav, { headers: { "content-type": "audio/wav" } });
		}
		if (url.pathname === "/ir.wav") {
			return new Response(irWav, { headers: { "content-type": "audio/wav" } });
		}
		if (url.pathname === "/amp.nam") {
			return new Response(namText, { headers: { "content-type": "application/json" } });
		}
		if (url.pathname === "/circuit.vdsp") {
			const which = query.get("circuit") ?? "buffer";
			const text = which === "fuzz" ? circuitFuzzText : which === "phase" ? circuitPhaseText : circuitBufferText;
			return new Response(text, { headers: { "content-type": "text/yaml" } });
		}
		if (url.pathname === "/") {
			const namAttr = query.get("nam") === "1";
			const irAttr = query.get("ir") === "1";
			const html = `<!doctype html><html><head><meta charset="utf-8"><title>player proof</title></head><body>
<vessel-player id="p" src="/circuit.vdsp?circuit=${query.get("circuit") ?? "buffer"}"
  inputs='[{"id":"stim","label":"Stimulus","src":"/stim.wav"}]'
  ${namAttr ? `nam='[{"id":"lead","label":"Lead","src":"/amp.nam"}]'` : ``}
  ${irAttr ? `ir='[{"id":"room","label":"Room","src":"/ir.wav"}]'` : ``}></vessel-player>
<script type="module" src="/page.js?circuit=${query.get("circuit") ?? "buffer"}&nam=${query.get("nam") ?? ""}&ir=${query.get("ir") ?? ""}"></script>
</body></html>`;
			return new Response(html, { headers: { "content-type": "text/html" } });
		}
		return new Response("not found", { status: 404 });
	},
});

// ---------------------------------------------------------------------------
// Bun-side oracles for one leg
// ---------------------------------------------------------------------------

type Oracle = {
	readonly scale: number;
	readonly tsRef: Float64Array;
	readonly wasmChain: Float64Array;
	readonly consoleDelta: number;
};

async function buildOracle(leg: Leg, frames: number): Promise<Oracle> {
	const program = loadProgramOrThrow(leg.circuit, circuitTextOf(leg));
	const input = loopedInput(frames);
	const scale = dacScaleFactor(outputConversionFullScale(program));
	// TS reference oracle: the TS console through the same chain topology.
	const tsSlots: ChainSlot[] = [programSlot(program)];
	if (leg.ir) {
		const node = new CabinetIrNode("room", "room", { ir: new Float64Array(irTaps), irSampleRate: RATE });
		const irProcessor: ExternalProcessor = {
			id: "room",
			produces: "miked",
			expects: "speaker-electrical",
			portFullScaleVolts: {
				input: outputConversionFullScale(program),
				output: outputConversionFullScale(program),
			},
			portImpedanceOhms: null,
			prepare(rate: number): void {
				node.prepare(rate);
			},
			process(buffer: Float64Array): Float64Array {
				return node.process(buffer);
			},
		};
		tsSlots.push(processorSlot(irProcessor));
	}
	if (leg.nam) {
		const glueUrl = pathToFileURL(resolve(repoRoot, "packages/chain/nam-engine/nam-engine.js")).href;
		const glue = (await import(glueUrl)).default as (options: {
			wasmBinary: ArrayBufferLike;
		}) => Promise<NamEngineModule>;
		const wasmBytes = new Uint8Array(readFileSync(resolve(repoRoot, "packages/chain/nam-engine/nam-engine.wasm"))).buffer;
		const engine = await instantiateNamEngine(wasmBytes, glue);
		const node = new NamNode("lead", "lead", { engine, model: namText });
		node.prepare(RATE);
		const namProcessor: ExternalProcessor = {
			id: "lead",
			produces: "speaker-electrical",
			expects: "instrument",
			portFullScaleVolts: { input: null, output: null },
			portImpedanceOhms: null,
			prepare(): void {},
			process(buffer: Float64Array): Float64Array {
				return node.process(buffer);
			},
		};
		tsSlots.push(processorSlot(namProcessor));
	}
	const tsChain = new ChainRuntime(tsSlots);
	tsChain.prepare(RATE);
	for (const frozen of leg.freezeControls ?? []) {
		tsChain.setControl(0, frozen.id, frozen.value);
	}
	// Chunked at the worklet quantum (128): stateful slots (NAM loudness
	// smoothing, IR filter state) advance per process() call, so a
	// whole-array render is a different call pattern than the worklet's.
	const tsOut = new Float64Array(frames);
	for (let offset = 0; offset < frames; offset += 128) {
		const block = input.slice(offset, offset + 128);
		tsOut.set(tsChain.process(block), offset);
	}
	const tsRef = new Float64Array(frames);
	for (let i = 0; i < frames; i += 1) tsRef[i] = (tsOut[i] as number) * scale;
	// Tight oracle: the same chain with the program on the WASM console.
	const held: Array<() => void> = [];
	const wasmSlots: ChainSlot[] = [];
	let wasmProgramControl: ((id: string, position: number) => void) | null = null;
	if (leg.circuit !== undefined) {
		const wrapped = await wasmProcessor(program);
		held.push(wrapped.destroy);
		wasmProgramControl = wrapped.setControl;
		wasmSlots.push({ kind: "processor", processor: wrapped.processor, bypassMode: "effect", program } as unknown as ChainSlot);
	}
	if (leg.ir) {
		const node = new CabinetIrNode("room", "room", { ir: new Float64Array(irTaps), irSampleRate: RATE });
		const wasmIrProcessor: ExternalProcessor = {
			id: "room",
			produces: "miked",
			expects: "speaker-electrical",
			portFullScaleVolts: {
				input: outputConversionFullScale(program),
				output: outputConversionFullScale(program),
			},
			portImpedanceOhms: null,
			prepare(rate: number): void {
				node.prepare(rate);
			},
			process(buffer: Float64Array): Float64Array {
				return node.process(buffer);
			},
		};
		wasmSlots.push({ kind: "processor", processor: wasmIrProcessor, bypassMode: "effect" } as unknown as ChainSlot);
	}
	if (leg.nam) {
		const glueUrl = pathToFileURL(resolve(repoRoot, "packages/chain/nam-engine/nam-engine.js")).href;
		const glue = (await import(glueUrl)).default as (options: {
			wasmBinary: ArrayBufferLike;
		}) => Promise<NamEngineModule>;
		const wasmBytes = new Uint8Array(readFileSync(resolve(repoRoot, "packages/chain/nam-engine/nam-engine.wasm"))).buffer;
		const engine = await instantiateNamEngine(wasmBytes, glue);
		const node = new NamNode("lead", "lead", { engine, model: namText });
		node.prepare(RATE);
		const wasmNamProcessor: ExternalProcessor = {
			id: "lead",
			produces: "speaker-electrical",
			expects: "instrument",
			portFullScaleVolts: { input: null, output: null },
			portImpedanceOhms: null,
			prepare(): void {},
			process(buffer: Float64Array): Float64Array {
				return node.process(buffer);
			},
		};
		wasmSlots.push({ kind: "processor", processor: wasmNamProcessor, bypassMode: "effect" } as unknown as ChainSlot);
	}
	const wasmChainRuntime = new ChainRuntime(wasmSlots);
	wasmChainRuntime.prepare(RATE);
	for (const frozen of leg.freezeControls ?? []) {
		// Slot 0 is the WASM program slot: route behind the C ABI,
		// exactly as the worklet does, not through setControl (which
		// rightly refuses processor slots).
		wasmProgramControl?.(frozen.id, frozen.value);
	}
	const wasmOut = new Float64Array(frames);
	for (let offset = 0; offset < frames; offset += 128) {
		const block = input.slice(offset, offset + 128);
		wasmOut.set(wasmChainRuntime.process(block), offset);
	}
	const wasmChain = new Float64Array(frames);
	for (let i = 0; i < frames; i += 1) wasmChain[i] = (wasmOut[i] as number) * scale;
	for (const release of held) release();
	const consoleDelta = maxAbs(wasmChain, tsRef) / Math.max(peak(tsRef), 1e-9);
	return { scale, tsRef, wasmChain, consoleDelta };
}

// Best alignment of ONE contiguous analyser window against the
// loop-phase-0 reference: the capture polls the analyser on a wall-clock
// interval, so consecutive windows have small gaps between them and only
// each window is internally contiguous. Correlate zero-meaned over one
// loop period, keep the top candidates (periodic content has many
// near-equal correlation peaks), refine, and decide by maxAbs with a
// fractional Catmull-Rom refinement.
function alignWindow(chunk: number[], reference: Float64Array): { shift: number; normalizedMaxAbs: number } {
	const refPeak = peak(reference);
	// Zero-mean the chunk: a 2048-sample window holds a non-integer
	// number of 440 Hz periods, so its DC varies with phase and would
	// bias the correlation peak by samples.
	let chunkMean = 0;
	for (let i = 0; i < chunk.length; i += 1) chunkMean += chunk[i] as number;
	chunkMean /= chunk.length;
	const zeroMeanScore = (shift: number, step: number): number => {
		let refMean = 0;
		let count = 0;
		for (let i = 0; i < chunk.length; i += step) {
			refMean += reference[(shift + i) % reference.length] as number;
			count += 1;
		}
		refMean /= Math.max(1, count);
		let score = 0;
		for (let i = 0; i < chunk.length; i += step) {
			score += ((chunk[i] as number) - chunkMean) * (((reference[(shift + i) % reference.length] as number) - refMean));
		}
		return score;
	};
	// Coarse pass keeps the top candidates, not just the winner: on
	// near-periodic content the correlation landscape has many
	// nearly-equal peaks, and the max-correlation peak is not always
	// the maxAbs-minimum one (measured: the true shift won maxAbs at
	// 1.7e-7 while correlation preferred a 6e-3 peak).
	const scored: Array<[number, number]> = [];
	for (let shift = 0; shift < LOOP; shift += 8) {
		scored.push([zeroMeanScore(shift, 8), shift]);
	}
	scored.sort((a, b) => b[0] - a[0]);
	const candidates = scored.slice(0, 20).map(([, shift]) => shift);
	// Refine each candidate ±128 on every sample, keep the best five.
	const refined: Array<[number, number]> = [];
	for (const candidate of candidates) {
		let bestShift = candidate;
		let bestScore = -Infinity;
		for (let shift = candidate - 128; shift <= candidate + 128; shift += 1) {
			const wrapped = (shift + LOOP) % LOOP;
			const score = zeroMeanScore(wrapped, 1);
			if (score > bestScore) {
				bestScore = score;
				bestShift = wrapped;
			}
		}
		refined.push([bestScore, bestShift]);
	}
	refined.sort((a, b) => b[0] - a[0]);
	const finalists = refined.slice(0, 5).map(([, shift]) => shift);
	// Fractional refinement per finalist (Catmull-Rom, ±3): decide by
	// maxAbs, not correlation.
	let bestShift = finalists[0] ?? 0;
	let bestDelta = Infinity;
	for (const refined of finalists) {
		for (let tenth = -30; tenth <= 30; tenth += 1) {
			const frac = tenth / 10;
			let fracTop = 0;
			for (let i = 0; i < chunk.length; i += 1) {
				const pos = refined + i + frac;
				const lo = Math.floor(pos);
				const p0 = reference[(((lo - 1) % reference.length) + reference.length) % reference.length] as number;
				const p1 = reference[(((lo) % reference.length) + reference.length) % reference.length] as number;
				const p2 = reference[(((lo + 1) % reference.length) + reference.length) % reference.length] as number;
				const p3 = reference[(((lo + 2) % reference.length) + reference.length) % reference.length] as number;
				const t = pos - lo;
				const t2 = t * t;
				const t3 = t2 * t;
				const interp =
					0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
				fracTop = Math.max(fracTop, Math.abs((chunk[i] as number) - interp));
			}
			if (fracTop < bestDelta) {
				bestDelta = fracTop;
				bestShift = refined;
			}
		}
	}
	return { shift: bestShift, normalizedMaxAbs: bestDelta / Math.max(refPeak, 1e-9) };
}

// ---------------------------------------------------------------------------
// Page run for one leg
// ---------------------------------------------------------------------------

async function runLeg(
	browser: import("playwright-core").Browser,
	leg: Leg,
	oracle: Oracle,
): Promise<{ cpuLoads: number[]; overruns: number; failed: boolean }> {
	const query = `?circuit=${leg.circuit}&nam=${leg.nam ? "1" : ""}&ir=${leg.ir ? "1" : ""}`;
	const page = await browser.newPage();
	const failures: string[] = [];
	// NOTE: the three page closures below are plain JavaScript with no type
	// annotations: playwright ships `fn.toString()` to the page verbatim,
	// and any TS syntax would not parse there.
	const readyFn = "window.__shellState === 'ready'";
	const playingFn = "document.querySelector('#p') && document.querySelector('#p').state === 'playing'";
	const preClickFn = "({ ctxCreated: window.__ctxCreated, state: document.querySelector('#p') ? document.querySelector('#p').state : null })";
	const captureFn = `async (ms) => {
		const result = await window.__capture(ms);
		return { peak: result.peak, rms: result.rms, samples: result.samples, rate: result.rate, telemetry: result.telemetry };
	}`;
	try {
		const mark = requestLog.length;
		await page.goto(`http://127.0.0.1:${PORT}/${query}`);
		// Wait for the shell to be ready (circuit text fetched + compiled).
		await page.waitForFunction(readyFn, null, { timeout: 30000 });
		// Pre-click laziness: no wasm/worklet requests and no AudioContext.
		const preClick = (await page.evaluate(preClickFn)) as { ctxCreated?: boolean; state?: string };
		const wasmHits = requestLog
			.slice(mark)
			.filter((entry) => entry.path.endsWith(".wasm") || entry.path.includes("worklet"));
		if (wasmHits.length > 0) {
			failures.push(`pre-click wasm/worklet requests: ${JSON.stringify(wasmHits.map((entry) => entry.path))}`);
		}
		if (preClick.ctxCreated === true) {
			failures.push("AudioContext was created before the gesture");
		}
		if (preClick.state !== "ready") {
			failures.push(`pre-click state is ${String(preClick.state)}, not ready`);
		}
		console.log(
			`player-proof: leg ${leg.name} pre-click state=${preClick.state} ctxCreated=${preClick.ctxCreated} wasmHits=${wasmHits.length}`,
		);
		// Select NAM/IR through the real pickers when the leg needs them.
		if (leg.nam) {
			await page.selectOption("#p >> select[data-picker='nam']", "lead");
		}
		if (leg.ir) {
			await page.selectOption("#p >> select[data-picker='ir']", "room");
		}
		// The gesture: click the transport button.
		await page.click("#p >> button[data-action='transport']");
		try {
			await page.waitForFunction(playingFn, null, { timeout: 60000 });
		} catch {
			const state = await page.evaluate(
				"({ state: document.querySelector('#p') ? document.querySelector('#p').state : null, error: document.querySelector('#p') && document.querySelector('#p').shadowRoot ? document.querySelector('#p').shadowRoot.querySelector('.error').textContent : null })",
			);
			failures.push(`never reached playing: ${JSON.stringify(state)}`);
			console.log(`player-proof: leg ${leg.name} never reached playing: ${JSON.stringify(state)}`);
			return { cpuLoads: [], overruns: -1, failed: true };
		}
		// Freeze modulated controls before capture (LFO freeze for
		// determinism): a free-running LFO phase cannot match across
		// processes, so the proof parks it through the real knob path,
		// which also exercises setControl in the browser.
		for (const frozen of leg.freezeControls ?? []) {
			await page.locator(`#p >> input[data-control="${frozen.id}"]`).fill(String(frozen.value));
		}
		if ((leg.freezeControls ?? []).length > 0) {
			await page.waitForTimeout(1500);
		}
		// Capture ~3 s of realtime output plus the telemetry log.
		const captured = (await page.evaluate(`(${captureFn})(${CAPTURE_MS})`)) as {
			peak: number;
			rms: number;
			samples: number[];
			rate: number;
			telemetry: Array<Record<string, number>>;
		};
		console.log(`player-proof: leg ${leg.name} contextRate=${captured.rate} captured=${captured.samples.length}`);
		const cpuLoads = captured.telemetry.map((entry) => entry.cpuLoad ?? -1);
		const overruns = captured.telemetry.map((entry) => entry.overruns ?? -1);
		// Baslined against the capture-window start: cold-start quanta
		// (the first telemetry window) predate steady audio, so only NEW
		// overruns inside the measured 3 s count.
		const baseOverruns = overruns[0] ?? 0;
		const lastOverruns = overruns[overruns.length - 1] ?? -1;
		const newOverruns = lastOverruns - baseOverruns;
		const firstOverrunAt = overruns.findIndex((value) => value > 0);
		const p95s = captured.telemetry.map((entry) => entry.cpuP95 ?? -1).filter((value) => value >= 0);
		const sessionPeaks = captured.telemetry.map((entry) => entry.cpuSessionPeak ?? -1).filter((value) => value >= 0);
		// Per-window comparison: each analyser window aligns independently.
		// The first second is startup (solver state settles from zero
		// while the loop is already running), so only steady-state
		// windows count; the oracle models the same startup, but a
		// transient window correlates best with high-energy steady
		// content and would misalign.
		const chunkFrames = 2048;
		const chunks: number[][] = [];
		for (let offset = 0; offset + chunkFrames <= captured.samples.length; offset += chunkFrames) {
			chunks.push(captured.samples.slice(offset, offset + chunkFrames));
		}
		const steady = chunks.slice(24);
		const tightPerChunk = steady.map((chunk) => alignWindow(chunk, oracle.wasmChain));
		const tsPerChunk = steady.map((chunk) => alignWindow(chunk, oracle.tsRef));
		const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
		const normalizedMaxAbs = Math.max(...tightPerChunk.map((entry) => entry.normalizedMaxAbs));
		const vsTs = Math.max(...tsPerChunk.map((entry) => entry.normalizedMaxAbs));
		const sortedTight = [...tightPerChunk.map((entry) => entry.normalizedMaxAbs)].sort((a, b) => a - b);
		// Diagnose the worst chunk: where inside it do the errors sit?
		let worstDetail = "";
		{
			let worstIdx = 0;
			for (let i = 0; i < tightPerChunk.length; i += 1) {
				if ((tightPerChunk[i]?.normalizedMaxAbs ?? 0) > (tightPerChunk[worstIdx]?.normalizedMaxAbs ?? 0)) {
					worstIdx = i;
				}
			}
			const worst = steady[worstIdx] ?? [];
			const shift = tightPerChunk[worstIdx]?.shift ?? 0;
			const errs: Array<[number, number, number]> = [];
			for (let i = 0; i < worst.length; i += 1) {
				errs.push([i, worst[i] as number, oracle.wasmChain[(shift + i) % oracle.wasmChain.length] as number]);
			}
			errs.sort((a, b) => Math.abs(a[1] - a[2]) - Math.abs(b[1] - b[2]));
			const refPeak = peak(oracle.wasmChain);
			worstDetail =
				`worstChunk=${worstIdx} shift=${shift} top5=` +
				errs.slice(-5).map(([i, a, b]) => `@${i}:${(a - b).toExponential(1)}`).join(",");
		}
		console.log(
			`player-proof: leg ${leg.name} tightDist p50=${sortedTight[Math.floor(sortedTight.length / 2)]?.toExponential(2)} ` +
				`p90=${sortedTight[Math.floor(sortedTight.length * 0.9)]?.toExponential(2)} ${worstDetail} ` +
				`first5=[${tightPerChunk.slice(0, 5).map((entry) => entry.normalizedMaxAbs.toExponential(1)).join(",")}]`,
		);
		// Bounds, stated with their derivation (see the report): the tight
		// bound guards the browser path against the same-console render
		// (float32 capture noise only); the TS bound is the measured
		// console parity for this circuit times five (minimum 2e-3), so the
		// browser must reproduce the console agreement, not beat it.
		const tightBound = 2e-3;
		const tsBound = Math.max(5 * oracle.consoleDelta, 2e-3);
		const silent = captured.peak < 0.05;
		if (process.env.PLAYER_PROOF_DUMP === "1") {
			await Bun.write(
				`/tmp/proof-dump-${leg.name}.json`,
				JSON.stringify({ chunks: steady, wasmChain: Array.from(oracle.wasmChain) }),
			);
		}
		const waveOk = leg.skipWaveform === true || (normalizedMaxAbs <= tightBound && vsTs <= tsBound);
		const overrunOk = leg.harvestOnly === true || newOverruns === 0;
		const pass = !silent && overrunOk && waveOk && cpuLoads.length > 0;
		if (!pass) {
			failures.push(
				`leg failed: peak=${captured.peak.toFixed(4)} newOverruns=${newOverruns} tight=${normalizedMaxAbs.toExponential(2)} (bound ${tightBound}) ts=${vsTs.toExponential(2)} (bound ${tsBound.toExponential(2)})`,
			);
		}
		if (leg.harvestOnly === true) {
			console.log(
				`player-proof: leg ${leg.name} HARVEST peak=${captured.peak.toFixed(4)} rms=${captured.rms.toFixed(4)} ` +
					`cpuLoadMean=${mean(cpuLoads).toFixed(2)} overruns=${lastOverruns} (reported, not gated)`,
			);
		}
		console.log(
			`player-proof: leg ${leg.name} peak=${captured.peak.toFixed(4)} rms=${captured.rms.toFixed(4)} ` +
				`rate=${captured.rate} chunks=${chunks.length} tightMax=${normalizedMaxAbs.toExponential(2)} (<=${tightBound}) ` +
				`vsTsMax=${vsTs.toExponential(2)} (<=${tsBound.toExponential(2)}, consoleDelta=${oracle.consoleDelta.toExponential(2)}) ` +
				`cpuLoadMean=${mean(cpuLoads).toFixed(2)} cpuP95Max=${mean(p95s).toFixed(2)} cpuSessionPeak=${(sessionPeaks[sessionPeaks.length - 1] ?? -1).toFixed(2)} overruns=${lastOverruns} newOverruns=${newOverruns} firstOverrunWindow=${firstOverrunAt} ` +
				`${pass ? "PASS" : "FAIL"}`,
		);
		return { cpuLoads, overruns: lastOverruns, failed: failures.length > 0 };
	} finally {
		const errors = failures.join("; ");
		if (errors !== "") {
			console.log(`player-proof: leg ${leg.name} ERRORS: ${errors}`);
		}
		await page.close();
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const uptime = await (async (): Promise<string> => {
	const proc = Bun.spawnSync(["uptime"]);
	return new TextDecoder().decode(proc.stdout).trim();
})();
console.log(`player-proof: box ${uptime}`);

const legs: Leg[] = [
	{ name: "buffer-pedal", circuit: "buffer", nam: false, ir: false },
	{ name: "fuzz-pedal", circuit: "fuzz", nam: false, ir: false },
	{ name: "buffer-plus-ir", circuit: "buffer", nam: false, ir: true },
	{ name: "buffer-plus-nam", circuit: "buffer", nam: true, ir: false },
	{ name: "phase90-pedal", circuit: "phase", nam: false, ir: false, freezeControls: [{ id: "Speed", value: 0 }], skipWaveform: true, harvestOnly: true },
].filter((leg) => {
	const only = argument("leg");
	return only === undefined || leg.name === only;
});
if (legs.length === 0) {
	console.error(`player-proof: no leg matches --leg=${argument("leg")}`);
	process.exit(1);
}

const CAPTURE_SECONDS = 3.2;
const FRAMES = Math.floor(RATE * CAPTURE_SECONDS);

let failed = false;
const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
	console.log(`player-proof: chromium ${browser.version()}, worklet ${playerWorklet.length} bytes, dsp wasm ${dspWasm.length} bytes, nam wasm ${namWasm.length} bytes`);
	for (const leg of legs) {
		const oracle = await buildOracle(leg, FRAMES);
		console.log(
			`player-proof: leg ${leg.name} oracle scale=${oracle.scale.toFixed(4)} refPeak=${peak(oracle.tsRef).toFixed(4)} ` +
				`consoleDelta=${oracle.consoleDelta.toExponential(2)}`,
		);
		const outcome = await runLeg(browser, leg, oracle);
		if (outcome.failed) {
			failed = true;
		}
	}
} finally {
	await browser.close();
	server.stop(true);
}

if (failed) {
	console.error("player-proof: FAIL");
	process.exit(1);
}
console.log("player-proof: PASS");

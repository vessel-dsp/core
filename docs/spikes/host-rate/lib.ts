// Shared instruments for the host-rate spike (2026-10-10 / 11).
//
// Adapted from docs/spikes/worklet-oversample/lib.ts (the phase-1 patch's harness, which is NOT merged and not
// changed): the same page-per-render worklet harness and the same probe fit, generalised in three ways --
//   * `RenderJob.hostRate`: the OfflineAudioContext, the stimulus and the suspend() times run at that rate
//     (phase 1 hard-coded 48000 in five places inside the page function);
//   * the result carries `ctxRate` (what `ctx.sampleRate` actually was), `renderMs` (wall clock of startRendering)
//     and `crossOriginIsolated`;
//   * `Harness.blocks()`: the real worklet bundle evaluated on the page's main thread behind a stub
//     AudioWorkletGlobalScope and driven in 128-frame blocks with `performance.now()` around every `process()`
//     call (the worklet's own telemetry clock is `Date.now()`, whole milliseconds, which cannot resolve a
//     0.67 ms deadline).
// The server sends COOP/COEP so `crossOriginIsolated` is true and `performance.now()` resolves to 5 us.
//
// Run from a CLONE's root (the root tsconfig maps @vessel-dsp/* to src):
//   NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules bun docs/spikes/host-rate/<script>.ts
// Headless Chromium's OfflineAudioContext renders as fast as the CPU allows. It is NOT a real-time audio thread.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Program } from "@vessel-dsp/compiler";
import { compile, emptyRegistry, pedalPartCatalog } from "@vessel-dsp/compiler";
import { rcLowPass, resistorDivider } from "@vessel-dsp/compiler/fixtures/circuits";
import { ChainRuntime, dacScaleFactor, outputConversionFullScale, programSlot } from "@vessel-dsp/runtime";
import { designHalfBand2x, resampleStageSpec } from "@vessel-dsp/runtime/resample";

export const WB = process.env.WORKBENCH ?? "/home/joseph/projects/VesselDSP/workbench";
export const ART = process.env.ARTIFACTS ?? "/home/joseph/projects/VesselDSP/artifacts";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit === undefined ? fallback : hit.slice(name.length + 3);
}
export const has = (name: string): boolean => process.argv.includes(`--${name}`);
export const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
export const ts = (): string => new Date().toISOString();

// --- the matrix ------------------------------------------------------------------------------------------------------
export type Arm = { name: string; host: number; factor: 1 | 2 | 4; internal: number };
const mk = (host: number, factor: 1 | 2 | 4): Arm => ({
	name: `${host / 1000}k ${factor === 1 ? "x1" : `os${factor}`}`,
	host,
	factor,
	internal: host * factor,
});
export const ARMS: Arm[] = [mk(48000, 1), mk(48000, 2), mk(48000, 4), mk(96000, 1), mk(96000, 2), mk(96000, 4), mk(192000, 1), mk(192000, 2)];
export const armByName = (name: string): Arm => {
	const a = ARMS.find((x) => x.name === name);
	if (a === undefined) throw new Error(`unknown arm ${name}; have ${ARMS.map((x) => x.name).join(", ")}`);
	return a;
};
export const selectArms = (spec: string): Arm[] => (spec === "all" ? ARMS : spec.split(",").map(armByName));

// --- pedals under test (netlists read-only; controls per the task) ------------------------------------------------------
export type PedalSpec = { file: string; controls: Record<string, number> };
const std = { Drive: 0.5, Tone: 0.5, Level: 0.3 };
export const PEDALS: Record<string, PedalSpec> = {
	muff: {
		file: `${WB}/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp`,
		controls: { SUSTAIN: 0.5, TONE: 0.5, VOLUME: 0.3 },
	},
	sd1: { file: `${WB}/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp`, controls: std },
	ts9: { file: `${ART}/schematics/vessel-dsp/ibanez-ts9-reissue.vdsp`, controls: std },
};
export const PEDAL_NAMES = ["muff", "sd1", "ts9"] as const;

export function compileFile(file: string): Program {
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog } as never) as { status: string; program: Program };
	if (r.status !== "ok") throw new Error(`${file} did not compile`);
	return r.program;
}
/** A Program as plain JSON, the way it crosses the worklet port. */
export function loadPedal(name: string): { program: Program; json: unknown; controls: Record<string, number> } {
	const spec = PEDALS[name];
	if (spec === undefined) throw new Error(`unknown pedal ${name}`);
	const program = compileFile(spec.file);
	const ids = new Set(program.controls.map((c) => String(c.id)));
	for (const id of Object.keys(spec.controls)) {
		if (!ids.has(id)) throw new Error(`${name}: control ${id} not in ${[...ids].join(",")}`);
	}
	return { program, json: JSON.parse(JSON.stringify(program)), controls: spec.controls };
}
export const controlMessages = (name: string, slot = 0): { slot: number; id: string; position: number }[] =>
	Object.entries(PEDALS[name]!.controls).map(([id, position]) => ({ slot, id, position }));

/** The linear resistor divider (gain 0.5) and the RC low pass (R = 10 k, C = 10 nF, corner 1591.5 Hz): fixtures with a closed form. */
export function loadFixture(which: "divider" | "rc"): { program: Program; json: unknown } {
	const r = compile(which === "divider" ? resistorDivider : rcLowPass, { registry: emptyRegistry }) as { status: string; program: Program };
	if (r.status !== "ok") throw new Error(`${which} did not compile`);
	return { program: r.program, json: JSON.parse(JSON.stringify(r.program)) };
}
export const loadDivider = () => loadFixture("divider");
export const DIVIDER_GAIN = 0.5;
export const RC_R = 10_000;
export const RC_C = 10e-9;

/** The DAC scale the worklet applies to a one-program chain: same function, same program. */
export const dacScaleOf = (program: Program): number => dacScaleFactor(outputConversionFullScale(program));

// --- stimulus (one function, shipped to the page as source so both sides synthesize alike) ---------------------------------
export type Spec =
	| { kind: "sine"; hz: number; amp: number }
	| { kind: "multisine"; tones: { hz: number; amp: number }[] }
	| { kind: "impulse"; at: number; amp: number }
	| { kind: "array"; data: number[] };

/** Plain JS on purpose: `synth.toString()` is evaluated inside the page. */
export function synth(spec: any, n: number, rate: number): Float64Array {
	const out = new Float64Array(n);
	if (spec.kind === "sine") {
		for (let i = 0; i < n; i += 1) out[i] = spec.amp * Math.sin((2 * Math.PI * spec.hz * i) / rate);
	} else if (spec.kind === "multisine") {
		for (const t of spec.tones) {
			for (let i = 0; i < n; i += 1) out[i] += t.amp * Math.sin((2 * Math.PI * t.hz * i) / rate);
		}
	} else if (spec.kind === "impulse") {
		out[spec.at] = spec.amp;
	} else {
		for (let i = 0; i < n; i += 1) out[i] = spec.data[i] ?? 0;
	}
	return out;
}

// --- the browser leg ---------------------------------------------------------------------------------------------------------
export type Slot = { kind: "program"; program: unknown; bypassMode?: string };
export type RenderJob = {
	slots: Slot[];
	wasm: boolean;
	/** Host (context) rate in Hz; default 48000. */
	hostRate?: number;
	/** Omitted => the `oversample` key is absent from the load message (the default path, factor 1). */
	oversample?: unknown;
	controls?: { slot: number; id: string; position: number }[];
	input: Spec;
	samples: number;
	events?: { atSample: number; messages: Record<string, unknown>[] }[];
};
export type RenderResult = {
	samples: Float32Array;
	loaded: any[];
	errors: string[];
	telemetry: any[];
	log: string[];
	ctxRate: number;
	renderMs: number;
	crossOriginIsolated: boolean;
};
export type BlockJob = {
	slots: Slot[];
	wasm: boolean;
	hostRate: number;
	oversample?: unknown;
	controls?: { slot: number; id: string; position: number }[];
	input: Spec;
	/** Blocks of 128 frames discarded, then measured. */
	warmupBlocks: number;
	blocks: number;
};
export type BlockResult = {
	times: number[];
	loaded: any[];
	errors: string[];
	crossOriginIsolated: boolean;
	timerResolutionUs: number;
	/** Peak abs of the last output block (a render that produced nothing would read 0). */
	lastBlockPeak: number;
	telemetry: any[];
};
export type Harness = {
	render(job: RenderJob): Promise<RenderResult>;
	blocks(job: BlockJob): Promise<BlockResult>;
	/** Run arbitrary page code on a blank page of the same origin (live-context probe etc). */
	page<T>(fn: (a: any) => Promise<T>, a?: unknown): Promise<T>;
	version: string;
	bundleSha: string;
	wasmSha: string;
	close(): Promise<void>;
};

export async function openHarness(options: { bundle: string; wasm: string; port: number; extraArgs?: string[] }): Promise<Harness> {
	let playwright: typeof import("playwright-core");
	try {
		playwright = await import("playwright-core");
	} catch {
		throw new Error("cannot resolve playwright-core: set NODE_PATH=<workbench>/node_modules");
	}
	const bundleBytes = readFileSync(options.bundle);
	const wasmBytes = readFileSync(options.wasm);
	const isolation = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" };
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: options.port,
		fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/v2-audio-worklet.js") {
				return new Response(bundleBytes, { headers: { ...isolation, "content-type": "text/javascript", "cross-origin-resource-policy": "same-origin" } });
			}
			if (path === "/v2_dsp.wasm") {
				return new Response(wasmBytes, { headers: { ...isolation, "content-type": "application/wasm", "cross-origin-resource-policy": "same-origin" } });
			}
			return new Response("<!doctype html><title>host rate</title>", { headers: { ...isolation, "content-type": "text/html" } });
		},
	});
	const browser = await playwright.chromium.launch({
		headless: true,
		args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", ...(options.extraArgs ?? [])],
	});
	const synthSource = synth.toString();
	return {
		version: `chromium ${browser.version()}`,
		bundleSha: sha(bundleBytes),
		wasmSha: sha(wasmBytes),
		async close() {
			await browser.close();
			server.stop(true);
		},
		async page<T>(fn: (a: any) => Promise<T>, a?: unknown): Promise<T> {
			const page = await browser.newPage();
			try {
				await page.goto(`http://127.0.0.1:${options.port}/`);
				return (await page.evaluate(fn as never, a as never)) as T;
			} finally {
				await page.close();
			}
		},
		async render(job: RenderJob): Promise<RenderResult> {
			const page = await browser.newPage();
			try {
				await page.goto(`http://127.0.0.1:${options.port}/`);
				// NOTE: plain JS in this function; playwright ships `fn.toString()` to the page.
				return (await page.evaluate(
					async (a: any) => {
						const log: string[] = [];
						const errors: string[] = [];
						const loaded: any[] = [];
						const telemetry: any[] = [];
						const H: number = a.job.hostRate;
						const synthFn = new Function(`return (${a.synthSource})`)();
						const wasmBytesLocal = a.job.wasm ? await (await fetch("/v2_dsp.wasm")).arrayBuffer() : null;
						const ctx = new OfflineAudioContext(1, a.job.samples, a.job.ctxRate);
						await ctx.audioWorklet.addModule("/v2-audio-worklet.js");
						const node = new AudioWorkletNode(ctx, "v2-pedal-processor");
						let waiter: null | ((m: any) => void) = null;
						node.port.onmessage = (event: MessageEvent) => {
							const msg = event.data;
							if (msg.type === "telemetry") {
								telemetry.push(msg);
								return;
							}
							if (msg.type === "error" && typeof msg.message === "string" && msg.message.includes("no slot 99999")) {
								if (waiter) {
									const w = waiter;
									waiter = null;
									w(msg);
								}
								return;
							}
							if (msg.type === "loaded") loaded.push(msg);
							else if (msg.type === "error") errors.push(msg.message);
							if (waiter && (msg.type === "loaded" || msg.type === "error")) {
								const w = waiter;
								waiter = null;
								w(msg);
							}
						};
						const nextMessage = (timeoutMs: number) =>
							new Promise<any>((resolve, reject) => {
								const timer = setTimeout(() => {
									waiter = null;
									reject(new Error("timed out waiting for the worklet"));
								}, timeoutMs);
								waiter = (m) => {
									clearTimeout(timer);
									resolve(m);
								};
							});
						const withBytes = (m: any) => {
							const copy = Object.assign({}, m);
							if (copy.wasmConsole === "__bytes__") copy.wasmConsole = { wasmBytes: wasmBytesLocal };
							return copy;
						};
						const post = async (m: any) => {
							const isLoad = m.type === "load";
							const waitFor = nextMessage(60000);
							node.port.postMessage(isLoad ? withBytes(m) : m);
							if (isLoad) return waitFor;
							// A barrier: a setControl on a slot that cannot exist always answers with an error, and port
							// messages are handled in order, so its reply proves every earlier message was handled.
							node.port.postMessage({ type: "setControl", slot: 99999, id: "__barrier__", position: 0 });
							return waitFor;
						};
						const initial: any = { type: "load", slots: a.job.slots };
						if (a.job.wasm) initial.wasmConsole = "__bytes__";
						if (a.job.hasOversample) initial.oversample = a.job.oversample;
						await post(initial);
						for (const c of a.job.controls || []) {
							await post({ type: "setControl", slot: c.slot, id: c.id, position: c.position });
						}
						const stim = synthFn(a.job.input, a.job.samples, H);
						const source = ctx.createBufferSource();
						const buffer = ctx.createBuffer(1, a.job.samples, a.job.ctxRate);
						buffer.getChannelData(0).set(stim);
						source.buffer = buffer;
						source.connect(node);
						node.connect(ctx.destination);
						source.start(0);
						for (const ev of a.job.events || []) {
							ctx
								.suspend(ev.atSample / a.job.ctxRate)
								.then(async () => {
									try {
										for (const m of ev.messages) await post(m);
									} catch (error) {
										log.push(`event at ${ev.atSample}: ${String(error)}`);
									}
									ctx.resume();
								})
								.catch((error: unknown) => log.push(`suspend ${ev.atSample}: ${String(error)}`));
						}
						const t0 = performance.now();
						const rendered = await ctx.startRendering();
						const renderMs = performance.now() - t0;
						return {
							samples: Array.from(rendered.getChannelData(0)),
							loaded,
							errors,
							telemetry,
							log,
							ctxRate: ctx.sampleRate,
							renderMs,
							crossOriginIsolated: self.crossOriginIsolated === true,
						};
					},
					{
						synthSource,
						job: {
							slots: job.slots,
							wasm: job.wasm,
							hostRate: job.hostRate ?? 48000,
							ctxRate: job.hostRate ?? 48000,
							hasOversample: "oversample" in job,
							oversample: job.oversample,
							controls: job.controls,
							input: job.input,
							samples: job.samples,
							events: job.events,
						},
					},
				)) as unknown as RenderResult;
			} finally {
				await page.close();
			}
		},
		async blocks(job: BlockJob): Promise<BlockResult> {
			const page = await browser.newPage();
			try {
				await page.goto(`http://127.0.0.1:${options.port}/`);
				return (await page.evaluate(
					async (a: any) => {
						const H: number = a.job.hostRate;
						const synthFn = new Function(`return (${a.synthSource})`)();
						const source = await (await fetch("/v2-audio-worklet.js")).text();
						const wasmBytesLocal = a.job.wasm ? await (await fetch("/v2_dsp.wasm")).arrayBuffer() : null;
						const posted: any[] = [];
						let Ctor: any = null;
						class FakeProcessor {
							port: any;
							constructor() {
								this.port = { onmessage: null, postMessage: (m: any) => posted.push(m) };
							}
						}
						(globalThis as any).sampleRate = H;
						// The bundle has no import/export: its last statement is registerProcessor(name, class).
						new Function("AudioWorkletProcessor", "registerProcessor", source)(FakeProcessor, (_n: string, c: any) => {
							Ctor = c;
						});
						const proc = new Ctor();
						const msg: any = { type: "load", slots: a.job.slots };
						if (a.job.wasm) msg.wasmConsole = { wasmBytes: wasmBytesLocal };
						if (a.job.hasOversample) msg.oversample = a.job.oversample;
						proc.port.onmessage({ data: msg });
						const t0 = Date.now();
						while (!posted.some((m) => m.type === "loaded" || m.type === "error")) {
							if (Date.now() - t0 > 120000) throw new Error("timed out waiting for loaded");
							await new Promise((r) => setTimeout(r, 5));
						}
						for (const c of a.job.controls || []) proc.port.onmessage({ data: { type: "setControl", slot: c.slot, id: c.id, position: c.position } });
						const total = a.job.warmupBlocks + a.job.blocks;
						const stim = synthFn(a.job.input, total * 128, H);
						const inBuf = new Float32Array(128);
						const outBuf = new Float32Array(128);
						const inputs = [[inBuf]];
						const outputs = [[outBuf]];
						const times = new Float64Array(a.job.blocks);
						let lastPeak = 0;
						// timer resolution: smallest nonzero step over many back-to-back reads
						let res = Infinity;
						for (let i = 0; i < 20000; i += 1) {
							const x = performance.now();
							let y = performance.now();
							while (y === x) y = performance.now();
							res = Math.min(res, y - x);
						}
						for (let b = 0; b < total; b += 1) {
							for (let i = 0; i < 128; i += 1) inBuf[i] = stim[b * 128 + i];
							const s = performance.now();
							proc.process(inputs, outputs, {});
							const e = performance.now();
							if (b >= a.job.warmupBlocks) times[b - a.job.warmupBlocks] = e - s;
							if (b === total - 1) {
								for (let i = 0; i < 128; i += 1) lastPeak = Math.max(lastPeak, Math.abs(outBuf[i]));
							}
						}
						return {
							times: Array.from(times),
							loaded: posted.filter((m) => m.type === "loaded"),
							errors: posted.filter((m) => m.type === "error").map((m) => m.message),
							crossOriginIsolated: self.crossOriginIsolated === true,
							timerResolutionUs: res * 1000,
							lastBlockPeak: lastPeak,
							telemetry: posted.filter((m) => m.type === "telemetry").slice(-1),
						};
					},
					{
						synthSource,
						job: {
							slots: job.slots,
							wasm: job.wasm,
							hostRate: job.hostRate,
							hasOversample: "oversample" in job,
							oversample: job.oversample,
							controls: job.controls,
							input: job.input,
							warmupBlocks: job.warmupBlocks,
							blocks: job.blocks,
						},
					},
				)) as unknown as BlockResult;
			} finally {
				await page.close();
			}
		},
	};
}

/** `samples` arrives from the page as a plain array of float32 values. */
export const f32 = (result: RenderResult): Float32Array => Float32Array.from(result.samples as unknown as number[]);

export function bitsEqual(a: ArrayLike<number>, b: ArrayLike<number>): { equal: boolean; firstDiff: number; maxAbs: number } {
	let firstDiff = -1;
	let maxAbs = 0;
	if (a.length !== b.length) return { equal: false, firstDiff: 0, maxAbs: Number.POSITIVE_INFINITY };
	for (let i = 0; i < a.length; i += 1) {
		if (Object.is(a[i], b[i])) continue;
		if (firstDiff < 0) firstDiff = i;
		maxAbs = Math.max(maxAbs, Math.abs((a[i] as number) - (b[i] as number)));
	}
	return { equal: firstDiff < 0, firstDiff, maxAbs };
}

// --- the probe's measurement (phase-1 lib.ts, line for line; generalised only by taking the rate from the caller) ----------------
function lsFit(x: Float64Array, fs: number, f0: number, nh: number) {
	const n = x.length;
	const m = 1 + 2 * nh;
	const cols: Float64Array[] = [new Float64Array(n).fill(1)];
	for (let h = 1; h <= nh; h++) {
		const c = new Float64Array(n);
		const s = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			const p = (2 * Math.PI * f0 * h * i) / fs;
			c[i] = Math.cos(p);
			s[i] = Math.sin(p);
		}
		cols.push(c, s);
	}
	const A = Array.from({ length: m }, () => new Float64Array(m + 1));
	for (let a = 0; a < m; a++) {
		for (let b = a; b < m; b++) {
			let t = 0;
			const ca = cols[a]!;
			const cb = cols[b]!;
			for (let i = 0; i < n; i++) t += ca[i]! * cb[i]!;
			A[a]![b] = t;
			A[b]![a] = t;
		}
		let t = 0;
		const ca = cols[a]!;
		for (let i = 0; i < n; i++) t += ca[i]! * x[i]!;
		A[a]![m] = t;
	}
	for (let i = 0; i < m; i++) {
		let p = i;
		for (let r = i + 1; r < m; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
		[A[i], A[p]] = [A[p]!, A[i]!];
		for (let r = i + 1; r < m; r++) {
			const f = A[r]![i]! / A[i]![i]!;
			for (let c = i; c <= m; c++) A[r]![c]! -= f * A[i]![c]!;
		}
	}
	const coef = new Float64Array(m);
	for (let i = m - 1; i >= 0; i--) {
		let t = A[i]![m]!;
		for (let c = i + 1; c < m; c++) t -= A[i]![c]! * coef[c]!;
		coef[i] = t / A[i]![i]!;
	}
	let resid = 0;
	for (let i = 0; i < n; i++) {
		let y = 0;
		for (let k = 0; k < m; k++) y += coef[k]! * cols[k]![i]!;
		const e = x[i]! - y;
		resid += e * e;
	}
	return {
		fund: Math.hypot(coef[1]!, coef[2]!),
		phase: Math.atan2(-coef[1]!, coef[2]!),
		a: coef[1]!,
		b: coef[2]!,
		resid: Math.sqrt(resid / n),
		harm: Array.from({ length: nh }, (_, h) => Math.hypot(coef[1 + 2 * h]!, coef[2 + 2 * h]!)),
	};
}

export const SETTLE = 0.5;
export const LEN = 1.5;
export const RENDER_SECONDS = 2.0;

/** The probe's window: 0.9..1.7 s of a 2.0 s render (0.4 s ramp margin + SETTLE). */
export function fitFundamental(out: ArrayLike<number>, hostRate: number, hz: number): { fund: number; resid: number } {
	const WIN0 = 0.4 + SETTLE;
	const WIN1 = 1.2 + SETTLE;
	const w = Float64Array.from(
		{ length: Math.floor(WIN1 * hostRate) - Math.floor(WIN0 * hostRate) },
		(_, i) => out[Math.floor(WIN0 * hostRate) + i] as number,
	);
	let best = { f: hz, r: Number.POSITIVE_INFINITY };
	const nh = Math.max(1, Math.min(8, Math.floor(hostRate / 2 / hz) - 1));
	const dec = Math.max(1, Math.floor(hostRate / (8 * hz * nh)));
	const wd = Float64Array.from({ length: Math.floor(w.length / dec) }, (_, i) => w[i * dec]!);
	for (let k = -4; k <= 4; k++) {
		const f = hz + k * 0.25;
		const r = lsFit(wd, hostRate / dec, f, 1).resid;
		if (r < best.r) best = { f, r };
	}
	const fit = lsFit(w, hostRate, best.f, nh);
	return { fund: fit.fund, resid: fit.resid };
}
export function phaseAt(out: ArrayLike<number>, hostRate: number, hz: number, start: number, periods: number): { amp: number; phase: number } {
	const len = Math.round((periods * hostRate) / hz);
	const w = Float64Array.from({ length: len }, (_, i) => out[start + i] as number);
	const fit = lsFit(w, hostRate, hz, 1);
	return { amp: fit.fund, phase: fit.phase };
}
export const db = (ratio: number): number => 20 * Math.log10(ratio);

/** Rising zero crossings of a window, and the frequency they imply. */
export function zeroCrossingHz(out: ArrayLike<number>, hostRate: number, from: number, to: number): { crossings: number; hz: number } {
	let n = 0;
	let first = -1;
	let last = -1;
	for (let i = Math.max(1, from); i < to; i += 1) {
		const a = out[i - 1] as number;
		const b = out[i] as number;
		if (a < 0 && b >= 0) {
			const t = i - 1 + -a / (b - a); // linear interpolation of the crossing instant
			if (first < 0) first = t;
			last = t;
			n += 1;
		}
	}
	return { crossings: n, hz: n > 1 ? ((n - 1) * hostRate) / (last - first) : 0 };
}

// --- native references --------------------------------------------------------------------------------------------------------
/** Block size the reference renders feed ChainRuntime in (phase 1: 512; ChainRuntime is block-size invariant). */
const NATIVE_BLOCK = 512;

/** The whole native render as Float64 (post-DAC-scale) so callers can fit or hash it. */
export function nativeRender(name: string, hz: number, mv: number, rate: number, seconds = SETTLE + LEN): Float64Array {
	const { program, controls } = loadPedal(name);
	const chain = new ChainRuntime([programSlot(program)]);
	chain.prepare(rate);
	for (const [id, position] of Object.entries(controls)) chain.setControl(0, id as never, position);
	const n = Math.round(rate * seconds);
	const input = synth({ kind: "sine", hz, amp: mv / 1000 }, n, rate);
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += NATIVE_BLOCK) out.set(chain.process(input.subarray(i, Math.min(n, i + NATIVE_BLOCK))), i);
	const scale = dacScaleOf(program);
	return Float64Array.from(out, (v) => v * scale);
}

/** Fundamental (volts at the DAC, after the worklet's scale) of a chain rendered natively at `rate`; cached in a JSON file. */
export function nativeFundamental(name: string, hz: number, mv: number, rate: number, cachePath: string): number {
	const key = `${name}|${hz}|${mv}|${rate}`;
	let cache: Record<string, number> = {};
	if (existsSync(cachePath)) cache = JSON.parse(readFileSync(cachePath, "utf8"));
	if (cache[key] !== undefined) return cache[key] as number;
	const fit = fitFundamental(nativeRender(name, hz, mv, rate), rate, hz);
	// re-read: another process may have written other keys meanwhile (one cache file per process is the rule; this is belt and braces)
	if (existsSync(cachePath)) cache = { ...JSON.parse(readFileSync(cachePath, "utf8")), ...cache };
	cache[key] = fit.fund;
	writeFileSync(cachePath, JSON.stringify(cache, null, 1));
	return fit.fund;
}

// --- load gate and JSONL ------------------------------------------------------------------------------------------------------
export const load1 = (): number => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
let budgetMs = 20 * 60 * 1000;
/** Wait for the 1-minute load average below `maxLoad` while this series' single 20-minute budget lasts; report the reading proceeded at. */
export async function waitIdle(maxLoad = 1.5): Promise<{ before: number; waitedS: number; atBar: boolean }> {
	const t0 = Date.now();
	let l = load1();
	while (l >= maxLoad && budgetMs > 0) {
		await Bun.sleep(10_000);
		budgetMs -= 10_000;
		l = load1();
	}
	return { before: l, waitedS: Math.round((Date.now() - t0) / 1000), atBar: l < maxLoad };
}
export const jsonl = (path: string, row: unknown): void => appendFileSync(path, `${JSON.stringify(row)}\n`);
export const readJsonl = <T = any>(path: string): T[] =>
	existsSync(path)
		? readFileSync(path, "utf8")
				.split("\n")
				.filter((l) => l.trim() !== "")
				.map((l) => JSON.parse(l) as T)
		: [];
export const uptimeLine = (): string => bun(["uptime"]);
export const bun = (cmd: string[]): string => {
	const r = Bun.spawnSync(cmd);
	return `${r.stdout.toString()}${r.stderr.toString()}`.trim();
};
export const defaultBundle = (): string => `${process.cwd()}/packages/runtime/dist/worklet/v2-audio-worklet.js`;
export const defaultWasm = (): string => `${process.cwd()}/packages/runtime/dist/wasm/v2_dsp.wasm`;
export const stats = (xs: number[]): { n: number; mean: number; p50: number; p99: number; p999: number; max: number } => {
	const s = [...xs].sort((a, b) => a - b);
	const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
	return { n: s.length, mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), p50: q(0.5), p99: q(0.99), p999: q(0.999), max: s[s.length - 1] as number };
};

// --- the resampler's own response: a CALCULATION on the stage coefficients (the same one predict.ts printed before any render) -----------
function halfBandMag(taps: number, beta: number, f: number, stageRate: number): number {
	const h = designHalfBand2x(taps, beta);
	let re = 0;
	let im = 0;
	for (let k = 0; k < h.length; k += 1) {
		const ph = (2 * Math.PI * f * k) / stageRate;
		re += (h[k] as number) * Math.cos(ph);
		im -= (h[k] as number) * Math.sin(ph);
	}
	return Math.hypot(re, im);
}
/** Net amplitude response, dB, of interpolate-then-decimate through every stage at host rate H and factor N (|H|^2 per stage; 0 at x1). */
export function resamplerNetDb(f: number, H: number, N: number): number {
	let total = 0;
	for (let s = 0; s < Math.log2(N); s += 1) {
		const [taps, beta] = resampleStageSpec(s);
		total += 2 * 20 * Math.log10(halfBandMag(taps, beta, f, H * 2 ** (s + 1)));
	}
	return total;
}

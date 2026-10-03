// The real player engine: pedal + optional NAM + optional IR in the
// browser on WebAssembly, behind the existing `PlayerEngine` seam.
//
// Lazy by construction: creating the engine (and the factory that makes
// it) touches no network and no audio API. Circuit-text fetch plus compile
// run at `load()` so `ready` and the control list precede any gesture (the
// controller cannot leave `loading` otherwise, and `play()` outside `ready`
// is refused). Everything audio -- the `AudioContext`, the worklet module,
// both wasm binaries, the NAM glue probe, input WAV bytes, NAM text, and IR
// audio bytes -- waits for the first `play()` gesture, in section 5 order:
// create the context, `addModule` the worklet, fetch the wasm bytes (the
// NAM engine's only when a NAM is selected), post `load`, then start.
//
// All browser APIs arrive through constructor options with lazy
// `globalThis` defaults, so this module never reads a global at import
// time: importing it in Node (or rendering it server-side) is safe, and
// unit tests inject fakes. Optional engine-level extras beyond the seam
// (`setBypassMode`, `setInputGainDb`, `getAnalyserNode`) are plain extra
// methods: fakes written against `PlayerEngine` keep working unchanged.

import { compile, pedalPartCatalog, type PartRegistry, type Program } from "@vessel-dsp/compiler";
import {
	admissionVerdict,
	calibrateNsPerSolve,
	denseLinearSolveWorkload,
	postV2WorkletMessage,
	predictedWorstCaseNs,
	V2WasmEngine,
	type V2WorkletSlot,
} from "@vessel-dsp/runtime";
import {
	CabinetIrNode,
	instantiateNamEngine,
	loadNamModel,
	type NamEngineModule,
} from "@vessel-dsp/chain";
import { downmixToMono, loadWavInput } from "../inputs/wav.js";
import { browserAudioConstraints } from "../inputs/browser.js";
import { loadIr } from "../ir/load.js";
import { isNamLoadError, loadNam } from "../nam/load.js";
import type { NamProbeFn } from "../nam/types.js";
import { isSafeSrc } from "../source-list.js";
import {
	PlayerError,
	type InputChoiceDescriptor,
	type IrDescriptor,
	type NamDescriptor,
	type PlayerControlInfo,
	type PlayerEngine,
	type PlayerEngineEventName,
	type SourceItem,
} from "../types.js";
import { resolvePlayerAssetUrls, type PlayerAssetUrls } from "./asset-urls.js";
import { createChainNamProbe } from "./chain-probe.js";
import { playerWorkletProcessorName } from "./processor-name.js";

export type EngineFetchResponse = {
	readonly ok: boolean;
	readonly status: number;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
};

export type EngineFetchFn = (src: string) => Promise<EngineFetchResponse>;

export type RealPlayerEngineOptions = {
	readonly fetch?: EngineFetchFn;
	readonly createAudioContext?: (options: { readonly sampleRate?: number }) => AudioContext;
	readonly createWorkletNode?: (context: AudioContext, name: string) => AudioWorkletNode;
	readonly decodeAudioData?: (data: ArrayBuffer) => Promise<AudioBuffer>;
	readonly mediaDevices?: {
		getUserMedia(constraints: unknown): Promise<MediaStream>;
	} | null;
	readonly micDeviceId?: string;
	readonly workletUrl?: string;
	readonly dspWasmUrl?: string;
	readonly namWasmUrl?: string;
	readonly namGlueUrl?: string;
	/** Precompiled Program (object or JSON) to skip fetching and compiling. */
	readonly program?: Program | string;
	readonly registry?: PartRegistry;
	/** Pickable WAV inputs; the default input is the first entry. */
	readonly inputs?: readonly SourceItem[];
	readonly inputGainDb?: number;
	readonly bypassMode?: "wire" | "buffer" | "effect";
	/** Injected NAM probe (chain-built); default is built lazily from chain. */
	readonly probeNam?: NamProbeFn;
	/** Injected nanosecond clock for calibration; default wraps performance.now. */
	readonly now?: () => number;
};

type LoadedChain = {
	readonly program: Program;
	readonly controls: readonly PlayerControlInfo[];
};

function defaultFetch(src: string): Promise<EngineFetchResponse> {
	return globalThis.fetch(src) as Promise<EngineFetchResponse>;
}

function defaultCreateAudioContext(options: { readonly sampleRate?: number }): AudioContext {
	return new AudioContext(
		options.sampleRate === undefined
			? { latencyHint: "interactive" }
			: { sampleRate: options.sampleRate, latencyHint: "interactive" },
	);
}

function defaultNowNs(): number {
	return performance.now() * 1e6;
}

function dbToLinear(db: number): number {
	return 10 ** (db / 20);
}

// A WebAssembly binary starts with the magic `\0asm`; anything else fails
// `WebAssembly.instantiate` with a CompileError the glue cannot surface,
// so refuse it here instead of hanging the measurement on it.
function isWasmBinary(bytes: ArrayBuffer): boolean {
	if (bytes.byteLength < 4) {
		return false;
	}
	const prefix = new Uint8Array(bytes, 0, 4);
	return prefix[0] === 0x00 && prefix[1] === 0x61 && prefix[2] === 0x73 && prefix[3] === 0x6d;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

// Map a NAM/IR/input load rejection onto the typed surface. A NamLoadError
// keeps its reason 1:1 (the NAM reasons are a subset of PlayerErrorReason);
// a PlayerError passes through; anything else becomes load-failed.
function toPlayerError(unknown: unknown, fallback: string): PlayerError {
	if (unknown instanceof PlayerError) {
		return unknown;
	}
	if (isNamLoadError(unknown)) {
		return new PlayerError(unknown.reason as PlayerError["reason"], unknown.message, {
			src: unknown.src,
			status: unknown.status,
			expectedSampleRate: unknown.expectedSampleRate,
			contextSampleRate: unknown.contextSampleRate,
		});
	}
	const message = unknown instanceof Error ? unknown.message : String(unknown);
	return new PlayerError("load-failed", `${fallback}: ${message}`);
}

export class RealPlayerEngine implements PlayerEngine {
	private readonly options: RealPlayerEngineOptions;
	private readonly assetUrls: { workletUrl: string; dspWasmUrl: string; namWasmUrl: string; namGlueUrl: string };
	private readonly listeners = new Map<PlayerEngineEventName, Set<(payload?: unknown) => void>>();
	private chain: LoadedChain | null = null;
	private vdspSource: string | null = null;
	private context: AudioContext | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private analyser: AnalyserNode | null = null;
	private inputGain: GainNode | null = null;
	private activeSources: AudioScheduledSourceNode[] = [];
	private mediaStream: MediaStream | null = null;
	private audioStarted = false;
	private disposed = false;
	private inputChoice: InputChoiceDescriptor | null = null;
	private namSelection: NamDescriptor | null = null;
	private irSelection: IrDescriptor | null = null;
	private pendingControls = new Map<string, number>();
	private probePromise: Promise<NamProbeFn> | null = null;
	private dspModulePromise: Promise<unknown> | null = null;
	private loadAwaiters: Array<{
		resolve: (info: { controls: Array<{ slot: number; id: string }> }) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}> = [];

	constructor(options: RealPlayerEngineOptions = {}) {
		this.options = options;
		this.assetUrls = resolvePlayerAssetUrls(options, import.meta.url);
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

	load(source: { readonly vdsp: string; readonly program?: unknown }): void | Promise<void> {
		return this.doLoad(source);
	}

	start(): void | Promise<void> {
		return this.doStart();
	}

	stop(): void | Promise<void> {
		if (this.disposed || !this.audioStarted) {
			return;
		}
		return this.doStop();
	}

	setControl(id: string, value: number): void {
		this.throwIfDisposed();
		if (!Number.isFinite(value)) {
			throw new PlayerError("invalid-control-value", `Control "${id}" needs a finite number.`);
		}
		const chain = this.chain;
		if (chain === null) {
			throw new PlayerError("load-failed", "No program is loaded for this control change.");
		}
		const known = chain.controls.find((control) => control.id === id);
		if (known === undefined) {
			throw new PlayerError("unknown-control", `Unknown control "${id}".`);
		}
		const position = clamp01((value - known.min) / (known.max - known.min));
		this.pendingControls.set(id, position);
		if (this.workletNode !== null) {
			postV2WorkletMessage(this.workletNode.port, { type: "setControl", slot: 0, id, position });
		}
	}

	setInput(choice: InputChoiceDescriptor): void {
		this.throwIfDisposed();
		this.inputChoice = choice;
		if (this.audioStarted) {
			void this.rebuildAfterSelection().catch((error: unknown) => {
				this.emit("error", toPlayerError(error, "Rebuilding the chain after the input change failed"));
			});
		}
	}

	setNam(model: NamDescriptor | null): void {
		this.throwIfDisposed();
		this.namSelection = model;
		if (this.audioStarted) {
			void this.rebuildAfterSelection().catch((error: unknown) => {
				this.emit("error", toPlayerError(error, "Rebuilding the chain after the NAM change failed"));
			});
		}
	}

	setIr(ir: IrDescriptor | null): void {
		this.throwIfDisposed();
		this.irSelection = ir;
		if (this.audioStarted) {
			void this.rebuildAfterSelection().catch((error: unknown) => {
				this.emit("error", toPlayerError(error, "Rebuilding the chain after the IR change failed"));
			});
		}
	}

	/** Engine-level bypass control (slot 0): posts `setBypassMode` when audio runs. */
	setBypassMode(mode: "wire" | "buffer" | "effect"): void {
		this.throwIfDisposed();
		if (this.workletNode !== null) {
			postV2WorkletMessage(this.workletNode.port, { type: "setBypassMode", slot: 0, mode });
		}
	}

	/** Engine-level input trim in dB, applied at the input gain node when audio runs. */
	setInputGainDb(gainDb: number): void {
		this.throwIfDisposed();
		if (!Number.isFinite(gainDb)) {
			throw new PlayerError("invalid-control-value", "Input gain needs a finite number of dB.");
		}
		if (this.inputGain !== null && this.context !== null) {
			this.inputGain.gain.setValueAtTime(dbToLinear(gainDb), this.context.currentTime);
		}
	}

	/** The post-worklet analyser for host visualization, or null before start. */
	getAnalyserNode(): AnalyserNode | null {
		return this.analyser;
	}

	/** The context sample rate, or null before the first gesture created it. */
	getContextSampleRate(): number | null {
		return this.context?.sampleRate ?? null;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		const awaiters = this.loadAwaiters;
		this.loadAwaiters = [];
		const gone = new PlayerError("disposed", "This player engine was disposed.");
		for (const waiter of awaiters) {
			clearTimeout(waiter.timer);
			waiter.reject(gone);
		}
		for (const source of this.activeSources) {
			try {
				source.stop();
			} catch {
				// Already stopped: dispose must not throw.
			}
		}
		this.activeSources = [];
		for (const track of this.mediaStream?.getTracks() ?? []) {
			track.stop();
		}
		for (const track of this.mediaStream?.getTracks() ?? []) {
			track.stop();
		}
		this.mediaStream = null;
		const context = this.context;
		this.context = null;
		this.workletNode = null;
		this.analyser = null;
		this.inputGain = null;
		this.audioStarted = false;
		this.listeners.clear();
		if (context !== null) {
			void context.close().catch(() => {});
		}
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new PlayerError("disposed", "This player engine was disposed.");
		}
	}

	private emit(event: PlayerEngineEventName, payload?: unknown): void {
		for (const listener of [...(this.listeners.get(event) ?? [])]) {
			listener(payload);
		}
	}

	private async doLoad(source: { readonly vdsp: string; readonly program?: unknown }): Promise<void> {
		this.throwIfDisposed();
		this.vdspSource = source.vdsp;
		const program = await this.resolveProgram(source);
		const controls = program.controls.map((control) => ({
			id: control.id,
			label: control.label ?? control.id,
			value: control.defaultPosition,
			min: 0,
			max: 1,
		}));
		this.chain = { program, controls };
		this.emit("controls", [...controls]);
		this.emit("ready");
	}

	private async resolveProgram(source: { readonly vdsp: string; readonly program?: unknown }): Promise<Program> {
		const override = source.program ?? this.options.program;
		if (override !== undefined) {
			if (typeof override === "string") {
				try {
					const parsed = JSON.parse(override) as { blocks?: unknown; controls?: unknown };
					if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.blocks)) {
						throw new PlayerError("load-failed", "The precompiled program is not a Program (missing blocks).");
					}
					return parsed as Program;
				} catch (error) {
					if (error instanceof PlayerError) {
						throw error;
					}
					throw new PlayerError(
						"load-failed",
						`The precompiled program is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			if (override !== null && typeof override === "object" && Array.isArray((override as { blocks?: unknown }).blocks)) {
				return override as Program;
			}
			throw new PlayerError("load-failed", "The precompiled program is not a Program (missing blocks).");
		}
		const fetchFn = this.options.fetch ?? defaultFetch;
		let text: string;
		try {
			const response = await fetchFn(source.vdsp);
			if (response.ok !== true) {
				throw new PlayerError("load-failed", `Circuit request failed with status ${String(response.status)}.`);
			}
			text = await response.text();
		} catch (error) {
			throw toPlayerError(error, `Fetching the circuit ${source.vdsp} failed`);
		}
		let compiled: ReturnType<typeof compile>;
		try {
			compiled = compile(text, { registry: this.options.registry ?? pedalPartCatalog });
		} catch (error) {
			throw new PlayerError(
				"load-failed",
				`Compiling the circuit failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (compiled.status !== "ok") {
			const reasons = compiled.reasons.map((reason) => `${reason.stage}/${reason.device}: ${reason.reason}`).join("; ");
			throw new PlayerError("load-failed", `The circuit is unsupported: ${reasons}`);
		}
		return compiled.program;
	}

	private async doStart(): Promise<void> {
		this.throwIfDisposed();
		const chain = this.chain;
		if (chain === null) {
			throw new PlayerError("load-failed", "No program is loaded; play needs a circuit first.");
		}
		if (this.audioStarted && this.context !== null) {
			await this.restartLoopSource();
			try {
				await this.context.resume();
			} catch (error) {
				throw toPlayerError(error, "Resuming the audio context failed");
			}
			return;
		}
		const createContext = this.options.createAudioContext ?? defaultCreateAudioContext;
		let context: AudioContext;
		try {
			// 48 kHz preferred (section 6 rate policy); when the device
			// refuses it, run at the device rate and compare NAM/IR there.
			context = createContext({ sampleRate: 48000 });
		} catch {
			context = createContext({});
		}
		this.context = context;
		const rate = context.sampleRate;
		try {
			// NAM/IR fetch plus validation BEFORE the admission gate: the
			// gate prices the combination, and a refusal names the block
			// and the numbers rather than glitching.
			const nam = await this.resolveNam(rate);
			const ir = await this.resolveIr(rate);
			const dspBytes = await this.fetchWasmBytes(this.assetUrls.dspWasmUrl, "DSP console");
			await this.gateAdmission(chain.program, rate, dspBytes, nam?.nsPerSample ?? 0, ir?.nsPerSample ?? 0);
			const createNode = this.options.createWorkletNode ?? ((ctx, name) => new AudioWorkletNode(ctx, name));
			await context.audioWorklet.addModule(this.assetUrls.workletUrl);
			const node = createNode(context, playerWorkletProcessorName);
			this.workletNode = node;
			const gain = context.createGain();
			gain.gain.value = dbToLinear(this.options.inputGainDb ?? 0);
			this.inputGain = gain;
			const analyser = context.createAnalyser();
			analyser.fftSize = 2048;
			this.analyser = analyser;
			gain.connect(node);
			node.connect(analyser);
			analyser.connect(context.destination);
			this.attachPort(node.port);
			const slots = this.buildSlots(chain.program, nam, ir);
			const loaded = this.waitForLoaded();
			postV2WorkletMessage(node.port, { type: "load", slots, wasmConsole: { wasmBytes: dspBytes } });
			const info = await loaded;
			this.applyLoadedControls(chain, info);
			await this.startInputSource(context, gain);
			try {
				await context.resume();
			} catch (error) {
				throw toPlayerError(error, "Resuming the audio context failed");
			}
			this.audioStarted = true;
		} catch (error) {
			this.tearDownAudio();
			throw toPlayerError(error, "Starting playback failed");
		}
	}

	private async doStop(): Promise<void> {
		const context = this.context;
		for (const source of this.activeSources) {
			try {
				source.stop();
			} catch {
				// Already stopped.
			}
		}
		this.activeSources = [];
		this.audioStarted = false;
		if (context !== null) {
			await context.suspend();
		}
	}

	private tearDownAudio(): void {
		for (const source of this.activeSources) {
			try {
				source.stop();
			} catch {
				// Already stopped.
			}
		}
		this.activeSources = [];
		for (const track of this.mediaStream?.getTracks() ?? []) {
			track.stop();
		}
		this.mediaStream = null;
		this.workletNode = null;
		this.analyser = null;
		this.inputGain = null;
		this.audioStarted = false;
		// A failed start leaves no half-built graph behind: the next play()
		// gesture rebuilds from a fresh context rather than inheriting one.
		const context = this.context;
		this.context = null;
		if (context !== null) {
			void context.close().catch(() => {});
		}
	}

	private async rebuildAfterSelection(): Promise<void> {
		const context = this.context;
		const node = this.workletNode;
		const chain = this.chain;
		if (context === null || node === null || chain === null) {
			return;
		}
		const rate = context.sampleRate;
		const nam = await this.resolveNam(rate);
		const ir = await this.resolveIr(rate);
		const dspBytes = await this.fetchWasmBytes(this.assetUrls.dspWasmUrl, "DSP console");
		// Re-gate: a NAM/IR added after the first play brings its own
		// measured cost, priced exactly as at start.
		await this.gateAdmission(chain.program, rate, dspBytes, nam?.nsPerSample ?? 0, ir?.nsPerSample ?? 0);
		const slots = this.buildSlots(chain.program, nam, ir);
		const loaded = this.waitForLoaded();
		postV2WorkletMessage(node.port, { type: "load", slots, wasmConsole: { wasmBytes: dspBytes } });
		const info = await loaded;
		this.applyLoadedControls(chain, info);
	}

	private attachPort(port: { onmessage: unknown; postMessage: unknown }): void {
		(port as { onmessage: ((event: { data: unknown }) => void) | null }).onmessage = (event) => {
			const message = (event as { data: { type: string } }).data as
				| { type: "loaded"; controls: Array<{ slot: number; id: string }>; [key: string]: unknown }
				| { type: "error"; message: string }
				| {
						type: "telemetry";
						cpuLoadPercent?: number;
						overrunCount?: number;
						cpuPeakPercent?: number;
						cpuP95Percent?: number;
						cpuSessionPeakPercent?: number;
				  };
			if (message.type === "loaded") {
				const awaiters = this.loadAwaiters;
				this.loadAwaiters = [];
				for (const waiter of awaiters) {
					clearTimeout(waiter.timer);
					waiter.resolve({ controls: [...message.controls] });
				}
				return;
			}
			if (message.type === "error") {
				const awaiters = this.loadAwaiters;
				this.loadAwaiters = [];
				const failure = new PlayerError("load-failed", `The worklet refused the chain: ${message.message}`);
				for (const waiter of awaiters) {
					clearTimeout(waiter.timer);
					waiter.reject(failure);
				}
				this.emit("error", new PlayerError("engine-error", message.message));
				return;
			}
			if (message.type === "telemetry") {
				const telemetry: Record<string, number> = {
					cpuLoad: message.cpuLoadPercent ?? 0,
					overruns: message.overrunCount ?? 0,
				};
				if (message.cpuPeakPercent !== undefined) {
					telemetry.cpuPeak = message.cpuPeakPercent;
				}
				if (message.cpuP95Percent !== undefined) {
					telemetry.cpuP95 = message.cpuP95Percent;
				}
				if (message.cpuSessionPeakPercent !== undefined) {
					telemetry.cpuSessionPeak = message.cpuSessionPeakPercent;
				}
				this.emit("telemetry", telemetry);
			}
		};
	}

	private waitForLoaded(): Promise<{ controls: Array<{ slot: number; id: string }> }> {
		return new Promise((resolve, reject) => {
			// A silent worklet (crashed processor, hung instantiate) must
			// surface as a refusal, never hang the gesture that started it.
			const timer = setTimeout(() => {
				this.loadAwaiters = this.loadAwaiters.filter((waiter) => waiter.timer !== timer);
				reject(new PlayerError("load-failed", "The worklet did not answer the load within 30 s."));
			}, 30_000);
			this.loadAwaiters.push({ resolve, reject, timer });
		});
	}

	private applyLoadedControls(chain: LoadedChain, info: { controls: Array<{ slot: number; id: string }> }): void {
		const reported = new Set(info.controls.filter((entry) => entry.slot === 0).map((entry) => entry.id));
		const controls = chain.controls.filter((control) => reported.has(control.id));
		this.emit("controls", [...controls]);
		for (const [id, position] of this.pendingControls) {
			if (reported.has(id) && this.workletNode !== null) {
				postV2WorkletMessage(this.workletNode.port, { type: "setControl", slot: 0, id, position });
			}
		}
	}

	private buildSlots(
		program: Program,
		nam: { id: string; wasmBytes: ArrayBuffer; modelJson: string } | null,
		ir: { id: string; taps: Float32Array } | null,
	): V2WorkletSlot[] {
		const slots: V2WorkletSlot[] = [
			{ kind: "program", program, bypassMode: this.options.bypassMode ?? "effect" },
		];
		if (nam !== null) {
			slots.push({ kind: "nam", id: nam.id, wasmBytes: nam.wasmBytes, modelJson: nam.modelJson });
		}
		if (ir !== null) {
			slots.push({ kind: "ir", id: ir.id, taps: ir.taps });
		}
		return slots;
	}

	private async fetchBytes(url: string, what: string): Promise<ArrayBuffer> {
		const fetchFn = this.options.fetch ?? defaultFetch;
		let response: EngineFetchResponse;
		try {
			response = await fetchFn(url);
		} catch (error) {
			throw new PlayerError(
				"load-failed",
				`${what} fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (response.ok !== true) {
			throw new PlayerError("load-failed", `${what} request failed for ${url} with status ${String(response.status)}.`);
		}
		try {
			return await response.arrayBuffer();
		} catch (error) {
			throw new PlayerError(
				"load-failed",
				`${what} body read failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async fetchWasmBytes(url: string, what: string): Promise<ArrayBuffer> {
		const bytes = await this.fetchBytes(url, what);
		// Fail fast on proxy error pages served as 200: the worklet's
		// instantiate hook has no rejection channel for a CompileError and
		// would hang the load instead of refusing it.
		if (!isWasmBinary(bytes)) {
			throw new PlayerError("load-failed", `${what} bytes for ${url} are not a WebAssembly binary.`);
		}
		return bytes;
	}

	private async resolveProbe(): Promise<NamProbeFn> {
		if (this.options.probeNam !== undefined) {
			return this.options.probeNam;
		}
		if (this.probePromise === null) {
			const fetchFn = this.options.fetch ?? defaultFetch;
			this.probePromise = createChainNamProbe(
				{ instantiateNamEngine, loadNamModel },
				{
					fetch: fetchFn,
					importGlue: (url: string) => import(/* @vite-ignore */ url) as Promise<unknown>,
					namGlueUrl: this.assetUrls.namGlueUrl,
					namWasmUrl: this.assetUrls.namWasmUrl,
				},
			);
		}
		return this.probePromise;
	}

	private async resolveNam(
		rate: number,
	): Promise<{ id: string; wasmBytes: ArrayBuffer; modelJson: string; nsPerSample: number } | null> {
		const selection = this.namSelection;
		if (selection === null) {
			return null;
		}
		if (!isSafeSrc(selection.src)) {
			throw new PlayerError("load-failed", `NAM src refused as unsafe: ${selection.src}`);
		}
		const probe = await this.resolveProbe();
		const fetchRaw = this.options.fetch ?? defaultFetch;
		// One fetch for both validation and the slot: loadNam validates
		// through the injected fetch, which serves the bytes read here.
		let modelJson: string;
		try {
			const response = await fetchRaw(selection.src);
			if (response.ok !== true) {
				throw new PlayerError("load-failed", `NAM request failed with status ${String(response.status)}.`);
			}
			modelJson = await response.text();
		} catch (error) {
			throw toPlayerError(error, `Reading the NAM model ${selection.src} failed`);
		}
		const info = await loadNam(selection.src, rate, {
			fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(modelJson) }),
			probe: async (modelText: string) => probe(modelText),
		}).catch((error: unknown) => {
			throw toPlayerError(error, `Loading the NAM model ${selection.src} failed`);
		});
		void info;
		const wasmBytes = await this.fetchWasmBytes(this.assetUrls.namWasmUrl, "NAM engine");
		const nsPerSample = await this.measureNamNsPerSample(modelJson, rate);
		return { id: selection.id, wasmBytes, modelJson, nsPerSample };
	}

	private async resolveIr(rate: number): Promise<{ id: string; taps: Float32Array; nsPerSample: number } | null> {
		const selection = this.irSelection;
		if (selection === null) {
			return null;
		}
		if (!isSafeSrc(selection.src)) {
			throw new PlayerError("load-failed", `IR src refused as unsafe: ${selection.src}`);
		}
		const context = this.context;
		const decode: (data: ArrayBuffer) => Promise<AudioBuffer> =
			this.options.decodeAudioData ?? ((data) => context!.decodeAudioData(data.slice(0)));
		const fetchFn = this.options.fetch ?? defaultFetch;
		let taps: Float32Array;
		try {
			const loaded = await loadIr(selection.src, rate, { fetch: fetchFn, decodeAudioData: decode });
			taps = loaded.taps;
		} catch (error) {
			throw toPlayerError(error, `Loading the IR ${selection.src} failed`);
		}
		const nsPerSample = this.measureIrNsPerSample(taps, rate);
		return { id: selection.id, taps, nsPerSample };
	}

	private async gateAdmission(
		program: Program,
		rate: number,
		dspBytes: ArrayBuffer,
		namNsPerSample: number,
		irNsPerSample: number,
	): Promise<void> {
		const macroBlocks = program.costPredictors?.macroBlocks ?? [];
		if (macroBlocks.length > 0) {
			const named = macroBlocks.map((block) => `"${block.modelId}"`).join(", ");
			throw new PlayerError(
				"admission-refused",
				`The circuit needs DSP models this host has no measured price for (${named}); refusing instead of playing it unpriced.`,
			);
		}
		const now = this.options.now ?? defaultNowNs;
		const calibration = calibrateNsPerSolve({
			solve: denseLinearSolveWorkload,
			sizes: [2, 4, 8, 16, 32],
			warmupSolves: 10,
			solvesPerSample: 50,
			samples: 3,
			now,
		});
		if (calibration.ok !== true) {
			throw new PlayerError(
				"load-failed",
				`Admission calibration refused (${calibration.reason}); cannot show the circuit fits in real time.`,
			);
		}
		// Host policy for the static gate. The allowance prices the SHIPPED
		// sparse WASM console's sustained iteration counts (single digits;
		// the corpus median is ~2.5), not the reference interpreter: the
		// default 64 prices the interpreter and refuses working pedals
		// (measured: the blog buffer refused at 86 us against a 10.4 us
		// budget while the console renders it 13x faster than real time).
		// Spikes past the allowance are the overrun policy's held samples,
		// not refusals -- the same separation admission.ts draws between
		// the solver's cap (correctness) and the charge (cost).
		const budget = {
			nsPerSolve: calibration.nsPerSolve,
			// No measured macro price on this host; macro-bearing programs
			// are refused above, so this is never consulted for them.
			nsPerMacroSample: () => 0,
			budgetedIterationsPerSample: 2,
			cpuBudgetFraction: 0.5,
		};
		const verdict = admissionVerdict([program], rate, budget);
		const predicted = predictedWorstCaseNs([program], budget);
		const availableNs = (1e9 / rate) * 0.5;
		// Decisive gate: the program's own per-sample cost measured on the
		// shipped console on this machine, plus the measured NAM/IR extras.
		// When the static model refuses but the console measurement fits,
		// the measurement wins: the model prices the reference interpreter
		// (measured 11x over for mxr-phase-90: 89 us predicted against
		// 7.8 us measured), and refusing a runnable pedal is the failure
		// this gate exists to avoid in the other direction.
		const measured = await this.measureWasmNsPerSample(program, rate, dspBytes);
		const extras = namNsPerSample + irNsPerSample;
		if (measured !== null) {
			const totalNs = measured + extras;
			if (!(totalNs <= availableNs)) {
				throw new PlayerError(
					"admission-refused",
					`The chain cannot be shown to fit inside ${availableNs.toFixed(0)} ns/sample at ${rate} Hz: ` +
						`measured ${(measured).toFixed(0)} ns plus NAM/IR ${extras.toFixed(0)} ns.`,
				);
			}
			return;
		}
		if (!verdict.fits) {
			throw new PlayerError("admission-refused", verdict.reason);
		}
		const totalNs = (predicted ?? Number.POSITIVE_INFINITY) + extras;
		if (!(totalNs <= availableNs)) {
			throw new PlayerError(
				"admission-refused",
				`The chain cannot be shown to fit inside ${availableNs.toFixed(0)} ns/sample at ${rate} Hz: ` +
					`circuit ${(predicted ?? Number.POSITIVE_INFINITY).toFixed(0)} ns plus ` +
					`NAM ${namNsPerSample.toFixed(0)} ns plus IR ${irNsPerSample.toFixed(0)} ns.`,
			);
		}
	}

	private async measureWasmNsPerSample(
		program: Program,
		rate: number,
		dspBytes: ArrayBuffer,
	): Promise<number | null> {
		// The decisive real-time number: this program's own per-sample cost
		// on the shipped console on this machine. The module compiles once
		// per engine; a program the console cannot load measures nothing
		// (null) and the static verdict decides instead.
		try {
			if (!isWasmBinary(dspBytes)) {
				return null;
			}
			if (this.dspModulePromise === null) {
				const glue = (await import("@vessel-dsp/runtime/wasm/v2_dsp.cjs")) as {
					default: (options: {
						instantiateWasm: (
							imports: WebAssembly.Imports,
							receive: (instance: WebAssembly.Instance) => void,
						) => Record<string, never>;
					}) => Promise<unknown>;
				};
				const bytes = dspBytes.slice(0);
				// The glue's own promise never settles when the inner
				// instantiate fails (its hook path has no rejection
				// channel), so failures reject the wrapper explicitly:
				// a measurement that cannot run measures nothing.
				this.dspModulePromise = new Promise<unknown>((resolve, reject) => {
					void glue
						.default({
							instantiateWasm: (imports, receive) => {
								void WebAssembly.instantiate(bytes, imports).then(
									(result) => {
										// `receive` runs the glue's own instance
										// wiring, which throws on a module without
										// the console's exports: route it to the
										// rejection, never to an unhandled one.
										try {
											receive(result.instance);
										} catch (error) {
											reject(error);
										}
									},
									reject,
								);
								return {};
							},
						})
						.then(resolve, reject);
				});
			}
			const mod = await this.dspModulePromise;
			const engine = await V2WasmEngine.create(program, mod);
			try {
				engine.prepare({ sampleRate: rate });
				const frames = 128;
				const input = new Float32Array(frames).fill(0.1);
				const output = new Float32Array(frames);
				for (let warm = 0; warm < 4; warm += 1) {
					engine.processBlock(input, output);
				}
				const clock = this.options.now ?? defaultNowNs;
				const samples: number[] = [];
				for (let sample = 0; sample < 3; sample += 1) {
					const blocks = 5;
					const t0 = clock();
					for (let block = 0; block < blocks; block += 1) {
						engine.processBlock(input, output);
					}
					const elapsed = clock() - t0;
					if (elapsed >= 0 && Number.isFinite(elapsed)) {
						samples.push(elapsed / (blocks * frames));
					}
				}
				if (samples.length === 0) {
					return null;
				}
				samples.sort((a, b) => a - b);
				return samples[Math.floor(samples.length / 2)] as number;
			} finally {
				engine.destroy();
			}
		} catch {
			return null;
		}
	}

	private async measureNamNsPerSample(modelJson: string, rate: number): Promise<number> {
		const fetchFn = this.options.fetch ?? defaultFetch;
		try {
			const glueModule = (await import(/* @vite-ignore */ this.assetUrls.namGlueUrl)) as {
				default: (options: { readonly wasmBinary?: ArrayBufferLike }) => Promise<unknown>;
			};
			const wasmResponse = await fetchFn(this.assetUrls.namWasmUrl);
			if (wasmResponse.ok !== true) {
				return 0;
			}
			const wasmBytes = await wasmResponse.arrayBuffer();
			const engine = await instantiateNamEngine(wasmBytes, (options: { readonly wasmBinary: ArrayBufferLike }) =>
				glueModule.default({ wasmBinary: options.wasmBinary }) as Promise<NamEngineModule>,
			);
			const instanceId = engine._nam_createInstance(rate, 128);
			if (instanceId <= 0) {
				return 0;
			}
			try {
				loadNamModel(engine, instanceId, modelJson, -1);
			} catch {
				return 0;
			}
			const now = this.options.now;
			const clock: () => number = now ?? defaultNowNs;
			const frames = 128;
			const view = engine.HEAPF32.subarray(engine._nam_getBuffer(instanceId) >> 2, (engine._nam_getBuffer(instanceId) >> 2) + frames);
			for (let warm = 0; warm < 4; warm += 1) {
				view.fill(0.1);
				engine._nam_process(instanceId, frames);
			}
			const samples: number[] = [];
			for (let sample = 0; sample < 3; sample += 1) {
				const blocks = 5;
				const t0 = clock();
				for (let block = 0; block < blocks; block += 1) {
					view.fill(0.1);
					engine._nam_process(instanceId, frames);
				}
				const elapsed = clock() - t0;
				if (elapsed >= 0 && Number.isFinite(elapsed)) {
					samples.push(elapsed / (blocks * frames));
				}
			}
			engine._nam_destroyInstance(instanceId);
			if (samples.length === 0) {
				return 0;
			}
			samples.sort((a, b) => a - b);
			return samples[Math.floor(samples.length / 2)] as number;
		} catch {
			return 0;
		}
	}

	private measureIrNsPerSample(taps: Float32Array, rate: number): number {
		try {
			const node = new CabinetIrNode("admission-probe", "admission probe", { ir: taps, irSampleRate: rate });
			node.prepare(rate);
			const now = this.options.now;
			const clock: () => number = now ?? defaultNowNs;
			const input = new Float64Array(128).fill(0.1);
			for (let warm = 0; warm < 20; warm += 1) {
				node.process(input);
			}
			const samples: number[] = [];
			for (let sample = 0; sample < 5; sample += 1) {
				const blocks = 8;
				const t0 = clock();
				for (let block = 0; block < blocks; block += 1) {
					node.process(input);
				}
				const elapsed = clock() - t0;
				if (elapsed >= 0 && Number.isFinite(elapsed)) {
					samples.push(elapsed / (blocks * 128));
				}
			}
			if (samples.length === 0) {
				return 0;
			}
			samples.sort((a, b) => a - b);
			return samples[Math.floor(samples.length / 2)] as number;
		} catch {
			return 0;
		}
	}

	private defaultInput(): InputChoiceDescriptor | null {
		if (this.inputChoice !== null) {
			return this.inputChoice;
		}
		const first = this.options.inputs?.[0];
		if (first === undefined) {
			return null;
		}
		return { kind: "wav", id: first.id, label: first.label, src: first.src };
	}

	private async startInputSource(context: AudioContext, gain: GainNode): Promise<void> {
		const choice = this.defaultInput();
		if (choice === null) {
			const silent = context.createBufferSource();
			silent.buffer = context.createBuffer(1, 128, context.sampleRate);
			silent.loop = true;
			silent.connect(gain);
			silent.start(0);
			this.activeSources.push(silent);
			return;
		}
		if (choice.kind === "browser") {
			// Reuse the live stream across stop/start cycles; a fresh
			// getUserMedia per resume would strand the previous tracks.
			if (this.mediaStream !== null) {
				const mic = context.createMediaStreamSource(this.mediaStream);
				mic.connect(gain);
				return;
			}
			const devices = this.options.mediaDevices ?? globalThis.navigator?.mediaDevices ?? null;
			if (devices === null) {
				throw new PlayerError("load-failed", "Browser audio input needs a media device this host does not have.");
			}
			const constraints = browserAudioConstraints({ deviceId: this.options.micDeviceId });
			let stream: MediaStream;
			try {
				stream = await devices.getUserMedia(constraints as never);
			} catch (error) {
				throw new PlayerError(
					"load-failed",
					`Microphone access failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			this.mediaStream = stream;
			const mic = context.createMediaStreamSource(stream);
			mic.connect(gain);
			return;
		}
		const decode: (data: ArrayBuffer) => Promise<AudioBuffer> =
			this.options.decodeAudioData ?? ((data) => context.decodeAudioData(data.slice(0)));
		const fetchFn = this.options.fetch ?? defaultFetch;
		const loaded = await loadWavInput(choice.src, { fetch: fetchFn, decodeAudioData: decode }).catch(
			(error: unknown) => {
				throw toPlayerError(error, `Loading the input ${choice.src} failed`);
			},
		);
		const mono = downmixToMono(loaded);
		const buffer = context.createBuffer(1, Math.max(1, mono.length), loaded.sampleRate);
		buffer.getChannelData(0).set(mono.subarray(0, buffer.length));
		const loop = context.createBufferSource();
		loop.buffer = buffer;
		loop.loop = true;
		loop.connect(gain);
		loop.start(0);
		this.activeSources.push(loop);
	}

	private async restartLoopSource(): Promise<void> {
		const context = this.context;
		const gain = this.inputGain;
		if (context === null || gain === null) {
			return;
		}
		for (const source of this.activeSources) {
			try {
				source.stop();
			} catch {
				// Already stopped.
			}
			try {
				source.disconnect();
			} catch {
				// Already disconnected.
			}
		}
		this.activeSources = [];
		await this.startInputSource(context, gain);
	}
}

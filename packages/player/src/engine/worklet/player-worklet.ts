// The player AudioWorkletProcessor: pedal + NAM + IR in the audio thread.
//
// Composition, not a fork: the `program` path (WASM/TS consoles, seam
// arithmetic, DAC scaling, telemetry histogram) mirrors
// `@vessel-dsp/runtime`'s `v2-audio-worklet.ts`, and the `nam`/`ir` slot
// paths mirror the workbench reference `v2-audio-worklet.ts` plus
// `chain-processor-slots.ts`, which the workbench keeps. This package copy is
// the npm-published one behind the player `./worklet-player.js` subpath.
//
// Why this file exists at all: the runtime's bundle refuses `nam`/`ir`
// slots by name (adapters ship in this package per
// docs/design/player-architecture.md §4, and the task bans engine edits in
// runtime), while a NAM or IR outside the chain would give up the seam
// scaling and advisories. So the player bundles the same `ChainRuntime` with
// all three slot kinds. See docs/design/player-architecture.md,
// "Cutover: where NAM and IR run".
//
// Self-contained by necessity, same as the runtime's: bundled by
// `scripts/build-player-worklet.ts` into one file with no external imports,
// loaded via `audioContext.audioWorklet.addModule(...)`. The v2 DSP glue
// and the NAM glue are bundled statically; both `.wasm` binaries arrive in
// the `load` message because this scope cannot fetch.

import type { ControlId, Program } from "@vessel-dsp/compiler";
import type {
	PlayerLoadedMeasurement,
	PlayerLoadMeasurementFlag,
	PlayerProgramScheduleEntry,
} from "../admission-report.js";
import {
	bypassNotModelledAdvisories,
	ChainRuntime,
	chainAdvisories,
	dacScaleFactor,
	outputConversionFullScale,
	programSlot,
	slotContract,
	supplyGroundConflicts,
	V2WasmEngine,
	type BypassMode,
	type ChainSlot,
	type ExternalProcessor,
	type resolveBypassMode,
	type StageCoverage,
	type V2WorkletInboundMessage,
	type V2WorkletOutboundMessage,
	type V2WorkletSlot,
} from "@vessel-dsp/runtime";
import {
	CabinetIrNode,
	instantiateNamEngine,
	loadNamModel,
	namLoudness,
	type NamEngineModule,
} from "@vessel-dsp/chain";
import createV2DspModule from "@vessel-dsp/runtime/wasm/v2_dsp.cjs";
// @ts-expect-error -- a vendored build output with no type declarations;
// resolved by the bundle script's alias to the chain's published glue.
import createNamEngine from "@vessel-dsp/chain/nam-engine.js";
import { playerWorkletProcessorName } from "../processor-name.js";

// A NAM stating a rate this far from the context rate is refused in the
// audio thread too, not run silently. Mirrors the main-thread adapter's
// NAM_SAMPLE_RATE_TOLERANCE_HZ (and chain NamNode's 0.5 Hz); the page
// validates first, and this is the invariant behind it.
const NAM_SAMPLE_RATE_TOLERANCE_HZ = 0.5;

// AudioWorkletGlobalScope has no shipped TypeScript lib, so the globals and
// base class are declared locally, same as the runtime's worklet. The port
// is structural rather than `MessagePort`: this package typechecks the
// worklet source with a DOM lib, but the shape below keeps the processor
// honest about the surface it actually uses.
declare const sampleRate: number;

declare function registerProcessor(
	name: string,
	processorCtor: typeof AudioWorkletProcessor,
): void;

type AudioWorkletMessagePort = {
	onmessage: ((event: { readonly data: V2WorkletInboundMessage }) => void) | null;
	postMessage(message: V2WorkletOutboundMessage): void;
};

declare abstract class AudioWorkletProcessor {
	readonly port: AudioWorkletMessagePort;
	constructor();
	abstract process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>,
	): boolean;
}

// Telemetry is posted roughly this often rather than every quantum, same
// interval as the runtime's worklet: 4096 samples is ~85 ms at 48 kHz.
const TELEMETRY_INTERVAL_SAMPLES = 4096;

type NamHandle = {
	readonly processor: ExternalProcessor;
	dispose(): void;
};

function createPlayerNamProcessor(options: {
	readonly id: string;
	readonly module: NamEngineModule;
	readonly modelJson: string;
	readonly contextSampleRate: number;
	readonly maxFrames?: number;
	readonly slimSize?: number;
	readonly produces?: StageCoverage;
	readonly expects?: StageCoverage;
}): NamHandle {
	const maxFrames = options.maxFrames ?? 128;
	const instanceId = options.module._nam_createInstance(options.contextSampleRate, maxFrames);
	if (instanceId <= 0) {
		throw new Error("nam_createInstance refused");
	}
	try {
		loadNamModel(options.module, instanceId, options.modelJson, options.slimSize ?? -1);
	} catch (error) {
		options.module._nam_destroyInstance(instanceId);
		throw error;
	}
	// The audio-thread invariant behind the page's rate-mismatch refusal: the
	// engine fixes its DC blocker at instance creation and will not refuse a
	// wrong rate itself, so the worklet refuses the slot by name instead of
	// playing it at the wrong pitch character silently.
	const stated = options.module._nam_getExpectedSampleRate(instanceId);
	const expectedSampleRate = stated < 0 ? null : stated;
	if (
		expectedSampleRate !== null &&
		Math.abs(expectedSampleRate - options.contextSampleRate) > NAM_SAMPLE_RATE_TOLERANCE_HZ
	) {
		options.module._nam_destroyInstance(instanceId);
		throw new Error(
			`player worklet: NAM slot "${options.id}" states ${expectedSampleRate} Hz but the context runs at ${options.contextSampleRate} Hz; refusing to run it at the wrong rate`,
		);
	}
	void namLoudness(options.module, instanceId);
	const bufferPointer = options.module._nam_getBuffer(instanceId);
	let view: Float32Array | null = null;
	const bufferView = (): Float32Array => {
		if (view === null || view.buffer !== options.module.HEAPF32.buffer) {
			const offset = bufferPointer >> 2;
			view = options.module.HEAPF32.subarray(offset, offset + maxFrames);
		}
		return view;
	};
	const processor: ExternalProcessor = {
		id: options.id,
		produces: options.produces ?? "speaker-electrical",
		expects: options.expects ?? "instrument",
		// A NAM's ports are digital: nothing states what input voltage its
		// 1.0 corresponds to, so the seam into it cannot be scaled and
		// `unscalable-seam` reports it. Same encoding as the workbench.
		portFullScaleVolts: { input: null, output: null },
		portImpedanceOhms: null,
		prepare(): void {},
		process(buffer: Float64Array): Float64Array {
			const frames = buffer.length;
			const output = new Float64Array(frames);
			if (frames > maxFrames) {
				output.set(buffer);
				return output;
			}
			const heap = bufferView();
			for (let index = 0; index < frames; index += 1) {
				heap[index] = buffer[index] ?? 0;
			}
			options.module._nam_process(instanceId, frames);
			for (let index = 0; index < frames; index += 1) {
				output[index] = heap[index] ?? 0;
			}
			return output;
		},
	};
	return {
		processor,
		dispose(): void {
			options.module._nam_destroyInstance(instanceId);
		},
	};
}

function createPlayerIrProcessor(options: {
	readonly id: string;
	readonly taps: Float32Array;
	readonly portFullScaleVolts: { readonly input: number | null; readonly output: number | null };
	readonly produces?: StageCoverage;
	readonly expects?: StageCoverage;
	readonly gain?: number;
	readonly contextSampleRate: number;
}): ExternalProcessor {
	// Partitioned FFT convolution from the chain, wrapped as a chain slot.
	// Taps arrive already at the context rate (resampling is caller-side on
	// the main thread), so the node's own rate conversion is a no-op and
	// its filters stay off: this slot is a pure filter.
	const gain = options.gain ?? 1;
	const scaled = new Float32Array(options.taps.length);
	for (let index = 0; index < options.taps.length; index += 1) {
		scaled[index] = (options.taps[index] ?? 0) * gain;
	}
	const node = new CabinetIrNode(options.id, options.id, {
		ir: scaled,
		irSampleRate: options.contextSampleRate,
	});
	return {
		id: options.id,
		produces: options.produces ?? "miked",
		expects: options.expects ?? "speaker-electrical",
		// A filter borrows the upstream slot's own output bound on both
		// ports, making the seam into it exactly 1; null propagates when
		// the upstream states no bound. Same rule as the workbench.
		portFullScaleVolts: options.portFullScaleVolts,
		portImpedanceOhms: null,
		prepare(rate: number): void {
			node.prepare(rate);
		},
		process(buffer: Float64Array): Float64Array {
			return node.process(buffer);
		},
	};
}

class PlayerWorkletProcessor extends AudioWorkletProcessor {
	private runtime: ChainRuntime | null = null;
	private isPassthrough = false;
	private isWasmActive = false;
	private wasmConsoleAvailable = false;
	private samplesSinceTelemetry = 0;
	private totalQuantumTimeMs = 0;
	private quantumMeasurementCount = 0;
	private overrunCount = 0;
	private static readonly CPU_BINS = 128;
	private static readonly CPU_BIN_FRACTION = 1 / 32;
	private cpuHistogram = new Uint32Array(PlayerWorkletProcessor.CPU_BINS + 1);
	private cpuWindowCount = 0;
	private cpuWindowPeakMs = 0;
	private cpuSessionPeakMs = 0;
	private wasmEngines = new Map<number, V2WasmEngine>();
	private namHandles: NamHandle[] = [];
	private quantumBuffer = new Float64Array(128);
	private outputScale = 1.0;

	constructor() {
		super();
		this.port.onmessage = (event) => {
			this.handleMessage(event.data);
		};
	}

	private post(message: V2WorkletOutboundMessage): void {
		this.port.postMessage(message);
	}

	private handleMessage(message: V2WorkletInboundMessage): void {
		if (message.type === "load") {
			// Player-specific extension (see admission-report.ts): the
			// runtime protocol carries no such field and the runtime
			// worklet ignores it. Absent means measure -- a load that does
			// not explicitly opt out gets a measured cost, the fail-closed
			// direction for the admission gate.
			const measure =
				(message as V2WorkletInboundMessage & PlayerLoadMeasurementFlag).playerMeasureProgram !== false;
			void this.loadChain(message.slots, message.wasmConsole, measure);
			return;
		}
		if (message.type === "setControl") {
			this.setControl(message.slot, message.id, message.position);
			return;
		}
		if (message.type === "setBypassMode") {
			this.setBypassMode(message.slot, message.mode);
		}
	}

	private createWasmExternalProcessor(slotIndex: number, program: Program, engine: V2WasmEngine): ExternalProcessor {
		let scratchIn = new Float32Array(0);
		let scratchOut = new Float32Array(0);
		let scratchRendered = new Float64Array(0);
		return {
			id: `wasm-console slot ${slotIndex}`,
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
					scratchRendered = new Float64Array(buffer.length);
				}
				for (let i = 0; i < buffer.length; i += 1) scratchIn[i] = buffer[i] ?? 0;
				engine.processBlock(scratchIn, scratchOut);
				for (let i = 0; i < buffer.length; i += 1) scratchRendered[i] = scratchOut[i] ?? 0;
				return scratchRendered;
			},
		};
	}

	private wasmProgramSlot(slotIndex: number, program: Program, engine: V2WasmEngine, bypassMode: BypassMode = "effect"): ChainSlot {
		this.wasmEngines.set(slotIndex, engine);
		const processor = this.createWasmExternalProcessor(slotIndex, program, engine);
		return { kind: "processor", processor, bypassMode, program } as unknown as ChainSlot;
	}

	private async buildSlots(
		descriptors: readonly V2WorkletSlot[],
		wasmConsole?: { readonly wasmBytes: ArrayBuffer },
	): Promise<ChainSlot[]> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let wasmModule: any = null;
		if (wasmConsole !== undefined) {
			const bytes = wasmConsole.wasmBytes;
			wasmModule = await createV2DspModule({
				instantiateWasm: (
					imports: Bun.WebAssembly.Imports,
					receive: (instance: WebAssembly.Instance) => void,
				) => {
					// A rejection here must not become an unhandled one in
					// the audio scope: the page magic-checks the bytes
					// first, and the engine times out a silent load.
					void WebAssembly.instantiate(bytes, imports).then(
						(result) => {
							try {
								receive(result.instance);
							} catch (error) {
								console.error(`[player-worklet] wasm instance refused: ${errorMessage(error)}`);
							}
						},
						(error: unknown) => {
							console.error(`[player-worklet] wasm instantiate failed: ${errorMessage(error)}`);
						},
					);
					return {};
				},
			});
		}
		const slots: ChainSlot[] = [];
		// The converted output bound lent downstream to an IR filter. A wire
		// slot has no port and lends nothing; a NAM resets it to null (its
		// ports are digital). Same lending rules as the workbench.
		let upstreamOutputVolts: number | null = null;
		for (const [slotIndex, descriptor] of descriptors.entries()) {
			if (descriptor.kind === "program") {
				const bypassMode = (descriptor as { readonly bypassMode?: BypassMode }).bypassMode ?? "effect";
				const bufferProgram = (descriptor as { readonly bufferProgram?: Program }).bufferProgram;
				if (wasmModule !== null) {
					const engine = await V2WasmEngine.create(descriptor.program, wasmModule);
					if (bufferProgram !== undefined) {
						const bufEngine = await V2WasmEngine.create(bufferProgram, wasmModule);
						const mainProc = this.createWasmExternalProcessor(slotIndex, descriptor.program, engine);
						const bufProc = this.createWasmExternalProcessor(1000 + slotIndex, bufferProgram, bufEngine);
						this.wasmEngines.set(slotIndex, engine);
						this.wasmEngines.set(1000 + slotIndex, bufEngine);
						slots.push({ kind: "processor", processor: mainProc, bufferProcessor: bufProc, bypassMode, program: descriptor.program } as unknown as ChainSlot);
					} else {
						slots.push(this.wasmProgramSlot(slotIndex, descriptor.program, engine, bypassMode));
					}
				} else {
					const slot = programSlot(descriptor.program, bufferProgram);
					(slot as unknown as { bypassMode: BypassMode }).bypassMode = bypassMode;
					slots.push(slot);
				}
				if (bypassMode !== "wire") {
					upstreamOutputVolts = outputConversionFullScale(descriptor.program);
				}
				continue;
			}
			if (descriptor.kind === "nam") {
				const module = await instantiateNamEngine(descriptor.wasmBytes, createNamEngine);
				const handle = createPlayerNamProcessor({
					id: descriptor.id,
					module,
					modelJson: descriptor.modelJson,
					contextSampleRate: sampleRate,
					produces: descriptor.produces,
					expects: descriptor.expects,
					slimSize: descriptor.slimSize,
				});
				this.namHandles.push(handle);
				const bypassMode = (descriptor as { readonly bypassMode?: BypassMode }).bypassMode ?? "effect";
				slots.push({ kind: "processor", processor: handle.processor, bypassMode } as unknown as ChainSlot);
				upstreamOutputVolts = null;
				continue;
			}
			const bypassMode = (descriptor as { readonly bypassMode?: BypassMode }).bypassMode ?? "effect";
			const bounds = { input: upstreamOutputVolts, output: upstreamOutputVolts };
			slots.push({
				kind: "processor",
				processor: createPlayerIrProcessor({
					id: descriptor.id,
					taps: descriptor.taps,
					portFullScaleVolts: bounds,
					produces: descriptor.produces,
					expects: descriptor.expects,
					gain: descriptor.gain,
					contextSampleRate: sampleRate,
				}),
				bypassMode,
			} as unknown as ChainSlot);
			upstreamOutputVolts = bounds.output;
		}
		return slots;
	}

	private async loadChain(
		descriptors: readonly V2WorkletSlot[],
		wasmConsole?: { readonly wasmBytes: ArrayBuffer },
		measureProgram = true,
	): Promise<void> {
		try {
			for (const handle of this.namHandles) {
				handle.dispose();
			}
			this.namHandles = [];
			for (const engine of this.wasmEngines.values()) {
				engine.destroy();
			}
			this.wasmEngines.clear();

			this.wasmConsoleAvailable = wasmConsole !== undefined && wasmConsole.wasmBytes !== undefined;
			if (descriptors.length === 0) {
				this.runtime = null;
				this.isPassthrough = true;
				this.isWasmActive = this.wasmConsoleAvailable;
				this.post({
					type: "loaded",
					controls: [],
					supplyGroundConflicts: [],
					chainAdvisories: [],
					measuredNsPerSample: null,
					programSchedule: [],
				} as V2WorkletOutboundMessage);
				return;
			}
			this.isPassthrough = false;

			const slots = await this.buildSlots(descriptors, wasmConsole);
			const runtime = new ChainRuntime(slots);
			runtime.prepare(sampleRate);

			this.runtime = runtime;
			this.isWasmActive = wasmConsole !== undefined && this.wasmEngines.size > 0;
			this.samplesSinceTelemetry = 0;
			this.totalQuantumTimeMs = 0;
			this.quantumMeasurementCount = 0;
			this.overrunCount = 0;
			this.cpuHistogram.fill(0);
			this.cpuWindowCount = 0;
			this.cpuWindowPeakMs = 0;
			this.cpuSessionPeakMs = 0;

			let lastActiveSlot: ChainSlot | null = null;
			for (let idx = slots.length - 1; idx >= 0; idx -= 1) {
				if ((slots[idx] as unknown as { bypassMode?: BypassMode })?.bypassMode !== "wire") {
					lastActiveSlot = slots[idx]!;
					break;
				}
			}
			const program =
				(lastActiveSlot as unknown as { program?: Program } | null)?.program ??
				(lastActiveSlot?.kind === "program" ? lastActiveSlot.program : null);
			const fullScaleOut =
				program !== null && program !== undefined
					? outputConversionFullScale(program)
					: lastActiveSlot !== null
						? outputConversionFullScale(slotContract(lastActiveSlot))
						: null;
			this.outputScale = dacScaleFactor(fullScaleOut);
			console.log(
				`[player-worklet] load slots=${slots.length} fullScaleOut=${fullScaleOut === null ? "null" : fullScaleOut.toFixed(2)}V scale=${this.outputScale}`,
			);

			const controls: { slot: number; id: ControlId }[] = [];
			for (const [slot, descriptor] of descriptors.entries()) {
				if (descriptor.kind !== "program") {
					continue;
				}
				for (const control of descriptor.program.controls) {
					controls.push({ slot, id: control.id });
				}
			}
			const programs = descriptors
				.filter((descriptor) => descriptor.kind === "program")
				.map((descriptor) => descriptor.program);
			// The admission measurement, timed HERE on the shipped console
			// on the audio thread -- never on the main thread, which is why
			// the page bundle needs no copy of the node-flavoured glue (see
			// docs/design/player-architecture.md, "Cutover" admission note).
			// Same 128-frame warmed median-of-3 method the main-thread
			// probe used, so the figures stay comparable with the §7 table.
			let measuredNsPerSample: number | null = null;
			let programSchedule: PlayerProgramScheduleEntry[] = [];
			if (measureProgram) {
				const measured = this.measureProgramEngines();
				measuredNsPerSample = measured.nsPerSample;
				programSchedule = measured.schedule;
			}
			this.post({
				type: "loaded",
				controls,
				supplyGroundConflicts: supplyGroundConflicts(programs),
				chainAdvisories: [...chainAdvisories(slots.map(slotContract)), ...bypassNotModelledAdvisories(slots)],
				measuredNsPerSample,
				programSchedule,
			} as V2WorkletOutboundMessage);
		} catch (error) {
			this.runtime = null;
			this.isPassthrough = false;
			this.isWasmActive = false;
			this.post({ type: "error", message: errorMessage(error) });
		}
	}

	private measureProgramEngines(): { nsPerSample: number | null; schedule: PlayerProgramScheduleEntry[] } {
		// This program's own per-sample cost on the shipped console, timed
		// on the audio thread during load: the decisive real-time number
		// for the admission gate. Only primary program engines (slot < 1000;
		// the 1000+ slots are bypass-mode buffer mirrors that do not run in
		// effect mode) priced, summed across program slots. A program the
		// console cannot run measures nothing (null) and the static verdict
		// decides instead -- fail closed, never played unpriced.
		try {
			const entries = [...this.wasmEngines.entries()].filter(([slot]) => slot < 1000);
			if (entries.length === 0) {
				return { nsPerSample: null, schedule: [] };
			}
			const clock: () => number =
				typeof performance !== "undefined" && typeof performance.now === "function"
					? () => performance.now() * 1e6
					: () => Date.now() * 1e6;
			const currentSr = typeof sampleRate !== "undefined" ? sampleRate : 48000;
			let totalNs = 0;
			const schedule: PlayerProgramScheduleEntry[] = [];
			for (const [slot, engine] of entries) {
				engine.prepare({ sampleRate: currentSr });
				const frames = 128;
				const input = new Float32Array(frames).fill(0.1);
				const output = new Float32Array(frames);
				for (let warm = 0; warm < 4; warm += 1) {
					engine.processBlock(input, output);
				}
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
					return { nsPerSample: null, schedule: [] };
				}
				samples.sort((a, b) => a - b);
				totalNs += samples[Math.floor(samples.length / 2)] as number;
				const counters = engine.getScheduleTelemetry();
				schedule.push({ slot, ...counters });
			}
			return { nsPerSample: totalNs, schedule };
		} catch {
			return { nsPerSample: null, schedule: [] };
		}
	}

	private setControl(slot: number, id: ControlId, position: number): void {
		if (this.runtime === null) {
			return;
		}
		try {
			const wasmEngine = this.wasmEngines.get(slot);
			if (wasmEngine !== undefined) {
				wasmEngine.setControl(id, position);
				return;
			}
			this.runtime.setControl(slot, id, position);
		} catch (error) {
			this.post({ type: "error", message: errorMessage(error) });
		}
	}

	private setBypassMode(slot: number, mode: NonNullable<ReturnType<typeof resolveBypassMode>>): void {
		if (this.runtime === null) {
			return;
		}
		try {
			this.runtime.setBypassMode(slot, mode);
		} catch (error) {
			this.post({ type: "error", message: errorMessage(error) });
		}
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const outputChannels = outputs[0];
		if (outputChannels === undefined || outputChannels.length === 0) {
			return true;
		}

		const quantumLength = outputChannels[0]?.length ?? 0;
		const inputChannel = inputs[0]?.[0];

		if (this.isPassthrough) {
			for (const channel of outputChannels) {
				for (let index = 0; index < quantumLength; index += 1) {
					channel[index] = inputChannel?.[index] ?? 0;
				}
			}
			this.samplesSinceTelemetry += quantumLength;
			if (this.samplesSinceTelemetry >= TELEMETRY_INTERVAL_SAMPLES) {
				this.samplesSinceTelemetry = 0;
				this.post({
					type: "telemetry",
					slots: [],
					isWasmConsole: this.wasmConsoleAvailable,
					cpuLoadPercent: 0,
					quantumTimeMs: 0,
					overrunCount: this.overrunCount,
				});
			}
			return true;
		}

		const runtime = this.runtime;
		if (runtime === null) {
			for (const channel of outputChannels) {
				channel.fill(0);
			}
			return true;
		}

		if (this.quantumBuffer.length !== quantumLength) {
			this.quantumBuffer = new Float64Array(quantumLength);
		}
		const quantum = this.quantumBuffer;
		if (inputChannel !== undefined) {
			for (let index = 0; index < quantumLength; index += 1) {
				quantum[index] = inputChannel[index] ?? 0;
			}
		} else {
			quantum.fill(0);
		}

		const t0 = typeof performance !== "undefined" && typeof performance.now === "function"
			? performance.now()
			: Date.now();

		let rendered: Float64Array;
		try {
			rendered = runtime.process(quantum);
		} catch (error) {
			this.runtime = null;
			this.isPassthrough = false;
			this.isWasmActive = false;
			for (const channel of outputChannels) {
				channel.fill(0);
			}
			this.post({ type: "error", message: errorMessage(error) });
			return true;
		}

		const t1 = typeof performance !== "undefined" && typeof performance.now === "function"
			? performance.now()
			: Date.now();
		const elapsedMs = t1 - t0;
		this.totalQuantumTimeMs += elapsedMs;
		this.quantumMeasurementCount += 1;
		const currentSr = typeof sampleRate !== "undefined" ? sampleRate : 48000;
		const budgetMs = (quantumLength / currentSr) * 1000;
		if (elapsedMs > budgetMs) {
			this.overrunCount += 1;
		}
		if (budgetMs > 0) {
			const bin = Math.min(
				PlayerWorkletProcessor.CPU_BINS,
				Math.floor(elapsedMs / budgetMs / PlayerWorkletProcessor.CPU_BIN_FRACTION),
			);
			this.cpuHistogram[bin] = (this.cpuHistogram[bin] ?? 0) + 1;
			this.cpuWindowCount += 1;
		}
		if (elapsedMs > this.cpuWindowPeakMs) {
			this.cpuWindowPeakMs = elapsedMs;
		}
		if (elapsedMs > this.cpuSessionPeakMs) {
			this.cpuSessionPeakMs = elapsedMs;
		}

		const primaryChannel = outputChannels[0];
		if (primaryChannel !== undefined) {
			for (let index = 0; index < quantumLength; index += 1) {
				primaryChannel[index] = (rendered[index] ?? 0) * this.outputScale;
			}
			for (let c = 1; c < outputChannels.length; c += 1) {
				const ch = outputChannels[c];
				if (ch !== undefined) {
					for (let index = 0; index < quantumLength; index += 1) {
						ch[index] = primaryChannel[index] ?? 0;
					}
				}
			}
		}

		this.samplesSinceTelemetry += quantum.length;
		if (this.samplesSinceTelemetry >= TELEMETRY_INTERVAL_SAMPLES) {
			this.samplesSinceTelemetry = 0;
			const avgQuantumTimeMs = this.quantumMeasurementCount > 0
				? this.totalQuantumTimeMs / this.quantumMeasurementCount
				: 0;
			const quantumBudgetMs = (quantumLength / currentSr) * 1000;
			const cpuLoadPercent = quantumBudgetMs > 0 ? (avgQuantumTimeMs / quantumBudgetMs) * 100 : 0;
			let cpuP95Percent = 0;
			if (this.cpuWindowCount > 0) {
				const target = this.cpuWindowCount * 0.95;
				let seen = 0;
				for (let bin = 0; bin <= PlayerWorkletProcessor.CPU_BINS; bin += 1) {
					seen += this.cpuHistogram[bin] ?? 0;
					if (seen >= target) {
						cpuP95Percent = bin * PlayerWorkletProcessor.CPU_BIN_FRACTION * 100;
						break;
					}
				}
			}
			const cpuPeakPercent = quantumBudgetMs > 0 ? (this.cpuWindowPeakMs / quantumBudgetMs) * 100 : 0;
			const cpuSessionPeakPercent = quantumBudgetMs > 0 ? (this.cpuSessionPeakMs / quantumBudgetMs) * 100 : 0;

			this.totalQuantumTimeMs = 0;
			this.quantumMeasurementCount = 0;
			this.cpuHistogram.fill(0);
			this.cpuWindowCount = 0;
			this.cpuWindowPeakMs = 0;

			const telemetry = runtime.telemetry();
			this.post({
				type: "telemetry",
				slots: telemetry.map((slotTelemetry) => ({
					slot: slotTelemetry.slot,
					samples: slotTelemetry.samples,
					heldSamples:
						slotTelemetry.nonConvergedSamples + slotTelemetry.nonFiniteSamples,
					operatingPointFailures: slotTelemetry.operatingPointFailures,
					peakIterations: slotTelemetry.peakIterations,
				})),
				wasmSlots: [...this.wasmEngines.entries()].map(([slot, engine]) => ({
					slot,
					peakIterations: engine.getMaxIterations(),
				})),
				isWasmConsole: this.isWasmActive,
				cpuLoadPercent,
				cpuPeakPercent,
				cpuP95Percent,
				cpuSessionPeakPercent,
				quantumTimeMs: avgQuantumTimeMs,
				overrunCount: this.overrunCount,
			});
		}

		return true;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

registerProcessor(playerWorkletProcessorName, PlayerWorkletProcessor);

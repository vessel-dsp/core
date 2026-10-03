// The v2 AudioWorkletProcessor: hosts the v2 runtime (../reference-runtime.ts) in
// the audio thread, driven by a compiled Program (@vessel-dsp/compiler).
//
// Ported from the workbench reference copy at `workbench/src/web/v2-audio-worklet.ts`,
// which the workbench keeps; this package copy is the npm-published one. `program`
// slots (TS and WASM consoles) behave identically; `nam`/`ir` slots are refused by
// name here (see `buildSlots`) because the slot adapters ship in
// `@vessel-dsp/player`, not this package, per docs/design/player-architecture.md §4.
// This is S2 --
// "someone hears it" -- executed as a parallel, minimal worklet path alongside the v1
// spine's audio-worklet.ts, never through it. See thoughts/shared/plans/2026-08-12-runtime-modules.md
// (S2) and 2026-08-10-compiler-pipeline-modules.md (step P).
//
// Deliberately NOT the v1 protocol (pedal-worklet-protocol-types.d.ts): that one is a
// 19-way block.type configure chain plus a 622-line control dispatch keyed on 8 block
// types x ~35 parameter ids, which is exactly the boundary this plan says not to grow.
// The v2 runtime is a generic console -- operators, parameters and state layout all come
// from the Program -- so its protocol is two messages: load a Program, set a control.
//
// Self-contained by necessity, not merely by convention: this file is bundled separately
// (scripts/build-worklet.ts) into dist/worklet/v2-audio-worklet.js and loaded via
// `audioContext.audioWorklet.addModule(...)`. This file imports from
// `@vessel-dsp/compiler` and this package's own modules, whose *own* internal imports
// are extension-less (`from "./types"`, written for Node/bundler resolution, not raw
// browser ESM) -- so a plain tsc mirror would not resolve in an
// AudioWorkletGlobalScope, which has no import map and no bundler-style
// bare-specifier resolution. Bundling into one file sidesteps that without changing a
// single import in the compiler or the runtime.

import type { ControlId, Program } from "@vessel-dsp/compiler";
import { ChainRuntime } from "../chain";
import { bypassNotModelledAdvisories, chainAdvisories } from "../chain-advisories";
import { dacScaleFactor, outputConversionFullScale } from "../chain-scale";
import {
	type BypassMode,
	type ChainSlot,
	type ExternalProcessor,
	processorSlot,
	programSlot,
	type resolveBypassMode,
	slotContract,
} from "../chain-slot";
// The C++/WASM v2 console's Emscripten glue, statically bundled so the worklet ships as
// one file: a dynamic import would need a module loader, and an
// AudioWorkletGlobalScope has none. The wasm binary itself arrives in the load message
// (`wasmConsole`), because this global scope cannot fetch; `instantiateWasm` below
// feeds those bytes in.
// @ts-expect-error -- a build output with no type declarations.
import createV2DspModule from "../wasm/v2_dsp.cjs";
import { V2WasmEngine } from "../v2-wasm-engine";
import { supplyGroundConflicts } from "../supply-ground";
import {
	v2WorkletProcessorName,
	type V2WorkletInboundMessage,
	type V2WorkletOutboundMessage,
	type V2WorkletSlot,
} from "./v2-worklet-protocol";

// AudioWorkletGlobalScope has no shipped TypeScript lib (same gap audio-worklet.ts works
// around at its own top), so the globals and base class are declared locally. The port
// is structural rather than `MessagePort`: this package typechecks without a DOM lib,
// and the real port always satisfies this shape.
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

// Telemetry is posted roughly this often rather than every quantum: a silent overrun must
// be visible (Evidence Hygiene), not that it is visible every 2.7 ms. 4096 samples is
// ~85 ms at 48 kHz -- frequent enough that a listener sees a held-sample count climb
// within a note, rare enough not to flood the port.
const TELEMETRY_INTERVAL_SAMPLES = 4096;

class V2PedalProcessor extends AudioWorkletProcessor {
	private runtime: ChainRuntime | null = null;
	private isPassthrough = false;
	private isWasmActive = false;
	private wasmConsoleAvailable = false;
	private samplesSinceTelemetry = 0;
	private totalQuantumTimeMs = 0;
	private quantumMeasurementCount = 0;
	private overrunCount = 0;
	/**
	 * QUANTUM-TIME DISTRIBUTION, not just its mean.
	 *
	 * A real-time deadline is missed by an individual quantum, so the mean is the one statistic
	 * that cannot detect the failure: `sunn-beta-lead` reported 101% CPU while missing 616
	 * deadlines, and the readout looked healthy the whole time. Peak and p95 are what a listener
	 * is actually hearing.
	 *
	 * A histogram rather than a ring buffer because this runs on the audio thread: binning is O(1)
	 * per quantum and reading a percentile is O(bins) once per telemetry window, where keeping the
	 * last N times and sorting them would put a periodic tens-of-microseconds spike inside the very
	 * budget being measured. Bin width is 1/32 of budget (~3.1%), so a percentile is reported to
	 * within one bin; everything past 400% lands in the overflow bin and is reported as ">=400%".
	 */
	private static readonly CPU_BINS = 128;
	private static readonly CPU_BIN_FRACTION = 1 / 32;
	private cpuHistogram = new Uint32Array(V2PedalProcessor.CPU_BINS + 1);
	private cpuWindowCount = 0;
	private cpuWindowPeakMs = 0;
	/** Never reset while a chain is loaded: a rare spike must not scroll away between windows. */
	private cpuSessionPeakMs = 0;
	/**
	 * WASM-console engines by slot index, when the load message chose the C++/WASM console.
	 * Control routing needs this map: `ChainRuntime.setControl` rightly refuses processor
	 * slots (a silently ignored knob is the failure telemetry exists to avoid), and a WASM
	 * program slot *does* carry compiled controls — they just live behind the C ABI.
	 */
	private wasmEngines = new Map<number, V2WasmEngine>();
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
			void this.loadChain(message.slots, message.wasmConsole);
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

	/**
	 * A program slot running on the C++/WASM console, presented to the chain as an
	 * `ExternalProcessor`. The slot contract comes from the Program itself — same coverage,
	 * full-scale and impedance facts the TS console's `programSlot` exposes — so the seam
	 * arithmetic cannot tell the consoles apart, which is the point.
	 */
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
		return { kind: "processor", processor, bypassMode, program } as any;
	}

	/**
	 * Build the runtime's slots from the message's descriptors.
	 *
	 * `program` slots only. A `nam` or `ir` descriptor is refused by name (thrown
	 * into `loadChain`'s reported error, the same way an unloadable program is):
	 * the NAM/IR slot adapters ship in `@vessel-dsp/player`, not this package, per
	 * docs/design/player-architecture.md §4, and a slot kind that cannot run must
	 * refuse rather than sit silent in the chain. The protocol still describes all
	 * three kinds so hosts post one shape.
	 */
	private async buildSlots(
		descriptors: readonly V2WorkletSlot[],
		wasmConsole?: { readonly wasmBytes: ArrayBuffer },
	): Promise<ChainSlot[]> {
		// One module instantiation per chain, shared by every program slot's engine — the
		// engines are separate handles inside it. A failure here throws into loadChain's
		// reported error; there is deliberately no fallback to the TS console (see the
		// protocol comment: two consoles that can disagree must never be swapped quietly).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let wasmModule: any = null;
		if (wasmConsole !== undefined) {
			const bytes = wasmConsole.wasmBytes;
			wasmModule = await createV2DspModule({
				instantiateWasm: (
					// `Bun.WebAssembly.Imports`: the global `WebAssembly` namespace this
					// package typechecks against (no DOM lib) exposes no `Imports` alias.
					// Type-only; erased from the bundle.
					imports: Bun.WebAssembly.Imports,
					receive: (instance: WebAssembly.Instance) => void,
				) => {
					void WebAssembly.instantiate(bytes, imports).then((result) =>
						receive(result.instance),
					);
					return {};
				},
			});
		}
		const slots: ChainSlot[] = [];
		for (const [slotIndex, descriptor] of descriptors.entries()) {
			if (descriptor.kind === "program") {
				const bypassMode = (descriptor as any).bypassMode ?? "effect";
				const bufferProgram = (descriptor as any).bufferProgram as import("@vessel-dsp/compiler").Program | undefined;
				if (wasmModule !== null) {
					const engine = await V2WasmEngine.create(descriptor.program, wasmModule);
					if (bufferProgram !== undefined) {
						const bufEngine = await V2WasmEngine.create(bufferProgram, wasmModule);
						const mainProc = this.createWasmExternalProcessor(slotIndex, descriptor.program, engine);
						const bufProc = this.createWasmExternalProcessor(1000 + slotIndex, bufferProgram, bufEngine);
						this.wasmEngines.set(slotIndex, engine);
						this.wasmEngines.set(1000 + slotIndex, bufEngine);
						slots.push({ kind: "processor", processor: mainProc, bufferProcessor: bufProc, bypassMode, program: descriptor.program } as any);
					} else {
						slots.push(this.wasmProgramSlot(slotIndex, descriptor.program, engine, bypassMode));
					}
				} else {
					const slot = programSlot(descriptor.program, bufferProgram);
					(slot as any).bypassMode = bypassMode;
					slots.push(slot);
				}
			// A wire slot has no port and contributes no bounds downstream: bounds
			// lending belonged to the `ir` filter path, which this package does not
			// ship (see `buildSlots`), so there is nothing to lend to.
			continue;
			}
			if (descriptor.kind === "nam") {
				throw new Error(
					`v2 worklet: slot ${slotIndex} ("${descriptor.id}") is kind "nam": this package's worklet runs program slots only; NAM slots ship in @vessel-dsp/player`,
				);
			}
			throw new Error(
				`v2 worklet: slot ${slotIndex} ("${descriptor.id}") is kind "ir": this package's worklet runs program slots only; IR slots ship in @vessel-dsp/player`,
			);
		}
		return slots;
	}

	private async loadChain(
		descriptors: readonly V2WorkletSlot[],
		wasmConsole?: { readonly wasmBytes: ArrayBuffer },
	): Promise<void> {
		try {
			// WASM-console engines from a previous chain, released before the new one
			// takes over: the module is shared and stays, but each engine holds state.
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
				});
				return;
			}
			this.isPassthrough = false;

			const slots = await this.buildSlots(descriptors, wasmConsole);
			const runtime = new ChainRuntime(slots);
			// The only entry point that accepts a sample rate, and there is no fallback --
			// the runtime is rate-agnostic by design, so it always takes the real
			// AudioContext rate this global scope was constructed at, never a hardcoded 48000.
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

			// Scaling: if the chain's last slot produces high-voltage speaker-electrical output,
			// scale into the WebAudio unit range [-1, 1] so it does not peg the DAC against the rail.
			// A program's declared 0 dBFS reference wins over the derived ceiling -- the same rule
			// `render-v2-audio.ts` converts a +/-1 file by -- so a preamp monitor tap that declares
			// `V0dBFS` is not scaled by a supply bound ten times its swing.
			// For a wire tail, scale against the last non-wire slot — a wire has no port.
			// Buffer is a real stage, so it counts as active for scaling.
			let lastActiveSlot: ChainSlot | null = null;
			for (let idx = slots.length - 1; idx >= 0; idx -= 1) {
				if ((slots[idx] as any)?.bypassMode !== "wire") {
					lastActiveSlot = slots[idx]!;
					break;
				}
			}
			const program =
				(lastActiveSlot as any)?.program ??
				(lastActiveSlot?.kind === "program" ? lastActiveSlot.program : null);
			const fullScaleOut =
				program !== null
					? outputConversionFullScale(program)
					: lastActiveSlot !== null
						? outputConversionFullScale(slotContract(lastActiveSlot))
						: null;
			this.outputScale = dacScaleFactor(fullScaleOut);
		// Load-time scale readout: a bypassed program's bounds must never reach the
		// output scale (see the wire guard in buildSlots above), so print what did.
		console.log(
			`[worklet] load slots=${slots.length} fullScaleOut=${fullScaleOut === null ? "null" : fullScaleOut.toFixed(2)}V scale=${this.outputScale}`,
		);

			// Only a program slot has controls. A processor slot is skipped rather than reported
			// with an empty list, and `ChainRuntime.setControl` throws on one -- an inert knob is
			// worse than a missing one, because a listener cannot tell it from a broken circuit.
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
			// Advisory, and reported alongside a successful load rather than instead of one:
			// mixing grounds is a hazard for the board a listener would build, not a fault in
			// the render. See `../runtime/supply-ground.ts`.
			this.post({
				type: "loaded",
				controls,
				supplyGroundConflicts: supplyGroundConflicts(programs),
				chainAdvisories: [...chainAdvisories(slots.map(slotContract)), ...bypassNotModelledAdvisories(slots)],
			});
		} catch (error) {
			this.runtime = null;
			this.isPassthrough = false;
			this.isWasmActive = false;
			this.post({ type: "error", message: errorMessage(error) });
		}
	}

	private setControl(slot: number, id: ControlId, position: number): void {
		if (this.runtime === null) {
			return;
		}
		try {
			// A WASM program slot's controls live behind the C ABI, not in a ReferenceRuntime,
			// so route there first; ChainRuntime's own refusal still covers genuinely
			// control-less processor slots (NAM, IR).
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
			// A refusal or an unimplemented-operator throw must be visible, never silently
			// swallowed into a plausible-looking hum: report it once, go silent, and stop
			// calling into a runtime that just proved it cannot execute this program. A
			// per-sample throw must never propagate out of process(), which would kill the
			// whole audio graph rather than just this experimental path.
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
		// Bin this quantum. The last bin is the overflow: anything at or past 400% of budget.
		if (budgetMs > 0) {
			const bin = Math.min(
				V2PedalProcessor.CPU_BINS,
				Math.floor(elapsedMs / budgetMs / V2PedalProcessor.CPU_BIN_FRACTION),
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
			const currentSr = typeof sampleRate !== "undefined" ? sampleRate : 48000;
			const quantumBudgetMs = (quantumLength / currentSr) * 1000;
			const cpuLoadPercent = quantumBudgetMs > 0 ? (avgQuantumTimeMs / quantumBudgetMs) * 100 : 0;
			// p95 off the histogram: walk bins until 95% of the window's quanta are behind us.
			// Report the bin's value (lower edge), not its upper edge: the worklet clock only
			// resolves whole milliseconds, and at 128/48k the budget is 8/3 ms, so
			// 32 bins/budget / (8/3 ms) = 12 bins/ms. Every quantum therefore lands exactly on a
			// bin's lower edge, and the old `(bin + 1)` upper edge over-read every value by a full
			// unmeasured bin (+3.125%). The 12-bin (37.5%) step is the clock resolution, not the
			// ceiling, so no bin width removes it; dropping the `+1` makes the figure exact to it.
			let cpuP95Percent = 0;
			if (this.cpuWindowCount > 0) {
				const target = this.cpuWindowCount * 0.95;
				let seen = 0;
				for (let bin = 0; bin <= V2PedalProcessor.CPU_BINS; bin += 1) {
					seen += this.cpuHistogram[bin] ?? 0;
					if (seen >= target) {
						cpuP95Percent = bin * V2PedalProcessor.CPU_BIN_FRACTION * 100;
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
				// Every slot reported separately -- see V2WorkletOutboundMessage's own
				// comment on why a chain's telemetry is never blended into one total.
				slots: telemetry.map((slotTelemetry) => ({
					slot: slotTelemetry.slot,
					samples: slotTelemetry.samples,
					heldSamples:
						slotTelemetry.nonConvergedSamples + slotTelemetry.nonFiniteSamples,
					operatingPointFailures: slotTelemetry.operatingPointFailures,
					peakIterations: slotTelemetry.peakIterations,
				})),
				// `ChainRuntime.telemetry()` reports nothing for a processor slot, and every WASM
				// slot IS a processor slot -- so `slots` above is empty on the WASM console and the
				// iteration peak has to come from the engines directly. See `wasmSlots` in the
				// protocol for why this is a separate field and not a synthetic slot row.
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

registerProcessor(v2WorkletProcessorName, V2PedalProcessor);

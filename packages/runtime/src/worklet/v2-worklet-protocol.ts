// Message protocol between the main thread and the v2 AudioWorkletProcessor
// (v2-audio-worklet.ts). Ported from the workbench reference copy at
// `workbench/src/web/v2-worklet-protocol.ts`, which the workbench keeps; this
// package copy is the npm-published one. Behaviour is identical; only the
// imports below are retargeted into this package, and the `postV2WorkletMessage`
// port parameter is structural so hosts without a DOM lib can call it.
// Deliberately separate from pedal-worklet-protocol-types.d.ts:
// that protocol is v1's and carries 19 block.type variants plus a 622-line control
// dispatch (see thoughts/shared/plans/2026-08-12-runtime-modules.md, "where the boundary
// actually breaks"). The v2 runtime is a generic console that executes whatever a
// compiled Program declares, so its protocol is two messages, not a per-pedal dispatch.
//
// Both the worklet (bundled separately, see scripts/build-worklet.ts) and the main-thread
// panel import this file. It carries no runtime code beyond a couple of trivial
// constructors, so being imported into two separate bundles duplicates nothing that
// matters.
//
// "load" carries an ordered chain (`src/runtime/chain.ts`), not a single Program: a single
// pedal is that chain's one-element case, not a separate message shape -- the same "no
// single-program entry point" decision `admission.ts` already made. "setControl" addresses
// a control by (slot, id) rather than id alone, because two identical pedals in a chain
// declare the same control ids and slot index is the only thing that disambiguates them.

import type { ControlId, Program } from "@vessel-dsp/compiler";
import type { ChainAdvisory } from "../chain-advisories";
import type { StageCoverage } from "../chain-slot";
import type { SupplyGroundConflict } from "../supply-ground";

export const v2WorkletProcessorName = "v2-pedal-processor";

/**
 * The minimum port surface the worklet helper needs. `MessagePort` rather than a
 * narrower type is what the workbench copy takes; this structural form accepts the
 * same object while keeping this headless package free of a DOM lib import, so a
 * host (or a bun test) can pass any `{ postMessage }` holder, including a real port.
 */
export type V2WorkletPort = {
	postMessage(message: V2WorkletInboundMessage): void;
};

/**
 * Send an inbound message to the worklet, type-checked.
 *
 * **This exists because `MessagePort.postMessage` takes `any`.** When the `load` message changed
 * from `programs` to `slots`, `tsc` stayed silent on the one call site that still sent the old
 * shape -- the worklet would have read `message.slots` as `undefined` and gone quiet, with no
 * compile error anywhere. A one-line wrapper is the difference between that and a build failure.
 */
export function postV2WorkletMessage(
	port: V2WorkletPort,
	message: V2WorkletInboundMessage,
): void {
	port.postMessage(message);
}

/**
 * One slot in the chain the worklet is asked to build.
 *
 * **A discriminated union rather than a `Program[]`, because a chain slot is no longer always a
 * compiled circuit.** The runtime has accepted injected processors since heterogeneous chain slots
 * landed; this is the message shape that lets a caller send one. `programs` is gone rather than
 * kept alongside -- an obsolete path, not a compatibility surface.
 *
 * `ir` covers **both** an impulse response and the cab simulation, and that is the design rather
 * than a shortcut: nothing in `ChainSlot` distinguishes them, since both are buffer-in/buffer-out
 * filters producing a miked signal, so a second kind would be two names for one behaviour.
 *
 * `nam` is its own kind for the opposite reason -- not because the chain treats it differently, but
 * because building one needs different *inputs*: wasm bytes and a model document rather than taps.
 * The `ExternalProcessor` it becomes is indistinguishable to the chain.
 */
export type BypassMode = "wire" | "buffer" | "effect";

export type V2WorkletSlot =
	| {
			readonly kind: "program";
			readonly program: Program;
			readonly bufferProgram?: Program;
			readonly bypassMode?: BypassMode;
	  }
	| {
			readonly kind: "ir";
			/** Named in advisories and telemetry. A label, never a discriminator. */
			readonly id: string;
			/**
			 * Impulse response taps at the destination `AudioContext` rate. A `Float32Array`
			 * rather than a number list: structured clone carries typed arrays, and an IR is
			 * thousands of taps where JSON would be both large and lossy about precision.
			 * Resampling is the caller's, via `cab-mic-external-ir-resample.ts`.
			 */
			readonly taps: Float32Array;
			readonly produces?: StageCoverage;
			readonly expects?: StageCoverage;
			/**
			 * Optional scalar on the taps. Omitted means 1 and no normalisation -- the worklet
			 * invents no level. See `IrProcessorOptions.gain`.
			 */
			readonly gain?: number;
			readonly bypassMode?: BypassMode;
	  }
	| {
			readonly kind: "nam";
			/** Named in advisories and telemetry. A label, never a discriminator. */
			readonly id: string;
			/**
			 * The bytes of `web/nam-engine.wasm`.
			 *
			 * **Passed in rather than fetched, which is a requirement and not a preference:** an
			 * `AudioWorkletGlobalScope` has no `fetch`, so the module cannot load itself there. The
			 * worklet memoises instantiation, so sending these on a second load costs a structured
			 * clone and nothing more -- it will not recompile the module, which is the thing that
			 * crashed iOS tabs in the architecture this replaced.
			 */
			readonly wasmBytes: ArrayBuffer;
			/** The `.nam` document's text. The engine parses it; nothing here does. */
			readonly modelJson: string;
			/**
			 * Defaults to `speaker-electrical` -- a load-box capture is taken *at* the speaker
			 * terminal. Pass `miked` only for a profile that states it is a full-rig capture; nothing
			 * infers that from a file name or a title.
			 */
			readonly produces?: StageCoverage;
			readonly expects?: StageCoverage;
			/** A2/slimmable size in [0,1]; negative or omitted selects full size. */
			readonly slimSize?: number;
	  };

/** Main thread -> worklet. */
export type V2WorkletInboundMessage =
	| {
			readonly type: "load";
			/** An ordered chain of slots. A compiled Program round-trips through emit() already
			 * (src/compiler/emit.ts) and an IR's taps are a typed array, so structured clone
			 * carries the whole list intact. Slot 0 runs first; its output feeds slot 1, and so
			 * on. */
			readonly slots: readonly V2WorkletSlot[];
			/**
			 * When present, every `program` slot runs on the C++/WASM console instead of the
			 * TS `ReferenceRuntime` — same Program ROM, different console. The host supplies
			 * the wasm binary because an AudioWorkletGlobalScope cannot fetch; the glue is
			 * bundled statically like the NAM engine's. Absent means the TS console, which is
			 * also the fallback for nothing: a wasm load failure is a reported error, never a
			 * silent downgrade — two consoles that can disagree must never be swapped quietly.
			 */
			readonly wasmConsole?: { readonly wasmBytes: ArrayBuffer };
	  }
	| {
			readonly type: "setControl";
			/** Which slot's program owns this control. */
			readonly slot: number;
			readonly id: ControlId;
			/** 0..1. That slot's own runtime applies its program's own taper; nothing here does. */
			readonly position: number;
	  }
	| {
			readonly type: "setBypassMode";
			/** Which slot to change bypass mode for. */
			readonly slot: number;
			readonly mode: BypassMode;
	  };

/** Worklet -> main thread. */
export type V2WorkletOutboundMessage =
	| {
			readonly type: "loaded";
			/** Every slot's controls, labelled by slot so a listener can address `setControl`
			 * correctly even when two slots declare the same control id. */
			readonly controls: readonly {
				readonly slot: number;
				readonly id: ControlId;
			}[];
			/**
			 * Chain-level supply-ground conflicts (`src/runtime/supply-ground.ts`), empty when
			 * the chain agrees.
			 *
			 * Carried on `loaded` rather than as its own message, and that is the point: it is
			 * a property of the chain that just loaded, so it cannot arrive stale, be missed by
			 * a listener that subscribed late, or outlive the chain it describes. It rides
			 * *with* a successful load because the chain plays correctly either way -- each
			 * program is solved against its own rails -- and what it warns about is the board a
			 * listener would have to build to hear this on hardware.
			 *
			 * The type comes from the runtime module that computes it rather than being
			 * restated here, so the two cannot drift.
			 */
			readonly supplyGroundConflicts: readonly SupplyGroundConflict[];
			/**
			 * What the chain can say about itself that no single program can
			 * (`src/runtime/chain-advisories.ts`): a seam it could not scale, or a slot whose
			 * speaker-terminal output feeds another slot's input. Empty when the chain is sound.
			 *
			 * Carried on `loaded` for the same reason as the conflicts above: it describes the
			 * chain that just loaded. A level mismatch is not corrected at such a seam, which is
			 * the old behaviour — the difference is that it is now stated rather than silent.
			 */
			readonly chainAdvisories: readonly ChainAdvisory[];
	  }
	| {
			readonly type: "telemetry";
			/** Every slot's own telemetry, labelled by slot and never blended into one total --
			 * a non-converging pedal in slot 2 must stay visible even when slot 0 is clean.
			 * `heldSamples` is nonConvergedSamples + nonFiniteSamples from RuntimeTelemetry: a
			 * silent overrun must be visible, per this repository's Evidence Hygiene rule. */
			readonly slots: readonly {
				readonly slot: number;
				readonly samples: number;
				readonly heldSamples: number;
				readonly operatingPointFailures: number;
				readonly peakIterations: number;
			}[];
			/**
			 * The WASM console's per-slot iteration peak. Separate from `slots` rather than folded
			 * into it because a WASM slot is an `ExternalProcessor` to `ChainRuntime`, which reports
			 * no telemetry for it at all -- so `slots` arrives EMPTY on the WASM path and the UI read
			 * `Peak: 0 iters` while the engine was at 232% CPU. Reporting a synthetic slot row with
			 * `heldSamples: 0` would have been worse: this module already refuses to let a processor
			 * slot claim a zero held-sample count, because "never ran a solve" and "converged fine"
			 * must not print the same. So only the field the C ABI actually exposes is carried.
			 */
			readonly wasmSlots?: readonly {
				readonly slot: number;
				/** `Engine::maxIterationsObserved()` -- a SESSION peak, never reset, not a window. */
				readonly peakIterations: number;
			}[];
			/** True when the active program slots are executed on the WASM console. */
			readonly isWasmConsole?: boolean;
			/**
			 * MEAN CPU budget usage over the telemetry window (100% = the whole 2.67 ms quantum).
			 * A mean is the wrong statistic for a deadline and is kept only as context: an amp can
			 * average 101% while missing 616 deadlines, because what overruns is individual quanta,
			 * not the average. Judge with `cpuPeakPercent`/`cpuP95Percent`, and with `overrunCount`.
			 */
			readonly cpuLoadPercent?: number;
			/** Worst single quantum in the telemetry window, as a percentage of budget. */
			readonly cpuPeakPercent?: number;
			/** 95th-percentile quantum in the window, as a percentage of budget. */
			readonly cpuP95Percent?: number;
			/** Worst single quantum since the chain loaded -- a rare spike must not scroll away. */
			readonly cpuSessionPeakPercent?: number;
			/** Average compute time per 128-sample quantum in milliseconds. */
			readonly quantumTimeMs?: number;
			/** Total number of audio quantum deadlines missed (quantum compute time > budget). */
			readonly overrunCount?: number;
	  }
	| {
			/** A refusal or a per-sample throw. The worklet goes silent rather than
			 * killing the audio graph; this message is how a listener finds out why. */
			readonly type: "error";
			readonly message: string;
	  };

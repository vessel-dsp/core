// A chain: an ordered list of compiled Programs the v2 console runs in series -- slot 0's
// output sample feeds slot 1's input sample, and so on, and the last slot's output is the
// chain's output. This is what makes "pedal A into pedal B" a runtime concern rather than a
// compiler one.
//
// **A chain is a property of the runtime, never of a Program.** No field here describes a
// program's position in a chain, no program is fused with another at any point, and no
// pedal's compiled bytes change depending on which slot it occupies. `ChainRuntime` is
// nothing more than N independent `ReferenceRuntime` instances, each with its own state and
// its own `prepare(rate)`, wired output-to-input. A single pedal is the one-element case of
// this, not a separate code path -- see `admission.ts`'s own header, which already says so:
// "there is no single-program entry point left ... a caller with one program passes a
// one-element list and gets an identical answer." `admission.ts` and
// `reference-runtime.ts`'s `prepare()` both already name this file in comments written
// before it existed; this is that file.
//
// **Gate once, prepare ungated.** `admissionVerdict` takes the whole ordered list and sums
// worst-case cost across every slot -- gating each slot separately against the whole budget
// is exactly the permissive failure admission.ts's header warns about (three pedals at 0.9x
// each, admitted individually, need 2.7x together). So `prepare()` here calls
// `admissionVerdict` once over `this.programs`, then prepares every slot's own
// `ReferenceRuntime` with no `realtimeBudget` at all -- passing the budget down a second
// time would charge each slot against the *whole* chain's budget again.
//
// The operator/model lockout is untouched and still runs per slot: it is a question about
// whether a runtime can execute a program at all, independent of any budget, and it lives
// inside `ReferenceRuntime.prepare()` before that method ever looks at `realtimeBudget` --
// see its own comment. A slot that fails it here is refused with the slot named, because
// `ReferenceRuntime`'s own `RuntimeError` has no way to know which slot it was running in.

import type { ControlId, Program } from "@vessel-dsp/compiler";
import { admissionVerdict, type RealtimeBudget } from "./admission";
import { seamScale } from "./chain-advisories";
import {
	type ChainSlot,
	type ExternalProcessor,
	type SlotContract,
	slotContract,
	slotLabel,
} from "./chain-slot";
import {
	DEFAULT_NEWTON_MAX_ITERATIONS,
	ReferenceRuntime,
	RuntimeError,
	type RuntimeTelemetry,
} from "./reference-runtime";

/** One slot's own telemetry, labelled by position. See `ChainRuntime.telemetry()`. */
export type ChainSlotTelemetry = RuntimeTelemetry & { readonly slot: number };

export class ChainRuntime {
	private readonly slots: readonly ChainSlot[];
	private readonly contracts: readonly SlotContract[];
	/** One per slot: a runtime for a program, the injected processor otherwise. */
	private readonly engines: readonly (ReferenceRuntime | ExternalProcessor)[];

	constructor(slots: readonly ChainSlot[]) {
		if (slots.length === 0) {
			throw new RuntimeError("a chain needs at least one slot, got 0");
		}
		this.slots = slots;
		this.contracts = slots.map((slot) => slotContract(slot));
		this.engines = slots.map((slot) =>
			slot.kind === "program"
				? new ReferenceRuntime(slot.program)
				: slot.processor,
		);
	}

	/** How many slots this chain has. */
	get length(): number {
		return this.engines.length;
	}

	/**
	 * Gates the whole chain once (see this module's header), then prepares every slot,
	 * ungated, at the same rate and iteration cap. A slot's own refusal -- an operator or
	 * DSP model this runtime cannot execute -- is rethrown naming its slot, since
	 * `ReferenceRuntime`'s `RuntimeError` cannot know which slot it ran in.
	 */
	prepare(
		sampleRate: number,
		options: {
			readonly maxNewtonIterations?: number;
			readonly realtimeBudget?: RealtimeBudget;
		} = {},
	): void {
		// Resolved here, once, so the iteration count the admission gate charges is exactly
		// the iteration count every slot will actually be prepared with -- `ReferenceRuntime`
		// resolves the identical default the identical way, from the identical constant.
		const maxNewtonIterations = Math.max(
			1,
			Math.floor(options.maxNewtonIterations ?? DEFAULT_NEWTON_MAX_ITERATIONS),
		);
		if (options.realtimeBudget !== undefined) {
			// **Only the compiled slots are charged.** The admission model costs Newton iterations
			// against a matrix it can size from the program; an injected NAM or IR has neither, and
			// guessing a cost for it would make the verdict a fiction. A chain whose processors are
			// expensive can still overrun, and that is the host's to know -- so a `fits` verdict here
			// means the circuit slots fit, not that the whole chain does.
			const verdict = admissionVerdict(
				this.slots.flatMap((slot) =>
					slot.kind === "program" ? [slot.program] : [],
				),
				sampleRate,
				options.realtimeBudget,
			);
			if (!verdict.fits) {
				throw new RuntimeError(verdict.reason);
			}
		}
		for (const [slot, engine] of this.engines.entries()) {
			try {
				// Ungated: `realtimeBudget` is deliberately not forwarded here. The whole
				// chain was already charged against it above; forwarding it per slot would
				// charge every slot against the whole chain's budget a second time.
				if (engine instanceof ReferenceRuntime) {
					engine.prepare(sampleRate, { maxNewtonIterations });
				} else {
					engine.prepare(sampleRate);
				}
			} catch (error) {
				if (error instanceof RuntimeError) {
					throw new RuntimeError(`slot ${slot}: ${error.message}`);
				}
				throw error;
			}
		}
	}

	/**
	 * Slot 0 runs on `input`; its output buffer becomes slot 1's input, and so on -- the
	 * last slot's output is the chain's output.
	 *
	 * Whole buffers pass between slots rather than sample-by-sample calls between them.
	 * That is safe, not merely convenient: this is a feedforward chain (no slot reads a
	 * later slot's output), `ReferenceRuntime.process` has no lookahead -- each sample is a
	 * causal function of that slot's own past reactive state and the sample handed to it --
	 * so slot 1 sees the identical sample sequence in the identical order whether the chain
	 * hands it one sample at a time or the whole buffer at once. Each slot still advances
	 * its own sample-by-sample loop internally exactly as it always has.
	 *
	 * Allocates one `Float64Array` per slot per call (each `ReferenceRuntime.process` call
	 * allocates its own output buffer) -- for a worklet driven at a small quantum this is an
	 * allocation on the audio thread every callback, once per slot in the chain. Left as is:
	 * reusing scratch buffers across slots is a separate change, noted rather than made here.
	 */
	process(input: Float64Array): Float64Array {
		let buffer = input;
		for (const [slot, engine] of this.engines.entries()) {
			// The seam, before the slot that receives it. A pedal's output is the voltage at its
			// jack and an amp's is the voltage at its speaker terminal, so handing one straight
			// to the next -- which is what this loop did -- is an order-of-magnitude error the
			// moment the two are not the same kind of block. `seamScale` is 1 where either side
			// states no full scale, which keeps the old behaviour and is reported by
			// `chainScalingAdvisories` rather than passing silently.
			if (slot > 0) {
				const scale = seamScale(this.contracts, slot);
				if (scale !== 1) {
					// A fresh array: `buffer` is the previous slot's own output buffer, and
					// scaling in place would corrupt what that runtime may still hold.
					const scaled = new Float64Array(buffer.length);
					for (let index = 0; index < buffer.length; index += 1) {
						scaled[index] = (buffer[index] ?? 0) * scale;
					}
					buffer = scaled;
				}
			}
			buffer = engine.process(buffer);
		}
		return buffer;
	}

	/**
	 * Addresses a control by (slot, id). Slot index is the only disambiguator: two identical
	 * pedals in the chain declare the same control ids, but each slot owns an independent
	 * `ReferenceRuntime` with its own control-position map, so the shared id never collides
	 * with the other slot's.
	 */
	setControl(slot: number, id: ControlId, position: number): void {
		const engine = this.engines[slot];
		if (engine === undefined) {
			throw new RuntimeError(
				`chain has no slot ${slot} (chain length is ${this.engines.length})`,
			);
		}
		// A processor has no compiled controls. Its parameters are the host's to set on the object
		// it supplied, which is why refusing here names the slot rather than inventing a no-op: a
		// silently ignored knob is the failure this whole file's telemetry exists to avoid.
		if (!(engine instanceof ReferenceRuntime)) {
			throw new RuntimeError(
				`slot ${slot} is an injected processor (${slotLabel(this.slots[slot] as ChainSlot, slot)}) ` +
					`and carries no compiled control "${id}": set it on the processor the host supplied`,
			);
		}
		engine.setControl(id, position);
	}

	/**
	 * Every slot's own telemetry, labelled by position -- never blended into one set of
	 * totals. A chain's `samples`/`heldSamples`/etc. are per-slot facts (a nonlinear block
	 * failing to converge in slot 2 says nothing about slot 0), so summing or averaging them
	 * would silently under-report whichever slot is actually struggling; see this module's
	 * header and `RuntimeTelemetry` in `reference-runtime.ts`.
	 */
	telemetry(): readonly ChainSlotTelemetry[] {
		// Only the compiled slots have telemetry to give -- `samples`, `heldSamples`, Newton counts
		// are all properties of an MNA solve. A processor slot is absent rather than reported as
		// zeroes, because a zero held-sample count would read as "converged fine" for something that
		// never ran a solve at all.
		return this.engines.flatMap((engine, slot) =>
			engine instanceof ReferenceRuntime
				? [{ ...engine.telemetry(), slot }]
				: [],
		);
	}
}

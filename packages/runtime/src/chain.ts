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
import type { SupplyAddress } from "./supply";
import {
	DEFAULT_NEWTON_MAX_ITERATIONS,
	ReferenceRuntime,
	RuntimeError,
	type RuntimeTelemetry,
} from "./reference-runtime";

/** One slot's own telemetry, labelled by position. See `ChainRuntime.telemetry()`. */
export type ChainSlotTelemetry = RuntimeTelemetry & { readonly slot: number };

export type BypassMode = "wire" | "buffer" | "effect";

/**
 * Corner of the chain's output DC blocker, in hertz.
 *
 * The same 10 Hz first-order pole `scripts/render-v2-audio.ts` has used since the
 * `marshall-blues-breaker` finding. The two paths must agree: a packet that is listenable
 * offline and silent in the browser is precisely the defect this constant exists to close.
 */
const DC_BLOCK_HZ = 10;

export class ChainRuntime {
	private readonly slots: ChainSlot[];
	private readonly contracts: readonly SlotContract[];
	/** One per slot: a runtime for a program, the injected processor otherwise. */
	private readonly engines: readonly (ReferenceRuntime | ExternalProcessor)[];
	/** Parallel buffer engines; ExternalProcessor for WASM buffer, ReferenceRuntime for TS buffer. */
	private readonly bufferEngines: readonly (ReferenceRuntime | ExternalProcessor | null)[];
	/**
	 * Output DC blocker state, carried across `process` calls.
	 *
	 * **A chain ends in something, and that something is AC-coupled.** A runtime reads the
	 * output jack unloaded and DC-coupled, which no real signal chain is: the next device
	 * always presents a coupling cap and an input resistance. Without this the jack's
	 * operating point reaches the converter, and a packet whose output sits a few volts off
	 * ground clamps every sample to full scale -- audible offline, digitally silent here.
	 * Measured 2026-09-22: four corpus packets were in that state, `boss-dd-5` at 3.561 V
	 * against a 1.0 V full scale.
	 *
	 * Stateful across calls because a worklet hands over 128 samples at a time; a per-buffer
	 * mean-subtract would put a step at every quantum boundary.
	 */
	private dcPole = 0;
	private dcPreviousIn = 0;
	private dcPreviousOut = 0;

	constructor(slots: readonly ChainSlot[]) {
		if (slots.length === 0) {
			throw new RuntimeError("a chain needs at least one slot, got 0");
		}
		this.slots = slots.map((s) => ({ ...s })) as ChainSlot[];
		this.contracts = this.slots.map((slot) => slotContract(slot));
		this.engines = this.slots.map((slot) =>
			slot.kind === "program"
				? new ReferenceRuntime(slot.program)
				: slot.processor,
		);
		this.bufferEngines = this.slots.map((slot) => {
			if ((slot as any).bufferProcessor !== undefined) return (slot as any).bufferProcessor as ExternalProcessor;
			if (slot.kind === "program" && slot.bufferProgram !== undefined) return new ReferenceRuntime(slot.bufferProgram);
			return null;
		});
	}

	private effectiveBypassMode(slot: number): BypassMode {
		const s = this.slots[slot] as ChainSlot | undefined;
		const raw = (s?.bypassMode as BypassMode | undefined) ?? "effect";
		// Declared absence or switch not in audio path: wire is the only honest choice.
		// Surface via advisory, not log.
		if (raw !== "effect" && s?.kind === "program") {
			if (
				s.program.bypass.declared === "none" ||
				s.program.bypass.kind === "not-in-audio-path"
			) {
				return "wire";
			}
		}
		return raw;
	}

	private effectiveContract(slot: number): SlotContract | null {
		const s = this.slots[slot] as ChainSlot | undefined;
		if (s === undefined) return null;
		const mode = this.effectiveBypassMode(slot);
		if (mode === "wire") return null;
		if (mode === "buffer") {
			if ((s as any).bufferProcessor !== undefined) return (s as any).bufferProcessor as SlotContract;
			if (s.kind === "program" && s.bufferProgram !== undefined) {
				return {
					produces: s.bufferProgram.stageCoverage,
					expects: "instrument" as const,
					portFullScaleVolts: s.bufferProgram.portFullScaleVolts,
					portImpedanceOhms: s.bufferProgram.portImpedanceOhms,
				};
			}
		}
		return slotContract(s);
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
		this.dcPole = sampleRate > 0 ? 1 - (2 * Math.PI * DC_BLOCK_HZ) / sampleRate : 0;
		this.dcPreviousIn = 0;
		this.dcPreviousOut = 0;
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
				const bufEngine = this.bufferEngines[slot];
				if (bufEngine !== null) {
					bufEngine.prepare(sampleRate, { maxNewtonIterations });
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
	 *
	 * **Bypass modes:**
	 * - `wire` (true-bypass): no seam scaling, no solver — a wire.
	 * - `buffer` (buffered bypass): runs the bufferProgram (a handful of nodes), with seam
	 *   scaling against the buffer's output (a real stage). If no bufferProgram is present,
	 *   falls back to full program (slower, never wrong).
	 * - `effect` (default): full program.
	 * The seam into a bypassed slot is not scaled (a wire has no port), and the seam into
	 * the next non-wire slot is computed against the last non-wire upstream.
	 */
	process(input: Float64Array): Float64Array {
		let buffer = input;
		let lastNonWire = -1;
		for (const [slot, engine] of this.engines.entries()) {
			const mode = this.effectiveBypassMode(slot);
			if (mode === "wire") {
				continue;
			}
			const isBuffer = mode === "buffer";
			const effectiveContract = this.effectiveContract(slot);
			const upstreamContract = lastNonWire >= 0 ? this.effectiveContract(lastNonWire) : null;
			if (lastNonWire >= 0 && effectiveContract !== null && upstreamContract !== null) {
				const upstream = upstreamContract.portFullScaleVolts.output;
				const downstream = effectiveContract.portFullScaleVolts.input;
				const scale = upstream === null || downstream === null || downstream === 0 ? 1 : upstream / downstream;
				const source = upstreamContract.portImpedanceOhms;
				const load = effectiveContract.portImpedanceOhms;
				const out = source?.output ?? null;
				const inn = load?.input ?? null;
				let divider = 1;
				if (out !== null && inn !== null) {
					const total = out + inn;
					divider = total <= 0 ? 1 : inn / total;
				}
				const effectiveScale = scale * divider;
				if (effectiveScale !== 1) {
					const scaled = new Float64Array(buffer.length);
					for (let index = 0; index < buffer.length; index += 1) {
						scaled[index] = (buffer[index] ?? 0) * effectiveScale;
					}
					buffer = scaled;
				}
			} else if (slot > 0 && lastNonWire === -1) {
				// Leading wire slots: no upstream to scale against.
			}
			if (isBuffer) {
				const bufEngine = this.bufferEngines[slot];
				if (bufEngine !== null) {
					buffer = bufEngine.process(buffer);
				} else {
					buffer = engine.process(buffer);
				}
			} else {
				buffer = engine.process(buffer);
			}
			lastNonWire = slot;
		}
		return this.blockDc(buffer);
	}

	/**
	 * The coupling every real downstream device presents, as a first-order high pass.
	 *
	 * Identical pole to the offline renderer's, deliberately. A plain mean-subtract would
	 * leave the operating-point settling ramp in the signal and would step at every buffer
	 * boundary; this removes both and carries its state across calls.
	 */
	private blockDc(buffer: Float64Array): Float64Array {
		if (!(this.dcPole > 0) || buffer.length === 0) {
			return buffer;
		}
		const out = new Float64Array(buffer.length);
		for (let index = 0; index < buffer.length; index += 1) {
			const sample = buffer[index] ?? 0;
			this.dcPreviousOut = sample - this.dcPreviousIn + this.dcPole * this.dcPreviousOut;
			this.dcPreviousIn = sample;
			out[index] = this.dcPreviousOut;
		}
		return out;
	}

	setBypassMode(slot: number, mode: BypassMode): void {
		const current = this.slots[slot];
		if (current === undefined) {
			throw new RuntimeError(`chain has no slot ${slot} (chain length is ${this.engines.length})`);
		}
		const next: ChainSlot =
			current.kind === "program"
				? {
						kind: "program",
						program: current.program,
						bufferProgram: (current as any).bufferProgram,
						bufferProcessor: (current as any).bufferProcessor,
						bypassMode: mode,
				  }
				: { kind: "processor", processor: current.processor, bypassMode: mode };
		(this.slots as ChainSlot[])[slot] = next;
	}

	/** Slots where bypass was requested but the packet declares `audio.bypass: "none"` — wired through, flagged. */
	bypassNotModelledSlots(): readonly number[] {
		const out: number[] = [];
		for (let i = 0; i < this.slots.length; i++) {
			const s = this.slots[i];
			if (s === undefined || s.kind !== "program") continue;
			const mode = s.bypassMode ?? "effect";
			if (mode !== "wire" && mode !== "buffer") continue;
			if (s.program.bypass.declared === "none") out.push(i);
		}
		return out;
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
	 * Addresses a supply by (slot, addresses), mirroring `setControl`'s routing.
	 * Each slot owns an independent `ReferenceRuntime` with its own supply
	 * stamps, so the shared `sourceIndex` never collides with another slot's.
	 * A processor slot (NAM or IR) is refused by name: it has no compiled
	 * `dc-source` stamps, and a silently ignored rail would be the failure this
	 * file's telemetry exists to avoid.
	 */
	setSupply(slot: number, addresses: readonly SupplyAddress[], volts: number, sourceOhms: number): void {
		const engine = this.engines[slot];
		if (engine === undefined) {
			throw new RuntimeError(
				`chain has no slot ${slot} (chain length is ${this.engines.length})`,
			);
		}
		if (!(engine instanceof ReferenceRuntime)) {
			throw new RuntimeError(
				`slot ${slot} is an injected processor (${slotLabel(this.slots[slot] as ChainSlot, slot)}) ` +
					`and carries no compiled supply: set it on the processor the host supplied`,
			);
		}
		engine.setSupply(addresses, volts, sourceOhms);
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

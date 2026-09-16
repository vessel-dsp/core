// A chain slot that is not a compiled circuit.
//
// The chain used to be `Program[]`, which made every slot an MNA circuit and left the signal's final
// destination outside the runtime entirely. `chain-advisories.ts` said so in as many words: the rule
// that a miked signal must not be sent through a cabinet again "is **not expressible here**, because
// the coloration stage is not a chain slot". Making it one is what this file is for.
//
// **The runtime does not implement NAM or IR, and must not.** Two rules forbid it, and they agree:
// the v2 runtime may import the program contract and nothing else, so `src/dsp`'s convolvers and the
// cab simulator are out of reach; and the console/ROM rule says adding a device must never require a
// runtime change. A NAM profile is another kind of ROM. So the runtime owns the **seams** -- scaling,
// ordering, advisories, telemetry -- and the host supplies the engine.
//
// What a slot must state is therefore small, and it is the same in both directions:
//
//   - **what it produces**, as a `stageCoverage`, so the chain knows how far down the amplification
//     path its output already sits;
//   - **what it expects**, so a speaker terminal feeding an instrument input is separable from a
//     speaker terminal feeding a cabinet, which is a legitimate and very common connection;
//   - **its full scale at each port**, or `null`, so seams scale where both sides know and are
//     reported where they do not.
//
// A compiled `Program` already carries the first and third. It does not carry the second because it
// does not need to: a compiled circuit's input is a jack, and a jack expects an instrument-level
// signal. That is why `slotContract` supplies `instrument` for a program rather than the compiler
// growing a field.

import type { Program } from "@vessel-dsp/compiler";

/** How far down the amplification chain a signal already is. The compiler's own vocabulary. */
export type StageCoverage = Program["stageCoverage"];

/**
 * What the chain needs to know about a slot, whatever runs inside it.
 *
 * `Program` satisfies the produced/full-scale half structurally, which is deliberate: the seam
 * arithmetic is identical for a compiled circuit and an injected processor, and writing it twice
 * would be how the two drift apart.
 */
export type SlotContract = {
	/** The coverage of this slot's **output**. */
	readonly produces: StageCoverage;
	/** The coverage this slot's **input** is meant to receive. */
	readonly expects: StageCoverage;
	readonly portFullScaleVolts: {
		readonly input: number | null;
		readonly output: number | null;
	};
	/**
	 * Port impedances for the seam divider, or **`null` when this slot's ports are not electrical**.
	 *
	 * The two cases are different and must not collapse into one. A *circuit* seam with no declared
	 * impedance is **unknown** -- undeclared data, worth reporting once sources carry it. A
	 * *processor* seam has **nothing to declare**: a NAM capture already contains whatever loading
	 * existed when it was taken, and an impulse response or cab simulation is a filter rather than a
	 * source or a load. §3.2's own table says as much -- "IR / cabMic: unity, a filter, not a source".
	 *
	 * So a whole-object `null` means *not applicable*, and an inner `null` means *not stated*. Without
	 * that distinction the divider's advisory would fire on every NAM + cabinet chain, complaining
	 * about data that cannot exist.
	 */
	readonly portImpedanceOhms: {
		readonly input: number | null;
		readonly output: number | null;
	} | null;
};

/**
 * A processor the host supplies: a NAM profile, an impulse response, the cab simulation.
 *
 * `process` takes one buffer and returns one buffer of the same length, sample-for-sample causal in
 * the same sense `ReferenceRuntime.process` is -- the chain hands whole buffers between slots and
 * relies on that.
 *
 * **A NAM amp capture declares `produces: "speaker-electrical"`, not `"miked"`.** A load-box
 * capture is taken at the speaker terminal, which is what that value means -- the same coverage a
 * whitebox amp's own output carries, so NAM + IR and amp + IR are one case rather than two. The great
 * majority of captures on TONE3000 are taken through a reactive load box with no speaker and no
 * microphone, precisely so the player adds their own IR, and NAM + IR is the ordinary chain. Only a
 * profile that states it is a full-rig capture declares `miked`, and nothing here may infer that from
 * a file name or a title.
 */
export type ExternalProcessor = SlotContract & {
	/** Named in advisories and telemetry, since a processor has no program to point at. */
	readonly id: string;
	prepare(sampleRate: number): void;
	process(buffer: Float64Array): Float64Array;
};

/**
 * **Nothing here distinguishes a NAM from an IR, on purpose.** Both are buffer-in, buffer-out black
 * boxes, so the seam arithmetic, the ordering and the advisories are identical; `id` is a label for
 * messages, never a discriminator. What the chain asks is not *what kind of processor is this* but
 * *what coverage does it produce* -- which is why a NAM amp capture and a whitebox amp's own output
 * collapse to one case, and why a cab simulator and an impulse response do too.
 *
 * They are not, however, the same *kind* of process, and one consequence survives the abstraction.
 * An impulse response is linear and time-invariant: an unscaled seam into it is purely a level error,
 * and a gain after it undoes the damage exactly. A NAM is a neural capture of a **nonlinear** amp, so
 * the same signal at half the level does not merely arrive quieter -- it arrives with different
 * harmonic content, and no later gain recovers it. So an `unscalable-seam` reported into a nonlinear
 * slot is a **tone** error, where into a linear one it is only a level error.
 *
 * That distinction is recorded rather than encoded. Adding a `linear` flag to grade the advisory's
 * severity would be a field with one speculative consumer, and the advisory already names the seam;
 * a host that knows its processor is nonlinear knows to take that seam more seriously.
 */
export type ChainSlot =
	| { readonly kind: "program"; readonly program: Program }
	| { readonly kind: "processor"; readonly processor: ExternalProcessor };

/** A compiled circuit as a slot. */
export function programSlot(program: Program): ChainSlot {
	return { kind: "program", program };
}

/** An injected processor as a slot. */
export function processorSlot(processor: ExternalProcessor): ChainSlot {
	return { kind: "processor", processor };
}

/**
 * The contract a slot presents to the seam arithmetic.
 *
 * A program's `expects` is `instrument` by construction -- its input is a jack. Nothing infers it,
 * and no compiler field is needed for it.
 */
export function slotContract(slot: ChainSlot): SlotContract {
	if (slot.kind === "processor") {
		return slot.processor;
	}
	return {
		produces: slot.program.stageCoverage,
		expects: "instrument",
		portFullScaleVolts: slot.program.portFullScaleVolts,
		// A compiled circuit always has electrical ports, so this is the object form even when both
		// impedances are unstated. A processor supplies `null` instead -- see `SlotContract`.
		portImpedanceOhms: slot.program.portImpedanceOhms,
	};
}

/** How a slot names itself in a message. */
export function slotLabel(slot: ChainSlot, index: number): string {
	return slot.kind === "processor"
		? `slot ${index} (${slot.processor.id})`
		: `slot ${index}`;
}

// Two pedals on one physical supply have to agree about which terminal is ground.
//
// A germanium PNP fuzz references the battery's **positive** terminal to ground and runs a
// negative rail; every ordinary pedal references the negative terminal and runs a positive one.
// Chain them from one daisy-chain supply and its two terminals are tied together through the
// pedals' grounds -- which the signal cable shields already connect -- and the supply is
// shorted. This is why a vintage fuzz wants a battery or an isolated output, and it is a real
// build hazard rather than a matter of taste.
//
// **It is not a simulation error, and this must not refuse.** Each program is solved against
// its own declared rails, so the chain renders exactly as well either way: there is no shared
// supply in the model to short. The warning is about the board a listener would have to build
// to hear what they are hearing, so it is advisory, and `admission.ts` -- which is fail-closed
// because a cost overrun is audible as clicks -- deliberately does not consult it.
//
// The fact this reads (`Program.supplyReference`) is compiler-derived from the signs of the
// lowered supply sources. Barrel polarity, center-negative or center-positive, is not part of
// it and is not readable from any corpus source; see `../compiler/supply-reference.ts`.

import type { Program } from "@vessel-dsp/compiler";

/** One conflict, with the slots a host needs to point at. */
export type SupplyGroundConflict = {
	/** Slot indices in the chain, ascending. */
	readonly slots: readonly number[];
	readonly message: string;
};

/**
 * Positive-ground programs against programs carrying any positive rail.
 *
 * **Stated as "any positive rail" rather than "negative-ground", and that is the whole
 * correctness of it.** `klon-centaur` and `earthquaker-devices-plumes` are `dual-rail`: they
 * make a negative rail with an internal charge pump inside an otherwise ordinary
 * center-negative pedal, so they conflict with a positive-ground fuzz exactly as a plain
 * pedal does. Treating `dual-rail` as "already has a negative rail, so no conflict" would miss
 * both.
 *
 * `unpowered` programs -- a passive volume pedal, or a packet whose supply island is not
 * declared -- conflict with nothing: there is no terminal for them to disagree about.
 */
export function supplyGroundConflicts(
	chain: readonly Program[],
): readonly SupplyGroundConflict[] {
	const positiveGround: number[] = [];
	const positiveRail: number[] = [];
	for (const [slot, program] of chain.entries()) {
		if (program.supplyReference === "positive-ground") {
			positiveGround.push(slot);
		}
		if (
			program.supplyReference === "negative-ground" ||
			program.supplyReference === "dual-rail"
		) {
			positiveRail.push(slot);
		}
	}
	if (positiveGround.length === 0 || positiveRail.length === 0) {
		return [];
	}
	// One conflict for the chain, not one per pair: a board either mixes grounds or it does
	// not, and naming every pair of a five-pedal board would bury the fact in arithmetic.
	const slots = [...positiveGround, ...positiveRail].sort((a, b) => a - b);
	return [
		{
			slots,
			message:
				`slot(s) ${positiveGround.join(", ")} reference the supply's positive terminal ` +
				`to ground and slot(s) ${positiveRail.join(", ")} carry a positive rail, so one ` +
				"shared supply would tie its two terminals together through the pedals' grounds " +
				"and short it: on a real board these need a battery or an isolated supply " +
				"output. The chain renders correctly here regardless -- each program is solved " +
				"against its own rails",
		},
	];
}

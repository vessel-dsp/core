// Which terminal of its supply a circuit references to ground.
//
// A pedal's DC jack is center-negative or center-positive, and **that convention is not an
// electrical fact this pipeline can read or needs to**: MNA solves node voltages against a
// reference node, so once the source says which node is the supply and what sign it carries,
// how the barrel is wired is invisible to the solve. Nothing in the corpus declares barrel
// polarity, and nothing here reads it.
//
// What *is* electrical is the **sign of the supply relative to ground**. A germanium PNP fuzz
// references the battery's positive terminal to ground and runs a negative rail — measured over
// the corpus, five packets do: `dallas-arbiter-fuzz-face-ac128`,
// `dallas-rangemaster-original-treble-booster`, `sola-sound-mki-tone-bender`,
// `sola-sound-tone-bender-professional-mkii`, and `maestro-fz-1a` at **-1.5 V**. Get that sign
// wrong and the PNP stages never reach conduction, which is silence rather than a wrong tone.
//
// The reason a program carries this at all is that it is the one supply fact a *chain* needs:
// two pedals on one physical supply must agree about which terminal is ground, and a chain of
// programs is where that can be checked (`src/runtime/supply-ground.ts`). It is not a
// simulation input — each program is solved against its own declared rails either way.

import type { Block, Program } from "./types";

/**
 * Read from the lowered `dc-source` stamps rather than the declared `rail`/`battery` devices,
 * for the same reason `over-driven-node.ts` reads stamps: lowering is what collapses a
 * redundant pair of supply declarations into one source, and the stamps are what the runtime
 * executes and the deck is emitted from.
 *
 * Zero-volt sources are ignored. A `0 V` source is a ground tie, not a supply, and counting it
 * would make an unpowered circuit look powered.
 *
 * **`dual-rail` is not the same as `positive-ground`, and conflating them would be the whole
 * bug.** `klon-centaur` (`+9`, `+18`, `-9`) and `earthquaker-devices-plumes` (`+9`, `-9`) each
 * derive a negative rail from a charge pump inside an ordinary center-negative pedal, so their
 * *external* supply is the same as every other pedal's. What matters for a shared supply is
 * whether a positive rail exists at all, which is why the chain rule below is stated that way
 * and not as "positive-ground versus everything".
 */
export function supplyReference(
	blocks: readonly Block[],
): Program["supplyReference"] {
	let positive = false;
	let negative = false;
	for (const block of blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			if (stamp.kind !== "dc-source") {
				continue;
			}
			if (stamp.volts > 0) {
				positive = true;
			}
			if (stamp.volts < 0) {
				negative = true;
			}
		}
	}
	if (positive && negative) {
		return "dual-rail";
	}
	if (positive) {
		return "negative-ground";
	}
	if (negative) {
		return "positive-ground";
	}
	return "unpowered";
}

// A region that carries a real device and is never executed.
//
// `link.ts` puts only the blocks that can reach the output into `program.order`; everything
// else is compiled and then never runs. That is correct behaviour -- a bias island or an
// indicator LED has nothing to contribute to the audio -- and it is also how a whole
// *channel* can go missing without anything saying so.
//
// The threshold is what makes this a signal rather than noise. Measured over the 79
// compiling packets: 28 have some unexecuted region, and only **9** have one containing an
// active device. Warning on all 28 would report bias stubs; warning on the 9 reported, on
// its first run:
//
//   vox-ac30-top-boost   two 12-node triode regions -- the Normal and Vib/Trem CHANNELS,
//                        each dead-ending at its own monitor tap because the summing network
//                        into the shared power amp is not traced
//   boss-cs-3            a dead `ota` -- which is why that packet renders a real signal and
//                        does not compress
//   boss-bf-2            a dead `bbd` -- which is why the flanger is stalled
//
// Each of those was an open question answered by the same one-line check, so the rule is:
// an unexecuted region holding a device that can *do* something is worth a sentence.

import { stampNodes } from "./dangling-active-terminal";
import type { CompileWarning, Program } from "./types";

/**
 * Device kinds that are ACTIVE BUT NOT ALWAYS PARTITIONED NONLINEAR, and so would be missed by
 * `stampPartition.nonlinearStampIndices` alone.
 *
 * Deliberately the *active* set, not "anything with a stamp": a resistor or capacitor alone in its
 * own region is a bias/filter island and reporting it is what turns this check into noise. Written
 * as an explicit list rather than "not passive" so a new device kind has to be classified on
 * purpose.
 *
 * **Why this list is no longer the primary basis, corrected 2026-09-12.** It was calibrated against
 * 79 compiling packets; 141 compile now, and a hand-curated list in a second place drifts against
 * the corpus. `diode` was never in it, so `roland-jc-120-jazz-chorus` dropped 5 diodes and 71% of
 * its nonlinear devices while this check said nothing. `bbd` was in it and matched nothing, because
 * a BBD is a macro `modelId` and never a stamp kind.
 *
 * The fix is to read the classification the compiler already maintains in one place --
 * `stampPartition.nonlinearStampIndices` -- and keep this set only for what that cannot see. An
 * `ideal-opamp` is the case that keeps it alive: `boss-st-2` carries two of them in unexecuted
 * regions with zero nonlinear stamps, because an op-amp in some configurations is partitioned
 * linear. `vccs` is the same shape, a dependent source with no nonlinearity to partition.
 *
 * `nand-gate` and `inverter` are declared stamp kinds that no current packet emits. They are kept
 * because they are correctly classified, not because they fire.
 *
 * **Deliberately excluded**, and each is a judgement rather than an oversight: `dc-source`,
 * `capacitor`, `conductance`, `inductor` are the bias and filter islands the check exists not to
 * report (adding them would take it from 38 packets to over 60). `selector`, `switch` and
 * `controlled-conductance` are control-domain, and a dead control is already reported by
 * `control-cannot-affect-circuit` rather than twice here.
 */
const activeStampKinds: ReadonlySet<string> = new Set([
	"triode",
	"pentode",
	"tube-diode",
	"bjt",
	"fet",
	"ideal-opamp",
	"ota",
	"optocoupler",
	"analog-switch",
	"compandor",
	"vccs",
	"nand-gate",
	"logic-divider",
	"clock-driver",
	"inverter",
]);

export function findUnexecutedRegions(
	program: Program,
): readonly CompileWarning[] {
	const executed = new Set(program.order);
	const warnings: CompileWarning[] = [];
	for (const block of program.blocks) {
		if (executed.has(block.id) || block.kind !== "mna") {
			continue;
		}
		const nonlinearKinds = new Set(
			block.stampPartition.nonlinearStampIndices.flatMap((index) => {
				const kind = block.stamps[index]?.kind;
				return kind === undefined ? [] : [kind];
			}),
		);
		// The union, not either alone. The partition is the compiler's own maintained answer to
		// "can this device do something a resistor cannot" and catches 14 packets the curated list
		// missed; the curated list catches `boss-st-2`, whose unexecuted op-amps are partitioned
		// linear. Neither is a superset of the other.
		const active = [
			...new Set(
				block.stamps
					.map((stamp) => stamp.kind)
					.filter((kind) => activeStampKinds.has(kind) || nonlinearKinds.has(kind)),
			),
		].sort();
		if (active.length === 0) {
			continue;
		}
		// **Why it is unreachable, when the region says so itself.** A region none of whose stamps
		// references ground is electrically floating: it has no return path, its MNA sub-matrix is
		// singular without one, and it could not have been executed whatever the output port did.
		// That is a different repair from a region that is merely unsummed, and it is the last
		// cause in the corpus that no warning named -- `boss-hm-2`'s D13/D14/R46 form a closed
		// triangle on nodes 4/5/7 with no ground and no dangling terminal, so neither this check's
		// old text nor `active-device-terminal-unwired` could say what was wrong with it.
		//
		// Tested on the stamps, NOT on `block.nodeIds`: ground is synthesized into every block's
		// node list as row 0, so `nodeIds.includes(0)` is true even for a floating region.
		const floating = block.stamps.every(
			(stamp) => !stampNodes(stamp).includes(0),
		);
		warnings.push({
			code: "unexecuted-active-region",
			device: null,
			detail: (floating
				? `region ${block.id} is ELECTRICALLY FLOATING -- no device in it references ground, ` +
					"so it has no return path and could not be executed whatever the output port did. " +
					"Check the source for a missing ground connection in this group. "
				: "") +
				`region ${block.id} carries ${active.join(", ")} across ${block.nodeCount} nodes ` +
				"and is never executed, because nothing in it reaches the output port. Its devices " +
				"are compiled and then ignored, so whatever they contribute to the sound is absent " +
				"without the render looking wrong. Either the region is genuinely separate in the " +
				"source (a channel whose summing network into the shared output is not traced), or " +
				"the output port is on the wrong node.",
		});
	}
	return warnings;
}

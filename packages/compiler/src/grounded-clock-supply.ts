import type { CompileWarning, Program } from "./types";

/**
 * Clock drivers whose `vdd` row is the ground row, and therefore render no clock at all.
 *
 * **Why this is a program-level check and not a netlist one.** `vdd` is a *row index* into the
 * block's solution, not a source node id, so whether it is ground is only knowable after `link`
 * has assigned rows and `nodeIds` maps them back. Reading `stamp.vdd === 0` directly would happen
 * to work while row 0 is conventionally ground and would break silently the day it is not.
 *
 * See `ClockDriverSupplyAtGroundWarning` for why a correct transcription lands here.
 */
export function findGroundedClockSupplies(
	program: Program,
): readonly CompileWarning[] {
	const warnings: CompileWarning[] = [];
	for (const block of program.blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			if (stamp.kind !== "clock-driver") {
				continue;
			}
			// **Both** supply pins, not just `vdd`. Until the stamp gained a `gnd` terminal it
			// swung the phases between `vdd` and literal ground, so `vdd` at ground alone was
			// fatal and this warned on it; that is no longer true and warning on it would now be
			// a false alarm on two correctly-wired packets. What remains fatal is having no
			// supply to swing between at all.
			const vddNode = block.nodeIds?.[stamp.vdd] ?? stamp.vdd;
			const gndNode = block.nodeIds?.[stamp.gnd] ?? stamp.gnd;
			if (vddNode !== 0 || gndNode !== 0) {
				continue;
			}
			warnings.push({
				code: "clock-driver-supply-at-ground",
				device: null,
				detail:
					`Clock driver in block ${block.id} has both supply terminals at circuit ground ` +
					`(VDD row ${stamp.vdd}, GND row ${stamp.gnd}), so there is no potential for its ` +
					"clock phases to swing between and CP1, CP2 and VGG all render as zero -- the " +
					"bucket brigade receives no clock. The MN3101/MN3102 run on a single negative " +
					"supply, so exactly one of these two pins should sit at a rail: a +9 V pedal ties " +
					"the part's GND pin to the positive rail and its VDD pin to circuit ground.",
			});
		}
	}
	return warnings;
}

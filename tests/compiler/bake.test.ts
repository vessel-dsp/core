// Spec clause 5 contract: `bakeDecisionFor` refuses unless `linear && controlFree` both
// hold, and names which flag failed.

import { describe, expect, it } from "bun:test";
import { bakeDecisionFor } from "@vessel-dsp/compiler";
import { attachDeviceLaws } from "@vessel-dsp/compiler";
import { lower } from "@vessel-dsp/compiler";
import { readNetlist } from "@vessel-dsp/compiler";
import { partition } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import type { Block } from "@vessel-dsp/compiler";
import {
	diodeClipper,
	potDivider,
	resistorDivider,
	switchedDivider,
} from "./fixtures/circuits";

function mnaBlockFor(source: string): Extract<Block, { kind: "mna" }> {
	const lawed = attachDeviceLaws(readNetlist(source), emptyRegistry);
	const [block] = lower(partition(lawed), lawed);
	if (block?.kind !== "mna") {
		throw new Error("expected an mna block");
	}
	return block;
}

describe("bakeDecisionFor", () => {
	// The four quadrants, on the exact fixtures `lower.test.ts`'s own
	// "linear and controlFree, the precondition for factoring once" describe block already
	// established the flags for -- reused rather than re-derived, so this gate is tested
	// against the same evidence the flags themselves are.

	it("allows baking a resistive divider: linear and control-free", () => {
		const decision = bakeDecisionFor(mnaBlockFor(resistorDivider));
		expect(decision.outcome).toBe("may-bake");
	});

	it("refuses a pot divider, naming controlFree rather than linear", () => {
		const block = mnaBlockFor(potDivider);
		expect(block.linear).toBe(true);
		expect(block.controlFree).toBe(false);
		const decision = bakeDecisionFor(block);
		expect(decision.outcome).toBe("refused");
		if (decision.outcome === "refused") {
			expect(decision.refusal.block).toBe(block.id);
			expect(decision.refusal.reason).toContain("control-free");
			expect(decision.refusal.reason).not.toContain("not linear");
		}
	});

	it("refuses a switched divider the same way: linear, not control-free", () => {
		// A switch is a control-dependent conductance and needs no Newton -- the other
		// linear-but-control-bearing case `lower.test.ts` establishes.
		const block = mnaBlockFor(switchedDivider);
		expect(block.linear).toBe(true);
		expect(block.controlFree).toBe(false);
		const decision = bakeDecisionFor(block);
		expect(decision.outcome).toBe("refused");
		if (decision.outcome === "refused") {
			expect(decision.refusal.reason).toContain("control-free");
		}
	});

	it("refuses a block whose supply moves, after both flags have passed", () => {
		// The third condition, and the only one the block itself cannot answer: `controlFree`
		// is about controls, so a block can pass both flags and still reference a rail driven
		// from outside its own matrix. No compiler-built block does today -- which is why the
		// caller states it rather than the block carrying an untestable constant-`true` field.
		const block = mnaBlockFor(resistorDivider);
		expect(block.linear).toBe(true);
		expect(block.controlFree).toBe(true);
		expect(bakeDecisionFor(block, { static: true }).outcome).toBe("may-bake");

		const decision = bakeDecisionFor(block, { static: false });
		expect(decision.outcome).toBe("refused");
		if (decision.outcome === "refused") {
			expect(decision.refusal.block).toBe(block.id);
			expect(decision.refusal.reason).toContain("supply that moves");
			// Named for the right reason: not misreported as a linearity or control failure.
			expect(decision.refusal.reason).not.toContain("not linear");
			expect(decision.refusal.reason).not.toContain("not control-free");
		}
	});

	it("refuses a diode clipper, naming linear rather than controlFree", () => {
		// The other diagonal: control-free (nothing here reads a control) but not linear
		// (Newton). Confirms the two flags are checked independently, not as one combined
		// bit -- a block that is control-free but curved must still be refused, and for the
		// right reason.
		const block = mnaBlockFor(diodeClipper);
		expect(block.linear).toBe(false);
		expect(block.controlFree).toBe(true);
		const decision = bakeDecisionFor(block);
		expect(decision.outcome).toBe("refused");
		if (decision.outcome === "refused") {
			expect(decision.refusal.reason).toContain("not linear");
			expect(decision.refusal.reason).not.toContain("control-free");
		}
	});
});

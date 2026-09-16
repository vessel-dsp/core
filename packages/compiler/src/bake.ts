// Spec clause 5: `linear && controlFree`, jointly, as the precondition for baking a
// realisation -- and NOTHING ELSE. No new field: `Block.linear` and `Block.controlFree`
// already exist (`src/compiler/types.ts`, computed in `lower.ts` from the exhaustive,
// `never`-bound `stampNeedsNewton`/`stampControl` classifiers), and this file is the
// instruction to read them as a conjunction rather than separately, at the one place a
// reduction may ever be baked and reused across samples.
//
// **This gate has no caller today, and that is honest rather than incomplete.** Nothing in
// this compiler reduces an `mna` block into a state-space realisation -- that is step 5's own
// future work, and it does not exist yet (build-order steps 4 and 5 are unbuilt; clause 4,
// declared output nodes, has nothing to govern until something reduces). `bakeDecisionFor`
// is the precondition function that future stage MUST call before it bakes anything, and it
// is written, tested and wired into the plan's documentation now rather than left implicit,
// so the precondition cannot be forgotten the day someone builds the reducer. The insertion
// point is between `lower`/`couple` and `link` in `compile.ts`'s pipeline -- after a block's
// stamps are final and its `linear`/`controlFree` flags are settled, before anything is
// scheduled to run.
//
// **Why the conjunction, not either flag alone.** `linear-core-state-space-gate` measured
// H0 (a linear reduction is exact) fully holding, and H2 ("linear is sufficient on its own")
// false: its `load-shift` mutation -- a realisation derived at one load, evaluated at
// another -- errs 80% of the signal (`4.19e-02` against a `5.23e-02` reference), because a
// pot sits *inside* the matrix a realisation is derived from, so a knob move is exactly the
// kind of topology change a baked realisation cannot track without re-deriving. `linear`
// alone would have let that 80% error ship silently -- see `bake.test.ts`'s reproduction of
// this shape on `potDivider`, and `pipeline.test.ts` for the same shape measured end to end.
//
// **The supply gap, closed 2026-09-02 as a third condition rather than a fourth flag.** A block
// can be `linear && controlFree` and still reference a rail that moves with the audio, because
// `controlFree` is about controls and says nothing about supply state. This used to be recorded
// here as an undecided gap waiting on the rail-port design. It is not: the gate can refuse the
// case without knowing how a moving rail will eventually be *plumbed*, and refusing it is what
// the reducer needs.
//
// **Why the caller supplies the answer instead of the block carrying a flag.** A rail that moves
// cannot cross a block boundary today -- every supply a block references is either ground or a
// node inside its own matrix, and a rail sagging *inside* a linear block is already exact in the
// realisation, because the sag is part of the linear system being derived. So a `supplyStatic`
// field on `Block` would be a constant `true` with no way to test it, and this repository's
// evidence rule asks for a check that can fail for the reason claimed. Taking it as an argument
// makes the future reducer state the answer at the point it bakes, keeps the Program contract
// (and its C++ mirror) unchanged, and is testable today by passing `false`.
//
// **What is still open is the port design, and it is deliberately not decided here.** Whether a
// dynamic rail becomes a fourth port kind or folds into `coupled` is an architecture question
// whose evidence does not exist yet -- `thoughts/shared/experiments/power-domain-rail-sag-contract/`
// was written to produce exactly that evidence (sign convention, multi-rail summing, the DK
// rail-in/current-out contract) and has never been run. This gate is correct under either answer:
// whichever one lands sets `supply.static` to `false` for a block whose rail is driven from
// outside it.

import type { Block } from "./types";

/** Why a block's realisation may not be baked, naming the block and the failing flag. */
export type BakeRefusal = {
	readonly block: string;
	readonly reason: string;
};

export type BakeDecision =
	| { readonly outcome: "may-bake" }
	| { readonly outcome: "refused"; readonly refusal: BakeRefusal };

/**
 * May this block's realisation be derived once and reused across samples?
 *
 * Only when `linear && controlFree` both hold. Checked in that order because a `linear`
 * failure is the more fundamental one -- a nonlinear block has no fixed realisation to derive
 * at all, `linear && controlFree` or not -- so naming it first is the more useful refusal even
 * though a real block can fail either independently (see `bake.test.ts`'s four-quadrant cases,
 * matching `lower.test.ts`'s own `resistorDivider`/`potDivider`/`switchedDivider`/
 * `diodeClipper` fixtures for `linear`/`controlFree`'s own precedent).
 */
export function bakeDecisionFor(
	block: Extract<Block, { readonly kind: "mna" }>,
	/**
	 * Whether every supply this block references holds still across the samples the realisation
	 * would be reused over.
	 *
	 * `true` for every block the compiler builds today — a rail is ground or a node inside this
	 * block's own matrix, and sag inside the matrix is already exact in a linear realisation.
	 * The reducer must pass `false` the day a rail is driven from outside the block, whichever
	 * shape that plumbing takes.
	 */
	supply: { readonly static: boolean } = { static: true },
): BakeDecision {
	if (!block.linear) {
		return {
			outcome: "refused",
			refusal: {
				block: block.id,
				reason: `block "${block.id}" is not linear, so it has no fixed realisation to derive at all -- it must keep iterating Newton every sample`,
			},
		};
	}
	if (!block.controlFree) {
		return {
			outcome: "refused",
			refusal: {
				block: block.id,
				reason: `block "${block.id}" is linear but not control-free, so a realisation baked at one control position would be wrong at another -- linear-core-state-space-gate measured this at 80% of the signal (load-shift). Refuse to bake and keep solving the per-sample stamps until re-derivation on control change or knob-grid tabulation exists`,
			},
		};
	}
	if (!supply.static) {
		return {
			outcome: "refused",
			refusal: {
				block: block.id,
				reason: `block "${block.id}" is linear and control-free but references a supply that moves with the audio, and a realisation derived at one rail voltage is wrong at another for the same reason a pot position is -- the rail sits inside the matrix the realisation is derived from. Refuse to bake until the rail is an input the realisation can be re-derived against`,
			},
		};
	}
	return { outcome: "may-bake" };
}

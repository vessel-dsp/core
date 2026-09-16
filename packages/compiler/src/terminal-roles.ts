// Terminal-role vocabularies shared by more than one stage.
//
// **Why this file exists.** The corpus spells one terminal many ways, and the design rule is
// refuse rather than guess, so every stage that has to recognise a role carries a closed set of
// the spellings it accepts. That is correct. What is not correct is two stages carrying their
// *own* closed set for the *same* question, because the two then drift: the sets below were
// found defined twice, under the same names, in different files, and two of them had already
// diverged by three tokens each.
//
// The rule this file establishes: **a role vocabulary consulted by more than one stage lives
// here, once.** A vocabulary only one stage reads stays with that stage -- it cannot drift
// against anything. This is phase 1 of R1 in
// `thoughts/shared/plans/2026-08-31-v2-complexity-reduction-plan.md`, and it is deliberately
// the half that needs nothing from `@vessel-dsp/core`: consolidating duplication that already
// exists inside this repository. Canonicalising the spellings themselves, upstream, is the
// other half and is still gated on the core parser contract.
//
// Nothing here is a substring or regex test. Every set is compared as whole values against
// tokens `terminalRoleToken` has already folded (case dropped, separators stripped, a leading
// `pinN` removed), which is what keeps this on the right side of the repository's rule against
// reading authored prose.

/**
 * How a supply names the terminal it drives, and the terminal it returns through.
 *
 * **These were two pairs, not one, until 2026-09-01.** `device-laws.ts` (stage 3, building the
 * drive/return node sets that decide whether a jack contact engages onto a stranded supply
 * node) accepted `{positive, hot, plus}` / `{negative, return}`. `lower.ts` (stage 5, choosing
 * which end of a supply a stamp drives) accepted those plus `{line, anode, +}` /
 * `{cathode, minus, neutral}`. Same question, two answers, three tokens apart -- so a supply
 * declaring `line` was a drive terminal when lowering and invisible to stage 3, which decides
 * jack engagement.
 *
 * Resolved as the **union**, because both stages are asking which end is which and the wider
 * vocabulary is the more complete answer to that question, not a laxer one.
 *
 * **Measured before merging, so this is a consolidation and not a behaviour change.** Across
 * all 142 corpus packets, only five role tokens appear on a `voltage-source` at all:
 * `positive` (46), `negative` (45), `hot` (1), `return` (1) and `midpoint` (1). None of the six
 * divergent tokens occurs, so no packet's classification moves. The divergence was latent, and
 * the point of merging it now is that the next packet spelling a rail `line` gets one answer
 * instead of two.
 *
 * `midpoint` is deliberately in neither set: a centre tap is not a drive end or a return end,
 * and the stages that consult these are asking about polarity.
 */
export const supplyDriveRoles: ReadonlySet<string> = new Set([
	"positive",
	"plus",
	"hot",
	"line",
	"anode",
	"+",
]);

/**
 * Role tokens that name a terminal's **position or its winding half, and deliberately carry no
 * electrode evidence** — so a resolver that cannot orient a device from them has read the
 * document correctly rather than failed to.
 *
 * **Why this set exists.** Four asymmetric-device resolvers in `lower.ts` fall back to
 * declaration order when they cannot read a role, and that fallback serves two situations one
 * predicate could not previously tell apart: a document of bare lugs, which carries no
 * orientation evidence and where declaration order is all there is, and a document that *named*
 * its terminals in a spelling the resolver does not know, where declaration order is a guess.
 * The first is correct and must stay silent; the second is the silent-mis-wiring class the
 * 2026-09-02 census measured. This set is the escape hatch that separates them.
 *
 * Every entry is named as exactly this case by a resolver's own docstring already, and each is
 * corpus-evidenced: `diodeTerminals` says it "falls back to declaration order for `a,b` and bare
 * **`a`/`b` removed 2026-09-03, because a diode is not a symmetric device.** They were here for
 * "a diode's bare `a`/`b` lugs, which carry no orientation evidence" -- and that reading is wrong
 * in a way a mutation study caught: reversing such a diode moves the program, so declaration
 * order is not "the document's intended reading", it is a guess this set was suppressing the
 * warning about. What remains is genuinely symmetric: the two ends of a winding, where either
 * order is the same circuit.
 *
 * The older note read: `diodeTerminals` says "falls back to declaration order for `a,b` and bare
 * "`ac_a`/`ac_b` and `heater_a`/`heater_b` are symmetric windings that name no polarity ... so
 * both fall back to declaration order" (`fender-5f1-champ`'s filament bus and `hiwatt-dr103`'s
 * heater bus). Nothing here feeds a resolver, so adding a token changes no wiring — it only
 * declares that this spelling's fallback was intended.
 *
 * A `lugN` or bare `pinN` needs no entry: `terminalRoleToken` already folds a bare pin number to
 * `null`, and a `lug1`/`lug3` names a pot's track end, which `potTerminals` resolves by its own
 * quiet-distance rule rather than by orientation.
 */
export const orientationFreeRoles: ReadonlySet<string> = new Set([
	"aca",
	"acb",
	"heatera",
	"heaterb",
]);

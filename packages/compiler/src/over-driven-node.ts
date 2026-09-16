// More than one ideal voltage source driving one node, which is not a circuit.
//
// An op-amp output is a **low-impedance driven node**: the device's whole job is to force a
// voltage there. Two of them on one node are two sources asserting two different voltages
// through near-zero impedance, and there is no answer — the real circuit fights itself and
// one part wins on current limit, while the model has no current limit to arbitrate with.
//
// ngspice says so plainly and refuses the deck: `singular matrix: check nodes ee25#branch
// and n15`, because two `E` elements driving one node give two rows asserting the same
// unknown. **This runtime does not refuse.** It gives each op-amp its own auxiliary row and
// solves an over-determined system to whatever `gmin` and the limiters allow, which is how
// `ibanez-pql` renders volts a 9 V pedal cannot reach and reports converged samples doing it.
// That was `1.118e13` V when this was written. Re-measured 2026-08-28 on the node its contested
// output feeds, the number is not a level at all — **the node never settles**:
//
// ```
// t=0.25s   55.3411 V      t=2s    0.9281 V
// t=0.5s    17.7907 V      t=4s  -10.1509 V
// t=1s       5.4407 V      t=8s  500.1368 V
// ```
//
// Which is what two integrators fighting for one output node should do: there is no steady state
// to find, so it wanders. **Do not quote a single figure from this packet as a level** — an
// earlier revision of this comment quoted `17.177 V` as "settled over 0.5 s and unchanged at 2 s",
// which was a harness bug (the later reading was aliased to the earlier one, so the
// still-moving control could not fire) and not a property of the circuit. The durable claim is
// the shape: unbounded excursion far outside the supply envelope, while the sample count reports
// converged.
//
// The pair is not always two op-amps. `boss-pq-4` puts a declared 4.5 V rail and an op-amp
// output on one node -- `Vv2 n24 0 DC 4.5` beside `Ee49 n24 0 TABLE {...}` -- and ngspice
// refuses it the same way. What matters is the *count of ideal sources on a node*, not which
// kinds they are, so both are counted.
//
// Measured over the pedal corpus, 2026-08-27 at `a6f5732d`:
//
// ```
// boss-aw-2                      n23  <- two opamp stamps
//                                n26  <- five opamp stamps
// boss-ce-2b                     n16, n40, n46, n48  each <- two opamp stamps
// boss-dd-3b                     n8, n3              each <- two opamp stamps
// boss-pq-4                      n24  <- VREF rail + IC4_VREF
// boss-tr-2                      n3   <- a rail + one opamp stamp
// ibanez-pql                     n16  <- U2B + U2A
// moogerfooger-mf-102            n1   <- PLUS9 rail + U8C + U8D + U10A
// pigtronix-philosophers-tone    n36  <- VC rail + IC4
// ```
//
// **Eight packets now, and the previous list is the reason this one carries its revision.** At
// `1ccb9839` on 2026-08-21 this list held five, and said of `boss-aw-2`, `boss-dd-3b` and
// `electro-harmonix-deluxe-memory-man` that all three "now refuse to compile on an unregistered
// IC, so their over-driven nodes are not live findings". Re-measured at the revision above, all
// three compile: `boss-aw-2` and `boss-dd-3b` are **live findings again**, with two over-driven
// nodes each, and `electro-harmonix-deluxe-memory-man` compiles carrying none. `boss-tr-2` was
// never on either list. `boss-ce-2b`'s fourth node reads `n48` rather than `n49`.
//
// So the list has been wrong in both directions — naming packets that had stopped reaching this
// stage, and omitting packets that had started reaching it again. A reader who quoted it without
// re-running it went looking for packets that did not compile; a later reader would have missed
// three that do. **An example list in a comment is a measurement with a date on it**, and a
// packet dropping off this list because it stopped compiling is not the same as the
// contradiction being resolved. Re-run before quoting:
// `compile(...).warnings.filter((w) => w.code === "node-driven-by-two-sources")`.
//
// Evidence is terminal-role tokens and node identity, the same as the other three warnings
// here. No component name, no `Description`, no part number.
//
// **A warning rather than a refusal**, matching its neighbours: the program builds and the
// pedal renders, and this says the rendered circuit contains a contradiction the source almost
// certainly did not intend. Two plausible readings stay open and this stage cannot pick
// between them — a transcription that merged two distinct nets into one node, or a real
// paralleling that the source drew faithfully — and either way the compiled circuit is
// over-determined, which is the reportable fact.
//
// **All of them were read against their sources on 2026-08-21, and one thing that reading found
// belongs here: over-determined is not the same as inconsistent.** Freeing the second source
// changed the render by nothing measurable on four of the five, because two ideal sources
// asserting the *same* voltage leave the solution alone. Only `ibanez-pql`, whose two competing
// devices are *different* op-amps, manufactured a level — `1.79 V` of swing against `2.48e-2`
// once separated. So this warning marks a real structural contradiction and says nothing about
// audibility, and the triage test is one program patch plus one render. See
// `docs/troubleshootings/the-over-driven-nodes-read-against-their-sources.md`.

import type { Block, CompileWarning, NodeId, Program } from "./types";
import { blockRow, describeRow } from "./block-row";

/**
 * Nodes driven by more than one ideal voltage source, read from the **lowered stamps**.
 *
 * Reading stamps rather than the netlist is the whole correctness of this rule, and a first
 * version got it wrong. `boss-sd-1` declares two supply devices on node 14 -- a `rail` and a
 * battery's positive terminal -- and lowering collapses them into **one** `dc-source` stamp, so
 * the compiled circuit is not over-determined and ngspice accepts the deck. A netlist-level
 * check flagged it anyway, reporting a redundant *declaration* as a contradiction. The stamps
 * are what the runtime executes and what the deck is emitted from, so they are the only thing
 * that can say whether two sources really force one unknown.
 *
 * Counts `dc-source` positives and `ideal-opamp` outputs, and nothing else. A transistor
 * collector on a driven node is ordinary -- a collector is a current source behind a load
 * resistor, not a voltage forced through near-zero impedance -- and a supply's negative end is
 * a reference rather than a driver, so counting either would make this noise.
 *
 * Per block, because regions are independent solves: two sources on the same node id in
 * different regions are different unknowns and no conflict.
 */
export function findOverDrivenNodes(
	program: Program,
): readonly CompileWarning[] {
	const warnings: CompileWarning[] = [];
	for (const block of program.blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		const byNode = new Map<NodeId, string[]>();
		for (const stamp of block.stamps) {
			const driver = drivenNode(stamp);
			if (driver === null || driver.node === 0) {
				continue;
			}
			byNode.set(driver.node, [
				...(byNode.get(driver.node) ?? []),
				driver.label,
			]);
		}
		for (const [node, drivers] of byNode) {
			if (drivers.length < 2) {
				continue;
			}
			warnings.push({
				code: "node-driven-by-two-sources",
				device: null,
				detail:
					// The source node, not the row: this names a net someone has to go and look at.
					`in block ${block.id}, ${drivers.join(" and ")} all drive node ${describeRow(block, blockRow(node))}, so ` +
					"that many ideal voltage sources force one unknown and the system is " +
					"over-determined: ngspice refuses such a deck as a singular matrix, while " +
					"this runtime gives each its own auxiliary row and renders whatever the " +
					"solve allows",
			});
		}
	}
	return warnings;
}

/**
 * The node a stamp forces the voltage of and a label naming it, or `null` when it forces none.
 *
 * The label is the stamp kind and its auxiliary index, because a stamp carries no device id —
 * so this is the most specific thing that can be said about which element is in conflict.
 */
function drivenNode(
	stamp: Extract<Block, { kind: "mna" }>["stamps"][number],
): { readonly node: NodeId; readonly label: string } | null {
	switch (stamp.kind) {
		case "dc-source":
			return {
				node: stamp.positive,
				label: `dc-source#${stamp.sourceIndex}`,
			};
		// An AC source forces its node just as firmly as a DC one; only the value moves. Two of
		// them on a node -- or one beside a rail -- is the same over-determined system, and a
		// mains inlet declared twice is exactly the shape a transcription produces.
		case "ac-source":
			return {
				node: stamp.positive,
				label: `ac-source#${stamp.sourceIndex}`,
			};
		case "ideal-opamp":
			return {
				node: stamp.output,
				label: `ideal-opamp#${stamp.sourceIndex}`,
			};
		default:
			return null;
	}
}

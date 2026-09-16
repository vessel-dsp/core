// A program that reaches its output port with nothing at all.
//
// **The question a builder actually asks, and the one nothing answered.** Wire a guitar signal
// into a chip the registry cannot model -- an omitted codec, a DSP declared as a pin shell, a
// package whose analog pins the packet never traced -- and the chip lowers to `open`. The
// compiled program is then byte-for-byte the circuit *without* it: the stages before it stamp
// exactly as they did, the document is `ok`, and the output jack sits on a node no live block
// produces. `ic-not-executed` names the chip; nothing named the consequence.
//
// **What this proves, and it is a proof rather than an inference.** `link.ts` already computes
// which blocks reach the output (`blocksReachingOutput`) and emits only those into `order`. A
// program whose `order` is empty executes no block under any runtime, at any control position,
// at any sample rate. It cannot produce audio. That is a statement about the emitted program,
// not a claim about a graph.
//
// **Why this is not path-finding, which was the obvious design and is the wrong one.**
// `scripts/report-signal-path.ts` walks input to output over device conduction, and its own
// header records the trap: a non-inverting op-amp stage has no passive route from its signal
// input to its output, so `vemuram-jan-ray`, `mxr-micro-amp` and `jhs-morning-glory` all read
// "no path" while rendering perfectly well. A warning built on that graph would fire on working
// pedals, and a warning that cries wolf on a working pedal is worse than no warning. The first
// attempt here made a smaller version of the same mistake -- comparing `ports.output`, a global
// node id, against the node ids inside stamps -- and flagged 42 of 118 packets including
// `mxr-micro-amp` and `mxr-carbon-copy`. Block node ids are block-local; the comparison was
// meaningless. Measured against the emitted `order` instead, the false-alarm count is zero.
//
// **What it does not prove.** Not that a program with a non-empty `order` is audible: a block
// can execute and still be attenuated to nothing, which is `report-signal-path.ts`'s question
// and stays there. And a live `macro` block whose write-back reaches no block claiming the
// output port is *not* caught, because `blocksReachingOutput` treats every macro as live by
// construction; `boss-ps-2` and `boss-tu-3` are in that position and are deliberately left
// alone rather than flagged on a rule this cannot back.
//
// **Warning, not refusal**, for the reason the repository settles this trade every time: four
// corpus packets are in this state today (`boss-bf-3`, `boss-hr-2`, `boss-oc-3`, `boss-st-2`,
// each a digital pedal whose audio path crosses a chip that is not modelled) and refusing them
// would trade a compiling packet for a stricter gate. `boss-bf-3` is the one to look at first:
// it compiles **148 blocks and executes none of them**.
import { deviceCountByNode } from "./device-laws";
import type { Netlist, OutputPortUnreachableWarning, Program } from "./types";

/**
 * How much of the document is wired, as a sentence, or empty when it is wired normally.
 *
 * **The number that explains the block count.** `boss-bf-3` compiles 148 blocks of one stamp each
 * and runs none, and the block count alone reads like a compiler defect. It is not: its 166
 * devices declare 458 terminals across 418 non-ground nodes and only **10** of those nodes are
 * touched by more than one device. A node one device touches is not a net, so the document is a
 * terminalized parts list rather than a circuit, which is exactly the graph coverage its own
 * README claims (`terminalized-source-shell`).
 *
 * Reported as a measurement with no threshold and no verdict, because the corpus has a spread
 * rather than two classes: the median packet shares 93.3% of its non-ground nodes, and the tail
 * runs 2.1% (`boss-oc-3`), 2.4% (`boss-bf-3`), 4.8% (`boss-bf-2`), 11.5% (`boss-dd-5`). Naming a
 * cutoff would invent a boundary the data does not have; the reader can see the ratio.
 */
function wiringSummary(netlist: Netlist): string {
	const counts = deviceCountByNode(netlist);
	let nets = 0;
	let shared = 0;
	for (const [node, devices] of counts) {
		if (node === 0) {
			continue;
		}
		nets += 1;
		if (devices >= 2) {
			shared += 1;
		}
	}
	if (nets === 0) {
		return "";
	}
	const terminals = netlist.devices.reduce(
		(total, device) => total + device.nodes.length,
		0,
	);
	return (
		` Its ${netlist.devices.length} devices declare ${terminals} terminals across ${nets} ` +
		`non-ground nodes, and ${shared} of those nodes are touched by more than one device: a node ` +
		"only one device touches is not a net, so a low share here means the document's " +
		"connectivity was never captured rather than that a component is missing a model."
	);
}

export function findUnreachableOutput(
	program: Program,
	netlist: Netlist,
): readonly OutputPortUnreachableWarning[] {
	if (program.order.length > 0) {
		return [];
	}
	const macros = program.blocks.filter((block) => block.kind === "macro").length;
	return [
		{
			code: "output-port-unreachable",
			device: null,
			detail:
				`no block reaches the output port, so this program's execution order is empty: ` +
				`${program.blocks.length} block${program.blocks.length === 1 ? " was" : "s were"} compiled ` +
				`(${macros} of them DSP macros) and none of them runs. It can produce no audio at any ` +
				"control position. The usual cause is a component on the signal path that carries no " +
				"executable model, which an `ic-not-executed` or `electrically-isolated-ic` warning " +
				"beside this one will name: the stages around it still compile, so the document looks " +
				"whole while the path to the jack is severed." +
				wiringSummary(netlist),
		},
	];
}

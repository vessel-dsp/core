/**
 * **What KIND of gap is an open device?** `open` is one value standing in for five different
 * claims, and until it is split, "this chip has no model" cannot be told from "this chip needs no
 * model".
 *
 * The five, and what each one asserts:
 *
 * | category | the claim | how it is checked |
 * |---|---|---|
 * | `inert` | not on the audio path, so no model is needed | **structurally: the signal must not have to pass through it** |
 * | `opaque` | the behaviour IS firmware we do not have | the packet must carry a firmware blocker naming it |
 * | `gap` | fixed-function, documented, simply unwritten | this and only this counts as an engine gap |
 * | `subsumed` | owned by a macro that already models it | must name the macro, and the macro must exist |
 * | `source-boundary-shell` | deliberately outside the packet's declared scope | the packet's scope must say so |
 *
 * **`source-boundary-shell` is in this enum from the start on purpose.** It is a real reason the
 * compiler already emits, and it was missing from the 2026-09-11 Phase 0 triage — which is why that
 * census could not see `electro-harmonix-deluxe-memory-man`'s five open op-amps at all. A category
 * nobody knew to look for is invisible to a hand-kept list and merely unclassified to a query.
 */
export type OpenCategory =
	| "inert"
	| "opaque"
	| "gap"
	| "subsumed"
	| "source-boundary-shell";

export type NetGraph = {
	readonly devices: readonly { readonly id: string; readonly nodes: readonly number[] }[];
	readonly ports: { readonly input: number; readonly output: number };
};

/**
 * **DOES THE OUTPUT DEPEND ON THIS DEVICE?** — using the engine's own reachability, not a
 * re-implemented graph test.
 *
 * **This replaces a cut-vertex test that produced a zero, and the mechanism is worth keeping.**
 * That test asked whether removing a device disconnects the output from the input. It has four
 * biases and all four point the same way:
 *
 * 1. **A parallel branch is never a cut vertex** — wet beside dry, a bypass, a feedback network.
 *    That is every delay, reverb, chorus and phaser in the corpus.
 * 2. **A disconnected netlist scores everything "not load-bearing"**, because nothing reaches the
 *    output at all. Thirty-three open devices across seven packets scored inert for that reason.
 * 3. **Control and clock dependence is invisible to any connectivity test.** A chip that sets a
 *    delay time sits off the signal path by construction.
 * 4. The naming and ownership tests around it all erred toward "declared".
 *
 * **And the aggregate turned that conservatism into a clean bill of health**: the gap count was
 * computed only over the devices the test classified as on-path, so everything it could not
 * classify fell out of the count entirely. **A conservative test wired to an aggregate reports
 * zero.** The two queries defined "undeclared gap" identically and answered 0 and 9.
 *
 * So the criterion is not "on the signal path" but **"the output depends on it"**, and the
 * cheapest sound answer is the one `link.ts` already computes: a block in `program.order` is one
 * the linker proved can reach the output. **A device whose nodes sit in such a block is one the
 * output can depend on — through signal, clock, control or bias alike**, which is exactly the
 * dependence the connectivity tests could not see.
 */
export type Dependence = "output-can-depend" | "unreachable-region" | "packet-disconnected";

export function outputDependence(
	deviceNodes: readonly number[],
	executedBlockNodes: ReadonlySet<number>,
	packetDisconnected: boolean,
): Dependence {
	if (packetDisconnected) return "packet-disconnected";
	return deviceNodes.some((n) => n !== 0 && executedBlockNodes.has(n))
		? "output-can-depend"
		: "unreachable-region";
}

/**
 * **`packet-disconnected` is its own answer and never folded into "inert".** Thirty-three of the
 * eighty-seven open devices are unclassifiable because their packet's input does not reach its
 * output at all — a defect in the packet, not a property of the device. Counting them as inert is
 * how a broken corpus reads as a clean one.
 */
export function isPacketDisconnected(graph: NetGraph): boolean {
	const adj = new Map<number, number[]>();
	for (const d of graph.devices)
		for (let i = 0; i < d.nodes.length; i++)
			for (let j = i + 1; j < d.nodes.length; j++) {
				const a = d.nodes[i]!;
				const b = d.nodes[j]!;
				if (a === 0 || b === 0 || a === b) continue;
				(adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
				(adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
			}
	const seen = new Set<number>([graph.ports.input]);
	const queue = [graph.ports.input];
	while (queue.length > 0) {
		const n = queue.pop()!;
		for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
	}
	return !seen.has(graph.ports.output);
}

/**
 * **AN INDEPENDENT SECOND OPINION, DELIBERATELY LOOSER, WHOSE DISAGREEMENTS ARE THE SIGNAL.**
 *
 * `outputDependence` consults `program.order` — the linker's own reachability. That is the right
 * criterion and it has a blind spot that no cross-check of its *results* can see: **the census now
 * agrees with the runtime by construction, so a pruning bug is invisible to it.** If `link.ts`
 * over-prunes a region AND the packet therefore renders silent, the census and the runtime are
 * wrong together and agree — the silent-packet cross-check confirms the test does not fail open,
 * and cannot detect over-pruning that also silences.
 *
 * So this stays alive beside it: plain undirected connectivity with ground **and declared rails**
 * removed. It is **expected to be looser** — it says yes more often — and a bare disagreement is
 * not news. **The finding is the direction**: reachability saying a device is depended on where
 * this says it is not connected at all means the linker scheduled something the graph cannot
 * reach, and the reverse means a region the graph can reach was pruned.
 *
 * **This is not the cut-vertex test returning.** That one is dead: it asked whether removing a
 * device disconnects the ports, which every parallel branch defeats. This asks only whether the
 * device sits in the same rail-free component as both ports.
 */
export function connectedToBothPorts(
	graph: NetGraph,
	deviceNodes: readonly number[],
	rails: ReadonlySet<number>,
): boolean {
	const skip = (n: number): boolean => n === 0 || rails.has(n);
	const adj = new Map<number, number[]>();
	for (const d of graph.devices)
		for (let i = 0; i < d.nodes.length; i++)
			for (let j = i + 1; j < d.nodes.length; j++) {
				const a = d.nodes[i]!;
				const b = d.nodes[j]!;
				if (skip(a) || skip(b) || a === b) continue;
				(adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
				(adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
			}
	const reach = (from: number): Set<number> => {
		const seen = new Set<number>([from]);
		const q = [from];
		while (q.length > 0) {
			const n = q.pop()!;
			for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); q.push(m); }
		}
		return seen;
	};
	const fromIn = reach(graph.ports.input);
	const fromOut = reach(graph.ports.output);
	return deviceNodes.some((n) => !skip(n) && fromIn.has(n) && fromOut.has(n));
}

/** The structural rules. Each returns a violation string, or `null` when the claim holds. */
export const OPEN_RULES = {
	/** An open part the output can depend on may not be called inert. */
	inertOffPath(category: OpenCategory, mustTraverse: boolean): string | null {
		return category === "inert" && mustTraverse
			? "claims `inert` but the signal must pass through it: removing it disconnects the output from the input"
			: null;
	},
	/** `subsumed` must name its macro, and that macro must exist. */
	subsumedNamesAnExistingMacro(
		category: OpenCategory,
		macroId: string | null,
		macroExists: boolean,
	): string | null {
		if (category !== "subsumed") return null;
		if (macroId === null) return "claims `subsumed` but names no macro that subsumes it";
		return macroExists ? null : `claims \`subsumed\` by \`${macroId}\`, which does not exist`;
	},
	/** `opaque` must be paired with a firmware blocker in the packet. */
	opaqueHasFirmwareBlocker(category: OpenCategory, blocked: boolean): string | null {
		return category === "opaque" && !blocked
			? "claims `opaque` -- the behaviour is firmware -- but the packet's record declares no firmware blocker for it"
			: null;
	},
} as const;

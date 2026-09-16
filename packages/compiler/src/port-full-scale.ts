// The largest voltage a port can physically present, so a chain can compare two blocks.
//
// `ChainRuntime` hands one slot's output straight to the next as a bare number. That works for
// pedal-into-pedal only because their ranges coincide: a pedal's output is the voltage at its
// output jack, ~0.1 to 2 V, while an amp's is the voltage at its speaker terminal --
// `fender-5e3-deluxe-tweed` measures 7.08 V into its 8 ohm load. Feed one into the other and the
// level is wrong by an order of magnitude, and nothing in the program said what either number
// meant.
//
// **An upper bound, not a nominal level.** A node cannot swing beyond the rails feeding it, and
// an output transformer steps that bound down by its turns ratio. Both facts are already in the
// program, so this needs no new source declaration -- which matters, because the corpus does not
// carry one: 31 amp jacks declare `V0dBFS` and every one of them is a monitor tap, no typed
// speaker load declares it, and rated output power appears once in 24 amp packets.
//
// **`null` where it is not derivable**, and the chain then scales by 1 and says so. A fabricated
// default here would be exactly the silent substitution this repository refuses elsewhere: it
// would look like a level convention while being a guess.

import { type Block, GROUND, type NodeId, type Ports } from "./types";

export type PortFullScaleVolts = {
	readonly input: number | null;
	readonly output: number | null;
};

/**
 * Read from the lowered stamps rather than the declared devices, the same discipline
 * `supply-reference.ts` uses and for the same reason: lowering is what collapses redundant
 * supply declarations into one source, and the stamps are what the runtime executes.
 *
 * A transformer stamp is only consulted when it declares a `turnsRatio` **and** the output port
 * sits on one of its secondary nodes. A mains transformer's windings are nodes too, and dividing
 * by a power transformer's ratio would be arithmetic on an unrelated number.
 */
/**
 * Read from the lowered stamps rather than the declared devices, the same discipline
 * `supply-reference.ts` uses and for the same reason: lowering is what collapses redundant
 * supply declarations into one source, and the stamps are what the runtime executes.
 *
 * **Propagated from the supply rather than looked up at the port**, which is the correction of
 * 2026-09-03. The previous rung kept a `Map<NodeId, factor>` written by every transformer stamp
 * that touched a node, so the answer depended on write order and on whether a stamp related the
 * port to the *supply* at all. Two defects followed, and both are measured:
 *
 * - A coil with two loaded taps stamps a winding between them, and that stamp related
 *   `orange-rockerverb`'s 16 Ω output to its 8 Ω sibling -- not to any supply. Written last, its
 *   `x1.4142` replaced the `x0.1372` plate step-down and the amp's bound became 580 V, above its
 *   own 410 V rail.
 * - Nine of the 24 amps had **no** stamp on the output node and fell back to the bare rail:
 *   `marshall-jcm800` reported 466.7 V for a speaker terminal. Their speaker jack sits on an
 *   impedance selector's common, one 0.01 Ω throw away from the winding, and a direct node lookup
 *   cannot cross it.
 *
 * So this walks outward from the supply nodes: a transformer stamp multiplies by its ratio in the
 * direction travelled, and a selector throw is a near-short that carries the bound across
 * unchanged. **The largest bound reaching the port wins**, which is what makes it an upper bound
 * rather than a nominal level -- a selector's throws are alternative taps and any of them may be
 * the closed one, so the loosest is the one that has to hold.
 */
/**
 * Read from the lowered stamps rather than the declared devices, the same discipline
 * `supply-reference.ts` uses and for the same reason: lowering is what collapses redundant
 * supply declarations into one source, and the stamps are what the runtime executes.
 *
 * The composition is `maximum supply x the transformer factor at the port`. It is not a walk from
 * the supply to the port: the B+ that drives an output transformer's plate winding arrives
 * through a rectifier and a filter bank, so no transformer-only path connects the two --
 * `fender-5f1-champ`'s speaker node is reachable from its 410 V winding only through its 5Y3 and
 * two 16 uF caps. Tried and measured: a propagation reached the port on nothing.
 *
 * **Two corrections, 2026-09-03**, both from measuring all 24 corpus amps:
 *
 * - **The port may sit one near-short away from the winding.** Nine amps reported their bare rail
 *   for a speaker terminal -- `marshall-jcm800` 466.7 V -- because their speaker jack sits on an
 *   impedance selector's *common* and a direct node lookup cannot cross a 0.01 ohm throw. The
 *   port's winding node is now found through selector and switch links.
 * - **The smallest factor at that node wins.** A coil with two loaded taps stamps a winding
 *   between them, and that stamp relates `orange-rockerverb`'s 16 ohm output to its 8 ohm sibling
 *   rather than to any supply. Kept in a map written per stamp it replaced the plate step-down by
 *   write order and the amp's bound became 580 V, above its own 410 V rail. Every stamp touching
 *   the node constrains it at once, so the tightest is the one that has to hold.
 *
 *   The residual: a sibling-tap stamp whose factor happened to be *smaller* than the plate
 *   step-down would be chosen and would under-report the bound, making a render louder rather
 *   than quieter. No corpus coil is shaped that way -- a tap-to-tap ratio is within a factor of
 *   two of one, and a plate-to-speaker ratio is 10x to 40x down.
 */
export function portFullScaleVolts(
	blocks: readonly Block[],
	ports?: Ports,
): PortFullScaleVolts {
	let supplyVolts = 0;
	/** Smallest transformer factor found at each node. */
	const portFactor = new Map<NodeId, number>();
	/** Nodes joined to each other by a near-short: a selector throw or a switch. */
	const shorted = new Map<NodeId, Set<NodeId>>();
	const join = (a: NodeId | undefined, b: NodeId | undefined): void => {
		if (a === undefined || b === undefined || a === GROUND || b === GROUND) {
			return;
		}
		for (const [from, to] of [
			[a, b],
			[b, a],
		] as const) {
			const set = shorted.get(from) ?? new Set<NodeId>();
			set.add(to);
			shorted.set(from, set);
		}
	};
	const noteFactor = (node: NodeId | undefined, factor: number): void => {
		if (node === undefined || node === GROUND) {
			return;
		}
		portFactor.set(node, Math.min(portFactor.get(node) ?? factor, factor));
	};

	for (const block of blocks) {
		if (block.kind !== "mna") {
			continue;
		}
		for (const stamp of block.stamps) {
			// **Both source kinds, and an amp needs the AC one.** A tube amp's B+ is rectified
			// from a mains winding, so its supply appears as `ac-source` peaks and its
			// `dc-source` maximum is zero: measured, `fender-5e3-deluxe-tweed` states 466.7 V
			// peak of AC and 0 V of DC. Reading only `dc-source` returned `null` for three of
			// the five compiling amps -- the exact silent gap this bound exists to close.
			if (stamp.kind === "dc-source") {
				supplyVolts = Math.max(supplyVolts, Math.abs(stamp.volts));
				continue;
			}
			if (stamp.kind === "ac-source") {
				supplyVolts = Math.max(supplyVolts, Math.abs(stamp.amplitudeVolts));
				continue;
			}
			// Row indices, not node ids -- a block's stamps address its matrix rows, which is why
			// the transformer branch below indexes `nodeIds` too. Passing them through raw found
			// no winding for any of the nine amps this traversal exists for.
			if (stamp.kind === "selector") {
				join(block.nodeIds[stamp.common], block.nodeIds[stamp.throwNode]);
				continue;
			}
			if (stamp.kind === "switch") {
				join(block.nodeIds[stamp.a], block.nodeIds[stamp.b]);
				continue;
			}
			if (stamp.kind !== "transformer") {
				continue;
			}
			if (!Number.isFinite(stamp.turnsRatio) || stamp.turnsRatio <= 0) {
				continue;
			}
			// The stamp is `Vp - n*Vs = 0`, so a node on the primary side is `n` times the other
			// side and a node on the secondary side is `1/n` of it. **Which side a speaker sits
			// on is not an assumption to make**: `fender-5e3-deluxe-tweed` lowers with its 8 ohm
			// load on `primary` and its plates on `secondary`, and `fender-5f1-champ` the other
			// way round, so both directions are recorded and the port's own node decides.
			for (const row of [stamp.primaryPlus, stamp.primaryMinus]) {
				noteFactor(block.nodeIds[row], stamp.turnsRatio);
			}
			for (const row of [stamp.secondaryPlus, stamp.secondaryMinus]) {
				noteFactor(block.nodeIds[row], 1 / stamp.turnsRatio);
			}
		}
	}
	if (supplyVolts <= 0) {
		// No supply stated, so no bound exists for either port. A passive pedal --
		// `ernie-ball-vp-jr` -- lands here honestly.
		return { input: null, output: null };
	}
	const outputNode =
		ports?.output ??
		(() => {
			for (const block of blocks) {
				if (block.kind === "mna" && block.outputNode !== null) {
					return block.nodeIds[block.outputNode];
				}
			}
			return undefined;
		})();
	const factor =
		outputNode === undefined
			? undefined
			: factorNear(outputNode, portFactor, shorted);
	return {
		// **An input's bound is not derivable from the supply, so nothing is derived here.** The
		// rails bound what a node can *reach*, which is the right bound for an output and the
		// wrong one for an input: an amp's grid circuit sets its input sensitivity, and
		// `fender-5e3`'s 466.7 V rail says nothing about it. Deriving it anyway gave that amp an
		// input bound of 466.7 V, which would attenuate a 9 V pedal by 50x at that seam -- a
		// fabricated number producing an audible error, which is worse than no number at all.
		//
		// The missing fact is an input sensitivity, **or a `V0dBFS` on the input jack -- and this
		// comment used to record that no packet declared one.** Measured 2026-09-03: 98 of the 142
		// corpus documents do, 77 pedals and 21 amps, at 0.1, 0.15, 0.2 and 1 V. `link.ts` reads
		// them and prefers them over anything derived on either port. Null here still means the
		// same thing -- nothing is inferred from rails -- and where no declaration exists the
		// chain scales by 1 and `src/runtime/chain-scale.ts` says so.
		input: null,
		output: factor === undefined ? supplyVolts : supplyVolts * factor,
	};
}

/**
 * The transformer factor at `node`, or at the nearest node joined to it by near-shorts.
 *
 * Breadth-first so the nearest winding wins, and the smallest factor among equally near ones --
 * an impedance selector reaches three taps at one hop, any of which the control may close, and
 * the tightest bound is the one that has to hold for all of them.
 */
function factorNear(
	node: NodeId,
	portFactor: ReadonlyMap<NodeId, number>,
	shorted: ReadonlyMap<NodeId, ReadonlySet<NodeId>>,
): number | undefined {
	const seen = new Set<NodeId>([node]);
	let frontier: NodeId[] = [node];
	// Two hops covers a jack behind a selector behind a switch. Unbounded would let a chain of
	// shorts borrow a factor from an unrelated winding across the amp.
	for (let hop = 0; hop < 3 && frontier.length > 0; hop += 1) {
		let best: number | undefined;
		for (const at of frontier) {
			const factor = portFactor.get(at);
			if (factor !== undefined) {
				best = best === undefined ? factor : Math.min(best, factor);
			}
		}
		if (best !== undefined) {
			return best;
		}
		const next: NodeId[] = [];
		for (const at of frontier) {
			for (const neighbour of shorted.get(at) ?? []) {
				if (!seen.has(neighbour)) {
					seen.add(neighbour);
					next.push(neighbour);
				}
			}
		}
		frontier = next;
	}
	return undefined;
}

export function deriveFullScaleVolts(
	supplyVolts: number | null,
	turnsRatio: number | null,
): number | null {
	if (supplyVolts === null || !Number.isFinite(supplyVolts) || supplyVolts <= 0) {
		return null;
	}
	if (turnsRatio === null || !Number.isFinite(turnsRatio) || turnsRatio <= 0) {
		return supplyVolts;
	}
	return supplyVolts / turnsRatio;
}

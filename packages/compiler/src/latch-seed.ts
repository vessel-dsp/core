// Operating-point seeds for cross-coupled bistables.
//
// A symmetric cross-coupled BJT pair has **three** DC solutions: two latched and the
// unstable midpoint between them. Newton started from `fill(0)` begins exactly on the
// symmetry axis and returns the midpoint, which is a valid solution of the system and a
// state no physical pedal holds. Nothing is failing to converge, so no iteration cap and
// no tolerance touches it — the initial guess *chooses the answer*, and the only fix is to
// make that guess data rather than a convention.
//
// Measured on the corpus: three compiled packets sit on the axis, at `1.74723 / 1.74723`,
// `1.78645 / 1.78645` and `3.13363 / 3.13363`, their two halves agreeing to between `2e-11`
// and `4e-6`. One of them is the corpus's only ngspice `disagrees`, one is near-silent, and
// the third **agrees with ngspice at `corr=1.0000`** — because the deck carries the same
// stamps and ngspice converges to the same midpoint. Parity cannot see this class.
//
// See `docs/troubleshootings/boss-hm-2-linear-where-ngspice-distorts.md` for what the
// midpoint does downstream: both collectors half-high bias every switching JFET
// identically, so the bypass and effect paths conduct at once and which dominates is
// settled by rounding.

import type { Device, Netlist, NodeId, OperatingPointSeed } from "./types";

/**
 * Enough forward bias to put one base into conduction and let the pair fall to that side.
 *
 * Measured rather than chosen: seeding a single base at this value converges to a latched
 * state in 16 iterations, the same count as the symmetric solve, and the mirrored seed
 * reaches the mirrored state. Its exact value is not delicate — it has to be a base-emitter
 * voltage that conducts, and anything that does selects the same basin.
 */
const LATCH_SEED_VOLTS = 0.65;

/**
 * A cross-coupled pair, by connectivity alone.
 *
 * **Seed a base, never a collector.** This is the whole reason the rule is written in terms
 * of bases. A seed enters the solve only through the nonlinear devices' linearisation
 * points, and perturbing a *collector* creates no differential base drive: measured at every
 * magnitude from `1e-9` to `5 V`, a collector seed returns the symmetric solution in an
 * identical 16 iterations, so it does exactly nothing. A caller cannot be trusted to know
 * that, which is why this function emits the seeds rather than exposing the pair.
 *
 * Four structural requirements, and each one is load-bearing:
 *
 * 1. **A direct resistor each way**, collector to the opposite base. All three corpus pairs
 *    are wired this way, two of them with a speed-up capacitor in parallel. Requiring a
 *    direct element rather than a path is most of what keeps this from over-matching.
 * 2. **A shared emitter node.** The corpus pairs share ground, ground, and a common node
 *    that is not ground. Two transistors that merely have resistors between them do not.
 * 3. **Rails are not routes.** Neither collector nor base may be a rail. Without this the
 *    supply links every collector to every base and the rule dissolves: measured, a census
 *    lacking it reported one packet as having **12** cross-coupled pairs among four
 *    transistors. The same exclusion `findUnboundedOpamps` and `switchesClosedForPortPath`
 *    make. An emitter *on* a rail is expected and fine — two of the three pairs sit on
 *    ground.
 * 4. **Exclusivity.** A transistor in more than one candidate pair makes every pair it is in
 *    ambiguous, and an ambiguous latch is not seeded. Guessing which pair is the real one
 *    from a tie-break would put the pedal in a state chosen by node numbering.
 *
 * **Which side, with a floor.** `effectGatingBase` finds the member whose collector
 * gates the effect FET — and that member is **off** when the pedal is engaged, so the
 * names are written from the other member: `onWhenEngaged` is ON (collector low) at
 * control >= 0.5 and `offWhenEngaged` is OFF (collector high, effect FET gate high,
 * effect conducting). When neither connectivity nor (see Row 2) the effect-status LED
 * can read the side out, this falls back to the lower base node id — deterministic,
 * meaningless, and still a *physical* state rather than the midpoint. The fallback keeps
 * exactly the member the pre-fix code seeded (its `engaged` was the lower base id), so
 * fallback programs do not move; only its provenance (`fallback`) admits the name is a
 * stable choice rather than a derived fact.
 *
 * What this still does not give is **toggling**. The seed decides where the circuit powers up;
 * it is not an input the control plane can move, so a footswitch cannot change it. That needs
 * the latched-state operator with a state entry — see the runtime plan's S4 initial-state item.
 */
/**
 * A cross-coupled pair's two sides, named for the transistor that is ON when the
 * pedal is engaged.
 *
 * Physics, measured on `boss-sd-1`/`boss-ce-2`/`boss-dm-2` (2026-10-23): the member
 * `effectGatingBase` finds — the one whose collector reaches the effect FET's gate
 * through DC edges — must be OFF (collector high) when engaged, because a collector
 * pulled LOW (transistor ON) drags that FET's gate low through the steering diode and
 * turns the effect OFF. Seeding that member's base at 0.65 V rendered bypass
 * (`boss-sd-1` at bypass control 1: −0.73 dB, THD 0.02 %, effect FET off, CHECK LED
 * dark), and the steering stamps held the same wrong side. So `onWhenEngaged` is the
 * *other* member from what the old `engaged` named: ON (collector low) at engaged,
 * seeded at `LATCH_SEED_VOLTS`, its collector pulled to the emitter at control >= 0.5.
 */
export type LatchSideProvenance = "connectivity" | "effect-status-led" | "fallback";

export type BistableLatch = {
	readonly controlId: string | null;
	readonly onWhenEngagedBase: NodeId;
	readonly offWhenEngagedBase: NodeId;
	readonly emitter: NodeId;
	readonly onWhenEngagedCollector: NodeId;
	readonly offWhenEngagedCollector: NodeId;
	readonly onWhenEngagedTransistorId: string;
	readonly offWhenEngagedTransistorId: string;
	/**
	 * How the engaged side was chosen. `connectivity` and `effect-status-led` are
	 * evidence; `fallback` is the legacy stable choice (lower base id, the exact node
	 * the pre-fix code seeded) and carries no engaged-side claim.
	 */
	readonly sideProvenance: LatchSideProvenance;
};

/**
 * How an effect-status LED sits on a latch collector, or in other words which way
 * round it lights. `cathode-direct` / `cathode-1R` / `cathode-chain` light when the
 * collector is LOW (transistor ON); `anode-direct` / `anode-chain` light when it is
 * HIGH (transistor OFF). An anode exactly one resistor away is deliberately not
 * evidence: that is the shape a shared supply node makes with the collector load
 * resistors (measured on both `boss-bd-2` builds, `boss-ds-2`, `boss-cs-2` and
 * `boss-oc-2`, whose LED anodes sit a resistor from *both* collectors), not a
 * steering branch.
 */
export type LedLatchPolarity =
	| "cathode-direct"
	| "cathode-1R"
	| "cathode-chain"
	| "anode-direct"
	| "anode-chain";

/**
 * A latch where connectivity and the effect-status LED name different engaged sides.
 * The connectivity answer stands; this is the record the `latch-engaged-disagrees`
 * diagnostic reports.
 */
export type LatchLedDisagreement = {
	readonly onWhenEngagedTransistorId: string;
	readonly ledOnTransistorId: string;
	readonly ledId: string;
	readonly ledPolarity: LedLatchPolarity;
};

type LatchNetlist = Pick<Netlist, "devices" | "effectStatusLeds"> & {
	readonly controls?: readonly import("./types").Control[];
};

export function findBistableLatches(netlist: LatchNetlist): readonly BistableLatch[] {
	const rails = detectorRails(netlist);
	const floodRails = latchFloodRails(netlist, rails);
	const pairs = candidatePairs(netlist, rails);

	const latches: BistableLatch[] = [];
	for (const pair of pairs) {
		const assessed = assessLatchSides(netlist, floodRails, pair.a, pair.b);

		const bypassControls = (netlist.controls ?? []).filter(
			(c) => c.role === "bypass",
		);
		let controlId: string | null =
			bypassControls.length === 1 ? (bypassControls[0]?.id ?? null) : null;

		if (controlId === null) {
			for (const dev of netlist.devices) {
				if (dev.kind === "switch" && dev.control !== null) {
					controlId = dev.control;
					break;
				}
			}
		}

		latches.push({
			controlId,
			onWhenEngagedBase: assessed.onMember.base,
			offWhenEngagedBase: assessed.offMember.base,
			emitter: pair.a.emitter,
			onWhenEngagedCollector: assessed.onMember.collector,
			offWhenEngagedCollector: assessed.offMember.collector,
			onWhenEngagedTransistorId: assessed.onMember.id,
			offWhenEngagedTransistorId: assessed.offMember.id,
			sideProvenance: assessed.sideProvenance,
		});
	}
	return latches;
}

/**
 * Latches where the connectivity derivation and the effect-status LED disagree about
 * the engaged side. The detector keeps the connectivity answer; this names the
 * conflict for the diagnostic, one item per latch.
 */
export function findLatchLedDisagreements(
	netlist: LatchNetlist,
): readonly LatchLedDisagreement[] {
	const rails = detectorRails(netlist);
	const floodRails = latchFloodRails(netlist, rails);
	const out: LatchLedDisagreement[] = [];
	for (const pair of candidatePairs(netlist, rails)) {
		const assessed = assessLatchSides(netlist, floodRails, pair.a, pair.b);
		if (
			assessed.sideProvenance === "connectivity" &&
			assessed.ledVote !== null &&
			assessed.ledVote.member.id !== assessed.onMember.id
		) {
			out.push({
				onWhenEngagedTransistorId: assessed.onMember.id,
				ledOnTransistorId: assessed.ledVote.member.id,
				ledId: assessed.ledVote.ledId,
				ledPolarity: assessed.ledVote.polarity,
			});
		}
	}
	return out;
}

type LedVote = {
	readonly member: Transistor;
	readonly ledId: string;
	readonly polarity: LedLatchPolarity;
};

type SideAssessment = {
	readonly onMember: Transistor;
	readonly offMember: Transistor;
	readonly sideProvenance: LatchSideProvenance;
	readonly ledVote: LedVote | null;
};

/**
 * Which side is ON when engaged. Precedence is derivation order, not confidence
 * blending: connectivity first, then the effect-status LED, then the floor.
 *
 * - **Connectivity.** The member whose collector gates the effect path is OFF when
 *   engaged, so the ON side is the other member.
 * - **Effect-status LED.** A CHECK LED is lit when the pedal is engaged, so the
 *   member the LED indicates is the ON side — but only where connectivity refused.
 *   Where both speak and they disagree, connectivity stands and
 *   `findLatchLedDisagreements` reports it; that path never reaches a silent choice.
 * - **Fallback.** The pre-fix assignment (lower base id) exactly, so fallback
 *   programs stay byte-identical; the provenance admits the name is a stable choice
 *   rather than a derived fact.
 */
function assessLatchSides(
	netlist: LatchNetlist,
	rails: ReadonlySet<NodeId>,
	a: Transistor,
	b: Transistor,
): SideAssessment {
	const effectGateBaseNode = effectGatingBase(netlist, rails, a, b);
	const ledVote = ledIndicatedOnMember(netlist, a, b);
	if (effectGateBaseNode !== null) {
		const offMember = effectGateBaseNode === a.base ? a : b;
		const onMember = effectGateBaseNode === a.base ? b : a;
		return { onMember, offMember, sideProvenance: "connectivity", ledVote };
	}
	if (ledVote !== null) {
		const onMember = ledVote.member;
		const offMember = ledVote.member.id === a.id ? b : a;
		return { onMember, offMember, sideProvenance: "effect-status-led", ledVote };
	}
	const fallbackBase = Math.min(a.base, b.base) as NodeId;
	const onMember = fallbackBase === a.base ? a : b;
	const offMember = fallbackBase === a.base ? b : a;
	return { onMember, offMember, sideProvenance: "fallback", ledVote };
}

/**
 * The latch member an effect-status LED indicates as ON when engaged, or `null`.
 *
 * One unanimous vote wins: every LED terminal chain that reaches a latch collector
 * names the member lit in the effect state (a cathode-side chain: lit when that
 * collector is LOW, so that member; an anode-side chain: lit when it is HIGH, so
 * the other member), and conflicting or absent votes are no evidence rather than a
 * tie-break. Matching is by the panel record's exact component id (already resolved
 * to terminals by stage 1) and the typed `led` kind it carried — never by name or
 * description text.
 *
 * A chain is a pure series branch between the LED terminal and the collector: every
 * link is a two-terminal resistor or diode, and every interior node joins exactly
 * two device terminals (no branch). The LED device itself is never a link — a walk
 * through it would join the anode side to the cathode side and manufacture a vote
 * for every packet. An anode-side chain of exactly one resistor is not a vote
 * (the shared-supply-plus-loads shape above); a direct anode hit still is.
 */
function ledIndicatedOnMember(
	netlist: LatchNetlist,
	a: Transistor,
	b: Transistor,
): LedVote | null {
	const leds = netlist.effectStatusLeds ?? [];
	const votes: LedVote[] = [];
	for (const led of leds) {
		const chainsTo = (
			terminal: "anode" | "cathode",
			member: Transistor,
		): readonly (readonly string[])[] => {
			const start = terminal === "anode" ? led.anode : led.cathode;
			if (start === member.collector) {
				return [[]];
			}
			return ledSeriesChains(netlist, led.id, start, member.collector);
		};
		for (const member of [a, b] as const) {
			for (const terminal of ["cathode", "anode"] as const) {
				for (const path of chainsTo(terminal, member)) {
					if (terminal === "cathode") {
						votes.push({
							member,
							ledId: led.id,
							polarity:
								path.length === 0
									? "cathode-direct"
									: path.length === 1 && isSingleResistor(netlist, path)
										? "cathode-1R"
										: "cathode-chain",
						});
					} else {
						if (path.length === 1 && isSingleResistor(netlist, path)) {
							continue;
						}
						const other = member.id === a.id ? b : a;
						votes.push({
							member: other,
							ledId: led.id,
							polarity: path.length === 0 ? "anode-direct" : "anode-chain",
						});
					}
				}
			}
		}
	}
	if (votes.length === 0) {
		return null;
	}
	const first = votes[0] as LedVote;
	if (votes.every((vote) => vote.member.id === first.member.id)) {
		return first;
	}
	return null;
}

/** Whether a chain path is a single resistor link. */
function isSingleResistor(
	netlist: Pick<Netlist, "devices">,
	path: readonly string[],
): boolean {
	if (path.length !== 1) {
		return false;
	}
	const link = netlist.devices.find(
		(device) => String(device.id) === path[0],
	);
	return link?.kind === "resistor";
}

/**
 * Series device-id paths from a node to a target over two-terminal resistors and
 * diodes, excluding one device id (the LED being evaluated). Every interior node
 * must join exactly two device terminals across the whole netlist — a branch, a
 * ground return, a transistor terminal or an IC pin on the way disqualifies the
 * run. The start node is an endpoint and exempt; the target is an endpoint and
 * exempt. Revisits are refused, so every walk terminates.
 *
 * Diode orientation is deliberately not checked. The typed diode law cannot tell
 * an undeclared zener from an ordinary diode: `boss-oc-2`'s `D2` is an RD5.1
 * zener sitting in reverse in the CHECK branch, known as a zener only by its part
 * number (which this detector must not read), with `parameters` empty and the
 * plain diode source type. Refusing a reverse diode on absence of evidence would
 * refuse that real branch, and a declared `breakdownVolts` would admit it anyway,
 * so no orientation test can ever block a link. The no-branch, unanimity and
 * precedence rules carry the specificity instead.
 */
function ledSeriesChains(
	netlist: Pick<Netlist, "devices">,
	excludedId: string,
	start: NodeId,
	target: NodeId,
): readonly (readonly string[])[] {
	const adjacency = new Map<NodeId, { readonly to: NodeId; readonly id: string }[]>();
	for (const device of netlist.devices) {
		if (String(device.id) === excludedId) {
			continue;
		}
		if (
			(device.kind !== "resistor" && device.kind !== "diode") ||
			device.nodes.length !== 2
		) {
			continue;
		}
		const from = device.nodes[0];
		const to = device.nodes[1];
		if (from === undefined || to === undefined || from === to) {
			continue;
		}
		for (const [a, b] of [
			[from, to],
			[to, from],
		] as const) {
			const links = adjacency.get(a);
			if (links === undefined) {
				adjacency.set(a, [{ to: b, id: String(device.id) }]);
			} else {
				links.push({ to: b, id: String(device.id) });
			}
		}
	}
	const degree = (node: NodeId): number => {
		let count = 0;
		for (const device of netlist.devices) {
			for (const terminal of device.nodes) {
				if (terminal === node) {
					count += 1;
				}
			}
		}
		return count;
	};
	const out: string[][] = [];
	const walk = (node: NodeId, path: string[], visited: Set<NodeId>): void => {
		for (const link of adjacency.get(node) ?? []) {
			if (visited.has(link.to)) {
				continue;
			}
			// An interior node is a series joint or the walk ends here: anything
			// with more or fewer than two terminals is a branch, not a chain.
			if (link.to !== target && degree(link.to) !== 2) {
				continue;
			}
			if (link.to === target) {
				out.push([...path, link.id]);
				continue;
			}
			visited.add(link.to);
			walk(link.to, [...path, link.id], visited);
			visited.delete(link.to);
		}
	};
	walk(start, [], new Set<NodeId>([start]));
	return out;
}

/** This detector's rail set: ground plus every asserted supply node.
 *
 * This is the structural set, and it is also what decides latch candidacy
 * (requirement 3 below): a collector or base sitting on one of these is supply,
 * not state. It deliberately does NOT include diode-joined nodes — a base with
 * a clamp diode to ground is still a state node (`boss-ds-1`'s `Q4` base, node
 * 37, via `D7`), and promoting it would un-find a real latch. The flood view is
 * `latchFloodRails`.
 */
function detectorRails(netlist: LatchNetlist): Set<NodeId> {
	const rails = new Set<NodeId>([0]);
	for (const device of netlist.devices) {
		if (device.kind === "voltage-source" || device.kind === "rail") {
			for (const node of device.nodes) {
				rails.add(node);
			}
		}
	}
	return rails;
}

/**
 * The rail set the gate-steering floods are blocked at: the structural rails
 * plus every node a single diode joins to one of those.
 *
 * A reverse-polarity protection diode puts the whole board supply one diode from
 * the inlet rail, and the DC flood must treat that node as supply rather than
 * as a route: measured on `boss-oc-2`, node 7 sits behind `D1` (S5500G) off the
 * rail node 60, so both collectors flood through their load resistors (`R22`,
 * `R23`) into node 7, down the bias divider (`R46`) to the 4.5 V node 2, and
 * out to every JFET gate — both sides then "gate the same switches" and the
 * rule refuses a latch whose real gate paths (`Q5` collector → `R28` → `D4` →
 * `Q3` gate; `Q6` collector → `R30` → `D5` → `Q4` gate) are one switch each.
 * Blocking node 7 leaves each collector reaching only its own switch.
 *
 * Two deliberate limits. One hop only: a longer diode string is a signal path
 * (steering, clamping, detection), not supply distribution, and stopping the
 * flood there could hide a real gate. Effect-status indicators excluded: an LED
 * terminates on supply but is a load, not distribution, and its far node can sit
 * inside latch or LED networks rather than on a rail.
 *
 * The candidate not taken is stopping the flood at the shared load-resistor top
 * (a node both collectors reach through one resistor each): on this corpus every
 * such node is already a rail or is diode-joined to one (`boss-oc-2` node 7,
 * `boss-ds-1` node 5, `boss-hm-2` node 71, `boss-mt-2` node 1, the rest already
 * rails), so the diode rule is strictly more general here.
 *
 * This set is flood-blocking only. Candidacy (`candidatePairs`) keeps the
 * structural set: the expansion can mark small-signal clamp nodes — `boss-ds-1`'s
 * `Q4` base (node 37) sits behind its base-ground clamp `D7` — and a clamped
 * state node is still a state node. Blocking such a node in a flood only shrinks
 * reachability (worst case a refusal, the safe direction); promoting it to a
 * rail would un-find the latch outright.
 */
function latchFloodRails(
	netlist: LatchNetlist,
	rails: ReadonlySet<NodeId>,
): Set<NodeId> {
	const flood = new Set<NodeId>(rails);
	const indicators = new Set(
		(netlist.effectStatusLeds ?? []).map((led) => led.id),
	);
	for (const device of netlist.devices) {
		if (device.kind !== "diode" || device.nodes.length !== 2) {
			continue;
		}
		if (indicators.has(device.id)) {
			continue;
		}
		const from = device.nodes[0];
		const to = device.nodes[1];
		if (from === undefined || to === undefined || from === to) {
			continue;
		}
		if (rails.has(from) && !rails.has(to)) {
			flood.add(to);
		} else if (rails.has(to) && !rails.has(from)) {
			flood.add(from);
		}
	}
	return flood;
}

/**
 * Candidate cross-coupled pairs: the four structural requirements (a direct resistor
 * each way, a shared emitter, no rails on collectors or bases, exclusivity), without
 * any side assignment.
 */
function candidatePairs(
	netlist: Pick<Netlist, "devices">,
	rails: ReadonlySet<NodeId>,
): readonly { readonly a: Transistor; readonly b: Transistor }[] {
	const transistors = netlist.devices.flatMap((device) => {
		if (device.kind !== "bjt") {
			return [];
		}
		const collector = terminal(device, "collector");
		const base = terminal(device, "base");
		const emitter = terminal(device, "emitter");
		if (collector === null || base === null || emitter === null) {
			return [];
		}
		// Requirement 3, on the two nodes that carry the state. The emitter is exempt.
		if (rails.has(collector) || rails.has(base)) {
			return [];
		}
		return [{ id: String(device.id), collector, base, emitter }];
	});

	const coupledBetween = (a: NodeId, b: NodeId): boolean =>
		a === b ||
		netlist.devices.some(
			(device) =>
				device.kind === "resistor" &&
				device.nodes.length === 2 &&
				device.nodes.includes(a) &&
				device.nodes.includes(b),
		);

	const pairs: { readonly a: Transistor; readonly b: Transistor }[] = [];
	for (let i = 0; i < transistors.length; i += 1) {
		for (let j = i + 1; j < transistors.length; j += 1) {
			const a = transistors[i];
			const b = transistors[j];
			if (a === undefined || b === undefined) {
				continue;
			}
			if (a.emitter !== b.emitter) {
				continue;
			}
			if (
				!coupledBetween(a.collector, b.base) ||
				!coupledBetween(b.collector, a.base)
			) {
				continue;
			}
			pairs.push({ a, b });
		}
	}

	// Requirement 4. A transistor in two candidate pairs makes all of them ambiguous.
	const appearances = new Map<string, number>();
	for (const pair of pairs) {
		for (const member of [pair.a, pair.b]) {
			appearances.set(member.id, (appearances.get(member.id) ?? 0) + 1);
		}
	}
	return pairs.filter((pair) =>
		[pair.a, pair.b].every((m) => (appearances.get(m.id) ?? 0) <= 1),
	);
}

/**
 * An LED's anode or cathode node by role token, or `null` when the role is absent or
 * repeated. Reads the folded name token first and the declared role second: both are
 * typed terminal statements, and either may carry the `anode`/`cathode` word the
 * source filed.
 */
export function ledTerminalNode(
	device: Device,
	role: "anode" | "cathode",
): NodeId | null {
	const named = device.identity.terminalRoles.flatMap((candidate, index) =>
		candidate === role ? [index] : [],
	);
	if (named.length === 1) {
		const node = device.nodes[named[0] as number];
		return node === undefined ? null : node;
	}
	const declared = device.identity.declaredTerminalRoles.flatMap(
		(candidate, index) => (candidate === role ? [index] : []),
	);
	if (declared.length === 1) {
		const node = device.nodes[declared[0] as number];
		return node === undefined ? null : node;
	}
	return null;
}

export function findLatchSeeds(
	netlist: Netlist,
): readonly OperatingPointSeed[] {
	const latches = findBistableLatches(netlist);
	const seeds: OperatingPointSeed[] = [];
	const seeded = new Set<NodeId>();
	for (const latch of latches) {
		if (seeded.has(latch.onWhenEngagedBase)) {
			continue;
		}
		seeded.add(latch.onWhenEngagedBase);
		seeds.push({ node: latch.onWhenEngagedBase, volts: LATCH_SEED_VOLTS });
	}
	return seeds;
}

type Transistor = {
	readonly id: string;
	readonly collector: NodeId;
	readonly base: NodeId;
	readonly emitter: NodeId;
};

type Edge = { readonly a: NodeId; readonly b: NodeId; readonly id: string };

/**
 * Which member's collector gates the effect FET's gate, or `null` when that is not
 * derivable from connectivity.
 *
 * This is the rule the old spine's `discrete-bypass-latch.ts` paid for, with the
 * polarity corrected: the member found here is **off** when the pedal is engaged, not
 * on. A collector pulled LOW (transistor ON) pulls the FET gate it steers low through
 * the steering diode and turns that FET OFF — so the transistor whose collector
 * carries the effect path must sit HIGH (off) for the effect to conduct, and the seed
 * and the steering stamps belong to the *other* member. The pre-fix code seeded and
 * steered this member instead, which is why the three derived latches in the corpus
 * (`boss-sd-1`, `boss-ce-2`, `boss-dm-2`) rendered bypass at engaged control.
 *
 * Ported from the old spine's `discrete-bypass-latch.ts`, whose rule this repository already
 * paid for: a latch's side is a control fact, and the two questions that decide it are which
 * switches each collector gates, and which of those switch paths carries the audio the user
 * adjusts. Every refusal below is one the old rule names, and returning `null` for all of
 * them is deliberate — an undecidable side must fall back to *a* physical state rather than a
 * confident guess, because being wrong here silently bypasses the pedal.
 *
 * Two edge sets, and the split matters:
 *
 * - **DC edges are resistors and diodes only.** Capacitors are excluded because a bistable's
 *   own cross-coupling capacitors, plus every supply bypass capacitor, would bridge the whole
 *   circuit and make both collectors appear to gate everything.
 * - **Audio edges include capacitors**, since that is how a signal path is coupled, but
 *   exclude the switch channels themselves so a side cannot reach the controls *through* its
 *   counterpart.
 *
 * Both floods are blocked by rails, the same exclusion the rest of this file makes.
 */
function effectGatingBase(
	netlist: Pick<Netlist, "devices">,
	rails: ReadonlySet<NodeId>,
	a: Transistor,
	b: Transistor,
): NodeId | null {
	const dcEdges = edgesOf(netlist, ["resistor", "diode"]);
	const switches = netlist.devices.flatMap((switching) => {
		if (switching.kind !== "jfet" && switching.kind !== "mosfet") {
			return [];
		}
		const gate = terminal(switching, "gate");
		const drain = terminal(switching, "drain");
		return gate === null || drain === null
			? []
			: [{ id: String(switching.id), gate, drain }];
	});

	const gatedBy = (collector: NodeId): readonly string[] => {
		const reached = flood(collector, dcEdges, rails);
		return switches
			.filter((candidate) => reached.has(candidate.gate))
			.map((candidate) => candidate.id)
			.sort();
	};
	const gatedA = gatedBy(a.collector);
	const gatedB = gatedBy(b.collector);
	// Neither side drives a switch: not a switched bypass latch at all. A latch driving only
	// an indicator lands here, correctly.
	if (gatedA.length === 0 && gatedB.length === 0) {
		return null;
	}
	// Both sides gate the same switches, so the sides are indistinguishable.
	if (
		gatedA.length === gatedB.length &&
		gatedA.every((id, index) => id === gatedB[index])
	) {
		return null;
	}

	const switchIds = new Set([...gatedA, ...gatedB]);
	const audioEdges = edgesOf(netlist, [
		"resistor",
		"capacitor",
		"inductor",
		"potentiometer",
	]).filter((edge) => !switchIds.has(edge.id));
	// A control-bound device is one a knob varies, which is a typed field rather than a name.
	const controlNodes = netlist.devices.flatMap((device) =>
		device.control === null ? [] : device.nodes,
	);

	const reachesAControl = (gated: readonly string[]): boolean =>
		gated.some((switchId) => {
			const found = switches.find((candidate) => candidate.id === switchId);
			if (found === undefined) {
				return false;
			}
			const reached = flood(found.drain, audioEdges, rails);
			return controlNodes.some((node) => reached.has(node));
		});

	const gatingA = reachesAControl(gatedA);
	const gatingB = reachesAControl(gatedB);
	if (gatingA === gatingB) {
		return null;
	}
	return gatingA ? a.base : b.base;
}

/** Undirected two-terminal edges of the given kinds; a pot contributes one per terminal pair. */
function edgesOf(
	netlist: Pick<Netlist, "devices">,
	kinds: readonly Device["kind"][],
): readonly Edge[] {
	const wanted = new Set<string>(kinds);
	const edges: Edge[] = [];
	for (const device of netlist.devices) {
		if (!wanted.has(device.kind)) {
			continue;
		}
		for (let i = 0; i < device.nodes.length; i += 1) {
			for (let j = i + 1; j < device.nodes.length; j += 1) {
				const a = device.nodes[i];
				const b = device.nodes[j];
				if (a !== undefined && b !== undefined && a !== b) {
					edges.push({ a, b, id: String(device.id) });
				}
			}
		}
	}
	return edges;
}

/** Reachable nodes, never entering a blocked node. */
function flood(
	start: NodeId,
	edges: readonly Edge[],
	blocked: ReadonlySet<NodeId>,
): ReadonlySet<NodeId> {
	if (blocked.has(start)) {
		return new Set();
	}
	const seen = new Set<NodeId>([start]);
	const queue: NodeId[] = [start];
	while (queue.length > 0) {
		const node = queue.pop() as NodeId;
		for (const edge of edges) {
			const other = edge.a === node ? edge.b : edge.b === node ? edge.a : null;
			if (other === null || seen.has(other) || blocked.has(other)) {
				continue;
			}
			seen.add(other);
			queue.push(other);
		}
	}
	return seen;
}

/** A terminal's node by role token, or `null` when the role is absent or repeated. */
function terminal(device: Device, role: string): NodeId | null {
	const found = device.identity.terminalRoles.flatMap((candidate, index) =>
		candidate === role ? [index] : [],
	);
	if (found.length !== 1) {
		return null;
	}
	const node = device.nodes[found[0] as number];
	return node === undefined ? null : node;
}

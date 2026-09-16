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
 * **Which side, with a floor.** `engagedBase` derives the side that engages the effect from
 * connectivity, and when it cannot, this falls back to the lower base node id — deterministic,
 * meaningless, and still a *physical* state rather than the midpoint. The fallback is the
 * floor, not the intent: a latch nobody can read out is better left latched somewhere than
 * left halfway.
 *
 * What this still does not give is **toggling**. The seed decides where the circuit powers up;
 * it is not an input the control plane can move, so a footswitch cannot change it. That needs
 * the latched-state operator with a state entry — see the runtime plan's S4 initial-state item.
 */
export function findLatchSeeds(
	netlist: Netlist,
): readonly OperatingPointSeed[] {
	const rails = new Set<NodeId>([0]);
	for (const device of netlist.devices) {
		if (device.kind === "voltage-source" || device.kind === "rail") {
			for (const node of device.nodes) {
				rails.add(node);
			}
		}
	}

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

	const seeds: OperatingPointSeed[] = [];
	const seeded = new Set<NodeId>();
	for (const pair of pairs) {
		if (
			[pair.a, pair.b].some((m) => (appearances.get(m.id) ?? 0) > 1)
		) {
			continue;
		}
		// Prefer the side that engages the effect. Falling back to the lower base id keeps a
		// latch this cannot read out of the unphysical midpoint, which is the seed's floor.
		const node =
			engagedBase(netlist, rails, pair.a, pair.b) ??
			(Math.min(pair.a.base, pair.b.base) as NodeId);
		if (seeded.has(node)) {
			continue;
		}
		seeded.add(node);
		seeds.push({ node, volts: LATCH_SEED_VOLTS });
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
 * Which member of the pair is high when the pedal is **engaged**, or `null` when that is not
 * derivable from connectivity.
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
function engagedBase(
	netlist: Netlist,
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

	const engagedA = reachesAControl(gatedA);
	const engagedB = reachesAControl(gatedB);
	if (engagedA === engagedB) {
		return null;
	}
	return engagedA ? a.base : b.base;
}

/** Undirected two-terminal edges of the given kinds; a pot contributes one per terminal pair. */
function edgesOf(
	netlist: Netlist,
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

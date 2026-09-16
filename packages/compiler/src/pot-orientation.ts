// Which end of a potentiometer is the quiet one, split out of `lower.ts` (R7, 2026-09-01).
//
// A pot's law is a track resistance split by its 0..1 position, so lowering needs to know
// which declared end the position counts *from*. `.vdsp` does not state it, so this module
// infers it: a BFS over DC-conducting devices measures each end's distance to ground and to
// an op-amp input, and the closer-to-ground end is the quiet one. That is inference over
// inference, and it exists only because the source format has no field for the answer --
// see R1 in `thoughts/shared/plans/2026-08-31-v2-complexity-reduction-plan.md`.
//
// Moved verbatim: no behavior change, no role added or removed.

import { LoweringError } from "./errors";
import { dcConductingKinds } from "./netlist";
import type { Device, Netlist, NodeId } from "./types";
import { GROUND } from "./types";

/**
 * The one terminal index whose **declared** role is `wiper`, or null when the terminals disagree.
 *
 * Several terminals may declare it and still be unambiguous: `boss-dm-3`'s `VR1` writes
 * `lug1,lug2,lug3,wiper` with `lug2` and `wiper` on one node -- the same physical point named
 * twice -- so what matters is that every `wiper` resolves to the same node, not that only one
 * terminal says so. Two *different* nodes claiming it is a document this stage cannot read.
 */
function declaredWiperIndex(device: Device): number | null {
	const declared = device.identity.declaredTerminalRoles;
	const indices = declared.flatMap((role, index) =>
		role === "wiper" ? [index] : [],
	);
	if (indices.length === 0) {
		return null;
	}
	const nodes = new Set(indices.map((index) => device.nodes[index]));
	return nodes.size === 1 ? (indices[0] ?? null) : null;
}

/**
 * Adjacency among nodes joined by a DC-conducting device -- the closed `dcConductingKinds`
 * vocabulary (resistor, potentiometer, rheostat, inductor, switch, selector) `netlist.ts`'s
 * `voltagePortRails` also uses. Shared by every quiet-distance BFS in this file, computed once
 * per netlist rather than once per seed set: the graph does not change between them.
 */
function dcConductingAdjacency(
	netlist: Netlist,
): ReadonlyMap<NodeId, readonly NodeId[]> {
	const adjacency = new Map<NodeId, NodeId[]>();
	for (const device of netlist.devices) {
		if (!dcConductingKinds.has(device.kind)) {
			continue;
		}
		for (let i = 0; i < device.nodes.length; i += 1) {
			for (let j = i + 1; j < device.nodes.length; j += 1) {
				const a = device.nodes[i] as NodeId;
				const b = device.nodes[j] as NodeId;
				if (a === b) {
					continue;
				}
				adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
				adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
			}
		}
	}
	return adjacency;
}

/**
 * Multi-source BFS over a DC-conducting adjacency graph: every seed starts at distance 0, so the
 * result is each reachable node's distance to its *nearest* seed.
 */
function bfsDistances(
	adjacency: ReadonlyMap<NodeId, readonly NodeId[]>,
	seeds: ReadonlySet<NodeId>,
): ReadonlyMap<NodeId, number> {
	const distance = new Map<NodeId, number>();
	const queue: NodeId[] = [];
	for (const node of seeds) {
		distance.set(node, 0);
		queue.push(node);
	}
	let head = 0;
	while (head < queue.length) {
		const at = queue[head] as NodeId;
		head += 1;
		const atDistance = distance.get(at) as number;
		for (const next of adjacency.get(at) ?? []) {
			if (!distance.has(next)) {
				distance.set(next, atDistance + 1);
				queue.push(next);
			}
		}
	}
	return distance;
}

/**
 * How far each node sits, in hops through DC-conducting devices, from a quiet DC reference --
 * ground, or a supply's own terminal.
 *
 * This is the connectivity evidence a pot's orientation needs, in the same closed vocabulary
 * `netlist.ts`'s `voltagePortRails` already uses to ask a related question ("is this node's
 * potential already generated"): `dcConductingKinds` -- resistor, potentiometer, rheostat,
 * inductor, switch, selector -- conduct a steady current, and nothing else in this set does, so
 * an active device (a transistor, an op-amp, a diode) is never crossed. A quiet reference is
 * ground itself or any terminal of a `voltage-source` or `rail` device -- **not** an op-amp
 * output, which is actively driven with the signal and is the opposite of quiet.
 *
 * Computed once per netlist and passed down, not per pot: `boss-ds-1` alone lowers 82 regions,
 * and the graph does not change between them.
 */
export function quietDistances(netlist: Netlist): ReadonlyMap<NodeId, number> {
	const quietReferences = new Set<NodeId>([GROUND]);
	for (const device of netlist.devices) {
		if (device.kind === "voltage-source" || device.kind === "rail") {
			for (const node of device.nodes) {
				quietReferences.add(node);
			}
		}
	}
	return bfsDistances(dcConductingAdjacency(netlist), quietReferences);
}

/**
 * An op-amp input seeds the quiet-distance BFS this file uses for pot orientation, and it is read
 * from the declared role rather than from a folded terminal name.
 *
 * The name vocabulary this replaced had to be kept in step with
 * `scripts/lib/source-to-spice.ts`, which uses the same seeds for the from-source parity deck: a
 * stale copy there makes the deck disagree with the pipeline about which end of a pot is quiet,
 * and the parity report reads that tool artefact as a source defect. One field, read the same way
 * in both, removes that coupling.
 */
function isOpampInput(role: string | null): boolean {
	return role === "nonInverting" || role === "inverting";
}


/**
 * How far each node sits, in hops through DC-conducting devices, from an op-amp's own input
 * terminal.
 *
 * A second, narrower quiet-reference class than `quietDistances`, kept separate rather than
 * folded into it. An op-amp input under closed-loop negative feedback sits at a virtual
 * reference regardless of the feedback network's own resistances -- a property of the feedback
 * *topology*, not of any one element's value -- so seeding it is not the same evidence-standing-
 * on-itself risk `netlist.ts`'s `generated()` was found to have (there, an op-amp's *output* was
 * treated as an independent reference, which a feedback path can make circular: the output's own
 * potential depends on the input it would be certifying). Measured 2026-08-14 (the rheostat-nine
 * census, `docs/todo-archive/2026-08-14-the-rheostat-nine.md`): applied unconditionally, this
 * evidence moves 24 pots, 15 of them reversing an orientation `quietDistances` alone already
 * decided -- including undoing a same-day correction and overturning a pot where declaration
 * order and connectivity previously agreed unanimously. `potTerminals` below therefore only
 * consults this map when `quietDistances` leaves a pot's two ends **fully unreachable** (both
 * infinite) -- never to override an already-finite decision, even a finite tie. Scoped that way,
 * it moves exactly 6 pots and reverses none.
 */
export function opampInputDistances(
	netlist: Netlist,
): ReadonlyMap<NodeId, number> {
	const seeds = new Set<NodeId>();
	for (const device of netlist.devices) {
		if (device.kind !== "opamp") {
			continue;
		}
		device.identity.declaredTerminalRoles.forEach((role, index) => {
			if (isOpampInput(role)) {
				const node = device.nodes[index];
				if (node !== undefined) {
					seeds.add(node);
				}
			}
		});
	}
	return bfsDistances(dcConductingAdjacency(netlist), seeds);
}

/**
 * Control roles that name a time constant rather than a level.
 *
 * `potTerminals`' quiet-distance rule exists to make a rising control mean "louder", which is
 * the right goal for a gain or volume pot and an empty one for a pot setting an RC. Measured on
 * `boss-nf-1-noise-gate`'s `DECAY`: the two orientations render the *same* output level at both
 * ends of the sweep, so the loudness evidence says nothing and the rule picks arbitrarily -- it
 * picked the side that runs the knob backwards, giving a 240 ms release at full clockwise where
 * the ET-45C service note's ADJUSTMENT block sets DECAY full clockwise for its 1.5-2 s decay.
 *
 * **Why a positive list and not "every rheostat".** Letting declaration order win for all 64 of
 * the corpus's rheostat-shaped pots was measured and is worse: it inverts three knobs that are
 * currently right to fix one that is wrong. `boss-fa-1`'s `VOLUME` goes from 6.4e-7 -> 9.3e-1
 * across its sweep today and 9.3e-1 -> 6.4e-7 under that change, so turning the volume up would
 * mute the pedal; `bk-butler-tube-driver`'s `TUBE_DRIVE` and `boss-od-1`'s `OVER_DRIVE` invert
 * the same way. The quiet-distance rule is load-bearing for those and must keep them.
 *
 * So the exemption is scoped to roles that name a time constant, where "louder" is not what the
 * knob is for. Roles are free text in this corpus and most pots declare none at all -- including
 * `TUBE_DRIVE` and every Marshall tone pot -- so an unrecognised or absent role keeps today's
 * behaviour, which is the safe default.
 */
const TIME_CONSTANT_CONTROL_ROLES: ReadonlySet<string> = new Set([
	"decay",
	"attack",
	"release",
	"time",
	"d.time",
	"r.time",
	"rate",
	"lfo-rate",
	"speed",
	"rise",
	"rise/fall",
]);

function namesATimeConstant(role: string | null | undefined): boolean {
	return role == null
		? false
		: TIME_CONSTANT_CONTROL_ROLES.has(role.trim().toLowerCase());
}

export function potTerminals(
	device: Device,
	quietDistance: ReadonlyMap<NodeId, number>,
	opampInputDistance: ReadonlyMap<NodeId, number>,
	/**
	 * The declared role of the control that varies this pot, when the document states one.
	 * Only consulted for the rheostat exemption below; every other path ignores it, and a
	 * call site that has no role passes `null` and gets today's behaviour exactly.
	 */
	controlRole: string | null = null,
): readonly [number, number, number] {
	// Find the wiper by role, not by sitting in the middle. 81 of the corpus's 331
	// three-terminal pots declare it first or last -- `anode,cathode,wiper` alone is
	// 64 -- and taking position 2 regardless makes whatever is there the wiper. When
	// that is the grounded end, both halves of the track short to ground, the output
	// is cut off from the input, and the pedal renders **exact silence**.
	// **Read from the declared role, and refuse rather than fall back.** This matched a folded
	// terminal *name* against `{wiper, wipe, w}` and took declaration order when nothing matched,
	// which is the silent half of the role-vocabulary problem: a document naming its wiper
	// anything else got position 2 regardless, and nothing said so. Measured across the corpus
	// after the roles were backfilled: 523 of 523 pots reaching this resolve by declared role, 0
	// declare none, 0 are ambiguous -- so the positional path had no remaining legitimate case
	// and is a refusal instead.
	const wiperIndex = declaredWiperIndex(device);
	if (wiperIndex === null) {
		const declared = device.identity.declaredTerminalRoles;
		throw new LoweringError(
			`potentiometer ${device.id} does not identify its wiper: ${
				declared.some((role) => role === "wiper")
					? "several terminals declare `wiper` on different nodes"
					: "no terminal declares `wiper`"
			} (roles [${declared.join(", ")}]) -- and taking the middle terminal instead shorts ` +
				"both halves of the track to whatever sits there, which renders exact silence",
			device.id,
		);
	}
	const ends = device.nodes.filter((_, index) => index !== wiperIndex);
	const wiper = device.nodes[wiperIndex];
	const [declaredFirst, declaredSecond] = ends;
	if (
		declaredFirst === undefined ||
		wiper === undefined ||
		declaredSecond === undefined
	) {
		throw new LoweringError(
			`potentiometer ${device.id} needs three terminals`,
			device.id,
		);
	}
	// The stamps below put `end1`-to-wiper on the side whose share *shrinks* toward the wiper's
	// travel and `end2`-to-wiper on the side whose share *grows* with it (see `lowerRegion`'s
	// `controlled-conductance` case and the runtime's identical `fraction` comment) -- so `end2`
	// has to be the electrically quiet end for a rising control position to mean "louder",
	// which is a fact about the circuit, not about which terminal a schematic happened to list
	// first.
	//
	// Evidence, never declaration order: whichever declared end sits closer to a quiet DC
	// reference (ground, or a supply's own terminal) becomes `end2`. A tie -- both equidistant,
	// including both unreachable -- is not evidence either way, so it falls back to declaration
	// order exactly as before, which is what the corpus's other pots that already work this way
	// (248 of them, before this change) rely on unchanged.
	// A rheostat -- wiper strapped to one of its own ends -- has no divider to orient, and when
	// its control names a time constant the quiet-distance rule below has no loudness signal to
	// read. Which declared end the wiper is strapped to is then the only evidence there is, so
	// declaration order wins here and nowhere else. See `TIME_CONSTANT_CONTROL_ROLES`.
	if (
		(wiper === declaredFirst || wiper === declaredSecond) &&
		namesATimeConstant(controlRole)
	) {
		return [declaredFirst, wiper, declaredSecond];
	}
	const firstDistance =
		quietDistance.get(declaredFirst) ?? Number.POSITIVE_INFINITY;
	const secondDistance =
		quietDistance.get(declaredSecond) ?? Number.POSITIVE_INFINITY;
	if (Number.isFinite(firstDistance) || Number.isFinite(secondDistance)) {
		if (firstDistance < secondDistance) {
			return [declaredSecond, wiper, declaredFirst];
		}
		if (secondDistance < firstDistance) {
			return [declaredFirst, wiper, declaredSecond];
		}
		// A finite tie (both ends the same non-infinite distance, e.g. `boss-ph-1r`'s `VR2` at
		// 3/3) is still real evidence that *something* about the graph already reaches both ends
		// equally -- narrower and more reliable than "nothing reaches either", so it is left on
		// declaration order rather than handed to the op-amp-input fallback below, which is
		// scoped to the fully-unreachable case only.
		return [declaredFirst, wiper, declaredSecond];
	}
	// Both ends fully unreachable from ground/rail: `quietDistances` has made no claim at all
	// about this pot. Op-amp-input evidence is trustworthy here only for a pot that is *also*
	// structurally wired as a rheostat -- its wiper coincident with one of its own ends
	// (`boss-fa-1`'s `VR1` shape), or the wiper declared at the quiet reference itself
	// (`boss-hm-2`'s `VR4_DIST` shape) -- the same working detector the 2026-08-14 rheostat-nine
	// census validated. An ordinary three-terminal divider that merely floats in a DC-isolated
	// pocket for unrelated reasons (a real, separate wiper node, no rheostat shape at all) does
	// not get this evidence: measured against `jhs-morning-glory`'s `Drive` (exactly this
	// ordinary-divider shape, not wiper-coincident), letting it through moved the pot's own
	// already-marginal Newton operating point from a bounded reading at one end of its travel to
	// a diverging one (peak ~8e3 against a 0.1 V input) at the other -- a measured regression,
	// not a structural inference, and the reason this gate exists rather than trusting "both
	// ends unreachable" alone.
	const wiperIsRheostatShaped =
		wiper === declaredFirst ||
		wiper === declaredSecond ||
		quietDistance.get(wiper) === 0;
	if (!wiperIsRheostatShaped) {
		return [declaredFirst, wiper, declaredSecond];
	}
	const firstOpampDistance =
		opampInputDistance.get(declaredFirst) ?? Number.POSITIVE_INFINITY;
	const secondOpampDistance =
		opampInputDistance.get(declaredSecond) ?? Number.POSITIVE_INFINITY;
	if (firstOpampDistance < secondOpampDistance) {
		return [declaredSecond, wiper, declaredFirst];
	}
	if (secondOpampDistance < firstOpampDistance) {
		return [declaredFirst, wiper, declaredSecond];
	}
	return [declaredFirst, wiper, declaredSecond];
}


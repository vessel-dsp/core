// Which end of a potentiometer is the quiet one, split out of `lower.ts` (R7, 2026-09-01).
//
// A pot's law is a track resistance split by its 0..1 position, so lowering needs to know
// which declared end the position counts *from*.
//
// **The format CAN state it, and since 2026-09-22 the declaration is read first.**
// `@vessel-dsp/core` owns `PotentiometerTerminalRole = ccw | wiper | cw` -- rotation, not
// position, so it survives mirroring -- and its resolver refuses rather than guessing, saying
// of an incomplete one: *"the source does not carry the sweep direction. Do not infer it."*
// This module inferred it for every pot regardless, including the 15 in the corpus that
// declare both ends, and disagreed with 4 of them. See `declaredEnds`.
//
// The inference remains, because 348 of the corpus's 363 pots declare `end` -- core's
// deliberately ambiguous token -- and something has to orient them: a BFS over DC-conducting
// devices measures each end's distance to ground and to an op-amp input, and the closer-to-
// ground end is the quiet one. That is inference over inference, and every one of those 348 is
// a packet backfill waiting to retire a branch of it -- see R1 in
// `thoughts/shared/plans/archive/2026-08-31-v2-complexity-reduction-plan.md`.

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
 * The two nodes a device declares as its `ccw` and `cw` ends, or null when it does not say.
 *
 * **`@vessel-dsp/core` owns this vocabulary and everything below is the guess it replaces.**
 * `PotentiometerTerminalRole` is `ccw | wiper | cw`, rotation and not position, so it survives
 * mirroring and board rotation; the resolver refuses rather than completes, and its own doc
 * comment says of an incomplete resolution: *"False means the source does not carry the sweep
 * direction. Do not infer it."* Inferring it is exactly what this file did, for every pot,
 * including the ones that said.
 *
 * Measured over the corpus 2026-09-22: **363 pots, 15 declare both ends, 348 declare
 * `end`** -- core's ambiguous token, which resolves to no role by design. So the quiet-distance
 * inference below is still what almost every pot gets, and that is the *second* half of the
 * typed-source-evidence test: the source can state the fact and does not, which makes those 348
 * a packet backfill in `vessel-dsp/artifacts` rather than anything to fix here.
 *
 * On the 15 that do declare, the inference **agreed on 11 and disagreed on 4** --
 * `electro-harmonix-frequency-analyzer`'s `P1_BLEND` and `P2_FINE_TUNE`, and
 * `moogerfooger-mf-102`'s `P1` and `VR2`. Those four knobs swept backwards, and the packets had
 * said so all along. A conflict is resolved in favour of the declaration, because the
 * alternative is this repository overruling a typed source fact with a circuit guess.
 *
 * Both ends must resolve to one node each and the two must differ; anything else is not a
 * declaration this stage can read, and falls through to the inference.
 */
function declaredEnds(device: Device): readonly [NodeId, NodeId] | null {
	const declared = device.identity.declaredTerminalRoles;
	const nodesFor = (role: string): ReadonlySet<NodeId> =>
		new Set(
			declared.flatMap((declaredRole, index) =>
				declaredRole === role ? [device.nodes[index] as NodeId] : [],
			),
		);
	const ccw = nodesFor("ccw");
	const cw = nodesFor("cw");
	if (ccw.size !== 1 || cw.size !== 1) {
		return null;
	}
	const [ccwNode] = [...ccw];
	const [cwNode] = [...cw];
	if (ccwNode === undefined || cwNode === undefined || ccwNode === cwNode) {
		return null;
	}
	return [ccwNode, cwNode];
}

/**
 * Adjacency among nodes joined by a DC-conducting device -- the closed `dcConductingKinds`
 * vocabulary (resistor, potentiometer, rheostat, inductor, switch, selector) `netlist.ts`'s
 * `voltagePortRails` also uses. Shared by every quiet-distance BFS in this file, computed once
 * per netlist rather than once per seed set: the graph does not change between them.
 */
function dcConductingAdjacency(
	netlist: Netlist,
	/**
	 * Kinds to conduct in addition to `dcConductingKinds`. Empty by default (pure DC graph,
	 * the behaviour every existing caller relies on); a caller asking an AC-connectivity
	 * question passes the kinds it wants added, e.g. `"capacitor"`.
	 */
	extraKinds: ReadonlySet<string> = new Set(),
): ReadonlyMap<NodeId, readonly NodeId[]> {
	const conducts = (kind: string): boolean =>
		dcConductingKinds.has(kind) || extraKinds.has(kind);
	const adjacency = new Map<NodeId, NodeId[]>();
	for (const device of netlist.devices) {
		if (!conducts(device.kind)) {
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
 * How far each node sits, in hops through DC-conducting devices, from an op-amp's declared
 * **output** terminal.
 *
 * The companion of `opampInputDistances` for the negative-feedback gain-stage class: a rheostat
 * wired from an op-amp's declared output, through its track, to the same op-amp's declared
 * inverting input is a gain-setting feedback element, and for that class a rising control must
 * mean *more* feedback resistance (non-inverting gain is `1 + Rf/Rg`, so more `Rf` is more
 * gain). `boss-os-2`'s `DRIVE` sits exactly there on both its 270 k sections: the wiper shares
 * its node with the `output` terminal, the free end reaches the `inverting` terminal through a
 * single series resistor, and the whole pocket is DC-isolated from ground, so
 * `quietDistances` has no claim and the `opampInputDistances` tie above falls through to
 * declaration order -- which oriented `VR3b` so its live resistance *fell* as the knob rose,
 * running the pedal's Drive backwards (rendered: 6.3e-1 rms at 0.0 against 2.9e-1 at 1.0).
 * The output-side distance below is the discriminating typed fact: which end the wiper is
 * strapped to relative to the declared `output` role, not how close either end happens to sit
 * to an input.
 */
export function opampOutputDistances(
	netlist: Netlist,
): ReadonlyMap<NodeId, number> {
	const seeds = new Set<NodeId>();
	for (const device of netlist.devices) {
		if (device.kind !== "opamp") {
			continue;
		}
		device.identity.declaredTerminalRoles.forEach((role, index) => {
			if (role === "output") {
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
 * The set of nodes that are a declared op-amp **inverting** input, read from the declared
 * `inverting` role rather than a folded terminal name (the same closed-vocabulary read
 * `opampInputDistances` uses for its seeds, narrowed to the inverting half).
 *
 * Kept as a node set, not a distance map, because the one consumer below asks a yes/no
 * question -- "does this pot's wiper sit on an inverting input?" -- not "how far is it from
 * one". `opampInputDistances` cannot answer that: it seeds from *both* input roles, so a zero
 * there does not say which input a node sits on.
 */
export function opampInvertingInputNodes(
	netlist: Netlist,
): ReadonlySet<NodeId> {
	const nodes = new Set<NodeId>();
	for (const device of netlist.devices) {
		if (device.kind !== "opamp") {
			continue;
		}
		device.identity.declaredTerminalRoles.forEach((role, index) => {
			if (role === "inverting") {
				const node = device.nodes[index];
				if (node !== undefined) {
					nodes.add(node);
				}
			}
		});
	}
	return nodes;
}

/**
 * How far each node sits, in hops through the **AC** graph (DC-conducting devices *plus*
 * capacitors), from an op-amp's declared output terminal.
 *
 * The companion of `opampOutputDistances` for the one shape it cannot reach: a non-inverting
 * gain pot whose wiper sits *on* the op-amp's declared inverting input. For that class the wiper
 * is the DC hub -- both track ends reach ground, the inverting input, and the output through the
 * wiper in exactly the same number of DC hops -- so every DC distance map this file has is a
 * tie and is silent about which end the live half is. Capacitors are the one passive element
 * that separates the two ends in that shape (the output couples to one end, ground to the
 * other), so the discrimination has to follow them. `boss-ds-1`'s `VR1` is the corpus's sole
 * instance: its two ends are a 2/2 DC-quiet tie, the wiper is on the inverting input, and
 * only `AC` separates the output-coupled end (one cap, `C6`, from the output) from the
 * ground-coupled end.
 *
 * Computed over the AC graph on purpose, not by adding a capacitor-aware variant to the DC
 * maps: the DC maps are a validated "moves exactly 6 pots, reverses none" instrument and must
 * stay DC, and folding a capacitor into them would change what every existing caller reads.
 */
export function opampOutputAcDistances(
	netlist: Netlist,
): ReadonlyMap<NodeId, number> {
	const seeds = new Set<NodeId>();
	for (const device of netlist.devices) {
		if (device.kind !== "opamp") {
			continue;
		}
		device.identity.declaredTerminalRoles.forEach((role, index) => {
			if (role === "output") {
				const node = device.nodes[index];
				if (node !== undefined) {
					seeds.add(node);
				}
			}
		});
	}
	return bfsDistances(dcConductingAdjacency(netlist, new Set(["capacitor"])), seeds);
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
	 * Distance to an op-amp's declared output terminal, for the negative-feedback
	 * gain-stage tie below. Empty by default: a call site that has no netlist in hand
	 * (the inert-control and operating-point screens) passes nothing and gets today's
	 * behaviour exactly, as with the other two maps.
	 */
	opampOutputDistance: ReadonlyMap<NodeId, number> = new Map(),
	/**
	 * The declared role of the control that varies this pot, when the document states one.
	 * Only consulted for the rheostat exemption below; every other path ignores it, and a
	 * call site that has no role passes `null` and gets today's behaviour exactly.
	 */
	controlRole: string | null = null,
	/**
	 * Nodes that are a declared op-amp inverting input, for the negative-feedback gain-pot
	 * tie below. Empty by default: a call site with no netlist in hand (the inert-control and
	 * operating-point screens) passes nothing and gets today's behaviour exactly, as with the
	 * other evidence maps.
	 */
	invertingInputNodes: ReadonlySet<NodeId> = new Set(),
	/**
	 * AC distance (DC + capacitors) to an op-amp's declared output, for the same gain-pot
	 * tie. Empty by default for the same reason.
	 */
	acOutputDistance: ReadonlyMap<NodeId, number> = new Map(),
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
	// **A declaration outranks every inference below.** `end2` is the end the wiper sits at when
	// the control reads 0 -- it takes the `lower` stamp, whose share is `fraction` itself, so its
	// half collapses to the residual at position 0 -- and position 0 is the shaft fully
	// counter-clockwise. So `end2` is the `ccw` lug whenever the document names it, and nothing
	// after this point is consulted. See `declaredEnds`.
	//
	// **Including a rheostat**, whose wiper is strapped to one of its own declared ends. That
	// shape has no divider and the existing fallback for it reads the *control's* free-text role
	// against a spelling table (`TIME_CONSTANT_CONTROL_ROLES`), which is prose matching on the
	// lowering spine. A declared rotation is the typed fact that table stands in for, so it wins
	// here too, and the arithmetic comes out right either way: with the wiper on `cw`, `end2` is
	// `ccw` and the live half takes `share = fraction`, so its resistance grows as the shaft
	// turns clockwise; with the wiper on `ccw`, the live half is `end1`'s and takes
	// `1 - fraction`, and it shrinks. Both are what the shaft does.
	// `electro-harmonix-frequency-analyzer`'s `P2_FINE_TUNE` and `moogerfooger-mf-102`'s `P1`
	// are the corpus's two, and both ran backwards under the inference.
	const declaredRotation = declaredEnds(device);
	if (declaredRotation !== null) {
		const [ccwNode, cwNode] = declaredRotation;
		return [cwNode, wiper, ccwNode];
	}
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
		//
		// One exception, and only one: a non-inverting gain pot whose wiper sits on the op-amp's
		// declared inverting input. For that shape the wiper is the DC hub, so the quiet, input,
		// and output DC distances all tie exactly as here, and every DC map this file has is
		// silent about which end the live half is -- declaration order decides, and it orients
		// the live half backwards when the schematic lists the output-coupled end first.
		// `boss-ds-1`'s `VR1` is the corpus's sole instance: rendered 3.0e-2 rms at 0.0 against
		// 1.9e-2 at 1.0, its Drive running backwards. The one typed fact that separates the two
		// ends there is AC connectivity -- the output couples (through a capacitor) to one end,
		// ground to the other -- so when the wiper is on a declared inverting input and the ends
		// differ in AC output distance, the end nearer the output becomes `end2`: its live half
		// is the `lower` stamp (`share = fraction`), so a rising control adds feedback resistance
		// (non-inverting gain is `1 + Rf/Rg`) and means more gain. A plain tie with no such
		// discrimination stays on declaration order, as before; a tie where the wiper is not on
		// an inverting input is left alone here and falls to its own existing evidence.
		if (invertingInputNodes.has(wiper)) {
			const acFirst =
				acOutputDistance.get(declaredFirst) ?? Number.POSITIVE_INFINITY;
			const acSecond =
				acOutputDistance.get(declaredSecond) ?? Number.POSITIVE_INFINITY;
			if (acFirst < acSecond) {
				return [declaredSecond, wiper, declaredFirst];
			}
			if (acSecond < acFirst) {
				return [declaredFirst, wiper, declaredSecond];
			}
		}
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
	// The input distances tie, so the nearest-input evidence is silent about which end is
	// quiet, and what used to be left was declaration order. Before falling back to it, ask
	// the one typed fact the format does state for the negative-feedback gain-stage class:
	// a rheostat whose wiper is strapped to the end sitting on an op-amp's declared
	// **output**, with the free end reaching that op-amp's declared **inverting** input, is
	// a gain-setting feedback element (non-inverting gain is `1 + Rf/Rg`), and for that
	// class a rising control must mean *more* feedback resistance -- so the live half has
	// to be the `lower` stamp, `share = fraction`. Declaration order got this backwards for
	// `boss-os-2`'s `VR3b` (wiper strapped to the `output` node, `inverting` one hop away
	// through R22): its live half landed on `upper`, where `share = 1 - fraction`, so the
	// pedal's Drive ran backwards -- 6.3e-1 rms at 0.0 against 2.9e-1 at 1.0 -- while its
	// gang twin `VR3a`, decided by `quietDistances` above, was already right.
	//
	// Scoped to the tie on purpose, like the input-distance evidence it guards: the
	// asymmetric case above is the validated "moves exactly 6 pots and reverses none"
	// evidence, and this rule does not override a finite decision it already made. The
	// asymmetry guards (`outEout < outEfree`, `inEfree <= inEout`) keep the class narrow:
	// the wiper-strapped end must be the one nearer a declared output, and the free end at
	// least as near a declared inverting input. Both distances read declared roles and
	// connectivity only; nothing here reads a name.
	if (wiper === declaredFirst || wiper === declaredSecond) {
		const outputEnd = wiper === declaredFirst ? declaredFirst : declaredSecond;
		const freeEnd = wiper === declaredFirst ? declaredSecond : declaredFirst;
		if (outputEnd !== freeEnd) {
			const outEout =
				opampOutputDistance.get(outputEnd) ?? Number.POSITIVE_INFINITY;
			const outFree =
				opampOutputDistance.get(freeEnd) ?? Number.POSITIVE_INFINITY;
			const inFree =
				opampInputDistance.get(freeEnd) ?? Number.POSITIVE_INFINITY;
			const inEout =
				opampInputDistance.get(outputEnd) ?? Number.POSITIVE_INFINITY;
			if (
				Number.isFinite(outEout) &&
				outEout < outFree &&
				Number.isFinite(inFree) &&
				inFree <= inEout
			) {
				return [outputEnd, wiper, freeEnd];
			}
		}
	}
	return [declaredFirst, wiper, declaredSecond];
}


// Transformer winding resolution, split out of `lower.ts` (R7, 2026-09-01).
//
// This is winding work, not MNA work: the stamps a transformer contributes are two lines in
// `lowerRegion`, and everything here exists to answer which declared coil drives, which is
// coupled, and which end is unpaired.
//
// Until 2026-09-03 it also had to answer *which terminals form a coil*, from a 110-entry table
// keyed on folded terminal spellings that grew one packet at a time. `@vessel-dsp/core@0.6.35`
// makes the coil grouping a declaration (`windings`) and the corpus declares it, so the table is
// gone and `transformerWindings` reads. R1 in
// `thoughts/shared/plans/2026-08-31-v2-complexity-reduction-plan.md` is the plan this closes.

import { LoweringError } from "./errors";
import { GROUND, type Device, type DeviceLaw, type NodeId } from "./types";

/**
 * How many `(device, terminal)` references touch each node across the whole netlist.
 *
 * Existence evidence, not a corpus-wide cost: `transformerWindings` is the only reader, and
 * only when its own terminal grouping turns up a winding with a single, unpaired end. A node
 * this stage never asks about -- ground, or any node two ordinary components share -- costs
 * nothing extra to have counted.
 */
export function nodeOccurrenceCounts(devices: readonly Device[]): Map<NodeId, number> {
	const counts = new Map<NodeId, number>();
	for (const device of devices) {
		for (const node of device.nodes) {
			counts.set(node, (counts.get(node) ?? 0) + 1);
		}
	}
	return counts;
}

/**
 * A transformer's windings, as coupled pairs against its primary.
 *
 * **Positional order was silently wrong on 45 of the corpus's 55 transformers.** This read
 * `device.nodes` as exactly `[primary+, primary-, secondary+, secondary-]` and dropped every
 * terminal past the fourth without a word. Only 10 transformers have four terminals; the rest
 * have five to thirteen. `tycobrahe-octavia` is the compiled case: its `T1` is
 * `[primarya, primaryb, secondarya, secondaryct, secondaryb, shieldnc]`, so the old reading
 * coupled `(secondarya, secondaryct)` — **half the secondary** — and left `secondaryb` driven by
 * nothing. Since `secondarya` and `secondaryb` each feed a diode anode with the centre tap
 * grounded, that is a full-wave rectifier reduced to half-wave, which is the difference between
 * an octave-up pedal and a fuzz.
 *
 * Grouping is by **terminal-role token compared whole** against the closed table below, never by
 * substring or by position. A role this table does not name is a refusal rather than a guess: a
 * winding assembled from tokens nobody has checked would silently couple the wrong pair, which is
 * the failure this replaces.
 *
 * A centre tap splits its winding into two halves in series. Each half carries half the turns, so
 * its primary-to-half ratio is **twice** the declared one — the declared `Ratio` is read as
 * primary-to-*full*-winding, which is the conventional statement for a tapped secondary and is
 * documented here because the source cannot say which it meant.
 *
 * **One declared ratio is applied to every secondary.** `declaredRatio` is exact for a single
 * secondary, tapped or not, whose halves genuinely share a ratio -- which is every transformer
 * that reaches the coupled path, because a ratio is only ever derived for a transformer whose
 * primary carries signal.
 *
 * ## Driven windings: a power transformer needs no primary
 *
 * **A transformer the source specifies by its winding voltages is lowered as one `ac-source` per
 * winding, and its primary is not modelled at all.** Decided 2026-08-14 after measuring the amp
 * corpus; `netlist.ts`'s `transformerWindingVolts` carries the argument for why the primary side
 * is not needed and this function is where that is executed.
 *
 * The physics: the B+ rail comes from the HV secondary through the rectifier and the filter
 * network, and a cap-input rectifier's behaviour is fixed by the secondary RMS, the rectifier
 * drop and the load. The primary is the mains side, and nothing downstream of it is audio. So a
 * winding whose own RMS the source states can be driven directly, and the mains number the
 * previous formulation demanded -- unstateable for the multi-tap primaries this corpus is full of
 * -- drops out.
 *
 * **What this models that the coupled form did not.** `vox-ac15-top-boost` declares no supply
 * component at all: under the coupled form its power transformer's primary would be driven by
 * nothing and its B+ would solve to zero, a wrong answer that renders. A driven winding asserts
 * the voltage the source states regardless of what the mains side of the document contains.
 *
 * **What this does not model, plainly.** A real transformer sags: winding resistance, leakage
 * inductance and core loss make B+ fall as the power tubes draw, and that sag is part of how an
 * amp sounds. **No source in this corpus states any of those**, so none of them is modelled and
 * none is guessed. The series impedance is `SUPPLY_SOURCE_OHMS`, the repository's existing
 * one-ohm default for every supply, carried on the law -- it is there so an ideal source cannot
 * deliver unbounded current into a rectifier, and it is **not** a winding resistance: a real HV
 * winding is tens to hundreds of ohms. Read a B+ from this model as the no-load rail. Likewise
 * there is no cross-winding coupling (loading the HV winding does not disturb the heaters) and
 * nothing on the mains side can switch the amp off any more, because there is no longer a path
 * from the mains inlet to the secondaries; the standby switch, which sits after the rectifier,
 * is unaffected.
 *
 * **The centre tap is two sources about the tap, not one across the winding.** A `370-0-370`
 * winding with the tap grounded gets `V(a) - V(tap) = E` and `V(tap) - V(b) = E`, so `a` and `b`
 * swing in antiphase about the tap at 370 V RMS each -- which is what makes the full-wave
 * rectifier downstream full-wave. One 740 V source across `a`-`b` would leave the tap
 * undetermined and the rectifier fed wrongly. The pairing is the same one the coupled form
 * already uses, and the stated voltage is per half by the corpus's own convention, so it is
 * applied to each half directly and never doubled.
 *
 * **Every winding must have a voltage if any does.** A transformer on this path has no ratio to
 * fall back on by construction, so a winding with no typed voltage is refused by name rather than
 * silently dropped or defaulted -- `fender-bassman` and `marshall-jtm45` both state their
 * rectifier-heater winding only as prose ("assumed from GZ34 heater, unprinted on selected
 * schematic"), and that is a source gap to report, not a number to invent.
 *
 * **A tapped primary swaps which winding is the shared reference, added 2026-08-14.** Three
 * amp output transformers (`fender-5e3-deluxe-tweed`, `marshall-jtm45`, `vox-ac30-top-boost`)
 * declare a **centre-tapped primary** -- the ordinary push-pull shape, plate-to-plate with the
 * centre tap at B+ -- which the original code refused outright: "no single reference winding".
 * That refusal is still correct for a primary tapped *and* carrying no other complete winding to
 * pivot on, but a push-pull output transformer always has one: the secondary. Every winding on
 * one core shares the same volts-per-turn, so if `declaredRatio = Vprimary_full / Vsecondary_full`
 * (exactly what the impedance-pair rung above already derives), then for a centre tap splitting
 * the primary into two equal halves:
 *
 *   V(half) = V(primary_full) / 2
 *   V(secondary_full) = V(primary_full) / declaredRatio = (2 * V(half)) / declaredRatio
 *   =>  V(secondary_full) = (2 / declaredRatio) * V(half)
 *
 * So stamping the secondary as the shared reference and each primary half as a winding coupled
 * to it needs `2 / declaredRatio` per half -- applied directly, not doubled again. Verified
 * against `fender-5e3-deluxe-tweed`'s own numbers: `declaredRatio = sqrt(8000/8) ≈ 31.62`,
 * swapped ratio `2/31.62 ≈ 0.0632`, and `0.0632 * 15.81 = 1` confirms the round trip
 * (`1/0.0632 ≈ 15.81 = declaredRatio/2`, the per-half ratio the un-swapped direction would have
 * used).
 *
 * The swap needs **exactly one** other complete, untapped winding to pivot on; zero or several is
 * refused rather than guessed. It cannot arise on the driven path, which models no primary.
 *
 * **A winding with only one declared end is dropped if connectivity says it is dangling, and
 * refused by name otherwise -- also 2026-08-14.** `vox-ac30-top-boost`'s output transformer
 * declares a `secondary_8` terminal beside its typed, wired `secondary_16` -- "8 Ω alternate
 * source-visible tap" in the source's own words, a second impedance tap on the same core with no
 * companion end of its own. Its node touches no other component anywhere in the document (checked
 * against `nodeOccurrenceCounts`, connectivity rather than a spelling), so nothing this stage
 * could stamp for it would change the solved circuit, and it is dropped exactly as `shieldnc`
 * already is. This is deliberately **not** a blanket rule for the `secondary8`/`secondary_8`
 * spelling: a future packet that actually wires an alternate tap to a load has a node other
 * components touch, and that packet refuses by name instead -- a real multi-tap secondary in use
 * is a different device law this stage does not have, not a winding to silently drop.
 */
export type LoweredWinding =
	| {
			readonly kind: "coupled";
			readonly primaryPlus: number;
			readonly primaryMinus: number;
			readonly plus: number;
			readonly minus: number;
			readonly turnsRatio: number;
	  }
	| {
			readonly kind: "driven";
			readonly plus: number;
			readonly minus: number;
			readonly amplitudeVolts: number;
			readonly frequencyHz: number;
			readonly sourceOhms: number;
	  };

/**
 * Nodes where a transformer meets a **selector switch** and nothing else.
 *
 * Connectivity, never a spelling: a node qualifies when the devices touching it are one
 * transformer and one or more plain `switch`es, with no third kind. An output transformer's
 * impedance selector is exactly that shape -- `hiwatt-dr103`'s `SW_IMPEDANCE_SELECTOR` has one
 * `common` and three throws, each throw sharing a node with one secondary tap of
 * `T_OUTPUT_TH7549_2`.
 *
 * **`switch` and not `selector`, deliberately, and this is the whole boundary of this rule.** This
 * repository already models a real 1-of-N selector as its own device kind: `selector` stamps every
 * throw of every pole and lets a control decide which conducts, resolving its position from a
 * declared `Options:` list against `Position:`. That is the right answer for an ohms selector -- it
 * makes the taps *switchable*, so the reflected load changes with the selection, which is the half
 * that matters for power-stage distortion.
 *
 * These two packets do not reach it: they declare `kind: switch` with a `SelectedState: 16 ohms`
 * property rather than the `Options`/`Position` pair the classifier reads. So this rule is the
 * narrow, exact thing that can be said meanwhile -- an unselected throw is open, and an open
 * secondary contributes nothing -- and it **stops applying by construction** the moment a packet
 * declares its selector properly, because a `selector` is not a `switch` and this predicate counts
 * only the latter. It cannot defeat the better model; it is superseded by it.
 */
export function selectorTapNodes(devices: readonly Device[]): ReadonlySet<NodeId> {
	const kinds = new Map<
		NodeId,
		{ transformers: number; switches: number; others: number }
	>();
	for (const device of devices) {
		for (const node of new Set(device.nodes)) {
			const entry = kinds.get(node) ?? {
				transformers: 0,
				switches: 0,
				others: 0,
			};
			if (device.kind === "transformer") {
				entry.transformers += 1;
			} else if (device.kind === "switch") {
				entry.switches += 1;
			} else {
				entry.others += 1;
			}
			kinds.set(node, entry);
		}
	}
	const taps = new Set<NodeId>();
	for (const [node, entry] of kinds) {
		if (entry.transformers === 1 && entry.switches >= 1 && entry.others === 0) {
			taps.add(node);
		}
	}
	return taps;
}

/**
 * The coils this transformer declares, reduced to the pairs of nodes a stamp needs.
 *
 * **Read, not reconstructed.** Until `@vessel-dsp/core@0.6.35` a transformer's terminals gave no
 * statement of which coil each belonged to, so this stage grouped them with a 110-entry table
 * keyed on folded terminal spellings -- `primaryplus`, `hvreda345vac`, `powertubeheatercenter0v`.
 * That table covered the corpus because it was written from the corpus, one packet at a time, and
 * a transformer nobody had transcribed yet arrived as a refusal naming a winding class instead of
 * the real fault, which was that the document never said what its coils were.
 *
 * Everything the table encoded beyond the grouping stays where it was:
 *
 * - **`end: a|b|tap` is coil order plus each terminal's own role.** The ends are the terminals
 *   whose declared role is `winding`; a `windingTap` sits physically where the list puts it.
 * - **`end: unconnected` was never winding structure.** A tap the document wires to nothing is a
 *   connectivity fact, read from `terminalOccurrences` below exactly as before.
 * - **`end: selectable` likewise.** Which mains tap is live is a property of the selector switch,
 *   and the refusal below still names that switch rather than the transformer.
 */
export function transformerWindings(
	device: Device,
	law: Extract<DeviceLaw, { kind: "transformer" }>,
	terminalOccurrences: ReadonlyMap<NodeId, number>,
	selectorTaps: ReadonlySet<NodeId>,
): readonly LoweredWinding[] {
	const declared = device.identity.declaredWindings;
	if (declared === null) {
		throw new LoweringError(
			`transformer ${device.id} declares no windings, so which of its terminals form each ` +
				"coupled coil is unstated -- a coil grouping is a fact about the transformer that " +
				"this stage reads from the document and will not infer from terminal spellings",
			device.id,
		);
	}

	const groups = new Map<string, WindingGroup>();
	for (const [index, winding] of declared.entries()) {
		const nodes = winding.terminalIndices.flatMap((terminal) => {
			const node = device.nodes[terminal];
			return node === undefined ? [] : [node];
		});
		if (nodes.length === 0) {
			continue;
		}
		const key = windingKey(winding.role, winding.id, groups);
		const centerTap =
			winding.centerTapAt === null ? undefined : nodes[winding.centerTapAt];
		// Ratings arrive as terminal indices; the reduction and the stamps work in nodes.
		const ratedOhms = new Map<NodeId, number>();
		for (const rating of winding.impedances) {
			const [from, to] = rating.across;
			const ends = [device.nodes[from], device.nodes[to]].filter(
				(node): node is NodeId => node !== undefined,
			);
			// A rating names the pair it spans, and the reference end of that pair is shared by
			// every rating on the coil. What a stamp needs is the *other* end -- the tap -- so
			// the rating is keyed by whichever node is not the coil's reference.
			const reference = centerTap ?? (nodes[0] as NodeId);
			const tap = ends.find((node) => node !== reference) ?? ends[0];
			if (tap !== undefined) {
				ratedOhms.set(tap, rating.ohms);
			}
		}
		groups.set(key, {
			role: winding.role,
			a: nodes[0] as NodeId,
			b: nodes.length > 1 ? (nodes[nodes.length - 1] as NodeId) : undefined,
			centerTap,
			// An output tap is an alternative the coil is not simultaneously live at, so the
			// reference tap is not one of them.
			taps: nodes.slice(1, -1).filter((node) => node !== centerTap),
			amplitudeVolts: law.windingAmplitudeVolts[index] ?? null,
			ratedOhms,
		});
	}

	// A coil brought out as several taps needs to be reduced to the pair a stamp can hold, and
	// which pair that is comes from connectivity: the tap something else in the document touches
	// is the live one, and an open tap on an ideal transformer carries no current and reflects
	// nothing, which makes dropping it exact rather than an approximation.
	//
	// The reduction pivots the coil onto the live tap: that tap becomes one end and the coil's
	// other end -- the common -- stays the return. This is what the old table wrote by hand as
	// `secondary16white: end "a"` against `secondarycommonblack: end "b"`, and what its
	// `secondaryalt3`/`secondaryalt2` promotion loop then had to re-derive by preferring 16 over 8
	// over 4 by spelling.
	for (const [name, group] of [...groups]) {
		if (group.taps.length === 0) {
			continue;
		}
		const alternates = [...group.taps, ...(group.b === undefined ? [] : [group.b])];
		const live = alternates.filter(
			(node) => (terminalOccurrences.get(node) ?? 0) > 1,
		);

		const selected = live.filter((node) => !selectorTaps.has(node));
		const chosen = selected.length > 0 ? selected : live;
		if (chosen.length === 0) {
			// Nothing on the coil is wired: it is dangling and the drop below removes it.
			groups.set(name, { ...group, taps: [] });
			continue;
		}
		// **Every live tap is stamped, not just one.** A tapped secondary with two loaded taps is
		// two coupled windings sharing a common, and each takes the turns ratio its own rating
		// gives. Collapsing to one tap silently dropped whatever was on the others -- which is
		// what happened to `orange-rockerverb`'s 8 Ω speaker jack and its feedback resistor.
		//
		// A rating is what makes the extra tap stampable, so a live tap without one refuses.
		// Nothing else in the document says how many turns it sits at.
		const unrated = chosen.filter((node) => !group.ratedOhms.has(node));
		if (chosen.length > 1 && unrated.length > 0) {
			throw new LoweringError(
				`transformer ${device.id}: winding "${name}" has ${chosen.length} taps carrying a load ` +
					`at once and ${unrated.length} of them state no rated impedance (nodes ` +
					`${unrated.join(", ")}) -- each loaded tap needs its own rating for a turns ` +
					"ratio, and this stage will not guess where on the coil a tap sits",
				device.id,
			);
		}
		// The coil now spans the common to a live tap, so any reference tap it also declared is
		// outside that span and no longer part of what is stamped. No corpus coil declares both.
		groups.delete(name);
		for (const tap of chosen) {
			groups.set(windingKey(group.role, null, groups), {
				role: group.role,
				a: tap,
				b: group.a,
				centerTap: undefined,
				taps: [],
				amplitudeVolts: group.amplitudeVolts,
				ratedOhms: group.ratedOhms,
			});
		}
	}

	// A winding brought out as several selectable taps needs the selector's own position, and
	// nothing in this document states one. Refused here rather than guessed, and refused *naming
	// the selector* rather than the transformer: the misleading version of this said the primary
	// "has only one terminal declared", which sends a reader to the winding when the missing fact
	// is a switch position.
	//
	// **An unselected throw of a plain make-or-break selector is dropped instead**, and the
	// condition is a second winding to fall back on: a selector connects its common to exactly one
	// throw, so every other tap is open, and an open winding on an ideal transformer carries no
	// current and reflects nothing. `TransformerLaw.turnsRatio` already states that intent --
	// "exact for a transformer with one secondary (tapped or not)". Silent for the same reason the
	// dangling drop below is: lowering has no warning channel, and what is dropped provably cannot
	// change the solved circuit.
	for (const [name, group] of [...groups]) {
		if (group.b !== undefined || !selectorTaps.has(group.a)) {
			continue;
		}
		if (
			[...groups].some(
				([other, candidate]) => other !== name && candidate.b !== undefined,
			)
		) {
			groups.delete(name);
			continue;
		}
		throw new LoweringError(
			`transformer ${device.id}: winding "${name}" reaches the rest of the document only ` +
				`through a selector (node ${group.a}) and the document states no selected throw ` +
				"for it -- which tap is live is a property of that switch, not of a terminal's " +
				"spelling, and this stage will not pick one",
			device.id,
		);
	}

	// A winding no end of which connects anywhere else in the document is wired to nothing, and
	// is dropped. Checked by connectivity, never by spelling. `fender-5e3-deluxe-tweed`'s power
	// transformer is the case this was written for: its `filament_a`/`filament_b` pair is
	// declared, typed and touched by no other component, so stamping it would put a source across
	// two rows nothing else holds, which only `gmin` then references. Ground is never dangling, so
	// a winding returning to node 0 is always kept.
	for (const [name, group] of [...groups]) {
		const ends = [group.a, group.b, group.centerTap, ...group.taps].filter(
			(node): node is NodeId => node !== undefined,
		);
		if (ends.every((node) => (terminalOccurrences.get(node) ?? 0) <= 1)) {
			groups.delete(name);
			continue;
		}
		if (group.b !== undefined) {
			continue;
		}
		if (group.role === "bias") {
			// A single-ended bias winding returns inside the transformer. Ten corpus power
			// transformers declare exactly this, and core warns about it (`winding-single-ended`)
			// so the shape stays visible rather than becoming a silent convention here.
			groups.set(name, { ...group, b: GROUND });
			continue;
		}
		throw new LoweringError(
			`transformer ${device.id}: winding "${name}" declares one terminal, and its node ` +
				`${group.a} connects to another component -- this stage has no model for a used ` +
				"single-ended tap, so it refuses rather than guessing what it means",
			device.id,
		);
	}

	// A grounded end is the coil's return, so it is the one a stamp measures *from*. Coil order
	// states where the turns are, not a polarity -- the two ends of a winding have no inherent
	// plus and minus -- but a winding stamped with its return as the plus end is inverted against
	// everything that shares that return. Last, because the tap reduction above already puts the
	// common in `b`, and doing it first would offer ground itself as a live alternate.
	for (const [name, group] of groups) {
		if (group.b !== undefined && group.a === GROUND && group.b !== GROUND) {
			groups.set(name, { ...group, a: group.b, b: group.a });
		}
	}

	// A transformer is on the driven path when at least one coil states its own voltage. Tested
	// with `some`, not with the list's length: the list carries one slot per declared coil and a
	// slot is `null` when the source states nothing, so every transformer with any windings has a
	// non-zero length.
	const windings: LoweredWinding[] = law.windingAmplitudeVolts.some(
		(volts) => volts !== null,
	)
		? drivenWindings(device, law, groups)
		: coupledWindings(device, law.turnsRatio, groups);
	if (windings.length === 0) {
		throw new LoweringError(
			`transformer ${device.id} has a primary and no secondary winding`,
			device.id,
		);
	}
	return windings;
}

/**
 * The impedance this coil is rated at across the pair a stamp uses, or 0 when it states none.
 *
 * Both ends are tried because which one carries the rating depends on the coil: a primary is
 * rated plate-to-plate and a reduced secondary is rated at the live tap that became its `a`.
 */
function ratedOhmsOf(group: WindingGroup): number {
	const ohms =
		group.ratedOhms.get(group.a) ??
		(group.b === undefined ? undefined : group.ratedOhms.get(group.b));
	return ohms !== undefined && ohms > 0 ? ohms : 0;
}

/** The key of the coil whose role is `primary`, for the reference-swap comparison below. */
function primaryName(groups: ReadonlyMap<string, WindingGroup>): string {
	for (const [name, group] of groups) {
		if (group.role === "primary" || group.role === "drive") {
			return name;
		}
	}
	return "primary";
}

/** One declared coil, reduced to the nodes a stamp needs. */
type WindingGroup = {
	/** The declared role, verbatim. Compared only against whole values (`primary`, `drive`). */
	readonly role: string;
	readonly a: NodeId;
	readonly b: NodeId | undefined;
	/** The reference tap, about which both halves of the coil are live at once. */
	readonly centerTap: NodeId | undefined;
	/** Alternative output points, of which a selector normally makes one live. */
	readonly taps: readonly NodeId[];
	/** This coil's own peak EMF, or null where the source states no voltage for it. */
	readonly amplitudeVolts: number | null;
	/** Rated impedance in ohms, keyed by the tap node it is rated at. */
	readonly ratedOhms: ReadonlyMap<NodeId, number>;
};

/**
 * A key for a coil, unique within its transformer.
 *
 * A role may repeat: `orange-rockerverb`'s power transformer carries two filament windings, a
 * 3.15-0-3.15 V pair for the power tubes and a 6.3 V pair for the preamp. The declared `id`
 * distinguishes them where the document gives one; otherwise the role is suffixed, which is all
 * `secondaryalt2` ever was.
 */
function windingKey(
	role: string,
	id: string | null,
	groups: ReadonlyMap<string, WindingGroup>,
): string {
	const base = id ?? role;
	if (!groups.has(base)) {
		return base;
	}
	for (let suffix = 2; ; suffix += 1) {
		const candidate = `${base}#${suffix}`;
		if (!groups.has(candidate)) {
			return candidate;
		}
	}
}

/**
 * Each winding driven at its own stated EMF, with no primary modelled.
 *
 * The `primary` group is skipped rather than required: on this path it is the mains side, it
 * carries no audio, and the whole point is that the document need not say anything about it.
 */
function drivenWindings(
	device: Device,
	law: Extract<DeviceLaw, { kind: "transformer" }>,
	groups: ReadonlyMap<string, WindingGroup>,
): LoweredWinding[] {
	const frequencyHz = law.mainsFrequencyHz;
	if (frequencyHz === null) {
		throw new LoweringError(
			`transformer ${device.id} is specified by its winding voltages, but this document ` +
				"states no single AC supply frequency for those windings to run at -- a voltage " +
				"with no frequency is not a waveform, and this stage will not pick one",
			device.id,
		);
	}
	const windings: LoweredWinding[] = [];
	for (const [name, group] of groups) {
		if (group.role === "primary" || group.role === "drive") {
			continue;
		}
		const { a, b } = group;
		if (b === undefined) {
			throw new LoweringError(
				`transformer ${device.id}: winding "${name}" has no pair of ends`,
				device.id,
			);
		}
		const tap = group.centerTap;
		const amplitudeVolts = group.amplitudeVolts;
		if (amplitudeVolts === null) {
			// **A coil whose source states no voltage is not driven.** This replaced a five-name
			// `HEATER_CLASS_WINDINGS` set that excused the same thing by class, which could not
			// see the reason: `fender-bassman`'s rectifier heater is the only corpus coil in this
			// position, and its packet's own `Derivation` says the 5 V is "assumed from GZ34
			// heater, unprinted on selected schematic" and that typing it would be the
			// invented-typical-value inference the source discipline forbids. So the absence is
			// the packet's decision, not an omission, and the class of the coil is irrelevant to
			// it.
			//
			// The risk this accepts is a *wired* coil left undriven. That is loud rather than
			// silent for anything carrying audio -- an undriven HV winding is a dead B+ rail and
			// a silent amp -- and `requireWindingSpecification` in `netlist.ts` refuses a
			// transformer where no coil states a voltage at all.
			continue;
		}
		// A centre tap is two sources of the stated size about the tap, so the two ends swing in
		// antiphase and the rectifier downstream is full-wave. Never one source of twice the size.
		const halves =
			tap === undefined
				? [{ plus: a, minus: b }]
				: [
						{ plus: a, minus: tap },
						{ plus: tap, minus: b },
					];
		for (const half of halves) {
			windings.push({
				kind: "driven",
				plus: half.plus,
				minus: half.minus,
				amplitudeVolts,
				frequencyHz,
				sourceOhms: law.windingSourceOhms,
			});
		}
	}
	return windings;
}

/** Each secondary coupled to the shared primary through the declared turns ratio. */
function coupledWindings(
	device: Device,
	declaredRatio: number,
	groups: ReadonlyMap<string, WindingGroup>,
): LoweredWinding[] {
	// `drive` is a primary in every sense this reduction cares about: it is the coil the signal
	// enters, and the others are referred to it. It is a separate role because a spring tank's
	// coils do not transform each other's voltage -- but a tank shell whose part number is not a
	// tank's lowers here as an ordinary transformer, and then the drive coil is the primary.
	const primary = [...groups.values()].find(
		(group) => group.role === "primary" || group.role === "drive",
	);
	if (primary === undefined || primary.b === undefined) {
		throw new LoweringError(
			`transformer ${device.id} has no complete primary winding`,
			device.id,
		);
	}

	// A tapped primary has no single reference winding of its own -- see the docstring's
	// derivation -- so the shared-primary reduction pivots on any OTHER complete, untapped
	// winding instead, which sees the same core flux and can stand in for it.
	let referenceName = primaryName(groups);
	let referenceGroup = primary;
	let reference: { a: number; b: number } = { a: primary.a, b: primary.b };
	if (primary.centerTap !== undefined) {
		const candidates = [...groups.entries()].filter(
			(entry): entry is [string, WindingGroup & { b: NodeId }] => {
				const [, group] = entry;
				return (
					group.role !== "primary" &&
					group.role !== "drive" &&
					group.b !== undefined &&
					group.centerTap === undefined
				);
			},
		);
		if (candidates.length === 0) {
			throw new LoweringError(
				`transformer ${device.id} has a tapped primary and no untapped winding to use as a ` +
					"reference instead, which this stage cannot reduce to coupled pairs",
				device.id,
			);
		}
		// Several candidates are the loaded taps of one physical secondary, which the reduction
		// above split into a group each. Any of them can serve -- they all see the same core, and
		// every ratio here is taken against whichever one this picks -- so the highest-rated is
		// chosen: it is the coil's far end and therefore the most complete statement of it.
		const [name, group] = candidates.reduce((best, entry) =>
			ratedOhmsOf(entry[1]) > ratedOhmsOf(best[1]) ? entry : best,
		) as [string, WindingGroup & { b: NodeId }];
		referenceName = name;
		referenceGroup = group;
		reference = { a: group.a, b: group.b };
	}

	// The rating of the reference coil, against which every other coil's ratio is taken.
	const referenceOhms = ratedOhmsOf(referenceGroup) || null;

	const windings: LoweredWinding[] = [];
	for (const [name, group] of groups) {
		if (name === referenceName) {
			continue;
		}
		const { a, b } = group;
		if (b === undefined) {
			throw new LoweringError(
				`transformer ${device.id}: winding "${name}" has no pair of ends`,
				device.id,
			);
		}
		const tap = group.centerTap;
		// The tapped primary, reflected through a swapped reference, uses the inverse of the
		// declared ratio, halved -- worked out in the docstring above.
		const isSwappedPrimary = group.role === "primary" || group.role === "drive";
		// **A coil's ratio comes from its own rating**, which is what lets two loaded taps of one
		// secondary be stamped at different ratios. `declaredRatio` is already
		// `sqrt(Zreference / Zcoil)` for a transformer whose ratings this derives from, so for the
		// single-rating coils that is the same arithmetic on the same numbers; the rated path is
		// what the extra taps need.
		//
		// The swapped primary keeps `declaredRatio`: its formula is `2 / sqrt(Zp/Zs)`, and
		// recomputing that as `2 * sqrt(Zs/Zp)` is the same value by algebra and not always the
		// same double.
		//
		// `turnsRatio` on a coupled stamp is (reference turns)/(coil turns), and turns go as the
		// square root of impedance, so a rating at each end of the pair states it completely.
		const coilOhms = ratedOhmsOf(group) || null;
		const rated = referenceOhms !== null && coilOhms !== null;
		const coilRatio = rated
			? Math.sqrt((referenceOhms as number) / (coilOhms as number))
			: declaredRatio;
		// The swapped primary keeps the reciprocal *expression* the previous rung used rather
		// than the algebraically equal `2 * sqrt(Zref / Zcoil)`: the two agree to within a double's
		// last bit, and the point of reading ratings is to fix a wrong ratio, not to perturb the
		// ten packets whose ratio was already right.
		const localRatio = isSwappedPrimary
			? 2 /
				(rated
					? Math.sqrt((coilOhms as number) / (referenceOhms as number))
					: declaredRatio)
			: coilRatio;
		const halves =
			tap === undefined
				? [{ plus: a, minus: b, ratio: localRatio }]
				: isSwappedPrimary
					? [
							{ plus: a, minus: tap, ratio: localRatio },
							{ plus: tap, minus: b, ratio: localRatio },
						]
					: [
							{ plus: a, minus: tap, ratio: coilRatio * 2 },
							{ plus: tap, minus: b, ratio: coilRatio * 2 },
						];
		for (const half of halves) {
			windings.push({
				kind: "coupled",
				primaryPlus: reference.a,
				primaryMinus: reference.b,
				plus: half.plus,
				minus: half.minus,
				turnsRatio: half.ratio,
			});
		}
	}
	return windings;
}

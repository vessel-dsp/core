// Stage 2: Device -> PartIdentity | null.
//
// The only stage in the pipeline that asks "what is this thing". Everything else is
// arithmetic on a graph. Passives and discretes never reach it: an R, C, D or
// transistor's law follows from its typed kind plus parameters, so identification
// exists solely for parts whose behaviour is genuinely not in the netlist.
//
// The evidence ladder, hardest first. Each rung refuses to reach the next:
//
//   1. exact part id      a manufacturer number, compared whole and case-folded
//   2. declared type      a value from the source's closed type vocabulary
//   3. pinout signature   terminal role tokens, compared as whole tokens
//
// There is no fourth rung and no score. A ranked guess has no consumer, and a wrong
// identity is worse than none: it renders a plausible wrong pedal instead of
// refusing. Returning `null` is a correct, expected answer.
//
// Topology is deliberately absent. It was measured at length and the conclusions were
// that similarity cannot gate a decision, that a memory and its clock driver are
// automorphic across their shared net so no graph function separates them, and that
// with n=1 to 3 instances per family a structural signature cannot be told from
// memorisation. If a topology rung is ever added it belongs here and nowhere else.

import { canonicalPartId } from "./part-number";
import {
	foldPartId,
	foldToken,
	type PartEntry,
	type PartRegistry,
} from "./registry";
import type { Device, PartIdentity } from "./types";
import { opampNeedsRegistrySections } from "./unreadable-terminal-role";

/** Kinds whose behaviour is not determined by the netlist and so need a part. */
export function requiresIdentification(device: Device): boolean {
	return device.kind === "ic" || device.kind === "power-amp";
}

/**
 * Kinds whose behaviour a registry **may** extend, as opposed to supply outright.
 *
 * `ic` and `power-amp` have no behaviour except a part's, so for them the registry is the only
 * source and its silence is a refusal -- that is `requiresIdentification` above. An `ota` is
 * different in both directions: it carries a universal device-class law
 * (`I_out = gm * (V+ - V-)`), so an unregistered one must still work; and a registered one can be
 * *more* than that law, because a single `ota` stamp cannot carry a second section. A BA662A is
 * an OTA **plus** a Darlington buffer, and before this `boss-cs-2`'s `bufferinput`/`buffertie`
 * net was touched by no stamp in the compiled program at all.
 *
 * So this is consulted only where a `sections` model is being looked up. It deliberately does not
 * widen `requiresIdentification`: doing that put OTAs through the `ic` shell/isolation predicates
 * and the unmatched-pinout refusal, which cost `electro-harmonix-small-stone` all five of its
 * CA3094 stamps at once.
 */
export function mayCarryRegistrySections(device: Device): boolean {
	return (
		requiresIdentification(device) ||
		device.kind === "ota" ||
		// An optocoupler is the `ota` case in both directions: it has a universal law of its own,
		// so an unregistered discrete LED/LDR pair must still work, and a registered VTL5C1 can be
		// more than that law. 13 corpus packets declare `kind: optocoupler` against a registry part
		// and reach their sections through here.
		device.kind === "optocoupler" ||
		// Only an op-amp its own device-class law cannot bind; see
		// `opampNeedsRegistrySections` for why this is scoped rather than a kind test.
		opampNeedsRegistrySections(device)
	);
}

/**
 * An op-amp whose registered *part* says it is not an op-amp, so the part's law overrides the
 * device-class law even though the class law can read the terminals.
 *
 * The class law is `ideal-opamp`; a `sections` entry whose law kind is not that is the part
 * disagreeing with the drawn kind. That is typed evidence the part carries and the document's
 * `kind: opamp` is a drawing convenience: an LM339 drawn as an op-amp is still an
 * open-collector comparator, and the ideal-op-amp output that stamps binds the shared node is
 * a voltage source where the real part is a sink-or-float. `moogerfooger-mf-102`'s `U2A`/`U2C`
 * wire-OR onto one pull-up resistor because the LM339's outputs *are* open-collector; a voltage
 * source makes that node over-determined and the packet renders silence.
 *
 * Match is the same whole-token exact part id (rung 1) or canonical die (rung 4) the evidence
 * ladder uses, so a prose mention can never admit one. The default registry is consulted with the
 * arity deliberately unconstrained: an arity *mismatch* against a comparator entry still wants the
 * registration question to end where it would today -- rung 3 -- rather than falling through to
 * `declaredType`, whose class would re-stamp the drawn `opamp`.
 */
export function opampPartRegisteredAsOtherLaw(device: Device, registry: PartRegistry): boolean {
	if (device.kind !== "opamp") {
		return false;
	}
	const partNumber = device.identity.partNumber;
	if (partNumber === null) {
		return false;
	}
	const folded = foldPartId(partNumber);
	const canonical = foldPartId(canonicalPartId(partNumber));
	for (const entry of registry.entries) {
		if (entry.model.kind !== "sections") {
			continue;
		}
		const matches =
			entry.partIds.some((id) => foldPartId(id) === folded) ||
			entry.partIds.some((id) => foldPartId(canonicalPartId(id)) === canonical);
		if (matches && entry.model.sections.some((section) => section.law.kind !== "ideal-opamp")) {
			return true;
		}
	}
	return false;
}

/**
 * An op-amp the device-class law already binds, whose matched registry entry would say nothing
 * new: a `sections` entry that is empty or every-section `ideal-opamp` is the class law in another
 * spelling, so taking the entry would move the program (new section device ids, a registry arity
 * read) without changing a stamp. Keeping the class law makes this route zero-change for every
 * packet whose op-amps are actually op-amps -- measured wrong once already on 2026-09-02, when
 * widening the gate to every `opamp` moved 14 packets before `opampNeedsRegistrySections`
 * scoped it.
 */
function opampKeepsItsClass(device: Device, entry: PartEntry): boolean {
	return (
		device.kind === "opamp" &&
		!opampNeedsRegistrySections(device) &&
		entry.model.kind === "sections" &&
		entry.model.sections.every((section) => section.law.kind === "ideal-opamp")
	);
}

export function identify(
	device: Device,
	registry: PartRegistry,
): PartIdentity | null {
	if (
		!mayCarryRegistrySections(device) &&
		!opampPartRegisteredAsOtherLaw(device, registry)
	) {
		return null;
	}

	const partNumber = device.identity.partNumber;
	if (partNumber !== null) {
		const folded = foldPartId(partNumber);
		// 1. Try to find an entry with matching partId AND matching terminal arity (or macro kind)
		for (const entry of registry.entries) {
			if (entry.partIds.some((id) => foldPartId(id) === folded)) {
				if (entry.model.kind === "sections") {
					if (device.nodes.length === entry.model.pinout.length) {
						// A part the op-amp class law binds already keeps that law unless the
						// registry says the part is not an op-amp; see `opampKeepsItsClass`.
						if (opampKeepsItsClass(device, entry)) {
							continue;
						}
						const resolvedId = entry.partIds[0] ?? partNumber;
						return { partId: resolvedId, evidence: "exact-part" };
					}
				} else if (entry.model.kind === "macro") {
					const resolvedId = entry.partIds[0] ?? partNumber;
					return { partId: resolvedId, evidence: "exact-part" };
				}
			}
		}
		// 2. Fall back to standard matching on partId only if not an incompatible sections model
		for (const entry of registry.entries) {
			if (entry.partIds.some((id) => foldPartId(id) === folded)) {
				if (
					entry.model.kind !== "sections" ||
					device.nodes.length === entry.model.pinout.length
				) {
					if (opampKeepsItsClass(device, entry)) {
						continue;
					}
					const resolvedId = entry.partIds[0] ?? partNumber;
					return { partId: resolvedId, evidence: "exact-part" };
				}
			}
		}
		// 3. **The rung is terminal, which is what "each rung refuses to reach the next" means.**
		//
		// Both loops above give up when a registered part's entry is a `sections` model whose
		// pinout does not fit this component's terminal count -- and until 2026-09-04 that fell
		// through to declared type and then to *pin names*, which is weaker evidence about a
		// component whose part number the registry already knows. `moogerfooger-mf-102`'s `U4A`
		// is the proof: it declares `PartNumber: LM13600` with five of that OTA's pins, no
		// entry has a five-pin LM13600, and rung 3 matched its
		// `nonInverting/inverting/output/vplus/vminus` naming against the **LM311 comparator**
		// signature -- so a dual OTA was one lowering away from being stamped as a comparator.
		// A pinout signature cannot tell an OTA from a comparator; both are five pins with those
		// names, which is exactly the case this file records as "a wrong identity is worse than
		// none".
		//
		// So a known part number ends identification here. An entry whose arity does not fit is a
		// registry coverage gap, and it is reported as one downstream -- `sectionDevices` refuses
		// by name for a part it cannot expand, and an OTA keeps its correct device-class law --
		// rather than becoming grounds to guess a different part from pin names.
		for (const entry of registry.entries) {
			if (entry.partIds.some((id) => foldPartId(id) === folded)) {
				if (opampKeepsItsClass(device, entry)) {
					continue;
				}
				return {
					partId: entry.partIds[0] ?? partNumber,
					evidence: "exact-part",
				};
			}
		}

		// 4. **Canonicalised ordering code -> die identity.** Tried only after both exact rungs,
		// because rule 49's asymmetry runs the whole length of this file: a missed match is a
		// diagnosable refusal and a wrong match executes silently, so exact evidence always wins
		// and this rung never guesses. It strips trailing package markings and a fixed vocabulary
		// of grade suffixes; it does NOT match on prefixes, because `M5K4164` against
		// `M5K4164ANL-15` is a prefix match and a different die.
		//
		// **It exists because a package suffix decided whether a pedal got a DSP model.**
		// `boss-rv-6` declares `UPD800402GJ-211` and `boss-st-2` declares
		// `uPD800402GJ-211-UEN-A(ESC)` -- the same silicon. Neither matched the catalog's
		// `UPD800402GJ-211-UEN-A`, so both fell through to `declaredType` below, and because the
		// two packets declare different classes, `rv-6`'s 144-pin reverb DSP was resolved as a
		// bucket-brigade delay line and rendered a 50 ms delay its chip never made.
		const canonical = foldPartId(canonicalPartId(partNumber));
		for (const entry of registry.entries) {
			if (entry.partIds.some((id) => foldPartId(canonicalPartId(id)) === canonical)) {
				if (opampKeepsItsClass(device, entry)) {
					continue;
				}
				return {
					partId: entry.partIds[0] ?? partNumber,
					evidence: "exact-part",
				};
			}
		}
	}

	// **A NAMED PART NUMBER THAT MATCHED NOTHING ENDS IDENTIFICATION HERE.**
	//
	// Falling through to `declaredType` after an unmatched part number is how `boss-rv-6`'s
	// 144-pin reverb DSP became a bucket-brigade delay line: the ordering code matched no entry,
	// so the class decided the model, and the class said `Circuit.DelayMemoryChip`. The same path
	// is still live for `boss-dd-3t`, whose `U1` declares `PartNumber: undisclosed-roland-boss-dsp`
	// and whose DRAM declares `PartNumber: excluded-dd3b-dram-context` -- **prose in a typed
	// field**, one lookup away from executing as a delay line (format item 8).
	//
	// **This is the rung order of the whole file applied once more** (rule 49): a device that
	// names its part has given the strongest evidence available, and when that evidence matches
	// nothing the honest answer is "no identity", not a weaker guess from a different field. The
	// consequence is an open device with a reason a reader can act on, which is the outcome this
	// programme exists to produce -- never a plausible model nobody asked for.
	// **The narrow form, and the wide one was measured and rejected.** Refusing *all* fall-through
	// after an unmatched part number stops two documents compiling, and one of them is a false
	// positive: `belton-brick-reverb` declares `PartNumber: unspecified-op-amp-section` on an
	// op-amp whose `Circuit.OpAmp` class resolves it perfectly well. Prose in the part-number field
	// is a source defect (format item 8), not grounds to refuse a device its class already
	// identifies.
	//
	// **What the class may NOT supply is a MACRO.** A generic class law says "this is an op-amp",
	// which the class genuinely knows. A macro says "this is *this specific chip* and here is its
	// behaviour" -- an identity claim, and the one piece of evidence that could support it just
	// failed to match. That asymmetry is the whole rule: `boss-rv-6`'s reverb DSP became a
	// bucket-brigade delay line through exactly this door, and `boss-dd-3t`'s
	// `undisclosed-roland-boss-dsp` is still standing in it.
	const partNumberUnmatched = partNumber !== null && partNumber.trim() !== "";

	const declaredType = device.identity.declaredType;
	if (declaredType !== null) {
		const folded = foldToken(declaredType);
		// 1. Try to find an entry with matching declaredType AND matching terminal arity (only for "sections" kind)
		for (const entry of registry.entries) {
			if (
				!(partNumberUnmatched && entry.model.kind === "macro") &&
				entry.declaredTypes.some((type) => foldToken(type) === folded) &&
				entry.model.kind === "sections" &&
				device.nodes.length === entry.model.pinout.length
			) {
				const resolvedId = entry.declaredTypes[0] ?? declaredType;
				return { partId: resolvedId, evidence: "declared-type" };
			}
		}
		// 2. Fall back to standard matching on declaredType only (backward compatibility)
		for (const entry of registry.entries) {
			if (partNumberUnmatched && entry.model.kind === "macro") continue;
			if (entry.declaredTypes.some((type) => foldToken(type) === folded)) {
				const resolvedId = entry.declaredTypes[0] ?? declaredType;
				return { partId: resolvedId, evidence: "declared-type" };
			}
		}
	}

	for (const entry of registry.entries) {
		if (entry.terminalRoleGroups.length === 0) {
			continue;
		}
		if (matchesTerminalRoles(device, entry)) {
			const partId = entry.partIds[0] ?? entry.declaredTypes[0];
			if (partId !== undefined) {
				return { partId, evidence: "pinout" };
			}
		}
	}

	return null;
}

/**
 * A pinout match is exact, not "these roles are present among possibly others". Two
 * directions, both whole-token and case-folded on both sides: every required group must
 * be satisfied by an alias, and every role the device declares must be covered by some
 * group. The second direction is the guard against a superset: a five-terminal part that
 * carries `in`/`gnd`/`out` plus two more would otherwise satisfy a three-group
 * regulator's signature and be stamped with a regulator's law. Presence alone is a
 * substring-shaped trap wearing role tokens.
 *
 * A part that declares more terminals than groups on purpose -- the MN3101 clock driver,
 * six named roles on an eight-pin body, two power pins the entry does not model -- still
 * matches, because its *extra terminals* carry no role token (a bare `pin` number folds
 * to null and is not in `present`); the test is on roles, not on pin count.
 *
 * Whole-token comparison cannot invent a match the way a substring search can, but it is
 * coverage-limited: the transcriber must have used a spelling the registry lists. That is
 * a known and accepted bound, not a defect to paper over.
 */
function matchesTerminalRoles(device: Device, entry: PartEntry): boolean {
	const present = device.identity.terminalRoles
		.filter((role): role is string => role !== null)
		.map(foldToken);
	if (present.length === 0) {
		return false;
	}
	const covered = (role: string): boolean =>
		entry.terminalRoleGroups.some((group) =>
			group.some((alias) => foldToken(alias) === role),
		);
	return (
		entry.terminalRoleGroups.every((group) =>
			group.some((alias) => present.includes(foldToken(alias))),
		) && present.every(covered)
	);
}

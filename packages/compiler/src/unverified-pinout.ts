import { declaredRegulatorTerminals } from "./device-laws";
import {
	identify,
	mayCarryRegistrySections,
	requiresIdentification,
} from "./identify";
import { foldToken, pinoutMatches, terminalWithRole } from "./registry";
import type { PartEntry, PartRegistry } from "./registry";
import type { CompileWarning, Device, Netlist } from "./types";

/**
 * The entry a part identified to, or null.
 *
 * Matched on the resolved `partId` against both id lists, because `identify` returns a part id
 * that may have come from either -- an `exact-part` match resolves through `partIds`, a
 * `declared-type` match through `declaredTypes`.
 */
function entryFor(partId: string, registry: PartRegistry): PartEntry | null {
	// Folded on both sides, because `identify` matches folded and this looked up raw: a part that
	// resolved through a declared type spelled differently from the registry's copy would fail to
	// find its own entry here and silently lose its pinout check. `Circuit.LED`/`Circuit.Led` is
	// the spelling the corpus actually varies on today.
	const folded = foldToken(partId);
	for (const entry of registry.entries) {
		if (
			entry.partIds.some((id) => foldToken(id) === folded) ||
			entry.declaredTypes.some((type) => foldToken(type) === folded)
		) {
			return entry;
		}
	}
	return null;
}

/**
 * Does this device's pin-to-law-slot mapping rest on nothing but the order its terminals were
 * written in?
 *
 * `expandRegistrySections` has three rungs. A clean bijection from the entry's role groups onto
 * the device's terminal names wires by role. Failing that, `pinoutMatches` checks the device's
 * names against the entry's `pinout` position by position -- but **a position the entry leaves
 * `null` is unchecked**, so an entry whose pinout is null throughout accepts any order at all.
 * Failing both, the device is refused.
 *
 * This finds the middle rung with nothing left to check: the mapping is the declaration order,
 * and no side asserts what that order means.
 */
function bindsByUnverifiedOrder(device: Device, entry: PartEntry): boolean {
	if (entry.model.kind !== "sections") {
		return false;
	}
	// **A declared supply binding takes the section before any of this runs.** Without this the
	// warning fired on `moogerfooger-mf-102`'s `U13` after its packet declared `positive` and
	// `ground` on it -- reporting an unverified order for a device whose order the document had
	// just settled, which is the same defect as a warning naming a mechanism the compiler did
	// not use.
	if (declaredRegulatorTerminals(device, entry.model) !== null) {
		return false;
	}
	const roles = device.identity.terminalRoles;
	const groups = entry.terminalRoleGroups;
	const positions = groups.map((group) => terminalWithRole(roles, group));
	const boundByRole =
		groups.length > 0 &&
		groups.length === roles.length &&
		positions.every((position) => position !== null) &&
		new Set(positions).size === positions.length;
	if (boundByRole) {
		return false;
	}
	if (!pinoutMatches(entry.model.pinout, roles)) {
		return false; // Refused elsewhere, and a refusal is not a silent binding.
	}
	return entry.model.pinout.every((position) => position === null);
}

/**
 * Parts whose terminals are mapped to law slots by declaration order alone.
 *
 * **Measured 2026-09-03: 30 devices across 21 packets, and one of them is wrong.**
 * (55 corpus devices take the positional rung; the 30 are those whose entry pinout is null
 * throughout, so nothing checks the order at all.)
 * `moogerfooger-mf-102`'s `U13` is a 78L05 whose three terminals are `pin1`/`pin2`/`pin3`, and the
 * order the entry assumed puts the regulator's reference on the pedal's own rail: node 3 carries
 * 24 devices and solves to **-4.9989 V**, so 18 of the packet's 26 active devices sit dark with
 * their base-emitter junctions reverse-biased by a whole supply.
 *
 * **There is no connectivity rule to fall back on, and that was tested rather than assumed.**
 * "The reference is the grounded terminal and the output is the busier of the rest" agrees with
 * four of the corpus's named regulators, disagrees with `boss-dd-3b`'s `TA78L05F`, and cannot
 * apply to `boss-rv-3`, whose 78L05 has no terminal on ground at all. A rule that fixes one
 * packet and breaks another is not a rule.
 *
 * Nor does the corpus agree on the order itself: three packets name a 78Lxx `in, gnd, out` and
 * `electro-harmonix-q-tron` names it `in, out, ground`. So this is reported rather than repaired
 * -- the order has to be asserted by the entry's `pinout` or by the document's own terminal
 * roles, and until one of them does, an author who writes a package's pins in a different order
 * gets a different circuit with no diagnostic.
 */
export function findUnverifiedPinoutBindings(
	netlist: Netlist,
	registry: PartRegistry,
): readonly CompileWarning[] {
	const warnings: CompileWarning[] = [];
	for (const device of netlist.devices) {
		if (!requiresIdentification(device) || !mayCarryRegistrySections(device)) {
			continue;
		}
		let identity: ReturnType<typeof identify>;
		try {
			identity = identify(device, registry);
		} catch {
			continue;
		}
		if (identity === null) {
			continue;
		}
		const entry = entryFor(identity.partId, registry);
		if (entry === null || !bindsByUnverifiedOrder(device, entry)) {
			continue;
		}
		warnings.push({
			code: "unverified-pinout-binding",
			device: device.id,
			partNumber: identity.partId,
			detail:
				`${identity.partId} ${device.id} has its ${device.nodes.length} terminals mapped to ` +
				"law slots by the order they were written in: its registry entry states no pinout " +
				"and its terminal names do not resolve onto the entry's role groups, so nothing " +
				"asserts what that order means. A document listing the same package's pins in a " +
				"different order compiles to a different circuit.",
		});
	}
	return warnings;
}

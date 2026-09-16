// A device that **named** its terminals in a spelling no resolver recognises, and was therefore
// wired by declaration order.
//
// **The defect class this closes.** Four asymmetric-device resolvers in `lower.ts` -- transistor,
// op-amp, two-terminal diode, supply -- fall back to declaration order when they cannot read a
// terminal role. That fallback is correct for a document of bare lugs, which carries no
// orientation evidence at all. It is a *guess* for a document that named its terminals in a
// vocabulary the resolver does not speak, and the guess is silent: the packet compiles `ok`,
// renders, and sounds like something. `bjtTerminals`' own comment records why that matters --
// 449 of the corpus's 490 transistors do not declare their control terminal first, so positional
// order exchanges base and collector on nearly every transistor there is.
//
// **Why a warning and not a refusal.** The 2026-09-02 census (R1 in
// `thoughts/shared/plans/2026-08-31-v2-complexity-reduction-plan.md`) measured the residue after
// the true synonyms were absorbed: five packets that compile today carry a device this would
// refuse, and all five render. `CompileWarning`'s own contract is the rule for exactly this
// situation -- "things that compiled but will not behave. A warning never blocks a program ... but
// it must not be silent either" -- and this repository's standing principle is not to trade a
// working product for a stricter gate. So the silent class becomes *named* here, which was the
// whole complaint, and promoting these rows to refusals is a later layer, once the named rows are
// corrected at the source.
//
// **What this does not claim.** A warning here says the resolver could not read the declared
// roles and fell back to position. It does **not** say the resulting wiring is wrong: declaration
// order may coincide with the right answer, and on a symmetric device it always does. The
// `orientationFreeRoles` escape hatch removes the cases where the fallback is the document's
// intended reading, so what remains is "a stated fact this pipeline could not use" -- which is
// the same bar `report-source-coverage.ts` applies on the property side.
import {
	orientationFreeRoles,
	supplyDriveRoles,
} from "./terminal-roles";
import { foldToken } from "./registry";
import { otaPackageOrderAssumed } from "./device-laws";
import { optocouplerBinding } from "./lower";
import type {
	Device,
	LawedNetlist,
	NonExecutableSupportShellWarning,
	UnreadableTerminalRoleWarning,
} from "./types";

/**
 * The one terminal index whose role is in `accepted`, or null when none or several are.
 *
 * Mirrors `lower.ts`'s `uniqueRoleIndex` deliberately, including its refusal of an ambiguous
 * match: a device declaring two terminals that both read as one slot is more than one device in
 * one component, and the resolver falls back for that reason too.
 */
function unique(
	roles: readonly (string | null)[],
	accepted: ReadonlySet<string>,
): number | null {
	const found = roles.flatMap((role, index) =>
		role !== null && accepted.has(role) ? [index] : [],
	);
	return found.length === 1 ? (found[0] ?? null) : null;
}

const allSlotsRead = (
	roles: readonly (string | null)[],
	slots: readonly ReadonlySet<string>[],
): boolean => slots.every((slot) => unique(roles, slot) !== null);

/**
 * The declared roles a resolver was given and could not place: everything the document named,
 * minus the tokens that deliberately state no orientation. Empty means there was nothing to
 * misread — either the document named nothing, or what it named carries no electrode claim.
 */
function unplaceableRoles(
	roles: readonly (string | null)[],
	slots: readonly ReadonlySet<string>[],
): readonly string[] {
	const named = roles.filter((role): role is string => role !== null);
	if (named.length === 0 || allSlotsRead(roles, slots)) {
		return [];
	}
	return named.filter((role) => !orientationFreeRoles.has(role));
}

/** A transistor whose declared roles do not give exactly one full electrode triple. */
function transistorDeclaredRolesMissing(device: Device): boolean {
	// Fewer than three terminals is not a transistor this law can bind at all, and a device with
	// none reaches no resolver.
	if (device.nodes.length < 3) {
		return false;
	}
	const declared = device.identity.declaredTerminalRoles;
	const has = (role: string) =>
		declared.filter((value) => value === role).length === 1;
	return !(
		(has("base") && has("collector") && has("emitter")) ||
		(has("gate") && has("drain") && has("source"))
	);
}

/**
 * A component declared as one transistor that is really **several devices in one shell**.
 *
 * `boss-ce-1` declares `SRC_CE1_Q3_Q6_D01_D05_CLOCK_BRIDGE_SUPPORT` as `kind: bjt` with
 * **nineteen** terminals, standing for four transistors and five diodes, and
 * `SRC_CE1_Q15_Q16_Q17_POWER_REGULATOR` as `kind: bjt` with eight, standing for three. Stamping
 * either as a single transistor invents a device: the packet's own `Description` says "Exact
 * physical package C/B/E orientation … remain unresolved", so there is no base, collector or
 * emitter to bind, and declaration order supplies one anyway.
 *
 * **Two conditions, and the conjunction is what makes this safe.**
 *
 *  - *The law cannot consume the terminals.* A `bjt`/`fet` law binds exactly three nodes, so a
 *    component declaring more has terminals no stamp can reach.
 *  - *And its roles cannot be read.* This is the discriminator. Measured across the corpus, 20
 *    devices declare more terminals than their kind's law consumes, and almost all are
 *    legitimate: 14 are multi-junction diodes (bridges, dual tube rectifiers) that
 *    `diodeJunctions` places by role, and `moogerfooger-mf-102`'s four `MPQ3906` sections are a
 *    quad transistor array declaring `collector`/`base`/`emitter` plus two unused package pins,
 *    which read cleanly. Only `boss-ce-1`'s two shells fail both tests.
 *
 * **Why not read `PartNumber`.** These shells announce themselves there —
 * `"Q3/Q4 2SA493; Q5/Q6 2SC536F; D01-D05 1S1555"` is plainly several parts — and splitting that
 * string on its separators is exactly the prose parsing this repository forbids for a
 * classification decision. Terminal count against a law's fixed arity, and whether a closed role
 * vocabulary reads, are structural facts about the document instead.
 *
 * Deliberately not extended to `opamp`: an op-amp package legitimately declares more terminals
 * than its law binds (supplies, a second section), so arity says nothing there. `boss-dm-3`'s
 * 8-pin `IC1` is that case and is a registry-expansion question, not a shell.
 */
export function isMultiDeviceTransistorShell(device: Device): boolean {
	if (
		device.kind !== "bjt" &&
		device.kind !== "jfet" &&
		device.kind !== "mosfet"
	) {
		return false;
	}
	if (device.nodes.length <= 3) {
		return false;
	}
	// **The declared triple, not a table of spellings.** This predicate decides the *program* --
	// a shell is opened rather than stamped -- so it was the last program-affecting reader of
	// `transistorControlRoles` and its two siblings -- now deleted, since diagnostics were their
	// only other reader and it needed neither. Every device this distinguishes already declares
	// its electrodes, which is what makes the swap behaviour-neutral: `moogerfooger-mf-102`'s
	// four `MPQ3906` sections declare `collector`/`base`/`emitter` beside two unused package
	// pins, `fulltone-ocd`'s and `mxr-carbon-copy`'s MOSFETs declare `drain`/`gate`/`source`
	// beside `bulk`, and `boss-ce-1`'s two shells declare nothing at all -- which is exactly the
	// distinction being drawn.
	return transistorDeclaredRolesMissing(device);
}

/**
 * The slot sets each law's resolver reads, or null for a law this check does not cover.
 *
 * Only the four asymmetric resolvers that **fall back to declaration order** are listed. A
 * resolver that already refuses on an unreadable role needs nothing here -- the triode, the
 * pentode, the tube diode, the transformer and the multi-junction diode all name the offending
 * token themselves. Deliberately absent for a different reason: a **pot**, whose unresolved
 * orientation is a quiet-reference hint rather than a topology decision ("an unresolved pot,
 * never a wrong one" -- `lowerRegion`'s own parameter docs); a **switch**, where the corpus
 * routinely leaves the common terminal unnamed and `switchPoles` treats the first contact as
 * common by design; and an **OTA**, whose binding permits a null bias pin outright and whose
 * package fallback requires eight all-null roles, so a named OTA never reaches it.
 */
function slotsForLaw(
	law: string,
	device: Device,
): readonly ReadonlySet<string>[] | null {
	// `bjt`, `fet` and `ideal-opamp` are handled by `declaredRolesMissing` instead: since
	// 2026-09-03 their resolvers read the declared `role` rather than the terminal name, so
	// checking the name vocabulary here would report a device as readable that the resolver then
	// refuses or wires positionally -- the silent fallback this warning exists to catch. Keeping
	// a warning on a different vocabulary from the resolver it guards is how that bug was
	// introduced once already, in this same file, on the same day.
	if (law === "bjt" || law === "fet" || law === "ideal-opamp") {
		return null;
	}
	// A two-terminal diode is handled by `diodeDeclaredRolesMissing` for the same reason: its
	// resolver reads the declared `anode`/`cathode`, so a name check here would call a device
	// readable that the resolver then orients by declaration order.
	if (law === "diode" && device.nodes.length === 2) {
		return null;
	}
	// A rail declares one terminal and means "against ground", which is not a polarity
	// question -- `supplyTerminals` returns early for it and reads no role at all.
	if (
		(law === "voltage-source" || law === "ac-source") &&
		device.nodes.length > 1
	) {
		return [supplyDriveRoles];
	}

	return null;
}

/**
 * `supplyTerminals` resolves from **either** end alone -- one named terminal beside an unlabelled
 * lug is enough, and requiring both would discard the evidence in a supply declaring `positive`
 * next to a bare pin. So its readable test is a disjunction where the other three are
 * conjunctions, and treating it as a conjunction here would warn about supplies the resolver
 * orients correctly.
 *
 * **The return half of the disjunction is gone**, along with `supplyReturnRoles`. Emptying that
 * set left the corpus's `terminal-role-unreadable` count unchanged at 34, and removing its slot
 * outright left it unchanged again -- so no corpus supply was being spared a warning by a
 * `negative`/`neutral`/`return` *name*. Its declared counterpart is what `supplyTerminals` reads.
 */
function supplyReadable(roles: readonly (string | null)[]): boolean {
	return roles.some((role) => role !== null && supplyDriveRoles.has(role));
}

/**
 * The three-terminal roles a `bjt`/`fet` resolver needs, and whether the device declares them.
 *
 * Kept beside the name-based check rather than merged with it, because the two ask different
 * questions now: this one asks what the *source declared*, which is what `lower.ts` reads.
 */
/**
 * A switch with three or more contacts that declares no pole, so `switchPoles` takes the first
 * contact as the common.
 *
 * **Two contacts are exempt, and the exemption is measured rather than assumed.** A closed contact
 * pair is a symmetric conductance, so which terminal is called the pole cannot change the circuit
 * -- verified by swapping the two terminals of `earthquaker-devices-plumes`'s `SW` and diffing the
 * program: the only difference is the stamp's `a` and `b` fields exchanging, `{"a":25,"b":0}` for
 * `{"a":0,"b":25}`. The digest moves and the circuit does not, which is the one case where the
 * digest gate reports a difference that is not there.
 *
 * At three contacts it matters: the pole is the node every throw hangs off, and choosing the wrong
 * one rewires the switch. 118 corpus switches name what each contact *connects to* -- `effect`,
 * `bypass`, `rectifier_output` -- which says nothing about which is the pole, and 32 of those have
 * three or more contacts.
 */
function switchPoleUnreadable(device: Device): boolean {
	const declared = device.identity.declaredTerminalRoles;
	if (declared.some((role) => role === "common")) {
		return false;
	}
	// The name rung this used to mirror is gone from `switchPoles` along with
	// `switchCommonRoles`, so the declared role above is the whole test. It stays worth
	// recording that mirroring mattered: checking only the declaration once reported 62
	// switches, and its first two examples had a terminal literally named `common`, which the
	// compiler was still reading -- a warning naming a mechanism the compiler did not use is
	// worse than none.
	// Contacts only: a `coil` or `pin` terminal is not part of the mechanism's contact set, and a
	// document declaring neither still has every terminal to choose a pole from.
	const contacts = declared.some((role) => role !== null)
		? declared.filter((role) => role === "throw").length
		: device.nodes.length;
	return contacts >= 3;
}

/**
 * A two-terminal diode that declares no orientation, so `diodeTerminals` takes its direction from
 * declaration order.
 *
 * **`end`/`end` is the case this exists for.** Core's `end` means two interchangeable ends, which
 * is true of a resistor and false of a diode: a diode has a direction, so `end`/`end` says the
 * source did not state it rather than that there is nothing to state. 13 corpus diodes are in
 * that position, and reversing one of them moves the program — measured by mutation, in a review
 * that found this while `orientationFreeRoles` was keeping the warning quiet about it.
 */
function diodeDeclaredRolesMissing(device: Device): boolean {
	const declared = device.identity.declaredTerminalRoles;
	return !(declared.includes("anode") && declared.includes("cathode"));
}

/** An op-amp whose declared roles do not give exactly one of each signal pin. */
function opampDeclaredRolesMissing(device: Device): boolean {
	const declared = device.identity.declaredTerminalRoles;
	return !(["nonInverting", "inverting", "output"] as const).every(
		(role) => declared.filter((value) => value === role).length === 1,
	);
}

export function findUnreadableTerminalRoles(
	lawed: LawedNetlist,
): readonly UnreadableTerminalRoleWarning[] {
	const warnings: UnreadableTerminalRoleWarning[] = [];
	// Read the law rather than `device.kind`, because a multi-section part has already become
	// one device per section by this stage, with its roles rewritten to canonical ones -- so a
	// dual op-amp the registry recognises is correctly wired and must not be reported here.
	const lawByDevice = new Map(
		lawed.resolutions.flatMap((resolution) =>
			resolution.outcome === "law"
				? [[resolution.device, resolution.law.kind] as const]
				: [],
		),
	);
	for (const device of lawed.netlist.devices) {
		const law = lawByDevice.get(device.id);
		if (law === undefined) {
			continue;
		}
		if (law === "selector") {
			if (switchPoleUnreadable(device)) {
				const named = device.identity.terminalRoles
					.filter((role): role is string => role !== null)
					.map((role) => `"${role}"`);
				warnings.push({
					code: "terminal-role-unreadable",
					device: device.id,
					detail:
						`switch ${device.id} declares no \`common\` among its ${device.nodes.length} ` +
						"terminals' roles, so the first contact was taken as the pole and every other " +
						`contact hung off it${named.length > 0 ? ` (its terminals are named ${named.join(", ")})` : ""}. ` +
						"With three or more contacts the pole decides the wiring; with two it cannot.",
				});
			}
			continue;
		}
		if (law === "ota") {
			if (otaPackageOrderAssumed(device)) {
				warnings.push({
					code: "terminal-role-unreadable",
					device: device.id,
					detail:
						`OTA ${device.id} names none of its eight terminals and declares no ` +
						"electrodes, so its inputs, output and bias were read as DIP-8 package " +
						"order. That is a better assumption than declaration order, which puts the " +
						"output on pin 3, but it is still the package's convention rather than " +
						"anything this document states.",
				});
			}
			continue;
		}
		if (law === "optocoupler") {
			const binding = optocouplerBinding(device);
			if (binding !== "declared") {
				warnings.push({
					code: "terminal-role-unreadable",
					device: device.id,
					detail:
						binding === "named"
							? `optocoupler ${device.id} declares no anode or cell ends, so its LED ` +
								"direction was taken from its terminals' names instead. The wiring is " +
								"right and the evidence is prose: declaring `anode` and two `end` " +
								"roles states the same fact in a form nothing has to spell-match."
							: `optocoupler ${device.id} declares no roles and names none its ` +
								"resolver recognises, so its LED and cell were taken in declaration " +
								"order. An LED has a direction and the source did not state one.",
				});
			}
			continue;
		}
		if (law === "diode" && device.nodes.length === 2) {
			if (diodeDeclaredRolesMissing(device)) {
				const named = device.identity.terminalRoles
					.filter((role): role is string => role !== null)
					.map((role) => `"${role}"`);
				warnings.push({
					code: "terminal-role-unreadable",
					device: device.id,
					detail:
						`diode ${device.id} declares no anode and cathode among its terminals' roles, ` +
						`so its direction was taken in declaration order instead${named.length > 0 ? ` (its terminals are named ${named.join(", ")})` : ""}. ` +
						"A diode has a direction and `end` does not state one, so declaration order " +
						"may or may not be the way this one conducts.",
				});
			}
			continue;
		}
		if (law === "bjt" || law === "fet") {
			if (transistorDeclaredRolesMissing(device)) {
				const named = device.identity.terminalRoles
					.filter((role): role is string => role !== null)
					.map((role) => `"${role}"`);
				warnings.push({
					code: "terminal-role-unreadable",
					device: device.id,
					detail:
						`${device.kind} ${device.id} does not declare a base/collector/emitter or ` +
						"gate/drain/source among its terminals' roles, so they were taken in " +
						`declaration order instead${named.length > 0 ? ` (its terminals are named ${named.join(", ")})` : ""}. ` +
						"Declaration order may or may not be the right wiring.",
				});
			}
			continue;
		}
		const slots = slotsForLaw(law, device);
		if (slots === null) {
			continue;
		}
		const roles = device.identity.terminalRoles;
		// A supply resolves from **either** end alone, so its readable test is a disjunction
		// where the other three are conjunctions; `unplaceableRoles` asks the conjunction.
		if (
			(law === "voltage-source" || law === "ac-source") &&
			supplyReadable(roles)
		) {
			continue;
		}
		// Empty covers all three silent cases at once: nothing declared (bare lugs, where
		// declaration order is all the document supports), roles that read cleanly, and roles
		// that are orientation-free and so state no electrode to have missed.
		const unreadable = unplaceableRoles(roles, slots);
		if (unreadable.length === 0) {
			continue;
		}
		warnings.push({
			code: "terminal-role-unreadable",
			device: device.id,
			detail:
				`${device.kind} ${device.id} declares terminal role${unreadable.length === 1 ? "" : "s"} ` +
				`${unreadable.map((role) => `"${role}"`).join(", ")} that its ${law} lowering ` +
				"cannot place, so its terminals were taken in declaration order instead. Declaration " +
				"order may or may not be the right wiring; the device's declared roles were not used.",
		});
	}
	return warnings;
}

/**
 * The multi-device shells stage 3 resolved to `open`, so a packet is told the component was
 * dropped rather than silently losing it.
 *
 * Paired with `isMultiDeviceTransistorShell`'s use in `resolveDevice`: that decides the law, this
 * reports it. Conjoined with the law so a device the predicate matches but some other rule opened
 * — an isolated IC, a charge pump — is not attributed to this one.
 */
export function findMultiDeviceShells(
	lawed: LawedNetlist,
): readonly NonExecutableSupportShellWarning[] {
	const opened = new Set(
		lawed.resolutions.flatMap((resolution) =>
			resolution.outcome === "law" && resolution.law.kind === "open"
				? [resolution.device]
				: [],
		),
	);
	return lawed.netlist.devices.flatMap((device) =>
		opened.has(device.id) && isMultiDeviceTransistorShell(device)
			? [
					{
						code: "non-executable-support-shell" as const,
						device: device.id,
						detail:
							`${device.kind} ${device.id} declares ${device.nodes.length} terminals for a law that ` +
							"binds three, and names none of them readably, so it stands for several devices " +
							"rather than one. It is not executed: stamping it as a single transistor would " +
							"invent a base, collector and emitter the source does not state.",
					},
				]
			: [],
	);
}

/**
 * An `opamp` whose own device-class law cannot bind its terminals, so a registry `sections` entry
 * is the only thing that can place them.
 *
 * **The direction matters, and it is the OTA rule inverted.** `sectionDevices` records that for an
 * OTA "the registry only wins when it can bind by role", because an OTA carries a correct
 * role-bound device-class law and a positional guess from an entry written for other spellings is
 * strictly worse. An op-amp is in the same position, so the same principle gives the mirror rule:
 * **the device-class law wins wherever it can read the terminals, and the registry is consulted
 * only where it cannot.** That keeps every ordinary op-amp exactly where it is.
 *
 * Measured over the corpus: 113 `opamp` devices declare three terminals, 195 declare five, four
 * declare seven (`LM308`/`OP07CP` balance pins, `HA1457W` compensation pins) and **one** declares
 * eight -- `boss-dm-3`'s `IC1`, a whole `NJM4558DD` dual package as a single component. Only that
 * one fails to bind, because it names two non-inverting inputs and `uniqueRoleIndex` refuses an
 * ambiguous read. Stamped as one op-amp it put both inputs on node 4 and drove node 10, which is
 * *both* sections' non-inverting input.
 *
 * Widening `mayCarryRegistrySections` to every `opamp` was tried on 2026-09-02 and measured wrong:
 * `boss-dm-3` itself became `unsupported` and 14 other packets' programs moved. This predicate is
 * why the fix is scoped rather than a kind test.
 */
export function opampNeedsRegistrySections(device: Device): boolean {
	if (device.kind !== "opamp") {
		return false;
	}
	// The same question `opampTerminals` asks, on the same field: a package declares two of each
	// signal role and the resolver refuses it, so this predicate has to agree with that or the
	// two disagree about which devices need sections.
	return opampDeclaredRolesMissing(device);
}

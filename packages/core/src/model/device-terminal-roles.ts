// Canonical terminal roles for the active devices whose electrodes are asymmetric, and the
// spellings that resolve to them.
//
// **Why this exists.** A resistor's two ends are interchangeable, so a consumer that reads them
// in the wrong order is still right. A transistor's are not: exchange a BJT's base and collector
// and the stage never turns on, exchange a triode's plate and cathode and a gain stage becomes a
// cathode follower, reverse a rectifier and it conducts on the wrong half-cycle. Each of those
// still *solves*, so the wrong answer is silent. The role therefore has to come from the
// document, and a consumer needs one declared vocabulary to read it by -- otherwise every
// consumer grows its own, and they drift. That is not hypothetical: the audio-engine consumer
// had accumulated roughly thirty private spelling sets for these same electrodes, two of which
// had already diverged from each other.
//
// **Per kind, not one flat table.** The same token means different electrodes on different
// devices, so a single global map would mis-bind. `c` is a BJT's collector and a tube's cathode.
// `plate` is a triode's anode and, on a `diode`-kind tube rectifier, its own thing. `input` and
// `output` name a FET's channel ends in one corpus convention and mean nothing on a tube. Keying
// the vocabulary by `ComponentKind` is what makes those coexist.
//
// **Survey this vocabulary was built from** -- 142 project documents, 26,016 terminals, counted
// by declaration:
//
//   triode      3 spellings   grid(136) plate(136) cathode(136)
//   pentode     6             grid(58) plate(58) screen(58) cathode(58) suppressor(12) heater(4)
//   tube-diode  6             plate_a(6) plate_b(6) heater_a(6) heater_b(6)
//                             cathode_filament(3) cathode(3)
//   jfet        6             gate(146) drain(146) source(146) input(2) control(2) output(2)
//   mosfet      5             drain(4) gate(4) source(4) bulk(2) body(1)
//   bjt        34             base(356) collector(356) emitter(357), then 31 singletons
//
// A triode uses exactly three spellings across 408 declarations: the vocabulary was already an
// enum, it just was not declared anywhere. The BJT tail is the informative part -- see
// `BJT_TERMINAL_ROLE_ALIASES` for what those 31 turn out to be, because none of them is a
// spelling of an electrode.
//
// **Canonical only -- there is deliberately no alias table.** An earlier draft of this module
// carried one, and it was wrong twice over. It accommodated spellings that a document should
// simply be corrected to stop using, which is the accretion channel this vocabulary exists to
// close rather than relocate; and most of its entries (`g`, `k`, `p`, `anode`, `g2`, `substrate`,
// ...) were exercised by nothing in the survey, which is speculative vocabulary against
// unexercised data. What the survey actually needs beyond the canonical tokens is **twelve
// declarations across five spellings**, every one of which is a document to fix:
//
//   jfet    input(2) control(2) output(2)   -> drain / gate / source
//   mosfet  body(1)                         -> bulk
//   diode   cathode_filament(3)             -> cathode
//
// An unrecognized verdict is therefore a **work item, not an accommodation**. That is what makes
// the vocabulary normative: a consumer reads one spelling per role, and a document that does not
// use it is reported rather than quietly translated.
//
// Like the potentiometer vocabulary next door, this never rewrites a document: a resolved role is
// always reported alongside the raw token the source used.

import type { ComponentKind } from "./types";
import { normalizeToken } from "./tokens";

/**
 * Electrode concepts across the covered kinds.
 *
 * One union rather than one type per kind, because `plate` on a triode and `plate` on a tube
 * rectifier are the same electrode. Which subset is legal for a given kind is
 * `DEVICE_TERMINAL_ROLES`.
 */
export type DeviceTerminalRole =
	// Vacuum devices.
	| "grid"
	| "screen"
	| "suppressor"
	| "plate"
	| "cathode"
	| "heater"
	// Bipolar.
	| "base"
	| "collector"
	| "emitter"
	// Field effect.
	| "gate"
	| "drain"
	| "source"
	| "bulk";

/** Kinds this module covers. Every other `ComponentKind` classifies as `out-of-scope`. */
export type RoledDeviceKind =
	| "triode"
	| "pentode"
	| "tube-diode"
	| "bjt"
	| "jfet"
	| "mosfet";

const ROLED_DEVICE_KINDS: ReadonlySet<string> = new Set<RoledDeviceKind>([
	"triode",
	"pentode",
	"tube-diode",
	"bjt",
	"jfet",
	"mosfet",
]);

/** Is this kind covered here? Narrows `ComponentKind` to {@link RoledDeviceKind}. */
export function isRoledDeviceKind(kind: string): kind is RoledDeviceKind {
	return ROLED_DEVICE_KINDS.has(kind);
}

/**
 * The roles each kind may carry.
 *
 * `heater` is listed for every vacuum device because a heater is a real electrode that a
 * document may declare; it carries no signal current, so a consumer is free to read it and do
 * nothing with it. What a consumer must not do is fail to recognise it -- that is how a declared
 * heater ends up bound as a signal electrode.
 */
export const DEVICE_TERMINAL_ROLES: Readonly<
	Record<RoledDeviceKind, readonly DeviceTerminalRole[]>
> = {
	triode: ["grid", "cathode", "plate", "heater"],
	pentode: ["grid", "screen", "suppressor", "cathode", "plate", "heater"],
	"tube-diode": ["plate", "cathode", "heater"],
	bjt: ["base", "collector", "emitter"],
	jfet: ["gate", "drain", "source"],
	mosfet: ["gate", "drain", "source", "bulk"],
};

/**
 * Electrodes that may legitimately appear more than once on one component, and therefore need an
 * index in the terminal name.
 *
 * **This is forced by the format, not a spelling preference.** A terminal name is the pin's
 * identity -- the `nodes:` ledger references it as `<component>.<terminal>` -- so core rejects two
 * terminals sharing a name (`pin "V1.plate" already belongs to node 1`). Every tube rectifier in
 * the survey is a dual, two plates on one directly heated cathode, so it *cannot* name both plates
 * `plate`. `plate_a`/`plate_b` are the canonical indexed form of one role, not two spellings of it.
 *
 * A heater is listed for the same reason: its two ends are one electrode. Whether a repetition is
 * meaningful is the consuming device law's question; this only says the name is well-formed.
 */
export const INDEXABLE_DEVICE_TERMINAL_ROLES: ReadonlySet<DeviceTerminalRole> =
	new Set<DeviceTerminalRole>(["plate", "heater", "grid", "cathode"]);

/** A one-token index suffix: `a`..`d` or `1`..`9`. Anything else is not an index. */
const INDEX_PATTERN = /^(?:[a-d]|[1-9])$/;

/**
 * Tokens that name a terminal without naming an electrode.
 *
 * Same principle as the potentiometer module's ambiguous ends: there is nothing to correct in
 * `a`, it is simply under-specified, so it resolves to no role rather than to a guessed one. An
 * author fixes one by writing which electrode it is.
 *
 * `a` matters here beyond the general case: it is standard notation for a tube's anode *and* the
 * first of two unordered ends, and a two-terminal component in this corpus is routinely spelled
 * `a`/`b`. Resolving it to `plate` would silently orient every device that used it positionally.
 *
 * Note these are whole tokens. `plate-a` is not ambiguous: its head names the electrode and the
 * `a` is an index, which is a different thing from `a` standing alone.
 */
export const AMBIGUOUS_DEVICE_TERMINAL_TOKENS: ReadonlySet<string> = new Set([
	"a",
	"b",
	"x",
	"y",
	"end",
	"end1",
	"end2",
	"lead1",
	"lead2",
	"left",
	"right",
	"top",
	"bottom",
	"one",
	"two",
	"three",
	// A heater tap and a directly heated cathode are both "the filament"; which one a bare
	// `filament` means is exactly what a consumer must not guess.
	"filament",
]);

/**
 * A bare physical pin number, carrying position and no semantics.
 *
 * `pin7` of an unknown package names where a wire lands, not what the electrode does, so it is
 * neither a role nor a misspelling of one -- a distinct verdict rather than `unrecognized`,
 * because a document that numbers its pins is doing something legitimate that a consumer may be
 * able to use via the package's pinout. Matches `pin7`, `p7`, `terminal4`, `lug2`, `7`.
 */
const PACKAGE_PIN_PATTERN = /^(?:pin|p|terminal|lug|t)?-?\d{1,3}$/;

export type DeviceTerminalRoleVerdict =
	| {
			readonly status: "canonical";
			readonly role: DeviceTerminalRole;
			/** Set when the name carried an index, as a dual rectifier's plates must. */
			readonly index?: string;
	  }
	| { readonly status: "ambiguous" }
	| { readonly status: "package-pin"; readonly pin: number }
	| { readonly status: "unrecognized" }
	| { readonly status: "out-of-scope" };

/**
 * Classify one terminal name against a device kind's vocabulary.
 *
 * A kind this module does not cover returns `out-of-scope` rather than `unrecognized`: the two
 * mean different things to a caller, and conflating them would report every resistor as a defect.
 */
export function classifyDeviceTerminalRole(
	kind: ComponentKind | string,
	terminalName: string,
): DeviceTerminalRoleVerdict {
	if (!isRoledDeviceKind(kind)) {
		return { status: "out-of-scope" };
	}
	const token = normalizeToken(terminalName);
	const legal = DEVICE_TERMINAL_ROLES[kind];
	if ((legal as readonly string[]).includes(token)) {
		return { status: "canonical", role: token as DeviceTerminalRole };
	}
	// An indexed electrode: `plate-a` is one role plus a distinguishing suffix, which the format
	// forces because a pin name must be unique within its component.
	const split = token.lastIndexOf("-");
	if (split > 0) {
		const head = token.slice(0, split);
		const index = token.slice(split + 1);
		if (
			(legal as readonly string[]).includes(head) &&
			INDEXABLE_DEVICE_TERMINAL_ROLES.has(head as DeviceTerminalRole) &&
			INDEX_PATTERN.test(index)
		) {
			return { status: "canonical", role: head as DeviceTerminalRole, index };
		}
	}
	// Ambiguity is checked before the pin pattern so a token that is both (`a`, `b`) reports the
	// more informative verdict: it names an end, it just does not say which.
	if (AMBIGUOUS_DEVICE_TERMINAL_TOKENS.has(token)) {
		return { status: "ambiguous" };
	}
	if (PACKAGE_PIN_PATTERN.test(token)) {
		const digits = /\d{1,3}$/.exec(token);
		return { status: "package-pin", pin: Number(digits?.[0] ?? "0") };
	}
	return { status: "unrecognized" };
}

/**
 * Every role a component's terminals resolve to, keyed by the raw name the document used.
 *
 * Deliberately **not** a completeness verdict. The potentiometer resolver can say `complete`
 * because a pot has exactly three roles exactly once; these kinds do not share one arity -- a
 * dual rectifier carries two plates, a ganged tube envelope carries two grids, and a MOSFET's
 * substrate is optional. Whether a given component's set is sufficient is the consuming device
 * law's question, and answering it here would bake one law's expectations into the format.
 */
export function resolveComponentTerminalRoles(
	kind: ComponentKind | string,
	terminalNames: readonly string[],
): ReadonlyMap<string, DeviceTerminalRole> {
	const resolved = new Map<string, DeviceTerminalRole>();
	for (const name of terminalNames) {
		const verdict = classifyDeviceTerminalRole(kind, name);
		if (verdict.status === "canonical") {
			resolved.set(name, verdict.role);
		}
	}
	return resolved;
}

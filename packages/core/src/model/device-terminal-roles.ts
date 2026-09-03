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
 * Electrodes that may legitimately appear more than once on one component, so their pin names
 * carry a distinguishing suffix.
 *
 * **Forced by the format, not a spelling preference.** A terminal name is the pin's identity --
 * the `nodes:` ledger references it as `<component>.<terminal>` -- so core rejects two terminals
 * sharing a name (`pin "V1.plate" already belongs to node 1`). Every tube rectifier in the survey
 * is a dual, two plates on one directly heated cathode, so it cannot name both plates `plate`.
 *
 * The suffix distinguishes the name and means nothing by itself. Which device inside a package a
 * pin belongs to is stated by that device's own terminal list, which refers to pins by name.
 */
export const SUFFIXABLE_DEVICE_TERMINAL_ROLES: ReadonlySet<DeviceTerminalRole> =
	new Set<DeviceTerminalRole>(["plate", "heater", "grid", "cathode"]);

/** A one-token name suffix: `a`..`d` or `1`..`9`. */
const NAME_SUFFIX_PATTERN = /^(?:[a-d]|[1-9])$/;

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
	| { readonly status: "canonical"; readonly role: DeviceTerminalRole }
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
	// A suffixed electrode: `plate-a` and `plate-b` are two pins carrying the same role, which the
	// format forces because a pin name must be unique within its component. The suffix
	// distinguishes the *name*; it carries no meaning of its own, so the verdict is just the role.
	const split = token.lastIndexOf("-");
	if (split > 0) {
		const head = token.slice(0, split);
		if (
			(legal as readonly string[]).includes(head) &&
			SUFFIXABLE_DEVICE_TERMINAL_ROLES.has(head as DeviceTerminalRole) &&
			NAME_SUFFIX_PATTERN.test(token.slice(split + 1))
		) {
			return { status: "canonical", role: head as DeviceTerminalRole };
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

// ---------------------------------------------------------------------------
// The `role` field contract (0.6.28)
//
// Everything above infers a role from a terminal's *name*, which was the wrong layer: a name is
// the pin's identity in the `nodes:` ledger, and loading it with semantics is what made every
// consumer grow a spelling table. A terminal carries its role in its own typed field instead, and
// the name goes back to being whatever the transcriber read off the page.
//
// The inference above does not go away -- it is how 26,016 existing terminals get a `role` written
// into them without a human typing each one. It is a migration reader, not the contract.
//
// **Every terminal has a role, so the vocabulary must cover every kind.** That forces two values
// that look like escape hatches and are not:
//
//   `pin`  -- an opaque part's numbered pin. Pin 7 of an unknown IC has no electrode meaning;
//             saying `pin` is a true statement about it, where inventing a role would not be.
//             2,648 `ic` terminals across 1,566 spellings are this, and no enum can absorb them.
//   `end`  -- one of two interchangeable ends. A resistor genuinely has no first or second
//             terminal, so `end` twice on one component is correct rather than under-specified.
//             This is why a role need not be unique within a component while a *name* must be.
// ---------------------------------------------------------------------------

/** Every role a terminal may declare, across every component kind. */
export type TerminalRole =
	// Interchangeable ends, and stated polarity where a part has it.
	| "end"
	| "positive"
	| "negative"
	// Junction.
	| "anode"
	| "cathode"
	// Bipolar.
	| "base"
	| "collector"
	| "emitter"
	// Field effect.
	| "gate"
	| "drain"
	| "source"
	| "bulk"
	// Vacuum. (`cathode` is shared with the junction group.)
	| "grid"
	| "screen"
	| "suppressor"
	| "plate"
	| "heater"
	// Amplifier signal and support pins.
	| "nonInverting"
	| "inverting"
	| "output"
	| "supplyPositive"
	| "supplyNegative"
	| "bias"
	| "compensation"
	| "balance"
	// Potentiometer sweep, matching `PotentiometerTerminalRole`.
	| "ccw"
	| "wiper"
	| "cw"
	// Connectors.
	| "tip"
	| "ring"
	| "sleeve"
	| "send"
	| "return"
	| "switchContact"
	// Magnetics. Which winding a terminal belongs to is structure, not a role -- see the
	// transformer note in `TERMINAL_ROLES_BY_KIND`.
	| "winding"
	| "windingTap"
	| "shield"
	// Mechanical contacts.
	| "common"
	| "throw"
	| "coil"
	// Circuit reference.
	| "ground"
	// An opaque part's numbered pin: position, no semantics.
	| "pin";

const TWO_TERMINAL: readonly TerminalRole[] = ["end", "positive", "negative"];
const SUPPLY: readonly TerminalRole[] = [
	"positive",
	"negative",
	"ground",
	"end",
];
const OPAMP: readonly TerminalRole[] = [
	"nonInverting",
	"inverting",
	"output",
	"supplyPositive",
	"supplyNegative",
	"bias",
	"compensation",
	"balance",
	"pin",
];

/**
 * Which roles each kind may declare.
 *
 * **`transformer` and `switch` are deliberately coarse.** A transformer terminal's role is that it
 * is a winding end or a tap; *which* winding it belongs to is membership, which a flat role cannot
 * express and which the 107 spellings in the survey are currently carrying inside names
 * (`hv_red_a_345vac`). That needs a winding construct; until it exists, `winding`/`windingTap`
 * states what is true without pretending to state the grouping. `switch` is the same shape: 232
 * spellings naming what each contact connects to.
 *
 * Kinds that are not electrical devices (`label`, `named-wire`, `port`, `unsupported`) take `pin`,
 * since their terminals are attachment points rather than electrodes.
 */
export const TERMINAL_ROLES_BY_KIND: Readonly<
	Record<string, readonly TerminalRole[]>
> = {
	resistor: TWO_TERMINAL,
	"variable-resistor": [...TWO_TERMINAL, "wiper"],
	capacitor: TWO_TERMINAL,
	inductor: TWO_TERMINAL,
	diode: [...TWO_TERMINAL, "anode", "cathode", "plate", "heater"],
	led: ["anode", "cathode", "end"],
	bjt: ["base", "collector", "emitter", "pin"],
	jfet: ["gate", "drain", "source", "pin"],
	mosfet: ["gate", "drain", "source", "bulk", "pin"],
	triode: ["grid", "cathode", "plate", "heater"],
	pentode: ["grid", "screen", "suppressor", "cathode", "plate", "heater"],
	"tube-diode": ["plate", "cathode", "heater"],
	opamp: OPAMP,
	ota: OPAMP,
	comparator: OPAMP,
	potentiometer: ["ccw", "wiper", "cw", "end"],
	jack: [
		"tip",
		"ring",
		"sleeve",
		"send",
		"return",
		"switchContact",
		"ground",
		"positive",
		"negative",
		"pin",
	],
	transformer: ["winding", "windingTap", "shield"],
	switch: ["common", "throw", "coil", "pin"],
	selector: ["common", "throw", "coil", "pin"],
	"analog-switch": ["common", "throw", "coil", "pin"],
	optocoupler: ["anode", "cathode", "end", "pin"],
	"voltage-source": SUPPLY,
	"current-source": SUPPLY,
	battery: SUPPLY,
	rail: SUPPLY,
	ground: ["ground"],
	// Opaque parts: pins are data, and which subset carries executable meaning is a separate
	// declared interface rather than a role.
	ic: ["pin"],
	bbd: ["pin"],
	"delay-ic": ["pin"],
	regulator: ["pin", "positive", "negative", "ground"],
	"power-converter": ["pin", "positive", "negative", "ground"],
	"power-amp": ["pin", "nonInverting", "inverting", "output"],
	flipflop: ["pin"],
	// Not electrical devices; their terminals are attachment points.
	label: ["pin"],
	"named-wire": ["pin"],
	port: ["pin", "end"],
	unsupported: ["pin"],
};

/** Is `role` a legal declaration for a component of `kind`? */
export function isLegalTerminalRole(
	kind: ComponentKind | string,
	role: string,
): role is TerminalRole {
	return (TERMINAL_ROLES_BY_KIND[kind] ?? []).includes(role as TerminalRole);
}

/** The roles `kind` accepts, or an empty list for a kind with no declared vocabulary. */
export function terminalRolesFor(
	kind: ComponentKind | string,
): readonly TerminalRole[] {
	return TERMINAL_ROLES_BY_KIND[kind] ?? [];
}

/**
 * Diagnostics for the `role` field: one for a role a kind cannot carry, one for a terminal that
 * declares none.
 *
 * **Both are warnings, and the missing-role one is the whole migration.** The format requires a
 * role on every terminal, but 26,016 terminals were written before the field existed, so refusing
 * a document without one would refuse the entire corpus. Reporting instead makes the backfill
 * measurable — the warning count is the work remaining — and lets it proceed document by
 * document. Tighten to a refusal once the count reaches zero.
 *
 * An **illegal** role is a different thing and is always the document's error: `screen` on a
 * triode, or `wiper` on a diode, is a claim the kind cannot support.
 */
export function collectTerminalRoleWarnings(
	components: readonly {
		readonly id: string;
		readonly kind: string;
		readonly terminals: readonly {
			readonly name: string;
			readonly role?: string;
		}[];
	}[],
): readonly {
	readonly code: "terminal-role-illegal" | "terminal-role-missing";
	readonly message: string;
	readonly componentId: string;
}[] {
	const warnings: {
		code: "terminal-role-illegal" | "terminal-role-missing";
		message: string;
		componentId: string;
	}[] = [];
	for (const component of components) {
		const legal = terminalRolesFor(component.kind);
		for (const terminal of component.terminals) {
			if (terminal.role === undefined) {
				warnings.push({
					code: "terminal-role-missing",
					message: `terminal "${terminal.name}" declares no role; ${component.kind} terminals must declare one of: ${legal.join(", ") || "(no vocabulary for this kind)"}`,
					componentId: component.id,
				});
				continue;
			}
			if (!isLegalTerminalRole(component.kind, terminal.role)) {
				warnings.push({
					code: "terminal-role-illegal",
					message: `terminal "${terminal.name}" declares role "${terminal.role}", which a ${component.kind} cannot carry; legal roles: ${legal.join(", ") || "(none)"}`,
					componentId: component.id,
				});
			}
		}
	}
	return warnings;
}

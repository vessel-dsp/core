// Canonical potentiometer terminal roles, and the spellings that resolve to them.
//
// A potentiometer's two ends are only meaningful as a *rotational* pair: which end
// the wiper travels toward as the shaft turns clockwise. A consumer needs that to
// know which way a control sweeps, and it cannot be recovered from the schematic --
// a symbol's terminal positions say which end is drawn where, not which way the
// shaft turns. So a consumer that infers it from topology or geometry produces a
// control that sweeps backwards on some documents, silently.
//
// Survey of the fixture corpus (54 documents, 65 potentiometers):
//
//   2  `.vdsp`  [1, 2, 3]        lug numbers -- carries the answer by convention
//  63  `.schx`  [a, wiper, b]    names an end without naming its rotation
//   0            cw / ccw
//
// The 63 matter less than they look: those names are core's own catalog
// (`formats/schx/catalog.ts`), because LiveSPICE files do not name pot terminals.
// They are not author drift, and warning an author about a token core invented
// would be noise.
//
// This module therefore resolves what is resolvable and refuses the rest. Lug
// numbers and spelling variants normalize silently -- the common cases cost an
// author nothing. `a`/`b` resolve to no role at all: `complete` stays false and a
// diagnostic says the source does not carry the semantics, which is the truthful
// answer and the one that stops each consumer inventing its own guess.
//
// Like the `sourceTypeName` vocabulary, this is data, not policy. It never
// rewrites a document; the resolved role is reported alongside the raw token.

import type { CircuitDocument, Component, Warning } from "./types";
import { normalizeToken } from "./tokens";

/**
 * Canonical potentiometer terminal roles.
 *
 * `ccw` and `cw` are the ends the wiper travels toward as the shaft turns
 * counter-clockwise and clockwise. Rotation, not position: it stays true under any
 * symbol orientation, mirroring or board rotation.
 */
export type PotentiometerTerminalRole = "ccw" | "wiper" | "cw";

export const POTENTIOMETER_TERMINAL_ROLES: readonly PotentiometerTerminalRole[] = [
	"ccw",
	"wiper",
	"cw",
];

/**
 * Spellings that resolve to a canonical role, keyed by normalized token.
 *
 * Every entry is a spelling of one of the three concepts, never a fourth concept.
 * Lug numbers are included because the physical numbering is standard: lug 1 is the
 * counter-clockwise end, lug 2 the wiper, lug 3 the clockwise end.
 */
export const POTENTIOMETER_TERMINAL_ROLE_ALIASES: ReadonlyMap<
	string,
	PotentiometerTerminalRole
> = new Map([
	// Canonical.
	["ccw", "ccw"],
	["wiper", "wiper"],
	["cw", "cw"],

	// Physical lug numbering.
	["1", "ccw"],
	["2", "wiper"],
	["3", "cw"],
	["lug1", "ccw"],
	["lug2", "wiper"],
	["lug3", "cw"],
	["lug-1", "ccw"],
	["lug-2", "wiper"],
	["lug-3", "cw"],
	["pin1", "ccw"],
	["pin2", "wiper"],
	["pin3", "cw"],
	["pin-1", "ccw"],
	["pin-2", "wiper"],
	["pin-3", "cw"],
	["terminal1", "ccw"],
	["terminal2", "wiper"],
	["terminal3", "cw"],
	["terminal-1", "ccw"],
	["terminal-2", "wiper"],
	["terminal-3", "cw"],

	// Spellings of the counter-clockwise end.
	["counterclockwise", "ccw"],
	["counter-clockwise", "ccw"],
	["anticlockwise", "ccw"],
	["anti-clockwise", "ccw"],
	["acw", "ccw"],
	["ccw-end", "ccw"],

	// Spellings of the clockwise end.
	["clockwise", "cw"],
	["cw-end", "cw"],

	// Spellings of the wiper.
	["w", "wiper"],
	["wpr", "wiper"],
	["wip", "wiper"],
	["slider", "wiper"],
	["tap", "wiper"],
	["center-tap", "wiper"],
	["centre-tap", "wiper"],
]);

/**
 * Tokens that name one of the two ends without saying which rotation it is.
 *
 * These are not misspellings -- there is nothing to correct in `a`. They are
 * under-specified, so they resolve to no role rather than to a guessed one. An
 * author fixes one by writing which end the shaft turns toward.
 */
export const AMBIGUOUS_POTENTIOMETER_END_TOKENS: ReadonlySet<string> = new Set([
	"a",
	"b",
	"end",
	"end1",
	"end2",
	"end-1",
	"end-2",
	"x",
	"y",
	"0",
	"left",
	"right",
	"top",
	"bottom",
	"start",
	"finish",
	"in",
	"out",
	"input",
	"output",
]);

export type PotentiometerTerminalRoleVerdict =
	| {
			readonly status: "canonical";
			readonly role: PotentiometerTerminalRole;
	  }
	| { readonly status: "alias"; readonly role: PotentiometerTerminalRole }
	| { readonly status: "ambiguous" }
	| { readonly status: "unrecognized" };

/** Classify one potentiometer terminal name. */
export function classifyPotentiometerTerminalRole(
	terminalName: string,
): PotentiometerTerminalRoleVerdict {
	const token = normalizeToken(terminalName);
	const role = POTENTIOMETER_TERMINAL_ROLE_ALIASES.get(token);
	if (role !== undefined) {
		return token === role
			? { status: "canonical", role }
			: { status: "alias", role };
	}
	if (AMBIGUOUS_POTENTIOMETER_END_TOKENS.has(token)) {
		return { status: "ambiguous" };
	}
	return { status: "unrecognized" };
}

export type PotentiometerTerminalRoleResolution = Readonly<{
	componentId: string;
	/**
	 * Canonical role per source terminal name. The key is the raw token as the
	 * document spelled it, so the map is its own traceability record: nothing is
	 * rewritten, and a consumer can always get back to what the source said.
	 */
	roles: ReadonlyMap<string, PotentiometerTerminalRole>;
	/** Source terminal name per canonical role -- the reverse lookup. */
	terminals: ReadonlyMap<PotentiometerTerminalRole, string>;
	/**
	 * True only when `ccw`, `wiper` and `cw` each resolved exactly once.
	 *
	 * False means the source does not carry the sweep direction. Do not infer it:
	 * read `diagnostics` and report, or ask the author.
	 */
	complete: boolean;
	diagnostics: readonly Warning[];
}>;

/**
 * Resolve a potentiometer's terminal roles, or `null` for a component that has no
 * rotational ends to resolve.
 *
 * Refuses rather than guesses. A terminal naming an end without its rotation
 * contributes no role, and two terminals claiming the same role cancel: an
 * incomplete resolution is reported, never completed by inference.
 */
export function resolvePotentiometerTerminalRoles(
	component: Component,
): PotentiometerTerminalRoleResolution | null {
	if (component.kind !== "potentiometer") return null;

	const roles = new Map<string, PotentiometerTerminalRole>();
	const claims = new Map<PotentiometerTerminalRole, string[]>();
	const diagnostics: Warning[] = [];

	for (const terminal of component.terminals) {
		const verdict = classifyPotentiometerTerminalRole(terminal.name);
		if (verdict.status === "ambiguous") {
			diagnostics.push({
				code: "potentiometer-terminal-role-ambiguous",
				message: `terminal "${terminal.name}" names an end of ${component.id} without saying which way the shaft turns toward it. Write "cw" or "ccw" (or lug numbers 1/2/3); rotation cannot be recovered from the schematic.`,
				componentId: component.id,
			});
			continue;
		}
		if (verdict.status === "unrecognized") {
			diagnostics.push({
				code: "potentiometer-terminal-role-unrecognized",
				message: `terminal "${terminal.name}" on ${component.id} is not a recognised potentiometer terminal role. Expected "ccw", "wiper" or "cw", a lug number 1/2/3, or a known spelling of one of those.`,
				componentId: component.id,
			});
			continue;
		}
		roles.set(terminal.name, verdict.role);
		claims.set(verdict.role, [
			...(claims.get(verdict.role) ?? []),
			terminal.name,
		]);
	}

	const terminals = new Map<PotentiometerTerminalRole, string>();
	for (const [role, names] of claims) {
		const [first, ...rest] = names;
		if (first === undefined) continue;
		if (rest.length > 0) {
			diagnostics.push({
				code: "potentiometer-terminal-role-duplicate",
				message: `terminals ${names.map((name) => `"${name}"`).join(", ")} on ${component.id} all resolve to role "${role}". One terminal per role; the duplicate claims are dropped rather than ordered arbitrarily.`,
				componentId: component.id,
			});
			for (const name of names) roles.delete(name);
			continue;
		}
		terminals.set(role, first);
	}

	return {
		componentId: component.id,
		roles,
		terminals,
		complete: POTENTIOMETER_TERMINAL_ROLES.every((role) =>
			terminals.has(role),
		),
		diagnostics,
	};
}

/** Resolve every potentiometer in a document, in document order. */
export function resolveDocumentPotentiometerTerminalRoles(
	document: CircuitDocument,
): readonly PotentiometerTerminalRoleResolution[] {
	const out: PotentiometerTerminalRoleResolution[] = [];
	for (const component of document.components) {
		const resolution = resolvePotentiometerTerminalRoles(component);
		if (resolution !== null) out.push(resolution);
	}
	return out;
}

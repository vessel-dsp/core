// A transformer's windings: which of its terminals form each coil.
//
// **Why this is not a use of `devices`.** A package holding several devices is one construct; a
// transformer is the opposite claim -- *one* device whose coils are magnetically coupled, so
// modelling each winding as a device would say they are independent. They are the sibling
// constructs `docs/device-construct-design.md` names, and this is the second one.
//
// **What names were carrying.** Measured over 55 corpus transformers with 38 distinct terminal
// shapes, winding membership and tap position live entirely inside terminal names:
//
//   primary_a primary_ct primary_b hv_a hv_center_tap hv_b rectifier_heater_a ... filament_a ...
//   primary_top primary_ct primary_bottom secondary_100v secondary_15ohm secondary_7r5ohm ...
//   primary_black primary_white hv_red_a_345vac hv_center_tap_rd_blu low_voltage_brn_a_140vac ...
//
// A consumer therefore reconstructs the grouping from spelling -- 110 table entries in 822 lines
// of one file -- and a spelling it does not know silently becomes a winding of its own or a
// refusal. `secondary_16`/`secondary_8`/`secondary_4` are three taps on one coil, and only the
// names say so.
//
// **Ends and taps are told apart by each terminal's own role**, `winding` against `windingTap` or
// `windingCenterTap`,
// which the terminal vocabulary already carries. A winding entry therefore needs nothing but its
// role and its terminals in coil order.

import type {
	Component,
	ComponentWinding,
	Terminal,
	WindingRole,
} from "./types";

export const WINDING_ROLES: readonly WindingRole[] = [
	"primary",
	"secondary",
	"hv",
	"filament",
	"rectifier-heater",
	"bias",
	"low-voltage",
	"auxiliary",
	"drive",
	"pickup",
];

export type WindingIssue = Readonly<{
	code: string;
	severity: "error" | "warning";
	message: string;
	componentId: string;
}>;

/**
 * Whether a declared winding list is well-formed.
 *
 * **What is deliberately not checked**: whether a transformer has the *right* windings for its
 * job, or whether a turns ratio follows. A two-winding output transformer and a five-winding power
 * transformer are both valid, and how many a given amp needs is the consuming model's question.
 *
 * A single-terminal winding is a **warning, not an error**: a bias tap whose return is internally
 * grounded really does declare one terminal, and the corpus has one. It is reported because a
 * consumer cannot complete the coil from the declaration alone.
 */
export function validateComponentWindings(
	component: Component,
): readonly WindingIssue[] {
	const windings = component.windings;
	if (windings === undefined || windings.length === 0) return [];
	const issues: WindingIssue[] = [];
	const byName = new Map<string, Terminal>(
		component.terminals.map((terminal) => [terminal.name, terminal] as const),
	);
	const seenIds = new Set<string>();
	const claimed = new Set<string>();

	for (const winding of windings) {
		const label = winding.id ?? winding.role;
		if (winding.id !== undefined) {
			if (seenIds.has(winding.id)) {
				issues.push({
					code: "winding-id-duplicate",
					severity: "error",
					message: `winding "${winding.id}" is declared more than once`,
					componentId: component.id,
				});
			}
			seenIds.add(winding.id);
		}
		if (!WINDING_ROLES.includes(winding.role)) {
			issues.push({
				code: "winding-role-unknown",
				severity: "error",
				message: `winding "${label}" declares role "${winding.role}"; legal roles: ${WINDING_ROLES.join(", ")}`,
				componentId: component.id,
			});
		}
		if (winding.terminals.length === 0) {
			issues.push({
				code: "winding-empty",
				severity: "error",
				message: `winding "${label}" names no terminals`,
				componentId: component.id,
			});
		} else if (winding.terminals.length === 1) {
			issues.push({
				code: "winding-single-ended",
				severity: "warning",
				message: `winding "${label}" names one terminal, so its coil cannot be completed from the declaration; a bias tap with an internally grounded return is the legitimate case`,
				componentId: component.id,
			});
		}
		const seenHere = new Set<string>();
		for (const name of winding.terminals) {
			if (!byName.has(name)) {
				issues.push({
					code: "winding-terminal-unknown",
					severity: "error",
					message: `winding "${label}" names terminal "${name}", which this component does not declare`,
					componentId: component.id,
				});
				continue;
			}
			if (seenHere.has(name)) {
				issues.push({
					code: "winding-terminal-repeated",
					severity: "error",
					message: `winding "${label}" names terminal "${name}" twice`,
					componentId: component.id,
				});
			}
			seenHere.add(name);
			// A terminal on two coils would be a shared conductor, which a transformer does not
			// have: its windings are magnetically coupled, not electrically joined. An autotransformer
			// is the exception and is declared as one tapped winding, not two overlapping ones.
			if (claimed.has(name)) {
				issues.push({
					code: "winding-terminal-shared",
					severity: "error",
					message: `terminal "${name}" is claimed by more than one winding; coupled coils share no conductor, and an autotransformer is one tapped winding rather than two`,
					componentId: component.id,
				});
			}
			claimed.add(name);
		}
	}

	for (const terminal of component.terminals) {
		// A shield is deliberately not a coil: it is a grounded foil between windings, and
		// `role: shield` on the terminal is the whole statement. Warning that nothing couples it
		// would ask for a winding entry that would be false.
		if (terminal.role === "shield") continue;
		if (!claimed.has(terminal.name)) {
			issues.push({
				code: "winding-terminal-orphaned",
				severity: "warning",
				message: `terminal "${terminal.name}" belongs to no winding, so nothing couples it`,
				componentId: component.id,
			});
		}
	}
	return issues;
}

/** The winding a terminal belongs to, or null. Keyed by terminal name. */
export function windingOfTerminal(
	component: Component,
	terminalName: string,
): ComponentWinding | null {
	for (const winding of component.windings ?? []) {
		if (winding.terminals.includes(terminalName)) return winding;
	}
	return null;
}

/**
 * A winding's ends and taps, split by each terminal's own declared role.
 *
 * `ends` keeps coil order, so the first and last are the coil's extremes where a document declares
 * two. `taps` likewise, so a consumer reading `secondary_4`/`secondary_8`/`secondary_16` gets them
 * in ascending position rather than in whatever order a name sorted.
 */
export function windingEndsAndTaps(
	component: Component,
	winding: ComponentWinding,
): { readonly ends: readonly string[]; readonly taps: readonly string[] } {
	const roleOf = new Map(
		component.terminals.map((terminal) => [terminal.name, terminal.role] as const),
	);
	const ends: string[] = [];
	const taps: string[] = [];
	for (const name of winding.terminals) {
		const role = roleOf.get(name);
		(role === "windingTap" || role === "windingCenterTap" ? taps : ends).push(name);
	}
	return { ends, taps };
}

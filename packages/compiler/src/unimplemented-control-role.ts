import type { CompileWarning, Control } from "./types";

/**
 * **A control the engine has no law for — declared, accepted, and silently ignored.**
 *
 * This is a THIRD kind of dead control and neither existing instrument can see it:
 *
 * - it is **not** `control-cannot-affect-circuit`, because the control is structurally sound —
 *   bound to real devices, the devices connected, the region scheduled;
 * - it is **not** on the panel, because `isPlayableUserControl` filters `role: power` out, which
 *   is correct on its own terms: a mains switch is not a tone control.
 *
 * **Two independently-correct filters, and the defect sits behind both.** It was found only by a
 * render sweep, measured 2026-09-12: every declared power switch in the corpus moves the rendered
 * level by **0.00 dB** at both extremes —
 *
 * | amp | control | declared default | swing |
 * |---|---|---|---|
 * | `fender-5e3-deluxe-tweed` | `SRC_AC_SWITCH` | 0 (off) | 0.00 dB |
 * | `fender-bassman` | `S_AC_POWER` | 1 | 0.00 dB |
 * | `marshall-jtm45` | `S_POWER_SWITCH` | 0 (off) | 0.00 dB |
 * | `orange-gro100` | `S_POWER` | 0 (off) | 0.00 dB |
 * | `peavey-5150` | `S_MAINS_POWER` | 1 | 0.00 dB |
 * | `trainwreck-express` | `S_POWER_SWITCH` | 0 (off) | 0.00 dB |
 *
 * **Four of the six declare the amp OFF and render audibly anyway.**
 *
 * **This warns; it does not change audio.** Implementing the law is the right fix and is queued
 * separately, because it cannot land alone: with these defaults, a working power switch would
 * silence four amps, which would read as a catastrophic regression while being correct behaviour
 * on a wrong default.
 */
const ROLES_WITHOUT_A_LAW: ReadonlySet<string> = new Set(["power"]);

export function findUnimplementedControlRoles(
	controls: readonly Control[],
): readonly CompileWarning[] {
	const warnings: CompileWarning[] = [];
	for (const control of controls) {
		const role = control.role;
		if (role === undefined || role === null) continue;
		if (!ROLES_WITHOUT_A_LAW.has(role)) continue;
		warnings.push({
			code: "control-role-not-implemented",
			control: control.id,
			role,
			// **The claim is about the ENGINE, not about this control.** No law exists for the role,
			// so the position cannot matter -- that is a fact about lowering and holds for every
			// packet. The 0.00 dB SWING was measured on the six amp power switches only, and is
			// cited as corroboration rather than asserted of the seven `role: power` DC jacks that
			// were never swept.
			detail:
				`control "${control.id}" declares role \`${role}\`, which this engine implements no ` +
				"law for: it is accepted, carried through lowering, and then ignored, so its " +
				`position cannot change the output. This packet declares it at ${control.defaultPosition}` +
				(control.defaultPosition === 0
					? " -- OFF -- and the packet still renders audibly, so a powered-off device is being rendered as though it were on."
					: ".") +
				" (Corroborated by measurement on the six amp power switches, 2026-09-12: 0.00 dB" +
				" swing at both extremes. The DC-input jacks carrying this role were not swept.)",
		});
	}
	return warnings;
}

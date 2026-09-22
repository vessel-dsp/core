import { describe, expect, test } from "bun:test";
import {
	collectTerminalRoleWarnings,
	isLegalTerminalRole,
	terminalRolesFor,
} from "../../packages/core/src";

/**
 * A reprogrammable or opaque chip's analog audio boundary is a fact the drawing knows and the
 * format could not state. `Component.program` (0.8.0) says what the chip computes; it says
 * nothing about which two pins the guitar signal enters and leaves by, and every consumer of a
 * `law: open` chip needs that second fact to wire it into a signal chain at all.
 *
 * Before 0.8.1 the only way to supply it was a table keyed on the part number, which is both the
 * workaround the `input` role was defined to remove and the wrong key for shared silicon:
 * `TC25SC080AU-104` is three different effects across three pedals.
 */
const chip = (role: string) => ({
	id: "U1",
	kind: "ic" as const,
	name: "U1",
	sourceTypeName: null,
	origin: { x: 0, y: 0 },
	rotation: 0,
	flipped: false,
	properties: {},
	terminals: [
		{ name: "audio in", role, node: 0, position: { x: 0, y: 0 } },
		{ name: "pin2_VDD", role: "pin", node: 1, position: { x: 1, y: 0 } },
	],
});

describe("an opaque chip can name its audio boundary", () => {
	test("ic, bbd and delay-ic admit input and output", () => {
		for (const kind of ["ic", "bbd", "delay-ic"] as const) {
			expect(isLegalTerminalRole(kind, "input")).toBe(true);
			expect(isLegalTerminalRole(kind, "output")).toBe(true);
			// `pin` stays legal and stays the default: the pins a design does not know about must
			// keep making no claim.
			expect(isLegalTerminalRole(kind, "pin")).toBe(true);
			expect(terminalRolesFor(kind)).toContain("pin");
		}
	});

	test("a chip declaring its audio pins raises no warning", () => {
		expect(collectTerminalRoleWarnings([chip("input")])).toEqual([]);
		expect(collectTerminalRoleWarnings([chip("output")])).toEqual([]);
		expect(collectTerminalRoleWarnings([chip("pin")])).toEqual([]);
	});

	test("the widening is these three kinds, not the vocabulary", () => {
		// Negative control in the other direction. If this ever passes, the change stopped being
		// "an opaque chip may name its audio boundary" and became "roles are advisory".
		expect(isLegalTerminalRole("ic", "gate")).toBe(false);
		expect(isLegalTerminalRole("ic", "nonInverting")).toBe(false);
		expect(isLegalTerminalRole("ic", "wiper")).toBe(false);

		// `flipflop` is the same shape of opaque part and was deliberately left alone: nothing in
		// the corpus needs to name a flip-flop's data pins, and a role admitted speculatively is a
		// claim nobody checked.
		expect(isLegalTerminalRole("flipflop", "input")).toBe(false);
	});

	test("an illegal role on a chip still reports which roles are legal", () => {
		const warnings = collectTerminalRoleWarnings([chip("wiper")]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe("terminal-role-illegal");
		expect(warnings[0]?.message).toContain("input");
		expect(warnings[0]?.message).toContain("output");
	});
});

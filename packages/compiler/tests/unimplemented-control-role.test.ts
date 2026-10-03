import { describe, expect, test } from "bun:test";
import { findUnimplementedControlRoles } from "../src/unimplemented-control-role";
import type { Control } from "../src/types";

const control = (id: string, role: string | undefined, defaultPosition = 0.5) =>
	({ id, role, defaultPosition, label: id }) as unknown as Control;

/**
 * **The control fires both ways.** A check that only warned would be indistinguishable from one
 * that warns on everything, and this diagnostic exists precisely because two other filters were
 * each individually correct and still let the defect through.
 */
describe("control roles the engine implements no law for", () => {
	test("a role: power control is refused, and says the packet declared it OFF", () => {
		const [w] = findUnimplementedControlRoles([control("S_POWER", "power", 0)]);
		expect(w).toBeDefined();
		expect(w!.code).toBe("control-role-not-implemented");
		expect(w!.detail).toContain("implements no law for");
		expect(w!.detail).toContain("rendered as though it were on");
	});

	test("a role: power control declared ON warns without the powered-off sentence", () => {
		const [w] = findUnimplementedControlRoles([control("S_AC_POWER", "power", 1)]);
		expect(w!.detail).not.toContain("rendered as though it were on");
	});

	test("roles the engine DOES implement are not warned about", () => {
		expect(
			findUnimplementedControlRoles([
				control("Treble", "treble"),
				control("Gain", "gain"),
				control("Master", "master-level"),
				control("Vol", undefined),
			]),
		).toEqual([]);
	});
});

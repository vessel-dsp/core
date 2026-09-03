import { describe, expect, it } from "bun:test";
import {
	AMBIGUOUS_DEVICE_TERMINAL_TOKENS,
	DEVICE_TERMINAL_ROLES,
	SUFFIXABLE_DEVICE_TERMINAL_ROLES,
	classifyDeviceTerminalRole,
	collectTerminalRoleWarnings,
	isLegalTerminalRole,
	isRoledDeviceKind,
	resolveComponentTerminalRoles,
	terminalRolesFor,
} from "../../packages/core/src/model/device-terminal-roles";

describe("device terminal roles", () => {
	it("resolves the canonical electrode of every covered kind", () => {
		expect(classifyDeviceTerminalRole("triode", "grid")).toEqual({
			status: "canonical",
			role: "grid",
		});
		expect(classifyDeviceTerminalRole("pentode", "screen")).toEqual({
			status: "canonical",
			role: "screen",
		});
		expect(classifyDeviceTerminalRole("bjt", "collector")).toEqual({
			status: "canonical",
			role: "collector",
		});
		expect(classifyDeviceTerminalRole("mosfet", "bulk")).toEqual({
			status: "canonical",
			role: "bulk",
		});
	});

	it("normalizes case and separators, but does not translate spellings", () => {
		// `normalizeToken` folds case and whitespace/underscores. That is normalization, not an
		// alias: the token still has to *be* the canonical role.
		expect(classifyDeviceTerminalRole("triode", "  GRID ")).toEqual({
			status: "canonical",
			role: "grid",
		});
		// There is no alias table on purpose. A document spelling the gate `g` is a document to
		// correct, and the verdict says so instead of quietly accepting it.
		expect(classifyDeviceTerminalRole("jfet", "g")).toEqual({ status: "unrecognized" });
		expect(classifyDeviceTerminalRole("jfet", "input")).toEqual({ status: "unrecognized" });
		expect(classifyDeviceTerminalRole("mosfet", "body")).toEqual({ status: "unrecognized" });
	});

	it("resolves a suffixed name to the plain role, carrying no index of its own", () => {
		// Forced by the format: a pin name is the pin's identity, so a dual rectifier cannot name
		// both plates `plate`. The suffix distinguishes the *name* and means nothing by itself --
		// which device inside a package a pin belongs to is that device's own terminal list.
		expect(classifyDeviceTerminalRole("tube-diode", "plate_a")).toEqual({
			status: "canonical",
			role: "plate",
		});
		expect(classifyDeviceTerminalRole("tube-diode", "heater_b")).toEqual({
			status: "canonical",
			role: "heater",
		});
		expect(classifyDeviceTerminalRole("pentode", "grid_1")).toEqual({
			status: "canonical",
			role: "grid",
		});
	});

	it("refuses a suffix where the electrode cannot repeat, or the suffix is not one", () => {
		// A BJT has one base; `base_1`/`base_2` are a unijunction's bar ends on a component
		// declared `kind: bjt`, and resolving them onto a BJT would model a different device.
		expect(SUFFIXABLE_DEVICE_TERMINAL_ROLES.has("base")).toBe(false);
		expect(classifyDeviceTerminalRole("bjt", "base1")).toEqual({ status: "unrecognized" });
		expect(classifyDeviceTerminalRole("bjt", "base_2")).toEqual({ status: "unrecognized" });
		// `cathode_filament` is a spelling, not an index: `filament` is not an index token.
		expect(classifyDeviceTerminalRole("tube-diode", "cathode_filament")).toEqual({
			status: "unrecognized",
		});
	});

	it("keys the vocabulary by kind, so a kind cannot borrow another's electrode", () => {
		expect(classifyDeviceTerminalRole("triode", "screen")).toEqual({
			status: "unrecognized",
		});
		expect(classifyDeviceTerminalRole("pentode", "screen")).toEqual({
			status: "canonical",
			role: "screen",
		});
		expect(classifyDeviceTerminalRole("jfet", "bulk")).toEqual({ status: "unrecognized" });
		expect(classifyDeviceTerminalRole("bjt", "gate")).toEqual({ status: "unrecognized" });
	});

	it("refuses an under-specified end rather than guessing an electrode", () => {
		// `a` is both standard notation for a tube anode and the first of two unordered ends.
		// Resolving it would silently orient every device that meant it positionally.
		expect(classifyDeviceTerminalRole("triode", "a")).toEqual({ status: "ambiguous" });
		expect(classifyDeviceTerminalRole("bjt", "b")).toEqual({ status: "ambiguous" });
		// A bare filament cannot be told from a heater tap.
		expect(classifyDeviceTerminalRole("tube-diode", "filament")).toEqual({
			status: "ambiguous",
		});
	});

	it("reports a bare pin number as a package pin, not as an unknown role", () => {
		// A numbered pin names where a wire lands, not what the electrode does. Distinct from
		// `unrecognized` because a consumer with the package pinout can still use it.
		expect(classifyDeviceTerminalRole("bjt", "terminal4")).toEqual({
			status: "package-pin",
			pin: 4,
		});
		expect(classifyDeviceTerminalRole("bjt", "pin7")).toEqual({
			status: "package-pin",
			pin: 7,
		});
	});

	it("returns out-of-scope for a kind it does not cover", () => {
		// Not `unrecognized`: a resistor's ends are interchangeable, so reporting them as defects
		// would flag most of a document.
		expect(classifyDeviceTerminalRole("resistor", "a")).toEqual({ status: "out-of-scope" });
		expect(classifyDeviceTerminalRole("transformer", "hv_a")).toEqual({
			status: "out-of-scope",
		});
		expect(isRoledDeviceKind("resistor")).toBe(false);
		expect(isRoledDeviceKind("triode")).toBe(true);
	});

	it("lets one role appear twice, because a dual rectifier has two plates", () => {
		const resolved = resolveComponentTerminalRoles("tube-diode", [
			"plate_a",
			"plate_b",
			"cathode",
			"heater_a",
			"heater_b",
		]);
		expect(resolved.get("plate_a")).toBe("plate");
		expect(resolved.get("plate_b")).toBe("plate");
		// Keyed by the raw name the document used, so nothing is rewritten.
		expect([...resolved.keys()]).toEqual([
			"plate_a",
			"plate_b",
			"cathode",
			"heater_a",
			"heater_b",
		]);
	});

	it("drops nothing silently: an unresolved terminal is absent from the resolution", () => {
		const resolved = resolveComponentTerminalRoles("bjt", ["base", "q3_base_r26_d01_side"]);
		expect(resolved.get("base")).toBe("base");
		expect(resolved.has("q3_base_r26_d01_side")).toBe(false);
		expect(resolved.size).toBe(1);
	});

	it("never lets an ambiguous token resolve to a role on any kind", () => {
		// With no alias table there is nothing that can override the ambiguous set, and this
		// asserts it stays that way: an ambiguous token that resolved would make the set dead
		// code and the guess silent.
		for (const kind of Object.keys(DEVICE_TERMINAL_ROLES) as (keyof typeof DEVICE_TERMINAL_ROLES)[]) {
			for (const token of AMBIGUOUS_DEVICE_TERMINAL_TOKENS) {
				expect(classifyDeviceTerminalRole(kind, token).status).toBe("ambiguous");
			}
		}
	});

	it("keeps every suffixable role inside some kind's declared roles", () => {
		const declared = new Set(Object.values(DEVICE_TERMINAL_ROLES).flat());
		for (const role of SUFFIXABLE_DEVICE_TERMINAL_ROLES) {
			expect(declared.has(role)).toBe(true);
		}
	});
});

describe("the terminal role field", () => {
	it("accepts a role its kind carries and rejects one it does not", () => {
		expect(isLegalTerminalRole("pentode", "screen")).toBe(true);
		expect(isLegalTerminalRole("triode", "screen")).toBe(false);
		expect(isLegalTerminalRole("diode", "wiper")).toBe(false);
		expect(isLegalTerminalRole("potentiometer", "wiper")).toBe(true);
	});

	it("covers every component kind, so a required field is satisfiable everywhere", () => {
		// The point of `pin` and `end`: without them a required role would be impossible to
		// declare on an opaque chip or an unordered two-terminal part.
		expect(terminalRolesFor("ic")).toEqual(["pin"]);
		expect(terminalRolesFor("resistor")).toContain("end");
		for (const kind of ["ic", "switch", "transformer", "label", "port", "unsupported"]) {
			expect(terminalRolesFor(kind).length).toBeGreaterThan(0);
		}
	});

	it("reports a missing role separately from an illegal one", () => {
		const warnings = collectTerminalRoleWarnings([
			{
				id: "V1",
				kind: "triode",
				terminals: [
					{ name: "plate", role: "plate" },
					{ name: "grid" },
					{ name: "k", role: "screen" },
				],
			},
		]);
		expect(warnings.map((w) => w.code)).toEqual([
			"terminal-role-missing",
			"terminal-role-illegal",
		]);
		// The missing-role warning is the migration counter; the illegal one is a document error.
		expect(warnings[0]?.message).toContain("grid, cathode, plate, heater");
		expect(warnings[1]?.message).toContain("a triode cannot carry");
	});

	it("says nothing about a fully declared component", () => {
		expect(
			collectTerminalRoleWarnings([
				{
					id: "R1",
					kind: "resistor",
					terminals: [
						{ name: "a", role: "end" },
						{ name: "b", role: "end" },
					],
				},
			]),
		).toEqual([]);
		// A role repeats where a name cannot: two interchangeable ends are both `end`.
	});
});

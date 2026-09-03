import { describe, expect, it } from "bun:test";
import {
	WINDING_ROLES,
	validateComponentWindings,
	windingEndsAndTaps,
	windingImpedanceAcross,
	windingOfTerminal,
} from "../../packages/core/src/model/windings";
import type { Component } from "../../packages/core/src/model/types";

const at = { x: 0, y: 0 };
const xfmr = (
	terminals: readonly [string, string | undefined][],
	windings?: Component["windings"],
): Component =>
	({
		id: "T1",
		kind: "transformer",
		name: "T1",
		origin: at,
		rotation: 0,
		flipped: false,
		terminals: terminals.map(([name, role]) => ({
			name,
			position: at,
			...(role === undefined ? {} : { role }),
		})),
		properties: {},
		sourceTypeName: null,
		...(windings === undefined ? {} : { windings }),
	}) as Component;

const ohms = (value: number) => ({ raw: `${value} \u03a9`, value, unit: "\u03a9" });
const volts = (value: number) => ({ raw: `${value} VAC`, value, unit: "V" });

describe("transformer windings", () => {
	it("groups a power transformer's coils, keeping tap position from order", () => {
		const t = xfmr(
			[
				["primary_a", "winding"],
				["primary_b", "winding"],
				["hv_a", "winding"],
				["hv_center_tap", "windingCenterTap"],
				["hv_b", "winding"],
				["filament_a", "winding"],
				["filament_b", "winding"],
			],
			[
				{ role: "primary", terminals: ["primary_a", "primary_b"] },
				{ role: "hv", terminals: ["hv_a", "hv_center_tap", "hv_b"] },
				{ role: "filament", terminals: ["filament_a", "filament_b"] },
			],
		);
		expect(validateComponentWindings(t)).toEqual([]);
		expect(windingOfTerminal(t, "hv_center_tap")?.role).toBe("hv");
		expect(windingOfTerminal(t, "filament_b")?.role).toBe("filament");
		expect(windingOfTerminal(t, "nothing")).toBeNull();
		// Ends and taps come from each terminal's own role, and both keep coil order.
		const hv = windingEndsAndTaps(t, t.windings![1]!);
		expect(hv.ends).toEqual(["hv_a", "hv_b"]);
		expect(hv.taps).toEqual(["hv_center_tap"]);
	});

	it("separates a coil's reference tap from its alternative output taps", () => {
		// The two are one declaration and different circuits, so the terminal's own role has to
		// say which. A power transformer's HV winding is referenced at its centre and both halves
		// are live at once; a speaker winding's 4/8/16 taps are alternatives.
		const t = xfmr(
			[
				["hv_a", "winding"],
				["hv_center_tap", "windingCenterTap"],
				["hv_b", "winding"],
				["secondary_common", "winding"],
				["secondary_8", "windingTap"],
				["secondary_16", "winding"],
			],
			[
				{ role: "hv", terminals: ["hv_a", "hv_center_tap", "hv_b"] },
				{
					role: "secondary",
					terminals: ["secondary_common", "secondary_8", "secondary_16"],
				},
			],
		);
		expect(validateComponentWindings(t)).toEqual([]);
		// Both count as taps for ends-and-taps; what differs is which one a consumer may treat as
		// simultaneously live with both ends.
		expect(windingEndsAndTaps(t, t.windings![0]!).taps).toEqual(["hv_center_tap"]);
		expect(windingEndsAndTaps(t, t.windings![1]!).taps).toEqual(["secondary_8"]);
		expect(windingEndsAndTaps(t, t.windings![1]!).ends).toEqual([
			"secondary_common",
			"secondary_16",
		]);
	});

	it("keeps three impedance taps on one secondary in ascending order", () => {
		// `secondary_16`/`secondary_8`/`secondary_4` are three taps on one coil, which only the
		// names said before. Order states their position; a spelling table could not.
		const t = xfmr(
			[
				["secondary_common", "winding"],
				["secondary_4", "windingTap"],
				["secondary_8", "windingTap"],
				["secondary_16", "windingTap"],
			],
			[
				{
					role: "secondary",
					terminals: ["secondary_common", "secondary_4", "secondary_8", "secondary_16"],
				},
			],
		);
		expect(validateComponentWindings(t)).toEqual([]);
		expect(windingEndsAndTaps(t, t.windings![0]!).taps).toEqual([
			"secondary_4",
			"secondary_8",
			"secondary_16",
		]);
	});

	it("carries a spring reverb tank, which primary/secondary cannot describe", () => {
		// Neither coil transforms the other's voltage: one drives the springs and one picks up.
		const tank = xfmr(
			[
				["input_hot", "winding"],
				["input_return", "winding"],
				["output_hot", "winding"],
				["output_return", "winding"],
			],
			[
				{ role: "drive", terminals: ["input_hot", "input_return"] },
				{ role: "pickup", terminals: ["output_hot", "output_return"] },
			],
		);
		expect(validateComponentWindings(tank)).toEqual([]);
		expect(windingOfTerminal(tank, "output_hot")?.role).toBe("pickup");
		expect(WINDING_ROLES).toContain("drive");
		expect(WINDING_ROLES).toContain("pickup");
		// A shield is not a coil, so it has no winding role and is not expected to be coupled.
		expect(WINDING_ROLES).not.toContain("shield");
	});

	it("lets a role repeat, which one transformer in the corpus needs", () => {
		// `orange-rockerverb`'s power transformer: 3.15-0-3.15 V for the power tube heaters and a
		// separate 6.3 V pair for the preamp. Both are filament windings, and a record keyed on a
		// role -- or on a terminal spelling -- has nowhere to put the second.
		const t = xfmr(
			[
				["power_tube_heater_a_3v15", "winding"],
				["power_tube_heater_center_0v", "windingCenterTap"],
				["power_tube_heater_b_3v15", "winding"],
				["preamp_heater_a_6vac_black", "winding"],
				["preamp_heater_b_6vac_black", "winding"],
			],
			[
				{
					id: "power_tube_heater",
					role: "filament",
					terminals: [
						"power_tube_heater_a_3v15",
						"power_tube_heater_center_0v",
						"power_tube_heater_b_3v15",
					],
				},
				{
					id: "preamp_heater",
					role: "filament",
					terminals: ["preamp_heater_a_6vac_black", "preamp_heater_b_6vac_black"],
				},
			],
		);
		expect(validateComponentWindings(t)).toEqual([]);
		expect(windingOfTerminal(t, "preamp_heater_a_6vac_black")?.id).toBe("preamp_heater");
		expect(windingOfTerminal(t, "power_tube_heater_center_0v")?.id).toBe("power_tube_heater");
	});

	it("does not ask a shield terminal to belong to a winding", () => {
		// `tycobrahe-octavia`'s T1 brings out a `shield_nc` pin. Coupling it to a coil would state
		// something false, and it is the only orphan in the corpus.
		expect(
			validateComponentWindings(
				xfmr(
					[["primary_a", "winding"], ["primary_b", "winding"], ["shield_nc", "shield"]],
					[{ role: "primary", terminals: ["primary_a", "primary_b"] }],
				),
			),
		).toEqual([]);
	});

	it("errors on an unknown terminal, a duplicate id, an unknown role and a repeat", () => {
		const issues = validateComponentWindings(
			xfmr(
				[["a", "winding"], ["b", "winding"]],
				[
					{ id: "w", role: "primary", terminals: ["a", "a"] },
					{ id: "w", role: "nonsense" as never, terminals: ["b", "ghost"] },
				],
			),
		);
		const codes = issues.map((i) => i.code);
		expect(codes).toContain("winding-terminal-repeated");
		expect(codes).toContain("winding-id-duplicate");
		expect(codes).toContain("winding-role-unknown");
		expect(codes).toContain("winding-terminal-unknown");
	});

	it("errors when two windings claim the same terminal", () => {
		// Coupled coils share no conductor. An autotransformer is one tapped winding, not two
		// overlapping ones, which is why this is an error rather than a shape to support.
		const issues = validateComponentWindings(
			xfmr(
				[["a", "winding"], ["b", "winding"]],
				[
					{ role: "primary", terminals: ["a", "b"] },
					{ role: "secondary", terminals: ["a", "b"] },
				],
			),
		);
		expect(issues.filter((i) => i.code === "winding-terminal-shared").length).toBe(2);
		expect(issues.every((i) => i.severity === "error" || i.code === "winding-terminal-orphaned")).toBe(true);
	});

	it("warns rather than errors on a single-ended winding", () => {
		// A bias tap whose return is internally grounded really does declare one terminal.
		const issues = validateComponentWindings(
			xfmr([["bias_tap", "winding"]], [{ role: "bias", terminals: ["bias_tap"] }]),
		);
		expect(issues.map((i) => [i.code, i.severity])).toEqual([
			["winding-single-ended", "warning"],
		]);
	});

	it("warns on a terminal no winding couples, and says nothing when none are declared", () => {
		expect(
			validateComponentWindings(
				xfmr(
					[["a", "winding"], ["b", "winding"], ["secondary_a", "winding"]],
					[{ role: "primary", terminals: ["a", "b"] }],
				),
			).map((i) => i.code),
		).toEqual(["winding-terminal-orphaned"]);
		// A document that declares no windings cannot be malformed, so it is never reported.
		expect(validateComponentWindings(xfmr([["a", "winding"]]))).toEqual([]);
	});
});

describe("winding ratings", () => {
	it("rates a primary plate-to-plate and a secondary from its common, on one part", () => {
		// The reason a rating names its pair. A primary is printed across its ends, over the
		// centre tap; a speaker secondary is printed from its common to each tap. A bare number
		// per winding would need a convention, and either convention is wrong for one of them.
		const t = xfmr(
			[
				["primary_a", "winding"],
				["primary_ct", "windingCenterTap"],
				["primary_b", "winding"],
				["secondary_common", "winding"],
				["secondary_8", "windingTap"],
				["secondary_16", "winding"],
			],
			[
				{
					role: "primary",
					terminals: ["primary_a", "primary_ct", "primary_b"],
					impedances: [
						{ across: ["primary_a", "primary_b"], impedance: ohms(3400) },
					],
				},
				{
					role: "secondary",
					terminals: ["secondary_common", "secondary_8", "secondary_16"],
					impedances: [
						{ across: ["secondary_common", "secondary_8"], impedance: ohms(8) },
						{ across: ["secondary_common", "secondary_16"], impedance: ohms(16) },
					],
				},
			],
		);
		expect(validateComponentWindings(t)).toEqual([]);
		const secondary = t.windings![1]!;
		// Either order finds it, so a consumer never has to know how the document wrote the pair.
		expect(windingImpedanceAcross(secondary, "secondary_common", "secondary_8")?.value).toBe(8);
		expect(windingImpedanceAcross(secondary, "secondary_8", "secondary_common")?.value).toBe(8);
		expect(windingImpedanceAcross(secondary, "secondary_8", "secondary_16")).toBeNull();
		// The turns ratio between any two rated pairs is the square root of the impedance ratio,
		// which is what removes the need for a separate per-tap ratio.
		const primary = windingImpedanceAcross(t.windings![0]!, "primary_a", "primary_b")!;
		const tap16 = windingImpedanceAcross(secondary, "secondary_common", "secondary_16")!;
		expect(Math.sqrt(primary.value / tap16.value)).toBeCloseTo(14.577, 3);
	});

	it("carries a voltage per coil, which two windings of one role both need", () => {
		// `orange-rockerverb`: 3.15-0-3.15 V for the power tube heaters and 6 V for the preamp.
		// Stated in component properties these had to become two invented keys
		// (`PowerTubeFilamentSecondary`, `PreampHeaterSecondary`) and a consumer keyed on the
		// winding class still collapsed them to one value.
		const t = xfmr(
			[
				["power_tube_heater_a", "winding"],
				["power_tube_heater_center", "windingCenterTap"],
				["power_tube_heater_b", "winding"],
				["preamp_heater_a", "winding"],
				["preamp_heater_b", "winding"],
			],
			[
				{
					id: "power_tube_heater",
					role: "filament",
					terminals: [
						"power_tube_heater_a",
						"power_tube_heater_center",
						"power_tube_heater_b",
					],
					voltage: volts(3.15),
				},
				{
					id: "preamp_heater",
					role: "filament",
					terminals: ["preamp_heater_a", "preamp_heater_b"],
					voltage: volts(6),
				},
			],
		);
		expect(validateComponentWindings(t)).toEqual([]);
		expect(t.windings!.map((w) => w.voltage?.value)).toEqual([3.15, 6]);
		// Per half where a centre tap is declared, end to end where none is. The declared centre
		// tap is what makes that unambiguous.
		expect(windingEndsAndTaps(t, t.windings![0]!).taps).toEqual([
			"power_tube_heater_center",
		]);
		expect(windingEndsAndTaps(t, t.windings![1]!).taps).toEqual([]);
	});

	it("errors on a rating across another coil's terminal, its own terminal twice, or nothing", () => {
		// The foreign-terminal case is the one worth catching: it reads as a valid pair and
		// silently rates the wrong winding.
		const issues = validateComponentWindings(
			xfmr(
				[
					["primary_a", "winding"],
					["primary_b", "winding"],
					["secondary_a", "winding"],
					["secondary_b", "winding"],
				],
				[
					{
						role: "primary",
						terminals: ["primary_a", "primary_b"],
						impedances: [
							{ across: ["primary_a", "secondary_b"], impedance: ohms(3400) },
							{ across: ["primary_a", "primary_a"], impedance: ohms(3400) },
						],
					},
					{
						role: "secondary",
						terminals: ["secondary_a", "secondary_b"],
						impedances: [
							{ across: ["secondary_a", "secondary_b"], impedance: ohms(0) },
						],
						voltage: volts(-6),
					},
				],
			),
		);
		const codes = issues.map((i) => i.code);
		expect(codes).toContain("winding-impedance-terminal-foreign");
		expect(codes).toContain("winding-impedance-degenerate");
		expect(codes).toContain("winding-impedance-not-positive");
		expect(codes).toContain("winding-voltage-not-positive");
		expect(issues.every((i) => i.severity === "error")).toBe(true);
	});

	it("says nothing when a winding states no ratings, which is most of them", () => {
		expect(
			validateComponentWindings(
				xfmr(
					[["a", "winding"], ["b", "winding"]],
					[{ role: "primary", terminals: ["a", "b"] }],
				),
			),
		).toEqual([]);
	});
});

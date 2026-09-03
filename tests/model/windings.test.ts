import { describe, expect, it } from "bun:test";
import {
	WINDING_ROLES,
	validateComponentWindings,
	windingEndsAndTaps,
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

describe("transformer windings", () => {
	it("groups a power transformer's coils, keeping tap position from order", () => {
		const t = xfmr(
			[
				["primary_a", "winding"],
				["primary_b", "winding"],
				["hv_a", "winding"],
				["hv_center_tap", "windingTap"],
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
	});

	it("lets a role repeat, because a transformer may carry two secondaries", () => {
		// One feeds a speaker, one a constant-voltage line output. They are distinguished by
		// their terminals rather than by role.
		const t = xfmr(
			[
				["secondary_common", "winding"],
				["secondary_15ohm", "windingTap"],
				["secondary_100v", "winding"],
				["secondary_100v_return", "winding"],
			],
			[
				{ id: "speaker", role: "secondary", terminals: ["secondary_common", "secondary_15ohm"] },
				{ id: "line", role: "secondary", terminals: ["secondary_100v", "secondary_100v_return"] },
			],
		);
		expect(validateComponentWindings(t)).toEqual([]);
		expect(windingOfTerminal(t, "secondary_100v")?.id).toBe("line");
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
					[["a", "winding"], ["b", "winding"], ["shield_nc", "shield"]],
					[{ role: "primary", terminals: ["a", "b"] }],
				),
			).map((i) => i.code),
		).toEqual(["winding-terminal-orphaned"]);
		// A document that declares no windings cannot be malformed, so it is never reported.
		expect(validateComponentWindings(xfmr([["a", "winding"]]))).toEqual([]);
	});
});

import { describe, expect, it } from "bun:test";
import {
	POTENTIOMETER_TAPERS,
	classifyTaper,
	collectTaperIssues,
} from "../../packages/core/src/model/taper";
import type { Component } from "../../packages/core/src/model/types";

const pot = (properties: Record<string, unknown>, kind = "potentiometer"): Component =>
	({
		id: "VR1",
		kind,
		name: "VR1",
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: [],
		properties,
		sourceTypeName: null,
	}) as Component;

describe("potentiometer taper", () => {
	it("accepts each canonical law", () => {
		for (const taper of POTENTIOMETER_TAPERS) {
			expect(classifyTaper(taper)).toEqual({ status: "canonical", taper });
		}
	});

	it("normalizes case, separators and CamelCase word boundaries only", () => {
		expect(classifyTaper("Reverse Log")).toEqual({
			status: "canonical",
			taper: "reverse-log",
		});
		expect(classifyTaper("ReverseLog")).toEqual({
			status: "canonical",
			taper: "reverse-log",
		});
		expect(classifyTaper("LINEAR")).toEqual({ status: "canonical", taper: "linear" });
		// A synonym is not a spelling: `Logarithmic` and `Audio` name this law under other words,
		// and accepting them would be the accommodation this vocabulary avoids.
		expect(classifyTaper("Logarithmic")).toEqual({ status: "unrecognized" });
		expect(classifyTaper("Audio")).toEqual({ status: "unrecognized" });
	});

	it("uses the spellings `KnobTaper` already publishes", () => {
		// Defining a second spelling for the same law inside one package is the drift this work
		// removes. `panel/types.ts` shipped `linear`/`log`/`reverse-log` first.
		for (const shared of ["linear", "log", "reverse-log"] as const) {
			expect(POTENTIOMETER_TAPERS).toContain(shared);
		}
		// `unknown` is in `KnobTaper` because a panel knob's field is required. A property can be
		// omitted, so absence is expressed by absence.
		expect(POTENTIOMETER_TAPERS).not.toContain("unknown" as never);
	});

	it("refuses a manufacturer letter code rather than reading it as a law", () => {
		// `A`/`B`/`C` are printed markings whose meaning is a convention, not a definition. The
		// corpus happens to use the Japanese/Alps mapping; reading it as universal would be the
		// inference this vocabulary removes.
		for (const code of ["A", "B", "C", "W20", "G", "2BH"]) {
			expect(classifyTaper(code)).toEqual({ status: "unrecognized" });
		}
	});

	it("separates a statement of absence from a law", () => {
		// The fix for these is to omit the property, not to invent a value for absence.
		for (const value of ["Unknown", "source-unmarked", "not-visible", "source-unspecified"]) {
			expect(classifyTaper(value)).toEqual({ status: "absence" });
		}
	});

	it("separates a package name and a travel range from a law", () => {
		// A trimmer still has a taper; `trim` states neither it nor its absence.
		expect(classifyTaper("trim")).toEqual({ status: "not-a-law" });
		expect(classifyTaper("0..1")).toEqual({ status: "not-a-law" });
	});

	it("reports the superseded `Sweep` key", () => {
		const issues = collectTaperIssues(pot({ Taper: "linear", Sweep: "Linear" }));
		expect(issues.map((i) => i.code)).toEqual(["taper-property-superseded"]);
	});

	it("says nothing about a canonical declaration, or an absent one", () => {
		expect(collectTaperIssues(pot({ Taper: "log" }))).toEqual([]);
		// No property at all is the correct way to say the source did not mark the pot.
		expect(collectTaperIssues(pot({}))).toEqual([]);
	});

	it("gives each wrong shape its own actionable message", () => {
		expect(collectTaperIssues(pot({ Taper: "B" }))[0]?.code).toBe("taper-unrecognized");
		expect(collectTaperIssues(pot({ Taper: "Unknown" }))[0]?.code).toBe("taper-states-absence");
		expect(collectTaperIssues(pot({ Taper: "trim" }))[0]?.code).toBe("taper-not-a-law");
		expect(collectTaperIssues(pot({ Taper: 0.5 }))[0]?.code).toBe("taper-not-a-string");
	});

	it("ignores a component kind that has no taper", () => {
		expect(collectTaperIssues(pot({ Taper: "nonsense" }, "resistor"))).toEqual([]);
	});
});

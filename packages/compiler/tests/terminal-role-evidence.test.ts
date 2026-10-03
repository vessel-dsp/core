import { describe, expect, test } from "bun:test";
import {
	audioTerminals,
	evidenceStrength,
	type TerminalProfile,
	validateTerminalProfile,
} from "../src/terminal-role";

/**
 * **The control, fired both ways, and committed rather than run once in a scratch file.**
 *
 * The registered control is: **a role assigned without evidence must be REFUSED**. A control that
 * only ever passes is not a control, so every case below has a partner that fails.
 *
 * `packet-validated-shell` is the weaker kind admitted on 2026-09-12. Its whole safety property is
 * that it is admissible for `audio` and nothing else — so the refusal of a non-audio claim is the
 * test that matters, and it is checked at RUNTIME as well as in the types because registry entries
 * are authored as data and can arrive from JSON, where the union discriminates nothing.
 */
describe("terminal role evidence", () => {
	test("unpopulated is a correct outcome, but must say why", () => {
		expect(
			validateTerminalProfile({ status: "unpopulated", reason: "no per-terminal source claim" }),
		).toEqual([]);
		expect(validateTerminalProfile({ status: "unpopulated", reason: "  " })).toHaveLength(1);
	});

	test("a direct-source role is admitted; an uncited one is refused", () => {
		const cited: TerminalProfile = {
			status: "populated",
			terminals: {
				lin: { kind: "direct-source", role: "audio", source: "AK4552VT datasheet pinout, LIN pin 2" },
			},
		};
		expect(validateTerminalProfile(cited)).toEqual([]);

		const uncited: TerminalProfile = {
			status: "populated",
			terminals: { lin: { kind: "direct-source", role: "audio", source: "" } },
		};
		expect(validateTerminalProfile(uncited)[0]).toContain("WITHOUT EVIDENCE IS REFUSED");
	});

	test("packet-validated-shell evidences audio, and is refused for every other role", () => {
		const admitted: TerminalProfile = {
			status: "populated",
			terminals: {
				"jack-input": {
					kind: "packet-validated-shell",
					role: "audio",
					deck: "pedals/boss-st-2/validation/st2-input-codec-shell.cir",
					signalPath: "in -> codec_lin",
				},
			},
		};
		expect(validateTerminalProfile(admitted)).toEqual([]);

		// The banned use: a deck driving a bus line says nothing about what the line carries.
		for (const role of ["address", "data", "clock", "control", "supply", "ground", "reference"]) {
			const refused = {
				status: "populated",
				terminals: {
					ea0: {
						kind: "packet-validated-shell",
						role,
						deck: "some.cir",
						signalPath: "a -> b",
					},
				},
			} as unknown as TerminalProfile;
			expect(validateTerminalProfile(refused)[0]).toContain("REFUSED");
		}
	});

	test("a component-level citation cannot support a per-terminal claim", () => {
		const noPath: TerminalProfile = {
			status: "populated",
			terminals: {
				"jack-input": {
					kind: "packet-validated-shell",
					role: "audio",
					deck: "pedals/boss-st-2/validation/st2-input-codec-shell.cir",
					signalPath: "",
				},
			},
		};
		expect(validateTerminalProfile(noPath)[0]).toContain("cannot support a per-terminal claim");
	});

	test("the two kinds report different strength", () => {
		expect(
			evidenceStrength({ kind: "direct-source", role: "clock", source: "service note" }),
		).toBe("source");
		expect(
			evidenceStrength({
				kind: "packet-validated-shell",
				role: "audio",
				deck: "d.cir",
				signalPath: "a -> b",
			}),
		).toBe("circumstantial");
	});

	test("audioTerminals returns null when unpopulated so a caller must report an upper bound", () => {
		expect(audioTerminals(undefined)).toBeNull();
		expect(audioTerminals({ status: "unpopulated", reason: "blocked on source" })).toBeNull();
		expect(
			audioTerminals({
				status: "populated",
				terminals: {
					sum: { kind: "direct-source", role: "audio", source: "RKM14L492 pinout" },
					d0: { kind: "direct-source", role: "data", source: "RKM14L492 pinout" },
				},
			}),
		).toEqual(["sum"]);
	});
});

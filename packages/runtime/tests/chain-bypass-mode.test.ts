// Host bypass mapping for row 8 tail step 1 (`../chain-slot.ts`).
//
// Two properties, both load-bearing for the "stop omitting bypassed slots" change:
// the mapping table itself (whole `ProgramBypass` values compared as whole values,
// never packet identity), and the wire-omission parity the change leans on — a
// bypassed true-bypass pedal must render bit-identical to the slot omitted, or the
// host mapping is not the honest equivalent of today's behavior. The negative
// control runs the same slot engaged and requires the output to move.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import { resistorDivider } from "@vessel-dsp/compiler/fixtures/circuits";
import type { Program, ProgramBypass } from "@vessel-dsp/compiler";
import { ChainRuntime } from "../src/chain";
import {
	type BypassMode,
	programSlot,
	resolveBypassMode,
} from "../src/chain-slot";

function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	return result.program;
}

/** The fixture program with its bypass block overridden per case. */
function programWithBypass(bypass: ProgramBypass): Program {
	return { ...programFor(resistorDivider), bypass };
}

function processChain(
	programs: readonly { program: Program; mode: BypassMode }[],
): Float64Array {
	const chain = new ChainRuntime(
		programs.map(({ program, mode }) => ({ ...programSlot(program), bypassMode: mode })),
	);
	chain.prepare(48_000);
	return chain.process(new Float64Array([0.25, 0.5, -0.125]));
}

const bypassShapes: readonly (readonly [string, ProgramBypass])[] = [
	["none", { declared: "none" }],
	["true-bypass", { declared: "switch", kind: "true-bypass" }],
	["buffered", { declared: "switch", kind: "buffered" }],
	["buffered-mechanical", { declared: "switch", kind: "buffered-mechanical" }],
	["hardwire", { declared: "switch", kind: "hardwire" }],
	["not-in-audio-path", { declared: "switch", kind: "not-in-audio-path" }],
] as const;

describe("resolveBypassMode", () => {
	it("maps every engaged slot to effect regardless of bypass shape", () => {
		for (const [name, bypass] of bypassShapes) {
			expect(resolveBypassMode(bypass, true), name).toBe("effect");
		}
	});

	it("maps bypassed slots per kind, omitting only the two buffered kinds", () => {
		const expected: Record<string, BypassMode | null> = {
			none: "wire",
			"true-bypass": "wire",
			buffered: null,
			"buffered-mechanical": null,
			hardwire: "wire",
			"not-in-audio-path": "wire",
		};
		for (const [name, bypass] of bypassShapes) {
			expect(resolveBypassMode(bypass, false), name).toBe(expected[name]);
		}
	});

	it("renders a bypassed true-bypass slot bit-identical to the slot omitted", () => {
		const engaged = programWithBypass({ declared: "switch", kind: "true-bypass" });
		const withWire = processChain([
			{ program: engaged, mode: "effect" },
			{ program: engaged, mode: "wire" },
		]);
		const omitted = processChain([{ program: engaged, mode: "effect" }]);
		expect(withWire.length).toBe(omitted.length);
		for (let i = 0; i < withWire.length; i += 1) {
			expect(withWire[i]).toBe(omitted[i]);
		}
	});

	it("moves the output when the same slot runs engaged (negative control)", () => {
		const program = programWithBypass({ declared: "switch", kind: "true-bypass" });
		const engaged = processChain([
			{ program, mode: "effect" },
			{ program, mode: "effect" },
		]);
		const bypassed = processChain([
			{ program, mode: "effect" },
			{ program, mode: "wire" },
		]);
		// A divider that divides: the engaged pair must differ from the bypassed one.
		expect(engaged[1]).not.toBe(bypassed[1]);
	});
});

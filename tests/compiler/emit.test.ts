// Stage 7 contract: deterministic serialization and a faithful round trip.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { decode, emit } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import { rcLowPass, resistorDivider } from "./fixtures/circuits";

function programFor(source: string) {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(
			`fixture did not compile: ${JSON.stringify(result.reasons)}`,
		);
	}
	return result.program;
}

describe("emit", () => {
	it("is deterministic: the same program yields the same digest", () => {
		const first = emit(programFor(resistorDivider));
		const second = emit(programFor(resistorDivider));
		expect(second.digest).toBe(first.digest);
		expect(second.text).toBe(first.text);
	});

	it("distinguishes different programs", () => {
		expect(emit(programFor(rcLowPass)).digest).not.toBe(
			emit(programFor(resistorDivider)).digest,
		);
	});

	it("round-trips without losing anything the runtime needs", () => {
		const program = programFor(rcLowPass);
		const decoded = decode(emit(program).text);
		expect(decoded.order).toEqual(program.order);
		expect(decoded.blocks.length).toBe(program.blocks.length);
		expect(decoded.ports).toEqual(program.ports);
		// The declared operator set is what a runtime refuses on, so it has to survive
		// serialization: a set that arrived empty would make every program loadable by any
		// runtime, which is the silent-acceptance case the lockout exists to remove.
		expect(decoded.requiredOperators).toEqual(program.requiredOperators);
		expect(decoded.requiredOperators.length).toBeGreaterThan(0);
	});

	it("emits no sample rate", () => {
		expect(emit(programFor(rcLowPass)).text).not.toContain("sampleRate");
	});

	it("refuses a program from an unknown format version", () => {
		expect(() => decode(JSON.stringify({ formatVersion: 99 }))).toThrow();
	});
});

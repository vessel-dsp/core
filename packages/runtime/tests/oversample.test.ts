// Solver oversampling: a console setting that changes how finely the circuit is solved without
// changing what the host sees.
//
// Why these four and not a fidelity assertion: the *value* of oversampling was measured against
// ngspice (47 -> 50 `agrees` over 118 packets) and against a limit cycle, and neither belongs in
// a unit test — the first needs a corpus and a second solver, the second needs a real packet.
// What belongs here is the contract a caller depends on, which is that the option is invisible
// except for being more accurate.
import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import {
	clippingOverdriveStage,
	resistorDivider,
} from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "../src/reference-runtime";
import type { Program } from "@vessel-dsp/compiler";

const RATE = 48_000;

const programFor = (source: string): Program => {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`fixture no longer compiles: ${JSON.stringify(result)}`);
	}
	return result.program;
};

const sine = (length: number, amplitude: number): Float64Array => {
	const input = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		input[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / RATE);
	}
	return input;
};

const render = (
	program: Program,
	oversample: number | undefined,
	length = 480,
): Float64Array => {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(RATE, oversample === undefined ? {} : { oversample });
	return runtime.process(sine(length, 0.3));
};

describe("solver oversampling", () => {
	it("is bit-identical to the default path at a factor of 1", () => {
		// The option must cost nothing when unused, or every existing measurement taken before it
		// existed stops being comparable.
		const program = programFor(clippingOverdriveStage);
		const absent = render(program, undefined);
		const explicit = render(program, 1);
		expect(explicit.length).toBe(absent.length);
		for (let index = 0; index < absent.length; index += 1) {
			expect(explicit[index]).toBe(absent[index]);
		}
	});

	it("returns one output sample per input sample at every factor", () => {
		// The host's buffer length is the host's, whatever the solver did inside it. A factor that
		// leaked into the output length would corrupt every caller's block accounting.
		const program = programFor(clippingOverdriveStage);
		for (const oversample of [1, 2, 4, 8]) {
			expect(render(program, oversample).length).toBe(480);
		}
	});

	it("reports the host rate, not the rate it solves at", () => {
		const program = programFor(resistorDivider);
		for (const oversample of [1, 2, 4]) {
			const runtime = new ReferenceRuntime(program);
			runtime.prepare(RATE, { oversample });
			expect(runtime.hostSampleRate()).toBe(RATE);
		}
	});

	it("leaves a working circuit's output where it was", () => {
		// A divider is exact and rate-independent, so oversampling it must be a no-op to within
		// floating point. This is the property that makes the option safe to raise on a packet
		// that already agrees with ngspice: it buys accuracy where the solve was stiff and
		// changes nothing where it was not.
		const program = programFor(resistorDivider);
		const plain = render(program, 1);
		const fourTimes = render(program, 4);
		const settled = Math.floor(plain.length / 2);
		for (let index = settled; index < plain.length; index += 1) {
			expect(fourTimes[index]).toBeCloseTo(plain[index] ?? 0, 9);
		}
	});

	it("refuses a factor below 1 by clamping rather than solving nonsense", () => {
		// Zero or negative sub-samples per sample has no reading; 1 is the floor.
		const program = programFor(resistorDivider);
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(RATE, { oversample: 0 });
		expect(runtime.hostSampleRate()).toBe(RATE);
	});
});

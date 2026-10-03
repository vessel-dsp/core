// Contract for the `spring-reverb` operator: does a tank actually reverberate?
//
// The operator exists because a spring tank is a **mechanical** delay medium -- the same
// category as a BBD die -- so no arrangement of R, L and C makes it emerge and MNA alone
// cannot produce it. Before it existed a tank was admitted as its declared two-winding
// `Circuit.Transformer`, which is the right electrical interface and acoustically silent: an
// ideal transformer is memoryless, so send-to-return was a wire with a turns ratio.
//
// So the assertions below are about **memory**, not level: energy must arrive after the input
// has stopped, and it must decay. A level check alone would pass on the transformer this
// replaced. Each is paired with a control that fails for the stated reason.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import { springReverbTank } from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "../src/reference-runtime";

const RATE = 48_000;

/** Drive a 20 ms burst, then silence, and return the whole render. */
function renderBurst(source: string, seconds: number): readonly number[] {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`fixture did not compile: ${result.status}`);
	}
	const runtime = new ReferenceRuntime(result.program);
	runtime.prepare(RATE, { inputSourceOhms: 1000 });
	const total = Math.round(RATE * seconds);
	const input = new Float64Array(total);
	for (let i = 0; i < Math.round(RATE * 0.02); i += 1) {
		input[i] = Math.sin((2 * Math.PI * 440 * i) / RATE);
	}
	return Array.from(runtime.process(input));
}

/** Peak absolute value over a window given in seconds. */
function peak(
	samples: readonly number[],
	fromSeconds: number,
	toSeconds: number,
): number {
	let worst = 0;
	const from = Math.round(RATE * fromSeconds);
	const to = Math.min(samples.length, Math.round(RATE * toSeconds));
	for (let i = from; i < to; i += 1) {
		worst = Math.max(worst, Math.abs(samples[i] ?? 0));
	}
	return worst;
}

describe("the spring-reverb operator", () => {
	const rendered = renderBurst(springReverbTank, 1.5);

	it("still carries signal long after the input has stopped", () => {
		// The input ends at 20 ms. Anything at 500 ms is the tank's own memory, and a
		// memoryless element cannot produce it at all.
		expect(peak(rendered, 0.5, 0.6)).toBeGreaterThan(0);
	});

	it("decays rather than ringing forever", () => {
		// A feedback delay line with a loop gain at or above 1 would grow without bound, which
		// is the failure mode this structure is built to exclude: the dispersion chain is
		// allpass, so the loop gain is exactly the decay coefficient.
		const early = peak(rendered, 0.1, 0.2);
		const late = peak(rendered, 1.2, 1.3);
		expect(late).toBeLessThan(early);
		expect(Number.isFinite(late)).toBe(true);
	});

	it("does not respond before its shortest spring's transit time", () => {
		// The control for "is this really a delay". The tank's shortest spring is 29 ms, and
		// the fixture wires the jacks straight across it, so a pickup that moved during the
		// first millisecond would mean the operator is passing signal through rather than
		// delaying it -- which is exactly what the transformer it replaced did.
		expect(peak(rendered, 0, 0.001)).toBe(0);
	});

	it("a tank part number the table does not know stays memoryless", () => {
		// The negative control for the whole feature. `125A9A` is a real Fender output
		// transformer, so this is the same fixture with the one field that classifies it
		// changed -- and it must lose the tail completely, not merely shorten it.
		const transformer = renderBurst(
			springReverbTank.replace('PartNumber: "4AB3C1B"', 'PartNumber: "125A9A"'),
			1.5,
		);
		expect(peak(transformer, 0.5, 0.6)).toBe(0);
	});
});

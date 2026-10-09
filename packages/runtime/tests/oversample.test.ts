// Solver oversampling: a console setting that changes how finely the circuit is solved without
// changing what the host sees.
//
// Why these four and not a fidelity assertion: the *value* of oversampling was measured against
// ngspice (47 -> 50 `agrees` over 118 packets) and against a limit cycle, and neither belongs in
// a unit test — the first needs a corpus and a second solver, the second needs a real packet.
// What belongs here is the contract a caller depends on, which is that the option is invisible
// except for being more accurate.
import { describe, expect, it } from "bun:test";
import type { Program } from "@vessel-dsp/compiler";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import {
	clippingOverdriveStage,
	resistorDivider,
} from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "../src/reference-runtime";

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

	it("leaves a working circuit's gain where it was, after the resampler's delay", () => {
		// A divider is exact and rate-independent, so oversampling it must be a no-op to within
		// the resampler's own passband ripple once its group delay has passed. Sample-by-sample
		// equality cannot hold: the band-limited path delays the output by `oversampleLatency()`
		// host samples (26.25 at 4x, fractional, so no integer shift can align it either).
		// What is pinned here is the gain: the fundamental of the settled output at 4x agrees
		// with the 1x fundamental to well within the 0.01 dB passband-ripple budget.
		const program = programFor(resistorDivider);
		const fundamental = (output: Float64Array, hz: number): number => {
			let cc = 0;
			let cs = 0;
			let ss = 0;
			let tc = 0;
			let ts = 0;
			for (let index = 0; index < output.length; index += 1) {
				const phase = (2 * Math.PI * hz * index) / RATE;
				const cos = Math.cos(phase);
				const sin = Math.sin(phase);
				cc += cos * cos;
				cs += cos * sin;
				ss += sin * sin;
				tc += (output[index] ?? 0) * cos;
				ts += (output[index] ?? 0) * sin;
			}
			const det = cc * ss - cs * cs;
			return Math.hypot((tc * ss - ts * cs) / det, (cc * ts - cs * tc) / det);
		};
		for (const hz of [100, 1000, 8000]) {
			const input = new Float64Array(9600);
			for (let index = 0; index < input.length; index += 1) {
				input[index] = 0.3 * Math.sin((2 * Math.PI * hz * index) / RATE);
			}
			const plain = new ReferenceRuntime(program);
			plain.prepare(RATE);
			const settled1x = plain.process(input).subarray(4800);
			const over = new ReferenceRuntime(program);
			over.prepare(RATE, { oversample: 4 });
			const settled4x = over.process(input).subarray(4800);
			const ratioDb =
				20 *
				Math.log10(fundamental(settled4x, hz) / fundamental(settled1x, hz));
			expect(Math.abs(ratioDb)).toBeLessThan(0.01);
		}
	});

	it("keeps every power-of-two factor working past the stage table, with the divider's gain intact", () => {
		// The stage table has three entries (host-rate, 2x, 4x stages); 16x and 32x need four and
		// five cascaded stages and reuse the last (leanest) spec rather than refusing. The 16x
		// and 32x settled fundamental of a divider (exact at any rate) must still match 1x to
		// within the resampler's ripple budget, and the reported latency must grow by the extra
		// stages' (2C-1)/2^s with C = 10.
		const program = programFor(resistorDivider);
		const input = new Float64Array(9600);
		for (let index = 0; index < input.length; index += 1) {
			input[index] = 0.3 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
		}
		const amplitude = (output: Float64Array): number => {
			let cc = 0;
			let cs = 0;
			let ss = 0;
			let tc = 0;
			let ts = 0;
			for (let index = 0; index < output.length; index += 1) {
				const phase = (2 * Math.PI * 1000 * index) / RATE;
				const cos = Math.cos(phase);
				const sin = Math.sin(phase);
				cc += cos * cos;
				cs += cos * sin;
				ss += sin * sin;
				tc += (output[index] ?? 0) * cos;
				ts += (output[index] ?? 0) * sin;
			}
			const det = cc * ss - cs * cs;
			return Math.hypot((tc * ss - ts * cs) / det, (cc * ts - cs * tc) / det);
		};
		const plain = new ReferenceRuntime(program);
		plain.prepare(RATE);
		const reference = amplitude(plain.process(input).subarray(4800));
		expect(reference).toBeGreaterThan(0);
		for (const [oversample, latency] of [
			[16, 28.625 + 19 / 16],
			[32, 28.625 + 19 / 16 + 19 / 32],
		] as const) {
			const runtime = new ReferenceRuntime(program);
			runtime.prepare(RATE, { oversample });
			expect(runtime.oversampleLatency()).toBe(latency);
			const settled = runtime.process(input).subarray(4800);
			expect(settled.every(Number.isFinite)).toBe(true);
			expect(Math.abs(20 * Math.log10(amplitude(settled) / reference))).toBeLessThan(0.01);
		}
	});

	it("refuses a factor below 1 by clamping rather than solving nonsense", () => {
		// Zero or negative sub-samples per sample has no reading; 1 is the floor.
		const program = programFor(resistorDivider);
		const runtime = new ReferenceRuntime(program);
		runtime.prepare(RATE, { oversample: 0 });
		expect(runtime.hostSampleRate()).toBe(RATE);
	});

	it("reports the resampler latency in host samples, and none on the legacy path", () => {
		// The band-limited path delays the output by the half-band cascade's group delay;
		// the held path adds nothing. `null` before `prepare()`, like `hostSampleRate()`.
		const program = programFor(resistorDivider);
		const idle = new ReferenceRuntime(program);
		expect(idle.oversampleLatency()).toBeNull();
		for (const [oversample, latency] of [
			[1, 0],
			[2, 19.5],
			[4, 26.25],
			[8, 28.625],
		] as const) {
			const runtime = new ReferenceRuntime(program);
			runtime.prepare(RATE, { oversample });
			expect(runtime.oversampleLatency()).toBe(latency);
		}
		// A factor that is not a power of two keeps the legacy path: no stages, no latency.
		const legacy = new ReferenceRuntime(program);
		legacy.prepare(RATE, { oversample: 3 });
		expect(legacy.oversampleLatency()).toBe(0);
		expect(legacy.process(sine(480, 0.3)).length).toBe(480);
	});

	it("renders bit-identically however the input is split across process() calls", () => {
		// The resampler state is carried on the stages, so block boundaries are invisible --
		// at every factor, on a nonlinear circuit. One long call is the reference.
		const program = programFor(clippingOverdriveStage);
		for (const oversample of [1, 2, 4, 8]) {
			const renderIn = (splits: readonly number[]): Float64Array => {
				const runtime = new ReferenceRuntime(program);
				runtime.prepare(RATE, oversample === 1 ? {} : { oversample });
				const full = sine(480, 0.3);
				const output = new Float64Array(full.length);
				let at = 0;
				for (const split of splits) {
					output.set(runtime.process(full.subarray(at, at + split)), at);
					at += split;
				}
				return output;
			};
			const whole = renderIn([480]);
			const tenths = renderIn(Array(10).fill(48));
			const ones = renderIn(Array(480).fill(1));
			expect(tenths.length).toBe(whole.length);
			expect(ones.length).toBe(whole.length);
			for (let index = 0; index < whole.length; index += 1) {
				expect(tenths[index]).toBe(whole[index]);
				expect(ones[index]).toBe(whole[index]);
			}
		}
	});
});

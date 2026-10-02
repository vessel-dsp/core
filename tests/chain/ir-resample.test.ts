import { describe, expect, test } from "bun:test";
import { resampleImpulseResponse } from "@vessel-dsp/chain";

function makeDecayingSine(length: number): Float64Array {
	const ir = new Float64Array(length);
	for (let i = 0; i < length; i++) {
		const t = i / 48000;
		ir[i] =
			Math.exp(-i / (length / 4)) *
			(0.7 * Math.sin((2 * Math.PI * 440 * t)) +
				0.3 * Math.sin((2 * Math.PI * 1000 * t)));
	}
	return ir;
}

describe("resampleImpulseResponse (moved from ir-node, numerics unchanged)", () => {
	test("identity when rates match returns an equal copy", () => {
		const input = new Float64Array([0.5, -0.25, 0.125, 0.75]);
		const out = resampleImpulseResponse(input, 48000, 48000);
		// expected length 4, same values as the input
		expect(out.length).toBe(4);
		// expected out[0] 0.5
		expect(out[0]).toBe(0.5);
		// expected out[1] -0.25
		expect(out[1]).toBe(-0.25);
		// expected out[2] 0.125
		expect(out[2]).toBe(0.125);
		// expected out[3] 0.75
		expect(out[3]).toBe(0.75);
		// negative control: the result is a copy, so mutating it leaves the input alone
		// expected input[0] still 0.5 after mutating the copy
		out[0] = 999;
		expect(input[0]).toBe(0.5);
	});

	test("identity is only for equal rates: different rates change the length", () => {
		const input = new Float64Array(100).fill(0.1);
		input[0] = 1;
		const same = resampleImpulseResponse(input, 48000, 48000);
		// expected length 100 when rates match
		expect(same.length).toBe(100);
		const down = resampleImpulseResponse(input, 48000, 24000);
		// expected length round(100 * 24000 / 48000) = 50
		expect(down.length).toBe(50);
		// negative control: the downsampled length is not 100, so identity did not apply
		expect(down.length).not.toBe(100);
	});

	test("unit impulse stays at index 0 with peak near the cutoff gain", () => {
		const input = new Float64Array(8);
		input[0] = 1;
		const out = resampleImpulseResponse(input, 48000, 44100);
		// expected length round(8 * 44100 / 48000) = round(7.35) = 7
		expect(out.length).toBe(7);
		// expected out[0] is cutoff = 44100/48000 = 0.91875 (only tap 0 contributes at n=0)
		expect(Math.abs((out[0] as number) - 0.91875)).toBeLessThan(1e-12);
		// expected peak index 0: every other tap is smaller than tap 0
		let peakIndex = 0;
		let peak = Math.abs(out[0] as number);
		for (let i = 1; i < out.length; i++) {
			const mag = Math.abs(out[i] as number);
			if (mag > peak) {
				peak = mag;
				peakIndex = i;
			}
		}
		// expected peakIndex 0
		expect(peakIndex).toBe(0);
		// negative control: a trailing impulse does not peak at 0
		const trailing = new Float64Array(8);
		trailing[7] = 1;
		const trailingOut = resampleImpulseResponse(trailing, 48000, 44100);
		let trailingPeak = 0;
		for (let i = 0; i < trailingOut.length; i++) {
			trailingPeak = Math.max(trailingPeak, Math.abs(trailingOut[i] as number));
		}
		// expected trailing output tap 0 is smaller than its own peak, so the peak moved
		expect(Math.abs(trailingOut[0] as number)).toBeLessThan(trailingPeak);
	});

	test("output length is round(length * toRate / fromRate)", () => {
		const input = new Float64Array(100).fill(0.1);
		input[0] = 1;
		const down = resampleImpulseResponse(input, 48000, 44100);
		// expected length round(100 * 44100 / 48000) = round(91.875) = 92
		expect(down.length).toBe(92);
		const up = resampleImpulseResponse(input, 44100, 48000);
		// expected length round(100 * 48000 / 44100) = round(108.8435) = 109
		expect(up.length).toBe(109);
		// negative control: the upsampled length is not the downsampled length
		expect(up.length).not.toBe(down.length);
	});

	test("48000 to 44100 to 48000 round trip keeps the peak within 5 percent", () => {
		// Bound justification: the fixture holds only 440 Hz and 1000 Hz content,
		// far below the 22050 Hz Nyquist of the 44100 Hz middle rate, so the
		// anti-alias cutoff removes almost no signal energy and only the Hann
		// window ripple remains. A 5 percent peak bound is loose for this smooth
		// fixture and tight enough to catch a broken kernel.
		const original = makeDecayingSine(480);
		let originalPeak = 0;
		for (let i = 0; i < original.length; i++) {
			originalPeak = Math.max(originalPeak, Math.abs(original[i] as number));
		}
		const mid = resampleImpulseResponse(original, 48000, 44100);
		// expected middle length round(480 * 44100 / 48000) = round(441) = 441
		expect(mid.length).toBe(441);
		const back = resampleImpulseResponse(mid, 44100, 48000);
		// expected final length round(441 * 48000 / 44100) = round(480) = 480
		expect(back.length).toBe(480);
		let backPeak = 0;
		for (let i = 0; i < back.length; i++) {
			backPeak = Math.max(backPeak, Math.abs(back[i] as number));
		}
		const drift = Math.abs(backPeak - originalPeak) / originalPeak;
		// expected drift at most 0.05 (5 percent) for this smooth low-frequency IR
		expect(drift).toBeLessThanOrEqual(0.05);
		// negative control: comparing against silence exceeds the same bound,
		// so the bound check can fail for the stated reason
		const silenceDrift = Math.abs(0 - originalPeak) / originalPeak;
		// expected silence drift 1.0, which is above the 0.05 bound
		expect(silenceDrift).toBeGreaterThan(0.05);
	});

	test("empty input is refused", () => {
		// expected a RangeError for an empty IR at equal rates
		expect(() => resampleImpulseResponse(new Float64Array(0), 48000, 48000)).toThrow(RangeError);
		// expected a RangeError for an empty IR at different rates
		expect(() => resampleImpulseResponse(new Float64Array(0), 48000, 44100)).toThrow(RangeError);
		// negative control: a one-tap IR does not throw
		// expected length 1 round trip copy
		expect(resampleImpulseResponse(new Float64Array([1]), 48000, 48000).length).toBe(1);
	});

	test("non-positive rates are refused", () => {
		const input = new Float64Array([1, 0.5, 0.25]);
		// expected a RangeError for fromRate 0
		expect(() => resampleImpulseResponse(input, 0, 48000)).toThrow(RangeError);
		// expected a RangeError for toRate 0
		expect(() => resampleImpulseResponse(input, 48000, 0)).toThrow(RangeError);
		// expected a RangeError for a negative fromRate
		expect(() => resampleImpulseResponse(input, -48000, 48000)).toThrow(RangeError);
		// expected a RangeError for a negative toRate
		expect(() => resampleImpulseResponse(input, 48000, -44100)).toThrow(RangeError);
		// negative control: positive unequal rates do not throw
		// expected length round(3 * 44100 / 48000) = round(2.75625) = 3
		expect(resampleImpulseResponse(input, 48000, 44100).length).toBe(3);
	});
});

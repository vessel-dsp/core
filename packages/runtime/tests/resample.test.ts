// The half-band resampler on its own, before it ever touches a circuit.
//
// What belongs here is the resampler's design contract: the prototype's shape
// (length, center tap, exact even zeros, DC gain exactly 1), its measured
// frequency response against the design targets (passband ripple <= 0.01 dB
// to 0.4*fs_host, stopband >= 80 dB beyond 0.6*fs_host), the round-trip
// behaviour at each cascade depth, the latency formula, and proof the checks
// can fail (a deliberately worse prototype misses the stopband target).
import { describe, expect, it } from "bun:test";
import {
	cascadeLatencyHostSamples,
	designHalfBand2x,
	HalfBandStage2x,
	RESAMPLE_HALF_BAND_TAPS,
} from "../src/resample";

const HOST = 48_000;
// The prototype is designed at the first 2x stage's high rate.
const STAGE_RATE = 96_000;

const dtftDb = (h: Float64Array, fs: number, f: number): number => {
	let re = 0;
	let im = 0;
	for (let i = 0; i < h.length; i += 1) {
		const phase = (2 * Math.PI * f * i) / fs;
		re += (h[i] as number) * Math.cos(phase);
		im -= (h[i] as number) * Math.sin(phase);
	}
	return 20 * Math.log10(Math.hypot(re, im));
};

const fitFundamental = (y: Float64Array, fs: number, f: number): number => {
	let cc = 0;
	let cs = 0;
	let ss = 0;
	let tc = 0;
	let ts = 0;
	for (let index = 0; index < y.length; index += 1) {
		const phase = (2 * Math.PI * f * index) / fs;
		const cos = Math.cos(phase);
		const sin = Math.sin(phase);
		cc += cos * cos;
		cs += cos * sin;
		ss += sin * sin;
		tc += (y[index] ?? 0) * cos;
		ts += (y[index] ?? 0) * sin;
	}
	const det = cc * ss - cs * cs;
	return Math.hypot((tc * ss - ts * cs) / det, (cc * ts - cs * tc) / det);
};

/** Upsample x`stages`, decimate x`stages`: the runtime's path without the solver. */
const roundTrip = (input: Float64Array, stages: number): Float64Array => {
	const prototype = designHalfBand2x();
	const ups = Array.from(
		{ length: stages },
		() => new HalfBandStage2x(prototype),
	);
	const downs = Array.from(
		{ length: stages },
		() => new HalfBandStage2x(prototype),
	);
	const bufA = new Float64Array(8);
	const bufB = new Float64Array(8);
	const output = new Float64Array(input.length);
	for (let n = 0; n < input.length; n += 1) {
		let cur = bufA;
		let next = bufB;
		ups[0]?.interpolate(input[n] as number, cur, 0);
		let width = 2;
		for (let stage = 1; stage < stages; stage += 1) {
			for (let i = 0; i < width; i += 1) {
				ups[stage]?.interpolate(cur[i] as number, next, 2 * i);
			}
			[cur, next] = [next, cur];
			width *= 2;
		}
		const hi = cur;
		for (let stage = stages - 1; stage >= 0; stage -= 1) {
			const half = width / 2;
			for (let i = 0; i < half; i += 1) {
				hi[i] =
					downs[stage]?.decimate(
						hi[2 * i] as number,
						hi[2 * i + 1] as number,
					) ?? 0;
			}
			width = half;
		}
		output[n] = hi[0] as number;
	}
	return output;
};

describe("half-band prototype design", () => {
	it("is 57 taps with the center at exactly 0.5 and exact even zeros", () => {
		const prototype = designHalfBand2x();
		expect(prototype.length).toBe(RESAMPLE_HALF_BAND_TAPS);
		expect(prototype.length % 4).toBe(1);
		const center = (prototype.length - 1) / 2;
		expect(prototype[center]).toBe(0.5);
		for (let i = 0; i < prototype.length; i += 2) {
			if (i !== center) expect(prototype[i]).toBe(0);
		}
	});

	it("has DC gain exactly 1", () => {
		const prototype = designHalfBand2x();
		let sum = 0;
		let oddSum = 0;
		for (let i = 0; i < prototype.length; i += 1) {
			sum += prototype[i] as number;
			if (i % 2 === 1) oddSum += prototype[i] as number;
		}
		expect(sum).toBeCloseTo(1, 12);
		expect(oddSum).toBeCloseTo(0.5, 12);
	});

	it("holds the passband to 0.01 dB out to 0.4*fs_host", () => {
		const prototype = designHalfBand2x();
		for (const f of [100, 5000, 10000, 15000, 19200]) {
			expect(Math.abs(dtftDb(prototype, STAGE_RATE, f))).toBeLessThan(0.01);
		}
	});

	it("stops 80 dB beyond 0.6*fs_host", () => {
		const prototype = designHalfBand2x();
		for (const f of [28800, 30000, 35000, 40000, 48000]) {
			expect(dtftDb(prototype, STAGE_RATE, f)).toBeLessThan(-80);
		}
	});

	it("is symmetric about -6 dB at the quarter-rate cutoff", () => {
		// The half-band's own sanity shape: -6.02 dB exactly at 24 kHz at the 96 kHz rate.
		expect(dtftDb(designHalfBand2x(), STAGE_RATE, 24000)).toBeCloseTo(
			-6.0206,
			2,
		);
	});

	it("refuses a tap count that cannot center on an even index", () => {
		expect(() => designHalfBand2x(8)).toThrow();
		expect(() => designHalfBand2x(51)).toThrow();
	});

	it("misses the stopband target when deliberately designed worse", () => {
		// The check-can-fail control: halve the stopband depth (Kaiser beta for
		// ~45 dB) and the 30 kHz assertion above fails by ~35 dB.
		const worse = designHalfBand2x(RESAMPLE_HALF_BAND_TAPS, 3.5);
		expect(dtftDb(worse, STAGE_RATE, 30000)).toBeGreaterThan(-60);
	});
});

describe("half-band stage streaming", () => {
	it("passes DC at unity through interpolate-then-decimate", () => {
		const prototype = designHalfBand2x();
		const up = new HalfBandStage2x(prototype);
		const down = new HalfBandStage2x(prototype);
		const pair = new Float64Array(2);
		let last = 0;
		for (let n = 0; n < 200; n += 1) {
			up.interpolate(1, pair, 0);
			last = down.decimate(pair[0] as number, pair[1] as number);
		}
		expect(last).toBeCloseTo(1, 9);
	});

	it("carries the delayed input bit-exactly on the even sub-samples", () => {
		const up = new HalfBandStage2x(designHalfBand2x());
		const pair = new Float64Array(2);
		const seen: number[] = [];
		for (let n = 0; n < 40; n += 1) {
			up.interpolate(0.1 * n + 0.37, pair, 0);
			seen.push(pair[0] as number);
		}
		// The even path is one coefficient of exactly 1 on a delayed input.
		expect(seen[20]).toBe(0.1 * 6 + 0.37);
	});

	it("gives bit-identical output however the input is split", () => {
		const run = (splits: readonly number[]): Float64Array => {
			const stage = new HalfBandStage2x(designHalfBand2x());
			const output = new Float64Array(200);
			let at = 0;
			for (const split of splits) {
				const pair = new Float64Array(2 * split);
				for (let i = 0; i < split; i += 1) {
					stage.interpolate(
						Math.sin((2 * Math.PI * 1000 * (at + i)) / HOST),
						pair,
						2 * i,
					);
				}
				output.set(pair.subarray(0, 0), at);
				at += split;
			}
			return output;
		};
		const whole = run([200]);
		const split = run([37, 163]);
		for (let index = 0; index < whole.length; index += 1) {
			expect(split[index]).toBe(whole[index]);
		}
	});

	it("kills a stopband fold by 80 dB on decimation", () => {
		// A 30 kHz tone at the 96 kHz rate folds to 18 kHz on decimation; the
		// filter must remove it first.
		const down = new HalfBandStage2x(designHalfBand2x());
		const output = new Float64Array(9600);
		for (let i = 0; i < output.length; i += 1) {
			output[i] = down.decimate(
				Math.sin((2 * Math.PI * 30000 * (2 * i)) / STAGE_RATE),
				Math.sin((2 * Math.PI * 30000 * (2 * i + 1)) / STAGE_RATE),
			);
		}
		const folded = fitFundamental(output.subarray(200), HOST, 18000);
		expect(20 * Math.log10(folded)).toBeLessThan(-80);
	});
});

describe("resampler round trip", () => {
	it("holds passband gain through 1, 2 and 3 stages", () => {
		for (const stages of [1, 2, 3]) {
			for (const f of [1000, 8000, 19200]) {
				const length = 4800 + 128;
				const input = new Float64Array(length);
				for (let i = 0; i < length; i += 1) {
					input[i] = Math.sin((2 * Math.PI * f * i) / HOST);
				}
				const settled = roundTrip(input, stages).subarray(128);
				const gainDb = 20 * Math.log10(fitFundamental(settled, HOST, f));
				expect(Math.abs(gainDb)).toBeLessThan(0.01);
			}
		}
	});

	it("reports the cascade latency the impulse centroid confirms", () => {
		// (2C-1)*(1-2^-stages) host samples for C = (57-1)/2 = 28: 27.5, 41.25, 48.125.
		expect(cascadeLatencyHostSamples(1, RESAMPLE_HALF_BAND_TAPS)).toBe(27.5);
		expect(cascadeLatencyHostSamples(2, RESAMPLE_HALF_BAND_TAPS)).toBe(41.25);
		expect(cascadeLatencyHostSamples(3, RESAMPLE_HALF_BAND_TAPS)).toBe(48.125);
	});
});

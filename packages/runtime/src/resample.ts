// Band-limited half-band resampling for solver oversampling.
//
// The solver integrates trapezoidally, which warps frequency; solving at
// rate*N reduces the warp, but the old path held each host sample flat across
// the N sub-samples (zero-order hold) and kept the last sub-sample, leaving the
// hold's own sinc droop on the way in and most of the aliasing on the way out.
// These stages replace both ends: polyphase half-band FIR interpolation on the
// way in and FIR decimation on the way out, one 2x stage each, cascaded for
// 4x and 8x.
//
// Design: windowed-sinc (Kaiser) half-band prototypes with cutoff at a quarter
// of each stage's high rate, odd length L = 1 mod 4 so the center tap sits on an
// even index. The window preserves the ideal response's exact even-tap zeros,
// so the even sub-samples carry the delayed input bit-exactly and only the
// odd taps do arithmetic. The coefficients are a function of the stage only,
// never of the circuit: `designHalfBand2x` takes just the tap count and beta,
// and `RESAMPLE_STAGE_SPECS` fixes one pair per 2x stage. Only the first stage
// (48 -> 96 kHz) needs the sharp 19.2-28.8 kHz transition; later stages work
// where the absolute transition is wider (their stopband needs are sized from
// what folds where: 192 -> 96 kHz folds [48k, 96k] into [0, 48k], and content
// landing in the host baseband comes from [72k, 96k]; 384 -> 192 kHz folds
// [96k, 192k] similarly), so far fewer taps suffice there. See
// docs/spikes/2026-10-09-resampler-latency.md for the measurement that sizes
// each stage (latency 19.5 / 26.25 / 28.625 host samples at 2x/4x/8x).
//
// Streaming and state: each stage owns fixed-size histories; `prepare()` builds
// fresh stages and `reset()` zeroes the histories, so any block split of
// `process()` gives bit-identical output to one long call. DC gain is 1 by
// construction (odd taps normalized to sum exactly 1/2); group delay is
// exactly (L-1)/2 high-rate samples per direction per stage.

/**
 * Per-2x-stage half-band prototype specs as [taps, Kaiser beta], oldest
 * (host-rate) stage first. Taps are 1 mod 4 (center on an even index).
 * Stage 1 keeps the sharp audio-band transition (41 taps, -61 dB stopband);
 * stages 2-3 are sized from their folding analysis (see the module comment).
 */
export const RESAMPLE_STAGE_SPECS: readonly (readonly [taps: number, beta: number])[] = [
  [41, 6.0],
  [29, 7.0],
  [21, 6.0],
];

/** Kaiser beta for the default prototype stopband. Exported so tests can deliberately
 * design a worse prototype for the failing control. */
export const RESAMPLE_KAISER_BETA = 8.3;

/** Modified Bessel function I0, needed by the Kaiser window. */
function besselI0(x: number): number {
	let sum = 1;
	let term = 1;
	const half = (x * x) / 4;
	for (let k = 1; k <= 32; k += 1) {
		term *= half / (k * k);
		sum += term;
		if (term < 1e-17 * sum) break;
	}
	return sum;
}

/**
 * Half-band lowpass prototype at gain 1: cutoff 0.25 cycles/sample, center
 * tap exactly 0.5, even taps exactly 0, odd taps normalized to sum to 0.5.
 */
export function designHalfBand2x(
	taps: number = 57,
	beta: number = RESAMPLE_KAISER_BETA,
): Float64Array {
	if (!Number.isInteger(taps) || taps < 9 || taps % 4 !== 1) {
		throw new Error(
			`half-band prototype needs an odd tap count of 1 mod 4 (got ${String(taps)})`,
		);
	}
	const center = (taps - 1) / 2;
	const denom = besselI0(beta);
	const out = new Float64Array(taps);
	for (let i = 0; i < taps; i += 1) {
		const d = i - center;
		const r = d / center;
		const window = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / denom;
		if (d === 0) {
			out[i] = 0.5;
		} else if (d % 2 === 0) {
			// The ideal response is exactly zero at even offsets and the
			// window preserves that, so these are exact zeros, not rounded ones.
			out[i] = 0;
		} else {
			out[i] = (window * Math.sin((Math.PI * d) / 2)) / (Math.PI * d);
		}
	}
	// Normalize the odd taps to sum to exactly 1/2, so the full filter sums
	// to exactly 1 (DC gain 1) with the center tap untouched at 0.5.
	let oddSum = 0;
	for (let i = 1; i < taps; i += 2) oddSum += out[i] as number;
	const scale = 0.5 / oddSum;
	for (let i = 1; i < taps; i += 2) out[i] = (out[i] as number) * scale;
	out[center] = 0.5;
	return out;
}

/**
 * One bidirectional 2x half-band stage. Two instances in series make 4x;
 * three make 8x. The up direction interpolates (gain 2: even outputs are the
 * delayed input, odd outputs use the odd taps at gain 2); the down direction
 * decimates (gain 1). Histories are newest-first; arithmetic order is fixed,
 * so block splits cannot change the output.
 */
export class HalfBandStage2x {
	private readonly odd: Float64Array;
	/** Input samples of history behind the even (passthrough) output. */
	private readonly upDelay: number;
	/** Group delay in high-rate samples, each direction. */
	readonly delayHighRate: number;
	private readonly histUp: Float64Array;
	private readonly histDown: Float64Array;

	constructor(prototype: Float64Array) {
		const taps = prototype.length;
		if (taps % 4 !== 1 || taps < 9) {
			throw new Error(
				`half-band stage needs a 1-mod-4 prototype (got ${taps})`,
			);
		}
		const center = (taps - 1) / 2;
		if (prototype[center] !== 0.5) {
			throw new Error("half-band prototype center tap must be exactly 0.5");
		}
		const oddCount = (taps - 1) / 2;
		const odd = new Float64Array(oddCount);
		for (let j = 0; j < oddCount; j += 1)
			odd[j] = prototype[2 * j + 1] as number;
		this.odd = odd;
		this.upDelay = center / 2;
		this.delayHighRate = center;
		this.histUp = new Float64Array(oddCount);
		this.histDown = new Float64Array(taps);
	}

	/** Zero both histories. */
	reset(): void {
		this.histUp.fill(0);
		this.histDown.fill(0);
	}

	/**
	 * Interpolate one input sample into two: `out[at]` is the delayed input
	 * itself (bit-exact, coefficient 1), `out[at+1]` the filtered midpoint.
	 */
	interpolate(x: number, out: Float64Array, at: number): void {
		this.histUp.copyWithin(1, 0, this.histUp.length - 1);
		this.histUp[0] = x;
		out[at] = this.histUp[this.upDelay] as number;
		// Gain 2 compensates the zero-stuff: odd taps sum to 1/2, so this
		// sums to 1 on DC.
		let mid = 0;
		const odd = this.odd;
		for (let j = 0; j < odd.length; j += 1) {
			mid += (odd[j] as number) * (this.histUp[j] as number);
		}
		out[at + 1] = 2 * mid;
	}

	/**
	 * Decimate a consecutive pair (`first` older, `second` newer) to one
	 * sample at gain 1.
	 */
	decimate(first: number, second: number): number {
		this.histDown.copyWithin(2, 0, this.histDown.length - 2);
		this.histDown[0] = second;
		this.histDown[1] = first;
		// Even taps are exact zeros except the center at 0.5.
		let acc = 0.5 * (this.histDown[this.delayHighRate] as number);
		const odd = this.odd;
		for (let j = 0; j < odd.length; j += 1) {
			acc += (odd[j] as number) * (this.histDown[2 * j + 1] as number);
		}
		return acc;
	}
}

/**
 * Total resampler group delay in host samples for a cascade of `stages`
 * 2x stages (up and down around the solver), using `RESAMPLE_STAGE_SPECS`.
 *
 * Each up-stage delays by exactly C high-rate samples (the even outputs are
 * the input delayed by C/2 input samples = C output samples, and the odd-tap
 * midpoints are symmetric about the same center). Each down-stage delays by
 * C-1 of its own high-rate samples: `decimate(first, second)` consumes the
 * pair with `second` newest, i.e. it decimates the stream advanced by one
 * sample, which pulls the center one sample earlier. So stage s (high rate
 * 2^s per host sample, center C_s) contributes (2C_s-1)/2^s host samples:
 * 19.5 / 26.25 / 28.625 at 2x/4x/8x. Verified against an impulse centroid
 * (os2: 19.5, os4: 26.2, os8: 28.6) and a multi-frequency phase slope, not
 * just derived.
 */
export function cascadeLatencyHostSamples(stages: number): number {
	if (!Number.isInteger(stages) || stages < 1 || stages > RESAMPLE_STAGE_SPECS.length) {
		throw new Error(
			`resampler cascade needs 1-${RESAMPLE_STAGE_SPECS.length} stages (got ${String(stages)})`,
		);
	}
	let total = 0;
	for (let s = 0; s < stages; s += 1) {
		const center = ((RESAMPLE_STAGE_SPECS[s]?.[0] as number) - 1) / 2;
		total += (2 * center - 1) / 2 ** (s + 1);
	}
	return total;
}

import {
	DEFAULT_MAX_IR_TAPS,
	type IrHealth,
	type IrRefusal,
} from "./types.js";

export interface CheckIrTapsOptions {
	readonly maxTaps?: number;
	readonly sampleRate?: number;
}

// Health check for IR taps. Check order is fixed: empty, then too-long
// (before scanning, so a huge accidental buffer is refused fast), then
// non-finite (reporting the first bad index), then all-zero. A peak above
// one is not a refusal. It is reported on the healthy result through peak
// and peakAboveOne because level staging belongs to the audio path.
export function checkIrTaps(
	taps: Float32Array,
	opts?: CheckIrTapsOptions,
): IrHealth | IrRefusal {
	const maxTaps = opts?.maxTaps ?? DEFAULT_MAX_IR_TAPS;
	const sampleRate = opts?.sampleRate ?? 48000;
	if (taps.length === 0) {
		return { ok: false, reason: "empty" };
	}
	if (taps.length > maxTaps) {
		return { ok: false, reason: "too-long", tapCount: taps.length, maxTaps };
	}
	for (let i = 0; i < taps.length; i++) {
		const value = taps[i] as number;
		if (!Number.isFinite(value)) {
			return { ok: false, reason: "non-finite", index: i };
		}
	}
	let allZero = true;
	for (let i = 0; i < taps.length; i++) {
		if ((taps[i] as number) !== 0) {
			allZero = false;
			break;
		}
	}
	if (allZero) {
		return { ok: false, reason: "all-zero" };
	}
	let peak = 0;
	let peakIndex = 0;
	let sumSquares = 0;
	for (let i = 0; i < taps.length; i++) {
		const value = taps[i] as number;
		sumSquares += value * value;
		const magnitude = Math.abs(value);
		if (magnitude > peak) {
			peak = magnitude;
			peakIndex = i;
		}
	}
	const rms = Math.sqrt(sumSquares / taps.length);
	return {
		ok: true,
		tapCount: taps.length,
		peak,
		peakIndex,
		rms,
		durationSeconds: taps.length / sampleRate,
		peakAboveOne: peak > 1,
	};
}

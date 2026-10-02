import { resampleImpulseResponse } from "@vessel-dsp/chain";
import { checkIrTaps } from "./check.js";
import type {
	IrDecodedAudio,
	IrLoadDeps,
	IrLoadReason,
	IrTaps,
} from "./types.js";

// Typed failure for the IR load path. Compare reason as a whole value.
// Never match on the message text.
export class IrLoadError extends Error {
	readonly reason: IrLoadReason;
	readonly status?: number;
	readonly index?: number;

	constructor(reason: IrLoadReason, message: string, detail?: { status?: number; index?: number }) {
		super(message);
		this.name = "IrLoadError";
		this.reason = reason;
		if (detail?.status !== undefined) {
			this.status = detail.status;
		}
		if (detail?.index !== undefined) {
			this.index = detail.index;
		}
	}
}

// Decode the channels of a decoded buffer to a single mono Float32Array by
// taking the mean across channels at each sample index. A single channel is
// returned as a copy. This documents the stereo rule: left and right count
// equally.
function monoMix(decoded: IrDecodedAudio): Float32Array {
	const channels = decoded.numberOfChannels;
	if (channels <= 0) {
		return new Float32Array(0);
	}
	const first = decoded.getChannelData(0);
	const length = decoded.length;
	const mono = new Float32Array(length);
	if (channels === 1) {
		mono.set(first.subarray(0, length));
		return mono;
	}
	for (let i = 0; i < length; i++) {
		let sum = 0;
		for (let ch = 0; ch < channels; ch++) {
			const data = decoded.getChannelData(ch);
			sum += data[i] as number;
		}
		mono[i] = sum / channels;
	}
	return mono;
}

// Normalisation policy: this module never normalises or scales the taps.
// The decoded mono mix is resampled when needed and returned unchanged
// otherwise. Level staging belongs to the audio path, so a hot IR keeps its
// peak and the health check only reports it.

// Fetch an IR file, decode it, mix to mono, resample to the target rate when
// the decoded rate differs, run the tap health check, and return the taps.
// Throws IrLoadError with a closed reason union on every failure.
export async function loadIr(
	src: string,
	targetSampleRate: number,
	deps: IrLoadDeps,
): Promise<IrTaps> {
	if (!(targetSampleRate > 0) || !Number.isFinite(targetSampleRate)) {
		throw new RangeError(`loadIr requires a positive targetSampleRate, got ${String(targetSampleRate)}`);
	}
	let response;
	try {
		response = await deps.fetch(src);
	} catch (error) {
		throw new IrLoadError(
			"network-or-cors",
			`IR fetch failed for ${src}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!response.ok) {
		throw new IrLoadError("http-status", `IR request failed for ${src} with status ${String(response.status)}`, {
			status: response.status,
		});
	}
	let bytes: ArrayBuffer;
	try {
		bytes = await response.arrayBuffer();
	} catch (error) {
		throw new IrLoadError(
			"network-or-cors",
			`IR body read failed for ${src}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let decoded: IrDecodedAudio;
	try {
		decoded = await deps.decodeAudioData(bytes);
	} catch (error) {
		throw new IrLoadError(
			"decode-failed",
			`IR decode failed for ${src}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!(decoded.sampleRate > 0) || !Number.isFinite(decoded.sampleRate)) {
		throw new IrLoadError("decode-failed", `IR decode failed for ${src}: bad sample rate`);
	}
	const mono = monoMix(decoded);
	let taps: Float32Array;
	if (decoded.sampleRate === targetSampleRate) {
		taps = mono;
	} else {
		const asF64 = new Float64Array(mono);
		const resampled = resampleImpulseResponse(asF64, decoded.sampleRate, targetSampleRate);
		taps = Float32Array.from(resampled);
	}
	const health = checkIrTaps(taps, { sampleRate: targetSampleRate });
	if (!health.ok) {
		if (health.reason === "non-finite") {
			throw new IrLoadError("non-finite", `IR taps refused for ${src}: non-finite at index ${String(health.index)}`, {
				index: health.index,
			});
		}
		if (health.reason === "too-long") {
			throw new IrLoadError(
				"too-long",
				`IR taps refused for ${src}: ${String(health.tapCount)} taps exceed cap ${String(health.maxTaps)}`,
			);
		}
		throw new IrLoadError(health.reason, `IR taps refused for ${src}: ${health.reason}`);
	}
	return { taps, sampleRate: targetSampleRate };
}

import { describe, expect, test } from "bun:test";
import { checkIrTaps } from "@vessel-dsp/player/ir/check.js";
import { IrLoadError, loadIr } from "@vessel-dsp/player/ir/load.js";
import { DEFAULT_MAX_IR_TAPS } from "@vessel-dsp/player/ir/types.js";
import type {
	IrDecodedAudio,
	IrFetchResponse,
	IrLoadDeps,
} from "@vessel-dsp/player/ir/types.js";

function decodedAudio(sampleRate: number, channels: Float32Array[]): IrDecodedAudio {
	const length = channels.length === 0 ? 0 : (channels[0] as Float32Array).length;
	return {
		sampleRate,
		length,
		numberOfChannels: channels.length,
		getChannelData(channel: number): Float32Array {
			const data = channels[channel] as Float32Array | undefined;
			if (!data) {
				throw new Error(`missing channel ${String(channel)}`);
			}
			return data;
		},
	};
}

function okFetchResponse(): IrFetchResponse {
	return {
		ok: true,
		status: 200,
		arrayBuffer(): Promise<ArrayBuffer> {
			return Promise.resolve(new ArrayBuffer(8));
		},
	};
}

function depsFor(channels: Float32Array[], sampleRate: number): IrLoadDeps {
	return {
		fetch(): Promise<IrFetchResponse> {
			return Promise.resolve(okFetchResponse());
		},
		decodeAudioData(): Promise<IrDecodedAudio> {
			return Promise.resolve(decodedAudio(sampleRate, channels));
		},
	};
}

describe("checkIrTaps health and refusals", () => {
	test("healthy fixture reports peak, rms, count, duration, and peak index", () => {
		const taps = new Float32Array([1, 0.5, 0.25]);
		const result = checkIrTaps(taps, { sampleRate: 48000 });
		// expected ok true for a finite non-zero short IR
		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("expected healthy IR");
		}
		// expected tapCount 3
		expect(result.tapCount).toBe(3);
		// expected peak 1 (max abs of [1, 0.5, 0.25])
		expect(result.peak).toBe(1);
		// expected peakIndex 0 (the 1 sits at index 0)
		expect(result.peakIndex).toBe(0);
		// expected rms sqrt((1 + 0.25 + 0.0625) / 3) = sqrt(0.4375) = 0.6614378
		expect(result.rms).toBeCloseTo(0.6614378, 6);
		// expected durationSeconds 3 / 48000 = 0.0000625
		expect(result.durationSeconds).toBeCloseTo(0.0000625, 10);
		// expected peakAboveOne false because the peak equals exactly 1
		expect(result.peakAboveOne).toBe(false);
		// negative control: a hot IR flips peakAboveOne to true, so the flag can fail
		const hot = checkIrTaps(new Float32Array([2, 0.5, 0.25]), { sampleRate: 48000 });
		if (!hot.ok) {
			throw new Error("expected hot IR to be healthy");
		}
		// expected hot peakAboveOne true
		expect(hot.peakAboveOne).toBe(true);
	});

	test("peak above one is reported, not refused", () => {
		const result = checkIrTaps(new Float32Array([2, 1, 0.5]), { sampleRate: 48000 });
		// expected ok true even though the peak exceeds one
		expect(result.ok).toBe(true);
		if (!result.ok) {
			throw new Error("expected hot IR to pass");
		}
		// expected peak 2
		expect(result.peak).toBe(2);
		// expected peakIndex 0
		expect(result.peakIndex).toBe(0);
		// expected peakAboveOne true
		expect(result.peakAboveOne).toBe(true);
		// negative control: a quiet IR reports peakAboveOne false
		const quiet = checkIrTaps(new Float32Array([0.5, 0.25, 0.125]), { sampleRate: 48000 });
		if (!quiet.ok) {
			throw new Error("expected quiet IR to pass");
		}
		// expected quiet peakAboveOne false
		expect(quiet.peakAboveOne).toBe(false);
	});

	test("empty taps are refused", () => {
		const result = checkIrTaps(new Float32Array([]));
		// expected ok false for length 0
		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected empty refusal");
		}
		// expected reason is the whole value "empty"
		expect(result.reason).toBe("empty");
		// negative control: a one-tap IR is not refused as empty
		const one = checkIrTaps(new Float32Array([0.5]));
		// expected ok true for one tap
		expect(one.ok).toBe(true);
	});

	test("non-finite taps are refused with the first bad index", () => {
		const result = checkIrTaps(new Float32Array([0.5, Number.NaN, Number.POSITIVE_INFINITY]));
		// expected ok false for NaN at index 1
		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected non-finite refusal");
		}
		// expected reason is the whole value "non-finite"
		expect(result.reason).toBe("non-finite");
		if (result.reason !== "non-finite") {
			throw new Error("expected non-finite reason");
		}
		// expected index 1 (the NaN sits before the Infinity)
		expect(result.index).toBe(1);
		// negative control: a finite IR with the same shape passes
		const finite = checkIrTaps(new Float32Array([0.5, 0.25, 0.125]));
		// expected ok true for finite taps
		expect(finite.ok).toBe(true);
	});

	test("Infinity at index 0 reports index 0", () => {
		const result = checkIrTaps(new Float32Array([Number.POSITIVE_INFINITY, 0.5]));
		// expected ok false
		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected non-finite refusal");
		}
		// expected reason is the whole value "non-finite"
		expect(result.reason).toBe("non-finite");
		if (result.reason !== "non-finite") {
			throw new Error("expected non-finite reason");
		}
		// expected index 0
		expect(result.index).toBe(0);
	});

	test("all-zero taps are refused", () => {
		const result = checkIrTaps(new Float32Array([0, 0, 0]));
		// expected ok false for all zeros
		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected all-zero refusal");
		}
		// expected reason is the whole value "all-zero"
		expect(result.reason).toBe("all-zero");
		// negative control: the same shape with one nonzero tap passes
		const nonzero = checkIrTaps(new Float32Array([0, 0.5, 0]));
		// expected ok true when one tap is nonzero
		expect(nonzero.ok).toBe(true);
	});

	test("too-long taps are refused", () => {
		const result = checkIrTaps(new Float32Array([0.5, 0.25, 0.125, 0.0625, 0.03125]), { maxTaps: 4 });
		// expected ok false for 5 taps over a cap of 4
		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected too-long refusal");
		}
		// expected reason is the whole value "too-long"
		expect(result.reason).toBe("too-long");
		if (result.reason !== "too-long") {
			throw new Error("expected too-long reason");
		}
		// expected tapCount 5
		expect(result.tapCount).toBe(5);
		// expected maxTaps 4
		expect(result.maxTaps).toBe(4);
		// negative control: 4 taps at the same cap pass
		const atCap = checkIrTaps(new Float32Array([0.5, 0.25, 0.125, 0.0625]), { maxTaps: 4 });
		// expected ok true at exactly the cap
		expect(atCap.ok).toBe(true);
	});

	test("cap boundary: maxTaps accepted, maxTaps plus one refused", () => {
		const atCap = checkIrTaps(new Float32Array([0.5, 0.25, 0.125, 0.0625]), { maxTaps: 4 });
		// expected ok true for 4 taps with maxTaps 4
		expect(atCap.ok).toBe(true);
		const over = checkIrTaps(new Float32Array([0.5, 0.25, 0.125, 0.0625, 0.03125]), { maxTaps: 4 });
		// expected ok false for 5 taps with maxTaps 4
		expect(over.ok).toBe(false);
		if (over.ok) {
			throw new Error("expected too-long refusal");
		}
		// expected reason is the whole value "too-long"
		expect(over.reason).toBe("too-long");
	});

	test("default cap is 48000 taps", () => {
		// expected default cap 48000, one second at 48 kHz
		expect(DEFAULT_MAX_IR_TAPS).toBe(48000);
		const atDefault = new Float32Array(48000).fill(0.5);
		const accepted = checkIrTaps(atDefault);
		// expected ok true for exactly 48000 taps
		expect(accepted.ok).toBe(true);
		const overDefault = new Float32Array(48001).fill(0.5);
		const refused = checkIrTaps(overDefault);
		// expected ok false for 48001 taps
		expect(refused.ok).toBe(false);
		if (refused.ok) {
			throw new Error("expected too-long refusal");
		}
		// expected reason is the whole value "too-long"
		expect(refused.reason).toBe("too-long");
	});
});

describe("loadIr fetch, decode, mono mix, and resample", () => {
	test("same-rate fixture passes through unchanged", async () => {
		const result = await loadIr("https://blog.example/ir/hall.wav", 48000, depsFor([new Float32Array([1, 0.5, 0.25])], 48000));
		// expected sampleRate 48000 (the requested target)
		expect(result.sampleRate).toBe(48000);
		// expected tap count 3 (no resample changes the length)
		expect(result.taps.length).toBe(3);
		// expected taps[0] 1
		expect(result.taps[0]).toBe(1);
		// expected taps[1] 0.5
		expect(result.taps[1]).toBe(0.5);
		// expected taps[2] 0.25
		expect(result.taps[2]).toBe(0.25);
		// negative control: the taps are not silently cleared or scaled
		// expected taps[0] is not 0
		expect(result.taps[0]).not.toBe(0);
	});

	test("different-rate fixture resamples to round(3 * target / source)", async () => {
		const narrow = await loadIr(
			"https://blog.example/ir/hall.wav",
			24000,
			depsFor([new Float32Array([1, 0.5, 0.25])], 48000),
		);
		// expected length round(3 * 24000 / 48000) = round(1.5) = 2
		expect(narrow.taps.length).toBe(2);
		// expected sampleRate 24000 (the requested target)
		expect(narrow.sampleRate).toBe(24000);
		const wide = await loadIr(
			"https://blog.example/ir/hall.wav",
			44100,
			depsFor([new Float32Array([1, 0.5, 0.25])], 48000),
		);
		// expected length round(3 * 44100 / 48000) = round(2.75625) = 3
		expect(wide.taps.length).toBe(3);
		// negative control: the narrow and wide lengths differ, so the rate mattered
		expect(narrow.taps.length).not.toBe(6);
	});

	test("stereo channels are mixed by mean", async () => {
		const left = new Float32Array([2, 4, 6]);
		const right = new Float32Array([0, 2, 4]);
		const result = await loadIr("https://blog.example/ir/stereo.wav", 48000, depsFor([left, right], 48000));
		// expected tap count 3
		expect(result.taps.length).toBe(3);
		// expected mono[0] (2 + 0) / 2 = 1
		expect(result.taps[0]).toBe(1);
		// expected mono[1] (4 + 2) / 2 = 3
		expect(result.taps[1]).toBe(3);
		// expected mono[2] (6 + 4) / 2 = 5
		expect(result.taps[2]).toBe(5);
		// negative control: the mono mix is not the left channel alone
		// expected mono[0] 1 differs from left[0] 2
		expect(result.taps[0]).not.toBe(left[0]);
	});

	test("taps are not normalised", async () => {
		const quiet = await loadIr(
			"https://blog.example/ir/quiet.wav",
			48000,
			depsFor([new Float32Array([0.5, 0.25, 0.125])], 48000),
		);
		// expected quiet taps[0] 0.5 (kept, not scaled to 1)
		expect(quiet.taps[0]).toBe(0.5);
		// expected quiet taps[1] 0.25
		expect(quiet.taps[1]).toBe(0.25);
		// expected quiet taps[2] 0.125
		expect(quiet.taps[2]).toBe(0.125);
		const hot = await loadIr(
			"https://blog.example/ir/hot.wav",
			48000,
			depsFor([new Float32Array([2, 1, 0.5])], 48000),
		);
		// expected hot taps[0] 2 (kept, not scaled down to 1)
		expect(hot.taps[0]).toBe(2);
		// negative control: the quiet peak was not lifted to full scale
		// expected quiet taps[0] is not 1
		expect(quiet.taps[0]).not.toBe(1);
	});

	test("fetch rejection is typed network-or-cors", async () => {
		const deps: IrLoadDeps = {
			fetch(): Promise<IrFetchResponse> {
				return Promise.reject(new Error("boom"));
			},
			decodeAudioData(): Promise<IrDecodedAudio> {
				return Promise.resolve(decodedAudio(48000, [new Float32Array([1])]));
			},
		};
		let caught: unknown;
		try {
			await loadIr("https://blog.example/ir/missing.wav", 48000, deps);
		} catch (error) {
			caught = error;
		}
		// expected an IrLoadError was thrown
		expect(caught instanceof IrLoadError).toBe(true);
		// expected reason is the whole value "network-or-cors"
		expect((caught as IrLoadError).reason).toBe("network-or-cors");
		// negative control: a good fetch does not throw network-or-cors
		const good = await loadIr("https://blog.example/ir/ok.wav", 48000, depsFor([new Float32Array([1, 0.5])], 48000));
		// expected tap count 2 for the good fetch
		expect(good.taps.length).toBe(2);
	});

	test("http error status is typed http-status and carries the status", async () => {
		const deps: IrLoadDeps = {
			fetch(): Promise<IrFetchResponse> {
				return Promise.resolve({
					ok: false,
					status: 404,
					arrayBuffer(): Promise<ArrayBuffer> {
						return Promise.resolve(new ArrayBuffer(0));
					},
				});
			},
			decodeAudioData(): Promise<IrDecodedAudio> {
				return Promise.resolve(decodedAudio(48000, [new Float32Array([1])]));
			},
		};
		let caught: unknown;
		try {
			await loadIr("https://blog.example/ir/gone.wav", 48000, deps);
		} catch (error) {
			caught = error;
		}
		// expected an IrLoadError was thrown
		expect(caught instanceof IrLoadError).toBe(true);
		// expected reason is the whole value "http-status"
		expect((caught as IrLoadError).reason).toBe("http-status");
		// expected carried status 404
		expect((caught as IrLoadError).status).toBe(404);
		// negative control: status 200 with ok true does not throw http-status
		const good = await loadIr("https://blog.example/ir/ok.wav", 48000, depsFor([new Float32Array([1, 0.5])], 48000));
		// expected tap count 2 for the ok response
		expect(good.taps.length).toBe(2);
	});

	test("decode rejection is typed decode-failed", async () => {
		const deps: IrLoadDeps = {
			fetch(): Promise<IrFetchResponse> {
				return Promise.resolve(okFetchResponse());
			},
			decodeAudioData(): Promise<IrDecodedAudio> {
				return Promise.reject(new Error("not audio"));
			},
		};
		let caught: unknown;
		try {
			await loadIr("https://blog.example/ir/broken.wav", 48000, deps);
		} catch (error) {
			caught = error;
		}
		// expected an IrLoadError was thrown
		expect(caught instanceof IrLoadError).toBe(true);
		// expected reason is the whole value "decode-failed"
		expect((caught as IrLoadError).reason).toBe("decode-failed");
		// negative control: a good decode does not throw decode-failed
		const good = await loadIr("https://blog.example/ir/ok.wav", 48000, depsFor([new Float32Array([1, 0.5])], 48000));
		// expected tap count 2 for the good decode
		expect(good.taps.length).toBe(2);
	});

	test("loadIr surfaces tap refusals with typed reasons", async () => {
		let emptyCaught: unknown;
		try {
			await loadIr("https://blog.example/ir/empty.wav", 48000, depsFor([new Float32Array([])], 48000));
		} catch (error) {
			emptyCaught = error;
		}
		// expected reason is the whole value "empty"
		expect((emptyCaught as IrLoadError).reason).toBe("empty");
		let zeroCaught: unknown;
		try {
			await loadIr("https://blog.example/ir/silent.wav", 48000, depsFor([new Float32Array([0, 0])], 48000));
		} catch (error) {
			zeroCaught = error;
		}
		// expected reason is the whole value "all-zero"
		expect((zeroCaught as IrLoadError).reason).toBe("all-zero");
		let finiteCaught: unknown;
		try {
			await loadIr(
				"https://blog.example/ir/broken-tap.wav",
				48000,
				depsFor([new Float32Array([0.5, Number.NaN])], 48000),
			);
		} catch (error) {
			finiteCaught = error;
		}
		// expected reason is the whole value "non-finite"
		expect((finiteCaught as IrLoadError).reason).toBe("non-finite");
		// negative control: a healthy IR through the same path does not throw
		const good = await loadIr("https://blog.example/ir/ok.wav", 48000, depsFor([new Float32Array([1, 0.5])], 48000));
		// expected tap count 2 for the healthy IR
		expect(good.taps.length).toBe(2);
	});

	test("loadIr refuses an IR longer than the default cap", async () => {
		const tooLong = new Float32Array(48001).fill(0.5);
		let caught: unknown;
		try {
			await loadIr("https://blog.example/ir/huge.wav", 48000, depsFor([tooLong], 48000));
		} catch (error) {
			caught = error;
		}
		// expected an IrLoadError was thrown
		expect(caught instanceof IrLoadError).toBe(true);
		// expected reason is the whole value "too-long"
		expect((caught as IrLoadError).reason).toBe("too-long");
		// negative control: exactly 48000 taps pass the same path
		const atCap = new Float32Array(48000).fill(0.5);
		const good = await loadIr("https://blog.example/ir/cap.wav", 48000, depsFor([atCap], 48000));
		// expected tap count 48000 at the cap
		expect(good.taps.length).toBe(48000);
	});
});

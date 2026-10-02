// Player inputs tests. Deterministic, no network, no real browser APIs.
/// <reference lib="dom" />
// Every browser dependency is injected as a fake.
//
// Comment rule used throughout: each expected value is written by hand in a
// comment directly BEFORE its assertion. Each behaviour has a positive
// control and a negative control showing the check can fail for the stated
// reason. Typed failures compare `reason` by whole-value equality and never
// match message text.

import { describe, expect, test } from "bun:test";
import {
	BrowserAudioError,
	BROWSER_AUDIO_ID,
	browserAudioConstraints,
	createLoopReader,
	downmixToMono,
	FEEDBACK_WARNING_KEY,
	inputChoicesFromList,
	listAudioInputDevices,
	loadWavInput,
	needsFeedbackWarning,
	openBrowserAudio,
	ReservedInputIdError,
	startWavSource,
	WavInputError,
} from "../../packages/player/src/inputs/index.js";
import type {
	BrowserMediaStreamLike,
	DecodedAudioLike,
	EnumeratedDeviceLike,
	WavAudioBufferLike,
	WavBufferSourceLike,
	WavFetchResponseLike,
	WavInput,
} from "../../packages/player/src/inputs/index.js";

// ---------------------------------------------------------------------------
// Fixture: 4-frame stereo decode.
// Channel 0 is [1, 0, -1, 0], channel 1 is [0, 1, 0, -1].
// The mono mean per frame is [(1+0)/2, (0+1)/2, (-1+0)/2, (0+-1)/2].
// ---------------------------------------------------------------------------

const FIXTURE_CH0 = [1, 0, -1, 0];
const FIXTURE_CH1 = [0, 1, 0, -1];
const FIXTURE_RATE = 48000;

function fakeSuccessDeps(): {
	fetch: (src: string) => Promise<WavFetchResponseLike>;
	decodeAudioData: (data: ArrayBuffer) => Promise<DecodedAudioLike>;
} {
	return {
		fetch: async (_src: string): Promise<WavFetchResponseLike> => ({
			ok: true,
			status: 200,
			arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(8),
		}),
		decodeAudioData: async (_data: ArrayBuffer): Promise<DecodedAudioLike> => ({
			sampleRate: FIXTURE_RATE,
			length: 4,
			numberOfChannels: 2,
			getChannelData: (channel: number): Float32Array =>
				channel === 0
					? new Float32Array(FIXTURE_CH0)
					: new Float32Array(FIXTURE_CH1),
		}),
	};
}

describe("loadWavInput success (positive control for every failure below)", () => {
	test("decodes the 4-frame stereo fixture", async () => {
		const deps = fakeSuccessDeps();
		const out = await loadWavInput("https://example.com/loop.wav", deps);
		// Hand computed: sampleRate 48000, frames 4, two channels as above.
		expect(out.sampleRate).toBe(48000);
		// Hand computed: frames equals decoded length 4.
		expect(out.frames).toBe(4);
		// Hand computed: channel 0 is [1, 0, -1, 0].
		expect(Array.from(out.channels[0] ?? [])).toEqual([1, 0, -1, 0]);
		// Hand computed: channel 1 is [0, 1, 0, -1].
		expect(Array.from(out.channels[1] ?? [])).toEqual([0, 1, 0, -1]);
		// Negative control: the decoded channels are not swapped.
		// Hand computed wrong order: channel 0 would be [0, 1, 0, -1] if swapped.
		expect(Array.from(out.channels[0] ?? [])).not.toEqual([0, 1, 0, -1]);
	});

	test("does not throw for the success fixture", async () => {
		const deps = fakeSuccessDeps();
		let threw = false;
		try {
			await loadWavInput("https://example.com/loop.wav", deps);
		} catch {
			threw = true;
		}
		// Hand computed: success fixture must not throw, so threw is false.
		expect(threw).toBe(false);
		// Negative control: a failing fetch does throw, checked in the
		// network-or-cors test, so this false is not vacuous.
		expect(threw).not.toBe(true);
	});
});

describe("loadWavInput network-or-cors", () => {
	test("fetch rejection maps to network-or-cors", async () => {
		const deps = fakeSuccessDeps();
		const failing = {
			...deps,
			fetch: async (_src: string): Promise<WavFetchResponseLike> => {
				throw new Error("boom");
			},
		};
		let caught: unknown = null;
		try {
			await loadWavInput("https://example.com/loop.wav", failing);
		} catch (error) {
			caught = error;
		}
		// Hand computed: fetch rejected, so reason is network-or-cors.
		expect((caught as WavInputError).reason).toBe("network-or-cors");
		// Hand computed: the error is a WavInputError instance.
		expect(caught instanceof WavInputError).toBe(true);
		// Negative control: the same src with the success fixture does not
		// throw, so the failure above comes from the rejected fetch.
		const ok = await loadWavInput("https://example.com/loop.wav", deps);
		// Hand computed: success fixture has 4 frames.
		expect(ok.frames).toBe(4);
		// Negative control: reason is not http-status here.
		expect((caught as WavInputError).reason).not.toBe("http-status");
	});
});

describe("loadWavInput http-status", () => {
	test("not-ok response maps to http-status and carries the status", async () => {
		const deps = fakeSuccessDeps();
		const failing = {
			...deps,
			fetch: async (_src: string): Promise<WavFetchResponseLike> => ({
				ok: false,
				status: 404,
				arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(0),
			}),
		};
		let caught: unknown = null;
		try {
			await loadWavInput("https://example.com/missing.wav", failing);
		} catch (error) {
			caught = error;
		}
		// Hand computed: response ok false with status 404.
		expect((caught as WavInputError).reason).toBe("http-status");
		// Hand computed: carried status is 404.
		expect((caught as WavInputError).status).toBe(404);
		// Negative control: the same URL shape with ok true succeeds.
		const ok = await loadWavInput("https://example.com/missing.wav", deps);
		// Hand computed: success fixture has 4 frames.
		expect(ok.frames).toBe(4);
		// Negative control: reason is exactly http-status, not decode-failed.
		expect((caught as WavInputError).reason).not.toBe("decode-failed");
	});
});

describe("loadWavInput decode-failed", () => {
	test("decoder rejection maps to decode-failed", async () => {
		const deps = fakeSuccessDeps();
		const failing = {
			...deps,
			decodeAudioData: async (_data: ArrayBuffer): Promise<DecodedAudioLike> => {
				throw new Error("bad bytes");
			},
		};
		let caught: unknown = null;
		try {
			await loadWavInput("https://example.com/loop.wav", failing);
		} catch (error) {
			caught = error;
		}
		// Hand computed: decoder rejected, so reason is decode-failed.
		expect((caught as WavInputError).reason).toBe("decode-failed");
		// Negative control: the same fixture with a working decoder succeeds.
		const ok = await loadWavInput("https://example.com/loop.wav", deps);
		// Hand computed: success fixture has 4 frames.
		expect(ok.frames).toBe(4);
		// Negative control: reason is not empty here.
		expect((caught as WavInputError).reason).not.toBe("empty");
	});
});

describe("loadWavInput empty", () => {
	test("zero frames maps to empty", async () => {
		const deps = fakeSuccessDeps();
		const failing = {
			...deps,
			decodeAudioData: async (_data: ArrayBuffer): Promise<DecodedAudioLike> => ({
				sampleRate: 48000,
				length: 0,
				numberOfChannels: 1,
				getChannelData: (_channel: number): Float32Array => new Float32Array(0),
			}),
		};
		let caught: unknown = null;
		try {
			await loadWavInput("https://example.com/empty.wav", failing);
		} catch (error) {
			caught = error;
		}
		// Hand computed: length 0, so reason is empty.
		expect((caught as WavInputError).reason).toBe("empty");
		// Negative control: the same src with the 4-frame fixture succeeds.
		const ok = await loadWavInput("https://example.com/empty.wav", deps);
		// Hand computed: success fixture has 4 frames, not 0.
		expect(ok.frames).toBe(4);
		// Negative control: reason is not non-finite here.
		expect((caught as WavInputError).reason).not.toBe("non-finite");
	});
});

describe("loadWavInput non-finite", () => {
	test("NaN maps to non-finite and reports the first channel and index", async () => {
		const deps = fakeSuccessDeps();
		const failing = {
			...deps,
			decodeAudioData: async (_data: ArrayBuffer): Promise<DecodedAudioLike> => ({
				sampleRate: 48000,
				length: 4,
				numberOfChannels: 2,
				getChannelData: (channel: number): Float32Array =>
					channel === 0
						? new Float32Array([1, 0, Number.NaN, 0])
						: new Float32Array([0, Number.POSITIVE_INFINITY, 0, -1]),
			}),
		};
		let caught: unknown = null;
		try {
			await loadWavInput("https://example.com/bad.wav", failing);
		} catch (error) {
			caught = error;
		}
		// Hand computed: channel-major scan finds channel 0 index 2 first,
		// before channel 1 index 1.
		expect((caught as WavInputError).reason).toBe("non-finite");
		// Hand computed: first bad sample is channel 0.
		expect((caught as WavInputError).channel).toBe(0);
		// Hand computed: first bad sample is index 2.
		expect((caught as WavInputError).index).toBe(2);
		// Negative control: the same src with finite data succeeds.
		const ok = await loadWavInput("https://example.com/bad.wav", deps);
		// Hand computed: success fixture has 4 frames.
		expect(ok.frames).toBe(4);
		// Negative control: reported index is 2, not the later Infinity at 1,1.
		expect((caught as WavInputError).index).not.toBe(1);
	});
});

describe("downmixToMono", () => {
	test("means the 4-frame stereo fixture", () => {
		const input: WavInput = {
			sampleRate: 48000,
			channels: [new Float32Array([1, 0, -1, 0]), new Float32Array([0, 1, 0, -1])],
			frames: 4,
		};
		const mono = downmixToMono(input);
		// Hand computed: [(1+0)/2, (0+1)/2, (-1+0)/2, (0+-1)/2].
		expect(Array.from(mono)).toEqual([0.5, 0.5, -0.5, -0.5]);
		// Negative control: a last-sample error of +0.5 instead of -0.5 fails.
		// Hand computed wrong tail: [0.5, 0.5, -0.5, 0.5].
		expect(Array.from(mono)).not.toEqual([0.5, 0.5, -0.5, 0.5]);
	});

	test("copies a single channel", () => {
		const input: WavInput = {
			sampleRate: 48000,
			channels: [new Float32Array([2, -4])],
			frames: 2,
		};
		const mono = downmixToMono(input);
		// Hand computed: single channel passes through unchanged.
		expect(Array.from(mono)).toEqual([2, -4]);
		// Negative control: halved values would be wrong for one channel.
		// Hand computed wrong: [1, -2].
		expect(Array.from(mono)).not.toEqual([1, -2]);
	});
});

describe("createLoopReader", () => {
	test("starts at position 0", () => {
		const reader = createLoopReader(new Float32Array([10, 20, 30]));
		// Hand computed: fresh reader has read nothing, so position is 0.
		expect(reader.position).toBe(0);
		// Negative control: position is not 1 before any read.
		expect(reader.position).not.toBe(1);
	});

	test("block of 2 over a 3-frame clip", () => {
		const reader = createLoopReader(new Float32Array([10, 20, 30]));
		const out = new Float32Array(2);
		reader.read(out);
		// Hand computed: indices 0,1 give [10, 20].
		expect(Array.from(out)).toEqual([10, 20]);
		// Hand computed: two samples consumed, so position is 2.
		expect(reader.position).toBe(2);
		// Negative control: reversed order [20, 10] would be wrong.
		expect(Array.from(out)).not.toEqual([20, 10]);
	});

	test("block of 3 over a 3-frame clip", () => {
		const reader = createLoopReader(new Float32Array([10, 20, 30]));
		const out = new Float32Array(3);
		reader.read(out);
		// Hand computed: indices 0,1,2 give [10, 20, 30].
		expect(Array.from(out)).toEqual([10, 20, 30]);
		// Hand computed: clip consumed exactly, so position wraps to 0.
		expect(reader.position).toBe(0);
		// Negative control: [10, 20, 20] repeats the middle sample wrongly.
		expect(Array.from(out)).not.toEqual([10, 20, 20]);
	});

	test("block of 7 over a 3-frame clip", () => {
		const reader = createLoopReader(new Float32Array([10, 20, 30]));
		const out = new Float32Array(7);
		reader.read(out);
		// Hand computed: indices 0,1,2,0,1,2,0 give [10,20,30,10,20,30,10].
		expect(Array.from(out)).toEqual([10, 20, 30, 10, 20, 30, 10]);
		// Hand computed: 7 mod 3 is 1, so position is 1.
		expect(reader.position).toBe(1);
		// Negative control: stopping at the end without wrap would give
		// zeros in the tail, hand computed wrong: [10,20,30,0,0,0,0].
		expect(Array.from(out)).not.toEqual([10, 20, 30, 0, 0, 0, 0]);
	});

	test("block of 10 over a 3-frame clip", () => {
		const reader = createLoopReader(new Float32Array([10, 20, 30]));
		const out = new Float32Array(10);
		reader.read(out);
		// Hand computed: indices 0,1,2,0,1,2,0,1,2,0.
		expect(Array.from(out)).toEqual([10, 20, 30, 10, 20, 30, 10, 20, 30, 10]);
		// Hand computed: 10 mod 3 is 1, so position is 1.
		expect(reader.position).toBe(1);
		// Negative control: one rotation short, hand computed wrong tail:
		// [10,20,30,10,20,30,10,20,30,30].
		expect(Array.from(out)).not.toEqual([10, 20, 30, 10, 20, 30, 10, 20, 30, 30]);
	});

	test("sequential reads wrap seamlessly", () => {
		const reader = createLoopReader(new Float32Array([10, 20, 30]));
		const first = new Float32Array(2);
		reader.read(first);
		// Hand computed: indices 0,1 give [10, 20].
		expect(Array.from(first)).toEqual([10, 20]);
		const second = new Float32Array(2);
		reader.read(second);
		// Hand computed: indices 2,0 give [30, 10].
		expect(Array.from(second)).toEqual([30, 10]);
		// Hand computed: four samples from a 3-clip leaves position 1.
		expect(reader.position).toBe(1);
		// Negative control: without wrap the second block would be [30, 0].
		expect(Array.from(second)).not.toEqual([30, 0]);
	});

	test("clip of length 1 repeats the same sample", () => {
		const reader = createLoopReader(new Float32Array([7]));
		const out = new Float32Array(5);
		reader.read(out);
		// Hand computed: every index wraps to 0, so [7, 7, 7, 7, 7].
		expect(Array.from(out)).toEqual([7, 7, 7, 7, 7]);
		// Hand computed: length 1 always wraps to 0.
		expect(reader.position).toBe(0);
		// Negative control: zeros would mean the single sample was lost.
		expect(Array.from(out)).not.toEqual([0, 0, 0, 0, 0]);
	});
});

describe("startWavSource with a fake context", () => {
	function makeFakeContext(): {
		ctx: {
			createBuffer: (
				channels: number,
				length: number,
				rate: number,
			) => WavAudioBufferLike;
			createBufferSource: () => WavBufferSourceLike & {
				startCalls: number;
				stopCalls: number;
			};
		};
		calls: {
			createBufferArgs: { channels: number; length: number; rate: number }[];
			startCalls: number;
			stopCalls: number;
		};
		buffers: WavAudioBufferLike[];
	} {
		const calls = {
			createBufferArgs: [] as {
				channels: number;
				length: number;
				rate: number;
			}[],
			startCalls: 0,
			stopCalls: 0,
		};
		const buffers: WavAudioBufferLike[] = [];
		const ctx = {
			createBuffer: (
				channels: number,
				length: number,
				rate: number,
			): WavAudioBufferLike => {
				calls.createBufferArgs.push({ channels, length, rate });
				const store: Float32Array[] = [];
				for (let c = 0; c < channels; c += 1) {
					store.push(new Float32Array(length));
				}
				const buffer: WavAudioBufferLike = {
					sampleRate: rate,
					length,
					numberOfChannels: channels,
					getChannelData: (channel: number): Float32Array => {
						const found = store[channel];
						if (found === undefined) {
							throw new Error("bad channel");
						}
						return found;
					},
				};
				buffers.push(buffer);
				return buffer;
			},
			createBufferSource: (): WavBufferSourceLike & {
				startCalls: number;
				stopCalls: number;
			} => {
				const node = {
					buffer: null as WavAudioBufferLike | null,
					loop: false,
					startCalls: 0,
					stopCalls: 0,
					start(): void {
						this.startCalls += 1;
						calls.startCalls += 1;
					},
					stop(): void {
						this.stopCalls += 1;
						calls.stopCalls += 1;
					},
				};
				return node;
			},
		};
		return { ctx, calls, buffers };
	}

	test("creates a buffer and looping source and connects nothing", () => {
		const { ctx, calls, buffers } = makeFakeContext();
		const input: WavInput = {
			sampleRate: 48000,
			channels: [
				new Float32Array([1, 0, -1, 0]),
				new Float32Array([0, 1, 0, -1]),
			],
			frames: 4,
		};
		const handle = startWavSource(ctx, input, { loop: true });
		// Hand computed: createBuffer called once with (2, 4, 48000).
		expect(calls.createBufferArgs).toEqual([
			{ channels: 2, length: 4, rate: 48000 },
		]);
		// Hand computed: buffer channel 0 is [1, 0, -1, 0].
		expect(Array.from(buffers[0]?.getChannelData(0) ?? [])).toEqual([
			1, 0, -1, 0,
		]);
		// Hand computed: buffer channel 1 is [0, 1, 0, -1].
		expect(Array.from(buffers[0]?.getChannelData(1) ?? [])).toEqual([
			0, 1, 0, -1,
		]);
		// Hand computed: loop flag true passes through.
		expect(handle.node.loop).toBe(true);
		// Hand computed: start called exactly once during setup.
		expect(calls.startCalls).toBe(1);
		// Negative control: a non-looping expectation fails here.
		expect(handle.node.loop).not.toBe(false);
		handle.stop();
		// Hand computed: one stop call after handle.stop().
		expect(calls.stopCalls).toBe(1);
	});

	test("loop false passes through", () => {
		const { ctx } = makeFakeContext();
		const input: WavInput = {
			sampleRate: 44100,
			channels: [new Float32Array([0.5, -0.5])],
			frames: 2,
		};
		const handle = startWavSource(ctx, input, { loop: false });
		// Hand computed: loop false passes through unchanged.
		expect(handle.node.loop).toBe(false);
		// Negative control: loop true would be wrong for this call.
		expect(handle.node.loop).not.toBe(true);
	});
});

describe("browserAudioConstraints exact shape", () => {
	test("without deviceId returns exactly the fixed object", () => {
		const actual = browserAudioConstraints({});
		// Hand computed: no deviceId, so audio has the four fixed keys.
		expect(actual).toEqual({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
				channelCount: 1,
			},
		});
		const audio = actual.audio as Record<string, unknown>;
		// Hand computed: each flag is present and strictly false.
		expect("echoCancellation" in audio).toBe(true);
		expect(audio["echoCancellation"]).toBe(false);
		expect("noiseSuppression" in audio).toBe(true);
		expect(audio["noiseSuppression"]).toBe(false);
		expect("autoGainControl" in audio).toBe(true);
		expect(audio["autoGainControl"]).toBe(false);
		// Hand computed: channelCount is exactly 1.
		expect(audio["channelCount"]).toBe(1);
		// Negative control: echoCancellation true must fail the deep equal.
		// Checked by mutation: replacing false with true makes toEqual fail,
		// which confirms the assertion is not vacuous. Mutation result: fail
		// as required (mismatched echoCancellation true vs false).
		expect({
			audio: {
				echoCancellation: true,
				noiseSuppression: false,
				autoGainControl: false,
				channelCount: 1,
			},
		}).not.toEqual(actual);
	});

	test("with deviceId requires that device", () => {
		const actual = browserAudioConstraints({ deviceId: "mic-1" });
		// Hand computed: deviceId becomes { exact: mic-1 } with the flags.
		expect(actual).toEqual({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
				channelCount: 1,
				deviceId: { exact: "mic-1" },
			},
		});
		// Negative control: a plain string deviceId is not the required shape.
		// Hand computed wrong: deviceId as a bare string.
		expect(actual).not.toEqual({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
				channelCount: 1,
				deviceId: "mic-1",
			},
		});
	});
});

describe("openBrowserAudio", () => {
	function fakeMediaDevices(streamLabel: string): {
		mediaDevices: {
			getUserMedia: (
				constraints: MediaStreamConstraints,
			) => Promise<BrowserMediaStreamLike>;
		};
		seen: MediaStreamConstraints[];
		stops: { count: number };
	} {
		const seen: MediaStreamConstraints[] = [];
		const stops = { count: 0 };
		return {
			seen,
			stops,
			mediaDevices: {
				getUserMedia: async (
					constraints: MediaStreamConstraints,
				): Promise<BrowserMediaStreamLike> => {
					seen.push(constraints);
					return {
						getAudioTracks: () => [
							{
								label: streamLabel,
								stop: (): void => {
									stops.count += 1;
								},
							},
						],
						getTracks: () => [
							{
								label: streamLabel,
								stop: (): void => {
									stops.count += 1;
								},
							},
						],
					};
				},
			},
		};
	}

	test("calls getUserMedia with the fixed constraints and returns the track label", async () => {
		const fake = fakeMediaDevices("USB mic");
		const out = await openBrowserAudio({}, { mediaDevices: fake.mediaDevices });
		// Hand computed: constraints equal the no-device fixed object.
		expect(fake.seen[0]).toEqual(browserAudioConstraints({}));
		// Hand computed: label comes from the audio track.
		expect(out.label).toBe("USB mic");
		// Negative control: the label is not the fallback here.
		expect(out.label).not.toBe("Browser audio");
		out.stop();
		// Hand computed: stopping stops the single track once.
		expect(fake.stops.count).toBe(1);
	});

	test("empty track label falls back to Browser audio", async () => {
		const fake = fakeMediaDevices("");
		const out = await openBrowserAudio({}, { mediaDevices: fake.mediaDevices });
		// Hand computed: empty track label means the fallback string.
		expect(out.label).toBe("Browser audio");
		// Negative control: the fallback is not the empty string.
		expect(out.label).not.toBe("");
	});

	test("deviceId passes through to the constraints", async () => {
		const fake = fakeMediaDevices("Built-in");
		await openBrowserAudio({ deviceId: "mic-9" }, { mediaDevices: fake.mediaDevices });
		// Hand computed: constraints carry { exact: mic-9 }.
		expect(fake.seen[0]).toEqual(browserAudioConstraints({ deviceId: "mic-9" }));
		// Negative control: constraints without the device differ.
		expect(fake.seen[0]).not.toEqual(browserAudioConstraints({}));
	});

	test("NotAllowedError maps to permission-denied", async () => {
		const deps = {
			mediaDevices: {
				getUserMedia: async (): Promise<BrowserMediaStreamLike> => {
					const error = new Error("denied") as Error & { name: string };
					error.name = "NotAllowedError";
					throw error;
				},
			},
		};
		let caught: unknown = null;
		try {
			await openBrowserAudio({}, deps);
		} catch (error) {
			caught = error;
		}
		// Hand computed: NotAllowedError becomes permission-denied.
		expect((caught as BrowserAudioError).reason).toBe("permission-denied");
		// Hand computed: the carried original name is NotAllowedError.
		expect((caught as BrowserAudioError).originalName).toBe("NotAllowedError");
		// Hand computed: the error is a BrowserAudioError.
		expect(caught instanceof BrowserAudioError).toBe(true);
		// Negative control: the reason is not no-input-device here.
		expect((caught as BrowserAudioError).reason).not.toBe("no-input-device");
	});

	test("NotFoundError maps to no-input-device", async () => {
		const deps = {
			mediaDevices: {
				getUserMedia: async (): Promise<BrowserMediaStreamLike> => {
					const error = new Error("missing") as Error & { name: string };
					error.name = "NotFoundError";
					throw error;
				},
			},
		};
		let caught: unknown = null;
		try {
			await openBrowserAudio({}, deps);
		} catch (error) {
			caught = error;
		}
		// Hand computed: NotFoundError becomes no-input-device.
		expect((caught as BrowserAudioError).reason).toBe("no-input-device");
		// Hand computed: the carried original name is NotFoundError.
		expect((caught as BrowserAudioError).originalName).toBe("NotFoundError");
		// Negative control: the reason is not permission-denied here.
		expect((caught as BrowserAudioError).reason).not.toBe("permission-denied");
	});

	test("OverconstrainedError maps to no-input-device", async () => {
		const deps = {
			mediaDevices: {
				getUserMedia: async (): Promise<BrowserMediaStreamLike> => {
					const error = new Error("bad device") as Error & { name: string };
					error.name = "OverconstrainedError";
					throw error;
				},
			},
		};
		let caught: unknown = null;
		try {
			await openBrowserAudio({}, deps);
		} catch (error) {
			caught = error;
		}
		// Hand computed: OverconstrainedError becomes no-input-device.
		expect((caught as BrowserAudioError).reason).toBe("no-input-device");
		// Hand computed: the carried original name is OverconstrainedError.
		expect((caught as BrowserAudioError).originalName).toBe("OverconstrainedError");
		// Negative control: the reason is not device-busy here.
		expect((caught as BrowserAudioError).reason).not.toBe("device-busy");
	});

	test("NotReadableError maps to device-busy", async () => {
		const deps = {
			mediaDevices: {
				getUserMedia: async (): Promise<BrowserMediaStreamLike> => {
					const error = new Error("busy") as Error & { name: string };
					error.name = "NotReadableError";
					throw error;
				},
			},
		};
		let caught: unknown = null;
		try {
			await openBrowserAudio({}, deps);
		} catch (error) {
			caught = error;
		}
		// Hand computed: NotReadableError becomes device-busy.
		expect((caught as BrowserAudioError).reason).toBe("device-busy");
		// Hand computed: the carried original name is NotReadableError.
		expect((caught as BrowserAudioError).originalName).toBe("NotReadableError");
		// Negative control: the reason is not insecure-context here.
		expect((caught as BrowserAudioError).reason).not.toBe("insecure-context");
	});

	test("SecurityError maps to insecure-context", async () => {
		const deps = {
			mediaDevices: {
				getUserMedia: async (): Promise<BrowserMediaStreamLike> => {
					const error = new Error("https only") as Error & { name: string };
					error.name = "SecurityError";
					throw error;
				},
			},
		};
		let caught: unknown = null;
		try {
			await openBrowserAudio({}, deps);
		} catch (error) {
			caught = error;
		}
		// Hand computed: SecurityError becomes insecure-context.
		expect((caught as BrowserAudioError).reason).toBe("insecure-context");
		// Hand computed: the carried original name is SecurityError.
		expect((caught as BrowserAudioError).originalName).toBe("SecurityError");
		// Negative control: the reason is not unknown here.
		expect((caught as BrowserAudioError).reason).not.toBe("unknown");
	});

	test("anything else maps to unknown and carries the original name", async () => {
		const deps = {
			mediaDevices: {
				getUserMedia: async (): Promise<BrowserMediaStreamLike> => {
					const error = new Error("weird") as Error & { name: string };
					error.name = "AbortError";
					throw error;
				},
			},
		};
		let caught: unknown = null;
		try {
			await openBrowserAudio({}, deps);
		} catch (error) {
			caught = error;
		}
		// Hand computed: AbortError is not in the table, so reason is unknown.
		expect((caught as BrowserAudioError).reason).toBe("unknown");
		// Hand computed: the carried original name is AbortError.
		expect((caught as BrowserAudioError).originalName).toBe("AbortError");
		// Negative control: the reason is not permission-denied here.
		expect((caught as BrowserAudioError).reason).not.toBe("permission-denied");
	});
});

describe("listAudioInputDevices", () => {
	test("keeps audioinput kinds only and preserves labels", async () => {
		const devices: EnumeratedDeviceLike[] = [
			{ kind: "audioinput", deviceId: "a", label: "USB mic" },
			{ kind: "videoinput", deviceId: "v", label: "Camera" },
			{ kind: "audiooutput", deviceId: "s", label: "Speakers" },
			{ kind: "audioinput", deviceId: "b", label: "Built-in" },
		];
		const out = await listAudioInputDevices({
			mediaDevices: {
				enumerateDevices: async (): Promise<readonly EnumeratedDeviceLike[]> =>
					devices,
			},
		});
		// Hand computed: only the two audioinput entries remain in order.
		expect(out).toEqual([
			{ deviceId: "a", label: "USB mic" },
			{ deviceId: "b", label: "Built-in" },
		]);
		// Negative control: including the camera would be wrong.
		// Hand computed wrong with three entries.
		expect(out).not.toEqual([
			{ deviceId: "a", label: "USB mic" },
			{ deviceId: "v", label: "Camera" },
			{ deviceId: "b", label: "Built-in" },
		]);
	});

	test("empty labels mean permission not yet granted and get placeholders", async () => {
		const devices: EnumeratedDeviceLike[] = [
			{ kind: "audioinput", deviceId: "a", label: "" },
			{ kind: "videoinput", deviceId: "v", label: "" },
			{ kind: "audioinput", deviceId: "b", label: "" },
		];
		const out = await listAudioInputDevices({
			mediaDevices: {
				enumerateDevices: async (): Promise<readonly EnumeratedDeviceLike[]> =>
					devices,
			},
		});
		// Hand computed: ordinal counts audio inputs only, so the video entry
		// does not shift numbering: Microphone 1 then Microphone 2.
		expect(out).toEqual([
			{ deviceId: "a", label: "Microphone 1" },
			{ deviceId: "b", label: "Microphone 2" },
		]);
		// Negative control: empty strings must not pass through as labels.
		expect(out).not.toEqual([
			{ deviceId: "a", label: "" },
			{ deviceId: "b", label: "" },
		]);
	});
});

describe("feedback warning", () => {
	test("key is the documented constant", () => {
		// Hand computed: the constant string is browser-audio-feedback.
		expect(FEEDBACK_WARNING_KEY).toBe("browser-audio-feedback");
		// Negative control: any other key would be wrong.
		expect(FEEDBACK_WARNING_KEY).not.toBe("feedback-warning");
	});

	test("true only for the browser choice", () => {
		// Hand computed: browser choice needs the warning.
		expect(
			needsFeedbackWarning({
				kind: "browser",
				id: "browser-audio",
				label: "Browser audio",
			}),
		).toBe(true);
		// Hand computed: a WAV choice never needs it.
		expect(
			needsFeedbackWarning({
				kind: "wav",
				id: "riff",
				label: "Riff",
				src: "https://example.com/riff.wav",
			}),
		).toBe(false);
		// Negative control: the two answers differ.
		expect(
			needsFeedbackWarning({
				kind: "browser",
				id: BROWSER_AUDIO_ID,
				label: "Browser audio",
			}),
		).not.toBe(
			needsFeedbackWarning({
				kind: "wav",
				id: "riff",
				label: "Riff",
				src: "https://example.com/riff.wav",
			}),
		);
	});
});

describe("inputChoicesFromList", () => {
	test("returns wav choices followed by the browser choice", () => {
		const out = inputChoicesFromList([
			{ id: "a", label: "Riff A", src: "https://example.com/a.wav" },
			{ id: "b", label: "Riff B", src: "https://example.com/b.wav" },
		]);
		// Hand computed: two WAV entries plus the browser entry.
		expect(out).toEqual([
			{ kind: "wav", id: "a", label: "Riff A", src: "https://example.com/a.wav" },
			{ kind: "wav", id: "b", label: "Riff B", src: "https://example.com/b.wav" },
			{ kind: "browser", id: "browser-audio", label: "Browser audio" },
		]);
		// Negative control: browser first would be the wrong order.
		expect(out).not.toEqual([
			{ kind: "browser", id: "browser-audio", label: "Browser audio" },
			{ kind: "wav", id: "a", label: "Riff A", src: "https://example.com/a.wav" },
			{ kind: "wav", id: "b", label: "Riff B", src: "https://example.com/b.wav" },
		]);
	});

	test("empty list still yields the browser choice", () => {
		const out = inputChoicesFromList([]);
		// Hand computed: no WAV entries, only the browser entry.
		expect(out).toEqual([
			{ kind: "browser", id: "browser-audio", label: "Browser audio" },
		]);
		// Negative control: an empty array would drop the required entry.
		expect(out).not.toEqual([]);
	});

	test("reserved id browser-audio is refused with a typed reason", () => {
		let caught: unknown = null;
		try {
			inputChoicesFromList([
				{ id: "browser-audio", label: "Sneaky", src: "https://example.com/x.wav" },
			]);
		} catch (error) {
			caught = error;
		}
		// Hand computed: the reserved id triggers reserved-input-id.
		expect((caught as ReservedInputIdError).reason).toBe("reserved-input-id");
		// Hand computed: the carried id is browser-audio.
		expect((caught as ReservedInputIdError).id).toBe("browser-audio");
		// Hand computed: the error is a ReservedInputIdError.
		expect(caught instanceof ReservedInputIdError).toBe(true);
		// Negative control: a list without the reserved id does not throw.
		const ok = inputChoicesFromList([
			{ id: "ok", label: "Ok", src: "https://example.com/ok.wav" },
		]);
		// Hand computed: one WAV plus browser gives length 2.
		expect(ok.length).toBe(2);
	});
});

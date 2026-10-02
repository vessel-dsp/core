// WAV input path: fetch, decode, downmix, loop, and buffer-source wrapper.
//
// All browser APIs are injected through function arguments. This module never
// reads a global at import time and never touches the DOM, AudioContext, or
// navigator directly.

import type { WavInput } from "./types.js";

// Closed reason union for WAV load failures. Callers compare `reason` by
// whole-value equality and never match message text.
export type WavLoadFailureReason =
	| "network-or-cors"
	| "http-status"
	| "decode-failed"
	| "empty"
	| "non-finite";

export class WavInputError extends Error {
	readonly reason: WavLoadFailureReason;
	readonly src: string;
	readonly status?: number;
	readonly channel?: number;
	readonly index?: number;

	constructor(options: {
		readonly reason: WavLoadFailureReason;
		readonly src: string;
		readonly status?: number;
		readonly channel?: number;
		readonly index?: number;
	}) {
		super(`wav input ${options.reason}: ${options.src}`);
		this.name = "WavInputError";
		this.reason = options.reason;
		this.src = options.src;
		if (options.status !== undefined) {
			this.status = options.status;
		}
		if (options.channel !== undefined) {
			this.channel = options.channel;
		}
		if (options.index !== undefined) {
			this.index = options.index;
		}
	}
}

// Minimal structural shape of a fetch response used here. Only `ok`,
// `status`, and `arrayBuffer()` are read.
export type WavFetchResponseLike = {
	readonly ok: boolean;
	readonly status: number;
	arrayBuffer(): Promise<ArrayBuffer>;
};

export type WavFetchFn = (src: string) => Promise<WavFetchResponseLike>;

// Minimal structural shape of a decoded audio buffer. Only `sampleRate`,
// `length`, `numberOfChannels`, and `getChannelData()` are read.
export type DecodedAudioLike = {
	readonly sampleRate: number;
	readonly length: number;
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
};

export type DecodeAudioDataFn = (data: ArrayBuffer) => Promise<DecodedAudioLike>;

export type LoadWavInputDeps = {
	readonly fetch: WavFetchFn;
	readonly decodeAudioData: DecodeAudioDataFn;
};

// Fetch the URL, check the HTTP status, read the bytes, and decode them with
// the injected decoder. Returns planar Float32 channels plus rate and frames.
//
// Failure mapping by whole-value reason codes:
// - fetch rejects, or the body read rejects, becomes network-or-cors.
// - response ok false becomes http-status and carries the numeric status.
// - decodeAudioData rejects, or resolves to an unusable value, becomes
//   decode-failed.
// - zero frames or zero channels becomes empty.
// - NaN or Infinity in any sample becomes non-finite and reports the first
//   channel and index in channel-major scan order.
export async function loadWavInput(
	src: string,
	deps: LoadWavInputDeps,
): Promise<WavInput> {
	let response: WavFetchResponseLike;
	try {
		response = await deps.fetch(src);
	} catch {
		throw new WavInputError({ reason: "network-or-cors", src });
	}
	if (response.ok !== true) {
		throw new WavInputError({
			reason: "http-status",
			src,
			status: response.status,
		});
	}
	let bytes: ArrayBuffer;
	try {
		bytes = await response.arrayBuffer();
	} catch {
		throw new WavInputError({ reason: "network-or-cors", src });
	}
	let decoded: DecodedAudioLike;
	try {
		decoded = await deps.decodeAudioData(bytes);
	} catch {
		throw new WavInputError({ reason: "decode-failed", src });
	}
	if (
		decoded === null ||
		decoded === undefined ||
		typeof decoded.length !== "number" ||
		typeof decoded.numberOfChannels !== "number" ||
		typeof decoded.sampleRate !== "number" ||
		typeof decoded.getChannelData !== "function"
	) {
		throw new WavInputError({ reason: "decode-failed", src });
	}
	if (decoded.length === 0 || decoded.numberOfChannels === 0) {
		throw new WavInputError({ reason: "empty", src });
	}
	const channels: Float32Array[] = [];
	for (let c = 0; c < decoded.numberOfChannels; c += 1) {
		const data = decoded.getChannelData(c);
		channels.push(new Float32Array(data));
	}
	const frames = decoded.length;
	for (let c = 0; c < channels.length; c += 1) {
		const channel = channels[c];
		if (channel === undefined) {
			continue;
		}
		for (let i = 0; i < channel.length; i += 1) {
			const value = channel[i];
			if (value === undefined || Number.isFinite(value) !== true) {
				throw new WavInputError({
					reason: "non-finite",
					src,
					channel: c,
					index: i,
				});
			}
		}
	}
	return { sampleRate: decoded.sampleRate, channels, frames };
}

// Documented rule: the mono mix is the mean of the channels per frame. A
// single channel input is copied. An input with no channels or no frames
// yields an empty array.
export function downmixToMono(input: WavInput): Float32Array {
	const channels = input.channels;
	const frames = input.frames;
	if (channels.length === 0 || frames === 0) {
		return new Float32Array(0);
	}
	if (channels.length === 1) {
		const only = channels[0];
		if (only === undefined) {
			return new Float32Array(0);
		}
		return new Float32Array(only);
	}
	const out = new Float32Array(frames);
	for (let i = 0; i < frames; i += 1) {
		let sum = 0;
		for (let c = 0; c < channels.length; c += 1) {
			const channel = channels[c];
			if (channel !== undefined) {
				sum += channel[i] ?? 0;
			}
		}
		out[i] = sum / channels.length;
	}
	return out;
}

export type LoopReader = {
	readonly position: number;
	read(out: Float32Array): void;
};

// Deterministic loop reader over a mono clip. `read` fills the whole output
// block and wraps seamlessly at the end, including blocks longer than the
// clip and a clip of length 1. `position` is the index of the next sample to
// read. The reader holds the provided array without copying, so the caller
// must not mutate it while reading. An empty clip reads silence and keeps
// position at 0.
export function createLoopReader(mono: Float32Array): LoopReader {
	let pos = 0;
	return {
		get position(): number {
			return pos;
		},
		read(out: Float32Array): void {
			if (mono.length === 0) {
				out.fill(0);
				pos = 0;
				return;
			}
			for (let i = 0; i < out.length; i += 1) {
				out[i] = mono[pos] ?? 0;
				pos += 1;
				if (pos >= mono.length) {
					pos = 0;
				}
			}
		},
	};
}

// Minimal context-like shapes used only so tests can inject a fake. The real
// AudioContext satisfies these structurally for the methods used here.
export type WavAudioBufferLike = {
	readonly sampleRate: number;
	readonly length: number;
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
};

export type WavBufferSourceLike = {
	buffer: WavAudioBufferLike | null;
	loop: boolean;
	start(): void;
	stop(): void;
};

export type WavSourceContextLike = {
	createBuffer(
		numberOfChannels: number,
		length: number,
		sampleRate: number,
	): WavAudioBufferLike;
	createBufferSource(): WavBufferSourceLike;
};

// Thin wrapper that creates an AudioBuffer and a buffer source through the
// injected context-like object. It copies the planar input channels into the
// new buffer, assigns it to the source, sets the loop flag, starts the
// source, and connects nothing. The caller connects the returned node.
export function startWavSource(
	ctx: WavSourceContextLike,
	input: WavInput,
	opts: { readonly loop: boolean },
): { readonly node: WavBufferSourceLike; stop(): void } {
	const buffer = ctx.createBuffer(
		input.channels.length,
		input.frames,
		input.sampleRate,
	);
	for (let c = 0; c < input.channels.length; c += 1) {
		const source = input.channels[c];
		if (source !== undefined) {
			buffer.getChannelData(c).set(source);
		}
	}
	const node = ctx.createBufferSource();
	node.buffer = buffer;
	node.loop = opts.loop;
	node.start();
	return {
		node,
		stop: (): void => {
			node.stop();
		},
	};
}

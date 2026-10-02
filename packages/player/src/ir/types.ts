// Shared IR types owned by the player IR rate path.
//
// Plain notes on the choices below. The mono mix is the mean of the decoded
// channels. Level staging belongs to the audio path, so taps are never
// normalised or scaled here.

export type IrTaps = { readonly taps: Float32Array; readonly sampleRate: number };

// Default tap cap. Chosen as 48000 taps, which is one second at 48 kHz.
// Justification: the chain measured its partitioned convolution cost with a
// 48000 tap IR at about 27 times faster than real time in the TypeScript
// node, so this cap keeps routine cabinet captures while refusing IRs that
// are likely accidental (for example a full song decoded as an IR).
export const DEFAULT_MAX_IR_TAPS = 48000;

export interface IrHealth {
	readonly ok: true;
	readonly tapCount: number;
	readonly peak: number;
	readonly peakIndex: number;
	readonly rms: number;
	readonly durationSeconds: number;
	readonly peakAboveOne: boolean;
}

export type IrRefusal =
	| { readonly ok: false; readonly reason: "empty" }
	| { readonly ok: false; readonly reason: "non-finite"; readonly index: number }
	| { readonly ok: false; readonly reason: "all-zero" }
	| {
			readonly ok: false;
			readonly reason: "too-long";
			readonly tapCount: number;
			readonly maxTaps: number;
	  };

export type IrLoadReason =
	| "network-or-cors"
	| "http-status"
	| "decode-failed"
	| "empty"
	| "non-finite"
	| "all-zero"
	| "too-long";

// Minimal structural shape of a fetch response used by loadIr. The real
// fetch Response satisfies this shape; tests pass a fake.
export interface IrFetchResponse {
	readonly ok: boolean;
	readonly status: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

// Minimal structural shape of decoded audio used by loadIr. The real
// AudioBuffer satisfies this shape; tests pass a fake.
export interface IrDecodedAudio {
	readonly sampleRate: number;
	readonly length: number;
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
}

export interface IrLoadDeps {
	readonly fetch: (src: string) => Promise<IrFetchResponse>;
	readonly decodeAudioData: (data: ArrayBuffer) => Promise<IrDecodedAudio>;
}

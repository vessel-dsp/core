// Browser audio input: constraints, getUserMedia open, and device listing.
///
/// <reference lib="dom" />
//
// All browser APIs are injected. This module never reads navigator,
// mediaDevices, or MediaStream globals at import time.
//
// Reason for the fixed constraints: browser echo cancellation, noise
// suppression, and automatic gain control are wrong for an instrument signal,
// so they are always disabled and a single channel is requested.

import type { InputChoice } from "./types.js";

// Key the shell can use to store or check its own feedback warning state.
export const FEEDBACK_WARNING_KEY = "browser-audio-feedback" as const;

// True only for the browser choice, so the shell can show its own warning
// words for microphone feedback. WAV choices never need it.
export function needsFeedbackWarning(choice: InputChoice): boolean {
	return choice.kind === "browser";
}

// Closed reason union for browser audio failures. Callers compare `reason`
// and the carried `name` by whole-value equality and never match message text.
export type BrowserAudioFailureReason =
	| "permission-denied"
	| "no-input-device"
	| "device-busy"
	| "insecure-context"
	| "unknown";

export class BrowserAudioError extends Error {
	readonly reason: BrowserAudioFailureReason;
	readonly originalName: string;

	constructor(reason: BrowserAudioFailureReason, originalName: string) {
		super(`browser audio ${reason}: ${originalName}`);
		this.name = "BrowserAudioError";
		this.reason = reason;
		this.originalName = originalName;
	}
}

// Return EXACTLY audio { echoCancellation false, noiseSuppression false,
// autoGainControl false, channelCount 1, plus deviceId when given }. The
// flags are present and false, not omitted and not merely falsy. When a
// deviceId is given it is requested as { exact } so the named device is
// required rather than preferred.
export function browserAudioConstraints(opts: {
	readonly deviceId?: string;
}): MediaStreamConstraints {
	if (opts.deviceId === undefined) {
		return {
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
				channelCount: 1,
			},
		};
	}
	return {
		audio: {
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			channelCount: 1,
			deviceId: { exact: opts.deviceId },
		},
	};
}

export type BrowserMediaStreamTrackLike = {
	readonly label: string;
	stop(): void;
};

export type BrowserMediaStreamLike = {
	getAudioTracks(): readonly BrowserMediaStreamTrackLike[];
	getTracks(): readonly BrowserMediaStreamTrackLike[];
};

export type BrowserMediaDevicesLike = {
	getUserMedia(
		constraints: MediaStreamConstraints,
	): Promise<BrowserMediaStreamLike>;
};

export type OpenBrowserAudioOptions = {
	readonly deviceId?: string;
};

export type OpenBrowserAudioDeps = {
	readonly mediaDevices: BrowserMediaDevicesLike;
};

// Map a getUserMedia rejection to a typed reason by whole-value comparison
// of the `name` field. Never reads message text.
function mapBrowserAudioError(error: unknown): BrowserAudioError {
	const nameField: unknown = (error as { readonly name?: unknown } | null)
		?.name;
	if (nameField === "NotAllowedError") {
		return new BrowserAudioError("permission-denied", "NotAllowedError");
	}
	if (nameField === "NotFoundError") {
		return new BrowserAudioError("no-input-device", "NotFoundError");
	}
	if (nameField === "OverconstrainedError") {
		return new BrowserAudioError("no-input-device", "OverconstrainedError");
	}
	if (nameField === "NotReadableError") {
		return new BrowserAudioError("device-busy", "NotReadableError");
	}
	if (nameField === "SecurityError") {
		return new BrowserAudioError("insecure-context", "SecurityError");
	}
	const fallback =
		typeof nameField === "string" && nameField !== ""
			? nameField
			: "UnknownError";
	return new BrowserAudioError("unknown", fallback);
}

// Open the microphone with the fixed constraints. Returns the stream, a
// stop function that stops every track, and a label taken from the first
// audio track when it is non-empty, else "Browser audio".
export async function openBrowserAudio(
	opts: OpenBrowserAudioOptions,
	deps: OpenBrowserAudioDeps,
): Promise<{
	readonly stream: BrowserMediaStreamLike;
	stop(): void;
	readonly label: string;
}> {
	const constraints = browserAudioConstraints(opts);
	let stream: BrowserMediaStreamLike;
	try {
		stream = await deps.mediaDevices.getUserMedia(constraints);
	} catch (error) {
		throw mapBrowserAudioError(error);
	}
	const audioTracks = stream.getAudioTracks();
	const first = audioTracks[0];
	const label =
		first !== undefined && first.label !== "" ? first.label : "Browser audio";
	return {
		stream,
		label,
		stop: (): void => {
			for (const track of stream.getTracks()) {
				track.stop();
			}
		},
	};
}

export type EnumeratedDeviceLike = {
	readonly kind: string;
	readonly deviceId: string;
	readonly label: string;
};

export type EnumerateDevicesLike = {
	enumerateDevices(): Promise<readonly EnumeratedDeviceLike[]>;
};

export type ListAudioInputDevicesDeps = {
	readonly mediaDevices: EnumerateDevicesLike;
};

// List audio input devices, keeping only kinds that equal "audioinput" by
// whole-value comparison. Documented rule for empty labels: an empty label
// means permission has not been granted yet and the browser withholds the
// name, so a stable placeholder "Microphone N" is returned where N counts
// audio inputs in enumeration order starting at 1.
export async function listAudioInputDevices(
	deps: ListAudioInputDevicesDeps,
): Promise<{ readonly deviceId: string; readonly label: string }[]> {
	const devices = await deps.mediaDevices.enumerateDevices();
	const out: { readonly deviceId: string; readonly label: string }[] = [];
	let ordinal = 0;
	for (const device of devices) {
		if (device.kind !== "audioinput") {
			continue;
		}
		ordinal += 1;
		const label =
			device.label !== "" ? device.label : `Microphone ${ordinal}`;
		out.push({ deviceId: device.deviceId, label });
	}
	return out;
}

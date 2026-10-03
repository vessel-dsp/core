// NAM slot adapter: fetch a `.nam` URL, read its stated rate through the
// chain engine boundary, and compare against the context rate.
//
// All browser and engine dependencies arrive through arguments. This module
// never reads a global at import time and never touches the DOM,
// AudioContext, or navigator directly, so the controller stays DOM-free.
//
// Failure mapping by whole-value reason codes (see NamLoadReason):
// - the src fails isSafeSrc becomes unsafe-src, and fetch is never called.
// - the context rate is not a positive finite number throws RangeError
//   (a caller bug, not a model refusal; mirrors loadIr's targetSampleRate).
// - fetch rejects, or the body text read rejects, becomes network-or-cors.
// - response ok false becomes http-status and carries the numeric status.
// - the probe rejects (the engine refused the model text) becomes
//   nam-load-failed carrying the engine's own text verbatim.
// - a stated rate differing from the context rate by more than
//   NAM_SAMPLE_RATE_TOLERANCE_HZ becomes rate-mismatch carrying both rates.
// - a model stating no rate (null) is accepted at any context rate.
// Nothing here resamples a model: mismatch refuses, never converts.

import { isSafeSrc } from "../source-list.js";
import type {
	NamFetchResponseLike,
	NamLoadDeps,
	NamLoadReason,
	NamModelInfo,
} from "./types.js";

// A model stating a rate this far from the context rate is refused, not run
// silently. Mirrors chain NamNode's SAMPLE_RATE_TOLERANCE_HZ (0.5 Hz,
// packages/chain/src/nodes/nam-node.ts), which is not exported, so the value
// is repeated here with its source cited instead of imported.
export const NAM_SAMPLE_RATE_TOLERANCE_HZ = 0.5;

// Typed failure for the NAM load path. Compare reason as a whole value.
// Never match on the message text.
export class NamLoadError extends Error {
	readonly reason: NamLoadReason;
	readonly src: string;
	readonly status?: number;
	readonly expectedSampleRate?: number | null;
	readonly contextSampleRate?: number;

	constructor(
		reason: NamLoadReason,
		message: string,
		detail: {
			readonly src: string;
			readonly status?: number;
			readonly expectedSampleRate?: number | null;
			readonly contextSampleRate?: number;
		},
	) {
		super(message);
		this.name = "NamLoadError";
		this.reason = reason;
		this.src = detail.src;
		if (detail.status !== undefined) {
			this.status = detail.status;
		}
		if (detail.expectedSampleRate !== undefined) {
			this.expectedSampleRate = detail.expectedSampleRate;
		}
		if (detail.contextSampleRate !== undefined) {
			this.contextSampleRate = detail.contextSampleRate;
		}
	}
}

// Duck-type check for a NamLoadError from another copy of this module
// (same dual-bundle hazard as PlayerError's isPlayerError). The reason is
// membership-checked, so a foreign object with a bogus reason cannot pass.
const KNOWN_NAM_REASONS: ReadonlySet<string> = new Set([
	"unsafe-src",
	"network-or-cors",
	"http-status",
	"nam-load-failed",
	"rate-mismatch",
]);

export function isNamLoadError(value: unknown): value is NamLoadError {
	if (value instanceof NamLoadError) {
		return true;
	}
	if (value === null || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		candidate.name === "NamLoadError" &&
		typeof candidate.message === "string" &&
		typeof candidate.reason === "string" &&
		KNOWN_NAM_REASONS.has(candidate.reason)
	);
}
// Fetch the `.nam` document at src, read its stated rate through deps.probe
// (the chain engine boundary), and accept it only when unstated or within
// tolerance of contextSampleRate. Throws NamLoadError on every refusal.
export async function loadNam(
	src: string,
	contextSampleRate: number,
	deps: NamLoadDeps,
): Promise<NamModelInfo> {
	if (!isSafeSrc(src)) {
		throw new NamLoadError("unsafe-src", `NAM src refused as unsafe: ${src}`, {
			src,
		});
	}
	if (!(contextSampleRate > 0) || !Number.isFinite(contextSampleRate)) {
		throw new RangeError(
			`loadNam requires a positive contextSampleRate, got ${String(contextSampleRate)}`,
		);
	}
	let response: NamFetchResponseLike;
	try {
		response = await deps.fetch(src);
	} catch (error) {
		throw new NamLoadError(
			"network-or-cors",
			`NAM fetch failed for ${src}: ${error instanceof Error ? error.message : String(error)}`,
			{ src },
		);
	}
	if (response.ok !== true) {
		throw new NamLoadError(
			"http-status",
			`NAM request failed for ${src} with status ${String(response.status)}`,
			{ src, status: response.status },
		);
	}
	let modelText: string;
	try {
		modelText = await response.text();
	} catch (error) {
		throw new NamLoadError(
			"network-or-cors",
			`NAM body read failed for ${src}: ${error instanceof Error ? error.message : String(error)}`,
			{ src },
		);
	}
	let expectedSampleRate: number | null;
	try {
		const probed = await deps.probe(modelText);
		expectedSampleRate = probed.expectedSampleRate;
	} catch (error) {
		throw new NamLoadError(
			"nam-load-failed",
			`NAM model refused for ${src}: ${error instanceof Error ? error.message : String(error)}`,
			{ src },
		);
	}
	if (
		expectedSampleRate !== null &&
		Math.abs(expectedSampleRate - contextSampleRate) > NAM_SAMPLE_RATE_TOLERANCE_HZ
	) {
		throw new NamLoadError(
			"rate-mismatch",
			`NAM model states ${String(expectedSampleRate)} Hz but the context runs at ${String(contextSampleRate)} Hz; refusing to run it at the wrong rate`,
			{ src, expectedSampleRate, contextSampleRate },
		);
	}
	return { src, expectedSampleRate };
}

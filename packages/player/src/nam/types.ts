// Shared NAM slot-adapter types owned by the player.
//
// The adapter fetches a `.nam` URL, asks the chain NAM engine boundary for
// the model's stated rate (never parsing the JSON here), and compares it to
// the page's context rate. It never resamples: a stated rate that differs is
// a typed refusal, and a model stating no rate is accepted.
//
// Why the engine arrives as an injected probe instead of an import: the
// player cannot import the chain barrel (`@vessel-dsp/chain` re-exports the
// runtime node, which pulls the compiler, the runtime, and the missing
// `../../build/v2_dsp.cjs` artifact, so the browser bundle fails to resolve;
// see tests/player/bundle.test.ts history), and the chain package publishes
// no pure NAM subpath (only `.` and `./ir-resample`). The host therefore
// builds the probe from chain itself -- `loadNamModel` plus
// `_nam_getExpectedSampleRate`, exactly what `NamNode.getInfo()` reports --
// and the adapter only fetches, delegates, and compares. Type-only imports
// below keep the compile-time join without emitting runtime imports.

// Closed load reasons. Compared as whole values; never match message text.
// unsafe-src: the src fails isSafeSrc (same rule as the source lists).
// network-or-cors: fetch rejected, or the body read rejected.
// http-status: the response status is not ok; carries the numeric status.
// nam-load-failed: the engine refused the model text; the message carries
//   the engine's own reason verbatim.
// rate-mismatch: the model states a rate that differs from the context rate
//   by more than NAM_SAMPLE_RATE_TOLERANCE_HZ; carries both rates.
export type NamLoadReason =
	| "unsafe-src"
	| "network-or-cors"
	| "http-status"
	| "nam-load-failed"
	| "rate-mismatch";

// What a successful load reports. The rate is the model's own statement as
// the engine read it: a number in Hz, or null when the model states none.
export interface NamModelInfo {
	readonly src: string;
	readonly expectedSampleRate: number | null;
}

// What probing the engine reports for one model document. Kept separate
// from NamModelInfo so the probe stays a pure engine read with no fetch.
export interface NamProbeInfo {
	readonly expectedSampleRate: number | null;
}

// Minimal structural shape of a fetch response used here. Only `ok`,
// `status`, and `text()` are read. The real fetch Response satisfies this
// shape; tests pass a fake.
export interface NamFetchResponseLike {
	readonly ok: boolean;
	readonly status: number;
	text(): Promise<string>;
}

export type NamFetchFn = (src: string) => Promise<NamFetchResponseLike>;

// Reads one model document through the chain NAM engine boundary and
// returns its stated rate (null when unstated). The host implements this
// with chain -- `loadNamModel` for the refusal text plus
// `_nam_getExpectedSampleRate` for the rate, the same pair `NamNode`
// reports through `getInfo()` -- and may be sync or async. A corrupt model
// rejects, and the adapter surfaces the rejection text as nam-load-failed.
export type NamProbeFn = (
	modelText: string,
) => NamProbeInfo | Promise<NamProbeInfo>;

export interface NamLoadDeps {
	readonly fetch: NamFetchFn;
	readonly probe: NamProbeFn;
}

// Controller-level validation hook. The page closes over its fetch, its
// chain probe, and its AudioContext rate: typically
// `(src) => loadNam(src, context.sampleRate, { fetch, probe })`.
// Absent (null) means no validation: selectNam forwards synchronously as
// before, which is what the shell tests and the no-engine path use.
export type NamSlotLoader = (src: string) => NamModelInfo | Promise<NamModelInfo>;

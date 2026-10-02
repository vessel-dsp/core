// Player inputs entrypoint. Re-exports the owned shared types and all
// input helpers. No browser global is read at import time.
export type { InputChoice, WavInput } from "./types.js";
export {
	loadWavInput,
	downmixToMono,
	createLoopReader,
	startWavSource,
	WavInputError,
} from "./wav.js";
export type {
	WavLoadFailureReason,
	WavFetchResponseLike,
	WavFetchFn,
	DecodedAudioLike,
	DecodeAudioDataFn,
	LoadWavInputDeps,
	LoopReader,
	WavAudioBufferLike,
	WavBufferSourceLike,
	WavSourceContextLike,
} from "./wav.js";
export {
	FEEDBACK_WARNING_KEY,
	needsFeedbackWarning,
	browserAudioConstraints,
	openBrowserAudio,
	listAudioInputDevices,
	BrowserAudioError,
} from "./browser.js";
export type {
	BrowserAudioFailureReason,
	BrowserMediaStreamTrackLike,
	BrowserMediaStreamLike,
	BrowserMediaDevicesLike,
	OpenBrowserAudioOptions,
	OpenBrowserAudioDeps,
	EnumeratedDeviceLike,
	EnumerateDevicesLike,
	ListAudioInputDevicesDeps,
} from "./browser.js";
export {
	inputChoicesFromList,
	ReservedInputIdError,
	BROWSER_AUDIO_ID,
	BROWSER_AUDIO_LABEL,
} from "./choices.js";
export type {
	InputListItem,
	ReservedInputIdReason,
} from "./choices.js";

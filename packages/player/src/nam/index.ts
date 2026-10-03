// Player NAM slot adapter entrypoint. Re-exports the owned shared types,
// the typed loader, and the tolerance. No browser global is read at import
// time.
export type {
	NamFetchResponseLike,
	NamFetchFn,
	NamLoadDeps,
	NamLoadReason,
	NamModelInfo,
	NamProbeFn,
	NamProbeInfo,
	NamSlotLoader,
} from "./types.js";
export { NAM_SAMPLE_RATE_TOLERANCE_HZ, NamLoadError, loadNam } from "./load.js";

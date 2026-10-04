// Player-specific admission measurement report: the shapes the player
// worklet adds to the runtime protocol's `loaded` reply, and the flag the
// engine sends on `load`.
//
// The runtime protocol (`V2WorkletOutboundMessage`) is owned by
// `@vessel-dsp/runtime` and cannot grow player fields; these ride the same
// messages as extra properties (the worklet posts them, the engine reads
// them through local types). Both sides import this file as types only, so
// it adds no runtime edge to either bundle -- in particular the worklet
// bundle's no-external-imports assertion is unaffected.

/** One program slot's solver-schedule counters, read off the WASM console. */
export type PlayerProgramScheduleEntry = {
	readonly slot: number;
	/** Every solve that ran a schedule since prepare. */
	readonly solves: number;
	/** Schedule solves that collapsed on a pivot and were re-solved densely. */
	readonly fallbacks: number;
	/** Solves that ran a compiled sparse kernel. */
	readonly kernelSolves: number;
	readonly repivotedBlocks: number;
	readonly abandonedBlocks: number;
	readonly droppedBlocks: number;
};

/**
 * Player extension on the inbound `load` message. The runtime worklet
 * ignores it; the player worklet reads it. Absent means measure (the
 * fail-closed direction: a load that does not explicitly opt out is
 * measured). The engine sets it false only on selection rebuilds, where the
 * program is unchanged and its cost is already cached -- re-measuring on the
 * audio thread mid-playback would itself be a dropout.
 */
export type PlayerLoadMeasurementFlag = {
	readonly playerMeasureProgram?: boolean;
};

/** Player extension on the outbound `loaded` reply. */
export type PlayerLoadedMeasurement = {
	/**
	 * This program's own per-sample cost in nanoseconds, timed on the
	 * shipped console on the audio thread during this load (warmed,
	 * median-of-3, same 128-frame method the main-thread probe used), summed
	 * over the program slots. Null when nothing was measured (flag off, no
	 * wasm engine, or the timing threw): the static verdict decides then.
	 */
	readonly measuredNsPerSample?: number | null;
	readonly programSchedule?: readonly PlayerProgramScheduleEntry[];
};

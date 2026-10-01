// The typed boundary to `nam-engine/nam-engine.js`, the plain-WASM NAM inference library.
//
// Separate from the node for one reason that matters: **instantiating the module is asynchronous,
// and `NamNode.prepare` is not.** So the async half lives here and is awaited by whoever builds a
// chain, leaving the node itself synchronous and therefore testable without a promise in the audio
// path. Everything after instantiation -- creating an instance, loading a model, processing a block
// -- is a synchronous WASM call.
//
// Built and vendored by `scripts/build-nam-engine.sh`; licences in `nam-engine/NOTICE.md`. The
// exports below are the ones this package uses, not the module's full surface.

/** The subset of the Emscripten module this package calls. */
export type NamEngineModule = {
	/** @returns a 1-based instance id, or 0 on refusal. */
	_nam_createInstance(sampleRate: number, maxFrames: number): number;
	_nam_destroyInstance(id: number): void;
	/** @returns 1 on success, 0 on failure -- then read `_nam_getLastError`. */
	_nam_loadModel(id: number, jsonPtr: number, slimSize: number): number;
	_nam_hasModel(id: number): number;
	/** Pointer to `maxFrames` floats. Write input, call process, read output back. */
	_nam_getBuffer(id: number): number;
	/** In-place over the instance's buffer. Real-time safe: no allocation, no exceptions. */
	_nam_process(id: number, frames: number): void;
	_nam_hasLoudness(id: number): number;
	/** The model's own output level in dB for a nominal signal, from its metadata. */
	_nam_getLoudness(id: number): number;
	/** The rate the model was captured at, or negative when it states none. */
	_nam_getExpectedSampleRate(id: number): number;
	/** True for A2 models -- NAM's newer architecture, which can trade size for cost. */
	_nam_isSlimmable(id: number): number;
	_nam_setSlimmableSize(id: number, slimSize: number): void;
	_nam_getSlimmableBreakpointCount(id: number): number;
	_nam_getSlimmableBreakpoint(id: number, index: number): number;
	_nam_getLastError(): number;
	_malloc(bytes: number): number;
	_free(ptr: number): void;
	lengthBytesUTF8(text: string): number;
	stringToUTF8(text: string, ptr: number, maxBytes: number): void;
	UTF8ToString(ptr: number): string;
	/** Re-read after anything that may grow the heap: growth detaches existing views. */
	HEAPF32: Float32Array;
};

type NamEngineFactory = (options: {
	readonly wasmBinary: ArrayBufferLike;
	readonly locateFile?: (path: string) => string;
}) => Promise<NamEngineModule>;

/**
 * One module per scope, many instances inside it.
 *
 * Memoized because instantiation compiles 420 KB of WebAssembly, and because a second
 * instantiation is what upstream abandoned its previous architecture over: doing it again on the
 * audio thread triggered a ~500 MB recompile storm in WebKit that crossed the iOS Jetsam limit and
 * crashed the tab. Multiple NAM nodes share this module and are separated by instance id.
 */
let modulePromise: Promise<NamEngineModule> | null = null;

/**
 * Instantiate the engine from wasm bytes the caller supplies.
 *
 * **The bytes are passed in rather than fetched, and that is a hard requirement, not a preference.**
 * An `AudioWorkletGlobalScope` has no `fetch`, so the glue's own loader cannot run there. For the
 * same reason `locateFile` is stubbed to the identity: a worklet scope has no `URL` constructor
 * either, and the glue would otherwise build a path it never uses.
 */
export async function instantiateNamEngine(
	wasmBinary: ArrayBufferLike,
	factory: NamEngineFactory,
): Promise<NamEngineModule> {
	modulePromise ??= factory({ wasmBinary, locateFile: (path) => path });
	return modulePromise;
}

/** Drop the memo. Tests only -- a host has no reason to re-instantiate. */
export function resetNamEngineForTests(): void {
	modulePromise = null;
}

/** The loudness target the engine normalises to internally, in dB. See {@link namLoudness}. */
export const NAM_LOUDNESS_TARGET_DB = -18;

export type NamLoudness = {
	/** What the model states, or `null` when its metadata carries none. */
	readonly modelLoudnessDb: number | null;
	/**
	 * The gain the engine applies inside `nam_process`, as a linear factor.
	 *
	 * **Reported, never applied by us.** `nam_process` already multiplies by this -- it implements
	 * NAM's `Normalized` output mode, `10^((-18 - modelLoudness)/20)`, with smoothing against
	 * clicks. Applying it again in the node would double it. This value exists so a host can
	 * *show* what the engine did, which is the difference between a level a user can reason about
	 * and one that merely happens.
	 */
	readonly appliedGain: number;
};

/** What the engine will do to this instance's level, read from the loaded model's metadata. */
export function namLoudness(
	module: NamEngineModule,
	instanceId: number,
): NamLoudness {
	if (module._nam_hasLoudness(instanceId) !== 1) {
		// NAM's `Raw` mode: no metadata, so no normalisation. The engine returns 1.0 here for the
		// same reason, and the node must not invent a figure of its own.
		return { modelLoudnessDb: null, appliedGain: 1 };
	}
	const modelLoudnessDb = module._nam_getLoudness(instanceId);
	return {
		modelLoudnessDb,
		appliedGain: 10 ** ((NAM_LOUDNESS_TARGET_DB - modelLoudnessDb) / 20),
	};
}

/**
 * Load a `.nam` document into an instance, or throw with the engine's own reason.
 *
 * Not real-time safe: it parses JSON, allocates the network and prewarms it. Call it before the
 * node is in a running chain, which is what building the chain from a preset does.
 */
export function loadNamModel(
	module: NamEngineModule,
	instanceId: number,
	modelJson: string,
	slimSize: number,
): void {
	const byteLength = module.lengthBytesUTF8(modelJson) + 1;
	const pointer = module._malloc(byteLength);
	// **The return of `_malloc` is validated, and this is the guard a "memory access out of
	// bounds" crash was missing.** The engine is built with a hard 512 MiB ceiling
	// (`scripts/build-nam-engine.sh`: `ALLOW_MEMORY_GROWTH=1`, `INITIAL_MEMORY=64MB`,
	// `MAXIMUM_MEMORY=512MB`), and when the heap cannot grow any further emmalloc gives up and
	// returns 0 instead of throwing. Writing the model JSON at offset 0 would then clobber
	// Emscripten's static globals (`DYNAMICTOP_PTR`, `__heap_base`, the ctor tables), and the
	// engine's next internal allocation would address memory past the heap's end and trap inside
	// `_nam_loadModel` with `RuntimeError: memory access out of bounds` -- far from the point of
	// failure, where nothing could name it. A healthy allocation always satisfies both checks by
	// construction: a region emmalloc returns always fits in the current memory, so this can only
	// trip on a failed or corrupt allocation, never on a legitimate one.
	const heapBytes = module.HEAPF32.buffer.byteLength;
	if (pointer <= 0 || pointer + byteLength > heapBytes) {
		throw new Error(
			`nam-engine heap allocation failed: _malloc(${byteLength}) returned ${pointer}, ` +
				`heap holds ${heapBytes} bytes (the engine's ceiling is 512 MiB)`,
		);
	}
	try {
		module.stringToUTF8(modelJson, pointer, byteLength);
		if (module._nam_loadModel(instanceId, pointer, slimSize) !== 1) {
			const reason = module.UTF8ToString(module._nam_getLastError());
			throw new Error(
				`nam_loadModel refused the model${reason === "" ? "" : `: ${reason}`}`,
			);
		}
	} finally {
		// Freed on the throwing path too: a refused model must not leak the JSON it was refused
		// for, and a chain that reports one bad node is expected to keep running.
		module._free(pointer);
	}
}

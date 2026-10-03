// Default NAM probe for the real player engine, built from chain.
//
// The probe reads a `.nam` document's stated rate through the chain NAM
// engine boundary (`loadNamModel` for the refusal text plus
// `_nam_getExpectedSampleRate`, exactly what `NamNode.getInfo()` reports),
// never parsing the model JSON here. It is built LAZILY -- only when a NAM
// is actually selected -- so the NAM glue and wasm are never fetched for a
// pedal-only chain (section 5 loading strategy).
//
// Both the glue module and the wasm bytes arrive by URL: the glue through a
// dynamic `import()` of the shipped `nam-engine-glue.js` copy (a full URL
// works with no import map), the bytes through `fetch`. The instantiated
// module is memoized per engine: compiling 420 KB of WebAssembly twice for
// one selection would be the recompile cost the engine boundary memoizes
// against.

import type { NamProbeFn } from "../nam/types.js";

export type ChainProbeDeps = {
	readonly fetch: (src: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
	readonly importGlue: (url: string) => Promise<unknown>;
	readonly namGlueUrl: string;
	readonly namWasmUrl: string;
};

// The subset of the chain barrel this probe uses. Imported as a type only
// so the value import below stays the single runtime join.
export type ChainNamBoundary = {
	instantiateNamEngine(
		wasmBinary: ArrayBufferLike,
		factory: (options: { readonly wasmBinary: ArrayBufferLike }) => Promise<unknown>,
	): Promise<unknown>;
	loadNamModel(module: unknown, instanceId: number, modelJson: string, slimSize: number): void;
};

export async function createChainNamProbe(
	boundary: ChainNamBoundary,
	deps: ChainProbeDeps,
): Promise<NamProbeFn> {
	const glueModule = (await deps.importGlue(deps.namGlueUrl)) as {
		default: (options: { readonly wasmBinary?: ArrayBufferLike }) => Promise<unknown>;
	};
	const wasmResponse = await deps.fetch(deps.namWasmUrl);
	if (wasmResponse.ok !== true) {
		throw new Error(`NAM engine request failed with status ${String(wasmResponse.status)}`);
	}
	const wasmBytes = await wasmResponse.arrayBuffer();
	const engine = (await boundary.instantiateNamEngine(wasmBytes, (options) =>
		glueModule.default({ wasmBinary: options.wasmBinary }),
	)) as {
		_nam_createInstance(sampleRate: number, maxFrames: number): number;
		_nam_destroyInstance(id: number): void;
		_nam_getExpectedSampleRate(id: number): number;
	};
	return (modelText: string): { expectedSampleRate: number | null } => {
		const instanceId = engine._nam_createInstance(48000, 1024);
		if (instanceId <= 0) {
			throw new Error("nam_createInstance refused");
		}
		try {
			boundary.loadNamModel(engine, instanceId, modelText, -1);
			const expected = engine._nam_getExpectedSampleRate(instanceId);
			return { expectedSampleRate: expected < 0 ? null : expected };
		} finally {
			engine._nam_destroyInstance(instanceId);
		}
	};
}

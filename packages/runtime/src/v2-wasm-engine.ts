// TypeScript wrapper around the C++/WASM V2 Engine console.

import type { Program } from "@vessel-dsp/compiler";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let v2ModulePromise: Promise<any> | null = null;

export async function getV2WasmModule() {
	if (!v2ModulePromise) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		// @ts-ignore
		const createV2Module = (await import("../../build/v2_dsp.cjs")).default;
		v2ModulePromise = createV2Module();
	}
	return v2ModulePromise;
}

export class V2WasmEngine {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private mod: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private handle: any;
	private inPtr: number = 0;
	private outPtr: number = 0;
	private inBufferCapacity: number = 0;
	private outBufferCapacity: number = 0;
	private inputFloatView: Float32Array | null = null;
	private outputFloatView: Float32Array | null = null;

	private constructor(mod: any, handle: any) {
		this.mod = mod;
		this.handle = handle;
	}

	/**
	 * `mod` injects an already-instantiated Emscripten module, for hosts where the default
	 * dynamic import cannot run — an AudioWorkletGlobalScope bundles the glue statically and
	 * instantiates the wasm from bytes it was posted (see v2-audio-worklet.ts). Omitted, the
	 * module loads from `build/` as before (bun scripts, node).
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public static async create(program?: Program, mod?: any): Promise<V2WasmEngine> {
		mod ??= await getV2WasmModule();
		const handle = mod._v2_engine_create();
		if (!handle) {
			throw new Error("Failed to allocate V2 C++ Engine handle in WASM memory");
		}
		const engine = new V2WasmEngine(mod, handle);
		if (program) {
			engine.loadProgram(program);
		}
		return engine;
	}

	public destroy(): void {
		if (this.handle) {
			this.mod._v2_engine_destroy(this.handle);
			this.handle = 0;
		}
	}

	public loadProgram(program: Program): void {
		const json = JSON.stringify(program);
		const len = this.mod.lengthBytesUTF8(json) + 1;
		const ptr = this.mod._malloc(len);
		this.mod.stringToUTF8(json, ptr, len);
		const ok = this.mod._v2_engine_load_json(this.handle, ptr);
		this.mod._free(ptr);
		if (!ok) {
			const errPtr = this.mod._v2_engine_get_last_error(this.handle);
			const errStr = errPtr ? this.mod.UTF8ToString(errPtr) : "";
			throw new Error(`Failed to load program into V2 C++ Engine${errStr ? `: ${errStr}` : ""}`);
		}
	}

	public prepare(options: { sampleRate?: number; maxNewtonIterations?: number; inputSourceOhms?: number } = {}): void {
		const sr = options.sampleRate ?? 48000.0;
		const maxIters = options.maxNewtonIterations ?? 64;
		const inputOhms = options.inputSourceOhms ?? 0.0;
		this.mod._v2_engine_prepare(this.handle, sr, maxIters, inputOhms);
	}

	public reset(): void {
		this.mod._v2_engine_reset(this.handle);
	}

	public setControl(controlId: string, position: number): void {
		const len = this.mod.lengthBytesUTF8(controlId) + 1;
		const ptr = this.mod._malloc(len);
		this.mod.stringToUTF8(controlId, ptr, len);
		this.mod._v2_engine_set_control(this.handle, ptr, position);
		this.mod._free(ptr);
	}

	public getControl(controlId: string): number {
		const len = this.mod.lengthBytesUTF8(controlId) + 1;
		const ptr = this.mod._malloc(len);
		this.mod.stringToUTF8(controlId, ptr, len);
		const val = this.mod._v2_engine_get_control(this.handle, ptr);
		this.mod._free(ptr);
		return val;
	}

	public processSample(input: number): number {
		return this.mod._v2_engine_process_sample(this.handle, input);
	}

	public processBlock(input: Float32Array, output: Float32Array): void {
		const frames = input.length;
		// Views are built on HEAPU8.buffer: the Emscripten glue exports HEAP8/HEAPU8/HEAPF64
		// but NOT HEAPF32, and this method's original `this.mod.HEAPF32.buffer` threw on the
		// first block-mode caller (the WASM-console worklet path), which every prior
		// instrument missed because they all use processSample. Buffer identity against
		// HEAPU8.buffer also catches heap growth, same as before.
		const heapBuffer = () => this.mod.HEAPU8.buffer as ArrayBuffer;
		if (frames > this.inBufferCapacity || this.inputFloatView?.buffer !== heapBuffer()) {
			this.inPtr = this.mod._v2_engine_get_input_buffer(this.handle, frames);
			this.outPtr = this.mod._v2_engine_get_output_buffer(this.handle, frames);
			this.inBufferCapacity = Math.max(frames, this.inBufferCapacity);
			this.outBufferCapacity = this.inBufferCapacity;
			this.inputFloatView = new Float32Array(heapBuffer(), this.inPtr, this.inBufferCapacity);
			this.outputFloatView = new Float32Array(heapBuffer(), this.outPtr, this.outBufferCapacity);
		}

		this.inputFloatView!.set(input);
		this.mod._v2_engine_process_internal(this.handle, frames);
		output.set(this.outputFloatView!.subarray(0, frames));
	}

	public getLastIterationCount(): number {
		return this.mod._v2_engine_get_last_iteration_count(this.handle);
	}

	public getLastConverged(): boolean {
		return this.mod._v2_engine_get_last_converged(this.handle) !== 0;
	}

	public getMaxIterations(): number {
		return this.mod._v2_engine_get_max_iterations(this.handle);
	}

	public getOperatingPointNode(blockIdx: number, node: number): number {
		return this.mod._v2_engine_get_operating_point(this.handle, blockIdx, node);
	}

	public getStateValue(blockIdx: number, stateIdx: number): number {
		return this.mod._v2_engine_get_state(this.handle, blockIdx, stateIdx);
	}

	public getLastError(): string {
		const errPtr = this.mod._v2_engine_get_last_error(this.handle);
		return errPtr ? this.mod.UTF8ToString(errPtr) : "";
	}
}

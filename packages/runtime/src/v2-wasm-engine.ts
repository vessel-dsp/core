// TypeScript wrapper around the C++/WASM V2 Engine console.

import type { Program } from "@vessel-dsp/compiler";
import { DEFAULT_NEWTON_MAX_ITERATIONS, RuntimeError } from "./reference-runtime";
import type { SupplyAddress, SupplyInfo } from "./supply";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let v2ModulePromise: Promise<any> | null = null;

export async function getV2WasmModule() {
	if (!v2ModulePromise) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		// @ts-ignore
		const createV2Module = (await import("./wasm/v2_dsp.cjs")).default;
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
	/**
	 * This wrapper's own copy of the loaded program, so `getSupplies` reflects
	 * the live supply values the engine solves with. Cloned on load so the
	 * caller's object is never mutated; updated stamp-for-stamp beside every
	 * successful engine `setSupply`, and only then.
	 */
	private program: Program | null = null;

	private constructor(mod: any, handle: any) {
		this.mod = mod;
		this.handle = handle;
	}

	/**
	 * `mod` injects an already-instantiated Emscripten module, for hosts where the default
	 * dynamic import cannot run — an AudioWorkletGlobalScope bundles the glue statically and
	 * instantiates the wasm from bytes it was posted (see v2-audio-worklet.ts). Omitted, the
	 * module loads from `./wasm/`, the release artifact `scripts/build-wasm.sh` writes (bun scripts, node).
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
		// JSON round-trip, not `structuredClone`: this runs inside an AudioWorkletGlobalScope, which
		// does not expose `structuredClone`. The program is JSON by construction (stringified above).
		this.program = JSON.parse(json) as Program;
	}

	public prepare(
		options: { sampleRate?: number; maxNewtonIterations?: number; inputSourceOhms?: number; oversample?: number } = {},
	): void {
		const sr = options.sampleRate ?? 48000.0;
		// The product runs DEFAULT_NEWTON_MAX_ITERATIONS (chain.ts:137); a lower default
		// here made every bun-hosted probe cap-conditioned against the shipping console.
		const maxIters = options.maxNewtonIterations ?? DEFAULT_NEWTON_MAX_ITERATIONS;
		const inputOhms = options.inputSourceOhms ?? 0.0;
		// The oversample factor is a property of the host: validated exactly
		// like `ReferenceRuntime.prepare` (floor, floor of 1, non-finite
		// refused with the same message), then passed to the native `prepare`
		// whose signature takes it explicitly -- there is no second export.
		const oversample = Math.max(1, Math.floor(options.oversample ?? 1));
		if (!Number.isFinite(oversample)) {
			throw new RuntimeError(
				`oversample must be a finite integer of at least 1, got ${String(options.oversample)}`,
			);
		}
		this.mod._v2_engine_prepare(this.handle, sr, maxIters, inputOhms, oversample);
	}

	/**
	 * The rate `prepare` was called with (the host rate), as opposed to the
	 * solver's sub-sample rate -- the same name and semantics as
	 * `ReferenceRuntime.hostSampleRate()`, including `null` before
	 * `prepare()`.
	 */
	public hostSampleRate(): number | null {
		const value = this.mod._v2_engine_get_host_sample_rate(this.handle) as number;
		return value < 0 ? null : value;
	}

	/**
	 * The resampler's total group delay in **host** samples -- the same name
	 * and semantics as `ReferenceRuntime.oversampleLatency()`, including
	 * `null` before `prepare()` and 0 on the held path (factor 1 or a factor
	 * that is not a power of two).
	 */
	public oversampleLatency(): number | null {
		const value = this.mod._v2_engine_get_oversample_latency(this.handle) as number;
		return value < 0 ? null : value;
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

	/**
	 * Every addressable `dc-source` stamp in `program.blocks` order, then stamp
	 * order within each block -- the same order and the same `SupplyInfo` shape
	 * as the TypeScript runtime, so `infos.map((info) => info.address)` feeds
	 * `setSupply` directly. Reads this wrapper's own live record, which tracks
	 * every successful `setSupply`, not the caller's original object.
	 */
	public getSupplies(): readonly SupplyInfo[] {
		if (this.program === null) return [];
		const infos: SupplyInfo[] = [];
		for (const [blockIndex, block] of this.program.blocks.entries()) {
			if (block.kind !== "mna") continue;
			for (const stamp of block.stamps) {
				if (stamp.kind !== "dc-source") continue;
				infos.push({
					address: { blockIndex, sourceIndex: stamp.sourceIndex },
					positive: stamp.positive,
					negative: stamp.negative,
					volts: stamp.volts,
					sourceOhms: stamp.sourceOhms,
				});
			}
		}
		return infos;
	}

	/**
	 * Retarget one or more supply stamps between `process()` calls, with the
	 * SAME validation and `RuntimeError` behaviour as
	 * `ReferenceRuntime.setSupply`: `volts` must be finite, `sourceOhms` finite
	 * and non-negative, and every address must name an existing `dc-source`
	 * stamp. All addresses are validated before the engine is touched once per
	 * address, so a bad address leaves even the valid ones unchanged; if the
	 * engine itself refuses one after that, the wrapper's record tracks exactly
	 * the calls that succeeded, so wrapper and engine stay consistent, and the
	 * error names the address. Reapplying the values a stamp already carries
	 * calls nothing and changes nothing.
	 */
	public setSupply(addresses: readonly SupplyAddress[], volts: number, sourceOhms: number): void {
		if (this.program === null) {
			throw new RuntimeError("setSupply: no program loaded");
		}
		if (!Number.isFinite(volts)) {
			throw new RuntimeError(`supply volts ${String(volts)} is not finite`);
		}
		if (!Number.isFinite(sourceOhms) || sourceOhms < 0) {
			throw new RuntimeError(
				`supply sourceOhms ${String(sourceOhms)} is not a finite non-negative resistance`,
			);
		}
		type Target = { blockIndex: number; sourceIndex: number };
		const targets: Target[] = [];
		for (const address of addresses) {
			const block =
				Number.isInteger(address.blockIndex) &&
				address.blockIndex >= 0 &&
				address.blockIndex < this.program.blocks.length
					? this.program.blocks[address.blockIndex]
					: undefined;
			if (block === undefined) {
				throw new RuntimeError(`setSupply: unknown block index ${String(address.blockIndex)}`);
			}
			if (block.kind !== "mna") {
				throw new RuntimeError(
					`setSupply: block index ${address.blockIndex} ("${block.id}") is not an MNA block`,
				);
			}
			let matched = false;
			for (const stamp of block.stamps) {
				if (stamp.kind === "dc-source" && stamp.sourceIndex === address.sourceIndex) {
					matched = true;
					break;
				}
			}
			if (!matched) {
				throw new RuntimeError(
					`setSupply: block index ${address.blockIndex} ("${block.id}") has no dc-source with sourceIndex ${String(address.sourceIndex)}`,
				);
			}
			targets.push({ blockIndex: address.blockIndex, sourceIndex: address.sourceIndex });
		}
		if (targets.length === 0) return;
		// Deduplicate and drop stamps that already carry the values: only a real
		// change reaches the engine, mirroring the reference runtime's no-op rule.
		const seen = new Set<string>();
		const pending: Target[] = [];
		for (const target of targets) {
			const key = `${target.blockIndex}:${target.sourceIndex}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const block = this.program.blocks[target.blockIndex];
			if (block?.kind !== "mna") continue;
			let alreadyMatches = true;
			let hasStamp = false;
			for (const stamp of block.stamps) {
				if (stamp.kind === "dc-source" && stamp.sourceIndex === target.sourceIndex) {
					hasStamp = true;
					if (stamp.volts !== volts || stamp.sourceOhms !== sourceOhms) {
						alreadyMatches = false;
					}
				}
			}
			if (!hasStamp || alreadyMatches) continue;
			pending.push(target);
		}
		if (pending.length === 0) return;
		const setSupplyFn = this.mod._v2_engine_set_supply as
			| ((handle: unknown, blockIndex: number, sourceIndex: number, volts: number, sourceOhms: number) => number)
			| undefined;
		if (typeof setSupplyFn !== "function") {
			throw new RuntimeError("setSupply: wasm console was built without v2_engine_set_supply; rebuild with scripts/build-wasm.sh");
		}
		for (const target of pending) {
			const code = setSupplyFn(this.handle, target.blockIndex, target.sourceIndex, volts, sourceOhms);
			if (code !== 0) {
				throw new RuntimeError(
					`setSupply: block index ${target.blockIndex} sourceIndex ${target.sourceIndex} refused by the engine (code ${code})`,
				);
			}
			// Engine accepted it: move the wrapper's own record alongside, stamp
			// for stamp, so getSupplies reflects the values the solver now reads.
			const block = this.program?.blocks[target.blockIndex];
			if (block?.kind === "mna") {
				for (const stamp of block.stamps) {
					if (stamp.kind === "dc-source" && stamp.sourceIndex === target.sourceIndex) {
						(stamp as { volts: number }).volts = volts;
						(stamp as { sourceOhms: number }).sourceOhms = sourceOhms;
					}
				}
			}
		}
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

	/**
	 * Whether the compiled sparse schedules are actually running on this console.
	 *
	 * The mirror of `ReferenceRuntime.solverPlan()`'s `scheduleSolves`/`scheduleFallbacks`/
	 * `abandoned`/`dropped`, which existed on the TypeScript side and had no counterpart here — so the
	 * console that ships was the one that could not be asked. `solves` counts every solve that
	 * ran a schedule since `prepare()`/`reset()`, `fallbacks` how many of those collapsed on a
	 * pivot and were re-solved densely (paying for both), `abandonedBlocks` how many
	 * admitted blocks have given their schedule up for good, and `droppedBlocks` how many
	 * were moved to dense at `prepare()` because their shipped order disagreed with dense
	 * on the operating-point matrix.
	 *
	 * A healthy packet reads `fallbacks === 0` and `abandonedBlocks === 0`. Anything else is a
	 * cost defect even though the audio is correct.
	 */
	public getScheduleTelemetry(): {
		readonly solves: number;
		readonly fallbacks: number;
		readonly kernelSolves: number;
		readonly repivotedBlocks: number;
		readonly abandonedBlocks: number;
		readonly droppedBlocks: number;
	} {
		return {
			solves: this.mod._v2_engine_get_schedule_solves(this.handle),
			fallbacks: this.mod._v2_engine_get_schedule_fallbacks(this.handle),
			kernelSolves: this.mod._v2_engine_get_kernel_solves(this.handle),
			repivotedBlocks: this.mod._v2_engine_get_repivoted_schedule_blocks(this.handle),
			abandonedBlocks: this.mod._v2_engine_get_abandoned_schedule_blocks(this.handle),
			droppedBlocks: this.mod._v2_engine_get_dropped_schedule_blocks(this.handle),
		};
	}
}

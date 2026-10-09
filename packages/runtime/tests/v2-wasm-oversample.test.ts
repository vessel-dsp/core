// Band-limited oversampling on the C++/WASM console.
// Port parity against `ReferenceRuntime` (the fixed reference): the same
// solver rate, the same half-band cascades, the same held path, the same
// readings -- at every factor. Every test here needs the compiled console,
// so the whole suite skips by name when `src/wasm/` is absent, exactly as
// `wasm-presence.ts` prescribes.
import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import {
	clippingOverdriveStage,
	rcLowPass,
	resistorDivider,
} from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime, RuntimeError } from "../src/reference-runtime";
import {
	cascadeLatencyHostSamples,
	designHalfBand2x,
	HalfBandStage2x,
	RESAMPLE_STAGE_SPECS,
	resampleStageSpec,
} from "../src/resample";
import { getV2WasmModule, V2WasmEngine } from "../src/v2-wasm-engine";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

const RATE = 48_000;

function programFor(source: string): Program {
	const result = compile(source, { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`fixture no longer compiles: ${JSON.stringify(result)}`);
	}
	return result.program;
}

function sine(length: number, hz: number, amplitude: number, rate = RATE): Float64Array {
	const input = new Float64Array(length);
	for (let index = 0; index < length; index += 1) {
		input[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / rate);
	}
	return input;
}

/** Least-squares fundamental amplitude of a settled render. */
function fundamental(output: Float64Array, hz: number, rate = RATE): number {
	let cc = 0;
	let cs = 0;
	let ss = 0;
	let tc = 0;
	let ts = 0;
	for (let index = 0; index < output.length; index += 1) {
		const phase = (2 * Math.PI * hz * index) / rate;
		const cos = Math.cos(phase);
		const sin = Math.sin(phase);
		cc += cos * cos;
		cs += cos * sin;
		ss += sin * sin;
		tc += (output[index] ?? 0) * cos;
		ts += (output[index] ?? 0) * sin;
	}
	const det = cc * ss - cs * cs;
	return Math.hypot((tc * ss - ts * cs) / det, (cc * ts - cs * tc) / det);
}

function correlation(a: Float64Array, b: Float64Array): number {
	const n = a.length;
	let sumA = 0;
	let sumB = 0;
	let sumAA = 0;
	let sumBB = 0;
	let sumAB = 0;
	for (let i = 0; i < n; i += 1) {
		const va = a[i] ?? 0;
		const vb = b[i] ?? 0;
		sumA += va;
		sumB += vb;
		sumAA += va * va;
		sumBB += vb * vb;
		sumAB += va * vb;
	}
	const varA = Math.max(0, sumAA - (sumA * sumA) / n);
	const varB = Math.max(0, sumBB - (sumB * sumB) / n);
	if (varA <= 1e-12 && varB <= 1e-12) return 1;
	if (varA <= 1e-12 || varB <= 1e-12) return 0;
	const cov = sumAB - (sumA * sumB) / n;
	return Math.max(-1, Math.min(1, cov / Math.sqrt(varA * varB)));
}

function maxAbs(a: Float64Array, b: Float64Array): number {
	let worst = 0;
	for (let i = 0; i < a.length; i += 1) {
		worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
	}
	return worst;
}

async function renderWasmSamples(program: Program, input: Float64Array, oversample: number): Promise<Float64Array> {
	const engine = await V2WasmEngine.create(program);
	engine.prepare({ sampleRate: RATE, oversample });
	const output = new Float64Array(input.length);
	for (let index = 0; index < input.length; index += 1) {
		output[index] = engine.processSample(input[index] ?? 0);
	}
	engine.destroy();
	return output;
}

function renderTs(program: Program, input: Float64Array, oversample: number): Float64Array {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(RATE, oversample === 1 ? {} : { oversample });
	return runtime.process(input);
}

describe.skipIf(!wasmBinaryPresent)(
	`V2WasmEngine band-limited oversampling${WASM_SKIP_REASON ? ` (${WASM_SKIP_REASON})` : ""}`,
	() => {
		it("designs each stage's half-band prototype bit-for-bit like the reference", async () => {
			// Each 2x stage owns its prototype from RESAMPLE_STAGE_SPECS; the
			// test-only getters expose every stage's coefficients so this pins
			// each stage's taps with Object.is. Stage 3 (oversample 16) reuses
			// the last spec entry by the clamp-to-last rule, so it must read
			// identically to stage 2. The (57, 8.3) designHalfBand2x defaults
			// stay as the parity anchor.
			expect(designHalfBand2x().length).toBe(57);
			const mod = await getV2WasmModule();
			expect(mod._v2_resample_stage_count()).toBe(RESAMPLE_STAGE_SPECS.length);
			for (let stage = 0; stage <= RESAMPLE_STAGE_SPECS.length; stage += 1) {
				const [taps, beta] = resampleStageSpec(stage);
				expect(mod._v2_resample_prototype_length(stage)).toBe(taps);
				const expected = designHalfBand2x(taps, beta);
				expect(expected.length).toBe(taps);
				for (let index = 0; index < expected.length; index += 1) {
					const actual = mod._v2_resample_prototype_tap(stage, index) as number;
					expect(Object.is(actual, expected[index])).toBe(true);
				}
			}
		});

		it("validates the factor exactly like ReferenceRuntime.prepare", async () => {
			const program = programFor(resistorDivider);
			const engine = await V2WasmEngine.create(program);
			// Non-finite is refused with the reference's message.
			expect(() => engine.prepare({ sampleRate: RATE, oversample: Number.NaN })).toThrow(RuntimeError);
			expect(() => engine.prepare({ sampleRate: RATE, oversample: Number.NaN })).toThrow(
				/oversample must be a finite integer of at least 1/,
			);
			expect(() => engine.prepare({ sampleRate: RATE, oversample: Number.POSITIVE_INFINITY })).toThrow(
				RuntimeError,
			);
			// Below 1 clamps to the plain path; fractions floor.
			engine.prepare({ sampleRate: RATE, oversample: 0 });
			expect(engine.hostSampleRate()).toBe(RATE);
			expect(engine.oversampleLatency()).toBe(0);
			engine.prepare({ sampleRate: RATE, oversample: 2.7 });
			expect(engine.oversampleLatency()).toBe(19.5);
			engine.destroy();
		});

		it("reports the host rate and the cascade latency, and null before prepare", async () => {
			const program = programFor(resistorDivider);
			const idle = await V2WasmEngine.create(program);
			expect(idle.hostSampleRate()).toBeNull();
			expect(idle.oversampleLatency()).toBeNull();
			idle.destroy();
			for (const [oversample, latency] of [
				[1, 0],
				[2, 19.5],
				[4, 26.25],
				[8, 28.625],
				[16, cascadeLatencyHostSamples(4)],
				[32, cascadeLatencyHostSamples(5)],
			] as const) {
				const engine = await V2WasmEngine.create(program);
				engine.prepare({ sampleRate: RATE, oversample });
				expect(engine.hostSampleRate()).toBe(RATE);
				expect(engine.oversampleLatency()).toBe(latency);
				engine.destroy();
			}
			// A factor that is not a power of two keeps the legacy path: no
			// stages, no latency, length preserved.
			const legacy = await V2WasmEngine.create(program);
			legacy.prepare({ sampleRate: RATE, oversample: 3 });
			expect(legacy.hostSampleRate()).toBe(RATE);
			expect(legacy.oversampleLatency()).toBe(0);
			const input = new Float32Array(480);
			const output = new Float32Array(480);
			legacy.processBlock(input, output);
			expect(output.length).toBe(480);
			legacy.destroy();
		});

		it("renders bit-identically however the input is split, at every factor", async () => {
			// The resampler state is carried on the stages across processBlock
			// calls, so block boundaries are invisible -- at every factor, on
			// a nonlinear circuit, through the float transport. One long call
			// is the reference, in 512-sample blocks like the probe harness.
			const program = programFor(clippingOverdriveStage);
			const full = sine(4800, 1000, 0.3);
			for (const oversample of [1, 2, 3, 4, 8, 16]) {
				const renderIn = async (splits: readonly number[]): Promise<Float32Array> => {
					const engine = await V2WasmEngine.create(program);
					engine.prepare({ sampleRate: RATE, oversample });
					const output = new Float32Array(full.length);
					let at = 0;
					for (const split of splits) {
						const chunk = Float32Array.from(full.subarray(at, at + split));
						const rendered = new Float32Array(split);
						engine.processBlock(chunk, rendered);
						output.set(rendered, at);
						at += split;
					}
					engine.destroy();
					return output;
				};
				const whole = await renderIn([4800]);
				const halves = await renderIn([2400, 2400]);
				const tenths = await renderIn(Array(10).fill(480));
				const ones = await renderIn(Array(4800).fill(1));
				const blocks128 = await renderIn(Array(37).fill(128).concat([64]));
				for (const other of [halves, tenths, ones, blocks128]) {
					expect(other.length).toBe(whole.length);
					for (let index = 0; index < whole.length; index += 1) {
						expect(other[index]).toBe(whole[index]);
					}
				}
			}
		});

		it("process_sample and process_block agree bit-for-bit at every factor", async () => {
			// The float in/out narrowing lives at the block boundary, so both
			// entries see the same doubles: float32-quantized input through
			// processSample, rounded back to float32, is the block path.
			const program = programFor(clippingOverdriveStage);
			const source = sine(480, 1000, 0.3);
			const quantized = Float32Array.from(source);
			for (const oversample of [1, 2, 3, 4, 8, 16]) {
				const viaSamples = await (async () => {
					const engine = await V2WasmEngine.create(program);
					engine.prepare({ sampleRate: RATE, oversample });
					const out = new Float32Array(quantized.length);
					for (let index = 0; index < quantized.length; index += 1) {
						out[index] = engine.processSample(quantized[index] ?? 0);
					}
					engine.destroy();
					return out;
				})();
				const engine = await V2WasmEngine.create(program);
				engine.prepare({ sampleRate: RATE, oversample });
				const viaBlock = new Float32Array(quantized.length);
				engine.processBlock(quantized, viaBlock);
				engine.destroy();
				for (let index = 0; index < quantized.length; index += 1) {
					expect(viaBlock[index]).toBe(viaSamples[index]);
				}
			}
		});

		it("reset() clears the filter state and prepare() starts clean", async () => {
			// Render, reset, render again: identical. Prepare again likewise.
			const program = programFor(clippingOverdriveStage);
			const input = Float32Array.from(sine(2400, 1000, 0.3));
			for (const oversample of [2, 4, 8, 16]) {
				const engine = await V2WasmEngine.create(program);
				engine.prepare({ sampleRate: RATE, oversample });
				const first = new Float32Array(input.length);
				engine.processBlock(input, first);
				engine.reset();
				const afterReset = new Float32Array(input.length);
				engine.processBlock(input, afterReset);
				for (let index = 0; index < first.length; index += 1) {
					expect(afterReset[index]).toBe(first[index]);
				}
				engine.prepare({ sampleRate: RATE, oversample });
				const afterPrepare = new Float32Array(input.length);
				engine.processBlock(input, afterPrepare);
				for (let index = 0; index < first.length; index += 1) {
					expect(afterPrepare[index]).toBe(first[index]);
				}
				engine.destroy();
			}
		});

		it("agrees with the reference console within the parity bars at every factor", async () => {
			// The workbench parity method: settle 100, window 2048, 1 kHz
			// tone; pass needs correlation >= 0.9999 AND max abs < 1e-4 (or a
			// silent window with max abs < 1e-4). Float32 transport bounds the
			// comparison, not the solver.
			const program = programFor(clippingOverdriveStage);
			const input = sine(2048, 1000, 0.3);
			for (const oversample of [1, 2, 3, 4, 8, 16]) {
				const expected = renderTs(program, input, oversample);
				const actualF64 = await renderWasmSamples(
					program,
					Float64Array.from(Float32Array.from(input)),
					oversample,
				);
				const settle = 100;
				const a = expected.subarray(settle);
				const b = actualF64.subarray(settle);
				const delta = maxAbs(a, b);
				const r = correlation(a, b);
				const rms = (x: Float64Array) => Math.sqrt(x.reduce((t, v) => t + v * v, 0) / x.length);
				const silent = rms(a) < 1e-5 && rms(b) < 1e-5;
				expect(delta).toBeLessThan(1e-4);
				if (!silent) expect(r).toBeGreaterThanOrEqual(0.9999);
			}
		});

		it("drives the C++ cascades alone as accurately as the TS stages", async () => {
			// No circuit in the loop: the test-only round-trip (up-cascade,
			// identity, down-cascade) against the same wiring of TS stages,
			// each stage built from its own RESAMPLE_STAGE_SPECS entry (stages
			// past the table reuse the last one, exactly as both consoles'
			// prepare() paths do). Impulse fully characterizes the linear
			// system and must agree exactly (max abs diff 0); swept sine is
			// the second confirmation (1e-12 relative). Bar: 1e-12 relative.
			const mod = await getV2WasmModule();
			for (const stages of [1, 2, 3, 4]) {
				const factor = 2 ** stages;
				const wireTs = () => {
					const specs = Array.from({ length: stages }, (_, s) => resampleStageSpec(s));
					return {
						up: specs.map(([taps, beta]) => new HalfBandStage2x(designHalfBand2x(taps, beta))),
						down: specs.map(([taps, beta]) => new HalfBandStage2x(designHalfBand2x(taps, beta))),
						bufA: new Float64Array(factor),
						bufB: new Float64Array(factor),
					};
				};
				const processTs = (w: ReturnType<typeof wireTs>, sample: number): number => {
					let cur = w.bufA;
					let next = w.bufB;
					(w.up[0] as HalfBandStage2x).interpolate(sample, cur, 0);
					let width = 2;
					for (let stage = 1; stage < stages; stage += 1) {
						for (let i = 0; i < width; i += 1) {
							(w.up[stage] as HalfBandStage2x).interpolate(cur[i] ?? 0, next, 2 * i);
						}
						[cur, next] = [next, cur];
						width *= 2;
					}
					for (let sub = 0; sub < width; sub += 1) next[sub] = cur[sub] ?? 0;
					const hi = next;
					for (let stage = stages - 1; stage >= 0; stage -= 1) {
						const half = width / 2;
						for (let i = 0; i < half; i += 1) {
							hi[i] = (w.down[stage] as HalfBandStage2x).decimate(hi[2 * i] ?? 0, hi[2 * i + 1] ?? 0);
						}
						width = half;
					}
					return hi[0] ?? 0;
				};
				const check = (input: Float64Array): { worst: number; norm: number } => {
					const handle = mod._v2_testonly_resample_create(stages) as number;
					expect(handle).toBeGreaterThan(0);
					const w = wireTs();
					let worst = 0;
					let norm = 0;
					for (let index = 0; index < input.length; index += 1) {
						const sample = input[index] ?? 0;
						const a = mod._v2_testonly_resample_process(handle, sample) as number;
						const b = processTs(w, sample);
						worst = Math.max(worst, Math.abs(a - b));
						norm = Math.max(norm, Math.abs(b));
					}
					mod._v2_testonly_resample_destroy(handle);
					return { worst, norm };
				};
				// Impulse: 1 followed by zeros (fully characterizes the round trip).
				// Identical doubles in identical order: exactly 0, not just small.
				const impulse = new Float64Array(512);
				impulse[0] = 1;
				expect(check(impulse).worst).toBe(0);
				// Swept sine across the audio band at the host rate.
				for (const hz of [100, 1000, 8000, 19000]) {
					const { worst, norm } = check(sine(2048, hz, 0.9));
					expect(worst / Math.max(norm, 1e-30)).toBeLessThan(1e-12);
				}
			}
		});

		it("is transparent: osN at a 48 kHz host matches a native 48k*N render", async () => {
			// The spike's central result, now on the console that ships: the
			// RC low-pass renders osN at 48 kHz and natively at 48k*N, and the
			// fundamental ratio must read <= 0.01 dB. The bar was 0.001 dB for
			// the old uniform-57 cascade; the adopted stage-specific cascade
			// (41-tap first stage, ripple 0.0076 dB to 19.2 kHz -- see
			// docs/spikes/2026-10-09-resampler-latency.md section 2, round-trip
			// <= 0.0061 dB worst) honestly reads up to 0.0048 dB here, and the
			// TS reference reads identically digit-for-digit (twin run:
			// 0.00473 vs 0.00473, TS-vs-WASM relative 3.8e-9), so the residual
			// is the reference's own answer, not a port defect. The pedal-level
			// acceptance (0.1 dB to 8 kHz) still has >20x margin.
			const program = programFor(rcLowPass);
			const renderNative = async (rate: number, hz: number): Promise<number> => {
				const engine = await V2WasmEngine.create(program);
				engine.prepare({ sampleRate: rate });
				const length = Math.round(rate * 1.0);
				const source = sine(length, hz, 0.1, rate);
				const input = Float32Array.from(source);
				const output = new Float32Array(length);
				const BLK = 512;
				for (let at = 0; at < length; at += BLK) {
					const n = Math.min(BLK, length - at);
					engine.processBlock(input.subarray(at, at + n), output.subarray(at, at + n));
				}
				engine.destroy();
				const settled = Float64Array.from(output.subarray(Math.floor(length / 2)));
				return fundamental(settled, hz, rate);
			};
			const renderOs = async (oversample: number, hz: number): Promise<number> => {
				const engine = await V2WasmEngine.create(program);
				engine.prepare({ sampleRate: RATE, oversample });
				const length = RATE;
				const input = Float32Array.from(sine(length, hz, 0.1));
				const output = new Float32Array(length);
				const BLK = 512;
				for (let at = 0; at < length; at += BLK) {
					const n = Math.min(BLK, length - at);
					engine.processBlock(input.subarray(at, at + n), output.subarray(at, at + n));
				}
				engine.destroy();
				const settled = Float64Array.from(output.subarray(Math.floor(length / 2)));
				return fundamental(settled, hz);
			};
			for (const [oversample, hz] of [
				[2, 400],
				[2, 1500],
				[4, 1500],
				[4, 6000],
				[8, 6000],
			] as const) {
				const osFund = await renderOs(oversample, hz);
				const nativeFund = await renderNative(RATE * oversample, hz);
				const db = Math.abs(20 * Math.log10(osFund / nativeFund));
				expect(db).toBeLessThan(0.01);
			}
		});
	},
);

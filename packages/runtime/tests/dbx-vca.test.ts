// dbx-style VCA law v2: exponential dB control plus an internal envelope.
//
// The numbers are the NEC uPC1252 feature line (control constant -5.9 mV/dB,
// Av -30dB~+30dB) and the packet island's threshold quoted both ways: the
// island centers its off-chip ctrl_bus at 4.5 V, this law centers the on-chip
// GC node at its engine-measured rest 4.66 V (declared defaults, SUSTAIN 0.5).

import { describe, expect, it } from "bun:test";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { dbxVcaCell } from "@vessel-dsp/compiler/fixtures/circuits";
import {
	dbxVcaDcControlCenter,
	dbxVcaDcControlHigh,
	dbxVcaDcControlLow,
	dbxVcaDcInputHigh,
	dbxVcaDcInputLow,
	dbxVcaDcInputMid,
} from "@vessel-dsp/compiler/fixtures/expected";
import {
	dbxVcaEnvelopeK,
	dbxVcaGainDb,
	dbxVcaGainLinear,
	ReferenceRuntime,
} from "../src/index";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

describe("dbxVcaGainDb", () => {
	it("reads 0 dB at the center with no envelope", () => {
		expect(dbxVcaGainDb(4.66, 4.66, 0, -30, 30)).toBeCloseTo(0, 12);
	});

	it("is millivolt-sensitive: 5.9 mV moves a dB", () => {
		expect(dbxVcaGainDb(4.6659, 4.66, 0, -30, 30)).toBeCloseTo(-1, 9);
		expect(dbxVcaGainDb(4.6541, 4.66, 0, -30, 30)).toBeCloseTo(1, 9);
	});

	it("matches the LM-2 deck's control law", () => {
		// `gain_db = -v(ctrl)/0.0059` with control against center.
		expect(dbxVcaGainDb(4.76, 4.66, 0, -30, 30)).toBeCloseTo(
			-0.1 / 0.0059,
			9,
		);
	});

	it("clamps to the datasheet +-30 dB range instead of running away", () => {
		expect(dbxVcaGainDb(3.5, 4.66, 0, -30, 30)).toBe(30);
		expect(dbxVcaGainDb(5.5, 4.66, 0, -30, 30)).toBe(-30);
		// The internal envelope alone can pin the floor: a volt of envelope
		// is 169 dB down.
		expect(dbxVcaGainDb(4.66, 4.66, 1, -30, 30)).toBe(-30);
	});

	it("adds the envelope in volts through the same divisor", () => {
		expect(dbxVcaGainDb(4.66, 4.66, 0.059, -30, 30)).toBeCloseTo(-10, 9);
	});

	it("falls monotonically as control rises and as envelope rises", () => {
		let previous = Infinity;
		for (let control = 4.55; control <= 4.8; control += 0.05) {
			const gain = dbxVcaGainDb(control, 4.66, 0, -30, 30);
			expect(gain).toBeLessThan(previous);
			previous = gain;
		}
		previous = Infinity;
		for (let env = 0; env <= 0.15; env += 0.01) {
			const gain = dbxVcaGainDb(4.66, 4.66, env, -30, 30);
			expect(gain).toBeLessThan(previous);
			previous = gain;
		}
	});

	it("fails if the law were linear in control", () => {
		// The mutant this pins: the v1 island sigmoid's shape (bounded,
		// volts-scale) cannot be moved by the millivolts the topology
		// delivers. Ten millivolts above center must already move more
		// than a dB; a linear law barely notices.
		expect(dbxVcaGainDb(4.67, 4.66, 0, -30, 30)).toBeLessThan(-1);
		expect(dbxVcaGainDb(4.65, 4.66, 0, -30, 30)).toBeGreaterThan(1);
	});
});

describe("dbxVcaGainLinear", () => {
	it("converts dB to voltage gain", () => {
		expect(dbxVcaGainLinear(0)).toBeCloseTo(1, 12);
		expect(dbxVcaGainLinear(-6)).toBeCloseTo(0.5011872336272722, 9);
		expect(dbxVcaGainLinear(20)).toBeCloseTo(10, 12);
		expect(dbxVcaGainLinear(-30)).toBeCloseTo(0.0316227766016838, 9);
	});
});

describe("dbxVcaEnvelopeK", () => {
	it("matches the one-pole smoothing coefficient", () => {
		expect(dbxVcaEnvelopeK(0.05, 48000)).toBeCloseTo(
			1 - Math.exp(-1 / 2400),
			12,
		);
		expect(dbxVcaEnvelopeK(0.0005, 48000)).toBeCloseTo(
			1 - Math.exp(-1 / 24),
			12,
		);
	});

	it("tracks immediately for a non-positive time constant", () => {
		expect(dbxVcaEnvelopeK(0, 48000)).toBe(1);
		expect(dbxVcaEnvelopeK(-1, 48000)).toBe(1);
	});
});

describe("dbx-style VCA transfer: exponential control plus input envelope", () => {
	// Hand-computed against the fixture (see `dbxVcaDc*` in fixtures/expected):
	// the input divider (100 ohm virtual ground against Rin 10k) times the
	// input conductance times the Ro 22k load times the exponential gain.
	// DC inputs settle the internal envelope exactly, so these are exact
	// closed forms. A law edit that moves the center, the divisor, the clamp
	// rails, or the envelope fails here rather than surfacing as a silent
	// level or depth defect in a pedal.
	const dcGain = (controlVolts: number, inputVolts: number): number => {
		const result = compile(dbxVcaCell(controlVolts), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		const length = 4800;
		const input = new Float64Array(length).fill(inputVolts);
		const output = runtime.process(input);
		let inSum = 0;
		let outSum = 0;
		for (let index = length >> 1; index < length; index += 1) {
			inSum += input[index] ?? 0;
			outSum += output[index] ?? 0;
		}
		const count = length - (length >> 1);
		return outSum / count / (inSum / count);
	};

	it("pins the external path: millivolts of control move dB at fixed input", () => {
		expect(dcGain(4.6, 0.5)).toBeCloseTo(dbxVcaDcControlLow, 2);
		expect(dcGain(4.66, 0.5)).toBeCloseTo(dbxVcaDcControlCenter, 2);
		expect(dcGain(4.72, 0.5)).toBeCloseTo(dbxVcaDcControlHigh, 2);
		expect(dcGain(4.6, 0.5)).toBeGreaterThan(dcGain(4.72, 0.5));
	});

	it("compresses: gain falls as DC input level rises at static control", () => {
		expect(dcGain(4.66, 0.5)).toBeCloseTo(dbxVcaDcInputLow, 2);
		expect(dcGain(4.66, 2)).toBeCloseTo(dbxVcaDcInputMid, 2);
		expect(dcGain(4.66, 5)).toBeCloseTo(dbxVcaDcInputHigh, 2);
		expect(dcGain(4.66, 0.5)).toBeGreaterThan(dcGain(4.66, 2));
		expect(dcGain(4.66, 2)).toBeGreaterThan(dcGain(4.66, 5));
	});

	it("compresses a sine at static control: gain falls as amplitude rises", () => {
		// Behavioral bands, not closed forms: a sine's settled envelope is a
		// limit cycle (attack 0.5 ms against release 50 ms), so the exact
		// mean is solver-measured. What is load-bearing is the fall itself --
		// the gap v1 shipped, where the same sweep rendered flat.
		const sineGain = (amplitude: number): number => {
			const result = compile(dbxVcaCell(4.66), {
				registry: pedalPartCatalog,
			});
			if (result.status !== "ok") {
				throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
			}
			const runtime = new ReferenceRuntime(result.program);
			runtime.prepare(48_000);
			const length = 4800;
			const input = new Float64Array(length);
			for (let index = 0; index < length; index += 1) {
				input[index] =
					amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
			}
			const output = runtime.process(input);
			let inPeak = 0;
			let outPeak = 0;
			for (let index = length >> 1; index < length; index += 1) {
				inPeak = Math.max(inPeak, Math.abs(input[index] ?? 0));
				outPeak = Math.max(outPeak, Math.abs(output[index] ?? 0));
			}
			return outPeak / inPeak;
		};
		const low = sineGain(0.5);
		const mid = sineGain(2);
		const high = sineGain(5);
		expect(low).toBeGreaterThan(mid);
		expect(mid).toBeGreaterThan(high);
		expect(low).toBeGreaterThan(1.5);
		expect(low).toBeLessThan(2.2);
		expect(mid).toBeGreaterThan(1.0);
		expect(mid).toBeLessThan(1.8);
		expect(high).toBeGreaterThan(0.5);
		expect(high).toBeLessThan(1.2);
	});
});

describe.skipIf(!wasmBinaryPresent)(
	"dbx-vca cross-console agreement",
	() => {
		it(`renders DC and sine transfer identically on both consoles (${WASM_SKIP_REASON || "wasm present"})`, async () => {
			const check = async (
				controlVolts: number,
				input: Float64Array,
			): Promise<{ correlation: number; maxDelta: number }> => {
				const result = compile(dbxVcaCell(controlVolts), {
					registry: pedalPartCatalog,
				});
				if (result.status !== "ok") {
					throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
				}
				const ts = new ReferenceRuntime(result.program);
				ts.prepare(48_000);
				const tsOut = ts.process(input);

				const wasm = await V2WasmEngine.create(result.program);
				wasm.prepare({ sampleRate: 48000, maxNewtonIterations: 1024 });
				const wasmOut = new Float32Array(input.length);
				wasm.processBlock(Float32Array.from(input), wasmOut);
				wasm.destroy();

				const from = input.length >> 1;
				let sumT = 0;
				let sumW = 0;
				let sumTT = 0;
				let sumWW = 0;
				let sumTW = 0;
				let maxDelta = 0;
				const count = input.length - from;
				for (let index = from; index < input.length; index += 1) {
					const t = tsOut[index] ?? 0;
					const w = wasmOut[index] ?? 0;
					sumT += t;
					sumW += w;
					sumTT += t * t;
					sumWW += w * w;
					sumTW += t * w;
					maxDelta = Math.max(maxDelta, Math.abs(t - w));
				}
				const denom = Math.sqrt(
					Math.max(0, count * sumTT - sumT * sumT) *
						Math.max(0, count * sumWW - sumW * sumW),
				);
				const correlation =
					denom === 0 ? 1 : (count * sumTW - sumT * sumW) / denom;
				return { correlation, maxDelta };
			};

			// DC input sweep point: exercises the settled envelope identically.
			const dc = new Float64Array(4800).fill(2);
			const dcAgreement = await check(4.66, dc);
			expect(dcAgreement.correlation).toBeGreaterThan(0.9999);
			expect(dcAgreement.maxDelta).toBeLessThan(1e-4);

			// Sine sweep point: exercises the attack/release limit cycle identically.
			const sine = new Float64Array(4800);
			for (let index = 0; index < sine.length; index += 1) {
				sine[index] = 2 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
			}
			const sineAgreement = await check(4.66, sine);
			expect(sineAgreement.correlation).toBeGreaterThan(0.9999);
			expect(sineAgreement.maxDelta).toBeLessThan(1e-4);
		});
	},
);

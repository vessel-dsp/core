// dbx-style VCA law v3: exponential dB control over smoothed terms.
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
	dbxVcaDcInputRestLow,
	dbxVcaDcInputLow,
	dbxVcaDcInputMid,
	dbxVcaDcInputRestOffset,
} from "@vessel-dsp/compiler/fixtures/expected";
import {
	dbxVcaControlTarget,
	dbxVcaEnvelopeK,
	dbxVcaGainDb,
	dbxVcaGainLinear,
	ReferenceRuntime,
} from "../src/index";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

describe("dbxVcaControlTarget", () => {
	it("sums the external control against center with the rectified input", () => {
		// No input: the target is the external control alone.
		expect(dbxVcaControlTarget(4.7, 4.66, 0, 1600)).toBeCloseTo(0.04, 12);
		expect(dbxVcaControlTarget(4.62, 4.66, 0, 1600)).toBeCloseTo(-0.04, 12);
		// Rectification: either half-cycle drives toward reduction.
		expect(dbxVcaControlTarget(4.66, 4.66, 0.001, 1000)).toBeCloseTo(1.0, 12);
		expect(dbxVcaControlTarget(4.66, 4.66, -0.001, 1000)).toBeCloseTo(1.0, 12);
	});

	it("proves the sign chain: louder input increases the terms", () => {
		// The pedal-expansion bug was a terms scale 100x too small, not an
		// inverted sign -- pin both here with a unit probe, not by reading
		// the stamp path: more input current must mean larger terms (which
		// `dbxVcaGainDb` turns into less gain below).
		let previous = -Infinity;
		for (const amps of [0, 0.0001, 0.001, 0.01]) {
			const terms = dbxVcaControlTarget(4.66, 4.66, amps, 1000);
			expect(terms).toBeGreaterThan(previous);
			previous = terms;
		}
	});
});

describe("dbxVcaGainDb", () => {
	it("reads 0 dB at zero terms", () => {
		expect(dbxVcaGainDb(0, -30, 30)).toBeCloseTo(0, 12);
	});

	it("is millivolt-sensitive: 5.9 mV moves a dB", () => {
		expect(dbxVcaGainDb(0.0059, -30, 30)).toBeCloseTo(-1, 9);
		expect(dbxVcaGainDb(-0.0059, -30, 30)).toBeCloseTo(1, 9);
	});

	it("matches the LM-2 deck's control law", () => {
		// `gain_db = -v(ctrl)/0.0059` with control against center.
		expect(dbxVcaGainDb(0.1, -30, 30)).toBeCloseTo(-0.1 / 0.0059, 9);
	});

	it("clamps to the datasheet +-30 dB range instead of running away", () => {
		expect(dbxVcaGainDb(-2, -30, 30)).toBe(30);
		expect(dbxVcaGainDb(2, -30, 30)).toBe(-30);
		// A volt of envelope alone pins the floor.
		expect(dbxVcaGainDb(1, -30, 30)).toBe(-30);
	});

	it("falls monotonically as terms rise", () => {
		let previous = Infinity;
		for (let terms = -0.1; terms <= 0.15; terms += 0.01) {
			const gain = dbxVcaGainDb(terms, -30, 30);
			expect(gain).toBeLessThan(previous);
			previous = gain;
		}
	});

	it("fails if the law were linear in control", () => {
		// The mutant this pins: a proportional gain law barely notices
		// 10 mV. Ten millivolts of terms must already move more than a dB.
		expect(dbxVcaGainDb(0.01, -30, 30)).toBeLessThan(-1);
		expect(dbxVcaGainDb(-0.01, -30, 30)).toBeGreaterThan(1);
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

describe("dbx-style VCA transfer: smoothed terms drive the gain", () => {
	// Hand-computed against the fixture (see `dbxVcaDc*` in fixtures/expected):
	// the input divider (100 ohm virtual ground against Rin 10k) times the
	// input conductance times the Ro 22k load times the exponential gain.
	// DC inputs settle the smoothed terms exactly, so these are exact closed
	// forms. A law edit that moves the center, the divisor, the detector
	// scaling, the clamp rails, or the follower fails here rather than
	// surfacing as a silent level or depth defect in a pedal.
	const dcGain = (controlVolts: number, inputVolts: number): number => {
		const result = compile(dbxVcaCell(controlVolts), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		// 0.3 s settle: release-dominated points (target below the zero
		// start, e.g. control below center) converge with the 50 ms release
		// TC, so a 0.1 s window leaves them measurably unsettled.
		const length = 14400;
		const input = new Float64Array(length).fill(inputVolts);
		const output = runtime.process(input);
		let inSum = 0;
		let outSum = 0;
		const window = 2400;
		for (let index = length - window; index < length; index += 1) {
			inSum += input[index] ?? 0;
			outSum += output[index] ?? 0;
		}
		return outSum / window / (inSum / window);
	};

	it("pins the external path: millivolts of control move dB at fixed input", () => {
		expect(dcGain(4.6, 0.5)).toBeCloseTo(dbxVcaDcControlLow, 2);
		expect(dcGain(4.66, 0.5)).toBeCloseTo(dbxVcaDcControlCenter, 2);
		expect(dcGain(4.72, 0.5)).toBeCloseTo(dbxVcaDcControlHigh, 2);
		expect(dcGain(4.6, 0.5)).toBeGreaterThan(dcGain(4.72, 0.5));
	});

	it("compresses: gain falls as DC input level rises at static control", () => {
		expect(dcGain(4.66, 0.05)).toBeCloseTo(dbxVcaDcInputLow, 2);
		expect(dcGain(4.66, 0.2)).toBeCloseTo(dbxVcaDcInputMid, 2);
		expect(dcGain(4.66, 0.5)).toBeCloseTo(dbxVcaDcInputHigh, 2);
		expect(dcGain(4.66, 0.05)).toBeGreaterThan(dcGain(4.66, 0.2));
		expect(dcGain(4.66, 0.2)).toBeGreaterThan(dcGain(4.66, 0.5));
	});

	it("compresses a sine at static control: gain falls as amplitude rises", () => {
		// Behavioral bands, not closed forms: a sine's settled terms are a
		// limit cycle (attack 0.5 ms against release 50 ms), so the exact
		// mean is solver-measured. What is load-bearing is the fall itself --
		// the gap v2 shipped, where the same sweep rendered flat.
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
		const low = sineGain(0.2);
		const mid = sineGain(0.5);
		const high = sineGain(1);
		expect(low).toBeGreaterThan(mid);
		expect(mid).toBeGreaterThan(high);
		expect(low).toBeGreaterThan(1.2);
		expect(low).toBeLessThan(1.8);
		expect(mid).toBeGreaterThan(0.6);
		expect(mid).toBeLessThan(1.1);
		expect(high).toBeGreaterThan(0.2);
		expect(high).toBeLessThan(0.5);
	});

	it("compresses at the pedal's GC rest offset, not just at center", () => {
		// The acceptance shape: the same cell with control pinned 40 mV above
		// center reproduces the re-traced CS-3's node-70 rest at high SUSTAIN,
		// so the input sweep here proves monotonic fall under the pedal's own
		// DC operating conditions. DC renders are exact closed forms.
		expect(dcGain(4.7, 0.05)).toBeCloseTo(dbxVcaDcInputRestLow, 2);
		expect(dcGain(4.7, 0.5)).toBeCloseTo(dbxVcaDcInputRestOffset, 2);
		const restLow = dcGain(4.7, 0.05);
		const restMid = dcGain(4.7, 0.5);
		const restHigh = dcGain(4.7, 0.9);
		expect(restLow).toBeGreaterThan(restMid);
		expect(restMid).toBeGreaterThan(restHigh);
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

			// DC input sweep point: exercises the settled smoothed terms.
			const dc = new Float64Array(4800).fill(2);
			const dcAgreement = await check(4.66, dc);
			expect(dcAgreement.correlation).toBeGreaterThan(0.9999);
			expect(dcAgreement.maxDelta).toBeLessThan(1e-4);

			// Rest-offset DC point: the pedal's operating region.
			const dcRest = new Float64Array(4800).fill(0.5);
			const dcRestAgreement = await check(4.7, dcRest);
			expect(dcRestAgreement.correlation).toBeGreaterThan(0.9999);
			expect(dcRestAgreement.maxDelta).toBeLessThan(1e-4);

			// Sine sweep point: exercises the attack/release limit cycle.
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

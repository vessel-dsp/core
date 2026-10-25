// dbx-style VCA law: pure-gain unit tests, transfer renders on the TS console,
// and TS-vs-WASM console agreement for a program carrying the stamp.
//
// The numbers are the packet island's own (`boss-cs-3-service-vca-control-island.cir`):
// gain = 0.18 + 0.82 / (1 + exp((Vc - 4.5) * 1.6)).

import { describe, expect, it } from "bun:test";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { dbxVcaCell } from "@vessel-dsp/compiler/fixtures/circuits";
import {
	dbxVcaGainCenter,
	dbxVcaGainHigh,
	dbxVcaGainLow,
} from "@vessel-dsp/compiler/fixtures/expected";
import { dbxVcaGain, ReferenceRuntime } from "../src/index";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

describe("dbxVcaGain", () => {
	it("sits at mid-scale at the center voltage", () => {
		expect(dbxVcaGain(4.5, 4.5, 1.6, 0.18, 1.0)).toBeCloseTo(0.59, 12);
	});

	it("reaches the ceiling at low control and the floor at high control", () => {
		expect(dbxVcaGain(-10, 4.5, 1.6, 0.18, 1.0)).toBeCloseTo(1.0, 9);
		expect(dbxVcaGain(20, 4.5, 1.6, 0.18, 1.0)).toBeCloseTo(0.18, 9);
	});

	it("matches the island's B-source at the three transfer points", () => {
		for (const control of [3.5, 4.5, 5.5]) {
			const island = 0.18 + 0.82 / (1 + Math.exp((control - 4.5) * 1.6));
			expect(dbxVcaGain(control, 4.5, 1.6, 0.18, 1.0)).toBeCloseTo(island, 12);
		}
	});

	it("falls monotonically as control rises", () => {
		let previous = Infinity;
		for (let control = 0; control <= 9; control += 0.25) {
			const gain = dbxVcaGain(control, 4.5, 1.6, 0.18, 1.0);
			expect(gain).toBeLessThan(previous);
			previous = gain;
		}
	});

	it("fails if the law were linear in control", () => {
		// The mutant this pins: a proportional gain (the old linear-OTA fallback's
		// shape) rises with control instead of falling. Half a volt above center
		// the sigmoid is already below mid-scale; a linear law is not.
		expect(dbxVcaGain(5.0, 4.5, 1.6, 0.18, 1.0)).toBeLessThan(0.59);
		expect(dbxVcaGain(4.0, 4.5, 1.6, 0.18, 1.0)).toBeGreaterThan(0.59);
	});
});

describe("dbx-style VCA transfer: gain falls as control rises", () => {
	// Hand-computed against the fixture: input divider (100 ohm virtual ground
	// against Rin 10k) times the input conductance times the Ro 22k load times
	// the sigmoidal control gain. Three control points pin the ceiling end, the
	// center, and the floor end of the curve; a law edit that moves the gain,
	// the floor, the ceiling, the center, or the slope fails here rather than
	// surfacing as a silent level or depth defect in a pedal.
	const transferGain = (controlVolts: number): number => {
		const result = compile(dbxVcaCell(controlVolts), {
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
			input[index] = 0.05 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
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

	it("passes ceiling-end gain at low control", () => {
		expect(transferGain(3.5)).toBeCloseTo(dbxVcaGainLow, 2);
	});

	it("passes mid-scale gain at the center voltage", () => {
		expect(transferGain(4.5)).toBeCloseTo(dbxVcaGainCenter, 2);
	});

	it("passes floor-end gain at high control", () => {
		expect(transferGain(5.5)).toBeCloseTo(dbxVcaGainHigh, 2);
	});

	it("compresses: gain strictly falls as control rises", () => {
		expect(transferGain(3.5)).toBeGreaterThan(transferGain(4.5));
		expect(transferGain(4.5)).toBeGreaterThan(transferGain(5.5));
	});
});

describe.skipIf(!wasmBinaryPresent)(
	"dbx-vca cross-console agreement",
	() => {
		it(`renders the transfer cell identically on both consoles (${WASM_SKIP_REASON || "wasm present"})`, async () => {
			const result = compile(dbxVcaCell(5.5), { registry: pedalPartCatalog });
			if (result.status !== "ok") {
				throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
			}
			const ts = new ReferenceRuntime(result.program);
			ts.prepare(48_000);
			const length = 4800;
			const input = new Float64Array(length);
			for (let index = 0; index < length; index += 1) {
				input[index] = 0.05 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
			}
			const tsOut = ts.process(input);

			const wasm = await V2WasmEngine.create(result.program);
			wasm.prepare({ sampleRate: 48000, maxNewtonIterations: 1024 });
			const wasmOut = new Float32Array(length);
			wasm.processBlock(
				Float32Array.from(input),
				wasmOut,
			);
			wasm.destroy();

			// Same verdict shape as the supply cross-console test: correlation
			// >= 0.9999 with max |delta| < 1e-4 over the settled window, so the
			// C++ mirror cannot drift from the TS Newton path it mirrors.
			const from = length >> 1;
			let sumT = 0;
			let sumW = 0;
			let sumTT = 0;
			let sumWW = 0;
			let sumTW = 0;
			let maxDelta = 0;
			const count = length - from;
			for (let index = from; index < length; index += 1) {
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
			expect(correlation).toBeGreaterThan(0.9999);
			expect(maxDelta).toBeLessThan(1e-4);
		});
	},
);

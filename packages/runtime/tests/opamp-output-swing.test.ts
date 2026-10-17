// A printed per-side op-amp swing clamps the output where the stamp's rails say, on both consoles.
//
// The compiler folds a part's printed drops into absolute `railHigh`/`railLow` at lowering and the Stamp carries
// only those, so this is the runtime's half of the contract: nothing about a swing field exists below the compiler,
// and a pair that is asymmetric in the part must be an asymmetric clamp in the solver. The parts are fictional
// (`FIXTURE-SWING-*`) and the circuit is the shared non-inverting stage at +-9 V, driven far past its rails, so the
// known answer is `railHigh - high` and `railLow + low` with no capture, no ngspice and no corpus packet involved.
//
// Scope, so it is not read as more than it is: it proves both consoles clamp at the stamp's rails (the `tanh`
// saturates to them well inside a millivolt at this overdrive). It does not prove any part's pair is right.

import { describe, expect, it } from "bun:test";
import { compile, type PartRegistry, type Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "../src/reference-runtime";
import { V2WasmEngine } from "../src/v2-wasm-engine";
import { nonInvertingStage } from "./non-inverting-stage";
import { WASM_SKIP_REASON, wasmBinaryPresent } from "./wasm-presence";

const RATE = 48_000;
const RAIL = 9;
/** 5 V into a gain of 10 asks for 50 V of a +-9 V stage: the output sits on a rail for most of every cycle. */
const DRIVE_VOLTS = 5;
const SECONDS = 0.1;
/** The clamp must sit within a millivolt of the rail the stamp holds. */
const CLAMP_TOLERANCE_VOLTS = 1e-3;

const opamp = (partIds: readonly string[], law: Record<string, unknown>) => ({
	partIds,
	declaredTypes: [],
	terminalRoleGroups: [],
	model: {
		kind: "sections" as const,
		pinout: [null, null, null],
		sections: [
			{
				law: {
					kind: "ideal-opamp" as const,
					railHigh: null,
					railLow: null,
					openLoopGain: 100000,
					...law,
				},
				terminals: [0, 1, 2],
			},
		],
	},
});
const registry = {
	entries: [
		opamp(["FIXTURE-SWING-ASYM"], {
			outputSwingDropHighVolts: 1.5,
			outputSwingDropLowVolts: 0.02,
			outputSwingPrinted: {
				supplyVolts: 30,
				loadOhms: 10000,
				translation: "constant",
			},
		}),
		opamp(["FIXTURE-SWING-PROP"], {
			outputSwingDropHighVolts: 2.0,
			outputSwingDropLowVolts: 3.0,
			outputSwingPrinted: {
				supplyVolts: 30,
				loadOhms: 2000,
				translation: "proportional",
			},
		}),
		opamp(["FIXTURE-SWING-NONE"], {}),
	],
} as unknown as PartRegistry;

/** The clamp each part must produce at +-9 V: [lowest, highest] output. */
const CASES: ReadonlyArray<readonly [part: string, low: number, high: number]> =
	[
		["FIXTURE-SWING-ASYM", -RAIL + 0.02, RAIL - 1.5],
		// Printed at 30 V, carried by the stage's 18 V span: 18 / 30 = 0.6.
		["FIXTURE-SWING-PROP", -RAIL + 3.0 * 0.6, RAIL - 2.0 * 0.6],
		["FIXTURE-SWING-NONE", -RAIL, RAIL],
	];

function programFor(part: string): Program {
	const result = compile(
		nonInvertingStage({ rfOhms: 9000, rgOhms: 1000, partNumber: part }),
		{ registry },
	);
	if (result.status !== "ok")
		throw new Error(`stage did not compile: ${JSON.stringify(result)}`);
	return result.program;
}
function stimulus(): Float64Array {
	const input = new Float64Array(Math.round(RATE * SECONDS));
	for (let i = 0; i < input.length; i += 1)
		input[i] = DRIVE_VOLTS * Math.sin((2 * Math.PI * 1000 * i) / RATE);
	return input;
}
function extremes(
	output: ArrayLike<number>,
): readonly [low: number, high: number] {
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	// The first few milliseconds carry the operating-point settle; the clamp is read after it.
	for (let i = Math.round(RATE * 0.02); i < output.length; i += 1) {
		low = Math.min(low, output[i] ?? 0);
		high = Math.max(high, output[i] ?? 0);
	}
	return [low, high];
}

describe("the output clamps at the stamp's rails, one side at a time", () => {
	it("sits on railLow + low and railHigh - high on the TS console", () => {
		for (const [part, low, high] of CASES) {
			const runtime = new ReferenceRuntime(programFor(part));
			runtime.prepare(RATE);
			const [measuredLow, measuredHigh] = extremes(runtime.process(stimulus()));
			expect(Math.abs(measuredHigh - high)).toBeLessThan(CLAMP_TOLERANCE_VOLTS);
			expect(Math.abs(measuredLow - low)).toBeLessThan(CLAMP_TOLERANCE_VOLTS);
		}
	});

	describe.skipIf(!wasmBinaryPresent)(
		`WASM console${wasmBinaryPresent ? "" : ` (${WASM_SKIP_REASON})`}`,
		() => {
			it("sits on railLow + low and railHigh - high", async () => {
				for (const [part, low, high] of CASES) {
					const engine = await V2WasmEngine.create(programFor(part));
					engine.prepare({ sampleRate: RATE });
					const input = stimulus();
					const output = new Float64Array(input.length);
					for (let i = 0; i < input.length; i += 1)
						output[i] = engine.processSample(input[i] ?? 0);
					engine.destroy();
					const [measuredLow, measuredHigh] = extremes(output);
					expect(Math.abs(measuredHigh - high)).toBeLessThan(
						CLAMP_TOLERANCE_VOLTS,
					);
					expect(Math.abs(measuredLow - low)).toBeLessThan(
						CLAMP_TOLERANCE_VOLTS,
					);
				}
			});
		},
	);

	it("is not trivially satisfied: the clamp of one part is not the clamp of another", () => {
		// A mutation guard: if every part clamped at the same place the checks above would hold for the wrong
		// reason, so the three cases must be pairwise distinct on both sides they state.
		const highs = new Set(CASES.map(([, , high]) => high.toFixed(6)));
		const lows = new Set(CASES.map(([, low]) => low.toFixed(6)));
		expect(highs.size).toBe(CASES.length);
		expect(lows.size).toBe(CASES.length);
	});
});

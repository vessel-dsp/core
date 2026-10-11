// Check 4c: ITERATIONS PER HOST SAMPLE AND PER INTERNAL SAMPLE (is the Newton problem easier or harder at a higher internal rate?).
//
//   bun docs/spikes/host-rate/iterations.ts [--arms=all] [--pedals=muff,sd1,ts9] [--consoles=wasm,ts] [--amps=0.01,0.1] [--out=<jsonl>]
//
// Headless engines, no browser (iteration counts are deterministic engine facts, not timings): the program through `V2WasmEngine` (the shipping
// console, counters `totalIterations`, `seedsUsed`, `oneIterationSolves`) and `ReferenceRuntime` (`telemetry().totalIterations`), controls set after
// prepare, 1 kHz sine, 128-frame blocks, `--warm` seconds of warm-up then `--measure` seconds counted as a DIFFERENCE of the cumulative counters.
// `seedsUsed` is the Newton start predictor's own counter: 0 at factor 1 BY CONSTRUCTION (the `oversample > 1` gate), including at a 192 kHz host.
import { writeFileSync } from "node:fs";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { arg, loadPedal, PEDALS, selectArms, ts } from "./lib";

const arms = selectArms(arg("arms", "all"));
const pedals = arg("pedals", "muff,sd1,ts9").split(",");
const consoles = arg("consoles", "wasm,ts").split(",");
const amps = arg("amps", "0.01,0.1").split(",").map(Number);
const warm = Number(arg("warm", "0.5"));
const measure = Number(arg("measure", "0.5"));
const out = arg("out", "");
const rows: Record<string, unknown>[] = [];
console.log(`iterations: ${ts()} warm ${warm} s, measure ${measure} s, 1 kHz, blocks of 128`);
for (const name of pedals) {
	const { program, controls } = loadPedal(name);
	for (const amp of amps) {
		for (const arm of arms) {
			for (const consoleName of consoles) {
				if (consoleName === "ts" && arm.internal > 192000 && !process.argv.includes("--ts-all")) continue;
				const nWarm = Math.round((arm.host * warm) / 128) * 128;
				const nMeasure = Math.round((arm.host * measure) / 128) * 128;
				const n = nWarm + nMeasure;
				const input = Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / arm.host));
				let iterWarm = 0;
				let iterEnd = 0;
				let seeds = 0;
				let ones = 0;
				if (consoleName === "wasm") {
					const eng = await V2WasmEngine.create(program);
					eng.prepare({ sampleRate: arm.host, ...(arm.factor > 1 ? { oversample: arm.factor } : {}) });
					for (const [id, v] of Object.entries(controls)) eng.setControl(id, v);
					const inF = new Float32Array(128);
					const outF = new Float32Array(128);
					let seeds0 = 0;
					let ones0 = 0;
					for (let i = 0; i < n; i += 128) {
						if (i === nWarm) {
							const t = eng.getPredictorTelemetry();
							iterWarm = t.totalIterations;
							seeds0 = t.seedsUsed;
							ones0 = t.oneIterationSolves;
						}
						for (let k = 0; k < 128; k += 1) inF[k] = input[i + k] ?? 0;
						eng.processBlock(inF, outF);
					}
					const t = eng.getPredictorTelemetry();
					iterEnd = t.totalIterations;
					seeds = t.seedsUsed - seeds0;
					ones = t.oneIterationSolves - ones0;
					eng.destroy();
				} else {
					const rt = new ReferenceRuntime(program);
					rt.prepare(arm.host, arm.factor > 1 ? { oversample: arm.factor } : {});
					for (const [id, v] of Object.entries(controls)) rt.setControl(id, v);
					for (let i = 0; i < n; i += 128) {
						if (i === nWarm) iterWarm = rt.telemetry().totalIterations;
						rt.process(input.subarray(i, i + 128));
					}
					iterEnd = rt.telemetry().totalIterations;
				}
				const hostSamples = nMeasure;
				const it = iterEnd - iterWarm;
				const row = {
					pedal: name, amp, arm: arm.name, console: consoleName, host: arm.host, factor: arm.factor, internal: arm.internal,
					itPerHost: it / hostSamples, itPerInternal: it / (hostSamples * arm.factor), predictorSeedsPerInternal: seeds / (hostSamples * arm.factor), oneIterPerInternal: ones / (hostSamples * arm.factor),
				};
				rows.push(row);
				console.log(
					`${name.padEnd(5)} ${String(amp).padEnd(5)} V ${arm.name.padEnd(8)} ${consoleName.padEnd(4)} it/host ${row.itPerHost.toFixed(3).padStart(7)}  it/internal ${row.itPerInternal.toFixed(3)}` +
						(consoleName === "wasm" ? `  predictor seeds/internal ${row.predictorSeedsPerInternal.toFixed(3)}  one-iteration solves/internal ${row.oneIterPerInternal.toFixed(3)}` : ""),
				);
			}
		}
	}
}
void PEDALS;
if (out !== "") writeFileSync(out, JSON.stringify(rows, null, 1));

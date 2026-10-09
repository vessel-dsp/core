// F1 probe: boss-mt-2 under the workbench scoreboard's stimulus (440 Hz @0.25 + 1320 Hz @0.1
// from t=0, 128-sample blocks, cap DEFAULT_NEWTON_MAX_ITERATIONS) on one console; prints wall-clock
// ns/sample per second of audio, each block over --slow-ms (wasm 50, ts 2000) with its start sample, and the
// predictor telemetry at that point. Stops after --stall-blocks slow blocks (a stalled block is ~11 s).
//   bun docs/spikes/hotfix-0.4.1/mt2-timeline.ts --console=wasm|ts [--seconds=8] [--os=1] [--packet=boss-mt-2]
import { DEFAULT_NEWTON_MAX_ITERATIONS, ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { RATE, arg, compileFile, fileForSlug, twoTone } from "./lib";

const consoleName = arg("console", "wasm");
const seconds = Number(arg("seconds", "8"));
const os = Number(arg("os", "1"));
const slug = arg("packet", "boss-mt-2");
// A transient cap storm costs tens of ms; a stalled block costs seconds. Only the latter ends the run.
const stallBlocks = Number(arg("stall-blocks", "3"));
const stallMs = Number(arg("stall-ms", consoleName === "wasm" ? "1000" : "60000"));
// A WASM block over 50 ms is a stall (normal is ~3 ms); the TS reference is ~100x slower per sample, so its bar is 2 s.
const slowMs = Number(arg("slow-ms", consoleName === "wasm" ? "50" : "2000"));
const BLOCK = 128;
const program = compileFile(fileForSlug(slug));
const oversample = os > 1 ? { oversample: os } : {};

let step: (input: Float64Array) => void;
let telemetry: () => unknown;
if (consoleName === "wasm") {
	const eng = await V2WasmEngine.create(program);
	eng.prepare({ sampleRate: RATE, maxNewtonIterations: DEFAULT_NEWTON_MAX_ITERATIONS, ...oversample });
	const fin = new Float32Array(BLOCK);
	const fout = new Float32Array(BLOCK);
	step = (input) => {
		for (let i = 0; i < BLOCK; i += 1) fin[i] = input[i] as number;
		eng.processBlock(fin, fout);
	};
	// The published 0.3.1 console has no predictor telemetry (the predictor did not exist yet).
	telemetry = () => (typeof eng.getPredictorTelemetry === "function" ? eng.getPredictorTelemetry() : "n/a (runtime without predictor telemetry)");
} else {
	const rt = new ReferenceRuntime(program);
	rt.prepare(RATE, { maxNewtonIterations: DEFAULT_NEWTON_MAX_ITERATIONS, ...oversample });
	const h = rt as unknown as { newtonStartHistory: Map<string, { order: number }> };
	step = (input) => void rt.process(input);
	telemetry = () => ({
		totalIterations: rt.telemetry().totalIterations,
		nonConvergedSamples: rt.telemetry().nonConvergedSamples,
		ordersNonZero: [...h.newtonStartHistory.values()].filter((v) => v.order > 0).length,
	});
}

console.log(`# ${slug} console=${consoleName} os=${os} cap=${DEFAULT_NEWTON_MAX_ITERATIONS} seconds=${seconds} block=${BLOCK}`);
const blocksPerSecond = RATE / BLOCK;
let sample = 0;
let slow = 0;
let stalled = 0;
outer: for (let s = 0; s < seconds; s += 1) {
	const t0 = performance.now();
	for (let k = 0; k < blocksPerSecond; k += 1) {
		const input = twoTone(BLOCK, sample);
		const b0 = performance.now();
		step(input);
		const ms = performance.now() - b0;
		if (ms > slowMs) {
			slow += 1;
			if (ms > stallMs) stalled += 1;
			console.log(`SLOW block starting at sample ${sample} (${(sample / RATE).toFixed(4)} s): ${ms.toFixed(1)} ms = ${((ms * 1000) / BLOCK).toFixed(0)} us/sample; telemetry ${JSON.stringify(telemetry())}`);
			if (stalled >= stallBlocks) {
				sample += BLOCK;
				console.log(`stopped after ${stalled} stalled blocks (over ${stallMs} ms) at sample ${sample}`);
				break outer;
			}
		}
		sample += BLOCK;
	}
	const ns = ((performance.now() - t0) * 1e6) / (blocksPerSecond * BLOCK);
	console.log(`second ${s}: ${(ns / 1000).toFixed(1)} us/sample (${(ns / (1e9 / RATE)).toFixed(2)}x real time)`);
}
console.log(`final telemetry: ${JSON.stringify(telemetry())}`);
console.log(stalled > 0 ? `RESULT: STALL, ${stalled} blocks over ${stallMs} ms (first at the SLOW line above)` : slow === 0 ? `RESULT: no block over ${slowMs} ms` : `RESULT: no stall; ${slow} blocks over ${slowMs} ms, none over ${stallMs} ms`);

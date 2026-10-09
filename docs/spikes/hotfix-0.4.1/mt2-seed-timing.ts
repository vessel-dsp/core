// Where do the predictor's seeds fall relative to the mt-2 stall on the 0.4.0 WASM console? Block-steps (128) to just before
// the stall, recording every block in which `seedsUsed` grew; then single-sample steps through the stall onset, timing each
// sample and printing the seed count and total iterations at the first expensive one. Separates "a seed starts the stall" from
// "the stall begins long after the last seed". Run in a tree where the predictor runs at x1 (the published 0.4.0).
//   bun docs/spikes/hotfix-0.4.1/mt2-seed-timing.ts [--from=131840] [--until=132300]
import { DEFAULT_NEWTON_MAX_ITERATIONS, V2WasmEngine } from "@vessel-dsp/runtime";
import { RATE, arg, compileFile, fileForSlug, twoTone } from "./lib";

const from = Number(arg("from", "131840"));
const until = Number(arg("until", "132300"));
const eng = await V2WasmEngine.create(compileFile(fileForSlug("boss-mt-2")));
eng.prepare({ sampleRate: RATE, maxNewtonIterations: DEFAULT_NEWTON_MAX_ITERATIONS });
const seedBlocks: Array<[number, number]> = [];
let last = 0;
let sample = 0;
const fin = new Float32Array(128), fout = new Float32Array(128);
while (sample < from) {
	const x = twoTone(128, sample);
	for (let i = 0; i < 128; i += 1) fin[i] = x[i] as number;
	eng.processBlock(fin, fout);
	const seeds = eng.getPredictorTelemetry().seedsUsed;
	if (seeds !== last) { seedBlocks.push([sample, seeds - last]); last = seeds; }
	sample += 128;
}
console.log(`block steps to sample ${sample}: seeds ${last}; blocks (start sample, seeds gained) in which seeds were used: ${seedBlocks.length}; first ${JSON.stringify(seedBlocks.slice(0, 5))}; last ${JSON.stringify(seedBlocks.slice(-5))}`);
const one = new Float32Array(1), oneOut = new Float32Array(1);
let firstSlow = -1;
for (; sample < until; sample += 1) {
	one[0] = twoTone(1, sample)[0] as number;
	const t0 = performance.now();
	eng.processBlock(one, oneOut);
	const ms = performance.now() - t0;
	const tel = eng.getPredictorTelemetry();
	if (tel.seedsUsed !== last) { console.log(`  seed(s) used at sample ${sample}: seedsUsed ${last} -> ${tel.seedsUsed}`); last = tel.seedsUsed; }
	if (ms > 5 && firstSlow < 0) { firstSlow = sample; console.log(`first sample over 5 ms: ${sample} (${ms.toFixed(1)} ms); seedsUsed ${tel.seedsUsed}, oneIterationSolves ${tel.oneIterationSolves}, totalIterations ${tel.totalIterations}`); }
	if (firstSlow >= 0 && sample >= firstSlow + 4) break;
}
const tel = eng.getPredictorTelemetry();
console.log(`stopped at sample ${sample}; seedsUsed ${tel.seedsUsed}; total iterations ${tel.totalIterations}`);

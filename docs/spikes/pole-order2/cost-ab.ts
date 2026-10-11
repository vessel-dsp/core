// COST: WASM ns per host sample, baseline binary (A, unchanged main) vs this tree's binary (B), the same program, interleaved A/B per repeat in one process, median of N, in-process
// (no worklet). 1 kHz 10 mV 1 s, cap 1024, 512-frame blocks. `uptime` is printed first and last; the caller records the load (and waits for an idle box before running).
//   bun docs/spikes/pole-order2/cost-ab.ts --base=<dir with v2_dsp.cjs> [--repeats=7] [--os=1,4] [--packets=muff,sd1,ts9,ts808,gro100,blue-box]
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { V2WasmEngine } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, median, sine } from "./lib";
const baseDir = arg("base", ""), REPEATS = Number(arg("repeats", "7"));
const factors = arg("os", "1,4").split(",").map(Number), packets = arg("packets", "muff,sd1,ts9,ts808,gro100,blue-box").split(",");
const RATE = 48000, N = 48000, BLK = 512, BUDGET = 20833;
const input = sine(N, 1000, 0.01);
const load = async (dir: string) => (await import(pathToFileURL(`${dir}/v2_dsp.cjs`).href)).default();
const baseMod = await load(baseDir);
const newMod = await load(new URL("../../../packages/runtime/src/wasm", import.meta.url).pathname);
console.log(`uptime at start: ${execSync("uptime").toString().trim()}`);
console.log(`WASM in-process ns/host sample, 1 kHz 10 mV 1 s, ${REPEATS} interleaved repeats (A = unchanged main, B = this tree), median; ${BUDGET} ns = 1.0 xRT in-process`);
console.log("packet  os | A ns (xRT)       | B ns (xRT)       | B/A   | it/host A / B | peak A/B | runs A (xRT) | runs B (xRT)");
async function once(mod: unknown, program: any, controls: Record<string, number>, os: number) {
	const eng = await V2WasmEngine.create(program, mod);
	eng.prepare({ sampleRate: RATE, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controls)) eng.setControl(k, v);
	const fi = Float32Array.from(input), fo = new Float32Array(N);
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < N; i += BLK) eng.processBlock(fi.subarray(i, i + BLK), fo.subarray(i, i + BLK));
	const ns = Number(process.hrtime.bigint() - t0) / N;
	let iters = Number.NaN;
	try { iters = eng.getPredictorTelemetry().totalIterations / N; } catch { /* module without the export */ }
	const peak = eng.getMaxIterations();
	eng.destroy();
	return { ns, iters, peak };
}
for (const os of factors) for (const slug of packets) {
	const spec = PACKETS[slug]!, program = compileFile(spec.file);
	const a: number[] = [], b: number[] = [];
	let peakA = 0, peakB = 0, itA = 0, itB = 0;
	for (let r = 0; r < REPEATS; r += 1) {
		const ra = await once(baseMod, program, spec.controls, os); a.push(ra.ns); peakA = ra.peak; itA = ra.iters;
		const rb = await once(newMod, program, spec.controls, os); b.push(rb.ns); peakB = rb.peak; itB = rb.iters;
	}
	const ma = median(a), mb = median(b);
	console.log(`${slug.padEnd(7)} ${String(os).padStart(2)} | ${ma.toFixed(0).padStart(7)} (${(ma / BUDGET).toFixed(2)}) | ${mb.toFixed(0).padStart(7)} (${(mb / BUDGET).toFixed(2)}) | ${(mb / ma).toFixed(3)} | ${itA.toFixed(3)} / ${itB.toFixed(3)} | ${peakA}/${peakB} | ${a.map((x) => (x / BUDGET).toFixed(2)).join(" ")} | ${b.map((x) => (x / BUDGET).toFixed(2)).join(" ")}`);
}
console.log(`uptime at end: ${execSync("uptime").toString().trim()}`);

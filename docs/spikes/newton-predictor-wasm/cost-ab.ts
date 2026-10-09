// Check 5: WASM ns per host sample, baseline binary (A, pre-port) vs ported binary (B),
// interleaved A/B/A/B per repeat in ONE process (both Emscripten modules loaded from their
// own paths), median of 5; iterations per host sample beside the time (B from the engine's
// total-iterations counter; A has no counter: its figure is the TS reference's count at the
// same settings, which the pre-predictor probe showed equal to the sample on the pedals).
// 1 kHz 10 mV 1 s at 48 kHz, cap 1024, 512-frame processBlock; `uptime` printed first.
//   bun docs/spikes/newton-predictor-wasm/cost-ab.ts --base=<dir with v2_dsp.cjs> [--repeats=5]
import { execSync } from "node:child_process";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, median, sine } from "./lib";

const baseDir = arg("base", "");
const REPEATS = Number(arg("repeats", "5"));
const RATE = 48000, N = 48000, BLK = 512, BUDGET = 20833;
const input = sine(N, 1000, 0.01);
const baseMod = await ((await import(`${baseDir}/v2_dsp.cjs`)).default)();
const portMod = await ((await import("../../../packages/runtime/src/wasm/v2_dsp.cjs")).default)();
console.log(`uptime at start: ${execSync("uptime").toString().trim()}`);
console.log(`WASM in-process ns/host sample, 1 kHz 10 mV 1 s, cap 1024, block 512, ${REPEATS} interleaved repeats (A=baseline ${baseDir.split("/").pop()}, B=port), median; 20833 ns = 1.0 xRT in-process (not worklet)`);
console.log(`packet    os | A ns (xRT)      | B ns (xRT)      | B/A   | it/host A (TS ref) / B | one-it/host B | seeds/host B | peak A/B | under budget`);
const programs = Object.fromEntries(Object.entries(PACKETS).map(([k, v]) => [k, compileFile(v.file)]));
async function once(mod: any, program: any, controls: Record<string, number>, os: number) {
	const eng = await V2WasmEngine.create(program, mod);
	eng.prepare({ sampleRate: RATE, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controls)) eng.setControl(k, v);
	const fi = Float32Array.from(input), fo = new Float32Array(N);
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < N; i += BLK) eng.processBlock(fi.subarray(i, i + BLK), fo.subarray(i, i + BLK));
	const ns = Number(process.hrtime.bigint() - t0) / N;
	let tel = { seedsUsed: Number.NaN, oneIterationSolves: Number.NaN, totalIterations: Number.NaN };
	try { tel = eng.getPredictorTelemetry(); } catch { /* baseline module has no such export */ }
	const peak = eng.getMaxIterations();
	eng.destroy();
	return { ns, tel, peak };
}
function tsIterations(program: any, controls: Record<string, number>, os: number): number {
	const rt = new ReferenceRuntime(program);
	rt.prepare(RATE, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controls)) rt.setControl(k, v);
	for (let i = 0; i < N; i += BLK) rt.process(input.subarray(i, i + BLK));
	return rt.telemetry().totalIterations / N;
}
for (const os of [1, 2, 4, 8]) {
	for (const [slug, spec] of Object.entries(PACKETS)) {
		const program = programs[slug]!;
		const a: number[] = [], b: number[] = [];
		let peakA = 0, peakB = 0, telB = { seedsUsed: 0, oneIterationSolves: 0, totalIterations: 0 };
		for (let r = 0; r < REPEATS; r += 1) {
			const ra = await once(baseMod, program, spec.controls, os); a.push(ra.ns); peakA = ra.peak;
			const rb = await once(portMod, program, spec.controls, os); b.push(rb.ns); peakB = rb.peak; telB = rb.tel as any;
		}
		const ma = median(a), mb = median(b);
		console.log(`${slug.padEnd(9)} ${String(os).padStart(2)} | ${ma.toFixed(0).padStart(7)} (${(ma / BUDGET).toFixed(2).padStart(5)}) | ${mb.toFixed(0).padStart(7)} (${(mb / BUDGET).toFixed(2).padStart(5)}) | ${(mb / ma).toFixed(3)} | — / ${(telB.totalIterations / N).toFixed(3)} | ${(telB.oneIterationSolves / N).toFixed(3)} | ${(telB.seedsUsed / N).toFixed(3)} | ${peakA}/${peakB} | A ${ma < BUDGET ? "yes" : "no"}, B ${mb < BUDGET ? "yes" : "no"}  runs A ${a.map((x) => (x / BUDGET).toFixed(2)).join(" ")} B ${b.map((x) => (x / BUDGET).toFixed(2)).join(" ")}`);
	}
}
console.log(`uptime at end: ${execSync("uptime").toString().trim()}`);

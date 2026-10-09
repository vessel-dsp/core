// Step 1 / control (d)/(e) renders: factor-1 and os4 output hashes for the three study
// pedals (1 kHz 10 mV, 1 s at 48 kHz, cap 1024, study controls after prepare, 512-frame
// processBlock) on the WASM console in src/wasm/ right now, with the TS render beside it.
// Also: a linear-only fixture (resistor divider) and the RC low-pass at x1, and the
// render -> reset -> render hash pair.
//   bun docs/spikes/newton-predictor-wasm/baseline-render.ts --label=baseline
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { rcLowPass, resistorDivider } from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, sha256, sine } from "./lib";

const label = arg("label", "now");
const RATE = 48000, N = 48000, BLK = 512;
async function renderWasm(program: any, controls: Record<string, number>, os: number, input: Float64Array, resetBetween = false): Promise<{ out: Float32Array; iters: number; peak: number; nc: number; eng: V2WasmEngine }> {
	const eng = await V2WasmEngine.create(program);
	eng.prepare({ sampleRate: RATE, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controls)) eng.setControl(k, v);
	const fi = Float32Array.from(input);
	const fo = new Float32Array(input.length);
	const run = () => { for (let i = 0; i < input.length; i += BLK) { const n = Math.min(BLK, input.length - i); eng.processBlock(fi.subarray(i, i + n), fo.subarray(i, i + n)); } };
	run();
	if (resetBetween) { eng.reset(); for (const [k, v] of Object.entries(controls)) eng.setControl(k, v); run(); }
	return { out: fo, iters: -1, peak: eng.getMaxIterations(), nc: -1, eng };
}
function renderTs(program: any, controls: Record<string, number>, os: number, input: Float64Array): { out: Float64Array; iters: number; peak: number; nc: number } {
	const rt = new ReferenceRuntime(program);
	rt.prepare(RATE, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controls)) rt.setControl(k, v);
	const out = new Float64Array(input.length);
	for (let i = 0; i < input.length; i += BLK) out.set(rt.process(input.subarray(i, i + BLK)), i);
	const t = rt.telemetry();
	return { out, iters: t.totalIterations, peak: t.peakIterations, nc: t.nonConvergedSamples };
}
const input = sine(N, 1000, 0.01);
console.log(`[${label}] renders: 1 kHz 10 mV 1 s 48 kHz cap 1024 block 512`);
for (const slug of ["muff", "sd1", "ts9"]) {
	const spec = PACKETS[slug]!;
	const program = compileFile(spec.file);
	for (const os of [1, 4]) {
		const w = await renderWasm(program, spec.controls, os, input);
		const t = renderTs(program, spec.controls, os, input);
		let maxAbs = 0;
		for (let i = 0; i < N; i += 1) maxAbs = Math.max(maxAbs, Math.abs((t.out[i] as number) - (w.out[i] as number)));
		console.log(`${slug.padEnd(5)} os${os} WASM sha256=${sha256(w.out)} peak=${w.peak} | TS sha256=${sha256(t.out)} it/host=${(t.iters / N).toFixed(3)} peak=${t.peak} NC=${t.nc} | TS-vs-WASM maxAbs=${maxAbs.toExponential(2)}`);
		w.eng.destroy();
	}
}
// Linear-only and RC fixtures at x1 (control d): these must hash identically before/after.
for (const [name, src] of [["resistor-divider (linear only)", resistorDivider], ["rc-low-pass (linear only)", rcLowPass]] as const) {
	const r = compile(src, { registry: emptyRegistry });
	if (r.status !== "ok") throw new Error("fixture");
	const w = await renderWasm(r.program, {}, 1, sine(N, 1000, 0.5));
	console.log(`${name}: x1 WASM sha256=${sha256(w.out)}`);
	w.eng.destroy();
}
// Control (e): render -> reset -> render.
for (const slug of ["ts9", "muff"]) {
	const spec = PACKETS[slug]!;
	const program = compileFile(spec.file);
	for (const os of [1, 4]) {
		const once = await renderWasm(program, spec.controls, os, input);
		const twice = await renderWasm(program, spec.controls, os, input, true);
		console.log(`${slug} os${os} render sha=${sha256(once.out).slice(0, 16)} render->reset->render sha=${sha256(twice.out).slice(0, 16)} ${sha256(once.out) === sha256(twice.out) ? "EQUAL" : "DIFFERENT"}`);
		once.eng.destroy(); twice.eng.destroy();
	}
}

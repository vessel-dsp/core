// Check 8: two wasm toolchains, one process. Loads the C++ console built by emsdk A (the local 6.0.4) and by
// emsdk B (CI's 3.1.74) from two directories holding v2_dsp.cjs + v2_dsp.wasm, runs the workbench parity
// method (440 Hz @0.25 + 1320 Hz @0.1, cap 1024, settle 100 / window 2048) on the six profile packets at
// x1/os2/os4/os8 on both binaries and on the TS reference, and reports (1) whether the two binaries' float32
// outputs are bit-identical, (2) each binary against the TS reference (r and max abs; bars r >= 0.9999,
// max abs < 1e-4), (3) predictor seeds / one-iteration solves of each binary.
//   bun docs/spikes/hotfix-0.4.1/toolchain-parity.ts --a=<dirA> --b=<dirB> [--os=1,2,4,8]
import { pathToFileURL } from "node:url";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile } from "../newton-predictor-wasm/lib";
import { twoTone } from "./lib";

const load = async (dir: string) => {
	const factory = (await import(pathToFileURL(`${dir}/v2_dsp.cjs`).href)).default;
	return factory();
};
const modA = await load(arg("a", ""));
const modB = await load(arg("b", ""));
const factors = arg("os", "1,2,4,8").split(",").map(Number);
const N = 2048;
const SETTLE = 100;
const input = twoTone(N);
const f32 = Float32Array.from(input);

const corr = (x: ArrayLike<number>, y: ArrayLike<number>): number => {
	let mx = 0, my = 0;
	for (let i = 0; i < x.length; i += 1) { mx += x[i] as number; my += y[i] as number; }
	mx /= x.length; my /= x.length;
	let sxy = 0, sxx = 0, syy = 0;
	for (let i = 0; i < x.length; i += 1) { const a = (x[i] as number) - mx, b = (y[i] as number) - my; sxy += a * b; sxx += a * a; syy += b * b; }
	return sxy / Math.sqrt(sxx * syy);
};
let allIdentical = true;
let anyFail = false;
console.log("packet    os | 6.0.4 vs 3.1.74 | A vs TS: r, max abs | B vs TS: r, max abs | seeds A/B | verdict");
for (const slug of Object.keys(PACKETS)) {
	const spec = PACKETS[slug]!;
	const program = compileFile(spec.file);
	for (const os of factors) {
		const opts = { sampleRate: 48000, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) };
		const ts = new ReferenceRuntime(program);
		ts.prepare(48000, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
		for (const [k, v] of Object.entries(spec.controls)) ts.setControl(k, v);
		const tsOut = Array.from(ts.process(Float64Array.from(f32)));
		const run = async (mod: unknown) => {
			const eng = await V2WasmEngine.create(program, mod);
			eng.prepare(opts);
			for (const [k, v] of Object.entries(spec.controls)) eng.setControl(k, v);
			const out = new Float32Array(N);
			eng.processBlock(f32, out);
			const tel = eng.getPredictorTelemetry();
			eng.destroy();
			return { out, seeds: tel.seedsUsed, ones: tel.oneIterationSolves };
		};
		const a = await run(modA);
		const b = await run(modB);
		let identical = true;
		for (let i = 0; i < N; i += 1) if (!Object.is(a.out[i], b.out[i])) { identical = false; break; }
		const stat = (o: Float32Array) => {
			const x = Array.from(o).slice(SETTLE), y = tsOut.slice(SETTLE);
			let mx = 0;
			for (let i = 0; i < x.length; i += 1) mx = Math.max(mx, Math.abs((x[i] as number) - (y[i] as number)));
			return { r: corr(x, y), mx };
		};
		const sa = stat(a.out), sb = stat(b.out);
		const bar = (s: { r: number; mx: number }) => s.r >= 0.9999 && s.mx < 1e-4;
		if (!identical) allIdentical = false;
		const pass = bar(sa) && bar(sb);
		if (!pass) anyFail = true;
		console.log(`${slug.padEnd(9)} ${String(os).padStart(2)} | ${identical ? "bit-identical" : "DIFFERENT"} | ${sa.r.toFixed(6)}, ${sa.mx.toExponential(2)} | ${sb.r.toFixed(6)}, ${sb.mx.toExponential(2)} | ${a.seeds}/${b.seeds} | ${pass ? "within bars" : "OVER A BAR (same on both binaries: " + (bar(sa) === bar(sb)) + ")"}`);
	}
}
console.log(allIdentical ? "\nthe two toolchains' binaries are bit-identical on every row" : "\nTOOLCHAIN DIFFERENCE on some row");
console.log(anyFail ? "some rows are over a parity bar (see rows; compare with the previous release's table)" : "every row within the parity bars");

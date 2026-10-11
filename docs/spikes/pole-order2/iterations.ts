// Newton iterations per host sample (and peak, non-converged samples) on both consoles, in the tree this is run in: 1 kHz 10 mV, 1 s, cap 1024, 512-frame blocks, study controls
// where the packet has them. TS from telemetry(); WASM from the predictor counters' totalIterations. Not a timing: run anywhere.
//   bun docs/spikes/pole-order2/iterations.ts --slugs=muff,sd1,ts9,ts808,gro100,blue-box --os=1,4 [--amp=0.01] [--hz=1000] [--seconds=1] [--out=<json>] [--wasm-dir=<dir>] [--no-wasm]
import { writeFileSync } from "node:fs";
import { PACKETS, arg, compileFile, fileForSlug, renderTs, renderWasm, sine } from "./lib";
const slugs = arg("slugs", "muff,sd1,ts9,ts808,gro100,blue-box").split(","), factors = arg("os", "1,4").split(",").map(Number);
const amp = Number(arg("amp", "0.01")), hz = Number(arg("hz", "1000")), seconds = Number(arg("seconds", "1")), out = arg("out", "");
const wasmDir = arg("wasm-dir", "") || undefined, noWasm = process.argv.includes("--no-wasm");
const N = Math.round(48000 * seconds), input = sine(N, hz, amp);
const rows: Array<Record<string, unknown>> = [];
console.log(`iterations per host sample, ${hz} Hz ${amp * 1000} mV ${seconds} s, cap 1024`);
console.log("packet                                  os | TS it/host  peak  NC | WASM it/host  peak");
for (const slug of slugs) {
	const spec = PACKETS[slug];
	const program = compileFile(spec?.file ?? fileForSlug(slug)), controls = spec?.controls ?? {};
	for (const os of factors) {
		const t = renderTs(program, controls, input, { os });
		const w = noWasm ? { totalIterations: Number.NaN, peak: Number.NaN } : await renderWasm(program, controls, input, { os, wasmDir });
		const row = { slug, os, ts_it: t.iterations / N, ts_peak: t.peak, ts_nc: t.nonConverged, wasm_it: w.totalIterations / N, wasm_peak: w.peak };
		rows.push(row);
		console.log(`${slug.padEnd(39)} ${String(os).padStart(2)} | ${row.ts_it.toFixed(3).padStart(10)} ${String(row.ts_peak).padStart(5)} ${String(row.ts_nc).padStart(3)} | ${row.wasm_it.toFixed(3).padStart(11)} ${String(row.wasm_peak).padStart(5)}`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

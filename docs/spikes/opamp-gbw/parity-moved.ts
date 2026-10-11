// TS-vs-WASM parity (the workbench method: 440 Hz @0.25 + 1320 Hz @0.1, float32 input to both, cap 1024, settle 100 / window 2048, bars r >= 0.9999 and max abs < 1e-4)
// for every corpus document with an op-amp section off 1 MHz, at x1 / os2 / os4, with the convergence numbers beside it. Run in both trees; compare with parity-moved-compare.py.
//   bun docs/spikes/opamp-gbw/parity-moved.ts --slugs=a,b --out=<json> [--stall-ms=20000]
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { StallError, arg, computeMetrics, corpusFiles, renderTs, renderWasm, twoTone } from "./lib";
const slugs = arg("slugs", "").split(",").filter(Boolean), out = arg("out", ""), stallMs = Number(arg("stall-ms", "20000"));
const W = 2048, SETTLE = 100;
const input = Float64Array.from(Float32Array.from(twoTone(W)));
const rows: Array<Record<string, unknown>> = [];
for (const { slug, file } of corpusFiles()) {
	if (!slugs.includes(slug)) continue;
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") continue;
	for (const os of [1, 2, 4]) {
		const row: Record<string, unknown> = { slug, os };
		try {
			const t = renderTs(r.program, {}, input, { os, block: W, stallMs });
			const w = await renderWasm(r.program, {}, input, { os, block: W, stallMs });
			const a = Array.from(t.out.subarray(SETTLE)), b = Array.from(w.out.subarray(SETTLE));
			const m = computeMetrics(a, b);
			Object.assign(row, { r: m.correlation, maxAbs: m.maxDelta, silent: m.isSilent, nc: t.nonConverged, it: t.iterations / W, tsPeak: t.peak, wasmPeak: w.peak, pass: m.isSilent ? m.maxDelta < 1e-4 : m.correlation >= 0.9999 && m.maxDelta < 1e-4 });
		} catch (e) { if (!(e instanceof StallError)) throw e; row.stall = e.message; }
		rows.push(row);
		console.log(`${slug.padEnd(40)} os${os} ${row.stall ? "STALL " + row.stall : `r ${(row.r as number).toFixed(6)} maxAbs ${(row.maxAbs as number).toExponential(2)} NC ${row.nc} it ${(row.it as number).toFixed(1)} peaks ${row.tsPeak}/${row.wasmPeak} ${row.pass ? "PASS" : "FAIL"}`}`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows, null, 1));

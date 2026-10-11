// Stall scan: every corpus document with a railed op-amp, WASM console, 1 kHz 100 mV, 0.25 s, at x1 / os2 / os4, one render each with a per-block stall guard. Per case: iterations per host
// sample and peak, or STALL (a block over --stall-ms; the render is abandoned). From whichever tree this is run in; compare two outputs with stall-scan-compare.py.
//   bun docs/spikes/pole-order2/stall-scan.ts --out=<json> [--stall-ms=8000] [--os=1,2,4] [--seconds=0.25] [--amp=0.1] [--only=a,b] [--wasm-dir=<dir>]
import { writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { readFileSync } from "node:fs";
import { StallError, arg, corpusFiles, renderWasm, sine } from "./lib";
const out = arg("out", ""), stallMs = Number(arg("stall-ms", "8000")), factors = arg("os", "1,2,4").split(",").map(Number), seconds = Number(arg("seconds", "0.25")), amp = Number(arg("amp", "0.1"));
const only = arg("only", "").split(",").filter(Boolean), wasmDir = arg("wasm-dir", "") || undefined;
const N = Math.round(48000 * seconds), input = sine(N, 1000, amp), rows: Array<Record<string, unknown>> = [];
for (const { slug, file } of corpusFiles()) {
	if (only.length > 0 && !only.includes(slug)) continue;
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") continue;
	if (only.length === 0 && !r.program.blocks.some((b) => b.kind === "mna" && b.stamps.some((s) => s.kind === "ideal-opamp" && (s as any).railHigh !== null && (s as any).railLow !== null))) continue;
	for (const os of factors) {
		const row: Record<string, unknown> = { slug, os }, t0 = Date.now();
		try { const w = await renderWasm(r.program, {}, input, { os, stallMs, block: 512, wasmDir }); row.it = w.totalIterations / N; row.peak = w.peak; }
		catch (e) { if (!(e instanceof StallError)) throw e; row.stall = e.message; }
		row.ms = Date.now() - t0; rows.push(row);
		console.log(`${slug.padEnd(40)} x${os} ${row.stall ? "STALL " + row.stall : `it/host ${(row.it as number).toFixed(2)} peak ${row.peak}`} (${row.ms} ms)`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

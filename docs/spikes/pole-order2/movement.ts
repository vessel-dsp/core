// Corpus movement and safety: for every corpus document whose compiled program has a RAILED op-amp stamp (the only ones the pole acts on; the same
// list in either tree, since the filter reads the compiled stamps), render a 1 kHz 100 mV second, then 8 kHz
// and 16 kHz 100 mV seconds, at os1 and os4, on the TS console (convergence telemetry) -- and the WASM console (level only). Levels are the
// harmonic-LS fundamental of the last 0.5 s. Run in both trees and compare with movement-compare.ts.
//   bun docs/spikes/pole-order2/movement.ts --out=<json> [--slugs=a,b] [--seconds=1] [--amp=0.1] [--no-wasm] [--no-ts]
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { StallError, arg, corpusFiles, fundamentalOf, has, renderTs, renderWasm, sine } from "./lib";

const out = arg("out", "");
const only = arg("slugs", "").split(",").filter(Boolean);
const seconds = Number(arg("seconds", "1")), amp = Number(arg("amp", "0.1"));
const FREQS = [1000, 8000, 10000, 12500, 16000];
const wasmDir = arg("wasm-dir", "") || undefined; // render the WASM levels on a scratch build (e.g. the BDF2 arm) instead of this tree's
const stallMs = Number(arg("stall-ms", "0")) || undefined; // a block over this is recorded as a STALL and the render abandoned
const rows: Array<Record<string, unknown>> = [];
for (const { slug, file } of corpusFiles()) {
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") continue;
	if (only.length > 0 ? !only.includes(slug) : !r.program.blocks.some((b) => b.kind === "mna" && b.stamps.some((s) => s.kind === "ideal-opamp" && (s as any).railHigh !== null && (s as any).railLow !== null))) continue;
	const N = Math.round(48000 * seconds);
	for (const os of [1, 4]) {
		const row: Record<string, unknown> = { slug, os };
		const t0 = Date.now();
		for (const hz of FREQS) {
			const input = sine(N, hz, amp);
			if (!has("no-ts") && hz === 1000) {
				try {
					const t = renderTs(r.program, {}, input, { os, stallMs });
					row[`ts_${hz}_mV`] = fundamentalOf(t.out.subarray(N >> 1), 48000, hz) * 1000;
					row[`ts_${hz}_nc`] = t.nonConverged; row[`ts_${hz}_it`] = t.iterations / N; row[`ts_${hz}_peak`] = t.peak;
					row[`ts_${hz}_finite`] = t.out.every((v) => Number.isFinite(v));
				} catch (e) { if (!(e instanceof StallError)) throw e; row[`ts_${hz}_stall`] = e.message; }
			}
			if (!has("no-wasm")) {
				try {
					const w = await renderWasm(r.program, {}, input, { os, stallMs, wasmDir });
					row[`wasm_${hz}_mV`] = fundamentalOf(Float64Array.from(w.out.subarray(N >> 1)), 48000, hz) * 1000;
					row[`wasm_${hz}_peak`] = w.peak;
				} catch (e) { if (!(e instanceof StallError)) throw e; row[`wasm_${hz}_stall`] = e.message; }
			}
		}
		row.ms = Date.now() - t0;
		rows.push(row);
		console.log(`${slug.padEnd(40)} os${os} ${row.ms} ms`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows, null, 1));

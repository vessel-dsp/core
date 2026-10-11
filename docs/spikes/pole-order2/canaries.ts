// Stability canaries (TS and WASM, both oversample factors): the documents that have broken the solver before. For each, two stimuli -- 1 kHz 100 mV for 1 s, and the
// scoreboard two-tone (440 Hz @0.25 + 1320 Hz @0.1) for 2 s -- at os1 and os4: non-converged samples and peak iterations (TS), iterations per host sample (TS and WASM), finite
// output, a block-over-`stall-ms` STALL guard (a stalled block costs tens of seconds, so the render is abandoned and recorded).
//   bun docs/spikes/pole-order2/canaries.ts [--slugs=boss-bd-2-blues-driver,ibanez-pql,boss-od-1] [--out=<json>] [--stall-ms=20000] [--os=1,4] [--no-wasm]
import { writeFileSync } from "node:fs";
import { StallError, arg, compileFile, fileForSlug, renderTs, renderWasm, sine } from "./lib";
const slugs = arg("slugs", "boss-bd-2-blues-driver,ibanez-pql,boss-od-1").split(","), factors = arg("os", "1,4").split(",").map(Number);
const out = arg("out", ""), stallMs = Number(arg("stall-ms", "20000")), noWasm = process.argv.includes("--no-wasm");
const tone = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / 48000) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / 48000));
const stimuli: Array<[string, Float64Array]> = [["1kHz-100mV-1s", sine(48000, 1000, 0.1)], ["two-tone-2s", tone(96000)]];
const rows: Array<Record<string, unknown>> = [];
console.log("slug                                os stimulus       | TS: NC  peak it/host finite | WASM: it/host peak");
for (const slug of slugs) {
	const program = compileFile(fileForSlug(slug));
	for (const os of factors) for (const [label, input] of stimuli) {
		const row: Record<string, unknown> = { slug, os, stimulus: label };
		let tsText = "", wasmText = "";
		try {
			const t = renderTs(program, {}, input, { os, stallMs });
			Object.assign(row, { ts_nc: t.nonConverged, ts_peak: t.peak, ts_it: t.iterations / input.length, ts_finite: t.out.every((v) => Number.isFinite(v)) });
			tsText = `${String(t.nonConverged).padStart(5)} ${String(t.peak).padStart(5)} ${(t.iterations / input.length).toFixed(3).padStart(7)} ${row.ts_finite}`;
		} catch (e) { if (!(e instanceof StallError)) throw e; row.ts_stall = e.message; tsText = `STALL ${e.message}`; }
		try {
			if (noWasm) throw new StallError("wasm skipped");
			const w = await renderWasm(program, {}, input, { os, stallMs });
			Object.assign(row, { wasm_it: w.totalIterations / input.length, wasm_peak: w.peak });
			wasmText = `${(w.totalIterations / input.length).toFixed(3).padStart(7)} ${String(w.peak).padStart(5)}`;
		} catch (e) { if (!(e instanceof StallError)) throw e; row.wasm_stall = e.message; wasmText = `STALL ${e.message}`; }
		rows.push(row);
		console.log(`${slug.padEnd(35)} ${os} ${label.padEnd(14)} | ${tsText} | ${wasmText}`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

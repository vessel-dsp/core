// Corpus-wide render hashes, from whichever tree this is run in: every corpus document (pedals, then amps) is compiled with
// pedalPartCatalog, its op-amp stamps are counted (railed / total / with a stated product), and a 1 kHz 100 mV sine of
// 0.25 s is rendered at x1 and os4 on the TS console and, where the tree has a wasm build, the WASM console; each output is
// sha256-hashed. Run in the baseline clone and in the worktree and compare with corpus-hash-compare.ts.
//   bun docs/spikes/opamp-gbw/corpus-hash.ts --out=<file.json> [--only=slug,slug] [--seconds=0.25] [--no-wasm] [--no-ts]
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { arg, corpusFiles, has, renderTs, renderWasm, sha256, sine } from "./lib";

const out = arg("out", "");
const only = arg("only", "").split(",").filter(Boolean);
const seconds = Number(arg("seconds", "0.25"));
const doTs = !has("no-ts"), doWasm = !has("no-wasm");
const N = Math.round(48000 * seconds);
const input = sine(N, 1000, 0.1);
const rows: Array<Record<string, unknown>> = [];
for (const { slug, file, amp } of corpusFiles()) {
	if (only.length > 0 && !only.includes(slug)) continue;
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") { rows.push({ slug, amp, status: r.status }); continue; }
	const stamps = r.program.blocks.flatMap((b) => (b.kind === "mna" ? b.stamps : [])).filter((s) => s.kind === "ideal-opamp") as any[];
	const row: Record<string, unknown> = {
		slug, amp, status: "ok",
		opamps: stamps.length,
		railed: stamps.filter((s) => s.railHigh !== null).length,
		stated: stamps.filter((s) => typeof s.gainBandwidthHz === "number").length,
		gbps: [...new Set(stamps.map((s) => s.gainBandwidthHz ?? null))].sort(),
	};
	const t0 = Date.now();
	try {
		for (const os of [1, 4]) {
			if (doTs) { const t = renderTs(r.program, {}, input, { os }); row[`ts_x${os}`] = sha256(t.out); row[`ts_x${os}_nc`] = t.nonConverged; }
			if (doWasm) { const w = await renderWasm(r.program, {}, input, { os }); row[`wasm_x${os}`] = sha256(w.out); }
		}
	} catch (e) { row.error = String(e).slice(0, 200); }
	row.ms = Date.now() - t0;
	rows.push(row);
	console.log(`${slug.padEnd(40)} opamps=${row.opamps} stated=${row.stated} ${row.error ? "ERROR " + row.error : ""} ${row.ms} ms`);
}
if (out !== "") writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`${rows.length} documents${out ? ` -> ${out}` : ""}`);

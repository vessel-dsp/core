// Check 4: which rows of the Newton-budget spike's corpus table (section 12, "method vs shipped") disagree
// with what the REAL runtime does? For each packet, relRMS of the real runtime with the predictor on (the
// 0.4.0 tree) against the same tree with it forced off (= the spike's "shipped"), in the spike's own
// protocol (x1, cap 64, 2400 + 9600 samples of 1 kHz @0.1 V; dumps from x1-dump.ts --stim=k1), against the
// table's methodVsShipped from its jsonl. Reads the dumps and the four jsonl files; prints the disagreements.
//   bun docs/spikes/hotfix-0.4.1/sweep-table-recheck.ts --on=<prefix> --off=<prefix> --out=<tsv>
import { readFileSync, writeFileSync } from "node:fs";
import { arg } from "./lib";

type Dump = { N: number; rows: Array<{ slug: string; status: string; ts?: number }>; data: Float64Array };
function load(prefix: string): Dump {
	const meta = JSON.parse(readFileSync(`${prefix}.json`, "utf8")) as { N: number; rows: Dump["rows"] };
	const buf = readFileSync(`${prefix}.f64`);
	return { N: meta.N, rows: meta.rows, data: new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8) };
}
const on = load(arg("on", ""));
const off = load(arg("off", ""));
const dir = new URL("../newton-budget/out/", import.meta.url).pathname;
const table = new Map<string, number>();
for (const f of ["corpus-m1adapt3-pedals.fixed.jsonl", "corpus-m1adapt3-amps.fixed.jsonl"]) {
	for (const line of readFileSync(`${dir}${f}`, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		const row = JSON.parse(line) as { packet: string; methodVsShipped?: number };
		if (typeof row.methodVsShipped === "number") table.set(row.packet, row.methodVsShipped);
	}
}
const offBy = new Map(off.rows.map((r) => [r.slug, r]));
type Out = { slug: string; real: number; table: number; ratio: number };
const outs: Out[] = [];
for (const a of on.rows) {
	const b = offBy.get(a.slug);
	if (a.status !== "ok" || b === undefined || b.status !== "ok" || a.ts === undefined || b.ts === undefined || !table.has(a.slug)) continue;
	const x = on.data.subarray(a.ts * on.N, (a.ts + 1) * on.N);
	const y = off.data.subarray(b.ts * off.N, (b.ts + 1) * off.N);
	let d2 = 0, r2 = 0;
	for (let i = 0; i < x.length; i += 1) { d2 += ((x[i] as number) - (y[i] as number)) ** 2; r2 += (y[i] as number) ** 2; }
	const real = Math.sqrt(d2 / Math.max(r2, 1e-300));
	const t = table.get(a.slug) as number;
	outs.push({ slug: a.slug, real, table: t, ratio: real / Math.max(t, 1e-16) });
}
const bad = outs.filter((o) => o.real >= 1e-7 && o.ratio >= 100).sort((p, q) => q.real - p.real);
const near = outs.filter((o) => o.real >= 1e-7 && o.ratio < 100 && o.ratio > 0.01).length;
console.log(`${outs.length} packets joined (table rows with a real-runtime run); the table's "method vs shipped" is >= 100x below the real predictor-on vs predictor-off relRMS (real >= 1e-7) on ${bad.length}:`);
console.log("packet                                    real relRMS   table method-vs-shipped   real / table");
for (const o of bad) console.log(`${o.slug.padEnd(40)}  ${o.real.toExponential(2).padStart(10)}   ${o.table.toExponential(2).padStart(10)}              ${o.ratio.toExponential(1)}`);
console.log(`rows where real >= 1e-7 and the table is within 100x either way: ${near}; rows where real < 1e-7: ${outs.filter((o) => o.real < 1e-7).length}`);
const dm = outs.find((o) => o.slug === "boss-dm-2");
if (dm) console.log(`boss-dm-2: real ${dm.real.toExponential(3)} vs table ${dm.table.toExponential(3)}`);
const hist = [1e-9, 1e-7, 1e-5, 1e-3, 1e-2, 1];
const names = ["<1e-9", "1e-9..1e-7", "1e-7..1e-5", "1e-5..1e-3", "1e-3..1e-2", "1e-2..1", ">1"];
const bucket = (v: number) => { for (let i = 0; i < hist.length; i += 1) if (v < (hist[i] as number)) return i; return hist.length; };
const realB = new Array<number>(names.length).fill(0), tabB = new Array<number>(names.length).fill(0);
for (const o of outs) { realB[bucket(o.real)] = (realB[bucket(o.real)] as number) + 1; tabB[bucket(o.table)] = (tabB[bucket(o.table)] as number) + 1; }
console.log("distribution of method-vs-shipped relRMS over the joined packets:");
for (const [i, n] of names.entries()) console.log(`  ${n.padEnd(12)} real ${String(realB[i]).padStart(3)}   table ${String(tabB[i]).padStart(3)}`);
const tsv = ["packet\treal\ttable\tratio", ...outs.map((o) => `${o.slug}\t${o.real}\t${o.table}\t${o.ratio}`)].join("\n");
if (arg("out", "") !== "") writeFileSync(arg("out", ""), tsv);

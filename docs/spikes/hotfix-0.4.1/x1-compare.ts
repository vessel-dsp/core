// Compares two x1-dump outputs sample for sample, per console. "Bit-identical" means every float64 (TS) or
// float32-widened (WASM) sample has equal bits. Reports the bucket table of max|a-b| / peak(a) (the
// workbench F3 method: relative to the reference side's peak over the window), and every packet that is
// not bit-identical with its repivot attribution.
//   bun docs/spikes/hotfix-0.4.1/x1-compare.ts --a=<prefix> --b=<prefix> [--settle=0] [--list=all|diff]
import { readFileSync } from "node:fs";
import { arg } from "./lib";

type Row = { slug: string; status: string; ts?: number; wasm?: number; text?: string; json?: string; tsRepivoted?: string[] | null; wasmRepivotedBlocks?: number | null; tsHistoryEntries?: number | null; wasmSeeds?: number | null; tsIterations?: number; wasmIterations?: number | null };
type Dump = { N: number; rows: Row[]; data: Float64Array };
function load(prefix: string): Dump {
	const meta = JSON.parse(readFileSync(`${prefix}.json`, "utf8")) as { N: number; rows: Row[] };
	const buf = readFileSync(`${prefix}.f64`);
	const data = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
	return { N: meta.N, rows: meta.rows, data };
}
const A = load(arg("a", ""));
const B = load(arg("b", ""));
const settle = Number(arg("settle", "0"));
const listMode = arg("list", "diff");
const byB = new Map(B.rows.map((r) => [r.slug, r]));
const slice = (d: Dump, k: number) => d.data.subarray(k * d.N + settle, (k + 1) * d.N);
const edges = [1e-9, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
const names = ["bit-identical", "<=1e-9", "<=1e-7", "<=1e-6", "<=1e-5", "<=1e-4", "<=1e-3", "<=1e-2", ">1e-2"];
const bucket = (rel: number): string => {
	if (rel === 0) return names[0] as string;
	for (let i = 0; i < edges.length; i += 1) if (rel <= (edges[i] as number)) return names[i + 1] as string;
	return names[names.length - 1] as string;
};
const programsDiffer: string[] = [];
for (const eng of ["ts", "wasm"] as const) {
	const rows: Array<{ slug: string; abs: number; rel: number; rms: number; peak: number; a: Row; b: Row }> = [];
	for (const a of A.rows) {
		const b = byB.get(a.slug);
		if (a.status !== "ok" || b === undefined || b.status !== "ok" || a[eng] === undefined || b[eng] === undefined) continue;
		if (eng === "ts" && (a.text !== b.text || a.json !== b.json)) programsDiffer.push(a.slug);
		const x = slice(A, a[eng] as number);
		const y = slice(B, b[eng] as number);
		let peak = 0;
		let abs = 0;
		let diff2 = 0;
		let ref2 = 0;
		for (let i = 0; i < x.length; i += 1) {
			const xv = x[i] as number;
			const yv = y[i] as number;
			peak = Math.max(peak, Math.abs(xv));
			diff2 += (xv - yv) * (xv - yv);
			ref2 += xv * xv;
			// Bit equality, not numeric equality: NaN and -0 must be caught too.
			if (!Object.is(xv, yv)) abs = Math.max(abs, Math.abs(xv - yv) || Number.POSITIVE_INFINITY);
		}
		rows.push({ slug: a.slug, abs, rel: abs / Math.max(peak, 1e-12), rms: Math.sqrt(diff2 / Math.max(ref2, 1e-300)), peak, a, b });
	}
	const counts = new Map<string, number>();
	for (const r of rows) counts.set(bucket(r.rel), (counts.get(bucket(r.rel)) ?? 0) + 1);
	console.log(`\n== ${eng.toUpperCase()}: ${rows.length} packets compared (window: samples ${settle}..${A.N}), max|a-b| / peak(a)`);
	console.log(names.filter((n) => counts.has(n)).map((n) => `${n}: ${counts.get(n)}`).join("  |  "));
	const bad = rows.filter((r) => r.abs !== 0).sort((p, q) => q.rel - p.rel);
	const show = listMode === "all" ? rows : bad;
	for (const r of show) {
		const rep = eng === "ts" ? `a-repivoted=${JSON.stringify(r.a.tsRepivoted ?? null)} b-repivoted=${JSON.stringify(r.b.tsRepivoted ?? null)}` : `a-repivotedBlocks=${r.a.wasmRepivotedBlocks ?? "n/a"} b-repivotedBlocks=${r.b.wasmRepivotedBlocks ?? "n/a"}`;
		console.log(`  ${r.slug.padEnd(44)} max abs ${r.abs.toExponential(3)}  rel ${r.rel.toExponential(3)}  relRMS ${r.rms.toExponential(3)}  peak ${r.peak.toExponential(3)}  ${rep}`);
	}
	console.log(`${eng}: bit-identical ${rows.length - bad.length} of ${rows.length}; differ ${bad.length}`);
}
console.log(`\nprograms: emitted text or JSON differs for ${programsDiffer.length} packets${programsDiffer.length ? `: ${programsDiffer.join(", ")}` : ""}`);

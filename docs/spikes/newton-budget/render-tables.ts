// Render the measurement jsonl files as markdown tables for the report.
//   bun docs/spikes/newton-budget/render-tables.ts main docs/spikes/newton-budget/out/main-m1.jsonl
//   bun docs/spikes/newton-budget/render-tables.ts corpus docs/spikes/newton-budget/out/corpus-m1adapt-pedals.jsonl
import { readFileSync } from "node:fs";
const [mode, file] = [process.argv[2] ?? "main", process.argv[3] ?? ""];
const rows = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const e = (x: number | null | undefined, d = 1) => x === null || x === undefined ? "–" : x.toExponential(d);
const f = (x: number | null | undefined, d = 2) => x === null || x === undefined ? "–" : x.toFixed(d);
if (mode === "main") {
	const packets = [...new Set(rows.map((r) => r.packet))];
	const factors = [...new Set(rows.map((r) => r.os))].sort((a: number, b: number) => a - b);
	for (const os of factors) {
		console.log(`\n**os${os}** (cap ${rows[0].cap}, ${rows[0].warmup}+${rows[0].samples} host samples)\n`);
		console.log("| packet | method | it/host | fac/host | reuse/host | 1-step % | relax | NC (warm) | peak | stall/cap/lim refactors | Broyden | vs dense relRMS | max abs V | fixed-point dev (tol units) | dev>1 | method>twin | twin it/host | twin NC |");
		console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
		for (const p of packets) for (const r of rows.filter((x) => x.packet === p && x.os === os)) {
			console.log(`| ${p} | ${r.method} | ${f(r.itPerHost, 3)} | ${f(r.facPerHost, 3)} | ${f(r.reusePerHost, 3)} | ${f(100 * r.oneStepShare, 1)} | ${r.relaxEngaged} | ${r.nc} (${r.warmNc}) | ${r.peak} | ${r.stallRefactors}/${r.capRefactors}/${r.limitedRefactors ?? 0} | ${r.broydenUpdates} | ${e(r.relRms)} | ${e(r.maxAbs)} | ${r.worstDeviationTol === null ? "–" : r.worstDeviationTol < 0.01 ? e(r.worstDeviationTol, 1) : f(r.worstDeviationTol, 3)} | ${r.deviationOver1 ?? "–"} | ${r.methodMoreIterations ?? "–"} | ${f(r.twinItPerHost, 3)} | ${r.twinNc ?? "–"} |`);
		}
	}
} else {
	console.log("| packet | n | it/host shipped → method | Δ% | NC shipped/method (dense) | peak s/m | vs dense shipped → method | method vs shipped | fixed-point dev (tol) | dev>1 | 1-step % |");
	console.log("|---|---|---|---|---|---|---|---|---|---|---|");
	for (const r of rows) {
		if (r.compile !== "ok") { console.log(`| ${r.packet} | – | compile ${r.compile}${r.note ? ` (${String(r.note).slice(0, 60)})` : ""} | | | | | | | | |`); continue; }
		const d = 100 * (r.methodItPerHost / r.shippedItPerHost - 1);
		console.log(`| ${r.packet} | ${r.n} | ${f(r.shippedItPerHost, 3)} → ${f(r.methodItPerHost, 3)} | ${d >= 0 ? "+" : ""}${f(d, 1)} | ${r.shippedNc}/${r.methodNc} (${r.denseNc}) | ${r.shippedPeak}/${r.methodPeak} | ${e(r.shippedVsDense)} → ${e(r.methodVsDense)} | ${e(r.methodVsShipped)} | ${r.worstDeviationTol < 0.01 ? e(r.worstDeviationTol, 1) : f(r.worstDeviationTol, 3)} | ${r.deviationOver1} | ${f(100 * r.oneStepShare, 1)} |`);
	}
	const ok = rows.filter((r) => r.compile === "ok");
	const fewer = ok.filter((r) => r.methodItPerHost < r.shippedItPerHost - 1e-9).length;
	const more = ok.filter((r) => r.methodItPerHost > r.shippedItPerHost + 1e-9).length;
	let worst = -1; let worstP: any = null;
	for (const r of ok) { const d = r.methodItPerHost / r.shippedItPerHost - 1; if (d > worst) { worst = d; worstP = r; } }
	const sumS = ok.reduce((a, r) => a + r.shippedItPerHost, 0), sumM = ok.reduce((a, r) => a + r.methodItPerHost, 0);
	console.log(`\npackets ${ok.length}: fewer iterations ${fewer}, more ${more} (worst +${f(100 * worst, 1)}% on ${worstP?.packet}), aggregate it/host ${f(sumS, 1)} → ${f(sumM, 1)} (${f(100 * (sumM / sumS - 1), 1)}%); more non-converged than shipped: ${ok.filter((r) => r.methodNc > r.shippedNc).map((r) => `${r.packet} ${r.shippedNc}→${r.methodNc}`).join(", ") || "none"}; fewer: ${ok.filter((r) => r.methodNc < r.shippedNc).map((r) => `${r.packet} ${r.shippedNc}→${r.methodNc}`).join(", ") || "none"}; any sub-sample deviating >1 tol unit: ${ok.filter((r) => r.deviationOver1 > 0).map((r) => `${r.packet} (${r.deviationOver1}, worst ${f(r.worstDeviationTol, 2)})`).join(", ") || "none"}; worst deviation among the rest ${f(Math.max(...ok.filter((r) => r.deviationOver1 === 0).map((r) => r.worstDeviationTol)), 3)}; packets within 1e-9 of dense as shipped: ${ok.filter((r) => r.shippedVsDense <= 1e-9).length}, still within 1e-9 with the method: ${ok.filter((r) => r.shippedVsDense <= 1e-9 && r.methodVsDense <= 1e-9).length}`);
}

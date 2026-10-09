// Per-solve comparison of converged solution vectors from two rule-trace.ts --solutions runs, in
// tolerance units |dx| / (1e-3 max|x| + 1e-6) (the spike's measure; <= 1 is "within the convergence
// tolerances"). Reports the first solve that differs at all, the first beyond 1 unit, and the worst.
//   bun docs/spikes/hotfix-0.4.1/solution-compare.ts a.json b.json
import { readFileSync } from "node:fs";
const [pa, pb] = process.argv.slice(2) as [string, string];
const meta = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { mode: string; warmRows: number; rows: number[][]; solveSize: number };
const load = (p: string) => { const b = readFileSync(`${p}.f64`); return new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8); };
const A = meta(pa), B = meta(pb), a = load(pa), b = load(pb);
const n = A.solveSize;
const solves = Math.min(A.rows.length, B.rows.length);
let firstAny = -1, firstOver1 = -1, worst = 0, worstAt = -1, differing = 0, over1 = 0;
for (let s = 0; s < solves; s += 1) {
	let w = 0, any = false;
	for (let i = 0; i < n; i += 1) {
		const x = a[s * n + i] as number, y = b[s * n + i] as number;
		if (!Object.is(x, y)) any = true;
		w = Math.max(w, Math.abs(x - y) / (1e-3 * Math.max(Math.abs(x), Math.abs(y)) + 1e-6));
	}
	if (any) { differing += 1; if (firstAny < 0) firstAny = s; }
	if (w > 1) { over1 += 1; if (firstOver1 < 0) firstOver1 = s; }
	if (w > worst) { worst = w; worstAt = s; }
}
console.log(`${A.mode} vs ${B.mode}: ${solves} solves (warm-up ${A.warmRows}); solves with any bit difference ${differing} (first ${firstAny}); beyond 1 tolerance unit ${over1} (first ${firstOver1}); worst ${worst.toExponential(3)} units at solve ${worstAt}`);
const seeded = (m: typeof A) => m.rows.filter((r) => r[0] === 1).length;
console.log(`seeded: ${A.mode} ${seeded(A)}, ${B.mode} ${seeded(B)}`);

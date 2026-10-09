// Aligns two rule-trace.ts outputs solve for solve and reports the first divergences in the decision
// (seeded or not) and in iterations used. bun docs/spikes/hotfix-0.4.1/rule-trace-compare.ts a.json b.json
import { readFileSync } from "node:fs";
const [pa, pb] = process.argv.slice(2) as [string, string];
type T = { mode: string; slug: string; warmRows: number; rows: Array<[number, number, number, number]> };
const a = JSON.parse(readFileSync(pa, "utf8")) as T;
const b = JSON.parse(readFileSync(pb, "utf8")) as T;
const n = Math.min(a.rows.length, b.rows.length);
console.log(`${a.mode}: ${a.rows.length} solves; ${b.mode}: ${b.rows.length} solves; aligned over ${n}`);
let seedDiff = 0, usedDiff = 0, firstSeed = -1, firstUsed = -1, bothSeeded = 0;
for (let i = 0; i < n; i += 1) {
	const x = a.rows[i] as [number, number, number, number];
	const y = b.rows[i] as [number, number, number, number];
	if (x[0] === 1 && y[0] === 1) bothSeeded += 1;
	if (x[0] !== y[0]) { seedDiff += 1; if (firstSeed < 0) firstSeed = i; }
	if (x[1] !== y[1]) { usedDiff += 1; if (firstUsed < 0) firstUsed = i; }
}
console.log(`seeded in both: ${bothSeeded}; solves where the seeding decision differs: ${seedDiff} (first at solve ${firstSeed}); where iterations used differ: ${usedDiff} (first at solve ${firstUsed})`);
const show = (i: number) => {
	if (i < 0) return;
	for (let k = Math.max(0, i - 3); k < Math.min(n, i + 4); k += 1) console.log(`  solve ${k}${k === i ? " <==" : "    "} ${a.mode}: seeded=${a.rows[k]?.[0]} used=${a.rows[k]?.[1]} conv=${a.rows[k]?.[2]} order=${a.rows[k]?.[3]} | ${b.mode}: seeded=${b.rows[k]?.[0]} used=${b.rows[k]?.[1]} conv=${b.rows[k]?.[2]} order=${b.rows[k]?.[3]}`);
};
show(firstSeed);
if (firstUsed !== firstSeed) show(firstUsed);

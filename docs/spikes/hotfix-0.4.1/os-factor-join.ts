// Joins two os-factor-probe.ts outputs (A = predictor OFF, B = predictor ON) per packet and factor:
// iterations per host sample, the saving, and the output movement the predictor causes (relRMS, max abs).
//   bun docs/spikes/hotfix-0.4.1/os-factor-join.ts off.json on.json
import { readFileSync } from "node:fs";
type Row = { packet: string; os: number; itPerHost: number; seeds: number; ones: number; nonConverged: number; output: number[] };
const [pa, pb] = process.argv.slice(2) as [string, string];
const A = JSON.parse(readFileSync(pa, "utf8")) as Row[];
const B = JSON.parse(readFileSync(pb, "utf8")) as Row[];
console.log("packet     os | it/host OFF -> ON (saving)  | seeds ON | one-it ON | NC off/on | output movement ON vs OFF: relRMS, max abs");
for (const a of A) {
	const b = B.find((r) => r.packet === a.packet && r.os === a.os);
	if (b === undefined) continue;
	let d2 = 0, r2 = 0, mx = 0;
	for (let i = 0; i < a.output.length; i += 1) {
		const x = a.output[i] as number, y = b.output[i] as number;
		d2 += (x - y) ** 2; r2 += x * x; mx = Math.max(mx, Math.abs(x - y));
	}
	const saving = (100 * (b.itPerHost / a.itPerHost - 1)).toFixed(1);
	console.log(`${a.packet.padEnd(9)} ${String(a.os).padStart(3)} | ${a.itPerHost.toFixed(3)} -> ${b.itPerHost.toFixed(3)} (${saving}%) | ${b.seeds} | ${b.ones} | ${a.nonConverged}/${b.nonConverged} | ${Math.sqrt(d2 / Math.max(r2, 1e-300)).toExponential(2)}, ${mx.toExponential(2)}`);
}

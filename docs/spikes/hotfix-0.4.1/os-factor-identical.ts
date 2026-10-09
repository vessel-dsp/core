// Exact comparison of two os-factor-probe.ts outputs (e.g. the 0.4.0 tree and the 0.4.1 tree at every factor above 1):
// iterations per host sample, seeds, one-iteration solves and every output sample must be equal.
//   bun docs/spikes/hotfix-0.4.1/os-factor-identical.ts a.json b.json
import { readFileSync } from "node:fs";
type Row = { packet: string; os: number; itPerHost: number; seeds: number; ones: number; nonConverged: number; output: number[] };
const [pa, pb] = process.argv.slice(2) as [string, string];
const A = JSON.parse(readFileSync(pa, "utf8")) as Row[];
const B = JSON.parse(readFileSync(pb, "utf8")) as Row[];
let identical = 0;
for (const a of A) {
	const b = B.find((r) => r.packet === a.packet && r.os === a.os);
	if (b === undefined) { console.log(`${a.packet} os${a.os}: missing in B`); continue; }
	const same = a.itPerHost === b.itPerHost && a.seeds === b.seeds && a.ones === b.ones && a.nonConverged === b.nonConverged && a.output.length === b.output.length && a.output.every((x, i) => Object.is(x, b.output[i]));
	console.log(`${a.packet.padEnd(8)} os${a.os}: ${same ? "identical (it/host, seeds, one-iteration, non-converged, every output sample)" : "DIFFERENT"}`);
	if (same) identical += 1;
}
console.log(`${identical} of ${A.length} rows identical`);

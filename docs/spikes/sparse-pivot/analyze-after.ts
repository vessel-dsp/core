// Before/after analysis for the numeric-pivoting report: joins baseline and
// after jsonl rows per packet and prints the acceptance tables (agreement,
// convergence, solver-plan deltas, timing). Run after both sweeps complete.
//
// Usage:
//   bun docs/spikes/sparse-pivot/analyze-after.ts [--amps]
import { readFileSync } from "node:fs";

const AMPS = process.argv.includes("--amps");
const tag = AMPS ? "amps" : "pedals";
const before = new Map(
	readFileSync(`docs/spikes/sparse-pivot/baseline-${tag}.jsonl`, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const r = JSON.parse(l);
			return [r.packet, r];
		}),
);
const after = new Map(
	readFileSync(`docs/spikes/sparse-pivot/after-${tag}.jsonl`, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const r = JSON.parse(l);
			return [r.packet, r];
		}),
);

const fmt = (v: number | null): string =>
	v === null || v === undefined ? "n/a" : v.toExponential(1);
console.log(`packet n(audio) | relRms before -> after | sNC dNC wNC | sMean | xRT | fb | drop repiv aband`);
const worsened: string[] = [];
const improved: string[] = [];
for (const [packet, b] of [...before.entries()].sort()) {
	const a = after.get(packet) as any;
	if (a === undefined) {
		console.log(`${packet}: MISSING after row`);
		continue;
	}
	const br = b.relRms as number | null;
	const ar = a.relRms as number | null;
	const flag =
		br !== null && ar !== null && ar > Math.max(br * 10, 1e-9) && ar > 1e-9 ? " WORSE" : "";
	const gain =
		br !== null && ar !== null && br > 1e-9 && ar <= 1e-9 ? " FIXED" : "";
	if (flag !== "") worsened.push(packet);
	if (gain !== "") improved.push(packet);
	const sizes = (a.blocks ?? []).filter((x: any) => x.path === "sparse").map((x: any) => x.size);
	console.log(
		`${packet} n=${Math.max(0, ...sizes)} | ${fmt(br)} -> ${fmt(ar)}${flag}${gain} ` +
			`| sNC ${b.sparseNonConverged}->${a.sparseNonConverged} dNC ${b.denseNonConverged}->${a.denseNonConverged} ` +
			`wNC ${b.sparseWarmNonConverged}/${b.denseWarmNonConverged}->${a.sparseWarmNonConverged}/${a.denseWarmNonConverged} ` +
			`| mean ${b.sparseMeanIter.toFixed(1)}->${a.sparseMeanIter.toFixed(1)} ` +
			`| xRT ${(b.sparseNsPerSample / 20833).toFixed(2)}->${(a.sparseNsPerSample / 20833).toFixed(2)} ` +
			`| fb ${b.scheduleFallbacks}->${a.scheduleFallbacks} ` +
			`| drop [${b.dropped}]->[${a.dropped}] repiv [${b.repivoted}]->[${a.repivoted}] aband [${b.abandoned}]->[${a.abandoned}]`,
	);
}
console.log(`\nworsened: [${worsened.join(" ")}]`);
console.log(`fixed-to-bar: [${improved.join(" ")}]`);
const over = (m: Map<string, any>): number =>
	[...m.values()].filter((r) => r.relRms !== null && r.relRms > 1e-9).length;
console.log(`mismatched(>1e-9): before=${over(before)} after=${over(after)}`);

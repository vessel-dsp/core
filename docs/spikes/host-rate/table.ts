// Check 6: THE TABLE FOR THE OWNER, assembled from the logs (nothing typed in by hand).
//
//   bun docs/spikes/host-rate/table.ts --data=<dir with accuracy-*.jsonl natives-*.json latency.json cost-wasm.jsonl blocks-wasm.jsonl live.jsonl ...>
//
// One row per arm. Every cell is MEASURED unless the column header says (arithmetic). Accuracy is the WASM console's (the TS console agrees to 0.0000 dB
// wherever both ran); the reference columns are native `ChainRuntime` renders. Dominance (end of the output) is computed, not judged, on the columns and
// tolerances printed there.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ARMS, arg, db, readJsonl } from "./lib";

const dir = arg("data", process.cwd());
const PEDALS = ["muff", "sd1", "ts9"];
type Acc = { pedal: string; arm: string; hz: number; console: string; fundV: number };
const acc: Acc[] = readdirSync(dir).filter((f) => /^accuracy-.*\.jsonl$/.test(f)).sort().flatMap((f) => readJsonl<Acc>(`${dir}/${f}`));
const natives: Record<string, Record<string, number>> = {};
for (const p of PEDALS) natives[p] = existsSync(`${dir}/natives-${p}.json`) ? JSON.parse(readFileSync(`${dir}/natives-${p}.json`, "utf8")) : {};
const nat = (p: string, hz: number, r: number): number | null => natives[p]?.[`${p}|${hz}|10|${r}`] ?? null;
const got = (p: string, arm: string, hz: number): number | null => acc.find((r) => r.pedal === p && r.arm === arm && r.hz === hz && r.console === "wasm")?.fundV ?? null;
const dbVs = (p: string, arm: string, hz: number, rate: number): number | null => {
	const a = got(p, arm, hz);
	const n = nat(p, hz, rate);
	return a === null || n === null ? null : db(a / n);
};
const read = <T>(f: string): T[] => readJsonl<T>(`${dir}/${f}`);
const lat: any[] = existsSync(`${dir}/latency.json`) ? JSON.parse(readFileSync(`${dir}/latency.json`, "utf8")) : [];
const cost = read<any>("cost-wasm.jsonl");
const blocks = read<any>("blocks-wasm.jsonl");
const live = read<any>("live.jsonl");
const f = (v: number | null | undefined, d = 2, sign = false): string => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${sign && v >= 0 ? "+" : ""}${v.toFixed(d)}`);
const lines: string[] = [];
const P = (s = ""): void => {
	lines.push(s);
	console.log(s);
};

const perSlotMs = (a: (typeof ARMS)[number]): number => {
	const r = lat.find((x) => x.slots === 1 && x.host === a.host && x.factor === a.factor && x.console === "wasm");
	return a.factor === 1 ? 0 : r === undefined ? Number.NaN : r.msMeasured;
};
const chainMs = (a: (typeof ARMS)[number]): number => {
	const r = lat.find((x) => x.slots === 3 && x.host === a.host && x.factor === a.factor && x.console === "wasm");
	return a.factor === 1 ? 0 : r === undefined ? Number.NaN : r.msMeasured;
};
const costOf = (subject: string, arm: string) => cost.find((r) => r.subject === subject && r.arm === arm && r.console === "wasm" && !r.skipped);
const blockOf = (subject: string, arm: string) => blocks.find((r) => r.subject === subject && r.arm === arm && r.console === "wasm" && !r.skipped);

P("## accuracy: dB of the WASM-console worklet over native (0 = match). Own = the native render at the arm's internal rate; 192k and 768k = native renders at those rates");
P("| arm | internal | " + PEDALS.map((p) => `${p} 8k own / 192k / 768k`).join(" | ") + " |");
P("|---|---|" + PEDALS.map(() => "---").join("|") + "|");
for (const a of ARMS) P(`| ${a.name} | ${a.internal / 1000}k | ${PEDALS.map((p) => `${f(dbVs(p, a.name, 8000, a.internal), 3, true)} / ${f(dbVs(p, a.name, 8000, 192000), 3, true)} / ${f(dbVs(p, a.name, 8000, 768000), 3, true)}`).join(" | ")} |`);
P("");
P("| arm | internal | " + PEDALS.map((p) => `${p} 16k own / 192k / 768k`).join(" | ") + " |");
P("|---|---|" + PEDALS.map(() => "---").join("|") + "|");
for (const a of ARMS) P(`| ${a.name} | ${a.internal / 1000}k | ${PEDALS.map((p) => `${f(dbVs(p, a.name, 16000, a.internal), 3, true)} / ${f(dbVs(p, a.name, 16000, 192000), 3, true)} / ${f(dbVs(p, a.name, 16000, 768000), 3, true)}`).join(" | ")} |`);

P("\n## the owner table (WASM console; box load and the timing caveats are in the note)");
P("| arm (host x factor) | internal | engine latency ms/slot | 3-pedal chain engine latency ms | quantum 128/H ms (arithmetic) | cost xRT muff / sd1 / ts9 / chain3 | mean block / deadline % muff / sd1 / ts9 / chain3 | p99 block / deadline % muff / sd1 / ts9 / chain3 | blocks over the deadline % muff / sd1 / ts9 / chain3 | STALLs | live ctx rtf sd1 / chain3 | NAM / IR |");
P("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const a of ARMS) {
	const xrt = ["muff", "sd1", "ts9", "chain3"].map((s) => f(costOf(s, a.name)?.xrtSteady, 2));
	const mean = ["muff", "sd1", "ts9", "chain3"].map((s) => f(blockOf(s, a.name) === undefined ? null : blockOf(s, a.name).meanFrac * 100, 0));
	const p99 = ["muff", "sd1", "ts9", "chain3"].map((s) => f(blockOf(s, a.name) === undefined ? null : blockOf(s, a.name).p99Frac * 100, 0));
	const overs = ["muff", "sd1", "ts9", "chain3"].map((x) => {
		const b = blockOf(x, a.name);
		return b === undefined ? "n/a" : f((100 * b.overDeadline) / b.blocks, b.overDeadline === 0 ? 0 : 1);
	});
	const nam = a.host === 48000 ? "48 kHz NAM / IR as today" : "NAM stating 48 kHz REFUSED; no-rate NAM and undeclared IR silently WRONG";
	const stalls = blocks.filter((r) => r.arm === a.name && r.stalls > 0).length;
	const lv = (s: string) => live.find((r) => r.part === 2 && r.subject === s && r.arm === a.name);
	P(
		`| ${a.name} | ${a.internal / 1000}k | ${f(perSlotMs(a), 4)} | ${f(chainMs(a), 4)} | ${((128 / a.host) * 1000).toFixed(3)} | ${xrt.join(" / ")} | ${mean.join(" / ")} | ${p99.join(" / ")} | ${overs.join(" / ")} | ${stalls} | ${f(lv("sd1")?.rtf, 3)} / ${f(lv("chain3")?.rtf, 3)} | ${nam} |`,
	);
}

// ---- dominance, computed -------------------------------------------------------------------------------------------------------------
P("\n## dominance (computed, not judged): arm A dominates arm B if A is no worse than B on EVERY column and strictly better on at least one, within the tolerances");
P("columns (all lower-is-better): |error vs native 768k| in dB at 8k and 16k for the three pedals (tolerance 0.02 dB; 20 kHz excluded); 3-pedal chain engine latency ms (0.001); quantum ms (0.0001);");
P("mean block / deadline for muff, sd1, ts9, chain3 (tolerance 10 % relative); p99 block / deadline for muff, sd1, ts9, chain3 (tolerance 20 % relative: one run per cell, the p99 of a 48 kHz cell rests on 22 blocks).");
type Vec = { name: string; v: (number | null)[] };
const SUBJ = ["muff", "sd1", "ts9", "chain3"];
const vecs: Vec[] = ARMS.map((a) => ({
	name: a.name,
	v: [
		...PEDALS.flatMap((p) => [8000, 16000].map((hz) => dbVs(p, a.name, hz, 768000))).map((x) => (x === null ? null : Math.abs(x))),
		chainMs(a),
		(128 / a.host) * 1000,
		...SUBJ.map((s) => blockOf(s, a.name)?.meanFrac ?? null),
		...SUBJ.map((s) => blockOf(s, a.name)?.p99Frac ?? null),
	],
}));
const names = [..."abcdef"].map((_, i) => `acc${i}`).concat(["latency", "quantum"], SUBJ.map((s) => `mean ${s}`), SUBJ.map((s) => `p99 ${s}`));
const tol = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.001, 0.0001, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2];
const kinds = tol.map((_, i) => (i < 8 ? "abs" : "rel"));
const present = vecs[0]!.v.map((_, i) => vecs.every((x) => x.v[i] !== null && Number.isFinite(x.v[i] as number)));
const rel = (a: number, b: number, i: number): "less" | "equal" | "more" => {
	const t = kinds[i] === "rel" ? tol[i]! * Math.max(Math.abs(a), Math.abs(b)) : tol[i]!;
	return a < b - t ? "less" : a > b + t ? "more" : "equal";
};
const view = (title: string, use: (i: number) => boolean): void => {
	P(`\n### ${title}`);
	for (const b of vecs) {
		const by: string[] = [];
		const trade: string[] = [];
		for (const a of vecs) {
			if (a === b) continue;
			let worse = false;
			let strictly = false;
			const wins: string[] = [];
			const loses: string[] = [];
			for (let i = 0; i < tol.length; i += 1) {
				if (!present[i] || !use(i)) continue;
				const r = rel(a.v[i] as number, b.v[i] as number, i);
				if (r === "more") {
					worse = true;
					loses.push(names[i] as string);
				}
				if (r === "less") {
					strictly = true;
					wins.push(names[i] as string);
				}
			}
			if (!worse && strictly) by.push(a.name);
			void trade;
		}
		P(`  ${b.name.padEnd(8)} ${by.length > 0 ? `DOMINATED by ${by.join(", ")}` : "not dominated"}`);
	}
};
view("view 1: every column (accuracy, latency, quantum, mean and p99 block time for all four subjects)", () => true);
view("view 2: without the p99 columns (single-run tails) -- accuracy, latency, quantum, mean block time", (i) => i < 12);
P("\n### selected pairs, from view 1: A is better than B on the columns listed and worse on the others");
for (const [an, bn] of [["96k os2", "48k os4"], ["96k x1", "48k os2"], ["192k x1", "96k os2"], ["192k x1", "48k os4"], ["192k os2", "96k os4"]] as [string, string][]) {
	const a = vecs.find((x) => x.name === an)!;
	const b = vecs.find((x) => x.name === bn)!;
	const wins: string[] = [];
	const loses: string[] = [];
	for (let i = 0; i < tol.length; i += 1) {
		if (!present[i]) continue;
		const r = rel(a.v[i] as number, b.v[i] as number, i);
		if (r === "less") wins.push(`${names[i]} ${f(a.v[i] as number, i < 6 ? 3 : i === 6 || i === 7 ? 4 : 2)} vs ${f(b.v[i] as number, i < 6 ? 3 : i === 6 || i === 7 ? 4 : 2)}`);
		if (r === "more") loses.push(`${names[i]} ${f(a.v[i] as number, i < 6 ? 3 : i === 6 || i === 7 ? 4 : 2)} vs ${f(b.v[i] as number, i < 6 ? 3 : i === 6 || i === 7 ? 4 : 2)}`);
	}
	P(`  ${an} against ${bn}: better on [${wins.join("; ")}]; worse on [${loses.join("; ")}]`);
}
P(`columns present for every arm: ${present.map((c, i) => (c ? names[i] : null)).filter((x) => x !== null).join(", ")}`);
const dest = arg("out", "");
if (dest !== "") await Bun.write(dest, `${lines.join("\n")}\n`);

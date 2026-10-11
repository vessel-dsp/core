// Check 4 (tables): the per-block deadline margin, the steady-state cost, the cross-check between the two instruments, the equal-internal-rate
// ratios (P4) and the prediction scoring (P5).
//
//   bun docs/spikes/host-rate/timing-report.ts --data=<dir with blocks-*.jsonl cost-*.jsonl iterations.json> [--out=<md>]
import { existsSync, readFileSync } from "node:fs";
import { ARMS, arg, readJsonl } from "./lib";

const dir = arg("data", process.cwd());
const lines: string[] = [];
const P = (s = ""): void => {
	lines.push(s);
	console.log(s);
};
const SUBJECTS = ["divider", "muff", "sd1", "ts9", "chain3"];
const f = (v: number | null | undefined, d = 0): string => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(d));
for (const consoleName of ["wasm", "ts"]) {
	const blocks = readJsonl<any>(`${dir}/blocks-${consoleName}.jsonl`);
	const cost = readJsonl<any>(`${dir}/cost-${consoleName}.jsonl`);
	if (blocks.length === 0 && cost.length === 0) continue;
	P(`\n# console ${consoleName}`);
	P(`\n## per-block wall time in 128-frame blocks (percent of the deadline 128/H: 2.667 / 1.333 / 0.667 ms); one row per subject and arm`);
	P(`| subject | arm | internal | deadline ms | mean % | p50 % | p99 % | p99.9 % | max % | blocks over the deadline | STALLs (>8 s) | load before -> after | waited s |`);
	P(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
	for (const s of SUBJECTS) {
		for (const a of ARMS) {
			const r = blocks.find((x) => x.subject === s && x.arm === a.name);
			if (r === undefined) continue;
			if (r.skipped) {
				P(`| ${s} | ${a.name} | ${a.internal / 1000}k | ${((128 / a.host) * 1000).toFixed(3)} | not run: ${r.skipped} | | | | | | | | |`);
				continue;
			}
			P(`| ${s} | ${a.name} | ${a.internal / 1000}k | ${r.deadlineMs.toFixed(3)} | ${f(r.meanFrac * 100)} | ${f(r.p50Frac * 100)} | ${f(r.p99Frac * 100)} | ${f(r.p999Frac * 100)} | ${f(r.maxFrac * 100)} | ${r.overDeadline}/${r.blocks} | ${r.stalls} | ${r.loadBefore.toFixed(2)} -> ${r.loadAfter.toFixed(2)}${r.atBar ? "" : " (above the bar)"} | ${r.waitedS} |`);
		}
	}
	P(`\n## steady-state cost: audio seconds per wall second (xRT, subtraction of a short and a long render) and the worklet's own telemetry`);
	P(`| subject | arm | xRT steady | xRT whole render | worklet mean cpuLoad % (Date.now clock, whole ms) | overruns / quanta | cross-check 100 / xRT (%) vs per-block mean % | load before -> after |`);
	P(`|---|---|---|---|---|---|---|---|`);
	for (const s of SUBJECTS) {
		for (const a of ARMS) {
			const r = cost.find((x) => x.subject === s && x.arm === a.name);
			if (r === undefined) continue;
			if (r.skipped) {
				P(`| ${s} | ${a.name} | not run: ${r.skipped} | | | | | |`);
				continue;
			}
			const b = blocks.find((x) => x.subject === s && x.arm === a.name && !x.skipped);
			P(`| ${s} | ${a.name} | ${f(r.xrtSteady, 3)} | ${f(r.xrtWhole, 3)} | ${f(r.cpuLoadMeanPct, 1)} | ${r.overruns}/${r.quanta} | ${f(100 / r.xrtSteady, 0)} vs ${b === undefined ? "n/a" : f(b.meanFrac * 100, 0)} | ${r.loadBefore.toFixed(2)} -> ${r.loadAfter.toFixed(2)}${r.atBar ? "" : " (above the bar)"} |`);
		}
	}
	if (consoleName !== "wasm") continue;
	// ---- P4 ratios --------------------------------------------------------------------------------------------------------------------
	const xrt = (s: string, arm: string): number | null => cost.find((x) => x.subject === s && x.arm === arm && !x.skipped)?.xrtSteady ?? null;
	const mean = (s: string, arm: string): number | null => blocks.find((x) => x.subject === s && x.arm === arm && !x.skipped)?.meanFrac ?? null;
	P(`\n## P4: cost per audio second at equal internal rate. cost ratio A/B = xRT(B) / xRT(A) (steady cost) and mean-block(A) x H_A / (mean-block(B) x H_B)... reported both ways`);
	P(`| subject | 96k os2 / 48k os4 (xRT) | (block mean) | 192k x1 / 48k os4 (xRT) | (block mean) | 96k x1 / 48k os2 (xRT) | (block mean) | 192k os2 / 96k os4 (xRT) | (block mean) |`);
	P(`|---|---|---|---|---|---|---|---|---|`);
	for (const s of SUBJECTS) {
		const r = (a: string, b: string) => {
			const x1 = xrt(s, a);
			const x2 = xrt(s, b);
			const m1 = mean(s, a);
			const m2 = mean(s, b);
			return [x1 !== null && x2 !== null ? (x2 / x1).toFixed(2) : "n/a", m1 !== null && m2 !== null ? (m1 / m2).toFixed(2) : "n/a"];
		};
		P(`| ${s} | ${r("96k os2", "48k os4").join(" | ")} | ${r("192k x1", "48k os4").join(" | ")} | ${r("96k x1", "48k os2").join(" | ")} | ${r("192k os2", "96k os4").join(" | ")} |`);
	}
	// ---- P5 scoring --------------------------------------------------------------------------------------------------------------------
	P(`\n## P5 scored: the frozen prediction (mean (p99), percent of deadline) against the measurement`);
	const pred: Record<string, Record<string, [number, number]>> = {
		"48k x1": { muff: [46, 68], sd1: [61, 91], ts9: [28, 41], chain3: [134, 201] },
		"48k os2": { muff: [69, 103], sd1: [93, 139], ts9: [48, 72], chain3: [210, 315] },
		"48k os4": { muff: [96, 144], sd1: [122, 183], ts9: [65, 98], chain3: [283, 425] },
		"96k x1": { muff: [79, 142], sd1: [103, 186], ts9: [59, 107], chain3: [241, 434] },
		"96k os2": { muff: [96, 173], sd1: [122, 219], ts9: [65, 118], chain3: [283, 509] },
		"96k os4": { muff: [192, 346], sd1: [243, 438], ts9: [131, 235], chain3: [566, 1019] },
		"192k x1": { muff: [157, 378], sd1: [206, 495], ts9: [119, 285], chain3: [482, 1158] },
		"192k os2": { muff: [192, 461], sd1: [243, 584], ts9: [131, 313], chain3: [566, 1358] },
	};
	P(`| arm | muff mean: pred / meas | sd1 mean | ts9 mean | chain3 mean | muff p99: pred / meas | sd1 p99 | ts9 p99 | chain3 p99 |`);
	P(`|---|---|---|---|---|---|---|---|---|`);
	let meanWithin = 0;
	let meanTotal = 0;
	let classRight = 0;
	let classTotal = 0;
	for (const a of ARMS) {
		const cells: string[] = [];
		const cellsP: string[] = [];
		for (const s of ["muff", "sd1", "ts9", "chain3"]) {
			const b = blocks.find((x) => x.subject === s && x.arm === a.name && !x.skipped);
			const p = pred[a.name]?.[s];
			if (b === undefined || p === undefined) {
				cells.push("n/a");
				cellsP.push("n/a");
				continue;
			}
			const m = b.meanFrac * 100;
			const q = b.p99Frac * 100;
			cells.push(`${p[0]} / ${m.toFixed(0)}`);
			cellsP.push(`${p[1]} / ${q.toFixed(0)}`);
			meanTotal += 1;
			if (Math.abs(m - p[0]) <= 0.25 * p[0]) meanWithin += 1;
			// classification: under 50 %, under 100 % of the deadline at p99
			for (const bar of [50, 100]) {
				classTotal += 1;
				if (p[1] < bar === q < bar) classRight += 1;
			}
		}
		P(`| ${a.name} | ${cells.join(" | ")} | ${cellsP.join(" | ")} |`);
	}
	P(`\nmean within +-25 % of the prediction: ${meanWithin} of ${meanTotal}; p99 classification (under 50 % / under 100 % of the deadline) right: ${classRight} of ${classTotal}`);
}
if (existsSync(`${dir}/iterations.json`)) {
	P("\n# iterations per internal sample (WASM; TS reads the same)");
	const rows = JSON.parse(readFileSync(`${dir}/iterations.json`, "utf8")) as any[];
	for (const amp of [0.01, 0.1]) {
		P(`\n${amp} V, 1 kHz: it/internal sample, then Newton start-predictor seeds per internal sample`);
		P(`| pedal | ${ARMS.map((a) => a.name).join(" | ")} |`);
		P(`|---|${ARMS.map(() => "---").join("|")}|`);
		for (const p of ["muff", "sd1", "ts9"]) {
			const cell = (a: string) => {
				const r = rows.find((x) => x.pedal === p && x.amp === amp && x.arm === a && x.console === "wasm");
				return r === undefined ? "-" : `${r.itPerInternal.toFixed(3)} (${r.predictorSeedsPerInternal.toFixed(2)})`;
			};
			P(`| ${p} | ${ARMS.map((a) => cell(a.name)).join(" | ")} |`);
		}
	}
}
const dest = arg("out", "");
if (dest !== "") await Bun.write(dest, `${lines.join("\n")}\n`);

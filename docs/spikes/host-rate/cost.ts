// Check 4a: COST, from the worklet's own telemetry and from wall clock, every arm.
//
//   NODE_PATH=<workbench>/node_modules bun docs/spikes/host-rate/cost.ts --consoles=wasm --out=<jsonl> [--arms=all]
//       [--subjects=divider,muff,sd1,ts9,chain3] [--short=2] [--long=6] [--maxload=1.5]
//
// Per arm x subject x console: two offline renders of 1 kHz at 0.1 V (phase-1 `cost.ts`'s stimulus), `--short` and `--long` seconds long. The
// steady-state cost in audio seconds per wall second (xRT) is a SUBTRACTION, as in the workbench scoreboard:
//     xRT = (long - short) / (wall(long) - wall(short))
// (the shared prefix, which carries instantiation, the JIT and the settling transient, cancels). Beside it: the worklet telemetry of the long render
// (`cpuLoadPercent`, mean over windows after the first, `cpuP95Percent`, `cpuPeakPercent`, `overrunCount`; the worklet's clock in its scope is
// Date.now(), whole milliseconds, so only the MEAN is unbiased -- the per-block distribution is `blocks.ts`).
// BEFORE EACH SUBJECT the 1-minute load average is read from /proc/loadavg and printed; the run waits (10 s polls, one 20-minute budget for the series)
// for it to fall below --maxload, then proceeds and RECORDS the reading it proceeded at and the reading after.
// WHAT THIS IS NOT: an OfflineAudioContext renders as fast as the CPU allows. It is not a real-time audio thread.
import { arg, defaultBundle, defaultWasm, jsonl, load1, openHarness, readJsonl, selectArms, ts, waitIdle } from "./lib";
import { SUBJECTS } from "./subjects";

const out = arg("out", "");
if (out === "") throw new Error("--out=<jsonl> is required");
const arms = selectArms(arg("arms", "all"));
const subjects = arg("subjects", "divider,muff,sd1,ts9,chain3").split(",");
const consoles = arg("consoles", "wasm").split(",");
const shortS = Number(arg("short", "2"));
const longS = Number(arg("long", "6"));
const maxLoad = Number(arg("maxload", "1.5"));
const skipChainTsAbove = Number(arg("ts-chain-max-internal", "192000"));
const done = new Set(readJsonl<{ key: string }>(out).map((r) => r.key));
const harness = await openHarness({ bundle: arg("bundle", defaultBundle()), wasm: arg("wasm", defaultWasm()), port: Number(arg("port", "8741")) });
console.log(`cost: ${ts()} ${harness.version} bundle ${harness.bundleSha.slice(0, 12)} wasm ${harness.wasmSha.slice(0, 12)} short ${shortS} s long ${longS} s, 1 kHz 0.1 V, quantum 128`);
try {
	for (const consoleName of consoles) {
		for (const subjectName of subjects) {
			const subject = (SUBJECTS[subjectName] as () => ReturnType<(typeof SUBJECTS)[string]>)();
			for (const arm of arms) {
				const key = `${consoleName}|${subjectName}|${arm.name}`;
				if (done.has(key)) continue;
				if (consoleName === "ts" && subjectName === "chain3" && arm.internal > skipChainTsAbove) {
					jsonl(out, { key, console: consoleName, subject: subjectName, arm: arm.name, skipped: `TS chain at ${arm.internal / 1000}k internal not run (time)` });
					continue;
				}
				const sec = consoleName === "ts" ? [Math.min(shortS, 1), Math.min(longS, 2.5)] : [shortS, longS];
				const gate = await waitIdle(maxLoad);
				const upt = `${new Date().toISOString().slice(11, 19)} load ${gate.before.toFixed(2)}`;
				const renderOf = async (seconds: number) => {
					const job: Parameters<typeof harness.render>[0] = {
						slots: subject.slots, wasm: consoleName === "wasm", hostRate: arm.host, controls: subject.controls,
						input: { kind: "sine", hz: 1000, amp: 0.1 }, samples: Math.round(arm.host * seconds),
					};
					if (arm.factor !== 1) (job as { oversample?: unknown }).oversample = arm.factor;
					const r = await harness.render(job);
					if (r.errors.length > 0) throw new Error(`${key}: ${r.errors.join("; ")}`);
					return r;
				};
				const a = await renderOf(sec[0] as number);
				const b = await renderOf(sec[1] as number);
				const after = load1();
				const xrt = ((sec[1] as number) - (sec[0] as number)) / (((b.renderMs as number) - (a.renderMs as number)) / 1000);
				const wholeXrt = (sec[1] as number) / ((b.renderMs as number) / 1000);
				const t = b.telemetry.slice(1);
				const mean = (k: string) => t.reduce((s: number, m: any) => s + ((m[k] as number) ?? 0), 0) / Math.max(1, t.length);
				const mx = (k: string) => t.reduce((s: number, m: any) => Math.max(s, (m[k] as number) ?? 0), 0);
				const last = b.telemetry[b.telemetry.length - 1] ?? {};
				const row = {
					key, console: consoleName, subject: subjectName, arm: arm.name, host: arm.host, factor: arm.factor, internal: arm.internal,
					secondsShort: sec[0], secondsLong: sec[1], wallShortMs: Math.round(a.renderMs), wallLongMs: Math.round(b.renderMs),
					xrtSteady: xrt, xrtWhole: wholeXrt, cpuLoadMeanPct: mean("cpuLoadPercent"), cpuP95MaxPct: mx("cpuP95Percent"), cpuPeakMaxPct: mx("cpuPeakPercent"),
					overruns: last.overrunCount, quanta: Math.round(((sec[1] as number) * arm.host) / 128), windows: t.length,
					loadBefore: gate.before, loadAfter: after, waitedS: gate.waitedS, atBar: gate.atBar, startedAt: upt,
				};
				jsonl(out, row);
				console.log(
					`${consoleName.padEnd(4)} ${subjectName.padEnd(7)} ${arm.name.padEnd(8)} xRT ${xrt.toFixed(3).padStart(7)} (whole ${wholeXrt.toFixed(3)}) cpuLoad ${row.cpuLoadMeanPct.toFixed(1).padStart(6)} % overruns ${row.overruns}/${row.quanta} load ${gate.before.toFixed(2)}${gate.atBar ? "" : " (ABOVE the bar after the wait budget)"} -> ${after.toFixed(2)} waited ${gate.waitedS} s`,
				);
			}
		}
	}
} finally {
	await harness.close();
}
console.log(`cost: done ${ts()}`);

// Check 4b: DEADLINE MARGIN, per-block wall time in 128-frame blocks against the deadline 128 / host rate.
//
//   NODE_PATH=<workbench>/node_modules bun docs/spikes/host-rate/blocks.ts --consoles=wasm --out=<jsonl> [--arms=all]
//       [--subjects=divider,muff,sd1,ts9,chain3] [--seconds=6] [--warmup=1] [--maxload=1.5]
//
// The REAL worklet bundle (`v2-audio-worklet.js`) is evaluated on the page's main thread behind a stub AudioWorkletGlobalScope and its `process()` is
// called once per 128-frame block with `performance.now()` around it (cross-origin isolated: 5 us resolution; the page prints the measured step).
// Recorded per arm x subject x console: mean, p50, p99, p99.9 and max block time, the deadline 128/H, and each as a fraction of it; blocks over
// the deadline; a STALL is a block over 8 s. Idle gate as in cost.ts (load before every run, printed and recorded).
// WHAT THIS IS NOT: a main-thread loop calling process() back to back. There is no output device, no audio-thread priority and no scheduler
// pressure from other audio work, so a block time under the deadline is NECESSARY, NOT SUFFICIENT; it is not a real-time audio thread.
import { arg, defaultBundle, defaultWasm, jsonl, load1, openHarness, readJsonl, selectArms, stats, ts, waitIdle } from "./lib";
import { SUBJECTS } from "./subjects";

const out = arg("out", "");
if (out === "") throw new Error("--out=<jsonl> is required");
const arms = selectArms(arg("arms", "all"));
const subjects = arg("subjects", "divider,muff,sd1,ts9,chain3").split(",");
const consoles = arg("consoles", "wasm").split(",");
const seconds = Number(arg("seconds", "6"));
const warmup = Number(arg("warmup", "1"));
const maxLoad = Number(arg("maxload", "1.5"));
const tsMaxInternal = Number(arg("ts-max-internal", "384000"));
const done = new Set(readJsonl<{ key: string }>(out).map((r) => r.key));
const harness = await openHarness({ bundle: arg("bundle", defaultBundle()), wasm: arg("wasm", defaultWasm()), port: Number(arg("port", "8751")) });
console.log(`blocks: ${ts()} ${harness.version} bundle ${harness.bundleSha.slice(0, 12)} wasm ${harness.wasmSha.slice(0, 12)} ${seconds} s measured after ${warmup} s warm-up, 1 kHz 0.1 V`);
try {
	for (const consoleName of consoles) {
		for (const subjectName of subjects) {
			const subject = (SUBJECTS[subjectName] as () => ReturnType<(typeof SUBJECTS)[string]>)();
			for (const arm of arms) {
				const key = `${consoleName}|${subjectName}|${arm.name}`;
				if (done.has(key)) continue;
				const sec = consoleName === "ts" ? Math.min(seconds, 2) : seconds;
				const wup = consoleName === "ts" ? Math.min(warmup, 0.5) : warmup;
				if (consoleName === "ts" && (arm.internal > tsMaxInternal || (subjectName === "chain3" && arm.internal > 192000))) {
					jsonl(out, { key, console: consoleName, subject: subjectName, arm: arm.name, skipped: "TS console not run at this internal rate / subject (time)" });
					continue;
				}
				const gate = await waitIdle(maxLoad);
				const blocksPerSecond = arm.host / 128;
				const job = {
					slots: subject.slots, wasm: consoleName === "wasm", hostRate: arm.host, controls: subject.controls,
					input: { kind: "sine" as const, hz: 1000, amp: 0.1 }, warmupBlocks: Math.round(wup * blocksPerSecond), blocks: Math.round(sec * blocksPerSecond),
				};
				if (arm.factor !== 1) (job as { oversample?: unknown }).oversample = arm.factor;
				const r = await harness.blocks(job);
				const after = load1();
				if (r.errors.length > 0) throw new Error(`${key}: ${r.errors.join("; ")}`);
				const deadlineMs = (128 / arm.host) * 1000;
				const s = stats(r.times);
				const over = r.times.filter((t) => t > deadlineMs).length;
				const stall = r.times.filter((t) => t > 8000).length;
				const row = {
					key, console: consoleName, subject: subjectName, arm: arm.name, host: arm.host, factor: arm.factor, internal: arm.internal,
					blocks: s.n, deadlineMs, meanMs: s.mean, p50Ms: s.p50, p99Ms: s.p99, p999Ms: s.p999, maxMs: s.max,
					meanFrac: s.mean / deadlineMs, p50Frac: s.p50 / deadlineMs, p99Frac: s.p99 / deadlineMs, p999Frac: s.p999 / deadlineMs, maxFrac: s.max / deadlineMs,
					overDeadline: over, stalls: stall, timerResolutionUs: r.timerResolutionUs, crossOriginIsolated: r.crossOriginIsolated, lastBlockPeak: r.lastBlockPeak,
					loadBefore: gate.before, loadAfter: after, waitedS: gate.waitedS, atBar: gate.atBar,
				};
				jsonl(out, row);
				console.log(
					`${consoleName.padEnd(4)} ${subjectName.padEnd(7)} ${arm.name.padEnd(8)} deadline ${deadlineMs.toFixed(3)} ms: mean ${(row.meanFrac * 100).toFixed(0).padStart(4)} %  p50 ${(row.p50Frac * 100).toFixed(0).padStart(4)} %  p99 ${(row.p99Frac * 100).toFixed(0).padStart(4)} %  p99.9 ${(row.p999Frac * 100).toFixed(0).padStart(4)} %  max ${(row.maxFrac * 100).toFixed(0).padStart(5)} %  over ${over}/${s.n}${stall > 0 ? `  STALL x${stall}` : ""}  load ${gate.before.toFixed(2)}${gate.atBar ? "" : " (ABOVE bar)"} -> ${after.toFixed(2)}  timer ${r.timerResolutionUs.toFixed(1)} us, COI ${r.crossOriginIsolated}, peak ${r.lastBlockPeak.toExponential(2)}`,
				);
			}
		}
	}
} finally {
	await harness.close();
}
console.log(`blocks: done ${ts()}`);

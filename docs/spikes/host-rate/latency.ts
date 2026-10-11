// Check 3 (offline part): ENGINE LATENCY IN HOST SAMPLES AND MILLISECONDS, measured through the real worklet at every host rate.
//
//   NODE_PATH=<workbench>/node_modules bun docs/spikes/host-rate/latency.ts [--hosts=48000,96000,192000] [--factors=2,4] [--out=<json>]
//
// Method = phase 1's `ctl-c-latency.ts`, generalised to the host rate. The program is the linear resistor divider (gain 0.5, no reactive
// parts), so everything that moves the signal in time is the chain's own: the 10 Hz DC blocker (identical at every factor, so it cancels
// against the x1 render at the SAME host rate) and the resampler. Two instruments, both on both consoles, each read against the x1
// render of the same console and host rate:
//   * a swept-sine phase slope: multisine 100/200/300/500/800 Hz (whole periods in the window at every rate), least-squares phase,
//     delay(os) - delay(x1) per tone, in host samples;
//   * an impulse at host sample 1024: the index of the largest |sample| against the x1 render's, and against the input's index.
// Expectations are LITERALS (19.5 / 26.25 host samples per slot), not what the worklet reports; the ms column is samples / host rate.
// Then the same method on a chain of three dividers (slots stack), against `loaded.latencyHostSamples` and 3 x the literal; and the real
// three-pedal chain's `loaded.latencyHostSamples` readback (a readback, labelled as one: a nonlinear chain has no unambiguous phase slope).
import { writeFileSync } from "node:fs";
import { arg, controlMessages, defaultBundle, defaultWasm, f32, loadDivider, loadPedal, openHarness, phaseAt, ts } from "./lib";

const hosts = arg("hosts", "48000,96000,192000").split(",").map(Number);
const factors = arg("factors", "2,4").split(",").map(Number);
const out = arg("out", "");
const EXPECTED: Record<number, number> = { 2: 19.5, 4: 26.25, 8: 28.625 };
// One slot: 100..800 Hz (unambiguous below ~28.6 samples of delay, phase 1's bound). Three slots stack up to 78.75 samples, which wraps an 800 Hz tone
// (the first run of this script read 27.3 / 47.55 for 3 slots at 48 kHz: a phase wrap, logs/40-latency-run1-3slot-phase-wrap.log), so the chain uses 20..150 Hz
// and a 1.0 s window (whole periods of every tone): f x delay / H stays below a quarter cycle at every rate.
const TONES_FOR = (slotsN: number): number[] => (slotsN === 1 ? [100, 200, 300, 500, 800] : [20, 40, 60, 100, 150]);
const WINDOW_S = (slotsN: number): number => (slotsN === 1 ? 0.75 : 1.0);
const harness = await openHarness({ bundle: arg("bundle", defaultBundle()), wasm: arg("wasm", defaultWasm()), port: Number(arg("port", "8731")) });
const { json } = loadDivider();
const peakIndex = (samples: ArrayLike<number>): number => {
	let best = 0;
	for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i] as number) > Math.abs(samples[best] as number)) best = i;
	return best;
};
const rows: Record<string, unknown>[] = [];
let failed = false;
try {
	console.log(`latency: ${ts()} ${harness.version}, bundle ${harness.bundleSha.slice(0, 12)}`);
	for (const H of hosts) {
		const START = Math.round(0.25 * H);
		// Phases in radians (w x d, wrapped to (-pi, pi]); the DIFFERENCE of two phases is wrapped again before it is divided by w, because a tone
		// whose x1 phase sits near +-pi (the 10 Hz DC blocker leads a 20 Hz tone by ~27 degrees) can land on the other side of the wrap at os N
		// (the second run of this script read garbage for 3 slots for that reason: logs/40-latency-run2-3slot-phase-difference-wrap.log).
		const phases = (samples: ArrayLike<number>, slotsN: number): number[] =>
			TONES_FOR(slotsN).map((hz) => phaseAt(samples, H, hz, START, Math.round(hz * WINDOW_S(slotsN))).phase);
		const wrap = (x: number): number => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
		const delayDiff = (os: number[], base: number[], slotsN: number): number[] =>
			TONES_FOR(slotsN).map((hz, i) => wrap((os[i] as number) - (base[i] as number)) / ((2 * Math.PI * hz) / H));
		for (const consoleName of ["ts", "wasm"]) {
			const wasm = consoleName === "wasm";
			const run = async (slotsN: number, os: number | "default", input: Parameters<typeof harness.render>[0]["input"]) => {
				const job: Parameters<typeof harness.render>[0] = {
					slots: Array.from({ length: slotsN }, () => ({ kind: "program" as const, program: json })),
					wasm, hostRate: H, input, samples: Math.round((0.25 + WINDOW_S(slotsN) + 0.25) * H),
				};
				if (os !== "default") (job as { oversample?: unknown }).oversample = os;
				const r = await harness.render(job);
				if (r.errors.length > 0) throw new Error(r.errors.join("; "));
				return r;
			};
			const impulse = { kind: "impulse" as const, at: 1024, amp: 0.5 };
			for (const slotsN of [1, 3]) {
				const multi = { kind: "multisine" as const, tones: TONES_FOR(slotsN).map((hz) => ({ hz, amp: 0.04 })) };
				const base = await run(slotsN, "default", multi);
				const basePhases = phases(f32(base), slotsN);
				const baseImpulse = peakIndex(f32(await run(slotsN, "default", impulse)));
				for (const factor of factors) {
					const r = await run(slotsN, factor, multi);
					const loaded = r.loaded[0] as { latencyHostSamples: number; oversample: number; hostSampleRate: number };
					const d = delayDiff(phases(f32(r), slotsN), basePhases, slotsN);
					const mean = d.reduce((a, b) => a + b, 0) / d.length;
					const spread = Math.max(...d) - Math.min(...d);
					const peak = peakIndex(f32(await run(slotsN, factor, impulse))) - baseImpulse;
					const expected = (EXPECTED[factor] as number) * slotsN;
					const ok =
						loaded.latencyHostSamples === expected && loaded.oversample === factor && loaded.hostSampleRate === H &&
						Math.abs(mean - expected) < 0.05 && spread < 0.05 && Math.abs(peak - expected) <= 0.5 * slotsN + 0.5;
					if (!ok) failed = true;
					const row = {
						host: H, console: consoleName, slots: slotsN, factor, expectedSamples: expected, loadedSamples: loaded.latencyHostSamples,
						measuredSlope: mean, spread, impulseOffset: peak, impulseBaseIndexMinusInput: baseImpulse - 1024,
						msLoaded: (loaded.latencyHostSamples / H) * 1000, msMeasured: (mean / H) * 1000, ok,
					};
					rows.push(row);
					console.log(
						`${ok ? "PASS" : "FAIL"} ${String(H / 1000).padStart(3)}k ${consoleName.padEnd(4)} ${slotsN} slot${slotsN > 1 ? "s" : " "} os${factor}: expected ${expected} loaded ${loaded.latencyHostSamples} ` +
							`phase slope ${mean.toFixed(4)} (spread ${spread.toFixed(4)}) impulse +${peak} (x1 peak at input+${baseImpulse - 1024}) -> ${(row.msLoaded).toFixed(4)} ms loaded, ${(row.msMeasured).toFixed(4)} ms measured`,
					);
				}
			}
		}
		// readback for the real chain
		for (const factor of [1, ...factors]) {
			const slots = ["muff", "sd1", "ts9"].map((n) => ({ kind: "program" as const, program: loadPedal(n).json }));
			const controls = ["muff", "sd1", "ts9"].flatMap((n, i) => controlMessages(n, i));
			const job: Parameters<typeof harness.render>[0] = { slots, wasm: true, hostRate: H, controls, input: { kind: "sine", hz: 1000, amp: 0.01 }, samples: 4096 };
			if (factor !== 1) (job as { oversample?: unknown }).oversample = factor;
			const r = await harness.render(job);
			const l = r.loaded[0] as { latencyHostSamples: number; hostSampleRate: number; latencySlots: { engagedHostSamples: number }[] };
			rows.push({ host: H, console: "wasm", realChain: "muff+sd1+ts9", factor, loadedSamples: l.latencyHostSamples, ms: (l.latencyHostSamples / H) * 1000, perSlot: l.latencySlots.map((s) => s.engagedHostSamples) });
			console.log(`readback ${String(H / 1000).padStart(3)}k x${factor} Muff+SD-1+TS-9 (wasm): loaded.latencyHostSamples ${l.latencyHostSamples} (per slot ${l.latencySlots.map((s) => s.engagedHostSamples).join("/")}) = ${((l.latencyHostSamples / H) * 1000).toFixed(4)} ms`);
		}
	}
} finally {
	await harness.close();
}
if (out !== "") writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(failed ? "latency: FAIL" : "latency: PASS");
if (failed) process.exit(1);

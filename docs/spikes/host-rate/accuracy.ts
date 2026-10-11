// Check 2: ACCURACY THROUGH THE REAL WORKLET, every matrix arm.
//
//   NODE_PATH=<workbench>/node_modules bun docs/spikes/host-rate/accuracy.ts --consoles=wasm --out=<jsonl> [--arms=all] [--pedals=muff,sd1,ts9]
//       [--hz=1000,4000,8000,12500,16000,20000,30000] [--mv=10] [--port=8711]
//
// For each pedal x arm x frequency x console: the fundamental of the worklet's output (probe method, 0.9-1.7 s of a 2.0 s render at the HOST
// rate, 10 mV peak sine from t=0, controls set after load) in volts at the DAC, written as one JSONL row. Resumable (rows already present are
// skipped). `accuracy-report.ts` joins the rows with the native references (`natives.ts`) and prints the tables. A frequency at or above the
// arm's host Nyquist is skipped; 30 kHz is therefore only run on the 96 k and 192 k hosts (above the 48 kHz host's 24 kHz Nyquist).
import { arg, controlMessages, dacScaleOf, defaultBundle, defaultWasm, f32, fitFundamental, jsonl, loadPedal, openHarness, readJsonl, selectArms, ts } from "./lib";

const out = arg("out", "");
if (out === "") throw new Error("--out=<jsonl> is required");
const arms = selectArms(arg("arms", "all"));
const pedals = arg("pedals", "muff,sd1,ts9").split(",");
const hzs = arg("hz", "1000,4000,8000,12500,16000,20000,30000").split(",").map(Number);
const consoles = arg("consoles", "wasm").split(",");
const mv = Number(arg("mv", "10"));
const done = new Set(readJsonl<{ key: string }>(out).map((r) => r.key));

const harness = await openHarness({ bundle: arg("bundle", defaultBundle()), wasm: arg("wasm", defaultWasm()), port: Number(arg("port", "8711")) });
console.log(`accuracy: ${ts()} ${harness.version} bundle ${harness.bundleSha.slice(0, 12)} wasm ${harness.wasmSha.slice(0, 12)} consoles=${consoles.join(",")} mv=${mv}`);
try {
	for (const name of pedals) {
		const { json, program } = loadPedal(name);
		const scale = dacScaleOf(program);
		for (const arm of arms) {
			for (const hz of hzs) {
				if (hz >= arm.host / 2) continue;
				for (const consoleName of consoles) {
					const key = `${name}|${arm.name}|${hz}|${consoleName}|${mv}`;
					if (done.has(key)) continue;
					const job: Parameters<typeof harness.render>[0] = {
						slots: [{ kind: "program", program: json }],
						wasm: consoleName === "wasm",
						hostRate: arm.host,
						controls: controlMessages(name),
						input: { kind: "sine", hz, amp: mv / 1000 },
						samples: Math.round(arm.host * 2),
					};
					if (arm.factor !== 1) (job as { oversample?: unknown }).oversample = arm.factor;
					const t0 = performance.now();
					const r = await harness.render(job);
					const ms = performance.now() - t0;
					if (r.errors.length > 0) throw new Error(`worklet error on ${key}: ${r.errors.join("; ")}`);
					const loaded = r.loaded[0] ?? {};
					const fit = fitFundamental(f32(r), arm.host, hz);
					jsonl(out, {
						key, pedal: name, arm: arm.name, host: arm.host, factor: arm.factor, internal: arm.internal, hz, console: consoleName, mv,
						fundV: fit.fund, fundMv: (fit.fund * 1e3) / scale, resid: fit.resid, scale,
						loadedOversample: loaded.oversample, loadedHost: loaded.hostSampleRate, loadedLatency: loaded.latencyHostSamples, ctxRate: r.ctxRate,
						renderMs: Math.round(ms),
					});
					console.log(`${ts()} ${name.padEnd(4)} ${arm.name.padEnd(8)} ${String(hz).padStart(5)} Hz ${consoleName.padEnd(4)} fund ${((fit.fund * 1e3) / scale).toFixed(5)} mV (${Math.round(ms)} ms)`);
				}
			}
		}
	}
} finally {
	await harness.close();
}
console.log(`accuracy: done ${ts()}`);

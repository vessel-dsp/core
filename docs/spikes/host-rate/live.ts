// Check 3b: LIVE (not offline) AudioContext readings, and a clock-driven run of the worklet.
//
//   NODE_PATH=<workbench>/node_modules bun docs/spikes/host-rate/live.ts --out=<jsonl> [--arms=all] [--subjects=divider,muff,sd1,ts9,chain3] [--seconds=8]
//
// Part 1 (API readings): a live `AudioContext` requested at 48000 / 96000 / 192000 with latencyHint interactive and playback: `ctx.sampleRate` (was the
// request honoured?), `baseLatency`, `outputLatency`, `state`, `renderCapacity` (exposed or not), `getOutputTimestamp()`.
// Part 2 (clock-driven run): the real worklet in that live context, WASM console, an oscillator at 1 kHz 0.1 V in, for --seconds of wall time; the context
// clock's progress against the wall clock after 2 s of warm-up (a real-time factor below 1 means the audio thread could not keep up), and the worklet's
// own telemetry (mean cpuLoadPercent, overrunCount).
//
// WHAT THIS IS, READ FIRST: this box has NO audio output Chromium can open (`logs/30-live-no-device-evidence.log`: ALSA nodes EACCES, no PulseAudio / PipeWire).
// Chromium's AudioContext therefore runs on its fallback sink. Every number here is what the Web Audio API returned on that sink: it is NOT a device latency
// (outputLatency is 32 ms at every rate, which no hardware reports) and NOT a hardware callback deadline. The clock-driven run is the closest thing to real time
// this box offers (wall-clock cadence, the audio rendering thread), and it still is not an interface. Interface and loopback latency cannot be measured here.
import { arg, defaultBundle, defaultWasm, jsonl, load1, openHarness, selectArms, ts, waitIdle } from "./lib";
import { SUBJECTS } from "./subjects";

const out = arg("out", "");
if (out === "") throw new Error("--out=<jsonl> is required");
const arms = selectArms(arg("arms", "all"));
const subjects = arg("subjects", "divider,muff,sd1,ts9,chain3").split(",");
const seconds = Number(arg("seconds", "8"));
const harness = await openHarness({ bundle: arg("bundle", defaultBundle()), wasm: arg("wasm", defaultWasm()), port: Number(arg("port", "8761")) });
console.log(`live: ${ts()} ${harness.version}`);
try {
	for (const hint of ["interactive", "playback"]) {
		for (const rate of [48000, 96000, 192000]) {
			const r = await harness.page(async (a: any) => {
				const ctx = new AudioContext({ sampleRate: a.rate, latencyHint: a.hint });
				await ctx.resume();
				await new Promise((res) => setTimeout(res, 1500));
				const stamp = ctx.getOutputTimestamp();
				const res = {
					requested: a.rate, hint: a.hint, state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency,
					baseLatencySamples: ctx.baseLatency * ctx.sampleRate, renderCapacity: typeof (ctx as any).renderCapacity, outputTimestamp: { contextTime: stamp.contextTime, performanceTime: stamp.performanceTime },
				};
				await ctx.close();
				return res;
			}, { rate, hint });
			jsonl(out, { part: 1, ...r });
			console.log(`API ${hint.padEnd(11)} requested ${rate}: ctx.sampleRate ${r.sampleRate} ${r.sampleRate === rate ? "(honoured)" : "(NOT honoured)"} state ${r.state} baseLatency ${(r.baseLatency * 1000).toFixed(3)} ms (${r.baseLatencySamples.toFixed(1)} frames) outputLatency ${(r.outputLatency * 1000).toFixed(1)} ms renderCapacity ${r.renderCapacity}`);
		}
	}
	for (const subjectName of subjects) {
		const subject = (SUBJECTS[subjectName] as () => ReturnType<(typeof SUBJECTS)[string]>)();
		for (const arm of arms) {
			const gate = await waitIdle(1.5);
			const r = await harness.page(async (a: any) => {
				const wasmBytes = await (await fetch("/v2_dsp.wasm")).arrayBuffer();
				const ctx = new AudioContext({ sampleRate: a.host, latencyHint: "interactive" });
				await ctx.audioWorklet.addModule("/v2-audio-worklet.js");
				const node = new AudioWorkletNode(ctx, "v2-pedal-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
				const telemetry: any[] = [];
				const errors: string[] = [];
				let loaded: any = null;
				node.port.onmessage = (e: MessageEvent) => {
					if (e.data.type === "telemetry") telemetry.push(e.data);
					else if (e.data.type === "loaded") loaded = e.data;
					else if (e.data.type === "error") errors.push(e.data.message);
				};
				const msg: any = { type: "load", slots: a.slots, wasmConsole: { wasmBytes } };
				if (a.factor !== 1) msg.oversample = a.factor;
				node.port.postMessage(msg);
				const t0 = Date.now();
				while (loaded === null && errors.length === 0) {
					if (Date.now() - t0 > 120000) throw new Error("load timed out");
					await new Promise((res) => setTimeout(res, 10));
				}
				for (const c of a.controls) node.port.postMessage({ type: "setControl", slot: c.slot, id: c.id, position: c.position });
				const osc = ctx.createOscillator();
				osc.frequency.value = 1000;
				const g = ctx.createGain();
				g.gain.value = 0.1;
				osc.connect(g).connect(node);
				node.connect(ctx.destination);
				osc.start();
				await ctx.resume();
				await new Promise((res) => setTimeout(res, 2000));
				const w0 = performance.now();
				const c0 = ctx.currentTime;
				const n0 = telemetry.length;
				await new Promise((res) => setTimeout(res, a.seconds * 1000));
				const w1 = performance.now();
				const c1 = ctx.currentTime;
				const t = telemetry.slice(n0);
				const last = telemetry[telemetry.length - 1] ?? {};
				const mean = t.reduce((s, m) => s + (m.cpuLoadPercent ?? 0), 0) / Math.max(1, t.length);
				const res = {
					state: ctx.state, ctxRate: ctx.sampleRate, rtf: (c1 - c0) / ((w1 - w0) / 1000), contextSeconds: c1 - c0, wallSeconds: (w1 - w0) / 1000,
					cpuLoadMeanPct: mean, overruns: last.overrunCount, windows: t.length, p95Max: t.reduce((s, m) => Math.max(s, m.cpuP95Percent ?? 0), 0),
					loaded: loaded === null ? null : { oversample: loaded.oversample, hostSampleRate: loaded.hostSampleRate, latencyHostSamples: loaded.latencyHostSamples }, errors,
				};
				await ctx.close();
				return res;
			}, { host: arm.host, factor: arm.factor, slots: subject.slots, controls: subject.controls, seconds });
			const after = load1();
			jsonl(out, { part: 2, subject: subjectName, arm: arm.name, ...r, loadBefore: gate.before, loadAfter: after });
			console.log(`RUN ${subjectName.padEnd(7)} ${arm.name.padEnd(8)} state ${r.state} ctx ${r.ctxRate} rtf ${r.rtf.toFixed(4)} (context ${r.contextSeconds.toFixed(2)} s in ${r.wallSeconds.toFixed(2)} s wall) worklet cpuLoad ${r.cpuLoadMeanPct.toFixed(1)} % overruns ${r.overruns} load ${gate.before.toFixed(2)} -> ${after.toFixed(2)}${r.errors.length > 0 ? ` ERRORS ${r.errors.join("; ")}` : ""}`);
		}
	}
} finally {
	await harness.close();
}
console.log(`live: done ${ts()}`);

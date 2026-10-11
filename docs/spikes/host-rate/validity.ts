// Check 1: INSTRUMENT VALIDITY, before any figure.
//
//   NODE_PATH=<workbench>/node_modules bun docs/spikes/host-rate/validity.ts --bundle=<js> --wasm=<wasm> [--out=<json>]
//
//  A  each host rate is real: for 48 k / 96 k / 192 k / 384 k the OfflineAudioContext reports that `sampleRate`, a bare oscillator
//     and the worklet-rendered 1 kHz tone each count 1000 Hz by zero crossings, and the worklet's `loaded.hostSampleRate` equals it
//  B  determinism: native `ChainRuntime` renders at each internal rate are bit-identical across two runs (sha256 of the Float64
//     output), and so are worklet renders (TS and WASM) of a resampled arm
//  C  NEGATIVE control (the check must be able to go red): a render that is secretly 48 kHz os2 but is labelled "96 kHz os2" --
//     the rate readbacks disagree with the label AND the level against the claimed arm's own native render is off by the droop
//  D  POSITIVE known answer: the RC low pass (R = 10 k, C = 10 nF) has a closed form; every arm, both consoles, must read the
//     bilinear closed form at its INTERNAL rate x the DC blocker's own digital response x the resampler's calculated net response
//     (a calculation on the stage coefficients; 0 at x1), not the ideal analog one. The first version of this control left the
//     resampler term out and FAILED at 20 kHz on the 48 kHz-host resampled arms by exactly the calculated -0.136 dB
//     (logs/10-validity-run1-FAIL.log): the term is in the expectation now, and the x1 arms (no resampler) are held to a tighter bar.
import { writeFileSync } from "node:fs";
import {
	arg, ARMS, bitsEqual, dacScaleOf, db, f32, fitFundamental, loadFixture, loadPedal, nativeFundamental, nativeRender, openHarness,
	RC_C, RC_R, resamplerNetDb, sha, ts, zeroCrossingHz, type Arm, controlMessages, defaultBundle, defaultWasm,
} from "./lib";

const harness = await openHarness({ bundle: arg("bundle", defaultBundle()), wasm: arg("wasm", defaultWasm()), port: Number(arg("port", "8701")) });
const out = arg("out", "");
const results: Record<string, unknown>[] = [];
let failed = false;
const verdict = (name: string, ok: boolean, detail: string): void => {
	if (!ok) failed = true;
	console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
	results.push({ name, ok, detail });
};
console.log(`validity: ${ts()} ${harness.version}, bundle ${harness.bundleSha.slice(0, 12)}, wasm ${harness.wasmSha.slice(0, 12)}`);

try {
	// ---- A: the rate is the rate ---------------------------------------------------------------------------------------
	console.log("\n== A. host rates are real ==");
	for (const H of [48000, 96000, 192000, 384000]) {
		// bare oscillator in a blank page: the context and the browser's own tone
		const osc = await harness.page(async (a: any) => {
			const ctx = new OfflineAudioContext(1, a.H, a.H);
			const o = ctx.createOscillator();
			o.frequency.value = 1000;
			o.connect(ctx.destination);
			o.start();
			const buf = await ctx.startRendering();
			return { ctxRate: ctx.sampleRate, bufRate: buf.sampleRate, samples: Array.from(buf.getChannelData(0)) };
		}, { H });
		const zo = zeroCrossingHz(osc.samples, H, Math.round(0.2 * H), Math.round(0.9 * H));
		verdict(`A1 oscillator ${H}`, osc.ctxRate === H && osc.bufRate === H && Math.abs(zo.hz - 1000) < 1, `ctx.sampleRate ${osc.ctxRate}, buffer ${osc.bufRate}, ${zo.crossings} rising crossings in 0.7 s, ${zo.hz.toFixed(3)} Hz`);
		// through the real worklet: divider, x1 and os2 (os2 only where 2H is a rate the matrix uses or is cheap: all), both consoles
		const { json } = loadFixture("divider");
		for (const wasm of [false, true]) {
			for (const factor of H === 384000 ? [1] : [1, 2]) {
				const job: Parameters<typeof harness.render>[0] = {
					slots: [{ kind: "program", program: json }],
					wasm,
					hostRate: H,
					input: { kind: "sine", hz: 1000, amp: 0.1 },
					samples: H,
				};
				if (factor !== 1) (job as { oversample?: unknown }).oversample = factor;
				const r = await harness.render(job);
				if (r.errors.length > 0) throw new Error(r.errors.join("; "));
				const loaded = r.loaded[0];
				const z = zeroCrossingHz(f32(r), H, Math.round(0.3 * H), Math.round(0.9 * H));
				verdict(
					`A2 worklet ${wasm ? "wasm" : "ts  "} ${H / 1000}k x${factor}`,
					r.ctxRate === H && loaded.hostSampleRate === H && Math.abs(z.hz - 1000) < 1 && r.crossOriginIsolated,
					`ctx.sampleRate ${r.ctxRate}, loaded.hostSampleRate ${loaded.hostSampleRate}, loaded.oversample ${loaded.oversample}, ${z.crossings} crossings in 0.6 s = ${z.hz.toFixed(3)} Hz, crossOriginIsolated ${r.crossOriginIsolated}`,
				);
			}
		}
	}

	// ---- B: determinism --------------------------------------------------------------------------------------------------
	console.log("\n== B. references and worklet renders are bit-identical across two runs ==");
	for (const [name, hz] of [["sd1", 1000], ["muff", 8000]] as [string, number][]) {
		for (const rate of [48000, 96000, 192000, 384000]) {
			const a = nativeRender(name, hz, 0.01 * 1000, rate, 0.25);
			const b = nativeRender(name, hz, 0.01 * 1000, rate, 0.25);
			const ha = sha(new Uint8Array(a.buffer));
			const hb = sha(new Uint8Array(b.buffer));
			verdict(`B1 native ${name} ${hz} Hz @${rate / 1000}k`, ha === hb, `${a.length} samples, sha256 ${ha.slice(0, 16)} vs ${hb.slice(0, 16)}`);
		}
	}
	{
		const { json } = loadPedal("sd1");
		for (const wasm of [false, true]) {
			const job: Parameters<typeof harness.render>[0] = {
				slots: [{ kind: "program", program: json }], wasm, hostRate: 96000, oversample: 2, controls: controlMessages("sd1"),
				input: { kind: "sine", hz: 4000, amp: 0.01 }, samples: 48000,
			};
			const a = await harness.render(job);
			const b = await harness.render(job);
			const c = bitsEqual(f32(a), f32(b));
			verdict(`B2 worklet ${wasm ? "wasm" : "ts  "} sd1 96k os2`, c.equal, `${f32(a).length} samples, bit-identical=${c.equal}${c.equal ? "" : ` first diff ${c.firstDiff} max abs ${c.maxAbs}`}`);
		}
	}

	// ---- C: negative control ---------------------------------------------------------------------------------------------
	console.log("\n== C. NEGATIVE control: a render that is secretly 48 kHz os2 but labelled 96 kHz os2 ==");
	{
		const claimed = ARMS.find((x) => x.name === "96k os2") as Arm;
		for (const [name, hz] of [["muff", 16000], ["sd1", 16000], ["ts9", 8000]] as [string, number][]) {
			const { json, program } = loadPedal(name);
			const scale = dacScaleOf(program);
			const native = nativeFundamental(name, hz, 10, claimed.internal, `${process.cwd()}/native-validity-cache.json`);
			for (const wasm of [false, true]) {
				// what actually runs: host 48000 os2 (internal 96k); the label says 96k os2 (internal 192k)
				const r = await harness.render({
					slots: [{ kind: "program", program: json }], wasm, hostRate: 48000, oversample: 2, controls: controlMessages(name),
					input: { kind: "sine", hz, amp: 0.01 }, samples: 96000,
				});
				if (r.errors.length > 0) throw new Error(r.errors.join("; "));
				const loaded = r.loaded[0];
				const level = db(fitFundamental(f32(r), 48000, hz).fund / native);
				const readbackRed = r.ctxRate !== claimed.host || loaded.hostSampleRate !== claimed.host;
				const levelRed = Math.abs(level) > 0.02;
				verdict(
					`C ${name} ${hz} Hz ${wasm ? "wasm" : "ts  "} (label 96k os2, actual 48k os2)`,
					readbackRed && levelRed,
					`ctx.sampleRate ${r.ctxRate} and loaded.hostSampleRate ${loaded.hostSampleRate} vs label ${claimed.host}: ${readbackRed ? "RED (as it must)" : "GREEN (control failed)"}; level vs native ${claimed.internal / 1000}k ${level.toFixed(4)} dB: ${levelRed ? "RED (as it must)" : "GREEN (control failed)"}; scale ${scale.toExponential(3)}`,
				);
			}
		}
	}

	// ---- D: positive known answer ------------------------------------------------------------------------------------------
	console.log("\n== D. POSITIVE known answer: RC low pass (10 k, 10 nF; corner 1591.5 Hz), every arm, both consoles ==");
	{
		const { json, program } = loadFixture("rc");
		const scale = dacScaleOf(program);
		const rc = RC_R * RC_C;
		const analog = (f: number) => 1 / Math.sqrt(1 + (2 * Math.PI * f * rc) ** 2);
		const trap = (f: number, R: number) => 1 / Math.sqrt(1 + (2 * R * Math.tan((Math.PI * f) / R) * rc) ** 2);
		const be = (f: number, R: number) => {
			const w = (2 * Math.PI * f) / R;
			const re = 1 + rc * R * (1 - Math.cos(w));
			const im = rc * R * Math.sin(w);
			return 1 / Math.hypot(re, im);
		};
		// the chain's own 10 Hz DC blocker at the HOST rate: y = x - x1 + p y1
		const dcb = (f: number, H: number) => {
			const p = 1 - (2 * Math.PI * 10) / H;
			const w = (2 * Math.PI * f) / H;
			return Math.hypot(1 - Math.cos(w), Math.sin(w)) / Math.hypot(1 - p * Math.cos(w), p * Math.sin(w));
		};
		let worstTrap = 0;
		let worstTrapX1 = 0;
		let worstBe = 0;
		let analogSpread = 0;
		const rows: string[] = [];
		for (const arm of ARMS) {
			for (const wasm of [false, true]) {
				const cells: string[] = [];
				for (const hz of arm.host >= 96000 ? [1000, 4000, 8000, 16000, 20000, 30000] : [1000, 4000, 8000, 16000, 20000]) {
					const job: Parameters<typeof harness.render>[0] = {
						slots: [{ kind: "program", program: json }], wasm, hostRate: arm.host,
						input: { kind: "sine", hz, amp: 0.01 }, samples: arm.host * 2,
					};
					if (arm.factor !== 1) (job as { oversample?: unknown }).oversample = arm.factor;
					const r = await harness.render(job);
					if (r.errors.length > 0) throw new Error(r.errors.join("; "));
					const gain = fitFundamental(f32(r), arm.host, hz).fund / scale / 0.01;
					const dcf = dcb(hz, arm.host) * 10 ** (resamplerNetDb(hz, arm.host, arm.factor) / 20);
					const dT = db(gain / (trap(hz, arm.internal) * dcf));
					const dB = db(gain / (be(hz, arm.internal) * dcf));
					const dA = db(gain / (analog(hz) * dcf));
					worstTrap = Math.max(worstTrap, Math.abs(dT));
					if (arm.factor === 1) worstTrapX1 = Math.max(worstTrapX1, Math.abs(dT));
					worstBe = Math.max(worstBe, Math.abs(dB));
					analogSpread = Math.max(analogSpread, Math.abs(dA));
					cells.push(`${hz / 1000}k: ${dT >= 0 ? "+" : ""}${dT.toFixed(4)}/${dA >= 0 ? "+" : ""}${dA.toFixed(2)}`);
				}
				rows.push(`${arm.name.padEnd(8)} ${wasm ? "wasm" : "ts  "} (internal ${arm.internal / 1000}k) dB over [bilinear closed form x resampler calc]/[ideal analog x same]: ${cells.join("  ")}`);
			}
		}
		for (const r of rows) console.log(`  ${r}`);
		verdict(
			"D RC closed form",
			worstTrap < 0.005 && worstTrapX1 < 0.001,
			`worst |measured - bilinear closed form at the internal rate x DC blocker x calculated resampler response| = ${worstTrap.toFixed(4)} dB over ${rows.length} arm x console rows (x1 arms, no resampler: ${worstTrapX1.toFixed(5)} dB); the backward-Euler closed form is off by up to ${worstBe.toFixed(2)} dB and the ideal analog one by up to ${analogSpread.toFixed(2)} dB, so the check can tell them apart`,
		);
	}
} finally {
	await harness.close();
}
if (out !== "") writeFileSync(out, JSON.stringify(results, null, 1));
console.log(failed ? "\nvalidity: FAIL" : "\nvalidity: PASS");
if (failed) process.exit(1);

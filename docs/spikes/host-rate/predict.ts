// PREDICTIONS, as arithmetic. Written and run BEFORE any engine render of this spike.
//
//   bun docs/spikes/host-rate/predict.ts            (from a clone root; imports the stage design only)
//
// Inputs are limited to (1) figures already recorded in the phase-1 note (docs/spikes/2026-10-10-worklet-oversample.md
// §3, §4b, §7), the Newton-predictor notes (docs/spikes/2026-10-09-newton-predictor-wasm-port.md §1,
// docs/spikes/2026-10-09-newton-iteration-budget.md line 688) and (2) the half-band stage design
// (`designHalfBand2x`, `RESAMPLE_STAGE_SPECS`), whose frequency response is a CALCULATION on coefficients, not a render.
// Nothing here calls ReferenceRuntime, ChainRuntime, the WASM engine or a browser.
import { designHalfBand2x, resampleStageSpec } from "@vessel-dsp/runtime/resample";

const dB = (x: number): number => 20 * Math.log10(x);

// ---- measured phase-1 data (dB of worklet/engine over native 192 kHz, 10 mV, default controls) -----------------------
type Pedal = "muff" | "sd1" | "ts9";
const X1_VS_192: Record<Pedal, Record<number, number>> = {
	muff: { 1000: -0.0046, 4000: -0.4136, 8000: -2.2201, 16000: -12.3368 },
	sd1: { 1000: -0.0133, 4000: -0.3095, 8000: -1.21, 16000: -4.9476 },
	ts9: { 1000: -0.0068, 4000: -0.3059, 8000: -1.2545, 16000: -5.6577 },
};
// os8 (384 kHz solver) over native 192k / over native 384k, phase-1 §4b + native384.ts: gives native384 - native192.
const OS8: { pedal: Pedal; hz: number; vs192: number; vs384: number }[] = [
	{ pedal: "muff", hz: 4000, vs192: 0.0238, vs384: 0.0041 },
	{ pedal: "muff", hz: 8000, vs192: 0.1079, vs384: 0.0052 },
	{ pedal: "muff", hz: 16000, vs192: 0.4532, vs384: 0.0078 },
	{ pedal: "sd1", hz: 16000, vs192: 0.3715, vs384: 0.0071 },
	{ pedal: "ts9", hz: 16000, vs192: 0.3926, vs384: 0.0077 },
];
const n384m192 = (p: Pedal, hz: number): number | null => {
	const r = OS8.find((o) => o.pedal === p && o.hz === hz);
	return r === undefined ? null : r.vs192 - r.vs384;
};

// ---- the warp model -------------------------------------------------------------------------------------------------
// Trapezoidal integration at solver rate R shows the analog network at Omega = (2R) tan(pi f / R) instead of 2 pi f.
// w(f,R) = ln(Omega / omega) = ln(tan(x)/x), x = pi f / R. Locally the level moves s dB per e-fold of frequency, so the
// level error against the continuous solution is T(R) = s * w(f,R) (pure warp: falls as (f/R)^2).
// A backward-Euler pole (the op-amp's) errs in proportion to dt: B(R) = beta / R. Op-amp pedals get both terms.
const w = (f: number, R: number): number => {
	const x = (Math.PI * f) / R;
	return Math.log(Math.tan(x) / x);
};

// pure warp: s from the measured x1-vs-192k point:  M48 = s (w48 - w192)
function pureWarp(p: Pedal, f: number): { s: number; T: (R: number) => number } {
	const m = X1_VS_192[p][f] as number;
	const s = m / (w(f, 48000) - w(f, 192000));
	return { s, T: (R) => s * w(f, R) };
}
// warp + dt term: two unknowns (a, beta) from M48 = a (w48-w192) + beta (1/48k-1/192k)  and  N = a (w192-w384) + beta (1/192k-1/384k),
// where N = native192 - native384 = -(native384 - native192).
function twoTerm(p: Pedal, f: number): { a: number; beta: number; T: (R: number) => number } | null {
	const n = n384m192(p, f);
	if (n === null) return null;
	const M = X1_VS_192[p][f] as number;
	const N = -n;
	const a11 = w(f, 48000) - w(f, 192000);
	const a12 = 1 / 48000 - 1 / 192000;
	const a21 = w(f, 192000) - w(f, 384000);
	const a22 = 1 / 192000 - 1 / 384000;
	const det = a11 * a22 - a12 * a21;
	const a = (M * a22 - a12 * N) / det;
	const beta = (a11 * N - a21 * M) / det;
	return { a, beta, T: (R) => a * w(f, R) + beta / R };
}

const out: string[] = [];
const log = (s = ""): void => {
	out.push(s);
	console.log(s);
};
log(`# predictions arithmetic, ${new Date().toISOString()}`);

// ---- P2 / convergence --------------------------------------------------------------------------------------------------
log("\n## P2 x1 warp at higher host rate, and convergence (dB; T(R) = level error of an engine solving at rate R vs the continuous solution)");
log("model check on EXISTING data: pure-warp model fitted to the 48k point, then asked for native384 - native192 (measured in phase 1)");
for (const [p, f] of [["muff", 4000], ["muff", 8000], ["muff", 16000]] as [Pedal, number][]) {
	const m = pureWarp(p, f);
	const pred = m.T(384000) - m.T(192000);
	log(`  ${p} ${f} Hz: s=${m.s.toFixed(2)} dB/e-fold; predicted native384-native192 = ${pred.toFixed(4)}; measured (phase 1) = ${(n384m192(p, f) as number).toFixed(4)}`);
}
for (const p of ["muff", "sd1", "ts9"] as Pedal[]) {
	for (const f of [8000, 16000]) {
		const pw = pureWarp(p, f);
		const tt = twoTerm(p, f);
		const rows: string[] = [];
		const read = (label: string, T: (R: number) => number) => {
			rows.push(
				`${label}: x1@96k vs 192k ${(T(96000) - T(192000)).toFixed(3)}, x1@96k vs 768k ${(T(96000) - T(768000)).toFixed(3)}, ` +
					`native192 vs 768k ${(T(192000) - T(768000)).toFixed(3)}, native384 vs 768k ${(T(384000) - T(768000)).toFixed(3)}, x1@48k vs 768k ${(T(48000) - T(768000)).toFixed(3)}`,
			);
		};
		read("pure-warp", pw.T);
		if (tt !== null) read(`warp+dt (a=${tt.a.toFixed(3)}, beta=${tt.beta.toFixed(2)})`, tt.T);
		// bounds for the pedals with an op-amp when no 384k datum exists: all warp, or all dt
		if (tt === null) {
			const m = X1_VS_192[p][f] as number;
			const beta = m / (1 / 48000 - 1 / 192000);
			read("dt-only bound", (R) => beta / R);
		}
		log(`  ${p} ${f} Hz:`);
		for (const r of rows) log(`     ${r}`);
	}
}
log("  naive (f/fs)^2 reading of the task: Muff 16 kHz x1: 96k -3.08 dB, 192k -0.77 dB (= -12.3368 / 4, / 16)");

// ---- the resampler's own response: calculation on the stage coefficients ---------------------------------------------------
function halfBandMag(taps: number, beta: number, f: number, stageRate: number): number {
	const h = designHalfBand2x(taps, beta);
	// the up path has gain 2 on the zero-stuffed signal; the prototype sums to 1, so the passband magnitude is |sum h e^-jwk| (taps sum to 1)
	let re = 0;
	let im = 0;
	for (let k = 0; k < h.length; k += 1) {
		const ph = (2 * Math.PI * f * k) / stageRate;
		re += (h[k] as number) * Math.cos(ph);
		im -= (h[k] as number) * Math.sin(ph);
	}
	return Math.hypot(re, im);
}
/** Net amplitude response (dB) of interpolate-then-decimate through every stage at host rate H and factor N (the pair = |H|^2 per stage). */
function resamplerNet(f: number, H: number, N: number): number {
	let total = 0;
	for (let s = 0; s < Math.log2(N); s += 1) {
		const [taps, beta] = resampleStageSpec(s);
		const mag = halfBandMag(taps, beta, f, H * 2 ** (s + 1));
		total += 2 * dB(mag);
	}
	return total;
}
log("\n## resampler net response (dB), calculated from the stage designs (interpolation pair per stage, no solver)");
log("  freq        48k os2   48k os4   48k os8   96k os2   96k os4   192k os2");
for (const f of [1000, 4000, 8000, 12500, 16000, 20000, 30000]) {
	const cell = (H: number, N: number) => (f < (H * N) / 2 && f < H / 2 ? resamplerNet(f, H, N).toFixed(4).padStart(9) : "      n/a");
	log(`  ${String(f).padStart(5)} Hz ${cell(48000, 2)} ${cell(48000, 4)} ${cell(48000, 8)} ${cell(96000, 2)} ${cell(96000, 4)} ${cell(192000, 2)}`);
}
log("  check against phase 1: os4 at 48k read +0.0057/+0.0041/+0.0066/+0.0099 dB (Muff, 1/4/8/16 kHz) over native 192k; the calculation's");
log("  16 kHz os4 figure above is the model's passband term for the same arm");

// ---- P3 latency arithmetic -------------------------------------------------------------------------------------------------
log("\n## P3 engine latency (arithmetic: host samples per slot are fixed by the stage designs, ms = samples / host rate)");
const LAT = { 2: 19.5, 4: 26.25, 8: 28.625 } as const;
log("  arm          host-samples/slot   ms/slot    ms three-slot chain   quantum ms (128/H)");
for (const H of [48000, 96000, 192000]) {
	for (const N of [1, 2, 4] as const) {
		const s = N === 1 ? 0 : LAT[N as 2 | 4];
		log(`  ${String(H / 1000).padStart(3)}k x${N}         ${String(s).padStart(8)}        ${((s / H) * 1000).toFixed(4)}      ${((3 * s * 1000) / H).toFixed(4)}             ${((128 / H) * 1000).toFixed(4)}`);
	}
}

// ---- P4 / P5 -----------------------------------------------------------------------------------------------------------------
log("\n## P4 cost and P7 predictor gate: iterations per INTERNAL sample (TS, 1 kHz 10 mV; predictor spike note §1) and the predictor's os4 gain");
// per host sample, shipped predictor on at os4; the budget note (line 688) gives the os4 gain vs the un-predicted solve
const IT: Record<Pedal, { x1: number; os4: number; gain: number }> = {
	muff: { x1: 2.833, os4: 5.625, gain: 0.39 },
	sd1: { x1: 2.354, os4: 4.585, gain: 0.41 },
	ts9: { x1: 1.708, os4: 4.043, gain: 0.45 },
};
// WASM mean cpuLoad of the 2.67 ms quantum at 48k, phase-1 §7 (box NOT idle, load 1.4-1.8): os1 / os2 / os4, percent
const LOAD: Record<Pedal, [number, number, number]> = { muff: [45.5, 68.9, 96.0], sd1: [60.8, 92.8, 121.7], ts9: [27.5, 48.2, 65.3] };
for (const p of ["muff", "sd1", "ts9"] as Pedal[]) {
	const perInternalPred = IT[p].os4 / 4;
	const perInternalUnpred = IT[p].os4 / (1 - IT[p].gain) / 4;
	const ratio = perInternalUnpred / perInternalPred;
	log(
		`  ${p}: it/internal predictor ON at os4 ${perInternalPred.toFixed(3)}, un-predicted at the same dt ${perInternalUnpred.toFixed(3)} (x1 at 48k: ${IT[p].x1}); ` +
			`predicted 192k-x1 cost / 48k-os4 cost = ${ratio.toFixed(2)} if cost follows iterations (phase 1: cost ratio os4/os1 ${(LOAD[p][2] / LOAD[p][0]).toFixed(2)} vs iteration ratio ${(IT[p].os4 / IT[p].x1).toFixed(2)})`,
	);
}
log("\n## P5 predicted mean load (fraction of the 128/H deadline) for the WASM console, from the phase-1 table and the iteration rule above");
log("  rule: cost per audio second = internal rate x iterations per internal sample; the deadline per block is 128/H and so is the block time:");
log("  the MEAN fraction is therefore equal across equal-internal-rate arms EXCEPT through the predictor gate (x1 arms run it off)");
const arms: { name: string; H: number; N: 1 | 2 | 4 }[] = [
	{ name: "48k x1", H: 48000, N: 1 }, { name: "48k os2", H: 48000, N: 2 }, { name: "48k os4", H: 48000, N: 4 },
	{ name: "96k x1", H: 96000, N: 1 }, { name: "96k os2", H: 96000, N: 2 }, { name: "96k os4", H: 96000, N: 4 },
	{ name: "192k x1", H: 192000, N: 1 }, { name: "192k os2", H: 192000, N: 2 },
];
const loadOf = (p: Pedal, H: number, N: 1 | 2 | 4): number => {
	const internal = H * N;
	// anchor on phase 1 where the arm is one of 48k x1/os2/os4; otherwise scale by internal rate, and for
	// predictor-off (x1) arms above 48k apply the un-predicted/predicted iteration ratio relative to the os4 anchor.
	const un = IT[p].os4 / (1 - IT[p].gain) / 4;
	const pr = IT[p].os4 / 4;
	if (H === 48000) return LOAD[p][N === 1 ? 0 : N === 2 ? 1 : 2];
	const base = LOAD[p][2] * (internal / 192000); // as if predictor ON at 192k-class dt
	return N === 1 ? base * (un / pr) : base;
};
const KP99 = { 48000: 1.5, 96000: 1.8, 192000: 2.4 } as Record<number, number>; // GUESS: p99 / mean, rising with H (fewer solves per block, fixed-time jitter)
log("  arm      internal   muff mean (p99)   sd1 mean (p99)   ts9 mean (p99)   chain3 mean (p99)   [percent of deadline; p99 = mean x guess k(H) 1.5/1.8/2.4]");
for (const a of arms) {
	const m = (["muff", "sd1", "ts9"] as Pedal[]).map((p) => loadOf(p, a.H, a.N));
	const chain = m.reduce((x, y) => x + y, 0);
	const k = KP99[a.H] as number;
	const f = (v: number) => `${v.toFixed(0).padStart(4)} (${(v * k).toFixed(0).padStart(4)})`;
	log(`  ${a.name.padEnd(8)} ${String((a.H * a.N) / 1000).padStart(4)}k      ${f(m[0] as number)}       ${f(m[1] as number)}      ${f(m[2] as number)}      ${f(chain)}`);
}
log("  (phase-1 anchors are contaminated by a one-core background job at load 1.4-1.8, so an idle box should read LOWER; the 96k os4 / 192k os2 rows are scaled from the 384k-class dt with the 192k anchor x2 -- low confidence)");

import { writeFileSync } from "node:fs";
const dest = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
if (dest !== undefined) writeFileSync(dest, `${out.join("\n")}\n`);

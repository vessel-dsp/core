// The trapezoid's known hazard, measured: the step response of a non-inverting stage (G = 1, 2, 10, 100) at the solver's native rates 48 kHz and 192 kHz (oversample 1,
// so the solver's own sample-to-sample behaviour is what is read, not the resampler's), TS and/or WASM. e[n] = (y[n] - y_final) / y_final after a 10 mV step. Printed:
// the first 8 samples of e, the per-sample ratio e[n+1]/e[n] over samples 3..12 (the ring-down pole; negative = Nyquist ringing), the peak |e| after the first sample,
// and the samples until |e| < 1 % and < 0.1 %. Closed-loop poles predicted by closed-forms.ts are printed beside them.
//   bun docs/spikes/pole-order2/ring-probe.ts [--consoles=ts,wasm] [--scheme=tr] [--out=<json>]
import { writeFileSync } from "node:fs";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { type Scheme, closedLoopPole } from "./closed-forms";
import { arg, renderTs, renderWasm } from "./lib";
const consoles = arg("consoles", "ts,wasm").split(","), scheme = arg("scheme", "tr") as Scheme, out = arg("out", "");
const wasmDir = arg("wasm-dir", "") || undefined;
const STEP_AT = 60, N = 260, AMP = 0.01;
const rows: Array<Record<string, unknown>> = [];
console.log("console G   rate   os | e[0..7] after the step (fraction of final)                                   | ratio e[n+1]/e[n] n=3..12 (median) | peak|e| n>=1 | samples to 1% / 0.1% | predicted pole");
// modes: [host rate, oversample]: the two native rates read the solver's own sample-to-sample behaviour; 48000 x4 reads it through the band-limited resampler (the ring at the
// solver's Nyquist is removed by construction, so it is reported, not claimed).
for (const cn of consoles) for (const [rate, os] of [[48000, 1], [192000, 1], [48000, 4]] as const) for (const g of [1, 2, 10, 100]) {
	const [rf, rg] = g === 1 ? [1, 1e9] : [(g - 1) * 1000, 1000];
	const r = compile(nonInvertingStage({ rfOhms: rf, rgOhms: rg }), { registry: emptyRegistry });
	if (r.status !== "ok") throw new Error("compile");
	const input = new Float64Array(N);
	for (let i = STEP_AT; i < N; i += 1) input[i] = AMP;
	const y = cn === "ts" ? renderTs(r.program, {}, input, { rate, os, sourceOhms: 0, block: N }).out : Float64Array.from((await renderWasm(r.program, {}, input, { rate, os, sourceOhms: 0, block: N, wasmDir })).out);
	const final = y[N - 1] as number, e = Array.from({ length: N - STEP_AT }, (_, i) => ((y[STEP_AT + i] as number) - final) / final);
	const ratios = e.slice(3, 13).map((v, i) => (e[4 + i] as number) / v).filter(Number.isFinite).sort((a, b) => a - b);
	const med = ratios[ratios.length >> 1] ?? Number.NaN;
	const peak = Math.max(...e.slice(1, 60).map(Math.abs));
	const settle = (tol: number) => { let last = -1; for (let i = 0; i < e.length; i += 1) if (Math.abs(e[i] as number) >= tol) last = i; return last + 1; };
	rows.push({ console: cn, G: g, rate, os, e: e.slice(0, 40), ratio: med, peak, settle1: settle(0.01), settle01: settle(0.001) });
	console.log(`${cn.padEnd(7)} ${String(g).padEnd(3)} ${String(rate).padEnd(6)} x${os} | ${e.slice(0, 8).map((v) => v.toFixed(4).padStart(8)).join("")} | ${med.toFixed(3).padStart(8)} | ${peak.toFixed(4).padStart(8)} | ${String(settle(0.01)).padStart(4)} / ${String(settle(0.001)).padStart(4)} | ${closedLoopPole(scheme, g, 1e6, rate * os).join("/")}`);
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

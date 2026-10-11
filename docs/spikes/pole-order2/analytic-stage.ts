// The known answer. A non-inverting op-amp stage with exact resistors (G = 1 + Rf/Rg) against the analytic single-pole closed loop
// |G0 / (1 + j f/fc)|, G0 = G/(1 + G/A0), fc = GBP (1/A0 + 1/G), 100 Hz-16 kHz, at os1/os2/os4/os8, on the TS (ReferenceRuntime) and the WASM
// (V2WasmEngine) consoles, from whichever tree this is run in. Prints measured minus the continuous closed form (the ACCURACY control) and
// measured minus the discrete closed form of the named scheme (the WIRING control: the engine implements the law exactly or it does not).
//   bun docs/spikes/pole-order2/analytic-stage.ts [--modes=os1,os2,os4,os8] [--consoles=ts,wasm] [--gains=10,100] [--scheme=be|tr] [--out=<json>] [--wasm-dir=<dir>]
// GBP: the engine's constant is 1e6. GBW_HZ (scratch trees only, never in the diff) overrides the constant on the TS console of a scratch tree
// and names the value the analytic reference uses; a scratch-built wasm (--wasm-dir) carries the same value on the WASM console.
import { writeFileSync } from "node:fs";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { type Scheme, continuousClosedLoopDb, discreteClosedLoopDb } from "./closed-forms";
import { arg, fundamentalOf, renderTs, renderWasm, sine } from "./lib";

const modes = arg("modes", "os1,os2,os4,os8").split(",");
const consoles = arg("consoles", "ts,wasm").split(",");
const gains = arg("gains", "10,100").split(",").map(Number);
const scheme = arg("scheme", "tr") as Scheme;
const out = arg("out", "");
const wasmDir = arg("wasm-dir", "") || undefined;
const amp = Number(arg("amp", "0.001"));
const aol = Number(arg("aol", "1e5"));
const GBP = Number(process.env.GBW_HZ ?? 1e6);
const freqs = arg("freqs", "100,250,500,1000,2000,3150,4000,6300,8000,10000,12500,16000").split(",").map(Number);
const SETTLE = 0.05, WINDOW = 0.25;
const resistors = (g: number): [number, number] => (g === 1 ? [1, 1e9] : [(g - 1) * 1000, 1000]);
const rows: Array<Record<string, number | string>> = [];
console.log(`GBP ${GBP}, A0 ${aol}, ${amp * 1000} mV sine; cell = measured minus X (dB); X = continuous single pole | X = discrete closed form of '${scheme}'`);
for (const mode of modes) {
	const os = Number(mode.replace("os", "")), rate = 48000, fs = rate * os;
	for (const cn of consoles) {
		console.log(`\n== ${cn} ${mode} (solver ${fs} Hz)`);
		console.log(`G    |${freqs.filter((f) => f < fs / 2).map((f) => String(f).padStart(15)).join("")} | max|vs continuous| f<=10k | max|vs ${scheme}|`);
		for (const g of gains) {
			const [rf, rg] = resistors(g);
			const r = compile(nonInvertingStage({ rfOhms: rf, rgOhms: rg, ...(aol !== 1e5 ? { aol } : {}) }), { registry: emptyRegistry });
			if (r.status !== "ok") throw new Error(`stage did not compile: ${r.status}`);
			const cells: string[] = [];
			let worstC = 0, worstD = 0;
			for (const hz of freqs) {
				if (hz >= rate / 2) continue;
				const n = Math.round(rate * (SETTLE + WINDOW));
				const input = sine(n, hz, amp, rate);
				const o = cn === "ts" ? renderTs(r.program, {}, input, { rate, os }).out : (await renderWasm(r.program, {}, input, { rate, os, wasmDir })).out;
				const fund = fundamentalOf(Float64Array.from(o as ArrayLike<number>).subarray(Math.round(rate * SETTLE)), rate, hz);
				const measured = 20 * Math.log10(fund / amp);
				const gEff = 1 + rf / rg;
				const eC = measured - continuousClosedLoopDb(gEff, GBP, hz, aol);
				const eD = measured - discreteClosedLoopDb(scheme, gEff, GBP, hz, fs, aol);
				rows.push({ console: cn, os, gain: g, hz, gbp: GBP, aol, measuredDb: measured, errContinuous: eC, errDiscrete: eD });
				if (hz <= 10000) worstC = Math.max(worstC, Math.abs(eC));
				worstD = Math.max(worstD, Math.abs(eD));
				cells.push(`${eC >= 0 ? "+" : ""}${eC.toFixed(3)}|${eD >= 0 ? "+" : ""}${eD.toFixed(3)}`.padStart(15));
			}
			console.log(`${String(g).padEnd(4)} |${cells.join("")} | ${worstC.toFixed(3).padStart(8)} | ${worstD.toFixed(4)}`);
		}
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

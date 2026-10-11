// Stepped-sine sweep: for each pedal x state x frequency, render a 10 mV sine and report the fundamental (mV) of
// a settled window. Modes: os4 (host 48 kHz, oversample 4), n192 (native 192 kHz host, TS only is the stand-in the
// task allows), x1 (native 48 kHz). No source impedance (stiff drive), matching the three-way engine columns.
// Settle 0.5 s then a 0.9 s window; fundamental by the workbench probe's harmonic least-squares fit.
//   bun docs/spikes/opamp-gbw/sweep.ts --label=base --pedals=sd1,ts9 --states=drive-min,centre,drive-max \
//        --console=ts|wasm --mode=os4|n192|x1 --out=<file.json>
import { writeFileSync } from "node:fs";
import { FREQS, PACKETS, STATES, arg, compileFile, db, fundamentalOf, renderTs, renderWasm, sine } from "./lib";

const label = arg("label", "now");
const pedals = arg("pedals", "sd1,ts9").split(",");
const states = arg("states", "drive-min,centre,drive-max").split(",");
const consoleName = arg("console", "ts") as "ts" | "wasm";
const mode = arg("mode", "os4") as "os4" | "n192" | "x1";
const out = arg("out", "");
const amp = Number(arg("amp", "0.01"));
const freqs = arg("freqs", FREQS.join(",")).split(",").map(Number);
const SETTLE = 0.5, WINDOW = 0.9;
const rate = mode === "n192" ? 192000 : 48000;
const os = mode === "os4" ? 4 : 1;
const rows: Array<Record<string, unknown>> = [];
console.log(`[${label}] sweep ${consoleName} ${mode}: ${pedals.join("+")} x ${states.join("+")}, ${amp * 1000} mV sine, settle ${SETTLE} s window ${WINDOW} s, host rate ${rate}`);
for (const pedal of pedals) {
	const program = compileFile(PACKETS[pedal]!.file);
	for (const state of states) {
		const controls = STATES[state]!;
		const line: string[] = [];
		for (const hz of freqs) {
			const n = Math.round(rate * (SETTLE + WINDOW));
			const input = sine(n, hz, amp, rate);
			const r = consoleName === "ts" ? renderTs(program, controls, input, { rate, os }) : await renderWasm(program, controls, input, { rate, os });
			const w = (r.out as ArrayLike<number>) instanceof Float32Array ? Float64Array.from(r.out as Float32Array) : (r.out as Float64Array);
			const fund = fundamentalOf(w.subarray(Math.round(rate * SETTLE)), rate, hz);
			rows.push({ pedal, state, hz, console: consoleName, mode, fund_mV: fund * 1000 });
			line.push(`${hz}:${(fund * 1000).toFixed(3)}`);
		}
		console.log(`${pedal} ${state.padEnd(9)} ${line.join("  ")}`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

// Control 2(a): the known answer. A non-inverting op-amp stage with exact resistors (G = 1 + Rf/Rg = 10 and 100), the
// product stated as a typed GBP of 1e6, 3e6 and 1e7, driven at os4 (and os1 / native 192 kHz for the discretisation
// attribution). Measured closed-loop magnitude vs the single-pole closed form |G0 / (1 + j f / fc)|
// (G0 = G / (1 + G/A0), fc = GBP (1/A0 + 1/G); see closedLoopMagnitudeDb), 100 Hz-16 kHz, on the TS and the WASM console.
//   bun docs/spikes/opamp-gbw/analytic-stage.ts [--modes=os4,os1,n192] [--consoles=ts,wasm] [--amp=0.01]
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { closedLoopMagnitudeDb, nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { arg, fundamentalOf, renderTs, renderWasm, sine } from "./lib";

const baseline = process.argv.includes("--baseline"); // unchanged main: no stamp field, so no GBP declared and no stamp check (GBP is the 1e6 constant)
const modes = arg("modes", "os4").split(",");
const consoles = arg("consoles", "ts,wasm").split(",");
const amp = Number(arg("amp", "0.01"));
const gains: Array<[number, number, number]> = [[10, 9000, 1000], [100, 99000, 1000]];
const gbps = baseline ? [1e6] : [1e6, 3e6, 1e7];
const freqs = [100, 250, 500, 1000, 2000, 3150, 4000, 6300, 8000, 10000, 12500, 16000];
const SETTLE = 0.05, WINDOW = 0.25;
for (const mode of modes) {
	const rate = mode === "n768" ? 768000 : mode === "n192" ? 192000 : 48000, os = mode === "os8" ? 8 : mode === "os4" ? 4 : mode === "os2" ? 2 : 1;
	for (const cn of consoles) {
		console.log(`\n== ${cn} ${mode}: measured minus analytic closed loop (dB), ${amp * 1000} mV sine`);
		console.log(`G    GBP     |${freqs.map((f) => String(f).padStart(7)).join("")} | max|err| f<=10k | corner(Hz)`);
		for (const [g, rf, rg] of gains) {
			for (const gbp of gbps) {
				const r = compile(nonInvertingStage({ rfOhms: rf, rgOhms: rg, ...(baseline ? {} : { gbp: `${gbp} Hz` }) }), { registry: emptyRegistry });
				if (r.status !== "ok") throw new Error(`stage did not compile: ${r.status}`);
				const stamp = r.program.blocks.flatMap((b) => (b.kind === "mna" ? b.stamps : [])).find((s) => s.kind === "ideal-opamp") as any;
				if (!baseline && stamp?.gainBandwidthHz !== gbp) throw new Error(`stamp carries ${stamp?.gainBandwidthHz}, expected ${gbp}`);
				const errs: number[] = [];
				for (const hz of freqs) {
					const n = Math.round(rate * (SETTLE + WINDOW));
					const input = sine(n, hz, amp, rate);
					const out = cn === "ts" ? renderTs(r.program, {}, input, { rate, os }).out : renderWasm(r.program, {}, input, { rate, os }).then((x) => x.out);
					const o = await out;
					const w = Float64Array.from(o as ArrayLike<number>);
					const fund = fundamentalOf(w.subarray(Math.round(rate * SETTLE)), rate, hz);
					const measuredDb = 20 * Math.log10(fund / amp);
					errs.push(measuredDb - closedLoopMagnitudeDb(g, gbp, hz));
				}
				const maxErr = Math.max(...errs.filter((_, i) => freqs[i]! <= 10000).map(Math.abs));
				const corner = gbp * (1 / 1e5 + 1 / g);
				console.log(`${String(g).padEnd(4)} ${(gbp / 1e6).toFixed(0).padStart(2)} MHz  |${errs.map((e) => (e >= 0 ? "+" : "") + e.toFixed(3).padStart(6)).join("")} | ${maxErr.toFixed(3)}        | ${corner.toFixed(0)}`);
			}
		}
	}
}

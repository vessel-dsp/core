// The transparent / active boundary of the pole: `poleHz = GBP / A0 >= fs / 2` returns the no-pole limit. Is the response continuous across it, and by how much does it jump?
// For each solver rate (os1..os8 at 48 kHz) a G = 2 non-inverting stage is rendered with A0 just ABOVE the boundary (pole below Nyquist: ACTIVE) and just BELOW it (pole above
// Nyquist: TRANSPARENT), at 1 mV; the residual against the continuous closed form (which knows A0) is taken for each, and the JUMP is the difference of the two residuals (dB):
// the model's discontinuity at that frequency, the change in what the engine says about the true law when the rule flips. From whichever tree this is run in (BE on main, TR on the change).
//   bun docs/spikes/pole-order2/boundary.ts [--console=ts|wasm] [--gain=2]
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { continuousClosedLoopDb } from "./closed-forms";
import { arg, fundamentalOf, renderTs, renderWasm, sine } from "./lib";
const cn = arg("console", "ts"), G = Number(arg("gain", "2"));
const freqs = [1000, 4000, 8000, 12500, 16000];
console.log(`gain ${G} stage, ${cn} console, 1 mV: residual vs the continuous closed form (dB) for A0 just below the boundary (transparent) and just above (active), and the jump`);
console.log("os  A0 transparent / active | residual transparent: " + freqs.map((f) => String(f).padStart(7)).join("") + " | residual active: " + freqs.map((f) => String(f).padStart(7)).join("") + " | jump: " + freqs.map((f) => String(f).padStart(7)).join(""));
for (const os of [1, 2, 4, 8]) {
	const fs = 48000 * os, boundary = 1e6 / (fs / 2);
	const a0s = [Math.max(G * 1.05, boundary * 0.97), boundary * 1.03] as const; // transparent (A0 smaller: pole higher), active (A0 larger: pole lower)
	const res: number[][] = [];
	for (const aol of a0s) {
		const r = compile(nonInvertingStage({ rfOhms: (G - 1) * 1000, rgOhms: 1000, aol }), { registry: emptyRegistry });
		if (r.status !== "ok") throw new Error("stage");
		res.push(await Promise.all(freqs.map(async (hz) => {
			if (hz >= 24000) return Number.NaN;
			const n = Math.round(48000 * 0.3), input = sine(n, hz, 0.001);
			const y = cn === "ts" ? renderTs(r.program, {}, input, { rate: 48000, os, sourceOhms: 0, block: n }).out : Float64Array.from((await renderWasm(r.program, {}, input, { rate: 48000, os, sourceOhms: 0, block: n })).out);
			return 20 * Math.log10(fundamentalOf(Float64Array.from(y).subarray(2400), 48000, hz) / 0.001) - continuousClosedLoopDb(G, 1e6, hz, aol);
		})));
	}
	const f = (v: number) => (Number.isNaN(v) ? "    n/a" : v.toFixed(3).padStart(7));
	console.log(`x${os} ${a0s[0].toFixed(1)} / ${a0s[1].toFixed(1)} | ${res[0]!.map(f).join("")} | ${res[1]!.map(f).join("")} | ${res[1]!.map((v, i) => f(v - (res[0]![i] as number))).join("")}`);
}

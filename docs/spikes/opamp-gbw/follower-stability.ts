// Item 4, high-GBP parts at os1: a unity-gain stage (and a gain-10 stage) with a typed GBP of 1, 3, 10, 15, 19 and 30 MHz -- the
// figures the workbench registry carries for LM833 / JRC4580 (15), LF412 (19) and AD712 (30) -- put the closed-loop corner far above
// Nyquist at 48 kHz. Check: finite and bounded output, unity-gain level, non-converged samples and iterations per sample, at 10 mV and
// 1 V, os1 and os4, TS (telemetry) and WASM (peak iterations). These GBP values are TEST STIMULI for stability, not catalog entries.
//   bun docs/spikes/opamp-gbw/follower-stability.ts
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { fundamentalOf, renderTs, renderWasm, sine } from "./lib";

const N = 48000;
console.log("stage          GBP     amp   os | TS: level(dB) finite NC it/host peak | WASM: level(dB) peak");
for (const [label, rf, rg] of [["unity (G=1)", 1, 1e9], ["G=10", 9000, 1000]] as const) {
	for (const gbp of [1e6, 3e6, 1e7, 1.5e7, 1.9e7, 3e7]) {
		const r = compile(nonInvertingStage({ rfOhms: rf, rgOhms: rg, gbp: `${gbp} Hz` }), { registry: emptyRegistry });
		if (r.status !== "ok") throw new Error("compile");
		for (const amp of [0.01, 1]) for (const os of [1, 4]) {
			const input = sine(N, 1000, amp);
			const t = renderTs(r.program, {}, input, { os });
			const w = await renderWasm(r.program, {}, input, { os });
			const lvlT = 20 * Math.log10(fundamentalOf(t.out.subarray(N >> 1), 48000, 1000) / amp);
			const lvlW = 20 * Math.log10(fundamentalOf(Float64Array.from(w.out.subarray(N >> 1)), 48000, 1000) / amp);
			console.log(`${label.padEnd(13)} ${(gbp / 1e6).toFixed(0).padStart(3)} MHz ${String(amp).padEnd(5)} x${os} | ${lvlT.toFixed(3).padStart(8)} ${String(t.out.every((v) => Number.isFinite(v))).padEnd(5)} ${String(t.nonConverged).padStart(3)} ${(t.iterations / N).toFixed(3)} ${String(t.peak).padStart(4)} | ${lvlW.toFixed(3).padStart(8)} ${String(w.peak).padStart(4)}`);
		}
	}
}

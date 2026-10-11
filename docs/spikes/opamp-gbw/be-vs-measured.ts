// Measured (both consoles, os4 = 192 kHz internal) vs the BACKWARD-EULER discrete closed form, per stage x GBP, 100 Hz-16 kHz.
// If the engine implements opAmpPoleAlpha's law exactly, measured minus BE-discrete is ~0 even where measured minus the
// continuous single pole is not. Run from a tree with the stamp field wired.
//   bun docs/spikes/opamp-gbw/be-vs-measured.ts [--mode=os4]
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { closedLoopMagnitudeDb } from "../../../packages/runtime/tests/non-inverting-stage";
import { beClosedLoopDb } from "./be-closed-form";
import { arg, fundamentalOf, renderTs, renderWasm, sine } from "./lib";

const mode = arg("mode", "os4");
const rate = mode === "n192" ? 192000 : 48000, os = mode === "os4" ? 4 : mode === "os2" ? 2 : 1;
const fs = rate * os;
const amp = 0.01, SETTLE = 0.05, WINDOW = 0.25;
const freqs = [100, 1000, 2000, 4000, 6300, 8000, 10000, 12500, 16000];
console.log(`${mode}: internal rate ${fs} Hz. cell = measured - X (dB); X = continuous single pole | X = BE discrete closed form`);
console.log(`console G    GBP    |${freqs.map((f) => String(f).padStart(15)).join("")} | max|vs BE| (all f)`);
for (const cn of ["ts", "wasm"] as const) for (const [g, rf, rg] of [[10, 9000, 1000], [100, 99000, 1000]] as const) for (const gbp of [1e6, 3e6, 1e7]) {
	const r = compile(nonInvertingStage({ rfOhms: rf, rgOhms: rg, gbp: `${gbp} Hz` }), { registry: emptyRegistry });
	if (r.status !== "ok") throw new Error("compile");
	const cells: string[] = []; let worst = 0;
	for (const hz of freqs) {
		const n = Math.round(rate * (SETTLE + WINDOW));
		const o = cn === "ts" ? renderTs(r.program, {}, sine(n, hz, amp, rate), { rate, os }).out : (await renderWasm(r.program, {}, sine(n, hz, amp, rate), { rate, os })).out;
		const fund = fundamentalOf(Float64Array.from(o as ArrayLike<number>).subarray(Math.round(rate * SETTLE)), rate, hz);
		const m = 20 * Math.log10(fund / amp);
		const eC = m - closedLoopMagnitudeDb(g, gbp, hz), eB = m - beClosedLoopDb(g, gbp, hz, fs);
		worst = Math.max(worst, Math.abs(eB));
		cells.push(`${eC.toFixed(3).padStart(7)}|${eB.toFixed(3).padStart(7)}`);
	}
	console.log(`${cn.padEnd(7)} ${String(g).padEnd(4)} ${(gbp / 1e6).toFixed(0).padStart(2)} MHz |${cells.join(" ")} | ${worst.toFixed(4)}`);
}

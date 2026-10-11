// SCRATCH-ONLY rate scan (coordinator condition 3): separates the two mechanisms behind the engine's HF change, the declared product and
// the backward-Euler pole's discretisation error, WITHOUT changing the pole in the diff. TS console at native host rates 192 / 384 /
// 768 kHz (oversample 1: the BE step dt falls as 1/rate, so its error falls ~linearly and 768 kHz approximates the continuous pole), the
// product forced on every op-amp stamp to 1e6 and to 3e6 (the SD-1's 3e6 is a SCAN VARIABLE here, not its stamp, which is null),
// 10 mV, settle 0.5 s + 0.5 s window, no source impedance.
//   bun docs/spikes/opamp-gbw/rate-scan.ts --pedal=ts9 --rate=192000 --out=<json> [--states=..] [--freqs=1000,8000,12500,16000] [--gbps=1e6,3e6]
import { writeFileSync } from "node:fs";
import type { Program } from "@vessel-dsp/compiler";
import { PACKETS, STATES, arg, compileFile, fundamentalOf, renderTs, sine } from "./lib";

const pedal = arg("pedal", "ts9"), rate = Number(arg("rate", "192000")), out = arg("out", "");
const states = arg("states", "centre,drive-max,drive-min").split(",");
const freqs = arg("freqs", "1000,8000,12500,16000").split(",").map(Number);
const gbps = arg("gbps", "1e6,3e6").split(",").map(Number);
const SETTLE = 0.5, WINDOW = 0.5;
const base = compileFile(PACKETS[pedal]!.file);
const withGbp = (gbp: number): Program => ({ ...base, blocks: base.blocks.map((b) => b.kind === "mna" ? { ...b, stamps: b.stamps.map((s) => s.kind === "ideal-opamp" ? { ...s, gainBandwidthHz: gbp } : s) } : b) }) as Program;
const rows: Array<Record<string, unknown>> = [];
for (const gbp of gbps) {
	const program = withGbp(gbp);
	for (const state of states) {
		const cells: string[] = [];
		for (const hz of freqs) {
			const n = Math.round(rate * (SETTLE + WINDOW));
			const o = renderTs(program, STATES[state]!, sine(n, hz, 0.01, rate), { rate, os: 1, sourceOhms: 0, block: n });
			const fund = fundamentalOf(o.out.subarray(Math.round(rate * SETTLE)), rate, hz) * 1000;
			rows.push({ pedal, state, hz, rate, gbp, fund_mV: fund, nc: o.nonConverged });
			cells.push(`${hz}:${fund.toFixed(3)}`);
		}
		console.log(`${pedal} @${rate} GBP ${gbp / 1e6} MHz ${state.padEnd(9)} ${cells.join("  ")}`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

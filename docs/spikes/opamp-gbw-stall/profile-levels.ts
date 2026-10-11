// G3 / G6 instrument: the six profile packets and the Rat study fixture, a 1 kHz, 8 kHz and 16 kHz second at --amp
// (default 0.1 V, the movement harness's level; 0.01 is the hardware study's), at x1 and os4. Level = the WASM
// console's harmonic-LS fundamental of the last 0.5 s (mV); cost = TS console iterations per host sample and
// non-converged count at 1 kHz. Run before and after a solver change and diff with profile-levels-compare.py.
//   bun docs/spikes/opamp-gbw-stall/profile-levels.ts --out=<json> [--amp=0.1] [--packets=muff,sd1,...] [--os=1,4]
import { writeFileSync } from "node:fs";
import { PACKETS, RATE, arg, controlsFor, fundamentalOf, programFor, renderTs, renderWasm, sine } from "./lib";
const RAT = "/home/joseph/projects/VesselDSP/workbench/packet-study/pro-co-rat-2-v4b-op07cp/pro-co-rat-2-v4b-op07cp.fixture.vdsp";
const names = arg("packets", [...Object.keys(PACKETS), "rat"].join(",")).split(",");
const factors = arg("os", "1,4").split(",").map(Number), amp = Number(arg("amp", "0.1")), out = arg("out", "");
const N = RATE;
const rows: Array<Record<string, unknown>> = [];
for (const name of names) {
	const program = programFor(name === "rat" ? RAT : name);
	const controls = controlsFor(name);
	for (const os of factors) {
		const row: Record<string, unknown> = { packet: name, os, amp };
		const t0 = Date.now();
		for (const hz of [1000, 8000, 16000]) {
			const input = sine(N, hz, amp);
			const w = await renderWasm(program, controls, input, { os });
			row[`wasm_${hz}_mV`] = fundamentalOf(Float64Array.from(w.out.subarray(N >> 1)), RATE, hz) * 1000;
			row[`wasm_${hz}_peak`] = w.peak;
			if (hz === 1000) {
				const t = renderTs(program, controls, input, { os });
				row.ts_it = t.iterations / N; row.ts_nc = t.nonConverged; row.ts_peak = t.peak;
				row.ts_1000_mV = fundamentalOf(t.out.subarray(N >> 1), RATE, hz) * 1000;
			}
		}
		row.ms = Date.now() - t0;
		rows.push(row);
		console.log(`${name.padEnd(9)} os${os} amp ${amp}: 1k ${(row.wasm_1000_mV as number).toFixed(3)} 8k ${(row.wasm_8000_mV as number).toFixed(3)} 16k ${(row.wasm_16000_mV as number).toFixed(3)} mV | TS it/host ${(row.ts_it as number).toFixed(3)} nc ${row.ts_nc} peak ${row.ts_peak} | ${row.ms} ms`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows, null, 1));

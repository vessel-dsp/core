// Check 1 (baseline) and 2(b)/2(c): output hashes of the x1 and os4 renders of the three study pedals, on both
// consoles, from whichever tree this is run in. 1 kHz 10 mV, 1 s at 48 kHz, cap 1024, 512-frame blocks, study
// controls (Drive/Sustain 0.5, Tone 0.5, Level/Volume 0.3) set after prepare. TS = sha256 of the Float64 output,
// WASM = sha256 of the Float32 output (the console's native width).
//   bun docs/spikes/opamp-gbw/baseline-render.ts --label=baseline [--packets=muff,sd1,ts9]
import type { Program } from "@vessel-dsp/compiler";
import { PACKETS, RATE, arg, compileFile, renderTs, renderWasm, sha256, sine } from "./lib";

const label = arg("label", "now");
const slugs = arg("packets", "muff,sd1,ts9").split(",");
const N = 48000;
// --force-gbp=null|<hertz>: set every op-amp stamp's gainBandwidthHz before rendering (2(b) identity controls: a null or 1e6 stamp
// must hash exactly as unchanged main, whose consoles run the 1e6 constant). Default (absent): render the program as compiled.
const force = arg("force-gbp", "");
const forced = (program: Program): Program =>
	force === "" ? program : ({ ...program, blocks: program.blocks.map((b) => b.kind === "mna" ? { ...b, stamps: b.stamps.map((s) => s.kind === "ideal-opamp" ? { ...s, gainBandwidthHz: force === "null" ? null : Number(force) } : s) } : b) } as Program);
const input = sine(N, 1000, 0.01);
console.log(`[${label}] renders: 1 kHz 10 mV, ${N} samples at ${RATE} Hz, cap 1024, block 512`);
for (const slug of slugs) {
	const spec = PACKETS[slug]!;
	const program = forced(compileFile(spec.file));
	for (const os of [1, 4]) {
		const w = await renderWasm(program, spec.controls, input, { os });
		const t = renderTs(program, spec.controls, input, { os });
		let maxAbs = 0;
		for (let i = 0; i < N; i += 1) maxAbs = Math.max(maxAbs, Math.abs((t.out[i] as number) - (w.out[i] as number)));
		console.log(`${slug.padEnd(5)} os${os} TS f64 sha256=${sha256(t.out)} it/host=${(t.iterations / N).toFixed(3)} peak=${t.peak} NC=${t.nonConverged} | WASM f32 sha256=${sha256(w.out)} peak=${w.peak} | TS-vs-WASM maxAbs=${maxAbs.toExponential(2)}`);
	}
}

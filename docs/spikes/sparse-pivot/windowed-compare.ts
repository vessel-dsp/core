// Windowed sparse-vs-dense: split the measured window into chunks, render both
// paths chunk by chunk (state carries across chunks within a path), and report
// per-chunk agreement + cap-hits. Localises divergence in time: divergent
// chunks that coincide with cap-hit chunks are Newton/cap-driven, not pivot
// error (a pivot defect would bias every chunk).
//
// Usage:
//   bun docs/spikes/sparse-pivot/windowed-compare.ts --packet=boss-mt-2 [--amps]
//       [--warmup=2400] [--samples=9600] [--chunks=10]
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import {
	arg,
	loadProgram,
	nullSchedules,
	relRms,
	tone,
	type Program,
} from "./lib";

const packet = arg("packet", "boss-mt-2");
const AMPS = process.argv.includes("--amps");
const WARMUP = Number(arg("warmup", "2400"));
const SAMPLES = Number(arg("samples", "9600"));
const CHUNKS = Number(arg("chunks", "10"));

const program = loadProgram(packet, AMPS);
const sparse = new ReferenceRuntime(structuredClone(program));
sparse.prepare(48000, { maxNewtonIterations: 64 });
const dense = new ReferenceRuntime(nullSchedules(program));
dense.prepare(48000, { maxNewtonIterations: 64 });
sparse.process(tone(WARMUP));
dense.process(tone(WARMUP));

const per = Math.floor(SAMPLES / CHUNKS);
console.log(`${packet}: ${CHUNKS} chunks of ${per} samples after ${WARMUP} warmup`);
for (let c = 0; c < CHUNKS; c += 1) {
	const input = tone(SAMPLES + c * per).subarray(SAMPLES, SAMPLES + per);
	// Phase-continuous slice: regenerate from absolute index instead.
	const slice = new Float64Array(per);
	const base = WARMUP + c * per;
	for (let i = 0; i < per; i += 1) {
		slice[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * (base + i)) / 48000);
	}
	const s0 = sparse.telemetry().nonConvergedSamples;
	const d0 = dense.telemetry().nonConvergedSamples;
	const sOut = sparse.process(slice);
	const dOut = dense.process(slice);
	const s1 = sparse.telemetry().nonConvergedSamples;
	const d1 = dense.telemetry().nonConvergedSamples;
	void input;
	console.log(
		`  chunk ${c}: agree=${relRms(Float64Array.from(sOut), Float64Array.from(dOut)).toExponential(1)} ` +
			`sNC=${s1 - s0} dNC=${d1 - d0}`,
	);
}

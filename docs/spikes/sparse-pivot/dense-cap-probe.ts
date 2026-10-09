// Dense cap-sensitivity probe: renders forced-dense at cap 64 and cap 1024
// (same warmup+samples) and compares. If dense moves with the cap more than
// sparse moves from dense, the packet's disagreement level is solver-path
// noise, not a pivot defect -- the "dense itself is unstable" judgment.
//
// Usage:
//   bun docs/spikes/sparse-pivot/dense-cap-probe.ts --packet=boss-od-3 [--amps]
//       [--warmup=2400] [--samples=9600]
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import {
	arg,
	loadProgram,
	nullSchedules,
	relRms,
	tone,
	type Program,
} from "./lib";

const packet = arg("packet", "boss-od-3");
const AMPS = process.argv.includes("--amps");
const WARMUP = Number(arg("warmup", "2400"));
const SAMPLES = Number(arg("samples", "9600"));

function renderDense(cap: number): { out: Float64Array; nonConv: number; warmNC: number; meanIter: number; stalled: number; flagged: number; peak: number } {
	const program = nullSchedules(loadProgram(packet, AMPS));
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(48000, { maxNewtonIterations: cap });
	runtime.process(tone(WARMUP));
	const tWarm = runtime.telemetry();
	const out = Float64Array.from(runtime.process(tone(SAMPLES)));
	const t1 = runtime.telemetry();
	return {
		out,
		nonConv: t1.nonConvergedSamples - tWarm.nonConvergedSamples,
		warmNC: tWarm.nonConvergedSamples,
		meanIter: (t1.totalIterations - tWarm.totalIterations) / Math.max(t1.samples - tWarm.samples, 1),
		stalled: t1.stalledSamples - tWarm.stalledSamples,
		flagged: t1.solvedButFlaggedSamples - tWarm.solvedButFlaggedSamples,
		peak: t1.peakIterations,
	};
}

const a = renderDense(64);
const b = renderDense(1024);
console.log(
	`${packet}: dense64-vs-dense1024=${relRms(a.out, b.out).toExponential(1)} ` +
		`cap64[nonConv=${a.nonConv} stall=${a.stalled} flag=${a.flagged} peak=${a.peak} warmNC=${a.warmNC} mean=${a.meanIter.toFixed(2)}] ` +
		`cap1024[nonConv=${b.nonConv} stall=${b.stalled} flag=${b.flagged} peak=${b.peak} warmNC=${b.warmNC} mean=${b.meanIter.toFixed(2)}]`,
);

// Baseline 2 (read-only): the pivot report's sparse-vs-dense instrument
// (docs/spikes/sparse-pivot/sparse-vs-dense.ts) copied with two additions: --os=N
// (prepare oversample) and the six profile packets by slug with the oversampling report's
// study controls for muff/sd1/ts9. Method unchanged: 48 kHz, 1 kHz @ 0.1 V, cap 64,
// 2400 warmup + 9600 measured host samples, forced-dense = every block's schedule nulled.
//
//   bun docs/spikes/newton-budget/sparse-vs-dense.ts --packet=muff,sd1 --os=4 [--cap=64]
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, nullSchedules, relRms, tone, fmt } from "./lib";
import type { Program } from "@vessel-dsp/compiler";

const only = arg("packet", Object.keys(PACKETS).join(",")).split(",");
const OS = Number(arg("os", "1"));
const CAP = Number(arg("cap", "64"));
const WARMUP = Number(arg("warmup", "2400"));
const SAMPLES = Number(arg("samples", "9600"));
const BUDGET_NS = 20_833;

function runOnce(program: Program, controls: Record<string, number>, warmup: Float64Array, signal: Float64Array) {
	const rt = new ReferenceRuntime(program);
	rt.prepare(48000, { maxNewtonIterations: CAP, ...(OS > 1 ? { oversample: OS } : {}) });
	for (const [k, v] of Object.entries(controls)) rt.setControl(k, v);
	rt.process(warmup);
	const tWarm = rt.telemetry();
	const start = process.hrtime.bigint();
	const output = rt.process(signal);
	const ns = Number(process.hrtime.bigint() - start) / signal.length;
	const t1 = rt.telemetry();
	const plan = rt.solverPlan();
	return {
		output: Float64Array.from(output), ns,
		nc: t1.nonConvergedSamples - tWarm.nonConvergedSamples, warmNc: tWarm.nonConvergedSamples,
		peak: t1.peakIterations, meanHost: (t1.totalIterations - tWarm.totalIterations) / (t1.samples - tWarm.samples),
		fb: plan.scheduleFallbacks, solves: plan.scheduleSolves, repiv: [...plan.repivoted], drop: [...plan.dropped], aband: [...plan.abandoned],
	};
}

const warm = tone(WARMUP);
const sig = tone(SAMPLES, 0.1, 1000, 48000, WARMUP);
console.log(`sparse-vs-dense os=${OS} cap=${CAP} warmup=${WARMUP} samples=${SAMPLES} (host samples; 1 kHz 0.1 V)`);
for (const slug of only) {
	const spec = PACKETS[slug];
	if (spec === undefined) { console.log(`${slug}: unknown`); continue; }
	const program = compileFile(spec.file);
	const s = runOnce(program, spec.controls, warm, sig);
	const d = runOnce(nullSchedules(program), spec.controls, warm, sig);
	const r = relRms(s.output, d.output);
	console.log(`${slug.padEnd(9)} relRms=${r.rel.toExponential(1)} absRms=${r.abs.toExponential(1)} denseRms=${r.refRms.toExponential(2)} sNC=${s.nc}/${SAMPLES} dNC=${d.nc} wNC=${s.warmNc}/${d.warmNc} sPeak=${s.peak} dPeak=${d.peak} sMean/host=${fmt(s.meanHost, 2)} dMean/host=${fmt(d.meanHost, 2)} (per sub ${fmt(s.meanHost / OS, 2)}/${fmt(d.meanHost / OS, 2)}) sxRT=${fmt(s.ns / BUDGET_NS, 2)} dxRT=${fmt(d.ns / BUDGET_NS, 2)} fb=${s.fb}/${s.solves} repiv=[${s.repiv}] drop=[${s.drop}] aband=[${s.aband}]`);
}

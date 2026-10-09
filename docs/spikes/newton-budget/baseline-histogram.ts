// Baseline 1 (read-only): iteration histograms at the deadline instrument's settle --
// a copy of ~/projects/VesselDSP/workbench/scripts/report-newton-deadline.ts's method:
// 48 kHz, 1 kHz sine at 0.1 V, 960 warmup + 960 steady host samples (x OVERSAMPLE for the
// sub-sample count), one-sample process() calls, per-host-sample iteration deltas from
// telemetry().totalIterations. Default controls unless --study (muff/sd1/ts9 study controls).
//
//   bun docs/spikes/newton-budget/baseline-histogram.ts --packet=gro100,blue-box,ts808 --cap=64 --os=1
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, flag, fmt } from "./lib";

const only = arg("packet", "gro100,blue-box,ts808").split(",");
const CAP = Number(arg("cap", "64"));
const OS = Number(arg("os", "1"));
const WARM = Number(arg("warmup", "960"));
const STEADY = Number(arg("samples", "960"));
const study = flag("study");

for (const slug of only) {
	const spec = PACKETS[slug];
	if (spec === undefined) { console.log(`${slug}: not a profile packet`); continue; }
	const program = compileFile(spec.file);
	const rt = new ReferenceRuntime(program);
	rt.prepare(48000, { maxNewtonIterations: CAP, ...(OS > 1 ? { oversample: OS } : {}) });
	if (study) for (const [k, v] of Object.entries(spec.controls)) rt.setControl(k, v);
	const chunk = new Float64Array(1);
	const input = (i: number) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
	for (let i = 0; i < WARM; i += 1) { chunk[0] = input(i); rt.process(chunk); }
	const tWarm = rt.telemetry();
	const hist = new Map<number, number>();
	let last = tWarm.totalIterations;
	let steadyIters = 0, capHits = 0, capIters = 0, ncBefore = tWarm.nonConvergedSamples;
	for (let i = 0; i < STEADY; i += 1) {
		chunk[0] = input(WARM + i);
		rt.process(chunk);
		const t = rt.telemetry();
		const d = t.totalIterations - last;
		last = t.totalIterations;
		steadyIters += d;
		hist.set(d, (hist.get(d) ?? 0) + 1);
		// A host sample "hits the cap" when any of its sub-samples burned the cap (the
		// deadline instrument's `itersThisSample >= cap` at os1; at osN a host sample with
		// one capped sub-sample shows >= cap too, so the same test holds).
		if (d >= CAP) { capHits += 1; capIters += d; }
	}
	const t = rt.telemetry();
	const sorted = [...hist.entries()].sort((a, b) => a[0] - b[0]);
	console.log(`${slug} cap=${CAP} os=${OS} warm=${WARM} steady=${STEADY} controls=${study ? "study" : "default"}`);
	console.log(`  steady mean/host=${fmt(steadyIters / STEADY, 2)} mean/sub=${fmt(steadyIters / STEADY / OS, 2)} peak=${t.peakIterations} cap-hit host samples=${capHits} (${fmt(100 * capHits / STEADY)}%) carrying ${fmt(100 * capIters / Math.max(1, steadyIters))}% of iterations; nonConverged warm=${ncBefore} steady=${t.nonConvergedSamples - ncBefore}`);
	console.log(`  histogram: ${sorted.map(([k, v]) => `${k}:${v}`).join(", ")}`);
}

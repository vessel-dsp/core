// Per-method measurement: iterations / factorisations / assembles / convergence checks per
// host sample, non-converged host samples, output agreement with an independent dense
// full-Newton run (shipped loop, schedules nulled), and -- with --fixed-point -- the worst
// per-sub-sample deviation of the solution vector from a dense full-Newton twin solved from
// the same state (tolerance units: |dx| / (reltol*|x| + vntol); <= 1 is "within the
// convergence tolerances").
//
// Harness: ReferenceRuntime in-process, 48 kHz host, 1 kHz sine at 0.1 V, cap 64 (default),
// 2400 warmup + 9600 measured host samples (the pivot report's window), study controls for
// muff/sd1/ts9, default controls otherwise. Counters cover every standard-audio-pass solve of
// every nonlinear block, measured window only.
//
//   bun docs/spikes/newton-budget/measure.ts --packet=ts808 --os=1,4 --method=shipped,m1lin,m4 [--fixed-point] [--cap=64] [--out=x.jsonl]
import { appendFileSync, existsSync } from "node:fs";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import type { Program } from "@vessel-dsp/compiler";
import { ARTIFACT_CORPUS, PACKETS, arg, compileFile, nullSchedules, relRms, tone, fmt, flag, sha256 } from "./lib";
import * as scratch from "./scratch-newton";

export const METHODS: Record<string, Partial<scratch.ScratchConfig>> = {
	shipped: {},
	m1lin: { predictor: "linear" },
	m1quad: { predictor: "quadratic" },
	m1wrong: { predictor: "wrong-sign" },
	m1adapt: { predictor: "adaptive" },
	m1adapt2: { predictor: "adaptive2" },
	m1adapt3: { predictor: "adaptive3" },
	m4adapt: { predictor: "adaptive", chord: "within", chordRatio: 0.5, chordAccept: "bound" },
	m2within: { chord: "within", chordRatio: 0.5 },
	m2within25: { chord: "within", chordRatio: 0.25 },
	m2across: { chord: "across", chordRatio: 0.5 },
	m2across25: { chord: "across", chordRatio: 0.25 },
	m2acrossB: { chord: "across", chordRatio: 0.5, chordAccept: "bound" },
	m2nostall: { chord: "across", chordRatio: 0.5, chordStallDisabled: true },
	m3within: { chord: "within", chordRatio: 0.5, broyden: true },
	m3across: { chord: "across", chordRatio: 0.5, broyden: true },
	m4: { predictor: "linear", chord: "across", chordRatio: 0.5 },
	m4B: { predictor: "linear", chord: "across", chordRatio: 0.5, chordAccept: "bound" },
	m4within: { predictor: "linear", chord: "within", chordRatio: 0.5 },
	m4broyden: { predictor: "linear", chord: "across", chordRatio: 0.5, broyden: true },
	m4quad: { predictor: "quadratic", chord: "across", chordRatio: 0.5 },
};

export type RunResult = {
	output: Float64Array;
	hash: string;
	ns: number;
	nc: number;
	warmNc: number;
	peak: number;
	meanHost: number;
	counters: scratch.Counters;
	fb: number;
	solves: number;
};

export function runPacket(program: Program, controls: Record<string, number>, os: number, cap: number, warmup: Float64Array, signal: Float64Array, config: Partial<scratch.ScratchConfig> | null, ohms = 0): RunResult {
	if (config === null) scratch.uninstall();
	else { scratch.install(); scratch.configure(config); }
	const rt = new ReferenceRuntime(program);
	rt.prepare(48000, { maxNewtonIterations: cap, inputSourceOhms: ohms, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controls)) rt.setControl(k, v);
	rt.process(warmup);
	const tWarm = rt.telemetry();
	scratch.resetCounters();
	const start = process.hrtime.bigint();
	const output = rt.process(signal);
	const ns = Number(process.hrtime.bigint() - start) / signal.length;
	const t1 = rt.telemetry();
	const plan = rt.solverPlan();
	const out = Float64Array.from(output);
	scratch.uninstall();
	return {
		output: out, hash: sha256(out), ns,
		nc: t1.nonConvergedSamples - tWarm.nonConvergedSamples, warmNc: tWarm.nonConvergedSamples,
		peak: t1.peakIterations, meanHost: (t1.totalIterations - tWarm.totalIterations) / (t1.samples - tWarm.samples),
		counters: scratch.snapshotCounters(), fb: plan.scheduleFallbacks, solves: plan.scheduleSolves,
	};
}

if (import.meta.main) {
	const packets = arg("packet", Object.keys(PACKETS).join(",")).split(",");
	const factors = arg("os", "1").split(",").map(Number);
	const methods = arg("method", "shipped,m1lin,m2across,m4").split(",");
	const CAP = Number(arg("cap", "64"));
	const WARMUP = Number(arg("warmup", "2400"));
	const SAMPLES = Number(arg("samples", "9600"));
	const fixedPoint = flag("fixed-point");
	const OUT = arg("out", "");
	const warm = tone(WARMUP);
	const sig = tone(SAMPLES, 0.1, 1000, 48000, WARMUP);
	console.log(`measure cap=${CAP} warmup=${WARMUP} samples=${SAMPLES} host samples, 1 kHz 0.1 V, fixedPoint=${fixedPoint}`);
	for (const slug of packets) {
		const spec = PACKETS[slug] ?? (existsSync(`${ARTIFACT_CORPUS}/${slug}.vdsp`) ? { file: `${ARTIFACT_CORPUS}/${slug}.vdsp`, controls: {}, ohms: 0 } : existsSync(`${ARTIFACT_CORPUS}/amps/${slug}.vdsp`) ? { file: `${ARTIFACT_CORPUS}/amps/${slug}.vdsp`, controls: {}, ohms: 0 } : undefined);
		if (spec === undefined) { console.log(`${slug}: unknown packet`); continue; }
		const program = compileFile(spec.file);
		for (const os of factors) {
			const dense = runPacket(nullSchedules(program), spec.controls, os, CAP, warm, sig, null);
			const shippedRun = runPacket(program, spec.controls, os, CAP, warm, sig, null);
			const known = relRms(shippedRun.output, dense.output);
			console.log(`\n${slug} os=${os}: shipped-vs-dense (known positive) relRms=${known.rel.toExponential(1)} maxAbs=${known.maxAbs.toExponential(1)} denseRms=${known.refRms.toExponential(2)} sNC=${shippedRun.nc} dNC=${dense.nc} shippedHash=${shippedRun.hash.slice(0, 12)}`);
			console.log(`  ${"method".padEnd(11)} ${"it/host".padStart(8)} ${"fac/host".padStart(9)} ${"asm/host".padStart(9)} ${"reuse/h".padStart(8)} ${"1-step%".padStart(8)} ${"relax".padStart(6)} ${"NC".padStart(5)} ${"peak".padStart(5)} ${"stall".padStart(6)} ${"cap".padStart(5)} ${"lim".padStart(6)} ${"brdy".padStart(6)} ${"relRms".padStart(8)} ${"maxAbs".padStart(8)} ${"xRT".padStart(6)} ${"devTol".padStart(8)} ${"dev>1".padStart(6)} ${"m>tw".padStart(6)} ${"tw-it/h".padStart(8)} ${"twNC".padStart(5)} hash`);
			for (const m of methods) {
				const config = METHODS[m];
				if (config === undefined) { console.log(`  ${m}: unknown method`); continue; }
				const r = runPacket(program, spec.controls, os, CAP, warm, sig, { ...config, fixedPointCheck: fixedPoint });
				const c = r.counters;
				const a = relRms(r.output, dense.output);
				const H = SAMPLES;
				const row = {
					packet: slug, os, method: m, cap: CAP, warmup: WARMUP, samples: SAMPLES,
					itPerHost: c.iterations / H, facPerHost: c.factorisations / H, asmPerHost: c.assembles / H, reusePerHost: c.reuseSolves / H,
					checksPerHost: c.convergenceChecks / H, oneStepShare: c.oneStepConverged / Math.max(1, c.subSamples), relaxEngaged: c.relaxEngaged,
					nc: r.nc, warmNc: r.warmNc, peak: r.peak, stallRefactors: c.stallRefactors, capRefactors: c.capRefactors, limitedRefactors: c.limitedRefactors, boundRejects: c.boundRejects, broydenUpdates: c.broydenUpdates,
					relRms: a.rel, maxAbs: a.maxAbs, denseRms: a.refRms, ns: r.ns, xRT: r.ns / 20833,
					worstDeviationTol: fixedPoint ? c.worstDeviationTol : null, deviationOver1: fixedPoint ? c.deviationOver1 : null, deviationOver0p1: fixedPoint ? c.deviationOver0p1 : null,
					methodMoreIterations: fixedPoint ? c.methodMoreIterations : null, extraIterationsVsTwin: fixedPoint ? c.extraIterationsVsTwin : null, twinItPerHost: fixedPoint ? c.twinIterations / H : null, twinNc: fixedPoint ? c.twinNonConverged : null, twinRelax: fixedPoint ? c.twinRelaxEngaged : null,
					limitedFirst: c.limitedFirstIterations, subSamples: c.subSamples, hash: r.hash, shippedHash: shippedRun.hash, fb: r.fb,
				};
				console.log(`  ${m.padEnd(11)} ${fmt(row.itPerHost, 3).padStart(8)} ${fmt(row.facPerHost, 3).padStart(9)} ${fmt(row.asmPerHost, 3).padStart(9)} ${fmt(row.reusePerHost, 3).padStart(8)} ${fmt(100 * row.oneStepShare).padStart(8)} ${String(row.relaxEngaged).padStart(6)} ${String(row.nc).padStart(5)} ${String(row.peak).padStart(5)} ${String(row.stallRefactors).padStart(6)} ${String(row.capRefactors).padStart(5)} ${String(c.limitedRefactors).padStart(6)} ${String(row.broydenUpdates).padStart(6)} ${a.rel.toExponential(1).padStart(8)} ${a.maxAbs.toExponential(1).padStart(8)} ${fmt(row.xRT, 2).padStart(6)} ${(fixedPoint ? fmt(c.worstDeviationTol, 3) : "-").padStart(8)} ${(fixedPoint ? String(c.deviationOver1) : "-").padStart(6)} ${(fixedPoint ? String(c.methodMoreIterations) : "-").padStart(6)} ${(fixedPoint ? fmt(c.twinIterations / H, 3) : "-").padStart(8)} ${(fixedPoint ? String(c.twinNonConverged) : "-").padStart(5)} ${r.hash.slice(0, 12)}${r.hash === shippedRun.hash ? " =shipped" : ""}`);
				if (OUT !== "") appendFileSync(OUT, `${JSON.stringify(row)}\n`);
			}
		}
	}
}

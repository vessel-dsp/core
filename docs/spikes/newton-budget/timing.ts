// Cost: ns per host sample, TS in-process, six profile packets at x1/os2/os4, 5 interleaved
// repeats (A, B, A, B, ...), median; iteration / factorisation / assemble counts beside the
// time so the saving is attributable. Window: 2400 warmup + 9600 timed host samples, 1 kHz
// 0.1 V, cap 64, study controls for muff/sd1/ts9 (the measurement tables' window).
//
//   A = the loop as shipped in this tree (scratch uninstalled); B = scratch loop with --method.
//   --no-b times A alone (used after the runtime change: A is then the patched shipped loop).
//
//   bun docs/spikes/newton-budget/timing.ts [--method=m1adapt] [--os=1,2,4] [--repeats=5] [--no-b]
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, flag, median, tone, fmt } from "./lib";
import { METHODS } from "./measure";
import * as scratch from "./scratch-newton";

const method = arg("method", "m1adapt");
const factors = arg("os", "1,2,4").split(",").map(Number);
const REPEATS = Number(arg("repeats", "5"));
const noB = flag("no-b");
const CAP = Number(arg("cap", "64"));
const warm = tone(2400);
const sig = tone(9600, 0.1, 1000, 48000, 2400);
const BUDGET = 20833;

function once(program: ReturnType<typeof compileFile>, controls: Record<string, number>, os: number, config: Partial<scratch.ScratchConfig> | null) {
	if (config === null) scratch.uninstall(); else { scratch.install(); scratch.configure(config); }
	const rt = new ReferenceRuntime(program);
	rt.prepare(48000, { maxNewtonIterations: CAP, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controls)) rt.setControl(k, v);
	rt.process(warm);
	const t0 = rt.telemetry();
	scratch.resetCounters();
	const start = process.hrtime.bigint();
	rt.process(sig);
	const ns = Number(process.hrtime.bigint() - start) / sig.length;
	const t1 = rt.telemetry();
	const c = scratch.snapshotCounters();
	scratch.uninstall();
	return { ns, itPerHost: (t1.totalIterations - t0.totalIterations) / 9600, fac: c.factorisations / 9600, asm: c.assembles / 9600, nc: t1.nonConvergedSamples - t0.nonConvergedSamples };
}
console.log(`timing method=${method} repeats=${REPEATS} cap=${CAP} window 2400+9600 host samples; ns/host sample (median of ${REPEATS}), xRT = ns/20833`);
console.log(`packet    os | A(shipped) ns   xRT  it/host | B(${method}) ns   xRT  it/host fac/host asm/host | B/A`);
for (const [slug, spec] of Object.entries(PACKETS)) {
	const program = compileFile(spec.file);
	for (const os of factors) {
		const a: number[] = [], b: number[] = [];
		let ai = 0, bi = 0, bf = 0, bs = 0, anc = 0, bnc = 0;
		for (let r = 0; r < REPEATS; r += 1) {
			const ra = once(program, spec.controls, os, null);
			a.push(ra.ns); ai = ra.itPerHost; anc = ra.nc;
			if (!noB) {
				const rb = once(program, spec.controls, os, METHODS[method] as Partial<scratch.ScratchConfig>);
				b.push(rb.ns); bi = rb.itPerHost; bf = rb.fac; bs = rb.asm; bnc = rb.nc;
			}
		}
		const ma = median(a), mb = noB ? Number.NaN : median(b);
		console.log(`${slug.padEnd(9)} ${String(os).padStart(2)} | ${fmt(ma, 0).padStart(9)} ${fmt(ma / BUDGET, 2).padStart(6)} ${fmt(ai, 3).padStart(8)} (NC ${anc}) | ${noB ? "-" : `${fmt(mb, 0).padStart(9)} ${fmt(mb / BUDGET, 2).padStart(6)} ${fmt(bi, 3).padStart(8)} ${fmt(bf, 3).padStart(8)} ${fmt(bs, 3).padStart(8)} (NC ${bnc}) | ${fmt(mb / ma, 3)}`}  (A runs: ${a.map((x) => fmt(x / BUDGET, 2)).join(" ")}${noB ? "" : `; B runs: ${b.map((x) => fmt(x / BUDGET, 2)).join(" ")}`})`);
	}
}

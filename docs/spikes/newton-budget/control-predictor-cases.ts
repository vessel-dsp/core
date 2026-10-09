// Control (d): one case where the predictor is known to help and one where it is known to
// hurt, through the real loop with the real counters.
//
// HELP: a smooth 1 kHz sinusoid (10 mV) through a linear RC (10k + 100 nF) that carries one
// diode which never conducts (10 mV << 0.5 V), so the block is nonlinear in the loop's eyes
// but linear in behaviour. At os4 (192 kHz solver rate) the quadratic predictor's error is
// ~1e-7 of the signal, far inside the 1e-3 relative tolerance, so ONE Newton step should
// converge on nearly every sub-sample; the shipped loop needs two (step + check).
//
// HURT: a hard +-1 V square at 1 kHz at x1 through the anti-parallel diode clipper. The
// sample after an edge is a jump; the linear predictor then extrapolates that jump onto the
// next sample (2*x1 - x2), overshooting across the clipping knee, so the first assembly is
// junction-limited and the sample costs more iterations than the shipped start would.
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { diodeClipper } from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import * as scratch from "./scratch-newton";
import { fmt } from "./lib";

const rcWithDiode = diodeClipper.replace(/ {2}- id: D2[\s\S]*?Description: "Clipping diode\."\n(?=wires)/, `  - id: C1
    kind: capacitor
    name: C_SHUNT
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 120
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 2
        position:
          x: 120
          y: -20
      - name: b
        node: 0
        position:
          x: 120
          y: 20
    properties:
      Capacitance: "100n"
      Description: "Shunt."
`);
if (rcWithDiode === diodeClipper) throw new Error("fixture derivation matched nothing");

function program(src: string) {
	const r = compile(src, { registry: pedalPartCatalog });
	if (r.status !== "ok") throw new Error(`compile ${r.status}`);
	return r.program;
}
type PerSample = { used: number; limitedFirst: boolean; relax: boolean };
function run(prog: ReturnType<typeof program>, os: number, input: (i: number) => number, n: number, warm: number, config: Partial<scratch.ScratchConfig>) {
	const per: PerSample[] = [];
	let acc: PerSample | null = null;
	scratch.install();
	scratch.configure({ ...config, onSubSample: (info) => {
		const it0 = info.iterations[0];
		const p = { used: info.used, limitedFirst: it0 !== undefined && it0.limited, relax: info.relaxEngaged };
		if (acc === null) acc = p; else { acc.used += p.used; acc.limitedFirst = acc.limitedFirst || p.limitedFirst; acc.relax = acc.relax || p.relax; }
	} });
	const rt = new ReferenceRuntime(prog);
	rt.prepare(48000, { maxNewtonIterations: 64, ...(os > 1 ? { oversample: os } : {}) });
	const chunk = new Float64Array(1);
	for (let i = 0; i < warm; i += 1) { chunk[0] = input(i); rt.process(chunk); }
	scratch.resetCounters();
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) { acc = null; chunk[0] = input(warm + i); out[i] = rt.process(chunk)[0] as number; per.push(acc as unknown as PerSample); }
	const c = scratch.snapshotCounters();
	scratch.uninstall();
	return { per, c, out };
}

// --- HELP ---
console.log("HELP case: 1 kHz 10 mV sine, RC + non-conducting diode, 480 warmup + 960 host samples, cap 64");
const rc = program(rcWithDiode);
const sine = (i: number) => 0.01 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
for (const os of [1, 4]) {
	for (const [name, cfg] of [["shipped", {}], ["m1lin", { predictor: "linear" }], ["m1quad", { predictor: "quadratic" }]] as const) {
		const r = run(rc, os, sine, 960, 480, cfg as Partial<scratch.ScratchConfig>);
		console.log(`  os=${os} ${name.padEnd(8)} it/sub=${fmt(r.c.iterations / r.c.subSamples, 3)} one-step=${fmt(100 * r.c.oneStepConverged / r.c.subSamples)}% fac/sub=${fmt(r.c.factorisations / r.c.subSamples, 3)} NC=${r.c.nonConverged} limitedFirst=${r.c.limitedFirstIterations} relax=${r.c.relaxEngaged}`);
	}
}
// --- HURT ---
console.log("\nHURT case: 1 kHz +-1 V square through the anti-parallel diode clipper at x1, 480 warmup + 960 host samples (40 edges), cap 64");
const clip = program(diodeClipper);
const square = (i: number) => (Math.floor(i / 24) % 2 === 0 ? 1 : -1);
const edgeOf = (i: number) => (i % 24 === 0 ? 0 : i % 24 === 1 ? 1 : i % 24 === 2 ? 2 : 3);
for (const [name, cfg] of [["shipped", {}], ["m1lin", { predictor: "linear" }], ["m1quad", { predictor: "quadratic" }]] as const) {
	const r = run(clip, 1, square, 960, 480, cfg as Partial<scratch.ScratchConfig>);
	const by = [0, 0, 0, 0], cnt = [0, 0, 0, 0], lim = [0, 0, 0, 0];
	r.per.forEach((p, i) => { const k = edgeOf(480 + i); by[k] += p.used; cnt[k] += 1; if (p.limitedFirst) lim[k] += 1; });
	console.log(`  ${name.padEnd(8)} it/host=${fmt(r.c.iterations / r.c.subSamples, 3)} fac/host=${fmt(r.c.factorisations / r.c.subSamples, 3)} NC=${r.c.nonConverged} limitedFirst=${r.c.limitedFirstIterations} relax=${r.c.relaxEngaged} | iterations at edge=${fmt(by[0] / cnt[0], 2)} edge+1=${fmt(by[1] / cnt[1], 2)} edge+2=${fmt(by[2] / cnt[2], 2)} plateau=${fmt(by[3] / cnt[3], 2)} | first-iteration limited at edge=${lim[0]} edge+1=${lim[1]} edge+2=${lim[2]} plateau=${lim[3]}`);
}

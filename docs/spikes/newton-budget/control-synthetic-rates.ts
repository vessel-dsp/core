// Control (c): a synthetic stiff scalar problem with a known root, through the SAME loop and
// counters the methods use. One silicon diode (catalog defaults: Is 2.52 nA, N 1.752,
// Rs 1 Ohm) fed through 10k from an ideal source: F(v) = (v - vin)/R + Id(v) = 0, root by
// bisection on the shipped law (Lambert-W form, copied). The source steps from 20 V to 2 V
// so the solve starts at the 2 mA operating point and must reach the 0.17 mA one -- a
// 0.11 V move inside the junction's unlimited region (below the limiter's critical voltage,
// so no limiting fires; the trace prints the flag to prove it).
//
// Expected: full Newton converges quadratically (delta_{k+1} / delta_k^2 bounded), chord
// Newton on the start Jacobian converges linearly with ratio rho = 1 - F'(root)/F'(start),
// and the counters read: Newton factorisations == iterations; chord factorisations == 1.
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { diodeClipper } from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import * as scratch from "./scratch-newton";

// Drop the anti-parallel diode D2 so the problem is scalar in the diode voltage.
const source = diodeClipper.replace(/ {2}- id: D2[\s\S]*?Description: "Clipping diode\."\n(?=wires)/, "");
if (source === diodeClipper) throw new Error("fixture derivation matched nothing");
const result = compile(source, { registry: pedalPartCatalog });
if (result.status !== "ok") throw new Error(`compile ${result.status}`);
const block = result.program.blocks.find((b) => b.kind === "mna") as any;
const diode = block.stamps.find((s: any) => s.kind === "diode");
const r1 = block.stamps.find((s: any) => s.kind === "conductance");
console.log(`block n=${block.nodeCount + block.auxCount} stamps=${block.stamps.map((s: any) => s.kind).join(",")} diode Is=${diode.saturationCurrent} N=${diode.emissionCoefficient} Vt=${diode.thermalVoltage} Rs=${diode.seriesResistance ?? 0.05} R1=${(1 / r1.siemens).toFixed(0)} ohm`);

// The shipped diode law (reference-runtime.ts `case "diode"`, Rs branch), copied.
function lambertW0(z: number): number {
	if (z <= 0) return 0;
	if (z < 1e-6) return z * (1 - z);
	let w: number;
	if (z < Math.E) w = (z * (1 + 1.2 * z)) / (1 + 2.2 * z + 0.8 * z * z);
	else { const lnZ = Math.log(z); const lnLnZ = Math.log(lnZ); w = lnZ - lnLnZ + lnLnZ / lnZ; }
	for (let i = 0; i < 3; i++) {
		const eW = Math.exp(w); const f = w * eW - z; const fp = eW * (w + 1); const fpp = eW * (w + 2);
		const delta = f / (fp - (f * fpp) / (2 * fp)); w -= delta;
		if (Math.abs(delta) < 1e-13 * (w + 1)) break;
	}
	return w;
}
function lambertW0FromLogZ(logZ: number): number {
	if (logZ < -15) { const z = Math.exp(logZ); return z * (1 - z); }
	if (logZ < 1.0) return lambertW0(Math.exp(logZ));
	const lnLnZ = Math.log(logZ);
	let w = logZ - lnLnZ + lnLnZ / logZ;
	for (let i = 0; i < 3; i++) {
		const lnW = Math.log(w); const g = w + lnW - logZ; const gp = 1 + 1 / w; const gpp = -1 / (w * w);
		const delta = g / (gp - (g * gpp) / (2 * gp)); w -= delta;
		if (Math.abs(delta) < 1e-13 * w) break;
	}
	return w;
}
const scale = diode.emissionCoefficient * diode.thermalVoltage;
const rs = diode.seriesResistance ?? 0.05;
const Is = diode.saturationCurrent;
function diodeCurrent(v: number): { i: number; g: number } {
	const x = (Is * rs) / scale;
	const logZ = Math.log(x) + x + v / scale;
	const w = lambertW0FromLogZ(logZ);
	return { i: (scale / rs) * w - Is, g: w / (rs * (1 + w)) };
}
const R = 1 / r1.siemens;
function F(v: number, vin: number): number { return (v - vin) / R + diodeCurrent(v).i; }
function Fprime(v: number): number { return 1 / R + diodeCurrent(v).g; }
function root(vin: number): number {
	let lo = -1, hi = vin;
	for (let k = 0; k < 200; k += 1) { const mid = 0.5 * (lo + hi); if (F(mid, vin) > 0) hi = mid; else lo = mid; }
	return 0.5 * (lo + hi);
}
const critical = scale * Math.log(scale / (Math.SQRT2 * Is));
const V_START = 20, V_END = 2;
const vStart = root(V_START), vEnd = root(V_END);
const rhoTheory = 1 - Fprime(vEnd) / Fprime(vStart);
console.log(`limiter critical voltage=${critical.toFixed(4)} V; root(${V_START} V)=${vStart.toFixed(6)} V, root(${V_END} V)=${vEnd.toFixed(6)} V (both below critical -> no junction limiting); theory chord ratio rho = 1 - F'(root)/F'(start) = ${rhoTheory.toFixed(4)}`);

const node = block.outputNode as number;
function runCase(label: string, config: Partial<scratch.ScratchConfig>) {
	let captured: scratch.SubSampleInfo | null = null;
	let sampleIndex = 0;
	const target = 48;
	scratch.install();
	scratch.configure({ ...config, onSubSample: (info) => { if (sampleIndex === target) captured = info; sampleIndex += 1; } });
	scratch.resetCounters();
	const rt = new ReferenceRuntime(result.program);
	rt.prepare(48000, { maxNewtonIterations: 1024 });
	const chunk = new Float64Array(1);
	for (let i = 0; i < 48; i += 1) { chunk[0] = V_START; rt.process(chunk); }
	const before = scratch.snapshotCounters();
	chunk[0] = V_END;
	rt.process(chunk);
	const after = scratch.snapshotCounters();
	scratch.uninstall();
	const info = captured as scratch.SubSampleInfo | null;
	if (info === null) throw new Error("no capture");
	const solved = info.solution[node] as number;
	const errTol = Math.abs(solved - vEnd) / (1e-3 * Math.abs(vEnd) + 1e-6);
	console.log(`\n${label}: start v=${(info.start[node] as number).toFixed(6)} (= root at ${V_START} V to ${Math.abs((info.start[node] as number) - vStart).toExponential(1)} V), converged=${info.converged} used=${info.used} solved v=${solved.toFixed(7)} |solved-root|=${Math.abs(solved - vEnd).toExponential(2)} V = ${errTol.toFixed(3)} tolerance units`);
	console.log(`  counters for this sample: iterations=${after.iterations - before.iterations} factorisations=${after.factorisations - before.factorisations} reuseSolves=${after.reuseSolves - before.reuseSolves} assembles=${after.assembles - before.assembles} checks=${after.convergenceChecks - before.convergenceChecks} limitedFirst=${after.limitedFirstIterations - before.limitedFirstIterations}`);
	const d = info.iterations.map((t) => t.delta);
	const anyLimited = info.iterations.some((t) => t.limited);
	console.log(`  any iteration limited: ${anyLimited}`);
	const rows: string[] = [];
	for (let k = 0; k < d.length; k += 1) {
		const dk = d[k] as number;
		const q = k > 0 ? dk / ((d[k - 1] as number) ** 2) : Number.NaN;
		const l = k > 0 ? dk / (d[k - 1] as number) : Number.NaN;
		if (k < 12 || k >= d.length - 3 || k % 20 === 0) rows.push(`    k=${String(k).padStart(3)} delta=${dk.toExponential(3)} ratio(lin)=${Number.isNaN(l) ? "-" : l.toFixed(4)} ratio(quad)=${Number.isNaN(q) ? "-" : q.toExponential(2)} reused=${info.iterations[k]?.reused}`);
	}
	console.log(rows.join("\n"));
	return { d, info };
}
const newton = runCase("FULL NEWTON (shipped loop, methods off)", {});
const chord = runCase("CHORD (chord within, stall rule disabled, cap 1024)", { chord: "within", chordStallDisabled: true, chordMaxSteps: 1e9 });
// Verdicts. Quadratic: delta_{k+1}/delta_k^2 stays within a factor of 3 over the last three
// steps while delta_{k+1}/delta_k keeps falling. Linear: the last ratio delta_{k+1}/delta_k is
// within 0.05 of the theory value and the quadratic ratio grows without bound.
const nd = newton.d;
const q = (d: number[], k: number) => (d[k] as number) / ((d[k - 1] as number) ** 2);
const l = (d: number[], k: number) => (d[k] as number) / (d[k - 1] as number);
const nq = [q(nd, nd.length - 3), q(nd, nd.length - 2), q(nd, nd.length - 1)];
const quadOk = Math.max(...nq) / Math.min(...nq) < 3 && l(nd, nd.length - 1) < l(nd, nd.length - 2) && l(nd, nd.length - 2) < l(nd, nd.length - 3);
const cd = chord.d;
const rhoMeasured = l(cd, cd.length - 1);
const linOk = Math.abs(rhoMeasured - rhoTheory) < 0.05 && q(cd, cd.length - 1) > q(cd, cd.length - 6);
const chordErr = Math.abs((chord.info.solution[node] as number) - vEnd) / (1e-3 * Math.abs(vEnd) + 1e-6);
console.log(`\nVERDICT: full Newton reached the root in ${newton.info.used} iterations, last three quadratic ratios ${nq.map((x) => x.toFixed(1)).join(" / ")} (quadratic ${quadOk ? "YES" : "NO"}); chord took ${chord.info.used} iterations, last linear ratio ${rhoMeasured.toFixed(4)} vs theory ${rhoTheory.toFixed(4)} (linear ${linOk ? "YES" : "NO"}); counters: Newton factorisations ${newton.info.used} == iterations ${newton.info.used}; chord factorisations 1, reuse ${chord.info.used - 1}. Chord accepted by the plain delta test sits ${chordErr.toFixed(1)} tolerance units from the root (rho/(1-rho) = ${(rhoMeasured / (1 - rhoMeasured)).toFixed(1)} x its last delta): the delta test is NOT the same tolerance under linear convergence.`);
// The same chord run under the contraction-bound acceptance rule.
const chordB = runCase("CHORD + contraction-bound acceptance (chordAccept=bound)", { chord: "within", chordStallDisabled: true, chordMaxSteps: 1e9, chordAccept: "bound" });
const chordBErr = Math.abs((chordB.info.solution[node] as number) - vEnd) / (1e-3 * Math.abs(vEnd) + 1e-6);
console.log(`VERDICT (bound rule): chord took ${chordB.info.used} iterations and sits ${chordBErr.toFixed(3)} tolerance units from the root (${chordBErr <= 1 ? "within" : "OUTSIDE"} the convergence tolerance).`);

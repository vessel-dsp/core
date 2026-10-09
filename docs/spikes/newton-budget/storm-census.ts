// Storm census: for the steady-state host samples that hit the Newton cap, which device
// carries the worst difference at each iteration, the node voltages across the event,
// whether the sample follows a conduction-boundary crossing (diode current sign, BJT
// junction, FET gate junction, triode/pentode grid onset) or a switch state change, the
// input phase, and how the FULL DENSE Newton path (the twin: 88-unknown `iterate` with no
// schedule and no elimination, solved from the same state) behaves on the same samples.
//
// Harness: ReferenceRuntime, 48 kHz, x1, 1 kHz sine at 0.1 V, default controls. Settle: 3 s
// (144000 host samples) on the shipped loop at the stated cap, then 1 s (48000 samples)
// traced through the scratch loop with every method off (the shipped arithmetic, control
// (e)) and the twin on. Devices are named by the netlist device id and the stamp kind,
// matched on exact terminal node sets (typed), never by description text.
//
// Classes (priority order, stated):
//   (b) genuine non-convergence: the twin also fails at the same cap, OR the last 8 deltas do
//       not contract against the 8 before them (max_last8 >= 0.5 * max_prev8): oscillating /
//       bistable iterate.
//   (c) slow contraction: relaxation engaged and the deltas contract (max_last8 < 0.5 *
//       max_prev8) without reaching tolerance inside the cap.
//   (a) switching / limiting event: a conduction-boundary crossing between the previous
//       sample's solution and this sample's answer (twin's, else the final iterate), or a
//       limiter firing inside the first 3 iterations; neither (b) nor (c).
//   (d) none of the above.
//
//   bun docs/spikes/newton-budget/storm-census.ts --packet=gro100 --cap=64 [--settle=144000] [--samples=48000] [--out=x.json]
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog, readNetlist } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PACKETS, arg, fmt } from "./lib";
import * as scratch from "./scratch-newton";

const slug = arg("packet", "gro100");
const CAP = Number(arg("cap", "64"));
const SETTLE = Number(arg("settle", "144000"));
const SAMPLES = Number(arg("samples", "48000"));
const OUT = arg("out", "");
const spec = PACKETS[slug];
if (spec === undefined) throw new Error(`unknown packet ${slug}`);
const source = readFileSync(spec.file, "utf8");
const compiled = compile(source, { registry: pedalPartCatalog });
if (compiled.status !== "ok") throw new Error(`compile ${compiled.status}`);
const program = compiled.program;
const netlist = readNetlist(source);
const blocks = new Map<string, any>();
for (const b of program.blocks) if (b.kind === "mna") blocks.set(b.id, b);

// --- device naming: stamp terminals (block rows) -> source node ids -> netlist device ----
type NamedStamp = { stamp: any; rows: number[]; name: string; kind: string };
const named = new Map<string, NamedStamp[]>();
function terminalRows(stamp: any): number[] {
	switch (stamp.kind) {
		case "diode": return [stamp.anode, stamp.cathode];
		case "bjt": return [stamp.base, stamp.collector, stamp.emitter];
		case "fet": return [stamp.gate, stamp.drain, stamp.source];
		case "triode": return [stamp.grid, stamp.cathode, stamp.plate];
		case "pentode": return [stamp.grid, stamp.cathode, stamp.plate, stamp.screen];
		case "ideal-opamp": return [stamp.plus, stamp.minus, stamp.output];
		case "switch": return [stamp.a, stamp.b];
		default: return [];
	}
}
for (const [id, b] of blocks) {
	const list: NamedStamp[] = [];
	for (const stamp of b.stamps) {
		const rows = terminalRows(stamp);
		if (rows.length === 0) continue;
		const sourceNodes = rows.map((r) => b.nodeIds[r] as number);
		// Exact typed match: a netlist device whose terminal node set contains every stamp
		// terminal node (ground is row 0 in every block and node 0 in the netlist).
		const candidates = netlist.devices.filter((d) => sourceNodes.every((n) => d.nodes.includes(n)));
		const kindish = candidates.filter((d) => d.kind === stamp.kind || (stamp.kind === "fet" && (d.kind === "jfet" || d.kind === "mosfet")) || (stamp.kind === "ideal-opamp" && d.kind === "opamp"));
		const pick = kindish[0] ?? candidates[0];
		list.push({ stamp, rows, name: pick === undefined ? `?(nodes ${sourceNodes.join(",")})` : `${pick.id}[${pick.kind}]`, kind: stamp.kind });
	}
	named.set(id, list);
}
function devicesAtRow(blockId: string, row: number): string[] {
	const out: string[] = [];
	for (const n of named.get(blockId) ?? []) if (n.rows.includes(row)) out.push(`${n.name}/${n.kind}`);
	return out.length === 0 ? [`row ${row} (no nonlinear stamp)`] : out;
}
/** Conduction-boundary signature per stamp at a solution vector. */
function signature(blockId: string, x: readonly number[]): string[] {
	const out: string[] = [];
	for (const n of named.get(blockId) ?? []) {
		const s = n.stamp;
		const v = (r: number) => x[r] ?? 0;
		switch (s.kind) {
			case "diode": out.push(v(s.anode) - v(s.cathode) > 0 ? "F" : "R"); break;
			case "bjt": out.push((s.polarity === "pnp" ? v(s.emitter) - v(s.base) : v(s.base) - v(s.emitter)) > 0 ? "E" : "e"); out.push((s.polarity === "pnp" ? v(s.collector) - v(s.base) : v(s.base) - v(s.collector)) > 0 ? "C" : "c"); break;
			case "fet": out.push(v(s.gate) - v(s.source) > (s.gateOnsetVolts ?? 0) ? "G" : "g"); break;
			case "triode": case "pentode": out.push(v(s.grid) - v(s.cathode) > (s.gridOnsetVolts ?? 0) ? "G" : "g"); break;
			case "ideal-opamp": out.push("o"); break;
			case "switch": out.push("s"); break;
		}
	}
	return out;
}
function crossings(blockId: string, a: readonly number[], b: readonly number[]): string[] {
	const sa = signature(blockId, a), sb = signature(blockId, b);
	const list = named.get(blockId) ?? [];
	const out: string[] = [];
	let k = 0;
	for (const n of list) {
		const width = n.kind === "bjt" ? 2 : 1;
		for (let j = 0; j < width; j += 1) { if (sa[k] !== sb[k]) out.push(`${n.name}/${n.kind}:${sa[k]}->${sb[k]}`); k += 1; }
	}
	return out;
}

// --- run -----------------------------------------------------------------------------------
const input = (i: number) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
scratch.uninstall();
const rt = new ReferenceRuntime(program);
rt.prepare(48000, { maxNewtonIterations: CAP });
for (const [k, v] of Object.entries(spec.controls)) rt.setControl(k, v);
const chunk = new Float64Array(1);
const t0 = Date.now();
for (let i = 0; i < SETTLE; i += 1) { chunk[0] = input(i); rt.process(chunk); }
const tSettle = rt.telemetry();
console.log(`${slug} cap=${CAP}: settled ${SETTLE} host samples in ${((Date.now() - t0) / 1000).toFixed(0)} s; settle NC=${tSettle.nonConvergedSamples} mean it/host=${(tSettle.totalIterations / tSettle.samples).toFixed(2)} peak=${tSettle.peakIterations}`);

type Compact = { i: number; block: string; used: number; conv: boolean; twinUsed: number; twinConv: boolean; dev: number; relax: boolean; limFirst: boolean; input: number };
type Storm = Compact & { phaseDeg: number; cls: "a" | "b" | "c" | "d"; why: string; crossingsPrevToAnswer: string[]; crossingsPrevToTwin: string[]; limitedEarly: string[]; worstByIteration: string[]; deltas: number[]; relaxAt: number; nodesPrev: number[]; nodesFinal: number[]; nodesTwin: number[]; lastDelta: number; worstFinal: string[] };
const compact: Compact[] = [];
const storms: Storm[] = [];
const prevSolution = new Map<string, number[]>();
let sampleIndex = SETTLE;
let interesting = 0;
scratch.install();
scratch.configure({ fixedPointCheck: true, onSubSample: (info) => {
	const row: Compact = { i: sampleIndex, block: info.blockId, used: info.used, conv: info.converged, twinUsed: info.twin?.used ?? -1, twinConv: info.twin?.converged ?? false, dev: info.twin?.deviationTol ?? Number.NaN, relax: info.relaxEngaged, limFirst: info.iterations[0]?.limited ?? false, input: info.input };
	compact.push(row);
	const prev = prevSolution.get(info.blockId) ?? info.start;
	if (info.used >= CAP) {
		interesting += 1;
		const d = info.iterations.map((t) => t.delta);
		const last8 = Math.max(...d.slice(-8));
		const prev8 = Math.max(...d.slice(-16, -8));
		const contracting = last8 < 0.5 * prev8;
		const relaxAt = info.iterations.findIndex((t) => t.relaxing);
		const answer = info.twin !== null && info.twin.converged ? info.twin.solution : info.solution;
		const crossA = crossings(info.blockId, prev, answer);
		const crossT = info.twin === null ? [] : crossings(info.blockId, prev, info.twin.solution);
		const limitedEarly = info.iterations.slice(0, 3).filter((t) => t.limited).map((t, k) => `it${k}:${t.limitedBy}`);
		let cls: Storm["cls"]; let why: string;
		if (info.twin !== null && !info.twin.converged) { cls = "b"; why = `twin (full dense Newton, same state, cap ${CAP}) also fails after ${info.twin.used}`; }
		else if (!contracting) { cls = "b"; why = `not contracting: max(last 8 deltas)=${last8.toExponential(2)} vs max(prev 8)=${prev8.toExponential(2)}`; }
		else if (relaxAt >= 0) { cls = "c"; why = `relaxation engaged at iteration ${relaxAt}, deltas contract (${prev8.toExponential(2)} -> ${last8.toExponential(2)}) but miss tolerance`; }
		else if (crossA.length > 0 || limitedEarly.length > 0) { cls = "a"; why = `${crossA.length} boundary crossing(s) prev->answer${limitedEarly.length > 0 ? `; limited early: ${limitedEarly.join(" ")}` : ""}`; }
		else { cls = "d"; why = "no crossing, no early limiter, contracting without relaxation, twin converges"; }
		const worstBy = info.iterations.slice(0, 6).map((t) => devicesAtRow(info.blockId, t.worstNode).join("+")).concat(["..."], info.iterations.slice(-2).map((t) => devicesAtRow(info.blockId, t.worstNode).join("+")));
		storms.push({ ...row, phaseDeg: ((sampleIndex % 48) / 48) * 360, cls, why, crossingsPrevToAnswer: crossA, crossingsPrevToTwin: crossT, limitedEarly, worstByIteration: worstBy, deltas: d, relaxAt, nodesPrev: prev.slice(), nodesFinal: info.solution.slice(), nodesTwin: info.twin?.solution.slice() ?? [], lastDelta: d[d.length - 1] as number, worstFinal: devicesAtRow(info.blockId, info.iterations[info.iterations.length - 1]?.worstNode ?? -1) });
	}
	if (info.converged) prevSolution.set(info.blockId, info.solution.slice());
} });
const t1 = Date.now();
for (let i = 0; i < SAMPLES; i += 1) { sampleIndex = SETTLE + i; chunk[0] = input(sampleIndex); rt.process(chunk); }
scratch.uninstall();
const c = scratch.snapshotCounters();
console.log(`measured ${SAMPLES} host samples in ${((Date.now() - t1) / 1000).toFixed(0)} s: it/host=${(c.iterations / SAMPLES).toFixed(2)} NC=${c.nonConverged} twin NC=${c.twinNonConverged} twin it/host=${(c.twinIterations / SAMPLES).toFixed(2)} cap-hit sub-samples=${storms.length} (${(100 * storms.length / SAMPLES).toFixed(1)}%) carrying ${(100 * storms.reduce((a, s) => a + s.used, 0) / c.iterations).toFixed(1)}% of iterations; worst deviation (converged pairs) ${c.worstDeviationTol.toFixed(3)} tol units`);
// Histogram of iterations in the measured window.
const hist = new Map<number, number>();
for (const r of compact) hist.set(r.used, (hist.get(r.used) ?? 0) + 1);
const hs = [...hist.entries()].sort((a, b) => a[0] - b[0]);
console.log(`histogram (sub-samples of nonlinear blocks): ${hs.slice(0, 12).map(([k, v]) => `${k}:${v}`).join(", ")}${hs.length > 12 ? `, ... ${hs.slice(-6).map(([k, v]) => `${k}:${v}`).join(", ")}` : ""}`);
const over = compact.filter((r) => r.used > 10).length;
console.log(`>10 iterations: ${over} (${(100 * over / compact.length).toFixed(1)}%), >20: ${compact.filter((r) => r.used > 20).length}, >=64: ${compact.filter((r) => r.used >= 64).length}, >=1024: ${compact.filter((r) => r.used >= 1024).length}`);
// Per class.
for (const cls of ["a", "b", "c", "d"] as const) {
	const rows = storms.filter((s) => s.cls === cls);
	if (rows.length === 0) { console.log(`class (${cls}): 0`); continue; }
	const work = rows.reduce((a, s) => a + s.used, 0);
	const twinConv = rows.filter((s) => s.twinConv).length;
	const twinMean = rows.reduce((a, s) => a + s.twinUsed, 0) / rows.length;
	const cross = rows.filter((s) => s.crossingsPrevToAnswer.length > 0).length;
	const limEarly = rows.filter((s) => s.limitedEarly.length > 0).length;
	const relax = rows.filter((s) => s.relaxAt >= 0).length;
	const devs = new Map<string, number>();
	for (const s of rows) for (const w of s.worstFinal) devs.set(w, (devs.get(w) ?? 0) + 1);
	const topDevs = [...devs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} x${v}`).join("; ");
	const phases = new Map<number, number>();
	for (const s of rows) { const bin = Math.floor(s.phaseDeg / 45) * 45; phases.set(bin, (phases.get(bin) ?? 0) + 1); }
	console.log(`class (${cls}): ${rows.length} samples, ${work} iterations (${(100 * work / c.iterations).toFixed(1)}% of all work); twin converges on ${twinConv}/${rows.length} (twin mean ${twinMean.toFixed(1)} it); with boundary crossing ${cross}; limiter in first 3 iterations ${limEarly}; relaxation engaged ${relax}; worst device at the last iteration: ${topDevs}; input phase bins (deg:count) ${[...phases.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ")}`);
}
// A few exemplars per class.
for (const cls of ["a", "b", "c", "d"] as const) {
	for (const s of storms.filter((x) => x.cls === cls).slice(0, 2)) {
		console.log(`  exemplar (${cls}) sample ${s.i} phase ${s.phaseDeg.toFixed(0)} deg input ${s.input.toFixed(4)} V: ${s.why}; crossings prev->answer [${s.crossingsPrevToAnswer.join(" ")}]; limited early [${s.limitedEarly.join(" ")}]; worst device by iteration [${s.worstByIteration.join(" | ")}]; deltas ${s.deltas.slice(0, 6).map((d) => d.toExponential(1)).join(" ")} ... ${s.deltas.slice(-4).map((d) => d.toExponential(1)).join(" ")}; twin used=${s.twinUsed} conv=${s.twinConv}`);
		const rowsOfInterest = new Set<number>();
		for (const n of named.get(s.block) ?? []) for (const r of n.rows) rowsOfInterest.add(r);
		const show = [...rowsOfInterest].sort((a, b) => a - b).slice(0, 14);
		console.log(`    node voltages (row: prev -> final | twin): ${show.map((r) => `${r}: ${fmt(s.nodesPrev[r], 3)} -> ${fmt(s.nodesFinal[r], 3)} | ${fmt(s.nodesTwin[r], 3)}`).join("; ")}`);
	}
}
if (OUT !== "") writeFileSync(OUT, JSON.stringify({ slug, cap: CAP, settle: SETTLE, samples: SAMPLES, counters: c, histogram: hs, storms: storms.map((s) => ({ ...s, nodesPrev: undefined, nodesFinal: undefined, nodesTwin: undefined })) }, null, 1));

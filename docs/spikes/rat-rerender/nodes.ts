// Predicted DC at internal nodes with the 100 mV tone on, per lane, for a multimeter check. Exploratory (post-hoc), run after rounds 1 and 2.
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
const FIXTURE = "/home/joseph/projects/VesselDSP/workbench/packet-study/pro-co-rat-2-v4b-op07cp/pro-co-rat-2-v4b-op07cp.fixture.vdsp";
const RATE = 96000, F0 = 1000, BIAS = 4.435;
const r: any = compile(readFileSync(FIXTURE, "utf8"), { registry: pedalPartCatalog });
const base: Program = r.program;
type Edit = (s: any) => any;
const tracks: Edit = (s) => s.kind === "controlled-resistance" && s.control === "Distortion" ? { ...s, maxOhms: 94900 } : s.kind === "controlled-resistance" && s.control === "Filter" ? { ...s, maxOhms: 102900 } : s.kind === "controlled-conductance" && s.control === "Volume" ? { ...s, totalOhms: 115600 } : s;
const supply: Edit = (s) => (s.kind === "dc-source" ? { ...s, volts: 8.88 } : s);
const noLoad: Edit = (s) => (s.kind === "conductance" && s.a === 12 && s.b === 0 && Math.abs(s.siemens - 1e-4) < 1e-12 ? { ...s, siemens: 1e-9 } : s);
const jfet: Edit = (s) => (s.kind === "fet" ? { ...s, thresholdVolts: -1.34, transconductance: 0.00127 } : s);
const scan = (a: number): Edit[] => { const sh = a - ((7.9 + 1.0) / 2 - BIAS); return [tracks, supply, noLoad, jfet, (s) => (s.kind === "ideal-opamp" ? { ...s, railHigh: 7.9 + sh, railLow: 1.0 + sh } : s)]; };
function prog(edits: Edit[]): Program { return edits.length === 0 ? base : ({ ...base, blocks: base.blocks.map((b: any) => b.kind === "mna" ? { ...b, stamps: b.stamps.map((s: any) => edits.reduce((x, e) => e(x), s)) } : b) } as Program); }
function run(p: Program, ampV: number) {
	const rt = new ReferenceRuntime(p);
	rt.prepare(RATE, { maxNewtonIterations: 1024, inputSourceOhms: 0 });
	rt.setControl("Distortion", 0.5); rt.setControl("Filter", 0.5); rt.setControl("Volume", 1);
	const n = Math.round(1.6 * RATE), BLK = 97, settle = Math.round(0.6 * RATE);
	const sums: Record<number, number> = {}; let count = 0;
	const nodes = [4, 6, 9, 11, 12];
	let idleNodeIds: string[] | undefined;
	for (let i = 0; i < n; i += BLK) {
		const len = Math.min(BLK, n - i), blk = new Float64Array(len);
		for (let k = 0; k < len; k += 1) blk[k] = ampV * Math.sin((2 * Math.PI * F0 * (i + k)) / RATE);
		rt.process(blk);
		if (i >= settle) {
			const snap: any = rt.nodeVoltageSnapshot()[0];
			idleNodeIds ??= snap.nodeIds;
			for (const nd of nodes) sums[nd] = (sums[nd] ?? 0) + (snap.voltages[nd] as number);
			count += 1;
		}
	}
	return Object.fromEntries(nodes.map((nd) => [nd, (sums[nd] as number) / count]));
}
const lanes: Array<[string, Edit[]]> = [["A baseline", []], ["G measured (a=0.015)", scan(0.015)], ["R a=0.065", scan(0.065)], ["R a=0.115", scan(0.115)], ["R a=-0.065", scan(-0.065)]];
console.log("mean DC (V) with a 100 mV tone vs 0 V input; nodes: 4 op-amp output (pin 6), 6 clip diodes, 9 JFET gate, 11 JFET source, 12 after 1 uF");
for (const [name, edits] of lanes) {
	const p = prog(edits);
	const off = run(p, 0), on = run(p, 0.1);
	const f = (o: any) => [4, 6, 9, 11, 12].map((nd) => (o[nd] as number).toFixed(4).padStart(8)).join(" ");
	console.log(name.padEnd(22), "idle", f(off), "| tone", f(on), "| shift mV", [4, 6, 9, 11, 12].map((nd) => (((on[nd] as number) - (off[nd] as number)) * 1000).toFixed(1).padStart(7)).join(" "));
}

// RAT2 RT-301860 re-render lanes. Predictions: docs/spikes/2026-10-11-rat-rerender-predictions.md (hashes in 2026-10-11-rat-rerender-predictions.sha256).
// Run from the repository root: bun docs/spikes/rat-rerender/rerender.ts [--lanes=A,B,..] [--levels=10,30,100] [--volumes=0.5,1] [--rate=96000]
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const FIXTURE = "/home/joseph/projects/VesselDSP/workbench/packet-study/pro-co-rat-2-v4b-op07cp/pro-co-rat-2-v4b-op07cp.fixture.vdsp";
const arg = (n: string, d: string): string => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const RATE = Number(arg("rate", "96000"));
const LANES = arg("lanes", "A,B,C,D,E,F,G").split(",");
const LEVELS_MV = arg("levels", "10,30,100").split(",").map(Number);
const VOLUMES = arg("volumes", "0.5,1").split(",").map(Number);
const SECONDS = 1.2, SETTLE = 0.4, F0 = 1000, NH = 6;

const r: any = compile(readFileSync(FIXTURE, "utf8"), { registry: pedalPartCatalog });
if (r.status !== "ok") throw new Error("fixture did not compile");
const base: Program = r.program;

type Edit = (s: any) => any;
const tracks: Edit = (s) => {
	if (s.kind === "controlled-resistance" && s.control === "Distortion") return { ...s, maxOhms: 94900 };
	if (s.kind === "controlled-resistance" && s.control === "Filter") return { ...s, maxOhms: 102900 };
	if (s.kind === "controlled-conductance" && s.control === "Volume") return { ...s, totalOhms: 115600 };
	return s;
};
const supply: Edit = (s) => (s.kind === "dc-source" ? { ...s, volts: 8.88 } : s);
const noLoad: Edit = (s) => (s.kind === "conductance" && s.a === 12 && s.b === 0 && Math.abs(s.siemens - 1e-4) < 1e-12 ? { ...s, siemens: 1e-9 } : s);
const jfet: Edit = (s) => (s.kind === "fet" ? { ...s, thresholdVolts: -1.34, transconductance: 0.00127 } : s);
const rails: Edit = (s) => (s.kind === "ideal-opamp" ? { ...s, railHigh: 7.9, railLow: 1.0 } : s);
const LANE_EDITS: Record<string, Edit[]> = { A: [], B: [tracks], C: [supply], D: [noLoad], E: [jfet], F: [rails], G: [tracks, supply, noLoad, jfet, rails] };

const BIAS = 4.435; // VBIAS when the VCC node reads 8.87 V
/** Round 2 scan lanes: "R<a>" is lane G with both limits shifted so that (railHigh + railLow) / 2 - BIAS = a. */
function scanEdits(a: number): Edit[] {
	const shift = a - (((7.9 + 1.0) / 2) - BIAS);
	return [tracks, supply, noLoad, jfet, (s) => (s.kind === "ideal-opamp" ? { ...s, railHigh: 7.9 + shift, railLow: 1.0 + shift } : s)];
}
function laneProgram(lane: string): Program {
	const edits = lane.startsWith("R") ? scanEdits(Number(lane.slice(1))) : LANE_EDITS[lane];
	if (edits === undefined) throw new Error(`no lane ${lane}`);
	if (edits.length === 0) return base;
	const apply = (s: any) => edits.reduce((acc, e) => e(acc), s);
	return { ...base, blocks: base.blocks.map((b: any) => (b.kind === "mna" ? { ...b, stamps: b.stamps.map(apply) } : b)) } as Program;
}

function render(program: Program, controls: Record<string, number>, ampVolts: number) {
	const rt = new ReferenceRuntime(program);
	rt.prepare(RATE, { maxNewtonIterations: 1024, inputSourceOhms: 0 });
	for (const [k, v] of Object.entries(controls)) rt.setControl(k, v);
	const n = Math.round(SECONDS * RATE);
	const input = new Float64Array(n);
	for (let i = 0; i < n; i += 1) input[i] = ampVolts * Math.sin((2 * Math.PI * F0 * i) / RATE);
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 512) out.set(rt.process(input.subarray(i, Math.min(n, i + 512))), i);
	const t: any = rt.telemetry();
	return { out, nonConverged: t.nonConvergedSamples as number };
}

/** Least-squares tone analysis over whole cycles after SETTLE: fundamental peak and harmonics 2..NH relative to it. */
function tone(x: Float64Array) {
	const start = Math.round(SETTLE * RATE);
	const cycles = Math.floor(((x.length - start) * F0) / RATE);
	const n = Math.round((cycles * RATE) / F0);
	const amp: number[] = [];
	for (let h = 1; h <= NH; h += 1) {
		let a = 0, b = 0;
		for (let i = 0; i < n; i += 1) { const ph = (2 * Math.PI * h * F0 * (start + i)) / RATE; const v = x[start + i] as number; a += v * Math.sin(ph); b += v * Math.cos(ph); }
		amp.push(((2 / n) * Math.hypot(a, b)));
	}
	const f1 = amp[0] as number;
	let rss = 0;
	for (let h = 2; h <= NH; h += 1) rss += (amp[h - 1] as number) ** 2;
	const dbc = (v: number) => 20 * Math.log10(Math.max(v / f1, 1e-12));
	let max = -Infinity, min = Infinity;
	for (let i = 0; i < n; i += 1) { const v = x[start + i] as number; if (v > max) max = v; if (v < min) min = v; }
	return { h1mV: f1 * 1000, h2: dbc(amp[1] as number), h3: dbc(amp[2] as number), thd: 20 * Math.log10(Math.sqrt(rss) / f1), outMaxV: max, outMinV: min };
}

const results: any[] = [];
console.log(`rate ${RATE}, lanes ${LANES.join(",")}, levels ${LEVELS_MV.join("/")} mV, volumes ${VOLUMES.join("/")}`);
console.log("lane  vol   mV |   H1 mV     H2 dBc   H3 dBc  THD dB | nonconv");
for (const lane of LANES) {
	const program = laneProgram(lane);
	for (const vol of VOLUMES) for (const mv of LEVELS_MV) {
		const t0 = performance.now();
		const { out, nonConverged } = render(program, { Distortion: 0.5, Filter: 0.5, Volume: vol }, mv / 1000);
		const m = tone(out);
		results.push({ lane, volume: vol, mv, ...m, nonConverged, seconds: (performance.now() - t0) / 1000 });
		console.log(`${lane.padEnd(4)} ${vol.toFixed(2)} ${String(mv).padStart(4)} | ${m.h1mV.toFixed(1).padStart(8)} ${m.h2.toFixed(2).padStart(9)} ${m.h3.toFixed(2).padStart(8)} ${m.thd.toFixed(2).padStart(8)} | ${nonConverged}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
	}
}
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 1));

// Order-of-accuracy control: from analytic-stage.ts JSON, the log-log slope of |measured - continuous| against dt (dt halves with each oversample doubling).
// Slope = log2(|e at os k| / |e at os 2k|). A first-order scheme reads -1 -> slope 1; the claim under test is >= 1.8. Cells with |e| < FLOOR at the coarser rate are skipped
// (below the measurement's own noise there is nothing to take a slope of). Also prints the os4 gain-100 bar (<= 0.05 dB up to 10 kHz).
//   bun docs/spikes/pole-order2/slope.ts <rows.json> [--floor=0.03] [--min-slope=1.8] [--fmax=10000]
// The gate is the MEDIAN slope per (console, G in {10, 100}, rate pair os2->os4 and os4->os8): single cells near the floor carry the oversampling path's +-0.007 dB passband
// ripple (visible in the baseline as measured-minus-own-law), so one cell is a measurement, the median over the frequency grid is the control.
import { readFileSync } from "node:fs";
import { arg } from "./lib";
type Row = { console: string; os: number; gain: number; hz: number; errContinuous: number };
const rows: Row[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const floor = Number(arg("floor", "0.03")), minSlope = Number(arg("min-slope", "1.8")), fmax = Number(arg("fmax", "10000"));
const key = (r: Row) => `${r.console}|${r.gain}|${r.hz}`;
// The oversampling path's passband ripple (+-0.007 dB at os >= 2, none at os1) is not the pole's error. The G = 1 follower has a law error of < 0.001 dB at every rate and
// frequency in the band, so its measured-minus-continuous IS the ripple at (console, os, hz); the corrected error subtracts it. `--raw` gates on the uncorrected error instead.
const raw = process.argv.includes("--raw");
const ripple = new Map<string, number>();
for (const r of rows) if (r.gain === 1) ripple.set(`${r.console}|${r.os}|${r.hz}`, r.errContinuous);
const errOf = (r: Row): number => (raw ? r.errContinuous : r.errContinuous - (ripple.get(`${r.console}|${r.os}|${r.hz}`) ?? 0));
const by = new Map<string, Map<number, number>>();
for (const r of rows) { const m = by.get(key(r)) ?? new Map(); m.set(r.os, Math.abs(errOf(r))); by.set(key(r), m); }
let cells = 0;
const summary = new Map<string, number[]>();
for (const [k, m] of by) {
	const [cn, g, hz] = k.split("|") as [string, string, string];
	if (Number(hz) > fmax) continue;
	for (const [a, b] of [[1, 2], [2, 4], [4, 8]] as const) {
		const ea = m.get(a), eb = m.get(b);
		if (ea === undefined || eb === undefined || ea < floor) continue;
		const slope = Math.log2(ea / Math.max(eb, 1e-9));
		cells += 1;
		const sk = `${cn} G=${g} os${a}->${b}`;
		(summary.get(sk) ?? summary.set(sk, []).get(sk)!).push(slope);
	}
}
console.log(`log-log slope of |error| vs dt (${raw ? "RAW error" : "error minus the G=1 follower's ripple"}; cells with |e| >= ${floor} dB at the coarser rate, f <= ${fmax} Hz)`);
for (const [k, v] of [...summary].sort()) console.log(`${k.padEnd(22)} n=${String(v.length).padStart(2)} min ${Math.min(...v).toFixed(2)} median ${[...v].sort((x, y) => x - y)[v.length >> 1]!.toFixed(2)} max ${Math.max(...v).toFixed(2)}`);
let gateFails = 0, gateRows = 0;
for (const [k, v] of summary) {
	const m = /^(\w+) G=(\d+) os(\d)->(\d)$/.exec(k)!;
	if (!["10", "100"].includes(m[2]!) || m[3] === "1") continue;
	const median = [...v].sort((x, y) => x - y)[v.length >> 1]!;
	gateRows += 1;
	if (median < minSlope) { gateFails += 1; console.log(`  GATE RED: ${k} median ${median.toFixed(2)} < ${minSlope}`); }
}
console.log(`order-of-accuracy gate (median slope >= ${minSlope} for G=10 and G=100, os2->os4 and os4->os8, per console): ${gateRows - gateFails} of ${gateRows} rows pass; ${cells} cells counted -> ${gateFails === 0 ? "GREEN" : "RED"}`);
for (const cn of new Set(rows.map((r) => r.console))) {
	const sel = rows.filter((r) => r.console === cn && r.os === 4 && r.gain === 100 && r.hz <= 10000);
	if (sel.length === 0) continue;
	const worst = sel.reduce((a, r) => (Math.abs(r.errContinuous) > Math.abs(a.errContinuous) ? r : a));
	console.log(`${cn} os4 G=100 worst |error| f<=10 kHz: ${Math.abs(worst.errContinuous).toFixed(4)} dB at ${worst.hz} Hz -> ${Math.abs(worst.errContinuous) <= 0.05 ? "MET" : "NOT MET"} (bar 0.05)`);
}

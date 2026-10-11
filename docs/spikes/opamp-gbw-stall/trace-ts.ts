// Per-iteration op-amp trace on the TS reference console, reaching past `private` by patching the
// prototype (no source change). For every host sample in [--from, --to) it prints the solve's verdict
// (iterations, converged, worst delta/node, limiter, stalled/flagged), and for a sample that used at
// least --detail-min iterations, the per-iteration state of every railed op-amp whose step was limited
// or whose output moved: differential, step, cap (in linear widths), limited/folded flags, raw state and
// output. Samples before --from are rendered silently (the trajectory must be the canary's own).
//   bun docs/spikes/opamp-gbw-stall/trace-ts.ts --packet=boss-mt-2 --os=1 --from=309120 --to=309130
//        [--stimulus=twotone|sine --hz --amp --f64] [--force-gbp=null|7e6] [--cap=1024] [--detail-min=64]
//        [--max-iter-lines=60] [--stop-after-cap=N]
import type { Block, Stamp } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, controlsFor, forceGbp, has, hostInput, programFor } from "./lib";

const slug = arg("packet", "boss-mt-2"), os = Number(arg("os", "1")), cap = Number(arg("cap", "1024"));
const from = Number(arg("from", "0")), to = Number(arg("to", String(from + 8)));
const detailMin = Number(arg("detail-min", "64")), maxIterLines = Number(arg("max-iter-lines", "60"));
const stopAfterCap = Number(arg("stop-after-cap", "1000000"));
const program = forceGbp(programFor(slug), arg("force-gbp", ""));
const RATE = 48000;
const input = hostInput(to, arg("stimulus", "twotone"), Number(arg("hz", "1000")), Number(arg("amp", "0.1")), has("f64"));

type OpampStamp = Extract<Stamp, { kind: "ideal-opamp" }>;
type Rt = ReferenceRuntime & {
	opampHistory: Map<number, { differential: number; step: number; cap: number }>;
	opampRawState: Map<number, number>;
	limitedOpamp: { key: number; folded: boolean } | null;
	lastFailure: unknown;
	stalledSamples: number;
	solvedButFlaggedSamples: number;
	elapsedSamples: number;
	sampleRate: number;
	oversample: number;
};
const HISTORY_KEY_BASE = 8192; // mirrors reference-runtime.ts HISTORY_KEY_BASE
const key3 = (b: number, x: number, y: number, z: number) => ((b * HISTORY_KEY_BASE + x) * HISTORY_KEY_BASE + y) * HISTORY_KEY_BASE + z;

// ---- the trace state, filled by the patched methods -------------------------------------------
let tracing = false;
let iteration = -1;
let firstOpampSeen = -1;
type IterRow = { it: number; stamp: number; diff: number; step: number; cap: number; width: number; limited: boolean; folded: boolean; raw: number; out: number; vout: number };
let rows: IterRow[] = [];
/** Per iteration: the iterate's max change against the previous iteration and where, and every limiter that fired. */
let iterInfo: Array<{ delta: number; node: number; limiters: Set<string> }> = [];
let prevIterate: number[] | null = null;

const proto = ReferenceRuntime.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const origApply = proto.applyStamp as (...a: unknown[]) => void;
proto.applyStamp = function (this: Rt, ...a: unknown[]) {
	origApply.apply(this, a);
	const [stamp, , , block, dt, , solution, , dc, , blockIndex] = a as [Stamp, unknown, unknown, Block & { kind: "mna" }, number, unknown, number[], number, boolean, number, number];
	if (!tracing || dc) return;
	const limitedBy = (this as unknown as { limitedBy: string | null }).limitedBy;
	if (limitedBy !== null && iteration >= 0) iterInfo[iteration]!.limiters.add(limitedBy);
	if (stamp.kind !== "ideal-opamp" || stamp.railHigh === null || stamp.railLow === null) return;
	const s = stamp as OpampStamp;
	const idx = block.stamps.indexOf(stamp);
	if (firstOpampSeen < 0) firstOpampSeen = idx;
	if (idx === firstOpampSeen) {
		iteration += 1;
		let delta = 0, node = -1;
		if (prevIterate !== null) for (let k = 0; k < solution.length; k += 1) { const d = Math.abs((solution[k] ?? 0) - (prevIterate[k] ?? 0)); if (d > delta) { delta = d; node = k; } }
		prevIterate = [...solution];
		iterInfo[iteration] = { delta, node, limiters: new Set() };
		if (limitedBy !== null) iterInfo[iteration]!.limiters.add(limitedBy);
	}
	const key = key3(blockIndex, s.plus, s.minus, s.output);
	const h = this.opampHistory.get(key);
	if (h === undefined) return;
	const halfSwing = Math.max((s.railHigh - s.railLow) / 2, 1e-9);
	const gbp = (s as { gainBandwidthHz?: number | null }).gainBandwidthHz ?? 1e6;
	const poleHz = gbp / s.openLoopGain;
	const tau = 1 / (2 * Math.PI * poleHz);
	const alpha = poleHz >= this.sampleRate / 2 ? 1 : dt / (dt + tau);
	const eff = alpha * s.openLoopGain, width = halfSwing / eff;
	const rawPrev = this.opampRawState.get(key) ?? 0;
	const raw = Math.min(8 * halfSwing, Math.max(-8 * halfSwing, alpha * s.openLoopGain * h.differential + (1 - alpha) * rawPrev));
	const out = (s.railHigh + s.railLow) / 2 + halfSwing * Math.tanh(raw / halfSwing);
	rows.push({ it: iteration, stamp: idx, diff: h.differential, step: h.step, cap: h.cap, width, limited: Math.abs(h.step) > h.cap, folded: h.cap <= width / 8, raw, out, vout: solution[s.output] ?? 0 });
};
// the damping factor each iteration applied (see reference-runtime.ts opAmpStepDamping)
let dampings: number[] = [];
const origDamping = proto.opAmpStepDamping as (...a: unknown[]) => number;
proto.opAmpStepDamping = function (this: Rt, ...a: unknown[]) {
	const d = origDamping.apply(this, a);
	if (tracing) dampings[iteration] = d;
	return d;
};
const origIterate = proto.iterate as (...a: unknown[]) => { solution: number[]; converged: boolean; used: number; worstNode: number; worstDelta: number };
let sampleReports: string[] = [];
let capHits = 0;
proto.iterate = function (this: Rt, ...a: unknown[]) {
	const [block, , , , , dc] = a as [Block & { kind: "mna" }, number, number, number[], number[], boolean];
	const hostSample = Math.floor(this.elapsedSamples / this.oversample);
	const sub = this.elapsedSamples % this.oversample;
	const inWindow = !dc && hostSample >= from && hostSample < to;
	tracing = inWindow;
	iteration = -1; firstOpampSeen = -1; rows = []; iterInfo = []; prevIterate = null; dampings = [];
	const stalledBefore = this.stalledSamples, flaggedBefore = this.solvedButFlaggedSamples;
	const r = origIterate.apply(this, a);
	tracing = false;
	if (!inWindow) return r;
	if (r.used >= cap) capHits += 1;
	const verdict = this.stalledSamples > stalledBefore ? "STALLED" : this.solvedButFlaggedSamples > flaggedBefore ? "FLAGGED" : r.converged ? "ok" : "exhausted";
	const nOpamps = new Set(rows.map((x) => x.stamp)).size;
	const limitedIts = new Set(rows.filter((x) => x.limited).map((x) => x.it)).size;
	const foldedIts = new Set(rows.filter((x) => x.folded).map((x) => x.it)).size;
	const limitedBy = new Map<number, number>();
	for (const x of rows) if (x.limited) limitedBy.set(x.stamp, (limitedBy.get(x.stamp) ?? 0) + 1);
	const lf = this.lastFailure as { node?: number; delta?: number; limitedBy?: string } | null;
	sampleReports.push(
		`sample ${hostSample}${this.oversample > 1 ? `.${sub}` : ""} (${(hostSample / RATE).toFixed(4)} s) block ${block.id}: used ${r.used} ${verdict} worstDelta ${r.worstDelta.toExponential(2)} node ${r.worstNode}` +
			(r.converged ? "" : ` lastFailure ${JSON.stringify(lf)}`) +
			` | opamps ${nOpamps}, iterations with a limited op-amp ${limitedIts}, folded ${foldedIts}; limited counts by stamp ${JSON.stringify([...limitedBy])}`,
	);
	if (r.used >= detailMin && rows.length > 0) {
		const its = [...new Set(rows.map((x) => x.it))];
		const pick = new Set<number>();
		for (const it of its.slice(0, Math.floor(maxIterLines / 2))) pick.add(it);
		for (const it of its.slice(-Math.floor(maxIterLines / 4))) pick.add(it);
		const stride = Math.max(1, Math.floor(its.length / Math.max(1, Math.floor(maxIterLines / 4))));
		for (let k = 0; k < its.length; k += stride) pick.add(its[k] as number);
		const active = new Set(rows.filter((x) => x.limited || x.folded).map((x) => x.stamp));
		for (const it of [...pick].sort((p, q) => p - q)) {
			const line = rows
				.filter((x) => x.it === it && (active.has(x.stamp) || rows.filter((y) => y.stamp === x.stamp).some((y) => y.limited)))
				.map((x) => `s${x.stamp} d=${(x.diff / x.width).toFixed(2)}w step=${(x.step / x.width).toFixed(2)}w cap=${(x.cap / x.width).toFixed(3)}w${x.limited ? " LIM" : ""}${x.folded ? " FOLD" : ""} raw=${x.raw.toFixed(3)} out=${x.out.toFixed(3)} vout=${x.vout.toFixed(3)}`)
				.join(" || ");
			const info = iterInfo[it];
			const head = info === undefined ? "" : `delta ${info.delta.toExponential(2)}@${info.node}${dampings[it] !== undefined && dampings[it] < 1 ? ` DAMP ${dampings[it]!.toExponential(2)}` : ""} lim[${[...info.limiters].map((l) => l.replace(/ \+=\d+ -=\d+ out=\d+/, "")).join(",")}] `;
			if (line !== "" || info !== undefined) sampleReports.push(`    it ${String(it).padStart(4)}: ${head}${line}`);
		}
	}
	return r;
};

const rt = new ReferenceRuntime(program) as Rt;
rt.prepare(RATE, { maxNewtonIterations: cap, ...(os > 1 ? { oversample: os } : {}) });
for (const [k, v] of Object.entries(controlsFor(slug))) rt.setControl(k, v);
const BLK = 128;
const t0 = performance.now();
let lastPrinted = 0;
for (let i = 0; i < to; i += BLK) {
	const n = Math.min(BLK, to - i);
	const b0 = performance.now();
	rt.process(input.subarray(i, i + n));
	const ms = performance.now() - b0;
	if (ms > 2000) console.log(`SLOW TS block at sample ${i} (${(i / RATE).toFixed(4)} s): ${ms.toFixed(0)} ms; telemetry ${JSON.stringify({ total: rt.telemetry().totalIterations, nc: rt.telemetry().nonConvergedSamples, stalled: rt.telemetry().stalledSamples, flagged: rt.telemetry().solvedButFlaggedSamples })}`);
	if (sampleReports.length > lastPrinted) { for (const l of sampleReports.slice(lastPrinted)) console.log(l); lastPrinted = sampleReports.length; }
	if (capHits >= stopAfterCap) { console.log(`stopped after ${capHits} cap-hit solves`); break; }
}
const t = rt.telemetry();
console.log(`${slug} TS os${os} cap ${cap} to sample ${to}: ${((performance.now() - t0) / 1000).toFixed(1)} s wall; nonConverged ${t.nonConvergedSamples} stalled ${t.stalledSamples} flagged ${t.solvedButFlaggedSamples} peak ${t.peakIterations} total ${t.totalIterations}`);

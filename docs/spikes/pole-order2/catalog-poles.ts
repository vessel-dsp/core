// Census of every op-amp stamp the corpus compiles: its open-loop gain A0, the dominant pole GBP/A0 the engine puts it at (GBP = the 1e6 class constant), and the
// margin of that pole against Nyquist of the solver rate (the existing rule returns the no-pole limit when poleHz >= fs/2). Compile only: no engine code runs.
//   bun docs/spikes/pole-order2/catalog-poles.ts
import { corpusFiles, compileResult } from "./lib";
const GBP = Number(process.env.GBW_HZ ?? 1e6);
type Row = { slug: string; a0: number; railed: boolean };
const rows: Row[] = [];
for (const f of corpusFiles()) {
	const r = compileResult(f.file);
	if (r.status !== "ok") continue;
	for (const b of r.program.blocks) if (b.kind === "mna") for (const s of b.stamps) if (s.kind === "ideal-opamp") rows.push({ slug: f.slug, a0: s.openLoopGain, railed: s.railHigh !== null && s.railLow !== null });
}
const railed = rows.filter((r) => r.railed);
console.log(`${rows.length} op-amp stamps (${railed.length} railed, the only ones the pole acts on) in ${new Set(rows.map((r) => r.slug)).size} documents; GBP ${GBP}`);
const byA0 = new Map<number, { n: number; docs: Set<string> }>();
for (const r of railed) { const e = byA0.get(r.a0) ?? { n: 0, docs: new Set() }; e.n += 1; e.docs.add(r.slug); byA0.set(r.a0, e); }
console.log("A0 (linear)   pole Hz    sections docs | pole/(fs/2) at x1 48k | at os4 192k | x=dt/(2 tau) at x1 | os4");
for (const [a0, e] of [...byA0].sort((a, b) => a[0] - b[0])) {
	const pole = GBP / a0, tau = 1 / (2 * Math.PI * pole);
	const x = (fs: number) => 1 / fs / (2 * tau);
	console.log(`${a0.toExponential(2).padStart(10)} ${pole.toFixed(2).padStart(10)} ${String(e.n).padStart(9)} ${String(e.docs.size).padStart(4)} | ${(pole / 24000).toExponential(2).padStart(10)} | ${(pole / 96000).toExponential(2).padStart(10)} | ${x(48000).toExponential(2)} | ${x(192000).toExponential(2)}`);
}
const minA0 = Math.min(...railed.map((r) => r.a0)), maxA0 = Math.max(...railed.map((r) => r.a0));
console.log(`smallest railed A0 ${minA0.toExponential(2)} -> pole ${(GBP / minA0).toFixed(2)} Hz = ${(GBP / minA0 / 24000).toExponential(2)} of x1 Nyquist; largest ${maxA0.toExponential(2)} -> ${(GBP / maxA0).toFixed(2)} Hz`);
console.log(`A0 at which the pole reaches Nyquist (GBP ${GBP}): x1 ${(GBP / 24000).toFixed(1)}, os2 ${(GBP / 48000).toFixed(1)}, os4 ${(GBP / 96000).toFixed(1)}, os8 ${(GBP / 192000).toFixed(1)}`);

// Trace of the op-amp stage (nodes 4 = non-inverting input, 9 = inverting, 10 = output) and the stage's output around the first three echoes of an impulse in the
// pipeline.test.ts S5 (iii) fixture, one sample per process() call, from whichever tree this is run in.
//   bun docs/spikes/pole-order2/echo-trace.ts
import { compile } from "@vessel-dsp/compiler";
import { hybridFeedbackDelayPedalUnstableLoop } from "@vessel-dsp/compiler/fixtures/circuits";
import { fixtureRegistry } from "@vessel-dsp/compiler/fixtures/registry";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
const r = compile(hybridFeedbackDelayPedalUnstableLoop, { registry: fixtureRegistry });
if (r.status !== "ok") throw new Error("x");
const rt = new ReferenceRuntime(r.program);
rt.prepare(48000);
const mna = r.program.blocks.filter((b) => b.kind === "mna");
console.log("mna blocks", mna.map((b) => `${b.id}(nodes ${b.nodeCount})`).join(" "));
const rows: string[] = [];
const want = new Set<number>(); for (const c of [145, 290, 435]) for (let k = -2; k <= 4; k += 1) want.add(c + k);
for (let n = 0; n < 440; n += 1) {
	const out = rt.process(Float64Array.of(n === 0 ? 1 : 0))[0] as number;
	if (!want.has(n)) continue;
	const snap = rt.nodeVoltageSnapshot();
	const cells = snap.map((s) => `${s.blockId}:[n4 ${(s.voltages[4] ?? 0).toFixed(4)} n9 ${(s.voltages[9] ?? 0).toFixed(4)} n10 ${(s.voltages[10] ?? 0).toFixed(4)}]`).join(" ");
	rows.push(`n=${String(n).padStart(3)} out ${out.toFixed(4)} ${cells}`);
}
console.log(rows.join("\n"));

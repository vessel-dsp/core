// The failing-test fixture of pipeline.test.ts S5 (iii): a BBD delay loop with an op-amp (Av = 5) in the feedback path; samples around the first three echoes of an impulse.
//   bun docs/spikes/pole-order2/echo-dump.ts
import { compile } from "@vessel-dsp/compiler";
import { hybridFeedbackDelayPedalUnstableLoop, hybridFeedbackDelayPedal } from "@vessel-dsp/compiler/fixtures/circuits";
import { fixtureRegistry } from "@vessel-dsp/compiler/fixtures/registry";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
for (const [name, src] of [["unstable", hybridFeedbackDelayPedalUnstableLoop], ["baseline", hybridFeedbackDelayPedal]] as const) {
	const r = compile(src, { registry: fixtureRegistry });
	if (r.status !== "ok") throw new Error("x");
	const rt = new ReferenceRuntime(r.program);
	rt.prepare(48000);
	const imp = new Float64Array(600); imp[0] = 1;
	const out = rt.process(imp);
	const stamps = r.program.blocks.flatMap((b: any) => (b.kind === "mna" ? b.stamps : [])).filter((s: any) => s.kind === "ideal-opamp") as any[];
	console.log(name, "opamps", stamps.map((s) => `${s.openLoopGain}/${s.railHigh}/${s.railLow}`).join(" "));
	console.log(" out[0..4]", Array.from(out.slice(0, 5)).map((v) => v.toFixed(4)).join(" "));
	console.log(" around 145:", Array.from(out.slice(141, 150)).map((v) => v.toFixed(4)).join(" "));
	console.log(" around 290:", Array.from(out.slice(286, 295)).map((v) => v.toFixed(4)).join(" "));
	console.log(" around 435:", Array.from(out.slice(431, 440)).map((v) => v.toFixed(4)).join(" "));
}

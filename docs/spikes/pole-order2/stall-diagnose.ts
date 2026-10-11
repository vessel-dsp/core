// First 600 samples of a stalling document on the TS console, one sample per process() call: iterations and convergence per sample (first 40), the last failure
// the console recorded (node, residual, limiter), and the op-amp stamps of the failing block. From whichever tree this is run in.
//   bun docs/spikes/pole-order2/stall-diagnose.ts --slug=boss-ch-1 --os=1 [--samples=600]
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, compileFile, fileForSlug, sine } from "./lib";
const slug = arg("slug", "boss-ch-1"), os = Number(arg("os", "1")), N = Number(arg("samples", "600"));
const program = compileFile(fileForSlug(slug));
const rt = new ReferenceRuntime(program);
rt.prepare(48000, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
const input = sine(N, 1000, 0.1);
const chunk = new Float64Array(1);
let last = 0, lastNc = 0;
const rows: string[] = [];
for (let i = 0; i < N; i += 1) {
	chunk[0] = input[i] as number; rt.process(chunk);
	const t = rt.telemetry();
	const d = t.totalIterations - last, nc = t.nonConvergedSamples - lastNc;
	last = t.totalIterations; lastNc = t.nonConvergedSamples;
	if (i < 40 || (nc > 0 && rows.length < 60)) rows.push(`sample ${i}: ${d} iterations${nc ? " NON-CONVERGED" : ""}`);
}
const t = rt.telemetry();
console.log(rows.slice(0, 50).join("\n"));
console.log(`after ${N} samples: it/host ${(t.totalIterations / N).toFixed(2)} NC ${t.nonConvergedSamples} peak ${t.peakIterations} operatingPointFailures ${t.operatingPointFailures}`);
console.log("lastFailure", JSON.stringify((t as any).lastFailure ?? null));

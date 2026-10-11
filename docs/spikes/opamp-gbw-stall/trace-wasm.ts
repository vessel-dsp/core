// Per-sample Newton trace on the WASM console: iteration count and convergence of every host sample of a
// render, reported as runs of cap-hit samples (a "stall" is a run of consecutive samples each burning the
// whole cap). Stops after --stop-after-cap samples at the cap so a stalled render does not take minutes.
//   bun docs/spikes/opamp-gbw-stall/trace-wasm.ts --packet=boss-mt-2 --os=1 [--seconds=8] [--stimulus=twotone|sine]
//        [--hz=1000] [--amp=0.1] [--force-gbp=null|7e6] [--cap=1024] [--stop-after-cap=256] [--print-from=<sample>]
import type { Program } from "@vessel-dsp/compiler";
import { V2WasmEngine } from "@vessel-dsp/runtime";
import { arg, forceGbp, hostInput, programFor } from "./lib";

const slug = arg("packet", "boss-mt-2"), os = Number(arg("os", "1")), seconds = Number(arg("seconds", "8")), cap = Number(arg("cap", "1024"));
const stopAfterCap = Number(arg("stop-after-cap", "256")), printFrom = Number(arg("print-from", "-1"));
const program: Program = forceGbp(programFor(slug), arg("force-gbp", ""));
const RATE = 48000, N = Math.round(RATE * seconds);
const input = hostInput(N, arg("stimulus", "twotone"), Number(arg("hz", "1000")), Number(arg("amp", "0.1")));
const eng = await V2WasmEngine.create(program);
eng.prepare({ sampleRate: RATE, maxNewtonIterations: cap, ...(os > 1 ? { oversample: os } : {}) });
let capHits = 0, nonConverged = 0, total = 0, runStart = -1, runLength = 0;
const runs: Array<{ start: number; length: number }> = [];
const t0 = performance.now();
let i = 0;
for (; i < N; i += 1) {
	eng.processSample(input[i] as number);
	// `getLastIterationCount` is the LAST sub-sample's count at os > 1, so a cap hit is any sub-sample's;
	// the engine's running max tells whether this host sample reached it.
	const used = eng.getLastIterationCount(), converged = eng.getLastConverged();
	total += used;
	if (!converged) nonConverged += 1;
	const atCap = used >= cap;
	if (atCap) {
		capHits += 1;
		if (runStart < 0) { runStart = i; runLength = 0; }
		runLength += 1;
	} else if (runStart >= 0) {
		runs.push({ start: runStart, length: runLength });
		runStart = -1;
	}
	if (printFrom >= 0 && i >= printFrom && i < printFrom + 64) console.log(`sample ${i} (${(i / RATE).toFixed(4)} s): used ${used} converged ${converged}`);
	if (capHits >= stopAfterCap) break;
}
if (runStart >= 0) runs.push({ start: runStart, length: runLength });
const wall = performance.now() - t0;
console.log(`${slug} WASM os${os} cap ${cap}: ${i} host samples in ${(wall / 1000).toFixed(1)} s wall; last-sub-sample cap hits ${capHits}, non-converged host samples ${nonConverged}, engine peak ${eng.getMaxIterations()}, mean used (last sub-sample) ${(total / Math.max(1, i)).toFixed(2)}`);
const shown = runs.length <= 60 ? runs : [...runs.slice(0, 30), ...runs.slice(-30)];
for (const r of shown) console.log(`  cap run from sample ${r.start} (${(r.start / RATE).toFixed(4)} s), length ${r.length}${r.start + r.length >= i ? " (ongoing at stop)" : ""}`);
eng.destroy();

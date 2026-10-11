// Where the two consoles part: render a packet sample by sample on both (TS `process` one sample at a time, WASM
// `processSample`), print the first samples whose outputs differ by more than --bar, with each console's iteration
// count for that sample and the TS console's fold-reseed count so far.
//   bun docs/spikes/opamp-gbw-stall/diverge.ts --packet=blue-box --os=4 [--n=2148] [--bar=1e-4] [--force-gbp=null]
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { arg, controlsFor, forceGbp, hostInput, programFor } from "./lib";
const slug = arg("packet", "blue-box"), os = Number(arg("os", "4")), n = Number(arg("n", "2148")), bar = Number(arg("bar", "1e-4"));
const program = forceGbp(programFor(slug), arg("force-gbp", ""));
const input = hostInput(n, arg("stimulus", "twotone"), Number(arg("hz", "1000")), Number(arg("amp", "0.1")));
const rt = new ReferenceRuntime(program) as ReferenceRuntime & { foldReseedCount: number };
rt.prepare(48000, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
const eng = await V2WasmEngine.create(program);
eng.prepare({ sampleRate: 48000, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
for (const [k, v] of Object.entries(controlsFor(slug))) { rt.setControl(k, v); eng.setControl(k, v); }
let shown = 0, lastTotal = 0, lastReseeds = 0, maxDiff = 0;
for (let i = 0; i < n; i += 1) {
	const t = rt.process(input.subarray(i, i + 1))[0] as number;
	const w = eng.processSample(input[i] as number);
	const tel = rt.telemetry();
	const used = tel.totalIterations - lastTotal; lastTotal = tel.totalIterations;
	const reseeds = rt.foldReseedCount - lastReseeds; lastReseeds = rt.foldReseedCount;
	const d = Math.abs(t - w); maxDiff = Math.max(maxDiff, d);
	if (reseeds > 0 || d > bar) {
		if (shown < 40) console.log(`sample ${i}: |TS-WASM| ${d.toExponential(2)} TS ${t.toFixed(5)} WASM ${w.toFixed(5)} | TS iterations this host sample ${used}, WASM last-sub-sample ${eng.getLastIterationCount()} converged ${eng.getLastConverged()} | TS reseeds this sample ${reseeds} (total ${rt.foldReseedCount}) nc ${tel.nonConvergedSamples}`);
		shown += 1;
	}
}
console.log(`${slug} os${os}: ${n} samples, max |diff| ${maxDiff.toExponential(2)}, TS reseeds ${rt.foldReseedCount}, TS nc ${rt.telemetry().nonConvergedSamples}, TS peak ${rt.telemetry().peakIterations}, WASM peak ${eng.getMaxIterations()}`);
eng.destroy();

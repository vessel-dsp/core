// boss-mt-2, 1 kHz 100 mV, os4: per-block wall time on the WASM console (and optionally TS), to find where a render stalls.
//   bun docs/spikes/opamp-gbw/mt2-probe.ts --console=wasm|ts --os=4 [--seconds=1] [--amp=0.1] [--hz=1000] [--stall-ms=2000]
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { arg, compileFile, corpusFiles, sine } from "./lib";
const cn = arg("console", "wasm"), os = Number(arg("os", "4")), seconds = Number(arg("seconds", "1")), amp = Number(arg("amp", "0.1")), hz = Number(arg("hz", "1000")), stall = Number(arg("stall-ms", "2000"));
const slug = arg("packet", "boss-mt-2");
const program = compileFile(corpusFiles().find((f) => f.slug === slug)!.file);
const N = Math.round(48000 * seconds), BLK = 512, input = sine(N, hz, amp);
const opts = os > 1 ? { oversample: os } : {};
let step: (a: Float64Array) => void;
if (cn === "wasm") { const e = await V2WasmEngine.create(program); e.prepare({ sampleRate: 48000, maxNewtonIterations: 1024, ...opts }); const fo = new Float32Array(BLK); step = (a) => e.processBlock(Float32Array.from(a), fo.subarray(0, a.length)); }
else { const rt = new ReferenceRuntime(program); rt.prepare(48000, { maxNewtonIterations: 1024, ...opts }); step = (a) => void rt.process(a); }
let slow = 0, worst = 0, t00 = performance.now();
for (let i = 0; i < N; i += BLK) { const t0 = performance.now(); step(input.subarray(i, Math.min(N, i + BLK))); const ms = performance.now() - t0; worst = Math.max(worst, ms); if (ms > stall) { slow += 1; console.log(`  slow block at sample ${i}: ${ms.toFixed(0)} ms`); if (slow >= 3) break; } }
console.log(`${slug} ${cn} os${os} ${hz} Hz ${amp} V: total ${(performance.now() - t00).toFixed(0)} ms, worst block ${worst.toFixed(0)} ms, slow blocks ${slow}`);

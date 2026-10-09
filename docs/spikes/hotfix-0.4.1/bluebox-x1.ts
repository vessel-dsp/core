// blue-box at x1 under the workbench parity method (440@0.25 + 1320@0.1, cap 1024, TS fed the float32-rounded input,
// settle 100 / window 2048): TS-vs-WASM max abs, on whichever runtime this resolves (published 0.3.1 in this dir).
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { compileFile, fileForSlug, twoTone } from "./lib";
const program = compileFile(fileForSlug("mxr-blue-box"));
const f32 = Float32Array.from(twoTone(2048));
const ts = new ReferenceRuntime(program);
ts.prepare(48000, { maxNewtonIterations: 1024 });
const t = Array.from(ts.process(Float64Array.from(f32)));
const eng = await V2WasmEngine.create(program);
eng.prepare({ sampleRate: 48000, maxNewtonIterations: 1024 });
const w = new Float32Array(2048);
eng.processBlock(f32, w);
let mx = 0;
for (let i = 100; i < 2048; i += 1) mx = Math.max(mx, Math.abs((t[i] as number) - (w[i] as number)));
console.log(`mxr-blue-box x1 TS vs WASM max abs ${mx.toExponential(3)} (parity bar 1e-4)`);

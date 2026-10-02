import { readFileSync } from "node:fs";
const WB = "/home/joseph/projects/VesselDSP/workbench";
const wbWasm = await import(`${WB}/src/runtime/v2-wasm-engine.ts`);
const prog = JSON.parse(readFileSync("/tmp/player-page/program-core-bumped-v6.json", "utf8"));
const eng: any = await wbWasm.V2WasmEngine.create(prog);
eng.prepare({ sampleRate: 48000 });
const N = 48000; let peak = 0, sum = 0;
for (let i = 0; i < N; i++) {
  const t = i / 48000;
  const x = 0.25 * Math.sin(2 * Math.PI * 440 * t);
  const y = eng.processSample(x);
  const a = Math.abs(y); if (a > peak) peak = a; sum += y * y;
}
eng.destroy();
console.log(`node wasm render lpb-1 bumped: peak=${peak.toFixed(4)} rms=${Math.sqrt(sum / N).toFixed(5)}`);

#!/usr/bin/env bun
// Perf: render 5 s in blocks of 128 through the workbench wasm console under
// Node; report factor faster than real time. Packets: blog circuits + 3 heavy.
// Run: bun /tmp/player-poc/perf.ts
import { readFileSync } from "node:fs";
const WB = "/home/joseph/projects/VesselDSP/workbench";
const BLOG = "/home/joseph/projects/VesselDSP/blog/content/circuits";
const CORPUS = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";
const wbCompiler = await import(`${WB}/src/compiler/index.ts`);
const wbWasm = await import(`${WB}/src/runtime/v2-wasm-engine.ts`);
const SAMPLE_RATE = 48000, SECONDS = 5, BLOCK = 128;
const N = SAMPLE_RATE * SECONDS;
const input = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SAMPLE_RATE;
  input[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 1320 * t);
}
const targets = [
  ["blog pickup-cable-1m", `${BLOG}/pickup-cable-1m.vdsp`],
  ["blog pickup-cable-6m", `${BLOG}/pickup-cable-6m.vdsp`],
  ["blog pickup-buffer-cable-6m", `${BLOG}/pickup-buffer-cable-6m.vdsp`],
  ["blog pickup-cable-6m-fuzz", `${BLOG}/pickup-cable-6m-fuzz.vdsp`],
  ["big-muff-pi", `${CORPUS}/big-muff-pi.vdsp`],
  ["ibanez-ts9", `${CORPUS}/ibanez-ts9.vdsp`],
  ["pro-co-rat-2-v4b-op07cp", `${CORPUS}/pro-co-rat-2-v4b-op07cp.vdsp`],
];
for (const [label, path] of targets) {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { console.log(`${label}: FILE NOT FOUND ${path}`); continue; }
  const res: any = wbCompiler.compile(text, { registry: wbCompiler.pedalPartCatalog });
  if (res.status !== "ok") { console.log(`${label}: workbench compile refused`); continue; }
  const eng: any = await wbWasm.V2WasmEngine.create(res.program);
  eng.prepare({ sampleRate: SAMPLE_RATE });
  const out = new Float32Array(BLOCK);
  // warm up
  const win = new Float32Array(BLOCK), wout = new Float32Array(BLOCK);
  win.set(input.subarray(0, BLOCK)); eng.processBlock(win, wout);
  const t0 = performance.now();
  for (let off = 0; off < N; off += BLOCK) {
    win.set(input.subarray(off, off + BLOCK));
    eng.processBlock(win, out);
  }
  const wallMs = performance.now() - t0;
  eng.destroy();
  const factor = (SECONDS * 1000) / wallMs;
  console.log(`${label}: ${SECONDS}s in ${BLOCK}-sample blocks took ${wallMs.toFixed(0)}ms => ${factor.toFixed(2)}x faster than real time (Node, not a browser)`);
}

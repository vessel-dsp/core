#!/usr/bin/env bun
// 2x2 adjudication per packet over core-ok packets whose bumped program the
// wasm accepts: A = wasm(core-bumped) vs coreTS, B = wasm(wb) vs wbTS,
// C = wasm(core-bumped) vs wasm(wb). Plus a chaos probe for C-disagree rows
// (1e-12 input poke through core TS; self-divergence > 1e-4 tags chaotic).
// Run: bun /tmp/player-poc/adjudicate.ts

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const CORE = "/home/joseph/projects/VesselDSP/core/player-design";
const WB = "/home/joseph/projects/VesselDSP/workbench";
const CORPUS = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";

const coreCompiler = await import(`${CORE}/packages/compiler/src/index.ts`);
const coreRuntime = await import(`${CORE}/packages/runtime/src/reference-runtime.ts`);
const wbCompiler = await import(`${WB}/src/compiler/index.ts`);
const wbRuntime = await import(`${WB}/src/runtime/reference-runtime.ts`);
const wbWasm = await import(`${WB}/src/runtime/v2-wasm-engine.ts`);

const SAMPLE_RATE = 48000, WINDOW = 2048, SETTLE = 100, CAP = 1024;

function metrics(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length;
  let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0, dMax = 0;
  for (let i = 0; i < n; i++) {
    const va = a[i]!, vb = b[i]!;
    dMax = Math.max(dMax, Math.abs(va - vb));
    sumA += va; sumB += vb; sumAA += va * va; sumBB += vb * vb; sumAB += va * vb;
  }
  const varA = Math.max(0, sumAA - (sumA * sumA) / n);
  const varB = Math.max(0, sumBB - (sumB * sumB) / n);
  let rmsA = 0, rmsB = 0;
  for (let i = 0; i < n; i++) { rmsA += a[i]! * a[i]!; rmsB += b[i]! * b[i]!; }
  rmsA = Math.sqrt(rmsA / Math.max(1, n)); rmsB = Math.sqrt(rmsB / Math.max(1, n));
  const silent = rmsA < 1e-5 && rmsB < 1e-5;
  let r = 1.0;
  if (!silent && varA > 1e-12 && varB > 1e-12) r = Math.max(-1, Math.min(1, (sumAB - (sumA * sumB) / n) / Math.sqrt(varA * varB)));
  else if (!silent) r = 0.0;
  return { maxDelta: dMax, correlation: r, silent };
}
const agrees = (m: { maxDelta: number; correlation: number; silent: boolean }) =>
  m.silent ? m.maxDelta < 1e-4 : m.correlation >= 0.9999 && m.maxDelta < 1e-4;
function inputSignal(n: number) {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    x[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 1320 * t);
  }
  return x;
}
function listVdsp(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listVdsp(p, out);
    else if (e.name.endsWith(".vdsp")) out.push(p);
  }
  return out.sort();
}
function renderWasm(engine: any, x: Float64Array): Float64Array {
  const o = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = engine.processSample(x[i]!);
  return o;
}

const input = inputSignal(WINDOW);
const cell: Record<string, string[]> = { "AAA": [], "AAc": [], "AaC": [], "Aac": [], "aAA": [], "aAc": [], "aaC": [], "aac": [] };
const chaosTagged: string[] = [];

for (const path of listVdsp(CORPUS)) {
  const slug = basename(path, ".vdsp");
  const text = readFileSync(path, "utf8");
  let cprog: any = null, wprog: any = null;
  try { const r: any = coreCompiler.compile(text, { registry: coreCompiler.pedalPartCatalog }); if (r.status === "ok") cprog = r.program; } catch {}
  try { const r: any = wbCompiler.compile(text, { registry: wbCompiler.pedalPartCatalog }); if (r.status === "ok") wprog = r.program; } catch {}
  if (!cprog || !wprog) continue;
  const bumped = JSON.parse(JSON.stringify(cprog));
  bumped.formatVersion = 6;
  let e1: any = null, e2: any = null;
  try {
    e1 = await wbWasm.V2WasmEngine.create(bumped);
    e1.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
    e2 = await wbWasm.V2WasmEngine.create(wprog);
    e2.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
  } catch { if (e1) e1.destroy(); if (e2) e2?.destroy?.(); continue; }
  const wCore = renderWasm(e1, input);
  const wWb = renderWasm(e2, input);
  e1.destroy(); e2.destroy();
  const rtC = new coreRuntime.ReferenceRuntime(cprog);
  rtC.prepare(SAMPLE_RATE, { maxNewtonIterations: CAP });
  const tsC = rtC.process(input);
  const rtW = new wbRuntime.ReferenceRuntime(wprog);
  rtW.prepare(SAMPLE_RATE, { maxNewtonIterations: CAP });
  const tsW = rtW.process(input);
  const A = agrees(metrics(tsC.subarray(SETTLE), wCore.subarray(SETTLE)));
  const B = agrees(metrics(tsW.subarray(SETTLE), wWb.subarray(SETTLE)));
  const mC = metrics(wCore.subarray(SETTLE), wWb.subarray(SETTLE));
  const C = agrees(mC);
  const key = `${A ? "A" : "a"}${B ? "A" : "a"}${C ? "C" : "c"}`;
  const entry = `${slug}: dC=${mC.maxDelta.toExponential(2)}`;
  cell[key === "AAC" ? "AAA" : key === "aAC" ? "aAA" : key]!.push(entry);
  if (!C) {
    // chaos probe: 1e-12 poke through core TS alone
    const poked = new Float64Array(input); poked[0]! += 1e-12;
    const rtP = new coreRuntime.ReferenceRuntime(cprog);
    rtP.prepare(SAMPLE_RATE, { maxNewtonIterations: CAP });
    const pOut = rtP.process(poked);
    let self = 0;
    for (let i = SETTLE; i < WINDOW; i++) self = Math.max(self, Math.abs(tsC[i]! - pOut[i]!));
    if (self > 1e-4) chaosTagged.push(`${slug}: self-diverges ${self.toExponential(2)}`);
  }
}

for (const [k, v] of Object.entries(cell)) console.log(`${k} (A=wasm(coreB)vsCoreTS B=wasm(wb)vsWbTS C=wasm-vs-wasm): n=${v.length}`);
for (const [k, v] of Object.entries(cell)) for (const e of v.slice(0, 30)) console.log(`  ${k} ${e}`);
console.log(`chaos-tagged C-disagree rows: ${chaosTagged.length}`);
for (const e of chaosTagged) console.log(`  CHAOS ${e}`);

#!/usr/bin/env bun
// Bump diagnostic over ALL core-ok packets: version 1->6 only, then load into
// workbench wasm. Accepted => compare wasm(core-bumped) vs core-TS (console
// parity) and vs wasm(workbench program) (compiler equivalence).
// Run: bun /tmp/player-poc/bump.ts

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const CORE = "/home/joseph/projects/VesselDSP/core/player-design";
const WB = "/home/joseph/projects/VesselDSP/workbench";
const CORPUS = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";

const coreCompiler = await import(`${CORE}/packages/compiler/src/index.ts`);
const coreRuntime = await import(`${CORE}/packages/runtime/src/reference-runtime.ts`);
const wbCompiler = await import(`${WB}/src/compiler/index.ts`);
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
function agrees(m: { maxDelta: number; correlation: number; silent: boolean }) {
  return m.silent ? m.maxDelta < 1e-4 : m.correlation >= 0.9999 && m.maxDelta < 1e-4;
}
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
const refuseTexts = new Map<string, { n: number; slugs: string[] }>();
let bumpAccept = 0;
let equivAgree = 0, equivDisagree = 0, equivSilent = 0;
let parityAgree = 0, parityDisagree = 0;
const equivDisRows: string[] = [];
const parityDisRows: string[] = [];

for (const path of listVdsp(CORPUS)) {
  const slug = basename(path, ".vdsp");
  const text = readFileSync(path, "utf8");
  let cprog: any = null;
  try { const r: any = coreCompiler.compile(text, { registry: coreCompiler.pedalPartCatalog }); if (r.status === "ok") cprog = r.program; } catch {}
  if (!cprog) continue;
  const bumped = JSON.parse(JSON.stringify(cprog));
  bumped.formatVersion = 6;
  let eng: any = null;
  try {
    eng = await wbWasm.V2WasmEngine.create(bumped);
    eng.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    const short = msg.replace("Failed to load program into V2 C++ Engine: ", "");
    const e0 = refuseTexts.get(short) ?? { n: 0, slugs: [] };
    e0.n++; if (e0.slugs.length < 8) e0.slugs.push(slug);
    refuseTexts.set(short, e0);
    continue;
  }
  bumpAccept++;
  const wBumped = renderWasm(eng, input);
  eng.destroy();
  // console parity: wasm(bumped core) vs core TS
  const rt = new coreRuntime.ReferenceRuntime(cprog);
  rt.prepare(SAMPLE_RATE, { maxNewtonIterations: CAP });
  const tsOut = rt.process(input);
  const mp = metrics(tsOut.subarray(SETTLE), wBumped.subarray(SETTLE));
  if (agrees(mp)) parityAgree++; else { parityDisagree++; if (parityDisRows.length < 15) parityDisRows.push(`${slug}: r=${mp.correlation.toFixed(6)} d=${mp.maxDelta.toExponential(2)}${mp.silent ? " silent" : ""}`); }
  // compiler equivalence: wasm(bumped core) vs wasm(workbench program)
  let wprog: any = null;
  try { const r: any = wbCompiler.compile(text, { registry: wbCompiler.pedalPartCatalog }); if (r.status === "ok") wprog = r.program; } catch {}
  if (wprog) {
    const eng2 = await wbWasm.V2WasmEngine.create(wprog);
    eng2.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
    const wOut2 = renderWasm(eng2, input);
    eng2.destroy();
    const m2 = metrics(wBumped.subarray(SETTLE), wOut2.subarray(SETTLE));
    if (m2.silent && m2.maxDelta < 1e-4) equivSilent++;
    else if (agrees(m2)) equivAgree++;
    else { equivDisagree++; if (equivDisRows.length < 15) equivDisRows.push(`${slug}: r=${m2.correlation.toFixed(6)} d=${m2.maxDelta.toExponential(2)}`); }
  }
}

console.log(`bump 1->6 accepted: ${bumpAccept}`);
console.log("--- post-bump refusal texts ---");
for (const [t, v] of refuseTexts) console.log(`  [x${v.n}] ${t} || eg: ${v.slugs.slice(0, 4).join(",")}`);
console.log(`console parity wasm(bumped-core) vs core-TS: agree=${parityAgree} disagree=${parityDisagree}`);
for (const r of parityDisRows) console.log(`  PAR-DIS ${r}`);
console.log(`compiler equivalence wasm(bumped-core) vs wasm(wb): agree=${equivAgree} silent=${equivSilent} disagree=${equivDisagree}`);
for (const r of equivDisRows) console.log(`  EQ-DIS ${r}`);

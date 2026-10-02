#!/usr/bin/env bun
// Compat POC: does a Program compiled by CORE's compiler run on the
// WORKBENCH's wasm console, and does it agree with core's ReferenceRuntime?
// Read-only w.r.t. both repos; corpus dir is read-only.
// Run: bun /tmp/player-poc/compat.ts [--limit=N]

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

const SAMPLE_RATE = 48000;
const WINDOW = 2048;
const SETTLE = 100;
const CAP = 1024;

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
  if (!silent && varA > 1e-12 && varB > 1e-12) {
    r = Math.max(-1, Math.min(1, (sumAB - (sumA * sumB) / n) / Math.sqrt(varA * varB)));
  } else if (!silent) r = 0.0;
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

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;
const files = listVdsp(CORPUS).slice(0, limit);
console.log(`corpus files: ${listVdsp(CORPUS).length}, testing: ${files.length}`);

const input = inputSignal(WINDOW);
let coreOk = 0, coreRefused = 0;
let wasmAccept = 0, wasmRefuse = 0;
const refuseTexts = new Map<string, number>();
const agreeRows: string[] = [];
const disagreeRows: string[] = [];
const accepted: { slug: string; path: string }[] = [];
const coreOkPrograms: { slug: string; path: string; program: any }[] = [];

for (const path of files) {
  const slug = basename(path, ".vdsp");
  const text = readFileSync(path, "utf8");
  let res: any;
  try {
    res = coreCompiler.compile(text, { registry: coreCompiler.pedalPartCatalog });
  } catch (e) {
    coreRefused++;
    continue;
  }
  if (res.status !== "ok") { coreRefused++; continue; }
  coreOk++;
  coreOkPrograms.push({ slug, path, program: res.program });
  let engine: any = null;
  try {
    engine = await wbWasm.V2WasmEngine.create(res.program);
    engine.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
  } catch (e: any) {
    wasmRefuse++;
    const msg = e instanceof Error ? e.message : String(e);
    refuseTexts.set(msg, (refuseTexts.get(msg) ?? 0) + 1);
    continue;
  }
  wasmAccept++;
  accepted.push({ slug, path });
  // render both
  const rt = new coreRuntime.ReferenceRuntime(res.program);
  rt.prepare(SAMPLE_RATE, { maxNewtonIterations: CAP });
  const tsOut = rt.process(input);
  const wasmOut = new Float64Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) wasmOut[i] = engine.processSample(input[i]!);
  engine.destroy();
  const m = metrics(tsOut.subarray(SETTLE), wasmOut.subarray(SETTLE));
  const row = `${slug}: r=${m.correlation.toFixed(6)} maxDelta=${m.maxDelta.toExponential(3)}${m.silent ? " [silent]" : ""}`;
  if (agrees(m)) agreeRows.push(row); else disagreeRows.push(row);
}

console.log(`core compiled ok: ${coreOk}, core refused/skip: ${coreRefused}`);
console.log(`wasm accepted: ${wasmAccept}, wasm refused: ${wasmRefuse}`);
console.log(`audio agree: ${agreeRows.length}, disagree: ${disagreeRows.length}`);
console.log("--- refusal texts ---");
for (const [t, n] of refuseTexts) console.log(`  [x${n}] ${t}`);
for (const r of agreeRows.slice(0, 40)) console.log(`  AGREE ${r}`);
for (const r of disagreeRows.slice(0, 40)) console.log(`  DISAGREE ${r}`);

// Negative control on a WORKBENCH-compiled v6 program (so the version gate
// passes and the refusal under test is the operator/model gate).
{
  const first = coreOkPrograms[0] ?? null;
  let wprog: any = null;
  if (first) {
    const wres: any = wbCompiler.compile(readFileSync(first.path, "utf8"), { registry: wbCompiler.pedalPartCatalog });
    if (wres.status === "ok") wprog = wres.program;
  }
  const prog = wprog;
  if (prog) {
    const bad1 = JSON.parse(JSON.stringify(prog));
    bad1.requiredOperators = [...(bad1.requiredOperators ?? []), "no-such-operator"];
    try {
      const e1 = await wbWasm.V2WasmEngine.create(bad1);
      e1.destroy();
      console.log("NEGATIVE-CONTROL operator: NOT refused (BAD)");
    } catch (e: any) {
      console.log(`NEGATIVE-CONTROL operator: refused as required: ${e instanceof Error ? e.message : String(e)}`);
    }
    const bad2 = JSON.parse(JSON.stringify(prog));
    bad2.formatVersion = 999;
    try {
      const e2 = await wbWasm.V2WasmEngine.create(bad2);
      e2.destroy();
      console.log("NEGATIVE-CONTROL version: NOT refused (BAD)");
    } catch (e: any) {
      console.log(`NEGATIVE-CONTROL version: refused as required: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Diagnostic: core program with ONLY formatVersion bumped 1->6: accepted?
    // Compared two ways: vs core TS (console parity) and vs wasm(workbench
    // program) (compiler equivalence through the same console).
    const bumped = JSON.parse(JSON.stringify(first!.program));
    bumped.formatVersion = 6;
    try {
      const e3 = await wbWasm.V2WasmEngine.create(bumped);
      e3.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
      const wres: any = wbCompiler.compile(readFileSync(first!.path, "utf8"), { registry: wbCompiler.pedalPartCatalog });
      const rt = new coreRuntime.ReferenceRuntime(first!.program);
      rt.prepare(SAMPLE_RATE, { maxNewtonIterations: CAP });
      const tsOut = rt.process(input);
      const wOut = new Float64Array(WINDOW);
      for (let i = 0; i < WINDOW; i++) wOut[i] = e3.processSample(input[i]!);
      e3.destroy();
      const m = metrics(tsOut.subarray(SETTLE), wOut.subarray(SETTLE));
      let equiv = "n/a (workbench compile refused)";
      if (wres.status === "ok") {
        const e4 = await wbWasm.V2WasmEngine.create(wres.program);
        e4.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
        const wOut2 = new Float64Array(WINDOW);
        for (let i = 0; i < WINDOW; i++) wOut2[i] = e4.processSample(input[i]!);
        e4.destroy();
        const m2 = metrics(wOut.subarray(SETTLE), wOut2.subarray(SETTLE));
        equiv = `r=${m2.correlation.toFixed(6)} maxDelta=${m2.maxDelta.toExponential(3)}`;
      }
      console.log(`VERSION-BUMP-DIAGNOSTIC [${first!.slug}]: accepted after 1->6 bump; vs-coreTS r=${m.correlation.toFixed(6)} maxDelta=${m.maxDelta.toExponential(3)} agree=${agrees(m)}; wasm-vs-wasm(equiv) ${equiv}`);
    } catch (e: any) {
      console.log(`VERSION-BUMP-DIAGNOSTIC [${first!.slug}]: still refused after 1->6 bump: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log("NEGATIVE-CONTROL: no accepted program to corrupt (SKIPPED)");
  }
}

// Positive control: workbench compiles same packets, runs its own wasm vs its own TS runtime.
{
  const slugs = coreOkPrograms.slice(0, 5);
  console.log(`--- positive control over ${slugs.length} packets (workbench compile + workbench wasm vs workbench TS) ---`);
  for (const { slug, path } of slugs) {
    const text = readFileSync(path, "utf8");
    const res: any = wbCompiler.compile(text, { registry: wbCompiler.pedalPartCatalog });
    if (res.status !== "ok") { console.log(`  POS [${slug}]: workbench compile refused (SKIP)`); continue; }
    const rt = new wbRuntime.ReferenceRuntime(res.program);
    rt.prepare(SAMPLE_RATE, { maxNewtonIterations: CAP });
    const tsOut = rt.process(input);
    const eng = await wbWasm.V2WasmEngine.create(res.program);
    eng.prepare({ sampleRate: SAMPLE_RATE, maxNewtonIterations: CAP });
    const wOut = new Float64Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) wOut[i] = eng.processSample(input[i]!);
    eng.destroy();
    const m = metrics(tsOut.subarray(SETTLE), wOut.subarray(SETTLE));
    console.log(`  POS [${slug}]: r=${m.correlation.toFixed(6)} maxDelta=${m.maxDelta.toExponential(3)} agree=${agrees(m)}`);
  }
}

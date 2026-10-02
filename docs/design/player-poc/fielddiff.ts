#!/usr/bin/env bun
// Field diff: for packets both compilers compile, which Program fields differ?
// Run: bun /tmp/player-poc/fielddiff.ts [--limit=N]

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const CORE = "/home/joseph/projects/VesselDSP/core/player-design";
const WB = "/home/joseph/projects/VesselDSP/workbench";
const CORPUS = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";

const coreCompiler = await import(`${CORE}/packages/compiler/src/index.ts`);
const wbCompiler = await import(`${WB}/src/compiler/index.ts`);

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

function stampKinds(blocks: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of blocks ?? []) for (const s of b.stamps ?? []) m.set(s.kind, (m.get(s.kind) ?? 0) + 1);
  return m;
}
function opNames(blocks: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of blocks ?? []) {
    for (const pos of (b.positions ?? [])) for (const op of pos.ops ?? []) m.set(op.op, (m.get(op.op) ?? 0) + 1);
    for (const [k, v] of Object.entries(b.parameters ?? {})) m.set(`param:${k}`, 1);
  }
  return m;
}

let bothOk = 0, coreOnly = 0, wbOnly = 0, neither = 0;
let versionDiff = 0;
const topKeyDiffs = new Map<string, number>();
const blockKindDiffs = new Map<string, number>();
const stampKindUnion = new Map<string, { core: number; wb: number }>();
const opUnion = new Map<string, { core: number; wb: number }>();
const reqOpOnlyCore = new Map<string, number>();
const reqOpOnlyWb = new Map<string, number>();
const reqModelOnlyCore = new Map<string, number>();
const reqModelOnlyWb = new Map<string, number>();
const exampleDiffs: string[] = [];

for (const path of files) {
  const slug = basename(path, ".vdsp");
  const text = readFileSync(path, "utf8");
  let c: any = null, w: any = null;
  try { const r: any = coreCompiler.compile(text, { registry: coreCompiler.pedalPartCatalog }); if (r.status === "ok") c = r.program; } catch {}
  try { const r: any = wbCompiler.compile(text, { registry: wbCompiler.pedalPartCatalog }); if (r.status === "ok") w = r.program; } catch {}
  if (c && w) bothOk++;
  else { if (c && !w) wbOnly0(); if (!c && w) coreOnly0(); if (!c && !w) neither0(); continue; }
  function wbOnly0() { wbOnly++; } function coreOnly0() { coreOnly++; } function neither0() { neither++; }
  if (c.formatVersion !== w.formatVersion) versionDiff++;
  const ck = Object.keys(c).sort().join(",");
  const wk = Object.keys(w).sort().join(",");
  if (ck !== wk) {
    const k = `core:{${Object.keys(c).sort().join(" ")}} wb:{${Object.keys(w).sort().join(" ")}}`;
    topKeyDiffs.set(k, (topKeyDiffs.get(k) ?? 0) + 1);
    if (exampleDiffs.length < 3) exampleDiffs.push(`${slug}: ${k}`);
  }
  const cbk = (c.blocks ?? []).map((b: any) => b.kind).join(",");
  const wbk = (w.blocks ?? []).map((b: any) => b.kind).join(",");
  if (cbk !== wbk) blockKindDiffs.set(`${slug}: core[${cbk}] wb[${wbk}]`, 1);
  for (const [k, v] of stampKinds(c.blocks)) {
    const e = stampKindUnion.get(k) ?? { core: 0, wb: 0 }; e.core += v; stampKindUnion.set(k, e);
  }
  for (const [k, v] of stampKinds(w.blocks)) {
    const e = stampKindUnion.get(k) ?? { core: 0, wb: 0 }; e.wb += v; stampKindUnion.set(k, e);
  }
  for (const [k, v] of opNames(c.blocks)) {
    const e = opUnion.get(k) ?? { core: 0, wb: 0 }; e.core += v; opUnion.set(k, e);
  }
  for (const [k, v] of opNames(w.blocks)) {
    const e = opUnion.get(k) ?? { core: 0, wb: 0 }; e.wb += v; opUnion.set(k, e);
  }
  for (const o of c.requiredOperators ?? []) if (!(w.requiredOperators ?? []).includes(o)) reqOpOnlyCore.set(o, (reqOpOnlyCore.get(o) ?? 0) + 1);
  for (const o of w.requiredOperators ?? []) if (!(c.requiredOperators ?? []).includes(o)) reqOpOnlyWb.set(o, (reqOpOnlyWb.get(o) ?? 0) + 1);
  for (const o of c.requiredModels ?? []) if (!(w.requiredModels ?? []).includes(o)) reqModelOnlyCore.set(o, (reqModelOnlyCore.get(o) ?? 0) + 1);
  for (const o of w.requiredModels ?? []) if (!(c.requiredModels ?? []).includes(o)) reqModelOnlyWb.set(o, (reqModelOnlyWb.get(o) ?? 0) + 1);
}

console.log(`both-ok: ${bothOk}, core-only: ${coreOnly}, wb-only: ${wbOnly}, neither: ${neither}`);
console.log(`formatVersion differs: ${versionDiff} (core=1 always, wb=6 always: verify below)`);
console.log("--- top-level key diffs ---");
for (const [k, n] of topKeyDiffs) console.log(`  [x${n}] ${k}`);
for (const e of exampleDiffs) console.log(`  eg ${e}`);
console.log("--- block-kind sequence diffs ---");
for (const [k] of blockKindDiffs) console.log(`  ${k}`);
console.log("--- stamp kinds seen in only one compiler ---");
for (const [k, v] of [...stampKindUnion.entries()].sort()) if (v.core === 0 || v.wb === 0) console.log(`  ${k}: core=${v.core} wb=${v.wb}`);
console.log("--- ops/params seen in only one compiler ---");
for (const [k, v] of [...opUnion.entries()].sort()) if (v.core === 0 || v.wb === 0) console.log(`  ${k}: core=${v.core} wb=${v.wb}`);
console.log("--- requiredOperators only in core ---");
for (const [k, v] of reqOpOnlyCore) console.log(`  [x${v}] ${k}`);
console.log("--- requiredOperators only in workbench ---");
for (const [k, v] of reqOpOnlyWb) console.log(`  [x${v}] ${k}`);
console.log("--- requiredModels only in core ---");
for (const [k, v] of reqModelOnlyCore) console.log(`  [x${v}] ${k}`);
console.log("--- requiredModels only in workbench ---");
for (const [k, v] of reqModelOnlyWb) console.log(`  [x${v}] ${k}`);

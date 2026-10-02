import { readFileSync } from "node:fs";
const CORE = "/home/joseph/projects/VesselDSP/core/player-design";
const CORPUS = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";
const coreCompiler = await import(`${CORE}/packages/compiler/src/index.ts`);
const coreRuntime = await import(`${CORE}/packages/runtime/src/reference-runtime.ts`);
const SR = 48000, SEC = 5, N = SR * SEC;
const x = new Float64Array(N);
for (let i = 0; i < N; i++) { const t = i / SR; x[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t); }
for (const slug of ["big-muff-pi", "ibanez-ts9", "pro-co-rat-2-v4b-op07cp"]) {
  const text = readFileSync(`${CORPUS}/${slug}.vdsp`, "utf8");
  const r: any = coreCompiler.compile(text, { registry: coreCompiler.pedalPartCatalog });
  if (r.status !== "ok") { console.log(`${slug}: core compile refused`); continue; }
  const rt = new coreRuntime.ReferenceRuntime(r.program);
  rt.prepare(SR);
  const t0 = performance.now();
  rt.process(x);
  const ms = performance.now() - t0;
  console.log(`${slug}: core ReferenceRuntime ${SEC}s took ${ms.toFixed(0)}ms => ${(SEC * 1000 / ms).toFixed(2)}x (Bun/Node, TS interpreter)`);
}

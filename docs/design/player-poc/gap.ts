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
for (const path of listVdsp(CORPUS)) {
  const slug = basename(path, ".vdsp");
  const text = readFileSync(path, "utf8");
  let c: any = null, w: any = null; let cWhy = "", wWhy = "";
  try { const r: any = coreCompiler.compile(text, { registry: coreCompiler.pedalPartCatalog }); if (r.status === "ok") c = r.program; else cWhy = r.reasons.map((x: any) => x.reason).join("; "); } catch (e: any) { cWhy = "THREW: " + String(e).slice(0, 200); }
  try { const r: any = wbCompiler.compile(text, { registry: wbCompiler.pedalPartCatalog }); if (r.status === "ok") w = r.program; else wWhy = r.reasons.map((x: any) => x.reason).join("; "); } catch (e: any) { wWhy = "THREW: " + String(e).slice(0, 200); }
  if (!c || !w) console.log(`GAP ${slug}: core=${c ? "ok" : "REFUSED: " + cWhy} | wb=${w ? "ok" : "REFUSED: " + wWhy}`);
}

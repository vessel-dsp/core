import { readFileSync, writeFileSync } from "node:fs";
const CORE = "/home/joseph/projects/VesselDSP/core/player-design";
const CORPUS = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";
const coreCompiler = await import(`${CORE}/packages/compiler/src/index.ts`);
const text = readFileSync(`${CORPUS}/electro-harmonix-lpb-1.vdsp`, "utf8");
const res: any = coreCompiler.compile(text, { registry: coreCompiler.pedalPartCatalog });
if (res.status !== "ok") { console.log("core compile refused"); process.exit(1); }
console.log("formatVersion:", res.program.formatVersion, "blocks:", res.program.blocks.map((b: any) => b.kind).join(","));
writeFileSync("/tmp/player-page/program-core-v1.json", JSON.stringify(res.program));
const bumped = { ...res.program, formatVersion: 6 };
writeFileSync("/tmp/player-page/program-core-bumped-v6.json", JSON.stringify(bumped));

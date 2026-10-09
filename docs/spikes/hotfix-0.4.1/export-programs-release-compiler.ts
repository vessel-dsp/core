// Check 7 (kernels): the workbench's `scripts/export-programs.ts` exports the catalogs its OLD pinned
// compiler compiled, so the programs for the kernel regeneration are exported here with THIS tree's
// compiler instead: every corpus document (pedals, then amps) through `compile` with `pedalPartCatalog`,
// `emit(program).text` written per slug exactly as the catalog generator writes it.
//   bun docs/spikes/hotfix-0.4.1/export-programs-release-compiler.ts --out=<dir>
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { compile, emit, pedalPartCatalog } from "@vessel-dsp/compiler";
import { arg, corpusFiles } from "./lib";

const out = arg("out", "");
if (out === "") throw new Error("--out=<dir> required");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const pkg = JSON.parse(readFileSync(new URL("../../../packages/compiler/package.json", import.meta.url), "utf8")) as { version: string };
let written = 0;
for (const { slug, file } of corpusFiles()) {
	const result = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (result.status !== "ok") {
		console.log(`  skip ${slug}: ${result.status}`);
		continue;
	}
	writeFileSync(`${out}/${slug}.json`, emit(result.program).text, "utf8");
	written += 1;
}
console.log(`compiler package version ${pkg.version}; wrote ${written} programs to ${out}`);

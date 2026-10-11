// Export every corpus document's compiled program text (emit(program).text) per slug, from whichever tree this runs in,
// so two trees' programs can be compared byte for byte.   bun docs/spikes/opamp-gbw/corpus-programs.ts --out=<dir>
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { compile, emit, pedalPartCatalog } from "@vessel-dsp/compiler";
import { arg, corpusFiles } from "./lib";

const out = arg("out", "");
if (out === "") throw new Error("--out=<dir> required");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let ok = 0, other = 0;
const warnings: Record<string, string[]> = {};
for (const { slug, file } of corpusFiles()) {
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") { other += 1; writeFileSync(`${out}/${slug}.status`, r.status); continue; }
	writeFileSync(`${out}/${slug}.json`, emit(r.program).text);
	warnings[slug] = r.warnings.map((w) => w.code);
	ok += 1;
}
writeFileSync(`${out}/_warnings.json`, JSON.stringify(warnings));
console.log(`${ok} programs written, ${other} not ok, -> ${out}`);

// Export compiled corpus programs as JSON for kernel regeneration (in-worktree
// replacement for the workbench's export-programs input): one file per program
// under <outdir>. Read-only against the artifact corpus.
//
// Usage:
//   bun docs/spikes/sparse-pivot/export-corpus-programs.ts --outdir=docs/spikes/sparse-pivot/programs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { arg, corpusFiles } from "./lib";

const OUTDIR = arg("outdir", "docs/spikes/sparse-pivot/programs");
mkdirSync(OUTDIR, { recursive: true });
let ok = 0;
let failed = 0;
for (const amps of [false, true]) {
	for (const file of corpusFiles(amps)) {
		const packet = basename(file, ".vdsp");
		const name = `${amps ? "amp-" : ""}${packet}.json`;
		try {
			const result = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
			if (result.status !== "ok") {
				failed += 1;
				continue;
			}
			writeFileSync(join(OUTDIR, name), JSON.stringify(result.program));
			ok += 1;
		} catch {
			failed += 1;
		}
	}
}
console.log(`exported ${ok} programs to ${OUTDIR} (${failed} failed)`);

// Read-only probe: block structure of the six profile packets (size, linear, eliminate,
// sparse schedule, nonlinear stamp kinds) so the harness knows which Newton path each takes.
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { PACKETS } from "./lib";

for (const [slug, p] of Object.entries(PACKETS)) {
	const r = compile(readFileSync(p.file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") { console.log(slug, "compile", r.status); continue; }
	const prog = r.program as any;
	console.log(`\n${slug}: blocks=${prog.blocks.length} order=${prog.order.length} controls=${prog.controls.map((c: any) => c.id).join(",")}`);
	for (const b of prog.blocks) {
		if (b.kind !== "mna") { console.log(`  ${b.id} kind=${b.kind}`); continue; }
		const kinds = new Map<string, number>();
		for (const s of b.stamps) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
		console.log(`  ${b.id} n=${b.nodeCount + b.auxCount} linear=${b.linear} eliminate=${b.eliminate} sparse=${b.sparseSchedule ? `slots=${b.sparseSchedule.slots} ops=${b.sparseSchedule.sparseOps}/${b.sparseSchedule.denseOps}` : "null"} out=${b.outputNode} stamps=${[...kinds].map(([k, v]) => `${k}:${v}`).join(" ")}`);
	}
}

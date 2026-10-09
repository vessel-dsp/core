// The corpus sweep's `methodItPerHost` is the scratch counter (nonlinear standard-pass
// solves only) while `shippedItPerHost` is runtime telemetry (every scheduled MNA block,
// linear ones at exactly one iteration per sub-sample). This adds the exact linear-block
// contribution (scheduled linear MNA blocks x1) to the method column so both sides count the
// same thing, writing <file>.fixed.jsonl.
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ARTIFACT_CORPUS } from "./lib";
for (const file of process.argv.slice(2)) {
	const amps = file.includes("amps");
	const out: string[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		const r = JSON.parse(line);
		if (r.compile === "ok") {
			const src = readFileSync(`${ARTIFACT_CORPUS}/${amps ? "amps/" : ""}${r.packet}.vdsp`, "utf8");
			const c = compile(src, { registry: pedalPartCatalog });
			if (c.status === "ok") {
				const blocks = new Map(c.program.blocks.map((b) => [b.id, b]));
				const linear = c.program.order.filter((id) => { const b = blocks.get(id) as any; return b !== undefined && b.kind === "mna" && b.linear; }).length;
				r.methodItPerHostCounter = r.methodItPerHost;
				r.linearBlocksScheduled = linear;
				r.methodItPerHost = r.methodItPerHost + linear;
			}
		}
		out.push(JSON.stringify(r));
	}
	writeFileSync(file.replace(/\.jsonl$/, ".fixed.jsonl"), `${out.join("\n")}\n`);
	console.log(`${file}: ${out.length} rows`);
}

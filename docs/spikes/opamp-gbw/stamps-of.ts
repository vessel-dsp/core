// The op-amp stamps (and the gain-bandwidth warning) a document compiles to.   bun docs/spikes/opamp-gbw/stamps-of.ts <slug|path>...
import { PACKETS, compileResult, corpusFiles } from "./lib";
for (const a of process.argv.slice(2)) {
	const file = PACKETS[a]?.file ?? corpusFiles().find((f) => f.slug === a)?.file ?? a;
	const r = compileResult(file);
	if (r.status !== "ok") { console.log(`${a}: ${r.status}`); continue; }
	const stamps = r.program.blocks.flatMap((b) => (b.kind === "mna" ? b.stamps : [])).filter((s) => s.kind === "ideal-opamp") as any[];
	console.log(`${a}: ${stamps.length} op-amp stamp(s): ${stamps.map((s) => `${s.railHigh === null ? "unrailed " : ""}A0=${s.openLoopGain} GBP=${s.gainBandwidthHz}`).join(" | ")}`);
	for (const w of r.warnings) if (w.code === "opamp-gain-bandwidth-default") console.log(`   WARN ${w.code} sections=${(w as any).sections}: ${w.detail.slice(0, 200)}`);
}

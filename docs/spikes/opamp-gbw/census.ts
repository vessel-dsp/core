// Coverage census (item 3): across the compiled corpus documents, per op-amp part id, where each section's gain-bandwidth product comes
// from (the packet's typed GBP, the catalog's datasheet figure, or null / the class default), how many sections move off 1 MHz and by
// how much, and which parts have a datasheet with no GBP row. Read-only against the corpus; compiles with pedalPartCatalog and reads
// the lawed netlist (law resolutions + the devices' own typed parameters), not the text of any packet.
//   bun docs/spikes/opamp-gbw/census.ts [--json=<file>]
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { attachDeviceLaws } from "@vessel-dsp/compiler/device-laws";
import { readNetlist } from "@vessel-dsp/compiler/netlist";
import { opampGainBandwidthAbsent, opampRegistryRecords } from "@vessel-dsp/compiler/part-catalog";
import { foldPartId } from "@vessel-dsp/compiler/registry";
import { arg, corpusFiles } from "./lib";

type Row = { slug: string; device: string; part: string | null; source: "packet" | "catalog" | "null" | "compandor-null"; hertz: number | null; railed: boolean };
const rows: Row[] = [];
let compiled = 0, withOpamp = 0;
const docs = new Map<string, { sections: number; nonNull: number; moved: number; defaulted: number; gbps: Set<string> }>();
for (const { slug, file } of corpusFiles()) {
	const source = readFileSync(file, "utf8");
	if (compile(source, { registry: pedalPartCatalog }).status !== "ok") continue;
	compiled += 1;
	const netlist = readNetlist(source);
	const lawed = attachDeviceLaws(netlist, pedalPartCatalog);
	const byId = new Map(lawed.netlist.devices.map((d) => [d.id, d]));
	let any = false;
	for (const resolution of lawed.resolutions) {
		if (resolution.outcome !== "law") continue;
		const law = resolution.law;
		if (law.kind !== "ideal-opamp" && law.kind !== "compandor") continue;
		any = true;
		const id = resolution.device.replace(/#\d+$/, "");
		const device = byId.get(id) ?? byId.get(resolution.device);
		const declared = (device?.parameters as Record<string, number> | undefined)?.gainBandwidthHz;
		let src: Row["source"], hertz: number | null;
		if (law.kind === "compandor") { src = "compandor-null"; hertz = null; }
		else if (typeof declared === "number") { src = "packet"; hertz = declared; }
		else if (law.gainBandwidthHz !== undefined) { src = "catalog"; hertz = law.gainBandwidthHz; }
		else { src = "null"; hertz = null; }
		rows.push({ slug, device: resolution.device, part: device?.identity.partNumber ?? null, source: src, hertz, railed: law.railHigh !== null && law.railLow !== null });
	}
	if (any) withOpamp += 1;
}
const railed = rows.filter((r) => r.railed);
console.log(`corpus documents compiled ok: ${compiled}; documents with at least one op-amp section law: ${withOpamp}; op-amp section laws: ${rows.length} (railed ${railed.length}, unrailed ${rows.length - railed.length})`);
const by = (rs: Row[], f: (r: Row) => string) => { const m = new Map<string, Row[]>(); for (const r of rs) { const k = f(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); } return m; };
const table = (title: string, rs: Row[]) => {
	console.log(`\n${title}`);
	console.log("part id".padEnd(22) + "sections  docs  packet catalog null | stated GBP (Hz)                 | factor vs 1 MHz | datasheet row / reason");
	const absentReason = new Map<string, string>();
	for (const a of opampGainBandwidthAbsent) for (const id of a.partIds) absentReason.set(foldPartId(id), a.reason);
	const rowFor = new Map<string, number>();
	for (const r of opampRegistryRecords) {
		const hertz = r.gainBandwidthHz?.value;
		if (hertz === undefined) continue;
		for (const id of r.partIds) rowFor.set(foldPartId(id), hertz);
	}
	for (const [part, group] of [...by(rs, (r) => r.part ?? "(no part number)")].sort((a, b) => b[1].length - a[1].length)) {
		const slugs = new Set(group.map((r) => r.slug));
		const packet = group.filter((r) => r.source === "packet").length, catalog = group.filter((r) => r.source === "catalog").length;
		const nul = group.length - packet - catalog;
		const values = [...new Set(group.filter((r) => r.hertz !== null).map((r) => r.hertz as number))].sort((a, b) => a - b);
		const factor = values.length === 0 ? "1 (default)" : values.map((v) => (v / 1e6).toFixed(2)).join(", ");
		const folded = foldPartId(part);
		const note = rowFor.has(folded) ? `datasheet ${(rowFor.get(folded)! / 1e6).toFixed(2)} MHz` : absentReason.has(folded) ? "ABSENT: " + (absentReason.get(folded) as string).slice(0, 70) : part === "(no part number)" ? "no part number" : "not in catalog";
		console.log(`${part.padEnd(22)} ${String(group.length).padStart(8)} ${String(slugs.size).padStart(5)} ${String(packet).padStart(6)} ${String(catalog).padStart(7)} ${String(nul).padStart(4)} | ${values.map((v) => v.toExponential(2)).join(", ").padEnd(32) || "-".padEnd(32)} | ${factor.padEnd(15)} | ${note}`);
	}
};
table("RAILED sections (the ones the pole acts on), by part id:", railed);
const moved = railed.filter((r) => r.hertz !== null && r.hertz !== 1e6);
console.log(`\nrailed sections: ${railed.length}; stated by the packet ${railed.filter((r) => r.source === "packet").length}; by the catalog ${railed.filter((r) => r.source === "catalog").length}; null (class default) ${railed.filter((r) => r.source === "null").length}; compandor-internal null ${railed.filter((r) => r.source === "compandor-null").length}`);
console.log(`sections that move off 1 MHz: ${moved.length} in ${new Set(moved.map((r) => r.slug)).size} documents; stated exactly 1 MHz (no move): ${railed.filter((r) => r.hertz === 1e6).length}`);
const dist = by(moved, (r) => `${(r.hertz as number) / 1e6} MHz`);
console.log(`  by value: ${[...dist].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, v]) => `${k}: ${v.length}`).join(", ")}`);
const perDoc = by(moved, (r) => r.slug);
console.log(`\nDocuments with a section off 1 MHz (${perDoc.size}):`);
for (const [slug, rs] of [...perDoc].sort()) console.log(`  ${slug.padEnd(40)} ${rs.length} sect  ${[...new Set(rs.map((r) => `${r.part ?? "?"}[${r.source}]=${(r.hertz as number) / 1e6}`))].join(", ")}`);
const nullParts = by(railed.filter((r) => r.source === "null"), (r) => r.part ?? "(no part number)");
console.log(`\nRailed sections left on the default, by part (${railed.filter((r) => r.source === "null").length} sections in ${new Set(railed.filter((r) => r.source === "null").map((r) => r.slug)).size} documents):`);
for (const [part, g] of [...nullParts].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${part.padEnd(24)} ${String(g.length).padStart(3)} sections in ${new Set(g.map((r) => r.slug)).size} docs`);
const out = arg("json", "");
if (out !== "") writeFileSync(out, JSON.stringify(rows));

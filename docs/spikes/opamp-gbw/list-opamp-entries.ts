import { pedalPartCatalog } from "@vessel-dsp/compiler";
let i = 0;
for (const e of pedalPartCatalog.entries) {
	const m: any = e.model;
	const laws: any[] = m.kind === "law" ? [m.law] : m.kind === "sections" ? m.sections.map((s: any) => s.law) : [];
	const amps = laws.filter((l) => l.kind === "ideal-opamp");
	if (amps.length === 0) continue;
	i += 1;
	console.log(`#${i} [${m.kind}] sections=${laws.length} Aol=${[...new Set(amps.map((l) => l.openLoopGain))].join("/")} GBP=${[...new Set(amps.map((l) => l.gainBandwidthHz ?? "-"))].join("/")} drop=${[...new Set(amps.map((l) => l.outputSwingDropVolts))].join("/")}\n   ids: ${e.partIds.join(", ")}`);
}

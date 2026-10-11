// Identity control for the DC pass: the operating point of every corpus document, on both consoles, hashed. The op-amp is transparent at DC (`dc` => no pole), and this change
// does not touch that pass, so every document's node voltages after prepare() must hash identically in the baseline tree and in this one. TS: the reference solves the
// operating point lazily at the first process() call, so an empty process() forces it, then the per-block node voltages and the seeded pole raw state are read (private maps,
// read-only). WASM: the console solves in prepare(); the node voltages are read through getOperatingPointNode.
//   bun docs/spikes/pole-order2/dc-points.ts --out=<json> [--os=1,4] [--only=a,b]
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { arg, corpusFiles, sha256 } from "./lib";
const out = arg("out", ""), factors = arg("os", "1,4").split(",").map(Number), only = arg("only", "").split(",").filter(Boolean);
const rows: Array<Record<string, unknown>> = [];
for (const { slug, file } of corpusFiles()) {
	if (only.length > 0 && !only.includes(slug)) continue;
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") continue;
	const stamps = r.program.blocks.flatMap((b) => (b.kind === "mna" ? b.stamps : [])).filter((s) => s.kind === "ideal-opamp") as any[];
	const row: Record<string, unknown> = { slug, opamps: stamps.length, railed: stamps.filter((s) => s.railHigh !== null && s.railLow !== null).length };
	try {
		for (const os of factors) {
			const rt = new ReferenceRuntime(r.program);
			rt.prepare(48000, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
			rt.process(new Float64Array(0));
			const nv = (rt as any).nodeVoltages as Map<string, number[]>;
			const flat: number[] = [];
			for (const b of r.program.blocks) if (b.kind === "mna") flat.push(...(nv.get(b.id) ?? []));
			row[`ts_os${os}`] = sha256(Float64Array.from(flat));
			const raw = (rt as any).opampRawState as Map<number, number>;
			row[`ts_os${os}_raw`] = sha256(Float64Array.from([...raw.entries()].sort((a, b) => a[0] - b[0]).flatMap(([k, v]) => [k, v])));
			const eng = await V2WasmEngine.create(r.program);
			eng.prepare({ sampleRate: 48000, maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
			const wf: number[] = [];
			r.program.blocks.forEach((b, bi) => { if (b.kind === "mna") for (let n = 0; n < b.nodeCount; n += 1) wf.push(eng.getOperatingPointNode(bi, n)); });
			row[`wasm_os${os}`] = sha256(Float64Array.from(wf));
			eng.destroy();
		}
	} catch (e) { row.error = String(e).slice(0, 160); }
	rows.push(row);
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));
console.log(`${rows.length} documents (${rows.filter((x) => (x.railed as number) > 0).length} with a railed op-amp)${out ? ` -> ${out}` : ""}`);

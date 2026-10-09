// Name a block row by its source node and the netlist devices (any kind) on that node, for
// the census rows no nonlinear stamp writes (transformer / inductor / supply rows).
//   bun docs/spikes/newton-budget/resolve-rows.ts --packet=gro100 --rows=37,54,50,82,35
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog, readNetlist } from "@vessel-dsp/compiler";
import { PACKETS, arg } from "./lib";
const spec = PACKETS[arg("packet", "gro100")]!;
const source = readFileSync(spec.file, "utf8");
const r = compile(source, { registry: pedalPartCatalog });
if (r.status !== "ok") throw new Error(r.status);
const net = readNetlist(source);
const block = r.program.blocks.find((b) => b.kind === "mna") as any;
for (const row of arg("rows", "").split(",").map(Number)) {
	if (row >= block.nodeCount) {
		const aux = row - block.nodeCount;
		const owners = block.stamps.filter((s: any) => s.sourceIndex === aux || s.auxIndex === aux || s.branch === aux).map((s: any) => s.kind);
		console.log(`row ${row}: aux unknown #${aux} (branch current) stamps=${JSON.stringify(owners)} auxStamps=${block.stamps.filter((s: any) => ["dc-source","ac-source","transformer","inductor","input-source","ideal-opamp"].includes(s.kind)).map((s: any) => `${s.kind}:${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => /index|aux|row/i.test(k))))}`).join(" ")}`);
		continue;
	}
	const node = block.nodeIds[row];
	const devs = net.devices.filter((d) => d.nodes.includes(node)).map((d) => `${d.id}[${d.kind}]`);
	const stamps = block.stamps.filter((s: any) => Object.values(s).includes(row)).map((s: any) => s.kind);
	console.log(`row ${row}: source node ${node}; devices ${devs.join(", ")}; stamps touching the row: ${stamps.join(",")}`);
}

// Which unknowns carry the fixed-point deviation on a packet, and are they coupled to the
// output? Runs a method with the twin on and reports, per block row, the worst deviation
// (tolerance units) and the voltages on both sides at that sub-sample, with the row named.
//   bun docs/spikes/newton-budget/probe-deviation.ts --packet=gro100 --method=m1adapt --os=1 --warmup=2400 --samples=4800
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog, readNetlist } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PACKETS, arg, tone } from "./lib";
import { METHODS } from "./measure";
import * as scratch from "./scratch-newton";

const slug = arg("packet", "gro100");
const { existsSync } = await import("node:fs");
const { ARTIFACT_CORPUS } = await import("./lib");
const spec = PACKETS[slug] ?? { file: existsSync(`${ARTIFACT_CORPUS}/${slug}.vdsp`) ? `${ARTIFACT_CORPUS}/${slug}.vdsp` : `${ARTIFACT_CORPUS}/amps/${slug}.vdsp`, controls: {}, ohms: 0 };
const OS = Number(arg("os", "1")), WARM = Number(arg("warmup", "2400")), N = Number(arg("samples", "4800"));
const source = readFileSync(spec.file, "utf8");
const r = compile(source, { registry: pedalPartCatalog });
if (r.status !== "ok") throw new Error(r.status);
const net = readNetlist(source);
const blocks = new Map<string, any>();
for (const b of r.program.blocks) if (b.kind === "mna") blocks.set(b.id, b);
const rowName = (b: any, row: number) => {
	if (row >= b.nodeCount) return `aux#${row - b.nodeCount}`;
	const node = b.nodeIds[row];
	return `node ${node} [${net.devices.filter((d) => d.nodes.includes(node)).map((d) => d.id).join(",")}]`;
};
type Worst = { dev: number; a: number; b: number; sample: number; twinUsed: number; used: number };
const worst = new Map<string, Map<number, Worst>>();
let over1 = 0, pairs = 0;
scratch.install();
scratch.configure({ ...METHODS[arg("method", "m1adapt")], fixedPointCheck: true, onSubSample: (info) => {
	if (info.twin === null || !info.twin.converged || !info.converged) return;
	pairs += 1;
	if (info.twin.deviationTol > 1) over1 += 1;
	const m = worst.get(info.blockId) ?? new Map<number, Worst>();
	worst.set(info.blockId, m);
	for (let i = 0; i < info.solution.length; i += 1) {
		const x = info.solution[i] as number, y = info.twin.solution[i] as number;
		const dev = Math.abs(x - y) / (1e-3 * Math.max(Math.abs(x), Math.abs(y)) + 1e-6);
		const w = m.get(i);
		if (w === undefined || dev > w.dev) m.set(i, { dev, a: x, b: y, sample: info.elapsedSamples, twinUsed: info.twin.used, used: info.used });
	}
} });
const rt = new ReferenceRuntime(r.program);
rt.prepare(48000, { maxNewtonIterations: 64, ...(OS > 1 ? { oversample: OS } : {}) });
for (const [k, v] of Object.entries(spec.controls)) rt.setControl(k, v);
rt.process(tone(WARM));
worst.clear(); over1 = 0; pairs = 0;
rt.process(tone(N, 0.1, 1000, 48000, WARM));
scratch.uninstall();
console.log(`${slug} os=${OS}: converged pairs ${pairs}, deviating >1 tol unit: ${over1}`);
for (const [id, m] of worst) {
	const b = blocks.get(id);
	const rows = [...m.entries()].sort((x, y) => y[1].dev - x[1].dev).slice(0, 10);
	console.log(`block ${id} (output row ${b.outputNode}):`);
	for (const [row, w] of rows) console.log(`  row ${String(row).padStart(3)} dev=${w.dev.toExponential(2)} method=${w.a.toExponential(4)} twin=${w.b.toExponential(4)} |diff|=${Math.abs(w.a - w.b).toExponential(2)} V at sub-sample ${w.sample} (used ${w.used}/twin ${w.twinUsed}) ${rowName(b, row)}`);
}

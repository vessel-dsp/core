// Every stamp of a document's MNA blocks that touches one of the given nodes, with its index, so a traced op-amp's
// surroundings can be read: bun docs/spikes/opamp-gbw-stall/nodes-of.ts <slug|packet|path> <node>...
import { programFor } from "./lib";
const [name, ...nodeArgs] = process.argv.slice(2);
const nodes = new Set(nodeArgs.map(Number));
const program = programFor(name!);
for (const b of program.blocks) {
	if (b.kind !== "mna") continue;
	console.log(`block ${b.id}: ${b.nodeCount} nodes, ${b.auxCount} aux, output node ${b.outputNode}`);
	b.stamps.forEach((s, i) => {
		const o = s as unknown as Record<string, unknown>;
		const terminals = Object.entries(o).filter(([k, v]) => typeof v === "number" && /^(a|b|plus|minus|output|base|collector|emitter|gate|drain|source|anode|cathode|inP|inN|outP|outN|bias|vee|node|grid|plate|p|n)$/.test(k)) as Array<[string, number]>;
		if (!terminals.some(([, v]) => nodes.has(v))) return;
		const values = Object.entries(o).filter(([k, v]) => !terminals.some(([t]) => t === k) && (typeof v === "number" || typeof v === "string") && k !== "kind").map(([k, v]) => `${k}=${typeof v === "number" ? Number(v).toPrecision(4) : v}`).slice(0, 6).join(" ");
		console.log(`  s${i} ${s.kind} ${terminals.map(([k, v]) => `${k}=${v}`).join(" ")} ${values}`);
	});
}

// Map kernel fingerprints to (packet, block) for the regen diff.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Program, SparseSchedule } from "@vessel-dsp/compiler";

const dir = "/home/joseph/projects/VesselDSP/core/sparse-numeric-pivot/docs/spikes/sparse-pivot/programs";

function fingerprint(schedule: SparseSchedule): number {
	let hash = 2166136261 >>> 0;
	const mix = (value: number): void => {
		for (let shift = 0; shift < 32; shift += 8) {
			hash = (hash ^ ((value >> shift) & 0xff)) >>> 0;
			hash = Math.imul(hash, 16777619) >>> 0;
		}
	};
	mix(schedule.size);
	mix(schedule.slots);
	mix(schedule.factorCount);
	for (const op of schedule.ops) mix(op);
	for (const row of schedule.gatherRow) mix(row);
	for (const column of schedule.gatherColumn) mix(column);
	return hash >>> 0;
}

const want = new Set(process.argv.slice(2));
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
	const program = JSON.parse(readFileSync(join(dir, file), "utf8")) as Program;
	for (const block of program.blocks) {
		if (block.kind !== "mna" || block.sparseSchedule === null) continue;
		if (block.sparseSchedule.ops.length / 4 < 64) continue;
		const fp = fingerprint(block.sparseSchedule).toString(16).padStart(8, "0");
		if (want.size === 0 || want.has(fp)) {
			console.log(`${fp} ${file} ${block.id} n=${block.nodeCount + block.auxCount}`);
		}
	}
}

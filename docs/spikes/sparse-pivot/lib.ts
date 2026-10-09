// Tau sensitivity, v2: dense references cached to disk so the sweep is
// resumable and each tau candidate costs one sparse render instead of two.
//
// Step 1 (cache): for each packet, render forced-dense warmup+samples and
//   write raw f64 to <cache>/<packet>.f64 (plus a .json sidecar with rms).
// Step 2 (sweep): for each tau, swap the candidate into a program copy with
//   settle skipped and compare against the cached dense output.
//
// Usage:
//   bun docs/spikes/sparse-pivot/tau-cache-dense.ts --packet=boss-aw-2
//   bun docs/spikes/sparse-pivot/tau-sweep2.ts --packet=boss-aw-2 --taus=0.1,0.01,0.001
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

export const ARTIFACT_CORPUS =
	"/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";
export const CACHE_DIR =
	"/home/joseph/projects/VesselDSP/core/sparse-numeric-pivot/docs/spikes/sparse-pivot/dense-cache";

export function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit === undefined ? fallback : hit.slice(name.length + 3);
}

export function tone(n: number): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) {
		out[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
	}
	return out;
}

export type Program = ConstructorParameters<typeof ReferenceRuntime>[0];

export function corpusFiles(amps: boolean): string[] {
	const { readdirSync } = require("node:fs") as typeof import("node:fs");
	const dir = amps ? join(ARTIFACT_CORPUS, "amps") : ARTIFACT_CORPUS;
	return readdirSync(dir)
		.filter((f: string) => f.endsWith(".vdsp"))
		.sort()
		.map((f: string) => join(dir, f));
}

export function loadProgram(packet: string, amps: boolean): Program {
	const dir = amps ? join(ARTIFACT_CORPUS, "amps") : ARTIFACT_CORPUS;
	const result = compile(readFileSync(join(dir, `${packet}.vdsp`), "utf8"), {
		registry: pedalPartCatalog,
	});
	if (result.status !== "ok") throw new Error(`compile ${result.status}`);
	return result.program as Program;
}

export function nullSchedules(program: Program): Program {
	const copy = structuredClone(program) as {
		blocks: { kind: string; sparseSchedule: unknown }[];
	};
	for (const b of copy.blocks) if (b.kind === "mna") b.sparseSchedule = null;
	return copy as unknown as Program;
}

export function relRms(a: Float64Array, b: Float64Array): number {
	let diff2 = 0;
	let b2 = 0;
	for (let i = 0; i < a.length; i += 1) {
		const d = (a[i] as number) - (b[i] as number);
		diff2 += d * d;
		b2 += (b[i] as number) ** 2;
	}
	const norm = Math.sqrt(b2 / a.length);
	const abs = Math.sqrt(diff2 / a.length);
	return norm > 1e-12 ? abs / norm : abs;
}

void basename;

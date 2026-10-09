// Shared pieces for the 0.4.1 hotfix checks (2026-10-09). Run from a clone's root (the root
// tsconfig maps @vessel-dsp/* to src) or from a scratch dir whose node_modules holds the
// published packages: the same script then measures whichever runtime it resolves.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { compile, emit, pedalPartCatalog } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";

export const ARTIFACTS = process.env.ARTIFACTS ?? "/home/joseph/projects/VesselDSP/artifacts";
export const PEDALS = `${ARTIFACTS}/schematics/vessel-dsp`;
export const AMPS = `${PEDALS}/amps`;
export const RATE = 48000;

export function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit === undefined ? fallback : hit.slice(name.length + 3);
}
export const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** Every corpus document (pedals, then amps), sorted by slug within each group. */
export function corpusFiles(): Array<{ slug: string; file: string; amp: boolean }> {
	const pick = (dir: string, amp: boolean) =>
		readdirSync(dir)
			.filter((f) => f.endsWith(".vdsp"))
			.sort()
			.map((f) => ({ slug: f.replace(/\.vdsp$/, ""), file: `${dir}/${f}`, amp }));
	return [...pick(PEDALS, false), ...pick(AMPS, true)];
}

export function fileForSlug(slug: string): string {
	for (const f of corpusFiles()) if (f.slug === slug) return f.file;
	throw new Error(`no corpus document ${slug}`);
}

export function compileFile(file: string): Program {
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") throw new Error(`compile ${r.status}: ${file}`);
	return r.program;
}

export const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
/** Two fingerprints of a compiled program: the emitted text and the JSON of the object itself. */
export function programHashes(program: Program): { text: string; json: string } {
	return { text: sha(emit(program).text), json: sha(JSON.stringify(program)) };
}

/** The workbench scoreboard / parity two-tone: 440 Hz @0.25 + 1320 Hz @0.1, continuous from t=0. */
export function twoTone(n: number, offset = 0, rate = RATE): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) {
		const t = (offset + i) / rate;
		out[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 1320 * t);
	}
	return out;
}
/** NOTE the argument order (n, hz, amp, offset): the Newton-budget spike's own `tone` is (n, amp, hz, rate, offset). */
export function tone(n: number, hz: number, amp: number, offset = 0, rate = RATE): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * (offset + i)) / rate);
	return out;
}

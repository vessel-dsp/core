// Shared harness pieces for the Newton iteration budget spike (2026-10-09).
// Read-only against the artifact corpus and the workbench study packets.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";

const ROOT = "/home/joseph/projects/VesselDSP";
export const ARTIFACT_CORPUS = `${ROOT}/artifacts/schematics/vessel-dsp`;

export type PacketSpec = { file: string; controls: Record<string, number>; ohms: number };

/** The six profile packets of the oversampling report §7 (controls as stated there). */
export const PACKETS: Record<string, PacketSpec> = {
	muff: { file: `${ROOT}/workbench/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp`, controls: { SUSTAIN: 0.5, TONE: 0.5, VOLUME: 0.3 }, ohms: 0 },
	sd1: { file: `${ROOT}/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp`, controls: { Drive: 0.5, Tone: 0.5, Level: 0.3 }, ohms: 0 },
	ts9: { file: `${ARTIFACT_CORPUS}/ibanez-ts9-reissue.vdsp`, controls: { Drive: 0.5, Tone: 0.5, Level: 0.3 }, ohms: 0 },
	ts808: { file: `${ARTIFACT_CORPUS}/ibanez-ts808.vdsp`, controls: {}, ohms: 0 },
	gro100: { file: `${ARTIFACT_CORPUS}/amps/orange-gro100.vdsp`, controls: {}, ohms: 0 },
	"blue-box": { file: `${ARTIFACT_CORPUS}/mxr-blue-box.vdsp`, controls: {}, ohms: 0 },
};

export function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit === undefined ? fallback : hit.slice(name.length + 3);
}
export function flag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

export function corpusFiles(amps: boolean): string[] {
	const dir = amps ? join(ARTIFACT_CORPUS, "amps") : ARTIFACT_CORPUS;
	return readdirSync(dir).filter((f) => f.endsWith(".vdsp")).sort().map((f) => join(dir, f));
}

export function compileFile(file: string): Program {
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") throw new Error(`compile ${r.status}: ${file}`);
	return r.program;
}

/** Forced-dense control: same program, every mna block's schedule nulled (pivot report's method). */
export function nullSchedules(program: Program): Program {
	const copy = structuredClone(program) as unknown as { blocks: { kind: string; sparseSchedule: unknown }[] };
	for (const b of copy.blocks) if (b.kind === "mna") b.sparseSchedule = null;
	return copy as unknown as Program;
}

/** 1 kHz sine at `amp` V, `n` host samples at 48 kHz (the deadline/pivot instruments' stimulus). */
export function tone(n: number, amp = 0.1, hz = 1000, rate = 48000, offset = 0): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * (i + offset)) / rate);
	return out;
}

export function relRms(a: ArrayLike<number>, b: ArrayLike<number>): { rel: number; abs: number; maxAbs: number; refRms: number } {
	let diff2 = 0, b2 = 0, maxAbs = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i += 1) {
		const d = (a[i] as number) - (b[i] as number);
		diff2 += d * d;
		b2 += (b[i] as number) ** 2;
		if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
	}
	const refRms = Math.sqrt(b2 / n);
	const abs = Math.sqrt(diff2 / n);
	return { rel: refRms > 1e-12 ? abs / refRms : abs, abs, maxAbs, refRms };
}

export function sha256(data: ArrayBufferView): string {
	const h = new Bun.CryptoHasher("sha256");
	h.update(data as unknown as ArrayBuffer);
	return h.digest("hex");
}

export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
export const fmt = (x: number | null | undefined, d = 1): string => x === null || x === undefined ? "n/a" : Number.isFinite(x) ? (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(d) : x.toFixed(d)) : String(x);

/** Full dense full-Newton reference: schedules nulled AND elimination off on every block. */
export function fullDense(program: Program): Program {
	const copy = structuredClone(program) as unknown as { blocks: { kind: string; sparseSchedule: unknown; eliminate: boolean }[] };
	for (const b of copy.blocks) if (b.kind === "mna") { b.sparseSchedule = null; b.eliminate = false; }
	return copy as unknown as Program;
}

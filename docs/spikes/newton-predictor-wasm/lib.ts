// Shared pieces for the predictor WASM-port checks (2026-10-09). Read-only against the
// corpus and study packets; TS = ReferenceRuntime (the reference), WASM = V2WasmEngine.
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";

const ROOT = "/home/joseph/projects/VesselDSP";
export const ARTIFACT_CORPUS = `${ROOT}/artifacts/schematics/vessel-dsp`;
export type PacketSpec = { file: string; controls: Record<string, number> };
export const PACKETS: Record<string, PacketSpec> = {
	muff: { file: `${ROOT}/workbench/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp`, controls: { SUSTAIN: 0.5, TONE: 0.5, VOLUME: 0.3 } },
	sd1: { file: `${ROOT}/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp`, controls: { Drive: 0.5, Tone: 0.5, Level: 0.3 } },
	ts9: { file: `${ARTIFACT_CORPUS}/ibanez-ts9-reissue.vdsp`, controls: { Drive: 0.5, Tone: 0.5, Level: 0.3 } },
	ts808: { file: `${ARTIFACT_CORPUS}/ibanez-ts808.vdsp`, controls: {} },
	gro100: { file: `${ARTIFACT_CORPUS}/amps/orange-gro100.vdsp`, controls: {} },
	"blue-box": { file: `${ARTIFACT_CORPUS}/mxr-blue-box.vdsp`, controls: {} },
};
export function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit === undefined ? fallback : hit.slice(name.length + 3);
}
export function compileFile(file: string): Program {
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") throw new Error(`compile ${r.status}: ${file}`);
	return r.program;
}
export function sine(n: number, hz: number, amp: number, rate = 48000): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
	return out;
}
/** The workbench parity stimulus: 440 Hz @0.25 + 1320 Hz @0.1. */
export function twoTone(n: number, rate = 48000): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) out[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / rate);
	return out;
}
export function sha256(data: ArrayBufferView): string {
	const h = new Bun.CryptoHasher("sha256");
	h.update(data as unknown as ArrayBuffer);
	return h.digest("hex");
}
/** Verbatim from workbench/scripts/test-v2-wasm-parity.ts `computeMetrics`. */
export function computeMetrics(a: ArrayLike<number>, b: ArrayLike<number>) {
	let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0;
	const n = a.length;
	let dMax = 0;
	for (let i = 0; i < n; i++) {
		const va = a[i] as number, vb = b[i] as number;
		dMax = Math.max(dMax, Math.abs(va - vb));
		sumA += va; sumB += vb; sumAA += va * va; sumBB += vb * vb; sumAB += va * vb;
	}
	const varA = Math.max(0, sumAA - (sumA * sumA) / n);
	const varB = Math.max(0, sumBB - (sumB * sumB) / n);
	const rms = (x: ArrayLike<number>) => { let s = 0; for (let i = 0; i < x.length; i++) s += (x[i] as number) ** 2; return Math.sqrt(s / Math.max(1, x.length)); };
	const rmsA = rms(a), rmsB = rms(b);
	const isSilent = rmsA < 1e-5 && rmsB < 1e-5;
	let r = 1.0;
	if (!isSilent && varA > 1e-12 && varB > 1e-12) {
		const cov = sumAB - (sumA * sumB) / n;
		r = Math.max(-1.0, Math.min(1.0, cov / Math.sqrt(varA * varB)));
	} else if (isSilent) r = 1.0;
	else r = varA <= 1e-12 && varB <= 1e-12 ? 1.0 : 0.0;
	return { maxDelta: dMax, correlation: r, isSilent, rmsA, rmsB };
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

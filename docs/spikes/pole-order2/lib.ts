// Shared pieces for the op-amp pole-order checks (2026-10-10; adapted from the GBW worker's lib). Run from a repository root (the root tsconfig
// maps @vessel-dsp/* to src, and the WASM console loads packages/runtime/src/wasm), so the same script
// measures whichever tree it is run from: the baseline clone of 49cc15c, or this worktree.
// Read-only against the corpus and the study packets. TS = ReferenceRuntime (the reference), WASM =
// V2WasmEngine (the shipping console).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import type { Program } from "@vessel-dsp/compiler";
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";

export const ROOT = "/home/joseph/projects/VesselDSP";
export const ARTIFACTS = process.env.ARTIFACTS ?? `${ROOT}/artifacts`;
export const PEDALS = `${ARTIFACTS}/schematics/vessel-dsp`;
export const AMPS = `${PEDALS}/amps`;
export const RATE = 48000;

export type PacketSpec = { file: string; controls: Record<string, number> };
/** The six profile packets of the workbench parity method; controls as the baseline asks for them. */
export const PACKETS: Record<string, PacketSpec> = {
	muff: { file: `${ROOT}/workbench/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp`, controls: { SUSTAIN: 0.5, TONE: 0.5, VOLUME: 0.3 } },
	sd1: { file: `${ROOT}/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp`, controls: { Drive: 0.5, Tone: 0.5, Level: 0.3 } },
	ts9: { file: `${PEDALS}/ibanez-ts9-reissue.vdsp`, controls: { Drive: 0.5, Tone: 0.5, Level: 0.3 } },
	ts808: { file: `${PEDALS}/ibanez-ts808.vdsp`, controls: {} },
	gro100: { file: `${AMPS}/orange-gro100.vdsp`, controls: {} },
	"blue-box": { file: `${PEDALS}/mxr-blue-box.vdsp`, controls: {} },
};
/** The three-way tables' states (workbench three-way-sd1.py / three-way-ts9.py): Level 0.3 in every one. */
export const STATES: Record<string, Record<string, number>> = {
	centre: { Drive: 0.5, Tone: 0.5, Level: 0.3 },
	"drive-min": { Drive: 0.0, Tone: 0.5, Level: 0.3 },
	"drive-max": { Drive: 1.0, Tone: 0.5, Level: 0.3 },
	"tone-min": { Drive: 0.5, Tone: 0.0, Level: 0.3 },
	"tone-max": { Drive: 0.5, Tone: 1.0, Level: 0.3 },
};
/** The pooled instrument's frequency grid (workbench hardware-consistency/pool.py FREQS). */
export const FREQS = [100, 250, 500, 1000, 2000, 3150, 4000, 6300, 8000, 12500, 16000];

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
	const hit = corpusFiles().find((f) => f.slug === slug);
	if (hit === undefined) throw new Error(`no corpus document ${slug}`);
	return hit.file;
}
export function compileFile(file: string): Program {
	const r = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
	if (r.status !== "ok") throw new Error(`compile ${r.status}: ${file}`);
	return r.program;
}
export function compileResult(file: string) {
	return compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
}

export function sine(n: number, hz: number, amp: number, rate = RATE): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
	return out;
}
export function twoTone(n: number, rate = RATE): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) out[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / rate);
	return out;
}
export function sha256(data: ArrayBufferView): string {
	return createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
export const db = (v: number): number => 20 * Math.log10(Math.max(v, 1e-12));

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

// ---------------------------------------------------------------------------------------------
// Renders. `os` = oversample factor (1 = native). `rate` = the host sample rate handed to the engine,
// so a "native 192 kHz" render is rate 192000 with os 1.
// ---------------------------------------------------------------------------------------------
export type RenderOptions = { rate?: number; os?: number; cap?: number; sourceOhms?: number; block?: number; stallMs?: number; wasmDir?: string };
/** Thrown by a render whose single block exceeded `stallMs` of wall time: a stall, not a slow render (a stalled block costs tens of seconds). */
export class StallError extends Error {}
const BLK = 512;

export function renderTs(program: Program, controls: Record<string, number>, input: Float64Array, o: RenderOptions = {}) {
	const rate = o.rate ?? RATE, os = o.os ?? 1;
	const rt = new ReferenceRuntime(program);
	rt.prepare(rate, { maxNewtonIterations: o.cap ?? 1024, ...(os > 1 ? { oversample: os } : {}), ...(o.sourceOhms !== undefined ? { inputSourceOhms: o.sourceOhms } : {}) });
	for (const [k, v] of Object.entries(controls)) rt.setControl(k, v);
	const out = new Float64Array(input.length);
	const blk = o.block ?? BLK;
	for (let i = 0; i < input.length; i += blk) {
		const t0 = performance.now();
		out.set(rt.process(input.subarray(i, i + blk)), i);
		if (o.stallMs !== undefined && performance.now() - t0 > o.stallMs) throw new StallError(`TS block at sample ${i} took ${(performance.now() - t0).toFixed(0)} ms`);
	}
	const t = rt.telemetry();
	return { out, iterations: t.totalIterations, peak: t.peakIterations, nonConverged: t.nonConvergedSamples, telemetry: t };
}
export async function renderWasm(program: Program, controls: Record<string, number>, input: Float64Array, o: RenderOptions = {}) {
	const rate = o.rate ?? RATE, os = o.os ?? 1;
	const mod = o.wasmDir === undefined ? undefined : (await import(pathToFileURL(`${o.wasmDir}/v2_dsp.cjs`).href)).default();
	const eng = await V2WasmEngine.create(program, mod === undefined ? undefined : await mod);
	eng.prepare({ sampleRate: rate, maxNewtonIterations: o.cap ?? 1024, ...(os > 1 ? { oversample: os } : {}), ...(o.sourceOhms !== undefined ? { inputSourceOhms: o.sourceOhms } : {}) });
	for (const [k, v] of Object.entries(controls)) eng.setControl(k, v);
	const fi = Float32Array.from(input);
	const fo = new Float32Array(input.length);
	const blk = o.block ?? BLK;
	for (let i = 0; i < input.length; i += blk) {
		const n = Math.min(blk, input.length - i);
		const t0 = performance.now();
		eng.processBlock(fi.subarray(i, i + n), fo.subarray(i, i + n));
		if (o.stallMs !== undefined && performance.now() - t0 > o.stallMs) { eng.destroy(); throw new StallError(`WASM block at sample ${i} took ${(performance.now() - t0).toFixed(0)} ms`); }
	}
	const peak = eng.getMaxIterations();
	let totalIterations = Number.NaN;
	try { totalIterations = eng.getPredictorTelemetry().totalIterations; } catch { /* module without the export */ }
	eng.destroy();
	return { out: fo, peak, totalIterations };
}

// ---------------------------------------------------------------------------------------------
// Fundamental extraction: the workbench probe's harmonic least-squares fit (probe.ts, copied).
// ---------------------------------------------------------------------------------------------
export function lsFit(x: Float64Array, fs: number, f0: number, nh: number) {
	const n = x.length, m = 1 + 2 * nh;
	const cols: Float64Array[] = [new Float64Array(n).fill(1)];
	for (let h = 1; h <= nh; h++) {
		const c = new Float64Array(n), s = new Float64Array(n);
		for (let i = 0; i < n; i++) { const p = (2 * Math.PI * f0 * h * i) / fs; c[i] = Math.cos(p); s[i] = Math.sin(p); }
		cols.push(c, s);
	}
	const A = Array.from({ length: m }, () => new Float64Array(m + 1));
	for (let a = 0; a < m; a++) {
		for (let b = a; b < m; b++) { let t = 0; const ca = cols[a]!, cb = cols[b]!; for (let i = 0; i < n; i++) t += ca[i]! * cb[i]!; A[a]![b] = t; A[b]![a] = t; }
		let t = 0; const ca = cols[a]!; for (let i = 0; i < n; i++) t += ca[i]! * x[i]!; A[a]![m] = t;
	}
	for (let i = 0; i < m; i++) {
		let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
		[A[i], A[p]] = [A[p]!, A[i]!];
		for (let r = i + 1; r < m; r++) { const f = A[r]![i]! / A[i]![i]!; for (let c = i; c <= m; c++) A[r]![c]! -= f * A[i]![c]!; }
	}
	const coef = new Float64Array(m);
	for (let i = m - 1; i >= 0; i--) { let t = A[i]![m]!; for (let c = i + 1; c < m; c++) t -= A[i]![c]! * coef[c]!; coef[i] = t / A[i]![i]!; }
	let resid = 0; for (let i = 0; i < n; i++) { let y = 0; for (let k = 0; k < m; k++) y += coef[k]! * cols[k]![i]!; const e = x[i]! - y; resid += e * e; }
	return { fund: Math.hypot(coef[1]!, coef[2]!), resid: Math.sqrt(resid / n), harm: Array.from({ length: nh }, (_, h) => Math.hypot(coef[1 + 2 * h]!, coef[2 + 2 * h]!)) };
}
/** Fundamental amplitude (same units as `w`) of a settled window at hostRate, f0 refined within +-1 Hz. */
export function fundamentalOf(w: ArrayLike<number>, hostRate: number, hz: number): number {
	const wf = Float64Array.from(w as ArrayLike<number>);
	const nh = Math.max(1, Math.min(8, Math.floor(hostRate / 2 / hz) - 1));
	const dec = Math.max(1, Math.floor(hostRate / (8 * hz * nh)));
	const wd = Float64Array.from({ length: Math.floor(wf.length / dec) }, (_, i) => wf[i * dec]!);
	let best = { f: hz, r: Number.POSITIVE_INFINITY };
	for (let k = -4; k <= 4; k++) { const f = hz + k * 0.25; const r = lsFit(wd, hostRate / dec, f, 1).resid; if (r < best.r) best = { f, r }; }
	return lsFit(wf, hostRate, best.f, nh).fund;
}

// Shared pieces for the op-amp GBP stall study (2026-10-11). Builds on ../opamp-gbw/lib.ts (corpus listing,
// compile, renders, metrics); adds the canary's stimulus as the WASM console sees it, program lookup by slug
// or profile-packet name, and the forced-product variant used to stand in for main on the same binary.
import type { Program } from "@vessel-dsp/compiler";
import { PACKETS, compileFile, corpusFiles } from "../opamp-gbw/lib";
export { arg, has, computeMetrics, fundamentalOf, renderTs, renderWasm, sine, StallError, PACKETS, RATE } from "../opamp-gbw/lib";

/** A corpus slug, a profile-packet name (`PACKETS`), or a path to a `.vdsp`. */
export function fileFor(name: string): string {
	if (name.endsWith(".vdsp")) return name;
	if (PACKETS[name] !== undefined) return PACKETS[name]!.file;
	const hit = corpusFiles().find((f) => f.slug === name);
	if (hit === undefined) throw new Error(`no corpus document or packet ${name}`);
	return hit.file;
}
export function programFor(name: string): Program {
	return compileFile(fileFor(name));
}
export function controlsFor(name: string): Record<string, number> {
	return PACKETS[name]?.controls ?? {};
}

/** Every op-amp stamp's product forced to `spec` ("" leaves the program alone; "null" is main's class default). */
export function forceGbp(program: Program, spec: string): Program {
	if (spec === "") return program;
	return {
		...program,
		blocks: program.blocks.map((b) =>
			b.kind === "mna"
				? { ...b, stamps: b.stamps.map((s) => (s.kind === "ideal-opamp" ? { ...s, gainBandwidthHz: spec === "null" ? null : Number(spec) } : s)) }
				: b,
		),
	} as Program;
}

/**
 * The host-rate stimulus. `twotone` is the canary's (440 Hz @0.25 + 1320 Hz @0.1 from t=0,
 * docs/spikes/hotfix-0.4.1/mt2-timeline.ts), `sine` the movement harness's. Values are rounded to
 * float32 unless `f64`, because that is what the WASM console receives and the stall is trajectory-
 * sensitive: both consoles must be fed the same doubles.
 */
export function hostInput(n: number, stimulus: string, hz: number, amp: number, f64 = false, rate = 48000): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) {
		// The canary's own rounding (hotfix-0.4.1/lib.ts twoTone): t first, then 2*pi*f*t. The report found the os1
		// stall with this generation and not with `(2*pi*f*i)/rate` (mt2-gbp-scan.ts), so the form is load-bearing.
		const t = i / rate;
		// `parity` is the parity harness's rounding of the same two tones (opamp-gbw/lib.ts twoTone): (2*pi*f*i)/rate.
		const v = stimulus === "sine" ? amp * Math.sin(2 * Math.PI * hz * t)
			: stimulus === "parity" ? 0.25 * Math.sin((2 * Math.PI * 440 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / rate)
			: 0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 1320 * t);
		out[i] = f64 ? v : Math.fround(v);
	}
	return out;
}

/** The op-amp stamps of a program with their block id and stamp index, for naming a trace. */
export function opampStamps(program: Program): Array<{ blockId: string; index: number; plus: number; minus: number; output: number; gbp: number | null }> {
	const out: Array<{ blockId: string; index: number; plus: number; minus: number; output: number; gbp: number | null }> = [];
	for (const b of program.blocks) {
		if (b.kind !== "mna") continue;
		b.stamps.forEach((s, index) => {
			if (s.kind === "ideal-opamp") out.push({ blockId: b.id, index, plus: s.plus, minus: s.minus, output: s.output, gbp: (s as { gainBandwidthHz?: number | null }).gainBandwidthHz ?? null });
		});
	}
	return out;
}

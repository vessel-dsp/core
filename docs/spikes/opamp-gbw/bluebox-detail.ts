// mxr-blue-box (RC4558 sections, 4 MHz by the catalog) under the parity two-tone (440 Hz @0.25 + 1320 Hz @0.1, cap 1024): TS vs WASM per factor, with the
// numbers behind the parity verdict: non-converged samples and iterations per host sample on the TS console, peak iterations on both, output RMS, correlation,
// max abs difference, and the first sample at which the two consoles differ by more than 1e-3. Run in either tree (the new tree's program carries the stamps).
//   bun docs/spikes/opamp-gbw/bluebox-detail.ts [--packet=blue-box] [--os=1,2,4] [--window=2148] [--force-gbp=null|1e6] [--f32-input]
import type { Program } from "@vessel-dsp/compiler";
import { PACKETS, arg, compileFile, computeMetrics, renderTs, renderWasm, twoTone } from "./lib";
const slug = arg("packet", "blue-box"), factors = arg("os", "1,2,4").split(",").map(Number), W = Number(arg("window", "2148")), force = arg("force-gbp", "");
const base = compileFile(PACKETS[slug]!.file);
const program: Program = force === "" ? base : ({ ...base, blocks: base.blocks.map((b) => b.kind === "mna" ? { ...b, stamps: b.stamps.map((s) => s.kind === "ideal-opamp" ? { ...s, gainBandwidthHz: force === "null" ? null : Number(force) } : s) } : b) } as Program);
const f32 = process.argv.includes("--f32-input"); // toolchain-parity.ts feeds BOTH consoles the float32-rounded input
const input = f32 ? Float64Array.from(Float32Array.from(twoTone(W))) : twoTone(W);
const rms = (x: ArrayLike<number>) => Math.sqrt(Array.from(x).reduce((s, v) => s + v * v, 0) / x.length);
console.log(`${slug}${force ? ` force-gbp=${force}` : ""}: two-tone, ${W} host samples, cap 1024`);
for (const os of factors) {
	const t = renderTs(program, PACKETS[slug]!.controls, input, { os, block: W });
	const w = await renderWasm(program, PACKETS[slug]!.controls, input, { os, block: W });
	const a = Array.from(t.out.subarray(100)), b = Array.from(w.out.subarray(100));
	const m = computeMetrics(a, b);
	let first = -1; for (let i = 0; i < a.length; i += 1) if (Math.abs((a[i] as number) - (b[i] as number)) > 1e-3) { first = i + 100; break; }
	console.log(`os${os}: TS NC ${t.nonConverged}, it/host ${(t.iterations / W).toFixed(2)}, TS peak ${t.peak}, WASM peak ${w.peak} | rms TS ${rms(a).toExponential(3)} WASM ${rms(b).toExponential(3)} | r ${m.correlation.toFixed(6)} maxAbs ${m.maxDelta.toExponential(2)} | first |diff|>1e-3 at sample ${first}`);
}

// boss-mt-2 canary (the scoreboard stimulus of docs/spikes/hotfix-0.4.1/mt2-timeline.ts: 440 Hz @0.25 + 1320 Hz @0.1 from t=0, 128-sample blocks, cap 1024) on the
// WASM console with the product forced on every op-amp stamp. Is the stall a property of the stated 7 MHz (stiffness) or of which trajectory a given product selects?
//   bun docs/spikes/opamp-gbw/mt2-gbp-scan.ts --os=1|4 --gbps=null,2e6,3e6,5e6,7e6,1e7,1.5e7 [--seconds=8] [--packet=boss-mt-2]
import type { Program } from "@vessel-dsp/compiler";
import { DEFAULT_NEWTON_MAX_ITERATIONS, V2WasmEngine } from "@vessel-dsp/runtime";
import { arg, compileFile, corpusFiles } from "./lib";
const os = Number(arg("os", "1")), seconds = Number(arg("seconds", "8")), slug = arg("packet", "boss-mt-2");
const list = arg("gbps", "null,2e6,3e6,5e6,7e6,1e7,1.5e7").split(",");
const base = compileFile(corpusFiles().find((f) => f.slug === slug)!.file);
const BLOCK = 128, RATE = 48000, N = RATE * seconds;
const tone = (n: number, off: number) => Float32Array.from({ length: n }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * (off + i)) / RATE) + 0.1 * Math.sin((2 * Math.PI * 1320 * (off + i)) / RATE));
console.log(`${slug} WASM os${os}, cap ${DEFAULT_NEWTON_MAX_ITERATIONS}, ${seconds} s two-tone, per-product: first block over 50 ms / first stalled block (over 1000 ms)`);
for (const g of list) {
	const program: Program = ({ ...base, blocks: base.blocks.map((b) => b.kind === "mna" ? { ...b, stamps: b.stamps.map((s) => s.kind === "ideal-opamp" ? { ...s, gainBandwidthHz: g === "null" ? null : Number(g) } : s) } : b) }) as Program;
	const eng = await V2WasmEngine.create(program);
	eng.prepare({ sampleRate: RATE, maxNewtonIterations: DEFAULT_NEWTON_MAX_ITERATIONS, ...(os > 1 ? { oversample: os } : {}) });
	const fo = new Float32Array(BLOCK);
	let slow = 0, firstSlow = -1, firstStall = -1, stalled = 0, worst = 0;
	const t00 = performance.now();
	for (let i = 0; i < N; i += BLOCK) {
		const t0 = performance.now();
		eng.processBlock(tone(BLOCK, i), fo);
		const ms = performance.now() - t0;
		worst = Math.max(worst, ms);
		if (ms > 50) { slow += 1; if (firstSlow < 0) firstSlow = i; }
		if (ms > 1000) { stalled += 1; if (firstStall < 0) firstStall = i; if (stalled >= 2) break; }
	}
	const total = performance.now() - t00;
	console.log(`GBP ${(g === "null" ? "null (1 MHz default)" : `${Number(g) / 1e6} MHz`).padEnd(22)} blocks >50 ms: ${String(slow).padStart(4)}  first at ${firstSlow < 0 ? "-" : (firstSlow / RATE).toFixed(3) + " s"}  stall ${firstStall < 0 ? "none" : "at " + (firstStall / RATE).toFixed(3) + " s"}  worst block ${worst.toFixed(0)} ms  total ${(total / 1000).toFixed(1)} s`);
	eng.destroy();
}

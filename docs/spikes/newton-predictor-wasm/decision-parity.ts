// Check (a): decision parity. The reference is instrumented in-process by wrapping its
// private predictor methods (no TS change): `predictedNewtonStart` returning non-null counts a
// seed, `recordNewtonSolution` with used === 1 counts a one-iteration solve, and the per-block
// `newtonStartHistory.order` is read after every host sample. The WASM console exposes the
// same three counters plus `getPredictorOrder(blockIdx)`. Per host sample (one-sample process
// calls) the chosen order per block, the cumulative seeds, one-iteration solves and total
// iterations must be EQUAL on both consoles; the first disagreeing sample is named.
//   bun docs/spikes/newton-predictor-wasm/decision-parity.ts [--os=1,4] [--packet=...] [--samples=4800] [--cap=1024]
import { ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, sine } from "./lib";

const factors = arg("os", "1,4").split(",").map(Number);
const packets = arg("packet", Object.keys(PACKETS).join(",")).split(",");
const N = Number(arg("samples", "4800"));
const CAP = Number(arg("cap", "1024"));
const RATE = 48000;
const amp = Number(arg("amp", "0.1"));
const hz = Number(arg("hz", "1000"));

// Instrument the reference once, process-wide.
const proto = ReferenceRuntime.prototype as any;
const tsCounts = { seeds: 0, oneIteration: 0 };
const origPredict = proto.predictedNewtonStart;
const origRecord = proto.recordNewtonSolution;
proto.predictedNewtonStart = function (blockId: string, size: number) {
	const r = origPredict.call(this, blockId, size);
	if (r !== null) tsCounts.seeds += 1;
	return r;
};
proto.recordNewtonSolution = function (blockId: string, solution: readonly number[], converged: boolean, used: number) {
	if (used === 1) tsCounts.oneIteration += 1;
	return origRecord.call(this, blockId, solution, converged, used);
};

console.log(`decision parity: ${hz} Hz @${amp} V, ${N} host samples, cap ${CAP}, one-sample process calls; per sample: order per block, cumulative seeds / one-iteration solves / total iterations`);
console.log(`packet    os | samples | seeds TS/WASM | one-it TS/WASM | iterations TS/WASM | samples whose per-sample order / counter deltas differ | first | verdict`);
let allOk = true;
for (const slug of packets) {
	const spec = PACKETS[slug]!;
	const program = compileFile(spec.file);
	const mna = program.blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === "mna");
	for (const os of factors) {
		const rt = new ReferenceRuntime(program);
		rt.prepare(RATE, { maxNewtonIterations: CAP, ...(os > 1 ? { oversample: os } : {}) });
		for (const [k, v] of Object.entries(spec.controls)) rt.setControl(k, v);
		const eng = await V2WasmEngine.create(program);
		eng.prepare({ sampleRate: RATE, maxNewtonIterations: CAP, ...(os > 1 ? { oversample: os } : {}) });
		for (const [k, v] of Object.entries(spec.controls)) eng.setControl(k, v);
		tsCounts.seeds = 0; tsCounts.oneIteration = 0;
		const input = sine(N, hz, amp);
		const chunk = new Float64Array(1);
		const fin = new Float32Array(1), fout = new Float32Array(1);
		// Per sample: the order per block, and the per-sample DELTA of each cumulative counter
		// (so one knife-edge solve shows as one differing sample, not every sample after it).
		let orderMismatch = 0, seedMismatch = 0, oneMismatch = 0, iterMismatch = 0, first = "";
		let pSeedsT = 0, pOneT = 0, pItT = 0, pSeedsW = 0, pOneW = 0, pItW = 0;
		const hist = (rt as any).newtonStartHistory as Map<string, { order: number }>;
		for (let i = 0; i < N; i += 1) {
			chunk[0] = input[i] as number; rt.process(chunk);
			fin[0] = input[i] as number; eng.processBlock(fin, fout);
			const tw = eng.getPredictorTelemetry();
			const tt = rt.telemetry();
			let bad = "";
			for (const { b, i: bi } of mna) {
				const to = hist.get(b.id)?.order ?? 0;
				const wo = eng.getPredictorOrder(bi);
				if (to !== wo) { orderMismatch += 1; if (bad === "") bad = `order of ${b.id} TS ${to} WASM ${wo}`; break; }
			}
			const dSeedsT = tsCounts.seeds - pSeedsT, dSeedsW = tw.seedsUsed - pSeedsW;
			const dOneT = tsCounts.oneIteration - pOneT, dOneW = tw.oneIterationSolves - pOneW;
			const dItT = tt.totalIterations - pItT, dItW = tw.totalIterations - pItW;
			if (dSeedsT !== dSeedsW) { seedMismatch += 1; if (bad === "") bad = `seeds this sample TS ${dSeedsT} WASM ${dSeedsW}`; }
			if (dOneT !== dOneW) { oneMismatch += 1; if (bad === "") bad = `one-iteration solves this sample TS ${dOneT} WASM ${dOneW}`; }
			if (dItT !== dItW) { iterMismatch += 1; if (bad === "") bad = `iterations this sample TS ${dItT} WASM ${dItW}`; }
			pSeedsT = tsCounts.seeds; pOneT = tsCounts.oneIteration; pItT = tt.totalIterations;
			pSeedsW = tw.seedsUsed; pOneW = tw.oneIterationSolves; pItW = tw.totalIterations;
			if (bad !== "" && first === "") first = `sample ${i}: ${bad}`;
		}
		const tw = eng.getPredictorTelemetry();
		const tt = rt.telemetry();
		const ok = orderMismatch === 0 && seedMismatch === 0 && oneMismatch === 0 && iterMismatch === 0;
		if (!ok) allOk = false;
		console.log(`${slug.padEnd(9)} ${String(os).padStart(2)} | ${N} | ${tsCounts.seeds}/${tw.seedsUsed} | ${tsCounts.oneIteration}/${tw.oneIterationSolves} | ${tt.totalIterations}/${tw.totalIterations} | samples differing: order ${orderMismatch}, seeds ${seedMismatch}, one-it ${oneMismatch}, iterations ${iterMismatch} | ${first || "-"} | ${ok ? "EXACT" : "DIVERGE"}`);
		eng.destroy();
	}
}
console.log(allOk ? "\ndecision parity: EXACT on every row" : "\ndecision parity: DIVERGENCE (see rows)");

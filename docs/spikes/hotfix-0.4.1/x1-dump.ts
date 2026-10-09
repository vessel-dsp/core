// Renders corpus documents at one oversample factor (default 1) on the TS reference AND the C++/WASM
// console with a fixed stimulus, and writes the raw outputs (TS float64, WASM float32 widened) plus a
// per-packet index (program fingerprints, repivoted blocks, telemetry, seeds) so two runtimes can be
// compared bit for bit by x1-compare.ts. The same file measures whichever runtime it resolves:
// a clone (root tsconfig -> src) or a scratch dir holding the published 0.3.1.
//   bun docs/spikes/hotfix-0.4.1/x1-dump.ts --out=<prefix> [--samples=2048] [--stim=twotone|k1] [--os=1]
//       [--only=slug,slug] [--corpus] (default: every document)  [--consoles=ts,wasm]
// Stimuli: twotone = 440 Hz @0.25 + 1320 Hz @0.1 from t=0 (the parity / scoreboard method);
//          k1 = 1 kHz @0.1, 2400 warm-up samples then --samples measured (core's corpus-sweep protocol, cap 64).
import { writeFileSync } from "node:fs";
import { DEFAULT_NEWTON_MAX_ITERATIONS, ReferenceRuntime, V2WasmEngine } from "@vessel-dsp/runtime";
import type { Program } from "@vessel-dsp/compiler";
import { RATE, arg, compileFile, corpusFiles, has, programHashes, tone, twoTone } from "./lib";

const out = arg("out", "");
if (out === "") throw new Error("--out=<prefix> required");
const N = Number(arg("samples", "2048"));
const os = Number(arg("os", "1"));
const stim = arg("stim", "twotone");
const only = arg("only", "");
const consoles = arg("consoles", "ts,wasm").split(",");
const cap = stim === "k1" ? 64 : DEFAULT_NEWTON_MAX_ITERATIONS;
const warm = stim === "k1" ? 2400 : 0;
const oversample = os > 1 ? { oversample: os } : {};
const input = stim === "k1" ? tone(N, 1000, 0.1, warm) : twoTone(N);
const warmInput = warm > 0 ? tone(warm, 1000, 0.1, 0) : new Float64Array(0);
const files = corpusFiles().filter((f) => only === "" || only.split(",").includes(f.slug));

type Row = Record<string, unknown> & { slug: string; status: string };
const index: Row[] = [];
const chunks: Float64Array[] = [];
const take = (a: Float64Array): number => (chunks.push(a), chunks.length - 1);

for (const { slug, file } of files) {
	let program: Program;
	try {
		program = compileFile(file);
	} catch (e) {
		index.push({ slug, status: `refused: ${(e as Error).message.slice(0, 80)}` });
		continue;
	}
	const row: Row = { slug, status: "ok", ...programHashes(program) };
	if (consoles.includes("ts")) {
		const ts = new ReferenceRuntime(program);
		ts.prepare(RATE, { maxNewtonIterations: cap, inputSourceOhms: 0, ...oversample });
		if (warm > 0) ts.process(warmInput);
		const o = Float64Array.from(ts.process(input));
		row.ts = take(o);
		const plan = typeof ts.solverPlan === "function" ? ts.solverPlan() : undefined;
		row.tsRepivoted = plan?.repivoted ?? null;
		const t = ts.telemetry();
		row.tsIterations = t.totalIterations;
		row.tsNonConverged = t.nonConvergedSamples;
		const h = (ts as unknown as { newtonStartHistory?: Map<string, { order: number; chain: number }> }).newtonStartHistory;
		row.tsHistoryEntries = h === undefined ? null : h.size;
	}
	if (consoles.includes("wasm")) {
		const eng = await V2WasmEngine.create(program);
		eng.prepare({ sampleRate: RATE, maxNewtonIterations: cap, inputSourceOhms: 0, ...oversample });
		if (warm > 0) eng.processBlock(Float32Array.from(warmInput), new Float32Array(warm));
		const o32 = new Float32Array(N);
		eng.processBlock(Float32Array.from(input), o32);
		row.wasm = take(Float64Array.from(o32));
		const e = eng as unknown as {
			getScheduleTelemetry?: () => { repivotedBlocks: number };
			getPredictorTelemetry?: () => { seedsUsed: number; oneIterationSolves: number; totalIterations: number };
		};
		row.wasmRepivotedBlocks = e.getScheduleTelemetry?.().repivotedBlocks ?? null;
		const p = e.getPredictorTelemetry?.();
		row.wasmSeeds = p?.seedsUsed ?? null;
		row.wasmOneIteration = p?.oneIterationSolves ?? null;
		row.wasmIterations = p?.totalIterations ?? null;
		eng.destroy();
	}
	index.push(row);
}
writeFileSync(`${out}.json`, JSON.stringify({ N, os, stim, cap, chunks: chunks.length, rows: index }));
const all = new Float64Array(chunks.length * N);
for (const [k, c] of chunks.entries()) all.set(c, k * N);
writeFileSync(`${out}.f64`, Buffer.from(all.buffer));
console.log(`wrote ${index.filter((x) => x.status === "ok").length} packets (${consoles.join("+")}), os=${os}, ${stim}, N=${N} to ${out}.{json,f64}; refused ${index.filter((x) => x.status !== "ok").length}`);

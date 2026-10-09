// Evidence-integrity trace (check 4): per standard-pass solve of one packet in the Newton-budget
// spike's own protocol (x1, cap 64, source 0 ohm, 2400 warm-up + 9600 samples of 1 kHz @0.1 V), the
// pair (seeded?, iterations used, converged) under two implementations of the start-predictor rule:
//   --mode=patched : the real runtime with the shipped patch applied (wraps predictedNewtonStart /
//                    recordNewtonSolution, which are called once per standard-pass solve each)
//   --mode=scratch : the spike's scratch loop, method m1adapt3 (its onSubSample callback)
//   --mode=scratch-none : the scratch loop with no method (the shipped arithmetic through the scratch copy)
// --fixed-point turns on the scratch loop's fixed-point twin (what corpus-sweep.ts always does for the method run).
// With --solutions the converged solution vector of every solve is written next to --out (as <out>.f64).
// Writes a JSON array of [seeded, used, converged, order] per solve; compare with rule-trace-compare.ts.
// Run --mode=patched in a tree where the predictor runs at x1 (the spike's base 1d9b6f2 with its patch applied, or
// the published 0.4.0); in the 0.4.1 tree it records nothing at x1, by design.
//   bun docs/spikes/hotfix-0.4.1/rule-trace.ts --mode=patched|scratch --out=<file> [--packet=boss-dm-2]
import { writeFileSync } from "node:fs";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, compileFile, fileForSlug, tone } from "./lib";

const mode = arg("mode", "patched");
const scratchMode = mode.startsWith("scratch");
const out = arg("out", "");
const slug = arg("packet", "boss-dm-2");
const program = compileFile(fileForSlug(slug));
const rows: Array<[number, number, number, number]> = [];
const keepSolutions = process.argv.includes("--solutions");
const solutions: number[][] = [];

if (!scratchMode) {
	const proto = ReferenceRuntime.prototype as any;
	const origPredict = proto.predictedNewtonStart;
	const origRecord = proto.recordNewtonSolution;
	let seeded = 0;
	let order = 0;
	proto.predictedNewtonStart = function (blockId: string, size: number) {
		order = this.newtonStartHistory.get(blockId)?.order ?? 0;
		const r = origPredict.call(this, blockId, size);
		seeded = r !== null ? 1 : 0;
		return r;
	};
	proto.recordNewtonSolution = function (blockId: string, solution: readonly number[], converged: boolean, used: number) {
		rows.push([seeded, used, converged ? 1 : 0, order]);
		if (keepSolutions) solutions.push(Array.from(solution));
		return origRecord.call(this, blockId, solution, converged, used);
	};
} else {
	const scratch = await import("../newton-budget/scratch-newton");
	scratch.install();
	scratch.configure({
		predictor: mode === "scratch-none" ? "none" : "adaptive3",
		fixedPointCheck: process.argv.includes("--fixed-point"),
		onSubSample: (info: { predicted: unknown; used: number; converged: boolean; solution: number[] }) => {
			rows.push([info.predicted !== null ? 1 : 0, info.used, info.converged ? 1 : 0, -1]);
			if (keepSolutions) solutions.push(Array.from(info.solution));
		},
	} as never);
}

const rt = new ReferenceRuntime(program);
rt.prepare(48000, { maxNewtonIterations: 64, inputSourceOhms: 0 });
rt.process(tone(2400, 1000, 0.1, 0));
const warmRows = rows.length;
rt.process(tone(9600, 1000, 0.1, 2400));
const seeded = rows.filter((r) => r[0] === 1).length;
const seededWindow = rows.slice(warmRows).filter((r) => r[0] === 1).length;
console.log(`${mode}: ${rows.length} standard-pass solves (${warmRows} in warm-up); seeded ${seeded} (${seededWindow} in the measured window); iterations ${rows.reduce((s, r) => s + r[1], 0)}; non-converged ${rows.filter((r) => r[2] === 0).length}`);
if (out !== "") writeFileSync(out, JSON.stringify({ mode, slug, warmRows, rows, solveSize: solutions[0]?.length ?? 0 }));
if (out !== "" && keepSolutions) {
	const size = solutions[0]?.length ?? 0;
	const flat = new Float64Array(solutions.length * size);
	for (const [k, v] of solutions.entries()) flat.set(v, k * size);
	writeFileSync(`${out}.f64`, Buffer.from(flat.buffer));
}

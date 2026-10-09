// What does the start predictor buy at each oversample factor? Per profile packet and factor, on the TS
// reference: iterations per host sample, seeded solves and one-iteration solves over the measured window
// (the Newton-budget protocol: 1 kHz @0.1 V, cap 64, 2400 warm-up + 9600 measured host samples), and the
// output as a dump so a predictor-ON tree can be compared with a predictor-OFF tree run of the same file.
// Run the same file in the gated tree (predictor ON at os>1) and in a predictor-forced-off tree; join with
// os-factor-join.ts. Used for check 2 (non-power-of-two factors) and check 3c (the os4 saving).
//   bun docs/spikes/hotfix-0.4.1/os-factor-probe.ts --out=<file.json> [--os=2,3,4,5,6,8] [--packet=muff,...]
import { writeFileSync } from "node:fs";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile } from "../newton-predictor-wasm/lib";
import { tone } from "./lib";

const out = arg("out", "");
const factors = arg("os", "2,3,4,5,6,8").split(",").map(Number);
const packets = arg("packet", Object.keys(PACKETS).join(",")).split(",");
const WARM = 2400;
const N = 9600;

const proto = ReferenceRuntime.prototype as any;
let seeds = 0;
let ones = 0;
const origPredict = proto.predictedNewtonStart;
const origRecord = proto.recordNewtonSolution;
proto.predictedNewtonStart = function (blockId: string, size: number) {
	const r = origPredict.call(this, blockId, size);
	if (r !== null) seeds += 1;
	return r;
};
proto.recordNewtonSolution = function (blockId: string, solution: readonly number[], converged: boolean, used: number) {
	if (used === 1) ones += 1;
	return origRecord.call(this, blockId, solution, converged, used);
};

const rows: Array<Record<string, unknown>> = [];
for (const slug of packets) {
	const spec = PACKETS[slug]!;
	const program = compileFile(spec.file);
	for (const os of factors) {
		const rt = new ReferenceRuntime(program);
		rt.prepare(48000, { maxNewtonIterations: 64, inputSourceOhms: 0, oversample: os });
		for (const [k, v] of Object.entries(spec.controls)) rt.setControl(k, v);
		rt.process(tone(WARM, 1000, 0.1, 0));
		const t0 = rt.telemetry();
		seeds = 0;
		ones = 0;
		const output = Array.from(rt.process(tone(N, 1000, 0.1, WARM)));
		const t1 = rt.telemetry();
		rows.push({
			packet: slug, os,
			itPerHost: (t1.totalIterations - t0.totalIterations) / N,
			seeds, ones,
			nonConverged: t1.nonConvergedSamples - t0.nonConvergedSamples,
			output,
		});
		console.log(`${slug.padEnd(9)} os${os}: ${((t1.totalIterations - t0.totalIterations) / N).toFixed(3)} it/host, seeds ${seeds}, one-iteration ${ones}, non-converged ${t1.nonConvergedSamples - t0.nonConvergedSamples}`);
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

// Quick single-path probe: compile, prepare, short render, telemetry + plan.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const packet = process.argv[2] ?? "boss-tw-1";
const dir = process.argv.includes("--amps")
	? "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp/amps"
	: "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";
const WARMUP = Number(process.argv.find((a) => a.startsWith("--warmup="))?.slice(9) ?? "200");
const SAMPLES = Number(process.argv.find((a) => a.startsWith("--samples="))?.slice(10) ?? "400");
const denseOnly = process.argv.includes("--dense");

const result = compile(readFileSync(`${dir}/${packet}.vdsp`, "utf8"), {
	registry: pedalPartCatalog,
});
if (result.status !== "ok") throw new Error(`compile ${result.status}`);
const program = (
	denseOnly
		? (() => {
				const p = structuredClone(result.program) as {
					blocks: { kind: string; sparseSchedule: unknown }[];
				};
				for (const b of p.blocks) if (b.kind === "mna") b.sparseSchedule = null;
				return p;
			})()
		: result.program
) as ConstructorParameters<typeof ReferenceRuntime>[0];

const runtime = new ReferenceRuntime(program);
const tPrep0 = process.hrtime.bigint();
runtime.prepare(48000, { maxNewtonIterations: 64 });
const tPrep1 = process.hrtime.bigint();
const tone = (n: number): Float64Array => {
	const o = new Float64Array(n);
	for (let i = 0; i < n; i += 1) o[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
	return o;
};
runtime.process(tone(WARMUP));
const t0 = runtime.telemetry();
const start = process.hrtime.bigint();
const out = runtime.process(tone(SAMPLES));
const end = process.hrtime.bigint();
const t1 = runtime.telemetry();
console.log(
	`${packet} ${denseOnly ? "dense" : "sparse"} warmup=${WARMUP} samples=${SAMPLES} ` +
		`prepMs=${Number(tPrep1 - tPrep0) / 1e6} renderMs=${Number(end - start) / 1e6} ` +
		`nonConv=${t1.nonConvergedSamples - t0.nonConvergedSamples} ` +
		`meanIter=${((t1.totalIterations - t0.totalIterations) / Math.max(t1.samples - t0.samples, 1)).toFixed(2)} ` +
		`peakIter=${t1.peakIterations}`,
);
const plan = runtime.solverPlan();
console.log(
	`solves=${plan.scheduleSolves} fb=${plan.scheduleFallbacks} dropped=${plan.dropped} repiv=${plan.repivoted} aband=${plan.abandoned}`,
);
for (const b of plan.blocks) {
	if (b.pivotDisagreement !== null && b.pivotDisagreement > 1e-9) {
		console.log(
			`  ${b.blockId} size=${b.size} path=${b.path} disag=${b.pivotDisagreement?.toExponential(1)} ` +
				`worstRatio=${b.worstPivotRatio?.toExponential?.(1) ?? b.worstPivotRatio} viol=${b.pivotViolations} repiv=${b.repivoted}`,
		);
	}
}
let sum = 0;
for (let i = 0; i < out.length; i += 1) sum += (out[i] as number) ** 2;
console.log(`rms=${Math.sqrt(sum / out.length).toExponential(3)}`);
void basename;

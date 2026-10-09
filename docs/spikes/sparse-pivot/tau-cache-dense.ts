// Step 1: cache forced-dense references to disk.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import {
	arg,
	CACHE_DIR,
	corpusFiles,
	loadProgram,
	nullSchedules,
	tone,
} from "./lib";
import { basename } from "node:path";

const only = new Set(
	arg("packet", "").split(",").map((s) => s.trim()).filter(Boolean),
);
const WARMUP = Number(arg("warmup", "2400"));
const SAMPLES = Number(arg("samples", "9600"));
const AMPS = process.argv.includes("--amps");
mkdirSync(CACHE_DIR, { recursive: true });

for (const file of corpusFiles(AMPS)) {
	const packet = basename(file, ".vdsp");
	if (only.size > 0 && !only.has(packet)) continue;
	const target = join(CACHE_DIR, `${packet}.f64`);
	if (existsSync(target)) {
		console.log(`${packet}: cached, skip`);
		continue;
	}
	const program = nullSchedules(loadProgram(packet, AMPS));
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(48000, { maxNewtonIterations: 64 });
	runtime.process(tone(WARMUP));
	const start = process.hrtime.bigint();
	const out = runtime.process(tone(SAMPLES));
	const end = process.hrtime.bigint();
	const t = runtime.telemetry();
	writeFileSync(target, Buffer.from(out.buffer));
	writeFileSync(
		join(CACHE_DIR, `${packet}.json`),
		JSON.stringify({
			packet,
			warmup: WARMUP,
			samples: SAMPLES,
			ms: Number(end - start) / 1e6,
			nonConverged: t.nonConvergedSamples,
			peakIter: t.peakIterations,
			meanIter: t.totalIterations / Math.max(t.samples, 1),
		}),
	);
	console.log(
		`${packet}: cached ${(Number(end - start) / 1e6).toFixed(0)}ms ` +
			`nonConv=${t.nonConvergedSamples} peak=${t.peakIterations}`,
	);
}

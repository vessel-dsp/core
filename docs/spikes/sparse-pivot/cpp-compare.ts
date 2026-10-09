// Cross-console compare: TS ReferenceRuntime vs C++ V2WasmEngine on the same
// program and signal. Reports parity (cpp vs ts-sparse, allowing f32 I/O
// rounding), cpp vs ts-dense, per-console timing, and both consoles' schedule
// telemetry (solves/fallbacks/kernel/abandoned/dropped/repivoted).
//
// "Before" evidence: run on the base build and keep the .f64 outputs; rerun
// after the change + rebuild and diff.
//
// Usage:
//   bun docs/spikes/sparse-pivot/cpp-compare.ts --packet=boss-sd-1 [--amps]
//       [--warmup=2400] [--samples=9600] [--block=1024] [--outdir=...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { V2WasmEngine } from "@vessel-dsp/runtime";
import {
	arg,
	loadProgram,
	nullSchedules,
	relRms,
	tone,
	type Program,
} from "./lib";

const packet = arg("packet", "boss-sd-1");
const AMPS = process.argv.includes("--amps");
const WARMUP = Number(arg("warmup", "2400"));
const SAMPLES = Number(arg("samples", "9600"));
const BLOCK = Number(arg("block", "1024"));
const OUTDIR = arg("outdir", "docs/spikes/sparse-pivot/cpp-before");

function tsRender(program: Program): { out: Float64Array; ms: number } {
	const runtime = new ReferenceRuntime(program);
	runtime.prepare(48000, { maxNewtonIterations: 64 });
	runtime.process(tone(WARMUP));
	const start = process.hrtime.bigint();
	const out = Float64Array.from(runtime.process(tone(SAMPLES)));
	const end = process.hrtime.bigint();
	return { out, ms: Number(end - start) / 1e6 };
}

const program = loadProgram(packet, AMPS);
const tsSparse = tsRender(structuredClone(program));
const tsDense = tsRender(nullSchedules(program));

const engine = await V2WasmEngine.create(structuredClone(program));
engine.prepare({ sampleRate: 48000, maxNewtonIterations: 64 });
const warm = tone(WARMUP);
{
	const input = Float32Array.from(warm);
	const output = new Float32Array(warm.length);
	for (let at = 0; at < warm.length; at += BLOCK) {
		const n = Math.min(BLOCK, warm.length - at);
		engine.processBlock(input.subarray(at, at + n), output.subarray(at, at + n));
	}
}
const signal = tone(SAMPLES);
const cppOut = new Float64Array(SAMPLES);
{
	const input = Float32Array.from(signal);
	const output = new Float32Array(SAMPLES);
	const start = process.hrtime.bigint();
	for (let at = 0; at < SAMPLES; at += BLOCK) {
		const n = Math.min(BLOCK, SAMPLES - at);
		engine.processBlock(input.subarray(at, at + n), output.subarray(at, at + n));
	}
	const end = process.hrtime.bigint();
	cppOut.set(output);
	var cppMs = Number(end - start) / 1e6;
}
const tele = engine.getScheduleTelemetry();
engine.destroy();

const cppF64 = Float64Array.from(cppOut);
console.log(
	`${packet}: cpp-vs-tsSparse=${relRms(cppF64, tsSparse.out).toExponential(1)} ` +
		`cpp-vs-tsDense=${relRms(cppF64, tsDense.out).toExponential(1)} ` +
		`tsSparse-vs-tsDense=${relRms(tsSparse.out, tsDense.out).toExponential(1)}`,
);
console.log(
	`  tsMs=${tsSparse.ms.toFixed(0)} cppMs=${(cppMs as number).toFixed(0)} ` +
		`tsxRT=${(tsSparse.ms * 1e6 / SAMPLES / 20833).toFixed(2)} ` +
		`cppxRT=${((cppMs as number) * 1e6 / SAMPLES / 20833).toFixed(2)}`,
);
console.log(
	`  cppTele solves=${tele.solves} fb=${tele.fallbacks} kernel=${tele.kernelSolves} ` +
		`repiv=${tele.repivotedBlocks} aband=${tele.abandonedBlocks} dropped=${tele.droppedBlocks}`,
);
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(join(OUTDIR, `${packet}.cpp.f64`), Buffer.from(cppOut.buffer));
writeFileSync(join(OUTDIR, `${packet}.tssparse.f64`), Buffer.from(tsSparse.out.buffer));
writeFileSync(join(OUTDIR, `${packet}.tsdense.f64`), Buffer.from(tsDense.out.buffer));
console.log(`  wrote ${OUTDIR}/${packet}.*.f64`);

// The ENGINE columns of the specimen three-way tables, reproduced through this tree's engine. A port of the workbench's
// `render:v2 --signal=sine --hz=<hz> --amplitude=0.01 --seconds=2 --rate=<rate> --source-ohms=0 --no-ir --controls=<state>` path
// (scripts/render-v2-audio.ts, read-only): sine at `rate`, ReferenceRuntime.prepare(rate, {inputSourceOhms: 0}), setControl after
// prepare, one process() call over the whole signal, the 10 Hz first-order DC blocker, the port-to-file conversion where the program
// states a 0 dBFS reference, 16-bit PCM WAV. The analysis is the study's own (tolerance-envelope.py `analyse`, run by
// three-way-analyse.py on these files), so the instrument is the study's and only the engine under it differs.
//   bun docs/spikes/opamp-gbw/three-way-engine.ts --pedal=sd1|ts9 --rate=48000|192000 --out=<dir> [--states=..] [--freqs=..] [--force-gbp=null|<Hz>]
import { mkdirSync, writeFileSync } from "node:fs";
import type { Program } from "@vessel-dsp/compiler";
import { outputConversionFullScale } from "@vessel-dsp/runtime";
import { FREQS, PACKETS, STATES, arg, compileFile, renderTs } from "./lib";

const pedal = arg("pedal", "ts9");
const rate = Number(arg("rate", "48000"));
const out = arg("out", "");
const states = arg("states", Object.keys(STATES).join(",")).split(",");
const freqs = arg("freqs", FREQS.join(",")).split(",").map(Number);
const force = arg("force-gbp", "");
const SECONDS = 2.0, AMP = 0.01;
if (out === "") throw new Error("--out required");
mkdirSync(out, { recursive: true });

function writeWav(path: string, samples: Float64Array, sampleRate: number): number {
	const buf = Buffer.alloc(44 + samples.length * 2);
	buf.write("RIFF", 0, "ascii"); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVE", 8, "ascii"); buf.write("fmt ", 12, "ascii");
	buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
	buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36, "ascii"); buf.writeUInt32LE(samples.length * 2, 40);
	let clipped = 0;
	for (let i = 0; i < samples.length; i += 1) { const v = samples[i] ?? 0, b = Math.max(-1, Math.min(1, v)); if (b !== v) clipped += 1; buf.writeInt16LE(Math.round(b * 32767), 44 + i * 2); }
	writeFileSync(path, buf);
	return clipped;
}
const base = compileFile(PACKETS[pedal]!.file);
const program: Program = force === "" ? base : ({ ...base, blocks: base.blocks.map((b) => b.kind === "mna" ? { ...b, stamps: b.stamps.map((s) => s.kind === "ideal-opamp" ? { ...s, gainBandwidthHz: force === "null" ? null : Number(force) } : s) } : b) } as Program);
// Port conversion exactly as render-v2-audio.ts decides it.
const declaredReferenceVolts = program.portReferenceVolts.output;
const fullScaleVolts = outputConversionFullScale(program);
let maxSupplyVolts = 0;
for (const block of program.blocks) if (block.kind === "mna") for (const stamp of block.stamps) {
	if (stamp.kind === "dc-source") maxSupplyVolts = Math.max(maxSupplyVolts, Math.abs(stamp.volts));
	if (stamp.kind === "ac-source") maxSupplyVolts = Math.max(maxSupplyVolts, Math.abs(stamp.amplitudeVolts));
}
const convertible = fullScaleVolts !== null && fullScaleVolts > 0 && (declaredReferenceVolts !== null || (maxSupplyVolts > 0 && Math.abs(fullScaleVolts - maxSupplyVolts) > maxSupplyVolts * 1e-9));
console.log(`[${pedal} @ ${rate} Hz${force ? ` force-gbp=${force}` : ""}] reference ${declaredReferenceVolts}, full scale ${fullScaleVolts}, convertible ${convertible}`);
for (const state of states) for (const hz of freqs) {
	const n = Math.round(SECONDS * rate);
	const input = new Float64Array(n);
	for (let i = 0; i < n; i += 1) input[i] = AMP * Math.sin((2 * Math.PI * hz * i) / rate);
	const raw = renderTs(program, STATES[state]!, input, { rate, os: 1, sourceOhms: 0, block: n }).out;
	const pole = 1 - (2 * Math.PI * 10) / rate;
	const blocked = new Float64Array(n);
	let previousIn = raw[0] ?? 0, previousOut = 0;
	for (let i = 0; i < n; i += 1) { const s = raw[i] ?? 0; previousOut = s - previousIn + pole * previousOut; previousIn = s; blocked[i] = previousOut; }
	const rendered = convertible ? blocked.map((v) => v / (fullScaleVolts as number)) : blocked;
	const clipped = writeWav(`${out}/${pedal}-${state}-${hz}-${rate}.wav`, rendered, rate);
	if (clipped > 0) console.log(`  ${state} ${hz}: ${clipped} clipped`);
}
console.log(`done ${pedal} ${rate}`);

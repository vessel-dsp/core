// Corpus sweep at x1 for the candidate method: every .vdsp under the artifact corpus
// (pedals, and amps with --amps), default controls, 48 kHz, cap 64, 2400 warmup + 9600
// measured host samples, 1 kHz @ 0.1 V. Per packet: shipped loop, method loop, and the
// independent dense full-Newton reference (schedules nulled, as the pivot report); the
// fixed-point twin runs inside the method loop (worst deviation in tolerance units).
//
//   bun docs/spikes/newton-budget/corpus-sweep.ts --method=m1adapt [--amps] [--out=x.jsonl] [--packet=a,b]
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { readFileSync } from "node:fs";
import { arg, corpusFiles, flag, nullSchedules, relRms, tone, fmt } from "./lib";
import { METHODS, runPacket } from "./measure";

const method = arg("method", "m1adapt");
const config = METHODS[method];
if (config === undefined) throw new Error(`unknown method ${method}`);
const amps = flag("amps");
const OUT = arg("out", "");
const only = new Set(arg("packet", "").split(",").filter((x) => x !== ""));
const CAP = Number(arg("cap", "64"));
const [shardIndex, shardCount] = arg("shard", "0/1").split("/").map(Number) as [number, number];
const warm = tone(2400);
const sig = tone(9600, 0.1, 1000, 48000, 2400);
console.log(`corpus sweep method=${method} ${amps ? "amps" : "pedals"} cap=${CAP} x1 2400+9600`);
let n = 0, faster = 0, slower = 0, moreNc = 0, devOver = 0, fewerIt = 0, moreIt = 0;
for (const [fileIndex, file] of corpusFiles(amps).entries()) {
	const packet = basename(file, ".vdsp");
	if (only.size > 0 && !only.has(packet)) continue;
	if (fileIndex % shardCount !== shardIndex) continue;
	let row: Record<string, unknown> = { packet, method };
	try {
		const result = compile(readFileSync(file, "utf8"), { registry: pedalPartCatalog });
		if (result.status !== "ok") { console.log(`${packet.padEnd(40)} compile ${result.status}`); row.compile = result.status; if (OUT !== "") appendFileSync(OUT, `${JSON.stringify(row)}\n`); continue; }
		const program = result.program;
		const dense = runPacket(nullSchedules(program), {}, 1, CAP, warm, sig, null);
		const shipped = runPacket(program, {}, 1, CAP, warm, sig, null);
		const m = runPacket(program, {}, 1, CAP, warm, sig, { ...config, fixedPointCheck: true });
		const known = relRms(shipped.output, dense.output);
		const got = relRms(m.output, dense.output);
		const vsShipped = relRms(m.output, shipped.output);
		const c = m.counters;
		const H = 9600;
		row = {
			...row, compile: "ok", n: Math.max(0, ...program.blocks.filter((b) => b.kind === "mna").map((b: any) => b.nodeCount + b.auxCount)),
			shippedItPerHost: shipped.meanHost, methodItPerHost: c.iterations / H, methodFacPerHost: c.factorisations / H,
			shippedNc: shipped.nc, methodNc: m.nc, denseNc: dense.nc, shippedWarmNc: shipped.warmNc, methodWarmNc: m.warmNc,
			shippedPeak: shipped.peak, methodPeak: m.peak, shippedVsDense: known.rel, methodVsDense: got.rel, methodVsShipped: vsShipped.rel, denseRms: known.refRms,
			worstDeviationTol: c.worstDeviationTol, deviationOver1: c.deviationOver1, oneStepShare: c.oneStepConverged / Math.max(1, c.subSamples), twinNc: c.twinNonConverged,
			shippedNs: shipped.ns, methodNs: m.ns,
		};
		n += 1;
		if (c.iterations / H < shipped.meanHost - 1e-9) fewerIt += 1;
		if (c.iterations / H > shipped.meanHost + 1e-9) moreIt += 1;
		if (m.nc > shipped.nc) moreNc += 1;
		if (c.deviationOver1 > 0) devOver += 1;
		if (m.ns < shipped.ns) faster += 1; else slower += 1;
		console.log(`${packet.padEnd(40)} n=${String(row.n).padStart(3)} it/host ${fmt(shipped.meanHost, 3)} -> ${fmt(c.iterations / H, 3)} (${fmt(100 * (c.iterations / H / shipped.meanHost - 1))}%) NC ${shipped.nc}/${m.nc} (dense ${dense.nc}) peak ${shipped.peak}/${m.peak} vsDense ${known.rel.toExponential(1)} -> ${got.rel.toExponential(1)} vsShipped ${vsShipped.rel.toExponential(1)} devTol ${fmt(c.worstDeviationTol, 3)} dev>1 ${c.deviationOver1} 1-step ${fmt(100 * (c.oneStepConverged / Math.max(1, c.subSamples)))}% xRT ${fmt(shipped.ns / 20833, 2)} -> ${fmt(m.ns / 20833, 2)}`);
	} catch (error) {
		row.compile = "error"; row.note = String(error).slice(0, 200);
		console.log(`${packet.padEnd(40)} ERROR ${String(error).slice(0, 120)}`);
	}
	if (OUT !== "") appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}
console.log(`\npackets=${n} fewer iterations=${fewerIt} more iterations=${moreIt} more non-converged=${moreNc} deviation>1 tol unit on some sub-sample=${devOver} wall faster=${faster} slower=${slower} (wall is load-noisy here; see the dedicated timing section)`);

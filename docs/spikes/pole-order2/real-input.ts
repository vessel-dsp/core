// Iterations per host sample on REAL input, WASM console (the shipping one), from whichever tree this is run in. The input is a guitar DI take from the workbench's own test
// assets (read-only: workbench/src/web/public/assets/inputs/<name>.wav, mono 24-bit 48 kHz), a 3 s excerpt from its first onset, peak-normalised to 10 mV / 100 mV / 1 V.
// Main vs change is two runs of this script (one per tree) joined by real-input-compare.py. Reports per row: iterations/host sample, peak iterations, and the WASM console's
// own count of host samples (so a stalled render is visible as a missing row, guarded by --stall-ms).
//   bun docs/spikes/pole-order2/real-input.ts --takes=pluck-guitar,brit-guitar --out=<json> [--slugs=muff,sd1,ts9,ts808,gro100,blue-box] [--os=1,4] [--levels=0.01,0.1,1]
import { readFileSync, writeFileSync } from "node:fs";
import { PACKETS, ROOT, StallError, arg, compileFile, fileForSlug, renderWasm } from "./lib";
const takes = arg("takes", "pluck-guitar,brit-guitar").split(","), slugs = arg("slugs", "muff,sd1,ts9,ts808,gro100,blue-box").split(",");
const factors = arg("os", "1,4").split(",").map(Number), levels = arg("levels", "0.01,0.1,1").split(",").map(Number), out = arg("out", "");
const stallMs = Number(arg("stall-ms", "30000")), SECONDS = 3;
function readWav24(path: string): Float64Array {
	const b = readFileSync(path);
	let pos = 12, data = -1, size = 0, bits = 0, channels = 1, rate = 0;
	while (pos + 8 <= b.length) {
		const id = b.toString("ascii", pos, pos + 4), len = b.readUInt32LE(pos + 4);
		if (id === "fmt ") { channels = b.readUInt16LE(pos + 10); rate = b.readUInt32LE(pos + 12); bits = b.readUInt16LE(pos + 22); }
		if (id === "data") { data = pos + 8; size = len; break; }
		pos += 8 + len + (len & 1);
	}
	if (rate !== 48000 || channels !== 1 || bits !== 24) throw new Error(`${path}: expected mono 24-bit 48 kHz, got ${channels} ch ${bits} bit ${rate} Hz`);
	const n = size / 3, x = new Float64Array(n);
	for (let i = 0; i < n; i += 1) x[i] = b.readIntLE(data + 3 * i, 3) / 8388608;
	return x;
}
const rows: Array<Record<string, unknown>> = [];
console.log("take            level  packet  os | it/host   peak | (WASM console)");
for (const take of takes) {
	const all = readWav24(`${ROOT}/workbench/src/web/public/assets/inputs/${take}.wav`);
	let peak = 0; for (const v of all) peak = Math.max(peak, Math.abs(v));
	let onset = 0; while (onset < all.length && Math.abs(all[onset] as number) < 0.1 * peak) onset += 1;
	const start = Math.max(0, onset - 2400), seg = all.subarray(start, start + 48000 * SECONDS);
	let segPeak = 0; for (const v of seg) segPeak = Math.max(segPeak, Math.abs(v));
	for (const level of levels) {
		const input = Float64Array.from(seg, (v) => (v / segPeak) * level);
		for (const slug of slugs) {
			const spec = PACKETS[slug], program = compileFile(spec?.file ?? fileForSlug(slug));
			for (const os of factors) {
				const row: Record<string, unknown> = { take, level, slug, os };
				try {
					const w = await renderWasm(program, spec?.controls ?? {}, input, { os, stallMs });
					row.it = w.totalIterations / input.length; row.peak = w.peak;
					console.log(`${take.padEnd(15)} ${String(level).padEnd(5)}  ${slug.padEnd(8)} ${os} | ${(row.it as number).toFixed(3).padStart(8)} ${String(row.peak).padStart(6)}`);
				} catch (e) { if (!(e instanceof StallError)) throw e; row.stall = e.message; console.log(`${take.padEnd(15)} ${String(level).padEnd(5)}  ${slug.padEnd(8)} ${os} | STALL ${e.message}`); }
				rows.push(row);
			}
		}
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

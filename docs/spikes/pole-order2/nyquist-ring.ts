// The trapezoid's Nyquist ringing, with an instrument that can say YES as well as no. For each case the render's spectrum (Hann window, last 2^15 samples at the
// output rate) is read at the top bin (fs/2) and over the top band (0.45-0.5 fs, RMS), in dB relative to the reference component (the 1 kHz fundamental, or 440 Hz for the
// two-tone). Cases:
//   known-positive : a unity-gain follower driven by an IMPULSE train (one sample every 64) and by a 1 kHz SQUARE wave -- edges excite the stage's Nyquist-rate ring, so a
//                    trapezoid follower must read far above a backward-Euler one at native rates; if both read the same the instrument is blind.
//   negative       : the same follower driven by a 1 kHz SINE (nothing excites the ring): both read the floor.
//   real renders   : mxr-blue-box, boss-bd-2-blues-driver, ibanez-pql, 1 kHz 100 mV and the two-tone, x1 and os4 (the resampler band-limits the output of os4, so a solver-rate
//                    ring is hidden there by construction: it is reported, not claimed).
// "native" rows render at host rate 48000 and 192000 with oversample 1, so the solver's own Nyquist is the output's top bin. WASM console (shipping); --ts adds TS.
//   bun docs/spikes/pole-order2/nyquist-ring.ts --out=<json> [--ts] [--packets=mxr-blue-box,boss-bd-2-blues-driver,ibanez-pql]
import { writeFileSync } from "node:fs";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { nonInvertingStage } from "../../../packages/runtime/tests/non-inverting-stage";
import { arg, compileFile, fileForSlug, has, renderTs, renderWasm, sine } from "./lib";
const out = arg("out", ""), packets = arg("packets", "mxr-blue-box,boss-bd-2-blues-driver,ibanez-pql").split(","), withTs = has("ts");
const N = 1 << 15;
function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i += 1) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; } }
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k += 1) { const a = i + k, b = i + k + len / 2; const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr; re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
	}
}
/** dB of the top bin and of the top band against the reference tone, from the last N samples of `y` (host rate `rate`). */
function ringReading(y: ArrayLike<number>, rate: number, refHz: number) {
	const re = new Float64Array(N), im = new Float64Array(N), off = y.length - N;
	let win = 0;
	for (let i = 0; i < N; i += 1) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); re[i] = (y[off + i] as number) * w; win += w; }
	fft(re, im);
	const mag = (k: number) => (2 * Math.hypot(re[k]!, im[k]!)) / win;
	const refBin = Math.round((refHz * N) / rate);
	let ref = 0; for (let k = refBin - 2; k <= refBin + 2; k += 1) ref = Math.max(ref, mag(k));
	let band = 0, cnt = 0; for (let k = Math.round(0.45 * N); k < N / 2; k += 1) { band += mag(k) ** 2; cnt += 1; }
	const top = mag(N / 2 - 1);
	return { ref, topDb: 20 * Math.log10(Math.max(top, 1e-30) / ref), bandDb: 20 * Math.log10(Math.max(Math.sqrt(band / cnt), 1e-30) / ref) };
}
const rows: Array<Record<string, unknown>> = [];
const consoles: Array<"wasm" | "ts"> = withTs ? ["wasm", "ts"] : ["wasm"];
async function render(cn: "wasm" | "ts", program: any, input: Float64Array, rate: number, os: number): Promise<ArrayLike<number>> {
	return cn === "ts" ? renderTs(program, {}, input, { rate, os, sourceOhms: 0, block: 4096 }).out : (await renderWasm(program, {}, input, { rate, os, sourceOhms: 0, block: 4096 })).out;
}
console.log("case                              console  rate  os | top bin dBc  top band dBc | ref amplitude");
// follower and G=2 stages
for (const [label, rf, rg] of [["follower G=1", 1, 1e9], ["G=2", 1000, 1000], ["G=10", 9000, 1000]] as const) {
	const prog = compile(nonInvertingStage({ rfOhms: rf, rgOhms: rg }), { registry: emptyRegistry });
	if (prog.status !== "ok") throw new Error("stage");
	for (const [rate, os] of [[48000, 1], [192000, 1], [48000, 4]] as const) for (const cn of consoles) for (const stim of ["sine", "square", "impulse"] as const) {
		const n = N + 4096, input = new Float64Array(n);
		for (let i = 0; i < n; i += 1) input[i] = stim === "sine" ? 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate) : stim === "square" ? (Math.sin((2 * Math.PI * 1000 * i) / rate) >= 0 ? 0.1 : -0.1) : i % 64 === 0 ? 0.1 : 0;
		const y = await render(cn, prog.program, input, rate, os);
		// the ref for impulse trains is the repetition rate component (rate/64)
		const refHz = stim === "impulse" ? rate / 64 : 1000;
		const r = ringReading(y, rate, refHz);
		rows.push({ case: `${label} ${stim}`, console: cn, rate, os, ...r });
		console.log(`${`${label} ${stim}`.padEnd(33)} ${cn.padEnd(7)} ${String(rate).padStart(6)} x${os} | ${r.topDb.toFixed(1).padStart(10)} ${r.bandDb.toFixed(1).padStart(12)} | ${r.ref.toExponential(2)}`);
	}
}
// real renders
const tone = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / 48000) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / 48000));
for (const slug of packets) {
	const program = compileFile(fileForSlug(slug));
	for (const os of [1, 4]) for (const [stim, refHz] of [["1kHz-100mV", 1000], ["two-tone", 440]] as const) for (const cn of consoles) {
		if (cn === "ts" && slug === "boss-bd-2-blues-driver" && os === 4) continue;
		const n = 48000 + N, input = stim === "two-tone" ? tone(n) : sine(n, 1000, 0.1);
		try {
			const y = await render(cn, program, input, 48000, os);
			const r = ringReading(y, 48000, refHz);
			rows.push({ case: `${slug} ${stim}`, console: cn, rate: 48000, os, ...r });
			console.log(`${`${slug} ${stim}`.padEnd(33)} ${cn.padEnd(7)} ${String(48000).padStart(6)} x${os} | ${r.topDb.toFixed(1).padStart(10)} ${r.bandDb.toFixed(1).padStart(12)} | ${r.ref.toExponential(2)}`);
		} catch (e) { console.log(`${slug} ${stim} ${cn} x${os}: ${String(e).slice(0, 80)}`); }
	}
}
if (out !== "") writeFileSync(out, JSON.stringify(rows));

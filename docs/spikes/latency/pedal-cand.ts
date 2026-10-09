// Pedal-level candidate renders: EXTERNAL cascade (candidate upsample ->
// stock ReferenceRuntime at 48k·2^stages, oversample=1 -> candidate decimate).
// Equivalent to internal osN sample-for-sample (same filter arithmetic, same
// solve sequence, same t grid); avoids touching the runtime. Controls set
// AFTER prepare, inputSourceOhms 94, same as the probe.
// Usage: bun pedal-cand.ts <pedal> <cand|native192> <stages> <job> <out>
//   job = fr:FREQ,... | alias:FREQ,... | td:two-tone,pluck,burst[,sine1k]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { buildCandidate, type CandidateId, type Stage } from "./candidates";

const [pedal, cand, stagesArg, job, outFile] = process.argv.slice(2) as [string, string, string, string, string];
const stages = Number(stagesArg);
const M = 2 ** stages;
const HOST = 48_000;

const PATHS: Record<string, string> = {
  muff: "/home/joseph/projects/VesselDSP/workbench/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp",
  sd1: "/home/joseph/projects/VesselDSP/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp",
  ts9: "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp/ibanez-ts9-reissue.vdsp",
};
const CENTRE: Record<string, string> = {
  muff: "SUSTAIN=0.5,TONE=0.5,VOLUME=0.3",
  sd1: "Drive=0.5,Tone=0.5,Level=0.3",
  ts9: "Drive=0.5,Tone=0.5,Level=0.3",
};
const HOT: Record<string, string> = {
  muff: "SUSTAIN=1.0,TONE=0.5,VOLUME=0.3",
  sd1: "Drive=1.0,Tone=0.5,Level=0.3",
  ts9: "Drive=1.0,Tone=0.5,Level=0.3",
};

const result = compile(readFileSync(PATHS[pedal!]!, "utf8"), { registry: pedalPartCatalog } as never) as { status: string; program: never };
if (result.status !== "ok") throw new Error(`${pedal} did not compile`);

const setControls = (rt: ReferenceRuntime, spec: string): void => {
  for (const kv of spec.split(",")) { const [k, v] = kv.split("="); if (k && v) rt.setControl(k, Number(v)); }
};

// ---- stimuli (continuous-time definitions, sampled at the render rate) ----
const sineAt = (f: number, amp: number) => (t: number): number => amp * Math.sin(2 * Math.PI * f * t);
const twoToneAt = () => (t: number): number => 0.25 * Math.sin(2 * Math.PI * 440 * t) + 0.1 * Math.sin(2 * Math.PI * 1320 * t);
// Pluck: decaying 6-harmonic 110 Hz stack, 0.5 ms attack, 0.35 s decay, peak-normalized to 100 mV.
const pluckRaw = (t: number): number => {
  if (t < 0) return 0;
  const env = (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / 0.35);
  let s = 0;
  for (let k = 1; k <= 6; k += 1) s += Math.sin(2 * Math.PI * 110 * k * t + k * 0.7) / k;
  return env * s;
};
let pluckNorm = 0;
for (let i = 0; i < 0.05 * 192000; i += 1) pluckNorm = Math.max(pluckNorm, Math.abs(pluckRaw(i / 192000)));
const pluckAt = (onset: number) => (t: number): number => (0.1 / pluckNorm) * pluckRaw(t - onset);
// Square-ish burst: 110 Hz tanh square, 100 mV, windowed [0.1,0.3] s, 2 ms edges.
const burstAt = () => (t: number): number => {
  const edge = 0.002;
  const win = t < 0.1 ? 0 : t < 0.1 + edge ? 0.5 - 0.5 * Math.cos(Math.PI * (t - 0.1) / edge) : t < 0.3 ? 1 : t < 0.3 + edge ? 0.5 + 0.5 * Math.cos(Math.PI * (t - 0.3) / edge) : 0;
  return win * 0.1 * Math.tanh(8 * Math.sin(2 * Math.PI * 110 * t));
};

// ---- probe LS fit (copy of probe.ts) ----
function lsFit(x: Float64Array, fs: number, f0: number, nh: number) {
  const n = x.length, m = 1 + 2 * nh;
  const cols: Float64Array[] = [new Float64Array(n).fill(1)];
  for (let h = 1; h <= nh; h++) {
    const c = new Float64Array(n), s = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = (2 * Math.PI * f0 * h * i) / fs; c[i] = Math.cos(p); s[i] = Math.sin(p); }
    cols.push(c, s);
  }
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  for (let a = 0; a < m; a++) {
    for (let b = a; b < m; b++) { let t = 0; const ca = cols[a]!, cb = cols[b]!; for (let i = 0; i < n; i++) t += ca[i]! * cb[i]!; A[a]![b] = t; A[b]![a] = t; }
    let t = 0; const ca = cols[a]!; for (let i = 0; i < n; i++) t += ca[i]! * x[i]!; A[a]![m] = t;
  }
  for (let i = 0; i < m; i++) {
    let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = i + 1; r < m; r++) { const f = A[r]![i]! / A[i]![i]!; for (let c = i; c <= m; c++) A[r]![c]! -= f * A[i]![c]!; }
  }
  const coef = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) { let t = A[i]![m]!; for (let c = i + 1; c < m; c++) t -= A[i]![c]! * coef[c]!; coef[i] = t / A[i]![i]!; }
  let resid = 0; for (let i = 0; i < n; i++) { let y = 0; for (let k = 0; k < m; k++) y += coef[k]! * cols[k]![i]!; const e = x[i]! - y; resid += e * e; }
  return { fund: Math.hypot(coef[1]!, coef[2]!), resid: Math.sqrt(resid / n), harm: Array.from({ length: nh }, (_, h) => Math.hypot(coef[1 + 2 * h]!, coef[2 + 2 * h]!)) };
}

// ---- renders ----
const upsample = (input: Float64Array, up: Stage[]): Float64Array => {
  const out = new Float64Array(input.length * M);
  const bufs = [new Float64Array(M), new Float64Array(M)];
  for (let n = 0; n < input.length; n += 1) {
    let cur = bufs[0]!, next = bufs[1]!;
    up[0]!.interpolate(input[n]!, cur, 0);
    let width = 2;
    for (let s = 1; s < up.length; s += 1) {
      for (let i = 0; i < width; i += 1) up[s]!.interpolate(cur[i]!, next, 2 * i);
      [cur, next] = [next, cur]; width *= 2;
    }
    out.set(cur.subarray(0, width), n * M);
  }
  return out;
};
const decimate = (input: Float64Array, down: Stage[]): Float64Array => {
  const out = new Float64Array(input.length / M);
  const hi = Float64Array.from(input);
  let width = input.length;
  for (let s = down.length - 1; s >= 0; s -= 1) {
    const half = width / 2;
    for (let i = 0; i < half; i += 1) hi[i] = down[s]!.decimate(hi[2 * i]!, hi[2 * i + 1]!);
    width = half;
  }
  out.set(hi.subarray(0, width));
  return out;
};

const runOs = (stim: (t: number) => number, seconds: number, controls: string): Float64Array => {
  const { up, down } = buildCandidate(cand as CandidateId, stages);
  const nHost = Math.round(HOST * seconds);
  const inputHost = new Float64Array(nHost);
  for (let i = 0; i < nHost; i += 1) inputHost[i] = stim(i / HOST);
  const hi = upsample(inputHost, up);
  const rt = new ReferenceRuntime(result.program);
  rt.prepare(HOST * M, { inputSourceOhms: 94 });
  setControls(rt, controls);
  const hiOut = new Float64Array(hi.length);
  const blk = 2048;
  for (let i = 0; i < hi.length; i += blk) hiOut.set(rt.process(hi.subarray(i, Math.min(hi.length, i + blk))), i);
  return decimate(hiOut, down);
};
const runNative = (stim: (t: number) => number, seconds: number, controls: string): Float64Array => {
  const rate = 192000;
  const n = Math.round(rate * seconds);
  const input = new Float64Array(n);
  for (let i = 0; i < n; i += 1) input[i] = stim(i / rate);
  const rt = new ReferenceRuntime(result.program);
  rt.prepare(rate, { inputSourceOhms: 94 });
  setControls(rt, controls);
  const out = new Float64Array(n);
  const blk = 2048;
  for (let i = 0; i < n; i += blk) out.set(rt.process(input.subarray(i, Math.min(n, i + blk))), i);
  return out;
};

mkdirSync("/tmp/lat/wav", { recursive: true });
const rows: Record<string, unknown>[] = [];
const [kind, arg] = job.split(":") as [string, string];
if (kind === "fr" || kind === "alias") {
  const mv = kind === "fr" ? 10 : 100;
  const controls = kind === "fr" ? CENTRE[pedal]! : HOT[pedal]!;
  const SETTLE = 0.5, LEN = 1.5;
  for (const hz of arg.split(",").map(Number)) {
    const stim = sineAt(hz, mv / 1000);
    const out = cand === "native192" ? runNative(stim, SETTLE + LEN, controls) : runOs(stim, SETTLE + LEN, controls);
    const rate = cand === "native192" ? 192000 : HOST;
    const w = out.subarray(Math.floor((0.4 + SETTLE) * rate), Math.floor((1.2 + SETTLE) * rate));
    let best = { f: hz, r: Infinity };
    const nh = Math.max(1, Math.min(8, Math.floor(rate / 2 / hz) - 1));
    const dec = Math.max(1, Math.floor(rate / (8 * hz * nh)));
    const wd = Float64Array.from({ length: Math.floor(w.length / dec) }, (_, i) => w[i * dec]!);
    for (let k = -4; k <= 4; k++) { const f = hz + k * 0.25; const r = lsFit(wd, rate / dec, f, 1).resid; if (r < best.r) best = { f, r }; }
    const fit = lsFit(w, rate, best.f, nh);
    rows.push({ pedal, cand, stages, mv, controls, hz, fund_mV: fit.fund * 1e3, resid_dBc: 20 * Math.log10(fit.resid / fit.fund), h3_dBc: nh >= 3 ? 20 * Math.log10(fit.harm[2]! / fit.fund) : null });
  }
} else if (kind === "td") {
  for (const stimName of arg.split(",")) {
    const isHot = stimName === "pluck" || stimName === "burst";
    const controls = isHot ? HOT[pedal]! : CENTRE[pedal]!;
    let stim: (t: number) => number;
    let seconds: number;
    if (stimName === "two-tone") { stim = twoToneAt(); seconds = 1.5; }
    else if (stimName === "pluck") { stim = pluckAt(0.1); seconds = 1.0; }
    else if (stimName === "burst") { stim = burstAt(); seconds = 1.0; }
    else if (stimName === "sine1k") { stim = sineAt(1000, 0.01); seconds = 2.0; }
    else throw new Error(`unknown stim ${stimName}`);
    const out = cand === "native192" ? runNative(stim, seconds, controls) : runOs(stim, seconds, controls);
    const rate = cand === "native192" ? 192000 : HOST;
    const path = `/tmp/lat/wav/${pedal}-${stimName}-${cand === "native192" ? "n192" : `${cand}-os${M}`}.bin`;
    writeFileSync(path, Buffer.from(out.buffer));
    rows.push({ pedal, cand, stages, stim: stimName, controls, rate, seconds, path, peak: Math.max(...out.map(Math.abs)) });
  }
}
writeFileSync(outFile, JSON.stringify(rows));
console.log(`${pedal} ${cand} os${cand === "native192" ? 192 : M} ${job}: ${rows.length} rows -> ${outFile}`);

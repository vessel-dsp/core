// Known-positive for the phase metric: a single strong allpass at 3 kHz
// before the clipper MUST register as time-domain error under the same metric.
// Compares native192 clean-input vs native192 allpassed-input (pure input-phase
// effect, same circuit, same rate), plus shipped-os4 clean vs allpassed.
// Allpass: 2nd-order biquad allpass, f0=1200 Hz, Q=5 (RBJ cookbook): group
// delay peaks ~200 host samples in the pluck's core band (110 Hz–2 kHz),
// ~0 below 100 Hz — dispersion the lag search cannot absorb.
const AP_F0 = 1200, AP_Q = 5;
import { readFileSync, writeFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const mkAllpass = (f0: number, Q: number, fs: number): ((x: number) => number) => {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = (1 - alpha) / (1 + alpha), b1 = (-2 * Math.cos(w0)) / (1 + alpha), b2 = 1;
  const a0 = 1, a1 = (-2 * Math.cos(w0)) / (1 + alpha), a2 = (1 - alpha) / (1 + alpha);
  void a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number): number => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
};
// group delay at DC..8k for the report curve
{
  const fs = 48000;
  for (const f of [100, 500, 1000, 2000, 3000, 4000, 6000, 8000]) {
    const ap = mkAllpass(AP_F0, AP_Q, fs);
    const N = 48000;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i += 1) out[i] = ap(Math.sin((2 * Math.PI * f * i) / fs));
    // fit phase vs input
    let cc = 0, ss = 0, tc = 0, ts = 0;
    for (let i = 20000; i < N; i += 1) {
      const p = (2 * Math.PI * f * i) / fs;
      tc += out[i]! * Math.cos(p); ts += out[i]! * Math.sin(p);
      cc += Math.cos(p) ** 2; ss += Math.sin(p) ** 2;
    }
    void cc; void ss;
    console.log(`allpass GD probe f=${f}: outRMS ${(Math.sqrt((tc * tc + ts * ts) / ((N - 20000) ** 2)) ).toExponential(2)} phase ${Math.atan2(ts, tc).toFixed(3)}`);
  }
}

const PATHS: Record<string, string> = {
  sd1: "/home/joseph/projects/VesselDSP/workbench/packet-study/boss-sd-1-et521-5108/variants/boss-sd-1.at-9v17.vdsp",
  muff: "/home/joseph/projects/VesselDSP/workbench/packet-study/big-muff-ec3003-rev-f/big-muff-ec3003-rev-f.vdsp",
};
const HOT: Record<string, string> = {
  sd1: "Drive=1.0,Tone=0.5,Level=0.3",
  muff: "SUSTAIN=1.0,TONE=0.5,VOLUME=0.3",
};
// pluck stimulus (same definition as pedal-cand.ts)
const pluckRaw = (t: number): number => {
  if (t < 0) return 0;
  const env = (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / 0.35);
  let s = 0;
  for (let k = 1; k <= 6; k += 1) s += Math.sin(2 * Math.PI * 110 * k * t + k * 0.7) / k;
  return env * s;
};
let pluckNorm = 0;
for (let i = 0; i < 0.05 * 192000; i += 1) pluckNorm = Math.max(pluckNorm, Math.abs(pluckRaw(i / 192000)));

const render = (pedal: string, rate: number, allpass: boolean): Float64Array => {
  const src = readFileSync(PATHS[pedal]!, "utf8");
  const r = compile(src, { registry: pedalPartCatalog } as never) as { status: string; program: never };
  if (r.status !== "ok") throw new Error("no compile");
  const seconds = 1.0, n = Math.round(rate * seconds);
  const ap = mkAllpass(AP_F0, AP_Q, rate);
  const input = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const s = (0.1 / pluckNorm) * pluckRaw(t - 0.1);
    input[i] = allpass ? ap(s) : s;
  }
  const rt = new ReferenceRuntime(r.program);
  rt.prepare(rate, { inputSourceOhms: 94 });
  for (const kv of HOT[pedal]!.split(",")) { const [k, v] = kv.split("="); rt.setControl(k!, Number(v)); }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2048) out.set(rt.process(input.subarray(i, Math.min(n, i + 2048))), i);
  return out;
};

for (const pedal of ["sd1", "muff"]) {
  const clean = render(pedal, 192000, false);
  const ap = render(pedal, 192000, true);
  // input magnitude check: allpass is magnitude-flat (compare input spectra roughly via RMS)
  // metric: relRMS + maxAbs on time window [0.15, 1.0]s (past onset), no shift needed (allpass GD ~ ms, include lag search ±600)
  const w0 = Math.floor(0.15 * 192000);
  const a = clean.subarray(w0), b = ap.subarray(w0);
  let best = 0, blag = 0;
  for (let lag = -600; lag <= 600; lag += 8) {
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 600; i < a.length - 600; i += 4) {
      const x = a[i]!, y = (i + lag >= 0 && i + lag < b.length ? b[i + lag]! : 0);
      sab += x * y; saa += x * x; sbb += y * y;
    }
    const c = sab / Math.sqrt(saa * sbb);
    if (c > best) { best = c; blag = lag; }
  }
  // refine ±8
  for (let lag = blag - 8; lag <= blag + 8; lag += 1) {
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 600; i < a.length - 600; i += 2) {
      const x = a[i]!, y = (i + lag >= 0 && i + lag < b.length ? b[i + lag]! : 0);
      sab += x * y; saa += x * x; sbb += y * y;
    }
    const c = sab / Math.sqrt(saa * sbb);
    if (c > best) { best = c; blag = lag; }
  }
  let num = 0, den = 0, mx = 0, pk = 0;
  for (let i = 600; i < a.length - 600; i += 1) {
    const y = (i + blag >= 0 && i + blag < b.length ? b[i + blag]! : 0);
    const e = a[i]! - y;
    num += e * e; den += a[i]! * a[i]!;
    if (Math.abs(e) > mx) mx = Math.abs(e);
    if (Math.abs(a[i]!) > pk) pk = Math.abs(a[i]!);
  }
  console.log(`${pedal} allpass-positive n192-vs-n192: lag ${blag} @192k (${(blag / 4).toFixed(1)} host) ncorr ${best.toFixed(6)} relRMS ${(100 * Math.sqrt(num / den)).toFixed(2)}% maxAbs ${(20 * Math.log10(mx / pk)).toFixed(1)} dBpk`);
  writeFileSync(`/tmp/lat/wav/${pedal}-pluck-allpassed-n192.bin`, Buffer.from(ap.buffer));
}

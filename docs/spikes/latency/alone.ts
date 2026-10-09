// Resampler-alone measurements for every candidate (no circuit).
// DTFT magnitude, ripple, stopband, group-delay curve, impulse/centroid,
// round-trip swept-sine gain, image/fold tones, IIR stability, block-split
// identity, cost. Harness/window stated per figure in the report.
import { designHalfBand2x } from "../../../packages/runtime/src/resample";
import {
  buildCandidate,
  minPhaseFromLinear,
  solveD5,
  type CandidateId,
  type Stage,
} from "./candidates";

const HOST = 48_000;
const dtftDb = (h: Float64Array, fs: number, f: number): number => {
  let re = 0, im = 0;
  for (let i = 0; i < h.length; i += 1) {
    const p = (2 * Math.PI * f * i) / fs;
    re += h[i]! * Math.cos(p); im -= h[i]! * Math.sin(p);
  }
  return 20 * Math.log10(Math.hypot(re, im));
};

// IIR single-stage analytic response at its high rate (2x the stage low rate).
const iirStageDb = (a0: readonly number[], a1: readonly number[], fsHigh: number, f: number): number => {
  const ap = (a: number, w: number): [number, number] => {
    // (a + e^-jw)/(1 + a e^-jw)
    const nr = a + Math.cos(w), ni = -Math.sin(w);
    const dr = 1 + a * Math.cos(w), di = -a * Math.sin(w);
    const d = dr * dr + di * di;
    return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
  };
  const cas = (as: readonly number[], w2: number): [number, number] => {
    let r = 1, i = 0;
    for (const a of as) { const [br, bi] = ap(a, w2); const nr = r * br - i * bi; i = r * bi + i * br; r = nr; }
    return [r, i];
  };
  const w = (2 * Math.PI * f) / fsHigh;
  const [r0, i0] = cas(a0, 2 * w);
  const [r1, i1] = cas(a1, 2 * w);
  // H = (A0(z²) + z⁻¹A1(z²))/2
  const c = Math.cos(w), s = Math.sin(w);
  const hr = (r0 + c * r1 + s * i1) / 2, hi = (i0 + c * i1 - s * r1) / 2;
  return 20 * Math.log10(Math.hypot(hr, hi));
};

const roundTrip = (input: Float64Array, up: Stage[], down: Stage[]): Float64Array => {
  const stages = up.length;
  const bufs: Float64Array[] = [new Float64Array(8), new Float64Array(8)];
  const output = new Float64Array(input.length);
  for (let n = 0; n < input.length; n += 1) {
    let cur = bufs[0]!, next = bufs[1]!;
    up[0]!.interpolate(input[n]!, cur, 0);
    let width = 2;
    for (let s = 1; s < stages; s += 1) {
      for (let i = 0; i < width; i += 1) up[s]!.interpolate(cur[i]!, next, 2 * i);
      [cur, next] = [next, cur]; width *= 2;
    }
    const hi = cur;
    for (let s = stages - 1; s >= 0; s -= 1) {
      const half = width / 2;
      for (let i = 0; i < half; i += 1) hi[i] = down[s]!.decimate(hi[2 * i]!, hi[2 * i + 1]!);
      width = half;
    }
    output[n] = hi[0]!;
  }
  return output;
};

// Whole-period LS fit of DC + fundamental: returns gain + phase.
const fitSine = (y: Float64Array, fs: number, f: number): { gain: number; phase: number } => {
  let cc = 0, cs = 0, ss = 0, tc = 0, ts = 0;
  for (let i = 0; i < y.length; i += 1) {
    const p = (2 * Math.PI * f * i) / fs;
    const c = Math.cos(p), s = Math.sin(p);
    cc += c * c; cs += c * s; ss += s * s; tc += y[i]! * c; ts += y[i]! * s;
  }
  const det = cc * ss - cs * cs;
  const a = (tc * ss - ts * cs) / det, b = (cc * ts - cs * tc) / det;
  return { gain: Math.hypot(a, b), phase: Math.atan2(b, a) };
};

const wholePeriodWindow = (fn: (n: number) => number, fs: number, f: number, periods: number, skip: number): Float64Array => {
  const n = Math.round((periods * fs) / f);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) y[i] = fn(skip + i);
  return y;
};

const IDS: CandidateId[] = ["shipped", "A", "B", "C", "D3", "D5", "E"];

console.log("=== prototype DTFT (FIR candidates at 96 kHz stage rate) ===");
for (const [taps, beta, name] of [[57, 8.3, "shipped/A-s1"], [25, 8.3, "A-s2?"], [13, 8.3, "A-s3?"], [33, 5.8, "B"]] as const) {
  const h = designHalfBand2x(taps, beta);
  const row = [0, 5000, 10000, 15000, 19200, 20000, 24000, 28800, 30000, 40000].map((f) => dtftDb(h, 96000, f).toFixed(2)).join(" ");
  console.log(`${name} taps=${taps} beta=${beta}: ${row}`);
  // ripple to 19.2k on 100 Hz grid
  let rip = 0;
  for (let f = 100; f <= 19200; f += 100) rip = Math.max(rip, Math.abs(dtftDb(h, 96000, f)));
  let stop = -Infinity;
  for (let f = 28800; f <= 67200; f += 200) stop = Math.max(stop, dtftDb(h, 96000, f));
  console.log(`   ripple<=19.2k: ${rip.toFixed(4)} dB  worst-stop>=28.8k: ${stop.toFixed(2)} dB`);
}

console.log("=== later-stage prototypes at their own stage rates ===");
for (const [taps, beta, rate, pb, sb0, name] of [
  [25, 8.3, 192000, 24000, 48000, "A-s2"],
  [13, 8.3, 384000, 48000, 96000, "A-s3"],
  [21, 8.3, 192000, 24000, 48000, "A-s2alt"],
  [17, 8.3, 384000, 48000, 96000, "A-s3alt"],
] as const) {
  const h = designHalfBand2x(taps, beta);
  let rip = 0;
  for (let f = 100; f <= pb; f += 100) rip = Math.max(rip, Math.abs(dtftDb(h, rate, f)));
  let stop = -Infinity;
  for (let f = sb0; f <= rate / 2; f += 500) stop = Math.max(stop, dtftDb(h, rate, f));
  console.log(`${name} taps=${taps} @${rate / 1000}k: ripple<=${pb / 1000}k ${rip.toFixed(4)} dB  worst-stop>=${sb0 / 1000}k ${stop.toFixed(2)} dB  -6dB@quarter ${(dtftDb(h, rate, rate / 4)).toFixed(2)} dB`);
}

console.log("=== min-phase vs linear magnitude (57-tap β8.3) ===");
{
  const lin = designHalfBand2x();
  const minp = minPhaseFromLinear(lin);
  let worst = 0, worstF = 0;
  for (let f = 0; f <= 48000; f += 200) {
    const d = Math.abs(dtftDb(minp, 96000, f) - dtftDb(lin, 96000, f));
    if (d > worst) { worst = d; worstF = f; }
  }
  console.log(`worst |C-min| magnitude deviation 0..48k: ${worst.toFixed(3)} dB at ${worstF} Hz`);
  let rip = 0;
  for (let f = 100; f <= 19200; f += 100) rip = Math.max(rip, Math.abs(dtftDb(minp, 96000, f)));
  let stop = -Infinity;
  for (let f = 28800; f <= 67200; f += 200) stop = Math.max(stop, dtftDb(minp, 96000, f));
  let dc = 0; for (const v of minp) dc += v!;
  console.log(`C ripple<=19.2k ${rip.toFixed(4)} dB  worst-stop ${stop.toFixed(2)} dB  DC ${dc}`);
  console.log(`C first 8 taps: ${Array.from(minp.slice(0, 8)).map((v) => v.toFixed(5)).join(" ")}`);
  console.log(`C peak tap index: ${minp.indexOf(Math.max(...minp))} (linear center 28)`);
}

console.log("=== IIR single-stage analytic response ===");
console.log(`D5 solve: ${JSON.stringify(solveD5())}`);
for (const [a0, a1, name] of [[[], [1 / 3], "D3"], [[solveD5().a0], [solveD5().a1], "D5"]] as const) {
  const row = [0, 5000, 10000, 15000, 19200, 20000, 24000, 28800, 30000, 40000].map((f) => iirStageDb(a0, a1, 96000, f).toFixed(2)).join(" ");
  console.log(`${name} @96k: ${row}`);
}

console.log("=== round-trip swept-sine gain (host 48k, dB) ===");
for (const id of IDS) {
  for (const stages of [1, 2, 3]) {
    const { up, down } = buildCandidate(id, stages);
    const gains: string[] = [];
    for (const f of [100, 1000, 4000, 8000, 16000, 19200]) {
      const N = 4800 + 4096;
      const input = new Float64Array(N);
      for (let i = 0; i < N; i += 1) input[i] = Math.sin((2 * Math.PI * f * i) / HOST);
      const out = roundTrip(input, up, down).subarray(4096);
      const w = wholePeriodWindow((n) => out[n]!, HOST, f, 20, 0);
      const g = 20 * Math.log10(fitSine(w, HOST, f).gain);
      gains.push(`${f}:${g.toFixed(3)}`);
      up.forEach((s) => s.reset()); down.forEach((s) => s.reset());
    }
    console.log(`${id} x${2 ** stages}: ${gains.join(" ")}`);
  }
}

console.log("=== group delay vs frequency (host samples, round-trip, aligned whole-period) ===");
for (const id of IDS) {
  for (const stages of [1, 2]) {
    const { up, down } = buildCandidate(id, stages);
    const freqs = [100, 500, 1000, 2000, 4000, 8000, 12000, 16000, 19200];
    const phases = freqs.map((f) => {
      const N = 4800 + 8192;
      const input = new Float64Array(N);
      for (let i = 0; i < N; i += 1) input[i] = Math.sin((2 * Math.PI * f * i) / HOST);
      const out = roundTrip(input, up, down).subarray(8192);
      const w = wholePeriodWindow((n) => out[n]!, HOST, f, 30, 0);
      const ph = fitSine(w, HOST, f).phase;
      up.forEach((s) => s.reset()); down.forEach((s) => s.reset());
      return ph;
    });
    // unwrap + slope between adjacent (host samples)
    let unw = [phases[0]!];
    for (let i = 1; i < phases.length; i += 1) {
      let p = phases[i]!;
      while (p - unw[i - 1]! > Math.PI) p -= 2 * Math.PI;
      while (p - unw[i - 1]! < -Math.PI) p += 2 * Math.PI;
      unw.push(p);
    }
    const gds = freqs.map((f, i) => {
      if (i === 0) return "-";
      const dw = (2 * Math.PI * (f - freqs[i - 1]!)) / HOST;
      return (-(unw[i]! - unw[i - 1]!) / dw).toFixed(2);
    });
    console.log(`${id} x${2 ** stages}: ${freqs.map((f, i) => `${f}:${gds[i]}`).join(" ")}`);
  }
}

console.log("=== impulse centroid + peak (host samples, round-trip) ===");
for (const id of IDS) {
  for (const stages of [1, 2, 3]) {
    const { up, down } = buildCandidate(id, stages);
    const N = 1200;
    const input = new Float64Array(N); input[0] = 1;
    const out = roundTrip(input, up, down);
    let e = 0, c = 0, peak = 0, peakI = 0;
    for (let i = 0; i < N; i += 1) { const v = out[i]!; e += v * v; c += i * v * v; if (Math.abs(v) > peak) { peak = Math.abs(v); peakI = i; } }
    console.log(`${id} x${2 ** stages}: centroid ${(c / e).toFixed(3)} peak@${peakI} peakAmp ${peak.toExponential(2)} tailE ${(1 - (() => { let s = 0; for (let i = 0; i < 200; i += 1) s += out[i]! * out[i]!; return s; })() / e).toExponential(1)}`);
  }
}

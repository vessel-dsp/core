// Resampler-alone measurements, v2 (fixed buffers, GD with phase reference).
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

/** Render a host-rate sine through the cascade; return settled whole-period window + its absolute start. */
const renderSine = (f: number, up: Stage[], down: Stage[], periods = 40, skipPeriods = 60): { w: Float64Array; t0: number } => {
  const skip = Math.ceil((skipPeriods * HOST) / f);
  const n = Math.round((periods * HOST) / f);
  const input = new Float64Array(skip + n);
  for (let i = 0; i < input.length; i += 1) input[i] = Math.sin((2 * Math.PI * f * i) / HOST);
  const out = roundTrip(input, up, down).subarray(skip);
  up.forEach((s) => s.reset()); down.forEach((s) => s.reset());
  return { w: out, t0: skip };
};

const fitCosSin = (y: Float64Array): { a: number; b: number } => {
  // Fit y[i] = a cos + b sin on the window's own grid (phase relative to window start).
  let cc = 0, cs = 0, ss = 0, tc = 0, ts = 0;
  const n = y.length;
  for (let i = 0; i < n; i += 1) {
    const p = (2 * Math.PI * i) / n; // NOT the tone freq; caller ensures whole periods so fund = 1 cycle/window only if periods=1
    void p;
  }
  return { a: cc, b: cs, tc, ts, ss } as unknown as { a: number; b: number };
};
void fitCosSin;

const fitTone = (y: Float64Array, f: number): { gain: number; phaseW: number } => {
  let cc = 0, cs = 0, ss = 0, tc = 0, ts = 0;
  for (let i = 0; i < y.length; i += 1) {
    const p = (2 * Math.PI * f * i) / HOST;
    const c = Math.cos(p), s = Math.sin(p);
    cc += c * c; cs += c * s; ss += s * s; tc += y[i]! * c; ts += y[i]! * s;
  }
  const det = cc * ss - cs * cs;
  const a = (tc * ss - ts * cs) / det, b = (cc * ts - cs * tc) / det;
  return { gain: Math.hypot(a, b), phaseW: Math.atan2(b, a) };
};

console.log("=== B scan: relaxed first-stage (ripple to 19.2k, stop from 28.8k @96k) ===");
for (const taps of [29, 33, 37, 41]) {
  for (const beta of [5.5, 6.0, 6.5, 7.0]) {
    const h = designHalfBand2x(taps, beta);
    let rip = 0;
    for (let f = 100; f <= 19200; f += 200) rip = Math.max(rip, Math.abs(dtftDb(h, 96000, f)));
    let stop = -Infinity;
    for (let f = 28800; f <= 48000; f += 200) { if (f === 48000) continue; stop = Math.max(stop, dtftDb(h, 96000, f)); }
    const c = (taps - 1) / 2;
    console.log(`taps=${taps} beta=${beta}: ripple ${rip.toFixed(4)} dB  stop ${stop.toFixed(1)} dB  os4-lat ${(2 * c - 1) * 0.75}`);
  }
}

console.log("=== A later-stage scan (stage-appropriate bands) ===");
console.log("-- stage2 @192k: ripple to 30k, stop 60k..96k --");
for (const taps of [17, 21, 25, 29]) {
  for (const beta of [5.0, 6.0, 7.0, 8.3]) {
    const h = designHalfBand2x(taps, beta);
    let rip = 0;
    for (let f = 100; f <= 30000; f += 200) rip = Math.max(rip, Math.abs(dtftDb(h, 192000, f)));
    let stop = -Infinity;
    for (let f = 60000; f <= 96000; f += 500) { if (f === 96000) continue; stop = Math.max(stop, dtftDb(h, 192000, f)); }
    console.log(`taps=${taps} beta=${beta}: ripple ${rip.toFixed(4)} dB  stop ${stop.toFixed(1)} dB`);
  }
}
console.log("-- stage3 @384k: ripple to 60k, stop 120k..192k --");
for (const taps of [13, 17, 21, 25]) {
  for (const beta of [5.0, 6.0, 7.0, 8.3]) {
    const h = designHalfBand2x(taps, beta);
    let rip = 0;
    for (let f = 100; f <= 60000; f += 500) rip = Math.max(rip, Math.abs(dtftDb(h, 384000, f)));
    let stop = -Infinity;
    for (let f = 120000; f <= 192000; f += 1000) { if (f === 192000) continue; stop = Math.max(stop, dtftDb(h, 384000, f)); }
    console.log(`taps=${taps} beta=${beta}: ripple ${rip.toFixed(4)} dB  stop ${stop.toFixed(1)} dB`);
  }
}

console.log("=== round-trip swept-sine gain, all candidates (dB) ===");
const IDS: CandidateId[] = ["shipped", "A", "B", "C", "D5", "E"];
for (const id of IDS) {
  for (const stages of [1, 2, 3]) {
    const { up, down } = buildCandidate(id, stages);
    const gains: string[] = [];
    for (const f of [100, 1000, 4000, 8000, 16000, 19200]) {
      const { w } = renderSine(f, up, down);
      gains.push(`${f}:${(20 * Math.log10(fitTone(w, f).gain)).toFixed(3)}`);
    }
    console.log(`${id} x${2 ** stages}: ${gains.join(" ")}`);
  }
}

console.log("=== group delay (host samples): passband regression + spot values ===");
for (const id of IDS) {
  for (const stages of [1, 2, 3]) {
    const { up, down } = buildCandidate(id, stages);
    const freqs = [200, 500, 1000, 2000, 4000, 8000, 12000, 16000];
    const ph: number[] = [];
    for (const f of freqs) {
      const { w, t0 } = renderSine(f, up, down);
      const m = fitTone(w, f);
      // Remove the input's own accumulated phase: input sin at absolute t0+i
      // has phase 2πf(t0+i)/Fs; fit is relative to window start, so subtract 2πf·t0/Fs.
      // (sin = cos shifted by −π/2; the constant cancels in the slope.)
      let p = m.phaseW - ((2 * Math.PI * f * t0) / HOST);
      ph.push(p);
    }
    // unwrap
    for (let i = 1; i < ph.length; i += 1) {
      while (ph[i]! - ph[i - 1]! > Math.PI) ph[i]! -= 2 * Math.PI;
      while (ph[i]! - ph[i - 1]! < -Math.PI) ph[i]! += 2 * Math.PI;
    }
    // linear regression slope -> GD in host samples
    const w0 = freqs.map((f) => (2 * Math.PI * f) / HOST);
    const n = freqs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i += 1) { sx += w0[i]!; sy += ph[i]!; sxx += w0[i]! * w0[i]!; sxy += w0[i]! * ph[i]!; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const spots = freqs.map((f, i) => {
      if (i === 0) return `${f}:-`;
      const dw = w0[i]! - w0[i - 1]!;
      return `${f}:${(-(ph[i]! - ph[i - 1]!) / dw).toFixed(2)}`;
    });
    console.log(`${id} x${2 ** stages}: GDreg ${(-slope).toFixed(2)}  spots ${spots.join(" ")}`);
  }
}

console.log("=== impulse centroid + peak (host samples) ===");
for (const id of IDS) {
  for (const stages of [1, 2, 3]) {
    const { up, down } = buildCandidate(id, stages);
    const N = 1500;
    const input = new Float64Array(N); input[0] = 1;
    const out = roundTrip(input, up, down);
    let e = 0, c = 0, peak = 0, peakI = 0;
    for (let i = 0; i < N; i += 1) { const v = out[i]!; e += v * v; c += i * v * v; if (Math.abs(v) > peak) { peak = Math.abs(v); peakI = i; } }
    up.forEach((s) => s.reset()); down.forEach((s) => s.reset());
    console.log(`${id} x${2 ** stages}: centroid ${(c / e).toFixed(3)} peak@${peakI}`);
  }
}

console.log(`D5 solve: ${JSON.stringify(solveD5())}`);
